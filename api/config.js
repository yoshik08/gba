export default async function handler(req, res) {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  if (!googleClientId) {
    console.error('GOOGLE_CLIENT_ID is not defined in environment');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  res.status(200).json({
    googleClientId,
  });
}