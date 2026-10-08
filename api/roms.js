import { getDatabase } from '../lib/mongodb.js';
import { verifySessionCookie } from '../lib/auth.js';
import { google } from 'googleapis';
import { MongoClient } from 'mongodb';

// Helper to clean title from filename
function cleanTitle(filename) {
  // Remove .gba extension and replace underscores/dashes with spaces, then trim
  return filename.replace(/\.gba$/i, '').replace(/[_-]/g, ' ').trim();
}

export default async function handler(req, res) {
  // Verify session
  const sessionCookie = req.headers.cookie;
  const userSub = verifySessionCookie(sessionCookie);
  if (!userSub) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    // Initialize Google Drive API with service account
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const drive = google.drive({ version: 'v3', auth });

    // List files in the specified folder
    const folderId = process.env.GBA_DRIVE_FOLDER_ID;
    if (!folderId) {
      throw new Error('GBA_DRIVE_FOLDER_ID is not defined');
    }

    const response = await drive.files.list({
      q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.file' and name contains '.gba'`,
      fields: 'files(id, name, size)',
    });

    const files = response.data.files || [];

    // Get database connection
    const db = await getDatabase();
    const collection = db.collection('roms');

    // Upsert each file into the roms collection
    const roms = [];
    for (const file of files) {
      const romId = file.id;
      const title = cleanTitle(file.name);
      const size = parseInt(file.size, 10) || 0;

      // Upsert based on userSub and romId
      const updateDoc = {
        $set: {
          title,
          size,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      };
      await collection.updateOne(
        { userSub, romId },
        updateDoc,
        { upsert: true }
      );

      roms.push({
        id: romId,
        title,
        size,
        // We'll add coverUrl later via a separate endpoint or we can compute it now
        // For now, we'll leave it blank and the frontend can request from /cover
      });
    }

    // Fetch cover URLs for each rom (optional, we can let the frontend handle it)
    // For simplicity, we'll just return the roms without coverUrl and let the frontend request from /cover
    res.status(200).json(roms);
  } catch (error) {
    console.error('Error fetching roms:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}