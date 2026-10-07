import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discordFixture, fixture } from './fixtures.js';

/** Both churches share one guild and rides channel, as in production. */
function setup(type: 'post' | 'ask' = 'post') {
  const f = fixture();
  f.b.discordGuildId = 'guild-a'; f.b.weeklyPostChannelId = 'channel-a'; f.b.driverAskChannelId = 'drivers-a';
  for (const church of [f.a, f.b]) { church.activeMessageId = ''; church.activeWeekDate = ''; }
  f.db.data.Broadcasts.push({ broadcastId: 'sunday', type, churches: 'a, b', greeting: 'Good morning! Week of {weekDate}', greetingMessageId: '', greetingWeek: '' });
  const d = discordFixture(f);
  for (const channel of d.channels.values()) channel.history.clear();
  const run = (name = 'sunday') => d.bot.runBroadcast('guild-a', 'channel-a', name);
  return { f, d, run };
}
const church = (f: ReturnType<typeof fixture>, id: string) => f.db.data.Churches.find(row => row.churchId === id)!;
const contents = (d: ReturnType<typeof discordFixture>, channel: string) => d.channels.get(channel)!.sent.map(m => (m as unknown as { content: string }).content);

test('broadcast posts the greeting, then one ride post per church in order', async () => {
  const { f, d, run } = setup();
  const lines = await run();
  assert.deepEqual(contents(d, 'channel-a'), ['Good morning! Week of 2026-09-27', 'React ✅ for a ride. Deadline Saturday at 10am.', 'React ✅ for a ride. Deadline Saturday at 10am.']);
  const [greeting, postA, postB] = d.channels.get('channel-a')!.sent;
  assert.equal(church(f, 'a').activeMessageId, postA.id); assert.equal(church(f, 'b').activeMessageId, postB.id);
  assert.equal(f.db.data.Broadcasts[0].greetingMessageId, greeting.id); assert.equal(f.db.data.Broadcasts[0].greetingWeek, '2026-09-27');
  assert.match(lines.join('\n'), /Greeting posted\.\na: posted\.\nb: posted\./);
});

test('re-running deletes the old block, posts a fresh one, and cancels the week\'s pending requests', async () => {
  const { f, d, run } = setup();
  await run();
  await f.service.runChurch('a', c => f.service.register(c, 'person', { name: 'Test Member', phone: '+12025550123', preferences: '', zone: 'Zone a' }));
  await f.service.runChurch('a', c => f.service.reaction(c, 'person', c.activeMessageId, true));
  assert.equal(f.db.data.RideRequests[0].status, 'PENDING');
  const old = d.channels.get('channel-a')!.sent.map(m => m.id);
  const lines = await run();
  const channel = d.channels.get('channel-a')!;
  for (const id of old) assert.equal(channel.history.has(id), false);
  assert.equal(channel.history.size, 3);
  assert.equal(channel.sent.length, 6);
  assert.equal(f.db.data.RideRequests[0].status, 'CANCELLED');
  assert.match(lines.join('\n'), /a: replaced previous post \(1 requests cancelled\)/);
  assert.match(lines.join('\n'), /b: replaced previous post \(0 requests cancelled\)/);
  const fresh = channel.sent.slice(3).map(m => m.id);
  assert.deepEqual([f.db.data.Broadcasts[0].greetingMessageId, church(f, 'a').activeMessageId, church(f, 'b').activeMessageId], fresh);
  // A reaction on the new post restores the same request.
  await f.service.runChurch('a', c => f.service.reaction(c, 'person', c.activeMessageId, true));
  assert.equal(f.db.data.RideRequests.length, 1); assert.equal(f.db.data.RideRequests[0].status, 'PENDING');
});

test('ask broadcasts replace the driver ask and reset availability', async () => {
  const { f, d, run } = setup('ask');
  for (const id of ['a', 'b']) f.db.data.Drivers.push({ driverId: `driver-${id}`, churchId: id, name: 'Driver', discordId: `d-${id}`, memberId: '', seatsAvailable: '3', homeZone: `Zone ${id}`, isAvailableThisWeek: 'false', isActive: 'true', availabilityWeek: '', askedWeek: '', askMessageId: '', respondedWeek: '' });
  await run();
  const channel = d.channels.get('drivers-a')!;
  assert.deepEqual(contents(d, 'drivers-a').map(text => text.slice(0, 8)), ['Good mor', '[Church ', '[Church ']);
  const askA = church(f, 'a').driverAskMessageId;
  await d.sendReaction('d-a', 'guild-a', 'drivers-a', askA, '🚙');
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'true');
  const lines = await run();
  assert.equal(channel.history.has(askA), false);
  assert.equal(channel.history.size, 3);
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'false'); assert.equal(f.db.data.Drivers[0].respondedWeek, '');
  assert.match(lines.join('\n'), /a: replaced previous ask \(1 drivers reset\)/);
  await d.sendReaction('d-a', 'guild-a', 'drivers-a', askA, '🚙');
  assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'false', 'the old ask no longer counts');
});

test('invalid broadcasts are rejected before anything is sent or deleted', async () => {
  for (const [change, message] of [
    [{ type: 'both' }, /type must be/], [{ churches: '' }, /at least one church/], [{ churches: 'a, a' }, /listed twice/],
    [{ greeting: '  ' }, /greeting is empty/], [{ churches: 'a, nope' }, /nope must appear exactly once/],
  ] as const) {
    const { f, d, run } = setup();
    Object.assign(f.db.data.Broadcasts[0], change);
    await assert.rejects(run(), message);
    assert.equal(d.channels.get('channel-a')!.sent.length, 0);
  }
  const wrongGuild = setup(); wrongGuild.f.b.discordGuildId = 'guild-other';
  await assert.rejects(wrongGuild.run(), /different server or channel/);
  const noTemplate = setup(); noTemplate.f.b.weeklyMessageTemplate = '';
  await assert.rejects(noTemplate.run(), /weeklyMessageTemplate for b/);
  const noAsk = setup('ask'); noAsk.f.a.driverAskMessageTemplate = '';
  await assert.rejects(noAsk.run(), /driverAskMessageTemplate for a/);
  const split = setup('ask'); split.f.b.driverAskChannelId = 'drivers-b';
  await assert.rejects(split.run(), /same driver ask channel/);
  const closed = setup(); closed.f.b.assignmentCompletedWeek = '2026-09-27';
  await assert.rejects(closed.run(), /already run for b/);
  const unknown = setup();
  await assert.rejects(unknown.run('missing'), /No broadcast named "missing"/);
  for (const t of [wrongGuild, noTemplate, noAsk, split, closed, unknown]) assert.equal([...t.d.channels.values()].reduce((n, c) => n + c.sent.length, 0), 0);
});

test('a failing church stops the run, is reported, and a re-run completes it', async () => {
  const { f, d, run } = setup();
  const channel = d.channels.get('channel-a')!;
  const send = channel.send;
  let calls = 0;
  channel.send = async payload => { if (++calls === 3) throw new Error('boom'); return send(payload); };
  const lines = await run();
  assert.match(lines.join('\n'), /a: posted\.\nb: FAILED\. Stopped; re-run to retry\./);
  assert.ok(church(f, 'a').activeMessageId); assert.equal(church(f, 'b').activeMessageId, '');
  channel.send = send;
  const retry = await run();
  assert.match(retry.join('\n'), /a: replaced previous post/); assert.match(retry.join('\n'), /b: posted\./);
  assert.ok(church(f, 'b').activeMessageId);
});

test('a broadcast cannot run twice at once', async () => {
  const { run } = setup();
  const first = run();
  await assert.rejects(run(), /already running/);
  await first;
});
