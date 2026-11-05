'use strict';

// Deterministic text normalization for verification comparisons.
//
// Rules (applied identically to official and draft values):
//  1. Non-string input normalizes to null (missing), never to "".
//  2. Unicode NFKC normalization (compatibility equivalents unified).
//  3. All control/format characters (Unicode Cc/Cf) are removed.
//  4. Every run of whitespace (spaces, tabs, newlines, NBSP, …) collapses to
//     one ASCII space; leading/trailing whitespace is removed.
//  5. Empty results normalize to null.
//  6. Defensive length cap (10 000 chars); domain validators cap much earlier.
//
// Titles additionally compare case-insensitively. Venues additionally resolve
// explicitly configured aliases and unify a small set of punctuation so that
// "Main-Hall" matches "Main Hall" while "Room 1.5" still differs from
// "Room 15" (separators become spaces instead of disappearing).

const MAX_TEXT_LENGTH = 10000;
const CONTROL_RE = /[\p{Cc}\p{Cf}]/gu;
const WHITESPACE_RUN_RE = /\s+/g;
// Apostrophe-likes are dropped ("St Mary's" -> "st marys"), including the
// typographic quotes U+2018/U+2019; other separator punctuation becomes a
// space ("Hall-A" -> "hall a", "1.5" -> "1 5").
const APOSTROPHE_RE = /['\u2018\u2019\u201B\u02BC]/g;
const SEPARATOR_PUNCT_RE = /[.,\-_/:;()[\]{}]+/g;

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  // Collapse whitespace FIRST: tab/newline are control chars too, but they
  // separate words (a\tb -> "a b"), unlike NUL/SHY which vanish (a\0b -> "ab").
  let out = value.normalize('NFKC').replace(WHITESPACE_RUN_RE, ' ');
  out = out.replace(CONTROL_RE, '').replace(WHITESPACE_RUN_RE, ' ').trim();
  if (out === '') return null;
  if (out.length > MAX_TEXT_LENGTH) out = out.slice(0, MAX_TEXT_LENGTH);
  return out;
}

function normalizeTitleForCompare(value) {
  const text = normalizeText(value);
  return text === null ? null : text.toLowerCase();
}

function normalizeVenueCore(value) {
  const text = normalizeText(value);
  if (text === null) return null;
  return text
    .replace(APOSTROPHE_RE, '')
    .replace(SEPARATOR_PUNCT_RE, ' ')
    .replace(WHITESPACE_RUN_RE, ' ')
    .trim()
    .toLowerCase();
}

// Build a lookup of normalized-alias -> normalized-canonical from the raw
// config map (whose keys are already lowercased but not punct-normalized).
function buildVenueAliasLookup(venueAliases) {
  const lookup = new Map();
  if (!venueAliases || typeof venueAliases !== 'object') return lookup;
  for (const [alias, canonical] of Object.entries(venueAliases)) {
    const key = normalizeVenueCore(alias);
    const target = normalizeVenueCore(canonical);
    if (key && target) lookup.set(key, target);
  }
  return lookup;
}

// Returns { key, aliasUsed } where `key` is the comparison key and `aliasUsed`
// is true when an explicit alias produced it (for audit explanations).
function normalizeVenueForCompare(value, aliasLookup) {
  const core = normalizeVenueCore(value);
  if (core === null) return { key: null, aliasUsed: false };
  if (aliasLookup instanceof Map && aliasLookup.has(core)) {
    return { key: aliasLookup.get(core), aliasUsed: true };
  }
  return { key: core, aliasUsed: false };
}

module.exports = {
  normalizeText,
  normalizeTitleForCompare,
  normalizeVenueForCompare,
  normalizeVenueCore,
  buildVenueAliasLookup,
};
