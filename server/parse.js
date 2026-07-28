/**
 * Turning whatever the host pasted or uploaded into `{title, year}` entries.
 * Accepts JSON, CSV, or plain text — one title per line.
 */

/** RFC4180-ish CSV: handles quoted fields, embedded commas and doubled quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ''));
}

const yearFrom = (value) => {
  const year = Number(String(value ?? '').trim());
  return Number.isInteger(year) && year > 1870 && year < 2200 ? year : null;
};

/**
 * Splits a trailing year off a title: "Vertigo (1958)", "Vertigo, 1958",
 * "Vertigo - 1958" and bare "Vertigo" all work.
 */
export function splitTitleYear(line) {
  const text = String(line).trim();

  const parenthesised = /^(.*?)[\s]*[([](\d{4})[)\]]\s*$/.exec(text);
  if (parenthesised) return { title: parenthesised[1].trim(), year: yearFrom(parenthesised[2]) };

  const trailing = /^(.*?)[\s]*[,\-–—]\s*(\d{4})\s*$/.exec(text);
  if (trailing && trailing[1].trim()) {
    return { title: trailing[1].trim(), year: yearFrom(trailing[2]) };
  }

  return { title: text, year: null };
}

export function parseTextList(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map(splitTitleYear)
    .filter((entry) => entry.title);
}

function fromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((cell) => cell.toLowerCase());
  const titleIndex = header.findIndex((cell) => /^(title|name|film|movie)$/.test(cell));
  const yearIndex = header.findIndex((cell) => /^(year|release[_ ]?year)$/.test(cell));

  // No recognisable header: treat every row as data, first column the title.
  if (titleIndex === -1) {
    return rows
      .map((cells) => {
        const explicitYear = yearFrom(cells[1]);
        if (explicitYear) return { title: cells[0], year: explicitYear };
        return splitTitleYear(cells[0]);
      })
      .filter((entry) => entry.title);
  }

  return rows
    .slice(1)
    .map((cells) => ({
      title: (cells[titleIndex] ?? '').trim(),
      year: yearIndex === -1 ? splitTitleYear(cells[titleIndex] ?? '').year : yearFrom(cells[yearIndex]),
    }))
    .filter((entry) => entry.title);
}

function fromJson(value) {
  const list = Array.isArray(value) ? value : value?.movies ?? value?.entries ?? [];
  return list
    .map((item) => {
      if (typeof item === 'string') return splitTitleYear(item);
      const title = String(item?.title ?? item?.name ?? '').trim();
      if (!title) return null;
      return {
        title,
        year: yearFrom(item?.year ?? item?.release_year) ?? splitTitleYear(title).year,
        tmdb_id: Number.isInteger(item?.tmdb_id) ? item.tmdb_id : null,
      };
    })
    .filter((entry) => entry?.title);
}

/**
 * Detects the format rather than trusting the caller: the paste box, a .csv
 * upload and a .json upload all arrive on the same endpoint.
 */
export function parseImport(body, { format } = {}) {
  if (body && typeof body === 'object') return fromJson(body);

  const text = String(body ?? '').trim();
  if (!text) return [];

  if (format === 'json' || text.startsWith('[') || text.startsWith('{')) {
    try {
      return fromJson(JSON.parse(text));
    } catch {
      // Not valid JSON after all — fall through and treat it as text.
    }
  }

  const firstLine = text.split(/\r?\n/, 1)[0];
  if (format === 'csv' || firstLine.includes(',') || firstLine.includes('"')) {
    const rows = parseCsv(text);
    // A single column with no commas is really just a text list.
    if (rows.some((row) => row.length > 1)) return fromCsv(text);
  }

  return parseTextList(text);
}
