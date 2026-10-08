// Helper to get the session cookie and extract userSub (first part before dot)
function getUserSubFromCookie() {
  const match = document.cookie.match(/session=([^;]+)/);
  if (match) {
    const sessionValue = match[1];
    const parts = sessionValue.split('.');
    if (parts.length === 2) {
      return parts[0]; // userSub
    }
  }
  return null;
}

// Helper to sign out
function signOut() {
  document.cookie = 'session=; Path=/gba; Expires=Thu, 01 Jan 1970 00:00:00 GMT;';
  window.location.href = '/gba';
}

// Main logic for the play page
async function initPlay() {
  // Check if user is logged in
  const userSub = getUserSubFromCookie();
  if (!userSub) {
    // Redirect to library if not logged in
    window.location.href = '/gba';
    return;
  }

  // Get rom ID from query parameter
  const urlParams = new URLSearchParams(window.location.search);
  const romId = urlParams.get('rom');
  if (!romId) {
    // If no rom specified, go back to library
    window.location.href = '/gba';
    return;
  }

  // Set up the emulator container and canvas
  const container = document.getElementById('emulator-container');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  // Set canvas size (we'll adjust based on the ROM's aspect ratio later)
  const width = 240; // GBA screen width
  const height = 160; // GBA screen height
  canvas.width = width;
  canvas.height = height;

  // Scale the canvas to fit the container while maintaining aspect ratio
  function resizeCanvas() {
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    let scale = Math.min(containerWidth / width, containerHeight / height);
    if (scale < 1) scale = 1; // Allow upscaling? We'll keep it at least 1x.
    canvas.style.width = `${width * scale}px`;
    canvas.style.height = `${height * scale}px`;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // Emulator instance
  let emulator = null;
  let isRunning = false;
  let lastSramSave = 0;
  const SRAM_SAVE_DEBOUNCE_MS = 5000; // 5 seconds
  let stateSaveInterval = null;
  const STATE_SAVE_INTERVAL_MS = 60000; // 60 seconds
  let isPaused = false;
  let visibilityHidden = false;

  // UI elements
  const menu = document.getElementById('menu');
  const menuClose = document.getElementById('menu-close');
  const menuBack = document.getElementById('menu-back');
  const menuSaveState = document.getElementById('menu-save-state');
  const menuLoadState = document.getElementById('menu-load-state');
  const menuFastForwardToggle = document.getElementById('menu-fast-forward-toggle');
  const controlsSaveState = document.getElementById('save-state');
  const controlsLoadState = document.getElementById('load-state');
  const controlsFastForward = document.getElementById('fast-forward');

  // Fast forward state
  let isFastForward = false;
  const NORMAL_SPEED = 1;
  const FAST_FORWARD_SPEED = 5;

  // Initialize the emulator
  try {
    // Import mgba-wasm (this will be available from npm install)
    const { MGBA } = await import('@thenick775/mgba-wasm');

    // Create emulator instance
    emulator = new MGBA({
      canvas: canvas,
      // Optional: configure audio, etc.
    });

    // Load the ROM
    await loadRom(romId);

    // Start the emulator
    await emulator.start();
    isRunning = true;

    // Set up input handling
    setupInput();

    // Set up auto save state interval
    startStateSaveInterval();

    // Set up visibility change handler for auto save state
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Update UI
    updateMenuFastForwardButton();

  } catch (error) {
    console.error('Failed to initialize emulator:', error);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ff0000';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Failed to load emulator', width / 2, height / 2 - 20);
    ctx.fillText(error.message, width / 2, height / 2 + 20);
  }

  // Function to load ROM from API
  async function loadRom(romId) {
    try {
      const response = await fetch(`/gba/api/rom/${romId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch ROM: ${response.status}`);
      }

      // Get the ROM as ArrayBuffer
      const romData = await response.arrayBuffer();

      // Load ROM into emulator
      await emulator.loadRom(romData);

      // Try to load existing SRAM
      await loadSram(romId);

    } catch (error) {
      console.error('Error loading ROM:', error);
      throw error;
    }
  }

  // Function to load SRAM
  async function loadSram(romId) {
    try {
      const response = await fetch(`/gba/api/sram/${romId}`);
      if (!response.ok) {
        // No SRAM yet, that's okay
        return;
      }

      const sramData = await response.arrayBuffer();
      await emulator.loadSram(sramData);
    } catch (error) {
      console.error('Error loading SRAM:', error);
      // Continue without SRAM
    }
  }

  // Function to save SRAM
  async function saveSram(romId) {
    try {
      const sramData = await emulator.saveSram();
      if (sramData) {
        const response = await fetch(`/gba/api/sram/${romId}`, {
          method: 'PUT',
          body: sramData,
          headers: {
            'Content-Type': 'application/octet-stream'
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to save SRAM: ${response.status}`);
        }

        lastSramSave = Date.now();
      }
    } catch (error) {
      console.error('Error saving SRAM:', error);
    }
  }

  // Function to save state
  async function saveState() {
    try {
      const stateData = await emulator.saveState();
      if (stateData) {
        const response = await fetch(`/gba/api/states/${romId}`, {
          method: 'POST',
          body: stateData,
          headers: {
            'Content-Type': 'application/octet-stream'
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to save state: ${response.status}`);
        }

        const result = await response.json();
        console.log('State saved:', result);

        // Update UI to show save indicator temporarily
        showSaveIndicator();
      }
    } catch (error) {
      console.error('Error saving state:', error);
    }
  }

  // Function to load state (most recent)
  async function loadState() {
    try {
      // Get list of states
      const response = await fetch(`/gba/api/states/${romId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch states: ${response.status}`);
      }

      const states = await response.json();
      if (states.length === 0) {
        console.log('No states to load');
        return;
      }

      // Load the most recent state (first in the list)
      const stateId = states[0].id;
      await loadStateById(stateId);

    } catch (error) {
      console.error('Error loading state:', error);
    }
  }

  // Function to load state by ID
  async function loadStateById(stateId) {
    try {
      const response = await fetch(`/gba/api/states/${romId}/${stateId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch state: ${response.status}`);
      }

      const stateData = await response.arrayBuffer();
      await emulator.loadState(stateData);

    } catch (error) {
      console.error('Error loading state by ID:', error);
    }
  }

  // Function to show temporary save indicator
  function showSaveIndicator() {
    // Create a temporary indicator
    const indicator = document.createElement('div');
    indicator.textContent = 'Saved ✓';
    indicator.style.position = 'fixed';
    indicator.style.bottom = '20px';
    indicator.style.right = '20px';
    indicator.style.background = 'rgba(0,0,0,0.7)';
    indicator.style.color = '#0f0';
    indicator.style.padding = '5px 10px';
    indicator.style.borderRadius = '4px';
    indicator.style.fontSize = '14px';
    indicator.style.zIndex = '1000';
    indicator.style.pointerEvents = 'none';

    document.body.appendChild(indicator);

    // Remove after 1.5 seconds
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    }, 1500);
  }

  // Function to handle visibility change
  function handleVisibilityChange() {
    visibilityHidden = document.hidden;
    if (visibilityHidden && isRunning && !isPaused) {
      // Pause emulator when tab becomes hidden
      pauseEmulator();
      // Save state when hiding
      saveState();
    } else if (!visibilityHidden && isPaused) {
      // Resume emulator when tab becomes visible
      resumeEmulator();
    }
  }

  // Function to pause emulator
  function pauseEmulator() {
    if (emulator && isRunning && !isPaused) {
      emulator.pause();
      isPaused = true;
      updateMenuFastForwardButton();
    }
  }

  // Function to resume emulator
  function resumeEmulator() {
    if (emulator && isRunning && isPaused) {
      emulator.resume();
      isPaused = false;
      updateMenuFastForwardButton();
    }
  }

  // Function to start state save interval
  function startStateSaveInterval() {
    // Clear existing interval if any
    if (stateSaveInterval) {
      clearInterval(stateSaveInterval);
    }

    // Set new interval
    stateSaveInterval = setInterval(() => {
      if (isRunning && !isPaused) {
        saveState();
      }
    }, STATE_SAVE_INTERVAL_MS);
  }

  // Function to stop state save interval
  function stopStateSaveInterval() {
    if (stateSaveInterval) {
      clearInterval(stateSaveInterval);
      stateSaveInterval = null;
    }
  }

  // Function to setup input handling
  function setupInput() {
    // Keyboard controls
    const keyMap = {
      // GBA buttons
      'ArrowUp': 'UP',
      'ArrowDown': 'DOWN',
      'ArrowLeft': 'LEFT',
      'ArrowRight': 'RIGHT',
      'z': 'A',      // Z = A button
      'x': 'B',      // X = B button
      'a': 'L',      // A = L button
      's': 'R',      // S = R button
      'Enter': 'START',
      'Backspace': 'SELECT'
    };

    // Key down handler
    window.addEventListener('keydown', (e) => {
      // Prevent scrolling with arrow keys
      if ([ 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight' ].includes(e.key)) {
        e.preventDefault();
      }

      const button = keyMap[e.key.toLowerCase()];
      if (button && emulator) {
        emulator.pressButton(button);
      }

      // Handle special keys
      if (e.key === 'f') {
        // Toggle fast forward with F key
        toggleFastForward();
        e.preventDefault();
      }
      if (e.key === 'm') {
        // Toggle menu with M key
        toggleMenu();
        e.preventDefault();
      }
    });

    // Key up handler
    window.addEventListener('keyup', (e) => {
      const button = keyMap[e.key.toLowerCase()];
      if (button && emulator) {
        emulator.releaseButton(button);
      }
    });

    // Touch controls (simple overlay buttons)
    setupTouchControls();

    // Gamepad support
    setupGamepad();
  }

  // Function to setup touch controls
  function setupTouchControls() {
    // Create touch control overlay
    const touchOverlay = document.createElement('div');
    touchOverlay.style.position = 'absolute';
    touchOverlay.style.top = '0';
    touchOverlay.style.left = '0';
    touchOverlay.style.width = '100%';
    touchOverlay.style.height = '100%';
    touchOverlay.style.pointerEvents = 'none';
    touchOverlay.style.zIndex = '100';
    container.appendChild(touchOverlay);

    // Define button positions (simple layout for mobile)
    const buttonSize = 60;
    const margin = 20;
    const bottom = container.clientHeight - buttonSize - margin;

    // Create touch buttons (we'll implement a simple version)
    // In a full implementation, you'd create proper touch buttons with visual feedback
    // For now, we'll rely on keyboard and gamepad

    // Actually, let's just add a simple touch area that maps to buttons
    // This is a simplified implementation
    container.addEventListener('touchstart', (e) => {
      e.preventDefault();
      // Map touch location to buttons (simplified)
      const touch = e.touches[0];
      const relX = touch.clientX / container.clientWidth;
      const relY = touch.clientY / container.clientHeight;

      // Simple quadrant mapping
      if (relX < 0.3 && relY > 0.7) {
        // Bottom left: D-pad
        if (relY < 0.8) {
          emulator.pressButton('LEFT');
        } else if (relY > 0.9) {
          emulator.pressButton('DOWN');
        }
      } else if (relX > 0.7 && relY > 0.7) {
        // Bottom right: Action buttons
        if (relX < 0.85) {
          emulator.pressButton('B'); // X button area
        } else {
          emulator.pressButton('A'); // Z button area
        }
      }
    }, { passive: false });

    container.addEventListener('touchend', (e) => {
      e.preventDefault();
      // Release all buttons on touch end (simplified)
      ['LEFT', 'RIGHT', 'UP', 'DOWN', 'A', 'B', 'L', 'R', 'START', 'SELECT'].forEach(button => {
        emulator.releaseButton(button);
      });
    }, { passive: false });
  }

  // Function to setup gamepad support
  function setupGamepad() {
    let gamepadActive = false;

    function handleGamepad() {
      if (!emulator || !isRunning || isPaused) return;

      const gamepad = navigator.getGamepads()[0];
      if (gamepad) {
        gamepadActive = true;

        // Button mapping (common layout)
        const buttonMap = {
          0: 'A',   // A button
          1: 'B',   // B button
          2: 'L',   // X button
          3: 'R',   // Y button
          4: 'L',   // Left bumper
          5: 'R',   // Right bumper
          6: 'SELECT', // Back
          7: 'START',  // Start
          12: 'UP',    // D-pad up
          13: 'DOWN',  // D-pad down
          14: 'LEFT',  // D-pad left
          15: 'RIGHT'  // D-pad right
        };

        // Press buttons
        buttonMap.forEach((button, index) => {
          if (gamepad.buttons[index] && gamepad.buttons[index].pressed) {
            emulator.pressButton(button);
          }
        });

        // Handle analog sticks for D-pad (simplified)
        const axisThreshold = 0.3;
        if (gamepad.axes[0] < -axisThreshold) {
          emulator.pressButton('LEFT');
        } else if (gamepad.axes[0] > axisThreshold) {
          emulator.pressButton('RIGHT');
        }
        if (gamepad.axes[1] < -axisThreshold) {
          emulator.pressButton('UP');
        } else if (gamepad.axes[1] > axisThreshold) {
          emulator.pressButton('DOWN');
        }
      } else if (gamepadActive) {
        // Gamepad disconnected, release all buttons
        ['LEFT', 'RIGHT', 'UP', 'DOWN', 'A', 'B', 'L', 'R', 'START', 'SELECT'].forEach(button => {
          emulator.releaseButton(button);
        });
        gamepadActive = false;
      }
    }

    // Check gamepad periodically
    setInterval(handleGamepad, 100);

    // Also listen for gamepad connected/disconnected events
    window.addEventListener('gamepadconnected', () => {
      console.log('Gamepad connected');
    });
    window.addEventListener('gamepaddisconnected', () => {
      console.log('Gamepad disconnected');
    });
  }

  // Function to toggle fast forward
  function toggleFastForward() {
    isFastForward = !isFastForward;
    if (emulator) {
      // Assuming the emulator has a way to set speed
      // This is a placeholder - actual implementation depends on mgba-wasm API
      // emulator.setSpeed(isFastForward ? FAST_FORWARD_SPEED : NORMAL_SPEED);
    }
    updateMenuFastForwardButton();
  }

  // Function to update fast forward button text
  function updateMenuFastForwardButton() {
    if (menuFastForwardToggle) {
      menuFastForwardToggle.textContent = isFastForward ? 'Disable Fast Forward' : 'Enable Fast Forward';
    }
  }

  // Function to toggle menu
  function toggleMenu() {
    const isHidden = menu.style.display === 'none';
    menu.style.display = isHidden ? 'block' : 'none';
  }

  // Menu button handlers
  menuClose.addEventListener('click', () => {
    menu.style.display = 'none';
  });

  menuBack.addEventListener('click', () => {
    // Stop emulator before going back
    if (emulator) {
      emulator.stop();
      isRunning = false;
    }
    stopStateSaveInterval();
    window.location.href = '/gba';
  });

  menuSaveState.addEventListener('click', async () => {
    await saveState();
  });

  menuLoadState.addEventListener('click', async () => {
    await loadState();
  });

  menuFastForwardToggle.addEventListener('click', () => {
    toggleFastForward();
  });

  controlsSaveState.addEventListener('click', async () => {
    await saveState();
  });

  controlsLoadState.addEventListener('click', async () => {
    await loadState();
  });

  controlsFastForward.addEventListener('click', () => {
    toggleFastForward();
  });

  // Handle SRAM auto-save from emulator (if supported)
  // This would be implemented by listening to emulator events
  // For now, we'll rely on periodic saving via the state save interval
  // In a full implementation, you'd listen for SRAM change events from the emulator

  // Periodic SRAM save check (debounced)
  setInterval(() => {
    const now = Date.now();
    if (isRunning && !isPaused && (now - lastSramSave) > SRAM_SAVE_DEBOUNCE_MS) {
      saveSram(romId);
    }
  }, 1000); // Check every second

  // Handle page unload
  window.addEventListener('beforeunload', () => {
    if (emulator && isRunning) {
      // Try to save SRAM and state before unloading
      saveSram(romId).catch(() => {});
      saveState().catch(() => {});

      // Stop emulator
      emulator.stop().catch(() => {});
    }
    stopStateSaveInterval();
  });
}

// Initialize the play page when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPlay);
} else {
  initPlay();
}