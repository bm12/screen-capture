import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverBuildPath = path.resolve(__dirname, 'server/dist/server.js');
const serverSourcePath = path.resolve(__dirname, 'server/src/server.ts');
const serverEntry = fs.existsSync(serverBuildPath) ? serverBuildPath : serverSourcePath;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.{js,ts}'],
    globals: true,
  },
  resolve: {
    alias: {
      '#server': serverEntry,
    },
  },
});
