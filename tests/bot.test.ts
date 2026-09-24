import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discordFixture, fixture, register } from './fixtures.js';

function drivers(f: ReturnType<typeof fixture>) {
  for (const id of ['a', 'b']) f.db.data.Drivers.push({ driverId: `driver-${id}`, churchId: id, name: 'Driver', discordId: 'person', memberId: '', seatsAvailable: '3', homeZone: `Zone ${id}`, isAvailableThisWeek: 'true', isActive: 'true', availabilityWeek: '2026-09-20', askedWeek: '', askMessageId: '', respondedWeek: '' });
}
test('Thursday asks reset stale availability, persist context and do not repeat on another tick', async () => {
  const f = fixture(); drivers(f); const d = discordFixture(f);
  await d.bot.tick();
  assert.equal(d.dms.length, 2); assert.ok(f.db.data.Drivers.every(row => row.isAvailableThisWeek === 'false' && row.askedWeek === '2026-09-27'));
  await d.bot.tick(); assert.equal(d.dms.length, 2);
  f.setNow('2026-10-01T12:00:00'); await d.bot.tick();
  assert.equal(d.dms.length, 4); assert.ok(f.db.data.Drivers.every(row => row.availabilityWeek === '2026-10-04'));
});
test('driver with two churches must select a prompt; invalid replies never write', async () => {
  const f = fixture(); drivers(f); const d = discordFixture(f); await d.bot.tick();
  const count = f.db.writes.length;
  await d.sendDM('person', 'YES'); assert.match(d.replies.at(-1)!, /multiple pending/); assert.equal(f.db.writes.length, count);
  await d.sendDM('person', 'maybe', d.dms[0].id); assert.match(d.replies.at(-1)!, /YES or NO only/); assert.equal(f.db.writes.length, count);
  await d.sendDM('person', 'yes', d.dms[0].id);
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'true'); assert.equal(f.db.data.Drivers[1].isAvailableThisWeek, 'false');
  await d.sendDM('person', 'NO', d.dms[0].id);
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'false');
});
test('DM context survives restart and refuses another user or stale week', async () => {
  const f = fixture(); drivers(f); const first = discordFixture(f); await first.bot.tick();
  const restarted = discordFixture(f);
  await restarted.sendDM('intruder', 'YES', first.dms[0].id);
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'false');
  await restarted.sendDM('person', 'YES', first.dms[0].id);
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'true');
  f.setNow('2026-09-28T00:01:00'); const count = f.db.writes.length;
  await restarted.sendDM('person', 'NO', first.dms[0].id); assert.equal(f.db.writes.length, count);
});
test('NO driver remains a passenger; late YES saves availability with manual placement notice', async () => {
  const f = fixture(); drivers(f); await register(f); const d = discordFixture(f); await d.bot.tick();
  await f.service.run('guild-a', c => f.service.reaction(c, 'person', 'post-a', '✅', true));
  await d.sendDM('person', 'NO', d.dms[0].id);
  assert.equal(f.db.data.RideRequests[0].status, 'PENDING');
  f.setNow('2026-09-26T12:30:00'); await d.sendDM('person', 'YES', d.dms[0].id);
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'true'); assert.match(d.replies.at(-1)!, /admin must arrange/);
});
test('reconciliation restores offline additions and removes absent reactions, including guest data', async () => {
  const f = fixture(); await register(f); await register(f, 'guild-a', 'absent'); const d = discordFixture(f);
  await f.service.run('guild-a', c => f.service.reaction(c, 'absent', 'post-a', '✅', true));
  Object.assign(f.db.data.RideRequests[0], { hasPlusOne: 'true', plusOneName: 'Guest', plusOnePhone: '+12025550123' });
  const post = d.channels.get('channel-a')!.history.get('post-a')!;
  post.setUsers('✅', ['person']); post.setUsers('1️⃣', ['person']);
  await f.service.run('guild-a', c => d.bot.reconcile(c));
  assert.equal(f.db.data.RideRequests[0].status, 'CANCELLED'); assert.equal(f.db.data.RideRequests[0].plusOneName, '');
  assert.equal(f.db.data.RideRequests[1].status, 'PENDING'); assert.equal(d.dms.length, 1);
  const restarted = discordFixture(f);
  await restarted.sendDM('person', 'Guest\n+12025550123', d.dms[0].id);
  assert.equal(f.db.data.RideRequests[1].hasPlusOne, 'true');
  await f.service.run('guild-a', c => d.bot.reconcile(c)); assert.equal(d.dms.length, 1);
});
test('weekly post anchors reactions, saves ID and recovers a sent post after failed persistence', async () => {
  const f = fixture(); const d = discordFixture(f); f.a.activeMessageId = ''; f.a.activeWeekDate = '';
  await f.service.run('guild-a', c => d.bot.post(c));
  const channel = d.channels.get('channel-a')!;
  assert.equal(channel.sent.length, 1); assert.equal(channel.sent[0].reactions.cache.size, 2);
  assert.equal(f.db.data.Churches[0].activeMessageId, channel.sent[0].id);
  f.db.data.Churches[0].activeMessageId = ''; f.db.data.Churches[0].activeWeekDate = '';
  await f.service.run('guild-a', c => d.bot.post(c));
  assert.equal(channel.sent.length, 1); assert.equal(f.db.data.Churches[0].activeMessageId, channel.sent[0].id);
});
