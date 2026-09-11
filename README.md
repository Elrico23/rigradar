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
    tools/inspect-parser-*.mjs   reports the shape of parsed game data
    tools/compile-map.mjs        parser output -> data/<game>/ (roads, search,
                                  signs, city areas, ferries, routing)
    data/<game>/                 compiled map, written by the tool above

Features: live telemetry (speed, gear, fuel, damage, cargo, wallet),
auto-routing to your active job with a fallback manual search, reroute on
deviation (a missed turn or a different road taken asks the server for a
fresh route rather than leaving a stale line behind), turn-by-turn with a
curvature-aware turn detector, a "then" preview of the turn after next, and
an arrival state, road-class colour casing, colour-coded highway shields,
company badges and city/company labels with collision avoidance, shaded
city footprints, ferry crossings (including curved ones), a dashed route
centreline, a visible recenter button, an angle-accurate manoeuvre arrow,
and an experimental perspective-tilt view — all toggleable in Settings, all
confirmed working against real ATS/ETS2 game data at real map scale
(218k+ roads, real turn-by-turn routing). A cool cyan-on-navy look, in its
own right rather than copying any one app's exact palette.
