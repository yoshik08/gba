import { getDatabase } from '../../../lib/mongodb.js';
import { verifySessionCookie } from '../../../lib/auth.js';

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
    const db = await getDatabase();
    const collection = db.collection('states');

    if (req.method === 'GET') {
      // Fetch the states for this user and rom, sorted by createdAt descending, limit 3
      const docs = await collection
        .find({ userSub, romId: id })
        .sort({ createdAt: -1 })
        .limit(3)
        .toArray();

      // Return the list of states with id and createdAt (we won't return the binary data in the list)
      const states = docs.map((doc) => ({
        id: doc._id.toString(),
        createdAt: doc.createdAt,
        // We can optionally include coreVersion if needed
        coreVersion: doc.coreVersion,
      }));

      res.status(200).json(states);
    } else if (req.method === 'POST') {
      // Get the raw body (gzipped state bytes)
      let data = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => {
          chunks.push(chunk);
        });
        req.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
        req.on('error', (err) => {
          reject(err);
        });
      });

      // We need to know the coreVersion. We'll use a fixed version for now.
      // In a real app, we might get it from the emulator or config.
      const coreVersion = '0.10.1'; // Placeholder, should match the mgba-wasm version

      // Insert the new state
      const result = await collection.insertOne({
        userSub,
        romId: id,
        data, // Buffer
        coreVersion,
        createdAt: new Date(),
      });

      // After inserting, ensure we have at most 3 states for this user+game
      // Delete the oldest ones beyond the 3 most recent
      const states = await collection
        .find({ userSub, romId: id })
        .sort({ createdAt: -1 })
        .toArray();

      if (states.length > 3) {
        // Delete all but the first 3 (most recent)
        const idsToDelete = states.slice(3).map((doc) => doc._id);
        await collection.deleteMany({
          _id: { $in: idsToDelete },
        });
      }

      res.status(200).json({
        id: result.insertedId.toString(),
        message: 'State saved'
      });
    } else {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).end('Method Not Allowed');
    }
  } catch (error) {
    console.error('Error handling states:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}