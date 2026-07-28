/**
 * "Tonight is…" — the presets above Pool setup.
 *
 * The premise of v2: the same host has different Friday nights, and picking
 * between them shouldn't mean hand-toggling six lists and three filters. An
 * occasion bundles a list selection AND the filters that go with it, in one
 * click.
 *
 * Occasions are deliberately NOT the same thing as list categories. A category
 * is how the picker groups lists visually; an occasion is a curated starting
 * point that may draw on one category, several, or none. Keeping them separate
 * is what lets "Family" mean *family lists, minus horror* rather than merely
 * "the lists filed under family".
 *
 * An occasion whose `resolve()` yields no lists is hidden rather than shown
 * broken — so "Awards" simply appears once awards lists exist, and
 * "Crowd-pleasers" once the auto-updating list does, with no code change here.
 *
 * ---------------------------------------------------------------------------
 * FUTURE: parametric occasions (director night, theme night)
 *
 * Those need a value before they can resolve — "which director?", "which
 * theme?" — so they will carry an extra field:
 *
 *   {
 *     id: 'director',
 *     label: 'Director',
 *     param: { kind: 'person', placeholder: 'Kurosawa…' },
 *     resolve: ({ value }) => ({ lists: [ephemeralListFor(value)] }),
 *   }
 *
 * The chip renderer shows a `▾` for those and expands an inline input instead
 * of applying immediately. Nothing here defines one yet, and the expansion UI
 * is deliberately not written until there's an occasion to test it against —
 * but the shape above is what the dynamic-list work should target, and it is
 * why a dynamic list's query must be stored as a structured object rather than
 * a frozen URL (see ROADMAP §4.3).
 * ---------------------------------------------------------------------------
 */

const idsInCategory = (lists, category) =>
  lists.filter((list) => list.category === category).map((list) => list.id);

const genreIdByName = (facets, name) =>
  facets?.genres?.find((genre) => genre.name.toLowerCase() === name.toLowerCase())?.id ?? null;

export const OCCASIONS = [
  {
    id: 'cinephile',
    label: 'Cinephile',
    hint: 'The canon — the films that made history',
    resolve: ({ lists }) => ({ lists: idsInCategory(lists, 'canon') }),
  },
  {
    id: 'awards',
    label: 'Awards',
    hint: 'Prize winners',
    resolve: ({ lists }) => ({ lists: idsInCategory(lists, 'awards') }),
  },
  {
    id: 'crowd',
    label: 'Crowd-pleasers',
    hint: 'Recent films almost everyone enjoys',
    resolve: ({ lists }) => ({ lists: idsInCategory(lists, 'dynamic') }),
  },
  {
    id: 'family',
    label: 'Family',
    hint: 'Kid-friendly picks, horror excluded',
    // The one occasion that carries a real filter as well as a selection —
    // which is the point of it being an occasion rather than just a category.
    // Note the horror id is looked up by name from the live facets rather than
    // hardcoded: TMDB's ids are stable, but a filter that silently stops
    // working is a bad thing to bet on a magic number.
    resolve: ({ lists, facets }) => {
      const horror = genreIdByName(facets, 'Horror');
      return {
        lists: idsInCategory(lists, 'family'),
        genres: { include: [], exclude: horror === null ? [] : [horror] },
      };
    },
  },
];

/** Only the occasions that can actually produce a pool right now. */
export function availableOccasions(context) {
  return OCCASIONS.map((occasion) => ({ occasion, filters: occasion.resolve(context) })).filter(
    ({ filters }) => (filters.lists ?? []).length > 0,
  );
}
