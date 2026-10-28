import test from 'node:test';
import assert from 'node:assert/strict';
import { handshakeResponse } from '../src/wsProtocol.js';

test('RFC6455 websocket handshake response uses the required accept key',()=>{
  const response=handshakeResponse('dGhlIHNhbXBsZSBub25jZQ==');
  assert.match(response,/^HTTP\/1\.1 101 Switching Protocols\r\n/);
  assert.match(response,/Upgrade: websocket\r\nConnection: Upgrade\r\n/);
  assert.match(response,/Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=\r\n/);
});
