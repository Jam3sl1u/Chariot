import { sheetConfig } from '../src/config.js';
import { Sheets, columns, type Tab } from '../src/sheets.js';

async function main() {
  const config = sheetConfig();
  const db = Sheets.connect(config.sheetId, config.keyPath);
  for (const tab of Object.keys(columns) as Tab[]) {
    const { headers, rows } = await db.read(tab);
    const missing = columns[tab].filter(column => !headers.includes(column));
    if (missing.length) throw new Error(`Missing headers in ${tab}: ${missing.join(', ')}`);
    console.log(`${tab}: ${rows.length} rows; headers valid`);
  }
}
main().catch(() => { console.error('Sheet verification failed. Check credentials, sharing and run setup:sheets.'); process.exitCode = 1; });
