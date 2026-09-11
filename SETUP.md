# Rig Radar v2 — setup

Live map and instruments for Euro Truck Simulator 2 and American Truck
Simulator, running on your phone, driven by your own PC. Phase 1 below gets
it running with live telemetry and a placeholder grid. Phase 2 turns your
own game files into a real map with roads, search, and turn-by-turn routing.

For what's already built and how it fits together, see README.md. For a
compressed history of how it got here, see CHANGELOG.md.

---

## Phase 1 — run it now (10 minutes)

Unzip somewhere sensible, for example:

```
%USERPROFILE%\Desktop\rig-radar-v2
```

### 1. Bring your telemetry across

Copy these two files in from wherever your shared-memory reader lives:

| File | Goes to |
|---|---|
| `reader.ps1` | `rig-radar-v2\reader.ps1` |
| the shared-memory parser module | `rig-radar-v2\lib\telemetry.js` |

The parser module needs to export a `parse(buffer)` function that takes the
decoded shared-memory block and returns an object.

Skip this and everything still runs — you just get the demo drive instead of
your truck.

### 2. Start the server

```powershell
cd "$env:USERPROFILE\Desktop\rig-radar-v2"
node server.js
```

No `npm install`. It uses only the Node standard library, so there's nothing
to rebuild when Node updates and nothing to break mid-stream.

It prints your LAN address, something like `http://192.168.0.x:3000`.

### 3. Open it on your phone

Same Wi-Fi, open that address, then **Add to Home Screen**. It runs
fullscreen with no browser chrome.

Turn on **Keep screen awake** in Settings so the phone doesn't sleep mid-haul.

If the phone can't reach it, allow Node through Windows Firewall on private
networks:

```powershell
New-NetFirewallRule -DisplayName "Rig Radar" -Direction Inbound `
  -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

If it still won't connect, check the server is actually running before
anything else — `netstat -an | findstr :3000` from PowerShell; empty output
means nothing is listening. This is the single most common cause of a dead
connection, ahead of firewall or network settings.

---

## Optional — a PC window too

Everything above already works from any browser on the PC itself (the
server prints an `http://localhost:3000` line alongside the phone address).
`desktop/` wraps that same server in an actual desktop window with a tray
icon, for a TruckSim-Telemetry-style companion on the PC instead of a
browser tab.

```powershell
cd "$env:USERPROFILE\Desktop\rig-radar-v2\desktop"
npm install
npm start
```

This is the one part of the project that isn't zero-dependency —
`desktop/` has its own `package.json` and pulls in Electron, kept separate
so `server.js` itself never needs `npm install`. `npm start` spawns the
same, unmodified `server.js` underneath, so the PC window and your phone
are always looking at identical live data.

Closing the window minimises it to the tray rather than quitting — use
**Quit Rig Radar** from the tray icon's right-click menu to actually stop
it. Right-click → **Start with Windows** to have it come up automatically
at login.

To build an installable `.exe` instead of running from source:

```powershell
npm run dist
```

---

## Phase 2 — build the map

This is the long pole. Set aside an evening for the first run.

### 1. Prerequisites

- **Node 20+** — `node --version`
- **Python 3** — needed by node-gyp
- **Visual Studio Build Tools** with the *Desktop development with C++*
  workload. The parser has a native addon and won't build without it.

### 2. Get the parser

```powershell
cd "$env:USERPROFILE\Desktop"
mkdir trucksim-maps
cd trucksim-maps
git clone --recurse-submodules https://github.com/truckermudgeon/maps.git .
npm install
npm run build -w packages/clis/parser
```

`--recurse-submodules` is not optional — without it the native addon has no
source to compile.

### 3. Parse both games

```powershell
mkdir "$env:USERPROFILE\Desktop\parsed\ats"
mkdir "$env:USERPROFILE\Desktop\parsed\ets2"

npx parser -i "E:\Steam\steamapps\common\American Truck Simulator" `
           -o "$env:USERPROFILE\Desktop\parsed\ats"

npx parser -i "E:\Steam\steamapps\common\Euro Truck Simulator 2" `
           -o "$env:USERPROFILE\Desktop\parsed\ets2"
```

Only official map DLCs are supported — third-party map mods (ProMods,
workshop map add-ons) aren't, so those areas will have no road data at all.

### 4. Compile the map

```powershell
cd "$env:USERPROFILE\Desktop\rig-radar-v2"
$env:NODE_OPTIONS="--max-old-space-size=8192"
node tools/compile-map.mjs ats "$env:USERPROFILE\Desktop\parsed\ats"
node tools/compile-map.mjs ets2 "$env:USERPROFILE\Desktop\parsed\ets2"
```

Each run writes into `data\ats\` or `data\ets2\`:

| File | What it is |
|---|---|
| `roads.bin` | Road geometry, streamed per viewport rather than all at once |
| `graph.json` | The routing graph — every road endpoint and junction |
| `search-index.json` | Every city and company (fuel stops and repair shops are companies too — no separate list needed) |
| `signs.json` | Highway shield badges ("US 400", "I-15"), colour-coded by road type |
| `city-areas.json` | Each city's real footprint, for background shading |
| `ferries.json` | Ferry crossings, including curved ones |
| `meta.json` | The projection fitted to this game's coordinate range, plus counts |

Restart the server afterwards to pick up the new data:

```powershell
node server.js
```

The startup line reports what it loaded, e.g. `map loaded: ats (218184
roads, 2372 searchable places, 357873 routing nodes)`. Reload the phone and
the grid becomes real roads.

Re-run the compiler any time you re-parse (new DLC, game update).

**Recompile required when `roads.bin`'s format changes.** An old compiled
map will fail to load with a clear "wrong format version" message rather
than silently misrendering, so this is always obvious when it happens.

---

## Known limitations and design decisions

- **No road names in turn instructions.** The parser doesn't hand over
  legible road names — a road's `roadLookToken` is something like
  `nm_tmpl02`, not "I-40" — so manoeuvres say "turn left in 400m" rather
  than naming a road.
- **Road curves use centripetal Catmull-Rom smoothing** through simple
  pass-through points (where exactly two road pieces meet); real junctions
  (three or more roads meeting) stay straight chords, since there's no
  single "continuation direction" to smooth toward at an intersection.
  Centripetal rather than simpler uniform parameterization specifically
  because uniform badly overshoots on sharp, unevenly-spaced turns —
  measured on a realistic sharp corner, uniform bowed points 140m+ off the
  true path; centripetal keeps the same corner within about 6.5m.
- **Turn detection is curvature-rate based, not angle-based.** A wide 400m
  highway sweep and a tight 20m corner can share the same total bearing
  change, but only one is a real turn. Detection uses degrees-per-metre
  (roughly a 115m turning-radius cutoff), with a large-angle (45°+)
  exception so a genuine fork or exit is always flagged even if it happens
  to be gentle.
- **Level-of-detail cutoffs at wide zoom.** Past a viewport span of 20km,
  local roads and highway shields drop out; past 60km, only motorways
  remain. Measured on a synthetic map at real road-count scale: a full-map
  query went from 315ms/9.3MB to 66ms/2.4MB with this in place. Normal
  driving-zoom queries (12-25ms) are unaffected either way.
- **Auto-routing matches your active job's destination automatically** — no
  need to search and tap a destination yourself. If a job's destination
  isn't in the compiled map (most often a workshop mod area with no parsed
  road data), the route line simply won't appear for that job; manual
  search still works as a fallback for anywhere that *is* in the map.
- **Reroute on deviation.** Every couple of seconds the phone measures the
  distance from your live position to the nearest point on the route line
  itself (not just the next turn) — miss a turn, or take a different road,
  and once that gap passes 120m it asks the server for a fresh route from
  wherever you actually are, capped to one request every 8 seconds so a
  genuinely long stretch off-route doesn't hammer the server. Works the
  same way whether the route came from auto-routing or a manual search
  pick — it doesn't need to know which, only how to ask for a new one.
- **Tilted view (Settings, experimental, off by default).** A
  perspective-style compression that makes the road ahead recede toward a
  horizon while keeping every label and shield upright and legible —
  deliberately not a blanket visual transform, which would warp text.
  Flat mode is mathematically unchanged by this existing; toggling tilt
  off is provably identical to the original rendering.
- **The manoeuvre card's arrow is built from the turn's actual angle**, not
  one fixed shape — a quadratic curve from a stem through a control arm
  whose bend grows with the turn, capped at 150° so a near-U-turn still
  draws a legible hook instead of folding back on itself. At 0° the curve
  degenerates to a straight line, so "continue straight" draws an actual
  straight arrow rather than reusing the turn shape untransformed.

---

## How it fits together

```
  ETS2 / ATS
      |  scs-sdk-plugin writes shared memory
      v
  reader.ps1 ---- base64 lines ----> server.js <---- data/<game>/*
                                       |  |            (roads, search,
   Server-Sent Events                 |  |             signs, city areas,
        v                             |  |             ferries, routing)
  your phone (PWA) <---- /api/geo, /api/search, /api/autoroute, /api/route
```

One projection module, `lib/coords.js`, converts game metres to map
coordinates. The map geometry and the live truck position both go through
it, which is why the truck sits on the road instead of near it.

---

## Notes

- `node server.js --demo` forces the demo drive, handy for working on the UI
  with the game closed.
- `--port 3100` if 3000 is taken.
- Game time runs about 15× real time; that ratio drives the REAL and SIM
  figures on the waybill.
- The parser is GPL v3. Using its *output* to drive your own app is fine,
  but publishing Rig Radar with any of its code inside brings the GPL with
  it — worth knowing if this ever goes on the channel.
