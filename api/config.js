export default async function handler(req, res) {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  if (!googleClientId) {
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }
  res.status(200).json({ googleClientId });
}
