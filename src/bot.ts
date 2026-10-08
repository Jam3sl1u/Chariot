import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, Events, GatewayIntentBits,
  MessageFlags, ModalBuilder, Partials, PermissionFlagsBits, SlashCommandBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type Interaction, type Message, type MessageReaction, type PartialMessageReaction,
  type User, type PartialUser,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import { columns, type Row, type Tab } from './sheets.js';
import { Service, InputError, truth, validPhone } from './service.js';
import { broadcastProblems, parseBroadcast, tail } from './broadcast.js';
import { localTime, weekDate, weeklyDue } from './time.js';

export const commands = [
  new SlashCommandBuilder().setName('register').setDescription('Learn how to register for church rides'),
  new SlashCommandBuilder().setName('rides').setDescription('Manage church rides')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('post').setDescription('Post the current weekly ride request').addStringOption(o => o.setName('church').setDescription('Church ID').setRequired(true)))
    .addSubcommand(s => s.setName('sync').setDescription('Reconcile reactions on the current post').addStringOption(o => o.setName('church').setDescription('Church ID').setRequired(true)))
    .addSubcommand(s => s.setName('ask-drivers').setDescription('Ask drivers who have not replied this week').addStringOption(o => o.setName('church').setDescription('Church ID').setRequired(true)))
    .addSubcommand(s => s.setName('broadcast').setDescription('Post a greeting and one message per church from the Broadcasts tab').addStringOption(o => o.setName('name').setDescription('Broadcast ID').setRequired(true))),
].map(c => c.toJSON());

type Registration = { churchId: string; userId: string; expires: number; data: Row; zones: string[]; kind: 'rider' | 'driver' };
/** rider = full ride registration; driver = registration plus driver sign-up; seats = already registered, only needs seats. */
type Survey = { churchId: string; userId: string; expires: number; kind: 'rider' | 'driver' | 'seats' };
const surveyButtons = { survey: 'rider', dsurvey: 'driver', dseats: 'seats' } as const;
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
  private registrations = new Map<string, Registration>();
  private surveys = new Map<string, Survey>();
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
  private async grantDriverRole(church: Row, userId: string) {
    if (!church.driverRoleId?.trim()) throw new InputError('Set driverRoleId in Churches before allowing driver registration.');
    const guild = await this.client.guilds.fetch(church.discordGuildId);
    const member = await guild.members.fetch(userId);
    await member.roles.add(church.driverRoleId);
  }
  private async removeDriverRole(church: Row, userId: string) {
    if (!church.driverRoleId?.trim()) return;
    try {
      const guild = await this.client.guilds.fetch(church.discordGuildId);
      const member = await guild.members.fetch(userId);
      await member.roles.remove(church.driverRoleId);
    } catch { /* Preserve the original registration error. */ }
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
    console.log('Chariot is ready. Manual mode: use /rides commands to post, sync, or ask drivers.');
  }

  private modal(churchId: string) {
    const field = (id: string, label: string, required: boolean, max: number, style = TextInputStyle.Short) => new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max));
    return new ModalBuilder().setCustomId(`register-form:${churchId}`).setTitle('Register for church rides').addComponents(
      field('name', 'Full name', true, 100), field('phone', 'US phone (+12025550123)', true, 12), field('preferences', 'Ride preferences (optional)', false, 1000, TextInputStyle.Paragraph),
      field('isDriver', 'Volunteer as a driver? (YES or NO)', true, 3), field('seatsAvailable', 'Seats you can offer (drivers only)', false, 2),
    );
  }
  private field(id: string, label: string, required: boolean, max: number, style = TextInputStyle.Short) {
    return new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max));
  }
  private driverModal(churchId: string) {
    return new ModalBuilder().setCustomId(`driver-form:${churchId}`).setTitle('Sign up as a driver').addComponents(
      this.field('name', 'Full name', true, 100), this.field('phone', 'US phone (+12025550123)', true, 12), this.field('preferences', 'Preferences (optional)', false, 1000, TextInputStyle.Paragraph),
      this.field('seatsAvailable', 'Seats you can offer (1-20)', true, 2),
    );
  }
  private seatsModal(churchId: string) {
    return new ModalBuilder().setCustomId(`driver-seats:${churchId}`).setTitle('How many seats can you offer?').addComponents(this.field('seatsAvailable', 'Seats you can offer (1-20)', true, 2));
  }
  private surveyKey(userId: string) { return userId; }
  private async startSurvey(church: Row, userId: string, kind: Survey['kind'] = 'rider', message?: string) {
    const key = this.surveyKey(userId);
    const current = this.surveys.get(key);
    // Keep an unexpired prompt of the same kind (any church for riders, since registration is shared).
    if (current && current.expires >= Date.now() && current.kind === kind && (kind === 'rider' || current.churchId === church.churchId)) return;
    this.surveys.set(key, { churchId: church.churchId, userId, expires: Date.now() + 15 * 60_000, kind });
    try {
      const name = church.churchName;
      const [content, customId, label] = kind === 'rider'
        ? [(church.registrationDmTemplate?.trim() || `[${name}] Complete your registration survey before requesting a ride.`).replaceAll('{churchName}', name), `survey:${church.churchId}`, 'Start registration']
        : kind === 'driver'
          ? [message ?? `[${name}] To drive for ${name}, complete this quick sign-up. Signing up doesn't mark you available: afterwards, react to the driver post again to confirm you're driving this week.`, `dsurvey:${church.churchId}`, 'Start driver sign-up']
          : [message ?? `[${name}] To drive for ${name}, tell us how many seats you can offer. Afterwards, react to the driver post again to confirm you're driving this week.`, `dseats:${church.churchId}`, 'Set my seats'];
      await this.dm(userId, content, [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Primary))]);
    } catch {
      this.surveys.delete(key);
    }
  }
  /** Grants the Drivers role, runs the write, and takes the role back if the write fails. */
  private async withDriverRole<T>(church: Row, userId: string, work: () => Promise<T>) {
    await this.grantDriverRole(church, userId);
    try { return await work(); }
    catch (error) { await this.removeDriverRole(church, userId); throw error; }
  }
  /** Applies a reaction on the driver ask, starting the right sign-up prompt when the person is not a driver yet. */
  private async driverReactionFlow(church: Row, userId: string, messageId: string, added: boolean) {
    const result = await this.service.driverReaction(church, userId, messageId, added);
    if (result.status === 'register') {
      await this.service.beginRegistration(church, userId);
      await this.service.setCanDrive(church, userId, true);
      await this.startSurvey(church, userId, 'driver');
    } else if (result.status === 'seats') {
      await this.startSurvey(church, userId, 'seats');
    } else if (result.status === 'applied' && result.unconfirmed) {
      // Available on placeholder seats: say so, and ask them to confirm the real number.
      await this.startSurvey(church, userId, 'seats', `[${church.churchName}] You're marked available as a driver this week. Please confirm how many seats you can offer so we can plan rides:`);
    } else if (result.status === 'copy') {
      // Already drives for another church: their reaction here is the opt-in, so they are available now.
      if (church.driverRoleId?.trim()) await this.grantDriverRole(church, userId);
      await this.service.addDriver(church, userId, { seats: Number(result.source.seatsAvailable), homeZone: result.source.homeZone, available: true });
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
      if (i.isButton() && i.customId.split(':')[0] in surveyButtons) {
        const [prefix, churchId] = i.customId.split(':');
        const kind = surveyButtons[prefix as keyof typeof surveyButtons];
        const survey = this.surveys.get(this.surveyKey(i.user.id));
        if (!survey || survey.kind !== kind || survey.churchId !== churchId || survey.expires < Date.now()) throw new InputError('Your sign-up link expired. React to the post again to start over.');
        await i.showModal(kind === 'rider' ? this.modal(churchId) : kind === 'driver' ? this.driverModal(churchId) : this.seatsModal(churchId)); return;
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (i.isChatInputCommand() && i.commandName === 'rides' && i.options.getSubcommand() === 'broadcast') {
        if (!i.guildId || !i.channelId) throw new InputError('Use this command in the shared rides channel.');
        if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new InputError('Manage Server permission is required.');
        await i.editReply((await this.runBroadcast(i.guildId, i.channelId, i.options.getString('name', true))).join('\n'));
        return;
      }
      let churchId: string | undefined;
      if (i.isChatInputCommand()) {
        if (!i.guildId || !i.channelId) throw new InputError('Use this command in the shared rides channel.');
        churchId = i.options.getString('church', true);
      } else if (i.isModalSubmit()) {
        const [kind, id] = i.customId.split(':');
        if (!['register-form', 'driver-form', 'driver-seats'].includes(kind) || !id) throw new InputError('Invalid sign-up form. React to the post again.');
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
        for (const [key, value] of this.registrations) if (value.expires < Date.now()) this.registrations.delete(key);
        for (const [key, value] of this.surveys) if (value.expires < Date.now()) this.surveys.delete(key);
        if (i.isModalSubmit() && i.customId.startsWith('driver-seats:')) {
          const survey = this.surveys.get(this.surveyKey(i.user.id));
          if (!survey || survey.kind !== 'seats' || survey.churchId !== church.churchId || survey.expires < Date.now()) throw new InputError('Your sign-up expired. React to the driver post again.');
          const seats = parseSeats(i.fields.getTextInputValue('seatsAvailable'));
          await this.withDriverRole(church, i.user.id, () => this.service.addDriver(church, i.user.id, { seats }));
          this.surveys.delete(this.surveyKey(i.user.id));
          await i.editReply(`You're set up as a driver for ${church.churchName}. React to the driver post again to confirm you're driving this week.`); return;
        }
        if (i.isModalSubmit() && (i.customId.startsWith('register-form:') || i.customId.startsWith('driver-form:'))) {
          const driverForm = i.customId.startsWith('driver-form:');
          if (driverForm) {
            const survey = this.surveys.get(this.surveyKey(i.user.id));
            if (!survey || survey.kind !== 'driver' || survey.churchId !== church.churchId || survey.expires < Date.now()) throw new InputError('Your sign-up expired. React to the driver post again.');
          }
          const driverAnswer = driverForm ? 'YES' : i.fields.getTextInputValue('isDriver').trim().toUpperCase();
          const data = { name: i.fields.getTextInputValue('name').trim(), phone: i.fields.getTextInputValue('phone').trim(), preferences: i.fields.getTextInputValue('preferences').trim(), isDriver: String(driverAnswer === 'YES'), seatsAvailable: i.fields.getTextInputValue('seatsAvailable').trim() };
          if (!data.name || !validPhone(data.phone)) throw new InputError('Enter your name and a valid US E.164 phone (+12025550123). Run /register again.');
          if (driverAnswer !== 'YES' && driverAnswer !== 'NO') throw new InputError('Answer YES or NO for whether you want to volunteer as a driver.');
          if (data.isDriver === 'true' && (!/^\d+$/.test(data.seatsAvailable) || Number(data.seatsAvailable) < 1 || Number(data.seatsAvailable) > 20)) throw new InputError('Volunteer drivers must enter a whole number of seats from 1 to 20.');
          const zones = (await this.service.rows('Zones', church)).sort((a, b) => Number(a.zonePriorityOrder) - Number(b.zonePriorityOrder)).map(z => z.zoneName).filter(z => z && z !== 'Other / Not Listed');
          const id = randomUUID();
          const session: Registration = { churchId: church.churchId, userId: i.user.id, expires: Date.now() + 15 * 60_000, data, zones: [...new Set(zones)], kind: driverForm ? 'driver' : 'rider' };
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
        } else if (action === 'finish' && i.isStringSelectMenu() && session.data.zone && session.kind === 'driver') {
          // Profile first (never as a volunteer, whose driver row would land in the profile's own church),
          // then this church's Drivers row. Registering never marks anyone available.
          await this.withDriverRole(church, i.user.id, async () => {
            await this.service.register(church, i.user.id, { ...session.data, isDriver: 'false' });
            await this.service.addDriver(church, i.user.id, { seats: Number(session.data.seatsAvailable) });
          });
          this.registrations.delete(id);
          this.surveys.delete(this.surveyKey(i.user.id));
          await i.editReply(`Driver sign-up saved for ${church.churchName}. React to the driver post again to confirm you're driving this week.`);
        } else if (action === 'finish' && i.isStringSelectMenu() && session.data.zone) {
          const volunteering = session.data.isDriver === 'true';
          if (volunteering) await this.grantDriverRole(church, i.user.id);
          try { await this.service.register(church, i.user.id, session.data); }
          catch (error) { if (volunteering) await this.removeDriverRole(church, i.user.id); throw error; }
          this.registrations.delete(id);
          this.surveys.delete(this.surveyKey(i.user.id));
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
    let onDriverAsk = false;
    try {
      if (reaction.partial) await reaction.fetch();
      const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
      if (!message.guildId || message.author?.id !== this.client.user?.id) return;
      let handled = false;
      await this.service.runMessage(message.guildId, message.id, async church => {
        handled = true;
        if (message.channelId !== church.weeklyPostChannelId) return;
        if (added && !await this.service.member(church, user.id)) {
          await this.service.beginRegistration(church, user.id);
          await this.startSurvey(church, user.id);
        }
        await this.service.reaction(church, user.id, message.id, added);
      });
      if (handled) return;
      await this.service.runDriverAskMessage(message.guildId, message.id, async church => {
        if (message.channelId !== church.driverAskChannelId) return;
        onDriverAsk = true;
        await this.isMember(church, user.id);
        await this.driverReactionFlow(church, user.id, message.id, added);
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
    const message = await channel.send({ content: church.weeklyMessageTemplate, allowedMentions: { parse: [] } });
    try { await this.service.patch('Churches', church, {}, { activeMessageId: message.id, activeWeekDate: week }); }
    catch (error) { await this.deleteOwned(channel, message.id); throw error; } // never leave a live-looking post the Sheet doesn't know about
    if (!current) return { replaced: false, removed: true, cleared: 0 };
    const removed = await this.deleteOwned(channel, church.activeMessageId);
    return { replaced: true, removed, cleared: await this.service.cancelWeekRequests(church, week) };
  }
  /** Everyone (not bots) who reacted with any emoji, paging past 100 reactors. */
  private async reactors(message: Message) {
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
    for (const userId of reactors) {
      if (inNow(drivers.find(driver => driver.discordId === userId))) continue;
      try { await this.driverReactionFlow(church, userId, message.id, true); }
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
    for (const userId of reactors) {
      try {
        if (!await this.service.member(church, userId)) {
          await this.service.beginRegistration(church, userId);
          await this.startSurvey(church, userId);
        }
        await this.service.reaction(church, userId, message.id, true);
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
    const message = await channel.send({ content: church.driverAskMessageTemplate.replaceAll('{churchName}', church.churchName).replaceAll('{weekDate}', week), allowedMentions: { parse: [] } });
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
