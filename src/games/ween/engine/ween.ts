/**
 * Ween: The Prophecy sur le moteur Coktel, d'après ScummVM (`engines/gob/gob.cpp:558-569` : classes v2 de
 * Gobliins 2 ; `detection/tables_ween.h` : entrée `FR_FRA` d'`intro.stk`, archive et TOT de départ par défaut ;
 * `inter_v1.cpp` : o1_callSub, o1_keyFunc ; `game.cpp:612-616` : TOT absent ; GPL v3+).
 *
 * Écarts volontaires avec ScummVM (`docs/ween/engine.md`, « État de la vague C ») :
 * - protection de copie sautée (plan D2), comme le banc ; ScummVM la joue pour Ween ;
 * - rustine VAR(59) de l'attente active de l'introduction (`inter_v1.cpp:1373-1380`, bogue #3205) reprise, mais
 *   reconnue aussi par motif : telle quelle, elle teste la position 729 et ne se déclenche jamais sur cette version
 *   (keyFunc lu à 727) ; le banc reçoit la même correction (plan D9).
 */
import type { CoktelGameDefinition, GameHooks } from "../../../engine/coktel/definition";
import { Game, type GameOptions } from "../../../engine/coktel/game";
import type { Host, Subsystems } from "../../../engine/coktel/host";
import { createSystem, type System, type SystemOptions } from "../../../engine/coktel/system";
import { WeenSaves } from "./saves";

/**
 * Appels de la routine de la grille de couleurs (protection de copie) : `intro.tot` @348 quand l'introduction a été
 * interrompue (`if VAR(217) == 0`), `intro5.tot` @1023 à la fin de l'introduction regardée (après `VAR(217) = 1`).
 */
export const PROTECTION_CALLS: readonly { tot: string; offset: number }[] = [
  { tot: "INTRO.TOT", offset: 348 },
  { tot: "INTRO5.TOT", offset: 1023 },
];

/** Réponse juste au premier essai : nombre d'essais (210) et compteur de clignotement (211), relus par les salles. */
const PROTECTION_ANSWER: readonly [number, number][] = [
  [210, 1],
  [211, 10],
];

const sameTot = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase();

/**
 * Crochets sans état de Ween.
 *
 * Protection (plan D2, `o1_callSub`, à l'image des sauts de Gobliins 1 et 2 d'`inter_v1.cpp:719-737` et du correctif
 * du banc, `patch/gob-trace.patch`) : l'appel est reconnu par le TOT courant et la cible de l'appel, jamais par la
 * position de l'instruction. La routine sautée écrit aussi VAR(60) (déjà 1), VAR(212-214) (chiffres tirés au
 * hasard : le générateur n'avance pas, comme au banc), VAR(190), VAR(3461-3466) et des chaînes en VAR(2000) : non
 * relus ensuite, ils restent tels quels. Une nouvelle partie (`EMAJ1000`) remet 210 à 214 à zéro, sauf 212.
 */
export const WEEN_HOOKS: GameHooks = {
  /**
   * Attente active d'`intro5.tot` (bogue ScummVM #3205) : la boucle `repeat { keyFunc(1) ; VAR(59) = VAR(59) + 1 }
   * until VAR(59) > 5000` compte 5 000 tours que handleBusyWait ralentit ; comme ScummVM, VAR(59) passe à 4 000
   * (1 000 tours restent). Reconnue par la position de ScummVM (729, après l'opcode) ou par motif : `keyFunc(1)` suivi
   * de l'affectation de VAR(59) (`o2_assign` 0x90, variable 32 bits 0x17, indice 59).
   */
  onKeyFunc(game, ins) {
    if (!sameTot(game.curTotFile, "INTRO5.TOT") || game.vars.readVar32(59) >= 4000) return;
    const d = game.script.data;
    const n = ins.next;
    const motif = ins.args.cmd === 1 && d[n] === 0x90 && d[n + 1] === 0x17 && d[n + 2] === 59 && d[n + 3] === 0;
    if (ins.pos === 729 || motif) game.vars.writeVar32(59, 4000);
  },

  beforeCallSub(game, offset) {
    if (!PROTECTION_CALLS.some((c) => c.offset === offset && sameTot(c.tot, game.curTotFile))) return false;
    for (const [v, value] of PROTECTION_ANSWER) game.vars.writeVar32(v, value);
    return true;
  },
};

/** Ween, version DOS française sur disquettes (VGA, AdLib) : interpréteur v2, sauvegardes SaveLoad_v2, pas de CD. */
export const WEEN: CoktelGameDefinition = {
  id: "ween",
  version: 2,
  startArchive: "INTRO.STK",
  startTot: "INTRO.TOT",
  createSaves: ({ gfx, store }) => new WeenSaves(gfx, store),
  hooks: WEEN_HOOKS,
};

/**
 * Une partie de Ween. `endedOn` : TOT absent qui a terminé le jeu (`END` après « Quitter », `DEMO` de la version
 * de démonstration), comme ScummVM (`game.cpp:612-616` : `_terminate = 2`) ; l'interface y revient à l'accueil.
 * `o1_manageDataFile` sur une archive absente (`DISK2.STK`, `DISK3.STK` de `MENU.TOT`) ne fait rien, comme
 * `DataIO::openArchive` (`dataio.cpp:235-265`) : c'est le comportement du moteur commun.
 */
export class WeenGame extends Game {
  endedOn: string | null = null;

  constructor(host: Host, sys: Subsystems, options: Omit<GameOptions, "hooks"> = {}) {
    super(host, sys, WEEN, {
      ...options,
      hooks: { ...WEEN_HOOKS, onMissingTot: (game, tot) => ((game as WeenGame).endedOn = tot) },
    });
  }
}

/** Sous-systèmes réels de Ween (à passer à `new WeenGame(host, system.sys)`). */
export function createWeenSystem(options: Omit<SystemOptions, "definition" | "cdBackend">): System {
  return createSystem({ ...options, definition: WEEN });
}
