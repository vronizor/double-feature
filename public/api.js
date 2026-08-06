async function request(path, { method = 'GET', body, raw = false } = {}) {
  const options = { method, headers: {} };

  if (body !== undefined) {
    if (raw) {
      options.headers['content-type'] = 'text/plain';
      options.body = body;
    } else {
      options.headers['content-type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }

  const response = await fetch(path, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }

  if (!response.ok) {
    // Carried so callers can tell "the server said no" from "the server
    // didn't answer" — a 404 is permanent and a dropped request might not be,
    // and those two want different handling (see vote.js's poll loop).
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export const api = {
  config: () => request('/api/config'),

  lists: () => request('/api/lists'),
  // `owner` is what makes the new list a watchlist. Omitted for every ordinary
  // custom list, which belongs to the household rather than to a person.
  createList: (name, owner = null) =>
    request('/api/lists', { method: 'POST', body: { name, ...(owner ? { owner } : {}) } }),
  updateList: (id, patch) => request(`/api/lists/${id}`, { method: 'PATCH', body: patch }),
  deleteList: (id, force) =>
    request(`/api/lists/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' }),

  importList: (id, text, format) =>
    request(`/api/lists/${id}/import${format ? `?format=${format}` : ''}`, {
      method: 'POST',
      body: text,
      raw: true,
    }),
  importJob: (jobId) => request(`/api/lists/imports/${jobId}`),

  entries: (id, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/api/lists/${id}/entries${query ? `?${query}` : ''}`);
  },
  resolveEntry: (entryId, tmdbId, mediaType) =>
    request(`/api/lists/entries/${entryId}/resolve`, {
      method: 'POST',
      body: { tmdb_id: tmdbId, media_type: mediaType },
    }),
  resolveEntryMany: (entryId, items) =>
    request(`/api/lists/entries/${entryId}/resolve-many`, { method: 'POST', body: { items } }),
  deleteEntry: (entryId) => request(`/api/lists/entries/${entryId}`, { method: 'DELETE' }),

  // One known film onto one list, with no TMDB call and no matching. The film
  // must already be in the library — `getOrCacheMovie` first for anything that
  // came straight out of a search.
  addEntry: (listId, tmdbId) =>
    request(`/api/lists/${listId}/entries`, { method: 'POST', body: { tmdb_id: tmdbId } }),
  // The seed-file shape, so it re-imports through the path that already
  // exists. A URL rather than a fetch: the browser should download it.
  exportListUrl: (listId) => `/api/lists/${listId}/export`,

  searchTmdb: (q, year) => {
    const query = new URLSearchParams({ q, ...(year ? { year } : {}) });
    return request(`/api/tmdb/search?${query}`);
  },

  setWatched: (tmdbId, watched) =>
    request(`/api/movies/${tmdbId}/watched`, { method: 'POST', body: { watched } }),
  watched: () => request('/api/movies/watched'),
  getOrCacheMovie: (tmdbId, mediaType) =>
    request(`/api/movies/${tmdbId}${mediaType === 'tv' ? '?media_type=tv' : ''}`),
  addManualMovie: (title, year) =>
    request('/api/movies/manual', { method: 'POST', body: { title, year } }),

  // Omitting `lists` falls back to is_active server-side, which is what the
  // very first paint wants — the client has no selection of its own yet.
  facets: (lists = null) =>
    request(`/api/pool/facets${lists ? `?lists=${lists.join(',')}` : ''}`),
  // Every one of these takes a POOL SETUP — { lists, topN, filters } — because
  // a list selection is not a filter. See the header of server/pool.js.
  poolCount: (setup, exclude) =>
    request('/api/pool/count', { method: 'POST', body: { setup, exclude } }),
  draw: (size, setup, exclude) =>
    request('/api/draw', { method: 'POST', body: { size, setup, exclude } }),
  poolMovies: (setup, { sort, limit, offset } = {}) =>
    request('/api/pool/movies', { method: 'POST', body: { setup, sort, limit, offset } }),

  publish: (tmdbIds, anonymous, setup) =>
    request('/api/sessions', {
      method: 'POST',
      body: { tmdb_ids: tmdbIds, anonymous, setup },
    }),
  session: (slug, includeTally = false) =>
    request(`/api/sessions/${slug}${includeTally ? '?include=tally' : ''}`),
  submitBallot: (slug, voterName, ranks) =>
    request(`/api/sessions/${slug}/ballots`, {
      method: 'POST',
      body: { voter_name: voterName, ranks },
    }),
  closeSession: (slug) => request(`/api/sessions/${slug}/close`, { method: 'POST' }),
  cancelSession: (slug) => request(`/api/sessions/${slug}`, { method: 'DELETE' }),

  tags: () => request('/api/tags'),
  vibes: () => request('/api/vibes'),
  createVibe: (vibe) => request('/api/vibes', { method: 'POST', body: vibe }),
  updateVibe: (id, patch) => request(`/api/vibes/${id}`, { method: 'PATCH', body: patch }),
  deleteVibe: (id) => request(`/api/vibes/${id}`, { method: 'DELETE' }),
  // Parametric vibes: search for the thing being picked, then hand it back.
  searchPerson: (q) => request(`/api/tmdb/person?q=${encodeURIComponent(q)}`),
  poolCountries: () => request('/api/pool/countries'),
  applyVibeParameter: (id, value) =>
    request(`/api/vibes/${id}/parameter`, { method: 'POST', body: { value } }),
  results: (slug) => request(`/api/sessions/${slug}/results`),
  history: () => request('/api/sessions'),
};
