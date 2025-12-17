// Minimal Service Worker - Only handles configuration storage
// All connection logic is handled by the on-page UI (ui-overlay.js)

console.log('[VideoSync SW] Service worker initialized (config-only mode)');

// Register Netflix Cadmium script in MAIN world
// This allows the script to access the netflix global object
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[VideoSync SW] Registering Netflix Cadmium script in MAIN world');

  try {
    // Unregister any existing scripts first
    const existingScripts = await chrome.scripting.getRegisteredContentScripts();
    const netflixScriptIds = existingScripts
      .filter(script => script.id === 'netflix-cadmium')
      .map(script => script.id);

    if (netflixScriptIds.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: netflixScriptIds });
      console.log('[VideoSync SW] Unregistered existing Netflix Cadmium script');
    }

    // Register the Netflix Cadmium script in MAIN world
    await chrome.scripting.registerContentScripts([
      {
        id: 'netflix-cadmium',
        matches: ['*://*.netflix.com/*'],
        js: ['content-scripts/netflix-cadmium.js'],
        runAt: 'document_start',
        world: 'MAIN' // Run in page context to access netflix global
      }
    ]);

    console.log('[VideoSync SW] Netflix Cadmium script registered successfully');
  } catch (error) {
    console.error('[VideoSync SW] Failed to register Netflix Cadmium script:', error);
  }
});

// Listen for status requests from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[VideoSync SW] Received message:', message.type);

  switch (message.type) {
    case 'GET_STATUS':
      // Check if user has configuration
      chrome.storage.local.get(['serverUrl', 'apiKey', 'connectionState'], (result) => {
        sendResponse({
          configured: !!(result.serverUrl && result.apiKey),
          connected: !!result.connectionState,
          roomId: result.connectionState?.roomId || null
        });
      });
      return true; // Keep channel open for async response

    case 'SAVE_CONFIG':
      // Save configuration from popup
      const { serverUrl, apiKey, autoSync } = message;
      chrome.storage.local.set({ serverUrl, apiKey, autoSync }, () => {
        console.log('[VideoSync SW] Configuration saved');
        sendResponse({ success: true });
      });
      return true;

    case 'CLEAR_CONFIG':
      // Clear all configuration
      chrome.storage.local.clear(() => {
        console.log('[VideoSync SW] Configuration cleared');
        sendResponse({ success: true });
      });
      return true;

    default:
      console.log('[VideoSync SW] Unknown message type:', message.type);
  }

  return false;
});

console.log('[VideoSync SW] Ready - Waiting for configuration requests');
