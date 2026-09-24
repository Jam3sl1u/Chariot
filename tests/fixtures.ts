import { Collection, type Client, type Message } from 'discord.js';
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
    db.data.Churches.push({ churchId: id, churchName: `Church ${id}`, discordGuildId: `guild-${id}`, weeklyPostChannelId: `channel-${id}`, driverAskChannelId: `drivers-${id}`, timezone: 'America/Los_Angeles', weeklySendDay: 'Wednesday', weeklySendTime: '09:00', weeklyMessageTemplate: 'React ✅ for a ride. Deadline Saturday at 10am.', activeMessageId: `post-${id}`, activeWeekDate: '2026-09-27', availabilityResetWeek: '', assignmentCompletedWeek: '' });
    db.data.Zones.push({ churchId: id, zoneId: `zone-${id}`, zoneName: `Zone ${id}`, zonePriorityOrder: '1' });
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
  const dms: { user: string; content: string; id: string }[] = [];
  const replies: string[] = [];
  const channels = new Map<string, ReturnType<typeof makeChannel>>();
  function makeMessage(id: string, channelId: string, embeds: unknown[] = []) {
    const reactions = new Collection<string, { emoji: { name: string }; users: { fetch: (options: { after?: string }) => Promise<Collection<string, { id: string; bot: boolean }>> } }>();
    return {
      id, channelId, author: { id: 'bot' }, embeds, createdTimestamp: f.service.now().toMillis(), reactions: { cache: reactions },
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
      messages: { fetch: async (input: string | object) => typeof input === 'string' ? history.get(input) : history },
      send: async (payload: { embeds?: unknown[] }) => { const m = makeMessage(`sent-${++sequence}`, id, payload.embeds); history.set(m.id, m); sent.push(m); return m; },
    };
  }
  for (const c of [f.a, f.b]) {
    const channel = makeChannel(c.weeklyPostChannelId, c.discordGuildId);
    channel.history.set(c.activeMessageId, makeMessage(c.activeMessageId, channel.id));
    channels.set(channel.id, channel);
  }
  const client = {
    user: { id: 'bot' },
    channels: { fetch: async (id: string) => channels.get(id) },
    guilds: { fetch: async () => ({ commands: { create: async () => {} }, members: { fetch: async () => {} } }) },
    users: { fetch: async (user: string) => ({ send: async (payload: { content: string }) => { const id = `dm-${++sequence}`; dms.push({ user, content: payload.content, id }); return { id }; } }) },
  } as unknown as Client;
  const bot = new Bot(client, f.service);
  const sendDM = async (user: string, content: string, prompt?: string) => {
    await (bot as unknown as { message: (m: Message) => Promise<void> }).message({ author: { id: user, bot: false }, guildId: null, content, reference: prompt ? { messageId: prompt } : undefined, reply: async (text: string) => { replies.push(text); } } as unknown as Message);
  };
  return { bot, dms, replies, channels, sendDM };
}
