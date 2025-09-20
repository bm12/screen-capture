let serverModule;

try {
  serverModule = require('./server/dist/server.js');
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'MODULE_NOT_FOUND') {
    throw new Error('Server build not found. Run "npm run build:server" to compile TypeScript sources.');
  }

  throw error;
}

module.exports = serverModule;
