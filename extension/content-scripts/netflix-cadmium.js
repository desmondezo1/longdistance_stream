/**
 * Netflix Cadmium API Integration - MAIN WORLD Script
 *
 * This script runs in the MAIN world (page context) to access the netflix global object.
 * It communicates with the isolated content script (ui-overlay.js) via window.postMessage.
 *
 * For research purposes only.
 */

(function() {
  'use strict';

  console.log('[Netflix Cadmium] Script loaded in MAIN world');

  // Netflix Cadmium Player wrapper
  class NetflixCadmiumPlayer {
    constructor() {
      this.player = null;
      this.videoPlayer = null;
      this.sessionId = null;
      this.initialized = false;
      this.retryCount = 0;
      this.maxRetries = 10;
    }

    /**
     * Initialize the Cadmium player API
     */
    async initialize() {
      if (this.initialized) {
        return true;
      }

      try {
        // Wait for Netflix to be available
        if (typeof netflix === 'undefined' || !netflix.appContext) {
          console.log('[Netflix Cadmium] Netflix global not ready, retrying...');

          if (this.retryCount < this.maxRetries) {
            this.retryCount++;
            setTimeout(() => this.initialize(), 1000);
            return false;
          } else {
            throw new Error('Netflix global object not available after retries');
          }
        }

        // Access the Cadmium player API
        this.videoPlayer = netflix.appContext.state.playerApp.getAPI().videoPlayer;

        if (!this.videoPlayer) {
          throw new Error('Video player API not available');
        }

        // Get the player session
        const sessionIds = this.videoPlayer.getAllPlayerSessionIds();

        if (!sessionIds || sessionIds.length === 0) {
          console.log('[Netflix Cadmium] No player sessions yet, retrying...');

          if (this.retryCount < this.maxRetries) {
            this.retryCount++;
            setTimeout(() => this.initialize(), 1000);
            return false;
          } else {
            throw new Error('No player sessions available');
          }
        }

        this.sessionId = sessionIds[0];
        this.player = this.videoPlayer.getVideoPlayerBySessionId(this.sessionId);

        if (!this.player) {
          throw new Error('Failed to get player instance');
        }

        this.initialized = true;
        console.log('[Netflix Cadmium] Player initialized successfully', {
          sessionId: this.sessionId,
          availableMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(this.player))
        });

        // Notify content script that Cadmium is ready
        window.postMessage({
          type: 'CADMIUM_READY',
          source: 'netflix-cadmium'
        }, '*');

        return true;

      } catch (error) {
        console.error('[Netflix Cadmium] Initialization error:', error);

        // Retry initialization
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
          setTimeout(() => this.initialize(), 2000);
        }

        return false;
      }
    }

    /**
     * Play the video
     */
    play() {
      if (!this.initialized || !this.player) {
        console.error('[Netflix Cadmium] Player not initialized');
        return false;
      }

      try {
        this.player.play();
        console.log('[Netflix Cadmium] Play executed');
        return true;
      } catch (error) {
        console.error('[Netflix Cadmium] Play error:', error);
        return false;
      }
    }

    /**
     * Pause the video
     */
    pause() {
      if (!this.initialized || !this.player) {
        console.error('[Netflix Cadmium] Player not initialized');
        return false;
      }

      try {
        this.player.pause();
        console.log('[Netflix Cadmium] Pause executed');
        return true;
      } catch (error) {
        console.error('[Netflix Cadmium] Pause error:', error);
        return false;
      }
    }

    /**
     * Seek to a specific time (in milliseconds)
     * @param {number} timeMs - Time in milliseconds
     */
    seek(timeMs) {
      if (!this.initialized || !this.player) {
        console.error('[Netflix Cadmium] Player not initialized');
        return false;
      }

      try {
        this.player.seek(timeMs);
        console.log('[Netflix Cadmium] Seek to', timeMs, 'ms');
        return true;
      } catch (error) {
        console.error('[Netflix Cadmium] Seek error:', error);
        return false;
      }
    }

    /**
     * Get current playback time (in milliseconds)
     * @returns {number} Current time in milliseconds
     */
    getCurrentTime() {
      if (!this.initialized || !this.player) {
        console.error('[Netflix Cadmium] Player not initialized');
        return 0;
      }

      try {
        const time = this.player.getCurrentTime();
        return time;
      } catch (error) {
        console.error('[Netflix Cadmium] getCurrentTime error:', error);
        return 0;
      }
    }

    /**
     * Get video duration (in milliseconds)
     * @returns {number} Duration in milliseconds
     */
    getDuration() {
      if (!this.initialized || !this.player) {
        console.error('[Netflix Cadmium] Player not initialized');
        return 0;
      }

      try {
        const duration = this.player.getDuration();
        return duration;
      } catch (error) {
        console.error('[Netflix Cadmium] getDuration error:', error);
        return 0;
      }
    }

    /**
     * Check if video is paused
     * @returns {boolean}
     */
    isPaused() {
      if (!this.initialized || !this.player) {
        return true;
      }

      try {
        return this.player.isPaused();
      } catch (error) {
        console.error('[Netflix Cadmium] isPaused error:', error);
        return true;
      }
    }

    /**
     * Set volume (0 to 1)
     * @param {number} volume - Volume level between 0 and 1
     */
    setVolume(volume) {
      if (!this.initialized || !this.player) {
        console.error('[Netflix Cadmium] Player not initialized');
        return false;
      }

      try {
        this.player.setVolume(volume);
        console.log('[Netflix Cadmium] Volume set to', volume);
        return true;
      } catch (error) {
        console.error('[Netflix Cadmium] setVolume error:', error);
        return false;
      }
    }
  }

  // Create global instance
  const cadmiumPlayer = new NetflixCadmiumPlayer();

  // Listen for commands from content script
  window.addEventListener('message', (event) => {
    // Only accept messages from same origin
    if (event.source !== window) {
      return;
    }

    // Only handle our messages
    if (!event.data || event.data.source !== 'videosync-content') {
      return;
    }

    const { type, data } = event.data;

    switch (type) {
      case 'CADMIUM_INITIALIZE':
        cadmiumPlayer.initialize();
        break;

      case 'CADMIUM_PLAY':
        const playSuccess = cadmiumPlayer.play();
        window.postMessage({
          type: 'CADMIUM_PLAY_RESULT',
          source: 'netflix-cadmium',
          success: playSuccess
        }, '*');
        break;

      case 'CADMIUM_PAUSE':
        const pauseSuccess = cadmiumPlayer.pause();
        window.postMessage({
          type: 'CADMIUM_PAUSE_RESULT',
          source: 'netflix-cadmium',
          success: pauseSuccess
        }, '*');
        break;

      case 'CADMIUM_SEEK':
        if (data && typeof data.time === 'number') {
          const seekSuccess = cadmiumPlayer.seek(data.time);
          window.postMessage({
            type: 'CADMIUM_SEEK_RESULT',
            source: 'netflix-cadmium',
            success: seekSuccess
          }, '*');
        }
        break;

      case 'CADMIUM_GET_TIME':
        const currentTime = cadmiumPlayer.getCurrentTime();
        window.postMessage({
          type: 'CADMIUM_TIME_RESULT',
          source: 'netflix-cadmium',
          time: currentTime
        }, '*');
        break;

      case 'CADMIUM_GET_STATE':
        window.postMessage({
          type: 'CADMIUM_STATE_RESULT',
          source: 'netflix-cadmium',
          state: {
            initialized: cadmiumPlayer.initialized,
            isPaused: cadmiumPlayer.isPaused(),
            currentTime: cadmiumPlayer.getCurrentTime(),
            duration: cadmiumPlayer.getDuration()
          }
        }, '*');
        break;

      default:
        console.log('[Netflix Cadmium] Unknown message type:', type);
    }
  });

  // Auto-initialize when Netflix player loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => cadmiumPlayer.initialize(), 2000);
    });
  } else {
    setTimeout(() => cadmiumPlayer.initialize(), 2000);
  }

  console.log('[Netflix Cadmium] Message listener registered');

})();
