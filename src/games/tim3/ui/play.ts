/**
 * Écran de jeu, sans DOM : pointeur et clavier traduits en actions de l'éditeur et de la session, et image 640×480 de
 * l'écran (aire, barre d'outils, bac, barre de but, pièce tenue, poignées, liens en cours, indice).
 *
 * Glisser-déposer unifié (plan D8) : souris et doigt passent par les mêmes appuis. On prend une pièce du bac ou de l'aire, on
 * la glisse, on la lâche ; un simple appui sans glisser la garde en main (comme le clic de l'original, qui prend puis pose en
 * deux clics). Au doigt, la pièce tenue est dessinée au-dessus du doigt (`TOUCH_LIFT`), un appui sur une pièce posée la
 * sélectionne (ses poignées s'affichent) et un appui long dans le bac donne le nom et la description de la pièce.
 *
 * Labo : cadenas et poignée « solution » des pièces (`Zone.Lock`, `Zone.Solution`), plans des décors (`Zone.Back`, `Zone.Front`),
 * mains des indices du puzzle maison avec leurs poignées (41ffd0 : effacer en haut à gauche, tourner en bas à gauche, modifier en bas à droite ; un appui sur la main la déplace,
 * 42057e), pose d'une nouvelle main (42057e après « Nouveau »), tracé d'un rectangle (« Endroit précis » de `SOLVE.ITF`), barre du but
 * à écrire (414fc1), onglets du bac (`engine/bin-tabs.ts`, `drawBinTabs`).
 *
 * Deux joueurs (mode 2) : tableau des joueurs à droite de la barre du but (`H2H.ITF`, `render/duel-board.ts`) ; la règle du tour de
 * l'éditeur (`EditGuard`) rend les pièces interdites ce tour insensibles au survol (43013e) et un appui sur elles, ou sur le bac
 * fermé, demande le refus du jeu (`duelRefused`).
 */
import { HELP_BIN, HELP_GOAL } from "../data/help";
import type { Level } from "../data/lev";
import { readItf, type Itf } from "../data/itf";
import type { Duel } from "../engine/duel";
import type { PartInfo } from "../data/text";
import { FIELD_HEIGHT, FIELD_WIDTH, HANDLE_SIZE, HANDLE_STATES, Zone, type HeldPreview, type ZoneId } from "../engine/editor";
import { LAB_TAB_COUNT } from "../engine/bin-tabs";
import { HINT_HEIGHT, HINT_WIDTH } from "../engine/lab-puzzle";
import type { Part } from "../engine/part";
import type { Tim3Session } from "../engine/session";
import {
  BIN_LEFT,
  BIN_PANEL,
  BIN_PLAY,
  BIN_RIGHT,
  BIN_TAB_BUTTON,
  DUEL_GOAL_WIDTH,
  GOALBAR,
  PLAYFIELD,
  TOOLBAR,
  binLayout,
  binScrollStep,
  binTabCell,
  composeScreen,
  drawBinIcon,
  drawBinOverlay,
  drawBinTabs,
  drawDuelBoard,
  drawFieldRect,
  drawGoalBar,
  drawHandles,
  drawHeldPart,
  drawHintArrow,
  drawRubberBand,
  hintRect,
  inRect,
  nextHandleFrame,
  stateImage,
  type BinLayout,
  type BinSlot,
  type HandleView,
  type Rect,
  type RenderAssets,
  type Surface,
} from "../render";
import { toolbarStates, type ToolbarButtonState } from "./toolbar";

/** Décalage (pixels logiques) de la pièce tenue au-dessus du doigt. */
export const TOUCH_LIFT = 40;
/** Déplacement (pixels logiques) au-delà duquel un appui devient un glisser. */
export const DRAG_SLOP = 4;

/** Bouton de la barre d'outils (`WTOOLBAR.ITF`), en coordonnées de l'écran. */
export interface ToolbarButton extends Rect {
  name: string;
  /** Identifiant du contrôle : clé de l'infobulle `DESCRIPT.RES`. */
  id: number;
}

/** Bouton montré dans la barre (géométrie et état selon le mode). */
export type ShownButton = ToolbarButton & Pick<ToolbarButtonState, "pressed" | "disabled">;

/** Ce que l'écran demande à l'application (dialogues DOM, son). */
export type PlayEvent =
  | { type: "toolbar"; name: string }
  | { type: "start" }
  | { type: "stop" }
  | { type: "info"; partType: number; anchor: Rect }
  | { type: "program"; part: Part }
  /** Une pièce posée a été retournée (42e8bb, 42e8fa, 42e939 : sa condition de réussite suit, 429d84). */
  | { type: "flipped"; part: Part }
  | { type: "tip"; partType: number; anchor: Rect }
  | { type: "toolbarTip"; button: ShownButton }
  | { type: "tipEnd" }
  | { type: "goal" }
  /** Clic sur la main d'un indice (42013d) : son emplacement dans le LEV (0 à 7). */
  | { type: "hint"; slot: number }
  | { type: "sound"; name: "pick" | "drop" | "refused" | "remove" }
  /** Mode aide (41e6b7) : l'élément choisi d'un appui. */
  | { type: "helpPick"; target: HelpTarget }
  /** Mode aide : Échap l'abandonne (ajout du port). */
  | { type: "helpCancel" }
  /** Labo : poignée du cadenas (42e9d8), la pièce est maintenant verrouillée ou non. */
  | { type: "locked"; locked: boolean }
  /** Labo : poignée « solution » (42ea99 → `SOLVE.ITF`). */
  | { type: "solution"; part: Part }
  /** Labo : main d'un indice, poignée « modifier » (41ffd0 → 0x20 : `HINT.ITF`), « effacer » (0x40 : 31122 d'abord). */
  | { type: "hintEdit"; slot: number }
  | { type: "hintDelete"; slot: number }
  /** Labo : main tournée ou déplacée (puzzle maison changé). */
  | { type: "hintChanged" }
  /** Labo : la nouvelle main est posée (42057e), en (x, y) de l'aire. */
  | { type: "hintPlaced"; x: number; y: number }
  /** Labo : rectangle tracé dans l'aire (« Endroit précis »), coordonnées de l'aire. */
  | { type: "rectDrawn"; rect: Rect }
  /** Pose d'une main ou tracé abandonné (Échap). */
  | { type: "placeCancel" }
  /** Labo : un appui sur la barre du but l'ouvre à l'écriture (414fc1). */
  | { type: "goalEdit" }
  /** Labo : onglet du bac choisi. */
  | { type: "tab"; tab: number }
  /** Deux joueurs : le bac est fermé ce tour (418207 → 31153) ou la pièce n'est pas celle déjà touchée (43013e → 31152). */
  | { type: "duelRefused"; reason: "bin" | "moved" };

/**
 * Élément sous le pointeur en mode aide (41e85c) : un contrôle (son identifiant, clé de `HELP.RES`), une pièce posée (sa description,
 * `INFO.ITF`, 41ea8b), ou rien (« Je suis désolé… »).
 */
export type HelpTarget = { kind: "control"; id: number } | { kind: "part"; partType: number } | { kind: "none" };

/** Contrôles du panneau du bac (`PARTSBIN.ITF`) qui ont leur aide : drapeau, flèches. */
export const BIN_HELP = { play: 11003, left: 11001, right: 11002 } as const;

export interface PlayTexts {
  goal: string;
  hints: string[];
  parts: PartInfo[];
}

/** Main d'indice visible : emplacement LEV, position et texte. */
export interface HintView {
  slot: number;
  x: number;
  y: number;
  flip: number;
  text: string;
}

/** Zones d'une main d'indice au Labo (41ffd0). */
type HintZone = "remove" | "flip" | "edit" | "body";

interface Drag {
  kind: "bin" | "field" | "resize" | "pending" | "press" | "hint" | "rect";
  part: Part | null;
  zone?: ZoneId;
  startX: number;
  startY: number;
  moved: boolean;
  touch: boolean;
  /** Bouton d'interface appuyé (relâché dessus = clic). */
  button?: string;
  /** La pièce vient d'être prise par cet appui (relâchée sans glisser, elle reste en main). */
  fresh?: boolean;
  /** Main d'indice déplacée : emplacement et écart du pointeur. */
  slot?: number;
  grabX?: number;
  grabY?: number;
}

/** Curseur CSS selon la zone (le port garde les curseurs du système, plus nets que ceux de `CURSORS.BMP`). */
export type CursorKind = "default" | "pointer" | "grab" | "grabbing" | "ew-resize" | "ns-resize" | "not-allowed" | "copy" | "help" | "crosshair";

export class PlayScreen {
  /** Défilement horizontal du bac, en pixels (borné par `binLayout`). */
  binScroll = 0;
  /** Pièce posée dont les poignées sont affichées (survol à la souris, sélection au doigt). */
  focus: Part | null = null;
  /** Mains des indices affichées (4204cf / 420536 : toutes à la fois, `[0x472938]`). */
  hintsShown = false;
  /** Texte qui remplace le but dans la barre (message de l'interface), jusqu'au prochain geste. */
  message: string | null = null;
  /** Le puzzle ouvert a déjà été résolu : l'ampoule « Montrer la solution » apparaît (42d210). */
  solved = false;
  /** Mode aide (41e6b7) : le prochain appui choisit l'élément à expliquer au lieu d'agir. */
  helpPicking = false;
  /** Essai du puzzle maison (mode 8) : barre d'outils du Labo, levier enfoncé. */
  test = false;
  /** Visite guidée (mode 6) : barre du Labo réduite, portrait du professeur, chaussure enfoncée. */
  walkthrough = false;
  /** Labo : onglet du bac (`[0x471f90]`) et choix des onglets ouvert. */
  binTab = 0;
  tabPicker = false;
  /** Labo : pose d'une nouvelle main d'indice, ou tracé d'un rectangle (`SOLVE.ITF`). */
  placing: "hint" | "rect" | null = null;
  /** Mode à deux joueurs : le match en cours (tableau, barre d'outils). */
  duel: Duel | null = null;
  private boardItf: Itf | null = null;
  /** Main d'indice dont les poignées sont montrées (Labo). */
  private hintFocus: number | null = null;
  /** Rectangle en cours de tracé (coordonnées de l'aire). */
  private rect: Rect | null = null;
  private drag: Drag | null = null;
  private pointer = { x: -1, y: -1, touch: false, inside: false };
  private preview: HeldPreview = { valid: true };
  private handleFrames = new Map<number, number>();
  private hoverZone: ZoneId = Zone.None;

  constructor(
    public session: Tim3Session,
    readonly assets: RenderAssets,
    readonly level: Level,
    readonly texts: PlayTexts,
    readonly toolbar: readonly ToolbarButton[],
    private readonly emit: (event: PlayEvent) => void,
  ) {}

  get editor() {
    return this.session.editor;
  }

  /** Indices non vides du puzzle (texte français de `LEVELS.INF`, position du LEV ; au Labo, le puzzle maison). */
  get hintCount(): number {
    return this.hintList().length;
  }

  /** Emplacements LEV (0 à 7) des indices non vides. */
  hintSlots(): number[] {
    return this.hintList().map((h) => h.slot);
  }

  /** Mains d'indice : au Labo, celles du puzzle maison (modifiables) ; sinon celles du LEV, avec les textes donnés. */
  hintList(): HintView[] {
    const lab = this.session.labPuzzle;
    if (lab) return lab.hints.flatMap((h, slot) => (h.text !== "" ? [{ slot, x: h.x, y: h.y, flip: h.flip ?? 0, text: h.text }] : []));
    return this.texts.hints.flatMap((text, slot) => {
      const h = this.level.hints[slot];
      return text !== "" && h ? [{ slot, x: h.x, y: h.y, flip: h.flip ?? 0, text }] : [];
    });
  }

  /** Main d'indice sous le point (contrôle de 44 × 43 en x, y de l'emplacement, 41ef54), si les indices sont affichés. */
  hintAt(x: number, y: number): number | null {
    if (!this.hintsShown || this.session.running) return null;
    for (const h of this.hintList()) if (inRect(hintRect(h.x, h.y), x, y)) return h.slot;
    return null;
  }

  /** 41ffd0 : zone d'une main au Labo (poignées à 36 px autour du contrôle de 44 × 43), point de l'écran. */
  private hintZone(h: HintView, x: number, y: number): HintZone | null {
    const r = hintRect(h.x, h.y);
    const left = r.x - HANDLE_SIZE;
    const top = r.y - HANDLE_SIZE;
    const bottom = r.y + r.height;
    const right = r.x + r.width;
    if (x >= left && x < r.x && y >= top && y < r.y) return "remove";
    if (x >= left && x < r.x && y >= bottom && y < bottom + HANDLE_SIZE) return "flip";
    if (x >= right && x < right + HANDLE_SIZE && y >= bottom && y < bottom + HANDLE_SIZE) return "edit";
    return inRect(r, x, y) ? "body" : null;
  }

  /** Main et zone sous le point au Labo : d'abord les poignées de la main en vue, puis le corps d'une main. */
  private labHintAt(x: number, y: number): { hint: HintView; zone: HintZone } | null {
    if (!this.session.labPuzzle || !this.hintsShown || this.session.running) return null;
    const list = this.hintList();
    const focus = list.find((h) => h.slot === this.hintFocus);
    if (focus) {
      const zone = this.hintZone(focus, x, y);
      if (zone) return { hint: focus, zone };
    }
    const body = list.find((h) => inRect(hintRect(h.x, h.y), x, y));
    return body ? { hint: body, zone: "body" } : null;
  }

  /** Session remplacée (Arrêter restaure une copie du monde) : la sélection n'a plus de sens. */
  resetFocus(): void {
    this.focus = null;
    this.drag = null;
    this.hoverZone = Zone.None;
  }

  // ------------------------------------------------------------------ géométrie

  private toField(x: number, y: number, lift: boolean): { x: number; y: number } {
    return { x: x - PLAYFIELD.x, y: y - PLAYFIELD.y - (lift ? TOUCH_LIFT : 0) };
  }

  /**
   * Point de l'aire où va la pièce tenue, ou `null` s'il est hors de l'aire. L'original pose la pièce quand la fenêtre sous le
   * pointeur est l'aire (42ebba → 43b047), sinon un appui la rend au bac (42f978) ; le pointeur est le point par lequel on la tient.
   * Au doigt, ce point est `TOUCH_LIFT` au-dessus du doigt (sauf corde et courroie) : c'est lui qui doit être sur l'aire, pas le
   * doigt, sinon une pièce au ras du sol (doigt sur la barre du but) serait hors d'atteinte.
   */
  private heldTarget(x: number, y: number, touch: boolean): { x: number; y: number } | null {
    const held = this.editor.held;
    const lift = touch && held !== null && !isLink(held);
    return this.inField(x, lift ? y - TOUCH_LIFT : y) ? this.toField(x, y, lift) : null;
  }

  /** Le point est-il dans l'aire visible (hors du bac qui la recouvre à droite) ? */
  inField(x: number, y: number): boolean {
    return x >= PLAYFIELD.x && x < BIN_PANEL.x && y >= PLAYFIELD.y && y < PLAYFIELD.y + PLAYFIELD.height;
  }

  /** Barre du but (réduite en mode à deux joueurs : le tableau occupe la droite). */
  get goalRect(): Rect {
    return this.duel ? { ...GOALBAR, width: DUEL_GOAL_WIDTH } : GOALBAR;
  }

  inBin(x: number, y: number): boolean {
    return x >= BIN_PANEL.x && y >= BIN_PANEL.y && y < BIN_PANEL.y + BIN_PANEL.height;
  }

  /**
   * Cases du bac à l'état courant (417264 : la mise en page est refaite à chaque prise ou retour d'une pièce ; une case
   * qui se vide disparaît et les suivantes remontent). Au Labo, palette illimitée : pas de nombre (modes 1 et 6).
   */
  get bin(): BinLayout {
    return binLayout(this.assets, this.tabPicker ? [] : this.editor.binParts(), this.binScroll, this.session.lab === null);
  }

  /** Labo : onglet sous le point (bouton de l'onglet en cours, ou case du choix ouvert), sinon `null`. */
  tabAt(x: number, y: number): { tab: number; button: boolean } | null {
    if (!this.session.lab || this.session.running) return null;
    if (inRect(BIN_TAB_BUTTON, x, y)) return { tab: this.binTab, button: true };
    if (!this.tabPicker) return null;
    for (let t = 0; t < LAB_TAB_COUNT; t++) if (inRect(binTabCell(t), x, y)) return { tab: t, button: false };
    return null;
  }

  private slotAt(x: number, y: number): BinSlot | null {
    return this.bin.slots.find((s) => inRect(s, x, y)) ?? null;
  }

  /** Boutons montrés dans le mode courant (418b78), avec leur géométrie. */
  shownButtons(): ShownButton[] {
    const states = toolbarStates({ lab: this.session.lab !== null, test: this.test, duel: this.duel !== null, walkthrough: this.walkthrough, solved: this.solved, running: this.session.running });
    return states.flatMap((st) => {
      const b = this.toolbar.find((t) => t.name === st.name);
      return b ? [{ ...b, pressed: st.pressed, disabled: st.disabled }] : [];
    });
  }

  toolbarAt(x: number, y: number): ShownButton | null {
    if (!inRect(TOOLBAR, x, y)) return null;
    return this.shownButtons().find((b) => inRect(b, x, y)) ?? null;
  }

  /**
   * Mode aide (41e6b7) : la pièce tenue retourne au bac, plus de poignées ni d'indices survolés ; le prochain appui choisit l'élément
   * (`helpTargetAt`), Échap abandonne.
   */
  startHelpPick(): void {
    this.cancelGesture();
    if (this.editor.held) this.editor.returnHeld();
    this.drag = null;
    this.focus = null;
    this.hoverZone = Zone.None;
    this.helpPicking = true;
  }

  /**
   * 41e85c : le bac (fenêtre à part dans le jeu, 11014) et la barre du but (9000) d'abord, puis les contrôles de la fenêtre principale
   * (barre d'outils, et ici les boutons du panneau du bac), enfin une pièce posée (437cc9, décors exclus).
   */
  helpTargetAt(x: number, y: number): HelpTarget {
    x = Math.floor(x);
    y = Math.floor(y);
    if (inRect(BIN_PLAY, x, y)) return { kind: "control", id: BIN_HELP.play };
    if (inRect(BIN_LEFT, x, y)) return { kind: "control", id: BIN_HELP.left };
    if (inRect(BIN_RIGHT, x, y)) return { kind: "control", id: BIN_HELP.right };
    if (this.inBin(x, y)) return { kind: "control", id: HELP_BIN };
    if (inRect(this.goalRect, x, y)) return { kind: "control", id: HELP_GOAL };
    const button = this.toolbarAt(x, y);
    if (button) return { kind: "control", id: button.id };
    if (this.inField(x, y)) {
      const f = this.toField(x, y, false);
      const part = this.editor.partAt(f.x, f.y);
      if (part) return { kind: "part", partType: part.type };
    }
    return { kind: "none" };
  }

  /** Le point (coordonnées de l'aire) est-il dans le cadre des poignées de la pièce (rectangle élargi d'une poignée, info en bas à droite) ? */
  private inHandleFrame(p: Part, fx: number, fy: number): boolean {
    const r = this.editor.partRect(p);
    return fx >= r.x - HANDLE_SIZE && fx < r.x + r.w + HANDLE_SIZE + 5 && fy >= r.y - HANDLE_SIZE && fy < r.y + r.h + HANDLE_SIZE + 5;
  }

  /** Zone sous le point de l'aire pour la pièce en vue, ou la pièce sous le point. */
  private fieldTarget(fx: number, fy: number, touch: boolean): { part: Part | null; zone: ZoneId } {
    const ed = this.editor;
    if (this.focus && ed.isMovable(this.focus)) {
      const z = ed.zoneAt(this.focus, fx, fy, touch);
      if (z !== Zone.None) return { part: this.focus, zone: z };
    }
    const p = ed.partAt(fx, fy);
    if (!p) return { part: null, zone: Zone.None };
    return { part: p, zone: ed.zoneAt(p, fx, fy, touch) };
  }

  /** Curseur à montrer pour la souris. */
  cursor(): CursorKind {
    const { x, y } = this.pointer;
    if (this.helpPicking) return "help";
    if (this.placing === "rect") return this.inField(x, y) ? "crosshair" : "default";
    if (this.placing === "hint") return this.inField(x, y) ? "copy" : "default";
    if (this.drag?.kind === "hint") return "grabbing";
    if (this.drag?.kind === "resize") return this.drag.zone === Zone.WidthLeft || this.drag.zone === Zone.WidthRight ? "ew-resize" : "ns-resize";
    if (this.editor.held) {
      if (this.heldTarget(x, y, this.pointer.touch)) return this.preview.valid ? "grabbing" : "not-allowed";
      return "grabbing";
    }
    if (this.toolbarAt(x, y) || inRect(BIN_PLAY, x, y) || inRect(BIN_LEFT, x, y) || inRect(BIN_RIGHT, x, y) || this.tabAt(x, y)) return "pointer";
    if (this.slotAt(x, y)) return "grab";
    if (inRect(this.goalRect, x, y)) return this.session.lab && !this.session.running ? "default" : "pointer";
    if (this.session.running || !this.inField(x, y)) return "default";
    const hint = this.labHintAt(x, y);
    if (hint) return hint.zone === "body" ? "grab" : "pointer";
    switch (this.hoverZone) {
      case Zone.Body:
        return "grab";
      case Zone.WidthLeft:
      case Zone.WidthRight:
        return "ew-resize";
      case Zone.HeightTop:
      case Zone.HeightBottom:
        return "ns-resize";
      case Zone.Info:
        return "help";
      case Zone.Remove:
      case Zone.FlipX:
      case Zone.FlipY:
      case Zone.Turn:
      case Zone.Lock:
      case Zone.Solution:
      case Zone.Back:
      case Zone.Front:
        return "pointer";
      default:
        return "default";
    }
  }

  // ------------------------------------------------------------------ pointeur

  pointerDown(x: number, y: number, touch: boolean): void {
    // Le canvas mis à l'échelle donne des coordonnées fractionnaires : l'éditeur et le rendu travaillent au pixel entier.
    x = Math.floor(x);
    y = Math.floor(y);
    this.pointer = { x, y, touch, inside: true };
    this.message = null;
    if (this.helpPicking) {
      this.helpPicking = false;
      this.emit({ type: "helpPick", target: this.helpTargetAt(x, y) });
      return;
    }
    if (this.placing) {
      // Pose d'une main (42057e : un appui la pose) ou début du rectangle ; hors de l'aire, rien.
      if (!this.inField(x, y)) return;
      const f = this.toField(x, y, false);
      if (this.placing === "hint") {
        this.placing = null;
        const at = clampHint(f.x - (HINT_WIDTH >> 1), f.y - (HINT_HEIGHT >> 1));
        this.emit({ type: "hintPlaced", x: at.x, y: at.y });
        return;
      }
      this.rect = { x: f.x, y: f.y, width: 0, height: 0 };
      this.drag = { kind: "rect", part: null, startX: f.x, startY: f.y, moved: false, touch };
      return;
    }
    const tab = this.tabAt(x, y);
    if (tab) {
      if (tab.button) this.tabPicker = !this.tabPicker;
      else {
        this.tabPicker = false;
        if (tab.tab !== this.binTab) {
          this.binTab = tab.tab;
          this.binScroll = 0;
          this.emit({ type: "tab", tab: tab.tab });
        }
      }
      return;
    }
    if (this.tabPicker && this.inBin(x, y)) {
      this.tabPicker = false;
      return;
    }
    const button = this.toolbarAt(x, y);
    if (button) {
      this.drag = { kind: "press", part: null, startX: x, startY: y, moved: false, touch, button: button.name };
      return;
    }
    if (inRect(BIN_PLAY, x, y)) {
      this.drag = { kind: "press", part: null, startX: x, startY: y, moved: false, touch, button: "PB_PLAY" };
      return;
    }
    if (inRect(BIN_LEFT, x, y)) return this.scrollBin(-1);
    if (inRect(BIN_RIGHT, x, y)) return this.scrollBin(1);
    // Au doigt, une pièce tenue va au-dessus du doigt : un appui sur la barre du but peut la poser au ras du sol.
    const heldAbove = !this.session.running && this.heldTarget(x, y, touch) !== null;
    if (inRect(this.goalRect, x, y) && !heldAbove) {
      this.emit({ type: this.session.lab && !this.session.running ? "goalEdit" : "goal" });
      return;
    }
    if (inRect(GOALBAR, x, y) && !heldAbove) return;
    const labHint = this.labHintAt(x, y);
    if (labHint) {
      const { hint: h, zone } = labHint;
      this.hintFocus = h.slot;
      if (zone === "remove") this.emit({ type: "hintDelete", slot: h.slot });
      else if (zone === "edit") this.emit({ type: "hintEdit", slot: h.slot });
      else if (zone === "flip") {
        this.session.labPuzzle!.flipHint(h.slot);
        this.emit({ type: "hintChanged" });
      } else {
        const f = this.toField(x, y, false);
        this.drag = { kind: "hint", part: null, startX: x, startY: y, moved: false, touch, slot: h.slot, grabX: f.x - h.x, grabY: f.y - h.y };
      }
      return;
    }
    const hint = this.session.labPuzzle ? null : this.hintAt(x, y);
    if (hint !== null) {
      this.emit({ type: "hint", slot: hint });
      return;
    }
    if (this.session.running) {
      // Un clic dans l'aire arrête la machine (4359a4 : bouton de la souris → 0x1000).
      if (this.inField(x, y)) this.emit({ type: "stop" });
      return;
    }
    const ed = this.editor;
    if (ed.held) {
      // Pièce déjà en main (prise d'un appui) : l'appui la pose, la relie ou la rend au bac.
      this.drag = { kind: ed.held.flags0C & 0x800 ? "bin" : "field", part: ed.held, startX: x, startY: y, moved: false, touch };
      return;
    }
    const slot = this.inBin(x, y) ? this.slotAt(x, y) : null;
    if (slot) {
      const part = slot.parts[0]!;
      if (!ed.takeFromBin(part)) {
        if (!ed.mayTakeFromBin()) this.emit({ type: "duelRefused", reason: "bin" });
        return;
      }
      this.focus = null;
      this.drag = { kind: "bin", part, startX: x, startY: y, moved: false, touch, fresh: true };
      this.emit({ type: "sound", name: "pick" });
      return;
    }
    if (!this.inField(x, y)) return;
    const f = this.toField(x, y, false);
    const { part, zone } = this.fieldTarget(f.x, f.y, touch);
    if (!part) {
      this.focus = null;
      return;
    }
    if (!ed.mayTouch(part)) {
      // 42e6d3 : la pièce n'est pas sélectionnée ; l'appui donne 0xE24 et GENERIC 31152.
      this.focus = null;
      this.emit({ type: "duelRefused", reason: "moved" });
      return;
    }
    switch (zone) {
      case Zone.Body:
        if (touch && this.focus !== part) {
          // Au doigt : le premier appui sélectionne ; un glisser saisit.
          this.drag = { kind: "pending", part, startX: x, startY: y, moved: false, touch };
        } else {
          ed.grab(part, f.x, f.y);
          this.focus = null;
          this.drag = { kind: "field", part, startX: x, startY: y, moved: false, touch, fresh: true };
          this.emit({ type: "sound", name: "pick" });
        }
        return;
      case Zone.Remove:
        ed.removeToBin(part);
        this.focus = null;
        this.emit({ type: "sound", name: "remove" });
        return;
      case Zone.FlipX:
      case Zone.FlipY:
      case Zone.Turn:
        if (ed.flip(part, zone === Zone.FlipX ? "x" : zone === Zone.FlipY ? "y" : "turn")) this.emit({ type: "flipped", part });
        return;
      case Zone.Back:
      case Zone.Front:
        ed.layer(part, zone === Zone.Back);
        return;
      case Zone.WidthLeft:
      case Zone.WidthRight:
      case Zone.HeightTop:
      case Zone.HeightBottom:
        this.drag = { kind: "resize", part, zone, startX: x, startY: y, moved: false, touch };
        return;
      case Zone.Info:
        this.emit({ type: "info", partType: part.type, anchor: this.screenRect(part) });
        return;
      case Zone.Program:
        this.emit({ type: "program", part });
        return;
      case Zone.Lock: {
        const locked = ed.toggleLock(part);
        if (locked !== null) {
          this.emit({ type: "sound", name: "pick" });
          this.emit({ type: "locked", locked });
        }
        return;
      }
      case Zone.Solution:
        this.emit({ type: "solution", part });
        return;
      default:
        this.focus = touch ? part : this.focus;
    }
  }

  pointerMove(x: number, y: number, touch: boolean): void {
    x = Math.floor(x);
    y = Math.floor(y);
    this.pointer = { x, y, touch, inside: true };
    const d = this.drag;
    if (d && !d.moved && Math.abs(x - d.startX) + Math.abs(y - d.startY) > DRAG_SLOP) {
      d.moved = true;
      if (d.kind === "bin" && d.touch) this.emit({ type: "tipEnd" });
      if (d.kind === "pending" && d.part) {
        const f = this.toField(d.startX, d.startY, false);
        this.editor.grab(d.part, f.x, f.y);
        this.focus = null;
        d.kind = "field";
        d.fresh = true;
        this.emit({ type: "sound", name: "pick" });
      }
    }
    if (d?.kind === "resize" && d.part) {
      const f = this.toField(x, y, false);
      this.editor.resizeEdge(d.part, d.zone!, f.x, f.y);
      return;
    }
    if (d?.kind === "hint" && d.moved) {
      const f = this.toField(x, y, false);
      this.session.labPuzzle?.moveHint(d.slot!, f.x - d.grabX!, f.y - d.grabY!, FIELD_WIDTH, FIELD_HEIGHT);
      return;
    }
    if (d?.kind === "rect" && this.rect) {
      const f = this.toField(x, y, false);
      this.rect = normalRect(d.startX, d.startY, clamp(f.x, 0, FIELD_WIDTH), clamp(f.y, 0, FIELD_HEIGHT));
      return;
    }
    this.updateHover();
  }

  /** Aperçu de la pièce tenue et zone survolée, à la position courante du pointeur. */
  private updateHover(): void {
    const { x, y, touch } = this.pointer;
    const ed = this.editor;
    if (this.helpPicking || this.placing) return;
    if (this.session.labPuzzle && this.hintsShown && !this.session.running && !ed.held) {
      const h = this.labHintAt(x, y);
      if (h) {
        this.hintFocus = h.hint.slot;
        this.focus = null;
        this.hoverZone = Zone.None;
        return;
      }
      const focus = this.hintList().find((k) => k.slot === this.hintFocus);
      if (!focus || !this.inHintFrame(focus, x, y)) this.hintFocus = null;
    }
    if (ed.held) {
      const f = this.heldTarget(x, y, touch);
      this.preview = f ? ed.hover(f.x, f.y) : { valid: false };
      return;
    }
    if (this.session.running || !this.inField(x, y)) {
      this.hoverZone = Zone.None;
      return;
    }
    const f = this.toField(x, y, false);
    const found = this.fieldTarget(f.x, f.y, touch);
    const t = found.part && !ed.mayTouch(found.part) ? { part: null, zone: Zone.None } : found;
    if (!touch) {
      const target = t.part && ed.mayTouch(t.part) && (ed.isMovable(t.part) || t.zone === Zone.Info) ? t.part : null;
      // Entre la pièce et une poignée éloignée (retournement, info), au-dessus du vide ou d'une pièce fixe, la pièce garde ses poignées.
      const keep = !target && this.focus !== null && ed.isMovable(this.focus) && ed.mayTouch(this.focus) && this.inHandleFrame(this.focus, f.x, f.y);
      if (!keep) this.focus = target;
    }
    this.hoverZone = t.zone;
  }

  pointerUp(x: number, y: number): void {
    x = Math.floor(x);
    y = Math.floor(y);
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    this.pointer.x = x;
    this.pointer.y = y;
    if (d.kind === "press") {
      if (d.button === this.toolbarAt(x, y)?.name || (d.button === "PB_PLAY" && inRect(BIN_PLAY, x, y))) {
        if (d.button === "PB_PLAY" || d.button === "TB_FLAG") this.emit({ type: this.session.running ? "stop" : "start" });
        else this.emit({ type: "toolbar", name: d.button! });
      }
      return;
    }
    if (d.kind === "pending") {
      this.focus = d.part;
      return;
    }
    if (d.kind === "resize") return;
    if (d.kind === "hint") {
      if (d.moved) this.emit({ type: "hintChanged" });
      return;
    }
    if (d.kind === "rect") {
      const r = this.rect;
      this.rect = null;
      if (!r) return;
      this.placing = null;
      this.emit({ type: "rectDrawn", rect: r });
      return;
    }
    if (d.kind === "bin" && d.touch) this.emit({ type: "tipEnd" });
    const ed = this.editor;
    if (!ed.held) return;
    // Un appui sans glisser sur une pièce qu'on vient de prendre : elle reste en main.
    if (!d.moved && d.fresh) return;
    const f = this.heldTarget(x, y, d.touch);
    if (f) {
      const r = ed.click(f.x, f.y);
      if (r === "placed" || r === "linked") this.emit({ type: "sound", name: "drop" });
      else if (r === "refused") this.emit({ type: "sound", name: "refused" });
      this.updateHover();
    } else if (this.inBin(x, y) || d.moved) {
      ed.returnHeld();
      this.emit({ type: "sound", name: "remove" });
    }
  }

  /** Appui long (doigt) : dans le bac, nom et description de la pièce ; sur la barre, l'infobulle du bouton (sans le cliquer). */
  longPress(x: number, y: number): void {
    if (this.helpPicking) return;
    x = Math.floor(x);
    y = Math.floor(y);
    const button = this.toolbarAt(x, y);
    if (button) {
      if (this.drag?.kind === "press") this.drag = null;
      this.emit({ type: "toolbarTip", button });
      return;
    }
    const slot = this.inBin(x, y) ? this.slotAt(x, y) : null;
    if (!slot) return;
    const d = this.drag;
    if (d && !d.moved && d.kind === "bin") {
      // On n'a pas glissé : la pièce n'est pas prise.
      this.editor.returnHeld();
      this.drag = null;
    }
    this.emit({ type: "tip", partType: slot.type, anchor: slot });
  }

  /** Le pointeur quitte le canvas (ou geste interrompu) : un redimensionnement s'arrête, la pièce tenue reste en main. */
  pointerLeave(): void {
    this.pointer.inside = false;
    if (this.drag?.kind === "resize" || this.drag?.kind === "press") this.drag = null;
    if (!this.pointer.touch) this.focus = this.editor.held ? null : this.focus;
  }

  /** Geste interrompu (appel, onglet masqué) : pièce glissée rendue au bac. */
  cancelGesture(): void {
    const d = this.drag;
    this.drag = null;
    if (d && d.moved && this.editor.held) this.editor.returnHeld();
  }

  /** Infobulle d'une case survolée à la souris (après un délai géré par l'application). */
  slotUnder(x: number, y: number): BinSlot | null {
    return this.inBin(x, y) ? this.slotAt(x, y) : null;
  }

  /** Flèche du bac : −1 (gauche) ou 1 (droite), une colonne (`binScrollStep`). */
  scrollBin(direction: number): void {
    const bin = this.bin;
    this.binScroll = binScrollStep(bin, direction);
  }

  // ------------------------------------------------------------------ clavier

  /**
   * Touches d'origine (42f63c) : X, Y (retourner), + ou =, − (taille), sur la pièce tenue ou, dans le port, sur la pièce
   * sélectionnée. Échap rend la pièce tenue au bac, puis efface la sélection et l'indice ; Suppr range la pièce sélectionnée.
   * Rend vrai si la touche est prise.
   */
  key(key: string): boolean {
    const ed = this.editor;
    if (this.helpPicking) {
      if (key !== "Escape") return false;
      this.helpPicking = false;
      this.emit({ type: "helpCancel" });
      return true;
    }
    if (this.placing) {
      if (key !== "Escape") return false;
      this.placing = null;
      this.rect = null;
      this.drag = null;
      this.emit({ type: "placeCancel" });
      return true;
    }
    if (this.tabPicker && key === "Escape") {
      this.tabPicker = false;
      return true;
    }
    if (this.session.running) {
      if (key === "Escape") {
        this.emit({ type: "stop" });
        return true;
      }
      return false;
    }
    const target = ed.held ?? (this.focus && ed.isMovable(this.focus) && ed.mayTouch(this.focus) ? this.focus : null);
    const k = key.length === 1 ? key.toUpperCase() : key;
    switch (k) {
      case "X":
        if (target) ed.flip(target, "x");
        return target !== null;
      case "Y":
        if (target) ed.flip(target, "y");
        return target !== null;
      case "+":
      case "=":
        if (target) ed.resize(target, 1);
        return target !== null;
      case "-":
        if (target) ed.resize(target, -1);
        return target !== null;
      case "Delete":
      case "Backspace":
        if (target && target !== ed.held) {
          ed.removeToBin(target);
          this.focus = null;
          return true;
        }
        return false;
      case "Escape":
        if (ed.held) ed.returnHeld();
        else if (this.focus) this.focus = null;
        else if (this.hintsShown) this.hintsShown = false;
        else return false;
        this.updateHover();
        return true;
      default:
        return false;
    }
  }

  /** Bouton `TB_HINT` en mode Jeu (4192d3) : montre toutes les mains des indices (4204cf) ou les cache (420536). */
  toggleHints(): boolean {
    this.message = null;
    this.hintsShown = !this.hintsShown && this.hintCount > 0;
    return this.hintsShown;
  }

  // ------------------------------------------------------------------ dessin

  /** Écran complet de l'image courante. */
  render(): Surface {
    const s = this.session;
    const ed = this.editor;
    const bin = this.bin;
    this.binScroll = bin.scroll;
    // Labo : le but du puzzle maison, sinon la consigne (texte donné).
    const goal = this.message ?? (this.session.labPuzzle?.goal || this.texts.goal);
    const screen = composeScreen(this.assets, s.world, {
      backgroundColor: s.background,
      goal: "",
      running: s.running,
      toolbar: this.shownButtons(),
      binPanelOnly: true,
    });
    drawGoalBar(screen, this.assets, goal, this.goalRect.width);
    if (this.duel) this.drawBoard(screen, this.duel);
    const { x: px, y: py } = this.pointer;
    const hoverSlot = !this.pointer.touch && this.pointer.inside && !ed.held && this.inBin(px, py) ? (bin.slots.find((k) => inRect(k, px, py)) ?? null) : null;
    drawBinOverlay(screen, this.assets, { layout: bin, running: s.running, hover: hoverSlot });
    if (s.lab && !s.running) {
      const t = this.tabPicker ? this.tabAt(px, py) : null;
      drawBinTabs(screen, this.assets, { tab: this.binTab, picker: this.tabPicker, hover: t && !t.button ? t.tab : null, count: LAB_TAB_COUNT });
    }
    if (s.running) return screen;
    if (this.hintsShown) {
      for (const h of this.hintList()) drawHintArrow(screen, this.assets, h.x, h.y, h.flip);
      const focus = this.session.labPuzzle ? this.hintList().find((h) => h.slot === this.hintFocus) : undefined;
      if (focus && !ed.held && !this.placing) drawHandles(screen, this.assets, this.hintHandleViews(focus));
    }
    if (this.placing === "hint" && this.pointer.inside && this.inField(px, py)) {
      const f = this.toField(px, py, false);
      const at = clampHint(f.x - (HINT_WIDTH >> 1), f.y - (HINT_HEIGHT >> 1));
      drawHintArrow(screen, this.assets, at.x, at.y, 0);
    }
    if (this.rect) drawFieldRect(screen, this.rect);
    const focus = this.focus;
    if (focus && !ed.held && (focus.flags0C & 0x3000) !== 0 && ed.mayTouch(focus)) drawHandles(screen, this.assets, this.handleViews(focus));
    const held = ed.held;
    if (held) {
      const { x, y } = this.pointer;
      if (isLink(held)) {
        if (this.preview.line) drawRubberBand(screen, this.preview.line, this.preview.valid);
        if (!this.inField(x, y) || !this.preview.line) this.drawAtPointer(screen, held);
      } else if (this.pointer.inside && this.heldTarget(x, y, this.pointer.touch)) {
        drawHeldPart(screen, this.assets, s.world, held, this.preview.valid, true);
      } else if (this.pointer.inside || this.pointer.touch) {
        this.drawAtPointer(screen, held);
      }
    }
    return screen;
  }

  /** Tableau des deux joueurs (`H2H.ITF`). */
  private drawBoard(screen: Surface, duel: Duel): void {
    if (!this.boardItf && this.assets.index.has("H2H.ITF")) this.boardItf = readItf(this.assets.index.get("H2H.ITF"));
    if (!this.boardItf) return;
    drawDuelBoard(screen, this.assets, this.boardItf, { names: duel.settings.names, turn: duel.turn, wins: duel.wins, remaining: duel.remaining });
  }

  /** Pièce tenue hors de l'aire (au-dessus du bac) : dessinée sous le pointeur. */
  private drawAtPointer(screen: Surface, p: Part): void {
    const { x, y, touch } = this.pointer;
    if (x < 0) return;
    const save = { px: p.px, py: p.py };
    const lift = touch ? TOUCH_LIFT : 0;
    p.px = x - PLAYFIELD.x - this.editor.grabX;
    p.py = y - PLAYFIELD.y - this.editor.grabY - lift;
    if (isLink(p)) {
      // Corde, courroie : leur icône du bac, centrée sur le pointeur (42d26c).
      const icon = this.assets.binIcon(p.type);
      if (icon) drawBinIcon(screen, this.assets, p.type, x - (icon.width >> 1), y - (icon.height >> 1) - lift);
    } else {
      drawHeldPart(screen, this.assets, this.session.world, p, true, false);
    }
    p.px = save.px;
    p.py = save.py;
  }

  private handleViews(p: Part): HandleView[] {
    const anm = this.assets.anm("HANDLES.ANM");
    if (!anm) return [];
    return this.editor.handles(p).map((h) => {
      const base = stateImage(anm, h.state);
      let frame = this.handleFrames.get(h.zone) ?? base;
      if (frame < base) frame = base;
      if (this.hoverZone === h.zone && this.focus === p) frame = nextHandleFrame(this.assets, frame, base);
      else frame = base;
      this.handleFrames.set(h.zone, frame);
      return { x: h.x, y: h.y, frame };
    });
  }

  /** Poignées d'une main au Labo (41ffd0) : effacer, tourner, modifier, aux états de `HANDLES.ANM` des pièces (0x48101c = 7, 4, 9). */
  private hintHandleViews(h: HintView): HandleView[] {
    const anm = this.assets.anm("HANDLES.ANM");
    if (!anm) return [];
    const at = (state: number, x: number, y: number): HandleView => ({ x, y, frame: stateImage(anm, state) });
    return [at(HANDLE_STATES[7], h.x - HANDLE_SIZE, h.y - HANDLE_SIZE), at(HANDLE_STATES[4], h.x - HANDLE_SIZE, h.y + HINT_HEIGHT), at(HANDLE_STATES[9], h.x + HINT_WIDTH, h.y + HINT_HEIGHT)];
  }

  /** Le point de l'écran est-il dans le cadre des poignées d'une main ? */
  private inHintFrame(h: HintView, x: number, y: number): boolean {
    const r = hintRect(h.x, h.y);
    return x >= r.x - HANDLE_SIZE && x < r.x + r.width + HANDLE_SIZE && y >= r.y - HANDLE_SIZE && y < r.y + r.height + HANDLE_SIZE;
  }

  /** Rectangle d'une pièce posée dans l'écran (ancrage d'une infobulle). */
  screenRect(p: Part): Rect {
    const r = this.editor.partRect(p);
    return { x: PLAYFIELD.x + r.x, y: PLAYFIELD.y + r.y, width: Math.max(r.w, HANDLE_SIZE >> 1), height: Math.max(r.h, HANDLE_SIZE >> 1) };
  }
}

const isLink = (p: Part): boolean => p.type === 8 || p.type === 10 || p.type === 76;
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
/** 42057e : une main reste dans l'aire. */
const clampHint = (x: number, y: number): { x: number; y: number } => ({ x: clamp(x, 0, FIELD_WIDTH - HINT_WIDTH), y: clamp(y, 0, FIELD_HEIGHT - HINT_HEIGHT) });
const normalRect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) });

export { FIELD_HEIGHT, FIELD_WIDTH };
