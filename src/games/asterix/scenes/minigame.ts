import { MINIGAMES, announceVariant, initGame, minigameAt, type MinigameEntry } from "../game/rules";
import { createPlayer } from "../game/state";
import { copy } from "../ui/copy";
import { Board } from "./board";
import type { Play } from "./game";
import { LEFT, RIGHT, VOICES, type Runtime, type Script, type Zone } from "./runtime";
import { changeSesterces } from "./squares";

/**
 * Case jeu : aiguillage des mini-jeux (`20fa:135a`, table `20fa:146d`, `docs/asterix/engine.md` §10.11). L'annonce
 * `20fa:130f` est jouée ici, puis le mini-jeu reçoit la main ; le tour se termine à son retour.
 *
 * Un mini-jeu porté (vague E) s'inscrit par `registerMinigame(module, script)`, dans `scenes/minigames/index.ts` : c'est
 * le point d'entrée par case, celui que la table d'origine appelle. Ceux qui ne le sont pas encore sont remplacés par un
 * écran provisoire qui laisse choisir l'issue.
 */
export type MinigameScript = (play: Play, entry: MinigameEntry) => Script;

const SCRIPTS = new Map<number, MinigameScript>();

/** Branche le script d'un mini-jeu porté (module 22 à 36) à la place de l'écran provisoire. */
export function registerMinigame(module: number, script: MinigameScript): void {
  SCRIPTS.set(module, script);
}

/** Vrai si le mini-jeu du module est porté (inscrit) ; faux tant qu'il passe par l'écran provisoire. */
export function isPorted(module: number): boolean {
  return SCRIPTS.has(module);
}

/** Une position absente de la table lancerait le jeu d'Idéfix sans annonce (`20fa:1463`). */
const FALLBACK: MinigameEntry = { announce: -1, module: 34, entry: "23d1:09c1", argument: 1, name: "Idéfix dans la pyramide" };

/**
 * Sesterces donnés par l'écran provisoire pour un mini-jeu gagné. Hypothèse : la plupart des mini-jeux appellent
 * `1d24:0912(joueur, 1, 1)` ; les gains exacts (1 à 3 selon le jeu) relèvent de la vague E.
 */
export const PLACEHOLDER_GAIN = 1;

const OPTION_ZONES: readonly Zone[] = [
  { x1: 50, y1: 120, x2: 150, y2: 150 },
  { x1: 170, y1: 120, x2: 270, y2: 150 },
];

/**
 * Écran provisoire d'un mini-jeu : son nom et le choix « Gagné » ou « Perdu ». Gagné applique la conséquence du plateau
 * (un gain de sesterces par `1d24:0912`), perdu ne change rien.
 */
function* placeholder(play: Play, entry: MinigameEntry): Script {
  const { rt, board } = play;
  const { surface, palette, fade } = rt.ctx;
  const centred = (y: number, text: string, color: number): void => {
    rt.textColor = color;
    const width = rt.text(0, -20, text);
    rt.text(Math.floor((320 - width) / 2), y, text);
  };
  yield* rt.fadeOut();
  palette.setColor(1, 0xf0, 0xf0, 0xe0);
  palette.setColor(2, 0xf0, 0xb8, 0x20);
  palette.setColor(3, 0x70, 0x70, 0x70);
  palette.setColor(4, 0x28, 0x30, 0x50);
  let won = true;
  rt.screen = "minigame";
  rt.hint = { module: entry.module };
  const paint = (): void => {
    surface.clear(0);
    rt.fill(20, 30, 299, 170, 4);
    rt.frame(20, 30, 299, 170, 2);
    centred(42, copy.placeholder.title, 3);
    centred(62, entry.name, 2);
    centred(96, copy.placeholder.question, 1);
    [copy.placeholder.won, copy.placeholder.lost].forEach((label, i) => {
      const zone = OPTION_ZONES[i];
      const selected = won === (i === 0);
      rt.frame(zone.x1, zone.y1, zone.x2, zone.y2, selected ? 2 : 3);
      rt.textColor = selected ? 2 : 3;
      const width = rt.text(0, -20, label);
      rt.text(Math.floor((zone.x1 + zone.x2 - width) / 2), zone.y1 + 10, label);
    });
    rt.textColor = 0x7e;
  };
  paint();
  fade.reset();
  for (;;) {
    const directions = rt.dirs();
    if (directions & LEFT) won = true;
    if (directions & RIGHT) won = false;
    const click = rt.click(OPTION_ZONES);
    if (typeof click === "number") won = click === 0;
    paint();
    if (click !== null) break;
    yield;
  }
  rt.sound("validate");
  yield* rt.waitRelease();
  if (won) yield* changeSesterces(rt, board.player, PLACEHOLDER_GAIN, true);
  yield* rt.waitSound();
  yield* rt.fadeOut();
  rt.screen = "";
}

/** `20fa:135a` : case jeu du joueur courant. */
export function* minigameSquare(play: Play): Script {
  const { rt, board } = play;
  const entry = minigameAt(rt.tables, board.player.pos) ?? FALLBACK;
  rt.voiceKey = VOICES.announce;
  if (entry.announce >= 0) yield* rt.voice(entry.announce * 3 + announceVariant(rt.session, entry.announce, rt.rnd));
  yield* (SCRIPTS.get(entry.module) ?? placeholder)(play, entry);
}

/** Lancement direct d'un mini-jeu, hors partie (page de recette `?minigame=22`, tests) : module et niveaux du joueur. */
export interface MinigameStart {
  module: number;
  reflexion?: number;
  action?: number;
}

/**
 * Joue un seul mini-jeu comme le ferait sa case : une partie d'un joueur (Astérix) posé sur la case du module, l'annonce,
 * le mini-jeu, puis un fondu au noir. Le joueur reste dans `rt.game` (les tests y lisent ses sesterces).
 */
export function* playMinigame(rt: Runtime, start: MinigameStart): Script {
  const index = MINIGAMES.findIndex((entry) => entry.module === start.module);
  if (index < 0) throw new RangeError(`module ${start.module} : pas un mini-jeu`);
  rt.game = initGame(rt.session, rt.rnd, false);
  const player = createPlayer(0, start.reflexion, start.action);
  player.pos = rt.tables.minigamePositions[index];
  rt.game.players = [player];
  yield* minigameSquare({ rt, board: new Board(rt) });
  yield* rt.cleanup();
  yield* rt.fadeOut();
}
