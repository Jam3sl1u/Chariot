import { readFileSync } from 'node:fs';
import { google } from 'googleapis';

const { SHEET_ID, GOOGLE_APPLICATION_CREDENTIALS } = process.env;
if (!SHEET_ID || !GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error('SHEET_ID and GOOGLE_APPLICATION_CREDENTIALS must be set in .env');
}

const key = JSON.parse(readFileSync(GOOGLE_APPLICATION_CREDENTIALS, 'utf8')) as {
  client_email: string;
  private_key: string;
};

async function main() {
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Churches!A1:E3',
  });
  console.log(res.data.values);
}
main().catch(console.error);
