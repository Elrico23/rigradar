'use strict';
/* Rig Radar v2 — coordinate projection
 *
 * The problem: MapLibre wants lng/lat. The game gives us metres in a flat
 * world (X = east, Z = south). We need ONE transform used by both the map
 * geometry and the live truck marker, or the truck drifts off the roads.
 *
 * Rather than reverse-engineer someone else's projection, we define our own
 * and use it for everything. Game space maps linearly into Web Mercator
 * space, then Mercator-inverts to lat. That keeps the map conformal (no
 * shearing, north stays north, circles stay circles at every zoom).
 *
 *   u =  (X - cx) * s          -> longitude, degrees
 *   v = -(Z - cz) * s          -> Mercator northing, in "degrees"
 *   lat = gudermannian(v)
 *
 * cx/cz/s live in data/<game>/projection.json, written by compile-map.mjs
 * from the real bounds of the parsed map. Defaults below are only used
 * before a map has been compiled.
 */

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

const DEFAULTS = {
  // Rough world centres and a scale that fits each map inside ~110 deg of
  // longitude. compile-map.mjs overwrites these with measured values.
  ats: { cx: -60000, cz: 20000, s: 0.00035 },
  ets2: { cx: -5000, cz: 0, s: 0.00045 },
};

/** Mercator northing (in degrees) -> latitude (degrees). */
function gudermannian(v) {
  return (2 * Math.atan(Math.exp(v * RAD)) - Math.PI / 2) * DEG;
}

/** Latitude (degrees) -> Mercator northing (in degrees). */
function gudermannianInverse(lat) {
  return Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2)) * DEG;
}

class Projection {
  /** @param {{cx:number, cz:number, s:number}} p */
  constructor(p) {
    this.cx = p.cx;
    this.cz = p.cz;
    this.s = p.s;
  }

  static forGame(game, override) {
    return new Projection(override || DEFAULTS[game] || DEFAULTS.ets2);
  }

  /**
   * Game world metres -> [lng, lat].
   * @param {number} x game X (east)
   * @param {number} z game Z (south)
   * @returns {[number, number]}
   */
  toLngLat(x, z) {
    const lng = (x - this.cx) * this.s;
    const v = -(z - this.cz) * this.s;
    return [lng, gudermannian(v)];
  }

  /**
   * [lng, lat] -> game world metres.
   * @returns {[number, number]} [x, z]
   */
  toGame(lng, lat) {
    const x = lng / this.s + this.cx;
    const z = -gudermannianInverse(lat) / this.s + this.cz;
    return [x, z];
  }

  toJSON() {
    return { cx: this.cx, cz: this.cz, s: this.s };
  }
}

/**
 * Fits a projection so the given game-space bounds land inside a safe
 * lng/lat window. Called by compile-map.mjs once, per game.
 * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds
 */
function fitProjection(bounds, spanDegrees = 100) {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxZ - bounds.minZ, 1);
  // Keep the taller dimension inside the window too, so we never approach
  // the Mercator poles where the inverse blows up.
  const s = spanDegrees / Math.max(width, height);
  return new Projection({ cx, cz, s });
}

/** SCS heading (0..1, 0 = north, increasing counter-clockwise) -> degrees clockwise from north. */
function headingToDegrees(h) {
  let deg = -h * 360;
  deg %= 360;
  if (deg < 0) deg += 360;
  return deg;
}

module.exports = {
  Projection,
  fitProjection,
  headingToDegrees,
  gudermannian,
  gudermannianInverse,
  DEFAULTS,
};
