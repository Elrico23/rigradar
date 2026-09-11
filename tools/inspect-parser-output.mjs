#!/usr/bin/env node
/* Rig Radar v2 — parser output inspector
 *
 * Reads the JSON files produced by `npx parser -i <game> -o <dir>` and prints
 * a compact schema summary: file sizes, record counts, key names, value types
 * and one anonymised sample per file.
 *
 * Nothing is uploaded anywhere. It only prints to your terminal.
 *
 *   node tools/inspect-parser-output.mjs "C:\trucksim\parsed\ats"
 *
 * Paste the output back into the chat and I'll write the map compiler
 * against the exact shapes rather than guessing at them.
 */

import { readdirSync, statSync, createReadStream } from 'node:fs';
import { join, basename } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node tools/inspect-parser-output.mjs <parserOutputDir>');
  process.exit(1);
}

const MAX_SAMPLE_CHARS = 1200;
const MAX_KEYS = 40;

/** Reads the first N bytes of a file as text, without loading the whole thing. */
function head(path, bytes = 400_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let len = 0;
    const stream = createReadStream(path, { encoding: 'utf8', end: bytes });
    stream.on('data', (c) => {
      chunks.push(c);
      len += c.length;
    });
    stream.on('end', () => resolve(chunks.join('')));
    stream.on('error', reject);
  });
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'array(empty)';
    return `array<${typeOf(v[0])}>[${v.length}]`;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    return `object{${keys.slice(0, 6).join(',')}${keys.length > 6 ? ',…' : ''}}`;
  }
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  return typeof v;
}

/** Describes the shape of one record without dumping the whole thing. */
function describe(record, indent = '    ') {
  if (record === null || typeof record !== 'object') return `${indent}${typeOf(record)}`;
  const keys = Object.keys(record).slice(0, MAX_KEYS);
  return keys.map((k) => `${indent}${k}: ${typeOf(record[k])}`).join('\n');
}

function truncate(s, n = MAX_SAMPLE_CHARS) {
  return s.length > n ? `${s.slice(0, n)}\n    … (truncated)` : s;
}

function fmtSize(bytes) {
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes > 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'));

console.log(`\n=== Rig Radar parser output inspection ===`);
console.log(`Directory: ${dir}`);
console.log(`JSON files: ${files.length}\n`);

// A quick manifest first, so oversized files are obvious at a glance.
for (const f of files) {
  const size = statSync(join(dir, f)).size;
  console.log(`  ${f.padEnd(40)} ${fmtSize(size).padStart(10)}`);
}

const pngs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png'));
if (pngs.length) {
  console.log(`\n  (plus ${pngs.length} PNG files, e.g. ${pngs.slice(0, 3).join(', ')})`);
}

for (const f of files) {
  const path = join(dir, f);
  const size = statSync(path).size;
  console.log(`\n\n--- ${basename(f)} (${fmtSize(size)}) ---`);

  let text;
  try {
    text = await head(path);
  } catch (err) {
    console.log(`    ! could not read: ${err.message}`);
    continue;
  }

  // Small enough to parse whole? Then report exact counts.
  if (size < 300_000) {
    try {
      const data = JSON.parse(text);
      reportParsed(data);
      continue;
    } catch {
      /* fall through to partial reporting */
    }
  }

  // Large file: report the top-level container and the first record only.
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[')) {
    console.log(`    top level: array (too large to count here)`);
    const first = firstJsonValue(trimmed.slice(1));
    if (first) {
      console.log(`    first record shape:`);
      console.log(describe(first, '      '));
      console.log(`    first record raw:\n    ${truncate(JSON.stringify(first, null, 2))}`);
    }
  } else if (trimmed.startsWith('{')) {
    console.log(`    top level: object`);
    console.log(`    opening bytes:\n    ${truncate(trimmed.slice(0, 900))}`);
  } else {
    console.log(`    unrecognised opening: ${trimmed.slice(0, 80)}`);
  }
}

function reportParsed(data) {
  if (Array.isArray(data)) {
    console.log(`    top level: array of ${data.length}`);
    if (data.length) {
      console.log(`    record shape:`);
      console.log(describe(data[0], '      '));
      console.log(`    sample:\n    ${truncate(JSON.stringify(data[0], null, 2))}`);
    }
  } else if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    console.log(`    top level: object with ${keys.length} keys`);
    console.log(describe(data, '      '));
    const firstKey = keys[0];
    if (firstKey !== undefined) {
      console.log(`    sample value for "${firstKey}":`);
      console.log(`    ${truncate(JSON.stringify(data[firstKey], null, 2), 700)}`);
    }
  } else {
    console.log(`    top level: ${typeOf(data)}`);
  }
}

/** Pulls the first complete JSON value out of a string by brace matching. */
function firstJsonValue(s) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
