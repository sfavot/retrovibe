import { SCREEN_WIDTH } from "../../../../engine/infogrames/data/mcg";
import type { Play } from "../game";
import type { Script } from "../runtime";
import { changeSesterces } from "../squares";
import { ARROW_RGB, arrowCursor, beginPlay, centrePointer, endPlay, fadeSoundOut, flushInput, movePointer, pointerClick, waitFrame, type PointerClick } from "./common";

/**
 * Mini-jeu « Coloriages » (case 27, `MDF/35`, segment `1fe6` : `1fe6:0043` et `1fe6:000c`).
 * Règles, adresses et niveaux de confiance : `docs/asterix/minigames/m35.md`.
 *
 * Un dessin en couleurs est montré quelques secondes, puis ses zones blanchissent. Le joueur choisit une couleur dans la
 * colonne de droite et clique une zone : la bonne couleur la repeint, une mauvaise fait perdre. Tout repeint avant la
 * fin du temps : 1 sesterce.
 */
export const MODULE = 35;

/** Sesterces gagnés (`1d24:0912(joueur, 1, 1)`). */
export const GAIN = 1;

/** Dessins dans l'ordre de la table de saut `1fe6:0954` (`rnd() & 3 + 4 × niveau`) : fichier et nombre de couleurs proposées. */
export const PICTURES = [
  { file: "M35DA002.MCC", colors: 5 },
  { file: "M35DA006.MCC", colors: 5 },
  { file: "M35DA007.MCC", colors: 5 },
  { file: "M35DA010.MCC", colors: 5 },
  { file: "M35DA000.MCC", colors: 6 },
  { file: "M35DA001.MCC", colors: 6 },
  { file: "M35DA003.MCC", colors: 6 },
  { file: "M35DA005.MCC", colors: 6 },
  { file: "M35DA004.MCC", colors: 7 },
  { file: "M35DA008.MCC", colors: 7 },
  { file: "M35DA009.MCC", colors: 7 },
  { file: "M35DA011.MCC", colors: 6 },
] as const;

/** Couleurs de palette des zones à colorier : 0x60 à 0x6e. La couleur attendue de la zone `c` est la couleur `c + 16`. */
export const ZONE_FIRST = 0x60;
export const ZONE_END = 0x6f;
export const TARGET_SHIFT = 16;
/** Couleur dont le rouge sert de blanc aux zones effacées (`DS:58eb`), et couleur du cadre de sélection. */
const BLANK_COLOR = 0x7f;

/** Colonne des couleurs : le dessin s'arrête à x = 250 (`x + 0x20 < 0x11a`), une pastille tous les 25 pixels. */
export const PALETTE_X = 250;
export const SWATCH_STEP = 25;
/** Cadre de la pastille choisie et pixel où sa couleur est lue (`1fe6:000c(0x129, 25 × n + 0x29)`). */
export const SWATCH_X1 = 0x109;
export const SWATCH_X2 = 0x133;

/** Secondes pendant lesquelles le modèle reste visible (`1a93:01c3(8 − 2 × niveau)`). */
export function viewSeconds(level: number): number {
  return 8 - 2 * level;
}

/** Durée de l'épreuve en secondes (chrono 2) : `0x55 − 0x14 × niveau`. */
export function timeLimit(level: number): number {
  return 0x55 - 0x14 * level;
}

/** Une image de la boucle : `1831:030a(12)`, soit cinq clics par seconde au plus. */
export const FRAME_TICKS = 12;
/** Mauvaise couleur : trente palettes au hasard, puis 20 cs sur la couleur posée. */
const FLASHES = 30;
/** Pas du pointeur au clavier pendant le jeu (`DS:4048 = 1` : 2 pixels par tick). */
const KEY_POINTER_SHIFT = 1;

/** Clé du dossier de voix `MDF/35` (`DS:6412 = 0x45`, `DS:6410 = 1`). */
const VOICE_KEY = 169;

/** État du mini-jeu (variables locales de `1fe6:0043`), exposé aux robots par `rt.hint.state`. */
export interface ColoriagesState {
  /** Rang du dessin dans `PICTURES`. */
  picture: number;
  /** `[BP − 2]` : nombre de couleurs proposées. */
  count: number;
  /** `DI` : couleur choisie, 0 en haut. */
  selected: number;
  /** `[BP − 6]` : zones à colorier. */
  toPaint: number;
  /** `[BP − 4]` : zones coloriées. */
  painted: number;
  /** `[BP − 0xd]` : composante du blanc des zones effacées. */
  blank: number;
  /** `DS:610c` : le dessin sans cadre ni curseur, où le jeu lit la couleur sous le pointeur. */
  pixels: Uint8Array;
  /** Durée de l'épreuve en secondes. */
  limit: number;
  /** `[BP − 0xb]` et `[BP − 0xc]`. */
  won: boolean;
  lost: boolean;
}

/** `1fe6:0043`. */
export function* coloriages(play: Play): Script {
  const { rt, board } = play;
  const { surface, palette, resources, input, voice } = rt.ctx;
  const { colors } = palette;
  const player = board.player;
  const level = player.reflexion;
  rt.voiceKey = VOICE_KEY;

  // `DS:6ad8` : dernier dessin tiré à chaque niveau, jamais remis à zéro entre deux parties (décision D13). À zéro au
  // départ : le premier dessin d'un niveau n'est donc jamais le premier de son groupe.
  const memory = rt.session.lastColouring;
  let drawn: number;
  do drawn = rt.rnd() & 3;
  while (memory[level] === drawn);
  memory[level] = drawn;
  const picture = drawn + 4 * level;
  yield* rt.picture(PICTURES[picture].file, 1);
  const [selectSound, rightSound, wrongSound] = yield* rt.load(
    Promise.all([resources.sound("b35-01b.voc"), resources.sound("b24-03a.voc"), resources.sound("m35b0000.voc")]),
  );
  const arrow = arrowCursor(rt);
  yield* rt.music("m35m.voc");
  rt.commit();

  // Le modèle à mémoriser, puis ses zones passent au blanc.
  yield* rt.waitClick(viewSeconds(level));
  yield* rt.waitRelease();
  const s: ColoriagesState = {
    picture,
    count: PICTURES[picture].colors,
    selected: 0,
    toPaint: 0,
    painted: 0,
    blank: colors[BLANK_COLOR * 3],
    pixels: surface.work.slice(),
    limit: timeLimit(level),
    won: false,
    lost: false,
  };
  const isBlank = (color: number): boolean => colors[color * 3] === s.blank && colors[color * 3 + 1] === s.blank && colors[color * 3 + 2] === s.blank;
  const sameColor = (a: number, b: number): boolean => colors[a * 3] === colors[b * 3] && colors[a * 3 + 1] === colors[b * 3 + 1] && colors[a * 3 + 2] === colors[b * 3 + 2];
  for (let color = ZONE_FIRST; color < ZONE_END; color++) {
    if (isBlank(color)) continue;
    s.toPaint++;
    palette.setColor(color, s.blank, s.blank, s.blank);
  }
  rt.commit();
  yield* flushInput(rt);
  rt.startChrono(2);

  /** `1fe6:000c(x + 0x20, y + 0x28)` : couleur du dessin en (x, y) ; hors du tampon, l'original lit la mémoire voisine. */
  const pixelAt = (x: number, y: number): number => s.pixels[y * SCREEN_WIDTH + x] ?? 0;
  /** Solution : chaque zone reprend sa couleur attendue. */
  const reveal = (): void => {
    for (let color = ZONE_FIRST; color < ZONE_END; color++) rt.copyColor(color, color + TARGET_SHIFT);
  };
  /** Fond, cadre de la couleur choisie (couleurs 0x7f et 1), puis le curseur logiciel `153c:05b4`. */
  const redraw = (cursor: boolean): void => {
    rt.restore();
    const top = s.selected * SWATCH_STEP;
    rt.frame(SWATCH_X1, top + 1, SWATCH_X2, top + 0x17, BLANK_COLOR);
    rt.frame(SWATCH_X1 + 1, top + 2, SWATCH_X2 - 1, top + 0x16, 1);
    if (cursor) arrow.drawAtPointer();
  };

  /** Clic gauche ou droit de ce tick, retenu avec sa position jusqu'à la prochaine lecture de la boucle. */
  let pending: PointerClick | null = null;
  const pointer = (): void => {
    movePointer(rt);
    pending = pointerClick(rt) ?? pending;
    redraw(true);
  };
  const takeClick = (): PointerClick | null => {
    const click = pending;
    pending = null;
    return click;
  };

  /** Clic gauche sur le dessin : la couleur choisie est essayée sur les neuf pixels autour du pointeur. */
  function* paintAt(x: number, y: number): Script {
    const paint = pixelAt(SWATCH_X1, s.selected * SWATCH_STEP + 1);
    let candidates = 0;
    let last = 0;
    for (let i = 0; i < 9; i++) {
      const zone = pixelAt(x - 1 + (i % 3), y - 1 + Math.floor(i / 3));
      if (zone < ZONE_FIRST || zone >= ZONE_END || !isBlank(zone)) continue;
      if (sameColor(zone + TARGET_SHIFT, paint)) {
        rt.effect(rightSound);
        rt.copyColor(zone, paint);
        s.painted++;
        if (s.painted === s.toPaint) s.won = true;
        return;
      }
      candidates++;
      last = zone;
    }
    if (candidates === 0) return;
    // Mauvaise couleur : la zone clignote de couleurs au hasard, garde la couleur posée 20 cs, puis la solution s'affiche.
    rt.effect(wrongSound);
    s.lost = true;
    for (let i = 0; i < FLASHES; i++) {
      yield;
      const red = rt.rnd() & 0x7f;
      const green = rt.rnd() & 0x7f;
      palette.setColor(last, red, green, rt.rnd() & 0x7f);
    }
    rt.copyColor(last, paint);
    yield* rt.wait(20);
    reveal();
  }

  palette.setColor(0xff, ...ARROW_RGB);
  centrePointer(rt);
  redraw(true);
  const keyPointerShift = input.keyPointerShift;
  input.keyPointerShift = KEY_POINTER_SHIFT;
  beginPlay(rt, MODULE, s);
  do {
    let click = takeClick();
    while (click === null && rt.chrono(2) < s.limit) {
      yield;
      pointer();
      click = takeClick();
    }
    if (click?.button === 2) {
      rt.effect(selectSound);
      s.selected = (s.selected + 1) % s.count;
    } else if (click?.button === 1) {
      if (click.x < PALETTE_X) yield* paintAt(click.x, click.y);
      else {
        rt.effect(selectSound);
        s.selected = Math.min(Math.floor(click.y / SWATCH_STEP), s.count - 1);
      }
    }
    redraw(true);
    yield* waitFrame(FRAME_TICKS, pointer);
  } while (!s.lost && !s.won && rt.chrono(2) < s.limit);
  endPlay(rt);
  input.keyPointerShift = keyPointerShift;
  redraw(false);

  while (voice.effectPlaying) yield;
  yield* rt.wait(25);
  yield* fadeSoundOut(rt);
  yield* rt.wait(25);
  if (s.won) {
    yield* changeSesterces(rt, player, GAIN, true);
    yield* rt.voice(player.character + 4);
  } else if (s.lost) {
    reveal();
    yield* rt.voice(rt.rnd() & 1);
  } else {
    yield* rt.voice((rt.rnd() & 1) + 2);
  }
  yield* rt.cleanup();
}
