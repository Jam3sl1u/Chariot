import { DateTime } from 'luxon';
import type { Row } from './sheets.js';

export function localTime(church: Row, now: DateTime = DateTime.utc()) {
  const local = now.setZone(church.timezone);
  if (!church.timezone || !local.isValid) throw new Error(`Configure a valid timezone for church ${church.churchId}`);
  return local;
}
export function weekDate(church: Row, now: DateTime = DateTime.utc()) {
  const local = localTime(church, now);
  return local.plus({ days: 7 - local.weekday }).toISODate()!;
}
export function late(church: Row, now: DateTime = DateTime.utc()) {
  const local = localTime(church, now);
  return local.weekday === 7 || (local.weekday === 6 && local.toFormat('HH:mm') >= '11:45');
}
