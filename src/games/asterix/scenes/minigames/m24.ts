import type { Play } from "../game";
import { VOICES, type Runtime, type Script, type Zone } from "../runtime";
import { changeSesterces } from "../squares";
import { ARROW_RGB, arrowCursor, beginPlay, endPlay, fadeSoundOut, flushInput, movePointer, pointerAt } from "./common";

/**
 * Mini-jeu « Des détails à la loupe » (case 4, `MDF/24`, segment `207c` : une seule fonction, `207c:000c`).
 * Règles, adresses et niveaux de confiance : `docs/asterix/minigames/m24.md`.
 *
 * Une image est montrée quelques secondes, puis 4 à 6 rectangles en sont découpés : les morceaux passent, mélangés,
 * dans la colonne de droite, et un aplat les remplace dans l'image. Un cadre clignotant désigne un morceau : le joueur
 * clique le trou d'où il vient. Tous les morceaux replacés sauf le dernier, il gagne 1 sesterce ; un mauvais trou ou le
 * temps écoulé, il perd.
 */
export const MODULE = 24;

/** Images `M24DA000.mcg` à `007` (`rnd() & 7`). */
export const PICTURES = 8;
/** Morceaux : `4 + niveau Réflexion`. */
export const BASE_PIECES = 4;
/** Image entière montrée `5 − niveau` secondes (`1a93:01c3`), un clic l'abrège. */
export const SHOW_SECONDS = 5;
/** Temps de jeu : `40 − 5 × niveau` secondes (chrono 2). */
export const TIME_LIMIT = 0x28;
export const TIME_PER_LEVEL = 5;
/** Sesterces gagnés (`1d24:0912(joueur, 1, 1)`). */
export const GAIN = 1;

/** Taille d'un morceau (`2bac:0004(…, 0x28, 0x1e)`), et décalage (32, 40) des coordonnées tirées. */
export const PIECE_WIDTH = 0x28;
export const PIECE_HEIGHT = 0x1e;
const ORIGIN_X = 0x20;
const ORIGIN_Y = 0x28;
/** Deux morceaux sont refusés à moins de 42 pixels en x **et** 32 en y l'un de l'autre. */
const MIN_GAP_X = 0x2a;
const MIN_GAP_Y = 0x20;
/** Colonne de droite : une case de 42 × 32 tous les 33 pixels à partir de (276, 2) ; le morceau y est posé en (277, 3). */
const COLUMN_X = 0x114;
const SLOT_PITCH = 0x21;
const SLOT_WIDTH = 0x2a;
const SLOT_HEIGHT = 0x20;
/** Couleurs de l'image : cadres sombre et clair, aplat des trous. */
const DARK = 0x7e;
const LIGHT = 0x7f;
/** Le cadre du morceau demandé est tracé quand l'horloge en centièmes a ce bit (`1a93:01ab(0x10)`) : 16 cs sur 32. */
const BLINK_MASK = 0x10;

/** Clé du dossier de voix `MDF/24` (`DS:6412 = 0`, `DS:6410 = 1`). */
const VOICE_KEY = 100;
/** Voix `K24TE` : mauvais trou `personnage + 6 × (rnd() % 3)`, gagné `personnage + 18 + 6 × (rnd() & 1)`. */
const WIN_VOICE = 0x12;
const VOICE_STEP = 6;
/** Temps écoulé : `K63TE02`, dossier de Panoramix (`DS:6412 = 7`, `DS:6410 = 6`). */
const TIMEOUT_VOICE = 1;

// --- Le mini-jeu ----------------------------------------------------------------------------------

export interface LoupePiece {
  /** Coordonnées tirées (`[BP − 0x26]`, `[BP − 0x24]`) : le trou est en `(x − 32, y − 40)` à l'écran. */
  x: number;
  y: number;
  /** `[BP − 0x32]` : case de la colonne de droite où le morceau est montré. */
  slot: number;
  /** `[BP − 0xc]` : replacé. */
  found: boolean;
}

/** État du mini-jeu (variables locales de `207c:000c`), exposé aux robots par `rt.hint.state`. */
export interface LoupeState {
  /** Numéro de l'image. */
  picture: number;
  pieces: LoupePiece[];
  /** `[BP − 6]` : indice du morceau demandé (cadre clignotant). */
  target: number;
  /** `[BP − 4]` : morceaux replacés ; gagné à `pieces.length − 1`. */
  found: number;
  /** `[BP − 0xd]` : un mauvais trou a été cliqué. */
  wrong: boolean;
  /** Indice du trou sous le pointeur à la dernière image, −1 hors de tout trou. */
  hover: number;
  /** Secondes de mémorisation et de jeu du niveau. */
  showSeconds: number;
  limit: number;
}

/** Rectangle à l'écran du trou d'un morceau (bords compris) : le pointeur y « est » d'après le test de `207c:03c0`. */
export function holeZone(piece: LoupePiece): Zone {
  const x1 = piece.x - ORIGIN_X;
  const y1 = piece.y - ORIGIN_Y;
  return { x1, y1, x2: x1 + PIECE_WIDTH - 1, y2: y1 + PIECE_HEIGHT - 1 };
}

/** Rectangle à l'écran du morceau dans la colonne de droite. */
export function slotZone(piece: LoupePiece): Zone {
  const x1 = COLUMN_X + 1;
  const y1 = piece.slot * SLOT_PITCH + 3;
  return { x1, y1, x2: x1 + PIECE_WIDTH - 1, y2: y1 + PIECE_HEIGHT - 1 };
}

/** `207c:000c`. */
export function* loupe(play: Play): Script {
  const { rt, board } = play;
  const { surface, resources, palette, voice } = rt.ctx;
  const player = board.player;
  const count = player.reflexion + BASE_PIECES;

  // Tirage « différent de la dernière fois » (`DS:2a00`, mémoire de séance : décision D13)… qui ne sert qu'à consommer
  // des tirages : l'image chargée plus bas vient d'un tirage suivant.
  let draw: number;
  do draw = rt.rnd() & 7;
  while (draw === rt.session.lastLoupeDraw);
  rt.session.lastLoupeDraw = draw;
  const [goodSound, wrongSound] = yield* rt.load(Promise.all([resources.sound("b24-03a.voc"), resources.sound("b24-01a.voc")]));

  // Image chargée dans le tampon sous un écran noir ; la case vide du haut de la colonne est recopiée pour les
  // morceaux au-delà du quatrième (l'image n'en dessine que quatre).
  yield* rt.fadeOut(16);
  const picture = rt.rnd() & 7;
  rt.draw(yield* rt.load(resources.picture(`M24DA00${picture}.mcg`)), 4);
  for (let slot = BASE_PIECES; slot < count; slot++) rt.copyRect(surface.work, COLUMN_X, 2, COLUMN_X, slot * SLOT_PITCH + 2, SLOT_WIDTH, SLOT_HEIGHT);
  yield* rt.fadeIn(16);
  rt.commit();

  const s: LoupeState = {
    picture,
    pieces: [],
    target: 0,
    found: 0,
    wrong: false,
    hover: -1,
    showSeconds: SHOW_SECONDS - player.reflexion,
    limit: TIME_LIMIT - TIME_PER_LEVEL * player.reflexion,
  };
  // Un morceau par bande verticale de `200 / n` pixels, à une hauteur quelconque, sans chevauchement ; puis sa case.
  const band = Math.trunc(200 / count);
  for (let i = 0; i < count; i++) {
    let x: number;
    let y: number;
    do {
      x = (rt.rnd() % (band - 5)) + i * band + 0x2a;
      y = (rt.rnd() % 0x96) + 0x32;
    } while (s.pieces.some((other) => other.x - MIN_GAP_X < x && x < other.x + MIN_GAP_X && other.y - MIN_GAP_Y < y && y < other.y + MIN_GAP_Y));
    let slot: number;
    do slot = rt.rnd() % count;
    while (s.pieces.some((other) => other.slot === slot));
    s.pieces.push({ x, y, slot, found: false });
    if (slot === 0) s.target = i;
  }

  yield* rt.music("m24m.voc");
  yield* rt.waitClick(s.showSeconds);
  yield* rt.waitRelease();
  yield* flushInput(rt);
  palette.setColor(0xff, ...ARROW_RGB);
  const arrow = arrowCursor(rt);
  rt.startChrono(2);

  beginPlay(rt, MODULE, s, false);
  for (;;) {
    movePointer(rt);
    const clicked = rt.click() !== null;
    const pointer = pointerAt(rt);
    rt.restore();
    arrow.forget();
    s.hover = -1;
    s.pieces.forEach((piece, i) => {
      if (piece.found) return;
      const hole = holeZone(piece);
      const shown = slotZone(piece);
      rt.copyRect(surface.work, hole.x1, hole.y1, shown.x1, shown.y1, PIECE_WIDTH, PIECE_HEIGHT);
      rt.fill(hole.x1, hole.y1, hole.x2, hole.y2, LIGHT);
      if (pointer.x < hole.x1 || pointer.x > hole.x2 || pointer.y < hole.y1 || pointer.y > hole.y2) return;
      frameHole(rt, piece);
      s.hover = i;
    });
    if (rt.cs & BLINK_MASK) {
      const top = s.pieces[s.target].slot * SLOT_PITCH;
      rt.frame(COLUMN_X - 1, top + 1, 0x13e, top + 0x22, DARK);
    }
    arrow.draw(pointer.x, pointer.y);
    if (clicked) {
      if (s.hover === s.target) {
        rt.effect(goodSound);
        s.pieces[s.target].found = true;
        s.found++;
        // Morceau suivant : le premier de la colonne, de haut en bas, qui reste à replacer.
        for (let slot = 0; slot < count; slot++) {
          const index = s.pieces.findIndex((piece) => piece.slot === slot);
          if (s.pieces[index].found) continue;
          s.target = index;
          break;
        }
      } else if (s.hover !== -1) {
        s.wrong = true;
        rt.effect(wrongSound);
      }
      yield* rt.waitRelease();
    }
    if (s.wrong || s.found >= count - 1 || rt.chrono(2) >= s.limit) break;
    yield;
  }
  endPlay(rt);

  const won = s.found >= count - 1;
  yield* rt.waitRelease();
  arrow.erase();
  if (won) yield* rt.wait(0x1e);
  // L'image entière revient, les trous restants seulement encadrés.
  rt.restore();
  for (const piece of s.pieces) if (!piece.found) frameHole(rt, piece);
  while (voice.effectPlaying) yield;
  yield* rt.wait(0x19);
  yield* fadeSoundOut(rt);
  yield* rt.wait(0x19);
  if (won) {
    rt.restore();
    yield* changeSesterces(rt, player, GAIN, true);
    yield* rt.voice(player.character + WIN_VOICE + (rt.rnd() & 1) * VOICE_STEP, VOICE_KEY);
  } else if (s.wrong) {
    yield* rt.voice(player.character + (rt.rnd() % 3) * VOICE_STEP, VOICE_KEY);
  } else {
    yield* rt.voice(TIMEOUT_VOICE, VOICES.panoramix);
  }
  yield* rt.cleanup();
}

/** Double cadre d'un trou : sombre autour de l'aplat, clair décalé d'un pixel en haut à gauche (`207c:042e`, `0639`). */
function frameHole(rt: Runtime, piece: LoupePiece): void {
  rt.frame(piece.x - 0x21, piece.y - 0x29, piece.x + 9, piece.y - 9, DARK);
  rt.frame(piece.x - 0x22, piece.y - 0x2a, piece.x + 8, piece.y - 10, LIGHT);
}
