import express from 'express';
import fs from 'fs';
import https, { Server as HttpsServer, ServerOptions as HttpsServerOptions } from 'https';
import path from 'path';
import { createHmac, randomUUID } from 'crypto';
import { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer, RawData as WebSocketRawData } from 'ws';

const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT ? Number(process.env.PORT) : 8000;

const serverDirectory = path.resolve(__dirname, '..');
const projectRoot = path.resolve(serverDirectory, '..');
const DIST_DIR = path.join(projectRoot, 'dist');
const INDEX_HTML_PATH = path.join(DIST_DIR, 'index.html');
const DEFAULT_SSL_DIR = path.join(projectRoot, 'ssl');

const TURN_SECRET = process.env.TURN_SECRET;
const TURN_HOST = process.env.TURN_HOST ?? 'turn.caller-siblings.ru';
const TURN_REALM = process.env.TURN_REALM ?? 'caller-siblings.ru';
const ICE_TTL_SEC = Number(process.env.ICE_TTL_SEC ?? 86_400);

interface IceResponse {
  username: string;
  credential: string;
  realm: string;
  ttl: number;
  iceServers: Array<
    | { urls: string[] }
    | { urls: string[]; username: string; credential: string }
  >;
}

const ICE_CACHE_TTL_MS = 5 * 60 * 1000;

const iceResponseCache: Map<string, { cachedAt: number; response: IceResponse }> = new Map();

const log = (message: string, meta: Record<string, unknown> = {}): void => {
  const timestamp = new Date().toISOString();
  if (Object.keys(meta).length > 0) {
    console.log(`[${timestamp}] ${message}`, meta);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
};

const warn = (message: string, meta: Record<string, unknown> = {}): void => {
  const timestamp = new Date().toISOString();
  if (Object.keys(meta).length > 0) {
    console.warn(`[${timestamp}] ${message}`, meta);
  } else {
    console.warn(`[${timestamp}] ${message}`);
  }
};

export type RoomMode = 'stream' | 'call';
export type ClientRole = string | null;

export interface ClientInfo {
  socket: WebSocket;
  roomId: string | null;
  mode: RoomMode | null;
  role: ClientRole;
  connectedAt: number;
  ip?: string;
}

export interface RoomInfo {
  mode: RoomMode;
  clients: Set<string>;
}

export type ClientsMap = Map<string, ClientInfo>;
export type RoomsMap = Map<string, RoomInfo>;

export interface SignalPayload {
  roomId: string;
  targetClientId?: string;
  signal: unknown;
}

export interface SignalMessagePayload {
  roomId: string;
  senderId: string;
  signal: unknown;
}

export type HttpsOptions = HttpsServerOptions & {
  key: Buffer;
  cert: Buffer;
  ca?: Array<string | Buffer>;
  passphrase?: string;
};

interface JoinRoomPayload {
  roomId: string;
  mode: RoomMode | string;
  role?: string;
}

interface ClientMessageEnvelope<T extends string = string, P = unknown> {
  type: T;
  payload?: P;
}

export const app = express();
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

const normalizeUid = (value: unknown): string => {
  if (Array.isArray(value)) {
    return normalizeUid(value[0]);
  }

  const raw =
    typeof value === 'string'
      ? value
      : value !== undefined && value !== null
      ? String(value)
      : undefined;
  const fallback = 'web';
  if (!raw) {
    return fallback;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.slice(0, 64);
};

const buildIceResponse = (uid: string, secret: string): IceResponse => {
  const expiry = Math.floor(Date.now() / 1000) + ICE_TTL_SEC;
  const username = `${expiry}:${uid}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');

  const stunUrls = [`stun:${TURN_HOST}:3478`, `stun:${TURN_HOST}:80`];
  const turnUrls = [
    `turn:${TURN_HOST}:3478?transport=udp`,
    `turn:${TURN_HOST}:3478?transport=tcp`,
    `turns:${TURN_HOST}:443?transport=tcp`,
  ];

  return {
    username,
    credential,
    realm: TURN_REALM,
    ttl: ICE_TTL_SEC,
    iceServers: [
      { urls: stunUrls },
      { urls: turnUrls, username, credential },
    ],
  };
};

app.get('/ice', (req, res) => {
  if (!TURN_SECRET) {
    res.status(500).json({ error: 'TURN_SECRET not set' });
    return;
  }

  const uid = normalizeUid(req.query.uid);
  const now = Date.now();
  const cached = iceResponseCache.get(uid);

  if (cached && now - cached.cachedAt < ICE_CACHE_TTL_MS) {
    res.json(cached.response);
    return;
  }

  const response = buildIceResponse(uid, TURN_SECRET);
  iceResponseCache.set(uid, { cachedAt: now, response });
  res.json(response);
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

const resolvePath = (filePath: string): string =>
  path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

const readTlsFile = (filePath: string, label: string): Buffer => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`SSL ${label} file not found at ${filePath}`);
  }

  log('Loaded TLS file', { label, path: filePath });
  return fs.readFileSync(filePath);
};

const buildHttpsOptions = (): HttpsOptions => {
  const defaultKeyPath = path.join(DEFAULT_SSL_DIR, 'key.pem');
  const defaultCertPath = path.join(DEFAULT_SSL_DIR, 'cert.pem');

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

  const httpsOptions: HttpsOptions = {
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

export const createServer = (): HttpsServer => {
  const serverOptions = buildHttpsOptions();
  const server = https.createServer(serverOptions, app).listen(PORT, () => {
    log('HTTPS server is listening', { port: PORT });
  });

  return server;
};

export const clients: ClientsMap = new Map();
export const rooms: RoomsMap = new Map();

interface ServerMessage<T = unknown> {
  type: string;
  payload: T;
}

const safeSend = <T>(socket: WebSocket | undefined, message: ServerMessage<T>): void => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    warn('Attempted to send message to closed socket');
    return;
  }

  try {
    socket.send(JSON.stringify(message));
  } catch (error) {
    const err = error as Error;
    warn('Failed to send message', { error: err.message });
  }
};

const send = <T>(clientId: string, type: string, payload: T): void => {
  const client = clients.get(clientId);
  if (!client) {
    warn('Attempted to send message to unknown client', { clientId, type });
    return;
  }

  safeSend(client.socket, { type, payload });
};

const broadcastRoom = <T>(
  roomId: string,
  type: string,
  payload: T,
  excludeClientId?: string,
): void => {
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

const leaveRoom = (clientId: string): void => {
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

const disconnectClient = (clientId: string): void => {
  leaveRoom(clientId);
  clients.delete(clientId);
  log('WebSocket client disconnected', { clientId });
};

const handleJoinRoom = (clientId: string, payload: Partial<JoinRoomPayload> = {}): void => {
  const { roomId, mode, role } = payload;
  if (!roomId || !mode) {
    send(clientId, 'error', { message: 'roomId and mode are required to join a room.' });
    return;
  }

  const normalizedRoomId = String(roomId);
  const normalizedMode: RoomMode = mode === 'stream' ? 'stream' : 'call';
  const normalizedRole: ClientRole = role || (normalizedMode === 'stream' ? 'viewer' : 'participant');

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
    .filter((participant): participant is { clientId: string; role: ClientRole } => participant !== null);

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

const handleSignal = (clientId: string, payload: Partial<SignalPayload> = {}): void => {
  const { roomId, targetClientId, signal } = payload;
  if (!roomId || typeof signal === 'undefined') {
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
      } satisfies SignalMessagePayload,
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
      } satisfies SignalMessagePayload,
      clientId,
    );
    log('Broadcast signal to room', { roomId, senderId: clientId });
  }
};

const handleLeaveRoom = (clientId: string): void => {
  leaveRoom(clientId);
  send(clientId, 'room-left', {});
};

const handleMessage = (clientId: string, rawMessage: WebSocketRawData): void => {
  let parsed: ClientMessageEnvelope;

  try {
    parsed = JSON.parse(rawMessage.toString()) as ClientMessageEnvelope;
  } catch (error) {
    const err = error as Error;
    warn('Failed to parse WebSocket message', { error: err.message, rawMessage: rawMessage.toString() });
    send(clientId, 'error', { message: 'Message must be valid JSON.' });
    return;
  }

  if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
    send(clientId, 'error', { message: 'Message must include a type field.' });
    return;
  }

  const { type, payload } = parsed as ClientMessageEnvelope<string, unknown>;

  log('Received WebSocket message', { clientId, type });

  switch (type) {
    case 'join-room':
      handleJoinRoom(clientId, (payload as Partial<JoinRoomPayload>) || {});
      break;
    case 'signal':
      handleSignal(clientId, (payload as Partial<SignalPayload>) || {});
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

export const server: HttpsServer | null = process.env.NODE_ENV !== 'test' ? createServer() : null;

if (server) {
  const wssServer = new WebSocketServer({ server });
  log('WebSocket server started');

  wssServer.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    const clientId = randomUUID();
    clients.set(clientId, {
      socket,
      roomId: null,
      mode: null,
      role: null,
      connectedAt: Date.now(),
      ip: request.socket.remoteAddress ?? undefined,
    });

    log('WebSocket client connected', { clientId, ip: request.socket.remoteAddress });

    safeSend(socket, {
      type: 'welcome',
      payload: {
        clientId,
      },
    });

    socket.on('message', (message: WebSocketRawData) => handleMessage(clientId, message));
    socket.on('close', (code: number) => {
      log('WebSocket client closed connection', { clientId, code });
      disconnectClient(clientId);
    });
    socket.on('error', (error: Error) => {
      warn('WebSocket client error', { clientId, error: error.message });
      disconnectClient(clientId);
    });
  });
}

export default {
  app,
  server,
  createServer,
};
