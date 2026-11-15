/**
 * Tableau des deux joueurs (`H2H.ITF`, images de `GOALBAR.ANM`), sous l'aire de jeu à droite de la barre du but.
 *
 * TIMWIN.EXE (414670, 4147b6) ouvre en mode 2 une petite fenêtre « HeadToHead » de 346 × 64 (en 640×480 : (296, 388), table
 * 0x471a80) et réduit la barre du but à 286 pixels (table 0x471b80) ; le port pose le tableau en bas à droite de son écran
 * (`DUEL_BOARD`) et réduit la barre du but d'autant (`DUEL_GOAL_WIDTH`). Contenu :
 * - `GB_HEAD2HEAD` : état 3 (joueur 1, moitié rouge) ou 4 (joueur 2, moitié bleue) selon le joueur du tour (414a93) ;
 * - `GB_PLAY1` / `GB_PLAY2` (valeurs 11098 / 11099, 4213b9) : noms, couleur 15 pour le joueur du tour, 7 pour l'autre, lettres plates
 *   (style 1, non enregistré : 452e8c rend le dessin par défaut). Le 7 est le gris de la moitié inactive du tableau : l'original écrit
 *   donc le nom de l'attente gris sur gris, illisible. Écart du port : ce nom garde la couleur 7 mais reçoit un relief discret
 *   (`drawWaitingName`) ;
 * - `GB_WIN1` / `GB_WIN2` (11102, « Wins: », une espace en français) : couleur 14 pour le joueur du tour, 15 sinon (421fbf) ;
 * - `GB_P1SCORE` / `GB_P2SCORE` : manches gagnées, image n de l'état 6 ; `GB_10SEC`, `GB_SEC`, `GB_TENTHSEC` : temps restant du
 *   tour, images de l'état 5 (41495b : t / 10000, (t / 1000) % 10, (t / 100) % 10).
 */
import type { Itf } from "../data/itf";
import { clockDigits, type Player } from "../engine/duel";
import type { RenderAssets } from "./assets";
import { ITF_DEFAULT_FONT, ITF_FONTS, TEXT_CENTER_BLOCK, TEXT_CENTER_LINES, TEXT_MIDDLE, TEXT_WRAP, drawItf, drawTextBox, itfText } from "./itf-draw";
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

/** Couleurs du nom du joueur du tour / de celui qui attend (4214b4, 4214ef). */
const NAME_ACTIVE = 15;
const NAME_WAITING = 7;
/** Relief du nom qui attend : ombre sombre en haut à gauche (gris foncé, 8), reflet clair en bas à droite (15). */
const NAME_SHADOW = 8;
const NAME_HIGHLIGHT = 15;

/**
 * Nom du joueur qui attend : même couleur, police et mise en page que le contrôle (421c91 : 0x302 ^ 0x1000, police 1), avec un relief
 * d'un pixel. Dessiné après le tableau : sans lui, la couleur 7 se confond avec le gris du fond.
 */
function drawWaitingName(surface: Surface, assets: RenderAssets, itf: Itf, id: number, name: string): void {
  const c = itf.controls.find((k) => k.id === id);
  const fontName = ITF_FONTS[1] ?? ITF_DEFAULT_FONT;
  const font = assets.font(fontName);
  if (!c || !font || !name) return;
  const flags = TEXT_WRAP | TEXT_CENTER_BLOCK | TEXT_MIDDLE | TEXT_CENTER_LINES;
  const at = (dx: number, dy: number, color: number) =>
    drawTextBox(surface, font, name, { x: c.x + DUEL_BOARD.x + dx, y: c.y + DUEL_BOARD.y + 1 + dy, width: c.width, height: c.height }, { mode: 0, color, flags, font: fontName });
  at(-1, -1, NAME_SHADOW);
  at(1, 1, NAME_HIGHLIGHT);
  at(0, 0, NAME_WAITING);
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
      [H2H.p1Name]: `~C${active(0) ? NAME_ACTIVE : NAME_WAITING}${view.names[0]}`,
      [H2H.p2Name]: `~C${active(1) ? NAME_ACTIVE : NAME_WAITING}${view.names[1]}`,
      [H2H.p1Wins]: `~C${active(0) ? 14 : 15}${wins}`,
      [H2H.p2Wins]: `~C${active(1) ? 14 : 15}${wins}`,
    },
  });
  const waiting = view.turn === 0 ? 1 : 0;
  drawWaitingName(surface, assets, itf, waiting === 0 ? H2H.p1Name : H2H.p2Name, view.names[waiting]);
}
