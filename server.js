const express = require('express');
const fs = require('fs');
const https = require('https');
const http = require('http');
const WebSocket = require('ws');

const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 8000;

const app = express();
const serverOptions = {
  key: fs.readFileSync('./ssl/key.pem'),
  cert: fs.readFileSync('./ssl/cert.pem'),
  passphrase: '123456789',
};

app.use(express.static('public'));

const createServer = () => {
  const server = isProd ?
    http.createServer(app).listen(PORT) :
    https.createServer(serverOptions, app).listen(PORT);

  const protocol = isProd ? 'http' : 'https';
  console.log(`${protocol} server is up and running on ${protocol}://localhost:${PORT}`);

  return server;
};

const server = createServer();

const wssServer = new WebSocket.Server({ server });
console.log('WebSocket Secure server is up and running.');

wssServer.on('connection', function onWsConnection(client, ...args) {
  console.log(
    'A new WebSocket client was connected. Clients connected:',
    this.clients.size
  );

  // Listen to messages from the connected client
  client.on('message', function onIncomingWsMessage(message) {
    console.log('Relaying message', message);
    const msgObj = JSON.parse(message);
    if (msgObj.event === 'stream-request') {
      client.appData = {
        roomId: msgObj.roomId,
      };
      return;
    }
    wssServer.broadcast(msgObj, client);
  });
});

// broadcasting the message to all WebSocket clients.
wssServer.broadcast = function onWsBroadcast(msg, currentClient) {
  const numberOfClients = wssServer.clients ? wssServer.clients.size : 0;

  // If there's only 1 or 0 clients connected there's no need to broadcast
  if (numberOfClients < 2) return;

  console.log(
    'Broadcasting message to ' + numberOfClients + ' WebSocket clients.'
  );

  try {
    wssServer.clients.forEach(function broadCastToClient(client) {
      if (client === currentClient) return;

      if (client.readyState === client.OPEN) {
        if (!(client.appData && client.appData.roomId) || !(currentClient.appData && currentClient.appData.roomId)) return;
        if (String(client.appData.roomId) === String(currentClient.appData.roomId)) client.send(JSON.stringify(msg.data));
      } else console.error('Error: the client state is ' + client.readyState);
    });
  } catch(err) {
    console.error(err);
  }

};
