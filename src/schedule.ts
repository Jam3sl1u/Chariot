import type { DateTime } from 'luxon';
import { InputError } from './service.js';
import type { Row } from './sheets.js';
import { localTime } from './time.js';

export const MAX_ATTEMPTS = 3;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export type Command =
  | { kind: 'post' | 'ask-drivers' | 'sync'; churchId: string }
  | { kind: 'broadcast'; name: string };

/** Accepts only the exact admin command text; anything else is an error, never a guess. */
export function parseCommand(text: string): Command {
  const match = /^\/rides (post|ask-drivers|sync) church:(\S+)$/.exec(text.trim()) ?? /^\/rides (broadcast) name:(\S+)$/.exec(text.trim());
  if (!match) throw new InputError('command must be exactly one of: /rides post church:ID, /rides ask-drivers church:ID, /rides sync church:ID, /rides broadcast name:ID.');
  return match[1] === 'broadcast' ? { kind: 'broadcast', name: match[2] } : { kind: match[1] as 'post' | 'ask-drivers' | 'sync', churchId: match[2] };
}

export interface Job {
  id: string;
  churchId: string;
  /** ISO weekday, Monday = 1 ... Sunday = 7. */
  day: number;
  time: string;
  command?: Command;
  message?: string;
  channel?: 'rides' | 'drivers';
}

/** Validates one Schedules row. Throws InputError saying which cell to fix. */
export function parseJob(row: Row): Job {
  const id = (row.jobId ?? '').trim();
  const churchId = (row.churchId ?? '').trim();
  if (!churchId) throw new InputError('churchId is blank.');
  const day = DAYS.indexOf((row.day ?? '').trim()) + 1;
  if (!day) throw new InputError(`day must be a full English weekday such as Thursday, but it is ${row.day?.trim() ? `"${row.day.trim()}"` : 'blank'}.`);
  const time = (row.time ?? '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new InputError(`time must be 24-hour HH:mm such as 12:00, but it is ${time ? `"${time}"` : 'blank'}.`);
  const command = row.command?.trim() ? parseCommand(row.command) : undefined;
  const message = row.message?.trim() || undefined;
  if (!command && !message) throw new InputError('set a command, a message, or both.');
  if (message && message.length > 2000) throw new InputError(`message is ${message.length} characters; Discord's limit is 2000.`);
  const channel = (row.channel ?? '').trim().toLowerCase();
  if (message && channel !== 'rides' && channel !== 'drivers') throw new InputError('channel must be "rides" or "drivers" when a message is set.');
  return { id, churchId, day, time, command, message, channel: message ? channel as 'rides' | 'drivers' : undefined };
}

/**
 * True once the church's local clock has reached the job's day/time this week (Monday-Sunday).
 * It stays true for the rest of the week, which is what makes a missed job catch up late.
 */
export function jobDue(job: Job, church: Row, now: DateTime) {
  const local = localTime(church, now);
  return local.weekday > job.day || (local.weekday === job.day && local.toFormat('HH:mm') >= job.time);
}
