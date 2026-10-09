const signedOut = document.getElementById('signed-out');
const signedIn = document.getElementById('signed-in');
const loginButton = document.getElementById('login-button');
const signOutButton = document.getElementById('sign-out');
const userName = document.getElementById('user-name');
const grid = document.getElementById('grid');

async function me() {
  const res = await fetch('/gba/api/me');
  if (!res.ok) return null;
  return res.json();
}

async function startLogin() {
  const configResponse = await fetch('/gba/api/config');
  if (!configResponse.ok) throw new Error('Failed to fetch config');
  const config = await configResponse.json();
  const redirectUri = `${window.location.origin}/gba/api/auth/callback/google`;
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function loadRoms() {
  const res = await fetch('/gba/api/roms');
  if (!res.ok) throw new Error('Failed to fetch roms');
  const roms = await res.json();
  grid.innerHTML = '';
  if (!roms.length) {
    grid.innerHTML = '<p class="empty">No games yet. Add .gba files to the Drive folder.</p>';
    return;
  }
  for (const rom of roms) {
    const card = document.createElement('div');
    card.className = 'game-card';
    const cover = document.createElement('div');
    cover.className = 'cover';
    const img = document.createElement('img');
    img.alt = rom.title;
    img.src = rom.coverUrl || `/gba/api/cover?title=${encodeURIComponent(rom.title)}`;
    img.onerror = () => {
      img.remove();
      cover.textContent = rom.title.slice(0, 18);
    };
    cover.appendChild(img);
    const title = document.createElement('h3');
    title.textContent = rom.title;
    card.append(cover, title);
    card.addEventListener('click', () => {
      window.location.href = `/gba/play?id=${encodeURIComponent(rom.id)}`;
    });
    grid.appendChild(card);
  }
}

async function init() {
  loginButton.addEventListener('click', () => startLogin().catch(() => {
    alert('Failed to start Google sign-in.');
  }));
  signOutButton.addEventListener('click', async () => {
    await fetch('/gba/api/auth/logout', { method: 'POST' });
    window.location.href = '/gba';
  });

  const user = await me();
  if (!user) {
    signedOut.style.display = 'flex';
    signOutButton.style.display = 'none';
    return;
  }
  signedIn.style.display = 'block';
  userName.textContent = user.name || 'Signed in';
  try {
    await loadRoms();
  } catch {
    grid.innerHTML = '<p class="error">Failed to load games.</p>';
  }
}

init();
