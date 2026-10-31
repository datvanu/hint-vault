/** Runtime settings for the offline build. */
export const config = {
  port: Number(process.env.PORT || 3000),
  provider: process.env.AI_PROVIDER || 'mock',
  maxUsd: Number(process.env.MAX_USD_PER_STREAM || 1),
  clusterThreshold: 0.5,
  pricing: {
    source: 'MODELS-COSTS.md (offline placeholder)',
    date: '2026-10-28',
    models: { mock: { input: 0, output: 0 } },
  },
  stuckRoles: ['broadcaster', 'moderator'],
  blocklist: ['slur-placeholder'],
  inactivityMs: 12 * 60 * 60 * 1000,
  deleteHintMessages: process.env.HINTVAULT_DELETE_HINT_MESSAGES === '1',
};
