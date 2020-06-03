const express = require('express');
const fs = require('fs');
const https = require('https');

const PORT = 8000;

const app = express();
const serverOptions = {
  key: fs.readFileSync('./ssl/key.pem'),
  cert: fs.readFileSync('./ssl/cert.pem'),
  passphrase: '123456789',
};

app.use(express.static('public'));

https.createServer(serverOptions, app).listen(PORT);
console.log(`HTTPS server is up and running on https://localhost:${PORT}`);
