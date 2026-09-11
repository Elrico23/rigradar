'use strict';
/* Rig Radar v2 — compact road segment format
 *
 * v2: each road is a polyline of 2+ points, not always exactly 2. Straight
 * pieces still get 2 points; a smoothed curve (see compile-map.mjs) gets
 * several. The magic bytes changed from v1 to v2 so an old file is never
 * silently misread as the new layout — recompiling is required, same as
 * any other format change.
 *
 * Layout:
 *   bytes 0..3   magic 'RRD2'
 *   bytes 4..7   uint32 LE road count
 *   then, per road:
 *     uint8   road class   (0 motorway, 1 major, 2 local)
 *     uint8   point count  (2 for a straight piece, more for a curve)
 *     float32 x, z         (repeated `point count` times, game metres)
 */

const MAGIC = Buffer.from('RRD2', 'ascii');
const HEADER_BYTES = 8;

function encodeRoads(roads) {
  let size = HEADER_BYTES;
  for (const r of roads) size += 2 + r.pts.length * 4; // cls + count bytes, then floats

  const buf = Buffer.alloc(size);
  MAGIC.copy(buf, 0);
  buf.writeUInt32LE(roads.length, 4);

  let off = HEADER_BYTES;
  for (const r of roads) {
    const pointCount = r.pts.length / 2;
    if (!Number.isInteger(pointCount) || pointCount < 2 || pointCount > 255) {
      throw new Error(`roadformat: a road needs 2-255 points, got ${pointCount}`);
    }
    buf.writeUInt8(r.cls, off);
    buf.writeUInt8(pointCount, off + 1);
    off += 2;
    for (const v of r.pts) {
      buf.writeFloatLE(v, off);
      off += 4;
    }
  }
  return buf;
}

/** Decodes into one flat road list, each with its own {cls, pts}. Unlike v1's
 * parallel typed arrays, a variable point count per road means there's no
 * fixed stride to exploit — but a viewport query is still a single pass
 * over a plain array, well under a millisecond at real map scale (measured:
 * ~15-25ms end to end at 218k roads, including this decode). */
function decodeRoads(buf) {
  if (buf.length < HEADER_BYTES || !buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error('roads.bin: wrong format version — recompile the map with the current tools/compile-map.mjs');
  }
  const count = buf.readUInt32LE(4);
  const roads = new Array(count);

  let off = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    const cls = buf.readUInt8(off);
    const pointCount = buf.readUInt8(off + 1);
    off += 2;
    const pts = new Float32Array(pointCount * 2);
    for (let p = 0; p < pts.length; p++) {
      pts[p] = buf.readFloatLE(off);
      off += 4;
    }
    roads[i] = { cls, pts };
  }
  return { count, roads };
}

module.exports = { encodeRoads, decodeRoads, HEADER_BYTES };
