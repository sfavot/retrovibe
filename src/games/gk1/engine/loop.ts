/**
 * Boucle du jeu sans tête : une image à la fois, à 60 ticks par seconde (`docs/gk1/plan.md`, « Architecture » et D13).
 *
 * `runFrame` avance l'horloge du jeu d'un tick puis fait tourner la machine virtuelle jusqu'à ce qu'elle rende la main :
 * à `FrameOut`, ou à une fonction du noyau qui attend (cinématique, fichier audio, `GetEvent` relu en boucle sans
 * `FrameOut` : `kernel/events.ts`), ou quand `play` revient. `useGameClock` tire l'heure de `GetTime` de cette même horloge : les attentes en
 * secondes des scripts (`seconds` de `Script`, lues sur l'heure du système) avancent alors avec le jeu et l'exécution reste
 * reproductible.
 *
 * Écart volontaire : l'original lit l'horloge de la machine ; ici une exécution ne dépend que du nombre d'images jouées.
 */
import { GAME_SCRIPT, GLOBAL_CURRENT_ROOM, TICKS_PER_SECOND } from "./ids";
import { toSint16 } from "./memory";
import { type RunResult, RunStatus, type Vm } from "./vm";

/** Tranches d'instructions accordées à une image avant de conclure que les scripts bouclent sans `FrameOut`. */
const MAX_SLICES_PER_FRAME = 200;
/** Heure du jeu au démarrage : midi, le jour du CD (`VERSION`). */
const START = { year: 1994, month: 5, day: 3, hour: 12 };
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** Fait donner par `GetTime` une heure qui avance avec les ticks du jeu. */
export function useGameClock(vm: Vm): void {
  vm.wallClock = () => {
    const seconds = Math.floor(vm.ticks / TICKS_PER_SECOND);
    const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
    return {
      year: START.year,
      month: START.month,
      day: START.day,
      hour: (START.hour + Math.floor(minutes / MINUTES_PER_HOUR)) % HOURS_PER_DAY,
      minute: minutes % MINUTES_PER_HOUR,
      second: seconds % SECONDS_PER_MINUTE,
    };
  };
}

/**
 * Joue une image : un tick d'horloge, puis les scripts jusqu'à ce qu'ils rendent la main (`FrameOut` le plus souvent).
 * Renvoie le dernier résultat de `run`.
 *
 * Une tranche épuisée sans `FrameOut` avance elle aussi l'horloge d'un tick : les scripts ont des boucles d'attente qui ne
 * font que relire `GetTime` jusqu'à ce qu'il change (`Dialog::doit`, après l'ouverture d'une fenêtre), et l'horloge de
 * l'original avançait pendant ce temps.
 */
export function runFrame(vm: Vm): RunResult {
  vm.ticks++;
  for (let slice = 0; slice < MAX_SLICES_PER_FRAME; slice++) {
    const result = vm.run();
    if (result.status !== RunStatus.Slice) return result;
    vm.ticks++;
  }
  throw new Error("GK1 : les scripts ne rendent plus la main (aucun FrameOut)");
}

/** Numéro de la pièce où se trouve le jeu (0 avant le chargement du script 0). */
export function currentRoom(vm: Vm): number {
  const script = vm.scripts.loaded(GAME_SCRIPT);
  const globals = script && vm.memory.localsSegment(script.localsSegment);
  return globals ? toSint16(globals.values[GLOBAL_CURRENT_ROOM]) : 0;
}
