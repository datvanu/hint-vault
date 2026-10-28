import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createApp } from '../src/server.js';

test('real local WebSocket accepts game events and serves the game', { timeout: 10_000 }, async t => {
  const app = createApp();
  try {
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    await app.close();
    if (error.code === 'EPERM') {
      t.skip('local listen is unavailable in this sandbox (EPERM); operator can run this test outside it');
      return;
    }
    throw error;
  }

  const { port } = app.server.address();
  let socket;
  try {
    const gameResponse = await fetch(`http://127.0.0.1:${port}/game?seed=test`);
    const gameHtml = await gameResponse.text();
    assert.match(gameHtml, /Lumen Locks/);
    assert.match(gameHtml, /assets\/game.js/);
    const gameConfigResponse = await fetch(`http://127.0.0.1:${port}/game-config?seed=test`);
    assert.equal((await gameConfigResponse.json()).seed, 'test');
    const overlayCssResponse = await fetch(`http://127.0.0.1:${port}/assets/overlay.css`);
    assert.match(await overlayCssResponse.text(), /transparent/);
    const stageResponse = await fetch(`http://127.0.0.1:${port}/stage`);
    assert.match(await stageResponse.text(), /Lumen Locks game/);
    const stageCssResponse = await fetch(`http://127.0.0.1:${port}/assets/stage.css`);
    assert.match(await stageCssResponse.text(), /grid-template-columns: 1280px 640px/);
    const previewPage = await fetch(`http://127.0.0.1:${port}/overlay?preview=open`);
    assert.match(await previewPage.text(), /overlay.js/);
    const previewStateResponse = await fetch(`http://127.0.0.1:${port}/preview-state?mode=open`);
    const previewState = await previewStateResponse.json();
    assert.equal(previewState.preview, true);
    assert.equal(previewState.released.length, 3);

    const handshake = await new Promise((resolve, reject) => {
      socket = net.connect(port, '127.0.0.1');
      let response = '';
      socket.setTimeout(3000, () => reject(new Error('WebSocket handshake timed out')));
      socket.once('error', reject);
      socket.on('data', chunk => {
        response += chunk.toString('latin1');
        if (response.includes('\r\n\r\n')) {
          socket.setTimeout(0);
          resolve(response);
        }
      });
      socket.on('connect', () => socket.write(
        'GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n' +
        'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n',
      ));
    });
    assert.match(handshake, /HTTP\/1\.1 101 Switching Protocols/);
    assert.match(handshake, /Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/i);

    socket.write(maskedTextFrame({
      type: 'puzzle', id: 'room2-clock', name: 'Clock Shelf', context: 'Cracked clock sets the dial.',
    }));
    await waitFor(() => app.store.puzzle.id === 'room2-clock');
    app.router.handle({ userId: 'viewer-1', displayName: 'Viewer One', text: '!hint check the cracked clock' });
    app.store.release(2);
    socket.write(maskedTextFrame({ type: 'solved', id: 'room2-clock' }));
    await waitFor(() => app.store.puzzle.state === 'solved');
    assert.ok(app.store.board().some(helper => helper.displayName === 'Viewer One'));
  } finally {
    socket?.destroy();
    await app.close();
  }
});

function maskedTextFrame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const header = payload.length < 126
    ? Buffer.from([0x81, 0x80 | payload.length])
    : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for server state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
