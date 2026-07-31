import express from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { config, ROOT, hasTmdbCredentials } from './config.js';
import { getDb } from './db.js';
import { detectLanIp, baseUrl } from './lan.js';
import { startRefreshJob } from './refresh.js';
import listsRouter from './routes/lists.js';
import moviesRouter from './routes/movies.js';
import drawRouter from './routes/draw.js';
import sessionsRouter from './routes/sessions.js';
import vibesRouter from './routes/vibes.js';

/**
 * The displayed version, read from package.json so there is exactly one place
 * to bump it.
 *
 * MAJOR is the roadmap version (4 = v4, in flight). MINOR is a decision round:
 * it goes up once per session in which decisions were actually settled, which
 * is the unit this project already works in — see the reporting conventions in
 * CLAUDE.md. PATCH is unused for now.
 *
 * Read once at boot rather than imported, because a JSON import assertion is
 * still awkward across Node versions and this is a single synchronous read of
 * a file that is already on disk.
 */
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version ?? null;
  } catch {
    // A missing or unreadable package.json must not stop the app booting —
    // the footer simply shows nothing.
    return null;
  }
})();
import tmdbRouter from './routes/tmdb.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(express.text({ limit: '2mb', type: ['text/plain', 'text/csv'] }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.get('/api/config', (req, res) => {
    res.json({
      base_url: baseUrl(),
      lan_ip: detectLanIp(),
      port: config.port,
      tmdb_configured: hasTmdbCredentials(),
      version: VERSION,
    });
  });

  app.use('/api/lists', listsRouter);
  app.use('/api/movies', moviesRouter);
  app.use('/api/tmdb', tmdbRouter);
  app.use('/api', drawRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api', vibesRouter);

  app.use(express.static(join(ROOT, 'public')));

  // SPA entry points. Listed explicitly rather than with a catch-all so that a
  // bad /api path still 404s as JSON instead of silently returning the app HTML.
  //
  // The `root` option is load-bearing, not tidiness. send() applies its
  // dotfiles rule to the path RELATIVE to root, and with no root it explodes
  // the whole absolute path into segments instead — so a single dot-directory
  // anywhere above the app, like /home/pi/.local/share, made every guest see a
  // blank 404 while the host screen and QR code looked perfect. express.static
  // above was never affected, because it has always had a root.
  const index = (req, res) => res.sendFile('index.html', { root: join(ROOT, 'public') });
  app.get('/', index);
  app.get('/vote/:slug', index);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.expose === false ? 'Server error' : err.message });
  });

  return app;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  getDb();
  const app = createApp();

  app.listen(config.port, '0.0.0.0', () => {
    const url = baseUrl();
    console.log(`Double Feature listening on port ${config.port}`);
    if (url) {
      console.log(`  Host screen: ${url}`);
    } else {
      console.warn(
        '  No private LAN IPv4 address detected. Guests will not be able to reach ' +
          'this host — set HOST_LAN_IP in .env to the Pi\'s LAN address.',
      );
    }
    if (!hasTmdbCredentials()) {
      console.warn('  TMDB credentials missing — imports and seeding will fail. See .env.example.');
    }
  });

  startRefreshJob();
}
