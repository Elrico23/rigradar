'use strict';
/* Rig Radar v2 — compact lot/building footprint format
 *
 * Prefab-interior "polygon" mapPoints (parking lots, building footprints,
 * grass/median strips) — the fill counterpart to roadformat.js's road
 * polylines. Same layout idea, closed rings instead of open polylines, and
 * a colour index instead of a road class.
 *
 * Layout:
 *   bytes 0..3   magic 'RRA1'
 *   bytes 4..7   uint32 LE polygon count
 *   then, per polygon:
 *     uint8   colour index (SCS MapAreaColor: 0 road, 1 light, 2 dark, 3 green)
 *     uint16  point count  (closed ring, first point not repeated at the end)
 *     float32 x, z         (repeated `point count` times, game metres)
 */

const MAGIC = Buffer.from('RRA1', 'ascii');
const HEADER_BYTES = 8;

function encodeAreas(areas) {
  let size = HEADER_BYTES;
  for (const a of areas) size += 3 + a.pts.length * 4; // colour + uint16 count, then floats

  const buf = Buffer.alloc(size);
  MAGIC.copy(buf, 0);
  buf.writeUInt32LE(areas.length, 4);

  let off = HEADER_BYTES;
  for (const a of areas) {
    const pointCount = a.pts.length / 2;
    if (!Number.isInteger(pointCount) || pointCount < 3 || pointCount > 65535) {
      throw new Error(`areaformat: a polygon needs 3-65535 points, got ${pointCount}`);
    }
    buf.writeUInt8(a.color, off);
    buf.writeUInt16LE(pointCount, off + 1);
    off += 3;
    for (const v of a.pts) {
      buf.writeFloatLE(v, off);
      off += 4;
    }
  }
  return buf;
}

function decodeAreas(buf) {
  if (buf.length < HEADER_BYTES || !buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error('areas.bin: wrong format version — recompile the map with the current tools/compile-map.mjs');
  }
  const count = buf.readUInt32LE(4);
  const areas = new Array(count);

  let off = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    const color = buf.readUInt8(off);
    const pointCount = buf.readUInt16LE(off + 1);
    off += 3;
    const pts = new Float32Array(pointCount * 2);
    for (let p = 0; p < pts.length; p++) {
      pts[p] = buf.readFloatLE(off);
      off += 4;
    }
    areas[i] = { color, pts };
  }
  return { count, areas };
}

module.exports = { encodeAreas, decodeAreas, HEADER_BYTES };
