// Simple popup - Only handles configuration
console.log('[VideoSync Popup] Loaded');

// Load current configuration
async function loadConfig() {
  const result = await chrome.storage.local.get(['serverUrl', 'apiKey', 'autoSync', 'connectionState']);

  document.getElementById('server-url').value = result.serverUrl || '';
  document.getElementById('api-key').value = result.apiKey || '';
  document.getElementById('auto-sync').checked = result.autoSync !== false;

  // Update status
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  if (result.serverUrl && result.apiKey) {
    statusDot.classList.add('configured');
    statusText.textContent = 'Configured';

    // Show current room if connected
    if (result.connectionState && result.connectionState.roomId) {
      document.getElementById('current-room').style.display = 'flex';
      document.getElementById('room-id').textContent = result.connectionState.roomId;
    }
  } else {
    statusDot.classList.remove('configured');
    statusText.textContent = 'Not configured';
  }
}

// Save configuration
document.getElementById('save-btn').addEventListener('click', async () => {
  const serverUrl = document.getElementById('server-url').value.trim();
  const apiKey = document.getElementById('api-key').value.trim();
  const autoSync = document.getElementById('auto-sync').checked;

  if (!serverUrl) {
    alert('Please enter a server URL');
    return;
  }

  if (!apiKey) {
    alert('Please enter an API key');
    return;
  }

  // Save to storage
  await chrome.storage.local.set({ serverUrl, apiKey, autoSync });

  console.log('[VideoSync Popup] Configuration saved');

  // Show success message
  const successMsg = document.getElementById('success-message');
  successMsg.classList.add('show');
  setTimeout(() => {
    successMsg.classList.remove('show');
  }, 3000);

  // Reload config to update UI
  loadConfig();
});

// Clear all data
document.getElementById('clear-btn').addEventListener('click', async () => {
  if (confirm('Clear all configuration and room data?')) {
    await chrome.storage.local.clear();
    console.log('[VideoSync Popup] All data cleared');

    // Reload config to update UI
    loadConfig();

    alert('All data cleared. Extension reset to default state.');
  }
});

// Load configuration on startup
loadConfig();
