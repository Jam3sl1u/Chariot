import { InputError } from './service.js';
import type { Row } from './sheets.js';

/** Shows only the end of a Discord ID so admins can compare cells without the full ID in chat. */
export const tail = (id?: string) => id?.trim() ? `…${id.trim().slice(-4)}` : '(blank)';
const looksRounded = (id?: string) => !!id && id.trim().length >= 17 && id.trim().endsWith('000');

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
  if (type !== 'post' && type !== 'ask') throw new InputError(`Broadcast "${id}" (Broadcasts tab): type must be "post" or "ask", but it is ${type ? `"${type}"` : 'blank'}.`);
  const churchIds = (row.churches ?? '').split(',').map(part => part.trim()).filter(Boolean);
  if (!churchIds.length) throw new InputError(`Broadcast "${id}" (Broadcasts tab): the churches cell is empty. List church IDs like CH01, CH02.`);
  if (new Set(churchIds).size !== churchIds.length) throw new InputError(`Broadcast "${id}" (Broadcasts tab): a church is listed twice in the churches cell (${churchIds.join(', ')}).`);
  const greeting = (row.greeting ?? '').trim();
  if (!greeting) throw new InputError(`Broadcast "${id}" (Broadcasts tab): the greeting cell is empty.`);
  if (greeting.length > 2000) throw new InputError(`Broadcast "${id}" (Broadcasts tab): the greeting is ${greeting.length} characters; Discord's limit is 2000.`);
  return { id, type, churchIds, greeting, row };
}

export interface BroadcastContext {
  /** Server and channel where the command was run. */
  guildId: string;
  channelId: string;
  /** Service Sunday for a church, in that church's own timezone. */
  weekOf: (church: Row) => string;
}

/**
 * Every reason this broadcast cannot run, one admin-readable line each. An empty list means it
 * is safe to send. Reports all problems at once so one fix-up pass is enough.
 */
export function broadcastProblems(spec: BroadcastSpec, churches: Row[], ctx: BroadcastContext): string[] {
  const problems: string[] = [];
  const first = churches[0];
  const weeks = new Map<string, string>();
  for (const church of churches) {
    try { weeks.set(church.churchId, ctx.weekOf(church)); }
    catch { problems.push(`${church.churchId}: timezone is blank or not a valid IANA name (for example America/Los_Angeles) in the Churches tab.`); }
  }
  const channelField = spec.type === 'post' ? 'weeklyPostChannelId' : 'driverAskChannelId';
  const templateField = spec.type === 'post' ? 'weeklyMessageTemplate' : 'driverAskMessageTemplate';
  for (const church of churches) {
    const id = church.churchId;
    if (church.discordGuildId !== ctx.guildId) {
      problems.push(`${id}: discordGuildId is ${tail(church.discordGuildId)}, but you ran this in a server ending ${tail(ctx.guildId)}. Set ${id}'s discordGuildId in the Churches tab to match the other churches${looksRounded(church.discordGuildId) ? ' (it ends in 000, so the cell may have been rounded; format the column as Plain text and re-enter it)' : ''}.`);
    }
    if (church.weeklyPostChannelId !== ctx.channelId) {
      problems.push(`${id}: weeklyPostChannelId is ${tail(church.weeklyPostChannelId)}, but you ran this in a channel ending ${tail(ctx.channelId)}. A broadcast runs in the shared rides channel; fix ${id}'s weeklyPostChannelId or run it in the channel ${id} uses${looksRounded(church.weeklyPostChannelId) ? ' (it ends in 000, so the cell may have been rounded; format the column as Plain text and re-enter it)' : ''}.`);
    }
    if (spec.type === 'ask' && church !== first && church[channelField] !== first[channelField]) {
      problems.push(`${id}: ${channelField} is ${tail(church[channelField])} but ${first.churchId}'s is ${tail(first[channelField])}. Every church in a "${spec.type}" broadcast must use the same ${channelField}.`);
    }
    if (!church[templateField]?.trim()) problems.push(`${id}: ${templateField} is blank in the Churches tab. A "${spec.type}" broadcast needs it.`);
    const week = weeks.get(id);
    if (!week) continue;
    if (church !== first && weeks.has(first.churchId) && week !== weeks.get(first.churchId)) problems.push(`${id}: its service Sunday is ${week} but ${first.churchId}'s is ${weeks.get(first.churchId)}. Check both churches' timezone cells.`);
    if (church.assignmentCompletedWeek === week) problems.push(`${id}: assignmentCompletedWeek is already ${week}, so assignments have run. Clear that cell only if you really want to re-open this week.`);
  }
  return problems;
}
