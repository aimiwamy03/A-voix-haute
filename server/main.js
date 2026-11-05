import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { createApp } from './app.js';

loadEnv();

export function startServer(port = Number(process.env.PORT) || 3000, host = process.env.HOST || '127.0.0.1') {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (entry === self) {
  const host = process.env.HOST || (process.env.PUBLIC_URL ? '0.0.0.0' : '127.0.0.1');
  startServer(Number(process.env.PORT) || 3000, host).then((server) => {
    const address = server.address();
    const publicUrl = process.env.PUBLIC_URL || `http://127.0.0.1:${address.port}`;
    console.log(`Oral DELF sur ${publicUrl}`);
  });
}
