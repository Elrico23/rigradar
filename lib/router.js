'use strict';
/* Rig Radar v2 — router
 *
 * The graph is built once at load time from the compiled roads: every node
 * is a road endpoint or an intersection point, every edge a road piece or a
 * short connector through a junction. Positions only — no lane names, no
 * road numbers, because the parser doesn't hand those over on a plate (a
 * road is a `roadLookToken` like "nm_tmpl02", not "I-40"). So manoeuvres
 * read "turn left in 400 m" rather than "take I-40 north" for now.
 */

const CELL = 2000; // metres — bucket size for the nearest-node grid

class Router {
  /**
   * @param {{x:number, z:number, e:[number, number][]}[]} nodes
   *   e is a list of [neighbourIndex, distanceMetres].
   */
  constructor(nodes) {
    this.nodes = nodes;
    this.grid = new Map(); // "cx,cz" -> index[]
    for (let i = 0; i < nodes.length; i++) {
      const key = this._cellKey(nodes[i].x, nodes[i].z);
      let bucket = this.grid.get(key);
      if (!bucket) this.grid.set(key, (bucket = []));
      bucket.push(i);
    }
  }

  _cellKey(x, z) {
    return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  }

  /** Nearest graph node to a world position, searching outward ring by ring. */
  nearest(x, z) {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best = -1;
    let bestDist = Infinity;

    for (let ring = 0; ring < 6; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const bucket = this.grid.get(`${cx + dx},${cz + dz}`);
          if (!bucket) continue;
          for (const i of bucket) {
            const n = this.nodes[i];
            const d = (n.x - x) ** 2 + (n.z - z) ** 2;
            if (d < bestDist) {
              bestDist = d;
              best = i;
            }
          }
        }
      }
      // Once a candidate is found, one more ring catches anything just
      // across a cell boundary that's still closer.
      if (best >= 0 && ring > 0) break;
    }
    return best;
  }

  /** Dijkstra — the graph has no useful heuristic distance (no lat/lng yet
   * at this layer), so plain shortest-path rather than true A*. Fast enough
   * at a few hundred thousand nodes for one route request. */
  route(fromIdx, toIdx) {
    if (fromIdx < 0 || toIdx < 0) return null;
    const dist = new Float64Array(this.nodes.length).fill(Infinity);
    const prev = new Int32Array(this.nodes.length).fill(-1);
    const visited = new Uint8Array(this.nodes.length);
    dist[fromIdx] = 0;

    // A binary heap keeps this fast even on a large graph; an array with
    // linear scan would be O(n^2) and noticeably slow past ~50k nodes.
    const heap = new MinHeap();
    heap.push(0, fromIdx);

    while (heap.size) {
      const { key: d, value: u } = heap.pop();
      if (visited[u]) continue;
      visited[u] = 1;
      if (u === toIdx) break;
      if (d > dist[u]) continue;

      for (const [v, w] of this.nodes[u].e) {
        const nd = d + w;
        if (nd < dist[v]) {
          dist[v] = nd;
          prev[v] = u;
          heap.push(nd, v);
        }
      }
    }

    if (dist[toIdx] === Infinity) return null;

    const path = [];
    for (let at = toIdx; at !== -1; at = prev[at]) path.push(at);
    path.reverse();
    return path.map((i) => ({ x: this.nodes[i].x, z: this.nodes[i].z }));
  }
}

class MinHeap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  push(key, value) {
    this.a.push({ key, value });
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p].key <= this.a[i].key) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  pop() {
    const top = this.a[0];
    const last = this.a.pop();
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.a.length && this.a[l].key < this.a[smallest].key) smallest = l;
        if (r < this.a.length && this.a[r].key < this.a[smallest].key) smallest = r;
        if (smallest === i) break;
        [this.a[smallest], this.a[i]] = [this.a[i], this.a[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * Turns a point chain into a short list of manoeuvres: a heading change past
 * a threshold becomes a turn instruction, tagged with the distance along the
 * route travelled so far so the phone can count down to it.
 *
 * Total angle alone is a poor test: a wide, gentle highway sweep and a tight
 * intersection corner can share the same total bearing change if the sweep
 * just happens to be represented by long graph edges. What actually makes
 * something feel like a "turn" is how *quickly* the heading changes — degrees
 * per metre, not degrees on their own. A 28° bend over 400m is a curve you'd
 * barely notice; the same 28° over 20m is a real corner. ratePerMetre below
 * corresponds to roughly a 115m turning radius — tighter than that reads as
 * an actual turn, wider than that reads as the road just curving.
 */
function buildManoeuvres(points, turnThresholdDeg = 28, ratePerMetre = 0.5) {
  if (points.length < 3) return [];
  const manoeuvres = [];
  let travelled = 0;

  const bearing = (a, b) => (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI;
  const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

  let prevBearing = bearing(points[0], points[1]);
  let prevSeg = dist(points[0], points[1]);
  travelled += prevSeg;

  for (let i = 1; i < points.length - 1; i++) {
    const seg = dist(points[i], points[i + 1]);
    const nextBearing = bearing(points[i], points[i + 1]);
    let delta = ((nextBearing - prevBearing + 540) % 360) - 180;

    // Rate uses whichever adjacent segment is shorter — a real corner is
    // short on at least one side (the approach or the exit), whereas a
    // gentle sweep is long on both, so this catches "sharp on either end"
    // without needing both segments to individually look sharp.
    const rate = Math.abs(delta) / Math.max(Math.min(prevSeg, seg), 1);

    // A large divergence (45°+) is a real fork or exit regardless of how
    // gently it's shaped — that's a genuine direction split, not the same
    // road curving, so it's always worth a manoeuvre even at highway radius.
    const isRealFork = Math.abs(delta) >= 45;

    if (Math.abs(delta) >= turnThresholdDeg && (rate >= ratePerMetre || isRealFork)) {
      // The turn's own coordinates travel with it, so the phone can measure
      // a live "distance to next turn" by comparing against the truck's
      // current position — atDistance alone only tells you the route-start
      // offset, which is fixed and doesn't count down as you drive.
      manoeuvres.push({
        atDistance: travelled,
        x: points[i].x,
        z: points[i].z,
        direction: delta > 0 ? 'left' : 'right',
        angle: Math.round(Math.abs(delta)),
        // The heading you'll be travelling AFTER the turn — lets the client
        // draw a rotated arrow on the road itself, not just a card of text.
        heading: (nextBearing + 360) % 360,
      });
    }
    prevBearing = nextBearing;
    prevSeg = seg;
    travelled += seg;
  }
  return manoeuvres;
}

/**
 * Smooths a route's raw graph-node path into a curve for display, using the
 * same Catmull-Rom technique as the background road network — but simpler:
 * a route is a single path, not a network, so every interior point already
 * has exactly one "before" and one "after" from the path itself. There's no
 * ambiguous-junction case to guard against here the way there is for the
 * road network, so every corner gets smoothed, including real turns — which
 * is also what Waze and Google Maps do, since a route line rounding through
 * an intersection reads as more natural than a hard angle.
 *
 * Manoeuvre detection deliberately runs on the RAW path, not this smoothed
 * one — the turn distance countdown compares against the truck's real
 * position, and the real turn happens at the actual graph node, not at a
 * smoothed curve point a few metres off from it.
 */
function smoothRoute(points, samplesPerSegment = 4) {
  if (points.length < 3) return points;

  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  const out = [points[0]];

  // Centripetal parameterization (sqrt of chord length between control
  // points), not uniform spacing — the same technique tools/compile-map.mjs
  // uses for the background road network, and for the same reason: uniform
  // Catmull-Rom badly overshoots on sharp, unevenly-spaced turns (measured
  // 140m+ off the true path on a realistic corner). Using the simpler
  // uniform formula here would reintroduce that exact bug for the route
  // line specifically, even though the road network underneath it is fine.
  const chordSqrt = (a, b) => Math.max(Math.hypot(b.x - a.x, b.z - a.z) ** 0.5, 1e-6);
  const lerp = (a, b, ta, tb, t) => {
    const f = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
  };

  for (let i = 0; i < points.length - 1; i++) {
    // Endpoints have no real neighbour beyond them, so the segment itself
    // stands in for one — a standard clamped-spline technique that keeps
    // the curve from overshooting at the very start and end of a route.
    const p0 = at(i - 1);
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = at(i + 2);

    const t0 = 0;
    const t1 = t0 + chordSqrt(p0, p1);
    const t2 = t1 + chordSqrt(p1, p2);
    const t3 = t2 + chordSqrt(p2, p3);

    for (let s = 1; s <= samplesPerSegment; s++) {
      const t = t1 + ((t2 - t1) * s) / samplesPerSegment;
      const a1 = lerp(p0, p1, t0, t1, t);
      const a2 = lerp(p1, p2, t1, t2, t);
      const a3 = lerp(p2, p3, t2, t3, t);
      const b1 = lerp(a1, a2, t0, t2, t);
      const b2 = lerp(a2, a3, t1, t3, t);
      out.push(lerp(b1, b2, t1, t2, t));
    }
  }
  return out;
}

module.exports = { Router, buildManoeuvres, smoothRoute };
