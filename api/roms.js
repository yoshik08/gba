import { getDatabase } from '../lib/mongodb.js';
import { requireUser } from '../lib/auth.js';
import { folderId, getDrive } from '../lib/drive.js';

function cleanTitle(filename) {
  return String(filename || '')
    .replace(/\.gba$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const drive = getDrive();
    const parent = folderId();
    const response = await drive.files.list({
      q: `'${parent}' in parents and trashed = false`,
      fields: 'files(id, name, size)',
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files = (response.data.files || []).filter((file) =>
      /\.gba$/i.test(file.name || '')
    );

    const db = await getDatabase();
    const collection = db.collection('roms');
    const roms = [];

    for (const file of files) {
      const title = cleanTitle(file.name);
      const size = parseInt(file.size, 10) || 0;
      await collection.updateOne(
        { driveFileId: file.id },
        {
          $set: {
            title,
            size,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );
      roms.push({
        id: file.id,
        title,
        size,
        coverUrl: `/gba/api/cover?title=${encodeURIComponent(title)}`,
      });
    }

    res.status(200).json(roms);
  } catch (error) {
    console.error('Error fetching roms');
    res.status(500).json({ error: 'Internal server error' });
  }
}
