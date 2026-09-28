import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { auth, sheets } from 'googleapis/build/src/apis/sheets/index.js';
import { sheetConfig } from '../src/config.js';

type Point = { name: string; latitude: string; longitude: string };
type Pair = { locationA: string; locationB: string; distanceFeet: string; distanceMi: string };
const root = 'documentation/seed-data';
const csv = (file: string) => readFileSync(`${root}/${file}`, 'utf8').trim().split('\n').slice(1).map(line => line.split(','));
const points: Point[] = csv('pickup_points.csv').map(([name, latitude, longitude]) => ({ name, latitude, longitude }));
const pairs: Pair[] = csv('pickup_point_pairs.csv').map(([locationA, locationB, distanceFeet, distanceMi]) => ({ locationA, locationB, distanceFeet, distanceMi }));

// The workbook is the human-auditable source matrix. The CSV pair list is its
// Sheet 3 export; reject a seed when the workbook no longer contains that matrix.
const matrixXml = execFileSync('unzip', ['-p', `${root}/uci_housing_distances.xlsx`, 'xl/worksheets/sheet2.xml'], { encoding: 'utf8' });
const locationsXml = execFileSync('unzip', ['-p', `${root}/uci_housing_distances.xlsx`, 'xl/worksheets/sheet1.xml'], { encoding: 'utf8' });
if (!pairs.every(pair => matrixXml.includes(`<v>${pair.distanceFeet}</v>`)) || !points.every(point => locationsXml.includes(`<v>${point.latitude}</v>`) && locationsXml.includes(`<v>${point.longitude}</v>`))) throw new Error('The workbook does not agree with the CSV routing seeds; refusing to seed routing data.');
if (points.length !== 19 || pairs.length !== 171) throw new Error('Unexpected routing seed size.');

const { sheetId, keyPath } = sheetConfig();
const api = sheets({ version: 'v4', auth: new auth.GoogleAuth({ keyFile: keyPath, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) });
const metadata = await api.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties(sheetId,title)' });
let distanceSheet = metadata.data.sheets?.find(sheet => sheet.properties?.title === 'ZoneDistances');
if (!distanceSheet) {
  const created = await api.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests: [{ addSheet: { properties: { title: 'ZoneDistances' } } }] } });
  distanceSheet = created.data.replies?.[0].addSheet;
}
if (!distanceSheet?.properties?.sheetId) throw new Error('Could not create ZoneDistances.');

const zonesRead = await api.spreadsheets.values.get({ spreadsheetId: sheetId, range: "'Zones'!A:Z" });
let [headers = [], ...zoneRows] = zonesRead.data.values ?? [];
headers = headers.map(String);
const missing = ['latitude', 'longitude'].filter(header => !headers.includes(header));
if (missing.length) {
  await api.spreadsheets.values.update({ spreadsheetId: sheetId, range: `'Zones'!${column(headers.length)}1`, valueInputOption: 'RAW', requestBody: { values: [missing] } });
  headers = headers.concat(missing);
  zoneRows = (await api.spreadsheets.values.get({ spreadsheetId: sheetId, range: "'Zones'!A:Z" })).data.values?.slice(1) ?? [];
}
const nameColumn = headers.indexOf('zoneName'); const latitudeColumn = headers.indexOf('latitude'); const longitudeColumn = headers.indexOf('longitude');
if (nameColumn < 0) throw new Error('Zones.zoneName is required.');
const updates = points.flatMap(point => {
  const row = zoneRows.findIndex(values => String(values[nameColumn] ?? '') === point.name);
  return row < 0 ? [] : [
    { range: `'Zones'!${column(latitudeColumn)}${row + 2}`, values: [[Number(point.latitude)]] },
    { range: `'Zones'!${column(longitudeColumn)}${row + 2}`, values: [[Number(point.longitude)]] },
  ];
});
if (updates.length) await api.spreadsheets.values.batchUpdate({ spreadsheetId: sheetId, requestBody: { valueInputOption: 'RAW', data: updates } });
await api.spreadsheets.values.clear({ spreadsheetId: sheetId, range: "'ZoneDistances'!A:Z" });
await api.spreadsheets.values.update({ spreadsheetId: sheetId, range: "'ZoneDistances'!A1", valueInputOption: 'RAW', requestBody: { values: [
  ['locationA', 'locationB', 'distanceFeet', 'distanceMiles'],
  ...pairs.map(pair => [pair.locationA, pair.locationB, Number(pair.distanceFeet), Number(pair.distanceMi)]),
] } });
console.log(`Seeded ${points.length} coordinates and ${pairs.length} cached distance pairs from all three routing seed files.`);

function column(index: number) {
  let value = '';
  for (index++; index > 0; index = Math.floor((index - 1) / 26)) value = String.fromCharCode(65 + (index - 1) % 26) + value;
  return value;
}
