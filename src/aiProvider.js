const synonyms = { switch: 'lever', picture: 'poster', image: 'poster', pull: 'pull', try: 'pull', push: 'pull', crimson: 'red', scarlet: 'red' };
const stem = w => w.toLowerCase().replace(/(ing|ed|es|s)$/u, '');
export function vectorize(text, dim = 128) {
  const v = new Float32Array(dim); const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map(w => synonyms[stem(w)] || stem(w));
  const add = (s, weight) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); const i = (h >>> 0) % dim; v[i] += (h & 0x80000000) ? -weight : weight; };
  for (const w of words) add(`w:${w}`, 1.2); const chars = ` ${words.join(' ')} `; for (let i=0;i<chars.length-2;i++) add(`t:${chars.slice(i,i+3)}`, .35);
  const norm = Math.sqrt(v.reduce((s,x)=>s+x*x,0)) || 1; for (let i=0;i<dim;i++) v[i] /= norm; return v;
}
export function heuristicRate(context, text) {
  const t = text.toLowerCase(), c = context.toLowerCase(); const object = (c.match(/lever|clock|dial|mirror|door|poster|floor|color|colour|word/g) || []).find(w => t.includes(w));
  if (/\b(the answer is|answer:|\d+|red.{0,12}blue|blue.{0,12}red|green.{0,12}red)\b/i.test(t)) return 3;
  if (object && /\b(on|under|behind|order|color|colour|cracked|mirror|read|look at|use|pull|set)\b/i.test(t)) return 2;
  if (object) return 1; if (/look around|look again|explore|something/i.test(t)) return 0; return 0;
}
export function moderate(text, blocklist = []) {
  const t = text.toLowerCase(); const caps = (text.match(/[A-Z]/g)||[]).length / Math.max(1,(text.match(/[a-z]/gi)||[]).length);
  return /https?:\/\/|www\./i.test(text) || caps > .5 || /(.)\1{5,}/i.test(text) || [...blocklist, 'kill yourself','idiot','nazi'].some(w=>t.includes(w)) || /\b(dies|ending|the killer is|at the end)\b/i.test(t);
}
export class MockAIProvider {
  async moderate(texts) { return texts.map(t => moderate(t)); }
  async embed(texts) { return texts.map(t => vectorize(t)); }
  async rate(ctx, hint) { return { level: heuristicRate(ctx,hint), is_spoiler_for_other_content: /\b(dies|ending|the killer is)\b/i.test(hint), off_topic: false, gentle_rewrite: hint.slice(0,120) }; }
}
export class TwitchAdapter { async connect() { throw new Error('not enabled in offline build'); } }
export class OpenAIAdapter { async moderate() { throw new Error('not enabled in offline build'); } async embed() { throw new Error('not enabled in offline build'); } async rate() { throw new Error('not enabled in offline build'); } }
