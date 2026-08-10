import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCeremonyWinners, CEREMONY_ANCHORS } from '../scripts/fetch-seed-lists.mjs';

// Fixtures are the real markup from each edition, cut to two ceremonies. The
// three differ enough that a parser passing one can easily fail the others.

test('César: winners are single-* items, nominees are **', () => {
  const page = `
=== Années 1990 ===
* [[15e cérémonie des César|1990]] : '''''[[Trop belle pour toi]]'', réalisé par [[Bertrand Blier]]'''
** ''[[Monsieur Hire]]'', réalisé par [[Patrice Leconte]]
** ''[[Nocturne indien (film)|Nocturne indien]]'' – [[Alain Corneau]]
* [[16e cérémonie des César|1991]] : '''''[[Cyrano de Bergerac (film, 1990)|Cyrano de Bergerac]]'' – [[Jean-Paul Rappeneau]]'''
** ''[[Nikita (film)|Nikita]]'' – [[Luc Besson]]
`;
  const pairs = parseCeremonyWinners(page, CEREMONY_ANCHORS.cesar);
  assert.equal(pairs.length, 2, 'the ** nominee lines must not be read as ceremonies');
  assert.deepEqual(pairs[0], { ceremonyPage: '15e cérémonie des César', winnerPage: 'Trop belle pour toi' });
  assert.equal(pairs[1].ceremonyPage, '16e cérémonie des César');
  assert.equal(pairs[1].winnerPage, 'Cyrano de Bergerac (film, 1990)');
});

// The failure this fixture reproduces was live in the committed seed: the two
// newest César winners were present with a NULL ceremony year, and the fetch
// had reported success. An award list grows by one film a year, so the
// proportional shrink guard cannot tell 49 parsed from 51 — nothing was ever
// going to catch this except a fixture cut from the markup as it is TODAY.
test('César: a bullet with no space before the link is still a winner', () => {
  const page = `
=== Années 2020 ===
* [[49e cérémonie des César|2024]] : '''''[[Anatomie d'une chute]]'', réalisé par [[Justine Triet]]'''
*[[50e cérémonie des César|2025]] : '''''[[Emilia Pérez]]'', réalisé par [[Jacques Audiard]]'''
*[[51e cérémonie des César|2026]] : '''''[[L'Attachement]]'', réalisé par [[Carine Tardieu]]'''
** ''[[Un autre film]]'' – [[Quelqu'un]]
`;
  const pairs = parseCeremonyWinners(page, CEREMONY_ANCHORS.cesar);
  assert.equal(pairs.length, 3, 'the spaceless bullets must parse, and the ** must not');
  assert.equal(pairs[1].ceremonyPage, '50e cérémonie des César');
  assert.equal(pairs[1].winnerPage, 'Emilia Pérez');
  assert.equal(pairs[2].ceremonyPage, '51e cérémonie des César');
  assert.equal(pairs[2].winnerPage, "L'Attachement");
});

test('BAFTA: the winner is the gold-highlighted, bold-italic row', () => {
  const page = `
{| class="wikitable" style="width:100%;"
|-
! Year !! Film !! Director(s)
|-
| rowspan="3"| {{center|'''1990'''<br>{{small|([[44th British Academy Film Awards|44th]])}}}}
| style="background:#FAEB86"| '''''[[Goodfellas]]'''''
| style="background:#FAEB86"| '''[[Martin Scorsese]]'''
|-
| ''[[Crimes and Misdemeanors]]''
| [[Woody Allen]]
|-
| ''[[Pretty Woman]]''
| [[Garry Marshall]]
|-
| rowspan="2"| {{center|'''1991'''<br>{{small|([[45th British Academy Film Awards|45th]])}}}}
| style="background:#FAEB86"| '''''[[The Commitments (film)|The Commitments]]'''''
| style="background:#FAEB86"| '''[[Alan Parker]]'''
|}
`;
  const pairs = parseCeremonyWinners(page, CEREMONY_ANCHORS.bafta);
  assert.equal(pairs.length, 2);
  // The CEREMONY page is captured, never the printed year — 1990 in this table
  // is the year of the FILMS; the 44th ceremony was held in 1991.
  assert.equal(pairs[0].ceremonyPage, '44th British Academy Film Awards');
  assert.equal(pairs[0].winnerPage, 'Goodfellas');
  assert.equal(pairs[1].winnerPage, 'The Commitments (film)');
  assert.ok(!pairs.some((p) => /Pretty Woman|Crimes and/.test(p.winnerPage)), 'nominees are not winners');
});

test('Goya: a full-width header row introduces each ceremony', () => {
  const page = `
{| class=wikitable
! Título y director !! Candidatas
|-
! colspan="8" align="center"| '''[[Anexo:I edición de los Premios Goya|I edición - 1986]]'''
|-
! align="center" |
'''''[[El viaje a ninguna parte (película)|El viaje a ninguna parte]]''''' <br /> <small>(de [[Fernando Fernán Gómez]])</small>
|align="center" |
* ''[[27 horas]]'' ([[Montxo Armendáriz]])
|-
! colspan="8" align="center"| '''[[Anexo:II edición de los Premios Goya|II edición - 1987]]'''
|-
! align="center" |
'''''[[El bosque animado (película)|El bosque animado]]''''' <br /> <small>(de [[José Luis Cuerda]])</small>
|}
`;
  const pairs = parseCeremonyWinners(page, CEREMONY_ANCHORS.goya);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].ceremonyPage, 'Anexo:I edición de los Premios Goya');
  assert.equal(pairs[0].winnerPage, 'El viaje a ninguna parte (película)');
  assert.equal(pairs[1].winnerPage, 'El bosque animado (película)');
  assert.ok(!pairs.some((p) => p.winnerPage === '27 horas'), 'the Candidatas column is nominees');
});

test('a film listed again later keeps the ceremony it actually won', () => {
  // These articles end with "most awarded" summary tables that re-list winners.
  // Without first-occurrence-wins, the summary would overwrite the real year.
  const page = `
* [[15e cérémonie des César|1990]] : '''''[[Trop belle pour toi]]'', réalisé par X'''
* [[40e cérémonie des César|2015]] : '''''[[Timbuktu (film)|Timbuktu]]'', réalisé par Y'''
* [[99e cérémonie des César|2099]] : '''''[[Trop belle pour toi]]'' (rappel)'''
`;
  const pairs = parseCeremonyWinners(page, CEREMONY_ANCHORS.cesar);
  const trop = pairs.filter((p) => p.winnerPage === 'Trop belle pour toi');
  assert.equal(trop.length, 1);
  assert.equal(trop[0].ceremonyPage, '15e cérémonie des César');
});

test('a ceremony with no bold-italic winner is skipped, not mis-attributed', () => {
  // A ceremony that was cancelled or is not yet decided must not inherit the
  // next ceremony's winner.
  const page = `
* [[15e cérémonie des César|1990]] : pas encore décerné
* [[16e cérémonie des César|1991]] : '''''[[Cyrano de Bergerac (film, 1990)|Cyrano]]'' – Z'''
`;
  const pairs = parseCeremonyWinners(page, CEREMONY_ANCHORS.cesar);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].ceremonyPage, '16e cérémonie des César');
});

// --- Ties ------------------------------------------------------------------
//
// A ceremony with two winners writes them in whichever register is NOT being
// used for the sole winner, so the bold-italic marker finds nothing and the
// year silently produces no pair at all. Measured live on the 39th Goya, which
// went to El 47 AND La infiltrada: both were seeded with a null ceremony year
// while every count still added up to 40 films.

test('Goya: a tie written in single italic yields BOTH winners, and no nominees', () => {
  const page = `
! colspan="8" align="center"| '''[[Anexo:XXXVIII edición de los Premios Goya|XXXVIII edición - 2023]]'''
|-
!style="background:#;" align="center" | '''''[[La sociedad de la nieve]]''''' <br />
! colspan="8" align="center"| '''[[Anexo:XXXIX edición de los Premios Goya|XXXIX edición - 2024]]'''
|-
!style="background:#;" align="center" |
<small><small>(''ex aequo'')</small></small> <br>
''[[El 47]]'' <br>
<hr/>
''[[La infiltrada]]'' <br>
|style="background:#;" align="center" |
* ''[[Casa en llamas]]'' ([[Dani de la Orden]])
* ''[[Segundo premio (película) |Segundo premio]]'' ([[Isaki Lacuesta]])
`;
  const pairs = parseCeremonyWinners(page, CEREMONY_ANCHORS.goya);

  assert.equal(pairs.length, 3, 'the sole winner above, plus BOTH tied winners');
  assert.equal(pairs[0].winnerPage, 'La sociedad de la nieve');
  assert.deepEqual(
    pairs.slice(1).map((p) => p.winnerPage),
    ['El 47', 'La infiltrada'],
  );
  // The nominees sit in a bulleted cell in the same block and are also single
  // italic — dropping the bullet lines is the whole difference between two
  // winners and five films.
  assert.ok(!pairs.some((p) => /Casa en llamas|Segundo premio/.test(p.winnerPage)));
});

test('César: a tie written in BOLD italic also yields both', () => {
  const page = `
* [[9e cérémonie des César|1984]] : ''ex aequo'' '''''[[Le Bal (film, 1983)|Le Bal]]''''' et '''''[[À nos amours]]'''''
* [[10e cérémonie des César|1985]] : '''''[[Les Ripoux]]''''' – [[Claude Zidi]]
`;
  const pairs = parseCeremonyWinners(page, CEREMONY_ANCHORS.cesar);

  assert.deepEqual(pairs.map((p) => p.winnerPage), ['Le Bal (film, 1983)', 'À nos amours', 'Les Ripoux']);
  assert.equal(pairs[1].ceremonyPage, '9e cérémonie des César', 'both are dated by the SAME ceremony');
});

test('without "ex aequo", only the first bold-italic film still wins', () => {
  // The guard that must not be widened. A block runs to the next anchor, so
  // the LAST one swallows the rest of the article — the real Goya XL block
  // contains 32 bold-italic films from the "most awarded" summary tables. And
  // BAFTA's blocks carry the winners of its other film categories.
  const page = `
! colspan="8" align="center"| '''[[Anexo:XL edición de los Premios Goya|XL edición - 2025]]'''
|-
!style="background:#;" align="center" | '''''[[Los domingos]]'''''
== Más premiadas ==
'''''[[Mar adentro]]''''' and '''''[[Volver (película de 2006)|Volver]]'''''
`;
  const pairs = parseCeremonyWinners(page, CEREMONY_ANCHORS.goya);

  assert.deepEqual(pairs.map((p) => p.winnerPage), ['Los domingos']);
});

test('a block with neither a bold-italic film nor a tie yields nothing', () => {
  // 23 of the César article's anchors are ceremony links elsewhere on the page
  // rather than award rows. They must stay silent, not fall through to the
  // single-italic fallback and start harvesting nominees.
  const page = `
* [[15e cérémonie des César|1990]] : voir aussi la [[16e cérémonie des César|suite]]
** ''[[Un nominé]]'' – Quelqu'un
`;
  assert.deepEqual(parseCeremonyWinners(page, CEREMONY_ANCHORS.cesar), []);
});
