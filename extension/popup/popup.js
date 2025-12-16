// DOM Elements
const serverUrlInput = document.getElementById('server-url');
const roomIdInput = document.getElementById('room-id');
const createRoomBtn = document.getElementById('create-room');
const joinRoomBtn = document.getElementById('join-room');
const leaveRoomBtn = document.getElementById('leave-room');
const copyRoomBtn = document.getElementById('copy-room');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const roomInfoEl = document.getElementById('room-info');
const currentRoomEl = document.getElementById('current-room');
const userCountEl = document.getElementById('user-count');
const autoSyncCheckbox = document.getElementById('auto-sync');

// Load saved settings
chrome.storage.local.get(['serverUrl', 'roomId', 'autoSync'], (result) => {
  if (result.serverUrl) {
    serverUrlInput.value = result.serverUrl;
  }
  if (result.roomId) {
    showRoomInfo(result.roomId);
  }
  if (result.autoSync !== undefined) {
    autoSyncCheckbox.checked = result.autoSync;
  }
});

// Listen for connection status updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CONNECTION_STATUS') {
    updateConnectionStatus(message.connected);
  } else if (message.type === 'ROOM_JOINED') {
    showRoomInfo(message.roomId);
  } else if (message.type === 'USER_COUNT') {
    userCountEl.textContent = message.count;
  }
});

// Check current connection status
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  if (response) {
    updateConnectionStatus(response.connected);
    if (response.roomId) {
      showRoomInfo(response.roomId);
    }
  }
});

// Create new room
createRoomBtn.addEventListener('click', () => {
  const serverUrl = serverUrlInput.value.trim();
  if (!serverUrl) {
    alert('Please enter a server URL');
    return;
  }

  const roomId = generateRoomId();
  roomIdInput.value = roomId;

  chrome.storage.local.set({ serverUrl, roomId, autoSync: autoSyncCheckbox.checked });

  chrome.runtime.sendMessage({
    type: 'CONNECT',
    serverUrl,
    roomId
  });
});

// Join existing room
joinRoomBtn.addEventListener('click', () => {
  const serverUrl = serverUrlInput.value.trim();
  const roomId = roomIdInput.value.trim();

  if (!serverUrl) {
    alert('Please enter a server URL');
    return;
  }

  if (!roomId) {
    alert('Please enter a room code');
    return;
  }

  chrome.storage.local.set({ serverUrl, roomId, autoSync: autoSyncCheckbox.checked });

  chrome.runtime.sendMessage({
    type: 'CONNECT',
    serverUrl,
    roomId
  });
});

// Leave room
leaveRoomBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'DISCONNECT' });
  chrome.storage.local.remove(['roomId']);
  hideRoomInfo();
});

// Copy room code
copyRoomBtn.addEventListener('click', () => {
  const roomId = currentRoomEl.textContent;
  navigator.clipboard.writeText(roomId).then(() => {
    copyRoomBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyRoomBtn.textContent = 'Copy';
    }, 2000);
  });
});

// Save auto-sync preference
autoSyncCheckbox.addEventListener('change', () => {
  chrome.storage.local.set({ autoSync: autoSyncCheckbox.checked });
  chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    autoSync: autoSyncCheckbox.checked
  });
});

// Update connection status
function updateConnectionStatus(connected) {
  if (connected) {
    statusEl.classList.add('connected');
    statusText.textContent = 'Connected';
  } else {
    statusEl.classList.remove('connected');
    statusText.textContent = 'Disconnected';
  }
}

// Show room info
function showRoomInfo(roomId) {
  currentRoomEl.textContent = roomId;
  roomInfoEl.classList.remove('hidden');
}

// Hide room info
function hideRoomInfo() {
  roomInfoEl.classList.add('hidden');
}

// Generate random room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}
