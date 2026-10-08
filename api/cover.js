import { verifySessionCookie } from '../lib/auth.js';

export default async function handler(req, res) {
  // Verify session (optional but recommended)
  const sessionCookie = req.headers.cookie;
  const userSub = verifySessionCookie(sessionCookie);
  if (!userSub) {
    // We'll still allow the request? The spec says the cover is proxied through /gba/api/cover so they're same-origin.
    // It doesn't explicitly require auth, but to be safe we'll require auth.
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { title } = req.query;
  if (!title) {
    res.status(400).json({ error: 'Missing title parameter' });
    return;
  }

  // Clean the title for use in the URL (replace spaces with underscores, remove any unsafe characters)
  const cleanTitle = title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

  // libretro-thumbnails URL for GBA
  const system = 'Nintendo - Game Boy Advance';
  const cleanSystem = system.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const thumbnailUrl = `https://raw.githubusercontent.com/libretro/thumbnails/master/${cleanSystem}/${cleanTitle}.png`;

  try {
    const response = await fetch(thumbnailUrl);
    if (!response.ok) {
      // Thumbnail not found, we can return a 404 or let the frontend handle it.
      // We'll return a 404.
      res.status(404).json({ error: 'Thumbnail not found' });
      return;
    }

    // Set headers to proxy the image
    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable'); // Cache for a day

    // Pipe the response body to the response
    response.body.pipe(res);
  } catch (error) {
    console.error('Error fetching thumbnail:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}