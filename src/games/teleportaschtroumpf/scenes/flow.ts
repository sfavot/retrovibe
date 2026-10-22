import type { GameSetup } from "../game/rules";
import type { Scene, SceneContext, TransitionOptions } from "../engine/scene";
import { VideoScene } from "../engine/video";
import { createGameScene } from "./game";
import { createFreeModeScene } from "./s02-map";
import { createMenuScene } from "./s07-menu";
import { createCharactersScene } from "./s08-characters";
import { createPlayersScene } from "./s09-players";
import { createConfirmScene } from "./s49-confirm";
import { createCreditsScene } from "./s52-credits";
import { createParentsScene } from "./s04-parents";

/**
 * Flux de navigation entre les écrans (engine.md §1.2) : seul endroit qui décide de « l'écran suivant ».
 * Chaque écran (`sNN-*.ts`) reçoit ses paramètres et un rappel `onDone` ; il n'enchaîne rien lui-même. Ces fonctions
 * sont les points d'entrée fixes : les écrans, le menu et plus tard la partie s'appellent par elles.
 *
 * Elles remplacent la scène courante (`replace`) avec les fondus de l'original. Appelées depuis une scène qui vient de
 * faire un fondu au noir (fin de vidéo), elles n'en refont pas un (voir `transition`).
 */

/** Fondu au noir avant la transition, sauf si l'écran est déjà noir (un second `out` rallumerait l'image un instant). */
function transition(ctx: SceneContext): TransitionOptions {
  return { fade: !ctx.palette.black };
}

function go(ctx: SceneContext, scene: Scene): void {
  ctx.scenes.replace(scene, transition(ctx));
}

/** Menu principal S07. Le démarrage (`boot.ts`) n'est jamais rejoué. */
export function goMainMenu(ctx: SceneContext): void {
  go(ctx, createMenuScene());
}

function playVideo(ctx: SceneContext, file: string): void {
  go(ctx, new VideoScene({ file, fadeOutAtEnd: true, onEnd: goMainMenu }));
}

/** Règles (S10, `s10a.mux`), puis retour au menu. */
export function goRules(ctx: SceneContext): void {
  playVideo(ctx, "s10a.mux");
}

/** Introduction (S06, `s06a.mux`), puis retour au menu. */
export function goIntro(ctx: SceneContext): void {
  playVideo(ctx, "s06a.mux");
}

/** Mode « Schtroumpf » : carte libre (S02, `s02-map.ts`), puis retour au menu. */
export function goFreeMap(ctx: SceneContext): void {
  go(ctx, createFreeModeScene(goMainMenu));
}

/** S09 : nombre de joueurs, puis S08 avec ce nombre. */
export function goPlayers(ctx: SceneContext): void {
  go(ctx, createPlayersScene(goCharacters));
}

/** S08 : personnages de `players` joueurs. Jouer → partie ; retour → S09 ; menu → S07. */
export function goCharacters(ctx: SceneContext, players: number): void {
  go(
    ctx,
    createCharactersScene(players, (c, result) => {
      if (result.action === "play") startGame(c, { players: result.players, options: c.options });
      else if (result.action === "back") goPlayers(c);
      else goMainMenu(c);
    }),
  );
}

/** Menu parents (S04), puis retour au menu. */
export function goParents(ctx: SceneContext): void {
  go(ctx, createParentsScene(goMainMenu));
}

/**
 * Confirmation S49 numéro `n` (10 = quitter le jeu). `onAnswer` décide de la suite :
 * - `mode: "replace"` (défaut) : l'écran remplace la scène courante ; la réponse est suivie d'un `go…` ;
 * - `mode: "push"` : l'écran est empilé au-dessus de la scène courante ; `onAnswer` doit appeler `ctx.scenes.pop(…)` pour
 *   la reprendre (abandon S46 au-dessus de la partie).
 */
export function askConfirmation(
  ctx: SceneContext,
  n: number,
  onAnswer: (ctx: SceneContext, yes: boolean) => void,
  mode: "replace" | "push" = "replace",
): void {
  const scene = createConfirmScene(n, onAnswer);
  if (mode === "push") ctx.scenes.push(scene, transition(ctx));
  else go(ctx, scene);
}

/** Partie (`game.ts` : plateau S01 et tout ce qui s'en déclenche), puis retour au menu à sa fin. */
export function startGame(ctx: SceneContext, setup: GameSetup): void {
  go(ctx, createGameScene(setup, goMainMenu));
}

/** Quitter : confirmation (n = 10) ; Non → menu ; Oui → générique (S52) puis `host.exit()`. */
export function quitGame(ctx: SceneContext): void {
  askConfirmation(ctx, 10, (c, yes) => {
    if (yes) go(c, createCreditsScene((end) => end.host.exit()));
    else goMainMenu(c);
  });
}
