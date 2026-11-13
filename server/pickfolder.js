// Preserve the existing positional API for callers.
import { pickFolder as platformPickFolder } from './platform.js';

export function pickFolder(start, title = 'Choose folder') {
  return platformPickFolder({ start, title });
}
