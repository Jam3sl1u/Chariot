import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discordFixture, fixture } from './fixtures.js';

const WEEK = '2026-09-27';
/** Both churches share one guild and driver channel, as in production. */
function setup() {
  const f = fixture();
  f.b.discordGuildId = 'guild-a'; f.b.weeklyPostChannelId = 'channel-a'; f.b.driverAskChannelId = 'drivers-a';
  const d = discordFixture(f);
  return { f, d };
}
const church = (f: ReturnType<typeof fixture>, id: string) => f.db.data.Churches.find(row => row.churchId === id)!;
const registerRider = (f: ReturnType<typeof fixture>, id: string, user = 'person') =>
  f.service.runChurch(id, c => f.service.register(c, user, { name: 'Test Member', phone: '+12025550123', preferences: '', zone: `Zone ${id}` }));
const driverRow = (id: string, extra: Record<string, string> = {}) => ({ driverId: `driver-${id}`, churchId: id, name: 'Driver', discordId: 'person', memberId: '', seatsAvailable: '5', homeZone: `Zone ${id}`, isAvailableThisWeek: 'false', isActive: 'true', availabilityWeek: '', askedWeek: '', askMessageId: '', respondedWeek: '', ...extra });
const buttons = (components: unknown) => JSON.stringify(components ?? []);

/** Fakes the Discord interaction objects the bot reads, with the replies and modals it produced. */
function interactions(d: ReturnType<typeof discordFixture>) {
  const shown: { custom_id: string }[] = []; const replies: unknown[] = [];
  const run = (i: object) => (d.bot as unknown as { interaction: (i: unknown) => Promise<void> }).interaction(i);
  const base = (user: string) => ({
    user: { id: user }, deferred: false, replied: false, deferReply: async function (this: { deferred: boolean }) { this.deferred = true; },
    editReply: async (value: unknown) => { replies.push(value); },
    showModal: async (modal: { toJSON(): { custom_id: string } }) => { shown.push(modal.toJSON()); },
    isChatInputCommand: () => false, isModalSubmit: () => false, isStringSelectMenu: () => false, isButton: () => false,
  });
  const text = () => { const last = replies.at(-1); return typeof last === 'string' ? last : (last as { content: string }).content; };
  const nextId = () => JSON.parse(JSON.stringify(replies.at(-1))).components[0].components[0].custom_id as string;
  return {
    shown, replies, text, nextId,
    button: (user: string, customId: string) => run({ ...base(user), customId, isButton: () => true }),
    modal: (user: string, customId: string, fields: Record<string, string>) => run({ ...base(user), customId, isModalSubmit: () => true, fields: { getTextInputValue: (name: string) => fields[name] ?? '' } }),
    command: (user: string, channelId: string, sub: string, churchId = 'a') => run({ ...base(user), isChatInputCommand: () => true, commandName: 'rides', guildId: 'guild-a', channelId, options: { getString: () => churchId, getSubcommand: () => sub }, memberPermissions: { has: () => true } }),
    select: (user: string, customId: string, value: string) => run({ ...base(user), customId, isStringSelectMenu: () => true, values: [value] }),
  };
}

test('an unregistered person reacting to the driver ask starts driver sign-up and is not made a driver or available', async () => {
  const { f, d } = setup(); await d.bot.tick();
  await d.sendReaction('newbie', 'guild-a', 'drivers-a', church(f, 'a').driverAskMessageId);
  const member = f.db.data.Members.find(row => row.discordId === 'newbie');
  assert.equal(member?.profileStatus, 'PENDING');
  assert.equal(f.db.data.Drivers.length, 0);
  assert.equal(d.dms.length, 1);
  assert.match(d.dms[0].content, /To drive for Church a.*react to the driver post again/);
  assert.match(buttons(d.dms[0].components), /dsurvey:a/);
});

test('driver sign-up creates the Drivers row and role but never availability; re-reacting does', async () => {
  const { f, d } = setup(); await d.bot.tick();
  const ask = church(f, 'a').driverAskMessageId; const ui = interactions(d);
  await d.sendReaction('newbie', 'guild-a', 'drivers-a', ask);
  await ui.button('newbie', 'dsurvey:a');
  assert.equal(ui.shown[0].custom_id, 'driver-form:a');
  await ui.modal('newbie', 'driver-form:a', { name: 'New Driver', phone: '+12025550123', preferences: '', seatsAvailable: '3' });
  await ui.select('newbie', ui.nextId(), '0');
  await ui.select('newbie', ui.nextId(), 'DISCORD_DM');
  assert.match(ui.text(), /Driver sign-up saved for Church a\. React to the driver post again/);
  const [driver] = f.db.data.Drivers;
  assert.equal(f.db.data.Drivers.length, 1);
  assert.deepEqual([driver.churchId, driver.discordId, driver.name, driver.seatsAvailable, driver.homeZone, driver.isActive], ['a', 'newbie', 'New Driver', '3', 'Zone a', 'true']);
  assert.equal(driver.isAvailableThisWeek, 'false', 'registering never makes anyone available');
  assert.equal(f.db.data.Members.find(row => row.discordId === 'newbie')?.profileStatus, 'COMPLETE');
  assert.deepEqual(d.roleGrants, [{ user: 'newbie', role: 'drivers-role-a' }]);
  await d.sendReaction('newbie', 'guild-a', 'drivers-a', ask);
  const after = f.db.data.Drivers[0];
  assert.deepEqual([after.isAvailableThisWeek, after.availabilityWeek, after.respondedWeek], ['true', WEEK, WEEK]);
});

test('a registered rider is asked only for seats; the new row is not available until they react again', async () => {
  const { f, d } = setup(); await d.bot.tick(); await registerRider(f, 'a');
  const ask = church(f, 'a').driverAskMessageId; const ui = interactions(d);
  await d.sendReaction('person', 'guild-a', 'drivers-a', ask);
  assert.match(buttons(d.dms[0].components), /dseats:a/);
  assert.equal(f.db.data.Drivers.length, 0);
  await ui.button('person', 'dseats:a');
  assert.equal(ui.shown[0].custom_id, 'driver-seats:a');
  await ui.modal('person', 'driver-seats:a', { seatsAvailable: '0' });
  assert.match(ui.text(), /whole number of seats from 1 to 20/);
  assert.equal(f.db.data.Drivers.length, 0);
  assert.equal(d.roleGrants.length, 0, 'invalid seats are rejected before any role is granted');
  await ui.modal('person', 'driver-seats:a', { seatsAvailable: '4' });
  assert.match(ui.text(), /You're set up as a driver for Church a/);
  assert.deepEqual(d.roleGrants, [{ user: 'person', role: 'drivers-role-a' }]);
  const [driver] = f.db.data.Drivers;
  assert.deepEqual([driver.seatsAvailable, driver.homeZone, driver.isAvailableThisWeek], ['4', 'Zone a', 'false']);
  await d.sendReaction('person', 'guild-a', 'drivers-a', ask);
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'true');
});

test('someone who already drives for another church is added and available right away, with the same seats and home zone', async () => {
  const { f, d } = setup(); await d.bot.tick(); await registerRider(f, 'b');
  f.db.data.Drivers.push(driverRow('b', { seatsAvailable: '6', homeZone: 'Zone b' }));
  await d.sendReaction('person', 'guild-a', 'drivers-a', church(f, 'a').driverAskMessageId);
  const created = f.db.data.Drivers.find(row => row.churchId === 'a')!;
  assert.deepEqual([created.seatsAvailable, created.homeZone, created.isAvailableThisWeek, created.availabilityWeek], ['6', 'Zone b', 'true', WEEK]);
  assert.equal(d.dms.length, 0, 'no prompt is needed');
  assert.equal(f.db.data.Drivers.find(row => row.churchId === 'b')!.isAvailableThisWeek, 'false', 'the other church is untouched');
  assert.deepEqual(d.roleGrants, [{ user: 'person', role: 'drivers-role-a' }]);
});

test('removing a reaction: non-drivers are ignored silently; an existing driver becomes unavailable', async () => {
  const { f, d } = setup(); await d.bot.tick();
  f.db.data.Drivers.push(driverRow('a', { discordId: 'driver1', isAvailableThisWeek: 'true', availabilityWeek: WEEK, respondedWeek: WEEK }));
  const ask = church(f, 'a').driverAskMessageId;
  await d.sendReaction('stranger', 'guild-a', 'drivers-a', ask, '🚙', false);
  assert.equal(d.dms.length, 0); assert.equal(f.db.data.Members.length, 0);
  await d.sendReaction('driver1', 'guild-a', 'drivers-a', ask, '🚙', false);
  assert.deepEqual([f.db.data.Drivers[0].isAvailableThisWeek, f.db.data.Drivers[0].respondedWeek], ['false', '']);
});

test('a driver an admin turned off is told so, and a duplicate row is an error', async () => {
  const { f, d } = setup(); await d.bot.tick();
  f.db.data.Drivers.push(driverRow('a', { isActive: 'FALSE' }));
  const ask = church(f, 'a').driverAskMessageId;
  await d.sendReaction('person', 'guild-a', 'drivers-a', ask);
  assert.match(d.dms[0].content, /driver access for this church is turned off/);
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'false');
  f.db.data.Drivers[0].isActive = 'true'; f.db.data.Drivers.push(driverRow('a', { driverId: 'dup' }));
  await d.sendReaction('person', 'guild-a', 'drivers-a', ask);
  assert.match(d.dms[1].content, /Duplicate driver rows/);
});

test('once assignments have run, new availability is refused but opting out and already-in drivers still work', async () => {
  const { f, d } = setup(); await d.bot.tick();
  f.db.data.Drivers.push(driverRow('a', { discordId: 'in', isAvailableThisWeek: 'true', availabilityWeek: WEEK, respondedWeek: WEEK }), driverRow('a', { driverId: 'late', discordId: 'late' }));
  church(f, 'a').assignmentCompletedWeek = WEEK;
  const ask = church(f, 'a').driverAskMessageId;
  await d.sendReaction('late', 'guild-a', 'drivers-a', ask);
  assert.match(d.dms[0].content, /Assignments have run for this week/);
  assert.equal(f.db.data.Drivers.find(row => row.driverId === 'late')!.isAvailableThisWeek, 'false');
  await d.sendReaction('newbie', 'guild-a', 'drivers-a', ask);
  assert.match(d.dms[1].content, /Assignments have run for this week/);
  assert.equal(f.db.data.Members.length, 0, 'no sign-up is started either');
  await d.sendReaction('in', 'guild-a', 'drivers-a', ask, '🚙', false);
  assert.equal(f.db.data.Drivers.find(row => row.discordId === 'in')!.isAvailableThisWeek, 'false');
});

test('/rides sync catches up driver reactions without touching hand edits in the Sheet', async () => {
  const { f, d } = setup(); await d.bot.tick();
  f.db.data.Drivers.push(
    driverRow('a', { driverId: 'reacted', discordId: 'reacted' }),
    driverRow('a', { driverId: 'left', discordId: 'left', isAvailableThisWeek: 'true', availabilityWeek: WEEK, respondedWeek: WEEK }),
    driverRow('a', { driverId: 'manual', discordId: 'manual', isAvailableThisWeek: 'true', availabilityWeek: WEEK, respondedWeek: '' }),
  );
  const askId = church(f, 'a').driverAskMessageId;
  (d.channels.get('drivers-a')!.history.get(askId) as unknown as { setUsers: (emoji: string, ids: string[]) => void }).setUsers('🚙', ['reacted']);
  await d.bot.reconcileDrivers(church(f, 'a'));
  const state = Object.fromEntries(f.db.data.Drivers.map(row => [row.driverId, row.isAvailableThisWeek]));
  assert.deepEqual(state, { reacted: 'true', left: 'false', manual: 'true' });
  assert.equal(f.db.data.Drivers.find(row => row.driverId === 'left')!.respondedWeek, '');
});

test('sync clears a driver ask whose message was deleted so it can be posted again', async () => {
  const { f, d } = setup(); await d.bot.tick();
  const channel = d.channels.get('drivers-a')!;
  channel.history.delete(church(f, 'a').driverAskMessageId);
  await d.bot.reconcileDrivers(church(f, 'a'));
  assert.equal(church(f, 'a').driverAskMessageId, ''); assert.equal(church(f, 'a').driverAskWeek, '');
});

test('each /rides command only runs in its own channel; sync works from either', async () => {
  const { f, d } = setup(); const ui = interactions(d);
  await ui.command('admin', 'drivers-a', 'sync'); assert.equal(ui.text(), 'Completed.');
  await ui.command('admin', 'channel-a', 'sync'); assert.equal(ui.text(), 'Completed.');
  await ui.command('admin', 'random', 'sync'); assert.match(ui.text(), /rides channel \(weeklyPostChannelId\) or the driver channel \(driverAskChannelId\)/);
  await ui.command('admin', 'channel-a', 'ask-drivers'); assert.match(ui.text(), /in the driver channel \(driverAskChannelId\)/);
  await ui.command('admin', 'drivers-a', 'post'); assert.match(ui.text(), /shared rides channel \(weeklyPostChannelId\)/);
  assert.equal(d.channels.get('drivers-a')!.sent.length, 0);
  await ui.command('admin', 'drivers-a', 'ask-drivers'); assert.equal(ui.text(), 'Completed.');
  assert.equal(d.channels.get('drivers-a')!.sent.length, 1);
  assert.ok(church(f, 'a').driverAskMessageId);
});
