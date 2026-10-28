/** Wipes stream-scoped data after inactivity or an explicit purge. */
export class Purger {
  constructor(store, timeoutMs = 12 * 60 * 60 * 1000) {
    this.store = store;
    this.timeoutMs = timeoutMs;
    this.stopped = false;
    this.timer = setInterval(() => this.expireIfInactive(), Math.min(timeoutMs, 60_000));
    this.timer.unref?.();
  }

  purge() {
    this.store.reset();
    this.store.session.costUsd = 0;
    this.store.lastActivity = Date.now();
  }

  expireIfInactive(now = Date.now()) {
    if (now - this.store.lastActivity < this.timeoutMs) return false;
    this.purge();
    return true;
  }

  close() {
    this.stop();
    this.purge();
  }

  stop() {
    clearInterval(this.timer);
    this.stopped = true;
  }
}
