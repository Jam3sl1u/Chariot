import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, Events, GatewayIntentBits,
  MessageFlags, ModalBuilder, Partials, PermissionFlagsBits, SlashCommandBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type Interaction, type Message, type MessageReaction, type PartialMessageReaction,
  type User, type PartialUser,
} from 'discord.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Row } from './sheets.js';
import { Service, InputError, truth, validPhone } from './service.js';
import { localTime, weekDate, weeklyDue } from './time.js';

export const commands = [
  new SlashCommandBuilder().setName('register').setDescription('Register or update your ride profile'),
  new SlashCommandBuilder().setName('rides').setDescription('Manage church rides')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('post').setDescription('Post the current weekly ride request'))
    .addSubcommand(s => s.setName('sync').setDescription('Reconcile reactions on the current post'))
    .addSubcommand(s => s.setName('ask-drivers').setDescription('Ask drivers who have not replied this week')),
].map(c => c.toJSON());

type Registration = { guildId: string; userId: string; expires: number; data: Row; zones: string[] };
export function createClient() {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.DirectMessages],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
    allowedMentions: { parse: [] },
  });
}

export class Bot {
  private registrations = new Map<string, Registration>();
  private churchCache: Row[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private initializedGuilds = new Set<string>();
  constructor(readonly client: Client, readonly service: Service) {}

  private report(context: string, error: unknown) {
    // Never dump Google/Discord HTTP errors: they may contain credentials or personal data.
    console.error(`${context}: ${error instanceof InputError ? error.message : 'operation failed; check configuration, permissions and connectivity'}`);
  }
  private async dm(userId: string, content: string) {
    return (await this.client.users.fetch(userId)).send({ content, allowedMentions: { parse: [] } });
  }
  private async channel(church: Row) {
    const channel = await this.client.channels.fetch(church.weeklyPostChannelId);
    if (!channel || !channel.isTextBased() || !channel.isSendable() || !('guildId' in channel) || channel.guildId !== church.discordGuildId) throw new InputError('The weekly post channel must belong to this church’s server.');
    return channel;
  }
  private async isMember(church: Row, userId: string) {
    const guild = await this.client.guilds.fetch(church.discordGuildId);
    await guild.members.fetch(userId);
  }
  async start(token: string) {
    this.client.once(Events.ClientReady, () => {
      void this.ready().catch(error => { this.report('Startup', error); this.stop(); process.exitCode = 1; });
    });
    this.client.on(Events.InteractionCreate, interaction => void this.interaction(interaction));
    this.client.on(Events.MessageReactionAdd, (r, u) => void this.reaction(r, u, true));
    this.client.on(Events.MessageReactionRemove, (r, u) => void this.reaction(r, u, false));
    this.client.on(Events.MessageCreate, message => void this.message(message));
    this.client.on(Events.Error, error => this.report('Discord', error));
    await this.client.login(token);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.client.destroy(); }
  private async ready() {
    this.churchCache = await this.service.churches();
    for (const church of this.churchCache) {
      try { await this.service.run(church.discordGuildId, async resolved => {
        const guild = await this.client.guilds.fetch(resolved.discordGuildId);
        // Create/update only our commands; do not replace unrelated application commands.
        for (const command of commands) await guild.commands.create(command);
        await this.reconcile(resolved);
        this.initializedGuilds.add(resolved.discordGuildId);
      }); } catch (error) { this.report(`Startup (${church.churchId})`, error); }
    }
    await this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
    console.log('Chariot is ready.');
  }

  private modal() {
    const field = (id: string, label: string, required: boolean, max: number, style = TextInputStyle.Short) => new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max));
    return new ModalBuilder().setCustomId('register-form').setTitle('Register for church rides').addComponents(
      field('name', 'Full name', true, 100), field('phone', 'US phone (+12025550123)', true, 12), field('preferences', 'Ride preferences (optional)', false, 1000, TextInputStyle.Paragraph),
    );
  }
  private zoneComponents(id: string, session: Registration, page = 0) {
    const zones = session.zones.slice(page * 24, page * 24 + 24);
    const menu = new StringSelectMenuBuilder().setCustomId(`zone:${id}`).setPlaceholder('Choose your pickup location').addOptions(
      ...zones.map(zone => ({ label: zone.slice(0, 100), value: String(session.zones.indexOf(zone)) })),
      { label: 'Other / Not Listed', value: 'other' },
    );
    const rows: (ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>)[] = [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
    if (session.zones.length > 24) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`page:${id}:${page - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`page:${id}:${page + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled((page + 1) * 24 >= session.zones.length),
    ));
    return rows;
  }
  private async interaction(i: Interaction) {
    if (!i.isChatInputCommand() && !i.isModalSubmit() && !i.isStringSelectMenu() && !i.isButton()) return;
    try {
      if (i.isChatInputCommand() && i.commandName === 'register') {
        // Opening a modal must be the first response. Validate fresh mapping on submission.
        const matches = this.churchCache.filter(c => c.discordGuildId === i.guildId && c.weeklyPostChannelId === i.channelId);
        if (matches.length !== 1) { await i.reply({ content: 'Use /register in your church’s configured weekly rides channel.', flags: MessageFlags.Ephemeral }); return; }
        await i.showModal(this.modal()); return;
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (!i.guildId) throw new InputError('Use this command in your church’s server.');
      let recognized = false;
      await this.service.run(i.guildId, async church => {
        recognized = true;
        if (i.isChatInputCommand()) {
          if (i.commandName !== 'rides') return;
          if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new InputError('Manage Server permission is required.');
          const sub = i.options.getSubcommand();
          if (sub === 'post') await this.post(church);
          if (sub === 'sync') await this.reconcile(church);
          if (sub === 'ask-drivers') { await this.reset(church); await this.ask(church, true); }
          await i.editReply('Completed.'); return;
        }
        if (i.channelId !== church.weeklyPostChannelId) throw new InputError('Use the configured weekly rides channel.');
        for (const [key, value] of this.registrations) if (value.expires < Date.now()) this.registrations.delete(key);
        if (i.isModalSubmit() && i.customId === 'register-form') {
          const data = { name: i.fields.getTextInputValue('name').trim(), phone: i.fields.getTextInputValue('phone').trim(), preferences: i.fields.getTextInputValue('preferences').trim() };
          if (!data.name || !validPhone(data.phone)) throw new InputError('Enter your name and a valid US E.164 phone (+12025550123). Run /register again.');
          const zones = (await this.service.rows('Zones', church)).sort((a, b) => Number(a.zonePriorityOrder) - Number(b.zonePriorityOrder)).map(z => z.zoneName).filter(z => z && z !== 'Other / Not Listed');
          const id = randomUUID();
          const session = { guildId: i.guildId!, userId: i.user.id, expires: Date.now() + 15 * 60_000, data, zones: [...new Set(zones)] };
          this.registrations.set(id, session);
          await i.editReply({ content: 'Choose your pickup location. Registration expires in 15 minutes.', components: this.zoneComponents(id, session) }); return;
        }
        if (!i.isButton() && !i.isStringSelectMenu()) return;
        const [action, id, pageText] = i.customId.split(':');
        const session = this.registrations.get(id);
        if (!session || session.guildId !== i.guildId || session.userId !== i.user.id) throw new InputError('Registration expired. Please run /register again.');
        if (action === 'page') {
          const page = Number(pageText);
          if (!Number.isInteger(page) || page < 0 || page * 24 >= session.zones.length) throw new InputError('Invalid location page.');
          await i.editReply({ content: 'Choose your pickup location.', components: this.zoneComponents(id, session, page) });
        } else if (action === 'zone' && i.isStringSelectMenu()) {
          const zone = i.values[0] === 'other' ? 'Other / Not Listed' : session.zones[Number(i.values[0])];
          if (!zone) throw new InputError('Invalid pickup location.');
          session.data.zone = zone;
          await i.editReply({ content: 'The MVP sends notifications by Discord DM.', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`finish:${id}`).setPlaceholder('Confirm notification preference').addOptions({ label: 'Discord DM', value: 'DISCORD_DM' }))] });
        } else if (action === 'finish' && i.isStringSelectMenu() && session.data.zone) {
          await this.service.register(church, i.user.id, session.data);
          this.registrations.delete(id);
          try {
            await this.dm(i.user.id, `Welcome to ${church.churchName}, ${session.data.name}! Your registration is saved. React ✅ on the weekly rides post to request a ride; react 1️⃣ to bring one guest. Notifications arrive here by Discord DM.`);
            await i.editReply('Registration saved. Check your DMs!');
          } catch { await i.editReply('Registration saved, but I could not DM you. Enable direct messages from server members to receive ride messages.'); }
        }
      });
      if (!recognized) await i.editReply('This server is not configured for Chariot.');
    } catch (error) {
      this.report('Interaction', error);
      const content = error instanceof InputError ? error.message : 'Could not complete that action. Please try again; if it persists, contact an admin.';
      try { if (i.deferred || i.replied) await i.editReply({ content, components: [] }); else await i.reply({ content, flags: MessageFlags.Ephemeral }); } catch { /* expired Discord interaction */ }
    }
  }

  private async reaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, added: boolean) {
    if (user.bot || !['✅', '1️⃣'].includes(reaction.emoji.name ?? '')) return;
    try {
      if (reaction.partial) await reaction.fetch();
      const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
      if (!message.guildId || message.author?.id !== this.client.user?.id) return;
      await this.service.run(message.guildId, async church => {
        if (message.channelId !== church.weeklyPostChannelId) return;
        const ride = await this.service.reaction(church, user.id, message.id, reaction.emoji.name!, added);
        if (ride) await this.promptPlus(church, user.id, ride);
      });
    } catch (error) {
      this.report('Reaction', error);
      try { await this.dm(user.id, error instanceof InputError ? error.message : 'Your ride change could not be saved. Remove/re-add your reaction to retry, or ask an admin to run /rides sync.'); } catch { this.report('Reaction DM delivery', error); }
    }
  }
  private async promptPlus(church: Row, userId: string, ride: Row) {
    const message = await this.dm(userId, `[${church.churchName} — ${ride.weekDate}] ${truth(ride.hasPlusOne) ? 'Update your existing +1' : 'Add your +1'}: reply to THIS message with two lines: their full name, then US phone (+12025550123). You may use your own phone. Use Discord’s Reply action to select this church.`);
    await this.service.patch('RideRequests', church, { requestId: ride.requestId }, { plusOnePromptId: message.id });
  }

  private async message(message: Message) {
    if (message.author.bot || message.guildId) return;
    try {
      // DMs have no guildId: recover it only from a persisted, user-bound outbound prompt.
      const candidates: { church: Row; type: 'driver' | 'plus'; prompt: string }[] = [];
      const reference = message.reference?.messageId;
      for (const church of await this.service.churches()) {
        const week = weekDate(church, this.service.now());
        for (const driver of await this.service.rows('Drivers', church)) {
          if (driver.discordId === message.author.id && driver.askedWeek === week && driver.askMessageId && (reference ? driver.askMessageId === reference : driver.respondedWeek !== week)) candidates.push({ church, type: 'driver', prompt: driver.askMessageId });
        }
        const member = await this.service.member(church, message.author.id);
        if (member) for (const ride of await this.service.rows('RideRequests', church)) {
          if (ride.memberId === member.memberId && ride.weekDate === week && ride.plusOnePromptId && (!reference || reference === ride.plusOnePromptId)) candidates.push({ church, type: 'plus', prompt: ride.plusOnePromptId });
        }
      }
      if (candidates.length !== 1) {
        await message.reply(candidates.length ? 'You have multiple pending prompts. Use Discord’s Reply action on the specific church’s message.' : 'No current prompt matches this reply. Use /register in your church, react 1️⃣ for a guest, or ask an admin to resend the driver ask.'); return;
      }
      const candidate = candidates[0];
      await this.service.run(candidate.church.discordGuildId, async church => {
        if (church.churchId !== candidate.church.churchId) throw new InputError('Church configuration changed. Ask an admin to resend the prompt.');
        await this.isMember(church, message.author.id);
        if (candidate.type === 'driver') await message.reply(`[${church.churchName}] ${await this.service.driverReply(church, message.author.id, candidate.prompt, message.content)}`);
        else { await this.service.plusOne(church, message.author.id, candidate.prompt, message.content); await message.reply(`[${church.churchName}] Your +1 is saved.`); }
      });
    } catch (error) {
      this.report('DM reply', error);
      try { await message.reply(error instanceof InputError ? error.message : 'Your reply could not be saved. Please try replying to the original prompt again.'); } catch { /* user disabled DMs */ }
    }
  }

  async post(church: Row) {
    const week = weekDate(church, this.service.now());
    if (church.activeMessageId && church.activeWeekDate === week) return;
    if (!church.weeklyMessageTemplate?.trim()) throw new InputError('Set weeklyMessageTemplate in Churches before posting.');
    const channel = await this.channel(church);
    // Recover a post sent before a crash/failed Sheet write, before sending anything new.
    const marker = `chariot:weekly:${church.churchId}:${week}`;
    let recovered: Message | undefined;
    let before: string | undefined;
    const start = localTime(church, this.service.now()).startOf('week').toMillis();
    for (;;) {
      const history = await channel.messages.fetch({ limit: 100, before });
      recovered = history.find(m => m.author.id === this.client.user?.id && m.embeds.some(e => e.footer?.text === marker));
      if (recovered || history.size < 100 || history.last()!.createdTimestamp < start) break;
      before = history.last()!.id;
    }
    const message = recovered ?? await channel.send({ content: church.weeklyMessageTemplate, embeds: [{ footer: { text: marker } }], nonce: createHash('sha256').update(marker).digest('hex').slice(0, 24), enforceNonce: true, allowedMentions: { parse: [] } });
    // Save before reactions so a failed anchor can be repaired by reconciliation.
    await this.service.patch('Churches', church, {}, { activeMessageId: message.id, activeWeekDate: week });
    await message.react('✅');
    await message.react('1️⃣');
  }
  async reconcile(church: Row) {
    const week = weekDate(church, this.service.now());
    if (!church.activeMessageId || church.activeWeekDate !== week) return;
    const message = await (await this.channel(church)).messages.fetch(church.activeMessageId);
    if (message.author.id !== this.client.user?.id) throw new InputError('Active weekly message is not owned by this bot.');
    const users = async (emoji: string) => {
      const found = new Set<string>();
      const reaction = message.reactions.cache.find(r => r.emoji.name === emoji);
      if (!reaction) return found;
      let after: string | undefined;
      for (;;) {
        const batch = await reaction.users.fetch({ limit: 100, after });
        for (const user of batch.values()) if (!user.bot) found.add(user.id);
        if (batch.size < 100) break;
        after = batch.last()!.id;
      }
      return found;
    };
    const checks = await users('✅');
    const plus = await users('1️⃣');
    const members = await this.service.rows('Members', church);
    const requests = await this.service.rows('RideRequests', church);
    for (const userId of checks) {
      try { await this.service.reaction(church, userId, message.id, '✅', true); }
      catch (error) { if (!(error instanceof InputError)) throw error; try { await this.dm(userId, error.message); } catch { this.report('Reconciliation DM', error); } }
    }
    for (const ride of requests.filter(r => r.weekDate === week)) {
      const member = members.find(m => m.memberId === ride.memberId);
      if (!member) continue;
      if (!checks.has(member.discordId) && ride.status === 'PENDING') await this.service.reaction(church, member.discordId, message.id, '✅', false);
      if (!plus.has(member.discordId) && (truth(ride.hasPlusOne) || ride.plusOnePromptId)) await this.service.reaction(church, member.discordId, message.id, '1️⃣', false);
    }
    for (const userId of plus) {
      if (!checks.has(userId)) continue;
      try {
        const { ride } = await this.service.request(church, userId, week);
        if (ride && !truth(ride.hasPlusOne) && !ride.plusOnePromptId) {
          const eligible = await this.service.reaction(church, userId, message.id, '1️⃣', true);
          if (eligible) await this.promptPlus(church, userId, eligible);
        }
      } catch (error) { if (!(error instanceof InputError)) throw error; this.report('Reconcile guest', error); }
    }
    await message.react('✅'); await message.react('1️⃣');
  }
  private async reset(church: Row) {
    const week = weekDate(church, this.service.now());
    if (church.availabilityResetWeek === week) return;
    for (const driver of await this.service.rows('Drivers', church)) {
      if (driver.availabilityWeek !== week) await this.service.patch('Drivers', church, { driverId: driver.driverId }, { isAvailableThisWeek: 'false', availabilityWeek: week, respondedWeek: '', askedWeek: '', askMessageId: '' });
    }
    await this.service.patch('Churches', church, {}, { availabilityResetWeek: week });
  }
  private async ask(church: Row, resend = false) {
    const week = weekDate(church, this.service.now());
    for (const driver of await this.service.rows('Drivers', church)) {
      if (driver.isActive?.toLowerCase() === 'false' || !driver.discordId || driver.respondedWeek === week || (!resend && driver.askedWeek === week)) continue;
      try {
        await this.isMember(church, driver.discordId);
        const message = await this.dm(driver.discordId, `[${church.churchName} — ${week}] Hi ${driver.name}! Can you drive this Sunday? Reply YES or NO. No reply by Sat 11:45am = we assume NO. Use Discord’s Reply action on THIS message if you belong to multiple churches.`);
        await this.service.patch('Drivers', church, { driverId: driver.driverId }, { askedWeek: week, askMessageId: message.id });
      } catch (error) { this.report(`Driver ask (${church.churchId}/${driver.driverId})`, error); }
    }
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.churchCache = await this.service.churches();
      for (const church of this.churchCache) {
        try {
          await this.service.run(church.discordGuildId, async current => {
            if (!this.initializedGuilds.has(current.discordGuildId)) {
              const guild = await this.client.guilds.fetch(current.discordGuildId);
              for (const command of commands) await guild.commands.create(command);
              await this.reconcile(current);
              this.initializedGuilds.add(current.discordGuildId);
            }
            const local = localTime(current, this.service.now());
            await this.reset(current);
            if (weeklyDue(current, this.service.now())) await this.post(current);
            if ((local.weekday === 4 && local.toFormat('HH:mm') >= '12:00') || local.weekday === 5 || (local.weekday === 6 && local.toFormat('HH:mm') < '11:45')) await this.ask(current);
          });
        } catch (error) { this.report(`Schedule (${church.churchId})`, error); }
      }
    } catch (error) { this.report('Schedule', error); }
    finally { this.ticking = false; }
  }
}
