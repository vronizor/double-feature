/**
 * Display preferences — how things are shown, never what gets drawn.
 *
 * Deliberately separate from `pool-state.js`: that holds tonight's pool, which
 * is ephemeral by design and must not persist. These are the opposite — they
 * should survive a reload and apply everywhere, so they live in localStorage.
 * Mixing the two would mean either leaking tonight's lineup into next week or
 * forgetting a display choice on every navigation.
 */

const KEY = 'double-feature:prefs';

const DEFAULTS = {
  // Awards are shown by default: they're the interesting thing about a film
  // that a poster can't tell you, and 21% of the library has one.
  showAwards: true,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    // Private-mode Safari throws on localStorage access rather than returning
    // null. A display preference isn't worth breaking the page over.
    return { ...DEFAULTS };
  }
}

const state = load();

export const prefs = {
  get showAwards() {
    return state.showAwards;
  },

  set(key, value) {
    state[key] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Not persisting is survivable; the setting still applies this session.
    }
  },

  toggle(key) {
    this.set(key, !state[key]);
    return state[key];
  },
};
