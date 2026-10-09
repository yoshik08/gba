import { google } from 'googleapis';

export function getDrive() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not defined');
  }
  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

export function folderId() {
  const id = process.env.GBA_DRIVE_FOLDER_ID;
  if (!id) throw new Error('GBA_DRIVE_FOLDER_ID is not defined');
  return id;
}
