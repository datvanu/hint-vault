import { heuristicRate } from './aiProvider.js';
export class Rater { constructor(provider) { this.provider=provider; } rate(context,text) { return this.provider.rate(context,text); } fallback(context,text) { return Promise.resolve({level:heuristicRate(context,text),is_spoiler_for_other_content:false,off_topic:false,gentle_rewrite:text.slice(0,120)}); } }
