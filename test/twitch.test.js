import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TwitchAuth } from '../src/twitchAuth.js';
import { TwitchEventSub } from '../src/twitchEventSub.js';
import { createApp } from '../src/server.js';

const fakeAccess = 'fake-access-token';
const fakeRefresh = 'fake-refresh-token';

test('token refresh atomically replaces the token file with mode 0600', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'hintvault-auth-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const tokenFile = join(folder, 'token.json');
  const calls = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    calls.push({ url: request.url, body });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ access_token: 'new-fake-access', refresh_token: 'new-fake-refresh', expires_in: 3600, scope: ['user:read:chat'], token_type: 'bearer' }));
  });
  const base = await listen(server, t);
  if (!base) return;
  const auth = new TwitchAuth({ tokenFile, clientId: 'fake-client-id', idBase: base, fetchImpl: fetch });
  auth.token = { access_token: fakeAccess, refresh_token: fakeRefresh, scope: [], token_type: 'bearer' };
  await auth.writeTokenAtomically(auth.token);
  await auth.refresh();
  const file = JSON.parse(await readFile(tokenFile, 'utf8'));
  assert.equal(file.access_token, 'new-fake-access');
  assert.equal((await stat(tokenFile)).mode & 0o777, 0o600);
  assert.equal(calls.length, 1);
  assert.match(calls[0].body, /grant_type=refresh_token/);
  assert.match(calls[0].body, /client_id=fake-client-id/);
  assert.doesNotMatch(calls[0].body, /fake-client-secret/);
  assert.deepEqual((await readdir(folder)).filter(name => name.endsWith('.tmp')), []);
});

test('401 from Helix refreshes once and retries; token values stay out of errors', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'hintvault-401-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const tokenFile = join(folder, 'token.json');
  const token = { access_token: fakeAccess, refresh_token: fakeRefresh, expires_in: 3600, scope: [], token_type: 'bearer' };
  await writeFile(tokenFile, JSON.stringify(token), { mode: 0o600 });
  let helixCalls = 0;
  const server = http.createServer(async (request, response) => {
    if (request.url === '/oauth2/token') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ access_token: 'refreshed-fake-access', refresh_token: 'refreshed-fake-refresh', expires_in: 3600 }));
      return;
    }
    if (request.url === '/oauth2/validate') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ login: 'test-login', user_id: '123', scopes: [], expires_in: 3600 }));
      return;
    }
    helixCalls++;
    if (request.url === '/helix/fail') {
      response.writeHead(401);
      response.end(fakeAccess);
      return;
    }
    if (helixCalls === 1) { response.writeHead(401); response.end(fakeAccess); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ ok: true }] }));
  });
  const base = await listen(server, t);
  if (!base) return;
  const auth = new TwitchAuth({ tokenFile, clientId: 'fake-client-id', idBase: base, helixBase: `${base}/helix`, fetchImpl: fetch });
  const result = await auth.helix('example');
  assert.equal(result.data[0].ok, true);
  assert.equal(helixCalls, 2);
  await assert.rejects(auth.helix('fail'), error =>
    error.message.includes('HTTP 401') && !error.message.includes(fakeAccess) && !error.message.includes(fakeRefresh));

  const broken = new TwitchAuth({ tokenFile: join(folder, 'missing.json'), clientId: 'fake-client-id' });
  await assert.rejects(broken.validate(), error => !error.message.includes(fakeAccess) && !error.message.includes(fakeRefresh));
});

test('EventSub welcome creates chat and stream subscriptions with the token owner IDs', async t => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, path: request.url, body: body ? JSON.parse(body) : null });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: `sub-${requests.length}`, status: 'enabled' }] }));
  });
  const base = await listen(server, t);
  if (!base) return;
  const auth = fakeAuth(base);
  const eventSub = new TwitchEventSub({ auth, WebSocketImpl: FakeWebSocket, websocketUrl: 'ws://fake', onStatus: () => {} });
  t.after(() => eventSub.stop());
  const result = await eventSub.connect();
  assert.equal(result.subscription.status, 'enabled');
  const chat = requests[0];
  assert.equal(chat.path, '/eventsub/subscriptions');
  assert.equal(chat.body.type, 'channel.chat.message');
  assert.deepEqual(chat.body.condition, { broadcaster_user_id: 'own-42', user_id: 'own-42' });
  assert.equal(requests.length, 3);
  assert.deepEqual([...eventSub.subscriptionIds], ['sub-1', 'sub-2', 'sub-3']);
});

test('validate refreshes a token after 401 and proactively below 300 seconds', async t => {
  let validationCount = 0;
  let refreshCount = 0;
  const server = http.createServer(async (request, response) => {
    if (request.url === '/oauth2/token') {
      refreshCount++;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ access_token: `fake-new-${refreshCount}`, refresh_token: `fake-refresh-${refreshCount}` }));
      return;
    }
    validationCount++;
    if (validationCount === 1) { response.writeHead(401); response.end(fakeAccess); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ login: 'fake-login', user_id: '42', scopes: [], expires_in: validationCount === 2 ? 100 : 3600 }));
  });
  const base = await listen(server, t);
  if (!base) return;
  const folder = await mkdtemp(join(tmpdir(), 'hintvault-validate-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const tokenFile = join(folder, 'token.json');
  await writeFile(tokenFile, JSON.stringify({ access_token: fakeAccess, refresh_token: fakeRefresh }), { mode: 0o600 });
  const auth = new TwitchAuth({ tokenFile, clientId: 'fake-client-id', idBase: base, fetchImpl: fetch });
  const identity = await auth.validate();
  assert.equal(identity.expires_in, 3600);
  assert.equal(validationCount, 3, '401 retry, short expiry check, post-refresh validation');
  assert.equal(refreshCount, 2, 'refresh once after 401, then refresh proactively');
});

test('keepalive watchdog closes a silent socket and reconnect swaps only after welcome', async t => {
  const eventSub = new TwitchEventSub({
    auth: { validate: async () => ({ user_id: 'own-42' }), helix: async () => ({ data: [{ id: 'sub' }] }) },
    WebSocketImpl: FakeWebSocket, websocketUrl: 'ws://initial', onStatus: () => {}, watchdogGraceMs: 15,
  });
  t.after(() => eventSub.stop());
  const first = new FakeWebSocket('ws://initial');
  eventSub.socket = first;
  eventSub.armWatchdog(first, 0.005);
  await delay(30);
  assert.equal(first.closeCalls.length, 1);

  const old = new FakeWebSocket('ws://old');
  old.readyState = 1;
  eventSub.socket = old;
  eventSub.identity = { user_id: 'own-42' };
  eventSub.subscriptionIds = new Set(['existing-subscription']);
  const reconnect = eventSub.connectSocket('ws://reconnect', true);
  const pending = FakeWebSocket.instances.at(-1);
  await tick();
  assert.equal(old.closeCalls.length, 0);
  pending.message({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'new-session', keepalive_timeout_seconds: 30 } } });
  await reconnect;
  assert.equal(old.closeCalls.length, 1);
  assert.equal(eventSub.socket, pending);
  assert.deepEqual([...eventSub.subscriptionIds], ['existing-subscription'], 'reconnect keeps the existing subscription set');
  eventSub.scheduleReconnect();
  assert.equal(eventSub.lastReconnectDelay, 1000);
  clearTimeout(eventSub.reconnectTimer);
  eventSub.reconnectTimer = null;
  eventSub.scheduleReconnect();
  assert.equal(eventSub.lastReconnectDelay, 2000, 'consecutive transport failures back off');
});

test('notifications dedupe message IDs, filter shared chat, and enforce both own-account modes', async () => {
  const routed = [];
  const eventSub = new TwitchEventSub({
    auth: {}, WebSocketImpl: FakeWebSocket, websocketUrl: 'ws://none', onStatus: () => {},
    onMessage: message => routed.push(message),
  });
  eventSub.identity = { user_id: 'own-42' };
  const notification = (id, chatter, text, source = null) => ({
    metadata: { message_type: 'notification' },
    payload: { subscription: { type: 'channel.chat.message' }, event: {
      chatter_user_id: chatter, chatter_user_login: 'viewer', chatter_user_name: 'Viewer',
      message_id: id, message: { text }, badges: [{ set_id: 'moderator' }], source_broadcaster_user_id: source,
    } },
  });
  await eventSub.handlePayload({}, JSON.stringify(notification('shared', 'viewer-1', '!hint other', 'other-channel')));
  await eventSub.handlePayload({}, JSON.stringify(notification('one', 'viewer-1', '!hint safe')));
  await eventSub.handlePayload({}, JSON.stringify(notification('one', 'viewer-1', '!hint duplicate')));
  eventSub.sentIds.add('sent-id');
  await eventSub.handlePayload({}, JSON.stringify(notification('sent-id', 'own-42', '!hint outgoing')));
  await eventSub.handlePayload({}, JSON.stringify(notification('manual', 'own-42', '!hint manual')));
  await eventSub.handlePayload({}, JSON.stringify(notification('demo', 'own-42', '[Hint Vault demo] !hint demo')));
  await eventSub.handlePayload({}, JSON.stringify(notification('status', 'viewer-1', '[Hint Vault] status')));
  assert.deepEqual(routed.map(message => message.messageId), ['one', 'demo']);
  assert.equal(routed[1].text, '!hint demo');

  eventSub.ownMessages = 'all-except-status';
  await eventSub.handlePayload({}, JSON.stringify(notification('manual-2', 'own-42', '!hint manual')));
  assert.equal(routed.at(-1).messageId, 'manual-2');
});

test('dry-run send logs intent and never calls fetch', async () => {
  let fetchCalls = 0;
  const messages = [];
  const eventSub = new TwitchEventSub({
    auth: { helix: async () => { fetchCalls++; } }, WebSocketImpl: FakeWebSocket,
    websocketUrl: 'ws://none', dryRunSend: true, onStatus: text => messages.push(text),
  });
  eventSub.identity = { user_id: 'own-42' };
  assert.deepEqual(await eventSub.send('hello demo'), { dryRun: true });
  assert.equal(fetchCalls, 0);
  assert.deepEqual(messages, ['would send: [Hint Vault] hello demo']);
});

test('default app remains mock and game sidebar copy does not reveal clues', async () => {
  const app = createApp();
  assert.equal(app.liveClient, undefined);
  await app.close();
  const { roomDescriptions, controlDescriptions } = await import('../public/game-copy.js');
  const renderedCopy = [...roomDescriptions, ...Object.values(controlDescriptions)].join(' ');
  assert.doesNotMatch(renderedCopy, /cracked clock is the clue|floor writing is backwards|mirror may help you read|pull them in the right order/iu);
  assert.match(renderedCopy, /Set the dial/u);
  assert.match(renderedCopy, /Enter the door word/u);
});

function fakeAuth(base) {
  return {
    validate: async () => ({ login: 'fake-login', user_id: 'own-42', scopes: [], expires_in: 3600 }),
    helix: async (path, options = {}) => {
      const response = await fetch(`${base}/${path}`, {
        method: options.method || 'GET',
        headers: options.body ? { 'content-type': 'application/json' } : {},
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
      return response.json();
    },
  };
}

async function listen(server, t) {
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('local listen unavailable in this sandbox (EPERM); operator can run outside it');
      return null;
    }
    throw error;
  }
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.handlers = new Map();
    this.closeCalls = [];
    this.readyState = 0;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open', {});
      if (url === 'ws://fake') queueMicrotask(() => this.message({
        metadata: { message_type: 'session_welcome' },
        payload: { session: { id: 'session-fake', keepalive_timeout_seconds: 600 } },
      }));
    });
  }
  addEventListener(name, callback) {
    const listeners = this.handlers.get(name) || [];
    listeners.push(callback);
    this.handlers.set(name, listeners);
  }
  removeEventListener(name, callback) {
    this.handlers.set(name, (this.handlers.get(name) || []).filter(item => item !== callback));
  }
  emit(name, event) { for (const callback of this.handlers.get(name) || []) callback(event); }
  message(value) { this.emit('message', { data: JSON.stringify(value) }); }
  close(code = 1000, reason = '') {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.emit('close', {});
  }
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function tick() { return new Promise(resolve => setImmediate(resolve)); }
