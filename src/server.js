import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { handshakeResponse } from './wsProtocol.js';
import { config } from './config.js';
import { VaultStore } from './vaultStore.js';
import { RateLimiter } from './rateLimiter.js';
import { OverlayHub } from './overlayHub.js';
import { CommandRouter } from './commandRouter.js';
import { Purger } from './purger.js';
import { MockAIProvider, TwitchAdapter, OpenAIAdapter } from './aiProvider.js';
import { gameConfig } from './game.js';
import { runSimulator } from '../demo/simulator.js';
import { TwitchAuth } from './twitchAuth.js';
import { TwitchEventSub } from './twitchEventSub.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDirectory = join(root, 'public');
const previewStates = JSON.parse(readFileSync(join(root, 'demo/overlay-previews.json'), 'utf8'));
const publicRoutes = new Map([
  ['/overlay', ['overlay.html', 'text/html; charset=utf-8']],
  ['/admin', ['admin.html', 'text/html; charset=utf-8']],
  ['/stage', ['stage.html', 'text/html; charset=utf-8']],
  ['/game', ['game.html', 'text/html; charset=utf-8']],
  ['/assets/overlay.css', ['overlay.css', 'text/css; charset=utf-8']],
  ['/assets/overlay.js', ['overlay.js', 'text/javascript; charset=utf-8']],
  ['/assets/admin.css', ['admin.css', 'text/css; charset=utf-8']],
  ['/assets/admin.js', ['admin.js', 'text/javascript; charset=utf-8']],
  ['/assets/stage.css', ['stage.css', 'text/css; charset=utf-8']],
  ['/assets/stage.js', ['stage.js', 'text/javascript; charset=utf-8']],
  ['/assets/game.css', ['game.css', 'text/css; charset=utf-8']],
  ['/assets/game.js', ['game.js', 'text/javascript; charset=utf-8']],
  ['/assets/game-copy.js', ['game-copy.js', 'text/javascript; charset=utf-8']],
]);

/** Creates an offline app instance without binding a port. */
export function createApp({ live = false, dryRunSend = false } = {}) {
  const store = new VaultStore({
    threshold: config.clusterThreshold,
    cap: config.maxUsd,
    pricing: config.pricing.models,
    blocklist: config.blocklist,
  });
  const hub = new OverlayHub();
  const limiter = new RateLimiter();
  let liveClient;
  let replyCount = 0;
  const router = new CommandRouter({
    store, limiter, hub, blocklist: config.blocklist,
    onReply: text => {
      if (!liveClient) return;
      const cap = Number(process.env.HINTVAULT_MAX_SENDS || Infinity);
      replyCount += 1;
      if (replyCount > cap) { console.log(`reply suppressed by HINTVAULT_MAX_SENDS=${cap}: ${text}`); return; }
      liveClient.send(text)
        .then(result => console.log(`reply #${replyCount} ${result?.dryRun ? 'dry-run' : 'sent'}: ${text}`))
        .catch(error => console.error('Twitch chat send failed:', error.message));
    },
  });
  const provider = config.provider === 'openai' ? new OpenAIAdapter() : new MockAIProvider();
  // Adapters stay dormant in this offline build; they contain no network calls.
  void provider;
  if (!live) void new TwitchAdapter();
  if (live) {
    const auth = new TwitchAuth();
    liveClient = new TwitchEventSub({
      auth,
      dryRunSend: dryRunSend || process.env.HINTVAULT_ALLOW_SEND !== '1',
      deleteHintMessages: config.deleteHintMessages,
      onMessage: message => { console.log(`received ${message.messageId}: ${message.text}`); router.handle(message); },
      onStreamOffline: () => router.streamOffline(),
      onStreamOnline: () => { if (store.puzzle.state === 'solved') store.reset(); },
      onStatus: message => console.log(message),
    });
  }
  const purger = new Purger(store, config.inactivityMs);
  const demoController = new AbortController();
  const sockets = new Set();
  let closePromise;

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const publicFile = publicRoutes.get(url.pathname);
    if (publicFile) {
      response.writeHead(200, { 'content-type': publicFile[1] });
      response.end(readFileSync(join(publicDirectory, publicFile[0])));
      return;
    }

    if (url.pathname === '/game-config') {
      const requestedSeed = url.searchParams.get('seed') || '';
      const seed = /^[\w.-]{1,64}$/u.test(requestedSeed) ? requestedSeed : 'hintvault-demo';
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(gameConfig(seed)));
      return;
    }

    if (url.pathname === '/mode') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ live }));
      return;
    }

    if (url.pathname === '/preview-state') {
      const mode = url.searchParams.get('mode');
      if (!Object.hasOwn(previewStates, mode)) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'unknown preview state' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ...previewStates[mode], preview: true }));
      return;
    }

    if (url.pathname === '/state') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(store.state()));
      return;
    }

    if (url.pathname === '/admin-state') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(store.adminState()));
      return;
    }

    if (url.pathname === '/command' && request.method === 'POST') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        try {
          router.handle({
            text: JSON.parse(body).text,
            badges: [{ set_id: 'broadcaster' }],
            userId: 'admin',
            userLogin: 'admin',
          });
          response.writeHead(204);
          response.end();
        } catch {
          response.writeHead(400);
          response.end();
        }
      });
      return;
    }

    if (url.pathname === '/purge' && request.method === 'POST') {
      purger.purge();
      router.publish();
      response.writeHead(204);
      response.end();
      return;
    }

    response.writeHead(404);
    response.end('Not found');
  });

  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  server.on('upgrade', (request, socket) => {
    if (request.url !== '/ws' || !request.headers['sec-websocket-key']) {
      socket.destroy();
      return;
    }
    socket.write(handshakeResponse(request.headers['sec-websocket-key']));
    const client = {
      send(data) { if (!socket.destroyed) socket.write(frame(0x1, data)); },
    };
    hub.add(client);
    client.send(JSON.stringify(store.state()));
    readFrames(socket, frameData => {
      if (frameData.opcode === 0x9) socket.write(frame(0xa, frameData.payload));
      if (frameData.opcode === 0x8) socket.end(frame(0x8, frameData.payload));
      if (frameData.opcode === 0x1) {
        try {
          router.handleGameEvent(JSON.parse(frameData.payload.toString('utf8')));
        } catch {
          // Invalid or unrelated client messages are ignored.
        }
      }
    });
    socket.on('close', () => hub.clients.delete(client));
    socket.on('error', () => hub.clients.delete(client));
  });

  async function close() {
    if (closePromise) return closePromise;
    demoController.abort();
    router.close();
    hub.close();
    purger.close();
    liveClient?.stop();
    closePromise = new Promise(resolve => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(resolve);
      server.closeAllConnections?.();
      // Node excludes upgraded WebSocket sockets from closeAllConnections().
      for (const socket of sockets) socket.destroy();
    });
    return closePromise;
  }

  return { server, store, hub, router, limiter, purger, close, signal: demoController.signal, liveClient };
}

/** Starts listening and prints the pages used by the demo. */
export function startServer({ port = config.port, demo = false, speed = 1, hold = false, live = false, dryRunSend = false } = {}) {
  const app = createApp({ live, dryRunSend });
  app.server.listen(port, '127.0.0.1', () => {
    const base = `http://localhost:${app.server.address().port}`;
    console.log(`Hint Vault ${live ? 'live' : 'offline'} server: ${base}`);
    console.log(`Stage: ${base}/stage`);
    console.log(`Game: ${base}/game`);
    console.log(`Overlay: ${base}/overlay`);
    console.log(`Admin: ${base}/admin`);
    if (demo) {
      runSimulator(app.router, { speed, hold, signal: app.signal })
        .catch(error => console.error('Demo simulator stopped:', error.message));
    }
    if (live) {
      app.liveClient.connect().then(({ subscription }) => {
        console.log(`Twitch EventSub connected; chat subscription ${subscription?.status || 'active'}`);
      }).catch(async error => {
        console.error(`Twitch live mode could not start: ${app.liveClient.auth.redactError(error)}`);
        await app.close();
        process.exitCode = 1;
      });
    }
  });
  const shutdown = () => app.close().then(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('exit', () => app.store.reset());
  return app;
}

/** Encodes one unmasked server WebSocket frame. */
function frame(opcode, payload) {
  const data = Buffer.from(payload);
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

/** Reads complete masked client frames from a socket. */
function readFrames(socket, onFrame) {
  let buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = Boolean(buffer[1] & 0x80);
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const longLength = buffer.readBigUInt64BE(2);
        if (longLength > 1_048_576n) { socket.destroy(); return; }
        length = Number(longLength);
        offset = 10;
      }
      if (!masked) { socket.destroy(); return; }
      if (buffer.length < offset + 4 + length) return;
      const mask = buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      buffer = buffer.subarray(offset + 4 + length);
      onFrame({ opcode, payload });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const demo = process.argv.includes('--demo');
  const speedIndex = process.argv.indexOf('--speed');
  const speed = speedIndex >= 0 ? Number(process.argv[speedIndex + 1]) || 1 : 1;
  const hold = process.argv.includes('--hold');
  const live = process.argv.includes('--live');
  const sim = process.argv.includes('--sim');
  const dryRunSend = process.argv.includes('--dry-run-send');
  startServer({ demo: demo || sim, speed, hold, live, dryRunSend });
}
