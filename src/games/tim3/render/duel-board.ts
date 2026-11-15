/**
 * Tableau des deux joueurs (`H2H.ITF`, images de `GOALBAR.ANM`), sous l'aire de jeu à droite de la barre du but.
 *
 * TIMWIN.EXE (414670, 4147b6) ouvre en mode 2 une petite fenêtre « HeadToHead » de 346 × 64 (en 640×480 : (296, 388), table
 * 0x471a80) et réduit la barre du but à 286 pixels (table 0x471b80) ; le port pose le tableau en bas à droite de son écran
 * (`DUEL_BOARD`) et réduit la barre du but d'autant (`DUEL_GOAL_WIDTH`). Contenu :
 * - `GB_HEAD2HEAD` : état 3 (joueur 1, moitié rouge) ou 4 (joueur 2, moitié bleue) selon le joueur du tour (414a93) ;
 * - `GB_PLAY1` / `GB_PLAY2` (valeurs 11098 / 11099, 4213b9) : noms, couleur 15 pour le joueur du tour, 7 pour l'autre ;
 * - `GB_WIN1` / `GB_WIN2` (11102, « Wins: », une espace en français) : couleur 14 pour le joueur du tour, 15 sinon (421fbf) ;
 * - `GB_P1SCORE` / `GB_P2SCORE` : manches gagnées, image n de l'état 6 ; `GB_10SEC`, `GB_SEC`, `GB_TENTHSEC` : temps restant du
 *   tour, images de l'état 5 (41495b : t / 10000, (t / 1000) % 10, (t / 100) % 10).
 */
import type { Itf } from "../data/itf";
import { clockDigits, type Player } from "../engine/duel";
import type { RenderAssets } from "./assets";
import { drawItf, itfText } from "./itf-draw";
import type { Surface } from "./surface";

export const H2H = {
  frame: 37000,
  board: 37002,
  p1Score: 37005,
  p2Score: 37006,
  tens: 37007,
  seconds: 37008,
  tenths: 37009,
  p1Name: 37010,
  p2Name: 37011,
  p2Wins: 37012,
  p1Wins: 37013,
} as const;

/** Place du tableau dans l'écran 640×480 du port : en bas à droite, à la hauteur de la barre du but. */
export const DUEL_BOARD = { x: 294, y: 414, width: 346, height: 64 } as const;
/** Largeur de la barre du but à côté du tableau. */
export const DUEL_GOAL_WIDTH = DUEL_BOARD.x;
/** Texte « Wins: » (`INTRFACE.RES` 31102). */
const WINS_TEXT = 31102;

export interface DuelBoardView {
  names: readonly [string, string];
  turn: Player;
  wins: readonly [number, number];
  /** Temps restant du tour, en millisecondes. */
  remaining: number;
}

/** Dessine le tableau (`itf` : `H2H.ITF`) à sa place. */
export function drawDuelBoard(surface: Surface, assets: RenderAssets, itf: Itf, view: DuelBoardView): void {
  const [tens, seconds, tenths] = clockDigits(view.remaining);
  const active = (p: Player) => view.turn === p;
  const wins = itfText(assets, WINS_TEXT);
  drawItf(surface, assets, itf, {
    dx: DUEL_BOARD.x,
    dy: DUEL_BOARD.y,
    values: { [H2H.board]: 3 + view.turn },
    frames: {
      [H2H.p1Score]: view.wins[0] % 10,
      [H2H.p2Score]: view.wins[1] % 10,
      [H2H.tens]: tens,
      [H2H.seconds]: seconds,
      [H2H.tenths]: tenths,
    },
    texts: {
      [H2H.p1Name]: `~C${active(0) ? 15 : 7}${view.names[0]}`,
      [H2H.p2Name]: `~C${active(1) ? 15 : 7}${view.names[1]}`,
      [H2H.p1Wins]: `~C${active(0) ? 14 : 15}${wins}`,
      [H2H.p2Wins]: `~C${active(1) ? 14 : 15}${wins}`,
    },
  });
}
