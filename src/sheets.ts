// Load only Sheets, rather than all Google APIs on every bot/test startup.
import { sheets, auth, type sheets_v4 } from 'googleapis/build/src/apis/sheets/index.js';

export type Row = Record<string, string>;
export const columns = {
  Churches: ['churchId', 'churchName', 'discordGuildId', 'weeklyPostChannelId', 'driverAskChannelId', 'driverRoleId', 'timezone', 'weeklySendDay', 'weeklySendTime', 'weeklyMessageTemplate', 'driverAskMessageTemplate', 'registrationDmTemplate', 'activeMessageId', 'activeWeekDate', 'driverAskMessageId', 'driverAskWeek', 'availabilityResetWeek', 'assignmentCompletedWeek'],
  Members: ['memberId', 'churchId', 'name', 'discordId', 'zone', 'createdAt', 'phone', 'preferences', 'notificationPreference', 'profileStatus'],
  Drivers: ['driverId', 'churchId', 'memberId', 'name', 'discordId', 'seatsAvailable', 'homeZone', 'isAvailableThisWeek', 'isActive', 'availabilityWeek', 'askedWeek', 'askMessageId', 'respondedWeek'],
  Zones: ['zoneId', 'zoneName', 'zonePriorityOrder'],
  RideRequests: ['requestId', 'churchId', 'weekDate', 'memberId', 'status', 'hasPlusOne', 'plusOneName', 'plusOnePhone', 'plusOnePromptId'],
  Assignments: ['weekDate', 'churchId', 'driverId', 'memberId', 'seatPosition', 'notified', 'unassignedReason', 'assignmentStatus'],
  Broadcasts: ['broadcastId', 'type', 'churches', 'greeting', 'greetingMessageId', 'greetingWeek'],
} as const;
export type Tab = keyof typeof columns;
/** Tabs that are not scoped to one church, keyed by their own identifier column. */
const sharedKey: Partial<Record<Tab, string>> = { Zones: 'zoneId', Broadcasts: 'broadcastId' };
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
  if (['isAvailableThisWeek', 'isActive', 'hasPlusOne', 'notified'].includes(name) && /^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  return value;
}

/** Google quotas (about 60 reads and 60 writes per minute) are bursty for this bot: back off and retry. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const statusOf = (error: unknown) => {
  const details = error && typeof error === 'object' ? error as { status?: unknown; code?: unknown } : {};
  return Number(typeof details.status === 'number' ? details.status : details.code);
};

export class Sheets implements Storage {
  /** `retryBaseMs` is the first backoff delay; tests pass 0. */
  constructor(private api: sheets_v4.Sheets, private sheetId: string, private retryBaseMs = 2000) {}

  private async retry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await work(); }
      catch (error) {
        if (attempt >= 5 || !RETRYABLE.has(statusOf(error))) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(this.retryBaseMs * 2 ** attempt, 20_000) + Math.random() * this.retryBaseMs / 2));
      }
    }
  }

  static connect(sheetId: string, keyFile: string) {
    const credentials = new auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    return new Sheets(sheets({ version: 'v4', auth: credentials }), sheetId);
  }

  async read(tab: Tab): Promise<Table> {
    const result = await this.retry(() => this.api.spreadsheets.values.get({ spreadsheetId: this.sheetId, range: `'${tab}'!A:AZ`, valueRenderOption: 'UNFORMATTED_VALUE' }));
    const [first = [], ...values] = result.data.values ?? [];
    const headers = first.map(String);
    if (new Set(headers).size !== headers.length || !headers.includes(sharedKey[tab] ?? 'churchId')) throw new Error(`Invalid ${tab} headers`);
    return { headers, rows: values.map(cells => Object.fromEntries(headers.map((name, i) => [name, String(cells[i] ?? '')]))) };
  }

  // Explicit setup command only: append missing headers without moving existing columns/data.
  async initialize() {
    await this.ensureTab('Broadcasts');
    for (const tab of Object.keys(columns) as Tab[]) {
      const { headers } = await this.read(tab);
      const missing = columns[tab].filter(name => !headers.includes(name));
      if (missing.length) await this.retry(() => this.api.spreadsheets.values.update({ spreadsheetId: this.sheetId, range: `'${tab}'!${col(headers.length)}1`, valueInputOption: 'RAW', requestBody: { values: [missing] } }));
    }
  }

  // The one tab setup creates itself: it has no pre-existing data to preserve.
  private async ensureTab(tab: Tab) {
    const { data } = await this.retry(() => this.api.spreadsheets.get({ spreadsheetId: this.sheetId, fields: 'sheets.properties.title' }));
    if (!data.sheets?.some(sheet => sheet.properties?.title === tab)) {
      await this.retry(() => this.api.spreadsheets.batchUpdate({ spreadsheetId: this.sheetId, requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] } }));
    }
    const first = await this.retry(() => this.api.spreadsheets.values.get({ spreadsheetId: this.sheetId, range: `'${tab}'!1:1` }));
    if (!first.data.values?.[0]?.length) await this.retry(() => this.api.spreadsheets.values.update({ spreadsheetId: this.sheetId, range: `'${tab}'!A1`, valueInputOption: 'RAW', requestBody: { values: [[...columns[tab]]] } }));
  }

  async save(tab: Tab, row: Row, index?: number) {
    if (!sharedKey[tab] && !row.churchId) throw new Error('Every write requires churchId');
    const { headers } = await this.read(tab);
    for (const name of Object.keys(row)) if (!headers.includes(name)) throw new Error(`Missing ${tab}.${name}; run setup:sheets`);
    if (index === undefined) {
      await this.retry(() => this.api.spreadsheets.values.append({ spreadsheetId: this.sheetId, range: `'${tab}'!A:${col(headers.length - 1)}`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [headers.map(name => cell(name, row[name] ?? ''))] } }));
    } else {
      // Only patch named cells: retain admin-managed values, formulas and unknown columns.
      await this.retry(() => this.api.spreadsheets.values.batchUpdate({ spreadsheetId: this.sheetId, requestBody: { valueInputOption: 'RAW', data: Object.entries(row).map(([name, value]) => ({ range: `'${tab}'!${col(headers.indexOf(name))}${index + 2}`, values: [[cell(name, value)]] })) } }));
    }
  }
}
