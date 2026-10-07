import { InputError } from './service.js';
import type { Row } from './sheets.js';

export interface BroadcastSpec {
  id: string;
  /** `post` = ride requests ("ride to church"); `ask` = driver availability ("drive to church"). */
  type: 'post' | 'ask';
  churchIds: string[];
  greeting: string;
  row: Row;
}

/** Validates one Broadcasts row. Throws InputError with an admin-readable reason. */
export function parseBroadcast(row: Row): BroadcastSpec {
  const id = (row.broadcastId ?? '').trim();
  const type = (row.type ?? '').trim().toLowerCase();
  if (type !== 'post' && type !== 'ask') throw new InputError(`Broadcast ${id}: type must be "post" or "ask".`);
  const churchIds = (row.churches ?? '').split(',').map(part => part.trim()).filter(Boolean);
  if (!churchIds.length) throw new InputError(`Broadcast ${id}: list at least one church ID in "churches".`);
  if (new Set(churchIds).size !== churchIds.length) throw new InputError(`Broadcast ${id}: a church is listed twice.`);
  const greeting = (row.greeting ?? '').trim();
  if (!greeting) throw new InputError(`Broadcast ${id}: greeting is empty.`);
  if (greeting.length > 2000) throw new InputError(`Broadcast ${id}: greeting is over Discord's 2000-character limit.`);
  return { id, type, churchIds, greeting, row };
}
