import { spoilerFilter } from './spoilerFilter.js';

const synonyms = {
  switch: 'lever', picture: 'poster', image: 'poster', pull: 'pull', try: 'pull',
  push: 'pull', use: 'pull', move: 'pull', turn: 'pull', down: 'pull',
  handle: 'lever', crimson: 'red', scarlet: 'red',
};
const stopWords = new Set(['a', 'an', 'and', 'at', 'is', 'it', 'of', 'on', 'the', 'to', 'one']);
const stem = word => word.toLowerCase().replace(/(ing|ed|es|s)$/u, '');

/** Creates a deterministic normalized character/word feature vector. */
export function vectorize(text, dimension = 128) {
  const vector = new Float32Array(dimension);
  const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(Boolean)
    .map(word => synonyms[stem(word)] || stem(word))
    .filter(word => !stopWords.has(word));
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
  const lower = text.toLowerCase()
    .replace(/\b(?:picture|image)\b/g, 'poster')
    .replace(/\bswitch\b/g, 'lever');
  const keywords = context.toLowerCase().match(/lever|clock|dial|mirror|door|poster|floor|color|colour|word/g) || [];
  const object = keywords.find(word => lower.includes(word));
  if (/\b(the answer is|the word is|answer:|\d+|red.{0,12}blue|blue.{0,12}red|green.{0,12}red)\b/i.test(lower)) return 3;
  if (object && /\b(on|under|behind|order|color|colour|cracked|mirror|read|look at|use|pull|set)\b/i.test(lower)) return 2;
  if (object) return 1;
  if (/look around|look again|explore|something/i.test(lower)) return 0;
  return 0;
}

/** Offline implementation used by demo mode. */
export class MockAIProvider {
  async moderate(texts) { return texts.map(text => spoilerFilter(text)); }
  async embed(texts) { return texts.map(text => vectorize(text)); }
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
