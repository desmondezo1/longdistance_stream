const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

// Store rooms and their users
const rooms = new Map();

// Create WebSocket server
const wss = new WebSocket.Server({ port: PORT });

console.log(`[VideoSync Server] Running on port ${PORT}`);

wss.on('connection', (ws) => {
  console.log('[Server] New client connected');

  let clientRoom = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleMessage(ws, data);
    } catch (err) {
      console.error('[Server] Failed to parse message:', err);
    }
  });

  ws.on('close', () => {
    console.log('[Server] Client disconnected');

    if (clientRoom) {
      leaveRoom(ws, clientRoom);
    }
  });

  ws.on('error', (error) => {
    console.error('[Server] WebSocket error:', error);
  });

  function handleMessage(ws, message) {
    const { type, roomId, data } = message;

    switch (type) {
      case 'join-room':
        joinRoom(ws, roomId);
        clientRoom = roomId;
        break;

      case 'sync-event':
        // Broadcast sync event to all other users in the room
        broadcastToRoom(roomId, ws, {
          type: 'remote-event',
          data: data
        });
        break;

      case 'request-sync':
        // Request sync state from other user
        broadcastToRoom(roomId, ws, {
          type: 'sync-request',
          data: data
        });
        break;

      default:
        console.log('[Server] Unknown message type:', type);
    }
  }

  function joinRoom(ws, roomId) {
    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
      console.log('[Server] Room created:', roomId);
    }

    // Add user to room
    rooms.get(roomId).add(ws);
    ws.roomId = roomId;

    const userCount = rooms.get(roomId).size;
    console.log(`[Server] User joined room ${roomId} (${userCount} users)`);

    // Notify user they joined
    ws.send(JSON.stringify({
      type: 'room-joined',
      roomId: roomId
    }));

    // Broadcast user count to all users in room
    broadcastToRoom(roomId, null, {
      type: 'user-count',
      count: userCount
    });
  }

  function leaveRoom(ws, roomId) {
    if (rooms.has(roomId)) {
      rooms.get(roomId).delete(ws);

      const userCount = rooms.get(roomId).size;
      console.log(`[Server] User left room ${roomId} (${userCount} users remaining)`);

      // Remove room if empty
      if (userCount === 0) {
        rooms.delete(roomId);
        console.log('[Server] Room deleted:', roomId);
      } else {
        // Notify remaining users
        broadcastToRoom(roomId, null, {
          type: 'user-count',
          count: userCount
        });
      }
    }
  }

  function broadcastToRoom(roomId, excludeWs, message) {
    if (!rooms.has(roomId)) return;

    const messageStr = JSON.stringify(message);

    rooms.get(roomId).forEach((client) => {
      // Don't send to the sender or to disconnected clients
      if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }
});

// Health check endpoint (for Railway/Render)
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, closing server...');
  wss.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, closing server...');
  wss.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});
