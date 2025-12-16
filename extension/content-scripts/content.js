// State
let video = null;
let isRemoteEvent = false;
let syncInterval = null;

// Initialize
function init() {
  findVideo();
  if (!video) {
    // Video might load dynamically, try again after a delay
    setTimeout(init, 2000);
  }
}

// Find video element on the page
function findVideo() {
  // Try standard video tag
  video = document.querySelector('video');

  // If not found, try to find in shadow DOM (Netflix)
  if (!video) {
    const shadowHosts = document.querySelectorAll('*');
    for (const host of shadowHosts) {
      if (host.shadowRoot) {
        video = host.shadowRoot.querySelector('video');
        if (video) break;
      }
    }
  }

  if (video) {
    console.log('[VideoSync] Video element found');
    attachListeners();
  }
}

// Attach event listeners to video
function attachListeners() {
  // Play event
  video.addEventListener('play', () => {
    if (!isRemoteEvent) {
      console.log('[VideoSync] Local play event');
      sendEvent({
        action: 'PLAY',
        currentTime: video.currentTime,
        timestamp: Date.now()
      });
    }
    isRemoteEvent = false;
  });

  // Pause event
  video.addEventListener('pause', () => {
    if (!isRemoteEvent) {
      console.log('[VideoSync] Local pause event');
      sendEvent({
        action: 'PAUSE',
        currentTime: video.currentTime,
        timestamp: Date.now()
      });
    }
    isRemoteEvent = false;
  });

  // Seek event
  video.addEventListener('seeked', () => {
    if (!isRemoteEvent) {
      console.log('[VideoSync] Local seek event');
      sendEvent({
        action: 'SEEK',
        currentTime: video.currentTime,
        timestamp: Date.now()
      });
    }
    isRemoteEvent = false;
  });

  // Rate change (playback speed)
  video.addEventListener('ratechange', () => {
    if (!isRemoteEvent) {
      console.log('[VideoSync] Local rate change');
      sendEvent({
        action: 'RATE_CHANGE',
        playbackRate: video.playbackRate,
        timestamp: Date.now()
      });
    }
    isRemoteEvent = false;
  });

  console.log('[VideoSync] Event listeners attached');
}

// Send event to background script
function sendEvent(eventData) {
  chrome.runtime.sendMessage({
    type: 'SYNC_EVENT',
    data: eventData
  });
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REMOTE_EVENT') {
    handleRemoteEvent(message.data);
  } else if (message.type === 'START_SYNC') {
    startHeartbeatSync();
  } else if (message.type === 'STOP_SYNC') {
    stopHeartbeatSync();
  } else if (message.type === 'GET_VIDEO_STATE') {
    // Send current video state
    if (video) {
      sendResponse({
        currentTime: video.currentTime,
        paused: video.paused,
        playbackRate: video.playbackRate
      });
    }
  }
});

// Handle remote events from partner
function handleRemoteEvent(data) {
  if (!video) return;

  console.log('[VideoSync] Remote event received:', data.action);
  isRemoteEvent = true;

  const timeDiff = Date.now() - data.timestamp;

  // Ignore events older than 5 seconds (stale)
  if (timeDiff > 5000) {
    console.log('[VideoSync] Ignoring stale event');
    return;
  }

  switch (data.action) {
    case 'PLAY':
      video.currentTime = data.currentTime + (timeDiff / 1000);
      video.play().catch(err => console.error('[VideoSync] Play error:', err));
      break;

    case 'PAUSE':
      video.currentTime = data.currentTime;
      video.pause();
      break;

    case 'SEEK':
      video.currentTime = data.currentTime;
      break;

    case 'RATE_CHANGE':
      video.playbackRate = data.playbackRate;
      break;
  }
}

// Start heartbeat sync (check for drift every 5 seconds)
function startHeartbeatSync() {
  if (syncInterval) return;

  syncInterval = setInterval(() => {
    if (!video) return;

    // Request partner's state
    chrome.runtime.sendMessage({
      type: 'REQUEST_SYNC',
      data: {
        currentTime: video.currentTime,
        paused: video.paused
      }
    });
  }, 5000);

  console.log('[VideoSync] Heartbeat sync started');
}

// Stop heartbeat sync
function stopHeartbeatSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[VideoSync] Heartbeat sync stopped');
  }
}

// Check if times are in sync (within 1 second)
function checkSync(remoteTime, localTime) {
  const diff = Math.abs(remoteTime - localTime);
  if (diff > 1) {
    console.log('[VideoSync] Out of sync by', diff, 'seconds. Correcting...');
    isRemoteEvent = true;
    video.currentTime = remoteTime;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

console.log('[VideoSync] Content script loaded');
