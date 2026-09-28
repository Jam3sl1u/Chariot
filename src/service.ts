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
  private async unique(matches: Row[], route: string) {
    const churches = await this.churches();
    if (matches.length !== 1 || churches.filter(r => r.churchId === matches[0]?.churchId).length !== 1) {
      console.warn(`Dropped unmapped/ambiguous ${route}`);
      return undefined;
    }
    return matches[0];
  }
  async resolve(guildId: string) {
    const churches = await this.churches();
    return this.unique(churches.filter(r => r.discordGuildId === guildId), `guild: ${guildId}`);
  }
  async resolveChannel(guildId: string, channelId: string) {
    const churches = await this.churches();
    return this.unique(churches.filter(r => r.discordGuildId === guildId && r.weeklyPostChannelId === channelId), `channel: ${guildId}/${channelId}`);
  }
  async resolveMessage(guildId: string, messageId: string) {
    const churches = await this.churches();
    return this.unique(churches.filter(r => r.discordGuildId === guildId && r.activeMessageId === messageId), `weekly message: ${guildId}/${messageId}`);
  }
  async resolveChurch(churchId: string) {
    return this.unique((await this.churches()).filter(r => r.churchId === churchId), `church: ${churchId}`);
  }
  private queue<T>(resolve: () => Promise<Row | undefined>, work: (church: Row) => Promise<T>): Promise<T | undefined> {
    const task = this.tail.then(async () => {
      const church = await resolve();
      if (church) return work(church);
    });
    this.tail = task.catch(() => undefined);
    return task;
  }
  run<T>(guildId: string, work: (church: Row) => Promise<T>): Promise<T | undefined> {
    return this.queue(() => this.resolve(guildId), work);
  }
  runChannel<T>(guildId: string, channelId: string, work: (church: Row) => Promise<T>): Promise<T | undefined> {
    return this.queue(() => this.resolveChannel(guildId, channelId), work);
  }
  runMessage<T>(guildId: string, messageId: string, work: (church: Row) => Promise<T>): Promise<T | undefined> {
    return this.queue(() => this.resolveMessage(guildId, messageId), work);
  }
  runChurch<T>(churchId: string, work: (church: Row) => Promise<T>): Promise<T | undefined> {
    return this.queue(() => this.resolveChurch(churchId), work);
  }
  async rows(tab: Tab, church: Row) {
    const rows = (await this.db.read(tab)).rows;
    return tab === 'Zones' ? rows : rows.filter(r => r.churchId === church.churchId);
  }
  async patch(tab: Tab, church: Row, key: Row, values: Row) {
    // Resolve again immediately before any write; never trust client-supplied church IDs.
    const current = await this.resolveChurch(church.churchId);
    if (!current || current.churchId !== church.churchId || current.discordGuildId !== church.discordGuildId || current.weeklyPostChannelId !== church.weeklyPostChannelId) throw new InputError('Church configuration changed. Please try again.');
    const rows = (await this.db.read(tab)).rows;
    const matches = rows.map((row, i) => ({ row, i })).filter(({ row }) => row.churchId === church.churchId && Object.entries(key).every(([k, v]) => row[k] === v));
    if (matches.length > 1) throw new InputError(`Duplicate ${tab} rows; ask an admin to repair the Sheet.`);
    if (!matches.length && (tab === 'Churches' || tab === 'Drivers' || (tab === 'RideRequests' && key.requestId))) throw new InputError('That record was removed. Refresh and try again.');
    await this.db.save(tab, { ...key, ...values, churchId: church.churchId }, matches[0]?.i);
  }
  private async localMember(church: Row, discordId: string) {
    const matches = (await this.rows('Members', church)).filter(r => r.discordId === discordId);
    if (matches.length > 1) throw new InputError('Duplicate member rows; contact an admin.');
    return matches[0];
  }
  private complete(member: Row | undefined) {
    // Legacy rows predate profileStatus. A pending row may also be completed by an
    // admin directly in Sheets, without requiring them to know an internal label.
    return !!member && (member.profileStatus !== 'PENDING' || (!!member.name?.trim() && validPhone(member.phone) && !!member.zone?.trim()));
  }
  async member(church: Row, discordId: string) {
    const local = await this.localMember(church, discordId);
    if (this.complete(local)) return local;
    return (await this.db.read('Members')).rows.find(row => row.discordId === discordId && this.complete(row));
  }
  /** Records an unregistered reactor without making them eligible for a ride. */
  async beginRegistration(church: Row, discordId: string) {
    const existing = (await this.db.read('Members')).rows.find(row => row.discordId === discordId);
    if (existing) return existing;
    await this.patch('Members', church, { discordId }, {
      memberId: randomUUID(), createdAt: this.now().toISO()!, profileStatus: 'PENDING',
      name: '', phone: '', preferences: '', zone: '', notificationPreference: '',
    });
    return this.localMember(church, discordId);
  }
  async register(church: Row, discordId: string, data: Row) {
    if (!data.name?.trim() || !validPhone(data.phone)) throw new InputError('Enter your name and a US phone number such as +12025550123.');
    const zones = await this.rows('Zones', church);
    if (data.zone !== 'Other / Not Listed' && !zones.some(z => z.zoneName === data.zone)) throw new InputError('That pickup location is no longer available. Run /register again.');
    const allMembers = (await this.db.read('Members')).rows;
    const completed = allMembers.find(member => member.discordId === discordId && this.complete(member));
    if (completed) return completed;
    const pending = allMembers.find(member => member.discordId === discordId && member.profileStatus === 'PENDING');
    const profileChurch = pending ? await this.resolveChurch(pending.churchId) : church;
    if (!profileChurch) throw new InputError('The temporary profile was removed. React to the weekly post again to start over.');
    await this.patch('Members', profileChurch, { discordId }, {
      memberId: pending?.memberId || randomUUID(), createdAt: pending?.createdAt || this.now().toISO()!,
      name: data.name.trim(), phone: data.phone, preferences: data.preferences ?? '', zone: data.zone, notificationPreference: 'DISCORD_DM',
      profileStatus: 'COMPLETE',
    });
    return this.localMember(profileChurch, discordId);
  }
  async request(church: Row, discordId: string, week: string) {
    let member = await this.localMember(church, discordId);
    const profile = member || await this.member(church, discordId);
    if (!member && profile) {
      await this.patch('Members', church, { discordId }, {
        memberId: randomUUID(), createdAt: profile.createdAt || this.now().toISO()!, name: profile.name,
        phone: profile.phone, preferences: profile.preferences ?? '', zone: profile.zone,
        notificationPreference: profile.notificationPreference || 'DISCORD_DM',
      });
      member = await this.localMember(church, discordId);
    }
    if (!member) throw new InputError('Please run /register in the church’s weekly rides channel first.');
    const requests = (await this.rows('RideRequests', church)).filter(r => r.memberId === member.memberId && r.weekDate === week);
    if (requests.length > 1) throw new InputError('Duplicate ride requests; contact an admin.');
    return { member, ride: requests[0] };
  }
  async reaction(church: Row, discordId: string, messageId: string, added: boolean) {
    const week = weekDate(church, this.now());
    if (messageId !== church.activeMessageId || church.activeWeekDate !== week) return;
    const { member, ride } = await this.request(church, discordId, week);
    const key = { memberId: member.memberId, weekDate: week };
    if (added && church.assignmentCompletedWeek === week && ride?.status !== 'PENDING') throw new InputError('Assignments have run for this week. Please contact an admin.');
    if (!added && !ride) return;
    await this.patch('RideRequests', church, key, {
      requestId: ride?.requestId || randomUUID(), status: added ? 'PENDING' : 'CANCELLED',
      ...(!ride ? { hasPlusOne: 'false', plusOneName: '', plusOnePhone: '', plusOnePromptId: '' } : {}),
    });
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
