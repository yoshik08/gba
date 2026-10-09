import { readSession } from '../lib/auth.js';

export default async function handler(req, res) {
  const session = readSession(req.headers.cookie);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.status(200).json({
    sub: session.sub,
    name: session.name || '',
    picture: session.picture || '',
  });
}
