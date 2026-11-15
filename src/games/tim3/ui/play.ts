/**
 * Écran de jeu, sans DOM : pointeur et clavier traduits en actions de l'éditeur et de la session, et image 640×480 de
 * l'écran (aire, barre d'outils, bac, barre de but, pièce tenue, poignées, liens en cours, indice).
 *
 * Glisser-déposer unifié (plan D8) : souris et doigt passent par les mêmes appuis. On prend une pièce du bac ou de l'aire, on
 * la glisse, on la lâche ; un simple appui sans glisser la garde en main (comme le clic de l'original, qui prend puis pose en
 * deux clics). Au doigt, la pièce tenue est dessinée au-dessus du doigt (`TOUCH_LIFT`), un appui sur une pièce posée la
 * sélectionne (ses poignées s'affichent) et un appui long dans le bac donne le nom et la description de la pièce.
 */
import { HELP_BIN, HELP_GOAL } from "../data/help";
import type { Level } from "../data/lev";
import type { PartInfo } from "../data/text";
import { FIELD_HEIGHT, FIELD_WIDTH, HANDLE_SIZE, Zone, type HeldPreview, type ZoneId } from "../engine/editor";
import type { Part } from "../engine/part";
import type { Tim3Session } from "../engine/session";
import {
  BIN_LEFT,
  BIN_PANEL,
  BIN_PLAY,
  BIN_RIGHT,
  GOALBAR,
  PLAYFIELD,
  TOOLBAR,
  binLayout,
  binScrollStep,
  composeScreen,
  drawBinIcon,
  drawBinOverlay,
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
  | { type: "helpCancel" };

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

interface Drag {
  kind: "bin" | "field" | "resize" | "pending" | "press";
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
}

/** Curseur CSS selon la zone (le port garde les curseurs du système, plus nets que ceux de `CURSORS.BMP`). */
export type CursorKind = "default" | "pointer" | "grab" | "grabbing" | "ew-resize" | "ns-resize" | "not-allowed" | "copy" | "help";

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

  /** Indices non vides du puzzle (texte français de `LEVELS.INF`, position du LEV). */
  get hintCount(): number {
    return this.hintSlots().length;
  }

  /** Emplacements LEV (0 à 7) des indices non vides. */
  hintSlots(): number[] {
    return this.texts.hints.flatMap((h, i) => (h !== "" && this.level.hints[i] ? [i] : []));
  }

  /** Main d'indice sous le point (contrôle de 44 × 43 en x, y de l'emplacement, 41ef54), si les indices sont affichés. */
  hintAt(x: number, y: number): number | null {
    if (!this.hintsShown || this.session.running) return null;
    for (const slot of this.hintSlots()) {
      const h = this.level.hints[slot]!;
      if (inRect(hintRect(h.x, h.y), x, y)) return slot;
    }
    return null;
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

  /** Le point est-il dans l'aire visible (hors du bac qui la recouvre à droite) ? */
  inField(x: number, y: number): boolean {
    return x >= PLAYFIELD.x && x < BIN_PANEL.x && y >= PLAYFIELD.y && y < PLAYFIELD.y + PLAYFIELD.height;
  }

  inBin(x: number, y: number): boolean {
    return x >= BIN_PANEL.x && y >= BIN_PANEL.y && y < BIN_PANEL.y + BIN_PANEL.height;
  }

  /**
   * Cases du bac à l'état courant (417264 : la mise en page est refaite à chaque prise ou retour d'une pièce ; une case
   * qui se vide disparaît et les suivantes remontent). Au Labo, palette illimitée : pas de nombre (modes 1 et 6).
   */
  get bin(): BinLayout {
    return binLayout(this.assets, this.editor.binParts(), this.binScroll, this.session.lab === null);
  }

  private slotAt(x: number, y: number): BinSlot | null {
    return this.bin.slots.find((s) => inRect(s, x, y)) ?? null;
  }

  /** Boutons montrés dans le mode courant (418b78), avec leur géométrie. */
  shownButtons(): ShownButton[] {
    const states = toolbarStates({ lab: this.session.lab !== null, solved: this.solved, running: this.session.running });
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
    if (inRect(GOALBAR, x, y)) return { kind: "control", id: HELP_GOAL };
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
    if (this.drag?.kind === "resize") return this.drag.zone === Zone.WidthLeft || this.drag.zone === Zone.WidthRight ? "ew-resize" : "ns-resize";
    if (this.editor.held) {
      if (this.inField(x, y)) return this.preview.valid ? "grabbing" : "not-allowed";
      return "grabbing";
    }
    if (this.toolbarAt(x, y) || inRect(BIN_PLAY, x, y) || inRect(BIN_LEFT, x, y) || inRect(BIN_RIGHT, x, y)) return "pointer";
    if (this.slotAt(x, y)) return "grab";
    if (inRect(GOALBAR, x, y)) return "pointer";
    if (this.session.running || !this.inField(x, y)) return "default";
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
    if (inRect(GOALBAR, x, y)) {
      this.emit({ type: "goal" });
      return;
    }
    const hint = this.hintAt(x, y);
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
      ed.takeFromBin(part);
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
        ed.flip(part, zone === Zone.FlipX ? "x" : zone === Zone.FlipY ? "y" : "turn");
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
    this.updateHover();
  }

  /** Aperçu de la pièce tenue et zone survolée, à la position courante du pointeur. */
  private updateHover(): void {
    const { x, y, touch } = this.pointer;
    const ed = this.editor;
    if (this.helpPicking) return;
    if (ed.held) {
      if (this.inField(x, y)) {
        const f = this.toField(x, y, touch && !isLink(ed.held));
        this.preview = ed.hover(f.x, f.y);
      } else {
        this.preview = { valid: false };
      }
      return;
    }
    if (this.session.running || !this.inField(x, y)) {
      this.hoverZone = Zone.None;
      return;
    }
    const f = this.toField(x, y, false);
    const t = this.fieldTarget(f.x, f.y, touch);
    if (!touch) {
      const target = t.part && (ed.isMovable(t.part) || t.zone === Zone.Info) ? t.part : null;
      // Entre la pièce et une poignée éloignée (retournement, info), au-dessus du vide ou d'une pièce fixe, la pièce garde ses poignées.
      const keep = !target && this.focus !== null && ed.isMovable(this.focus) && this.inHandleFrame(this.focus, f.x, f.y);
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
    if (d.kind === "bin" && d.touch) this.emit({ type: "tipEnd" });
    const ed = this.editor;
    if (!ed.held) return;
    // Un appui sans glisser sur une pièce qu'on vient de prendre : elle reste en main.
    if (!d.moved && d.fresh) return;
    if (this.inField(x, y)) {
      const f = this.toField(x, y, d.touch && !isLink(ed.held));
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
    if (this.session.running) {
      if (key === "Escape") {
        this.emit({ type: "stop" });
        return true;
      }
      return false;
    }
    const target = ed.held ?? (this.focus && ed.isMovable(this.focus) ? this.focus : null);
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
    const goal = this.message ?? this.texts.goal;
    const screen = composeScreen(this.assets, s.world, {
      backgroundColor: s.background,
      goal: "",
      running: s.running,
      toolbar: this.shownButtons(),
      binPanelOnly: true,
    });
    drawGoalBar(screen, this.assets, goal);
    const { x: px, y: py } = this.pointer;
    const hoverSlot = !this.pointer.touch && this.pointer.inside && !ed.held && this.inBin(px, py) ? (bin.slots.find((k) => inRect(k, px, py)) ?? null) : null;
    drawBinOverlay(screen, this.assets, { layout: bin, running: s.running, hover: hoverSlot });
    if (s.running) return screen;
    if (this.hintsShown) {
      for (const slot of this.hintSlots()) {
        const h = this.level.hints[slot]!;
        drawHintArrow(screen, this.assets, h.x, h.y, h.flip ?? 0);
      }
    }
    const focus = this.focus;
    if (focus && !ed.held && (focus.flags0C & 0x3000) !== 0) drawHandles(screen, this.assets, this.handleViews(focus));
    const held = ed.held;
    if (held) {
      const { x, y } = this.pointer;
      if (isLink(held)) {
        if (this.preview.line) drawRubberBand(screen, this.preview.line, this.preview.valid);
        if (!this.inField(x, y) || !this.preview.line) this.drawAtPointer(screen, held);
      } else if (this.pointer.inside && this.inField(x, y)) {
        drawHeldPart(screen, this.assets, s.world, held, this.preview.valid, true);
      } else if (this.pointer.inside || this.pointer.touch) {
        this.drawAtPointer(screen, held);
      }
    }
    return screen;
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

  /** Rectangle d'une pièce posée dans l'écran (ancrage d'une infobulle). */
  screenRect(p: Part): Rect {
    const r = this.editor.partRect(p);
    return { x: PLAYFIELD.x + r.x, y: PLAYFIELD.y + r.y, width: Math.max(r.w, HANDLE_SIZE >> 1), height: Math.max(r.h, HANDLE_SIZE >> 1) };
  }
}

const isLink = (p: Part): boolean => p.type === 8 || p.type === 10 || p.type === 76;

export { FIELD_HEIGHT, FIELD_WIDTH };
