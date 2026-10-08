import { OAuth2Client } from 'google-auth-library';
import { sign } from 'crypto';
import cookie from 'cookie';

// We'll use the SESSION_SECRET from environment
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET is not defined');
}

// We'll create a simple signing function: create a SHA256 HMAC of the userSub
function signSession(userSub) {
  const crypto = await import('crypto');
  return crypto.createHmac('sha256', SESSION_SECRET).update(userSub).digest('hex');
}

function verifySession(signedValue, userSub) {
  const expected = signSession(userSub);
  return expected === signedValue;
}

export default async function handler(req, res) {
  // Expecting a code parameter from Google OAuth
  const { code } = req.query;
  if (!code) {
    res.status(400).send('Missing code parameter');
    return;
  }

  const oAuth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    // The redirect URI must match the one set in Google Cloud console
    // For production: https://yoshik.xyz/gba/api/auth/callback/google
    // For development: http://localhost:3000/gba/api/auth/callback/google
    `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/gba/api/auth/callback/google`
  );

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Verify the ID token
    const ticket = await oAuth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID, // Specify the CLIENT_ID of the app that accesses the backend
    });
    const payload = ticket.getPayload();
    const userSub = payload.sub;

    // Create a signed session value
    const signed = signSession(userSub);
    // Combine userSub and signed with a separator (e.g., '.')
    const sessionValue = `${userSub}.${signed}`;

    // Set the cookie
    res.setHeader(
      'Set-Cookie',
      cookie.serialize('session', sessionValue, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // In production, Vercel sets HTTPS
        sameSite: 'lax',
        path: '/gba',
        maxAge: 60 * 60 * 24 * 30, // 30 days
      })
    );

    // Redirect to the library page
    res.redirect('/gba');
  } catch (error) {
    console.error('Error verifying Google token:', error);
    res.status(500).send('Authentication failed');
  }
}