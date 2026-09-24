import { sheetConfig } from './config.js';
import { Sheets } from './sheets.js';

async function main() {
  const env = sheetConfig();
  await Sheets.connect(env.sheetId, env.keyPath).initialize();
  console.log('Required headers added. Configure each church’s timezone, weeklySendDay, weeklySendTime and weeklyMessageTemplate.');
}
main().catch(() => { console.error('Sheet setup failed. Check credentials, sharing, and existing tab/header names.'); process.exitCode = 1; });
