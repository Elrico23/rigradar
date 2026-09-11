# Rig Radar v2

Live map and instruments for Euro Truck Simulator 2 and American Truck
Simulator, on your phone, driven by your own PC.

Start here: SETUP.md. History of how it got here: CHANGELOG.md.

    node server.js          live if the game is running, demo drive if not
    node server.js --demo   force the demo drive
    node server.js --port 3100

    server.js                    HTTP + Server-Sent Events, no dependencies
    lib/coords.js                game metres -> map coordinates, both games
    lib/telemetry.js             SCS shared-memory parser (from v1)
    lib/roadformat.js            compact binary format for road geometry
    lib/mapdata.js               loads a compiled map, answers geo/search/route
    lib/router.js                Dijkstra pathfinding + turn-by-turn manoeuvres
    reader.ps1                   PowerShell sidecar reading SCS shared memory
    public/                      the phone app, single file
    desktop/                     optional PC window + tray icon (Electron)
    tools/inspect-parser-*.mjs   reports the shape of parsed game data
    tools/compile-map.mjs        parser output -> data/<game>/ (roads, search,
                                  signs, city areas, ferries, routing)
    data/<game>/                 compiled map, written by the tool above

Features: live telemetry (speed, cargo, wallet), a minimal bottom bar
matching the real in-dash GPS (digital clock, ETA, remaining distance,
speed next to the speed limit — both clock and ETA in-game time, not real
wall time), auto-routing to your active job with a fallback manual search,
reroute on deviation (a missed turn or a different road taken asks the
server for a fresh route rather than leaving a stale line behind),
turn-by-turn with a curvature-aware turn detector, a "then" preview of the
turn after next, and an arrival state. The map is styled to match
ETS2/ATS's own in-dash GPS specifically: grey undiscovered roads, bright
orange/yellow roads you've actually driven (approximated by a
localStorage-backed coordinate grid, since roads have no persistent
per-segment ID to track "visited" against directly), a bright green active
route, colour-coded highway shields, simple bold company markers, city
labels with collision avoidance, shaded city footprints, ferry crossings
(including curved ones), a dashed route centreline, a visible recenter
button, an angle-accurate manoeuvre arrow, and a forward-tilted trailing
camera on by default (flat/north-up is the opt-out, in Settings) — all
confirmed working against real ATS/ETS2 game data at real map scale
(218k+ roads, real turn-by-turn routing).

An optional PC counterpart lives in `desktop/`: a standalone window with a
tray icon and a Windows-autostart toggle, for a TruckSim-Telemetry-style
companion on the PC itself rather than a browser tab. It's the one part of
the project with actual npm dependencies (Electron); the server it wraps
is untouched and still runs standalone with zero installs. See SETUP.md.
