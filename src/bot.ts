import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, Events, GatewayIntentBits, LabelBuilder,
  MessageFlags, ModalBuilder, Partials, PermissionFlagsBits, SlashCommandBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type Interaction, type Message, type MessageReaction, type PartialMessageReaction,
  type User, type PartialUser,
} from 'discord.js';
import { columns, type Row, type Tab } from './sheets.js';
import { Service, InputError, truth } from './service.js';
import { broadcastProblems, parseBroadcast, tail } from './broadcast.js';
import { weekDate } from './time.js';
import { jobDue, MAX_ATTEMPTS, MESSAGE_LIMIT, parseJob, PENDING, renderMessage, UnconfirmedDeliveryError, type Job } from './schedule.js';

export const commands = [
  new SlashCommandBuilder().setName('register').setDescription('Learn how to register for church rides'),
  new SlashCommandBuilder().setName('rides').setDescription('Manage church rides')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('post').setDescription('Post the current weekly ride request').addStringOption(o => o.setName('church').setDescription('Church ID').setRequired(true)))
    .addSubcommand(s => s.setName('sync').setDescription('Reconcile reactions on the current post').addStringOption(o => o.setName('church').setDescription('Church ID').setRequired(true)))
    .addSubcommand(s => s.setName('ask-drivers').setDescription('Ask drivers who have not replied this week').addStringOption(o => o.setName('church').setDescription('Church ID').setRequired(true)))
    .addSubcommand(s => s.setName('broadcast').setDescription('Post a greeting and one message per church from the Broadcasts tab').addStringOption(o => o.setName('name').setDescription('Broadcast ID').setRequired(true))),
].map(c => c.toJSON());

type Mode = 'rides' | 'drivers';
const OTHER_ZONE = 'Other / Not Listed';
/** Discord requires the first response within 3 seconds; leave headroom for the reply itself. */
const MODAL_DEADLINE_MS = 2_500;
/** The Register button under a post. Its id carries everything needed, so it keeps working after a restart. */
const registerRow = (churchId: string, mode: Mode, label: string) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`register:${churchId}:${mode}`).setLabel(label).setStyle(ButtonStyle.Primary));
const parseSeats = (text: string) => {
  if (!/^\d+$/.test(text.trim()) || Number(text) < 1 || Number(text) > 20) throw new InputError('Enter a whole number of seats from 1 to 20.');
  return Number(text);
};
export function createClient() {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.DirectMessages],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
    allowedMentions: { parse: [] },
  });
}

export class Bot {
  private prompted = new Map<string, number>();
  private zoneCache?: { names: string[]; expires: number };
  private zoneRefresh?: Promise<string[]>;
  private churchCache: Row[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private initializedGuilds = new Set<string>();
  private broadcasting = new Set<string>();
  constructor(readonly client: Client, readonly service: Service) {}

  private report(context: string, error: unknown) {
    // Never dump Google/Discord HTTP errors: they may contain credentials or personal data.
    if (error instanceof InputError) { console.error(`${context}: ${error.message}`); return; }
    const details = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown } : {};
    const code = typeof details.code === 'number' || typeof details.code === 'string' ? `; code ${details.code}` : '';
    const status = typeof details.status === 'number' ? `; HTTP ${details.status}` : '';
    console.error(`${context}: operation failed; check configuration, permissions and connectivity${code}${status}`);
  }
  /** Admin-facing reason for a failure: our own messages as written, otherwise the safe error codes only. */
  private describe(error: unknown) {
    if (error instanceof InputError) return error.message;
    const details = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown } : {};
    if (details.status === 429 || Number(details.code) === 429) return 'rate limited (HTTP 429): Google Sheets allows only about 60 requests a minute and the bot retried but was still over the limit. Wait a minute, then re-run';
    const codes = [typeof details.code === 'number' || typeof details.code === 'string' ? `Discord/Node code ${details.code}` : '', typeof details.status === 'number' ? `HTTP ${details.status}` : ''].filter(Boolean).join(', ');
    return `unexpected failure${codes ? ` (${codes})` : ''}. Check that the bot can view, send and read history in that channel and still has access to the Sheet; see the Render logs`;
  }
  private async dm(userId: string, content: string, components: ActionRowBuilder<ButtonBuilder>[] = []) {
    return (await this.client.users.fetch(userId)).send({ content, components, allowedMentions: { parse: [] } });
  }
  private async channel(church: Row, channelId = church.weeklyPostChannelId, label = 'weekly post') {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !channel.isSendable() || !('guildId' in channel) || channel.guildId !== church.discordGuildId) throw new InputError(`The ${label} channel must belong to this church’s server.`);
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
  /** Logs (does not stop) when a tab is missing columns this version writes, e.g. setup:sheets was not run. */
  private async checkSheetHeaders() {
    const missing: string[] = [];
    for (const tab of Object.keys(columns) as Tab[]) {
      try {
        const { headers } = await this.service.db.read(tab);
        for (const name of columns[tab]) if (!headers.includes(name)) missing.push(`${tab}.${name}`);
      } catch { missing.push(`${tab} (tab missing or unreadable)`); }
    }
    if (missing.length) console.error(`SHEET SETUP NEEDED: missing ${missing.join(', ')}. Run "npm run setup:sheets" to add them.`);
  }
  private async ready() {
    await this.checkSheetHeaders();
    this.churchCache = await this.service.churches();
    if (this.churchCache[0]) await this.zoneNames(this.churchCache[0]).catch(() => undefined); // warm the sign-up form's zone list
    for (const church of this.churchCache) {
      try { await this.service.runChurch(church.churchId, async resolved => {
        if (!this.initializedGuilds.has(resolved.discordGuildId)) {
          const guild = await this.client.guilds.fetch(resolved.discordGuildId);
          // Create/update only our commands; do not replace unrelated application commands.
          for (const command of commands) await guild.commands.create(command);
          this.initializedGuilds.add(resolved.discordGuildId);
        }
        // Weekly state belongs to the Sheet, not this process. It must survive a
        // deploy or restart so /rides sync can continue managing the same post.
      }); } catch (error) { this.report(`Startup (${church.churchId})`, error); }
    }
    console.log('Chariot is ready. Scheduler running (Schedules tab); /rides commands still work for manual runs.');
    // Catch up anything missed while the bot was down, then check every minute. unref: never keeps the process alive.
    await this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  /** Zone names for the sign-up select, by priority. A modal must open within 3 seconds, so a stale cache is served while it refreshes. */
  private async zoneNames(church: Row) {
    const cache = this.zoneCache;
    if (cache && cache.expires > Date.now()) return cache.names;
    if (!this.zoneRefresh) {
      this.zoneRefresh = this.service.rows('Zones', church).then(rows => {
        const names = [...new Set(rows.sort((a, b) => Number(a.zonePriorityOrder) - Number(b.zonePriorityOrder)).map(z => z.zoneName).filter(z => z && z !== OTHER_ZONE))];
        this.zoneCache = { names, expires: Date.now() + 60_000 };
        return names;
      }).finally(() => { this.zoneRefresh = undefined; });
      this.zoneRefresh.catch(() => undefined);
    }
    return cache ? cache.names : this.zoneRefresh;
  }
  /** One form for riders and drivers. A modal holds 5 fields: blank seats means rider, a number means driver. */
  private async modal(church: Row, mode: Mode) {
    const names = await this.zoneNames(church);
    if (names.length > 24) console.warn(`Zones has ${names.length} rows; the sign-up form can only list the first 24.`);
    const driving = mode === 'drivers';
    const text = (id: string, label: string, required: boolean, max: number, style = TextInputStyle.Short, description?: string) => {
      const row = new LabelBuilder().setLabel(label).setTextInputComponent(new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required).setMaxLength(max));
      return description ? row.setDescription(description) : row;
    };
    const zone = new LabelBuilder().setLabel('Pickup / driving-from location').setDescription('Where you need a pickup, or where you would drive from.')
      .setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId('zone').setPlaceholder('Choose a location').setRequired(true).addOptions(
        ...names.slice(0, 24).map(name => ({ label: name.slice(0, 100), value: name.slice(0, 100) })), { label: OTHER_ZONE, value: OTHER_ZONE },
      ));
    return new ModalBuilder().setCustomId(`register-form:${church.churchId}:${mode}`).setTitle(driving ? 'Sign up to drive' : 'Register for church rides').addLabelComponents(
      text('name', 'Full name', true, 100), text('phone', 'Phone number', true, 30), text('preferences', 'Ride preferences (optional)', false, 1000, TextInputStyle.Paragraph),
      driving ? text('seatsAvailable', 'Seats you can offer', true, 2, TextInputStyle.Short, 'Required to sign up as a driver.')
        : text('seatsAvailable', 'Seats you can offer (drivers only)', false, 2, TextInputStyle.Short, 'Leave blank if you just need rides.'),
      zone,
    );
  }
  private seatsModal(churchId: string) {
    const input = new TextInputBuilder().setCustomId('seatsAvailable').setLabel('Seats you can offer (1-20)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2);
    return new ModalBuilder().setCustomId(`driver-seats:${churchId}`).setTitle('How many seats can you offer?').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  /** DMs a Register button, at most once per 15 minutes per person and mode, so a sync does not re-send to everyone. */
  private async prompt(church: Row, userId: string, mode: Mode, message?: string, label?: string) {
    const key = `${church.churchId}:${userId}:${mode}`;
    const last = this.prompted.get(key);
    if (last && last > Date.now() - 15 * 60_000) return;
    this.prompted.set(key, Date.now());
    try {
      const name = church.churchName;
      const content = message ?? (mode === 'rides'
        ? (church.registrationDmTemplate?.trim() || `[${name}] Complete your registration before requesting a ride.`).replaceAll('{churchName}', name)
        : `[${name}] To drive for ${name}, complete this quick sign-up (name, phone, seats and where you drive from).`);
      await this.dm(userId, content, [registerRow(church.churchId, mode, label ?? (mode === 'rides' ? 'Start registration' : 'Start driver sign-up'))]);
    } catch {
      this.prompted.delete(key);
    }
  }
  /** Applies a reaction on the driver ask. Reacting makes the person available at once; prompts finish their sign-up. */
  private async driverReactionFlow(church: Row, userId: string, messageId: string, added: boolean, username?: string) {
    const result = await this.service.driverReaction(church, userId, messageId, added, username);
    const name = church.churchName;
    const seatsNote = `[${name}] You're marked available as a driver this week. Confirm how many seats you can offer so we can plan rides:`;
    const signupNote = `[${name}] You're marked available as a driver this week. Finish your sign-up (name, phone, seats and where you drive from) so we can plan rides:`;
    if (result.status === 'register' || (result.status === 'applied' && result.unconfirmed && !await this.service.member(church, userId))) {
      await this.service.beginRegistration(church, userId, username);
      await this.service.setCanDrive(church, userId, true);
      await this.prompt(church, userId, 'drivers', signupNote);
    } else if (result.status === 'seats' || (result.status === 'applied' && result.unconfirmed)) {
      await this.prompt(church, userId, 'drivers', seatsNote, 'Set my seats');
    } else if (result.status === 'copy') {
      // Already drives for another church: their reaction here is the opt-in, so they are available now.
      await this.service.addDriver(church, userId, { seats: Number(result.source.seatsAvailable), homeZone: result.source.homeZone, available: true, username });
    }
  }
  /** A Register button on a post: opens the form (or just the seats form for someone already registered). */
  private async registerButton(i: ButtonInteraction) {
    const [, churchId, mode] = i.customId.split(':');
    if (mode !== 'rides' && mode !== 'drivers') throw new InputError('This sign-up button is out of date. Ask an admin to repost.');
    // Discord voids the interaction if showModal is not called within 3 seconds, and these are Sheet reads.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const busy = new Promise<'busy'>(resolve => { timer = setTimeout(() => resolve('busy'), MODAL_DEADLINE_MS); });
    const prepare = (async () => {
      const church = await this.service.resolveChurch(churchId);
      if (!church) throw new InputError('This church is no longer configured. Ask an admin.');
      const member = await this.service.member(church, i.user.id);
      if (member && mode === 'rides') return { already: true as const };
      return { modal: member ? this.seatsModal(churchId) : await this.modal(church, mode) };
    })();
    prepare.catch(() => undefined);
    try {
      const result = await Promise.race([prepare, busy]);
      if (result === 'busy') { await i.reply({ content: 'Chariot is busy right now. Please tap the button again in a few seconds.', flags: MessageFlags.Ephemeral }); return; }
      if ('already' in result) { await i.reply({ content: "You're already registered. React to the weekly post to request a ride.", flags: MessageFlags.Ephemeral }); return; }
      await i.showModal(result.modal);
    } finally { clearTimeout(timer); }
  }
  private async interaction(i: Interaction) {
    if (!i.isChatInputCommand() && !i.isModalSubmit() && !i.isButton()) return;
    try {
      if (i.isChatInputCommand() && i.commandName === 'register') {
        await i.reply({ content: 'Tap the Register button on your church’s weekly post, or react to it, to sign up.', flags: MessageFlags.Ephemeral }); return;
      }
      if (i.isButton()) {
        if (i.customId.startsWith('register:')) await this.registerButton(i);
        return;
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (i.isChatInputCommand() && i.commandName === 'rides' && i.options.getSubcommand() === 'broadcast') {
        if (!i.guildId || !i.channelId) throw new InputError('Use this command in the shared rides channel.');
        if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new InputError('Manage Server permission is required.');
        await i.editReply((await this.runBroadcast(i.guildId, i.channelId, i.options.getString('name', true))).join('\n'));
        return;
      }
      let churchId: string;
      if (i.isChatInputCommand()) {
        if (!i.guildId || !i.channelId) throw new InputError('Use this command in the shared rides channel.');
        churchId = i.options.getString('church', true);
      } else {
        const [kind, id] = i.customId.split(':');
        if (!['register-form', 'driver-seats'].includes(kind) || !id) throw new InputError('Invalid sign-up form. Tap the Register button on the post again.');
        churchId = id;
      }
      let recognized = false;
      await this.service.runChurch(churchId, async church => {
        recognized = true;
        if (i.isChatInputCommand()) {
          if (i.commandName !== 'rides') return;
          const sub = i.options.getSubcommand();
          // post: rides channel only. ask-drivers: driver channel only. sync covers both posts, so either.
          const homes = sub === 'ask-drivers' ? [church.driverAskChannelId] : sub === 'sync' ? [church.weeklyPostChannelId, church.driverAskChannelId] : [church.weeklyPostChannelId];
          if (church.discordGuildId !== i.guildId || !homes.includes(i.channelId)) throw new InputError(sub === 'ask-drivers' ? 'Use /rides ask-drivers in the driver channel (driverAskChannelId) with a configured church ID.' : sub === 'sync' ? 'Use /rides sync in the rides channel (weeklyPostChannelId) or the driver channel (driverAskChannelId) with a configured church ID.' : 'Use this command in the shared rides channel (weeklyPostChannelId) with a configured church ID.');
          if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new InputError('Manage Server permission is required.');
          try {
            if (sub === 'post') await this.post(church);
            if (sub === 'sync') { await this.reconcile(church); await this.reconcileDrivers(church); }
            if (sub === 'ask-drivers') { await this.reset(church); await this.ask(church); }
          } catch (error) {
            this.report(`Interaction /rides ${sub} (${church.churchId})`, error);
            throw error;
          }
          await i.editReply('Completed.'); return;
        }
        if (!i.isModalSubmit()) return;
        const username = i.user.username;
        if (i.customId.startsWith('driver-seats:')) {
          const seats = parseSeats(i.fields.getTextInputValue('seatsAvailable'));
          await this.service.addDriver(church, i.user.id, { seats, username });
          await i.editReply(`You're set up as a driver for ${church.churchName}. React to the current driver post to be marked available this week.`); return;
        }
        const driving = i.customId.split(':')[2] === 'drivers';
        const name = i.fields.getTextInputValue('name').trim();
        const phone = i.fields.getTextInputValue('phone').trim();
        const seatsText = i.fields.getTextInputValue('seatsAvailable').trim();
        if (!name || !phone) throw new InputError('Enter your name and a phone number, then tap Register again.');
        if (driving && !seatsText) throw new InputError('Enter how many seats you can offer (1 to 20) to sign up as a driver.');
        const seats = seatsText ? parseSeats(seatsText) : undefined;
        const zone = i.fields.getStringSelectValues('zone')[0];
        if (!zone) throw new InputError('Choose a pickup / driving-from location, then tap Register again.');
        await this.service.register(church, i.user.id, { name, phone, preferences: i.fields.getTextInputValue('preferences').trim(), zone, isDriver: 'false', discordUsername: username });
        if (seats !== undefined) await this.service.addDriver(church, i.user.id, { seats, username });
        await i.editReply(driving
          ? `Driver sign-up saved for ${church.churchName}. React to the current driver post to be marked available this week.`
          : `Registration saved for ${church.churchName}.${seats !== undefined ? ' You are signed up as a driver: react to the driver post to be marked available.' : ''} React to the weekly post to request a ride.`);
      });
      if (!recognized) await i.editReply('This church survey or command is no longer configured. Tap the Register button on the post again.');
    } catch (error) {
      this.report('Interaction', error);
      const content = error instanceof InputError ? error.message : 'Could not complete that action. Please try again; if it persists, contact an admin.';
      try { if (i.deferred || i.replied) await i.editReply({ content, components: [] }); else await i.reply({ content, flags: MessageFlags.Ephemeral }); } catch { /* expired Discord interaction */ }
    }
  }

  private async reaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, added: boolean) {
    if (user.bot) return;
    let onDriverAsk = false;
    try {
      if (user.partial) user = await user.fetch();
      const username = user.username ?? undefined;
      if (reaction.partial) await reaction.fetch();
      const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
      if (!message.guildId || message.author?.id !== this.client.user?.id) return;
      let handled = false;
      await this.service.runMessage(message.guildId, message.id, async church => {
        handled = true;
        if (message.channelId !== church.weeklyPostChannelId) return;
        if (added && !await this.service.member(church, user.id)) {
          await this.service.beginRegistration(church, user.id, username);
          await this.prompt(church, user.id, 'rides');
        }
        await this.service.reaction(church, user.id, message.id, added, username);
      });
      if (handled) return;
      await this.service.runDriverAskMessage(message.guildId, message.id, async church => {
        if (message.channelId !== church.driverAskChannelId) return;
        onDriverAsk = true;
        await this.isMember(church, user.id);
        await this.driverReactionFlow(church, user.id, message.id, added, username);
      });
    } catch (error) {
      this.report('Reaction', error);
      try { await this.dm(user.id, error instanceof InputError ? error.message : onDriverAsk ? 'Your driver availability could not be saved. Remove/re-add your reaction to retry, or ask an admin to run /rides sync.' : 'Your ride change could not be saved. Remove/re-add your reaction to retry, or ask an admin to run /rides sync.'); } catch { this.report('Reaction DM delivery', error); }
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

  /** Deletes a message this bot sent. True when it is gone; false when it could not be removed. */
  private async deleteOwned(channel: Awaited<ReturnType<Bot['channel']>>, messageId: string) {
    try {
      const message = await channel.messages.fetch(messageId);
      if (message.author.id !== this.client.user?.id) return false;
      await message.delete();
      return true;
    } catch (error) { return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 10008; }
  }
  /**
   * Posts the church's weekly ride request. Without `replace`, an existing post for the week
   * is kept. With it, the new post goes live first, then the old one is deleted and this
   * week's pending requests are cancelled, since their reactions went with the old post.
   */
  async post(church: Row, replace = false) {
    const week = weekDate(church, this.service.now());
    const current = !!church.activeMessageId && church.activeWeekDate === week;
    if (current && !replace) return { replaced: false, removed: true, cleared: 0 };
    if (!church.weeklyMessageTemplate?.trim()) throw new InputError('Set weeklyMessageTemplate in Churches before posting.');
    const channel = await this.channel(church);
    const message = await channel.send({ content: church.weeklyMessageTemplate, components: [registerRow(church.churchId, 'rides', 'Register for rides')], allowedMentions: { parse: [] } });
    try { await this.service.patch('Churches', church, {}, { activeMessageId: message.id, activeWeekDate: week }); }
    catch (error) { await this.deleteOwned(channel, message.id); throw error; } // never leave a live-looking post the Sheet doesn't know about
    if (!current) return { replaced: false, removed: true, cleared: 0 };
    const removed = await this.deleteOwned(channel, church.activeMessageId);
    return { replaced: true, removed, cleared: await this.service.cancelWeekRequests(church, week) };
  }
  /** Everyone (not bots) who reacted with any emoji, paging past 100 reactors. */
  private async reactors(message: Message) {
    const reactors = new Map<string, string | undefined>();
    for (const reaction of message.reactions.cache.values()) {
      let after: string | undefined;
      for (;;) {
        const batch = await reaction.users.fetch({ limit: 100, after });
        for (const user of batch.values()) if (!user.bot) reactors.set(user.id, user.username);
        if (batch.size < 100) break;
        after = batch.last()!.id;
      }
    }
    return reactors;
  }
  /**
   * Catches up the current driver ask with its reactions. Reactors become available (or are walked
   * through sign-up); drivers who answered by reaction but no longer have one become unavailable.
   * Hand edits in the Sheet (no recorded response this week) are left alone.
   */
  async reconcileDrivers(church: Row) {
    const week = weekDate(church, this.service.now());
    if (!church.driverAskMessageId || church.driverAskWeek !== week) return;
    const channel = await this.channel(church, church.driverAskChannelId, 'driver ask');
    let message: Message;
    try { message = await channel.messages.fetch(church.driverAskMessageId); }
    catch (error) {
      const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
      if (code === 10008) {
        await this.service.patch('Churches', church, {}, { driverAskMessageId: '', driverAskWeek: '' });
        return;
      }
      throw error;
    }
    if (message.author.id !== this.client.user?.id) throw new InputError('Active driver ask is not owned by this bot.');
    const reactors = await this.reactors(message);
    const drivers = await this.service.rows('Drivers', church);
    const inNow = (driver?: Row) => !!driver && truth(driver.isAvailableThisWeek) && driver.availabilityWeek === week;
    for (const [userId, username] of reactors) {
      if (inNow(drivers.find(driver => driver.discordId === userId))) continue;
      try { await this.driverReactionFlow(church, userId, message.id, true, username); }
      catch (error) { if (!(error instanceof InputError)) throw error; try { await this.dm(userId, error.message); } catch { this.report('Reconciliation DM', error); } }
    }
    for (const driver of drivers) {
      if (!reactors.has(driver.discordId) && inNow(driver) && driver.respondedWeek === week) await this.service.driverReaction(church, driver.discordId, message.id, false);
    }
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
    const reactors = await this.reactors(message);
    const members = await this.service.rows('Members', church);
    const requests = await this.service.rows('RideRequests', church);
    for (const [userId, username] of reactors) {
      try {
        if (!await this.service.member(church, userId)) {
          await this.service.beginRegistration(church, userId, username);
          await this.prompt(church, userId, 'rides');
        }
        await this.service.reaction(church, userId, message.id, true, username);
      }
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
  /** Posts the driver ask. `replace` swaps in a fresh post and resets drivers, like `post` does for riders. */
  private async ask(church: Row, replace = false) {
    const week = weekDate(church, this.service.now());
    const current = !!church.driverAskMessageId && church.driverAskWeek === week;
    if (current && !replace) return { replaced: false, removed: true, cleared: 0 };
    if (!church.driverAskMessageTemplate?.trim()) throw new InputError('Set driverAskMessageTemplate in Churches before posting.');
    const channel = await this.channel(church, church.driverAskChannelId, 'driver ask');
    const message = await channel.send({ content: church.driverAskMessageTemplate.replaceAll('{churchName}', church.churchName).replaceAll('{weekDate}', week), components: [registerRow(church.churchId, 'drivers', 'Sign up to drive')], allowedMentions: { parse: [] } });
    try { await this.service.patch('Churches', church, {}, { driverAskMessageId: message.id, driverAskWeek: week }); }
    catch (error) { await this.deleteOwned(channel, message.id); throw error; }
    if (!current) return { replaced: false, removed: true, cleared: 0 };
    const removed = await this.deleteOwned(channel, church.driverAskMessageId);
    return { replaced: true, removed, cleared: await this.service.resetWeekDrivers(church, week) };
  }
  /**
   * Runs one Broadcasts row: a greeting, then one post (or driver ask) per listed church.
   * Everything is validated before anything is sent. Re-running replaces the previous
   * greeting and church messages for the week. Stops at the first failing church.
   */
  async runBroadcast(guildId: string, channelId: string, name: string) {
    const all = await this.service.broadcasts();
    const rows = all.filter(row => row.broadcastId.trim() === name.trim());
    if (rows.length !== 1) throw new InputError(rows.length ? `Broadcast "${name}" is listed ${rows.length} times in the Broadcasts tab; each broadcastId must be unique.` : `No broadcast named "${name}" in the Broadcasts tab. ${all.length ? `Available: ${all.map(row => row.broadcastId.trim()).join(', ')}.` : 'The tab has no broadcasts yet.'}`);
    const spec = parseBroadcast(rows[0]);
    if (this.broadcasting.has(spec.id)) throw new InputError(`Broadcast "${spec.id}" is already running; wait for it to finish.`);
    this.broadcasting.add(spec.id);
    try {
      const churches: Row[] = [];
      const problems: string[] = [];
      for (const id of spec.churchIds) {
        const church = await this.service.resolveChurch(id);
        if (church) churches.push(church);
        else problems.push(`${id}: must appear exactly once in the Churches tab's churchId column (check spelling and capitalization, and for duplicates).`);
      }
      if (!problems.length) problems.push(...broadcastProblems(spec, churches, { guildId, channelId, weekOf: church => weekDate(church, this.service.now()) }));
      if (problems.length) throw new InputError(`Broadcast "${spec.id}" did not run — ${problems.length} problem${problems.length === 1 ? '' : 's'} to fix, and nothing was posted or deleted:\n${problems.map(line => `• ${line}`).join('\n')}`);
      const week = weekDate(churches[0], this.service.now());
      const targetOf = (church: Row) => spec.type === 'post' ? church.weeklyPostChannelId : church.driverAskChannelId;
      const channel = await this.channel(churches[0], targetOf(churches[0]), 'broadcast');
      const previous = spec.row.greetingWeek === week ? spec.row.greetingMessageId : '';
      let greeting: Awaited<ReturnType<typeof channel.send>>;
      try { greeting = await channel.send({ content: spec.greeting.replaceAll('{weekDate}', week), allowedMentions: { parse: [] } }); }
      catch (error) { this.report(`Broadcast ${spec.id} greeting`, error); throw new InputError(`Broadcast "${spec.id}" did not run: could not post the greeting in the channel ending ${tail(targetOf(churches[0]))} — ${this.describe(error)}. Nothing was changed.`); }
      try { await this.service.patchBroadcast(spec.id, { greetingMessageId: greeting.id, greetingWeek: week }); }
      catch (error) {
        await this.deleteOwned(channel, greeting.id);
        this.report(`Broadcast ${spec.id} greeting save`, error);
        throw new InputError(`Broadcast "${spec.id}" did not run: the greeting was posted but could not be saved to the Sheet, so it was removed — ${this.describe(error)}. Nothing else was changed.`);
      }
      const gone = previous ? await this.deleteOwned(channel, previous) : true;
      const lines = [`Greeting posted${previous ? (gone ? ' (replaced the previous one)' : ' (the previous one could not be deleted)') : ''}.`];
      for (const church of churches) {
        try {
          const result = await this.service.runChurch(church.churchId, async current => {
            if (spec.type === 'post') return this.post(current, true);
            // A replace resets every driver itself; the gentler reset is only for a first post.
            if (!(current.driverAskMessageId && current.driverAskWeek === week)) await this.reset(current);
            return this.ask(current, true);
          });
          if (!result) throw new InputError('Church configuration changed.');
          const noun = spec.type === 'post' ? 'requests cancelled' : 'drivers reset';
          lines.push(`${church.churchId}: ${result.replaced ? `replaced previous ${spec.type === 'post' ? 'post' : 'ask'} (${result.cleared} ${noun})` : 'posted'}${result.removed ? '' : '; the old message could not be deleted'}.`);
        } catch (error) {
          this.report(`Broadcast ${spec.id} (${church.churchId})`, error);
          lines.push(`${church.churchId}: FAILED — ${this.describe(error)}. Stopped before the remaining churches; fix that and re-run (churches already posted are replaced, the rest are posted).`);
          break;
        }
      }
      return lines;
    } finally { this.broadcasting.delete(spec.id); }
  }
  /**
   * One scheduler pass. Reads only Churches and Schedules unless something needs doing: a guild's
   * first pass, a stale weekly driver reset, or a due job.
   */
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.churchCache = await this.service.churches();
      const rows = await this.service.schedules();
      // Nothing touches a church's state unless one of its Schedules rows is enabled.
      const scheduled = new Set(rows.filter(row => row.enabled?.trim().toLowerCase() === 'true').map(row => (row.churchId ?? '').trim()));
      for (const church of this.churchCache) {
        if (!scheduled.has(church.churchId)) continue;
        try {
          // A bad timezone is recorded on the church's jobs by runSchedules; don't also log it every minute here.
          let week: string;
          try { week = weekDate(church, this.service.now()); } catch { continue; }
          if (this.initializedGuilds.has(church.discordGuildId) && church.availabilityResetWeek === week) continue;
          await this.service.runChurch(church.churchId, async current => {
            if (!this.initializedGuilds.has(current.discordGuildId)) {
              const guild = await this.client.guilds.fetch(current.discordGuildId);
              for (const command of commands) await guild.commands.create(command);
              await this.reconcile(current);
              this.initializedGuilds.add(current.discordGuildId);
            }
            await this.reset(current);
          });
        } catch (error) { this.report(`Schedule (${church.churchId})`, error); }
      }
      await this.runSchedules(rows);
    } catch (error) { this.report('Schedule', error); }
    finally { this.ticking = false; }
  }
  /** Runs every due job in Schedules row order. One job failing never stops the others. */
  private async runSchedules(rows: Row[]) {
    const seen = new Map<string, number>();
    for (const row of rows) seen.set(row.jobId.trim(), (seen.get(row.jobId.trim()) ?? 0) + 1);
    for (const row of rows) {
      const id = row.jobId.trim();
      if (row.enabled?.trim().toLowerCase() !== 'true') continue;
      if (seen.get(id)! > 1) { this.report(`Schedule job ${id}`, new InputError('jobId appears more than once in the Schedules tab; it was not run.')); continue; }
      try {
        let job: Job;
        try { job = parseJob(row); }
        catch (error) { await this.noteJobError(row, error); continue; }
        const church = this.churchCache.find(c => c.churchId === job.churchId);
        if (!church) { await this.noteJobError(row, new InputError(`churchId "${job.churchId}" is not in the Churches tab.`)); continue; }
        let week: string;
        let due: boolean;
        try { week = weekDate(church, this.service.now()); due = jobDue(job, church, this.service.now()); }
        catch (error) { await this.noteJobError(row, error); continue; }
        if (row.lastRunWeek === week || !due) continue;
        const attempts = row.attemptWeek === week ? Number(row.attempts) || 0 : 0;
        if (attempts >= MAX_ATTEMPTS) continue;
        if (job.message && row.messageSentWeek !== week) {
          const length = renderMessage(job.message, church, week).length;
          if (length > MESSAGE_LIMIT) { await this.noteJobError(row, new InputError(`message is ${length} characters after {churchName}/{weekDate} are filled in; Discord's limit is ${MESSAGE_LIMIT}.`)); continue; }
        }
        try {
          const outcome = await this.runJob(row, job, week);
          await this.service.patchSchedule(id, { lastRunWeek: week, lastStatus: outcome, lastError: '', lastRunAt: this.service.now().toISO()!, attempts: '', attemptWeek: '', ...(job.message ? { messageSentWeek: week } : {}) });
        } catch (error) {
          this.report(`Schedule job ${id}`, error);
          // An unconfirmed delivery is never retried automatically, so burn the remaining attempts.
          const used = error instanceof UnconfirmedDeliveryError ? MAX_ATTEMPTS : attempts + 1;
          await this.service.patchSchedule(id, { lastStatus: 'FAILED', lastError: this.describe(error), lastRunAt: this.service.now().toISO()!, attempts: String(used), attemptWeek: week });
        }
      } catch (error) { this.report(`Schedule job ${id}`, error); }
    }
  }
  /** Records a configuration error on the row, writing only when it changed so a bad row doesn't hit the Sheet every minute. */
  private async noteJobError(row: Row, error: unknown) {
    const text = this.describe(error);
    if (row.lastStatus === 'FAILED' && row.lastError === text) return;
    this.report(`Schedule job ${row.jobId.trim()}`, error);
    await this.service.patchSchedule(row.jobId.trim(), { lastStatus: 'FAILED', lastError: text, lastRunAt: this.service.now().toISO()! });
  }
  /** The message goes first, then the command. A retry after a failed command does not resend the message. */
  private async runJob(row: Row, job: Job, week: string): Promise<'OK' | 'SKIPPED'> {
    if (job.message && row.messageSentWeek === `${PENDING}${week}`) throw new UnconfirmedDeliveryError('The message was claimed but Discord never confirmed it. It was not resent, in case it was posted. Check the channel, then clear messageSentWeek (and attempts) on this row to try again.');
    if (job.message && row.messageSentWeek !== week) {
      const church = await this.service.resolveChurch(job.churchId);
      if (!church) throw new InputError('Church configuration changed.');
      const channel = await this.channel(church, job.channel === 'drivers' ? church.driverAskChannelId : church.weeklyPostChannelId, job.channel === 'drivers' ? 'driver' : 'rides');
      // Claim before sending, so a crash or a failed Sheet write can never send it twice. A failed send releases the claim and is retried.
      await this.service.patchSchedule(job.id, { messageSentWeek: `${PENDING}${week}` });
      try { await channel.send({ content: renderMessage(job.message, church, week), allowedMentions: { parse: [] } }); }
      catch (error) {
        try { await this.service.patchSchedule(job.id, { messageSentWeek: '' }); } catch (releaseError) { this.report(`Schedule job ${job.id} (releasing message claim)`, releaseError); }
        throw error;
      }
      // It was sent, so a failed confirmation must not stop the command; the claim stays pending and reads as unconfirmed later.
      try { await this.service.patchSchedule(job.id, { messageSentWeek: week }); } catch (confirmError) { this.report(`Schedule job ${job.id} (confirming message)`, confirmError); }
    }
    const command = job.command;
    if (!command) return 'OK';
    if (command.kind === 'broadcast') return this.runScheduledBroadcast(command.name);
    const done = await this.service.runChurch(command.churchId, async church => {
      if (command.kind === 'post') await this.post(church);
      else if (command.kind === 'sync') { await this.reconcile(church); await this.reconcileDrivers(church); }
      else { await this.reset(church); await this.ask(church); }
      return true;
    });
    if (!done) throw new InputError(`Church "${command.churchId}" is not configured.`);
    return 'OK';
  }
  /** Runs a Broadcasts row on a schedule. If another run already put this week's block live, leaves it alone. */
  private async runScheduledBroadcast(name: string): Promise<'OK' | 'SKIPPED'> {
    const rows = (await this.service.broadcasts()).filter(row => row.broadcastId.trim() === name);
    if (rows.length !== 1) throw new InputError(`Broadcast "${name}" must appear exactly once in the Broadcasts tab.`);
    const spec = parseBroadcast(rows[0]);
    const churches: Row[] = [];
    for (const id of spec.churchIds) {
      const church = await this.service.resolveChurch(id);
      if (!church) throw new InputError(`Broadcast "${name}": church "${id}" is not configured.`);
      churches.push(church);
    }
    const week = weekDate(churches[0], this.service.now());
    const live = spec.row.greetingWeek === week && churches.every(c => spec.type === 'post' ? c.activeMessageId && c.activeWeekDate === week : c.driverAskMessageId && c.driverAskWeek === week);
    if (live) return 'SKIPPED';
    const channelId = spec.type === 'post' ? churches[0].weeklyPostChannelId : churches[0].driverAskChannelId;
    const lines = await this.runBroadcast(churches[0].discordGuildId, channelId, name);
    if (lines.some(line => line.includes(': FAILED'))) throw new InputError(lines.filter(line => line.includes(': FAILED')).join(' '));
    return 'OK';
  }
}
