/**
 * The Draw tab's staged selection ("the Lineup"), as a module-level singleton
 * rather than view-local state — ES modules are only evaluated once, so every
 * view that imports `lineup` shares the exact same store. That's what lets a
 * film added from the Explore tab still be there when the host switches back
 * to Draw (each view is otherwise torn down and rebuilt fresh on every
 * navigation).
 */
const movies = [];

export const lineup = {
  get movies() {
    return movies;
  },
  ids() {
    return movies.map((movie) => movie.tmdb_id);
  },
  has(tmdbId) {
    return movies.some((movie) => movie.tmdb_id === tmdbId);
  },
  /** Returns false without adding if the film is already in the lineup. */
  add(movie) {
    if (this.has(movie.tmdb_id)) return false;
    movies.push(movie);
    return true;
  },
  addAll(newMovies) {
    for (const movie of newMovies) this.add(movie);
  },
  remove(tmdbId) {
    const index = movies.findIndex((movie) => movie.tmdb_id === tmdbId);
    if (index === -1) return false;
    movies.splice(index, 1);
    return true;
  },
  clear() {
    movies.length = 0;
  },
};
