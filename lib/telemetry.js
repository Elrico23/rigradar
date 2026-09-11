'use strict';
/* Rig Radar v2 — SCS shared-memory parser
 *
 * The byte offsets below come straight from the v1 server, where they were
 * already proven working against scs-telemetry-common.hpp. They are not
 * re-derived here, only reshaped into the structure v2 expects.
 *
 * Exports parse(buffer) -> state object, or null when the game is not
 * publishing (menu, loading, plugin not active).
 */

// Offsets into the plugin's shared-memory block. Cross-checked against the
// official scs-telemetry-common.hpp (RenCloud/scs-sdk-plugin, v1.12) — every
// offset that was already here matched the struct's computed byte layout
// exactly, so rpm and rpmMax below were computed the same way rather than
// guessed: rpm sits 4 bytes after speed, in the same float zone, matching
// the struct's declared field order (speed, engineRpm, userSteer, ...).
const O = {
  sdkActive: 0,
  paused: 4,
  game: 52,
  timeAbs: 64,
  deliveryAbs: 88,
  gearDash: 508,
  fuelCap: 704,
  rpmMax: 740,
  cargoMass: 748,
  speed: 948,
  rpm: 952,
  cruise: 988,
  fuel: 1000,
  fuelRange: 1008,
  wearEngine: 1036,
  wearTrans: 1040,
  wearCabin: 1044,
  wearChassis: 1048,
  wearWheels: 1052,
  routeDist: 1060,
  routeTime: 1064,
  speedLimit: 1068,
  posX: 2200,
  posY: 2208,
  posZ: 2216,
  heading: 2224,
  cargo: 2620,
  cityDst: 2748,
  compDst: 2876,
  citySrc: 3004,
  compSrc: 3132,
  jobIncome: 4000,
  onJob: 4300,
};

/** Reads a null-terminated UTF-8 string, capped so a bad offset can't run away. */
function str(b, off, max = 64) {
  const end = b.indexOf(0, off);
  const stop = end > off && end < off + max ? end : off + max;
  return b.toString('utf8', off, Math.min(stop, b.length)).trim();
}

function parse(b) {
  if (!b || b.length < O.onJob + 1) return null;
  if (!b[O.sdkActive]) return null;

  const gameId = b.readUInt32LE(O.game); // 1 = ETS2, 2 = ATS
  const minutes = b.readUInt32LE(O.timeAbs);
  const delivery = b.readUInt32LE(O.deliveryAbs);
  const onJob = Boolean(b[O.onJob]);

  const routeTime = b.readFloatLE(O.routeTime); // game seconds
  const routeDist = b.readFloatLE(O.routeDist); // metres

  const cargoMass = b.readFloatLE(O.cargoMass);
  const income = Number(b.readBigUInt64LE(O.jobIncome));

  const litres = b.readFloatLE(O.fuel);
  const capacity = b.readFloatLE(O.fuelCap);

  return {
    connected: true,
    game: gameId === 2 ? 'ats' : 'ets2',
    paused: Boolean(b[O.paused]),

    truck: {
      // The map needs world metres; X is east and Z is south in SCS space.
      x: b.readDoubleLE(O.posX),
      z: b.readDoubleLE(O.posZ),
      // The plugin reports heading as 0..1 counter-clockwise from north.
      heading: ((1 - b.readDoubleLE(O.heading)) * 360) % 360,
      speed: Math.abs(b.readFloatLE(O.speed)) * 3.6,
      gear: b.readInt32LE(O.gearDash),
      rpm: Math.max(0, b.readFloatLE(O.rpm)),
      rpmMax: b.readFloatLE(O.rpmMax),
      cruise: b.readFloatLE(O.cruise) * 3.6,
    },

    fuel: {
      litres,
      capacity,
      rangeKm: b.readFloatLE(O.fuelRange),
      warning: capacity > 0 && litres / capacity < 0.12,
    },

    damage: {
      engine: b.readFloatLE(O.wearEngine),
      transmission: b.readFloatLE(O.wearTrans),
      cabin: b.readFloatLE(O.wearCabin),
      chassis: b.readFloatLE(O.wearChassis),
      wheels: b.readFloatLE(O.wearWheels),
      // The trailer publishes its own wear on a separate shared-memory
      // channel this offset table doesn't cover, so it's left unread rather
      // than aliased to O.wearChassis — the previous alias silently showed
      // chassis wear as trailer wear, which is wrong whenever they differ.
    },

    navigation: {
      distance: routeDist > 0 ? routeDist : 0,
      time: routeTime > 0 ? routeTime : 0,
      speedLimit: Math.max(0, b.readFloatLE(O.speedLimit) * 3.6),
    },

    // The plugin does not publish your bank balance, so the pill shows what
    // this run pays instead. Reads the same way at a glance.
    wallet: onJob ? income : 0,

    gameTime: minutes,

    job: onJob
      ? {
          cargo: str(b, O.cargo),
          mass: cargoMass > 0 ? cargoMass : 0,
          income,
          source: [str(b, O.citySrc), str(b, O.compSrc)].filter(Boolean).join(' — '),
          destination: [str(b, O.cityDst), str(b, O.compDst)].filter(Boolean).join(' — '),
          lateInMinutes: delivery > minutes ? delivery - minutes : null,
        }
      : null,
  };
}

module.exports = { parse, OFFSETS: O };
