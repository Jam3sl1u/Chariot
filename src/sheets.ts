// Load only Sheets, rather than all Google APIs on every bot/test startup.
import { sheets, auth, type sheets_v4 } from 'googleapis/build/src/apis/sheets/index.js';

export type Row = Record<string, string>;
export const columns = {
  Churches: ['churchId', 'churchName', 'discordGuildId', 'weeklyPostChannelId', 'driverAskChannelId', 'timezone', 'weeklySendDay', 'weeklySendTime', 'weeklyMessageTemplate', 'activeMessageId', 'activeWeekDate', 'availabilityResetWeek', 'assignmentCompletedWeek'],
  Members: ['memberId', 'churchId', 'name', 'discordId', 'zone', 'createdAt', 'phone', 'preferences', 'notificationPreference'],
  Drivers: ['driverId', 'churchId', 'memberId', 'name', 'discordId', 'seatsAvailable', 'homeZone', 'isAvailableThisWeek', 'isActive', 'availabilityWeek', 'askedWeek', 'askMessageId', 'respondedWeek'],
  Zones: ['zoneId', 'churchId', 'zoneName', 'zonePriorityOrder'],
  RideRequests: ['requestId', 'churchId', 'weekDate', 'memberId', 'status', 'hasPlusOne', 'plusOneName', 'plusOnePhone', 'plusOnePromptId'],
} as const;
export type Tab = keyof typeof columns;
export interface Table { headers: string[]; rows: Row[] }
export interface Storage {
  read(tab: Tab): Promise<Table>;
  save(tab: Tab, row: Row, index?: number): Promise<void>;
}

function col(index: number): string {
  let value = '';
  for (index++; index > 0; index = Math.floor((index - 1) / 26)) value = String.fromCharCode(65 + (index - 1) % 26) + value;
  return value;
}
function cell(name: string, value: string): string | boolean {
  if (['isAvailableThisWeek', 'isActive', 'hasPlusOne'].includes(name) && /^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  return value;
}

export class Sheets implements Storage {
  constructor(private api: sheets_v4.Sheets, private sheetId: string) {}

  static connect(sheetId: string, keyFile: string) {
    const credentials = new auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    return new Sheets(sheets({ version: 'v4', auth: credentials }), sheetId);
  }

  async read(tab: Tab): Promise<Table> {
    const result = await this.api.spreadsheets.values.get({ spreadsheetId: this.sheetId, range: `'${tab}'!A:AZ`, valueRenderOption: 'UNFORMATTED_VALUE' });
    const [first = [], ...values] = result.data.values ?? [];
    const headers = first.map(String);
    if (new Set(headers).size !== headers.length || !headers.includes('churchId')) throw new Error(`Invalid ${tab} headers`);
    return { headers, rows: values.map(cells => Object.fromEntries(headers.map((name, i) => [name, String(cells[i] ?? '')]))) };
  }

  // Explicit setup command only: append missing headers without moving existing columns/data.
  async initialize() {
    for (const tab of Object.keys(columns) as Tab[]) {
      const { headers } = await this.read(tab);
      const missing = columns[tab].filter(name => !headers.includes(name));
      if (missing.length) await this.api.spreadsheets.values.update({ spreadsheetId: this.sheetId, range: `'${tab}'!${col(headers.length)}1`, valueInputOption: 'RAW', requestBody: { values: [missing] } });
    }
  }

  async save(tab: Tab, row: Row, index?: number) {
    if (!row.churchId) throw new Error('Every write requires churchId');
    const { headers } = await this.read(tab);
    for (const name of Object.keys(row)) if (!headers.includes(name)) throw new Error(`Missing ${tab}.${name}; run setup:sheets`);
    if (index === undefined) {
      await this.api.spreadsheets.values.append({ spreadsheetId: this.sheetId, range: `'${tab}'!A:${col(headers.length - 1)}`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [headers.map(name => cell(name, row[name] ?? ''))] } });
    } else {
      // Only patch named cells: retain admin-managed values, formulas and unknown columns.
      await this.api.spreadsheets.values.batchUpdate({ spreadsheetId: this.sheetId, requestBody: { valueInputOption: 'RAW', data: Object.entries(row).map(([name, value]) => ({ range: `'${tab}'!${col(headers.indexOf(name))}${index + 2}`, values: [[cell(name, value)]] })) } });
    }
  }
}
