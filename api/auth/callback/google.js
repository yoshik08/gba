import { OAuth2Client } from 'google-auth-library';
import { oauthRedirectUri, sessionCookie, signSession } from '../../../lib/auth.js';

export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) {
    res.status(400).send('Missing code parameter');
    return;
  }

  const redirectUri = oauthRedirectUri(req);
  const oAuth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    const ticket = await oAuth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const sessionValue = signSession({
      sub: payload.sub,
      name: payload.name || payload.email || '',
      picture: payload.picture || '',
    });
    res.setHeader('Set-Cookie', sessionCookie(sessionValue, req));
    res.redirect(302, '/gba');
  } catch (error) {
    console.error('Error verifying Google token');
    res.status(500).send('Authentication failed');
  }
}
