import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function applyEnvFile(file) {
  if (!file || !existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!value || process.env[key]) continue;
    process.env[key] = value;
  }
}

export function loadEnv() {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const resources = process.resourcesPath ? path.join(process.resourcesPath, '.env') : '';
  applyEnvFile(path.join(root, '.env'));
  applyEnvFile(resources);
  applyEnvFile(process.env.DELF_ENV_FILE);
}
