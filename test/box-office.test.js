import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBoxOfficePage, parseAdmissions } from '../scripts/fetch-seed-lists.mjs';

// Each fixture is the real markup shape from a specific era of the corpus, cut
// down to two rows. The variants were found by surveying all 82 pages rather
// than guessed, so these are the cases that actually occur.

test('admissions parse from every template the corpus uses', () => {
  assert.equal(parseAdmissions('{{unité|17267607}}'), 17267607);
  // The extra parameter is what broke the first parser: it expected the closing
  // braces straight after the digits, so 2008 came out with two rows.
  assert.equal(parseAdmissions('{{unité|20489303|entrées}}'), 20489303);
  assert.equal(parseAdmissions('{{formatnum:1000000}}'), 1000000);
  assert.equal(parseAdmissions('{{nombre|4310477}}'), 4310477);
  // 2013+ writes the figure bare.
  assert.equal(parseAdmissions('10 830 209'), 10830209);
  assert.equal(parseAdmissions('no number here'), null);
});

test('the 1962-2012 shape: rank as a header cell, templated admissions', () => {
  const page = `
{| class="wikitable"
|+ Films sortis en 1966 ayant dépassé {{formatnum:1000000}} de spectateurs
|-
! scope=col | Classement
! scope=col | Titre
! scope=col | Pays
! scope=col | Réalisateur
! scope=col | Box-office France
|-
! scope=row | 1.
| align="center"| ''[[La Grande Vadrouille]]''
| align="center"| [[Image:Flag of France.svg|20px]]
| align="center"| [[Gérard Oury]]
| align="center"| {{unité|17267607|entrées}}
|-
! scope=row | 2.
| align="center"| ''[[Le Docteur Jivago (film)|Le Docteur Jivago]]''
| align="center"| [[Image:Flag of the United States.svg|20px]]
| align="center"| [[David Lean]]
| align="center"| {{unité|9817059|entrées}}
|}
`;
  const rows = parseBoxOfficePage(page);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { page: 'La Grande Vadrouille', title: 'La Grande Vadrouille', admissions: 17267607 });
  // The wikilink's display text wins for the title, its target for identity.
  assert.equal(rows[1].page, 'Le Docteur Jivago (film)');
  assert.equal(rows[1].title, 'Le Docteur Jivago');
  assert.equal(rows[1].admissions, 9817059);
});

test('the 2013+ shape: caption directly above the header, bare numbers', () => {
  // The regression that matters most. `|+` is the CAPTION, not a cell, and on
  // these pages no `|-` separates it from the header row — so counting it
  // shifted every column index by one. That did not drop rows: it read the
  // WRONG column and reported 2022's Avatar at 2.7M against a real 14.0M.
  const page = `
{| class="wikitable centre alternance"
|+Films sortis en 2024 ayant dépassé 1 000 000 spectateurs en France<br/>
<small>Sources : [https://www.cbo-boxoffice.com/page000.php3 cbo-boxoffice.com]</small>
! scope="col" |Class.
! scope="col" |Titre
! scope="col" |Pays
! scope="col" |Réalisateur
! scope="col" |Box-Office France
|-
| align="center" |'''1'''
| align="center" |''[[Un p'tit truc en plus]]''
| align="center" |{{FRA-d}}
| align="center" |[[Artus (humoriste)|Artus]]
| align="center" |10 830 209
|-
| align="center" |'''2'''
| align="center" |''[[Le Comte de Monte-Cristo (film, 2024)|Le Comte de Monte-Cristo]]''
| align="center" |{{FRA-d}}
| align="center" |[[Matthieu Delaporte]] et [[Alexandre de La Patellière]]
| align="center" |9 382 216
|}
`;
  const rows = parseBoxOfficePage(page);
  assert.equal(rows.length, 2, 'the caption must not be mistaken for a row or a cell');
  assert.equal(rows[0].title, "Un p'tit truc en plus");
  assert.equal(rows[0].admissions, 10830209, 'reading the shifted column gives the director, not this');
  assert.equal(rows[1].admissions, 9382216);
});

test('"Box-Office France" and "Entrées" are the same column', () => {
  // Capitalisation genuinely changes in 2013, and the header changes name
  // entirely across eras. Matching one spelling silently loses ~45 years.
  const withEntrees = `
{| class="wikitable"
|-
! Rang !! Titre !! Pays !! Entrées
|-
| 1. || ''[[Titanic (film, 1997)|Titanic]]'' || {{USA-d}} || {{unité|20675196}}
|}
`;
  const rows = parseBoxOfficePage(withEntrees);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].admissions, 20675196);
});

test('a row whose title cell holds no wikilink is skipped, not guessed at', () => {
  const page = `
{| class="wikitable"
|-
! Rang !! Titre !! Entrées
|-
| 1. || Some Unlinked Film || {{unité|1234567}}
|-
| 2. || ''[[A Linked Film]]'' || {{unité|2345678}}
|}
`;
  const rows = parseBoxOfficePage(page);
  assert.equal(rows.length, 1, 'identity comes from the wikilink; without one there is nothing to resolve');
  assert.equal(rows[0].page, 'A Linked Film');
});

test('a table with no admissions column is ignored entirely', () => {
  // These pages carry several tables — attendance by month, cinema counts —
  // and only the one with both a title and an admissions column is the list.
  const page = `
{| class="wikitable"
|-
! Mois !! Fréquentation
|-
| Janvier || {{unité|15000000}}
|}
{| class="wikitable"
|-
! Rang !! Titre !! Entrées
|-
| 1. || ''[[The Real List]]'' || {{unité|5000000}}
|}
`;
  const rows = parseBoxOfficePage(page);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].page, 'The Real List');
});

test('flag images are never mistaken for the film link', () => {
  // FILM_LINK has to exclude Image:/Fichier:/File:, or the country cell's flag
  // becomes the film for any layout where country precedes title.
  const page = `
{| class="wikitable"
|-
! Titre !! Pays !! Entrées
|-
| [[Image:Flag of France.svg|20px]] ''[[Le Vrai Film]]'' || {{FRA-d}} || {{unité|3000000}}
|}
`;
  const rows = parseBoxOfficePage(page);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].page, 'Le Vrai Film');
});

test('a citation URL in the admissions cell is not mistaken for the figure', () => {
  // How this surfaced: three unrelated 1972 films all came out with exactly
  // 23,262,779 admissions and outranked Bienvenue chez les Ch'tis. The number
  // was the id inside a boxofficestory.com citation URL.
  assert.equal(parseAdmissions('[http://www.boxofficestory.com/paris-1972-c23262779/2]'), null);
  assert.equal(
    parseAdmissions("{{unité|98934|entrées}}\n[http://www.boxofficestory.com/paris-1972-c23262779/2]"),
    98934,
    'the real figure still wins when a citation sits beside it',
  );
  assert.equal(parseAdmissions('{{unité|2191183}}<ref>http://example.com/x-999999999</ref>'), 2191183);
});

test('the weekly Paris table is not parsed as the annual list', () => {
  // These pages carry a second table, "Box-office parisien par semaine", whose
  // header `Film {{n°}}1` normalises to "film 1". Matching column names with
  // startsWith accepted that as the title column, so a weekly chart was read as
  // the year's box office — with every row sharing one citation-derived number.
  const page = `
{| class="wikitable"
|-
! scope=col | Rang
! scope=col | Titre
! scope=col | Pays
! scope=col | Entrées
|-
! scope=row | 1.
| ''[[Le Viager]]''
| {{FRA-d}}
| {{unité|2191183}}
|}

== Box-office parisien par semaine ==
{| class="wikitable"
! #
! Date
! Film {{n°}}1
! Pays
! Entrées
! Sources
|-
| 1
| {{date|5|Janvier|1972}}
| ''[[Les Bidasses en folie]]''
| [[Image:Flag of France.svg|20px]]
| {{unité|98934|entrées}}
| [http://www.boxofficestory.com/paris-1972-c23262779/2]
|}
`;
  const rows = parseBoxOfficePage(page);
  assert.equal(rows.length, 1, 'only the annual table counts');
  assert.equal(rows[0].page, 'Le Viager');
  assert.equal(rows[0].admissions, 2191183);
});

test('a footnote welded to the column header does not hide the column', () => {
  // 1976-1982 write `Entrées<ref>Selon les sites : …</ref>`. Stripping only the
  // tags leaves the footnote text glued to the name, so an exact-match rule
  // stopped seeing the column and those years silently emptied.
  const page = `
{| class="wikitable"
|-
! scope=col | Rang
! scope=col | Titre
! scope=col | Entrées<ref>Selon les sites : [http://www.cbo-boxoffice.com/ CBO] et JP's Box-Office</ref>
|-
! scope=row | 1.
| ''[[La Cage aux folles (film)|La Cage aux folles]]''
| {{unité|5442000}}
|}
`;
  const rows = parseBoxOfficePage(page);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].admissions, 5442000);
});
