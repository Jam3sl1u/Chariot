import { config } from './config.js';
import { Sheets } from './sheets.js';
import { Service } from './service.js';
import { Bot, createClient } from './bot.js';

async function main() {
  const env = config();
  const sheets = Sheets.connect(env.sheetId, env.keyPath);
  const bot = new Bot(createClient(), new Service(sheets));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => bot.stop());
  await bot.start(env.token);
}
main().catch(() => { console.error('Bot startup failed. Check environment variables, credentials, Sheet headers and Discord permissions.'); process.exitCode = 1; });
