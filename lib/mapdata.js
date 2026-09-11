'use strict';
/* Rig Radar v2 — compiled map loader
 *
 * Everything here is read once at server startup. A viewport query is a
 * linear scan over typed arrays, which sounds slow but isn't: a few hundred
 * thousand float comparisons is well under a millisecond, and it means the
 * compiler stays simple (no spatial index to keep in sync on disk).
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { decodeRoads } = require('./roadformat');
const { Router, buildManoeuvres, smoothRoute } = require('./router');

/** True if any point of a flat [x,z,x,z,...] polyline falls in a box — not
 * just the endpoints, since a curved polyline can bow into view while both
 * ends sit outside it. */
function polylineHitsBox(pts, minX, maxX, minZ, maxZ) {
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] >= minX && pts[i] <= maxX && pts[i + 1] >= minZ && pts[i + 1] <= maxZ) return true;
  }
  return false;
}

const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

class CompiledMap {
  constructor({ meta, roads, search, router, signs, cityAreas, ferries }) {
    this.meta = meta;
    this.roads = roads; // decoded typed arrays
    this.search = search; // array of {id, name, kind, city, x, z}
    this.router = router; // Router instance, or null if the graph was empty
    this.signs = signs || []; // array of {x, z, label} — highway shields
    this.cityAreas = cityAreas || []; // array of {x, z, w, h} — urban footprints
    this.ferries = ferries || []; // array of {pts:[x,z,x,z,...], name, train}
  }

  /** Road segments intersecting a viewport, expanded a little so lines
   * don't visibly clip at the screen edge while panning. maxClass caps
   * which road classes are included (0 = motorway only ... 2 = everything),
   * for the level-of-detail cutoff applied at wide zoom. */
  roadsInView(minX, maxX, minZ, maxZ, pad = 400, maxClass = 2) {
    const lo_x = minX - pad, hi_x = maxX + pad;
    const lo_z = minZ - pad, hi_z = maxZ + pad;
    const out = [];
    for (const r of this.roads.roads) {
      if (r.cls > maxClass) continue;
      if (polylineHitsBox(r.pts, lo_x, hi_x, lo_z, hi_z)) out.push({ cls: r.cls, pts: Array.from(r.pts) });
    }
    return out;
  }

  searchByName(query, limit = 20) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [];
    for (const item of this.search) {
      if (item.name.toLowerCase().includes(q) || (item.city && item.city.toLowerCase().includes(q))) {
        out.push(item);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /** City and company names within a viewport, for map labels. Cities come
   * first and aren't capped by the limit — there are only ever a few
   * hundred per map, so they can't flood the response on their own. */
  labelsInView(minX, maxX, minZ, maxZ, companyLimit = 150) {
    const cities = [];
    const companies = [];
    for (const item of this.search) {
      if (item.x < minX || item.x > maxX || item.z < minZ || item.z > maxZ) continue;
      if (item.kind === 'City') cities.push(item);
      else if (item.kind === 'Company' && companies.length < companyLimit) companies.push(item);
    }
    return { cities, companies };
  }

  /** Highway shields within a viewport — only useful at close zoom, so the
   * client decides whether to actually draw them. */
  signsInView(minX, maxX, minZ, maxZ) {
    const out = [];
    for (const s of this.signs) {
      if (s.x >= minX && s.x <= maxX && s.z >= minZ && s.z <= maxZ) out.push(s);
    }
    return out;
  }

  /** City footprint rectangles overlapping a viewport, for background
   * shading. A rectangle overlaps if it isn't entirely on one side of the
   * box — the same test as any axis-aligned rect intersection. */
  cityAreasInView(minX, maxX, minZ, maxZ) {
    const out = [];
    for (const a of this.cityAreas) {
      const ax1 = a.x - a.w / 2, ax2 = a.x + a.w / 2;
      const az1 = a.z - a.h / 2, az2 = a.z + a.h / 2;
      if (ax2 < minX || ax1 > maxX || az2 < minZ || az1 > maxZ) continue;
      out.push(a);
    }
    return out;
  }

  /** Ferry crossings touching a viewport — a crossing is in view if any
   * point along its path (not just the two ports) falls in the box, since
   * a curved route can bow into view even when both ends are outside it. */
  ferriesInView(minX, maxX, minZ, maxZ) {
    return this.ferries.filter((f) => polylineHitsBox(f.pts, minX, maxX, minZ, maxZ));
  }

  findById(id) {
    return this.search.find((s) => s.id === id) || null;
  }

  /**
   * Matches the game's own job destination string — "City" or
   * "City — Company", built by lib/telemetry.js straight from shared
   * memory — against the compiled search index. This is what lets a route
   * appear the moment a job starts, with nothing typed into search.
   */
  matchJobDestination(job) {
    if (!job || !job.destination) return null;
    const parts = job.destination.split(' — ').map((s) => s.trim().toLowerCase());
    const [cityName, companyName] = parts;

    if (companyName) {
      const exact = this.search.find(
        (s) => s.kind === 'Company' && s.name.toLowerCase() === companyName &&
          (!s.city || s.city.toLowerCase() === cityName),
      );
      if (exact) return exact;
      // Company names can carry punctuation the parser rendered slightly
      // differently ("Chuck & Jack's" vs "Chuck and Jack's") — normalizing
      // both sides down to the same bare-word form catches those. A plain
      // substring match doesn't actually fix this (differing punctuation
      // still isn't a substring of the other) and risks matching an
      // unrelated company whose name happens to contain another's, so the
      // comparison runs on the normalized form instead.
      const normalize = (s) => s.replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      const normalizedCompany = normalize(companyName);
      const loose = this.search.find(
        (s) => s.kind === 'Company' && s.city && s.city.toLowerCase() === cityName &&
          normalize(s.name.toLowerCase()) === normalizedCompany,
      );
      if (loose) return loose;
    }

    return this.search.find((s) => s.kind === 'City' && s.name.toLowerCase() === cityName) || null;
  }

  /** Builds a route from a world position to a search result. */
  routeTo(from, destId) {
    if (!this.router) return { error: 'no-graph', message: 'This map has no routing graph.' };
    const dest = this.findById(destId);
    if (!dest) return { error: 'not-found', message: 'Unknown destination.' };

    const startIdx = this.router.nearest(from.x, from.z);
    const endIdx = this.router.nearest(dest.x, dest.z);
    const rawPoints = this.router.route(startIdx, endIdx);
    if (!rawPoints) return { error: 'no-route', message: 'No path found between those points.' };

    // Manoeuvres and distance come from the raw graph-node path — that's
    // where the truck's real turns actually happen. The smoothed version is
    // for drawing the line only, so a curve refinement here can never throw
    // off a turn countdown or the trip distance shown on the waybill.
    return {
      destination: dest.name,
      points: smoothRoute(rawPoints),
      manoeuvres: buildManoeuvres(rawPoints),
      distance: rawPoints.reduce(
        (sum, p, i) => (i === 0 ? 0 : sum + dist(p, rawPoints[i - 1])),
        0,
      ),
    };
  }
}

/** Older compiled maps won't have every optional file — signs.json,
 * city-areas.json and ferries.json were all added after roads and search
 * already existed — so a missing file means "none of these", not an error. */
function readOptionalJson(dataDir, filename) {
  const file = path.join(dataDir, filename);
  if (!fs.existsSync(file)) return [];
  return fsp.readFile(file, 'utf8').then(JSON.parse);
}

// Reads every file for one game's compiled map concurrently rather than one
// after another — at 200k+ road segments these are multi-MB files, and two
// games load side by side at server startup (see server.js's
// `Promise.all([loadMap('ats'), loadMap('ets2')])`), so overlapping the I/O
// here is what actually lets that outer Promise.all parallelize instead of
// just queuing two sequential blocking reads.
async function loadCompiledMap(dataDir) {
  const [meta, roadsBuf, search, signs, cityAreas, ferries, nodes] = await Promise.all([
    fsp.readFile(path.join(dataDir, 'meta.json'), 'utf8').then(JSON.parse),
    fsp.readFile(path.join(dataDir, 'roads.bin')),
    fsp.readFile(path.join(dataDir, 'search-index.json'), 'utf8').then(JSON.parse),
    readOptionalJson(dataDir, 'signs.json'),
    readOptionalJson(dataDir, 'city-areas.json'),
    readOptionalJson(dataDir, 'ferries.json'),
    readOptionalJson(dataDir, 'graph.json'),
  ]);
  const roads = decodeRoads(roadsBuf);
  const router = nodes.length ? new Router(nodes) : null;

  return new CompiledMap({ meta, roads, search, router, signs, cityAreas, ferries });
}

module.exports = { CompiledMap, loadCompiledMap };
