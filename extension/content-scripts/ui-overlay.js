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

    this.init();
  }

  async init() {
    console.log('[VideoSync UI] Initializing...');

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

    // Load configuration
    const config = await this.loadConfig();
    if (config.connectionState) {
      this.roomId = config.connectionState.roomId;
    }

    // Create UI
    this.createUI();

    // Find video element
    this.findVideo();

    // Restore connection if room exists
    if (this.roomId && config.connectionState) {
      this.connect(
        config.connectionState.serverUrl,
        config.connectionState.roomId,
        config.connectionState.apiKey
      );
    }
  }

  loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['connectionState', 'userId', 'serverUrl', 'apiKey'], resolve);
    });
  }

  saveConfig(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
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

      // Save connection state
      await this.saveConfig('connectionState', { serverUrl, roomId, apiKey });
      this.roomId = roomId;

      // Connect WebSocket
      this.socket = new WebSocket(serverUrl);

      this.socket.onopen = () => {
        this.log('Connected to server', 'success');
        this.socket.send(JSON.stringify({
          type: 'authenticate',
          apiKey: apiKey
        }));
      };

      this.socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('[VideoSync] ← Server message:', message.type, message);
          this.handleServerMessage(message);
        } catch (err) {
          this.log(`Parse error: ${err.message}`, 'error');
        }
      };

      this.socket.onerror = () => {
        this.log('Connection error', 'error');
        this.updateStatus('disconnected');
      };

      this.socket.onclose = () => {
        this.log('Connection closed');
        // Don't change status immediately - might reconnect
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
    chrome.storage.local.remove('connectionState');
    this.updateStatus('disconnected');
    this.log('Disconnected', 'success');
    this.showScreen('menu');
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
