import { clearSessionCookie } from '../../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Set-Cookie', clearSessionCookie(req));
  if (req.method === 'GET') {
    res.redirect(302, '/gba');
    return;
  }
  res.status(200).json({ ok: true });
}
