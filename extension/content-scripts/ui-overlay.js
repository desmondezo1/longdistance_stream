
// VideoSync UI Overlay - Injected into video pages
// This creates a floating panel for room management and connection status

class VideoSyncUI {
  constructor() {
    this.container = null;
    this.isMinimized = false;
    this.connectionStatus = 'disconnected';
    this.roomId = null;
    this.userCount = 0;
    this.socket = null;
    this.userId = null;
    this.video = null;

    // Netflix Cadmium API integration
    this.cadmiumReady = false;
    this.useCadmium = false;

    // Per-tab storage (sessionStorage-based)
    this.tabSessionId = null;
    this.username = null;

    // Reconnection handling
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 2000; // Start with 2 seconds
    this.reconnectTimer = null;
    this.isReconnecting = false;

    // Connection details for reconnection
    this.lastServerUrl = null;
    this.lastApiKey = null;

    // Heartbeat to keep connection alive
    this.heartbeatInterval = null;
    this.heartbeatTimer = 30000; // Send ping every 30 seconds
    this.missedHeartbeats = 0;
    this.maxMissedHeartbeats = 3;

    // Storage cleanup heartbeat
    this.storageHeartbeat = null;

    // Setup cleanup on page unload
    window.addEventListener('beforeunload', () => this.cleanupOnClose());

    this.init();
  }

  async init() {
    console.log('[VideoSync UI] Initializing...');

    // Initialize per-tab session ID
    this.initTabSession();

    // Set up Cadmium message listener (before everything else)
    this.setupCadmiumListener();

    // Check if we're on Netflix and should use Cadmium
    const platform = this.detectPlatform();
    if (platform === 'netflix') {
      this.useCadmium = true;
      console.log('[VideoSync UI] Netflix detected - will use Cadmium API');

      // Initialize Cadmium
      window.postMessage({
        type: 'CADMIUM_INITIALIZE',
        source: 'videosync-content'
      }, '*');
    }

    // Check if this tab has a username
    this.username = sessionStorage.getItem('videoSyncUsername');

    if (!this.username) {
      // New tab - show username prompt
      this.showUsernamePrompt();
      return;
    }

    console.log(`[VideoSync UI] Username loaded: ${this.username}`);

    // Load per-tab configuration
    const config = await this.loadConfig();

    // Clean up old orphaned connection states
    this.cleanupOldConnectionStates();

    // Start storage heartbeat to keep lastActive updated
    this.startStorageHeartbeat();

    // Create UI
    this.createUI();

    // Find video element
    this.findVideo();

    // Check if we should auto-reconnect
    if (config.connectionState) {
      const shouldResume = this.shouldAutoReconnect(config.connectionState);

      if (shouldResume === true) {
        // Auto-reconnect (recent session)
        this.roomId = config.connectionState.roomId;
        this.connect(
          config.connectionState.serverUrl,
          config.connectionState.roomId,
          config.connectionState.apiKey
        );
      } else if (shouldResume === 'prompt') {
        // Show resume prompt
        this.showResumePrompt(config.connectionState);
      }
    }
  }

  loadConfig() {
    return new Promise((resolve) => {
      const storageKey = this.getStorageKey();
      chrome.storage.local.get([storageKey, 'userId', 'serverUrl', 'apiKey'], (result) => {
        resolve({
          connectionState: result[storageKey],
          userId: result.userId,
          serverUrl: result.serverUrl,
          apiKey: result.apiKey
        });
      });
    });
  }

  saveConfig(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  }

  /**
   * Initialize per-tab session ID from sessionStorage
   */
  initTabSession() {
    this.tabSessionId = sessionStorage.getItem('videoSyncTabSessionId');

    if (!this.tabSessionId) {
      // First time in this tab - create new ID
      this.tabSessionId = Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      sessionStorage.setItem('videoSyncTabSessionId', this.tabSessionId);
      console.log(`[VideoSync UI] Created new tab session: ${this.tabSessionId}`);
    } else {
      console.log(`[VideoSync UI] Restored tab session: ${this.tabSessionId}`);
    }
  }

  /**
   * Get per-tab storage key
   */
  getStorageKey() {
    if (!this.tabSessionId) {
      this.initTabSession();
    }
    return `connectionState_${this.tabSessionId}`;
  }

  /**
   * Save connection state per-tab
   */
  async saveConnectionState(connectionState) {
    const storageKey = this.getStorageKey();
    return new Promise((resolve) => {
      chrome.storage.local.set({
        [storageKey]: {
          ...connectionState,
          lastActive: Date.now()
        }
      }, resolve);
    });
  }

  /**
   * Check if should auto-reconnect
   */
  shouldAutoReconnect(connectionState) {
    if (!connectionState || !connectionState.timestamp) {
      return false;
    }

    const timeSinceLastSession = Date.now() - connectionState.timestamp;

    // If less than 1 minute, auto-reconnect
    if (timeSinceLastSession < 60 * 1000) {
      return true;
    }

    // If 1-5 minutes, show resume prompt
    if (timeSinceLastSession < 5 * 60 * 1000) {
      return 'prompt';
    }

    // Too old, don't reconnect
    return false;
  }

  /**
   * Show username prompt for new tabs
   */
  showUsernamePrompt() {
    const overlay = document.createElement('div');
    overlay.id = 'vs-username-overlay';
    overlay.innerHTML = `
      <style>
        #vs-username-overlay {
          position: fixed;
          top: 0; left: 0;
          width: 100vw; height: 100vh;
          background: rgba(0, 0, 0, 0.85);
          z-index: 9999999;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .vs-username-card {
          background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
          border: 2px solid #444;
          border-radius: 16px;
          padding: 40px;
          max-width: 420px;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.9);
        }
        .vs-username-card h2 {
          color: #fff;
          margin: 0 0 10px 0;
          font-size: 28px;
        }
        .vs-username-card p {
          color: #999;
          margin: 0 0 30px 0;
          font-size: 14px;
          line-height: 1.5;
        }
        .vs-username-card input {
          width: 100%;
          padding: 14px;
          font-size: 16px;
          border: 2px solid #444;
          border-radius: 10px;
          background: #1a1a1a;
          color: #fff;
          margin-bottom: 20px;
          box-sizing: border-box;
          transition: border-color 0.2s;
        }
        .vs-username-card input:focus {
          outline: none;
          border-color: #0066ff;
        }
        .vs-username-card button {
          width: 100%;
          padding: 14px;
          font-size: 16px;
          font-weight: 600;
          background: #0066ff;
          color: #fff;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          transition: background 0.2s;
        }
        .vs-username-card button:hover {
          background: #0052cc;
        }
        .vs-username-card button:disabled {
          background: #333;
          cursor: not-allowed;
        }
      </style>
      <div class="vs-username-card">
        <h2>👋 Welcome to VideoSync!</h2>
        <p>Enter your name to start watching with friends</p>
        <input id="vs-username-input"
               type="text"
               placeholder="Your name (e.g., Alice)"
               maxlength="20"
               autofocus />
        <button id="vs-username-save">Continue</button>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = document.getElementById('vs-username-input');
    const button = document.getElementById('vs-username-save');

    input.focus();

    const saveUsername = () => {
      const username = input.value.trim();

      if (!username || username.length < 2) {
        input.style.borderColor = '#ff4444';
        input.placeholder = 'Please enter at least 2 characters';
        return;
      }

      // Save to sessionStorage
      sessionStorage.setItem('videoSyncUsername', username);
      this.username = username;

      // Remove overlay
      overlay.remove();

      console.log(`[VideoSync UI] Username set: ${username}`);

      // Continue initialization
      this.createUI();
      this.findVideo();

      // Clean up old states
      this.cleanupOldConnectionStates();

      // Start storage heartbeat
      this.startStorageHeartbeat();
    };

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        saveUsername();
      }
    });

    button.onclick = saveUsername;
  }

  /**
   * Show resume prompt for previous session
   */
  showResumePrompt(connectionState) {
    const timeSince = Date.now() - connectionState.timestamp;
    const minutesAgo = Math.floor(timeSince / 60000);
    const timeText = minutesAgo < 1 ? 'just now' : `${minutesAgo} minute${minutesAgo > 1 ? 's' : ''} ago`;

    const overlay = document.createElement('div');
    overlay.id = 'vs-resume-overlay';
    overlay.innerHTML = `
      <style>
        #vs-resume-overlay {
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 9999998;
          animation: slideIn 0.3s ease-out;
        }
        @keyframes slideIn {
          from { transform: translateX(400px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .vs-resume-card {
          background: rgba(0, 0, 0, 0.95);
          border: 2px solid #444;
          border-radius: 12px;
          padding: 20px;
          min-width: 280px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .vs-resume-card h3 {
          color: #fff;
          margin: 0 0 15px 0;
          font-size: 16px;
        }
        .vs-resume-card p {
          color: #999;
          margin: 5px 0;
          font-size: 13px;
        }
        .vs-resume-card .vs-resume-buttons {
          display: flex;
          gap: 10px;
          margin-top: 15px;
        }
        .vs-resume-card button {
          flex: 1;
          padding: 10px;
          font-size: 14px;
          font-weight: 600;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .vs-resume-card .vs-resume-yes {
          background: #0066ff;
          color: #fff;
        }
        .vs-resume-card .vs-resume-yes:hover {
          background: #0052cc;
        }
        .vs-resume-card .vs-resume-no {
          background: #333;
          color: #fff;
        }
        .vs-resume-card .vs-resume-no:hover {
          background: #444;
        }
      </style>
      <div class="vs-resume-card">
        <h3>Resume Watch Party?</h3>
        <p><strong>Room:</strong> ${connectionState.roomId}</p>
        <p><strong>Platform:</strong> ${connectionState.platform || 'Unknown'}</p>
        <p><strong>Last active:</strong> ${timeText}</p>
        <div class="vs-resume-buttons">
          <button class="vs-resume-yes">Resume</button>
          <button class="vs-resume-no">Start New</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('.vs-resume-yes').onclick = () => {
      overlay.remove();
      this.roomId = connectionState.roomId;
      this.connect(
        connectionState.serverUrl,
        connectionState.roomId,
        connectionState.apiKey
      );
    };

    overlay.querySelector('.vs-resume-no').onclick = async () => {
      overlay.remove();
      const storageKey = this.getStorageKey();
      await chrome.storage.local.remove(storageKey);
    };
  }

  /**
   * Start storage heartbeat to update lastActive
   */
  startStorageHeartbeat() {
    if (this.storageHeartbeat) {
      clearInterval(this.storageHeartbeat);
    }

    this.storageHeartbeat = setInterval(async () => {
      await this.updateLastActive();
    }, 30000); // Update every 30 seconds

    console.log('[VideoSync UI] Storage heartbeat started');
  }

  /**
   * Update lastActive timestamp
   */
  async updateLastActive() {
    if (!this.tabSessionId) return;

    const storageKey = this.getStorageKey();
    const result = await chrome.storage.local.get(storageKey);

    if (result[storageKey]) {
      result[storageKey].lastActive = Date.now();
      await chrome.storage.local.set(result);
    }
  }

  /**
   * Clean up old orphaned connection states
   */
  async cleanupOldConnectionStates() {
    try {
      const allStorage = await chrome.storage.local.get(null);
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      const keysToRemove = [];

      for (const [key, value] of Object.entries(allStorage)) {
        if (key.startsWith('connectionState_') && value.lastActive) {
          const age = now - value.lastActive;

          if (age > maxAge) {
            keysToRemove.push(key);
          }
        }
      }

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        console.log(`[VideoSync UI] Cleaned up ${keysToRemove.length} orphaned connection states`);
      }
    } catch (error) {
      console.error('[VideoSync UI] Cleanup error:', error);
    }
  }

  /**
   * Clean up this tab's storage on close
   */
  cleanupOnClose() {
    if (this.tabSessionId) {
      const storageKey = `connectionState_${this.tabSessionId}`;
      chrome.storage.local.remove(storageKey);
      console.log('[VideoSync UI] Cleaned up tab storage on close');
    }
  }

  createUI() {
    // Create container
    this.container = document.createElement('div');
    this.container.id = 'videosync-overlay';
    this.container.innerHTML = `
      <style>
        #videosync-overlay {
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          user-select: none;
        }

        .videosync-panel {
          background: rgba(0, 0, 0, 0.95);
          border: 2px solid #333;
          border-radius: 12px;
          padding: 16px;
          min-width: 280px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(10px);
        }

        .videosync-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          cursor: move;
        }

        .videosync-title {
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .videosync-status {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #666;
          animation: pulse 2s infinite;
        }

        .videosync-status.connected {
          background: #4CAF50;
        }

        .videosync-status.connecting {
          background: #FFC107;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .videosync-minimize {
          background: none;
          border: none;
          color: #888;
          cursor: pointer;
          font-size: 18px;
          padding: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .videosync-minimize:hover {
          color: #fff;
        }

        .videosync-content {
          color: #ccc;
          font-size: 13px;
        }

        .videosync-section {
          margin-bottom: 12px;
        }

        .videosync-label {
          color: #888;
          font-size: 11px;
          text-transform: uppercase;
          margin-bottom: 6px;
          font-weight: 600;
        }

        .videosync-input {
          width: 100%;
          padding: 8px;
          background: #222;
          border: 1px solid #444;
          border-radius: 6px;
          color: #fff;
          font-size: 13px;
          box-sizing: border-box;
        }

        .videosync-input:focus {
          outline: none;
          border-color: #007acc;
        }

        .videosync-button {
          width: 100%;
          padding: 10px;
          background: #007acc;
          border: none;
          border-radius: 6px;
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }

        .videosync-button:hover {
          background: #005a9e;
        }

        .videosync-button:disabled {
          background: #444;
          color: #888;
          cursor: not-allowed;
        }

        .videosync-button.secondary {
          background: #444;
          margin-top: 8px;
        }

        .videosync-button.secondary:hover {
          background: #555;
        }

        .videosync-room-code {
          background: #222;
          padding: 12px;
          border-radius: 6px;
          text-align: center;
          font-size: 24px;
          font-weight: bold;
          color: #fff;
          letter-spacing: 3px;
          margin: 12px 0;
          cursor: pointer;
        }

        .videosync-room-code:hover {
          background: #333;
        }

        .videosync-info {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-top: 1px solid #333;
          font-size: 12px;
        }

        .videosync-minimized {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.9);
          border: 2px solid #333;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          position: relative;
        }

        .videosync-minimized:hover {
          border-color: #007acc;
        }

        .videosync-minimized .videosync-status {
          width: 12px;
          height: 12px;
        }

        .videosync-log {
          max-height: 100px;
          overflow-y: auto;
          background: #111;
          border-radius: 6px;
          padding: 8px;
          font-size: 11px;
          font-family: monospace;
          margin-top: 8px;
        }

        .videosync-log-entry {
          padding: 2px 0;
          color: #888;
        }

        .videosync-log-entry.success {
          color: #4CAF50;
        }

        .videosync-log-entry.error {
          color: #f44336;
        }
      </style>

      <div class="videosync-panel">
        <div class="videosync-header">
          <div class="videosync-title">
            <div class="videosync-status" id="vs-status"></div>
            <span>VideoSync</span>
          </div>
          <button class="videosync-minimize" id="vs-minimize">−</button>
        </div>

        <div class="videosync-content" id="vs-content">
          <div id="vs-setup" style="display: none;">
            <div class="videosync-section">
              <div class="videosync-label">Server URL</div>
              <input type="text" class="videosync-input" id="vs-server-url" placeholder="ws://localhost:3000">
            </div>
            <div class="videosync-section">
              <div class="videosync-label">API Key</div>
              <input type="password" class="videosync-input" id="vs-api-key" placeholder="Enter API key">
            </div>
            <button class="videosync-button" id="vs-save-config">Save Configuration</button>
          </div>

          <div id="vs-menu" style="display: none;">
            <button class="videosync-button" id="vs-create-room">Create New Room</button>
            <button class="videosync-button secondary" id="vs-join-room">Join Room</button>
            <button class="videosync-button secondary" id="vs-show-settings">Settings</button>
          </div>

          <div id="vs-join-input" style="display: none;">
            <div class="videosync-section">
              <div class="videosync-label">Room Code</div>
              <input type="text" class="videosync-input" id="vs-room-code-input" placeholder="Enter 6-character code" maxlength="6">
            </div>
            <button class="videosync-button" id="vs-join-submit">Join Room</button>
            <button class="videosync-button secondary" id="vs-join-cancel">Cancel</button>
          </div>

          <div id="vs-connected" style="display: none;">
            <div class="videosync-room-code" id="vs-room-code" title="Click to copy">
              ------
            </div>
            <div class="videosync-info">
              <span>Users: <span id="vs-user-count">1</span></span>
              <span id="vs-sync-status">Syncing...</span>
            </div>
            <button class="videosync-button secondary" id="vs-disconnect">Leave Room</button>
            <div class="videosync-log" id="vs-log"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    // Set up event listeners
    this.setupEventListeners();

    // Show appropriate screen
    this.showScreen();
  }

  setupEventListeners() {
    // Minimize/maximize
    document.getElementById('vs-minimize').addEventListener('click', () => {
      this.toggleMinimize();
    });

    // Save configuration
    document.getElementById('vs-save-config').addEventListener('click', async () => {
      const serverUrl = document.getElementById('vs-server-url').value.trim();
      const apiKey = document.getElementById('vs-api-key').value.trim();

      if (!serverUrl || !apiKey) {
        alert('Please enter both server URL and API key');
        return;
      }

      await this.saveConfig('serverUrl', serverUrl);
      await this.saveConfig('apiKey', apiKey);

      this.log('Configuration saved', 'success');
      this.showScreen();
    });

    // Create room
    document.getElementById('vs-create-room').addEventListener('click', async () => {
      const config = await this.loadConfig();
      if (!config.serverUrl || !config.apiKey) {
        this.showSetup();
        return;
      }

      const roomId = this.generateRoomId();
      await this.connect(config.serverUrl, roomId, config.apiKey);
    });

    // Join room
    document.getElementById('vs-join-room').addEventListener('click', () => {
      this.showScreen('join-input');
    });

    document.getElementById('vs-join-submit').addEventListener('click', async () => {
      const roomCode = document.getElementById('vs-room-code-input').value.trim().toUpperCase();

      if (roomCode.length !== 6) {
        alert('Room code must be 6 characters');
        return;
      }

      const config = await this.loadConfig();
      await this.connect(config.serverUrl, roomCode, config.apiKey);
    });

    document.getElementById('vs-join-cancel').addEventListener('click', () => {
      this.showScreen('menu');
    });

    // Disconnect
    document.getElementById('vs-disconnect').addEventListener('click', () => {
      this.disconnect();
    });

    // Settings
    document.getElementById('vs-show-settings').addEventListener('click', () => {
      this.showSetup();
    });

    // Copy room code
    document.getElementById('vs-room-code').addEventListener('click', () => {
      navigator.clipboard.writeText(this.roomId);
      this.log('Room code copied!', 'success');
    });

    // Make draggable
    this.makeDraggable();
  }

  async showScreen(screen = null) {
    const config = await this.loadConfig();

    // Hide all screens
    document.getElementById('vs-setup').style.display = 'none';
    document.getElementById('vs-menu').style.display = 'none';
    document.getElementById('vs-join-input').style.display = 'none';
    document.getElementById('vs-connected').style.display = 'none';

    // Determine which screen to show
    if (screen) {
      document.getElementById(`vs-${screen}`).style.display = 'block';
    } else if (!config.serverUrl || !config.apiKey) {
      this.showSetup();
    } else if (this.roomId) {
      document.getElementById('vs-connected').style.display = 'block';
      document.getElementById('vs-room-code').textContent = this.roomId;
    } else {
      document.getElementById('vs-menu').style.display = 'block';
    }
  }

  showSetup() {
    chrome.storage.local.get(['serverUrl', 'apiKey'], (result) => {
      document.getElementById('vs-server-url').value = result.serverUrl || '';
      document.getElementById('vs-api-key').value = result.apiKey || '';
      this.showScreen('setup');
    });
  }

  generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  async connect(serverUrl, roomId, apiKey) {
    this.log(`Connecting to ${roomId}...`);
    this.updateStatus('connecting');

    try {
      // Generate or get user ID
      if (!this.userId) {
        const config = await this.loadConfig();
        if (config.userId) {
          this.userId = config.userId;
        } else {
          this.userId = 'user_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
          await this.saveConfig('userId', this.userId);
        }
      }

      // Save connection state per-tab
      await this.saveConnectionState({
        serverUrl,
        roomId,
        apiKey,
        username: this.username,
        platform: this.detectPlatform(),
        videoUrl: window.location.href,
        timestamp: Date.now()
      });
      this.roomId = roomId;

      // Save connection details for reconnection
      this.lastServerUrl = serverUrl;
      this.lastApiKey = apiKey;

      // Connect WebSocket
      this.socket = new WebSocket(serverUrl);

      this.socket.onopen = () => {
        this.log('Connected to server', 'success');

        // Reset reconnection state
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.missedHeartbeats = 0;

        // Start heartbeat
        this.startHeartbeat();

        this.socket.send(JSON.stringify({
          type: 'authenticate',
          apiKey: apiKey
        }));
      };

      this.socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('[VideoSync] ← Server message:', message.type, message);

          // Reset missed heartbeats on any message
          if (message.type === 'pong') {
            this.missedHeartbeats = 0;
            console.log('[VideoSync] ← Heartbeat pong received');
          } else {
            this.handleServerMessage(message);
          }
        } catch (err) {
          this.log(`Parse error: ${err.message}`, 'error');
        }
      };

      this.socket.onerror = (error) => {
        console.error('[VideoSync] WebSocket error:', error);
        this.log('Connection error', 'error');
        this.updateStatus('disconnected');
      };

      this.socket.onclose = (event) => {
        console.log('[VideoSync] WebSocket closed:', event.code, event.reason);
        this.log('Connection closed');
        this.updateStatus('disconnected');

        // Stop heartbeat
        this.stopHeartbeat();

        // Attempt to reconnect if we have connection details
        if (this.roomId && this.lastServerUrl && this.lastApiKey) {
          this.scheduleReconnect();
        }
      };

    } catch (error) {
      this.log(`Error: ${error.message}`, 'error');
      this.updateStatus('disconnected');
    }
  }

  handleServerMessage(message) {
    switch (message.type) {
      case 'authenticated':
        if (message.success) {
          this.log('Authenticated', 'success');
          this.socket.send(JSON.stringify({
            type: 'join-room',
            roomId: this.roomId,
            userId: this.userId
          }));
        }
        break;

      case 'room-joined':
        this.log(`Joined room ${message.roomId}`, 'success');
        this.updateStatus('connected');
        this.showScreen('connected');
        if (message.userCount) {
          this.updateUserCount(message.userCount);
        }
        break;

      case 'user-count':
        this.updateUserCount(message.count);
        break;

      case 'remote-event':
        this.handleRemoteEvent(message.data);
        break;

      case 'error':
        this.log(`Error: ${message.message}`, 'error');
        break;
    }
  }

  handleRemoteEvent(data) {
    this.log(`← ${data.action}`);
    const timeDiff = Date.now() - data.timestamp;

    // Ignore stale events
    if (timeDiff > 5000) {
      this.log('Ignoring stale event', 'error');
      return;
    }

    // Check if we should use Cadmium (Netflix)
    if (this.useCadmium && this.cadmiumReady) {
      // Use Cadmium API for Netflix
      this.handleRemoteEventWithCadmium(data, timeDiff);
      return;
    }

    // Fallback: if on Netflix but Cadmium not ready, show notification
    const platform = this.detectPlatform();
    if (platform === 'netflix' && !this.cadmiumReady) {
      this.showNetflixNotification(data);
      this.log('Cadmium not ready - showing notification only', 'warning');
      return;
    }

    // Standard HTML5 video handling for non-Netflix platforms
    if (!this.video) return;

    // Set flag to prevent echo (don't modify video element directly)
    this.remoteEventFlag = true;

    // Apply changes for non-Netflix platforms
    setTimeout(() => {
      switch (data.action) {
        case 'PLAY':
          this.video.currentTime = data.currentTime + (timeDiff / 1000);
          this.video.play().catch(err => {
            this.log(`Play error: ${err.message}`, 'error');
          });
          break;
        case 'PAUSE':
          this.video.currentTime = data.currentTime;
          this.video.pause();
          break;
        case 'SEEK':
          this.video.currentTime = data.currentTime;
          break;
        case 'RATE_CHANGE':
          this.video.playbackRate = data.playbackRate;
          break;
      }

      // Reset flag after action completes
      setTimeout(() => {
        this.remoteEventFlag = false;
      }, 200);
    }, 50);
  }

  /**
   * Handle remote events using Netflix Cadmium API
   */
  handleRemoteEventWithCadmium(data, timeDiff) {
    console.log('[VideoSync UI] Handling event with Cadmium:', data.action);

    // CRITICAL: Set flag BEFORE calling Cadmium to prevent echo
    // Cadmium will trigger HTML5 video events which we must ignore
    this.remoteEventFlag = true;

    switch (data.action) {
      case 'PLAY':
        // Seek to position accounting for network delay
        const playTimeMs = (data.currentTime + (timeDiff / 1000)) * 1000;
        window.postMessage({
          type: 'CADMIUM_SEEK',
          source: 'videosync-content',
          data: { time: playTimeMs }
        }, '*');

        // Then play
        setTimeout(() => {
          window.postMessage({
            type: 'CADMIUM_PLAY',
            source: 'videosync-content'
          }, '*');
        }, 100);
        break;

      case 'PAUSE':
        // Seek to exact position
        const pauseTimeMs = data.currentTime * 1000;
        window.postMessage({
          type: 'CADMIUM_SEEK',
          source: 'videosync-content',
          data: { time: pauseTimeMs }
        }, '*');

        // Then pause
        setTimeout(() => {
          window.postMessage({
            type: 'CADMIUM_PAUSE',
            source: 'videosync-content'
          }, '*');
        }, 100);
        break;

      case 'SEEK':
        const seekTimeMs = data.currentTime * 1000;
        window.postMessage({
          type: 'CADMIUM_SEEK',
          source: 'videosync-content',
          data: { time: seekTimeMs }
        }, '*');
        break;

      default:
        console.log('[VideoSync UI] Unsupported Cadmium action:', data.action);
    }

    // Reset flag after Cadmium actions complete and events fire
    // Cadmium operations + HTML5 event propagation takes ~200-300ms
    setTimeout(() => {
      this.remoteEventFlag = false;
      console.log('[VideoSync UI] remoteEventFlag reset after Cadmium action');
    }, 500);
  }

  showNetflixNotification(data) {
    // Show visual notification for Netflix users
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      background: rgba(229, 9, 20, 0.95);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: Arial, sans-serif;
      font-size: 14px;
      z-index: 999998;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      animation: slideIn 0.3s ease-out;
    `;

    const actionText = {
      'PLAY': '▶ Partner played video',
      'PAUSE': '⏸ Partner paused video',
      'SEEK': '⏩ Partner jumped in video'
    }[data.action] || `Partner: ${data.action}`;

    notification.textContent = actionText;
    document.body.appendChild(notification);

    // Add animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);

    // Remove after 2 seconds
    setTimeout(() => {
      notification.style.animation = 'slideIn 0.3s ease-out reverse';
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  }

  /**
   * Set up listener for Cadmium API messages from MAIN world script
   */
  setupCadmiumListener() {
    window.addEventListener('message', (event) => {
      // Only accept messages from same window
      if (event.source !== window) {
        return;
      }

      // Only handle Cadmium messages
      if (!event.data || event.data.source !== 'netflix-cadmium') {
        return;
      }

      const { type, success, state } = event.data;

      switch (type) {
        case 'CADMIUM_READY':
          this.cadmiumReady = true;
          console.log('[VideoSync UI] Cadmium API ready');
          this.log('✓ Netflix Cadmium API connected');
          break;

        case 'CADMIUM_PLAY_RESULT':
          if (success) {
            console.log('[VideoSync UI] Cadmium play successful');
          } else {
            console.error('[VideoSync UI] Cadmium play failed');
            this.log('Cadmium play failed', 'error');
          }
          break;

        case 'CADMIUM_PAUSE_RESULT':
          if (success) {
            console.log('[VideoSync UI] Cadmium pause successful');
          } else {
            console.error('[VideoSync UI] Cadmium pause failed');
            this.log('Cadmium pause failed', 'error');
          }
          break;

        case 'CADMIUM_SEEK_RESULT':
          if (success) {
            console.log('[VideoSync UI] Cadmium seek successful');
          } else {
            console.error('[VideoSync UI] Cadmium seek failed');
            this.log('Cadmium seek failed', 'error');
          }
          break;

        case 'CADMIUM_STATE_RESULT':
          console.log('[VideoSync UI] Cadmium state:', state);
          break;

        default:
          console.log('[VideoSync UI] Unknown Cadmium message:', type);
      }
    });

    console.log('[VideoSync UI] Cadmium listener set up');
  }

  disconnect() {
    // Stop WebSocket heartbeat
    this.stopHeartbeat();

    // Stop storage heartbeat
    if (this.storageHeartbeat) {
      clearInterval(this.storageHeartbeat);
      this.storageHeartbeat = null;
    }

    // Cancel any pending reconnection
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;

    if (this.socket) {
      this.socket.send(JSON.stringify({
        type: 'leave-room',
        roomId: this.roomId,
        userId: this.userId
      }));
      this.socket.close();
      this.socket = null;
    }

    this.roomId = null;
    this.lastServerUrl = null;
    this.lastApiKey = null;

    // Remove per-tab connection state
    const storageKey = this.getStorageKey();
    chrome.storage.local.remove(storageKey);
    this.updateStatus('disconnected');
    this.log('Disconnected', 'success');
    this.showScreen('menu');
  }

  /**
   * Start heartbeat to keep connection alive
   */
  startHeartbeat() {
    // Clear any existing heartbeat
    this.stopHeartbeat();

    console.log('[VideoSync] Starting heartbeat (30s interval)');

    this.heartbeatInterval = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        // Send ping
        this.socket.send(JSON.stringify({
          type: 'ping',
          timestamp: Date.now()
        }));
        console.log('[VideoSync] → Heartbeat ping sent');

        // Increment missed heartbeats
        this.missedHeartbeats++;

        // If too many missed heartbeats, assume connection is dead
        if (this.missedHeartbeats >= this.maxMissedHeartbeats) {
          console.warn('[VideoSync] Too many missed heartbeats, closing connection');
          this.log('Connection timeout', 'error');
          this.socket.close();
        }
      } else {
        console.warn('[VideoSync] Heartbeat: Socket not open');
      }
    }, this.heartbeatTimer);
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log('[VideoSync] Heartbeat stopped');
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  scheduleReconnect() {
    if (this.isReconnecting) {
      console.log('[VideoSync] Reconnection already scheduled');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log('Max reconnection attempts reached', 'error');
      this.isReconnecting = false;
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    // Exponential backoff: 2s, 4s, 8s, 16s, max 30s
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

    console.log(`[VideoSync] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    this.log(`Reconnecting in ${Math.round(delay / 1000)}s... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 'warning');

    this.reconnectTimer = setTimeout(() => {
      console.log('[VideoSync] Attempting reconnection...');
      this.reconnect();
    }, delay);
  }

  /**
   * Attempt to reconnect
   */
  async reconnect() {
    if (!this.roomId || !this.lastServerUrl || !this.lastApiKey) {
      console.error('[VideoSync] Cannot reconnect: missing connection details');
      this.isReconnecting = false;
      return;
    }

    console.log('[VideoSync] Reconnecting to room:', this.roomId);
    this.log('Reconnecting...', 'warning');

    try {
      // Close existing socket if any
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }

      // Reconnect
      await this.connect(this.lastServerUrl, this.roomId, this.lastApiKey);
    } catch (error) {
      console.error('[VideoSync] Reconnection failed:', error);
      this.log('Reconnection failed', 'error');

      // Schedule another attempt
      this.scheduleReconnect();
    }
  }

  updateStatus(status) {
    this.connectionStatus = status;
    const statusEl = document.getElementById('vs-status');
    statusEl.className = `videosync-status ${status}`;
  }

  updateUserCount(count) {
    this.userCount = count;
    const el = document.getElementById('vs-user-count');
    if (el) el.textContent = count;
    this.log(`Users in room: ${count}`);
  }

  log(message, type = 'info') {
    const logEl = document.getElementById('vs-log');
    if (!logEl) return;

    const entry = document.createElement('div');
    entry.className = `videosync-log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${message}`;

    logEl.insertBefore(entry, logEl.firstChild);

    // Keep only last 20 entries
    while (logEl.children.length > 20) {
      logEl.removeChild(logEl.lastChild);
    }
  }

  findVideo() {
    const platform = this.detectPlatform();
    this.log(`Detecting video on ${platform}...`);

    // Platform-specific video detection
    switch (platform) {
      case 'netflix':
        this.video = this.findNetflixVideo();
        break;
      case 'youtube':
        this.video = this.findYouTubeVideo();
        break;
      case 'primevideo':
        this.video = this.findPrimeVideo();
        break;
      case 'disneyplus':
        this.video = this.findDisneyPlusVideo();
        break;
      default:
        this.video = this.findGenericVideo();
    }

    if (this.video) {
      this.log(`✓ Video found on ${platform}`, 'success');
      this.attachVideoListeners();
    } else {
      this.log(`Waiting for video player...`);
      setTimeout(() => this.findVideo(), 2000);
    }
  }

  detectPlatform() {
    const hostname = window.location.hostname;
    if (hostname.includes('netflix.com')) return 'netflix';
    if (hostname.includes('youtube.com')) return 'youtube';
    if (hostname.includes('primevideo.com') || hostname.includes('amazon.com')) return 'primevideo';
    if (hostname.includes('disneyplus.com')) return 'disneyplus';
    return 'unknown';
  }

  findNetflixVideo() {
    // Netflix uses a custom video player
    // Try multiple selectors
    let video = document.querySelector('video');

    if (!video) {
      // Netflix often puts video in a specific container
      const playerContainer = document.querySelector('.watch-video');
      if (playerContainer) {
        video = playerContainer.querySelector('video');
      }
    }

    if (!video) {
      // Try shadow DOM
      video = this.findVideoInShadowDOM();
    }

    if (!video) {
      // Netflix sometimes uses specific class names
      const containers = [
        '.NFPlayer',
        '.PlayerView',
        '#appMountPoint video',
        '[data-uia="player"] video'
      ];

      for (const selector of containers) {
        video = document.querySelector(selector);
        if (video) break;
      }
    }

    return video;
  }

  findYouTubeVideo() {
    // YouTube standard video element
    return document.querySelector('video.html5-main-video') ||
           document.querySelector('video') ||
           document.querySelector('.html5-video-player video');
  }

  findPrimeVideo() {
    // Prime Video
    return document.querySelector('video.rendererContainer') ||
           document.querySelector('video[class*="video"]') ||
           document.querySelector('video');
  }

  findDisneyPlusVideo() {
    // Disney+
    return document.querySelector('video[class*="video"]') ||
           document.querySelector('.btm-media-client-element video') ||
           document.querySelector('video');
  }

  findGenericVideo() {
    // Generic fallback
    let video = document.querySelector('video');

    if (!video) {
      video = this.findVideoInShadowDOM();
    }

    return video;
  }

  findVideoInShadowDOM() {
    // Deep search in shadow DOM
    const findInNode = (node) => {
      if (node.tagName === 'VIDEO') {
        return node;
      }

      // Check shadow root
      if (node.shadowRoot) {
        const video = node.shadowRoot.querySelector('video');
        if (video) return video;

        // Recursively search shadow root children
        for (const child of node.shadowRoot.children) {
          const found = findInNode(child);
          if (found) return found;
        }
      }

      // Search regular children
      for (const child of node.children || []) {
        const found = findInNode(child);
        if (found) return found;
      }

      return null;
    };

    return findInNode(document.body);
  }

  attachVideoListeners() {
    // Use a WeakMap to track remote events without modifying the video element
    // This prevents Netflix DRM from detecting our modifications
    this.remoteEventFlag = false;

    // Use passive listeners to avoid blocking Netflix's DRM
    const options = { passive: true, capture: false };

    this.video.addEventListener('play', () => {
      if (!this.remoteEventFlag && this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.log('→ PLAY');
        // Use setTimeout to avoid blocking the play event
        setTimeout(() => {
          const eventData = {
            type: 'sync-event',
            roomId: this.roomId,
            userId: this.userId,
            data: {
              action: 'PLAY',
              currentTime: this.video.currentTime,
              timestamp: Date.now()
            }
          };
          console.log('[VideoSync] → Sending PLAY event:', eventData);
          this.socket.send(JSON.stringify(eventData));
        }, 0);
      } else if (this.remoteEventFlag) {
        console.log('[VideoSync] Skipping PLAY send (remote event)');
      }
    }, options);

    this.video.addEventListener('pause', () => {
      if (!this.remoteEventFlag && this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.log('→ PAUSE');
        setTimeout(() => {
          this.socket.send(JSON.stringify({
            type: 'sync-event',
            roomId: this.roomId,
            userId: this.userId,
            data: {
              action: 'PAUSE',
              currentTime: this.video.currentTime,
              timestamp: Date.now()
            }
          }));
        }, 0);
      } else if (this.remoteEventFlag) {
        console.log('[VideoSync] Skipping PAUSE send (remote event)');
      }
    }, options);

    this.video.addEventListener('seeked', () => {
      if (!this.remoteEventFlag && this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.log('→ SEEK');
        setTimeout(() => {
          this.socket.send(JSON.stringify({
            type: 'sync-event',
            roomId: this.roomId,
            userId: this.userId,
            data: {
              action: 'SEEK',
              currentTime: this.video.currentTime,
              timestamp: Date.now()
            }
          }));
        }, 0);
      } else if (this.remoteEventFlag) {
        console.log('[VideoSync] Skipping SEEK send (remote event)');
      }
    }, options);

    this.log('Event listeners attached (passive mode)');
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    const panel = this.container.querySelector('.videosync-panel');
    const content = document.getElementById('vs-content');
    const minimizeBtn = document.getElementById('vs-minimize');

    if (this.isMinimized) {
      content.style.display = 'none';
      minimizeBtn.textContent = '+';
      panel.style.minWidth = 'auto';
    } else {
      content.style.display = 'block';
      minimizeBtn.textContent = '−';
      panel.style.minWidth = '280px';
    }
  }

  makeDraggable() {
    const header = this.container.querySelector('.videosync-header');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      initialX = e.clientX - this.container.offsetLeft;
      initialY = e.clientY - this.container.offsetTop;
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;

      this.container.style.left = currentX + 'px';
      this.container.style.top = currentY + 'px';
      this.container.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }
}

// Initialize UI when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new VideoSyncUI();
  });
} else {
  new VideoSyncUI();
}
