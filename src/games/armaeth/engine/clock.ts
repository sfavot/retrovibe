/**
 * Cadence du monde et horloge de jeu (`docs/armaeth/engine.md` § 3) ; la lumière est dans `render/light.ts`. Fonctions pures : l'état est un objet simple
 * que l'appelant possède (il est sérialisé dans l'en-tête du monde, voir `save.ts`).
 */

/** Plafond du délai (`DGROUP:4b51`) : touche « plus lent » (`1023:027c`). */
export const MAX_DELAY = 0xfa;
/** Valeur d'écriture de la pause (`DGROUP:4b53`) ; 0 = reprise. */
export const PAUSE_ON = 7;
/** Délai initial de `A1FCFG.SYS`. */
export const DEFAULT_DELAY = 6;
/** Tics de monde dans une minute de jeu. */
export const TICKS_PER_MINUTE = 100;

/** Diviseur de tics (octets `4b51`, `4b52`, `4b53`) : le monde avance toutes les `delay + 1` images. */
export interface Cadence {
  /** `4b51` : images sautées entre deux tics (0 à 250). */
  delay: number;
  /** `4b52` : compteur décroissant (octet). */
  counter: number;
  /** `4b53` : non nul = monde en pause. */
  pause: number;
}

/** Horloge de jeu (octets `4b54`, `4b55`, mot `4b56`). */
export interface GameClock {
  hour: number;
  minute: number;
  /** « Centièmes » : tics de monde écoulés dans la minute, 0 à 99. */
  ticks: number;
}

export function createCadence(delay = DEFAULT_DELAY): Cadence {
  return { delay, counter: 0, pause: 0 };
}

/**
 * Décide s'il y a un tic de monde dans l'image (`18a9:01c0..0202`) et met le compteur à jour.
 * `keyPressed` : une touche reconnue force un tic (défaut n° 1 d'`engine.md` § 12), sans toucher au compteur.
 */
export function stepCadence(cadence: Cadence, keyPressed = false): boolean {
  if (keyPressed) return true;
  if (cadence.pause !== 0) return false;
  if (cadence.delay === 0) return true;
  const tick = cadence.counter === 0;
  cadence.counter = (cadence.counter - 1) & 0xff;
  if (tick) cadence.counter = cadence.delay;
  return tick;
}

/** Réglages au clavier (`1023:027c`) ; chacun remet le compteur à 0, donc le prochain tic est immédiat. */
export type CadenceKey = "slower" | "faster" | "pause" | "resume";

/** Alt+A ou Alt+- : plus lent. Alt+Z ou Alt+= : plus rapide. Alt+P : pause. Alt+N : reprise. */
export function cadenceKeyFor(key: string): CadenceKey | null {
  switch (key.toLowerCase()) {
    case "a":
    case "-":
      return "slower";
    case "z":
    case "=":
      return "faster";
    case "p":
      return "pause";
    case "n":
      return "resume";
    default:
      return null;
  }
}

export function applyCadenceKey(cadence: Cadence, key: CadenceKey): void {
  if (key === "slower") cadence.delay = Math.min(MAX_DELAY, cadence.delay + 1);
  else if (key === "faster") cadence.delay = Math.max(0, cadence.delay - 1);
  else cadence.pause = key === "pause" ? PAUSE_ON : 0;
  cadence.counter = 0;
}

export function createClock(hour = 10, minute = 0, ticks = 0): GameClock {
  return { hour, minute, ticks };
}

export interface ClockAdvance {
  /** Le compteur de tics a bouclé : une minute de jeu s'est écoulée. */
  minuteElapsed: boolean;
  /** La palette est à recalculer : minute écoulée et `minute % 10 == 0` (§ 3). */
  paletteDirty: boolean;
}

/** Avance l'horloge d'un tic de monde : 100 tics = 1 minute, 60 minutes = 1 heure, 24 heures = 1 jour. */
export function advanceClock(clock: GameClock): ClockAdvance {
  clock.ticks++;
  if (clock.ticks < TICKS_PER_MINUTE) return { minuteElapsed: false, paletteDirty: false };
  clock.ticks = 0;
  clock.minute++;
  if (clock.minute >= 60) {
    clock.minute = 0;
    clock.hour++;
    if (clock.hour >= 24) clock.hour = 0;
  }
  // hypothèse (engine.md §3) : le test « minutes % 10 == 0 » porte sur la minute déjà incrémentée.
  return { minuteElapsed: true, paletteDirty: clock.minute % 10 === 0 };
}
