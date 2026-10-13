import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { jobDue, parseCommand, parseJob } from '../src/schedule.js';
import { discordFixture, fixture, job } from './fixtures.js';

const LA = (iso: string) => DateTime.fromISO(iso, { zone: 'America/Los_Angeles' });
const setup = (jobs: Parameters<typeof job>[0][] = []) => {
  const f = fixture();
  f.db.data.Schedules.length = 0;
  for (const j of jobs) f.db.data.Schedules.push(job(j));
  return { f, d: discordFixture(f) };
};
const row = (f: ReturnType<typeof fixture>, id: string) => f.db.data.Schedules.find(r => r.jobId === id)!;

test('commands match exactly; anything else is rejected', () => {
  assert.deepEqual(parseCommand('/rides post church:a'), { kind: 'post', churchId: 'a' });
  assert.deepEqual(parseCommand(' /rides ask-drivers church:CH01 '), { kind: 'ask-drivers', churchId: 'CH01' });
  assert.deepEqual(parseCommand('/rides sync church:a'), { kind: 'sync', churchId: 'a' });
  assert.deepEqual(parseCommand('/rides broadcast name:thursday'), { kind: 'broadcast', name: 'thursday' });
  for (const bad of ['rides post church:a', '/rides post', '/rides post church:a extra', '/rides  post church:a', '/rides delete church:a', '/rides broadcast church:a'])
    assert.throws(() => parseCommand(bad), /exactly one of/, bad);
});

test('a job needs a valid day, time, content and (for messages) channel', () => {
  const ok = { jobId: 'j', churchId: 'a', day: 'Thursday', time: '12:00', command: '/rides post church:a' };
  assert.equal(parseJob(job(ok)).day, 4);
  assert.throws(() => parseJob(job({ ...ok, day: 'Thu' })), /day must be/);
  assert.throws(() => parseJob(job({ ...ok, time: '9:00' })), /time must be/);
  assert.throws(() => parseJob(job({ ...ok, command: '', message: '' })), /command, a message/);
  assert.throws(() => parseJob(job({ ...ok, command: '', message: 'hi' })), /channel must be/);
  assert.throws(() => parseJob(job({ ...ok, command: '/rides nope' })), /exactly one of/);
  assert.equal(parseJob(job({ ...ok, command: '', message: 'hi', channel: 'Drivers' })).channel, 'drivers');
});

test('a job is due from its day/time until the end of the week, in the church timezone', () => {
  const f = fixture();
  const thursdayNoon = parseJob(job({ jobId: 'j', churchId: 'a', day: 'Thursday', time: '12:00', command: '/rides post church:a' }));
  assert.equal(jobDue(thursdayNoon, f.a, LA('2026-09-24T11:59:00')), false);
  assert.equal(jobDue(thursdayNoon, f.a, LA('2026-09-24T12:00:00')), true);
  assert.equal(jobDue(thursdayNoon, f.a, LA('2026-09-26T15:00:00')), true);
  assert.equal(jobDue(thursdayNoon, f.a, LA('2026-09-23T23:59:00')), false);
  assert.equal(jobDue(thursdayNoon, f.a, LA('2026-09-28T00:00:00')), false); // Monday starts the next week
  // 19:00 UTC Thursday is 12:00 in Los Angeles during DST, but 15:00 in New York.
  assert.equal(jobDue(thursdayNoon, f.a, DateTime.fromISO('2026-09-24T18:59:00Z')), false);
  assert.equal(jobDue(thursdayNoon, f.a, DateTime.fromISO('2026-09-24T19:00:00Z')), true);
});

test('two jobs due the same minute both run in row order and are recorded independently', async () => {
  const { f, d } = setup([
    { jobId: 'ask-a', churchId: 'a', day: 'Thursday', time: '12:00', command: '/rides ask-drivers church:a' },
    { jobId: 'ask-b', churchId: 'b', day: 'Thursday', time: '12:00', command: '/rides ask-drivers church:b' },
    { jobId: 'note-a', churchId: 'a', day: 'Thursday', time: '12:00', message: 'Hi {churchName} for {weekDate}', channel: 'drivers' },
  ]);
  await d.bot.tick();
  assert.equal(d.channels.get('drivers-a')!.sent.length, 2); // ask + message
  assert.equal(d.channels.get('drivers-b')!.sent.length, 1);
  assert.equal(d.channels.get('drivers-a')!.sent[1].content, 'Hi Church a for 2026-09-27');
  for (const id of ['ask-a', 'ask-b', 'note-a']) { assert.equal(row(f, id).lastRunWeek, '2026-09-27'); assert.equal(row(f, id).lastStatus, 'OK'); }
});

test('one failing job does not stop the others, and is recorded without ids', async () => {
  const { f, d } = setup([
    { jobId: 'bad', churchId: 'a', day: 'Thursday', time: '12:00', command: '/rides post church:missing' },
    { jobId: 'good', churchId: 'b', day: 'Thursday', time: '12:00', command: '/rides ask-drivers church:b' },
  ]);
  await d.bot.tick();
  assert.equal(row(f, 'bad').lastStatus, 'FAILED'); assert.equal(row(f, 'bad').lastRunWeek, ''); assert.equal(row(f, 'bad').attempts, '1');
  assert.match(row(f, 'bad').lastError, /not configured/);
  assert.equal(row(f, 'good').lastStatus, 'OK'); assert.equal(d.channels.get('drivers-b')!.sent.length, 1);
});

test('a missed job catches up however late in the same week, once', async () => {
  const { f, d } = setup([{ jobId: 'ask-a', churchId: 'a', day: 'Thursday', time: '12:00', command: '/rides ask-drivers church:a' }]);
  f.setNow('2026-09-26T17:30:00'); // Saturday evening, bot was down since Wednesday
  await d.bot.tick(); await d.bot.tick();
  assert.equal(d.channels.get('drivers-a')!.sent.length, 1);
  assert.equal(row(f, 'ask-a').lastRunWeek, '2026-09-27');
});

test('a job not yet due does nothing; last week\'s run does not satisfy this week or get replayed', async () => {
  const { f, d } = setup([{ jobId: 'ask-a', churchId: 'a', day: 'Thursday', time: '12:00', command: '/rides ask-drivers church:a', lastRunWeek: '2026-09-20' }]);
  f.setNow('2026-09-24T11:00:00'); await d.bot.tick();
  assert.equal(d.channels.get('drivers-a')!.sent.length, 0);
  f.setNow('2026-09-24T12:00:00'); await d.bot.tick();
  assert.equal(d.channels.get('drivers-a')!.sent.length, 1); // exactly one run for this week, none for the missed one
  assert.equal(row(f, 'ask-a').lastRunWeek, '2026-09-27');
  f.setNow('2026-10-01T12:00:00'); await d.bot.tick();
  assert.equal(d.channels.get('drivers-a')!.sent.length, 2);
});

test('disabled, duplicate-id and invalid rows do not run; invalid rows are noted once', async () => {
  const { f, d } = setup([
    { jobId: 'off', enabled: 'FALSE', churchId: 'a', day: 'Thursday', time: '12:00', command: '/rides ask-drivers church:a' },
    { jobId: 'dup', churchId: 'a', day: 'Thursday', time: '12:00', command: '/rides ask-drivers church:a' },
    { jobId: 'dup', churchId: 'a', day: 'Thursday', time: '12:00', command: '/rides ask-drivers church:a' },
    { jobId: 'bad', churchId: 'a', day: 'Thursday', time: '12:00', command: '/rides post' },
    { jobId: 'nochurch', churchId: 'zzz', day: 'Thursday', time: '12:00', command: '/rides post church:a' },
  ]);
  await d.bot.tick();
  const writes = f.db.writes.filter(w => w.tab === 'Schedules').length;
  await d.bot.tick(); await d.bot.tick();
  assert.equal(f.db.writes.filter(w => w.tab === 'Schedules').length, writes); // no rewrite each minute
  assert.equal(d.channels.get('drivers-a')!.sent.length, 0);
  assert.match(row(f, 'bad').lastError, /exactly one of/); assert.match(row(f, 'nochurch').lastError, /not in the Churches tab/);
});

test('a failing job retries on later ticks up to 3 times, then stops until next week', async () => {
  const { f, d } = setup([{ jobId: 'bad', churchId: 'a', day: 'Thursday', time: '12:00', command: '/rides post church:missing' }]);
  for (let i = 0; i < 6; i++) await d.bot.tick();
  assert.equal(row(f, 'bad').attempts, '3');
  f.setNow('2026-10-01T12:00:00'); await d.bot.tick();
  assert.equal(row(f, 'bad').attempts, '1'); assert.equal(row(f, 'bad').attemptWeek, '2026-10-04');
});

test('message goes before the command, and a retry after a failed command does not resend it', async () => {
  const { f, d } = setup([{ jobId: 'both', churchId: 'a', day: 'Thursday', time: '12:00', message: 'Heads up', channel: 'drivers', command: '/rides ask-drivers church:a' }]);
  const channel = d.channels.get('drivers-a')!;
  const send = channel.send;
  let fail = true;
  channel.send = async payload => { if (fail && payload.content !== 'Heads up') throw new Error('boom'); return send(payload); };
  await d.bot.tick();
  assert.equal(row(f, 'both').lastStatus, 'FAILED'); assert.equal(row(f, 'both').messageSentWeek, '2026-09-27');
  fail = false; await d.bot.tick();
  assert.deepEqual(channel.sent.map(m => m.content?.slice(0, 8)), ['Heads up', '[Church ']);
  assert.equal(row(f, 'both').lastStatus, 'OK');
});

test('a scheduled broadcast runs once; if the week\'s block is already live it is left alone', async () => {
  const { f, d } = setup([{ jobId: 'bc', churchId: 'a', day: 'Thursday', time: '12:00', command: '/rides broadcast name:thu' }]);
  f.db.data.Broadcasts.push({ broadcastId: 'thu', type: 'ask', churches: 'a, b', greeting: 'Hello {weekDate}', greetingMessageId: '', greetingWeek: '' });
  f.b.discordGuildId = 'guild-a'; f.b.driverAskChannelId = 'drivers-a';
  await d.bot.tick();
  assert.equal(row(f, 'bc').lastStatus, 'OK');
  const sent = d.channels.get('drivers-a')!.sent.length; assert.equal(sent, 3); // greeting + two asks
  row(f, 'bc').lastRunWeek = ''; // as if the status write was lost: the live block must not be replaced
  await d.bot.tick();
  assert.equal(d.channels.get('drivers-a')!.sent.length, sent); assert.equal(row(f, 'bc').lastStatus, 'SKIPPED');
});

test('an idle tick reads only Churches and Schedules', async () => {
  const { f, d } = setup([{ jobId: 'later', churchId: 'a', day: 'Saturday', time: '09:00', command: '/rides post church:a' }]);
  await d.bot.tick(); // first pass initializes guilds and the weekly reset
  const reads: string[] = [];
  const read = f.db.read.bind(f.db); f.db.read = async tab => { reads.push(tab); return read(tab); };
  await d.bot.tick();
  assert.deepEqual(reads, ['Churches', 'Schedules']);
});

test('a failed message send is retried and sent exactly once; a recorded send is never repeated', async () => {
  const { f, d } = setup([{ jobId: 'note', churchId: 'a', day: 'Thursday', time: '12:00', message: 'Hello', channel: 'drivers' }]);
  const channel = d.channels.get('drivers-a')!;
  const send = channel.send;
  let fail = true;
  channel.send = async payload => { if (fail) throw new Error('discord down'); return send(payload); };
  await d.bot.tick();
  assert.equal(row(f, 'note').lastStatus, 'FAILED'); assert.equal(row(f, 'note').messageSentWeek, ''); assert.equal(channel.sent.length, 0);
  fail = false; await d.bot.tick(); await d.bot.tick();
  assert.equal(channel.sent.length, 1); assert.equal(row(f, 'note').lastStatus, 'OK');
});

test('if the Sheet write after a send fails, the message is not sent again', async () => {
  const { f, d } = setup([{ jobId: 'note', churchId: 'a', day: 'Thursday', time: '12:00', message: 'Hello', channel: 'drivers' }]);
  const save = f.db.save.bind(f.db);
  let failFinal = true;
  f.db.save = async (tab, r, i) => { if (failFinal && tab === 'Schedules' && 'lastRunWeek' in r) throw Object.assign(new Error('quota'), { status: 429 }); return save(tab, r, i); };
  await d.bot.tick();
  failFinal = false; await d.bot.tick();
  assert.equal(d.channels.get('drivers-a')!.sent.length, 1); assert.equal(row(f, 'note').lastStatus, 'OK');
});

test('a claimed but unconfirmed message is reported FAILED, not resent, skips the command and is not retried', async () => {
  const { f, d } = setup([{ jobId: 'both', churchId: 'a', day: 'Thursday', time: '12:00', message: 'Heads up', channel: 'drivers', command: '/rides ask-drivers church:a', messageSentWeek: 'pending:2026-09-27' }]);
  for (let i = 0; i < 3; i++) await d.bot.tick();
  assert.equal(d.channels.get('drivers-a')!.sent.length, 0);
  assert.equal(row(f, 'both').lastStatus, 'FAILED'); assert.equal(row(f, 'both').lastRunWeek, '');
  assert.match(row(f, 'both').lastError, /never confirmed/); assert.equal(row(f, 'both').attempts, '3');
});

test('a confirmed send records the week; if only the confirm write fails the final status write reconciles it', async () => {
  const { f, d } = setup([{ jobId: 'both', churchId: 'a', day: 'Thursday', time: '12:00', message: 'Heads up', channel: 'drivers', command: '/rides ask-drivers church:a' }]);
  const save = f.db.save.bind(f.db);
  f.db.save = async (tab, r, i) => { if (tab === 'Schedules' && r.messageSentWeek === '2026-09-27' && !('lastRunWeek' in r)) throw new Error('quota'); return save(tab, r, i); };
  await d.bot.tick();
  assert.equal(d.channels.get('drivers-a')!.sent.length, 2); assert.equal(row(f, 'both').lastStatus, 'OK');
  assert.equal(row(f, 'both').messageSentWeek, '2026-09-27');
  await d.bot.tick();
  assert.equal(d.channels.get('drivers-a')!.sent.length, 2);
  const ok = setup([{ jobId: 'note', churchId: 'a', day: 'Thursday', time: '12:00', message: 'Hello', channel: 'drivers' }]);
  await ok.d.bot.tick();
  assert.equal(row(ok.f, 'note').messageSentWeek, '2026-09-27');
});

test('if the confirm and the final status write both fail, the message is never resent and the row ends FAILED, not OK', async () => {
  const { f, d } = setup([{ jobId: 'note', churchId: 'a', day: 'Thursday', time: '12:00', message: 'Hello', channel: 'drivers' }]);
  const save = f.db.save.bind(f.db);
  let broken = true;
  f.db.save = async (tab, r, i) => { if (broken && tab === 'Schedules' && r.messageSentWeek === '2026-09-27') throw new Error('quota'); return save(tab, r, i); };
  await d.bot.tick();
  assert.equal(row(f, 'note').messageSentWeek, 'pending:2026-09-27'); assert.notEqual(row(f, 'note').lastStatus, 'OK');
  broken = false; await d.bot.tick();
  assert.equal(d.channels.get('drivers-a')!.sent.length, 1);
  assert.equal(row(f, 'note').lastStatus, 'FAILED'); assert.match(row(f, 'note').lastError, /never confirmed/);
});

test('with no enabled Schedules rows a tick changes no church or driver state', async () => {
  for (const rows of [[], [{ jobId: 'off', enabled: 'FALSE', churchId: 'a', day: 'Thursday', time: '12:00', command: '/rides ask-drivers church:a' }]]) {
    const { f, d } = setup(rows);
    f.db.data.Drivers.push({ driverId: 'd1', churchId: 'a', isAvailableThisWeek: 'true', availabilityWeek: '2026-09-20' } as never);
    await d.bot.tick();
    assert.equal(f.db.writes.length, 0);
    assert.equal(f.db.data.Drivers[0].isAvailableThisWeek, 'true'); assert.equal(f.a.availabilityResetWeek, '');
  }
});

test('an invalid church timezone marks its jobs FAILED once instead of failing silently every minute', async () => {
  const { f, d } = setup([{ jobId: 'ask-a', churchId: 'a', day: 'Thursday', time: '12:00', command: '/rides ask-drivers church:a' }]);
  f.a.timezone = 'Mars/Olympus';
  await d.bot.tick(); const writes = f.db.writes.length;
  assert.equal(row(f, 'ask-a').lastStatus, 'FAILED'); assert.ok(row(f, 'ask-a').lastError);
  await d.bot.tick(); await d.bot.tick();
  assert.equal(f.db.writes.length, writes);
});

test('a message that only exceeds 2000 characters after placeholders are filled in is rejected without sending', async () => {
  const { f, d } = setup([{ jobId: 'long', churchId: 'a', day: 'Thursday', time: '12:00', message: `${'x'.repeat(1990)}{churchName}`, channel: 'drivers' }]);
  await d.bot.tick(); await d.bot.tick();
  assert.equal(d.channels.get('drivers-a')!.sent.length, 0);
  assert.equal(row(f, 'long').lastStatus, 'FAILED'); assert.match(row(f, 'long').lastError, /2000/);
  assert.equal(row(f, 'long').messageSentWeek, '');
});
