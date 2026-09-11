# Changelog

Compressed history for context — what changed and why, not a full diff.
Built collaboratively with Claude across one long chat session; see
SETUP.md for current setup and known limitations.

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
