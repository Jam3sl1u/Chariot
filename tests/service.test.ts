import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { validPhone, yesNo } from '../src/service.js';
import { weekDate, localTime } from '../src/time.js';
import { DateTime } from 'luxon';
import { fixture, register } from './fixtures.js';

test('credentials required by exact environment names; error does not echo secrets', () => {
  assert.throws(() => config({ DISCORD_BOT_TOKEN: 'secret' }), /GOOGLE_SHEET_ID/);
  assert.deepEqual(config({ DISCORD_BOT_TOKEN: 'secret', GOOGLE_SHEET_ID: 'sheet', GOOGLE_SERVICE_ACCOUNT_KEY_PATH: './service-account-key.json' }), { token: 'secret', sheetId: 'sheet', keyPath: './service-account-key.json' });
});
test('unknown and ambiguous guild mappings never write', async () => {
  const f = fixture();
  assert.equal(await f.service.run('unknown', () => Promise.resolve(true)), undefined);
  f.db.data.Churches.push({ ...f.a, churchId: 'duplicate' });
  assert.equal(await f.service.run('guild-a', () => Promise.resolve(true)), undefined);
  assert.equal(f.db.writes.length, 0);
});
test('same Discord member registers independently in two churches, then updates in place', async () => {
  const f = fixture(); await register(f); await register(f, 'guild-b');
  const id = f.db.data.Members[0].memberId;
  await f.service.run('guild-a', c => f.service.register(c, 'person', { name: 'Updated', phone: '+12025550124', zone: 'Other / Not Listed' }));
  assert.equal(f.db.data.Members.length, 2); assert.equal(f.db.data.Members[0].memberId, id);
  assert.equal(f.db.data.Members[0].name, 'Updated'); assert.equal(f.db.data.Members[1].name, 'Test Member');
  assert.ok(f.db.writes.every(w => w.row.churchId));
});
test('registration rejects another church’s zone and invalid phone without writes', async () => {
  const f = fixture();
  await assert.rejects(f.service.run('guild-a', c => f.service.register(c, 'person', { name: 'Name', phone: '+12025550123', zone: 'Zone b' })), /location/);
  await assert.rejects(f.service.run('guild-a', c => f.service.register(c, 'person', { name: 'Name', phone: '2025550123', zone: 'Zone a' })), /US phone/);
  assert.equal(f.db.writes.length, 0);
});
test('concurrent duplicate reactions create one row; removal and re-add reuse it', async () => {
  const f = fixture(); await register(f); await register(f, 'guild-b');
  await Promise.all(Array.from({ length: 20 }, () => f.service.run('guild-a', c => f.service.reaction(c, 'person', 'post-a', '✅', true))));
  assert.equal(f.db.data.RideRequests.length, 1); const id = f.db.data.RideRequests[0].requestId;
  await f.service.run('guild-a', c => f.service.reaction(c, 'person', 'post-a', '✅', false));
  assert.equal(f.db.data.RideRequests[0].status, 'CANCELLED');
  await f.service.run('guild-a', c => f.service.reaction(c, 'person', 'post-a', '✅', true));
  assert.equal(f.db.data.RideRequests[0].requestId, id); assert.equal(f.db.data.RideRequests[0].status, 'PENDING');
});
test('old or unrelated posts do not change requests; unregistered user gets registration guidance', async () => {
  const f = fixture();
  await f.service.run('guild-a', c => f.service.reaction(c, 'person', 'unrelated', '✅', true));
  await assert.rejects(f.service.run('guild-a', c => f.service.reaction(c, 'person', 'post-a', '✅', true)), /register/);
  f.a.activeWeekDate = '2026-09-20';
  await f.service.run('guild-a', c => f.service.reaction(c, 'person', 'post-a', '✅', true));
  assert.equal(f.db.writes.length, 0);
});
test('+1 requires a pending ride, validates phone, updates one guest, and removal clears details', async () => {
  const f = fixture(); await register(f);
  await assert.rejects(f.service.run('guild-a', c => f.service.reaction(c, 'person', 'post-a', '1️⃣', true)), /own ride/);
  await f.service.run('guild-a', c => f.service.reaction(c, 'person', 'post-a', '✅', true));
  const ride = f.db.data.RideRequests[0]; ride.plusOnePromptId = 'prompt';
  await assert.rejects(f.service.run('guild-a', c => f.service.plusOne(c, 'person', 'prompt', 'Guest\ninvalid')), /two lines/);
  await f.service.run('guild-a', c => f.service.plusOne(c, 'person', 'prompt', 'Guest Name\n+12025550123'));
  assert.equal(f.db.data.RideRequests[0].hasPlusOne, 'true'); assert.equal(f.db.data.RideRequests[0].plusOneName, 'Guest Name');
  f.db.data.RideRequests[0].plusOnePromptId = 'update';
  await f.service.run('guild-a', c => f.service.plusOne(c, 'person', 'update', 'Updated Guest\n+12025550124'));
  assert.equal(f.db.data.RideRequests.length, 1); assert.equal(f.db.data.RideRequests[0].plusOneName, 'Updated Guest');
  await f.service.run('guild-a', c => f.service.reaction(c, 'person', 'post-a', '1️⃣', false));
  assert.equal(f.db.data.RideRequests[0].hasPlusOne, 'false'); assert.equal(f.db.data.RideRequests[0].plusOnePhone, '');
  await assert.rejects(f.service.run('guild-a', c => f.service.plusOne(c, 'person', 'update', 'Guest\n+12025550123')), /expired/);
});
test('Saturday 10am is informational; actual completion marker closes additions but not cancellations', async () => {
  const f = fixture(); await register(f); f.setNow('2026-09-26T12:00:00');
  await f.service.run('guild-a', c => f.service.reaction(c, 'person', 'post-a', '✅', true));
  f.a.assignmentCompletedWeek = '2026-09-27';
  await f.service.run('guild-a', c => f.service.reaction(c, 'person', 'post-a', '✅', false));
  await assert.rejects(f.service.run('guild-a', c => f.service.reaction(c, 'person', 'post-a', '✅', true)), /Assignments have run/);
  assert.equal(f.db.data.RideRequests[0].status, 'CANCELLED');
});
test('strict YES/NO parser and E.164 phone validation', () => {
  for (const text of ['YES', 'yes', 'YeS']) assert.equal(yesNo(text), true);
  for (const text of ['NO', 'no', 'No']) assert.equal(yesNo(text), false);
  for (const text of ['yes please', 'y', ' YES', 'NO\n', 'maybe']) assert.equal(yesNo(text), undefined);
  assert.equal(validPhone('+12025550123'), true); assert.equal(validPhone('+442025550123'), false);
});
test('church mapping is rechecked immediately before a write', async () => {
  const f = fixture(); const stale = { ...f.a }; f.a.discordGuildId = 'changed';
  await assert.rejects(f.service.patch('Members', stale, { discordId: 'person' }, { name: 'Name' }), /configuration changed/);
  assert.equal(f.db.writes.length, 0);
});
test('Sunday service week is church-local across UTC and DST boundaries', () => {
  const f = fixture();
  assert.equal(weekDate(f.a, DateTime.fromISO('2026-09-28T06:59:00Z')), '2026-09-27');
  assert.equal(weekDate(f.a, DateTime.fromISO('2026-09-28T07:00:00Z')), '2026-10-04');
  assert.equal(localTime(f.a, DateTime.fromISO('2026-03-08T10:00:00Z')).hour, 3);
  assert.equal(weekDate({ ...f.a, timezone: 'Asia/Tokyo' }, DateTime.fromISO('2026-09-27T16:00:00Z')), '2026-10-04');
});
