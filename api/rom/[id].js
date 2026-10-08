import { getDatabase } from '../../../lib/mongodb.js';
import { verifySessionCookie } from '../../../lib/auth.js';
import { google } from 'googleapis';
import { PassThrough } from 'stream';

export default async function handler(req, res) {
  // Verify session
  const sessionCookie = req.headers.cookie;
  const userSub = verifySessionCookie(sessionCookie);
  if (!userSub) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { id } = req.query; // romId
  if (!id) {
    res.status(400).json({ error: 'Missing romId' });
    return;
  }

  try {
    // Initialize Google Drive API with service account
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const drive = google.drive({ version: 'v3', auth });

    // Get file metadata to verify existence and parents
    const fileResponse = await drive.files.get({
      fileId: id,
      fields: 'id, name, size, parents',
    });
    const file = fileResponse.data;

    // Optional: check if file is in the allowed folder
    const folderId = process.env.GBA_DRIVE_FOLDER_ID;
    if (folderId && !file.parents?.includes(folderId)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const size = parseInt(file.size, 10);
    const range = req.headers.range;

    let start = 0;
    let end = size - 1;
    let statusCode = 200;
    let contentLength = size;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : size - 1;
      if (isNaN(start) || isNaN(end) || start > end || end >= size) {
        res.status(416).send('Requested range not satisfiable');
        return;
      }
      contentLength = end - start + 1;
      statusCode = 206;
    }

    // Stream the file with optional range header
    const response = await drive.files.get(
      { fileId: id, alt: 'media' },
      {
        responseType: 'stream',
        headers: { Range: req.headers.range }
      }
    );

    // Set response headers
    res.status(response.status);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

    if (response.status === 206 && response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    }

    // Pipe the stream to the response
    response.data.pipe(res);
  } catch (error) {
    console.error('Error streaming ROM:', error);
    if (error.response && error.response.status === 416) {
      res.status(416).send('Requested range not satisfiable');
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}