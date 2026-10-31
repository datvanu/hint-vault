import { readFile, rename, open, chmod } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_ID_BASE = 'https://id.twitch.tv';
const DEFAULT_HELIX_BASE = 'https://api.twitch.tv/helix';

/** User-token manager for Twitch OAuth and authenticated Helix requests. */
export class TwitchAuth {
  constructor({
    tokenFile = process.env.HINTVAULT_TWITCH_TOKEN_FILE,
    clientId = process.env.TWITCH_CLIENT_ID,
    idBase = process.env.TWITCH_ID_BASE || DEFAULT_ID_BASE,
    helixBase = process.env.TWITCH_HELIX_BASE || DEFAULT_HELIX_BASE,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.tokenFile = tokenFile;
    this.clientId = clientId;
    this.idBase = idBase.replace(/\/$/u, '');
    this.helixBase = helixBase.replace(/\/$/u, '');
    this.fetch = fetchImpl;
    this.token = null;
    this.identity = null;
  }

  async load() {
    if (!this.tokenFile) throw new Error('Set HINTVAULT_TWITCH_TOKEN_FILE to enable Twitch live mode');
    if (!this.clientId) throw new Error('Set TWITCH_CLIENT_ID to enable Twitch live mode');
    if (!this.token) {
      try {
        this.token = JSON.parse(await readFile(this.tokenFile, 'utf8'));
        await chmod(this.tokenFile, 0o600);
      } catch (error) {
        throw new Error(`Unable to read Twitch token file (${error.code || 'invalid JSON'})`);
      }
      if (!this.token?.access_token || !this.token?.refresh_token) {
        throw new Error('Twitch token file must contain access_token and refresh_token');
      }
    }
    return this.token;
  }

  async validate({ allowUnauthorizedRefresh = true, allowProactiveRefresh = true } = {}) {
    await this.load();
    let response;
    try {
      response = await this.fetch(`${this.idBase}/oauth2/validate`, {
        headers: { Authorization: `OAuth ${this.token.access_token}` },
      });
    } catch {
      throw new Error('Twitch token validation request failed');
    }
    if (response.status === 401 && allowUnauthorizedRefresh) {
      await this.refresh();
      return this.validate({ allowUnauthorizedRefresh: false });
    }
    if (!response.ok) throw await this.responseError('Twitch token validation', response);
    const data = await response.json();
    const identity = {
      login: data.login,
      user_id: data.user_id,
      scopes: data.scopes || [],
      expires_in: data.expires_in,
    };
    this.identity = identity;
    if (allowProactiveRefresh && Number(identity.expires_in) < 300) {
      await this.refresh();
      return this.validate({ allowUnauthorizedRefresh: false, allowProactiveRefresh: false });
    }
    return identity;
  }

  async refresh() {
    await this.load();
    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: 'refresh_token',
      refresh_token: this.token.refresh_token,
    });
    let response;
    try {
      response = await this.fetch(`${this.idBase}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch {
      throw new Error('Twitch token refresh request failed');
    }
    if (!response.ok) throw await this.responseError('Twitch token refresh', response);
    const replacement = await response.json();
    if (!replacement.access_token || !replacement.refresh_token) {
      throw new Error('Twitch token refresh returned an incomplete token response');
    }
    this.token = { ...this.token, ...replacement };
    await this.writeTokenAtomically(this.token);
    return this.token;
  }

  async helix(path, { method = 'GET', body, query } = {}, retried = false) {
    await this.load();
    const url = new URL(`${this.helixBase}/${path.replace(/^\//u, '')}`);
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const headers = {
      'Client-Id': this.clientId,
      Authorization: `Bearer ${this.token.access_token}`,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error('Twitch Helix request failed');
    }
    if (response.status === 401 && !retried) {
      await this.refresh();
      return this.helix(path, { method, body, query }, true);
    }
    if (!response.ok) throw await this.responseError('Twitch Helix request', response);
    if (response.status === 204) return null;
    return response.json();
  }

  async writeTokenAtomically(token) {
    const directory = dirname(this.tokenFile);
    const temporary = join(directory, `.${basename(this.tokenFile)}.${randomUUID()}.tmp`);
    let file;
    try {
      file = await open(temporary, 'wx', 0o600);
      await file.writeFile(`${JSON.stringify(token, null, 2)}\n`, 'utf8');
      await file.sync();
      await file.close();
      file = null;
      await rename(temporary, this.tokenFile);
      await chmod(this.tokenFile, 0o600);
    } catch (error) {
      await file?.close().catch(() => {});
      const { unlink } = await import('node:fs/promises');
      await unlink(temporary).catch(() => {});
      throw new Error(`Unable to update Twitch token file (${error.code || 'I/O error'})`);
    }
  }

  async responseError(label, response) {
    // Do not include response bodies or request URLs: either can contain secrets.
    return new Error(`${label} failed with HTTP ${response.status}`);
  }

  redactError(error) {
    let message = String(error?.message || 'unknown error');
    for (const secret of [this.clientId, this.token?.access_token, this.token?.refresh_token]) {
      if (secret) message = message.split(secret).join('[redacted]');
    }
    return message;
  }
}
