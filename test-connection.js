// Test WebSocket connection to server
const WebSocket = require('ws');

const SERVER_URL = 'ws://localhost:3000';
const API_KEY = 'mypasswordisstrong';
const ROOM_ID = 'DAK0XD';
const USER_ID = 'test_user_123';

console.log('=== Testing WebSocket Connection ===');
console.log('Server URL:', SERVER_URL);
console.log('API Key:', API_KEY);
console.log('Room ID:', ROOM_ID);
console.log('User ID:', USER_ID);
console.log('');

const socket = new WebSocket(SERVER_URL);

socket.on('open', () => {
  console.log('[Test] ✓ Connected to server');

  // Step 1: Authenticate
  console.log('[Test] Sending authenticate message...');
  socket.send(JSON.stringify({
    type: 'authenticate',
    apiKey: API_KEY
  }));
});

socket.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    console.log('[Test] ← Received:', message.type);

    if (message.type === 'authenticated') {
      if (message.success) {
        console.log('[Test] ✓ Authenticated successfully');

        // Step 2: Join room
        console.log('[Test] Sending join-room message...');
        socket.send(JSON.stringify({
          type: 'join-room',
          roomId: ROOM_ID,
          userId: USER_ID
        }));
      } else {
        console.log('[Test] ✗ Authentication failed');
        socket.close();
      }
    } else if (message.type === 'room-joined') {
      console.log('[Test] ✓ Joined room:', message.roomId);
      console.log('[Test] User count:', message.userCount);

      // Success! Close connection
      setTimeout(() => {
        console.log('[Test] Test successful - closing connection');
        socket.close();
      }, 1000);
    } else if (message.type === 'user-count') {
      console.log('[Test] User count updated:', message.count);
    } else if (message.type === 'error') {
      console.log('[Test] ✗ Server error:', message.message);
      socket.close();
    } else {
      console.log('[Test] Other message:', JSON.stringify(message));
    }
  } catch (err) {
    console.error('[Test] Failed to parse message:', err);
  }
});

socket.on('error', (error) => {
  console.error('[Test] ✗ WebSocket error:', error.message);
});

socket.on('close', () => {
  console.log('[Test] Connection closed');
  process.exit(0);
});

// Timeout after 5 seconds
setTimeout(() => {
  console.log('[Test] ✗ Test timeout - no response from server');
  socket.close();
  process.exit(1);
}, 5000);
