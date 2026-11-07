import type { DrasculaEngine } from "../../loop";
import { Plane } from "../../../render/plane";
import type { DrasculaRenderer, RoomPainter } from "../../../render/renderer";
import { type Sequence, pause } from "../../sequence";
import { roomObject } from "../../room-kit";
import { Track, Verb } from "../../state";
import { Flag, Gate, Item, Speech, VAMPIRE_CONVERSATION } from "./ids";

/**
 * Pièce 13, le vampire du chapitre 3. Réécriture de `room_13`, `update_13` (rooms.cpp, ScummVM), de `animation_6_3` (le vampire se
 * réveille) et `animation_2_3` (le héros le tue, ce qui finit le chapitre) (animation.cpp). La pièce 20 n'a ni `room_20` ni `update_20` :
 * son seul rectangle d'avant-plan est dans `roomUpdates` de `drascula.dat`, appliqué par le moteur.
 *
 * Écarts à ScummVM :
 * - **le réveil** (`update_13` appelle `animation_6_3` dès que `curX > 55`, pendant n'importe quel `updateRoom`, marche comprise) :
 *   un painter ne lance pas de séquence. `tickGate` arrête le héros qui marche dès qu'il passe cette abscisse (`_characterMoved = false`
 *   de l'animation) ; la séquence est jouée par `frame` (héros arrêté dans la boucle principale) ou par `checkAction` (une action sur un
 *   objet commencée par une marche : l'animation passe avant la réplique, comme dans l'original où elle a lieu pendant la marche) ;
 * - **les rectangles de `updateAnim` et d'`animation_6_3`** (`updateScreen` d'un rectangle seulement : le reste de l'écran garde son
 *   dernier dessin) sont des « cadres » de `GameState.anim`, dessinés par le painter par-dessus la pièce recomposée : le décor du
 *   rectangle, puis l'image de la feuille. Le cadre du vampire disparaît au rafraîchissement qui suit (`updateScreen(120, ...)`), celui du
 *   héros garde sa partie à gauche de x = 120 jusqu'à la fin. Un cadre est une **copie des pixels** de la feuille au moment où il est
 *   posé (`freezeFrame`) : dans ScummVM les pixels du héros restent dans l'écran quand les animations suivantes rechargent
 *   `front`, `extra` et `back` avec les feuilles du vampire ; relire la feuille à chaque image dessinerait le héros avec elles ;
 * - l'image fixe du héros (`updateRoom` : `draw3` en (113, 54), 77 x 89, dont les bords ont des traits de découpe) n'atteint l'écran de
 *   l'original que dans la partie rafraîchie, x >= 120, après la mort du vampire : `anim.poseFrom` la rogne de la même façon ;
 * - `animation_6_3` charge sa feuille (`an4y.alg`) dans `draw2` (libre au chapitre 3) et non dans `front` : la pièce est recomposée à chaque
 *   image et dessinerait le héros de face avec la mauvaise feuille. `front` reçoit quand même `96.ALG` à la fin (palette de la couleur 0).
 */

/** Abscisse du héros au-delà de laquelle le vampire se réveille (`curX > 55`). */
const WAKE_X = 55;
/** Pause entre deux images des animations (`pause(3)`, `delayVal`). */
const FRAME_PAUSE = 3;

/** Rectangles du vampire réveillé (`animation_6_3`) : colonne et rangée de la feuille `an4y.alg`, 78 x 90 posé en (112, 62). */
const WAKE_X_SHEET = [3, 82, 161, 240, 3, 82];
const WAKE_Y_SHEET = [3, 3, 3, 3, 94, 94];
const WAKE_RECT = { x: 112, y: 62, width: 78, height: 90 };

/** Hauteur de l'écran rafraîchi après la mort du vampire : `updateScreen(120, 0, 120, 0, 200, 200)`. */
const REFRESH_FROM_X = 120;
/** `anim.poseFrom` tant que rien n'est rafraîchi : au-delà de la largeur de l'écran. */
const POSE_NEVER = 320;

/** Feuilles que peut désigner un cadre (indice dans `anim`, 0 : aucun cadre). */
const SHEETS = ["front", "extra", "back", "draw2"] as const;
type SheetName = (typeof SHEETS)[number];

/** Les deux endroits de l'écran que les animations rafraîchissent seuls. */
type Slot = "hero" | "vampire";

interface Frame {
  sheet: SheetName;
  sourceX: number;
  sourceY: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pixels d'un cadre, copiés de sa feuille quand il est posé (le rectangle en (0, 0) d'un plan) : la feuille peut être rechargée ensuite. */
const frozen = new WeakMap<DrasculaRenderer, Partial<Record<Slot, Plane>>>();

function freezeFrame(g: DrasculaEngine, slot: Slot, frame: Frame): void {
  const planes = frozen.get(g.gfx) ?? {};
  const plane = planes[slot] ?? new Plane();
  plane.clear(255);
  plane.copyBackground(g.gfx[frame.sheet], frame.sourceX, frame.sourceY, 0, 0, frame.width, frame.height);
  planes[slot] = plane;
  frozen.set(g.gfx, planes);
}

/** Les valeurs de `GameState.anim` d'un cadre : `<emplacement>Sheet` (0 : aucun), `X`, `Y`, `SX`, `SY`, `W`, `H`, `Clip`. */
function setFrame(g: DrasculaEngine, slot: Slot, frame: Frame): void {
  const anim = g.state.anim;
  anim[`${slot}Sheet`] = SHEETS.indexOf(frame.sheet) + 1;
  anim[`${slot}SX`] = frame.sourceX;
  anim[`${slot}SY`] = frame.sourceY;
  anim[`${slot}X`] = frame.x;
  anim[`${slot}Y`] = frame.y;
  anim[`${slot}W`] = frame.width;
  anim[`${slot}H`] = frame.height;
  anim[`${slot}Clip`] = 0;
  freezeFrame(g, slot, frame);
}

function clearFrame(g: DrasculaEngine, slot: Slot): void {
  g.state.anim[`${slot}Sheet`] = 0;
  g.state.anim[`${slot}Clip`] = 0;
}

/** `room_13` : regarder, parler au vampire, lui offrir la pièce (19), le tuer avec la croix (9). */
export function* room13(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  if (objectId !== Gate.Vampire) return false;
  if (g.picked === Verb.Look) {
    yield* g.talk(Speech.LookFirst);
    g.state.hero.track = Track.Down;
    yield* g.talk(Speech.LookSecond);
    // `strcpy(objName[1], textmisc[4])` : le vampire s'appelle désormais « yoda » au survol.
    const vampire = roomObject(g, Gate.Vampire);
    if (vampire) vampire.name = g.data.text("textmisc", 4);
  } else if (g.picked === Verb.Talk) {
    yield* g.dialogs.converse(VAMPIRE_CONVERSATION);
  } else if (g.picked === Item.Coin) {
    yield* g.talk(Speech.CoinOffer);
    yield* g.talkers.growl();
    yield* pause(50);
    yield* g.talk(Speech.CoinRefused);
  } else if (g.picked === Item.Cross) {
    yield* g.animation("2_3");
    g.endChapter();
  } else {
    return false;
  }
  return true;
}

/** Le vampire doit se réveiller : le héros a passé l'abscisse 55 de la pièce 13 et il dort encore (`update_13`). */
function mustWake(g: DrasculaEngine): boolean {
  const s = g.state;
  return s.room?.number === 13 && s.flags[Flag.VampireWoke] === 0 && s.hero.x > WAKE_X;
}

/** Partie « avance » de `update_13` : arrête le héros qui passe l'abscisse du réveil, la séquence suit (`frame`, `checkAction`). */
export function tickGate(g: DrasculaEngine): void {
  if (mustWake(g)) g.state.hero.moving = false;
}

/** `frame` : le vampire se réveille dès que la boucle principale reprend la main avec le héros au-delà de la limite. */
export function wakeOnFrame(g: DrasculaEngine): Sequence | null {
  return mustWake(g) ? wakeVampire(g) : null;
}

/** `checkAction` du chapitre : une action commencée par une marche passe d'abord par le réveil (ScummVM : pendant la marche). */
export function* wakeBeforeAction(g: DrasculaEngine): Sequence<boolean> {
  if (!g.state.menuScreen && mustWake(g)) yield* wakeVampire(g);
  return false;
}

/** `animation_6_3` : six images du vampire qui se réveille, puis l'image du vampire réveillé remplace celle du vampire endormi. */
export function* wakeVampire(g: DrasculaEngine): Sequence {
  const { flags, hero } = g.state;
  hero.moving = false;
  flags[Flag.VampireWoke] = 1;
  g.updateRoom();
  flags[Flag.AwakeHidden] = 0;
  g.gfx.loadPic("an4y.alg", g.gfx.draw2);
  try {
    for (let frame = 0; frame < WAKE_X_SHEET.length; frame++) {
      yield* pause(FRAME_PAUSE);
      setFrame(g, "vampire", { sheet: "draw2", sourceX: WAKE_X_SHEET[frame], sourceY: WAKE_Y_SHEET[frame], ...WAKE_RECT });
    }
    flags[Flag.AsleepHidden] = 1;
  } finally {
    clearFrame(g, "vampire");
  }
  g.gfx.loadPic(96, g.gfx.front);
  g.updateRoom();
}

/** `updateAnim(y, x, y, width, height, 4, feuille, 3, true)` : quatre images côte à côte de la rangée `row`, une toutes les 3 pauses. */
function* playRow(g: DrasculaEngine, slot: Slot, sheet: SheetName, row: number, rect: { x: number; y: number; width: number; height: number }): Sequence {
  for (let n = 0; n < 4; n++) {
    setFrame(g, slot, { sheet, sourceX: 1 + n * (rect.width + 1), sourceY: row, ...rect });
    yield* pause(FRAME_PAUSE);
  }
}

/** Les trois feuilles `<nom>_1` à `<nom>_3` dans `front`, `extra` et `back`, chacune jouée sur ses deux rangées. */
function* playSheets(g: DrasculaEngine, slot: Slot, name: string, rows: [number, number], rect: { x: number; y: number; width: number; height: number }): Sequence {
  const gfx = g.gfx;
  const targets: Array<[SheetName, Plane]> = [
    ["front", gfx.front],
    ["extra", gfx.extra],
    ["back", gfx.back],
  ];
  targets.forEach(([, plane], i) => gfx.loadPic(`${name}_${i + 1}.alg`, plane));
  for (const [sheet] of targets) {
    for (const row of rows) yield* playRow(g, slot, sheet, row, rect);
  }
}

/**
 * `animation_2_3` : le héros brandit la croix (pose fixe, drapeau 0), le vampire se tord puis disparaît, le héros range la croix et
 * sort de l'écran par la droite. Le chapitre 3 finit ensuite (`room_13` rend vrai) : l'appelant le demande.
 */
export function* killVampire(g: DrasculaEngine): Sequence {
  const s = g.state;
  const { flags, hero } = s;
  const gfx = g.gfx;
  const heroRect = () => ({ x: hero.x - 20, y: hero.y - 1, width: 71, height: 72 });
  flags[Flag.Attacking] = 1;
  // Tant que `updateScreen(120, ...)` n'a pas eu lieu, aucune colonne de l'image fixe du héros (`updateRoom`) n'arrive à l'écran.
  s.anim.poseFrom = POSE_NEVER;
  g.host.playMusic(13);

  try {
    // Le héros (`an2y_*`), puis la musique reprend.
    yield* playSheets(g, "hero", "an2y", [2, 75], heroRect());
    g.host.playMusic(13);

    // Le vampire (`any_*`).
    yield* playSheets(g, "vampire", "any", [1, 91], { x: 120, y: 63, width: 77, height: 89 });
    flags[Flag.AwakeHidden] = 1;
    // `updateRoom(); updateScreen(120, 0, 120, 0, 200, 200)` : la partie droite de l'écran est redessinée, sans le vampire.
    clearFrame(g, "vampire");
    s.anim.heroClip = REFRESH_FROM_X;
    s.anim.poseFrom = REFRESH_FROM_X;
    g.updateRoom();

    // Le héros range la croix (`an3y_*`).
    yield* playSheets(g, "hero", "an3y", [2, 75], heroRect());
  } finally {
    clearFrame(g, "hero");
    clearFrame(g, "vampire");
    delete s.anim.poseFrom;
  }
  flags[Flag.Attacking] = 0;
  flags[Flag.AwakeHidden] = 1;
  gfx.loadPic(96, gfx.front);
  gfx.loadPic(97, gfx.extra);
  gfx.loadPic(99, gfx.back);
  yield* g.walkToPoint(332, 127);
}

/** Copie le cadre de l'emplacement `slot` : le décor du rectangle, puis l'image de la feuille (transparent 255). */
function drawFrame(r: DrasculaRenderer, anim: Record<string, number>, slot: Slot): void {
  const pixels = anim[`${slot}Sheet`] ? frozen.get(r)?.[slot] : undefined;
  if (!pixels) return;
  const x = anim[`${slot}X`];
  const y = anim[`${slot}Y`];
  const clip = anim[`${slot}Clip`];
  const width = clip ? Math.min(anim[`${slot}W`], clip - x) : anim[`${slot}W`];
  if (width <= 0) return;
  const height = anim[`${slot}H`];
  r.screen.copyBackground(r.bg, x, y, x, y, width, height);
  r.screen.copyRect(pixels, 0, 0, x, y, width, height);
}

/** `update_13` (après le héros) : le vampire endormi ou réveillé, l'avant-plan, puis les cadres des animations. */
export const gatePainter: RoomPainter = {
  post(r, s) {
    const { screen, draw3 } = r;
    const { flags, anim } = s;
    // Pendant un cadre du vampire, son rectangle remplace les deux images fixes (qui sont sous le rectangle).
    if (!anim.vampireSheet) {
      if (flags[Flag.AwakeHidden] === 0) screen.copyRect(draw3, 185, 110, 121, 65, 67, 88);
      if (flags[Flag.AsleepHidden] === 0) screen.copyRect(draw3, 185, 21, 121, 63, 67, 88);
    }
    screen.copyRect(draw3, 3, 127, 99, 102, 181, 71);
    drawFrame(r, anim, "hero");
    drawFrame(r, anim, "vampire");
  },
};
