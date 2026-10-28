import { moderate } from './aiProvider.js';
export const spoilerFilter = (text, blocklist=[]) => moderate(text,blocklist);
