// Helper to get the session cookie and extract userSub (first part before dot)
function getUserSubFromCookie() {
  const match = document.cookie.match(/session=([^;]+)/);
  if (match) {
    const sessionValue = match[1];
    // The session value is userSub.signed
    const parts = sessionValue.split('.');
    if (parts.length === 2) {
      return parts[0]; // userSub
    }
  }
  return null;
}

// Helper to sign out
function signOut() {
  // Clear the session cookie
  document.cookie = 'session=; Path=/gba; Expires=Thu, 01 Jan 1970 00:00:00 GMT;';
  // Redirect to library page (which will show the login button again)
  window.location.href = '/gba';
}

// Main logic
async function initLibrary() {
  const userSub = getUserSubFromCookie();
  const loginButton = document.getElementById('login-button');
  const userNameSpan = document.getElementById('user-name');
  const grid = document.getElementById('grid');

  if (userSub) {
    // User is logged in
    loginButton.style.display = 'none';
    userNameSpan.textContent = 'Signed in'; // We could fetch the user's name, but for now just show this
    // Add a sign out button next to the user name
    const signOutButton = document.createElement('button');
    signOutButton.textContent = 'Sign out';
    signOutButton.addEventListener('click', signOut);
    userNameSpan.appendChild(signOutButton);

    // Fetch the list of roms
    try {
      const response = await fetch('/gba/api/roms');
      if (!response.ok) {
        throw new Error(`Failed to fetch roms: ${response.status}`);
      }
      const roms = await response.json();

      // Clear the grid
      grid.innerHTML = '';

      // Create a card for each rom
      roms.forEach(rom => {
        const card = document.createElement('div');
        card.className = 'game-card';

        // Image: try to load cover via our proxy, fallback to a placeholder
        const img = document.createElement('img');
        img.src = `/gba/api/cover?title=${encodeURIComponent(rom.title)}`;
        img.alt = rom.title;
        img.onerror = () => {
          img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjEwMCI+PHJlY3Qgd2lkdGg9IjE1MCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiNmNWY1ZjUiLz48dGV4dCB4PSI3NSIgeT0iNTAiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iI2ZmZiIganVzdGZpZWxkPSJtaWRkbGUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIyIiB0ZXh0LWFuY2hvcj0ibWlkZGxlPjIweDEwMDwvdGV4dD48L3N2Zz4=';
        };

        const title = document.createElement('h3');
        title.textContent = rom.title;

        // Make the card clickable to open the game
        card.addEventListener('click', () => {
          window.location.href = `/gba/play?rom=${rom.id}`;
        });

        card.appendChild(img);
        card.appendChild(title);
        grid.appendChild(card);
      });
    } catch (error) {
      console.error('Error loading roms:', error);
      grid.textContent = 'Failed to load games. Please try again later.';
    }
  } else {
    // User is not logged in
    loginButton.style.display = 'inline-block';
    userNameSpan.textContent = '';
    loginButton.addEventListener('click', async () => {
      try {
        const configResponse = await fetch('/gba/api/config');
        if (!configResponse.ok) {
          throw new Error('Failed to fetch config');
        }
        const config = await configResponse.json();
        const clientId = config.googleClientId;
        if (!clientId) {
          throw new Error('Google client ID not configured');
        }
        const redirectUri = `${window.location.origin}/gba/api/auth/callback/google`;
        const scope = 'openid email profile';
        const responseType = 'code';
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=${responseType}&access_type=offline`;
        window.location.href = authUrl;
      } catch (error) {
        console.error('Error initiating login:', error);
        alert('Failed to initiate login. Please try again later.');
      }
    });
  }
}

// Initialize the library page
initLibrary();