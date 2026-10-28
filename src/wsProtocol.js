import { createHash } from 'node:crypto';

const websocketGuid = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Calculates Sec-WebSocket-Accept from the client's nonce. */
export function websocketAccept(key) {
  return createHash('sha1').update(key + websocketGuid).digest('base64');
}

/** Builds the RFC 6455 HTTP 101 upgrade response. */
export function handshakeResponse(key) {
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${websocketAccept(key)}`,
    '',
    '',
  ].join('\r\n');
}
