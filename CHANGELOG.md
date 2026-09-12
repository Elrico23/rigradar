# Changelog

Compressed history for context — what changed and why, not a full diff.
Built collaboratively with Claude across one long chat session; see
SETUP.md for current setup and known limitations.

**2.10.1** — Fixed the new bottom bar overlapping itself at narrower
phone widths (~314px) — a real gap in 2.10.0's own testing, which only
checked 390px+ viewports. `.stats` laid out its four labelled values with
`display: flex` and no wrap; at 314px there wasn't room for all four,
and since flex items shrink below their own content's width by default
(and the text itself is `white-space: nowrap`, so it can't wrap
internally either), the result wasn't truncation — it was each stat's
text silently overlapping the next one, confirmed by measuring the
actual rendered boxes (18-40px wide holding text that needs 35px+).
Switched to `flex-wrap: wrap` so a narrow phone gets two clean rows
instead of one illegible one; verified no overlaps at 314px (checked all
stat-pairs and both round buttons programmatically) and confirmed 390px+
still lays out on one line as before.

**2.10.0** — A full reskin to match ETS2/ATS's own in-dash GPS specifically
(not TruckSim GPS, not "Rig Radar's own take" — this one is meant to look
like the real thing), on explicit spec: grey/orange/green road-and-route
colours, a stripped-down bottom info bar, and a forward-tilted camera by
default. Two of the five requirements hit real gaps in the compiled data,
investigated and disclosed before building anything rather than after:

- **Undiscovered vs. travelled road colouring** — roads have no persistent
  per-segment ID in the compiled format (251k+ ETS2 segments are anonymous
  point arrays), so this is approximated: the truck's position marks off
  300m grid cells into a `Set` persisted in `localStorage`
  (`rigradar.visited`), and a road segment renders in bright orange/yellow
  if any of its sampled points fall in an already-visited cell, grey
  otherwise. This is a coordinate-grid proxy, not the same mechanism the
  real game's engine uses — verified live by force-marking cells and
  confirming the affected roads actually recolour.
- **Distinct fuel/rest/service icons** (bed/pump/wrench) — not feasible
  without re-running the parser against a raw game dump; every company in
  the compiled search index is `{id, name, kind, city, x, z}` with no
  category field at all (checked all 1,844+ ETS2 entries directly, zero
  variation). Replaced the old cargo-box badge with one simple, bold
  dot-in-ring marker for every company instead of pretending to
  distinguish types the data can't tell apart.

Everything else: road casing stays dark/neutral regardless of visited
state (only the fill recolours, same as the real game just recolouring
the surface, not the outline); the active route is bright green (`#3ddc4a`)
over a dark casing, replacing the old teal; the manoeuvre arrow, dashed
centreline, highway shields, and city/company labels are all unchanged.

**HUD stripped down to match the real GPS exactly**, on explicit request
after asking rather than assuming — removed the gear gauge, RPM ring,
fuel gauge, and damage badge entirely from the main view (they're
dashboard concerns, not GPS concerns; wallet/cargo stayed, since that
wasn't part of what was asked to strip). The waybill at the bottom now
carries the four things the real in-dash GPS actually shows: a digital
clock, ETA, remaining distance, and speed next to the speed limit. Both
the clock and ETA are **in-game time**, not real wall-clock time — matching
a GPS that lives entirely inside the game's own clock — derived from
`gameTime` (the SDK's `timeAbs` field, already parsed but never
previously displayed anywhere). Flagged in code: this assumes `timeAbs`
cycles with day/night per the SDK's documented behaviour, which hasn't
been confirmed yet against real live telemetry specifically for this
feature — worth double-checking next live session.

One structural side effect worth noting: removing the gear/fuel/damage
stack also removed the entire `@media (max-height: 480px)` compact-mode
block that existed specifically to stop that stack colliding with the
manoeuvre card on short viewports (the exact overlap bugs fixed in
2.7.9/2.7.10). With that stack gone, the conflict it was written to
prevent no longer has anything to collide with — verified at 390×420 with
a forced manoeuvre card: plenty of clearance, no CSS needed to force it.

**Camera defaults to tilted now** (`tilt: true`), not flat — flat/north-up
is the opt-out via Settings rather than the baseline, since a forward-
tilted trailing view is what the spec asked to default to.

**2.9.6** — Tilt view zoom, round two: pulled in to just under a third
(0.32x) of the flat-view distance, per live feedback comparing against
ATS's own in-game GPS map. Verified live against real telemetry mid-drive
(a real "Moving Containers" job, real speed-limit overage warning) rather
than the demo drive.

**2.9.7** — Still too zoomed out, and missing the "tilted forward" feel
entirely per the next round of live feedback — the previous two passes
only ever touched the zoom multiplier, never the two things that
actually define a forward-tilted GPS view: how low the truck sits on
screen, and how strongly the road ahead compresses toward the horizon.
Pushed all three together this time: zoom to 0.22x, the truck's screen
anchor from 62% down to 82% down (flat mode's anchor untouched), and
TILT_STRENGTH from 0.55 to 1.3 for a much more visible vanishing-point
curve. A noticeably bigger jump than the previous two rounds, on
purpose — two small nudges in a row that both came back "still not
enough" was a sign to stop iterating in tiny steps.

**2.9.5** — The 2.9.3 orphan-cleanup fix had a real gap: it checked
whether `reader.ps1`'s recorded parent PID still belonged to *any* live
process, but Windows doesn't update a child's recorded parent PID when
that parent exits, and does recycle PIDs — so an orphan whose real
node.exe had long since died could see its old parent PID reassigned to
some unrelated process later and conclude, wrongly, that its parent was
still alive forever. Caught this in practice, not in theory: a stray
reader from earlier in this session had its recorded parent PID
reassigned to the Claude Code CLI host itself and kept running past the
point the 2.9.3 fix should have caught it. Now records the parent's
`StartTime` alongside its PID at launch and requires both to still
match, which is what actually distinguishes "still my parent" from
"something else now has that number."

**2.9.4** — Tilt view zoomed the same as the flat view, so switching it on
only bent the horizon without giving the close, cockpit-mounted-GPS feel
it's meant to have — reported after actually comparing it against
TruckSim GPS during the first live drive. The auto-zoom target formula
never accounted for tilt at all; it now pulls in to half the usual
distance when tilt and heading-up are both on, since the perspective
compression already buys back the lookahead a wider flat view would
otherwise need. Verified live: same speed, tilt off vs on measured at
5.43 m/px vs 2.91 m/px — a ~1.9x closer view, visibly larger road
geometry on screen.

**2.9.3** — Fixed a real process leak, found because it was making actual
gameplay laggy during the first live test: killing `node.exe` (however
that happens — Task Manager, `Stop-Process -Force`, a crash) left
`reader.ps1` running forever in the background, since a spawned child on
Windows has no built-in way to know its parent is gone. Over many restarts
in one dev session, that's many stray PowerShell processes each polling
`Local\SCSTelemetry` in a tight 100ms loop, competing for the same shared
memory the actual live game needed — plausibly a real contributor to the
reported lag, on top of everything else this session had running at once.
Two-sided fix: `server.js` now kills the reader on a normal shutdown
(SIGINT/SIGTERM, i.e. Ctrl+C), and `reader.ps1` independently checks every
~2s that its parent PID is still alive and self-terminates if not — the
half that actually matters, since a forceful kill can't be intercepted by
the thing being killed, only worked around from the other side. Verified
by force-killing node mid-session and confirming the orphan exited within
the 2s check window with no manual cleanup, then swept up several
already-orphaned processes left over from this session's own restarts
(one had been running the whole time, since well before this fix existed).

**2.9.2** — A proper test pass across the whole app (settings, search, map
controls, server API edge cases), asked for after the manoeuvre-arrow
chase kept turning up nothing. Found three real bugs this time:

- **99.97% of ETS2's highway shields were malformed** — 2,981 of 2,982
  compiled shields showed a raw token like `D_A9` or `NO_E6` instead of a
  clean shield, because `formatShield()` in `tools/compile-map.mjs` was
  written and verified against only ATS's icon format (`us400`, `i15` —
  no prefix), and never checked against real ETS2 output, which prefixes
  every route icon with a country code (`d_`, `no_`, `pl_`, 33 more).
  Fixed the formatter to strip that prefix, and — since every real route
  is numbered — used "no digit anywhere" to also correctly drop non-route
  `type: "road"` POIs that were showing up as bogus shields alongside it
  (toll booths, weigh/agricultural checkpoints, border crossings, one
  stray "QUARRY"). Patched the already-compiled `data/ets2/signs.json`
  and `data/ats/signs.json` in place by re-deriving each corrected label
  from its current (mangled but information-preserving) one, rather than
  needing to re-run the full parser — ATS had a smaller version of the
  same issue (135 of 1981, mostly US state-route prefixes like `ca_r86`).
  Verified live: shields now read "E 40", "A 4" instead of "D_E40",
  "D_A4".
- **The manoeuvre card's distance ignored the imperial setting entirely**
  — turning on "Miles instead of km" correctly converted the speedometer,
  speed limit, and trip distance, but the next-turn countdown, the "then"
  preview, and the arrival-progress distance all had their own
  independent, hardcoded metric-only formatting, never routed through
  the existing `distance()` helper that already knew how to convert.
  Added a shared `turnDistanceParts()` (feet under a mile, miles above,
  mirroring the existing metres/km split) and pointed all three call
  sites at it. Verified live: "Then ↰ 96ft" instead of "Then ↰ 29m" with
  imperial on.
- **A manual search destination that failed to route did so in total
  silence** — `setDestination()` closed the search sheet before the
  fetch even resolved and, on failure, just `return`ed with the map
  otherwise untouched: no error, no indication anything had happened,
  found while investigating why a Kaunas search pick came back 404
  (a legitimate "no path found" for the truck's position at the time,
  not a bug in itself, but the silent handling of it was). Now shows the
  server's actual error message inline in the still-open search sheet
  ("Unknown destination.", "No path found between those points.") instead
  of closing and saying nothing.

Also verified clean with no changes needed: all five settings toggles,
zoom clamping at both extremes (60+ rapid clicks each direction, stayed
finite and bounded), recenter and north-up/heading-up toggling, the
tilted-view projection math (an initial test looked like a null result
but turned out to be a flawed test — picked a point not actually ahead of
the truck's heading), and a battery of server API edge cases (malformed
JSON, missing body, unknown game, empty/short/`<script>`-injection search
queries, unknown routes, inverted and whole-map geo bounds) — all
handled with the right status code and no crash.

**2.9.1** — Found a real bug while re-investigating the manoeuvre-arrow
report a third time: `sw.js`'s cache name was hardcoded to
`rig-radar-v2.7.1` and never bumped across eleven-plus releases since,
while its `fetch` handler served cached files with no revalidation. Any
device where the service worker successfully installed around that time
would silently keep serving that exact shell forever — every arrow fix
from 2.7.3 through 2.7.11 included — which would perfectly explain
"still broken, every turn, consistently" while every fresh test here
came back clean (the fix really was already live, just never reaching a
device stuck on the old cache). Bumped the cache name to match the
current version and changed `fetch` to stale-while-revalidate (serve
the cached copy for a fast open, but always refetch in the background
and update the cache), so this class of bug can't silently recur even
if the cache name isn't bumped by hand next time.

Important honesty check, not a confirmed fix: proving the cache-cleanup
logic works required manually planting a fake stale cache under the old
name, since nothing in this session had ever actually populated one —
and doing that surfaced something bigger. `navigator.serviceWorker.
register()` fails outright in this environment with "an unknown error
occurred when fetching the script," the exact console message that's
shown up in every single console check this whole session and been
dismissed each time as leftover noise. It wasn't. Plain `fetch('/sw.js')`
works fine (200, correct content) — only the ServiceWorker registration
API itself fails here, which points at an environment restriction on
this Browser pane rather than a code bug (`fetch('/sw.js')` succeeding
while `register()` fails isn't something app code controls either way).
That raises a real question this session cannot answer: service workers
require a secure context, and `localhost` counts but a phone reaching
the server over `http://192.168.x.x` (a plain LAN IP) does not on most
mobile browsers — so it's possible the service worker has never
successfully installed on the phone at all, in which case this cache
bug, however real, isn't what's actually being seen there. The desktop
app is unaffected either way (Electron's window loads `http://localhost`,
which is always a secure context). Asked for a screenshot of the actual
broken shape on the phone to settle which explanation is right, rather
than guess a fourth time.

**2.9.0** — A desktop shell, in `desktop/`, for a PC-side counterpart to
the phone PWA (the ask was "a PC program just like TruckSim Telemetry").
It's a thin Electron wrapper, kept deliberately separate from the root
project so `server.js` stays exactly what it's always been — zero
dependencies, no `npm install`, still runs standalone with plain
`node server.js`. `desktop/main.js` spawns that same, unmodified
`server.js` as a child process (via `ELECTRON_RUN_AS_NODE`, so it needs
no separate Node install on the machine running the app), points a
chrome-less window at it, and adds a tray icon with a "Start with
Windows" checkbox (`app.setLoginItemSettings`) and a "Quit" item —
closing the window just hides it, same pattern as TruckSim Telemetry
and similar always-on companion apps.

New icon assets specifically for this: the phone icon's full-bleed
navy-square design (built for OS home-screen masking) doesn't suit a
Windows taskbar/tray icon, which has no equivalent masking and wants a
transparent background. Added a separate simplified badge — a solid
`--beacon` circle with a bold two-shape truck glyph, no fine linework —
rendered at 16/32/48/256px into `desktop/build/icon.ico` (hand-encoded,
PNG-compressed ICO entries) plus standalone `desktop/tray-icon.png` /
`@2x.png`, since the phone icon's rings and windshield accent were
legible at 512px but would just blur into noise at tray-icon scale.

Verified: `npm install` inside `desktop/`, then `npm start` — the spawned
`server.js` child came up and logged its normal startup sequence (both
maps loaded, phone/PC URLs printed), `/api/status` answered correctly
over HTTP while the app was running, and Windows showed a live `electron`
process with the main window's title actually reading "Rig Radar" (the
title comes from the loaded page, so this confirms the window rendered
the real app rather than a blank/error page) — the one thing this
environment can't do is visually screenshot that native window the way
the phone PWA gets checked in a browser pane, so take that as
process-level, not pixel-level, verification. One hiccup along the way:
Electron's own postinstall binary download silently produced an empty
`node_modules/electron/dist/` on the first `npm install`, even though npm
reported exit code 0 — re-running `node node_modules/electron/install.js`
by hand completed it. `npm run dist` now confirmed too: it builds cleanly end to end —
downloads its own Electron binary, bundles `server.js`/`lib`/`public`/
`data` in via `extraResources`, and produces `dist\Rig Radar Setup
1.0.0.exe` (139MB, mostly the compiled map data). Unsigned, since there's
no code-signing certificate set up — Windows SmartScreen will show an
"unknown publisher" warning on first run, which is expected and not a
bug. Actually running it is now verified too — via NSIS's silent `/S`
flag rather than clicking through the wizard, since this environment
can't drive a GUI installer. It installed cleanly to
`%LOCALAPPDATA%\Programs\Rig Radar\` with a Start Menu shortcut, a
desktop shortcut, and a registry uninstall entry, and launching the
installed `Rig Radar.exe` came up as a process actually named "Rig
Radar" (electron-builder renames the binary to the product name) with
its server answering `/api/status` and both maps loaded — confirming
the packaged `extraResources` path resolves correctly, which the
earlier dev-mode (`electron .`) check never actually exercised, since
that always ran against the source tree directly rather than a packaged
copy.

**2.8.4** — Regenerated all four icon PNGs (light and dark, both sizes)
with more safe-zone margin: the outer ring pulled in from 0.34×size to
~0.28×size, comfortably inside the 0.40×size circle Android/iOS
guarantee stays unclipped regardless of a launcher's mask shape (circle,
squircle, teardrop). The previous 0.34 was already technically inside
that bound, so this wasn't a proven clipping bug — done because a
reported "wrong icon on the phone home screen" couldn't be reproduced
from here (no way to add-to-home-screen from this environment), so the
fix widens the margin defensively rather than asserting a cause I
couldn't verify.

Important caveat, not a code fix: iOS and Android both cache the icon
bitmap at the moment a PWA is added to the home screen. If the icon
already on a phone's home screen still looks wrong after this update,
the server-side file isn't the problem — remove that home screen icon
and use "Add to Home Screen" again to pick up the new PNG.

**2.8.3** — Listed the dark icon variants in `manifest.json` too, as
`purpose: "any"` entries alongside the existing `purpose: "any maskable"`
navy ones. Worth knowing: the Web App Manifest spec has no
prefers-color-scheme concept for icons, so this doesn't make an
installed home-screen icon switch with the OS theme — Android/iOS just
pick from whatever's listed, generally preferring a maskable match for
the adaptive icon slot, which is why the navy set keeps that purpose
and the dark set doesn't. The favicon `<link>` swap from 2.8.2 is still
the only genuinely theme-reactive piece.

**2.8.2** — A near-black variant of the 2.8.1 icon (`icon-192-dark.png`,
`icon-512-dark.png`): same rings, sweep, and truck glyph, background
swapped from navy to near-black. Wired it up the one place a dark/light
split actually works cross-browser today: the tab favicon, via
`<link rel="icon" media="(prefers-color-scheme: dark)">`. The PWA
installed-icon (manifest.json) still points at the single 2.8.1 set —
the Web App Manifest spec has no equivalent per-scheme icon mechanism,
so there's nothing to wire there.

**2.8.1** — Regenerated the app icons (`icon-192.png`, `icon-512.png`) to
match the 2.8.0 reskin; they'd been left over from the old amber palette.
New design: a navy background, three concentric `--beacon` radar rings
with a soft sweep wedge, and a simple chalk-white truck glyph with a
teal windshield accent — reads as both halves of "Rig Radar" rather than
just a generic marker. Generated as raw pixel data and hand-encoded to
PNG in a small Node script (no image library available, and no browser
round-trip needed for a flat-shaded icon at this size), verified visually
at both 512 and 192px before writing to `public/`.

**2.8.0** — A visual reskin, inspired by TruckSim GPS (a commercial ETS2/
ATS second-screen app) but deliberately not a copy of it — Rig Radar's
own take on the same cool GPS-navigation mood rather than matching its
exact hues or reusing any of its assets.

- **New palette.** Warm amber-on-near-black is now cool cyan-on-navy.
  Renamed the CSS variables along with their values (`--amber` →
  `--beacon`, `--ember` → `--glacier`, `--sodium` → `--signal`, `--dust` →
  `--fog`) rather than just swapping the hex in place, so nothing reads
  "`--amber: #2dd4c8`" a year from now. Road colours went neutral cool
  grey instead of shades of the new accent — the route is the only thing
  drawn in `--beacon`, so it actually stands out against the road network
  instead of blending into a same-hued map the way an all-teal scheme
  would have.
- **Dashed route centreline** — a thin light dash down the middle of the
  route line, reading as a painted road stripe rather than a flat fill.
- **"Then" preview** — the manoeuvre card now previews the turn after
  next ("Then ↰ 400m") when the route has one queued, not just the
  immediate turn. Hidden in compact mode specifically: that layout's
  height budget was already tuned against the gear gauge with only
  18-24px to spare (2.7.9), and a third text line would have eaten the
  margin that fix depends on.
- **Company badges** — a small badge with a generic cargo-box glyph in
  place of the old plain-text-plus-dot marker. One design deliberately
  *not* copied: TruckSim GPS shows real per-brand logos (a fuel chain's
  actual mark, for instance); the compiled map data has no sub-category
  to key that off even if reproducing third-party brand marks were
  something to do lightly, so every company gets the same generic badge.

Verified live: the full palette swap across every CSS variable and every
hardcoded canvas colour (two couldn't share a `var()`, since canvas can't
read CSS custom properties), the dashed centreline visible on a real
route, the "then" preview's text and distance math checked against a
synthetic two-turn route, and the company badge's shape confirmed at 3x
zoom — plus confirmed the badge and "then" additions don't reopen the
gear-gauge or damage-badge overlaps fixed in 2.7.9/2.7.10.

**2.7.11** — Couldn't reproduce the reported wrong-direction manoeuvre
icon after extensive testing (six scenarios across viewport sizes,
angles, and directions), but found a real, unverifiable-from-here risk
while investigating: the left-turn icon relied on a CSS `scaleX(-1)`
transform on the `<svg>`, whose mirror point depends on
`transform-origin`/`transform-box` resolving to the element's visual
centre — a default that's had documented cross-browser inconsistency for
inline SVG specifically (older WebKit engines resolved it differently
from the current spec). Couldn't confirm this was the actual cause, but
it matches the reported symptom exactly and is exactly the kind of thing
that wouldn't show up in this session's test browser while still
affecting a real device. Removed the dependency entirely rather than
chase a browser-specific repro: `setManoeuvreArrow()` now mirrors every
x-coordinate directly across the icon's own centre when building the SVG
path data, so the left-turn shape is correct by construction — there's
no transform, and therefore no browser default left to disagree about.
Verified both directions render correctly (including the exact mirror
relationship: a 60° left turn's tip lands at 32 minus the same angle's
right-turn tip, to the pixel) in both normal and compact layout modes.
**2.7.10** — Fixed the damage badge overlapping the manoeuvre card. Both
sit at the same fixed top-left offset (58px vs 64px), 18px apart in
theory but the badge is ~24px tall, so its bottom edge landed 18px inside
the card's top — an 18px overlap any time both are visible at once (a
wear badge during an active turn), independent of viewport height. Fixed
with `.layer:has(.damage.on) .manoeuvre { top: ... }`, so the card only
shifts down when the badge is actually showing — pristine-truck drives
(the common case) keep the tighter spacing rather than always paying for
room the badge isn't using. Verified 8px clearance settles in after the
new `top` transition, and that turning damage back off snaps the card
back to its normal 64px position.

Compact mode (see 2.7.9) needed a different answer: at 348px, clearing
both the badge above and the gear gauge below leaves the card no legal
position — the two constraints are ~30px apart with no overlap between
them. Rather than force a bad compromise, the badge is hidden while a
manoeuvre card is active in compact mode specifically (`:has()` again),
trading a wear percentage for turn-by-turn directions when there isn't
room for both. Had to also pin the card back to compact's own 40px top in
that case — the normal-mode 90px rule has identical selector specificity
and would otherwise still win by source order even with the badge hidden,
since `:has()` matches on the badge's class, not its visibility.
**2.7.9** — Fixed the manoeuvre card overlapping the gear gauge on short
viewports. Every gauge offset was tuned for a real phone's height (600px+);
below that, the top-anchored manoeuvre card and the bottom-anchored gear
gauge (itself stacked above speedo/fuel, which sit above the waybill) run
out of shared vertical room — measured a 112px overlap at 348px tall,
severe enough that gear's top edge landed above the manoeuvre card's own
top. Shrinking the manoeuvre card alone couldn't fix that; there was
nowhere left to reclaim the room from. Added a `max-height: 480px` media
query that compacts the whole chain together — manoeuvre card, gear,
speedo, fuel, and the speed-limit badge — verified by measuring the actual
clearance between each pair (manoeuvre→gear, gear→speedo, speedo→waybill)
at 348px, all positive, and confirmed the query has zero effect above
480px (gear back to its original 84px/232px offset, manoeuvre back to its
original top). Found but didn't touch: `.damage` and `.manoeuvre` share
the same fixed top-left offsets closely enough that they can overlap when
both are visible, independent of viewport height — a separate, pre-existing
issue, not something this pass introduced or was asked to fix.

**2.7.8** — Fixed the arrival-state text sitting visibly off-centre in the
manoeuvre card. The card's box was correctly centred all along; the
mismatch was `line-height: normal` on a 21px "Arrived" — a word with no
descenders — which allocates the font's full descender space below the
glyphs regardless, so the empty space landed entirely under the text
instead of split evenly. Tightened `line-height` to 1 and added a small
top nudge, verified by measuring the actual gap above and below the
rendered text (39px/39px at 4x zoom, then 0.8px/0.8px on a fresh reload)
rather than eyeballing it. Scoped to `.manoeuvre.arrived .road`
specifically — normal turn instructions ("Continue straight", "Waiting
for a route") do have descenders and were already fine, so the shared
`#turnRoad` styling used for those was left untouched.

**2.7.7** — The demo drive's wander now has a leash. It used to accumulate
heading drift with nothing pulling it back, so over a long enough session
it could wander arbitrarily far from its start point — including outside
the compiled map's locally-dense road network, the same "no road within
routing range" failure the raw (0,0) origin had (fixed in 2.7.5), just
reachable anywhere given enough time instead of guaranteed at the first
tick. Below 60% of a 15km radius from the start point this changes
nothing — short and medium demo sessions look exactly as before, pure
lazy wandering. Past that a gentle pull steers the heading back toward
the start, added on top of the existing wander rather than replacing it,
so the correction still reads as a normal curve rather than a snap turn.
Simulated 3 hours of demo driving before shipping this: max distance
from start stayed under 9.3km, never approaching the 15km leash.

**2.7.6** — Fixed the manoeuvre arrow icon clipping for most turn angles.
The 2.7.3 rewrite (angle-accurate arrow) never actually verified its own
geometry stayed inside the icon's 32×32 viewBox — the tip point goes
*highest* at a 0° (straight-ahead) angle, not at a sharp turn, since
nothing bends it sideways back into frame. With the old constants that
put the tip above y=0 for every turn under about 64°, which is most real
turns; the SVG's default overflow:hidden silently clipped the curve and
arrowhead, leaving only a thin vertical sliver that read as the numeral
"1" rather than an arrow. Not actually a narrow-screen bug specifically —
the clipping is identical at any width, since the icon is a fixed 34×34px
— but it's most visible on a phone where every pixel of a small icon
matters and where this card is actually looked at closely. Re-derived the
pivot/arm/head-length constants by sweeping every angle from 0° to
TURN_MAX_ANGLE and checking the full shape (tip and both arrowhead wings)
stays within bounds with margin, rather than eyeballing a few sample
angles like the original pass did.

**2.7.5** — Fixed the demo drive starting somewhere unroutable. It began at
the engine's raw world origin (0,0), which — now that a real compiled map
exists — turned out to have no road within routing range at all (open
water, for ETS2's origin specifically); search, auto-route, and reroute
requests from a fresh demo session all failed with `no-route` from the
very first tick. The demo drive's fabricated job destination
("North Western Transport") never matched anything in the compiled map
either, so auto-routing was silently broken in demo mode from the start
regardless of position. Both are now picked from the compiled map at
startup: the demo starts on the most-connected junction in the routing
graph (about as "on a real road" as a position gets), and its job routes
to a real company at a plausible haul distance — so search, auto-routing,
and reroute-on-deviation all work out of the box in demo mode, the same
way they do against live telemetry.

**2.7.4** — Reroute on deviation. Previously, once a route was drawn
(auto-matched to a job or manually picked) it never changed until the job
itself changed — miss a turn or take a different road and the line just
sat there pointing at where you would have been. Now the phone measures
distance from the truck to the nearest point on the route line itself
(not just the next turn point) every 2 seconds, and once that exceeds 120m
asks the server for a fresh route from the current position, capped to one
actual reroute every 8 seconds. Works for both auto-routed and
manually-picked destinations through one `routeSource` concept the
deviation checker doesn't need to know the origin of, only how to refetch
it. Verified live against the real SSE stream (not a standalone
reimplementation): set a real destination, let the truck drift, watched
`lastRerouteAt` advance and the route line snap to the live position on
its own, repeatedly, correctly throttled by the cooldown.

**2.7.3** — Fixed the manoeuvre card's arrow icon, the one open item carried
since 2.5.0: it was a single fixed ~90° shape reused for every turn
regardless of actual angle, mirrored for left/right — a gentle 28° bend and
a sharp 90°+ corner looked identical, and "continue straight" reused the
same curved shape with no rotation applied, which still read as a turn.
Replaced with a quadratic-curve arrow built from the turn's real angle
(`next.angle`, already computed by buildManoeuvres but never used
client-side before this): the bend now scales with sharpness, capped at
150° so a near-U-turn still draws a legible hook, and "continue straight"
draws an actual straight line since the curve mathematically degenerates to
one at 0°.

**2.7.2** — Full correctness + cleanup pass, no feature changes. Fixed: an
unhandled async write error on a dropped SSE connection could crash the
whole server for every connected phone; trailer damage was silently aliased
to chassis damage (same byte offset); the route line used uniform
Catmull-Rom smoothing instead of the centripetal fix already applied to the
road network, reintroducing the same 140m+ overshoot bug for route lines on
sharp turns; client-side `?game=` fallback was inconsistent across
search/route/autoroute calls and could hit the wrong game's map before the
first telemetry frame arrived; `reader.ps1` exiting never triggered a
retry, permanently stranding the app on the demo drive; ETA/remaining
distance blanked to "—" at the exact moment of arrival (falsy-zero bug);
the camera-recenter "uninitialized" check used `(0,0)` as a sentinel, which
collides with a real world position (the demo drive itself starts there)
and silently overrode manual panning; auto-routing's fuzzy company-name
match used substring `includes()`, which doesn't actually fix punctuation
differences and risked matching the wrong company; `/api/geo` silently
treated a missing bounds parameter as `0` instead of rejecting the request;
`--port 0` was silently ignored instead of binding an OS-assigned port.
Also deduplicated the three canvas polyline-drawing loops, the two
viewport hit-test loops in mapdata.js, and the three inline exponential-lerp
expressions in the animation loop; hoisted the road style table and the
body font lookup out of the render loop; switched compiled-map file reads
to async so loading ATS and ETS2 at startup actually overlaps instead of
running back-to-back; removed a few small dead code paths (an unused
`metresPerLng` getter, an unused import, a stale duplicated comment, an
unused pref-keys list). Also: the phone's Settings panel had its own
hardcoded version string, already one release stale — it now reads
`/api/status` instead of carrying a second copy that can drift.

Phase 2 map data compiled for the first time this session: 218184 roads for
ats, 251347 for ets2. Real roads, search, and turn-by-turn routing are live
in this install — see the road/routing-nodes counts SETUP.md described are
no longer hypothetical.

**2.7.1** — Turn detection now uses curvature rate (degrees per metre), not
raw angle. A wide 400m highway sweep and a tight 20m corner could share the
same total bearing change and both triggered a "turn" card, which is wrong.
Verified against five hand-built cases (gentle curve, sharp corner,
moderate fork, very gentle sweep, tight hairpin) and against a real
quarter-circle route end to end.

**2.7.0** — Fixed road curves bowing 140m+ off the true path on sharp,
unevenly-spaced corners. The previous version's curve smoothing (uniform
Catmull-Rom) is known to overshoot exactly in this case; switched to
centripetal parameterization, the standard fix. Re-measured on the same
corner: within 6.5m. `roads.bin` format unchanged from 2.6.0.

**2.6.0** — Road curves reconstructed from neighbouring road pieces
(Catmull-Rom smoothing at simple pass-through points; real junctions stay
straight). `roads.bin` format changed (RRD1 → RRD2) to support
variable-length polylines instead of fixed 2-point segments.

**2.5.1** — Level-of-detail cutoffs for wide zoom. A full-map query at real
road-count scale (218k+ segments) measured 315ms/9.3MB before this; local
roads and shields now drop out past 20km viewport span, everything but
motorways past 60km. Same query after: 66ms/2.4MB.

**2.5.0** — Damage indicator, arrival state on the manoeuvre card, a visible
recenter button, label collision avoidance, city footprint shading, ferry
crossings (straight and curved), and an experimental perspective-tilt view
(off by default, provably identical to flat mode when off).

**2.4.0–2.4.1** — City/company labels, colour-coded highway shield badges,
road-class casing (motorway/major/local), background depth gradient, a
manoeuvre arrow drawn on the map itself. Fixed a missing `?game=` parameter
bug in manual destination-setting that could silently route against the
wrong game's map.

**2.2.0–2.2.3** — Auto-routing: matches the active job's destination against
the compiled map automatically, no manual search needed. Fixed a stale-route
bug (an old job's route could linger on screen after the job changed and the
new one failed to match) and a `sw.js` caching bug that could block updates
from ever reaching the phone.

**2.1.0** — The real map compiler: parses truckermudgeon/maps output into
`roads.bin`, a search index, and a routing graph (Dijkstra/A*). Before this,
the map was a placeholder 1km grid.

**2.0.0** — Initial rewrite from the original single-file Rig Radar: split
into a proper Node/SSE server, single-file PWA client, and a projection
module shared between live telemetry and map rendering (this is why the
truck sits on the road rather than near it).
