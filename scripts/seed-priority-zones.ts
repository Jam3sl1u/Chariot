import { sheetConfig } from '../src/config.js';
import { Sheets, type Row } from '../src/sheets.js';
import { uciHousingZones } from '../src/zones.js';

const { sheetId, keyPath } = sheetConfig();
const db = Sheets.connect(sheetId, keyPath);
const zones = await db.read('Zones');
for (const zone of uciHousingZones) {
  const row: Row = { ...zone, zonePriorityOrder: String(zone.zonePriorityOrder) };
  const index = zones.rows.findIndex(existing => existing.zoneName === zone.zoneName);
  await db.save('Zones', row, index === -1 ? undefined : index);
}
console.log(`Seeded ${uciHousingZones.length} prioritized shared UCI housing zones.`);
