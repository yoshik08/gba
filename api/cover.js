import { requireUser } from '../lib/auth.js';

function candidates(title) {
  const raw = String(title || '').trim();
  const underscored = raw.replace(/\s+/g, '_');
  const names = [...new Set([raw, underscored])];
  const base = 'https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Game_Boy_Advance/master/Named_Boxarts';
  return names.flatMap((name) => [
    `${base}/${encodeURIComponent(name)}.png`,
    `https://thumbnails.libretro.com/${encodeURIComponent('Nintendo - Game Boy Advance')}/Named_Boxarts/${encodeURIComponent(name)}.png`,
  ]);
}

export default async function handler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;

  const { title } = req.query;
  if (!title) {
    res.status(400).json({ error: 'Missing title parameter' });
    return;
  }

  try {
    for (const url of candidates(title)) {
      const response = await fetch(url);
      if (!response.ok) continue;
      const buf = Buffer.from(await response.arrayBuffer());
      res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.end(buf);
      return;
    }
    res.status(404).json({ error: 'Thumbnail not found' });
  } catch (error) {
    console.error('Error fetching thumbnail');
    res.status(500).json({ error: 'Internal server error' });
  }
}
