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
    const collection = db.collection('sram');

    if (req.method === 'GET') {
      // Fetch the SRAM document
      const doc = await collection.findOne({ userSub, romId: id });
      if (doc && doc.data) {
        // Return the binary data
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
        // Assuming doc.data is a Buffer (BinData stored as Buffer)
        res.send(doc.data);
      } else {
        // No SRAM data, return empty buffer
        res.send(Buffer.from([]));
      }
    } else if (req.method === 'PUT') {
      // Get the raw body (SRAM bytes)
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

      // Upsert the SRAM document
      await collection.updateOne(
        { userSub, romId: id },
        {
          $set: {
            data, // Buffer
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );

      res.status(200).json({ message: 'SRAM saved' });
    } else {
      res.setHeader('Allow', 'GET, PUT');
      res.status(405).end('Method Not Allowed');
    }
  } catch (error) {
    console.error('Error handling SRAM:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}