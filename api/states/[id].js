import { requireUser } from '../../lib/auth.js';
import { readRawBody } from '../../lib/body.js';
import { getDatabase } from '../../lib/mongodb.js';

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
    const collection = db.collection('states');

    if (req.method === 'GET') {
      const docs = await collection
        .find({ userSub: user.sub, romId: id })
        .sort({ createdAt: -1 })
        .limit(3)
        .toArray();
      res.status(200).json(
        docs.map((doc) => ({
          id: doc._id.toString(),
          createdAt: doc.createdAt,
          coreVersion: doc.coreVersion,
        }))
      );
      return;
    }

    if (req.method === 'POST') {
      const data = await readRawBody(req);
      const coreVersion = req.headers['x-core-version'] || 'mgba-wasm';
      const result = await collection.insertOne({
        userSub: user.sub,
        romId: id,
        data,
        coreVersion,
        createdAt: new Date(),
      });
      const extras = await collection
        .find({ userSub: user.sub, romId: id })
        .sort({ createdAt: -1 })
        .skip(3)
        .project({ _id: 1 })
        .toArray();
      if (extras.length) {
        await collection.deleteMany({ _id: { $in: extras.map((d) => d._id) } });
      }
      res.status(200).json({ id: result.insertedId.toString(), message: 'State saved' });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).end('Method Not Allowed');
  } catch (error) {
    console.error('Error handling states');
    res.status(500).json({ error: 'Internal server error' });
  }
}
