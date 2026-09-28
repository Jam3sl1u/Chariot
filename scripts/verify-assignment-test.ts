import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { sheetConfig } from '../src/config.js';
import { Sheets } from '../src/sheets.js';
import { weekDate } from '../src/time.js';

async function main() {
  const config = sheetConfig();
  const db = Sheets.connect(config.sheetId, config.keyPath);
  const week = weekDate({ timezone: 'America/Los_Angeles' }, DateTime.utc());
  const rows = (await db.read('Assignments')).rows.filter(row => (row.churchId === 'TEST-A' || row.churchId === 'TEST-B') && sameWeek(row.weekDate, week));
  const byMember = new Map(rows.map(row => [row.memberId, row]));

  assert.equal(rows.length, 4, 'expected one assignment row for each seeded rider');
  assert.equal(byMember.get('a-near-1')?.driverId, 'a-driver');
  assert.equal(byMember.get('a-near-2')?.driverId, 'a-driver');
  assert.equal(byMember.get('a-far')?.driverId, '');
  assert.match(byMember.get('a-far')?.unassignedReason ?? '', /No available driver seats/);
  assert.equal(byMember.get('b-near')?.driverId, 'b-driver');
  assert.ok(rows.every(row => row.notified === 'false'), 'assignment script must leave rows unnotified');
  console.log(`Assignment test passed: 4 rows verified for ${week}; TEST-A overflow remained unassigned and TEST-B stayed isolated.`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

function sameWeek(value: string, week: string) {
  if (value === week) return true;
  // Google Sheets' UNFORMATTED_VALUE returns a serial day number for date-formatted cells.
  const serial = Number(value);
  if (!Number.isFinite(serial)) return false;
  return DateTime.fromMillis(Math.round((serial - 25569) * 86_400_000), { zone: 'utc' }).toISODate() === week;
}
