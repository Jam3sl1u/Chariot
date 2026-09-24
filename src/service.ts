import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { Row, Storage, Tab } from './sheets.js';
import { weekDate, late } from './time.js';

export const validPhone = (phone: string) => /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(phone);
export const yesNo = (text: string) => text.toUpperCase() === 'YES' ? true : text.toUpperCase() === 'NO' ? false : undefined;
export const truth = (text?: string) => text?.toLowerCase() === 'true';
export class InputError extends Error {}

/** One process owns bot writes. Serializes read-modify-write operations across all guilds. */
export class Service {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly db: Storage, readonly now: () => DateTime = () => DateTime.utc()) {}

  async churches() { return (await this.db.read('Churches')).rows.filter(r => r.churchId); }
  async resolve(guildId: string) {
    const churches = await this.churches();
    const matches = churches.filter(r => r.discordGuildId === guildId);
    if (matches.length !== 1 || churches.filter(r => r.churchId === matches[0]?.churchId).length !== 1) {
      console.warn(`Dropped unmapped/ambiguous guild: ${guildId}`);
      return undefined;
    }
    return matches[0];
  }
  run<T>(guildId: string, work: (church: Row) => Promise<T>): Promise<T | undefined> {
    const task = this.tail.then(async () => {
      const church = await this.resolve(guildId);
      if (church) return work(church);
    });
    this.tail = task.catch(() => undefined);
    return task;
  }
  async rows(tab: Tab, church: Row) { return (await this.db.read(tab)).rows.filter(r => r.churchId === church.churchId); }
  async patch(tab: Tab, church: Row, key: Row, values: Row) {
    // Resolve again immediately before any write; never trust client-supplied church IDs.
    const current = await this.resolve(church.discordGuildId);
    if (!current || current.churchId !== church.churchId) throw new InputError('Church configuration changed. Please try again.');
    const rows = (await this.db.read(tab)).rows;
    const matches = rows.map((row, i) => ({ row, i })).filter(({ row }) => row.churchId === church.churchId && Object.entries(key).every(([k, v]) => row[k] === v));
    if (matches.length > 1) throw new InputError(`Duplicate ${tab} rows; ask an admin to repair the Sheet.`);
    if (!matches.length && (tab === 'Churches' || tab === 'Drivers' || (tab === 'RideRequests' && key.requestId))) throw new InputError('That record was removed. Refresh and try again.');
    await this.db.save(tab, { ...key, ...values, churchId: church.churchId }, matches[0]?.i);
  }
  async member(church: Row, discordId: string) {
    const matches = (await this.rows('Members', church)).filter(r => r.discordId === discordId);
    if (matches.length > 1) throw new InputError('Duplicate member rows; contact an admin.');
    return matches[0];
  }
  async register(church: Row, discordId: string, data: Row) {
    if (!data.name?.trim() || !validPhone(data.phone)) throw new InputError('Enter your name and a US phone number such as +12025550123.');
    const zones = await this.rows('Zones', church);
    if (data.zone !== 'Other / Not Listed' && !zones.some(z => z.zoneName === data.zone)) throw new InputError('That pickup location is no longer available. Run /register again.');
    const existing = await this.member(church, discordId);
    await this.patch('Members', church, { discordId }, {
      memberId: existing?.memberId || randomUUID(), createdAt: existing?.createdAt || this.now().toISO()!,
      name: data.name.trim(), phone: data.phone, preferences: data.preferences ?? '', zone: data.zone, notificationPreference: 'DISCORD_DM',
    });
  }
  async request(church: Row, discordId: string, week: string) {
    const member = await this.member(church, discordId);
    if (!member) throw new InputError('Please run /register in the church’s weekly rides channel first.');
    const requests = (await this.rows('RideRequests', church)).filter(r => r.memberId === member.memberId && r.weekDate === week);
    if (requests.length > 1) throw new InputError('Duplicate ride requests; contact an admin.');
    return { member, ride: requests[0] };
  }
  async reaction(church: Row, discordId: string, messageId: string, emoji: string, added: boolean) {
    const week = weekDate(church, this.now());
    if (messageId !== church.activeMessageId || church.activeWeekDate !== week) return;
    const { member, ride } = await this.request(church, discordId, week);
    const key = { memberId: member.memberId, weekDate: week };
    if (emoji === '✅') {
      if (added && church.assignmentCompletedWeek === week && ride?.status !== 'PENDING') throw new InputError('Assignments have run for this week. Please contact an admin.');
      if (!added && !ride) return;
      await this.patch('RideRequests', church, key, {
        requestId: ride?.requestId || randomUUID(), status: added ? 'PENDING' : 'CANCELLED',
        ...(!ride ? { hasPlusOne: 'false', plusOneName: '', plusOnePhone: '', plusOnePromptId: '' } : !added ? { plusOnePromptId: '' } : {}),
      });
    } else if (emoji === '1️⃣') {
      if (!added) {
        if (ride) await this.patch('RideRequests', church, key, { hasPlusOne: 'false', plusOneName: '', plusOnePhone: '', plusOnePromptId: '' });
      } else {
        if (!ride || ride.status !== 'PENDING') throw new InputError('React ✅ to request your own ride before adding a +1.');
        if (church.assignmentCompletedWeek === week) throw new InputError('Please contact an admin to change your +1 after assignments have run.');
        return ride;
      }
    }
  }
  async plusOne(church: Row, discordId: string, promptId: string, text: string) {
    const week = weekDate(church, this.now());
    const { ride } = await this.request(church, discordId, week);
    if (!ride || ride.status !== 'PENDING' || ride.plusOnePromptId !== promptId || church.assignmentCompletedWeek === week) throw new InputError('That +1 request has expired. React 1️⃣ on the current post again or contact an admin.');
    const lines = text.trim().split(/\r?\n/);
    if (lines.length !== 2 || !lines[0].trim() || lines[0].length > 100 || !validPhone(lines[1].trim())) throw new InputError('Reply with two lines: full name, then a US phone number (+12025550123). You may use your own phone.');
    await this.patch('RideRequests', church, { requestId: ride.requestId }, { hasPlusOne: 'true', plusOneName: lines[0].trim(), plusOnePhone: lines[1].trim(), plusOnePromptId: '' });
  }
  async driverReply(church: Row, discordId: string, promptId: string, text: string) {
    const answer = yesNo(text);
    if (answer === undefined) throw new InputError("Sorry, I didn't understand that. Please reply YES or NO only.");
    const week = weekDate(church, this.now());
    const drivers = (await this.rows('Drivers', church)).filter(d => d.discordId === discordId && d.askMessageId === promptId && d.askedWeek === week && d.isActive?.toLowerCase() !== 'false');
    if (drivers.length !== 1) throw new InputError('This availability prompt is expired or ambiguous. Ask an admin to resend it.');
    await this.patch('Drivers', church, { driverId: drivers[0].driverId }, { isAvailableThisWeek: String(answer), availabilityWeek: week, respondedWeek: week });
    return answer ? (late(church, this.now()) ? 'Availability saved. The assignment time has passed; an admin must arrange any late placement.' : "Got it — you're confirmed as a driver this Sunday. Thanks!") : 'Got it — marked you as unavailable this Sunday. React ✅ in Discord if you need a ride!';
  }
}
