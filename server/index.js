import express from 'express';
import { join } from 'node:path';

import { config, ROOT, hasTmdbCredentials } from './config.js';
import { getDb } from './db.js';
import { detectLanIp, baseUrl } from './lan.js';
import { startRefreshJob } from './refresh.js';
import listsRouter from './routes/lists.js';
import moviesRouter from './routes/movies.js';
import drawRouter from './routes/draw.js';
import sessionsRouter from './routes/sessions.js';
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
    });
  });

  app.use('/api/lists', listsRouter);
  app.use('/api/movies', moviesRouter);
  app.use('/api/tmdb', tmdbRouter);
  app.use('/api', drawRouter);
  app.use('/api/sessions', sessionsRouter);

  app.use(express.static(join(ROOT, 'public')));

  // SPA entry points. Listed explicitly rather than with a catch-all so that a
  // bad /api path still 404s as JSON instead of silently returning the app HTML.
  const index = (req, res) => res.sendFile(join(ROOT, 'public', 'index.html'));
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
