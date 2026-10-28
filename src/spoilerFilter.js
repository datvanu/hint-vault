/** Configurable offline safety rules for hints and overlay content. */
export const filterRules = {
  storySpoilers: [
    /\b(?:the )?killer is\b/i,
    /\b(?:dies|is killed|gets killed|is murdered)\b/i,
    /\b(?:ending|finale|end of the story)\b/i,
    /\b(?:at|by) the end\b/i,
    /\b(?:turns out to be|was the villain)\b/i,
  ],
  links: [
    /\bhttps?:\/\/\S+/i,
    /\bwww\.\S+/i,
    /\b[a-z0-9-]+\.(?:com|net|org|gg|tv|io|xyz)(?:\/\S*)?\b/i,
  ],
  toxicWords: ['idiot', 'nazi', 'kill yourself', 'moron', 'slur-placeholder'],
  maxCapsRatio: 0.5,
  repeatedCharacterCount: 6,
};

/** Returns a reason for rejecting content, or null when it is safe. */
export function filterReason(text, blocklist = []) {
  const lower = String(text).toLowerCase();
  for (const pattern of filterRules.storySpoilers) if (pattern.test(text)) return 'story-spoiler';
  for (const pattern of filterRules.links) if (pattern.test(text)) return 'link';
  const toxic = [...filterRules.toxicWords, ...blocklist].filter(Boolean);
  if (toxic.some(word => new RegExp(`(?:^|[^\\p{L}])${escapeRegex(word)}(?:$|[^\\p{L}])`, 'iu').test(lower))) return 'toxic';

  const letters = text.match(/[a-z]/gi) || [];
  const uppercase = text.match(/[A-Z]/g) || [];
  if (letters.length >= 6 && uppercase.length / letters.length > filterRules.maxCapsRatio) return 'caps-spam';
  if (new RegExp(`(.)\\1{${filterRules.repeatedCharacterCount - 1},}`, 'iu').test(text)) return 'repeat-spam';
  return null;
}

/** Whether text must be rejected before storage or overlay rendering. */
export function spoilerFilter(text, blocklist = []) {
  return filterReason(text, blocklist) !== null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
