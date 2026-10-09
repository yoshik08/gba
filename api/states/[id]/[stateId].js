import { ObjectId } from 'mongodb';
import { requireUser } from '../../../../lib/auth.js';
import { getDatabase } from '../../../../lib/mongodb.js';

export default async function handler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;

  const { id: romId, stateId } = req.query;
  if (!romId || !stateId) {
    res.status(400).json({ error: 'Missing romId or stateId' });
    return;
  }

  try {
    const db = await getDatabase();
    let oid;
    try {
      oid = new ObjectId(stateId);
    } catch {
      res.status(400).json({ error: 'Invalid stateId' });
      return;
    }
    const doc = await db.collection('states').findOne({
      _id: oid,
      userSub: user.sub,
      romId,
    });
    if (!doc || !doc.data) {
      res.status(404).json({ error: 'State not found' });
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'private');
    res.send(Buffer.isBuffer(doc.data) ? doc.data : Buffer.from(doc.data.buffer));
  } catch (error) {
    console.error('Error fetching state');
    res.status(500).json({ error: 'Internal server error' });
  }
}
