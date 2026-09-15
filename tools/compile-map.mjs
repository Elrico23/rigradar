#!/usr/bin/env node
/* Rig Radar v2 — map compiler
 *
 * Turns the parser's JSON dump into what the server actually needs:
 * road geometry, a search index, and a routing graph. Run after every
 * `npx parser` re-run (new DLC, updated game version).
 *
 *   node tools/compile-map.mjs ats  C:\parsed\ats
 *   node tools/compile-map.mjs ets2 C:\parsed\ets2
 *
 * Set NODE_OPTIONS=--max-old-space-size=8192 first, same as for the parser —
 * the nodes file alone is 300+ MB of JSON.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeRoads } from '../lib/roadformat.js';
import { fitProjection } from '../lib/coords.js';

const GAME = process.argv[2];
const INPUT_DIR = process.argv[3];
const PREFIX = { ats: 'usa', ets2: 'europe' }[GAME];

if (!PREFIX || !INPUT_DIR) {
  console.error('Usage: node tools/compile-map.mjs <ats|ets2> <parserOutputDir>');
  process.exit(1);
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, 'data', GAME);
mkdirSync(OUT_DIR, { recursive: true });

function readJson(name) {
  const file = join(INPUT_DIR, `${PREFIX}-${name}.json`);
  process.stdout.write(`  reading ${PREFIX}-${name}.json... `);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`${Array.isArray(data) ? data.length : Object.keys(data).length} records`);
  return data;
}

console.log(`\nCompiling ${GAME} from ${INPUT_DIR}\n`);

// ---------------------------------------------------------------------------
// 1. Figure out which node UIDs actually matter — roads and prefabs — so we
//    only keep coordinates for those out of the (huge) nodes file.
// ---------------------------------------------------------------------------

const roadLooks = readJson('roadLooks');
const roads = readJson('roads');
const prefabs = readJson('prefabs');
const prefabDescriptions = readJson('prefabDescriptions');

const roadLookByToken = new Map(roadLooks.map((r) => [r.token, r]));
const prefabDescByToken = new Map(prefabDescriptions.map((d) => [d.token, d]));

/** Road class from lane count: more lanes reads as a bigger road on screen. */
function classify(roadLookToken) {
  const look = roadLookByToken.get(roadLookToken);
  const lanes = look ? (look.lanesLeft?.length || 0) + (look.lanesRight?.length || 0) : 2;
  if (lanes >= 4) return 0; // motorway
  if (lanes >= 2) return 1; // major
  return 2; // local
}

const neededNodes = new Set();
for (const r of roads) {
  neededNodes.add(r.startNodeUid);
  neededNodes.add(r.endNodeUid);
}
for (const p of prefabs) {
  for (const uid of p.nodeUids || []) neededNodes.add(uid);
}
console.log(`  ${neededNodes.size} node positions needed (out of the full node set)`);

// ---------------------------------------------------------------------------
// 2. Pull just those coordinates out of the nodes file. The parser names the
//    ground-plane axes x/y and elevation z; our world uses x/z for ground and
//    drops elevation, to match what the game's shared memory already gives us.
// ---------------------------------------------------------------------------

process.stdout.write(`  reading ${PREFIX}-nodes.json (this is the big one)... `);
const rawNodes = JSON.parse(readFileSync(join(INPUT_DIR, `${PREFIX}-nodes.json`), 'utf8'));
console.log(`${rawNodes.length} records`);

const nodePos = new Map(); // uid -> {x, z}
const nodeRot = new Map(); // uid -> rotation (radians) — needed to place prefab interiors, below
for (const n of rawNodes) {
  if (neededNodes.has(n.uid)) {
    nodePos.set(n.uid, { x: n.x, z: n.y });
    nodeRot.set(n.uid, n.rotation);
  }
}
console.log(`  matched ${nodePos.size} of ${neededNodes.size} referenced nodes`);
rawNodes.length = 0; // let the rest be collected before the next big read

// ---------------------------------------------------------------------------
// 3. Road geometry. A real road is already broken into many short straight
//    pieces by the game (your own parse logged this: "roads possibly split
//    by terrains, buildings, or curves"), so a chain of those pieces around
//    a bend is a rough polygon approximation of a smooth curve. Rather than
//    trust the uncertain sign convention of the parser's node `rotation`
//    field, this reconstructs the curve the same way any spline-through-
//    points technique does: using only positions we already trust.
//
//    Safety rule: a node is only treated as a "pass-through" point on a
//    curve if exactly two roads touch it. Three or more means a real
//    junction, where there's no single "continuation direction" to smooth
//    toward — those stay straight chords, unchanged from before.
// ---------------------------------------------------------------------------

const nodeRoads = new Map(); // nodeUid -> [{ roadIndex, otherEnd }]
function touch(nodeUid, roadIndex, otherEnd) {
  let list = nodeRoads.get(nodeUid);
  if (!list) nodeRoads.set(nodeUid, (list = []));
  list.push({ roadIndex, otherEnd });
}
roads.forEach((r, i) => {
  if (nodePos.has(r.startNodeUid) && nodePos.has(r.endNodeUid)) {
    touch(r.startNodeUid, i, r.endNodeUid);
    touch(r.endNodeUid, i, r.startNodeUid);
  }
});

/** The far endpoint of "the other road" at a node, only when exactly one
 * other road touches it — otherwise null, meaning "don't smooth this end". */
function passThroughNeighbour(nodeUid, thisRoadIndex) {
  const list = nodeRoads.get(nodeUid);
  if (!list || list.length !== 2) return null;
  const other = list.find((t) => t.roadIndex !== thisRoadIndex);
  return other ? nodePos.get(other.otherEnd) || null : null;
}

/** Centripetal Catmull-Rom through P0-P1-P2-P3, returning only the P1->P2
 * span. Uniform parameterization (the simpler, more common formula) badly
 * overshoots exactly when segment lengths differ a lot around a sharp turn
 * — measured on a real-world-shaped corner, it bowed points more than 140m
 * off the true path. Centripetal parameterization (using each segment's
 * square-rooted chord length rather than assuming equal spacing) is the
 * standard fix for this specific failure mode and stays close to the
 * control points regardless of how uneven the segment lengths are. */
function centripetalCatmullRom(p0, p1, p2, p3, sampleCount) {
  const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z) ** 0.5; // sqrt of chord length, hence "centripetal"

  const t0 = 0;
  const t1 = t0 + Math.max(dist(p0, p1), 1e-6);
  const t2 = t1 + Math.max(dist(p1, p2), 1e-6);
  const t3 = t2 + Math.max(dist(p2, p3), 1e-6);

  const lerp = (a, b, ta, tb, t) => {
    const f = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
  };

  const pts = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = t1 + ((t2 - t1) * i) / (sampleCount - 1);
    const a1 = lerp(p0, p1, t0, t1, t);
    const a2 = lerp(p1, p2, t1, t2, t);
    const a3 = lerp(p2, p3, t2, t3, t);
    const b1 = lerp(a1, a2, t0, t2, t);
    const b2 = lerp(a2, a3, t1, t3, t);
    const c = lerp(b1, b2, t1, t2, t);
    pts.push(c.x, c.z);
  }
  return pts;
}

const CURVE_SAMPLES = 5;

const segments = [];
let missing = 0;
let smoothed = 0;
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

roads.forEach((r, i) => {
  const a = nodePos.get(r.startNodeUid);
  const b = nodePos.get(r.endNodeUid);
  if (!a || !b) {
    missing++;
    return;
  }

  const before = passThroughNeighbour(r.startNodeUid, i);
  const after = passThroughNeighbour(r.endNodeUid, i);

  let pts;
  if (before && after) {
    pts = centripetalCatmullRom(before, a, b, after, CURVE_SAMPLES);
    smoothed++;
  } else {
    pts = [a.x, a.z, b.x, b.z];
  }

  segments.push({ cls: classify(r.roadLookToken), pts });
  minX = Math.min(minX, a.x, b.x);
  maxX = Math.max(maxX, a.x, b.x);
  minZ = Math.min(minZ, a.z, b.z);
  maxZ = Math.max(maxZ, a.z, b.z);
});
if (missing) console.log(`  ⚠ ${missing} road pieces had a missing endpoint node — skipped`);
console.log(`  ${segments.length} road segments compiled (${smoothed} smoothed as curves)`);

// ---------------------------------------------------------------------------
// 3b. Prefab interiors. A prefab (interchange, gas station, weigh station,
//     parking lot...) has its own internal road network, described in
//     prefabDescriptions in the prefab's own local coordinate space. Until
//     now nothing read that — only a prefab's boundary nodes were kept, for
//     routing connectivity (section 4) — so every interchange or lot drew as
//     a few disconnected straight stubs with nothing joining them up, which
//     is exactly what a live side-by-side against TruckSim's own GPS showed.
//
//     World placement mirrors truckermudgeon/maps' own toMapPosition
//     (packages/libs/map/prefabs.ts): anchor on nodeUids[0]'s world
//     position/rotation, offset by the description's own node at
//     originNodeIndex. Deliberately nodeUids[0], not
//     nodeUids[originNodeIndex] — matching that proven implementation
//     rather than the more "obvious" pairing.
// ---------------------------------------------------------------------------

/** Road class from a prefab mapPoint's own lane counts — classify() above
 * keys off a roadLookToken, which prefab-interior points don't have. */
function classifyLanes(left, right) {
  const lanes = (typeof left === 'number' ? left : 0) + (typeof right === 'number' ? right : 0);
  if (lanes >= 4) return 0;
  if (lanes >= 2) return 1;
  return 2;
}

let prefabsPlaced = 0, prefabsSkipped = 0, prefabSegments = 0;

for (const p of prefabs) {
  const desc = prefabDescByToken.get(p.token);
  const anchorUid = p.nodeUids?.[0];
  const anchorPos = anchorUid && nodePos.get(anchorUid);
  const anchorRot = anchorUid ? nodeRot.get(anchorUid) : undefined;
  const originLocal = desc?.nodes?.[p.originNodeIndex];
  if (!desc || !anchorPos || anchorRot === undefined || !originLocal) {
    prefabsSkipped++;
    continue;
  }

  const theta = anchorRot - originLocal.rotation;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const toWorld = (lx, ly) => {
    const dx = lx - originLocal.x;
    const dy = ly - originLocal.y;
    return { x: anchorPos.x + dx * cos - dy * sin, z: anchorPos.z + dx * sin + dy * cos };
  };

  const seenPairs = new Set();
  const mapPoints = desc.mapPoints || [];
  for (let i = 0; i < mapPoints.length; i++) {
    const point = mapPoints[i];
    if (point.type !== 'road') continue;
    for (const j of point.neighbors) {
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      const neighbour = mapPoints[j];
      if (!neighbour || neighbour.type !== 'road') continue;
      const a = toWorld(point.x, point.y);
      const b = toWorld(neighbour.x, neighbour.y);
      segments.push({ cls: classifyLanes(point.lanesLeft, point.lanesRight), pts: [a.x, a.z, b.x, b.z] });
      prefabSegments++;
    }
  }
  prefabsPlaced++;
}
console.log(`  prefab interiors: ${prefabsPlaced} placed (${prefabSegments} segments added), ${prefabsSkipped} skipped (no description/anchor match)`);

writeFileSync(join(OUT_DIR, 'roads.bin'), encodeRoads(segments));

// ---------------------------------------------------------------------------
// 4. Routing graph — roads become edges; prefabs (junctions) get their
//    endpoint nodes connected so a route can actually pass through them.
//    Large interchanges are chained rather than fully meshed, so one messy
//    junction can't blow up the edge count.
// ---------------------------------------------------------------------------

const nodeIndex = new Map(); // uid -> index into graphNodes
const graphNodes = []; // {x, z, e: [[idx, dist], ...]}

function nodeIdx(uid) {
  let i = nodeIndex.get(uid);
  if (i === undefined) {
    const p = nodePos.get(uid);
    if (!p) return -1;
    i = graphNodes.length;
    nodeIndex.set(uid, i);
    graphNodes.push({ x: p.x, z: p.z, e: [] });
  }
  return i;
}

const distance = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

function connect(uidA, uidB, dist) {
  const a = nodeIdx(uidA);
  const b = nodeIdx(uidB);
  if (a < 0 || b < 0 || a === b) return;
  graphNodes[a].e.push([b, dist]);
  graphNodes[b].e.push([a, dist]);
}

for (const r of roads) {
  const a = nodePos.get(r.startNodeUid);
  const b = nodePos.get(r.endNodeUid);
  if (!a || !b) continue;
  const dist = r.length > 0 ? r.length : distance(a, b);
  connect(r.startNodeUid, r.endNodeUid, dist);
}

const MAX_CLIQUE = 8;
for (const p of prefabs) {
  const uids = (p.nodeUids || []).filter((u) => nodePos.has(u));
  if (uids.length < 2) continue;
  if (uids.length <= MAX_CLIQUE) {
    for (let i = 0; i < uids.length; i++) {
      for (let j = i + 1; j < uids.length; j++) {
        const a = nodePos.get(uids[i]);
        const b = nodePos.get(uids[j]);
        connect(uids[i], uids[j], distance(a, b));
      }
    }
  } else {
    // A big interchange: chain consecutive nodes rather than mesh every
    // pair, so a 40-node flyover doesn't add ~800 edges for one junction.
    for (let i = 0; i < uids.length - 1; i++) {
      const a = nodePos.get(uids[i]);
      const b = nodePos.get(uids[i + 1]);
      connect(uids[i], uids[i + 1], distance(a, b));
    }
  }
}

const edgeCount = graphNodes.reduce((sum, n) => sum + n.e.length, 0) / 2;
console.log(`  routing graph: ${graphNodes.length} nodes, ${edgeCount} edges`);
writeFileSync(join(OUT_DIR, 'graph.json'), JSON.stringify(graphNodes));

// ---------------------------------------------------------------------------
// 5. Search index — cities and companies. Companies already cover fuel
//    stops, repair shops and the like, since the game treats those as
//    companies too; there's no separate "services" file to join against.
// ---------------------------------------------------------------------------

const cities = readJson('cities');
const companies = readJson('companies');
const companyDefs = readJson('companyDefs');

const cityByToken = new Map(cities.map((c) => [c.token, c]));
const defByToken = new Map(companyDefs.map((d) => [d.token, d]));

const searchIndex = [];

for (const c of cities) {
  searchIndex.push({ id: `city:${c.token}`, name: c.name, kind: 'City', x: c.x, z: c.y });
}
for (const co of companies) {
  const def = defByToken.get(co.token);
  const city = cityByToken.get(co.cityToken);
  searchIndex.push({
    id: `co:${co.uid}`,
    name: def ? def.name : co.token,
    kind: 'Company',
    city: city ? city.name : undefined,
    x: co.x,
    z: co.y,
  });
}
console.log(`  search index: ${searchIndex.length} entries`);
writeFileSync(join(OUT_DIR, 'search-index.json'), JSON.stringify(searchIndex));

// ---------------------------------------------------------------------------
// 5b. Road signs and facilities — both come from the same POI file, read
//     once and shared: `type: "road"` is a highway shield ("US 400",
//     "I-15"); `type: "facility"` is gas, parking, repair, and the like,
//     each with an icon token that already names its category cleanly (no
//     guessing from a company name or cargo list needed, unlike the
//     "Company" entries in the search index above). Everything else
//     (viewpoints, landmarks, ferries already covered separately) is
//     dropped — not relevant to either a shield or a facility badge.
// ---------------------------------------------------------------------------

const FACILITY_KINDS = {
  gas_ico: 'fuel',
  parking_ico: 'rest',
  service_ico: 'repair',
  weigh_station_ico: 'weigh',
  garage_large_ico: 'garage',
  dealer_ico: 'dealer',
  recruitment_ico: 'recruitment',
};

let signs = [];
let facilities = [];
try {
  const pois = readJson('pois');
  signs = pois
    .filter((p) => p.type === 'road' && p.icon)
    .map((p) => ({ x: p.x, z: p.y, label: formatShield(p.icon) }))
    .filter((s) => s.label);
  console.log(`  road signs: ${signs.length} of ${pois.length} POIs`);

  facilities = pois
    .filter((p) => p.type === 'facility' && FACILITY_KINDS[p.icon])
    .map((p) => ({ x: p.x, z: p.y, kind: FACILITY_KINDS[p.icon] }));
  console.log(`  facilities: ${facilities.length} of ${pois.length} POIs`);
} catch {
  console.log('  ⚠ no pois file found — skipping road signs and facilities');
}

/** "us400" -> "US 400", "i15" -> "I 15" (ATS: no country prefix at all) —
 * splits the letters from the digits. ETS2 icons additionally carry a
 * country code ahead of the route itself ("d_a9" for a German A9, "no_e6"
 * for a Norwegian E6) which needs stripping first, or every European
 * shield renders as the raw token ("D_A9") instead of a shield — this was
 * silently wrong for 2981 of ETS2's 2982 compiled signs before anyone
 * checked the actual output instead of just the one hand-picked ATS
 * example in this comment. A handful of `type: "road"` POIs also aren't
 * route shields at all (toll booths, weigh/agricultural checkpoints,
 * border crossings, and at least one stray "QUARRY") — every real route
 * is numbered, so "no digit anywhere once the prefix is gone" is what
 * actually distinguishes those, rather than hardcoding each facility
 * name one at a time as they turn up. Returns null for those, filtered
 * out by the caller. */
function formatShield(icon) {
  const stripped = icon.replace(/^[a-z]{1,3}_/i, '');
  if (!/\d/.test(stripped)) return null;
  const m = /^([a-z]+)(\d.*)$/i.exec(stripped);
  return m ? `${m[1].toUpperCase()} ${m[2]}` : stripped.toUpperCase();
}

writeFileSync(join(OUT_DIR, 'signs.json'), JSON.stringify(signs));
writeFileSync(join(OUT_DIR, 'facilities.json'), JSON.stringify(facilities));

// ---------------------------------------------------------------------------
// 5c. City footprints — cities.json already carries its own `areas` array,
//     a set of rectangles used by the game editor. Most are hidden helper
//     zones; the one visible rectangle per city is the actual footprint,
//     which lets the map shade urban extent instead of a bare dot.
// ---------------------------------------------------------------------------

const cityAreas = [];
for (const c of cities) {
  for (const a of c.areas || []) {
    if (a.hidden) continue;
    cityAreas.push({ x: a.x, z: a.y, w: a.width, h: a.height });
  }
}
console.log(`  city footprints: ${cityAreas.length}`);
writeFileSync(join(OUT_DIR, 'city-areas.json'), JSON.stringify(cityAreas));

// ---------------------------------------------------------------------------
// 5d. Ferry routes — each terminal lists its own connections, already
//     carrying the far end's coordinates, so no node lookup is needed here
//     the way roads and prefabs required one.
// ---------------------------------------------------------------------------

let ferryLines = [];
try {
  const ferries = readJson('ferries');
  for (const f of ferries) {
    for (const conn of f.connections || []) {
      // Most crossings are a straight hop between two ports, but some bend
      // around coastline via intermediatePoints — building a flat pts array
      // (same convention as roads) handles both without a separate code
      // path for the curved case.
      const pts = [f.x, f.y];
      for (const ip of conn.intermediatePoints || []) {
        if (typeof ip.x === 'number' && typeof ip.y === 'number') pts.push(ip.x, ip.y);
      }
      pts.push(conn.x, conn.y);
      ferryLines.push({ pts, name: `${f.name} — ${conn.name}`, train: Boolean(f.train) });
    }
  }
  console.log(`  ferry routes: ${ferryLines.length}`);
} catch {
  console.log('  ⚠ no ferries file found — skipping ferry routes');
}
writeFileSync(join(OUT_DIR, 'ferries.json'), JSON.stringify(ferryLines));

// ---------------------------------------------------------------------------
// 6. Projection and metadata — one shared coordinate system for map, truck
//    and route, fitted to this game's actual bounds rather than a guess.
// ---------------------------------------------------------------------------

const projection = fitProjection({ minX, maxX, minZ, maxZ });

writeFileSync(
  join(OUT_DIR, 'meta.json'),
  JSON.stringify(
    {
      game: GAME,
      compiledAt: new Date().toISOString(),
      projection: projection.toJSON(),
      bounds: { minX, maxX, minZ, maxZ },
      roadCount: segments.length,
      graphNodeCount: graphNodes.length,
      poiCount: searchIndex.length,
      signCount: signs.length,
      cityAreaCount: cityAreas.length,
      ferryCount: ferryLines.length,
      cityCount: cities.length,
    },
    null,
    2,
  ),
);

console.log(`\n  done — written to ${OUT_DIR}\n`);
