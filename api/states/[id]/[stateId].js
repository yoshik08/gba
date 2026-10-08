import { getDatabase } from '../../../../lib/mongodb.js';
import { verifySessionCookie } from '../../../../lib/auth.js';

export default async function handler(req, res) {
  // Verify session
  const sessionCookie = req.headers.cookie;
  const userSub = verifySessionCookie(sessionCookie);
  if (!userSub) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { id: romId, stateId } = req.query; // Note: the dynamic params are romId and stateId
  if (!romId || !stateId) {
    res.status(400).json({ error: 'Missing romId or stateId' });
    return;
  }

  try {
    const db = await getDatabase();
    const collection = db.collection('states');

    // Find the state by _id and ensure it belongs to the user and rom
    const doc = await collection.findOne({
      _id: new require('mongodb').ObjectId(stateId),
      userSub,
      romId: romId,
    });

    if (!doc || !doc.data) {
      res.status(404).json({ error: 'State not found' });
      return;
    }

    // Return the gzipped state data
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.send(doc.data);
  } catch (error) {
    console.error('Error fetching state:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}