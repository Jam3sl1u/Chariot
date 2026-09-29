import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discordFixture, fixture, register } from './fixtures.js';

function drivers(f: ReturnType<typeof fixture>) {
  for (const id of ['a', 'b']) f.db.data.Drivers.push({ driverId: `driver-${id}`, churchId: id, name: 'Driver', discordId: 'person', memberId: '', seatsAvailable: '3', homeZone: `Zone ${id}`, isAvailableThisWeek: 'true', isActive: 'true', availabilityWeek: '2026-09-20', askedWeek: '', askMessageId: '', respondedWeek: '' });
}
test('Thursday posts one driver ask per church, resets availability, and does not repeat that week', async () => {
  const f = fixture(); drivers(f); const d = discordFixture(f);
  await d.bot.tick();
  assert.equal(d.channels.get('drivers-a')!.sent.length, 1); assert.equal(d.channels.get('drivers-b')!.sent.length, 1);
  assert.ok(f.db.data.Drivers.every(row => row.isAvailableThisWeek === 'false' && row.askedWeek === ''));
  assert.ok(f.db.data.Churches.every(row => row.driverAskWeek === '2026-09-27' && row.driverAskMessageId));
  await d.bot.tick(); assert.equal(d.channels.get('drivers-a')!.sent.length, 1);
  f.setNow('2026-10-01T12:00:00'); await d.bot.tick();
  assert.equal(d.channels.get('drivers-a')!.sent.length, 2); assert.ok(f.db.data.Drivers.every(row => row.availabilityWeek === '2026-10-04'));
});
test('startup preserves weekly post and availability-reset state, then waits for admin commands', async () => {
  const f = fixture(); const d = discordFixture(f);
  for (const church of f.db.data.Churches) church.availabilityResetWeek = '2026-09-27';
  await (d.bot as unknown as { ready: () => Promise<void> }).ready();
  for (const church of f.db.data.Churches) {
    assert.equal(church.activeMessageId, `post-${church.churchId}`);
    assert.equal(church.activeWeekDate, '2026-09-27');
    assert.equal(church.availabilityResetWeek, '2026-09-27');
  }
  assert.equal(d.dms.length, 0);
});
test('shared driver channel reactions stay isolated to the church post and removal opts out', async () => {
  const f = fixture(); f.b.discordGuildId = 'guild-a'; f.b.driverAskChannelId = 'drivers-a'; drivers(f); const d = discordFixture(f); await d.bot.tick();
  const channel = d.channels.get('drivers-a')!;
  assert.equal(channel.sent.length, 2);
  const askA = f.db.data.Churches.find(c => c.churchId === 'a')!.driverAskMessageId;
  const askB = f.db.data.Churches.find(c => c.churchId === 'b')!.driverAskMessageId;
  await d.sendReaction('person', 'guild-a', 'drivers-a', askA, '🚙');
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'true'); assert.equal(f.db.data.Drivers[1].isAvailableThisWeek, 'false');
  await d.sendReaction('person', 'guild-a', 'drivers-a', askB, '👍');
  assert.equal(f.db.data.Drivers[1].isAvailableThisWeek, 'true');
  await d.sendReaction('person', 'guild-a', 'drivers-a', askA, '🚙', false);
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'false');
});
test('driver post reaction rejects non-drivers and old weeks', async () => {
  const f = fixture(); drivers(f); const d = discordFixture(f); await d.bot.tick();
  const ask = f.db.data.Churches.find(c => c.churchId === 'a')!.driverAskMessageId;
  await d.sendReaction('intruder', 'guild-a', 'drivers-a', ask);
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'false');
  f.setNow('2026-09-28T00:01:00'); await d.sendReaction('person', 'guild-a', 'drivers-a', ask);
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'false');
});
test('a driver who does not opt in remains a passenger', async () => {
  const f = fixture(); drivers(f); await register(f); const d = discordFixture(f); await d.bot.tick();
  await f.service.run('guild-a', c => f.service.reaction(c, 'person', 'post-a', true));
  assert.equal(f.db.data.RideRequests[0].status, 'PENDING');
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'false');
});
test('volunteer driver registration grants the configured Drivers role', async () => {
  const f = fixture(); const d = discordFixture(f);
  await (d.bot as unknown as { grantDriverRole: (church: typeof f.a, userId: string) => Promise<void> }).grantDriverRole(f.a, 'person');
  assert.deepEqual(d.roleGrants, [{ user: 'person', role: 'drivers-role-a' }]);
});
test('reconciliation restores any offline reaction and removes absent riders', async () => {
  const f = fixture(); await register(f); await register(f, 'guild-a', 'absent'); const d = discordFixture(f);
  await f.service.run('guild-a', c => f.service.reaction(c, 'absent', 'post-a', true));
  const post = d.channels.get('channel-a')!.history.get('post-a')!;
  post.setUsers('🚙', ['person']);
  await f.service.run('guild-a', c => d.bot.reconcile(c));
  assert.equal(f.db.data.RideRequests[0].status, 'CANCELLED');
  assert.equal(f.db.data.RideRequests[1].status, 'PENDING'); assert.equal(d.dms.length, 0);
});
test('manual posting creates a fresh post after startup state is cleared', async () => {
  const f = fixture(); const d = discordFixture(f); f.a.activeMessageId = ''; f.a.activeWeekDate = '';
  await f.service.run('guild-a', c => d.bot.post(c));
  const channel = d.channels.get('channel-a')!;
  assert.equal(channel.sent.length, 1); assert.equal(channel.sent[0].reactions.cache.size, 0);
  assert.equal(f.db.data.Churches[0].activeMessageId, channel.sent[0].id);
  f.db.data.Churches[0].activeMessageId = ''; f.db.data.Churches[0].activeWeekDate = '';
  await f.service.run('guild-a', c => d.bot.post(c));
  assert.equal(channel.sent.length, 2); assert.equal(f.db.data.Churches[0].activeMessageId, channel.sent[1].id);
});
test('manual sync clears a missing active weekly post', async () => {
  const f = fixture(); const d = discordFixture(f);
  f.a.activeMessageId = 'deleted-post';
  await f.service.runChurch('a', c => d.bot.reconcile(c));
  assert.equal(f.db.data.Churches[0].activeMessageId, ''); assert.equal(f.db.data.Churches[0].activeWeekDate, '');
});
test('an unregistered reaction starts one shared survey, creates a pending profile, and requests a ride', async () => {
  const f = fixture();
  f.b.discordGuildId = 'guild-a'; f.b.weeklyPostChannelId = 'channel-a';
  f.a.registrationDmTemplate = 'Welcome to {churchName}! Tap below to register.';
  const d = discordFixture(f);
  const first = await d.sendReaction('new-member', 'guild-a', 'channel-a', 'post-a', '🚙');
  assert.equal(first.removed, false); assert.equal(d.dms.length, 1); assert.equal(d.dms[0].content, 'Welcome to Church a! Tap below to register.');
  assert.equal(f.db.data.Members.length, 1); assert.deepEqual(f.db.data.Members[0], {
    memberId: f.db.data.Members[0].memberId, churchId: 'a', discordId: 'new-member', createdAt: f.db.data.Members[0].createdAt,
    profileStatus: 'PENDING', name: '', phone: '', preferences: '', zone: '', notificationPreference: '',
  }); assert.equal(f.db.data.RideRequests.length, 1); assert.equal(f.db.data.RideRequests[0].status, 'PENDING');
  await f.service.runChurch('a', c => f.service.register(c, 'new-member', { name: 'New Member', phone: '+12025550123', zone: 'Zone a' }));
  assert.equal(f.db.data.Members.length, 1); assert.equal(f.db.data.Members[0].profileStatus, 'COMPLETE');
  const second = await d.sendReaction('new-member', 'guild-a', 'channel-a', 'post-a');
  assert.equal(second.removed, false); assert.equal(f.db.data.RideRequests.length, 1); assert.equal(f.db.data.RideRequests[0].churchId, 'a');
  await d.sendReaction('new-member', 'guild-a', 'channel-a', 'post-b', '🎉');
  assert.equal(d.dms.length, 1); assert.equal(f.db.data.RideRequests.length, 2); assert.equal(f.db.data.RideRequests[1].churchId, 'b');
});
