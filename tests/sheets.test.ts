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
