import cookie from 'cookie';

// We'll use the SESSION_SECRET from environment
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET is not defined');
}

// We'll create a simple signing function: create a SHA256 HMAC of the userSub
export function verifySessionCookie(sessionCookie) {
  if (!sessionCookie) return null;

  const parsed = cookie.parse(sessionCookie);
  const sessionValue = parsed.session;
  if (!sessionValue) return null;

  const [userSub, signed] = sessionValue.split('.');
  if (!userSub || !signed) return null;

  // Verify the signature
  const crypto = require('crypto');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(userSub).digest('hex');
  if (expected !== signed) return null;

  return userSub;
}