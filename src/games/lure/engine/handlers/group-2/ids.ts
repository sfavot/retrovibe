/** Numéros du groupe L2 : hotspots, sons, scripts d'animation. */

/** Le feu sur la paille (apparaît quand la torche a fini de tomber), et la paille qui brûle. */
export const STRAW_FIRE_ID = 0x41c;
export const FIRE_ID = 0x418;
export const FIRE_SOUND = 8;
/** Scripts d'animation du prisonnier : repos et geste. */
export const PRISONER_IDLE_SCRIPT = 0x3e0;
export const PRISONER_ACTIVE_SCRIPT = 0x3f6;
/** Seuil du tirage du prisonnier (`getRandomNumber(65536) >= 6`). */
export const PRISONER_RANDOM_RANGE = 65536;
export const PRISONER_RANDOM_THRESHOLD = 6;
