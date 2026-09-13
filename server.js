'use strict';
/* Rig Radar v2 — telemetry + map server for ETS2 and ATS
 *
 * No npm install. Pure Node standard library, so it starts instantly on a
 * gaming PC and there is nothing to rebuild when Node updates.
 *
 * Telemetry reaches the phone over Server-Sent Events rather than a
 * WebSocket: it is one-way, it reconnects by itself when your phone sleeps
 * and wakes, and it needs no dependency.
 *
 *   node server.js                 live if the game is running, demo if not
 *   node server.js --demo          force the demo drive
 *   node server.js --port 3000
 */

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const { Projection } = require('./lib/coords');
const { loadCompiledMap } = require('./lib/mapdata');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');

const args = process.argv.slice(2);
const FORCE_DEMO = args.includes('--demo');
const portArg = args[args.indexOf('--port') + 1];
const PORT = portArg === undefined ? 3000 : Number(portArg);
const TICK_MS = 66; // ~15 Hz to the phone

// ---------------------------------------------------------------------------
// Telemetry source
// ---------------------------------------------------------------------------

/* The PowerShell sidecar reads the SCS shared memory block and writes
 * base64 lines to stdout. lib/telemetry.js turns one of those blocks into a
 * plain object. Both come from your existing Rig Radar install — drop them
 * in beside this file and live mode switches on by itself. */

let parseBlock = null;
try {
  parseBlock = require('./lib/telemetry').parse;
} catch {
  /* no parser yet — demo mode only */
}

const state = {
  connected: false,
  source: 'demo',
  game: 'ets2',
  truck: { x: 0, z: 0, heading: 0, speed: 0, gear: 0, rpm: 0, cruise: 0 },
  fuel: { litres: 0, capacity: 1, warning: false },
  damage: { engine: 0, transmission: 0, trailer: 0 },
  job: null,
  navigation: { distance: 0, time: 0, speedLimit: 0 },
  wallet: 0,
  gameTime: 0,
};

let reader = null;

// A Ctrl+C or a normal shutdown request should take reader.ps1 down with
// it — without this, killing node leaves the PowerShell sidecar running
// forever in the background (it has no way to know its parent is gone),
// polling shared memory in a tight loop that nothing will ever stop short
// of Task Manager. Doesn't cover a forceful kill of node itself (SIGKILL
// can't be intercepted by definition, on Windows or anywhere else) — that
// half is reader.ps1's own job, checking that its parent PID is still
// alive rather than trusting node to always tell it to stop.
function stopReader() {
  if (reader) reader.kill();
}
process.on('SIGINT', () => { stopReader(); process.exit(0); });
process.on('SIGTERM', () => { stopReader(); process.exit(0); });

function startReader() {
  if (FORCE_DEMO || !parseBlock) return;
  const script = path.join(ROOT, 'reader.ps1');
  if (!fs.existsSync(script)) {
    console.log('  reader.ps1 not found — running the demo drive instead.');
    return;
  }

  reader = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let buffer = '';
  reader.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      // The sidecar emits NOMAP when the game is not publishing yet.
      if (line === 'NOMAP') { state.connected = false; continue; }
      try {
        applyTelemetry(parseBlock(Buffer.from(line, 'base64')));
      } catch (err) {
        // A malformed frame is not worth killing the stream over.
        if (process.env.RR_VERBOSE) console.error('frame error:', err.message);
      }
    }
  });

  reader.stderr.on('data', (d) => console.error('[reader]', d.toString().trim()));
  reader.on('exit', (code) => {
    console.log(`  reader.ps1 exited (${code}) — falling back to the demo drive, retrying in 5s.`);
    state.connected = false;
    state.source = 'demo';
    reader = null;
    // The sidecar can exit for a transient reason (a shared-memory glitch
    // during a game loading screen, a PowerShell hiccup) while the game is
    // still running fine — without a retry the app is stuck on the demo
    // drive until someone notices and restarts the whole server by hand.
    setTimeout(startReader, 5000);
  });
}

let lastFrameAt = 0;

function applyTelemetry(t) {
  if (!t) return;
  lastFrameAt = Date.now();
  state.connected = true;
  state.source = 'live';
  if (t.game) state.game = t.game;
  Object.assign(state, t);
}

// Live data that stops arriving means the game was closed or paused.
setInterval(() => {
  if (state.source === 'live' && Date.now() - lastFrameAt > 2000) {
    state.connected = false;
  }
}, 1000);

// ---------------------------------------------------------------------------
// Demo drive — a plausible run so the phone shows something before the game
// is wired up.
// ---------------------------------------------------------------------------

// Start on a south-easterly heading, well clear of the 0/360 seam, and let
// the curve wander gently rather than oscillating about a single value.
// x/z default to the engine's raw world origin, which is only a placeholder
// — pickDemoStart() below replaces it with a real point on the compiled
// road network once one is available, since the origin itself often isn't
// near any road at all (for ETS2 specifically, it's out in open water) and
// search/auto-route/reroute-on-deviation would otherwise have nothing to
// work against from the very first tick.
// startX/startZ anchor the wander leash below — kept separate from x/z
// (which move every tick) so there's always a fixed point to measure
// distance from and steer back toward.
const demo = { t: 0, x: 0, z: 0, startX: 0, startZ: 0, heading: 2.3, speed: 0, target: 84 };

// Replaced by pickDemoStart() once a compiled map loads; kept as a fallback
// for a fresh install that hasn't run Phase 2 yet, where there's no real
// destination to route to regardless of the (also placeholder) position.
let demoJob = {
  cargo: 'Mobile Barrier',
  mass: 0,
  income: 4820,
  source: 'Vienna',
  destination: 'North Western Transport',
};

/** Finds a well-connected node in a compiled map's routing graph — a busy
 * junction is about as "on a real road" as a position gets — plus a real
 * company at a plausible haul distance from it, so the demo drive exercises
 * search, auto-routing, and reroute-on-deviation the same way live
 * telemetry would, instead of starting and routing against fabricated data
 * that never matches anything in the compiled map. */
function pickDemoStart(compiled) {
  const nodes = compiled.router?.nodes;
  if (!nodes?.length) return null;

  let hub = nodes[0];
  for (const n of nodes) if (n.e.length > hub.e.length) hub = n;

  const companies = compiled.search.filter((s) => s.kind === 'Company');
  if (!companies.length) return { x: hub.x, z: hub.z, job: null };

  // Sorted by distance so a real haul can be picked deliberately — roughly
  // a third of the way through the list is far enough to be a real trip,
  // not so far it's clear across the map.
  const sorted = companies
    .map((c) => ({ c, d: Math.hypot(c.x - hub.x, c.z - hub.z) }))
    .sort((a, b) => a.d - b.d);
  const dest = sorted[Math.floor(sorted.length / 3)].c;

  return {
    x: hub.x,
    z: hub.z,
    job: {
      cargo: 'Mobile Barrier',
      mass: 0,
      income: 4820,
      source: 'Depot',
      destination: dest.city ? `${dest.city} — ${dest.name}` : dest.name,
    },
  };
}

// How far the demo drive can wander from its start point before the leash
// below starts steering it back. Loose enough that the wander still looks
// natural at ordinary demo-session lengths, tight enough that it can't
// drift out of the locally-dense road network around a real starting hub
// and end up somewhere routing can't reach (the same failure mode the
// engine's raw (0,0) origin had, just reachable anywhere given enough time
// with nothing pulling it back).
const MAX_WANDER_METRES = 15000;

function stepDemo(dt) {
  demo.t += dt;
  // Ease towards a target speed that changes every half minute or so.
  if (Math.floor(demo.t / 28) !== Math.floor((demo.t - dt) / 28)) {
    demo.target = [50, 66, 84, 89, 72][Math.floor(Math.random() * 5)];
  }
  demo.speed += (demo.target - demo.speed) * dt * 0.25;
  // A long lazy curve, so the map has something to rotate against.
  demo.heading += Math.sin(demo.t / 37) * dt * 0.05 + Math.sin(demo.t / 91) * dt * 0.03;

  // Leash: below 60% of the radius this contributes nothing, so short and
  // medium demo sessions look exactly as before — pure lazy wandering, no
  // steering toward anything. Past that it ramps in a gentle pull toward
  // the start point, strong enough by 100% of the radius to turn the drive
  // around rather than let it cross the line, but still added to (not
  // replacing) the wander above, so the turn itself still looks like a
  // normal curve rather than a snap to a new heading.
  const distFromStart = Math.hypot(demo.x - demo.startX, demo.z - demo.startZ);
  const pull = Math.min(1, Math.max(0, (distFromStart - MAX_WANDER_METRES * 0.6) / (MAX_WANDER_METRES * 0.4)));
  if (pull > 0) {
    const bearingToStart = Math.atan2(demo.startX - demo.x, -(demo.startZ - demo.z));
    const diff = ((bearingToStart - demo.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    demo.heading += diff * pull * dt * 0.8;
  }

  const mps = demo.speed / 3.6;
  demo.x += Math.sin(demo.heading) * mps * dt;
  demo.z -= Math.cos(demo.heading) * mps * dt;

  state.connected = false;
  state.source = 'demo';
  state.truck = {
    x: demo.x,
    z: demo.z,
    heading: ((demo.heading * 180) / Math.PI + 360) % 360,
    speed: demo.speed,
    gear: Math.min(12, Math.max(1, Math.round(demo.speed / 8) + 3)),
    rpm: 900 + (demo.speed % 12) * 90,
    rpmMax: 2100,
    cruise: demo.speed > 80 ? demo.speed : 0,
  };
  state.fuel = { litres: Math.max(0, 997 - demo.t * 0.06), capacity: 1041, warning: false };
  state.damage = { engine: 0.01, transmission: 0, trailer: 0.04 };
  state.navigation = {
    distance: Math.max(0, 1039000 - demo.t * mps * 4),
    time: Math.max(0, 52320 - demo.t * 4),
    speedLimit: 80,
  };
  state.job = demoJob;
  state.wallet = 97447;
}

// ---------------------------------------------------------------------------
// Map data — populated by tools/compile-map.mjs once you have parsed the games
// ---------------------------------------------------------------------------

const maps = new Map(); // game -> { ready, compiled, projection }

async function loadMap(game) {
  const dir = path.join(DATA_DIR, game);
  try {
    const compiled = await loadCompiledMap(dir);
    maps.set(game, {
      ready: true,
      compiled,
      projection: new Projection(compiled.meta.projection),
    });
    console.log(
      `  map loaded: ${game} (${compiled.meta.roadCount} roads, ${compiled.meta.poiCount} searchable places, ` +
        `${compiled.meta.graphNodeCount} routing nodes)`,
    );
  } catch (err) {
    if (process.env.RR_VERBOSE) console.error(`  map not ready for ${game}:`, err.message);
    maps.set(game, { ready: false, compiled: null, projection: Projection.forGame(game) });
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const clients = new Set();

function broadcast() {
  if (!clients.size) return;
  const map = maps.get(state.game);
  const proj = map ? map.projection : Projection.forGame(state.game);
  const [lng, lat] = proj.toLngLat(state.truck.x, state.truck.z);

  const payload = JSON.stringify({
    ...state,
    position: { lng, lat },
    mapReady: Boolean(map && map.ready),
    at: Date.now(),
  });

  const frame = `data: ${payload}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  // Never serve outside public/.
  if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'Forbidden' });

  try {
    const data = await fsp.readFile(file);
    // sw.js governs the whole update cycle — caching it defeats every future
    // update push, since the browser would keep the stale service worker
    // for up to an hour regardless of what's actually on disk.
    const noCache = rel === 'index.html' || rel === 'sw.js';
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': noCache ? 'no-cache' : 'max-age=3600',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}

// Shared by both the plain-HTTP server (unchanged, still the default) and
// the optional HTTPS one below — a phone's real "Install app" flow (as
// opposed to a plain browser tab, or the simpler "Create shortcut") needs
// a secure origin to load at all once installed, which plain HTTP over a
// LAN IP never counts as.
async function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Lets a shell hosted elsewhere (e.g. Netlify) call this PC's API. There's
  // no auth or cookie state to leak here, so a wide-open origin is fine —
  // reflecting the request's own origin (rather than '*') so it still works
  // when the browser requires credentials mode for the EventSource/fetch.
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  // Served over plain HTTP deliberately, not just HTTPS — a phone that
  // hasn't trusted this self-signed cert yet can't reach the HTTPS side
  // reliably at all, so the one file it needs to fetch first to start
  // trusting it has to come from the side that already works everywhere.
  // application/x-x509-ca-cert is what gets Android's browser to offer
  // "install this certificate" instead of just downloading an opaque file.
  if (url.pathname === '/rootCA.crt') {
    try {
      const cert = fs.readFileSync(path.join(CERT_DIR, 'server.crt'));
      res.writeHead(200, { 'content-type': 'application/x-x509-ca-cert' });
      return res.end(cert);
    } catch {
      res.writeHead(404);
      return res.end('No certificate generated yet.');
    }
  }

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    // A dead socket can fail an async write with an 'error' event rather than
    // a synchronous throw; with no listener that's an uncaught exception that
    // takes the whole process down, so every other connected phone drops too.
    res.on('error', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/api/status') {
    return json(res, 200, {
      version: '2.14.0',
      source: state.source,
      connected: state.connected,
      game: state.game,
      maps: Object.fromEntries([...maps].map(([g, m]) => [g, m.ready])),
      clients: clients.size,
    });
  }

  const game = url.searchParams.get('game') || state.game;
  const map = maps.get(game);
  const notReady = () =>
    json(res, 501, {
      error: 'no-map-data',
      message: `No compiled map for ${game}. Run the parser, then tools/compile-map.mjs.`,
    });

  if (url.pathname === '/api/geo') {
    if (!map || !map.ready) return notReady();
    const rawBounds = ['minX', 'maxX', 'minZ', 'maxZ'].map((k) => url.searchParams.get(k));
    if (rawBounds.some((v) => v === null || v === '')) {
      return json(res, 400, { error: 'bad-request', message: 'minX, maxX, minZ, maxZ are required.' });
    }
    const [minX, maxX, minZ, maxZ] = rawBounds.map(Number);
    if ([minX, maxX, minZ, maxZ].some(Number.isNaN)) {
      return json(res, 400, { error: 'bad-request', message: 'minX, maxX, minZ, maxZ are required.' });
    }

    // Level of detail: zoomed out far enough, thousands of local streets are
    // sub-pixel clutter anyway and cost real bytes over a phone connection —
    // a full-map query on a real compiled map measured 9+ MB and 300ms+
    // before this cutoff existed. maxClass 0 = motorways only, 1 = + major,
    // 2 = everything. Signs and company names are similarly illegible past
    // a point, so they're dropped rather than sent and silently discarded.
    const span = Math.max(maxX - minX, maxZ - minZ);
    const maxClass = span > 60000 ? 0 : span > 20000 ? 1 : 2;
    const showDetail = span < 20000;

    return json(res, 200, {
      roads: map.compiled.roadsInView(minX, maxX, minZ, maxZ, 400, maxClass),
      labels: map.compiled.labelsInView(minX, maxX, minZ, maxZ, showDetail ? 150 : 0),
      signs: showDetail ? map.compiled.signsInView(minX, maxX, minZ, maxZ) : [],
      cityAreas: map.compiled.cityAreasInView(minX, maxX, minZ, maxZ),
      ferries: map.compiled.ferriesInView(minX, maxX, minZ, maxZ),
    });
  }

  if (url.pathname === '/api/search') {
    if (!map || !map.ready) return notReady();
    const q = url.searchParams.get('q') || '';
    return json(res, 200, map.compiled.searchByName(q));
  }

  if (url.pathname === '/api/autoroute') {
    if (!map || !map.ready) return notReady();
    if (!state.job) return json(res, 404, { error: 'no-job', message: 'No active job to route to.' });

    const dest = map.compiled.matchJobDestination(state.job);
    if (!dest) {
      return json(res, 404, {
        error: 'no-match',
        message: `Couldn't find "${state.job.destination}" in the compiled map.`,
      });
    }
    const result = map.compiled.routeTo({ x: state.truck.x, z: state.truck.z }, dest.id);
    if (result.error) return json(res, 404, result);
    return json(res, 200, result);
  }

  if (url.pathname === '/api/route' && req.method === 'POST') {
    if (!map || !map.ready) return notReady();
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1_000_000) req.destroy(); // a route request is never this big
    });
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: 'bad-request', message: 'Invalid JSON body.' });
      }
      const from = parsed.from || state.truck;
      const result = map.compiled.routeTo({ x: from.x, z: from.z }, parsed.to);
      if (result.error) return json(res, 404, result);
      return json(res, 200, result);
    });
    return;
  }

  return serveStatic(res, url.pathname);
}

const server = http.createServer(requestHandler);

// Optional HTTPS listener, only started if certs/server.{key,crt} exist —
// generated once with tools/generate-cert.sh (or by hand with openssl),
// not something server.js creates itself. A self-signed cert someone still
// has to install/trust on their phone isn't something to spring on a
// fresh install with no HTTP fallback, so plain HTTP on PORT keeps working
// exactly as before regardless of whether HTTPS is set up.
let httpsServer = null;
const CERT_DIR = path.join(ROOT, 'certs');
const HTTPS_PORT = Number(args[args.indexOf('--https-port') + 1]) || 3443;
try {
  const key = fs.readFileSync(path.join(CERT_DIR, 'server.key'));
  const cert = fs.readFileSync(path.join(CERT_DIR, 'server.crt'));
  httpsServer = https.createServer({ key, cert }, requestHandler);
} catch {
  // No cert/key on disk — HTTPS just isn't offered this run.
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

(async () => {
  await Promise.all([loadMap('ats'), loadMap('ets2')]);

  // Demo mode always presents as ETS2 (the € wallet, the fabricated
  // job flavour), so it should start on that map's roads specifically —
  // fall back to ATS only if this install hasn't compiled ETS2 at all.
  const demoMap = maps.get('ets2')?.ready ? maps.get('ets2') : maps.get('ats');
  if (demoMap) {
    const start = pickDemoStart(demoMap.compiled);
    if (start) {
      demo.x = demo.startX = start.x;
      demo.z = demo.startZ = start.z;
      if (start.job) demoJob = start.job;
    }
  }

  startReader();

  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    if (state.source !== 'live' || !state.connected) stepDemo(dt);
    broadcast();
  }, TICK_MS);

  server.listen(PORT, '0.0.0.0', () => {
    // With --port 0 the OS assigns the real port, so read it back rather
    // than printing the literal 0 that was passed in.
    const boundPort = server.address().port;
    console.log('\n  Rig Radar 2.14.0\n');
    for (const addr of localAddresses()) {
      console.log(`  Open on your phone:  http://${addr}:${boundPort}`);
    }
    console.log(`  On this PC:          http://localhost:${boundPort}\n`);
    if (!parseBlock) {
      console.log('  Telemetry parser missing — showing the demo drive.');
      console.log('  Copy lib/telemetry.js and reader.ps1 from your Rig Radar v1 folder.\n');
    }
    if (httpsServer) {
      httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log('  HTTPS (for a real "Install app" on your phone, not just a shortcut):');
        for (const addr of localAddresses()) {
          console.log(`    https://${addr}:${HTTPS_PORT}`);
        }
        console.log(`  First, install the cert: http://${localAddresses()[0] || 'localhost'}:${boundPort}/rootCA.crt\n`);
      });
    } else {
      console.log('  No certs/server.{key,crt} found — HTTPS not started.');
      console.log('  Run tools/generate-cert.sh to enable a real phone "Install app".\n');
    }
  });
})();
