/**
 * Numéros nommés du groupe L4 (Goewin, moines, grottes, château) : ceux de `luredefs.h` (ScummVM, GPL v3+) que `engine/ids.ts` n'a pas.
 * Les autres (`HotspotId.GOEWIN`, `SupportId.GOEWIN_CAVE`, `RoomNum.CAVE`…) viennent de `engine/ids.ts`.
 */

/** Hotspots du groupe. */
export const L4Hotspot = {
  GARGOYLE_1: 0x42c,
  GARGOYLE_2: 0x42d,
  CASTLE_SKORL_GUARD_1: 0x437,
  CASTLE_SKORL_GUARD_2: 0x438,
  DRAGON: 0x435,
} as const;

/** Portes de la jonction des crânes (`skullAnimHandler`). */
export const SkullDoor = { SOUTH_WEST: 0x272a, SOUTH_EAST: 0x272c, DEFAULT: 0x272e } as const;

/** Scripts d'animation du serf du chevalet (`RACK_SERF_SCRIPT_ID_*`, décalages de `0x3F0D`). */
export const RackSerfScript = { FREE: 0x35c, ESCAPE: 0x384 } as const;

/** Script d'animation de la transformation (étincelles) et du brûleur : décalages de `0x3F0D`. */
export const TRANSFORM_SCRIPT = 0x630;
export const GOEWIN_WORK_SCRIPT = 0x616;
/** Emploi du temps (index d'action) lancé par `makeGoewinWork`. */
export const GOEWIN_WORK_SCHEDULE_ROOM = 34;
/** Position du brûleur à huile une fois allumé. */
export const OIL_BURNER_X = 152;
/** Point où se tient Goewin au travail (`walkX`, `walkY`). */
export const GOEWIN_WORK_WALK = { x: 179, y: 138 } as const;
/** Verbes que Goewin libérée accepte : « Parle à », « Donne », « Corromps », « Demande » (`freeGoewin`). */
export const GOEWIN_FREED_ACTIONS = 0x820c00;
