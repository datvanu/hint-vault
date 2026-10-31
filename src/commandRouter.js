import { gameRooms } from './game.js';

/** Parses supported commands from a complete trimmed chat message. */
export function parseCommand(text) {
  const message = String(text || '').trim();
  const match = message.match(/^!(hint|stuck|more|solved|puzzle|vault|forgetme|vaultreset)(?:\s+([\s\S]*))?$/i);
  return match ? { command: match[1].toLowerCase(), args: (match[2] || '').trim() } : null;
}

const PUZZLES_BY_ALIAS = new Map(gameRooms.flatMap(room => [
  [room.name.toLowerCase(), room],
  [room.id.toLowerCase(), room],
]));

/** Routes simulated or real chat messages to the vault state. */
export class CommandRouter {
  constructor({ store, limiter, hub, blocklist = [], onReply = () => {} }) {
    Object.assign(this, { store, limiter, hub, blocklist, onReply });
    this.moreConfirmAt = 0;
    this.timers = new Set();
  }

  isPrivileged(message) {
    return (message.badges || []).some(badge => ['broadcaster', 'moderator'].includes(badge.set_id));
  }

  handle(message) {
    const command = parseCommand(message.text);
    if (!command) return false;
    const userId = message.userId || message.user_id || 'anon';

    if (command.command === 'hint') {
      if (command.args.length < 3 || command.args.length > 300 ||
          !this.limiter.allowHint(userId, this.store.puzzle.id)) return true;
      this.store.addHint({
        userId,
        userLogin: message.userLogin || userId,
        displayName: message.displayName || message.userLogin || userId,
        text: command.args,
        messageId: message.messageId,
      });
      this.publish();
      return true;
    }

    if (command.command === 'vault') {
      if (this.limiter.allowOutgoing()) {
        this.onReply(`Vault: ${this.store.hints.length} hint${this.store.hints.length === 1 ? '' : 's'} from ${this.store.counts().viewers} viewer${this.store.counts().viewers === 1 ? '' : 's'}`);
      }
      return true;
    }

    if (command.command === 'forgetme') {
      this.store.forget(userId);
      this.limiter.forget(userId);
      this.publish();
      if (this.limiter.allowOutgoing()) this.onReply(`@${message.userLogin || userId} your data was deleted`);
      return true;
    }

    const privilegedCommands = ['stuck', 'more', 'solved', 'puzzle', 'vaultreset'];
    if (privilegedCommands.includes(command.command) && !this.isPrivileged(message)) return true;

    if (command.command === 'stuck') {
      this.store.release(0);
      this.hub.broadcast({ ...this.store.state(), mode: 'opening', released: [] });
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.publish();
      }, 1500);
      timer.unref?.();
      this.timers.add(timer);
    } else if (command.command === 'more') {
      const now = Date.now();
      if (this.store.puzzle.maxReleasedLevel === 2 && now - this.moreConfirmAt > 10_000) {
        this.moreConfirmAt = now;
        if (this.limiter.allowOutgoing()) this.onReply('Are you sure? Type !more again');
        return true;
      }
      this.store.more();
      this.moreConfirmAt = 0;
    } else if (command.command === 'solved') {
      this.store.solve(command.args || null);
    } else if (command.command === 'puzzle') {
      const details = PUZZLES_BY_ALIAS.get(command.args.toLowerCase());
      this.store.startPuzzle({
        id: details?.id || (command.args ? undefined : gameRooms[0].id),
        name: details?.name || command.args || gameRooms[0].name,
        context: details?.context,
      });
    } else if (command.command === 'vaultreset') {
      this.store.reset();
    }

    this.publish();
    return true;
  }

  /** Applies local game events received over the existing WebSocket. */
  handleGameEvent(event) {
    if (!event || typeof event !== 'object') return false;
    if (event.type === 'puzzle' && event.id && event.name) {
      const changed = this.store.startPuzzle({ id: event.id, name: event.name, context: event.context });
      if (changed) this.publish();
      return true;
    }
    if (event.type === 'attempt') {
      if (event.id && event.id !== this.store.puzzle.id) return false;
      this.store.attempt = { correct: Boolean(event.correct) };
      this.publish();
      return true;
    }
    if (event.type === 'solved') {
      if (event.id && event.id !== this.store.puzzle.id) return false;
      this.store.solve(event.user || null);
      this.publish();
      return true;
    }
    return false;
  }

  streamOffline() {
    this.store.reset();
    this.publish();
  }

  close() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  publish() { this.hub.broadcast(this.store.state()); }
}
