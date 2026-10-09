import { requireUser } from '../../../lib/auth.js';
import { readRawBody } from '../../../lib/body.js';
import { getDatabase } from '../../../lib/mongodb.js';

export default async function handler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;

  const { id } = req.query;
  if (!id) {
    res.status(400).json({ error: 'Missing romId' });
    return;
  }

  try {
    const db = await getDatabase();
    const collection = db.collection('sram');

    if (req.method === 'GET') {
      const doc = await collection.findOne({ userSub: user.sub, romId: id });
      if (!doc || !doc.data) {
        res.status(404).json({ error: 'No SRAM' });
        return;
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'private');
      res.send(Buffer.isBuffer(doc.data) ? doc.data : Buffer.from(doc.data.buffer));
      return;
    }

    if (req.method === 'PUT') {
      const data = await readRawBody(req);
      await collection.updateOne(
        { userSub: user.sub, romId: id },
        {
          $set: { data, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );
      res.status(200).json({ message: 'SRAM saved' });
      return;
    }

    res.setHeader('Allow', 'GET, PUT');
    res.status(405).end('Method Not Allowed');
  } catch (error) {
    console.error('Error handling SRAM');
    res.status(500).json({ error: 'Internal server error' });
  }
}
