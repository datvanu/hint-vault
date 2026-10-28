import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCommand, CommandRouter } from '../src/commandRouter.js';
import { RateLimiter } from '../src/rateLimiter.js';
import { Clusterer, cosine } from '../src/clusterer.js';
import { vectorize, heuristicRate } from '../src/aiProvider.js';
import { CostGuard } from '../src/costGuard.js';
import { VaultStore } from '../src/vaultStore.js';
import { Purger } from '../src/purger.js';
import { filterReason, spoilerFilter } from '../src/spoilerFilter.js';
import { runSimulator } from '../demo/simulator.js';
import { checkSolution, createSeededSolutions } from '../src/game.js';
import { createApp } from '../src/server.js';

const quietHub = { broadcast() {} };

test('command parser is case-insensitive and trims input', () => {
  assert.deepEqual(parseCommand('  !HiNt pull lever '), { command: 'hint', args: 'pull lever' });
  assert.equal(parseCommand('hello'), null);
});

test('rate limiter enforces per-user, puzzle and outgoing limits', () => {
  const limiter = new RateLimiter({ userIntervalMs: 1000, perPuzzle: 2, perSession: 3 });
  assert.equal(limiter.allowHint('a', 'p', 10_000), true);
  assert.equal(limiter.allowHint('a', 'p', 10_500), false);
  assert.equal(limiter.allowHint('a', 'p', 11_000), true);
  assert.equal(limiter.allowHint('a', 'p', 12_000), false);
  assert.equal(limiter.allowOutgoing(10_000), true);
  assert.equal(limiter.allowOutgoing(11_999), false);
});

test('semantic cluster groups paraphrases and separates unrelated hints', () => {
  const clusterer = new Clusterer(0.36);
  const groups = [];
  const hints = [
    { id: '1', userId: 'a', level: 1, text: 'pull the red lever' },
    { id: '2', userId: 'b', level: 2, text: 'try the red switch' },
    { id: '3', userId: 'c', level: 0, text: 'the cracked clock shows seven' },
  ];
  for (const hint of hints) clusterer.add(groups, hint, vectorize(hint.text));
  assert.equal(groups.length, 2);
  assert.equal(groups[0].distinctUsers.size, 2);
  assert.ok(cosine(vectorize(hints[0].text), vectorize(hints[1].text)) >= 0.36);
});

test('five differently worded lever hints form one five-viewer group', () => {
  const phrases = [
    'pull the red lever',
    'try the red switch',
    'move the crimson handle down',
    'the red lever is the one to pull',
    'use the scarlet switch',
  ];
  const clusterer = new Clusterer(0.36);
  const groups = [];
  phrases.forEach((text, index) => clusterer.add(
    groups,
    { id: `hint-${index}`, userId: `viewer-${index}`, level: 1, text },
    vectorize(text),
  ));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].distinctUsers.size, 5);
});

test('room-aware aliases normalize wall art, watches, reflections, and ground', () => {
  const contexts = [
    ['Lever Hall poster', 'faded poster', 'picture on the wall'],
    ['cracked clock on the shelf', 'the clock', 'the watch'],
    ['mirror on the wall', 'the mirror', 'the reflection'],
    ['word written on the floor', 'the floor', 'the ground'],
  ];
  for (const [context, first, second] of contexts) {
    assert.ok(cosine(vectorize(first, 128, context), vectorize(second, 128, context)) > 0.5);
  }
});

test('release ordering is gentle first and rank descending', () => {
  const store = new VaultStore();
  for (const [text, userId] of [
    ['look around', 'u1'], ['look around', 'u2'],
    ['poster colors show the lever order', 'u3'], ['the answer is red blue red green', 'u4'],
  ]) store.addHint({ userId, text });
  const gentle = store.release(0);
  assert.ok(gentle.length > 0);
  assert.ok(gentle.every(item => item.level === 0));
  const next = store.release(1);
  assert.ok(next.every((item, index) => index === 0 || next[index - 1].rank >= item.rank));
  assert.ok(store.more().every(item => item.level <= 2));
});

test('level three requires a second !more within ten seconds', () => {
  const store = new VaultStore();
  store.addHint({ userId: 'solver', text: 'the answer is red blue red green' });
  const router = new CommandRouter({ store, limiter: new RateLimiter(), hub: quietHub });
  const host = { userId: 'host', badges: [{ set_id: 'broadcaster' }] };
  router.handle({ ...host, text: '!stuck' });
  router.handle({ ...host, text: '!more' });
  router.handle({ ...host, text: '!more' });
  assert.equal(store.puzzle.maxReleasedLevel, 2);
  router.handle({ ...host, text: '!more' });
  assert.equal(store.puzzle.maxReleasedLevel, 2);
  router.handle({ ...host, text: '!more' });
  assert.equal(store.puzzle.maxReleasedLevel, 3);
  router.close();
});

test('CostGuard estimates spend and switches to fallback at cap', () => {
  const guard = new CostGuard(0.001, { m: { input: 1, output: 2 } });
  assert.equal(guard.allow(0.0005), true);
  guard.record({ inputTokens: 1000, outputTokens: 0 }, 'm');
  assert.equal(guard.usdSpent, 0.001);
  assert.equal(guard.fallback, true);
  assert.equal(guard.allow(0), false);
});

test('CostGuard engages heuristic mode at a one-cent stream cap', () => {
  const guard = new CostGuard(0.01, { model: { input: 10, output: 10 } });
  assert.equal(guard.allow(0.011), false);
  assert.equal(guard.fallback, true);
  const store = new VaultStore({ cap: 0.01 });
  store.costGuard.allow(0.011);
  assert.equal(store.state().costMeter.aiPaused, true);
});

test('forgetme removes hints, memberships and board entries', () => {
  const store = new VaultStore();
  store.addHint({ userId: 'u', displayName: 'U', text: 'look at the poster' });
  store.addHint({ userId: 'v', text: 'look at the poster' });
  store.credit('u', 'U');
  store.forget('u');
  assert.equal(store.hints.some(hint => hint.userId === 'u'), false);
  assert.equal(store.board().length, 0);
  assert.ok(store.groups.every(group => !group.distinctUsers.has('u')));
});

test('purge empties session data', () => {
  const store = new VaultStore();
  store.addHint({ userId: 'u', text: 'look around' });
  const purger = new Purger(store, 999_999);
  purger.purge();
  clearInterval(purger.timer);
  assert.equal(store.hints.length, 0);
  assert.equal(store.groups.length, 0);
});

test('inactivity purger expires old sessions and app close clears its timers', async () => {
  const store = new VaultStore();
  store.addHint({ userId: 'viewer', text: 'check the poster' });
  const purger = new Purger(store, 1000);
  assert.equal(purger.expireIfInactive(store.lastActivity + 1001), true);
  assert.equal(store.hints.length, 0);
  purger.close();

  const app = createApp();
  app.store.addHint({ userId: 'viewer', text: 'check the poster' });
  await app.close();
  assert.equal(app.store.hints.length, 0);
  assert.equal(app.purger.stopped, true);
});

test('stream.offline event purges session hints and helpers', () => {
  const store = new VaultStore();
  store.addHint({ userId: 'viewer', text: 'check the poster' });
  store.credit('viewer', 'Viewer');
  const router = new CommandRouter({ store, limiter: new RateLimiter(), hub: quietHub });
  router.streamOffline();
  assert.equal(store.hints.length, 0);
  assert.equal(store.board().length, 0);
  store.addHint({ userId: 'again', text: 'check the poster' });
  router.handle({ userId: 'host', badges: [{ set_id: 'broadcaster' }], text: '!vaultreset' });
  assert.equal(store.hints.length, 0);
  router.close();
});

test('outgoing limiter caps a 200-message burst at one per two seconds', () => {
  const limiter = new RateLimiter();
  const accepted = [];
  for (let index = 0; index < 200; index++) {
    const now = 2000 + index * 50;
    if (limiter.allowOutgoing(now)) accepted.push(now);
  }
  assert.equal(accepted.length, 5);
  for (let index = 1; index < accepted.length; index++) {
    assert.ok(accepted[index] - accepted[index - 1] >= 2000);
  }
});

test('filter rules reject toxic words, links, story spoilers and spam', () => {
  const examples = [
    ['you are an idiot', 'toxic'],
    ['visit https://spam.example/path', 'link'],
    ['the hero dies at the ending', 'story-spoiler'],
    ['the villain is revealed at the end', 'story-spoiler'],
    ['THE ANSWER IS RED BLUE GREEN', 'caps-spam'],
    ['loooooooook at the room', 'repeat-spam'],
  ];
  for (const [text, reason] of examples) assert.equal(filterReason(text), reason);
  assert.equal(spoilerFilter('look at the poster'), false);
  assert.equal(filterReason('find the rune', ['rune']), 'toxic');
});

test('heuristic rating uses context keywords across all rooms', () => {
  assert.equal(heuristicRate('colored levers and a poster show the order', 'Check the picture on the wall'), 1);
  assert.equal(heuristicRate('cracked clock hour sets the dial', 'Only the cracked clock counts'), 2);
  assert.equal(heuristicRate('read the mirrored word on the floor', 'The word is GLOW'), 3);
  assert.equal(heuristicRate('a room with a hidden clue', 'Look around again'), 0);
});

test('filtered hints never enter the overlay state', () => {
  const store = new VaultStore();
  const router = new CommandRouter({ store, limiter: new RateLimiter(), hub: quietHub });
  for (const [index, text] of [
    'you are an idiot', 'https://spam.example', 'the hero dies at the ending',
  ].entries()) router.handle({ userId: `u${index}`, text: `!hint ${text}` });
  assert.equal(store.state().counts.hints, 0);
  store.release(3);
  assert.deepEqual(store.state().released, []);
});

test('demo timeline completes and filters content end to end', async () => {
  const store = new VaultStore();
  const router = new CommandRouter({ store, limiter: new RateLimiter(), hub: quietHub });
  await runSimulator(router, { speed: 100 });
  assert.equal(store.hints.some(hint => /dies at the ending/i.test(hint.text)), false);
  assert.equal(store.hints.some(hint => /https?:/i.test(hint.text)), false);
  assert.equal(store.hints.some(hint => /idiot/i.test(hint.text)), false);
  assert.equal(store.hints.some(hint => hint.userId === 'pixel_pia'), false);
  assert.equal(store.puzzle.state, 'solved');
  router.close();
});

test('demo hold stops at the open vault before the first !solved', async () => {
  const store = new VaultStore();
  const router = new CommandRouter({ store, limiter: new RateLimiter(), hub: quietHub });
  const result = await runSimulator(router, { speed: 100, hold: true });
  assert.equal(result.heldBeforeSolved, true);
  assert.notEqual(store.puzzle.state, 'solved');
  assert.equal(store.puzzle.maxReleasedLevel, 3);
  router.close();
});

test('seeded solutions are deterministic and room checkers accept only the solution', () => {
  const first = createSeededSolutions('stream-42');
  assert.deepEqual(first, createSeededSolutions('stream-42'));
  assert.notDeepEqual(first, createSeededSolutions('stream-43'));
  for (const [room, solution, correct, wrong] of [
    ['lever', first, { sequence: first.levers }, { sequence: ['red', 'red', 'blue', 'green'] }],
    ['clock', first, { value: first.clock }, { value: first.clock + 1 }],
    ['mirror', first, { value: first.word.toLowerCase() }, { value: 'NOPE' }],
  ]) {
    assert.equal(checkSolution(room, correct, solution), true);
    assert.equal(checkSolution(room, wrong, solution), false);
  }
});

test('game events switch puzzle context and solve with helper credit', () => {
  const store = new VaultStore();
  const router = new CommandRouter({ store, limiter: new RateLimiter(), hub: quietHub });
  store.addHint({ userId: 'helper', displayName: 'Helper', text: 'look at the poster' });
  store.release(0);
  assert.equal(router.handleGameEvent({
    type: 'puzzle', id: 'room2-clock', name: 'Clock Shelf', context: 'Cracked clock hour sets the dial.',
  }), true);
  assert.equal(store.puzzle.id, 'room2-clock');
  assert.equal(store.puzzle.context, 'Cracked clock hour sets the dial.');
  store.addHint({ userId: 'clock-helper', displayName: 'Clock Helper', text: 'check the cracked clock' });
  store.release(2);
  assert.equal(router.handleGameEvent({ type: 'solved', id: 'room2-clock' }), true);
  assert.equal(store.puzzle.state, 'solved');
  assert.ok(store.board().some(helper => helper.displayName === 'Clock Helper'));
});

test('same-id game puzzle events preserve open hints and canonical puzzle ids agree', () => {
  const store = new VaultStore();
  const router = new CommandRouter({ store, limiter: new RateLimiter(), hub: quietHub });
  assert.equal(store.puzzle.id, 'room1-lever');
  store.addHint({ userId: 'viewer', text: 'look at the faded poster' });
  store.release(1);
  const before = store.state();

  assert.equal(router.handleGameEvent({
    type: 'puzzle', id: 'room1-lever', name: 'Lever Hall', context: store.puzzle.context,
  }), true);
  assert.equal(store.state().mode, 'open');
  assert.equal(store.hints.length, 1);
  assert.equal(store.puzzle.id, before.puzzle.id);

  router.handle({ userId: 'host', badges: [{ set_id: 'broadcaster' }], text: '!puzzle Clock Shelf' });
  assert.equal(store.puzzle.id, 'room2-clock');
  assert.equal(store.puzzle.name, 'Clock Shelf');
  router.handle({ userId: 'host', badges: [{ set_id: 'broadcaster' }], text: '!puzzle room3-mirror' });
  assert.equal(store.puzzle.id, 'room3-mirror');
  assert.equal(store.puzzle.name, 'Mirror Door');
  router.close();
});

test('exact Lever Hall demo hints rate and release gently, with poster paraphrases grouped', async () => {
  const events = JSON.parse(await readFile(new URL('../demo/script.json', import.meta.url), 'utf8'))
    .filter(event => event.at < 36);
  const store = new VaultStore();
  const router = new CommandRouter({ store, limiter: new RateLimiter(), hub: quietHub });
  for (const event of events) {
    router.handle({
      text: event.text,
      userId: event.user,
      userLogin: event.user,
      displayName: event.name,
      badges: event.role ? [{ set_id: event.role }] : [],
    });
  }

  assert.equal(store.hints.length, 5);
  const larry = store.hints.find(hint => hint.userId === 'lever_larry');
  const sam = store.hints.find(hint => hint.userId === 'switch_sam');
  const ryan = store.hints.find(hint => hint.userId === 'red_ryan');
  assert.equal(larry.level, 1);
  assert.equal(sam.level, 1);
  assert.equal(ryan.level, 3);
  assert.equal(larry.groupId, sam.groupId);

  const firstRelease = store.release(1);
  assert.equal(firstRelease.length, 1);
  assert.equal(firstRelease[0].level, 1);
  assert.equal(firstRelease[0].rank, 2);
  const laterRelease = store.release(3);
  assert.deepEqual(laterRelease.map(group => group.level), [1, 2, 3]);
  router.close();
});
