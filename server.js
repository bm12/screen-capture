const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const WebSocket = require('ws');

const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 8000;

const app = express();

app.use(express.static('public'));

const resolvePath = (filePath) =>
  path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

const readTlsFile = (filePath, label) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`SSL ${label} file not found at ${filePath}`);
  }

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
      'Production HTTPS server requires SSL_KEY_PATH and SSL_CERT_PATH environment variables.'
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
  }

  return httpsOptions;
};

const createServer = () => {
  const serverOptions = buildHttpsOptions();
  const server = https.createServer(serverOptions, app).listen(PORT);

  console.log(`https server is up and running on https://localhost:${PORT}`);

  return server;
};

const server = createServer();

const wssServer = new WebSocket.Server({ server });
console.log('WebSocket server is up and running.');

wssServer.on('connection', function onWsConnection(client) {
  console.log(
    'A new WebSocket client was connected. Clients connected:',
    wssServer.clients.size
  );

  client.on('message', function onIncomingWsMessage(message) {
    console.log('message: ', message);
    const msgObj = JSON.parse(message);
    if (msgObj.event === 'room-request') {
      client.appData = { roomId: msgObj.roomId };
      return;
    }
    wssServer.broadcast(msgObj, client);
  });
});

wssServer.broadcast = function onWsBroadcast(msg, currentClient) {
  const numberOfClients = wssServer.clients ? wssServer.clients.size : 0;

  if (numberOfClients < 2) return;
  console.log(`Broadcasting message to ${numberOfClients} WebSocket clients.`);

  try {
    const { roomId: currentRoomId } = currentClient.appData;

    wssServer.clients.forEach(function broadCastToClient(client) {
      if (client === currentClient) return;

      if (client.readyState === client.OPEN) {
        const { roomId } = client.appData;

        if (!roomId || !currentRoomId) return;
        if (String(roomId) === String(currentRoomId)) client.send(JSON.stringify(msg.data));
      } else {
        console.error('Error: the client state is ' + client.readyState);
      }
    });
  } catch(err) {
    console.error(err);
  }
};
