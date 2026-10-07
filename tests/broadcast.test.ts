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
    [{ type: 'both' }, /type must be "post" or "ask", but it is "both"/], [{ churches: '' }, /churches cell is empty/], [{ churches: 'a, a' }, /listed twice/],
    [{ greeting: '  ' }, /greeting cell is empty/], [{ churches: 'a, nope' }, /nope: must appear exactly once/],
  ] as const) {
    const { f, d, run } = setup();
    Object.assign(f.db.data.Broadcasts[0], change);
    await assert.rejects(run(), message);
    assert.equal(d.channels.get('channel-a')!.sent.length, 0);
  }
  const wrongGuild = setup(); wrongGuild.f.b.discordGuildId = 'guild-other';
  await assert.rejects(wrongGuild.run(), /b: discordGuildId is …ther, but you ran this in a server ending …\S+/);
  const noTemplate = setup(); noTemplate.f.b.weeklyMessageTemplate = '';
  await assert.rejects(noTemplate.run(), /b: weeklyMessageTemplate is blank/);
  const noAsk = setup('ask'); noAsk.f.a.driverAskMessageTemplate = '';
  await assert.rejects(noAsk.run(), /a: driverAskMessageTemplate is blank/);
  const split = setup('ask'); split.f.b.driverAskChannelId = 'drivers-b';
  await assert.rejects(split.run(), /b: driverAskChannelId is …\S+ but a's is …\S+/);
  const closed = setup(); closed.f.b.assignmentCompletedWeek = '2026-09-27';
  await assert.rejects(closed.run(), /b: assignmentCompletedWeek is already 2026-09-27/);
  const unknown = setup();
  await assert.rejects(unknown.run('missing'), /No broadcast named "missing".*Available: sunday\./);
  for (const t of [wrongGuild, noTemplate, noAsk, split, closed, unknown]) assert.equal([...t.d.channels.values()].reduce((n, c) => n + c.sent.length, 0), 0);
});

test('a failing church stops the run, is reported, and a re-run completes it', async () => {
  const { f, d, run } = setup();
  const channel = d.channels.get('channel-a')!;
  const send = channel.send;
  let calls = 0;
  channel.send = async payload => { if (++calls === 3) throw new Error('boom'); return send(payload); };
  const lines = await run();
  assert.match(lines.join('\n'), /a: posted\.\nb: FAILED — unexpected failure\. Check that the bot/);
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

test('validation reports every problem at once, naming the church, field and what to change', async () => {
  const { f, d, run } = setup();
  f.b.discordGuildId = 'guild-elsewhere'; f.b.weeklyPostChannelId = 'channel-1000000000000000000'; f.b.weeklyMessageTemplate = '';
  const error = await run().then(() => undefined, (e: Error) => e);
  assert.ok(error);
  const lines = error.message.split('\n');
  assert.match(lines[0], /did not run — 3 problems to fix, and nothing was posted or deleted/);
  assert.equal(lines.length, 4);
  assert.match(error.message, /• b: discordGuildId is …here, but you ran this in a server ending …\S+\. Set b's discordGuildId in the Churches tab/);
  assert.match(error.message, /• b: weeklyPostChannelId is …0000, but you ran this in a channel ending …\S+/);
  assert.match(error.message, /it ends in 000, so the cell may have been rounded; format the column as Plain text/);
  assert.match(error.message, /• b: weeklyMessageTemplate is blank/);
  assert.doesNotMatch(error.message, /guild-elsewhere/, 'full IDs are never echoed');
  assert.equal(d.channels.get('channel-a')!.sent.length, 0);
});

test('an invalid timezone is reported as a timezone problem', async () => {
  const { f, run } = setup();
  f.b.timezone = '';
  await assert.rejects(run(), /b: timezone is blank or not a valid IANA name/);
});

test('a Discord failure on the greeting says what failed and that nothing changed', async () => {
  const { f, d, run } = setup();
  d.channels.get('channel-a')!.send = async () => { throw Object.assign(new Error('x'), { code: 50013 }); };
  await assert.rejects(run(), /could not post the greeting in the channel ending …\S+ — unexpected failure \(Discord\/Node code 50013\)\. Check that the bot can view, send and read history.*Nothing was changed\./);
  assert.equal(f.db.data.Broadcasts[0].greetingMessageId, '');
});

test('a church that fails mid-run gets a specific FAILED line', async () => {
  const { d, run } = setup();
  const channel = d.channels.get('channel-a')!; const send = channel.send; let calls = 0;
  channel.send = async payload => { if (++calls === 3) throw Object.assign(new Error('x'), { code: 50013 }); return send(payload); };
  const lines = (await run()).join('\n');
  assert.match(lines, /b: FAILED — unexpected failure \(Discord\/Node code 50013\)\..*Stopped before the remaining churches; fix that and re-run/);
});
