import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { handshakeResponse } from './wsProtocol.js';
import { config } from './config.js';
import { VaultStore } from './vaultStore.js';
import { RateLimiter } from './rateLimiter.js';
import { OverlayHub } from './overlayHub.js';
import { CommandRouter } from './commandRouter.js';
import { Purger } from './purger.js';
import { MockAIProvider, TwitchAdapter, OpenAIAdapter } from './aiProvider.js';
import { renderGamePage } from './game.js';
import { runSimulator } from '../demo/simulator.js';

const overlayPage = `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;background:transparent;color:#f4f7ff;font:28px system-ui;overflow:hidden}
.vault{position:absolute;left:35%;top:20%;width:30%;height:55%;display:grid;place-content:center;text-align:center;background:radial-gradient(ellipse,#13263eea,#06101be8);border:8px solid #79cfff;border-radius:48%;box-shadow:0 0 70px #239cff66}
.widget{position:absolute;right:30px;top:24px;background:#081522dd;padding:16px 24px;border:2px solid #78d2ff;border-radius:18px}.cards{position:absolute;right:2%;top:20%;width:32%}.card{padding:18px;margin:12px;background:#101d2def;border-left:8px solid #8ceaff;border-radius:12px}.level3{border-color:#ff8c91}.board{position:absolute;left:25px;bottom:24px;background:#071321df;padding:12px 20px;border-radius:10px}h1{font-size:50px}
</style></head><body><div id="root"></div><script>
const root=document.querySelector('#root');
const safe=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function draw(state){
  const cards=(state.released||[]).map(item=>'<div class="card level'+item.level+'">'+safe(item.text)+' <b>×'+item.rank+'</b></div>').join('');
  const board=(state.helpedBoard||[]).map(item=>safe(item.displayName)+' ×'+item.helps).join(' · ');
  root.innerHTML='<div class="widget">🔒 '+state.counts.hints+' hints · '+state.counts.groups+' groups · '+(state.helpedBoard||[]).slice(0,3).map(item=>safe(item.displayName)).join(', ')+'</div><div class="vault"><h1>'+safe(state.mode==='sealed'?'🔒 Vault sealed':state.mode==='solved'?'Solved!':'Vault open')+'</h1><div>'+safe(state.puzzle.name)+'</div></div><div class="cards">'+cards+'</div><div class="board">Helped '+board+'</div>';
}
const socket=new WebSocket('ws://'+location.host+'/ws');
socket.onmessage=event=>draw(JSON.parse(event.data));
draw({mode:'sealed',puzzle:{name:'Hint Vault'},counts:{hints:0,groups:0},released:[],helpedBoard:[]});
</script></body></html>`;

const adminPage = `<!doctype html><meta charset="utf-8"><title>Hint Vault admin</title>
<style>body{font:16px system-ui;background:#101722;color:#eef;padding:24px}button{padding:12px;margin:5px;background:#2679a8;color:white;border:0;border-radius:8px}pre{white-space:pre-wrap}</style>
<h1>Hint Vault · Admin</h1><p>Groups and cost meter. Demo controls.</p>
<div><button onclick="send('!stuck')">!stuck</button><button onclick="send('!more')">!more</button><button onclick="send('!solved')">!solved</button><button onclick="fetch('/purge',{method:'POST'})">Purge now</button></div>
<pre id="state"></pre><script>
const socket=new WebSocket('ws://'+location.host+'/ws');
socket.onmessage=event=>document.querySelector('#state').textContent=JSON.stringify(JSON.parse(event.data),null,2);
function send(text){fetch('/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})})}
</script>`;

const stagePage = `<!doctype html><html><head><meta charset="utf-8"><title>Lumen Locks · Stage</title>
<style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#07111d;color:#eef;font:22px system-ui}.stage{height:100%;display:grid;grid-template-columns:2fr 1fr;background:radial-gradient(ellipse at 45% 40%,#18334c,#07111d 75%)}iframe{border:0;width:100%;height:100%}.side{padding:34px 30px;border-left:1px solid #69ddff70;background:#091725c9}.name{color:#8beeff;letter-spacing:.14em;text-transform:uppercase;font-size:24px}.count{margin:22px 0;padding:18px;border:1px solid #73dbff66;border-radius:16px;background:#102338}.hint{margin:12px 0;padding:16px;border-left:5px solid #8beeff;background:#12243a;border-radius:8px}.board{margin-top:25px;color:#c5dced}.caption{font-size:14px;color:#aac5d8;margin-top:20px}</style></head><body>
<main class="stage"><iframe title="Lumen Locks game" src="/game?embedded=1"></iframe><aside class="side"><div class="name">Hint Vault</div><h1 id="puzzle">Lever Hall</h1><div class="count" id="counts">🔒 0 hints · 0 groups</div><section id="hints">Vault sealed. Chat hints stay hidden until the player gets stuck.</section><div class="board" id="board">Helped board</div><div class="caption">Simulated viewers · offline demo</div></aside></main>
<script>
const safe=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const socket=new WebSocket('ws://'+location.host+'/ws');
socket.onmessage=event=>{const state=JSON.parse(event.data);document.querySelector('#puzzle').textContent=state.puzzle.name;document.querySelector('#counts').textContent='🔒 '+state.counts.hints+' hints · '+state.counts.groups+' groups · '+state.counts.viewers+' viewers';document.querySelector('#hints').innerHTML=(state.released||[]).map(item=>'<div class="hint">'+safe(item.text)+' <b>×'+item.rank+'</b></div>').join('')||'Vault sealed. Chat hints stay hidden until the player gets stuck.';document.querySelector('#board').textContent='Helped: '+(state.helpedBoard||[]).map(item=>item.displayName+' ×'+item.helps).join(' · ')};
</script></body></html>`;

/** Creates an offline app instance without binding a port. */
export function createApp() {
  const store = new VaultStore({
    threshold: config.clusterThreshold,
    cap: config.maxUsd,
    pricing: config.pricing.models,
    blocklist: config.blocklist,
  });
  const hub = new OverlayHub();
  const limiter = new RateLimiter();
  const router = new CommandRouter({ store, limiter, hub, blocklist: config.blocklist });
  const provider = config.provider === 'openai' ? new OpenAIAdapter() : new MockAIProvider();
  // Adapters are deliberately not invoked in this offline build.
  void provider;
  void new TwitchAdapter();
  const purger = new Purger(store, config.inactivityMs);

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/overlay' || url.pathname === '/admin' || url.pathname === '/stage') {
      const page = url.pathname === '/overlay' ? overlayPage : url.pathname === '/admin' ? adminPage : stagePage;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(page);
      return;
    }
    if (url.pathname === '/game') {
      const seed = /^[\w.-]{1,64}$/u.test(url.searchParams.get('seed') || '')
        ? url.searchParams.get('seed')
        : 'hintvault-demo';
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(renderGamePage({ seed, embedded: url.searchParams.get('embedded') === '1' }));
      return;
    }
    if (url.pathname === '/state') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(store.state()));
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
      if (frameData.opcode === 0x9) socket.write(frame(0xA, frameData.payload));
      if (frameData.opcode === 0x8) socket.end(frame(0x8, frameData.payload));
      if (frameData.opcode === 0x1) {
        try { router.handleGameEvent(JSON.parse(frameData.payload.toString('utf8'))); } catch { /* Ignore invalid client data. */ }
      }
    });
    socket.on('close', () => hub.clients.delete(client));
    socket.on('error', () => hub.clients.delete(client));
  });

  return { server, store, hub, router, limiter, purger };
}

/** Starts listening and prints the local pages used by the demo. */
export function startServer({ port = config.port, demo = false, speed = 3 } = {}) {
  const app = createApp();
  app.server.listen(port, '127.0.0.1', () => {
    const actualPort = app.server.address().port;
    const base = `http://localhost:${actualPort}`;
    console.log(`Hint Vault offline server: ${base}`);
    console.log(`Stage: ${base}/stage`);
    console.log(`Game: ${base}/game`);
    console.log(`Overlay: ${base}/overlay`);
    console.log(`Admin: ${base}/admin`);
    if (demo) runSimulator(app.router, { speed });
  });
  const shutdown = () => {
    app.purger.close();
    app.server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('exit', () => app.store.reset());
  return app;
}

/** Encodes a server WebSocket frame. */
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
        const largeLength = buffer.readBigUInt64BE(2);
        if (largeLength > 1_048_576n) { socket.destroy(); return; }
        length = Number(largeLength);
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
  const speed = speedIndex >= 0 ? Number(process.argv[speedIndex + 1]) || 3 : 3;
  startServer({ demo, speed });
}
