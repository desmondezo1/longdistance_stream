// State
let socket = null;
let currentRoomId = null;
let currentServerUrl = null;
let isConnected = false;
let settings = { autoSync: true };

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'CONNECT':
      connect(message.serverUrl, message.roomId);
      break;

    case 'DISCONNECT':
      disconnect();
      break;

    case 'GET_STATUS':
      sendResponse({
        connected: isConnected,
        roomId: currentRoomId
      });
      break;

    case 'UPDATE_SETTINGS':
      settings = { ...settings, ...message };
      if (settings.autoSync && isConnected) {
        notifyContentScript('START_SYNC');
      } else {
        notifyContentScript('STOP_SYNC');
      }
      break;

    case 'SYNC_EVENT':
      // Forward sync event from content script to server
      if (socket && isConnected) {
        socket.send(JSON.stringify({
          type: 'sync-event',
          roomId: currentRoomId,
          data: message.data
        }));
      }
      break;

    case 'REQUEST_SYNC':
      // Request sync state from server
      if (socket && isConnected) {
        socket.send(JSON.stringify({
          type: 'request-sync',
          roomId: currentRoomId,
          data: message.data
        }));
      }
      break;
  }

  return true;
});

// Connect to server
function connect(serverUrl, roomId) {
  if (socket && isConnected) {
    disconnect();
  }

  currentServerUrl = serverUrl;
  currentRoomId = roomId;

  console.log('[VideoSync] Connecting to', serverUrl, 'room', roomId);

  try {
    socket = new WebSocket(serverUrl);

    socket.onopen = () => {
      console.log('[VideoSync] Connected to server');
      isConnected = true;

      // Join room
      socket.send(JSON.stringify({
        type: 'join-room',
        roomId: roomId
      }));

      // Notify popup
      notifyPopup({ type: 'CONNECTION_STATUS', connected: true });

      // Start auto-sync if enabled
      if (settings.autoSync) {
        notifyContentScript('START_SYNC');
      }
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
      } catch (err) {
        console.error('[VideoSync] Failed to parse message:', err);
      }
    };

    socket.onerror = (error) => {
      console.error('[VideoSync] WebSocket error:', error);
      isConnected = false;
      notifyPopup({ type: 'CONNECTION_STATUS', connected: false });
    };

    socket.onclose = () => {
      console.log('[VideoSync] Disconnected from server');
      isConnected = false;
      socket = null;
      notifyPopup({ type: 'CONNECTION_STATUS', connected: false });
      notifyContentScript('STOP_SYNC');

      // Attempt to reconnect after 5 seconds
      setTimeout(() => {
        if (currentServerUrl && currentRoomId) {
          console.log('[VideoSync] Attempting to reconnect...');
          connect(currentServerUrl, currentRoomId);
        }
      }, 5000);
    };
  } catch (err) {
    console.error('[VideoSync] Connection failed:', err);
    isConnected = false;
    notifyPopup({ type: 'CONNECTION_STATUS', connected: false });
  }
}

// Disconnect from server
function disconnect() {
  if (socket) {
    socket.close();
    socket = null;
  }
  isConnected = false;
  currentRoomId = null;
  notifyContentScript('STOP_SYNC');
  console.log('[VideoSync] Disconnected');
}

// Handle messages from server
function handleServerMessage(message) {
  console.log('[VideoSync] Server message:', message.type);

  switch (message.type) {
    case 'room-joined':
      console.log('[VideoSync] Joined room:', message.roomId);
      notifyPopup({
        type: 'ROOM_JOINED',
        roomId: message.roomId
      });
      break;

    case 'user-count':
      notifyPopup({
        type: 'USER_COUNT',
        count: message.count
      });
      break;

    case 'remote-event':
      // Forward to content script
      notifyContentScript('REMOTE_EVENT', message.data);
      break;

    case 'sync-state':
      // Partner's current state for heartbeat sync
      notifyContentScript('SYNC_STATE', message.data);
      break;
  }
}

// Notify popup
function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup might not be open, ignore error
  });
}

// Notify content script in active tab
async function notifyContentScript(type, data = null) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: type,
        data: data
      }).catch(() => {
        // Content script might not be loaded, ignore error
      });
    }
  } catch (err) {
    console.error('[VideoSync] Failed to notify content script:', err);
  }
}

// Load settings on startup
chrome.storage.local.get(['autoSync'], (result) => {
  if (result.autoSync !== undefined) {
    settings.autoSync = result.autoSync;
  }
});

console.log('[VideoSync] Service worker initialized');
