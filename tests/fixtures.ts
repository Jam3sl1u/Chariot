import { Collection, type Client, type Message, type MessageReaction, type User } from 'discord.js';
import { DateTime } from 'luxon';
import { Bot } from '../src/bot.js';
import { Service } from '../src/service.js';
import { columns, type Row, type Storage, type Tab } from '../src/sheets.js';

export class Memory implements Storage {
  data = Object.fromEntries(Object.keys(columns).map(k => [k, []])) as unknown as Record<Tab, Row[]>;
  writes: { tab: Tab; row: Row }[] = [];
  async read(tab: Tab) { return { headers: [...columns[tab]], rows: structuredClone(this.data[tab]) }; }
  async save(tab: Tab, row: Row, index?: number) {
    this.writes.push({ tab, row: structuredClone(row) });
    if (index === undefined) this.data[tab].push(structuredClone(row));
    else this.data[tab][index] = { ...this.data[tab][index], ...row };
  }
}
export function fixture() {
  const db = new Memory();
  for (const id of ['a', 'b']) {
    db.data.Churches.push({ churchId: id, churchName: `Church ${id}`, discordGuildId: `guild-${id}`, weeklyPostChannelId: `channel-${id}`, driverAskChannelId: `drivers-${id}`, driverRoleId: `drivers-role-${id}`, timezone: 'America/Los_Angeles', weeklySendDay: 'Wednesday', weeklySendTime: '09:00', weeklyMessageTemplate: 'React ✅ for a ride. Deadline Saturday at 10am.', driverAskMessageTemplate: '[{churchName}] Drivers: react to this post if you can drive on {weekDate}.', activeMessageId: `post-${id}`, activeWeekDate: '2026-09-27', driverAskMessageId: '', driverAskWeek: '', availabilityResetWeek: '', assignmentCompletedWeek: '' });
    db.data.Zones.push({ zoneId: `zone-${id}`, zoneName: `Zone ${id}`, zonePriorityOrder: '1' });
  }
  let now = DateTime.fromISO('2026-09-24T12:00:00', { zone: 'America/Los_Angeles' });
  const service = new Service(db, () => now);
  return { db, service, a: db.data.Churches[0], b: db.data.Churches[1], setNow: (iso: string) => { now = DateTime.fromISO(iso, { zone: 'America/Los_Angeles' }); } };
}
export async function register(f: ReturnType<typeof fixture>, guild = 'guild-a', user = 'person') {
  await f.service.run(guild, c => f.service.register(c, user, { name: 'Test Member', phone: '+12025550123', preferences: '', zone: `Zone ${c.churchId}` }));
}
export function discordFixture(f: ReturnType<typeof fixture>) {
  let sequence = 0;
  const dms: { user: string; content: string; id: string; components?: unknown }[] = [];
  const replies: string[] = [];
  const roleGrants: { user: string; role: string }[] = [];
  const channels = new Map<string, ReturnType<typeof makeChannel>>();
  function makeMessage(id: string, channelId: string, history: Collection<string, { id: string }>, embeds: unknown[] = [], content = '') {
    const reactions = new Collection<string, { emoji: { name: string }; users: { fetch: (options: { after?: string }) => Promise<Collection<string, { id: string; bot: boolean }>> } }>();
    return {
      id, channelId, content, author: { id: 'bot' }, embeds, delete: async () => { history.delete(id); }, createdTimestamp: f.service.now().toMillis(), reactions: { cache: reactions },
      react: async (emoji: string) => { if (!reactions.has(emoji)) setUsers(emoji, []); },
      setUsers,
    };
    function setUsers(emoji: string, ids: string[]) {
      reactions.set(emoji, { emoji: { name: emoji }, users: { fetch: async ({ after }) => {
        const start = after ? ids.indexOf(after) + 1 : 0;
        return new Collection(ids.slice(start, start + 100).map(id => [id, { id, bot: false }]));
      } } });
    }
  }
  function makeChannel(id: string, guildId: string) {
    const history = new Collection<string, ReturnType<typeof makeMessage>>();
    const sent: ReturnType<typeof makeMessage>[] = [];
    return { id, guildId, history, sent, isTextBased: () => true, isSendable: () => true,
      messages: { fetch: async (input: string | object) => {
        if (typeof input !== 'string') return history;
        const message = history.get(input);
        if (!message) throw { code: 10008 };
        return message;
      } },
      send: async (payload: { embeds?: unknown[]; content?: string }) => { const m = makeMessage(`sent-${++sequence}`, id, history, payload.embeds, payload.content); history.set(m.id, m); sent.push(m); return m; },
    };
  }
  for (const c of [f.a, f.b]) {
    let channel = channels.get(c.weeklyPostChannelId);
    if (!channel) { channel = makeChannel(c.weeklyPostChannelId, c.discordGuildId); channels.set(channel.id, channel); }
    channel.history.set(c.activeMessageId, makeMessage(c.activeMessageId, channel.id, channel.history));
    if (!channels.has(c.driverAskChannelId)) channels.set(c.driverAskChannelId, makeChannel(c.driverAskChannelId, c.discordGuildId));
  }
  const client = {
    user: { id: 'bot' },
    channels: { fetch: async (id: string) => channels.get(id) },
    guilds: { fetch: async () => ({ commands: { create: async () => {} }, members: { fetch: async (user: string) => ({ roles: { add: async (role: string) => { roleGrants.push({ user, role }); }, remove: async () => {} } }) } }) },
    users: { fetch: async (user: string) => ({ send: async (payload: { content: string; components?: unknown }) => { const id = `dm-${++sequence}`; dms.push({ user, content: payload.content, id, components: payload.components }); return { id }; } }) },
  } as unknown as Client;
  const bot = new Bot(client, f.service);
  const sendDM = async (user: string, content: string, prompt?: string) => {
    await (bot as unknown as { message: (m: Message) => Promise<void> }).message({ author: { id: user, bot: false }, guildId: null, content, reference: prompt ? { messageId: prompt } : undefined, reply: async (text: string) => { replies.push(text); } } as unknown as Message);
  };
  const sendReaction = async (user: string, guildId: string, channelId: string, messageId: string, emoji = '✅', added = true) => {
    let removed = false;
    await (bot as unknown as { reaction: (r: MessageReaction, u: User, added: boolean) => Promise<void> }).reaction({
      emoji: { name: emoji }, partial: false, users: { remove: async () => { removed = true; } },
      message: { partial: false, id: messageId, guildId, channelId, author: { id: 'bot' }, reply: async (value: string | { content: string }) => { replies.push(typeof value === 'string' ? value : value.content); } },
    } as unknown as MessageReaction, { id: user, bot: false } as User, added);
    return { removed };
  };
  return { bot, dms, replies, roleGrants, channels, sendDM, sendReaction };
}
