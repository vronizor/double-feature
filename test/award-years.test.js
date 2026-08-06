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
