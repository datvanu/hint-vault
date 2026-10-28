import { Clusterer } from './clusterer.js';
import { vectorize, heuristicRate } from './aiProvider.js';
import { spoilerFilter } from './spoilerFilter.js';
import { CostGuard } from './costGuard.js';

const ROOM_CONTEXTS = {
  'Lever Hall': 'Pull four colored levers in order; the order is shown by colored dots on a faded poster.',
  'Clock Shelf': 'Set the dial to the hour shown by the cracked clock on the shelf.',
  'Mirror Door': 'Read the four-letter word written backwards on the floor using the mirror.',
};

/** In-memory stream and puzzle state. Hint content is never logged or persisted. */
export class VaultStore {
  constructor({ threshold = 0.36, cap = 1, pricing = { mock: { input: 0, output: 0 } }, blocklist = [] } = {}) {
    this.session = { id: 'session-1', broadcasterId: 'demo', startedAt: Date.now(), demo: true, costUsd: 0 };
    this.helpers = new Map();
    this.threshold = threshold;
    this.cap = cap;
    this.pricing = pricing;
    this.costGuard = new CostGuard(cap, pricing);
    this.blocklist = blocklist;
    this.startPuzzle({ id: 'puzzle-1', name: 'Lever Hall', context: ROOM_CONTEXTS['Lever Hall'] });
    this.lastActivity = Date.now();
  }

  /** Switches puzzles while preserving stream-level helper credits. */
  startPuzzle({ id, name, context }) {
    this.puzzle = {
      id: id || `puzzle-${Date.now()}`,
      sessionId: this.session.id,
      name: name || 'Lever Hall',
      context: context || ROOM_CONTEXTS[name] || ROOM_CONTEXTS['Lever Hall'],
      state: 'collecting',
      maxReleasedLevel: -1,
    };
    this.hints = [];
    this.groups = [];
    this.released = [];
    this.lastReleasedGroupId = null;
    this.open = false;
    this.attempt = null;
    this.clusterer = new Clusterer(this.threshold);
    this.lastActivity = Date.now();
  }

  addHint({ userId, userLogin = userId, displayName = userLogin, text, messageId = null }, rating) {
    if (spoilerFilter(text, this.blocklist)) return null;
    const hint = {
      id: `h${this.hints.length + 1}`,
      puzzleId: this.puzzle.id,
      userId,
      userLogin,
      displayName,
      text,
      createdAt: Date.now(),
      messageId,
      level: rating?.level ?? heuristicRate(this.puzzle.context, text),
      flags: [],
      embedding: vectorize(text),
    };
    this.hints.push(hint);
    const group = this.clusterer.add(this.groups, hint, hint.embedding);
    hint.groupId = group.id;
    this.lastActivity = Date.now();
    return hint;
  }

  counts() {
    return {
      hints: this.hints.length,
      groups: this.groups.length,
      viewers: new Set(this.hints.map(hint => hint.userId)).size,
    };
  }

  release(maxLevel = this.puzzle.maxReleasedLevel) {
    this.puzzle.state = 'released';
    this.open = true;
    this.puzzle.maxReleasedLevel = maxLevel;
    const available = this.groups
      .filter(group => group.level <= maxLevel)
      .sort((a, b) => a.level - b.level || b.distinctUsers.size - a.distinctUsers.size)
      .slice(0, 3);
    this.released = available.map(group => ({
      groupId: group.id,
      level: group.level,
      text: group.repText,
      rank: group.distinctUsers.size,
    }));
    if (available.length) this.lastReleasedGroupId = available[0].id;
    return this.released;
  }

  more() { return this.release(Math.min(3, this.puzzle.maxReleasedLevel + 1)); }

  solve(user = null) {
    if (user) {
      const login = user.replace(/^@/, '').toLowerCase();
      const hint = this.hints.find(item => item.userId === user || item.userLogin.toLowerCase() === login);
      if (hint) this.credit(hint.userId, hint.displayName);
    } else {
      const group = this.groups.find(item => item.id === this.lastReleasedGroupId);
      if (group) {
        for (const id of group.distinctUsers) {
          const hint = this.hints.find(item => item.userId === id);
          if (hint) this.credit(id, hint.displayName);
        }
      }
    }
    this.puzzle.state = 'solved';
    return this.board();
  }

  credit(userId, displayName) {
    const helper = this.helpers.get(userId) || { userId, displayName, helps: 0 };
    helper.helps++;
    this.helpers.set(userId, helper);
  }

  board() {
    return [...this.helpers.values()]
      .sort((a, b) => b.helps - a.helps)
      .slice(0, 10)
      .map(({ displayName, helps }) => ({ displayName, helps }));
  }

  forget(userId) {
    const removed = this.hints.filter(hint => hint.userId === userId).length;
    this.hints = this.hints.filter(hint => hint.userId !== userId);
    this.helpers.delete(userId);
    this.rebuildGroups();
    return removed;
  }

  rebuildGroups() {
    this.groups = [];
    for (const hint of this.hints) {
      const group = this.clusterer.add(this.groups, hint, hint.embedding);
      hint.groupId = group.id;
    }
    if (this.lastReleasedGroupId && !this.groups.some(group => group.id === this.lastReleasedGroupId)) {
      this.lastReleasedGroupId = null;
    }
  }

  /** Full purge, including helpers. */
  reset() {
    this.helpers.clear();
    this.costGuard.reset();
    this.startPuzzle({ id: `puzzle-${Date.now()}`, name: 'Lever Hall', context: ROOM_CONTEXTS['Lever Hall'] });
  }

  state() {
    return {
      mode: this.puzzle.state === 'solved' ? 'solved' : this.open ? 'open' : 'sealed',
      puzzle: { id: this.puzzle.id, name: this.puzzle.name },
      counts: this.counts(),
      released: this.open ? this.released : [],
      attempt: this.attempt,
      helpedBoard: this.board(),
      costMeter: {
        usdSpent: this.costGuard.usdSpent,
        usdCap: this.cap,
        warning: this.costGuard.warning,
        aiPaused: this.costGuard.fallback,
      },
    };
  }

  /** Admin-only snapshot includes group representatives for local debugging. */
  adminState() {
    return {
      ...this.state(),
      groups: this.groups.map(group => ({
        id: group.id,
        level: group.level,
        rank: group.distinctUsers.size,
        text: group.repText,
      })),
    };
  }
}
