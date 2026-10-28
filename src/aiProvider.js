import { spoilerFilter } from './spoilerFilter.js';

const stopWords = new Set([
  'a', 'an', 'and', 'at', 'check', 'faded', 'is', 'it', 'look', 'of', 'on', 'the', 'to', 'one',
]);
const stem = word => word.toLowerCase().replace(/(ing|ed|es|s)$/u, '');

/** Creates a deterministic normalized character/word feature vector. */
export function vectorize(text, dimension = 128, context = '') {
  const vector = new Float32Array(dimension);
  const words = normalizeWords(text, context);
  const add = (feature, weight) => {
    let hash = 2166136261;
    for (const char of feature) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const index = (hash >>> 0) % dimension;
    vector[index] += (hash & 0x80000000) ? -weight : weight;
  };

  for (const word of words) add(`w:${word}`, 1.2);
  const characters = ` ${words.join(' ')} `;
  for (let i = 0; i < characters.length - 2; i++) add(`t:${characters.slice(i, i + 3)}`, 0.35);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  for (let i = 0; i < dimension; i++) vector[i] /= norm;
  return vector;
}

/** Rates hint specificity against the active room context. */
export function heuristicRate(context, text) {
  const lower = text.toLowerCase();
  const words = normalizeWords(text, context);
  const canonical = ` ${words.join(' ')} `;
  const colors = lower.match(/\b(red|blue|green|yellow)\b/g) || [];
  if (/\b(the answer is|the word is|answer:|\d+)\b/i.test(lower)) return 3;
  const orderCue = /\b(lever|switch|order|first|then|next|before|after|sequence)\b/i.test(lower);
  if (colors.length >= 2 && (orderCue || colors.length >= 3)) return 3;

  const contextWords = new Set(normalizeWords(context, context));
  const objects = ['lever', 'poster', 'clock', 'dial', 'mirror', 'floor', 'door', 'word'];
  const object = objects.find(word => contextWords.has(word) && canonical.includes(` ${word} `));
  if (object && /\b(order|colors?|cracked|mirror|reflection|read|under|behind|beneath|counts|sets|hour|sequence)\b/i.test(lower)) return 2;
  if (object) return 1;
  if (/look around|look again|explore|something/i.test(lower)) return 0;
  return 0;
}

/** Applies room-specific aliases before creating features or rating specificity. */
function normalizeWords(text, context = '') {
  const lowerContext = context.toLowerCase();
  const aliases = {
    try: 'pull', push: 'pull', use: 'pull', move: 'pull', turn: 'pull', down: 'pull',
    crimson: 'red', scarlet: 'red',
  };
  if (/lever/.test(lowerContext)) Object.assign(aliases, { switch: 'lever', handle: 'lever' });
  if (/poster/.test(lowerContext)) Object.assign(aliases, {
    picture: 'poster', image: 'poster', artwork: 'poster', painting: 'poster', wall: 'poster', art: 'poster',
  });
  if (/clock/.test(lowerContext)) Object.assign(aliases, { watch: 'clock', timepiece: 'clock' });
  if (/mirror/.test(lowerContext)) Object.assign(aliases, { reflection: 'mirror', lookingglass: 'mirror' });
  if (/floor/.test(lowerContext)) Object.assign(aliases, { ground: 'floor' });

  const lowerText = text.toLowerCase();
  const normalized = lowerText.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(Boolean)
    .map(word => stem(word))
    .map(word => aliases[word] || word)
    .filter(word => !stopWords.has(word));
  const colorCount = lowerText.match(/\b(red|blue|green|yellow)\b/g)?.length || 0;
  if (/lever/.test(lowerContext) && colorCount >= 2) normalized.push('leversequence', 'colororder');
  return normalized.filter((word, index) => index === 0 || word !== normalized[index - 1]);
}

/** Offline implementation used by demo mode. */
export class MockAIProvider {
  async moderate(texts) { return texts.map(text => spoilerFilter(text)); }
  async embed(texts, context = '') { return texts.map(text => vectorize(text, 128, context)); }
  async rate(context, hint) {
    return {
      level: heuristicRate(context, hint),
      is_spoiler_for_other_content: spoilerFilter(hint),
      off_topic: false,
      gentle_rewrite: hint.slice(0, 120),
    };
  }
}

/** Twitch integration intentionally unavailable in the offline build. */
export class TwitchAdapter {
  async connect() { throw new Error('not enabled in offline build'); }
  onMessage(_callback) { throw new Error('not enabled in offline build'); }
  onStreamOffline(_callback) { throw new Error('not enabled in offline build'); }
  onStreamOnline(_callback) { throw new Error('not enabled in offline build'); }
  async send(_text) { throw new Error('not enabled in offline build'); }
  async close() { throw new Error('not enabled in offline build'); }
}

/** OpenAI integration intentionally unavailable in the offline build. */
export class OpenAIAdapter {
  async moderate() { throw new Error('not enabled in offline build'); }
  async embed() { throw new Error('not enabled in offline build'); }
  async rate() { throw new Error('not enabled in offline build'); }
}
