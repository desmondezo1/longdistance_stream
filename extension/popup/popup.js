// DOM Elements
const settingsIcon = document.getElementById('settings-icon');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');

// Screens
const setupScreen = document.getElementById('setup-screen');
const mainMenuScreen = document.getElementById('main-menu-screen');
const joinInputScreen = document.getElementById('join-input-screen');
const creatorScreen = document.getElementById('creator-screen');
const joinerScreen = document.getElementById('joiner-screen');

// Setup Screen Elements
const setupServerUrl = document.getElementById('setup-server-url');
const setupApiKey = document.getElementById('setup-api-key');
const saveSetupBtn = document.getElementById('save-setup');

// Main Menu Elements
const createRoomBtn = document.getElementById('create-room');
const joinRoomBtn = document.getElementById('join-room');

// Join Input Elements
const roomIdInput = document.getElementById('room-id');
const joinRoomSubmitBtn = document.getElementById('join-room-submit');
const joinCancelBtn = document.getElementById('join-cancel');

// Creator Screen Elements
const creatorRoomCode = document.getElementById('creator-room-code');
const copyRoomCodeBtn = document.getElementById('copy-room-code');
const creatorUsersList = document.getElementById('creator-users-list');
const creatorDisconnectBtn = document.getElementById('creator-disconnect');

// Joiner Screen Elements
const joinerUsersList = document.getElementById('joiner-users-list');
const joinerDisconnectBtn = document.getElementById('joiner-disconnect');

// Settings Modal Elements
const settingsModal = document.getElementById('settings-modal');
const settingsServerUrl = document.getElementById('settings-server-url');
const settingsApiKey = document.getElementById('settings-api-key');
const autoSyncCheckbox = document.getElementById('auto-sync');
const closeModalBtn = document.getElementById('close-modal');
const cancelSettingsBtn = document.getElementById('cancel-settings');
const saveSettingsBtn = document.getElementById('save-settings');

// State
let currentState = 'setup'; // 'setup', 'main-menu', 'join-input', 'creator', 'joiner'
let isRoomCreator = false;
let currentRoomId = null;

// Initialize on load
chrome.storage.local.get(['serverUrl', 'apiKey', 'roomId', 'autoSync', 'isCreator', 'connectionState'], (result) => {
  // Check if setup is complete
  if (result.serverUrl && result.apiKey) {
    // Setup complete, show main menu or connected state
    settingsIcon.classList.remove('hidden');

    if (result.connectionState && result.connectionState.roomId) {
      // User has an active connection state
      isRoomCreator = result.isCreator || false;
      currentRoomId = result.connectionState.roomId;

      // Check if still connected
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
        if (chrome.runtime.lastError) {
          // Service worker not ready, show loading state
          console.log('[VideoSync] Service worker not ready');
          showScreen('main-menu');
          return;
        }

        if (response && response.connected) {
          // Still connected, show appropriate screen
          if (isRoomCreator) {
            showScreen('creator');
            creatorRoomCode.textContent = result.connectionState.roomId;
            // Request user count update
            setTimeout(() => {
              chrome.runtime.sendMessage({ type: 'GET_STATUS' });
            }, 500);
          } else {
            showScreen('joiner');
          }
        } else {
          // Not connected but has connection state - service worker is reconnecting
          // Show main menu and wait for ROOM_JOINED message
          showScreen('main-menu');
        }
      });
    } else {
      // Setup complete but no active connection, show main menu
      showScreen('main-menu');
    }
  } else {
    // First time setup
    showScreen('setup');
  }

  // Load auto-sync preference
  if (result.autoSync !== undefined) {
    autoSyncCheckbox.checked = result.autoSync;
  }
});

// Listen for connection status updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CONNECTION_STATUS') {
    updateConnectionStatus(message.connected);

    // Only return to main menu if we're actually disconnected (not just reconnecting)
    if (!message.connected && (currentState === 'creator' || currentState === 'joiner')) {
      // Check if we have connectionState - if yes, service worker is reconnecting
      chrome.storage.local.get(['connectionState'], (result) => {
        if (!result.connectionState) {
          // No connection state, truly disconnected
          showScreen('main-menu');
        }
        // Otherwise, wait for ROOM_JOINED message
      });
    }
  } else if (message.type === 'ROOM_JOINED') {
    currentRoomId = message.roomId;

    if (isRoomCreator) {
      creatorRoomCode.textContent = message.roomId;
      showScreen('creator');
    } else {
      showScreen('joiner');
    }
  } else if (message.type === 'USER_COUNT') {
    updateUsersList(message.count);
  } else if (message.type === 'ERROR') {
    alert('Error: ' + message.message);
  }
});

// Check current connection status
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  if (chrome.runtime.lastError || !response) {
    return;
  }
  updateConnectionStatus(response.connected);
});

// Setup Screen - Save Settings
saveSetupBtn.addEventListener('click', () => {
  const serverUrl = setupServerUrl.value.trim();
  const apiKey = setupApiKey.value.trim();

  if (!serverUrl) {
    alert('Please enter a server URL');
    return;
  }

  if (!apiKey) {
    alert('Please enter an API key');
    return;
  }

  // Save settings
  chrome.storage.local.set({
    serverUrl,
    apiKey,
    autoSync: autoSyncCheckbox.checked
  }, () => {
    settingsIcon.classList.remove('hidden');
    showScreen('main-menu');
  });
});

// Main Menu - Create Room
createRoomBtn.addEventListener('click', () => {
  chrome.storage.local.get(['serverUrl', 'apiKey', 'autoSync'], (result) => {
    if (!result.serverUrl || !result.apiKey) {
      alert('Please configure server settings first');
      return;
    }

    const roomId = generateRoomId();
    isRoomCreator = true;
    currentRoomId = roomId;

    // Save room info with creator flag
    chrome.storage.local.set({
      roomId,
      isCreator: true
    });

    // Connect to room
    chrome.runtime.sendMessage({
      type: 'CONNECT',
      serverUrl: result.serverUrl,
      roomId,
      apiKey: result.apiKey
    });

    // Update UI with room code but wait for ROOM_JOINED message to show screen
    creatorRoomCode.textContent = roomId;

    // Don't immediately show creator screen - wait for ROOM_JOINED message
    // This prevents the flash back to main menu if connection is slow
    console.log('[VideoSync] Connecting to room:', roomId);
  });
});

// Main Menu - Join Room
joinRoomBtn.addEventListener('click', () => {
  showScreen('join-input');
});

// Join Input - Submit
joinRoomSubmitBtn.addEventListener('click', () => {
  const roomId = roomIdInput.value.trim().toUpperCase();

  if (!roomId) {
    alert('Please enter a room code');
    return;
  }

  if (roomId.length !== 6) {
    alert('Room code must be 6 characters');
    return;
  }

  chrome.storage.local.get(['serverUrl', 'apiKey'], (result) => {
    if (!result.serverUrl || !result.apiKey) {
      alert('Please configure server settings first');
      return;
    }

    isRoomCreator = false;
    currentRoomId = roomId;

    // Save room info with joiner flag
    chrome.storage.local.set({
      roomId,
      isCreator: false
    });

    // Connect to room
    chrome.runtime.sendMessage({
      type: 'CONNECT',
      serverUrl: result.serverUrl,
      roomId,
      apiKey: result.apiKey
    });

    // Don't immediately show joiner screen - wait for ROOM_JOINED message
    console.log('[VideoSync] Joining room:', roomId);
  });
});

// Join Input - Cancel
joinCancelBtn.addEventListener('click', () => {
  roomIdInput.value = '';
  showScreen('main-menu');
});

// Creator - Copy Room Code
copyRoomCodeBtn.addEventListener('click', () => {
  const roomCode = creatorRoomCode.textContent;
  navigator.clipboard.writeText(roomCode).then(() => {
    const originalText = copyRoomCodeBtn.textContent;
    copyRoomCodeBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyRoomCodeBtn.textContent = originalText;
    }, 2000);
  });
});

// Creator - Disconnect
creatorDisconnectBtn.addEventListener('click', () => {
  disconnect();
});

// Joiner - Disconnect
joinerDisconnectBtn.addEventListener('click', () => {
  disconnect();
});

// Settings Icon - Open Modal
settingsIcon.addEventListener('click', () => {
  chrome.storage.local.get(['serverUrl', 'apiKey', 'autoSync'], (result) => {
    settingsServerUrl.value = result.serverUrl || '';
    settingsApiKey.value = result.apiKey || '';
    autoSyncCheckbox.checked = result.autoSync !== false;
    settingsModal.classList.remove('hidden');
  });
});

// Settings Modal - Close
closeModalBtn.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

cancelSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

// Settings Modal - Save
saveSettingsBtn.addEventListener('click', () => {
  const serverUrl = settingsServerUrl.value.trim();
  const apiKey = settingsApiKey.value.trim();
  const autoSync = autoSyncCheckbox.checked;

  if (!serverUrl) {
    alert('Please enter a server URL');
    return;
  }

  if (!apiKey) {
    alert('Please enter an API key');
    return;
  }

  chrome.storage.local.set({ serverUrl, apiKey, autoSync }, () => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      autoSync
    });
    settingsModal.classList.add('hidden');
  });
});

// Auto-sync checkbox change
autoSyncCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ autoSync: autoSyncCheckbox.checked });
  chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    autoSync: autoSyncCheckbox.checked
  });
});

// Helper Functions

function showScreen(screen) {
  currentState = screen;

  // Hide all screens
  setupScreen.classList.add('hidden');
  mainMenuScreen.classList.add('hidden');
  joinInputScreen.classList.add('hidden');
  creatorScreen.classList.add('hidden');
  joinerScreen.classList.add('hidden');

  // Show the requested screen
  switch(screen) {
    case 'setup':
      setupScreen.classList.remove('hidden');
      break;
    case 'main-menu':
      mainMenuScreen.classList.remove('hidden');
      break;
    case 'join-input':
      joinInputScreen.classList.remove('hidden');
      break;
    case 'creator':
      creatorScreen.classList.remove('hidden');
      break;
    case 'joiner':
      joinerScreen.classList.remove('hidden');
      break;
  }
}

function updateConnectionStatus(connected) {
  if (connected) {
    statusEl.classList.add('connected');
    statusText.textContent = 'Connected';
  } else {
    statusEl.classList.remove('connected');
    statusText.textContent = 'Disconnected';
  }
}

function updateUsersList(count) {
  const usersList = isRoomCreator ? creatorUsersList : joinerUsersList;
  usersList.innerHTML = '';

  if (isRoomCreator) {
    // Show host first
    const hostItem = document.createElement('div');
    hostItem.className = 'user-item';
    hostItem.textContent = 'You (Host)';
    usersList.appendChild(hostItem);

    // Show other users
    for (let i = 1; i < count; i++) {
      const userItem = document.createElement('div');
      userItem.className = 'user-item';
      userItem.textContent = `User ${i}`;
      usersList.appendChild(userItem);
    }
  } else {
    // Joiner view - just show user count
    for (let i = 0; i < count; i++) {
      const userItem = document.createElement('div');
      userItem.className = 'user-item';
      userItem.textContent = i === 0 ? 'Host' : `User ${i}`;
      usersList.appendChild(userItem);
    }
  }

  if (count === 1 && !isRoomCreator) {
    // Only host in room
    const userItem = document.createElement('div');
    userItem.className = 'user-item';
    userItem.textContent = 'Host';
    usersList.innerHTML = '';
    usersList.appendChild(userItem);
  }
}

function disconnect() {
  chrome.runtime.sendMessage({ type: 'DISCONNECT' });
  chrome.storage.local.remove(['roomId', 'isCreator']);
  isRoomCreator = false;
  currentRoomId = null;
  showScreen('main-menu');
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}
