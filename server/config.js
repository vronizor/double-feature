import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader so the app runs with `node server/index.js` and no
// dependency on dotenv. Real environment variables always win, which is what
// docker-compose relies on.
function loadDotEnv() {
  let raw;
  try {
    raw = readFileSync(resolve(ROOT, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    process.env[key] = match[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
}

loadDotEnv();

export const config = {
  port: Number(process.env.PORT) || 8080,
  dbPath: resolve(ROOT, process.env.DB_PATH || './data/double-feature.db'),
  hostLanIp: process.env.HOST_LAN_IP?.trim() || null,
  tmdb: {
    apiKey: process.env.TMDB_API_KEY?.trim() || null,
    accessToken: process.env.TMDB_ACCESS_TOKEN?.trim() || null,
  },
};

export const hasTmdbCredentials = () =>
  Boolean(config.tmdb.accessToken || config.tmdb.apiKey);
