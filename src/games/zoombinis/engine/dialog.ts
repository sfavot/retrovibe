/**
 * Boîte de dialogue de Zoombinis (`11a0:1737`, modes 1 à 6) et message de raccourci (`1168:2117`) : étude dans `docs/zoombinis/screens.md`
 * §1.4, §5.2 et §5.4, section « Dialogues et raccourcis » de `docs/zoombinis/engine-ts.md`.
 *
 * Original : chaque mode crée deux ou trois « features » dont le dessin est `11a0:21c4` (planche `tBMP` 1 et `SCRB` 1 à 11 de `ZOOMBINI.MHK`,
 * ouverts par `11a0:1597`) et dont le rappel `+0x14` (`11a0:35ca` pour le menu, `11a0:3914` pour les autres) traite les clics. Pendant
 * qu'un mode est ouvert (`DS:a2da`), `1198:05b3` envoie les touches à `11a0:316d` et `1198:0101` envoie les clics à `11a0:34d3` : l'écran
 * dessous ne reçoit plus rien, mais ses features continuent de jouer. Un bouton se déclenche 2 ticks après le clic (image « enfoncée »).
 *
 * Port : une pile de couches (menu, liste, oui / non, crédits, « à propos »). Tant qu'il y en a une, un crochet de tick (après le lecteur
 * de features) recompose l'écran (fond puis features) et dessine les couches par-dessus, puis vide les entrées du tick pour que la scène ne
 * les reçoive pas ; les touches sont prises par un gestionnaire `before`. À la fermeture, l'image enregistrée à l'ouverture est
 * restaurée et les features sont invalidées. Aucun texte n'est écrit ici : tout vient de `TEXTSTR.MHK` (`STRL` 2018, 2023, 2020, 2021, 1040).
 */
import { drawShape } from "../../../engine/mohawk/graphics/blit";
import { Surface, type Rect } from "../../../engine/mohawk/graphics/surface";
import type { Archive } from "../../../engine/mohawk/resources";
import type { Shape } from "../../../data/mohawk/shap";
import type { ButtonEvent, KeyEvent } from "../../../engine/mohawk/input";
import { COMMON_ARCHIVE } from "../data/archives";
import type { ScriptCell } from "../data/script";
import { newGameInPlay, resumeScreen } from "../game/route";
import { canTypeChar, normalizeName, SAVE_ERROR_STRL, SaveError, serializeGame } from "../game/saves";
import type { GameState } from "../game/state";
import type { ZoombinisContext } from "./context";
import type { ZoombinisEngine } from "./engine";
import { FEATURES } from "./features";
import type { Host } from "./host";
import { ZOOMBINIS_GAME } from "./game";
import { scrb } from "./resources";
import { defineService } from "./scene";
import { GRAPHICS } from "./services";
import { ZOOMBINIS_SOUND } from "./sound";
import { TextFlags, ZOOMBINIS_TEXT, type FontName } from "./text";

// --- Constantes de l'original ---

/** `STRL` de `TEXTSTR.MHK` : dialogues et menus (`DS:9db6`), messages d'options (`DS:9dbe`), crédits (`DS:9da6`, `DS:9dae`), version (`DS:9d96`). */
const STRL_DIALOG = 2018;
const STRL_OPTIONS = 2023;
const STRL_CREDITS_A = 2020;
const STRL_CREDITS_B = 2021;
const STRL_VERSION = 1040;

/** Indices (1-based, comme `1010:0000`) des textes de `STRL` 2018. */
const T = {
  leaveMessage: 1,
  leaveYes: 2,
  leaveNo: 3,
  ok: 4,
  cancel: 5,
  loadButton: 6,
  saveButton: 7,
  optionsTitle: 8,
  yes: 9,
  no: 10,
  question: 11,
  menuFirst: 12,
  noSave: 20,
  okMessage: 21,
  unsavedNewGame: 22,
  newGameButton: 23,
  replaceButton: 24,
  saveTitle: 25,
  saveLabel: 26,
  loadTitle: 27,
  replaceMessage: 28,
  team: 29,
  quitUnsaved: 33,
  quitUnsavedYes: 34,
  quitUnsavedNo: 35,
  noTrainingSave: 36,
  sureNewGame: 37,
  tooMany: 38,
  noTrainingLoad: 39,
  noTrainingNewGame: 40,
  sureQuit: 42,
  quitYes: 31,
  quitNo: 35,
} as const;

/** Suite de `message` qui n'est pas dans `TEXTSTR.MHK` : `"?` (`DS:3fa6`) clôt « remplacer la partie existante "nom"? ». À valider. */
const REPLACE_SUFFIX = '"?';

/** Palette partagée des écrans (index 10 à 45, identiques dans tous les `SHPL`) : couleurs lues dans `11a0:21c4`. */
const COLOR = {
  text: 0x2d,
  outline: 0x0e,
  selected: 0x22,
  creditsHeading: 0x26,
  creditsName: 0x23,
  black: 0,
  white: 255,
} as const;

/** `tBMP` 1 de `ZOOMBINI.MHK` : planche des boîtes (24 images) ; `SCRB` 1 à 11 : leurs assemblages. `tBMP` 20 / `SCRB` 20 : cadre des crédits. */
const SHEET = 1;
const CREDITS_SHEET = 20;
/** `tBMP` 3001 : trois plaques de message (87, 131 et 198 × 19) de `1168:224d`. */
const PLAQUE_SHEET = 3001;
const SCRB = { menu: [1, 2, 3], load: [4, 5, 6], save: [7, 8, 9], confirm: [10, 11], credits: 20 } as const;

function rect(left: number, top: number, right: number, bottom: number): Rect {
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Rectangles de texte, lus dans `DS:3ea8…3f18` (`ds` du `NE`, valeurs fixes) et `11a0:316d` / `11a0:1737` (liste). */
const AREA = {
  menuTitle: rect(250, 58, 380, 80),
  menuQuestion: rect(166, 190, 465, 210),
  menuYes: rect(197, 320, 260, 345),
  menuNo: rect(197, 345, 260, 365),
  menuRowLeft: 196,
  menuRowRight: 470,
  menuRowTops: [102, 124, 145, 166, 221, 243, 264, 285],
  menuRowHeight: 18,
  loadTitle: rect(200, 67, 455, 95),
  saveTitle: rect(200, 57, 455, 85),
  saveLabel: rect(187, 271, 380, 290),
  input: rect(192, 298, 456, 316),
  confirm: rect(154, 130, 487, 235),
  about: rect(150, 164, 490, 316),
  creditsLine: rect(155, 451, 485, 466),
  creditsPane: rect(170, 15, 470, 466),
  creditsInterior: rect(13, 14, 627, 466),
} as const;

/** Liste des parties : 8 lignes de 20 points, de 192 à 405 ; haut à 110 (chargement) ou 94 (enregistrement) ; défilement de 8 en 8. */
const LIST = { left: 192, right: 405, loadTop: 110, saveTop: 94, rowHeight: 20, rows: 8, height: 160 } as const;

/** Un bouton se déclenche 2 ticks après le clic (`+0x24 = now + 2` dans `11a0:3914` et `11a0:35ca`). */
const PRESS_TICKS = 2;
/** Double clic sur une ligne de la liste : au plus 30 ticks (`11a0:3914`, id 17). */
const DOUBLE_CLICK_TICKS = 30;
/** Son du clic de bouton (`11a0:0ee7(0, 999)`) et son des crédits (`11a0:0ee7(0, 0x4e88)`). */
const CLICK_SOUND = 999;
const CREDITS_SOUND = 0x4e88;
/** Durée d'un message de raccourci, en ticks (`1168:2117(…, 0x5a, …)`). */
const MESSAGE_TICKS = 0x5a;
/** Ticks de défilement d'une ligne des crédits (`a3f6` compte jusqu'à 15) ; une ligne fait 15 points. */
const CREDITS_LINE_TICKS = 15;
/** Cadence du curseur de saisie (`11a0:21c4` : toutes les 5 ticks, visible une fois sur deux). */
const CARET_STEP_TICKS = 5;
/** Écran 1 à 18 : le menu n'agit que là (`11a0:425e`, `4434`, `4493` : `0 < DS:8552 < 0x13`). */
const FIRST_MENU_SCREEN = 1;
const LAST_MENU_SCREEN = 18;

/** Mode de la boîte (`11a0:1737`) : 1 menu, 2 charger, 3 enregistrer, 4 et 6 oui / non, 5 crédits. `ABOUT` est la boîte de `1198:0213`. */
export type DialogMode = 1 | 2 | 3 | 4 | 5 | 6;

export interface ConfirmSpec {
  /** Texte de la question (lignes séparées par `\r`). */
  message: string;
  /** Texte du bouton de droite (`DS:a2e4`). */
  yes: string;
  /** Texte du bouton de gauche (`DS:a2e8`) ; absent = bouton unique, centré. */
  no?: string;
  onYes?: () => void;
  onNo?: () => void;
  /** 4 (défaut) ou 6 : même dessin, même comportement. */
  mode?: 4 | 6;
}

/** Une option basculable (`S+0x04…S+0x20`) : le nom suit `GameOptions`. */
export type OptionKey = "effects" | "music" | "magneticMouse" | "hideCursorWhileCarrying" | "autoMagnet" | "transitionsOff" | "lessAction";

// --- Géométrie des boutons ---

interface Button {
  id: number;
  up: ScriptCell;
  down: ScriptCell;
  /** Rectangle de l'image « relevée » (zone cliquable et du libellé). */
  area: Rect;
  /** Option liée (menu) : l'image est remplacée par la suivante (∅) quand elle est coupée. */
  option?: OptionKey;
}

interface Layer {
  readonly mode: DialogMode | "about";
  draw(env: Env, screen: Surface): void;
}

interface Env {
  readonly ctx: ZoombinisContext;
  readonly dialogs: Dialogs;
  readonly sheet: readonly Shape[];
  readonly frame: readonly Shape[];
  readonly plaques: readonly Shape[];
  readonly common: Archive;
}

type TextService = ReturnType<typeof textOf>;
function textOf(ctx: ZoombinisContext) {
  return ctx.services.get(ZOOMBINIS_TEXT);
}

function cellsOf(common: Archive, id: number): ScriptCell[] {
  return scrb(common, id).images[0]!.cells;
}

/** Boutons d'un `SCRB` : la première moitié des cases (relevées) puis la seconde (enfoncées), dans le même ordre (`11a0:35ca`). */
function buttonsOf(env: Env, scrbId: number, firstId: number): Button[] {
  const cells = cellsOf(env.common, scrbId);
  const half = cells.length / 2;
  const buttons: Button[] = [];
  for (let k = 0; k < half; k++) {
    const up = cells[k]!;
    const shape = env.sheet[up.w - 1]!;
    buttons.push({ id: firstId + k, up, down: cells[k + half]!, area: { x: up.x, y: up.y, w: shape.width, h: shape.height } });
  }
  return buttons;
}

function drawCells(env: Env, screen: Surface, scrbId: number): void {
  for (const cell of cellsOf(env.common, scrbId)) {
    const shape = env.sheet[cell.w - 1];
    if (shape) drawShape(screen, shape, cell.x, cell.y, 8);
  }
}

function contains(area: Rect, x: number, y: number): boolean {
  return x >= area.x && x < area.x + area.w && y >= area.y && y < area.y + area.h;
}

/** Les tours de `1000:0d88` + `10a8:0d9e` : quatre copies du texte décalées d'un point (gauche, haut, droite, bas) dans `outline`, puis le texte (`10a8:0cd2`). */
function drawOutlined(text: TextService, screen: Surface, font: FontName, str: string, area: Rect, flags: number, outline: number, color: number): void {
  const offsets: readonly (readonly [number, number])[] = [
    [-1, 0],
    [0, -1],
    [1, 0],
    [0, 1],
  ];
  for (const [dx, dy] of offsets) text.drawText(screen, font, str, { ...area, x: area.x + dx, y: area.y + dy }, flags, outline);
  text.drawText(screen, font, str, area, flags, color);
}

const CENTERED = TextFlags.center | TextFlags.vcenter;

// --- Couches ---

abstract class ButtonLayer implements Layer {
  abstract readonly mode: DialogMode;
  /** Bouton enfoncé et tick où son action part. */
  press: { id: number; due: number } | null = null;
  buttons: Button[] = [];

  abstract draw(env: Env, screen: Surface): void;
  abstract activate(env: Env, id: number): void;
  /** Ids acceptés pour un clic, dans l'ordre de `11a0:34d3` (premier rectangle touché). */
  abstract hit(x: number, y: number): number | null;

  pressed(id: number): boolean {
    return this.press?.id === id;
  }

  /** Cherche un bouton dont l'id est dans `ids` sous `(x, y)`. */
  protected hitButtons(x: number, y: number, ids: readonly number[]): number | null {
    for (const button of this.buttons) if (ids.includes(button.id) && contains(button.area, x, y)) return button.id;
    return null;
  }

  protected drawButton(env: Env, screen: Surface, button: Button, off = false): void {
    const pressed = this.pressed(button.id);
    const cell = pressed ? button.down : button.up;
    const shape = env.sheet[cell.w - 1 + (off ? 1 : 0)];
    if (shape) drawShape(screen, shape, cell.x, cell.y, 8);
  }
}

/** Mode 1 : 8 boutons, « ok » (9) et « Équipe » (10) (`11a0:35ca`). */
class MenuLayer extends ButtonLayer {
  readonly mode = 1;

  constructor(env: Env) {
    super();
    const [, rows, extra] = SCRB.menu;
    this.buttons = [...buttonsOf(env, rows, 1), ...buttonsOf(env, extra, 9)];
  }

  hit(x: number, y: number): number | null {
    return this.hitButtons(x, y, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  }

  /** `true` quand l'option de la ligne est coupée (∅) : ligne 5 = voix et effets, 6 = musique, 7 = souris aimantée, 8 = transitions. */
  private off(env: Env, id: number): boolean {
    const options = env.dialogs.game.options;
    switch (id) {
      case 5:
        return !options.effects;
      case 6:
        return !options.music;
      case 7:
        return !options.magneticMouse;
      case 8:
        return options.transitionsOff;
      default:
        return false;
    }
  }

  draw(env: Env, screen: Surface): void {
    const text = textOf(env.ctx);
    const str = (index: number) => text.strings.get(STRL_DIALOG, index) ?? "";
    drawCells(env, screen, SCRB.menu[0]);
    for (const button of this.buttons) this.drawButton(env, screen, button, this.off(env, button.id));
    drawOutlined(text, screen, "large", str(T.optionsTitle), AREA.menuTitle, CENTERED, COLOR.outline, COLOR.text);
    text.drawText(screen, "large", str(T.question), AREA.menuQuestion, 0, COLOR.text);
    text.drawText(screen, "large", str(T.yes), AREA.menuYes, 0, COLOR.text);
    text.drawText(screen, "large", str(T.no), AREA.menuNo, 0, COLOR.text);
    AREA.menuRowTops.forEach((top, k) => {
      const area = rect(AREA.menuRowLeft, top, AREA.menuRowRight, top + AREA.menuRowHeight);
      text.drawText(screen, "small", str(T.menuFirst + k), area, 0, COLOR.text);
    });
    for (const button of this.buttons.slice(8)) {
      // `11a0:21c4` : le libellé suit l'image du bouton (un point à gauche au repos, un point à droite enfoncé).
      const cell = this.pressed(button.id) ? button.down : button.up;
      const shape = env.sheet[cell.w - 1]!;
      const area = { x: cell.x + (this.pressed(button.id) ? 1 : -1), y: cell.y, w: shape.width, h: shape.height };
      text.drawText(screen, "large", str(button.id === 9 ? T.ok : T.team), area, CENTERED, COLOR.text);
    }
  }

  activate(env: Env, id: number): void {
    const d = env.dialogs;
    switch (id) {
      case 1:
        d.newGame(env.ctx);
        break;
      case 2:
        d.openLoad(env.ctx);
        break;
      case 3:
        d.openSave(env.ctx);
        break;
      case 4:
        d.quit(env.ctx);
        break;
      case 5:
        d.toggleOption(env.ctx, "effects");
        break;
      case 6:
        d.toggleOption(env.ctx, "music");
        break;
      case 7:
        d.toggleOption(env.ctx, "magneticMouse");
        break;
      case 8:
        d.toggleOption(env.ctx, "transitionsOff");
        break;
      case 9:
        d.closeTop(env.ctx, 1);
        break;
      case 10:
        d.openCredits(env.ctx);
    }
  }
}

/** Modes 2 (charger) et 3 (enregistrer) : liste des parties de 8 lignes, flèches, boutons, et en mode 3 le champ de saisie. */
class ListLayer extends ButtonLayer {
  readonly mode: 2 | 3;
  /** Rang de la première ligne affichée (`a2ba`), multiple de 8. */
  scroll = 0;
  /** Ligne choisie, 1-based, 0 = aucune (`a2bc`) ; le chargement ouvre avec la première. */
  selected: number;
  /** Tick du dernier clic sur la liste (`a2be`). */
  lastClick = 0;
  /** Nom saisi (`DS:a338`) et position du curseur (`DS:a34e`). */
  name = "";
  cursor = 0;
  /** Tick d'ouverture, pour le clignotement du curseur. */
  readonly openedAt: number;
  entries: { name: string }[];

  constructor(
    env: Env,
    mode: 2 | 3,
    private readonly top: number,
  ) {
    super();
    this.mode = mode;
    const [, arrows, buttons] = mode === 2 ? SCRB.load : SCRB.save;
    this.buttons = [...buttonsOf(env, arrows, 11), ...buttonsOf(env, buttons, 13)];
    this.entries = env.dialogs.saveStore.list();
    this.selected = mode === 2 ? 1 : 0;
    this.openedAt = env.ctx.clock.ticks;
  }

  hit(x: number, y: number): number | null {
    const found = this.hitButtons(x, y, [11, 12, 13, 14]);
    if (found !== null) return found;
    if (this.mode === 2 && contains(rect(LIST.left, this.top, LIST.right, this.top + LIST.height), x, y)) return 17;
    return null;
  }

  draw(env: Env, screen: Surface): void {
    const text = textOf(env.ctx);
    const str = (index: number) => text.strings.get(STRL_DIALOG, index) ?? "";
    drawCells(env, screen, (this.mode === 2 ? SCRB.load : SCRB.save)[0]);
    for (const button of this.buttons) this.drawButton(env, screen, button);
    drawOutlined(text, screen, "large", str(this.mode === 2 ? T.loadTitle : T.saveTitle), this.mode === 2 ? AREA.loadTitle : AREA.saveTitle, CENTERED, COLOR.outline, COLOR.text);
    if (this.mode === 3) text.drawText(screen, "large", str(T.saveLabel), AREA.saveLabel, 0, COLOR.text);
    for (let row = 0, index = this.scroll; row < LIST.rows && index < this.entries.length; row++, index++) {
      const area = rect(LIST.left, this.top + row * LIST.rowHeight, LIST.right, this.top + (row + 1) * LIST.rowHeight);
      const name = this.entries[index]!.name;
      if (this.mode === 2 && this.selected - 1 === index) drawOutlined(text, screen, "large", name, area, 0, COLOR.text, COLOR.selected);
      else text.drawText(screen, "large", name, area, 0, COLOR.text);
    }
    const right = this.buttons.find((b) => b.id === 13)!;
    const left = this.buttons.find((b) => b.id === 14)!;
    text.drawText(screen, "small", str(this.mode === 2 ? T.loadButton : T.saveButton), right.area, CENTERED, COLOR.text);
    text.drawText(screen, "small", str(T.cancel), left.area, CENTERED, COLOR.text);
    if (this.mode === 3) this.drawInput(env, screen, text);
  }

  /** Nom saisi à gauche du champ, curseur d'un point de large (haut et bas du champ) qui clignote. */
  private drawInput(env: Env, screen: Surface, text: TextService): void {
    const area = AREA.input;
    if (this.name !== "") text.drawText(screen, "large", this.name, area, 0, COLOR.text);
    const visible = (Math.floor((env.ctx.clock.ticks - this.openedAt) / CARET_STEP_TICKS) & 2) !== 0;
    if (!visible) return;
    const x = area.x + text.measure("large", this.name.slice(0, this.cursor));
    for (let y = area.y; y < area.y + area.h; y++) if (screen.visible(x, y)) screen.pixels[y * screen.width + x] = COLOR.text;
  }

  activate(env: Env, id: number): void {
    const d = env.dialogs;
    const count = this.entries.length;
    switch (id) {
      case 11:
        if (this.scroll > 0) this.scroll = Math.max(0, this.scroll - LIST.rows);
        break;
      case 12:
        if (count - LIST.rows > this.scroll) this.scroll = Math.min(this.scroll + LIST.rows, Math.max(0, count - LIST.rows));
        break;
      case 13:
        if (this.mode === 2) d.loadSelected(env.ctx, this);
        else d.saveNamed(env.ctx, this);
        break;
      case 14:
        d.closeTop(env.ctx, this.mode);
    }
  }

  /** Clic dans la liste (id 17, `11a0:3914`) : ligne = (y − haut) / 20, bornée à 19, plus le défilement ; deux clics en 30 ticks sur la même ligne la valident. */
  clickList(env: Env, y: number): void {
    const now = env.ctx.clock.ticks;
    let row = Math.floor((y - this.top) / LIST.rowHeight);
    if (row > 19) row = 19;
    const index = row + this.scroll + 1;
    if (this.selected === index && this.selected !== 0 && now - this.lastClick <= DOUBLE_CLICK_TICKS) {
      this.lastClick = now;
      this.press = { id: 13, due: now + PRESS_TICKS };
      return;
    }
    this.selected = index <= this.entries.length ? index : 0;
    this.lastClick = now;
  }

  /** Frappe dans le champ (`11a0:316d`) : caractère du jeu inséré au curseur (18 au plus), espaces de tête retirés, retour arrière et flèches. */
  type(env: Env, event: KeyEvent): boolean {
    if (event.code === "Backspace") {
      this.backspace();
      return true;
    }
    if (event.code === "ArrowLeft") {
      if (this.cursor > 0) this.cursor--;
      return true;
    }
    if (event.code === "ArrowRight") {
      if (this.cursor < this.name.length) this.cursor++;
      return true;
    }
    if (event.ctrl || event.alt || event.key.length !== 1) return false;
    this.insert(env, event.key);
    return true;
  }

  /** Efface le caractère avant le curseur. */
  backspace(): void {
    if (this.cursor === 0) return;
    this.name = this.name.slice(0, this.cursor - 1) + this.name.slice(this.cursor);
    this.cursor--;
  }

  /** Insère un caractère accepté par `canTypeChar` (jeu de caractères de la partie, 18 au plus) au curseur, puis retire les espaces de tête. */
  insert(env: Env, char: string): void {
    if (!canTypeChar(this.name, char, env.dialogs.saveStore.charset)) return;
    this.name = this.name.slice(0, this.cursor) + char + this.name.slice(this.cursor);
    this.cursor++;
    while (this.name.startsWith(" ")) {
      this.name = this.name.slice(1);
      this.cursor = Math.max(0, this.cursor - 1);
    }
  }
}

/** Modes 4 et 6 : une question et un ou deux boutons (`11a0:3914`, ids 15 et 16). */
class ConfirmLayer extends ButtonLayer {
  readonly mode: 4 | 6;

  constructor(
    env: Env,
    readonly spec: ConfirmSpec,
  ) {
    super();
    this.mode = spec.mode ?? 4;
    const buttons = buttonsOf(env, SCRB.confirm[1], 15);
    if (spec.no === undefined) {
      // Bouton unique : le bouton de gauche est retiré, celui de droite recule de 90 points (`11a0:3914`).
      const only = buttons[0]!;
      only.up = { ...only.up, x: only.up.x - 90 };
      only.down = { ...only.down, x: only.down.x - 90 };
      only.area = { ...only.area, x: only.up.x };
      this.buttons = [only];
    } else this.buttons = buttons;
  }

  hit(x: number, y: number): number | null {
    return this.hitButtons(x, y, [15, 16]);
  }

  draw(env: Env, screen: Surface): void {
    const text = textOf(env.ctx);
    drawCells(env, screen, SCRB.confirm[0]);
    for (const button of this.buttons) this.drawButton(env, screen, button);
    if (this.spec.message !== "") drawOutlined(text, screen, "large", this.spec.message, AREA.confirm, CENTERED, COLOR.outline, COLOR.text);
    for (const button of this.buttons) {
      const label = button.id === 15 ? this.spec.yes : (this.spec.no ?? "");
      if (label !== "") text.drawText(screen, "small", label, button.area, CENTERED, COLOR.text);
    }
  }

  activate(env: Env, id: number): void {
    const d = env.dialogs;
    d.closeTop(env.ctx, this.mode);
    if (id === 15) this.spec.onYes?.();
    else this.spec.onNo?.();
  }
}

/**
 * Mode 5 : cadre plein écran et défilement des crédits (`11a0:1c52`, `11a0:1f55`) : une ligne de 15 points toutes les 15 ticks, un point par tick.
 * Les deux Zoombinis du cadre (images 5 et 6 de `tBMP` 20, 69 × 92 et 58 × 92, en bas à droite et à gauche) ne sont **pas animés** : `11a0:1bd9` ne crée qu'une
 * feature (`11a0:1c0c`, rappels `1c52` / `1f55`), le `SCRB` 20 n'a qu'une image de six cases (quatre bandes et ces deux images) et aucun `SCRS` n'est chargé.
 */
class CreditsLayer implements Layer {
  readonly mode = 5;
  /** Zone de défilement (170…470 × 15…466) : fond noir, texte des crédits. */
  private readonly pane = new Surface(AREA.creditsPane.w, AREA.creditsPane.h);
  private tick = 0;
  private line = 0;
  private afterBlank = true;
  private ready = false;

  constructor() {
    this.pane.fill(COLOR.text);
  }

  /** Un tick de défilement (`11e8:32dc` : copie de la zone d'un point vers le haut) ; toutes les 15 ticks, une ligne est écrite en bas. */
  private advance(env: Env): void {
    const { w, h } = AREA.creditsPane;
    this.pane.pixels.copyWithin(0, w);
    this.pane.fill(COLOR.text, { x: 0, y: h - 1, w, h: 1 });
    this.tick++;
    if (this.tick < CREDITS_LINE_TICKS) return;
    this.tick = 0;
    const text = textOf(env.ctx);
    const first = text.strings.list(STRL_CREDITS_A).length;
    // Les lignes de `STRL` 2020 puis celles de 2021 ; la ligne « * » (fin de 2021) ramène au début.
    let str = this.line < first ? text.strings.get(STRL_CREDITS_A, this.line + 1) : text.strings.get(STRL_CREDITS_B, this.line - first + 1);
    if (str === "*" || str === null) {
      this.line = 0;
      str = text.strings.get(STRL_CREDITS_A, 1);
    }
    this.line++;
    if (str === null) return;
    if (str === "") {
      this.afterBlank = true;
      return;
    }
    // Rôle (après une ligne vide) en rouge, noms en orange.
    const color = this.afterBlank ? COLOR.creditsHeading : COLOR.creditsName;
    this.afterBlank = false;
    const line = AREA.creditsLine;
    text.drawText(this.pane, "small", str, { x: line.x - AREA.creditsPane.x, y: line.y - AREA.creditsPane.y, w: line.w, h: line.h }, CENTERED, color);
  }

  draw(env: Env, screen: Surface): void {
    if (this.ready) this.advance(env);
    this.ready = true;
    screen.fill(COLOR.text, AREA.creditsInterior);
    for (const cell of cellsOf(env.common, SCRB.credits)) {
      const shape = env.frame[cell.w - 1];
      if (shape) drawShape(screen, shape, cell.x, cell.y, 8);
    }
    const { x, y, w, h } = AREA.creditsPane;
    for (let row = 0; row < h; row++) screen.pixels.set(this.pane.pixels.subarray(row * w, (row + 1) * w), (y + row) * screen.width + x);
  }
}

/** Boîte « À propos » de `Ctrl+I` (`1198:0213`) : rectangle blanc cerné de noir, texte de `STRL` 1040 centré ; toute touche ou clic la ferme. */
class AboutLayer implements Layer {
  readonly mode = "about";

  draw(env: Env, screen: Surface): void {
    const text = textOf(env.ctx);
    const box = AREA.about;
    screen.fill(COLOR.black, box);
    screen.fill(COLOR.white, { x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2 });
    const inner = { x: box.x + 9, y: box.y + 9, w: box.w - 18, h: box.h - 18 };
    text.drawText(screen, "small", text.strings.get(STRL_VERSION, 2) ?? "", inner, CENTERED, COLOR.black);
  }
}

// --- Message de raccourci ---

interface FlashMessage {
  text: string;
  /** 0, 1 ou 2 : plaque de 87, 131 ou 198 points (`1168:224d`). */
  type: 0 | 1 | 2;
  until: number;
}

const PLAQUES: readonly Rect[] = [rect(277, 458, 364, 477), rect(257, 458, 387, 477), rect(237, 458, 437, 477)];

// --- Service ---

export class Dialogs {
  private readonly layers: Layer[] = [];
  private flash: FlashMessage | null = null;
  private snapshot: Uint8Array | null = null;
  /** Écran sous la boîte à son ouverture : si l'écran change, tout est abandonné sans restituer l'image. */
  private underScreen: number | undefined;
  private baseline: string;
  private readonly beforeSave: (() => void)[] = [];
  private readonly env: Env;
  /** Abonnement au champ de saisie invisible tant que la boîte d'enregistrement (mode 3) est au dessus ; `null` sinon. */
  private unsubscribeText: (() => void) | null = null;

  constructor(
    readonly common: Archive,
    ctx: ZoombinisContext,
  ) {
    const sheet = common.tbmpImages(SHEET);
    this.env = { ctx, dialogs: this, sheet, frame: common.tbmpImages(CREDITS_SHEET), plaques: common.tbmpImages(PLAQUE_SHEET), common };
    this.baseline = serializeGame(this.game);
  }

  private get zoombinis() {
    return this.env.ctx.services.get(ZOOMBINIS_GAME);
  }

  get game(): GameState {
    return this.zoombinis.game;
  }

  get saveStore() {
    return this.zoombinis.saves;
  }

  /** Une boîte est ouverte : les entrées lui reviennent et l'écran est recomposé à chaque tick. */
  get isOpen(): boolean {
    return this.layers.length > 0;
  }

  /** Modes ouverts, du dessous au dessus (4 et 6 sont rendus tels quels, « à propos » vaut `"about"`). */
  get modes(): readonly (DialogMode | "about")[] {
    return this.layers.map((layer) => layer.mode);
  }

  /** Question (ou message) de la boîte oui / non du dessus, `null` s'il n'y en a pas. */
  get prompt(): string | null {
    const top = this.layers[this.layers.length - 1];
    return top instanceof ConfirmLayer ? top.spec.message : null;
  }

  /** Message de raccourci affiché (texte), ou `null`. */
  get message(): string | null {
    return this.flash?.text ?? null;
  }

  /** Une action sur la partie ne s'applique qu'aux écrans 1 à 18 (`11a0:425e`, `4434`, `4493`). */
  inGameScreen(): boolean {
    const screen = this.zoombinis.session.screen;
    return screen >= FIRST_MENU_SCREEN && screen <= LAST_MENU_SCREEN;
  }

  /**
   * Ajoute une action avant chaque écriture de la partie depuis les dialogues (`11a0:141e` range le groupe courant dans la réserve de l'écran).
   * Renvoie la fonction qui la retire, à appeler par l'écran à sa sortie.
   */
  addBeforeSave(hook: () => void): () => void {
    this.beforeSave.push(hook);
    return () => {
      const index = this.beforeSave.indexOf(hook);
      if (index >= 0) this.beforeSave.splice(index, 1);
    };
  }

  // --- Ouverture ---

  /** `11a0:1737(mode)` : ouvre un mode (sauf 4 et 6, qui demandent `confirm`). Ignoré si ce mode est déjà ouvert ou si un écran change. */
  open(ctx: ZoombinisContext, mode: 1 | 2 | 3 | 5): void {
    switch (mode) {
      case 1:
        this.openMenu(ctx);
        break;
      case 2:
        this.openLoad(ctx);
        break;
      case 3:
        this.openSave(ctx);
        break;
      case 5:
        this.openCredits(ctx);
    }
  }

  /** `11a0:1737` ne fait rien tant qu'un changement d'écran est en cours (`DS:8554 != −1`) ou qu'un écran se charge. */
  private available(ctx: ZoombinisContext): boolean {
    return ctx.scenes.current !== undefined && !ctx.scenes.isLoading && ctx.scenes.pending === null;
  }

  private has(mode: DialogMode | "about"): boolean {
    return this.layers.some((layer) => layer.mode === mode || (mode === 4 && layer.mode === 6) || (mode === 6 && layer.mode === 4));
  }

  private push(ctx: ZoombinisContext, layer: Layer): void {
    this.dismissMessage();
    this.takeSnapshot(ctx);
    this.layers.push(layer);
    this.syncTextInput();
    ctx.requestPresent();
  }

  /**
   * Le champ de nom (mode 3 au dessus de la pile) reçoit aussi le texte du champ invisible de l'hôte (`Host.textInput`) : clavier
   * virtuel, caractères composés. Il prend le focus à l'ouverture (geste du joueur) et le rend au canvas dès que la boîte n'est plus
   * au dessus. Les touches physiques passent par `handleKey`, le champ ne relaie que ce qui n'en vient pas (pas de double saisie).
   */
  private syncTextInput(): void {
    const port = (this.env.ctx.host as Host).textInput;
    if (!port) return;
    const top = this.layers[this.layers.length - 1];
    const wanted = top instanceof ListLayer && top.mode === 3;
    if (wanted && !this.unsubscribeText) {
      this.unsubscribeText = port.onText((text) => this.typeText(text));
      port.focus();
    } else if (!wanted && this.unsubscribeText) {
      this.unsubscribeText();
      this.unsubscribeText = null;
      port.blur();
    }
  }

  /** Texte venu du champ invisible (`TextInputPort.onText`) : `\b` efface, `\n` valide (Entrée), le reste est inséré caractère par caractère. */
  private typeText(text: string): void {
    const top = this.layers[this.layers.length - 1];
    if (!(top instanceof ListLayer) || top.mode !== 3 || top.press) return;
    for (const char of text) {
      if (char === "\b") top.backspace();
      else if (char === "\n") this.press(this.env.ctx, top, 13);
      else top.insert(this.env, char);
    }
  }

  openMenu(ctx: ZoombinisContext): void {
    if (!this.available(ctx) || this.has(1)) return;
    this.push(ctx, new MenuLayer(this.env));
  }

  /** `11a0:4434` : liste des parties ; sans partie enregistrée, le message « aucune partie » ; en entraînement, le refus. */
  openLoad(ctx: ZoombinisContext): void {
    if (!this.inGameScreen() || this.has(2)) return;
    if (this.zoombinis.session.training !== 0) {
      this.info(ctx, T.noTrainingLoad);
      return;
    }
    if (this.saveStore.list().length === 0) {
      this.info(ctx, T.noSave);
      return;
    }
    this.push(ctx, new ListLayer(this.env, 2, LIST.loadTop));
  }

  /** `11a0:4493` : saisie du nom et liste ; en entraînement, le refus. */
  openSave(ctx: ZoombinisContext): void {
    if (!this.inGameScreen() || this.has(3)) return;
    if (this.zoombinis.session.training !== 0) {
      this.info(ctx, T.noTrainingSave);
      return;
    }
    this.push(ctx, new ListLayer(this.env, 3, LIST.saveTop));
  }

  /** Mode 5 : crédits (`STRL` 2020 puis 2021), toute touche ou clic les ferme ; le son des crédits démarre. */
  openCredits(ctx: ZoombinisContext): void {
    if (this.has(5)) return;
    this.push(ctx, new CreditsLayer());
    ctx.services.get(ZOOMBINIS_SOUND).queue(CREDITS_SOUND);
  }

  /** `1198:0213` : boîte « À propos » (`STRL` 1040). */
  openAbout(ctx: ZoombinisContext): void {
    if (this.has("about")) return;
    this.push(ctx, new AboutLayer());
  }

  /** Modes 4 et 6 : question oui / non, ou message à bouton unique si `no` est absent. Un seul à la fois (`DS:a2da & 8`). */
  confirm(ctx: ZoombinisContext, spec: ConfirmSpec): void {
    if (this.has(4)) return;
    this.push(ctx, new ConfirmLayer(this.env, spec));
  }

  /** Message à bouton unique (« ok », `STRL` 2018 n° 21) pour un texte de `STRL` 2018. */
  private info(ctx: ZoombinisContext, index: number): void {
    const text = textOf(ctx);
    this.confirm(ctx, { message: text.strings.get(STRL_DIALOG, index) ?? "", yes: text.strings.get(STRL_DIALOG, T.okMessage) ?? "" });
  }

  /** Message d'une erreur de sauvegarde : les chaînes de `SAVE_ERROR_STRL`, une par ligne. */
  private showError(ctx: ZoombinisContext, error: SaveError): void {
    const text = textOf(ctx);
    const lines = SAVE_ERROR_STRL[error.kind].map(([list, index]) => text.strings.get(list, index + 1) ?? "");
    this.confirm(ctx, { message: lines.join("\r"), yes: text.strings.get(STRL_DIALOG, T.okMessage) ?? "" });
  }

  /** `1198:0213`-like : « Avertissement de retour à la carte » : voir `confirmLeaveToMap`. */
  confirmLeaveToMap(ctx: ZoombinisContext, onConfirm: () => void, onCancel?: () => void): void {
    const text = textOf(ctx);
    this.confirm(ctx, {
      message: text.strings.get(STRL_DIALOG, T.leaveMessage) ?? "",
      yes: text.strings.get(STRL_DIALOG, T.leaveYes) ?? "",
      no: text.strings.get(STRL_DIALOG, T.leaveNo) ?? "",
      onYes: onConfirm,
      onNo: onCancel,
    });
  }

  // --- Fermeture ---

  /** Ferme la couche du mode donné (la plus haute de ce mode). */
  closeTop(ctx: ZoombinisContext, mode: DialogMode | "about"): void {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i]!;
      if (layer.mode === mode || (mode === 4 && layer.mode === 6) || (mode === 6 && layer.mode === 4)) {
        this.layers.splice(i, 1);
        if (layer.mode === 5) ctx.services.get(ZOOMBINIS_SOUND).stopEffects();
        break;
      }
    }
    this.syncTextInput();
    if (this.layers.length === 0) this.restore(ctx);
    else ctx.requestPresent();
  }

  closeAll(ctx: ZoombinisContext): void {
    const credits = this.has(5);
    this.layers.length = 0;
    this.syncTextInput();
    if (credits) ctx.services.get(ZOOMBINIS_SOUND).stopEffects();
    this.restore(ctx);
  }

  private restore(ctx: ZoombinisContext): void {
    this.underScreen = undefined;
    if (this.snapshot) {
      const screen = ctx.services.get(GRAPHICS).screen;
      screen.pixels.set(this.snapshot);
      this.snapshot = null;
      ctx.services.get(FEATURES).invalidate();
      ctx.requestPresent();
    }
  }

  // --- Actions sur la partie ---

  /** Une partie est-elle à enregistrer ? Équivaut à `DS:87e4 != 0` (posé à chaque changement, remis à 0 par l'écriture ou le chargement) : l'état diffère du dernier enregistré. */
  isDirty(): boolean {
    const { session } = this.zoombinis;
    if (session.name !== null) {
      try {
        return serializeGame(this.saveStore.load(session.name)) !== serializeGame(this.game);
      } catch {
        return true;
      }
    }
    return serializeGame(this.game) !== this.baseline;
  }

  /** `11a0:425e` : nouvelle partie, après confirmation (`STRL` 2018 n° 22 si la partie a changé, n° 37 sinon) ; refusée en entraînement. */
  newGame(ctx: ZoombinisContext): void {
    if (!this.inGameScreen()) return;
    if (this.zoombinis.session.training !== 0) {
      this.info(ctx, T.noTrainingNewGame);
      return;
    }
    if (this.has(4)) return;
    const text = textOf(ctx);
    this.confirm(ctx, {
      message: text.strings.get(STRL_DIALOG, this.isDirty() ? T.unsavedNewGame : T.sureNewGame) ?? "",
      yes: text.strings.get(STRL_DIALOG, T.newGameButton) ?? "",
      no: text.strings.get(STRL_DIALOG, T.cancel) ?? "",
      onYes: () => this.startNewGame(ctx),
    });
  }

  /** `11a0:416c` : partie neuve (`newGameInPlay`), reprise sur place sans transition (carte si on y est, sinon le choix des Zoombinis). */
  startNewGame(ctx: ZoombinisContext): void {
    const zb = this.zoombinis;
    const { game, screen } = newGameInPlay(zb.session);
    zb.game = game;
    this.baseline = serializeGame(game);
    this.closeAll(ctx);
    zb.goTo(ctx, screen);
  }

  /** Charge la partie choisie (`11a0:3914`, id 13 du mode 2) puis reprend à son écran de reprise (`1160:0521`). */
  loadSelected(ctx: ZoombinisContext, layer: ListLayer): void {
    const entry = layer.entries[layer.selected - 1];
    if (!entry) return;
    const zb = this.zoombinis;
    let game: GameState;
    try {
      game = this.saveStore.load(entry.name);
    } catch (error) {
      if (error instanceof SaveError) this.showError(ctx, error);
      else throw error;
      return;
    }
    zb.game = game;
    zb.session.name = entry.name;
    zb.session.training = 0;
    zb.session.levelRaised = false;
    zb.session.leftToMap = false;
    this.baseline = serializeGame(game);
    const screen = resumeScreen(game, zb.session);
    this.closeAll(ctx);
    zb.goTo(ctx, screen);
  }

  /** Enregistre sous le nom saisi (`11a0:3914`, id 13 du mode 3) : confirmation si le nom existe, refus au-delà de 50 parties. */
  saveNamed(ctx: ZoombinisContext, layer: ListLayer, confirmed = false): void {
    const name = normalizeName(layer.name, this.saveStore.charset);
    if (name === null) return;
    const text = textOf(ctx);
    if (!confirmed && this.saveStore.find(name) !== null) {
      this.confirm(ctx, {
        message: `${text.strings.get(STRL_DIALOG, T.replaceMessage) ?? ""}${name}${REPLACE_SUFFIX}`,
        yes: text.strings.get(STRL_DIALOG, T.replaceButton) ?? "",
        no: text.strings.get(STRL_DIALOG, T.cancel) ?? "",
        onYes: () => this.saveNamed(ctx, layer, true),
      });
      return;
    }
    const zb = this.zoombinis;
    try {
      for (const hook of this.beforeSave) hook();
      this.saveStore.save(name, zb.game);
    } catch (error) {
      if (error instanceof SaveError) this.showError(ctx, error);
      else throw error;
      return;
    }
    zb.session.name = name;
    this.baseline = serializeGame(zb.game);
    layer.entries = this.saveStore.list();
    this.closeTop(ctx, 3);
  }

  /**
   * `11a0:44f2` : quitter. Menu ouvert : « Es-tu sûr de vouloir quitter? » d'abord. Puis (`1160:05c9`) : en aventure sur un écran 1 à 18, si la partie a changé,
   * « veux-tu sauver ta partie avant de quitter? » (oui : la boîte d'enregistrement, puis la sortie ; non : sortie) ; sinon sortie directe.
   */
  quit(ctx: ZoombinisContext): void {
    const text = textOf(ctx);
    if (this.has(1)) {
      if (this.has(4)) return;
      this.confirm(ctx, {
        message: text.strings.get(STRL_DIALOG, T.sureQuit) ?? "",
        yes: text.strings.get(STRL_DIALOG, T.quitYes) ?? "",
        no: text.strings.get(STRL_DIALOG, T.quitNo) ?? "",
        onYes: () => {
          this.closeAll(ctx);
          this.leave(ctx);
        },
      });
      return;
    }
    this.leave(ctx);
  }

  private leave(ctx: ZoombinisContext): void {
    const zb = this.zoombinis;
    const text = textOf(ctx);
    if (zb.session.training === 0 && this.inGameScreen() && this.isDirty()) {
      this.confirm(ctx, {
        message: text.strings.get(STRL_DIALOG, T.quitUnsaved) ?? "",
        yes: text.strings.get(STRL_DIALOG, T.quitUnsavedYes) ?? "",
        no: text.strings.get(STRL_DIALOG, T.quitUnsavedNo) ?? "",
        onYes: () => this.openSaveThenExit(ctx),
        onNo: () => this.exit(ctx),
      });
      return;
    }
    this.exit(ctx);
  }

  /** Ouvre l'enregistrement ; la boîte fermée (enregistrée ou annulée), le jeu s'arrête (`DS:22fa`). */
  private openSaveThenExit(ctx: ZoombinisContext): void {
    this.openSave(ctx);
    if (!this.has(3)) {
      this.exit(ctx);
      return;
    }
    this.afterSave = () => this.exit(ctx);
  }

  private afterSave: (() => void) | null = null;

  private exit(ctx: ZoombinisContext): void {
    this.zoombinis.session.quitting = true;
    this.closeAll(ctx);
    ctx.host.exit();
  }

  // --- Options ---

  /**
   * Bascule une option de la partie, comme `11a0:35ca` (boutons du menu) et `1198:05b3` (raccourcis) : l'option, les préférences de session
   * (appliquées sans attendre le prochain tick) et, pour le son, la file correspondante (la musique rallumée rappelle la dernière, `11a0:0ee7(0, 0)`).
   * Renvoie la nouvelle valeur de l'option.
   */
  toggleOption(ctx: ZoombinisContext, key: OptionKey): boolean {
    const options = this.game.options;
    const value = !options[key];
    options[key] = value;
    const sound = ctx.services.get(ZOOMBINIS_SOUND);
    switch (key) {
      case "effects":
        ctx.prefs.effects = value;
        sound.effectsEnabled = value;
        break;
      case "music":
        ctx.prefs.music = value;
        sound.musicEnabled = value;
        if (value) sound.queue(0);
        break;
      case "magneticMouse":
        ctx.prefs.magneticMouse = value;
        break;
      case "autoMagnet":
        ctx.prefs.autoMagnet = value;
        break;
      case "transitionsOff":
        ctx.prefs.transitions = !value;
        break;
      case "hideCursorWhileCarrying":
        ctx.prefs.hideCursorWhileCarrying = value;
        break;
      case "lessAction":
        break;
    }
    return value;
  }

  // --- Message de raccourci ---

  /**
   * `1168:2117` : plaque de message au bas de l'écran pendant 90 ticks ; sans effet tant qu'une boîte est ouverte (`DS:a2da`). `message` : indice dans `STRL` 2023,
   * ou texte tel quel (chaînes du programme, non traduites, du mode de test : « you got it », « midi test on »…).
   */
  showMessage(ctx: ZoombinisContext, message: number | string, type: 0 | 1 | 2): void {
    if (this.isOpen) return;
    const text = typeof message === "string" ? message : textOf(ctx).strings.get(STRL_OPTIONS, message);
    if (text === null) return;
    this.takeSnapshot(ctx);
    this.flash = { text, type, until: ctx.clock.ticks + MESSAGE_TICKS };
    ctx.requestPresent();
  }

  private takeSnapshot(ctx: ZoombinisContext): void {
    if (this.snapshot) return;
    this.snapshot = ctx.services.get(GRAPHICS).screen.pixels.slice();
    this.underScreen = ctx.scenes.currentId;
  }

  private dismissMessage(): void {
    this.flash = null;
  }

  // --- Entrées ---

  /** Touche reçue pendant qu'une boîte est ouverte (`11a0:316d`) ; toujours consommée. */
  handleKey(ctx: ZoombinisContext, event: KeyEvent): boolean {
    const top = this.layers[this.layers.length - 1];
    if (!top) return false;
    if (top.mode === 5 || top.mode === "about") {
      if (!event.repeat) this.closeTop(ctx, top.mode);
      return true;
    }
    const layer = top as ButtonLayer;
    if (layer.press) return true;
    if (layer instanceof ListLayer && layer.mode === 3 && layer.type(this.env, event)) return true;
    if (event.repeat) return true;
    const id = this.keyButton(layer, event);
    if (id !== null) this.press(ctx, layer, id);
    else if (this.isQuitKey(event) && layer.mode !== 1) this.quitFromDialog(ctx);
    return true;
  }

  private isQuitKey(event: KeyEvent): boolean {
    return event.ctrl && !event.alt && letterOf(event) === "q";
  }

  /** Ctrl+Q avec une autre boîte au-dessus du menu : tout se ferme et le jeu se quitte (`11a0:316d`, touche 0x11). */
  private quitFromDialog(ctx: ZoombinisContext): void {
    this.closeAll(ctx);
    this.quit(ctx);
  }

  /** Touches des boutons (table `cs:349f` de `11a0:316d`). */
  private keyButton(layer: ButtonLayer, event: KeyEvent): number | null {
    const mode = layer.mode;
    const enter = event.code === "Enter" || event.code === "NumpadEnter";
    if (enter) return mode === 1 ? 9 : mode === 4 || mode === 6 ? 15 : 13;
    if (event.code === "Escape") {
      if (mode === 4 || mode === 6) return (layer as ConfirmLayer).spec.no === undefined ? null : 16;
      return mode === 2 || mode === 3 ? 14 : null;
    }
    if (mode === 2 || mode === 3) {
      if (event.code === "ArrowUp") return 11;
      if (event.code === "ArrowDown") return 12;
      return null;
    }
    if (mode !== 1 || !event.ctrl || event.alt) return null;
    switch (letterOf(event)) {
      case "n":
        return 1;
      case "l":
        return 2;
      case "s":
        return 3;
      case "q":
        return 4;
      case "v":
      case "b":
        return 5;
      case "y":
        return 6;
      case "j":
        return 7;
      case "t":
        return 8;
      default:
        return null;
    }
  }

  /** Clic reçu pendant qu'une boîte est ouverte (`11a0:34d3`) : n'importe quel bouton de la souris ; seul le dessus réagit. */
  handleClick(ctx: ZoombinisContext, event: ButtonEvent): void {
    const top = this.layers[this.layers.length - 1];
    if (!top || !event.down) return;
    if (top.mode === 5 || top.mode === "about") {
      this.closeTop(ctx, top.mode);
      return;
    }
    const layer = top as ButtonLayer;
    if (layer.press) return;
    const id = layer.hit(event.x, event.y);
    if (id === null) return;
    if (id === 17 && layer instanceof ListLayer) {
      layer.clickList(this.env, event.y);
      return;
    }
    this.press(ctx, layer, id);
  }

  private press(ctx: ZoombinisContext, layer: ButtonLayer, id: number): void {
    if (!layer.buttons.some((b) => b.id === id)) return;
    ctx.services.get(ZOOMBINIS_SOUND).queue(CLICK_SOUND);
    layer.press = { id, due: ctx.clock.ticks + PRESS_TICKS };
  }

  /** L'écran sous la boîte a changé (changement d'écran demandé par un autre moyen) : la boîte et le message disparaissent, l'image enregistrée est périmée. */
  private abandon(ctx: ZoombinisContext): void {
    const credits = this.has(5);
    this.layers.length = 0;
    this.syncTextInput();
    this.flash = null;
    this.snapshot = null;
    this.underScreen = undefined;
    this.afterSave = null;
    if (credits) ctx.services.get(ZOOMBINIS_SOUND).stopEffects();
    ctx.requestPresent();
  }

  /** Un tick : déclenche les boutons arrivés à échéance, avance le défilement, recompose l'écran puis dessine les couches et le message. */
  tick(ctx: ZoombinisContext): void {
    if ((this.isOpen || this.flash) && ctx.scenes.currentId !== this.underScreen) this.abandon(ctx);
    const wasOpen = this.isOpen;
    for (const event of ctx.input.buttonEvents) this.handleClick(ctx, event);
    if (wasOpen) ctx.input.flush();
    for (const layer of [...this.layers]) {
      if (!(layer instanceof ButtonLayer) || !layer.press || ctx.clock.ticks < layer.press.due) continue;
      const { id } = layer.press;
      layer.press = null;
      layer.activate(this.env, id);
    }
    if (this.flash && ctx.clock.ticks >= this.flash.until) {
      this.flash = null;
      if (!this.isOpen) this.restore(ctx);
    }
    if (this.afterSave && !this.has(3)) {
      const next = this.afterSave;
      this.afterSave = null;
      next();
    }
    if (!this.isOpen && !this.flash) return;
    const features = ctx.services.get(FEATURES);
    const { screen } = ctx.services.get(GRAPHICS);
    features.compose();
    const credits = this.layers.find((layer) => layer.mode === 5);
    if (credits) credits.draw(this.env, screen);
    else for (const layer of this.layers) layer.draw(this.env, screen);
    if (this.flash) this.drawMessage(ctx, screen);
    ctx.requestPresent();
  }

  /** `1168:224d` : plaque `tBMP` 3001 n° 1 + type et texte centré (couleur 45). */
  private drawMessage(ctx: ZoombinisContext, screen: Surface): void {
    const flash = this.flash!;
    const area = PLAQUES[flash.type]!;
    const shape = this.env.plaques[flash.type];
    if (shape) drawShape(screen, shape, area.x, area.y, 8);
    textOf(ctx).drawText(screen, "small", flash.text, area, CENTERED, COLOR.text);
  }
}

/** Lettre d'un raccourci avec Ctrl : la lettre tapée (clavier AZERTY compris), sinon celle de la touche physique. */
export function letterOf(event: KeyEvent): string | null {
  if (event.key.length === 1) return event.key.toLowerCase();
  const match = /^Key([A-Z])$/.exec(event.code);
  return match ? match[1]!.toLowerCase() : null;
}

export const DIALOG = defineService<Dialogs>("zoombinis.dialog");

/**
 * Installe le service `DIALOG` (après `installGame` et `installFeatures`, dont les crochets de tick passent avant) : ouvre `ZOOMBINI.MHK` (déjà
 * gardé par `installServices`), ajoute le crochet de tick et le gestionnaire de touches `before` qui prend toutes les touches tant qu'une boîte est ouverte.
 * Sans effet si le service est déjà installé.
 */
export async function installDialog(engine: ZoombinisEngine): Promise<Dialogs> {
  const existing = engine.services.tryGet(DIALOG);
  if (existing) return existing;
  const { ctx } = engine;
  const common = await ctx.resources.open(COMMON_ARCHIVE, "persistent");
  const dialogs = new Dialogs(common, ctx);
  engine.services.provide(DIALOG, dialogs);
  engine.addKeyHandler("before", (event, c) => dialogs.handleKey(c, event));
  engine.addTickHook((c) => dialogs.tick(c));
  return dialogs;
}

/**
 * Avertissement de retour à la carte (« Ce groupe de zoombinis sera perdu si tu retournes a la carte », boutons « Tant pis... » et « Ah non ! », `STRL` 2018 n° 1 à 3 ;
 * `screens.md` §3.4). `onConfirm` est appelé si le joueur accepte (« Tant pis... ») ; « Ah non ! » referme la boîte.
 */
export function confirmLeaveToMap(ctx: ZoombinisContext, onConfirm: () => void, onCancel?: () => void): void {
  ctx.services.get(DIALOG).confirmLeaveToMap(ctx, onConfirm, onCancel);
}
