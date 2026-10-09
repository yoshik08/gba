import { requireUser } from '../../../lib/auth.js';
import { folderId, getDrive } from '../../../lib/drive.js';

export default async function handler(req, res) {
  const user = requireUser(req, res);
  if (!user) return;

  const { id } = req.query;
  if (!id) {
    res.status(400).json({ error: 'Missing romId' });
    return;
  }

  try {
    const drive = getDrive();
    const parent = folderId();
    const fileResponse = await drive.files.get({
      fileId: id,
      fields: 'id, name, size, parents',
      supportsAllDrives: true,
    });
    const file = fileResponse.data;
    if (!file.parents?.includes(parent)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const size = parseInt(file.size, 10) || 0;
    const range = req.headers.range;
    const requestHeaders = {};
    if (range) requestHeaders.Range = range;

    const response = await drive.files.get(
      { fileId: id, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream', headers: requestHeaders }
    );

    const status = response.status === 206 || range ? 206 : 200;
    res.status(status);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private');
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    } else if (range && size) {
      const parts = range.replace(/bytes=/i, '').split('-');
      const start = parseInt(parts[0], 10) || 0;
      const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    response.data.pipe(res);
  } catch (error) {
    const status = error.response?.status;
    if (status === 416) {
      res.status(416).send('Requested range not satisfiable');
      return;
    }
    console.error('Error streaming ROM');
    res.status(500).json({ error: 'Internal server error' });
  }
}
