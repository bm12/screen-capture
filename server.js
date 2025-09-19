const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { randomUUID } = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 8000;

const DIST_DIR = path.join(__dirname, 'dist');
const INDEX_HTML_PATH = path.join(DIST_DIR, 'index.html');

const log = (message, meta = {}) => {
  const timestamp = new Date().toISOString();
  if (Object.keys(meta).length > 0) {
    console.log(`[${timestamp}] ${message}`, meta);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
};

const warn = (message, meta = {}) => {
  const timestamp = new Date().toISOString();
  if (Object.keys(meta).length > 0) {
    console.warn(`[${timestamp}] ${message}`, meta);
  } else {
    console.warn(`[${timestamp}] ${message}`);
  }
};

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  log('Incoming HTTP request', { method: req.method, url: req.originalUrl });
  next();
});

if (!fs.existsSync(DIST_DIR)) {
  warn('Static build directory not found. Run "npm run build" before starting the server.', {
    dist: DIST_DIR,
  });
} else {
  log('Serving static assets', { directory: DIST_DIR });
}

app.use(express.static(DIST_DIR));

app.get('/health', (req, res) => {
  log('Health check requested');
  res.json({ status: 'ok' });
});

app.post('/api/calls', (req, res) => {
  const roomId = randomUUID();
  const host = req.get('host');
  const forwardedProto = req.get('x-forwarded-proto');
  const protocol = forwardedProto ? forwardedProto.split(',')[0] : req.protocol || 'https';
  const callUrl = host ? `${protocol}://${host}/call/${roomId}` : `/call/${roomId}`;

  log('Generated call room link', { roomId, callUrl });
  res.json({ roomId, url: callUrl });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }

  if (fs.existsSync(INDEX_HTML_PATH)) {
    res.sendFile(INDEX_HTML_PATH);
  } else {
    res.status(404).send('Static build not found. Please run npm run build.');
  }
});

const resolvePath = (filePath) => (path.isAbsolute(filePath) ? filePath : path.resolve(filePath));

const readTlsFile = (filePath, label) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`SSL ${label} file not found at ${filePath}`);
  }

  log('Loaded TLS file', { label, path: filePath });
  return fs.readFileSync(filePath);
};

const buildHttpsOptions = () => {
  const defaultKeyPath = path.join(__dirname, 'ssl', 'key.pem');
  const defaultCertPath = path.join(__dirname, 'ssl', 'cert.pem');

  const keyPathEnv = process.env.SSL_KEY_PATH;
  const certPathEnv = process.env.SSL_CERT_PATH;
  const caPathEnv = process.env.SSL_CA_PATH;
  const passphraseEnv = process.env.SSL_PASSPHRASE;

  if (isProd && (!keyPathEnv || !certPathEnv)) {
    throw new Error(
      'Production HTTPS server requires SSL_KEY_PATH and SSL_CERT_PATH environment variables.',
    );
  }

  const keyPath = resolvePath(keyPathEnv || defaultKeyPath);
  const certPath = resolvePath(certPathEnv || defaultCertPath);

  const httpsOptions = {
    key: readTlsFile(keyPath, 'key'),
    cert: readTlsFile(certPath, 'certificate'),
  };

  if (caPathEnv) {
    const caPaths = caPathEnv
      .split(path.delimiter)
      .map((caPath) => caPath.trim())
      .filter(Boolean)
      .map(resolvePath);

    httpsOptions.ca = caPaths.map((caPath) => readTlsFile(caPath, 'CA/chain'));
  }

  const passphrase = passphraseEnv || (!isProd ? '123456789' : undefined);
  if (passphrase) {
    httpsOptions.passphrase = passphrase;
    log('Configured HTTPS passphrase');
  }

  return httpsOptions;
};

const createServer = () => {
  const serverOptions = buildHttpsOptions();
  const server = https.createServer(serverOptions, app).listen(PORT, () => {
    log('HTTPS server is listening', { port: PORT });
  });

  return server;
};

const server = createServer();

const clients = new Map();
const rooms = new Map();

const safeSend = (socket, message) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    warn('Attempted to send message to closed socket');
    return;
  }

  try {
    socket.send(JSON.stringify(message));
  } catch (error) {
    warn('Failed to send message', { error: error.message });
  }
};

const send = (clientId, type, payload) => {
  const client = clients.get(clientId);
  if (!client) {
    warn('Attempted to send message to unknown client', { clientId, type });
    return;
  }

  safeSend(client.socket, { type, payload });
};

const broadcastRoom = (roomId, type, payload, excludeClientId) => {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  room.clients.forEach((participantId) => {
    if (participantId === excludeClientId) return;
    const participant = clients.get(participantId);
    if (!participant) return;
    safeSend(participant.socket, { type, payload });
  });
};

const leaveRoom = (clientId) => {
  const client = clients.get(clientId);
  if (!client || !client.roomId) {
    return;
  }

  const { roomId, role, mode } = client;
  const room = rooms.get(roomId);
  if (room) {
    room.clients.delete(clientId);
    log('Client left room', { clientId, roomId, role, mode, members: room.clients.size });

    if (room.clients.size === 0) {
      rooms.delete(roomId);
      log('Room removed because it is empty', { roomId });
    } else {
      broadcastRoom(roomId, 'peer-left', { clientId }, clientId);
    }
  }

  client.roomId = null;
  client.role = null;
  client.mode = null;
};

const disconnectClient = (clientId) => {
  leaveRoom(clientId);
  clients.delete(clientId);
  log('WebSocket client disconnected', { clientId });
};

const handleJoinRoom = (clientId, payload = {}) => {
  const { roomId, mode, role } = payload;
  if (!roomId || !mode) {
    send(clientId, 'error', { message: 'roomId and mode are required to join a room.' });
    return;
  }

  const normalizedRoomId = String(roomId);
  const normalizedMode = mode === 'stream' ? 'stream' : 'call';
  const normalizedRole = role || (normalizedMode === 'stream' ? 'viewer' : 'participant');

  const client = clients.get(clientId);
  if (!client) {
    warn('Join request for unknown client', { clientId });
    return;
  }

  if (client.roomId && client.roomId !== normalizedRoomId) {
    leaveRoom(clientId);
  }

  let room = rooms.get(normalizedRoomId);
  if (room && room.mode !== normalizedMode) {
    send(clientId, 'error', {
      message: 'Room already exists with a different mode.',
      expectedMode: room.mode,
      receivedMode: normalizedMode,
    });
    return;
  }

  if (!room) {
    room = { mode: normalizedMode, clients: new Set() };
    rooms.set(normalizedRoomId, room);
    log('Created new room', { roomId: normalizedRoomId, mode: normalizedMode });
  }

  room.clients.add(clientId);
  client.roomId = normalizedRoomId;
  client.mode = normalizedMode;
  client.role = normalizedRole;

  const participants = Array.from(room.clients)
    .filter((id) => id !== clientId)
    .map((id) => {
      const participant = clients.get(id);
      if (!participant) return null;
      return {
        clientId: id,
        role: participant.role,
      };
    })
    .filter(Boolean);

  log('Client joined room', {
    clientId,
    roomId: normalizedRoomId,
    mode: normalizedMode,
    role: normalizedRole,
    members: room.clients.size,
  });

  send(clientId, 'room-joined', {
    roomId: normalizedRoomId,
    mode: normalizedMode,
    role: normalizedRole,
    participants,
  });

  broadcastRoom(
    normalizedRoomId,
    'peer-joined',
    {
      clientId,
      role: normalizedRole,
    },
    clientId,
  );
};

const handleSignal = (clientId, payload = {}) => {
  const { roomId, targetClientId, signal } = payload;
  if (!roomId || !signal) {
    send(clientId, 'error', { message: 'Signal payload must include roomId and signal data.' });
    return;
  }

  const sender = clients.get(clientId);
  if (!sender || sender.roomId !== String(roomId)) {
    send(clientId, 'error', { message: 'You are not part of the specified room.' });
    return;
  }

  if (targetClientId) {
    const target = clients.get(targetClientId);
    if (!target || target.roomId !== String(roomId)) {
      send(clientId, 'error', { message: 'Target client is not part of this room.' });
      return;
    }

    safeSend(target.socket, {
      type: 'signal',
      payload: {
        roomId,
        senderId: clientId,
        signal,
      },
    });
    log('Forwarded direct signal', { roomId, senderId: clientId, targetClientId });
  } else {
    broadcastRoom(
      String(roomId),
      'signal',
      {
        roomId,
        senderId: clientId,
        signal,
      },
      clientId,
    );
    log('Broadcast signal to room', { roomId, senderId: clientId });
  }
};

const handleLeaveRoom = (clientId) => {
  leaveRoom(clientId);
  send(clientId, 'room-left', {});
};

const handleMessage = (clientId, rawMessage) => {
  let message;

  try {
    message = JSON.parse(rawMessage.toString());
  } catch (error) {
    warn('Failed to parse WebSocket message', { error: error.message, rawMessage: rawMessage.toString() });
    send(clientId, 'error', { message: 'Message must be valid JSON.' });
    return;
  }

  const { type, payload } = message;

  log('Received WebSocket message', { clientId, type });

  switch (type) {
    case 'join-room':
      handleJoinRoom(clientId, payload);
      break;
    case 'signal':
      handleSignal(clientId, payload);
      break;
    case 'leave-room':
      handleLeaveRoom(clientId);
      break;
    case 'ping':
      send(clientId, 'pong', { timestamp: Date.now() });
      break;
    default:
      send(clientId, 'error', { message: `Unsupported message type: ${type}` });
  }
};

const wssServer = new WebSocketServer({ server });
log('WebSocket server started');

wssServer.on('connection', (socket, request) => {
  const clientId = randomUUID();
  clients.set(clientId, {
    socket,
    roomId: null,
    mode: null,
    role: null,
    connectedAt: Date.now(),
    ip: request.socket.remoteAddress,
  });

  log('WebSocket client connected', { clientId, ip: request.socket.remoteAddress });

  safeSend(socket, {
    type: 'welcome',
    payload: {
      clientId,
    },
  });

  socket.on('message', (message) => handleMessage(clientId, message));
  socket.on('close', (code) => {
    log('WebSocket client closed connection', { clientId, code });
    disconnectClient(clientId);
  });
  socket.on('error', (error) => {
    warn('WebSocket client error', { clientId, error: error.message });
    disconnectClient(clientId);
  });
});

module.exports = { app, server };
