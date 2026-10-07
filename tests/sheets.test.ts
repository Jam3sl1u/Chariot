import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { sheets_v4 } from 'googleapis/build/src/apis/sheets/index.js';
import { Sheets } from '../src/sheets.js';

function fake(headers: string[]) {
  const calls: Record<string, unknown>[] = [];
  const api = { spreadsheets: { values: {
    get: async () => ({ data: { values: [headers] } }),
    append: async (args: Record<string, unknown>) => { calls.push(args); },
    batchUpdate: async (args: Record<string, unknown>) => { calls.push(args); },
  } } } as unknown as sheets_v4.Sheets;
  return { db: new Sheets(api, 'test-sheet'), calls };
}
test('Sheets append uses RAW, preserves string IDs, and writes actual boolean cells', async () => {
  const f = fake(['churchId', 'discordId', 'name', 'hasPlusOne']);
  await f.db.save('Members', { churchId: 'a', discordId: '123456789012345678', name: '=IMPORTXML("example")', hasPlusOne: 'false' });
  assert.equal(f.calls[0].valueInputOption, 'RAW');
  assert.deepEqual(f.calls[0].requestBody, { values: [['a', '123456789012345678', '=IMPORTXML("example")', false]] });
});
test('Sheets patches only supplied fields with reordered headers, preserving unrelated cells', async () => {
  const f = fake(['adminFormula', 'isAvailableThisWeek', 'churchId', 'driverId']);
  await f.db.save('Drivers', { churchId: 'a', driverId: 'driver-a', isAvailableThisWeek: 'true' }, 4);
  assert.deepEqual(f.calls[0].requestBody, { valueInputOption: 'RAW', data: [
    { range: "'Drivers'!C6", values: [['a']] }, { range: "'Drivers'!D6", values: [['driver-a']] }, { range: "'Drivers'!B6", values: [[true]] },
  ] });
});
test('Sheets rejects missing tenant and missing headers before issuing any mutation', async () => {
  const f = fake(['churchId', 'name']);
  await assert.rejects(f.db.save('Members', { name: 'Test' }), /churchId/);
  await assert.rejects(f.db.save('Members', { churchId: 'a', phone: '+12025550123' }), /setup:sheets/);
  assert.equal(f.calls.length, 0);
});
test('Zones is the one shared table and does not require churchId', async () => {
  const f = fake(['zoneId', 'zoneName', 'zonePriorityOrder']);
  await f.db.save('Zones', { zoneId: 'mesa', zoneName: 'Mesa Court', zonePriorityOrder: '1' });
  assert.deepEqual(f.calls[0].requestBody, { values: [['mesa', 'Mesa Court', '1']] });
});

test('Sheets retries rate limits with backoff but not other errors', async () => {
  let reads = 0; let failures = 2;
  const api = { spreadsheets: { values: { get: async () => {
    reads++;
    if (failures-- > 0) throw Object.assign(new Error('quota'), { status: 429, code: 429 });
    return { data: { values: [['churchId', 'name'], ['a', 'One']] } };
  } } } } as unknown as sheets_v4.Sheets;
  const table = await new Sheets(api, 'test-sheet', 0).read('Members');
  assert.equal(reads, 3); assert.deepEqual(table.rows, [{ churchId: 'a', name: 'One' }]);

  let forbidden = 0;
  const denied = { spreadsheets: { values: { get: async () => { forbidden++; throw Object.assign(new Error('no'), { status: 403 }); } } } } as unknown as sheets_v4.Sheets;
  await assert.rejects(new Sheets(denied, 'test-sheet', 0).read('Members'), /no/);
  assert.equal(forbidden, 1, 'permission errors are not retried');

  let always = 0;
  const limited = { spreadsheets: { values: { get: async () => { always++; throw Object.assign(new Error('quota'), { status: 429 }); } } } } as unknown as sheets_v4.Sheets;
  await assert.rejects(new Sheets(limited, 'test-sheet', 0).read('Members'), /quota/);
  assert.equal(always, 6, 'one try plus five retries, then the error surfaces');
});
