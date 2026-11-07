/**
 * Épreuve provisoire des écrans 7 à 18 (vague G, tâche G11), remplacée épreuve par épreuve en vague H : elle rend le parcours complet jouable
 * avant que les vraies épreuves existent. Elle affiche le décor de l'archive de l'écran et le groupe courant, membres présents seulement,
 * et s'appuie sur le kit commun des épreuves (`puzzle-kit.ts`, tâche H0) : arrivée échelonnée (les trois quarts du groupe debout, le reste
 * entre à pied : 30 ticks puis 45 d'écart), animations d'attente, glisser-déposer entre places, bouton carte (région d'angle bas-droit,
 * sans image), musique de l'épreuve quand elle en a une (`PUZZLE_MUSIC`), enregistrement pendant l'épreuve. Aucun texte : c'est un outil
 * de développement, sans aide à l'écran.
 *
 * Places : une rangée de places d'attente en bas de l'écran (les membres y entrent et y attendent) et une rangée de places libres juste au-dessus,
 * pour pouvoir y glisser un Zoombini ; une cible = une place libre, le dépôt est toujours accepté.
 *
 * Fond : seule `BRIDGE` a le couple `SHPL` / `tBMP` 1000 ; pour les autres archives l'écran prend la première paire `SHPL` + `tBMP` de même id qui fait
 * 640 × 480 (`BACKGROUNDS`, relevé sur les 12 archives ; `HOTEL` en a trois, 5000 à 5002, le premier est pris).
 *
 * Touches de développement (sans `Ctrl` ni `Alt`, pour ne pas croiser les raccourcis du jeu ; ignorées quand une boîte de dialogue est ouverte) :
 *  - `R` : réussite sans perte ;
 *  - `1` à `9` (rangée du haut ou pavé numérique) : réussite en perdant ce nombre de Zoombinis, les derniers présents (borné à la taille du groupe moins 1) ;
 *  - `E` : échec, après l'avertissement de retour à la carte (`confirmLeaveToMap`) ; le groupe est abandonné comme à la sortie de la carte (`leaveMap`).
 * Chaque fin passe par `exitPuzzle` puis `ZOOMBINIS_GAME.goTo(nextScreen(…))` (`PuzzleKit.finish`), exactement comme le fera une vraie épreuve. Aucune épreuve n'a ici
 * deux suites (seuls les camps ont deux sorties).
 */
import type { Archive } from "../../../engine/mohawk/resources";
import { screenInfo } from "../data/archives";
import { DIALOG } from "../engine/dialog";
import type { Scene, SceneContext } from "../engine/scene";
import { SCREEN_WIDTH } from "../engine/services";
import { ZOOMBINIS_GAME } from "../engine/game";
import { FIRST_PUZZLE, LAST_PUZZLE, isPuzzleScreen } from "../game/route";
import type { Zoombini } from "../game/state";
import { createPuzzleKit, createTarget, type PuzzleKit } from "./puzzle-kit";
import { closeScreen, openScreen } from "./screen-kit";

/** Id de la palette `SHPL` et du fond `tBMP` 640 × 480 de chaque archive d'épreuve (le premier couple de même id). */
export const BACKGROUNDS: Readonly<Record<number, number>> = {
  7: 1000, // BRIDGE
  8: 300, // TUNNELS
  9: 5000, // PIZZA
  10: 1300, // FERRY
  11: 5000, // LILLY
  12: 5000, // SLIDES
  13: 300, // FLEENS
  14: 5000, // HOTEL
  15: 5000, // NET
  16: 5000, // CAVES
  17: 5000, // SMOKE
  18: 5000, // MAZE2
};

/** Ligne des pieds du groupe (places d'attente), ligne des places libres au-dessus, et écart entre deux places (16 au plus : 15 × 36 = 540 pixels). */
const ROW_Y = 458;
const FREE_ROW_Y = 410;
const STEP_X = 36;
/** Arrivée échelonnée (`1168:274e(30, 45)`, la valeur de la plupart des écrans). */
const START_DELAY = 30;
const STEP_DELAY = 45;

/** Nombre de Zoombinis perdus demandé par un code de touche (`Digit1` à `Digit9`, `Numpad1` à `Numpad9`), ou null. */
function lossOf(code: string): number | null {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return match ? Number(match[1]) : null;
}

/** Scène provisoire de l'épreuve `screen` (7 à 18). */
export function createPuzzleStubScene(screen: number): Scene {
  if (!isPuzzleScreen(screen)) throw new RangeError(`createPuzzleStubScene : l'écran ${screen} n'est pas une épreuve (${FIRST_PUZZLE} à ${LAST_PUZZLE})`);
  const name = screenInfo(screen)?.archive;
  if (!name) throw new Error(`createPuzzleStubScene : pas d'archive pour l'écran ${screen}`);
  let archive: Archive;
  /** Le kit des épreuves de la scène en cours (créé à l'entrée). */
  let kit: PuzzleKit | null = null;
  /** Le groupe de la scène (`party` de `exitPuzzle`) : copie des présents du tampon, que la scène fait évoluer. */
  let party: Zoombini[] = [];

  /** Sortie de l'épreuve (`1168:36e1`) puis écran suivant. */
  function leave(outcome: "success" | "failure", lost = 0): void {
    if (!kit || kit.left) return;
    if (outcome === "success") {
      const present = party.filter((z) => z.present);
      for (const z of present.slice(present.length - lost)) z.present = false;
    }
    kit.finish(outcome);
  }

  return {
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(name);
    },
    enter(ctx: SceneContext) {
      const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
      zoombinis.session.screen = screen;
      openScreen(ctx, archive, { background: BACKGROUNDS[screen] });
      party = zoombinis.game.group.members.filter((z) => z.present).map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() }));
      const x0 = (SCREEN_WIDTH - (party.length - 1) * STEP_X) / 2;
      const row = (y: number) => party.map((_, i) => ({ x: x0 + i * STEP_X, y }));
      kit = createPuzzleKit(ctx, {
        screen,
        party,
        places: row(ROW_Y),
        targets: (places) => [...places, ...row(FREE_ROW_Y).map((point) => createTarget(point))],
      });
      kit.arrive({ startDelay: START_DELAY, step: STEP_DELAY });
      kit.playMusic();
      ctx.requestPresent();
    },
    leave(ctx: SceneContext) {
      kit?.leave();
      kit = null;
      closeScreen(ctx);
    },
    tick() {
      kit?.tick();
    },
    key(event, ctx: SceneContext) {
      if (!kit || kit.left) return false;
      if (event.ctrl || event.alt) return false;
      if (ctx.services.tryGet(DIALOG)?.isOpen) return false;
      if (kit.key(event)) return true;
      if (event.code === "KeyR") {
        leave("success");
        return true;
      }
      const loss = lossOf(event.code);
      if (loss !== null) {
        leave("success", Math.max(0, Math.min(loss, party.length - 1)));
        return true;
      }
      if (event.code === "KeyE") {
        kit.pressMap();
        return true;
      }
      return false;
    },
  };
}
