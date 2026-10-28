/** Estimates model spend and permanently switches to heuristic mode at the cap. */
export class CostGuard {
  constructor(cap = 1, pricing = { mock: { input: 0, output: 0 } }) {
    this.cap = cap;
    this.pricing = pricing;
    this.usdSpent = 0;
    this.fallback = false;
  }

  allow(estimate = 0) {
    if (this.usdSpent + estimate > this.cap) {
      this.fallback = true;
      return false;
    }
    return !this.fallback;
  }

  estimate(model, inputTokens = 0, outputTokens = 0) {
    const price = this.pricing[model] || { input: 0, output: 0 };
    return inputTokens * price.input / 1e6 + outputTokens * price.output / 1e6;
  }

  record(usage = {}, model = 'mock') {
    this.usdSpent += this.estimate(
      model,
      usage.inputTokens || usage.input_tokens || 0,
      usage.outputTokens || usage.output_tokens || 0,
    );
    if (this.usdSpent >= this.cap) this.fallback = true;
  }

  reset() {
    this.usdSpent = 0;
    this.fallback = false;
  }

  get warning() { return this.usdSpent >= this.cap * 0.8; }
}
