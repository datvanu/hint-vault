import test from 'node:test';
import assert from 'node:assert/strict';
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

test('CostGuard estimates spend and switches to fallback at cap', () => {
  const guard = new CostGuard(0.001, { m: { input: 1, output: 2 } });
  assert.equal(guard.allow(0.0005), true);
  guard.record({ inputTokens: 1000, outputTokens: 0 }, 'm');
  assert.equal(guard.usdSpent, 0.001);
  assert.equal(guard.fallback, true);
  assert.equal(guard.allow(0), false);
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
  assert.equal(heuristicRate('colored levers and a poster show the order', 'Check the picture on the wall'), 2);
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
