import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, Events, GatewayIntentBits,
  MessageFlags, ModalBuilder, Partials, PermissionFlagsBits, SlashCommandBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type Interaction, type Message, type MessageReaction, type PartialMessageReaction,
  type User, type PartialUser,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import type { Row } from './sheets.js';
import { Service, InputError, validPhone } from './service.js';
import { localTime, weekDate, weeklyDue } from './time.js';

export const commands = [
  new SlashCommandBuilder().setName('register').setDescription('Learn how to register for church rides'),
  new SlashCommandBuilder().setName('rides').setDescription('Manage church rides')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('post').setDescription('Post the current weekly ride request').addStringOption(o => o.setName('church').setDescription('Church ID').setRequired(true)))
    .addSubcommand(s => s.setName('sync').setDescription('Reconcile reactions on the current post').addStringOption(o => o.setName('church').setDescription('Church ID').setRequired(true)))
    .addSubcommand(s => s.setName('ask-drivers').setDescription('Ask drivers who have not replied this week').addStringOption(o => o.setName('church').setDescription('Church ID').setRequired(true))),
].map(c => c.toJSON());

type Registration = { churchId: string; userId: string; expires: number; data: Row; zones: string[] };
type Survey = { churchId: string; userId: string; expires: number };
export function createClient() {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.DirectMessages],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
    allowedMentions: { parse: [] },
  });
}

export class Bot {
  private registrations = new Map<string, Registration>();
  private surveys = new Map<string, Survey>();
  private churchCache: Row[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private initializedGuilds = new Set<string>();
  constructor(readonly client: Client, readonly service: Service) {}

  private report(context: string, error: unknown) {
    // Never dump Google/Discord HTTP errors: they may contain credentials or personal data.
    if (error instanceof InputError) { console.error(`${context}: ${error.message}`); return; }
    const details = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown } : {};
    const code = typeof details.code === 'number' || typeof details.code === 'string' ? `; code ${details.code}` : '';
    const status = typeof details.status === 'number' ? `; HTTP ${details.status}` : '';
    console.error(`${context}: operation failed; check configuration, permissions and connectivity${code}${status}`);
  }
  private async dm(userId: string, content: string, components: ActionRowBuilder<ButtonBuilder>[] = []) {
    return (await this.client.users.fetch(userId)).send({ content, components, allowedMentions: { parse: [] } });
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
      try { await this.service.runChurch(church.churchId, async resolved => {
        if (!this.initializedGuilds.has(resolved.discordGuildId)) {
          const guild = await this.client.guilds.fetch(resolved.discordGuildId);
          // Create/update only our commands; do not replace unrelated application commands.
          for (const command of commands) await guild.commands.create(command);
          this.initializedGuilds.add(resolved.discordGuildId);
        }
        await this.service.patch('Churches', resolved, {}, { activeMessageId: '', activeWeekDate: '', availabilityResetWeek: '' });
      }); } catch (error) { this.report(`Startup (${church.churchId})`, error); }
    }
    console.log('Chariot is ready. Manual mode: use /rides commands to post, sync, or ask drivers.');
  }

  private modal(churchId: string) {
    const field = (id: string, label: string, required: boolean, max: number, style = TextInputStyle.Short) => new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max));
    return new ModalBuilder().setCustomId(`register-form:${churchId}`).setTitle('Register for church rides').addComponents(
      field('name', 'Full name', true, 100), field('phone', 'US phone (+12025550123)', true, 12), field('preferences', 'Ride preferences (optional)', false, 1000, TextInputStyle.Paragraph),
    );
  }
  private surveyKey(churchId: string, userId: string) { return `${churchId}:${userId}`; }
  private async startSurvey(church: Row, userId: string) {
    const key = this.surveyKey(church.churchId, userId);
    const current = this.surveys.get(key);
    if (current && current.expires >= Date.now()) return;
    this.surveys.set(key, { churchId: church.churchId, userId, expires: Date.now() + 15 * 60_000 });
    try {
      const content = church.registrationDmTemplate?.trim() || `[${church.churchName}] Complete your registration survey before requesting a ride.`;
      await this.dm(userId, content.replaceAll('{churchName}', church.churchName), [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`survey:${church.churchId}`).setLabel('Start registration').setStyle(ButtonStyle.Primary))]);
    } catch {
      this.surveys.delete(key);
    }
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
        await i.reply({ content: 'React to the weekly post for your church to start its registration survey.', flags: MessageFlags.Ephemeral }); return;
      }
      if (i.isButton() && i.customId.startsWith('survey:')) {
        const churchId = i.customId.slice('survey:'.length);
        const survey = this.surveys.get(this.surveyKey(churchId, i.user.id));
        if (!survey || survey.expires < Date.now()) throw new InputError('Your survey link expired. React to the weekly post again to start over.');
        await i.showModal(this.modal(churchId)); return;
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      let churchId: string | undefined;
      if (i.isChatInputCommand()) {
        if (!i.guildId || !i.channelId) throw new InputError('Use this command in the shared rides channel.');
        churchId = i.options.getString('church', true);
      } else if (i.isModalSubmit()) {
        const [kind, id] = i.customId.split(':');
        if (kind !== 'register-form' || !id) throw new InputError('Invalid registration survey. React to the weekly post again.');
        churchId = id;
      } else {
        const [, id] = i.customId.split(':');
        const session = id ? this.registrations.get(id) : undefined;
        if (!session || session.userId !== i.user.id) throw new InputError('Registration expired. React to the weekly post again.');
        churchId = session.churchId;
      }
      let recognized = false;
      await this.service.runChurch(churchId, async church => {
        recognized = true;
        if (i.isChatInputCommand()) {
          if (i.commandName !== 'rides') return;
          if (church.discordGuildId !== i.guildId || church.weeklyPostChannelId !== i.channelId) throw new InputError('Use this command in the shared rides channel with a configured church ID.');
          if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new InputError('Manage Server permission is required.');
          const sub = i.options.getSubcommand();
          try {
            if (sub === 'post') await this.post(church);
            if (sub === 'sync') await this.reconcile(church);
            if (sub === 'ask-drivers') { await this.reset(church); await this.ask(church, true); }
          } catch (error) {
            this.report(`Interaction /rides ${sub} (${church.churchId})`, error);
            throw error;
          }
          await i.editReply('Completed.'); return;
        }
        for (const [key, value] of this.registrations) if (value.expires < Date.now()) this.registrations.delete(key);
        for (const [key, value] of this.surveys) if (value.expires < Date.now()) this.surveys.delete(key);
        if (i.isModalSubmit() && i.customId.startsWith('register-form:')) {
          const data = { name: i.fields.getTextInputValue('name').trim(), phone: i.fields.getTextInputValue('phone').trim(), preferences: i.fields.getTextInputValue('preferences').trim() };
          if (!data.name || !validPhone(data.phone)) throw new InputError('Enter your name and a valid US E.164 phone (+12025550123). Run /register again.');
          const zones = (await this.service.rows('Zones', church)).sort((a, b) => Number(a.zonePriorityOrder) - Number(b.zonePriorityOrder)).map(z => z.zoneName).filter(z => z && z !== 'Other / Not Listed');
          const id = randomUUID();
          const session = { churchId: church.churchId, userId: i.user.id, expires: Date.now() + 15 * 60_000, data, zones: [...new Set(zones)] };
          this.registrations.set(id, session);
          await i.editReply({ content: 'Choose your pickup location. Registration expires in 15 minutes.', components: this.zoneComponents(id, session) }); return;
        }
        if (!i.isButton() && !i.isStringSelectMenu()) return;
        const [action, id, pageText] = i.customId.split(':');
        const session = this.registrations.get(id);
        if (!session || session.churchId !== church.churchId || session.userId !== i.user.id) throw new InputError('Registration expired. React to the weekly post again.');
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
          this.surveys.delete(this.surveyKey(church.churchId, i.user.id));
          await i.editReply(`Registration saved for ${church.churchName}. React again to this church's weekly post to request a ride.`);
        }
      });
      if (!recognized) await i.editReply('This church survey or command is no longer configured. React to the weekly post again.');
    } catch (error) {
      this.report('Interaction', error);
      const content = error instanceof InputError ? error.message : 'Could not complete that action. Please try again; if it persists, contact an admin.';
      try { if (i.deferred || i.replied) await i.editReply({ content, components: [] }); else await i.reply({ content, flags: MessageFlags.Ephemeral }); } catch { /* expired Discord interaction */ }
    }
  }

  private async reaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, added: boolean) {
    if (user.bot) return;
    try {
      if (reaction.partial) await reaction.fetch();
      const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
      if (!message.guildId || message.author?.id !== this.client.user?.id) return;
      await this.service.runMessage(message.guildId, message.id, async church => {
        if (message.channelId !== church.weeklyPostChannelId) return;
        if (added && !await this.service.member(church, user.id)) {
          await this.startSurvey(church, user.id);
          return;
        }
        await this.service.reaction(church, user.id, message.id, added);
      });
    } catch (error) {
      this.report('Reaction', error);
      try { await this.dm(user.id, error instanceof InputError ? error.message : 'Your ride change could not be saved. Remove/re-add your reaction to retry, or ask an admin to run /rides sync.'); } catch { this.report('Reaction DM delivery', error); }
    }
  }
  private async message(message: Message) {
    if (message.author.bot || message.guildId) return;
    try {
      // DMs have no guildId: recover it only from a persisted, user-bound outbound prompt.
      const candidates: { church: Row; prompt: string }[] = [];
      const reference = message.reference?.messageId;
      for (const church of await this.service.churches()) {
        const week = weekDate(church, this.service.now());
        for (const driver of await this.service.rows('Drivers', church)) {
          if (driver.discordId === message.author.id && driver.askedWeek === week && driver.askMessageId && (reference ? driver.askMessageId === reference : driver.respondedWeek !== week)) candidates.push({ church, prompt: driver.askMessageId });
        }
      }
      if (candidates.length !== 1) {
        await message.reply(candidates.length ? 'You have multiple pending prompts. Use Discord’s Reply action on the specific church’s message.' : 'No current driver prompt matches this reply. Ask an admin to resend it.'); return;
      }
      const candidate = candidates[0];
      await this.service.runChurch(candidate.church.churchId, async church => {
        if (church.churchId !== candidate.church.churchId) throw new InputError('Church configuration changed. Ask an admin to resend the prompt.');
        await this.isMember(church, message.author.id);
        await message.reply(`[${church.churchName}] ${await this.service.driverReply(church, message.author.id, candidate.prompt, message.content)}`);
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
    const message = await channel.send({ content: church.weeklyMessageTemplate, allowedMentions: { parse: [] } });
    await this.service.patch('Churches', church, {}, { activeMessageId: message.id, activeWeekDate: week });
  }
  async reconcile(church: Row) {
    const week = weekDate(church, this.service.now());
    if (!church.activeMessageId || church.activeWeekDate !== week) return;
    let message: Message;
    try { message = await (await this.channel(church)).messages.fetch(church.activeMessageId); }
    catch (error) {
      const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
      if (code === 10008) {
        await this.service.patch('Churches', church, {}, { activeMessageId: '', activeWeekDate: '' });
        return;
      }
      throw error;
    }
    if (message.author.id !== this.client.user?.id) throw new InputError('Active weekly message is not owned by this bot.');
    const reactors = new Set<string>();
    for (const reaction of message.reactions.cache.values()) {
      let after: string | undefined;
      for (;;) {
        const batch = await reaction.users.fetch({ limit: 100, after });
        for (const user of batch.values()) if (!user.bot) reactors.add(user.id);
        if (batch.size < 100) break;
        after = batch.last()!.id;
      }
    }
    const members = await this.service.rows('Members', church);
    const requests = await this.service.rows('RideRequests', church);
    for (const userId of reactors) {
      try { await this.service.reaction(church, userId, message.id, true); }
      catch (error) { if (!(error instanceof InputError)) throw error; try { await this.dm(userId, error.message); } catch { this.report('Reconciliation DM', error); } }
    }
    for (const ride of requests.filter(r => r.weekDate === week)) {
      const member = members.find(m => m.memberId === ride.memberId);
      if (!member) continue;
      if (!reactors.has(member.discordId) && ride.status === 'PENDING') await this.service.reaction(church, member.discordId, message.id, false);
    }
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
          await this.service.runChurch(church.churchId, async current => {
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
