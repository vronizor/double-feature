import { randomBytes } from 'node:crypto';

// Crockford-style alphabet with the look-alikes removed (no 0/O, 1/l/I) so a
// slug read off the host's screen and typed into a phone can't go wrong.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const LIMIT = 256 - (256 % ALPHABET.length);

/** ~887 million possibilities at length 6 — unguessable for a LAN party. */
export function generateSlug(length = 6) {
  let slug = '';
  while (slug.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= LIMIT) continue; // rejection sample, so every char is equally likely
      slug += ALPHABET[byte % ALPHABET.length];
      if (slug.length === length) break;
    }
  }
  return slug;
}

export const isValidSlug = (value) =>
  typeof value === 'string' && /^[2-9a-hjkmnp-z]{4,16}$/.test(value);
