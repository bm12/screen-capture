const express = require('express');
const fs = require('fs');
const https = require('https');
const http = require('http');
const WebSocket = require('ws');

const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 8000;

const app = express();

app.use(express.static('public'));

const createServer = () => {
  const serverOptions = {
    key: fs.readFileSync('./ssl/key.pem'),
    cert: fs.readFileSync('./ssl/cert.pem'),
    passphrase: '123456789',
  };

  const server = isProd ?
    http.createServer(app).listen(PORT) :
    https.createServer(serverOptions, app).listen(PORT);

  const protocol = isProd ? 'http' : 'https';
  console.log(`${protocol} server is up and running on ${protocol}://localhost:${PORT}`);

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
