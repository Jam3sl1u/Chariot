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
  const shown: { custom_id: string; components: unknown[] }[] = []; const replies: unknown[] = [];
  const run = (i: object) => (d.bot as unknown as { interaction: (i: unknown) => Promise<void> }).interaction(i);
  const base = (user: string) => ({
    user: { id: user, username: `${user}-name` }, deferred: false, replied: false, deferReply: async function (this: { deferred: boolean }) { this.deferred = true; },
    editReply: async (value: unknown) => { replies.push(value); }, reply: async (value: unknown) => { replies.push(value); },
    showModal: async (modal: { toJSON(): { custom_id: string; components: unknown[] } }) => { shown.push(modal.toJSON()); },
    isChatInputCommand: () => false, isModalSubmit: () => false, isStringSelectMenu: () => false, isButton: () => false,
  });
  const text = () => { const last = replies.at(-1); return typeof last === 'string' ? last : (last as { content: string }).content; };
  return {
    shown, replies, text,
    button: (user: string, customId: string) => run({ ...base(user), customId, isButton: () => true }),
    /** `zone` is the dropdown answer; every other key is a text field. */
    modal: (user: string, customId: string, fields: Record<string, string>) => run({ ...base(user), customId, isModalSubmit: () => true, fields: { getTextInputValue: (name: string) => fields[name] ?? '', getStringSelectValues: (name: string) => name === 'zone' && fields.zone ? [fields.zone] : [] } }),
    command: (user: string, channelId: string, sub: string, churchId = 'a') => run({ ...base(user), isChatInputCommand: () => true, commandName: 'rides', guildId: 'guild-a', channelId, options: { getString: () => churchId, getSubcommand: () => sub }, memberPermissions: { has: () => true } }),
  };
}

test('an unregistered person reacting to the driver ask is available at once as a PENDING placeholder, and is asked to finish sign-up', async () => {
  const { f, d } = setup(); await d.bot.tick();
  await d.sendReaction('newbie', 'guild-a', 'drivers-a', church(f, 'a').driverAskMessageId);
  const member = f.db.data.Members.find(row => row.discordId === 'newbie');
  assert.deepEqual([member?.profileStatus, member?.canDrive, member?.discordUsername], ['PENDING', 'true', 'newbie-name']);
  assert.equal(f.db.data.Drivers.length, 1);
  const placeholder = f.db.data.Drivers[0];
  assert.deepEqual([placeholder.churchId, placeholder.discordId, placeholder.discordUsername, placeholder.seatsAvailable, placeholder.isActive, placeholder.isAvailableThisWeek, placeholder.availabilityWeek, placeholder.signupStatus, placeholder.name, placeholder.homeZone], ['a', 'newbie', 'newbie-name', '4', 'true', 'true', WEEK, 'PENDING', '', '']);
  assert.equal(d.dms.length, 1);
  assert.match(d.dms[0].content, /marked available.*Finish your sign-up/);
  assert.match(buttons(d.dms[0].components), /register:a:drivers/);
});

test('the driver form completes the placeholder in one step without changing availability', async () => {
  const { f, d } = setup(); await d.bot.tick();
  const ask = church(f, 'a').driverAskMessageId; const ui = interactions(d);
  await d.sendReaction('newbie', 'guild-a', 'drivers-a', ask);
  await ui.button('newbie', 'register:a:drivers');
  assert.equal(ui.shown[0].custom_id, 'register-form:a:drivers');
  assert.equal(ui.shown[0].components.length, 5, 'name, phone, preferences, seats and location are all in the one form');
  assert.match(JSON.stringify(ui.shown[0].components), /"custom_id":"zone".*Zone a.*Zone b.*Other \/ Not Listed/);
  await ui.modal('newbie', 'register-form:a:drivers', { name: 'New Driver', phone: '(949) 555-1234', zone: 'Zone a' });
  assert.match(ui.text(), /Enter how many seats/);
  await ui.modal('newbie', 'register-form:a:drivers', { name: ' ', phone: '1', seatsAvailable: '3', zone: 'Zone a' });
  assert.match(ui.text(), /name and a phone number/);
  await ui.modal('newbie', 'register-form:a:drivers', { name: 'New Driver', phone: '(949) 555-1234', seatsAvailable: '21', zone: 'Zone a' });
  assert.match(ui.text(), /whole number of seats from 1 to 20/);
  assert.equal(f.db.data.Drivers[0].signupStatus, 'PENDING', 'rejected submissions write nothing');
  await ui.modal('newbie', 'register-form:a:drivers', { name: 'New Driver', phone: '(949) 555-1234', seatsAvailable: '3', zone: 'Zone a' });
  assert.match(ui.text(), /Driver sign-up saved for Church a\. React to the current driver post/);
  assert.equal(f.db.data.Drivers.length, 1, 'the placeholder is updated, not duplicated');
  const [driver] = f.db.data.Drivers;
  assert.deepEqual([driver.name, driver.seatsAvailable, driver.homeZone, driver.signupStatus, driver.isAvailableThisWeek, driver.availabilityWeek, driver.discordUsername], ['New Driver', '3', 'Zone a', 'COMPLETE', 'true', WEEK, 'newbie-name'] /* the earlier reaction, not the form, made them available */);
  const member = f.db.data.Members.find(row => row.discordId === 'newbie')!;
  assert.deepEqual([member.profileStatus, member.canDrive, member.phone, member.discordUsername], ['COMPLETE', 'true', '(949) 555-1234', 'newbie-name']);
});

test('a driver form from an old post cannot opt anyone into the current week', async () => {
  const { f, d } = setup(); await d.bot.tick(); await registerRider(f, 'a'); const ui = interactions(d);
  await ui.modal('person', 'driver-seats:a', { seatsAvailable: '3' });
  assert.match(ui.text(), /React to the current driver post/);
  assert.deepEqual([f.db.data.Drivers[0].signupStatus, f.db.data.Drivers[0].isAvailableThisWeek], ['COMPLETE', 'false']);
  await ui.modal('newcomer', 'register-form:a:drivers', { name: 'New', phone: '555', seatsAvailable: '2', zone: 'Zone a' });
  assert.equal(f.db.data.Drivers.find(row => row.discordId === 'newcomer')!.isAvailableThisWeek, 'false');
});

test('a registered rider who reacts to the driver ask is available at once and only asked for seats', async () => {
  const { f, d } = setup(); await d.bot.tick(); await registerRider(f, 'a');
  const ask = church(f, 'a').driverAskMessageId; const ui = interactions(d);
  await d.sendReaction('person', 'guild-a', 'drivers-a', ask);
  assert.match(buttons(d.dms[0].components), /register:a:drivers.*Set my seats|Set my seats.*register:a:drivers/);
  const placeholder = f.db.data.Drivers[0];
  assert.deepEqual([f.db.data.Drivers.length, placeholder.seatsAvailable, placeholder.homeZone, placeholder.name, placeholder.signupStatus, placeholder.isAvailableThisWeek], [1, '4', 'Zone a', 'Test Member', 'PENDING', 'true']);
  assert.ok(placeholder.memberId);
  await ui.button('person', 'register:a:drivers');
  assert.equal(ui.shown[0].custom_id, 'driver-seats:a', 'a registered member is not shown the whole form');
  await ui.modal('person', 'driver-seats:a', { seatsAvailable: '0' });
  assert.match(ui.text(), /whole number of seats from 1 to 20/);
  assert.equal(f.db.data.Drivers[0].seatsAvailable, '4');
  await ui.modal('person', 'driver-seats:a', { seatsAvailable: '5' });
  assert.match(ui.text(), /You're set up as a driver for Church a/);
  const [driver] = f.db.data.Drivers;
  assert.equal(f.db.data.Drivers.length, 1);
  assert.deepEqual([driver.seatsAvailable, driver.homeZone, driver.isAvailableThisWeek, driver.signupStatus], ['5', 'Zone a', 'true', 'COMPLETE'], 'still available from the earlier reaction');
  assert.equal(f.db.data.Members.find(row => row.discordId === 'person')?.canDrive, 'true');
});

test('the Register button on the rides post opens the full form; the rider path writes no Drivers row', async () => {
  const { f, d } = setup(); const ui = interactions(d);
  await ui.button('walkup', 'register:a:rides');
  assert.equal(ui.shown[0].custom_id, 'register-form:a:rides');
  assert.equal(f.db.data.Members.length, 0, 'opening the form writes nothing');
  await ui.modal('walkup', 'register-form:a:rides', { name: 'Walk Up', phone: 'call me', preferences: 'front seat', zone: 'Other / Not Listed' });
  assert.match(ui.text(), /Registration saved for Church a\. React to the weekly post/);
  const [member] = f.db.data.Members;
  assert.deepEqual([member.name, member.phone, member.zone, member.preferences, member.profileStatus, member.canDrive, member.discordUsername], ['Walk Up', 'call me', 'Other / Not Listed', 'front seat', 'COMPLETE', 'false', 'walkup-name']);
  assert.equal(f.db.data.Drivers.length, 0);
  await ui.button('walkup', 'register:a:rides');
  assert.match(ui.text(), /already registered/);
  assert.equal(ui.shown.length, 1);
});

test('seats typed into the rides form sign the person up as a driver, but not available until they react', async () => {
  const { f, d } = setup(); const ui = interactions(d);
  await ui.modal('both', 'register-form:a:rides', { name: 'Both', phone: '555', seatsAvailable: '2', zone: 'Zone a' });
  assert.match(ui.text(), /signed up as a driver/);
  const [driver] = f.db.data.Drivers;
  assert.deepEqual([driver.signupStatus, driver.seatsAvailable, driver.isAvailableThisWeek, driver.discordUsername], ['COMPLETE', '2', 'false', 'both-name']);
  assert.equal(f.db.data.Members[0].canDrive, 'true');
});

test('the weekly post and the driver ask each carry a Register button', async () => {
  const { f, d } = setup(); await d.bot.tick();
  await f.service.runChurch('a', c => d.bot.post(c, true));
  const sentButtons = (channel: string) => d.channels.get(channel)!.sent.map(message => buttons((message as unknown as { components: unknown }).components)).join();
  assert.match(sentButtons('channel-a'), /register:a:rides/);
  assert.match(sentButtons('drivers-a'), /register:a:drivers/);
  assert.match(sentButtons('drivers-a'), /register:b:drivers/, 'every church gets its own button');
});

test('someone who already drives for another church is added and available right away, with the same seats and home zone', async () => {
  const { f, d } = setup(); await d.bot.tick(); await registerRider(f, 'b');
  f.db.data.Drivers.push(driverRow('b', { seatsAvailable: '6', homeZone: 'Zone b' }));
  await d.sendReaction('person', 'guild-a', 'drivers-a', church(f, 'a').driverAskMessageId);
  const created = f.db.data.Drivers.find(row => row.churchId === 'a')!;
  assert.deepEqual([created.seatsAvailable, created.homeZone, created.isAvailableThisWeek, created.availabilityWeek], ['6', 'Zone b', 'true', WEEK]);
  assert.equal(d.dms.length, 0, 'no prompt is needed');
  assert.equal(f.db.data.Drivers.find(row => row.churchId === 'b')!.isAvailableThisWeek, 'false', 'the other church is untouched');
  assert.equal(created.signupStatus, 'COMPLETE');
  assert.equal(f.db.data.Members.find(row => row.churchId === 'a' && row.discordId === 'person')?.canDrive, 'true');
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

test('reacting again on a placeholder does not duplicate it or re-send the prompt', async () => {
  const { f, d } = setup(); await d.bot.tick(); await registerRider(f, 'a');
  const ask = church(f, 'a').driverAskMessageId;
  for (const user of ['person', 'newbie']) { await d.sendReaction(user, 'guild-a', 'drivers-a', ask); await d.sendReaction(user, 'guild-a', 'drivers-a', ask); }
  for (const user of ['person', 'newbie']) {
    const rows = f.db.data.Drivers.filter(driver => driver.discordId === user);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].isAvailableThisWeek, rows[0].seatsAvailable, rows[0].signupStatus], ['true', '4', 'PENDING']);
  }
  assert.equal(d.dms.length, 2, 'one prompt each: the second reaction is inside the 15-minute window');
  await d.sendReaction('newbie', 'guild-a', 'drivers-a', ask, '🚙', false);
  assert.equal(f.db.data.Drivers.find(driver => driver.discordId === 'newbie')!.isAvailableThisWeek, 'false', 'removing the reaction opts out');
});

test('sync gives reactors who are not drivers yet a placeholder row, availability and a sign-up prompt', async () => {
  const { f, d } = setup(); await d.bot.tick(); await registerRider(f, 'a', 'rider');
  const askId = church(f, 'a').driverAskMessageId;
  (d.channels.get('drivers-a')!.history.get(askId) as unknown as { setUsers: (emoji: string, ids: string[]) => void }).setUsers('🚙', ['rider', 'stranger']);
  await d.bot.reconcileDrivers(church(f, 'a'));
  const byUser = Object.fromEntries(f.db.data.Drivers.map(row => [row.discordId, row]));
  assert.deepEqual([byUser.rider?.signupStatus, byUser.rider?.seatsAvailable, byUser.rider?.homeZone, byUser.rider?.isAvailableThisWeek], ['PENDING', '4', 'Zone a', 'true']);
  assert.deepEqual([byUser.stranger?.signupStatus, byUser.stranger?.seatsAvailable, byUser.stranger?.isAvailableThisWeek], ['PENDING', '4', 'true']);
  assert.equal(f.db.data.Members.find(row => row.discordId === 'stranger')?.profileStatus, 'PENDING');
  assert.match(buttons(d.dms.find(dm => dm.user === 'rider')?.components), /Set my seats/);
  assert.match(buttons(d.dms.find(dm => dm.user === 'stranger')?.components), /Start driver sign-up/);
});

test('the canDrive flag follows the registration answer, and copies to another church\'s member row', async () => {
  const { f } = setup();
  await f.service.runChurch('a', c => f.service.register(c, 'rider', { name: 'Rider', phone: '+12025550123', preferences: '', zone: 'Zone a', isDriver: 'false' }));
  await f.service.runChurch('a', c => f.service.register(c, 'volunteer', { name: 'Volunteer', phone: '+12025550124', preferences: '', zone: 'Zone a', isDriver: 'true', seatsAvailable: '3' }));
  const flag = (id: string) => f.db.data.Members.find(row => row.discordId === id && row.churchId === 'a')?.canDrive;
  assert.deepEqual([flag('rider'), flag('volunteer')], ['false', 'true']);
  assert.equal(f.db.data.Drivers.find(row => row.discordId === 'volunteer')?.signupStatus, 'COMPLETE');
  await f.service.runChurch('b', c => f.service.request(c, 'volunteer', WEEK));
  assert.equal(f.db.data.Members.find(row => row.discordId === 'volunteer' && row.churchId === 'b')?.canDrive, 'true');
});

test('the sign-up prompt throttle is per church, so a two-church volunteer gets both links', async () => {
  const { f, d } = setup(); await d.bot.tick();
  await d.sendReaction('newbie', 'guild-a', 'drivers-a', church(f, 'a').driverAskMessageId);
  await d.sendReaction('newbie', 'guild-a', 'drivers-a', church(f, 'b').driverAskMessageId);
  assert.equal(d.dms.length, 2);
  assert.match(buttons(d.dms[0].components), /register:a:drivers/);
  assert.match(buttons(d.dms[1].components), /register:b:drivers/);
  await d.sendReaction('newbie', 'guild-a', 'drivers-a', church(f, 'a').driverAskMessageId);
  assert.equal(d.dms.length, 2, 'the same church is still throttled');
});

test('a Register button tapped while the Sheet is slow gets a retry message instead of a dead interaction', async () => {
  const { f, d } = setup(); const ui = interactions(d);
  const read = f.db.read.bind(f.db);
  f.db.read = async (tab: Parameters<typeof read>[0]) => { if (tab === 'Members') await new Promise(resolve => setTimeout(resolve, 3_000)); return read(tab); };
  await ui.button('walkup', 'register:a:rides');
  assert.equal(ui.shown.length, 0);
  assert.match(ui.text(), /busy right now/);
});

test('a ride reaction backfills a legacy member row\'s blank discordUsername once', async () => {
  const { f, d } = setup(); await registerRider(f, 'a');
  assert.equal(f.db.data.Members[0].discordUsername ?? '', '');
  await d.sendReaction('person', 'guild-a', 'channel-a', 'post-a');
  assert.equal(f.db.data.Members[0].discordUsername, 'person-name');
  const before = f.db.writes.filter(w => w.tab === 'Members').length;
  await d.sendReaction('person', 'guild-a', 'channel-a', 'post-a', '✅', false);
  await d.sendReaction('person', 'guild-a', 'channel-a', 'post-a');
  assert.equal(f.db.writes.filter(w => w.tab === 'Members').length, before, 'no further Members writes once filled');
});
