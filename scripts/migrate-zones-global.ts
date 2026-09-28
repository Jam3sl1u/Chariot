import { auth, sheets } from 'googleapis/build/src/apis/sheets/index.js';
import { sheetConfig } from '../src/config.js';

const { sheetId, keyPath } = sheetConfig();
const api = sheets({ version: 'v4', auth: new auth.GoogleAuth({ keyFile: keyPath, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) });
const result = await api.spreadsheets.values.get({ spreadsheetId: sheetId, range: "'Zones'!A:Z", valueRenderOption: 'UNFORMATTED_VALUE' });
const [rawHeaders = [], ...values] = result.data.values ?? [];
const headers = rawHeaders.map(String);
const churchColumn = headers.indexOf('churchId');
const nameColumn = headers.indexOf('zoneName');
if (churchColumn === -1) throw new Error('Zones is already global: no churchId column found.');
if (nameColumn === -1 || !headers.includes('zoneId') || !headers.includes('zonePriorityOrder')) throw new Error('Zones must contain zoneId, churchId, zoneName, and zonePriorityOrder.');

const seen = new Set<string>();
const duplicateRows: number[] = [];
values.forEach((row, index) => {
  const name = String(row[nameColumn] ?? '').trim();
  if (!name) return;
  if (seen.has(name)) duplicateRows.push(index + 2);
  else seen.add(name);
});

const metadata = await api.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties(sheetId,title)' });
const zonesSheetId = metadata.data.sheets?.find(sheet => sheet.properties?.title === 'Zones')?.properties?.sheetId;
if (zonesSheetId === undefined) throw new Error('Missing Zones sheet.');
const requests = duplicateRows.sort((a, b) => b - a).map(rowNumber => ({
  deleteDimension: { range: { sheetId: zonesSheetId, dimension: 'ROWS' as const, startIndex: rowNumber - 1, endIndex: rowNumber } },
}));
requests.push({ deleteDimension: { range: { sheetId: zonesSheetId, dimension: 'COLUMNS' as const, startIndex: churchColumn, endIndex: churchColumn + 1 } } });
await api.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests } });
console.log(`Migrated Zones to a shared registry: removed ${duplicateRows.length} duplicate row(s) and the churchId column.`);
