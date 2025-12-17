require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'your-secret-api-key-change-this';
const ROOM_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
const ROOM_INACTIVE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

console.log('[Server] API_KEY loaded:', API_KEY ? '✓ (set)' : '✗ (using default)');

// Store rooms with user IDs, last activity, and room metadata
// Structure: roomId => {
//   users: Set<userId>,
//   userNames: Map<userId, username>,
//   lastActivity: timestamp,
//   connections: Map<userId, ws>,
//   metadata: { url, title, platform, createdAt, creatorUserId }
// }
const rooms = new Map();

// Create HTTP server for health checks
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// Create WebSocket server attached to HTTP server
const wss = new WebSocket.Server({ server });

server.listen(PORT, () => {
  console.log(`[VideoSync Server] WebSocket and HTTP running on port ${PORT}`);
});

wss.on('connection', (ws) => {
  console.log('[Server] New client connected');

  let clientRoom = null;
  let clientUserId = null;
  let isAuthenticated = false;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // First message must be authentication
      if (!isAuthenticated && data.type !== 'authenticate') {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Authentication required. Send authenticate message first.'
        }));
        ws.close();
        return;
      }

      handleMessage(ws, data);
    } catch (err) {
      console.error('[Server] Failed to parse message:', err);
    }
  });

  ws.on('close', () => {
    console.log('[Server] Client disconnected');

    // Don't remove user from room on disconnect - they might reconnect
    // Just remove their active connection
    if (clientRoom && clientUserId && rooms.has(clientRoom)) {
      const room = rooms.get(clientRoom);
      if (room.connections.has(clientUserId)) {
        room.connections.delete(clientUserId);
        console.log(`[Server] Removed active connection for user ${clientUserId} in room ${clientRoom}`);
      }
    }
  });

  ws.on('error', (error) => {
    console.error('[Server] WebSocket error:', error);
  });

  function handleMessage(ws, message) {
    const { type, roomId, data, apiKey, userId } = message;

    switch (type) {
      case 'authenticate':
        if (apiKey === API_KEY) {
          isAuthenticated = true;
          ws.send(JSON.stringify({
            type: 'authenticated',
            success: true
          }));
          console.log('[Server] Client authenticated');
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid API key'
          }));
          ws.close();
          console.log('[Server] Client failed authentication');
        }
        break;

      case 'join-room':
        if (!isAuthenticated) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Not authenticated'
          }));
          return;
        }
        if (!userId) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'userId required for join-room'
          }));
          return;
        }

        clientUserId = userId;
        clientRoom = roomId;
        joinRoom(ws, roomId, userId, message.metadata);
        break;

      case 'get-room-info':
        if (!isAuthenticated) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Not authenticated'
          }));
          return;
        }
        sendRoomInfo(ws, roomId);
        break;

      case 'sync-event':
        if (!isAuthenticated) return;
        if (!clientRoom) return;

        // Update room activity
        updateRoomActivity(roomId);

        // Broadcast sync event to all other users in the room
        broadcastToRoom(roomId, userId, {
          type: 'remote-event',
          data: data
        });
        break;

      case 'request-sync':
        if (!isAuthenticated) return;
        if (!clientRoom) return;

        // Update room activity
        updateRoomActivity(roomId);

        // Broadcast to other users asking for their state
        broadcastToRoom(roomId, userId, {
          type: 'sync-request',
          data: data,
          requesterId: userId
        });
        break;

      case 'sync-response':
        if (!isAuthenticated) return;
        if (!clientRoom) return;

        // Send sync response to the requester
        const targetUserId = data.targetUserId;
        sendToUser(roomId, targetUserId, {
          type: 'sync-state',
          data: data
        });
        break;

      case 'ping':
        // Respond to keepalive ping with pong
        if (roomId) {
          updateRoomActivity(roomId);
        }
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: Date.now()
        }));
        break;

      case 'leave-room':
        if (clientRoom && clientUserId) {
          leaveRoom(clientUserId, clientRoom);
          clientRoom = null;
          clientUserId = null;
        }
        break;

      default:
        console.log('[Server] Unknown message type:', type);
    }
  }

  function joinRoom(ws, roomId, userId, metadata) {
    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Set(),
        userNames: new Map(),
        lastActivity: Date.now(),
        connections: new Map(),
        metadata: metadata || null
      });
      console.log('[Server] Room created:', roomId, metadata ? 'with metadata' : 'without metadata');
    }

    const room = rooms.get(roomId);

    // If this is the first user and metadata is provided, save it
    if (room.users.size === 0 && metadata) {
      room.metadata = {
        ...metadata,
        creatorUserId: userId,
        createdAt: Date.now()
      };
      console.log('[Server] Room metadata set:', room.metadata);
    }

    // Add user to room if not already there
    if (!room.users.has(userId)) {
      room.users.add(userId);
      console.log(`[Server] User ${userId} joined room ${roomId} (${room.users.size} users)`);
    } else {
      console.log(`[Server] User ${userId} reconnected to room ${roomId}`);
    }

    // Store username if provided in metadata
    if (metadata && metadata.username) {
      room.userNames.set(userId, metadata.username);
      console.log(`[Server] Stored username for ${userId}: ${metadata.username}`);
    }

    // Store active connection
    room.connections.set(userId, ws);
    room.lastActivity = Date.now();

    const userCount = room.users.size;

    // Build user list with names
    const users = Array.from(room.users).map(uid => ({
      userId: uid,
      username: room.userNames.get(uid) || 'Anonymous',
      isCreator: uid === room.metadata?.creatorUserId
    }));

    console.log(`[Server] Built user list for room ${roomId}:`, users);

    // Notify user they joined with room metadata
    ws.send(JSON.stringify({
      type: 'room-joined',
      roomId: roomId,
      userCount: userCount,
      users: users,
      metadata: room.metadata
    }));

    console.log(`[Server] Sent room-joined to ${userId} with ${users.length} users`);

    // Broadcast updated user list to all users in room
    broadcastToRoom(roomId, null, {
      type: 'user-list',
      count: userCount,
      users: users
    });

    console.log(`[Server] Broadcasted user-list to room ${roomId} with ${users.length} users`);
  }

  function sendRoomInfo(ws, roomId) {
    if (!rooms.has(roomId)) {
      ws.send(JSON.stringify({
        type: 'room-info',
        exists: false,
        roomId: roomId
      }));
      return;
    }

    const room = rooms.get(roomId);
    ws.send(JSON.stringify({
      type: 'room-info',
      exists: true,
      roomId: roomId,
      userCount: room.users.size,
      metadata: room.metadata
    }));
  }

  function leaveRoom(userId, roomId) {
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.users.delete(userId);
      room.userNames.delete(userId);
      room.connections.delete(userId);

      const userCount = room.users.size;
      console.log(`[Server] User ${userId} left room ${roomId} (${userCount} users remaining)`);

      // Remove room if empty
      if (userCount === 0) {
        rooms.delete(roomId);
        console.log('[Server] Room deleted:', roomId);
      } else {
        // Build updated user list
        const users = Array.from(room.users).map(uid => ({
          userId: uid,
          username: room.userNames.get(uid) || 'Anonymous',
          isCreator: uid === room.metadata?.creatorUserId
        }));

        // Notify remaining users with updated list
        broadcastToRoom(roomId, null, {
          type: 'user-list',
          count: userCount,
          users: users
        });
      }
    }
  }

  function updateRoomActivity(roomId) {
    if (rooms.has(roomId)) {
      rooms.get(roomId).lastActivity = Date.now();
    }
  }

  function broadcastToRoom(roomId, excludeUserId, message) {
    if (!rooms.has(roomId)) return;

    const room = rooms.get(roomId);
    const messageStr = JSON.stringify(message);

    room.connections.forEach((client, userId) => {
      // Don't send to the sender or to disconnected clients
      if (userId !== excludeUserId && client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageStr);
        } catch (err) {
          console.error(`[Server] Error sending to user ${userId}:`, err.message);
        }
      }
    });
  }

  function sendToUser(roomId, targetUserId, message) {
    if (!rooms.has(roomId)) return;

    const room = rooms.get(roomId);
    const client = room.connections.get(targetUserId);

    if (client && client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(message));
      } catch (err) {
        console.error(`[Server] Error sending to user ${targetUserId}:`, err.message);
      }
    }
  }
});

// Clean up inactive rooms periodically
setInterval(() => {
  const now = Date.now();
  const roomsToDelete = [];

  rooms.forEach((room, roomId) => {
    const inactiveTime = now - room.lastActivity;
    if (inactiveTime > ROOM_INACTIVE_TIMEOUT) {
      roomsToDelete.push(roomId);
    }
  });

  roomsToDelete.forEach(roomId => {
    rooms.delete(roomId);
    console.log(`[Server] Cleaned up inactive room: ${roomId}`);
  });

  if (roomsToDelete.length > 0) {
    console.log(`[Server] Cleaned up ${roomsToDelete.length} inactive rooms`);
  }
}, ROOM_CLEANUP_INTERVAL);

// Graceful shutdown
let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[Server] ${signal} received, closing server...`);

  // Set a shorter timeout for force exit
  const forceExitTimer = setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 3000).unref(); // unref() allows process to exit even if timer is pending

  // Close the HTTP server (stops accepting new connections)
  server.close((err) => {
    if (err) console.error('[Server] Error closing HTTP server:', err);
  });

  // Close all WebSocket connections gracefully
  const clients = Array.from(wss.clients);
  clients.forEach((client) => {
    try {
      client.terminate(); // Use terminate() instead of close() for immediate shutdown
    } catch (err) {
      // Ignore errors during shutdown
    }
  });

  // Close the WebSocket server
  wss.close((err) => {
    if (err) console.error('[Server] Error closing WebSocket server:', err);
    clearTimeout(forceExitTimer);
    console.log('[Server] Server closed successfully');
    process.exit(0);
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
