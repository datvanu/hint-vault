export class RateLimiter {
  constructor({ userIntervalMs = 20_000, perPuzzle = 3, perSession = 30, globalRate = 2, globalBurst = 4 } = {}) {
    Object.assign(this, { userIntervalMs, perPuzzle, perSession, globalRate, globalBurst }); this.users = new Map(); this.tokens = globalBurst; this.last = Date.now(); this.outgoingAt = 0;
  }
  allowHint(userId, puzzleId, now = Date.now()) {
    let u = this.users.get(userId) || { last: 0, total: 0, puzzles: new Map() };
    if (now - u.last < this.userIntervalMs || u.total >= this.perSession || (u.puzzles.get(puzzleId) || 0) >= this.perPuzzle) return false;
    u.last = now; u.total++; u.puzzles.set(puzzleId, (u.puzzles.get(puzzleId) || 0) + 1); this.users.set(userId, u); return true;
  }
  allowGlobal(now = Date.now()) { this.tokens = Math.min(this.globalBurst, this.tokens + (now - this.last) * this.globalRate / 1000); this.last = now; if (this.tokens < 1) return false; this.tokens--; return true; }
  allowOutgoing(now = Date.now()) { if (now - this.outgoingAt < 2000) return false; this.outgoingAt = now; return true; }
  forget(userId) { this.users.delete(userId); }
}
