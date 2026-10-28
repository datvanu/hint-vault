/** Broadcasts full overlay snapshots at no more than ten updates per second. */
export class OverlayHub {
  constructor() {
    this.clients = new Set();
    this.last = 0;
    this.pending = null;
  }

  add(client) {
    this.clients.add(client);
    client.onClose = () => this.clients.delete(client);
  }

  broadcast(state) {
    const now = Date.now();
    if (now - this.last < 100) {
      this.pending = state;
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          const pending = this.pending;
          this.pending = null;
          this.broadcastNow(pending);
        }, 100 - (now - this.last));
      }
      return;
    }
    this.broadcastNow(state);
  }

  broadcastNow(state) {
    this.last = Date.now();
    const data = JSON.stringify(state);
    for (const client of this.clients) client.send(data);
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.clients.clear();
  }
}
