/** Room metadata used by the game and the vault rater. */
export const gameRooms = [
  {
    id: 'room1-lever',
    name: 'Lever Hall',
    type: 'lever',
    context: 'Pull four colored levers in order; the order is shown by colored dots on a faded poster.',
  },
  {
    id: 'room2-clock',
    name: 'Clock Shelf',
    type: 'clock',
    context: 'Set the dial to the hour shown by the cracked clock on the shelf.',
  },
  {
    id: 'room3-mirror',
    name: 'Mirror Door',
    type: 'mirror',
    context: 'Read the four-letter word written backwards on the floor using the mirror.',
  },
];

/** Creates repeatable solutions for a supplied stream/demo seed. */
export function createSeededSolutions(seed = 'hintvault-demo') {
  if (seed === 'hintvault-demo') {
    return { levers: ['red', 'blue', 'red', 'green'], clock: 7, word: 'GLOW' };
  }
  let state = hashSeed(seed) || 1;
  const next = max => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % max;
  };
  const leverOrders = [
    ['red', 'blue', 'red', 'green'],
    ['blue', 'green', 'yellow', 'red'],
    ['green', 'red', 'blue', 'yellow'],
    ['yellow', 'red', 'green', 'blue'],
  ];
  const words = ['GLOW', 'LAMP', 'NOVA', 'BEAM'];
  return {
    levers: [...leverOrders[next(leverOrders.length)]],
    clock: [7, 4, 9, 6][next(4)],
    word: words[next(words.length)],
  };
}

/** Checks the current room's submitted solution. */
export function checkSolution(room, attempt, solutions) {
  if (room === 0 || room === 'lever') {
    const values = Array.isArray(attempt) ? attempt : attempt?.sequence;
    return Array.isArray(values) && values.length === 4 &&
      values.every((value, index) => value === solutions.levers[index]);
  }
  if (room === 1 || room === 'clock') {
    return Number(attempt?.value ?? attempt) === solutions.clock;
  }
  if (room === 2 || room === 'mirror') {
    return String(attempt?.value ?? attempt).trim().toUpperCase() === solutions.word;
  }
  return false;
}

/** Builds the client configuration for a validated game seed. */
export function gameConfig(seed = 'hintvault-demo') {
  const safeSeed = /^[\w.-]{1,64}$/u.test(seed) ? seed : 'hintvault-demo';
  return { seed: safeSeed, solutions: createSeededSolutions(safeSeed), rooms: gameRooms };
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
