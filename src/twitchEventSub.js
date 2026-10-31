const DEFAULT_EVENTSUB = 'wss://eventsub.wss.twitch.tv/ws';

/** EventSub WebSocket consumer and Helix chat sender. */
export class TwitchEventSub {
  constructor({
    auth,
    websocketUrl = process.env.TWITCH_EVENTSUB_WS || DEFAULT_EVENTSUB,
    WebSocketImpl = globalThis.WebSocket,
    onMessage = () => {},
    onStreamOffline = () => {},
    onStreamOnline = () => {},
    onStatus = message => console.log(message),
    ownMessages = process.env.HINTVAULT_OWN_MESSAGES || 'demo-tag-only',
    allowSend = process.env.HINTVAULT_ALLOW_SEND === '1',
    dryRunSend = !allowSend,
    deleteHintMessages = false,
    watchdogGraceMs = 5000,
  }) {
    if (!WebSocketImpl) throw new Error('This Node.js runtime needs a WebSocket implementation');
    Object.assign(this, {
      auth, websocketUrl, WebSocketImpl, onMessage, onStreamOffline,
      onStreamOnline, onStatus, ownMessages, dryRunSend, deleteHintMessages,
      watchdogGraceMs,
    });
    this.sentIds = new Set();
    this.seenIds = new Set();
    this.socket = null;
    this.watchdog = null;
    this.lastSendAt = 0;
    this.sendQueue = Promise.resolve();
    this.stopped = false;
  }

  async connect() {
    this.stopped = false;
    this.identity = await this.auth.validate();
    return this.connectSocket(this.websocketUrl, false);
  }

  async connectSocket(url, reconnecting) {
    const socket = new this.WebSocketImpl(url);
    this.welcomeWaiters ||= new Map();
    const welcome = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Twitch EventSub welcome timed out')), 12_000);
      timeout.unref?.();
      this.welcomeWaiters.set(socket, { resolve, reject, timeout, reconnecting });
    });
    socket.addEventListener('message', event => {
      this.handlePayload(socket, event.data, reconnecting).catch(error => {
        this.onStatus(`Twitch EventSub error: ${safeError(error, this.auth)}`);
      });
    });
    socket.addEventListener('close', () => {
      const waiter = this.welcomeWaiters?.get(socket);
      if (waiter) {
        clearTimeout(waiter.timeout);
        this.welcomeWaiters.delete(socket);
        waiter.reject(new Error('Twitch EventSub connection closed before welcome'));
      }
      if (this.socket === socket && !this.stopped) this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      const waiter = this.welcomeWaiters?.get(socket);
      if (!waiter) return;
      clearTimeout(waiter.timeout);
      this.welcomeWaiters.delete(socket);
      waiter.reject(new Error('Twitch EventSub WebSocket connection failed'));
    });
    this.pendingSocket = socket;
    return welcome;
  }

  async handlePayload(socket, raw, reconnecting) {
    let envelope;
    try { envelope = JSON.parse(typeof raw === 'string' ? raw : await raw.text()); }
    catch { return; }
    const metadata = envelope.metadata || {};
    const payload = envelope.payload || {};
    if (payload.session?.keepalive_timeout_seconds) {
      socket.keepaliveTimeoutSeconds = Number(payload.session.keepalive_timeout_seconds);
    }
    this.armWatchdog(socket, socket.keepaliveTimeoutSeconds || 10);

    if (metadata.message_type === 'session_welcome') {
      const sessionId = payload.session?.id;
      if (!sessionId) throw new Error('EventSub welcome did not include a session id');
      if (!reconnecting || !this.identity) this.identity = await this.auth.validate();
      let subscription;
      if (!reconnecting) {
        const subscriptions = [
          {
        method: 'POST',
        body: {
          type: 'channel.chat.message',
          version: '1',
          condition: {
            broadcaster_user_id: this.identity.user_id,
            user_id: this.identity.user_id,
          },
          transport: { method: 'websocket', session_id: sessionId },
        },
          },
          ...['stream.offline', 'stream.online'].map(type => ({
            method: 'POST',
            body: {
              type,
              version: '1',
              condition: { broadcaster_user_id: this.identity.user_id },
              transport: { method: 'websocket', session_id: sessionId },
            },
          })),
        ];
        const results = await Promise.all(subscriptions.map(request =>
          this.auth.helix('eventsub/subscriptions', request)));
        subscription = results[0]?.data?.[0];
        for (const result of results) {
          const id = result?.data?.[0]?.id;
          if (id) this.subscriptionIds ||= new Set(), this.subscriptionIds.add(id);
        }
      }
      const waiter = this.welcomeWaiters?.get(socket);
      if (waiter) {
        clearTimeout(waiter.timeout);
        this.welcomeWaiters.delete(socket);
        const previous = this.socket;
        this.socket = socket;
        this.pendingSocket = null;
        this.reconnectAttempts = 0;
        if (waiter.reconnecting && previous && previous !== socket) previous.close(1000, 'reconnected');
        waiter.resolve({ sessionId, subscription });
      }
      return;
    }

    if (metadata.message_type === 'session_keepalive') return;
    if (metadata.message_type === 'session_reconnect') {
      const reconnectUrl = payload.session?.reconnect_url;
      if (reconnectUrl) this.connectSocket(reconnectUrl, true).catch(error => {
        this.onStatus(`Twitch reconnect failed: ${safeError(error, this.auth)}`);
        this.scheduleReconnect();
      });
      return;
    }
    if (metadata.message_type === 'revocation') {
      const status = payload.subscription?.status || 'unknown';
      this.onStatus(`Twitch EventSub subscription revoked (${status}); stopping chat ingest`);
      await this.stop();
      return;
    }
    if (metadata.message_type !== 'notification') return;
    const subscriptionType = payload.subscription?.type;
    const event = payload.event || {};
    if (subscriptionType === 'stream.offline') { this.onStreamOffline(); return; }
    if (subscriptionType === 'stream.online') { this.onStreamOnline(); return; }
    if (subscriptionType !== 'channel.chat.message') return;
    if (event.source_broadcaster_user_id && event.source_broadcaster_user_id !== this.identity.user_id) return;
    const id = event.message_id;
    if (!id || this.seenIds.has(id)) return;
    this.seenIds.add(id);
    if (this.seenIds.size > 5000) this.seenIds.delete(this.seenIds.values().next().value);
    let text = event.message?.text || '';
    const prefix = '[Hint Vault]';
    if (this.sentIds.has(id) || text.startsWith(prefix)) return;
    if (event.chatter_user_id === this.identity.user_id) {
      const demoTag = '[Hint Vault demo]';
      if (this.ownMessages === 'all-except-status') {
        if (text.includes(demoTag)) text = text.replace(demoTag, '').trim();
      } else {
        if (!text.includes(demoTag)) return;
        text = text.replace(demoTag, '').trim();
      }
    }
    const badges = (event.badges || []).map(badge => ({ set_id: badge.set_id }));
    this.onMessage({
      userId: event.chatter_user_id,
      user_id: event.chatter_user_id,
      userLogin: event.chatter_user_login,
      displayName: event.chatter_user_name,
      text,
      badges,
      messageId: id,
    });
    if (this.deleteHintMessages && text.trimStart().toLowerCase().startsWith('!hint')) {
      this.auth.helix('moderation/chat', {
        method: 'DELETE',
        query: {
          broadcaster_id: this.identity.user_id,
          moderator_id: this.identity.user_id,
          message_id: id,
        },
      }).catch(error => this.onStatus(`Could not delete hint message (${safeError(error, this.auth)})`));
    }
  }

  armWatchdog(socket, seconds) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (socket === this.socket || socket === this.pendingSocket) socket.close(4002, 'keepalive timeout');
    }, (Number(seconds) * 1000) + this.watchdogGraceMs);
    this.watchdog.unref?.();
  }

  scheduleReconnect(delayMs) {
    if (this.reconnectTimer || this.stopped) return;
    this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
    const delay = delayMs ?? Math.min(30_000, 1000 * (2 ** Math.min(this.reconnectAttempts - 1, 5)));
    this.lastReconnectDelay = delay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSocket(this.websocketUrl, true).catch(error => {
        this.onStatus(`Twitch reconnect failed: ${safeError(error, this.auth)}`);
        this.scheduleReconnect();
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  send(text) {
    const queued = this.sendQueue.then(() => this.sendNow(text));
    this.sendQueue = queued.catch(() => {});
    return queued;
  }

  async sendNow(text) {
    const message = String(text).slice(0, 500);
    const prefixed = message.startsWith('[Hint Vault]') ? message : `[Hint Vault] ${message}`;
    const wait = 1000 - (Date.now() - this.lastSendAt);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    this.lastSendAt = Date.now();
    if (this.dryRunSend) {
      this.onStatus(`would send: ${prefixed}`);
      return { dryRun: true };
    }
    const result = await this.auth.helix('chat/messages', {
      method: 'POST',
      body: {
        broadcaster_id: this.identity.user_id,
        sender_id: this.identity.user_id,
        message: prefixed,
      },
    });
    const data = result?.data?.[0];
    if (!data?.is_sent) throw new Error('Twitch chat send was rejected');
    if (data.message_id) this.sentIds.add(data.message_id);
    return data;
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.watchdog);
    clearTimeout(this.reconnectTimer);
    for (const waiter of this.welcomeWaiters?.values() || []) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('Twitch EventSub stopped'));
    }
    this.welcomeWaiters?.clear();
    this.socket?.close(1000, 'stopped');
    this.pendingSocket?.close(1000, 'stopped');
    this.socket = null;
    this.pendingSocket = null;
  }
}

function safeError(error, auth) {
  return String(auth?.redactError?.(error) || error?.message || 'unknown error')
    .replace(/\b(?:Bearer|OAuth)\s+\S+/giu, '[redacted]');
}
