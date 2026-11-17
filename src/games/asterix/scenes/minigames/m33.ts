import type { Play } from "../game";
import { DOWN, LEFT, RIGHT, UP, type Click, type Script, type Zone } from "../runtime";
import { changeSesterces } from "../squares";
import { beginPlay, endPlay, fadeSoundOut, flushInput, restoreRects, waitReading, type Rect } from "./common";

/**
 * Mini-jeu « Les hiéroglyphes de Cléopâtre » (case 44, `MDF/33`, segment `2353` : la seule fonction `2353:0005`).
 * Règles, adresses et niveaux de confiance : `docs/asterix/minigames/m33.md`.
 *
 * Un Mastermind à trois colonnes : le joueur compose trois hiéroglyphes et valide ; chaque colonne répond « bien placé »,
 * « mal placé » ou « absent ». Sept essais et un temps limité pour trouver la combinaison ; moins il faut d'essais, plus
 * le gain est grand (3, 2 ou 1 sesterce).
 */
export const MODULE = 33;

/** Colonnes de la combinaison. */
export const COLUMNS = 3;
/** Essais permis (`2353:0487`). */
export const MAX_TRIES = 7;
/** Hiéroglyphes proposés : `6 + 2 × niveau Réflexion` (6, 8 ou 10). */
export const symbolCount = (reflexion: number): number => reflexion * 2 + 6;
/** Temps accordé en secondes (chrono 2) : `0x46 − 10 × niveau Réflexion` (70, 60 ou 50). */
export const timeLimit = (reflexion: number): number => 0x46 - reflexion * 10;
/** Sesterces gagnés selon le nombre d'essais : moins de 3, moins de 5, sinon (`2353:06ba`). */
export const gainFor = (tries: number): number => (tries < 3 ? 3 : tries < 5 ? 2 : 1);

/** Réponse d'une colonne (`BP−0x1a`) : absent, bien placé, mal placé. */
export const ABSENT = 0;
export const PLACED = 1;
export const MISPLACED = 2;

/** Sprites de `m33s.hy8` : trois jeux de dix hiéroglyphes (mal placé, bien placé, neutre), puis les deux flèches enfoncées. */
const SPRITES_MISPLACED = 0;
const SPRITES_PLACED = 0xa;
const SPRITES_NEUTRAL = 0x14;
const SPRITE_ARROW_UP = 0x1e;
const SPRITE_ARROW_DOWN = 0x1f;

/** Colonne des hiéroglyphes proposés, à droite : sprite `k` en (251, 16 + 20 k), ancre en bas à gauche. */
const PALETTE_X = 0xfb;
const PALETTE_Y = 0x10;
const PALETTE_STEP = 0x14;
/** Combinaison en cours : colonne `c` en (100 + 35 c, 187). */
const GUESS_X = 0x64;
const GUESS_Y = 0xbb;
const GUESS_STEP = 0x23;
/** Flèches enfoncées de la colonne `c` : en (114 + 33 c, 168) et (114 + 33 c, 191). */
const ARROW_X = 0x72;
const ARROW_STEP = 0x21;
const ARROW_UP_Y = 0xa8;
const ARROW_DOWN_Y = 0xbf;
/** Réponse de l'essai `n` (à partir de 1) : ligne `0xc4 − 20 (n − 1) − 0x28`, de 156 (premier) à 36 (septième). */
const ANSWER_Y = 0xc4 - 0x28;
const ANSWER_STEP = 0x14;
/** Couleur des deux cadres du curseur. */
const CURSOR_COLOR = 0x7e;

/** Zones restaurées à chaque tour de boucle : la colonne de droite et le bas du panneau (combinaison et flèches). */
const PALETTE_RECT: Rect = [0xfa, 0, 0x11e, 0xc7];
const GUESS_RECT: Rect = [0x62, 0x9d, 0xcd, 0xc7];
/** Zone restaurée pendant le clignotement de la solution. */
const REVEAL_RECT: Rect = [0x5e, 0xab, 0xd2, 0xbc];
/** La solution clignote neuf fois, 30 cs par image. */
const REVEAL_BLINKS = 9;
const REVEAL_CS = 0x1e;
/** Attente après un déplacement (`1a93:013d(0x1e)`) : c'est aussi la cadence de répétition d'une flèche tenue. */
const MOVE_CS = 0x1e;
/** Attente après chaque réponse (`1a93:0101(0x32)`). */
const ANSWER_CS = 0x32;

/** `2353:03b1` : réponse de chaque colonne pour une proposition. */
export function answer(secret: readonly number[], guess: readonly number[]): number[] {
  const used = secret.map((symbol, i) => symbol === guess[i]);
  const result: number[] = used.map((placed) => (placed ? PLACED : ABSENT));
  for (let i = 0; i < COLUMNS; i++) {
    if (secret[i] === guess[i]) continue;
    for (let j = 0; j < COLUMNS; j++) {
      if (j !== i && !used[j] && secret[j] === guess[i]) {
        used[j] = true;
        result[i] = MISPLACED;
        break;
      }
    }
  }
  return result;
}

/**
 * Zones cliquables (décision D11), dans l'ordre : les hiéroglyphes proposés, les colonnes, les flèches du haut, celles du
 * bas. Les zones des hiéroglyphes se touchent (20 lignes chacune) : un clic entre deux cartouches ne valide pas.
 */
export function paletteZone(symbol: number): Zone {
  const y = symbol * PALETTE_STEP;
  return { x1: 0xf4, y1: y - 1, x2: 0x123, y2: y + PALETTE_STEP - 2 };
}
export function columnZone(column: number): Zone {
  const x = column * GUESS_STEP;
  return { x1: x + 0x63, y1: 0xac, x2: x + 0x86, y2: GUESS_Y };
}
export function arrowZone(column: number, up: boolean): Zone {
  const x = column * ARROW_STEP + ARROW_X;
  return up ? { x1: x - 8, y1: ARROW_UP_Y - 10, x2: x + 24, y2: ARROW_UP_Y + 3 } : { x1: x - 8, y1: ARROW_DOWN_Y - 3, x2: x + 24, y2: 199 };
}

/** État du mini-jeu (locales de `2353:0005`), exposé aux robots par `rt.hint.state`. */
export interface HieroglyphesState {
  /** `BP−2` : nombre de hiéroglyphes proposés. */
  symbols: number;
  /** `BP−0xe` : la combinaison à trouver. */
  secret: number[];
  /** `BP−0x14` : la combinaison en cours. */
  guess: number[];
  /** `BP−8` : colonne du curseur. */
  column: number;
  /** `BP−4` : hiéroglyphe du curseur (celui de la colonne courante). */
  cursor: number;
  /** `BP−6` : essais validés. */
  tries: number;
  /** `BP−0x1a` : réponses du dernier essai. */
  answers: number[];
  /** Temps accordé en secondes. */
  limit: number;
  /** `BP−0x1f` et `BP−0x20` : trouvé, ou sept essais épuisés. */
  won: boolean;
  lost: boolean;
}

/** `2353:0005`. */
export function* hieroglyphes(play: Play): Script {
  const { rt, board } = play;
  const { surface, resources, voice } = rt.ctx;
  const player = board.player;
  const [moveSound, columnSound, absentSound, placedSound, misplacedSound, sheet] = yield* rt.load(
    Promise.all([
      resources.sound("b33-01a.voc"),
      resources.sound("b33-02a.voc"),
      resources.sound("b33-03a.voc"),
      resources.sound("b33-05a.voc"),
      resources.sound("b33-10a.voc"),
      resources.hy8("m33s.hy8"),
    ]),
  );
  const answerSounds = [absentSound, placedSound, misplacedSound];
  yield* rt.picture("m33da000.mcc", 1);
  yield* rt.music("m33m.voc");

  const s: HieroglyphesState = {
    symbols: symbolCount(player.reflexion),
    secret: [],
    guess: [],
    column: 0,
    cursor: 0,
    tries: 0,
    answers: [ABSENT, ABSENT, ABSENT],
    limit: timeLimit(player.reflexion),
    won: false,
    lost: false,
  };
  for (let k = 0; k < s.symbols; k++) rt.sprite(sheet, k + SPRITES_NEUTRAL, PALETTE_X, k * PALETTE_STEP + PALETTE_Y);
  rt.commit();
  // Tirage de la combinaison ; au niveau 0, une colonne qui répète une précédente est retirée.
  for (let i = 0; i < COLUMNS; i++) {
    s.secret[i] = rt.rnd() % s.symbols;
    s.guess[i] = 0;
    if (player.reflexion === 0 && s.secret.indexOf(s.secret[i]) < i) i--;
  }
  yield* flushInput(rt);
  rt.startChrono(2);

  const zones: Zone[] = [];
  for (let k = 0; k < s.symbols; k++) zones.push(paletteZone(k));
  for (let c = 0; c < COLUMNS; c++) zones.push(columnZone(c));
  for (let c = 0; c < COLUMNS; c++) zones.push(arrowZone(c, true));
  for (let c = 0; c < COLUMNS; c++) zones.push(arrowZone(c, false));
  const firstColumn = s.symbols;
  const firstUp = firstColumn + COLUMNS;
  const firstDown = firstUp + COLUMNS;
  /** Clic sur une zone, ou validation : Espace, ou un clic hors de toute zone (l'original valide au clic gauche, où qu'il soit). */
  const readClick = (): Click => rt.click(zones, true);
  /** Clic arrivé pendant une attente : l'original relit le bouton tenu, un clic bref y serait perdu. */
  let queued: Click = null;

  const stepUp = (): void => {
    if (--s.cursor < 0) s.cursor = s.symbols - 1;
    s.guess[s.column] = s.cursor;
    rt.sprite(sheet, SPRITE_ARROW_UP, s.column * ARROW_STEP + ARROW_X, ARROW_UP_Y);
    rt.effect(moveSound);
  };
  const stepDown = (): void => {
    if (++s.cursor === s.symbols) s.cursor = 0;
    s.guess[s.column] = s.cursor;
    rt.sprite(sheet, SPRITE_ARROW_DOWN, s.column * ARROW_STEP + ARROW_X, ARROW_DOWN_Y);
    rt.effect(moveSound);
  };
  const toColumn = (column: number): void => {
    s.column = column;
    s.cursor = s.guess[column];
  };

  beginPlay(rt, MODULE, s, false);
  let moved = false;
  let answered = false;
  for (;;) {
    const directions = rt.dirs();
    const click = queued ?? readClick();
    queued = null;
    restoreRects(rt, PALETTE_RECT, GUESS_RECT);
    if (directions & UP) {
      stepUp();
      moved = true;
    }
    if (directions & DOWN) {
      stepDown();
      moved = true;
    }
    if (directions & LEFT && s.column > 0 && !moved) {
      toColumn(s.column - 1);
      moved = true;
      rt.effect(columnSound);
    }
    if (directions & RIGHT && s.column < COLUMNS - 1 && !moved) {
      toColumn(s.column + 1);
      moved = true;
      rt.effect(columnSound);
    }
    // Clic ou toucher direct (D11) : un hiéroglyphe proposé, une colonne, ou une flèche d'une colonne.
    if (typeof click === "number" && !moved) {
      if (click < firstColumn) {
        if (click !== s.cursor) {
          s.cursor = click;
          s.guess[s.column] = click;
          rt.effect(moveSound);
          moved = true;
        }
      } else if (click < firstUp) {
        if (click - firstColumn !== s.column) {
          toColumn(click - firstColumn);
          rt.effect(columnSound);
          moved = true;
        }
      } else {
        const up = click < firstDown;
        toColumn(click - (up ? firstUp : firstDown));
        if (up) stepUp();
        else stepDown();
        moved = true;
      }
    }
    for (let i = 0; i < COLUMNS; i++) rt.sprite(sheet, s.guess[i] + SPRITES_NEUTRAL, i * GUESS_STEP + GUESS_X, GUESS_Y);
    if (click === "current" && !moved) {
      s.answers = answer(s.secret, s.guess);
      s.tries++;
      if (s.answers.every((result) => result === PLACED)) s.won = true;
      else if (s.tries === MAX_TRIES) s.lost = true;
      yield* rt.waitRelease();
      answered = true;
    }
    rt.frame(0xfa, s.cursor * PALETTE_STEP + 1, 0x11d, s.cursor * PALETTE_STEP + PALETTE_Y, CURSOR_COLOR);
    rt.frame(s.column * GUESS_STEP + 0x63, 0xac, s.column * GUESS_STEP + 0x86, GUESS_Y, CURSOR_COLOR);
    if (answered) {
      answered = false;
      // Les trois réponses, une par une : son, hiéroglyphe coloré sur la ligne de l'essai, 50 cs.
      for (let i = 0; i < COLUMNS; i++) {
        rt.effect(answerSounds[s.answers[i]]);
        const set = s.answers[i] === PLACED ? SPRITES_PLACED : s.answers[i] === MISPLACED ? SPRITES_MISPLACED : SPRITES_NEUTRAL;
        rt.sprite(sheet, set + s.guess[i], i * GUESS_STEP + GUESS_X, ANSWER_Y - (s.tries - 1) * ANSWER_STEP);
        queued = yield* waitReading(rt, ANSWER_CS, readClick, queued);
      }
      // Une validation donnée pendant les réponses ne vaut pas pour l'essai suivant.
      if (queued === "current") queued = null;
    }
    if (moved) {
      queued = yield* waitReading(rt, MOVE_CS, readClick, queued);
      moved = false;
    }
    if (s.won || s.lost || rt.chrono(2) >= s.limit) break;
    yield;
  }
  endPlay(rt);

  while (voice.effectPlaying) yield;
  yield* fadeSoundOut(rt);
  if (s.won) {
    // L'écran devient le fond, sous la vidéo `M33AC` en surimpression (`15d7:06eb(0x21, 2, 0, 0x5000)`).
    surface.commitBackground();
    yield* rt.cleanup();
    yield* rt.overlayVideo(MODULE, 2);
    yield* changeSesterces(rt, player, gainFor(s.tries), true);
  } else {
    // Perdu (sept essais ou temps écoulé) : la solution clignote dans la ligne du bas.
    for (let blink = 0; blink < REVEAL_BLINKS; blink++) {
      restoreRects(rt, REVEAL_RECT);
      const set = blink % 2 ? SPRITES_NEUTRAL : SPRITES_PLACED;
      for (let i = 0; i < COLUMNS; i++) rt.sprite(sheet, s.secret[i] + set, i * GUESS_STEP + GUESS_X, GUESS_Y);
      yield* rt.wait(REVEAL_CS);
    }
    surface.commitBackground();
    yield* rt.cleanup();
    // L'enveloppe de surimpression faite à la main : écran décalé dans les couleurs 128..255, puis `m33ab.mux` (`0x3c88`).
    rt.shiftUp();
    rt.commit();
    yield* rt.video("m33ab.mux", { overlay: true });
  }
}
