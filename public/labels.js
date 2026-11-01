/** Shared display labels for stage, overlay and admin. */
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function captionFor(mode = {}) {
  if (mode.live && mode.sim) return 'Live Twitch chat + simulated viewers (demo mode)';
  if (mode.live) return 'Live Twitch chat';
  return 'Simulated viewers · offline demo';
}
