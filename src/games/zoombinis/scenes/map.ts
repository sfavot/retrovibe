/**
 * Écran 1 : la carte des épreuves (`MAP.MHK`, `1110:*`, `docs/zoombinis/screens.md` §3.2). Portage de `1110:0107` (Enter), `1110:0562` (Tick :
 * survol), `1110:0819` (clic), `1110:0ab4` et ses touches (`Maj`, `1` à `4`), `1110:03b8` (Exit), `1110:1e28` (rebâtit les panneaux),
 * `1110:1a3e` (noms d'étapes), `1110:14bc` / `1110:1601` / `1110:182b` (rappels d'image), `1110:0f5c` / `1110:12a9` (textes des panneaux).
 *
 * Décor (fond `tBMP` 300 et palette `SHPL` 300, formes `tBMP` 1000, scripts `SCRB` 1000 à 1005), de l'arrière vers l'avant :
 *  - `SCRB` 1000 : une marque par lieu actif (`w` = lieu − 1, 1 à 15) ; au survol d'un lieu cliquable la marque devient `w + 0x5d` ; `w` 16 (Zoombinîle) ne
 *    s'affiche qu'au survol (`1110:14bc`) ;
 *  - `SCRB` 1001 : l'icône de chaque lieu actif (`w` 17 à 32), en variante de niveau `+ 0x10 × (valeur − 1)` (`1110:1601`) ;
 *  - `SCRB` 1004 : le bandeau du nom du lieu survolé, texte `STRL` 2000 centré, police 13, indice de couleur 45 (`1110:18d0`) ;
 *  - `SCRB` 1005 : le bouton du menu, dont le rectangle est la zone sensible `DS:3fde` ;
 *  - `SCRB` 1003 : le panneau en bas à droite, « touche terrain » en aventure (`STRL` 2004, 1) ou « choisis un niveau » en entraînement (2) avec
 *    les quatre niveaux, le niveau courant en relief (`1110:12a9`, `1110:182b`) ; `SCRB` 1002 : le panneau en haut à gauche, en aventure le nombre
 *    de Zoombinis à Zoombinîle, au camp 1, au camp 2 et à Zoombiniville (`STRL` 2002, 1 à 4), en entraînement « retour à la partie » (`1110:0f5c`) ;
 *  - les noms des étapes (`STRL` 2006) sont peints dans le fond (`1110:1a3e`) : tous en entraînement, ceux des étapes dont un lieu est actif en aventure.
 * `SCRB` 1006 et 1007 ne sont référencés par aucun code de la carte.
 *
 * Écrans cachés et mode de test (`screens.md` §1.7) : en entraînement, les lieux 8 et 9 mènent aux écrans 20 et 19 quand le code secret de l'écran vient d'être tapé
 * (`game/route.ts`, `mapClick`). En mode de test (`[a43f]`), `+` et `-` règlent le nombre de Zoombinis du prochain groupe d'entraînement (`DS:8810`, 1 à 16, remis à 16
 * à chaque entrée, `1110:0000`) et l'affichent sur la ligne d'état (« Snoids to practice with = n », `1198:03cf`). En entraînement, `T` affiche « Which Transition (a-p): »
 * (`1110:0d7b`, `DS:87c8`) ; la touche suivante l'efface et, si c'est `a` à `p`, force le trajet 1 à 16 (`Session.forcedTransfer`, `DS:4180`) et demande l'écran 7
 * (`1110:0ab4`) : `1108:0177` intercale la transition de ce trajet, qui revient ensuite à la carte (`11b0:139b`, `11b0:16e9`).
 *
 * Écarts : le bandeau disparaît dès que le pointeur quitte le lieu (l'original attend 60 ms, `1110:199b`) ; pas d'animation du bouton du menu. Trajet forcé : le décor des
 * étapes est celui d'une transition ordinaire (`11b0:010f` ne recalcule pas les niveaux d'étape, `DS:acf4`, et en force deux : non reproduit).
 */
import { drawShape } from "../../../engine/mohawk/graphics/blit";
import type { Surface } from "../../../engine/mohawk/graphics/surface";
import type { Archive } from "../../../engine/mohawk/resources";
import { FEATURES, FeatureFlag, type Feature, type FeaturePart, type Features } from "../engine/features";
import { DIALOG } from "../engine/dialog";
import { ZOOMBINIS_GAME, type ZoombinisGame } from "../engine/game";
import type { Scene, SceneContext } from "../engine/scene";
import { ScreenId } from "../engine/scene";
import { GRAPHICS } from "../engine/services";
import { showDebugLine } from "../engine/shortcuts";
import { ZOOMBINIS_SOUND } from "../engine/sound";
import { TextFlags, ZOOMBINIS_TEXT, type ZoombinisText } from "../engine/text";
import { cloneGame, testMode, type GameState } from "../game/state";
import { TRANSFER_ROUTES, enterTraining, leaveMap, leaveTraining, mapClick, placeActivation, stepTrainingSize } from "../game/route";
import { closeScreen, openScreen } from "./screen-kit";

const ARCHIVE = "MAP.MHK";
/** Fond (`tBMP` 300) et palette (`SHPL` 300) : `11a8:1475(300)`. */
const BACKGROUND = 300;
/** Planche des formes (`tBMP` 1000) et premier des 6 scripts (`11a0:0000(0, 0, 1000)`, `11a8:14ab(6, 1000)`). */
const SHEET = 1000;
const SCRIPTS = 6;
const SCRIPT_MARKS = 1000;
const SCRIPT_ICONS = 1001;
const SCRIPT_LEGEND = 1002;
const SCRIPT_KEY = 1003;
const SCRIPT_LABEL = 1004;
const SCRIPT_MENU = 1005;

/** Sons de `ZOOMBINI.MHK` : clic sur un lieu (`11a0:0ee7(0, 0x3e6)`) et sur le menu (`0x3e7`). */
const SOUND_PLACE = 998;
const SOUND_MENU = 999;

/** Indice de palette du texte (`11e8:3034(…, 0x2d)`) et couleurs des noms d'étapes (contour 45, remplissage 10, `1110:1a3e`). */
const INK = 45;
const STAGE_FILL = 10;
/** Contour du niveau courant du menu d'entraînement, par niveau (`DS:1676`). */
const LEVEL_OUTLINE = [236, 234, 232, 238] as const;

/** `STRL` : noms des lieux, panneau en haut à gauche, titres et niveaux, noms des étapes. */
const STRL_PLACES = 2000;
const STRL_LEGEND = 2002;
const STRL_LEVELS = 2004;
const STRL_STAGES = 2006;

/** Positions des 16 lieux (`1530:1634`) ; rectangle sensible ± 0x14 × ± 0x0f (`1110:0000`). */
const PLACE_POSITIONS: readonly (readonly [number, number])[] = [
  [60, 400],
  [170, 343],
  [160, 261],
  [222, 313],
  [236, 269],
  [234, 146],
  [286, 82],
  [362, 185],
  [321, 345],
  [427, 352],
  [484, 325],
  [442, 211],
  [490, 182],
  [487, 95],
  [540, 125],
  [578, 65],
];
const PLACE_HALF_WIDTH = 0x14;
const PLACE_HALF_HEIGHT = 0x0f;

/** `DS:1614` : les quatre lignes du menu des niveaux (`x1, y1, x2, y2`, bords droit et bas exclus), `1110:0819` cas 0x11. */
const LEVEL_RECTS: readonly Box[] = [
  { x1: 444, y1: 395, x2: 612, y2: 409 },
  { x1: 444, y1: 409, x2: 612, y2: 424 },
  { x1: 444, y1: 424, x2: 612, y2: 438 },
  { x1: 444, y1: 438, x2: 612, y2: 454 },
];

/** `DS:15c0` (indices 0 à 3) : où s'écrit le nom de chacune des 4 étapes. */
const STAGE_RECTS: readonly Box[] = [
  { x1: 10, y1: 150, x2: 170, y2: 275 },
  { x1: 214, y1: 47, x2: 384, y2: 62 },
  { x1: 327, y1: 390, x2: 439, y2: 480 },
  { x1: 490, y1: 195, x2: 610, y2: 253 },
];

/** Index d'activation (`placeActivation`) de la marque `w` (1 à 15, `1110:14bc`) et de chacune des icônes `w` 17 à 32 (`1110:1601`). */
const ICON_ACTIVATION = [1, 2, 3, 4, 5, 6, 7, 11, 8, 9, 10, 16, 12, 13, 14, 15] as const;
const FIRST_ICON = 17;
const ICON_VARIANT_STEP = 0x10;
const HIGHLIGHT_STEP = 0x5d;
/** Marque de Zoombinîle (`w` 16), forme survolée `w` 109 (`0x6d`). */
const HOME_MARK = 16;
const HOME_MARK_HIGHLIGHT = 0x6d;
/** Place de l'aire de grozarbre (index 11) : active par l'étape 2 (index 11) ou 3 (index 16). */
const GROZARBRE = 11;
const GROZARBRE_ALT = 16;

/** Formes du panneau des niveaux (`SCRB` 1003) : puces `w` 84 à 87, versions en relief `w` 88 à 91 (`1110:182b`, décalées de −2, −2). */
const LEVEL_BULLET_FIRST = 84;
const LEVEL_BULLET_RAISED = 4;

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Instantané de la partie prise à la première sortie de la carte en entraînement (`1110:03b8` écrit `ZBtemp`), rendu en le quittant (`1110:0dd4`). */
const stashes = new WeakMap<ZoombinisGame, GameState>();

/** `PtInRect` de Windows : bords gauche et haut inclus, droit et bas exclus. */
function contains(box: Box, x: number, y: number): boolean {
  return x >= box.x1 && x < box.x2 && y >= box.y1 && y < box.y2;
}

function placeBox(index: number): Box {
  const [x, y] = PLACE_POSITIONS[index]!;
  return { x1: x - PLACE_HALF_WIDTH, y1: y - PLACE_HALF_HEIGHT, x2: x + PLACE_HALF_WIDTH, y2: y + PLACE_HALF_HEIGHT };
}

/** Valeur d'activation du lieu d'indice `index` (0 à 15) : l'aire de grozarbre l'est par l'une ou l'autre de ses deux étapes (`1110:0562`). */
function placeValue(activation: readonly number[], index: number): number {
  return index === GROZARBRE ? Math.max(activation[GROZARBRE]!, activation[GROZARBRE_ALT]!) : activation[index]!;
}

/** `1110:0f5c`, entraînement : première ligne (0-based) du texte « retour à la partie » de `STRL` 2002, selon l'avancement (`S+0x51`, `S+0x52`, `S+0x50`). */
function returnLine(game: GameState): number {
  if ((game.masks.stage4 & 0xf) !== 0) return 17;
  if ((game.masks.stage2 | (game.masks.stage3 << 4)) !== 0) return 13;
  if ((game.masks.stage1 & 0xf) !== 0) return 9;
  return 5;
}

/** Rectangle `(x1, y1, x2, y2)` d'une feature (`+0xce…+0xd4`) ; tout zéro tant qu'elle n'a pas lu d'image. */
function boxOf(feature: Feature): Box {
  const rect = feature.rect;
  return rect ? { x1: rect.left, y1: rect.top, x2: rect.right, y2: rect.bottom } : { x1: 0, y1: 0, x2: 0, y2: 0 };
}

/** Écrit `text` dans `box` (`11e8:5d70` : police courante = petite, indice 45). */
function write(text: ZoombinisText, screen: Surface, value: string | null, box: Box, flags: number, color = INK): void {
  if (value === null || value === "") return;
  text.drawText(screen, "small", value, { x: box.x1, y: box.y1, w: box.x2 - box.x1, h: box.y2 - box.y1 }, flags, color);
}

/** `10a8:0cd2` : texte en relief, quatre exemplaires décalés d'un pixel (−1·0, 0·−1, +1·0, 0·+1) en `outline`, puis le texte en `fill`. */
function writeOutlined(text: ZoombinisText, screen: Surface, value: string | null, box: Box, flags: number, outline: number, fill: number): void {
  const shifts = [
    [-1, 0],
    [0, -1],
    [1, 0],
    [0, 1],
  ] as const;
  for (const [dx, dy] of shifts) write(text, screen, value, { x1: box.x1 + dx, y1: box.y1 + dy, x2: box.x2 + dx, y2: box.y2 + dy }, flags, outline);
  write(text, screen, value, box, flags, fill);
}

/** Clic sur la zone `DS:3fde` (`1110:0819` cas 0x11) : son 999 puis la boîte de dialogue en mode 1 (`11a0:1737(…, 1)`). */
function openMainMenu(ctx: SceneContext): void {
  ctx.services.get(ZOOMBINIS_SOUND).queue(SOUND_MENU);
  ctx.services.get(DIALOG).openMenu(ctx);
}

export function createMapScene(): Scene {
  let archive: Archive;
  let background: Surface;
  let features: Features;
  let text: ZoombinisText;
  let zoombinis: ZoombinisGame;
  let activation: number[] = [];
  /** `[87e8]` : lieu survolé (indice 0 à 15), −1 si aucun ; `[880e]` : numéro de lieu à mettre en valeur (1 à 16), 0 si aucun. */
  let hovered = -1;
  let highlight = 0;
  let labelText: string | null = null;
  let marks: Feature;
  let icons: Feature;
  let label: Feature;
  let menu: Feature;
  let levelPanel: Feature;
  let legend: Feature;
  let leaving = false;
  /** `DS:8810` : taille du prochain groupe d'entraînement (0 = 16), touches `+` / `-` du mode de test. */
  let trainingSize = 0;
  /** `DS:87c8` : `T` a été tapé (mode de test, en entraînement) ; la touche suivante choisit le trajet. */
  let askingTransfer = false;

  const training = (): number => zoombinis.session.training;

  /** Plus de lieu survolé : bandeau et mise en valeur retirés. */
  function clearHover(): void {
    hovered = -1;
    highlight = 0;
    labelText = null;
    label.flags |= FeatureFlag.noDraw;
  }

  /** Rejoue l'image d'un objet : son rappel d'image recalcule ses parties (`11a8:1b89`, `+0x2d = 1`). */
  function refresh(feature: Feature): void {
    feature.replacing = true;
    feature.active = true;
    feature.next = 0;
    features.invalidate();
  }

  /** `1110:14bc` : marques des lieux actifs, mise en valeur du lieu survolé. */
  function markParts(_feature: Feature, parts: FeaturePart[]): FeaturePart[] {
    const result: FeaturePart[] = [];
    for (const part of parts) {
      let w = part.w;
      if (w === HOME_MARK) {
        if (highlight !== 1) continue;
        w = HOME_MARK_HIGHLIGHT;
      } else if (w >= 1 && w <= 15) {
        if (placeValue(activation, w) === 0) continue;
        if (highlight - 1 === w) w += HIGHLIGHT_STEP;
      }
      result.push({ ...part, w });
    }
    return result;
  }

  /** `1110:1601` : icônes des lieux actifs, variante de niveau `valeur − 1`. */
  function iconParts(_feature: Feature, parts: FeaturePart[]): FeaturePart[] {
    const result: FeaturePart[] = [];
    for (const part of parts) {
      const slot = part.w - FIRST_ICON;
      const index = ICON_ACTIVATION[slot];
      if (index === undefined) {
        result.push(part);
        continue;
      }
      const value = activation[index]!;
      if (value === 0) continue;
      result.push({ ...part, w: part.w + ICON_VARIANT_STEP * (value - 1) });
    }
    return result;
  }

  /** `1110:182b` : en entraînement, la puce du niveau courant est remplacée par sa version en relief. */
  function levelParts(_feature: Feature, parts: FeaturePart[]): FeaturePart[] {
    const level = training() - 1;
    if (level < 0 || level > 3) return parts;
    return parts.map((part) =>
      part.w === LEVEL_BULLET_FIRST + level ? { w: part.w + LEVEL_BULLET_RAISED, x: part.x - 2, y: part.y - 2 } : part,
    );
  }

  /** `1110:1a3e` : repeint le fond, puis y écrit le nom de chaque étape à afficher (en relief, centré). */
  function paintBackground(): void {
    drawShape(background, archive.tbmp(BACKGROUND), 0, 0, 0);
    const shown = [false, false, false, false];
    if (training() !== 0) shown.fill(true);
    else {
      for (let place = 1; place < 16; place++) {
        if (activation[place] === 0) continue;
        if (place >= 1 && place < 4) shown[0] = true;
        if (place > 4 && place < 8) shown[1] = true;
        if (place > 7 && place < 11) shown[2] = true;
        if (place > 11 && place < 15) shown[3] = true;
      }
    }
    shown.forEach((visible, stage) => {
      if (!visible) return;
      const name = text.strings.get(STRL_STAGES, stage + 1);
      writeOutlined(text, background, name, STAGE_RECTS[stage]!, TextFlags.center | TextFlags.vcenter, INK, STAGE_FILL);
    });
    features.invalidate();
  }

  /** `1110:1e28` : recalcule les lieux actifs (`1110:1c75`), le fond et les panneaux. */
  function rebuild(): void {
    activation = placeActivation(zoombinis.game, zoombinis.session);
    paintBackground();
    refresh(marks);
    refresh(icons);
    refresh(levelPanel);
    refresh(legend);
  }

  /** `1110:12a9` : titre et quatre niveaux du panneau en bas à droite. */
  function drawLevels(feature: Feature, screen: Surface): void {
    const box = boxOf(feature);
    const trainingLevel = training();
    write(text, screen, text.strings.get(STRL_LEVELS, trainingLevel !== 0 ? 2 : 1), { x1: box.x1, y1: box.y1 - 3, x2: box.x2, y2: box.y1 + 0x23 }, TextFlags.center | TextFlags.vcenter);
    for (let level = 0; level < 4; level++) {
      const line = { x1: box.x1 + 0x24, y1: box.y1 + 0x21 + 0xe * level, x2: box.x2 + 0x19, y2: box.y1 + 0x2f + 0xe * level };
      const name = text.strings.get(STRL_LEVELS, level + 3);
      if (trainingLevel === level + 1) writeOutlined(text, screen, name, line, 0x01, LEVEL_OUTLINE[level]!, INK);
      else write(text, screen, name, line, 0x01);
    }
  }

  /** `1110:0f5c` : panneau en haut à gauche. */
  function drawLegend(feature: Feature, screen: Surface): void {
    const box = boxOf(feature);
    const title = { x1: box.x1, y1: box.y1 + 3, x2: box.x2, y2: box.y1 + 0x15 };
    if (training() === 0) {
      // Nom de la partie (`14b8:0000`), puis Zoombinîle, camp 1, camp 2 et Zoombiniville avec leurs effectifs (`S+0x4A`, `S+0x4C`, `S+0x4E`).
      write(text, screen, zoombinis.session.name, title, TextFlags.center | TextFlags.vcenter);
      const { camp1, camp2, town } = zoombinis.game.counters;
      const counts = [625 - (camp1 + camp2 + town), camp1, camp2, town];
      for (let line = 0; line < 4; line++) {
        const y1 = box.y1 + 0x1a + 0x12 * line;
        const y2 = box.y1 + 0x2c + 0x12 * line;
        write(text, screen, text.strings.get(STRL_LEGEND, line + 1), { x1: box.x1 + 7, y1, x2: box.x1 + 0x7a, y2 }, 0x01);
        write(text, screen, String(counts[line]), { x1: box.x1 + 0x7a, y1, x2: box.x2 - 7, y2 }, TextFlags.right);
      }
    } else {
      // « entraînement » et quatre lignes de « retour à la partie » (les rectangles s'allongent de 0x26 par ligne, le texte reste en haut à gauche).
      write(text, screen, text.strings.get(STRL_LEGEND, 5), title, TextFlags.center | TextFlags.vcenter);
      const first = returnLine(zoombinis.game);
      for (let line = 0; line < 4; line++) {
        const y1 = box.y1 + 0x1a + 0x12 * line;
        const y2 = box.y1 + 0x2c + 0x26 * line;
        write(text, screen, text.strings.get(STRL_LEGEND, first + line + 1), { x1: box.x1 + 5, y1, x2: box.x2, y2 }, 0x01);
      }
    }
  }

  /** Premier lieu actif dont le rectangle contient le point (`1110:0562`, dans l'ordre des lieux), ou −1. */
  function placeAt(x: number, y: number): number {
    for (let index = 0; index < 16; index++) {
      if (placeValue(activation, index) !== 0 && contains(placeBox(index), x, y)) return index;
    }
    return -1;
  }

  /** `1110:0562` : survol, bandeau du nom et mise en valeur du lieu s'il est cliquable (`1110:073e`). */
  function updateHover(ctx: SceneContext): void {
    const found = placeAt(ctx.input.mouseX, ctx.input.mouseY);
    if (found === hovered) return;
    hovered = found;
    highlight = found >= 0 && mapClick(zoombinis.game, zoombinis.session, found + 1) !== null ? found + 1 : 0;
    labelText = found >= 0 ? text.strings.get(STRL_PLACES, found + 1) : null;
    label.flags = labelText === null ? label.flags | FeatureFlag.noDraw : label.flags & ~FeatureFlag.noDraw;
    refresh(marks);
    features.invalidate();
  }

  /** `1110:03b8` pour une sortie vers `screen` (les lieux de la carte et l'entraînement sont rangés par `mapClick`). */
  function leaveTo(ctx: SceneContext, screen: number, leaveTrainingMode: boolean): void {
    leaving = true;
    const { game, session } = zoombinis;
    if (leaveTrainingMode) {
      // `1110:0dd4` : la partie mise de côté revient (`ZBtemp`), et le groupe abandonné ne sera pas recopié.
      const stash = stashes.get(zoombinis);
      stashes.delete(zoombinis);
      leaveTraining(session);
      if (stash) {
        zoombinis.game = stash;
        session.leftToMap = true;
      }
    } else if (session.training !== 0 && !stashes.has(zoombinis)) {
      // Première sortie de la carte en entraînement : la partie est mise de côté avant que le groupe d'entraînement ne la remplace.
      stashes.set(zoombinis, cloneGame(game));
      session.leftToMap = false;
    }
    leaveMap(zoombinis.game, session, ctx.rng, trainingSize);
    zoombinis.goTo(ctx, screen);
  }

  /** Entraînement : `Maj` y entre au niveau 0 (rien s'il y est déjà), `1` à `4` changent de niveau (rien en aventure). `1110:0b97`, `1110:0b8d`. */
  function setTraining(ctx: SceneContext, level: number | "enter"): void {
    const { session } = zoombinis;
    if (level === "enter") {
      if (session.training !== 0) return;
      enterTraining(session, 0);
    } else {
      if (session.training === 0 || session.training === level + 1) return;
      enterTraining(session, level);
    }
    clearHover();
    rebuild();
    ctx.requestPresent();
  }

  function click(ctx: SceneContext, x: number, y: number): void {
    const place = placeAt(x, y);
    if (place >= 0) {
      const result = mapClick(zoombinis.game, zoombinis.session, place + 1);
      if (!result) return;
      ctx.services.get(ZOOMBINIS_SOUND).queue(SOUND_PLACE);
      leaveTo(ctx, result.screen, result.leaveTraining);
      return;
    }
    if (contains(boxOf(menu), x, y)) {
      openMainMenu(ctx);
      return;
    }
    if (training() !== 0) {
      const level = LEVEL_RECTS.findIndex((box) => contains(box, x, y));
      if (level >= 0) setTraining(ctx, level);
    }
  }

  return {
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(ARCHIVE);
    },
    enter(ctx: SceneContext) {
      zoombinis = ctx.services.get(ZOOMBINIS_GAME);
      features = ctx.services.get(FEATURES);
      text = ctx.services.get(ZOOMBINIS_TEXT);
      zoombinis.session.screen = ScreenId.map;
      // `1110:0107` : le groupe courant est vidé à l'entrée (`S−0x56D2 = 0`).
      zoombinis.game.group.members = [];
      hovered = -1;
      highlight = 0;
      labelText = null;
      leaving = false;
      trainingSize = 0;
      askingTransfer = false;
      activation = placeActivation(zoombinis.game, zoombinis.session);
      background = openScreen(ctx, archive, { background: BACKGROUND });
      features.defineGroup(0, SHEET);
      features.setScripts(SCRIPT_MARKS, SCRIPTS);
      const flags = FeatureFlag.firstImage | FeatureFlag.stopAtEnd;
      marks = features.create({ script: SCRIPT_MARKS, delay: 6, flags, onImage: markParts });
      icons = features.create({ script: SCRIPT_ICONS, delay: 6, flags, onImage: iconParts });
      label = features.create({
        script: SCRIPT_LABEL,
        delay: 6,
        flags: flags | FeatureFlag.noDraw,
        onAfterDraw: (feature, screen) => write(text, screen, labelText, boxOf(feature), TextFlags.center | TextFlags.vcenter),
      });
      menu = features.create({ script: SCRIPT_MENU, delay: 3, flags });
      levelPanel = features.create({ script: SCRIPT_KEY, delay: 0, flags, onImage: levelParts, onAfterDraw: drawLevels });
      legend = features.create({ script: SCRIPT_LEGEND, delay: 0, flags, onAfterDraw: drawLegend });
      // Le rectangle du menu et celui du bandeau viennent de la première image de leur script, lue à la création.
      rebuild();
      ctx.services.get(GRAPHICS).screen.copyFrom(background);
      ctx.requestPresent();
    },
    leave(ctx: SceneContext) {
      closeScreen(ctx);
    },
    tick(ctx: SceneContext) {
      // Une boîte de dialogue ouverte gèle la carte (`[a2da]`) : ni survol ni clic.
      if (leaving || ctx.services.get(DIALOG).isOpen) return;
      updateHover(ctx);
      for (const event of ctx.input.buttonEvents) {
        if (leaving) return;
        if (event.down && event.button === "left") click(ctx, event.x, event.y);
      }
    },
    key(event, ctx: SceneContext) {
      if (leaving || event.ctrl || event.alt) return false;
      // `1110:0ab4` : après `T`, toute touche efface la question ; `a` à `p` forcent le trajet 1 à 16 (`DS:4180`) et demandent l'écran 7.
      if (askingTransfer && testMode(zoombinis.game)) {
        askingTransfer = false;
        zoombinis.session.forcedTransfer = 0;
        showDebugLine(ctx, "");
        const letter = event.key.length === 1 ? event.key.toLowerCase().charCodeAt(0) - 0x60 : 0;
        if (letter >= 1 && letter <= TRANSFER_ROUTES.length) {
          zoombinis.session.forcedTransfer = letter;
          leaveTo(ctx, ScreenId.bridge, false);
          return true;
        }
      }
      // `1110:0d7b` : `T` en entraînement et en mode de test.
      if (event.code === "KeyT" && testMode(zoombinis.game) && training() !== 0) {
        showDebugLine(ctx, "Which Transition (a-p):");
        askingTransfer = true;
        return true;
      }
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
        setTraining(ctx, "enter");
        return true;
      }
      const digit = /^Digit([1-4])$/.exec(event.code);
      if (digit) {
        setTraining(ctx, Number(digit[1]) - 1);
        return true;
      }
      if ((event.key === "+" || event.key === "-") && testMode(zoombinis.game)) {
        trainingSize = stepTrainingSize(trainingSize, event.key);
        showDebugLine(ctx, `Snoids to practice with = ${trainingSize}`);
        return true;
      }
      return false;
    },
  };
}
