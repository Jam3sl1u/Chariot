import { DateTime } from 'luxon';
import { sheetConfig } from '../src/config.js';
import { Sheets, type Row, type Tab } from '../src/sheets.js';
import { weekDate } from '../src/time.js';

const churchA = 'TEST-A';
const churchB = 'TEST-B';

async function main() {
  const config = sheetConfig();
  const db = Sheets.connect(config.sheetId, config.keyPath);
  const week = weekDate({ timezone: 'America/Los_Angeles' }, DateTime.utc());
  const tables = await Promise.all((['Churches', 'Members', 'Drivers', 'Zones', 'RideRequests', 'Assignments'] as Tab[]).map(async tab => [tab, await db.read(tab)] as const));
  const existing = tables.filter(([tab]) => tab !== 'Zones').flatMap(([, table]) => table.rows).filter(row => row.churchId === churchA || row.churchId === churchB);
  if (existing.length) throw new Error('TEST-A or TEST-B rows already exist. Refusing to create duplicate test data.');

  const rows: Record<Tab, Row[]> = {
    Churches: [
      church(churchA, 'Assignment Test A'),
      church(churchB, 'Assignment Test B'),
    ],
    Members: [
      member(churchA, 'a-near-1', 'Near Rider 1', 'Near'),
      member(churchA, 'a-near-2', 'Near Rider 2', 'Near'),
      member(churchA, 'a-far', 'Far Rider', 'Far'),
      member(churchB, 'b-near', 'Church B Rider', 'Near'),
    ],
    Drivers: [
      driver(churchA, 'a-driver', 'A Driver', '2', 'Near'),
      // Deliberately generous capacity: TEST-A must not use this driver's seats.
      driver(churchB, 'b-driver', 'B Driver', '10', 'Near'),
    ],
    Zones: [
      zone('test-near-zone', 'Near', '1'),
      zone('test-far-zone', 'Far', '2'),
    ],
    RideRequests: [
      request(churchA, 'a-request-near-1', 'a-near-1', week),
      request(churchA, 'a-request-near-2', 'a-near-2', week),
      request(churchA, 'a-request-far', 'a-far', week),
      request(churchB, 'b-request-near', 'b-near', week),
    ],
    Assignments: [],
  };

  for (const tab of Object.keys(rows) as Tab[]) for (const row of rows[tab]) await db.save(tab, row);
  console.log(`Seeded TEST-A and TEST-B for ${week}. Run runSaturdayAssignments in Apps Script, then npm run verify:assignment-test.`);
}

function church(churchId: string, churchName: string): Row {
  return { churchId, churchName, discordGuildId: 'test-guild', weeklyPostChannelId: 'test-channel', driverAskChannelId: 'test-driver-channel', driverRoleId: 'test-drivers-role', timezone: 'America/Los_Angeles', weeklySendDay: 'Wednesday', weeklySendTime: '09:00', weeklyMessageTemplate: 'Test', driverAskMessageTemplate: 'Drivers: react if you can drive this Sunday.', registrationDmTemplate: '', activeMessageId: '', activeWeekDate: '', driverAskMessageId: '', driverAskWeek: '', availabilityResetWeek: '', assignmentCompletedWeek: '' };
}
function member(churchId: string, memberId: string, name: string, zone: string): Row {
  return { churchId, memberId, name, discordId: `test-${memberId}`, zone, createdAt: DateTime.utc().toISO()!, phone: '', preferences: '', notificationPreference: 'DISCORD_DM' };
}
function driver(churchId: string, driverId: string, name: string, seatsAvailable: string, homeZone: string): Row {
  return { churchId, driverId, memberId: '', name, discordId: `test-${driverId}`, seatsAvailable, homeZone, isAvailableThisWeek: 'true', isActive: 'true', availabilityWeek: '', askedWeek: '', askMessageId: '', respondedWeek: '' };
}
function zone(zoneId: string, zoneName: string, zonePriorityOrder: string): Row {
  return { zoneId, zoneName, zonePriorityOrder };
}
function request(churchId: string, requestId: string, memberId: string, weekDate: string): Row {
  return { churchId, requestId, weekDate, memberId, status: 'PENDING', hasPlusOne: 'false', plusOneName: '', plusOnePhone: '', plusOnePromptId: '' };
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
