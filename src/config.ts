export function sheetConfig(env = process.env) {
  for (const key of ['GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_KEY_PATH']) {
    if (!env[key]?.trim()) throw new Error(`Missing environment variable: ${key}`);
  }
  return { sheetId: env.GOOGLE_SHEET_ID!, keyPath: env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH! };
}

export function config(env = process.env) {
  if (!env.DISCORD_BOT_TOKEN?.trim()) throw new Error('Missing environment variable: DISCORD_BOT_TOKEN');
  return { ...sheetConfig(env), token: env.DISCORD_BOT_TOKEN };
}
