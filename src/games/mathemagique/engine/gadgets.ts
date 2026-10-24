/**
 * Gadgets : groupes de boutons graphiques (`10a0`, engine.md §5.2) et tables de zones (`HotspotTable`).
 *
 * Original : `10a0:0000(tableau, nombre, drapeaux)` installe jusqu'à 10 **groupes** ; un groupe = des enregistrements (rectangle
 * `[gauche, droite[ × [haut, bas[`, drapeaux masqué / désactivé / enfoncé, formes par état, sons d'appui) et un rappel qui reçoit
 * l'indice 1 à n de l'enregistrement. `10a0:001b` suit la souris **à chaque tour** (pas de `WM_MOUSEMOVE`) : survol, appui, relâchement,
 * rappel. `10a0:098e` gère le clavier : Tab / Maj+Tab parcourent les boutons, Entrée active le bouton survolé ou, à défaut, celui qui a le focus
 * (clignotement de 30 ticks).
 *
 * Ici, logique pure (aucun accès au navigateur) :
 *  - `GadgetManager.handleButton(event)` traite un événement bouton de la file de `Input` (dans l'ordre, un clic plus court qu'un tick
 *    n'est pas perdu) ; `updatePointer(x, y)` suit le survol ; `tick()` fait avancer clignotements et rappels temporisés ; `handleKey(event)`
 *    est le gestionnaire de touche `before` du moteur ;
 *  - ordre de test (`hit order`) : groupes dans l'ordre d'ajout, enregistrements dans l'ordre du groupe, le premier touché gagne ; les
 *    enregistrements masqués ou désactivés (et les groupes inactifs) sont transparents au clic (le plein écran du hub n'est actif que dans
 *    certains états) ;
 *  - un appui sur un enregistrement actif l'« enfonce » ; le **relâchement** sur le même enregistrement le déclenche (hypothèse
 *    `activateOn: "release"`, défaut ; `"press"` déclenche à l'appui) ; n'importe quel bouton de souris convient (les trois font la même chose,
 *    common.md §0 point 3) ; un relâchement ailleurs annule ;
 *  - états visuels : `normal`, `hover` (survol ou focus clavier), `pressed`, `selected`, `disabled`, plus `hidden` ; chaque enregistrement peut
 *    avoir une forme `SHAP` par état (repli : pressed → selected → hover → normal, selected → pressed → normal, hover / disabled → normal) ;
 *  - dessin : `draw(surface)` ne redessine que les enregistrements dont l'état a changé ; avec `captureBackground` le fond sous le bouton est
 *    restauré avant de poser la nouvelle forme ; ce fond doit donc être capturé **sans** les formes des boutons (les gadgets posent aussi la forme
 *    normale). La forme « appuyé » peut avoir sa propre origine (`pressedRect`, second rectangle de la table de l'original, `1038:01af`).
 */
import type { Shape } from "../data/shap";
import { drawShape } from "./graphics/blit";
import type { Rect, SavedRect, Surface } from "./graphics/surface";
import type { CursorKind } from "./host";
import type { ButtonEvent, KeyEvent, MouseButton } from "./input";
import { defineService } from "./scene";

// --- Géométrie ---

/** Rectangle `[gauche, droite[ × [haut, bas[` des tables de l'original → `{ x, y, w, h }`. */
export function rectFromEdges(left: number, top: number, right: number, bottom: number): Rect {
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

// --- Tables de zones ---

/**
 * Table de rectangles simples (hub `DS:1050`, aides « ? » du Rhythm Shop et de Rockets) : `hit` renvoie l'indice **1-based** de la
 * première zone touchée, 0 si aucune.
 */
export class HotspotTable {
  constructor(readonly rects: readonly Rect[]) {}

  /** `[[gauche, haut, droite, bas], …]` comme dans les fiches d'écran. */
  static fromEdges(edges: readonly (readonly [number, number, number, number])[]): HotspotTable {
    return new HotspotTable(edges.map(([l, t, r, b]) => rectFromEdges(l, t, r, b)));
  }

  get length(): number {
    return this.rects.length;
  }

  /** Indice (1 à n) de la première zone qui contient le point, sinon 0. */
  hit(x: number, y: number): number {
    for (let i = 0; i < this.rects.length; i++) if (rectContains(this.rects[i]!, x, y)) return i + 1;
    return 0;
  }

  rect(index: number): Rect {
    const rect = this.rects[index - 1];
    if (!rect) throw new RangeError(`HotspotTable : zone ${index} hors de 1 à ${this.rects.length}`);
    return rect;
  }
}

/**
 * Curseur du mode aide : « ? » sur une zone d'indice `firstHelpIndex` ou plus (3 dans le hub : Poly, indices 1 et 2, ne montrent pas le « ? »,
 * `1020:06f6`), flèche sinon.
 */
export function helpCursorAt(table: HotspotTable, x: number, y: number, firstHelpIndex = 3): CursorKind {
  return table.hit(x, y) >= firstHelpIndex ? "help" : "arrow";
}

// --- Gadgets ---

export type GadgetVisual = "normal" | "hover" | "pressed" | "selected" | "disabled";
/** Id `SHAP` par état, dans l'archive que la source de formes du gestionnaire sait lire. */
export type GadgetShapes = Partial<Record<GadgetVisual, number>>;

const SHAPE_FALLBACK: Record<GadgetVisual, readonly GadgetVisual[]> = {
  normal: ["normal"],
  hover: ["hover", "normal"],
  pressed: ["pressed", "selected", "hover", "normal"],
  selected: ["selected", "pressed", "normal"],
  disabled: ["disabled", "normal"],
};

export interface GadgetSpec {
  /** Zone cliquable ; la forme est dessinée à `(shapeX, shapeY)` (défaut : coin de la zone). */
  rect: Rect;
  shapes?: GadgetShapes;
  shapeX?: number;
  shapeY?: number;
  /**
   * Second rectangle de l'original (table de 16 octets par bouton, `1038:01af`) : la forme « appuyé » est dessinée à **son** coin haut-gauche,
   * pas à celui de la zone (forme plus petite, collée au coin bas-droit : `(+2, +1)` ou `(+2, +2)`). Absent : même origine que la forme normale.
   */
  pressedRect?: Rect;
  /** Son d'appui (`\0SND`), fixe ou tiré à chaque appui (Help du hub : 3012 ou 3013). */
  pressSound?: number | (() => number | undefined);
  hidden?: boolean;
  disabled?: boolean;
  selected?: boolean;
  /** Bouton à deux états : chaque activation bascule `selected` (Click & Stick Mouse). */
  toggle?: boolean;
  /** Absent du parcours Tab (zones de décor). Défaut vrai. */
  focusable?: boolean;
  /** Test supplémentaire au pixel (coordonnées écran) après le test du rectangle. */
  hit?: (x: number, y: number) => boolean;
  /** Clignote (GO du bowling) : alterne entre normal et survol toutes les `blinkPeriod` ticks. 0 : pas de clignotement. */
  blinkPeriod?: number;
}

export class GadgetRecord {
  /** Indice 1 à n passé au rappel du groupe. */
  readonly index: number;
  readonly rect: Rect;
  readonly shapes: GadgetShapes | undefined;
  readonly shapeX: number;
  readonly shapeY: number;
  readonly pressedRect: Rect | undefined;
  readonly pressSound: GadgetSpec["pressSound"];
  readonly toggle: boolean;
  readonly focusable: boolean;
  readonly hitTest: GadgetSpec["hit"];
  hidden: boolean;
  disabled: boolean;
  selected: boolean;
  blinkPeriod: number;
  /** @internal */
  drawn: GadgetVisual | "hidden" | null = null;
  /** @internal */
  background: SavedRect | null = null;

  constructor(
    readonly group: GadgetGroup,
    index: number,
    spec: GadgetSpec,
  ) {
    this.index = index;
    this.rect = spec.rect;
    this.shapes = spec.shapes;
    this.shapeX = spec.shapeX ?? spec.rect.x;
    this.shapeY = spec.shapeY ?? spec.rect.y;
    this.pressedRect = spec.pressedRect;
    this.pressSound = spec.pressSound;
    this.toggle = spec.toggle ?? false;
    this.focusable = spec.focusable ?? true;
    this.hitTest = spec.hit;
    this.hidden = spec.hidden ?? false;
    this.disabled = spec.disabled ?? false;
    this.selected = spec.selected ?? false;
    this.blinkPeriod = spec.blinkPeriod ?? 0;
  }

  /** Cliquable, survolable et dans le parcours Tab (groupe actif, ni masqué ni désactivé). */
  get enabled(): boolean {
    return this.group.active && !this.hidden && !this.disabled;
  }
}

export interface GadgetActivation {
  /** `pointer` : relâchement (ou appui) de la souris ; `keyboard` : Entrée. */
  source: "pointer" | "keyboard";
  /** Bouton de souris (absent au clavier). */
  button?: MouseButton;
}

export interface GadgetGroupSpec {
  id?: string;
  records: readonly GadgetSpec[];
  /** Rappel avec l'indice 1 à n de l'enregistrement (comme `1020:098a(indice)`). */
  onActivate?: (index: number, record: GadgetRecord, activation: GadgetActivation) => void;
  /** Groupe actif (bit 0 des drapeaux de groupe = inactif dans l'original). Défaut vrai. */
  active?: boolean;
  /** Un seul enregistrement `selected` à la fois (opérations du bowling) : l'activation sélectionne le touché et désélectionne les autres. */
  exclusive?: boolean;
  /** Déclenchement au `release` (défaut) ou au `press`. */
  activateOn?: "press" | "release";
}

export class GadgetGroup {
  readonly id: string | undefined;
  readonly records: readonly GadgetRecord[];
  readonly onActivate: GadgetGroupSpec["onActivate"];
  readonly exclusive: boolean;
  readonly activateOn: "press" | "release";
  active: boolean;

  constructor(spec: GadgetGroupSpec) {
    this.id = spec.id;
    this.onActivate = spec.onActivate;
    this.exclusive = spec.exclusive ?? false;
    this.activateOn = spec.activateOn ?? "release";
    this.active = spec.active ?? true;
    this.records = spec.records.map((record, i) => new GadgetRecord(this, i + 1, record));
  }

  /** Enregistrement d'indice 1 à n. */
  record(index: number): GadgetRecord {
    const record = this.records[index - 1];
    if (!record) throw new RangeError(`Groupe ${this.id ?? "?"} : enregistrement ${index} hors de 1 à ${this.records.length}`);
    return record;
  }
}

export interface GadgetManagerOptions {
  /** Joue un son d'appui ; le gestionnaire ne connaît pas l'archive. */
  playSound?: (soundId: number, record: GadgetRecord) => void;
  /** Lit une forme par id `SHAP` (archive de la scène). */
  shape?: (id: number) => Shape | undefined;
}

/** Ticks pendant lesquels un bouton activé par Entrée reste « enfoncé » (`10a0:0bed`). */
export const KEYBOARD_FLASH_TICKS = 30;

export class GadgetManager {
  private readonly groups: GadgetGroup[] = [];
  private hoverRecord: GadgetRecord | null = null;
  private pressedRecord: GadgetRecord | null = null;
  private pressedButton: MouseButton | null = null;
  private focusRecord: GadgetRecord | null = null;
  private flash: { record: GadgetRecord; until: number } | null = null;
  private ticks = 0;
  private playSound: GadgetManagerOptions["playSound"];
  private shapeSource: GadgetManagerOptions["shape"];

  constructor(options: GadgetManagerOptions = {}) {
    this.playSound = options.playSound;
    this.shapeSource = options.shape;
  }

  /** Fournit la lecture des formes et le son d'appui de la scène (change à chaque scène). */
  configure(options: GadgetManagerOptions): void {
    if ("playSound" in options) this.playSound = options.playSound;
    if ("shape" in options) this.shapeSource = options.shape;
  }

  addGroup(spec: GadgetGroupSpec): GadgetGroup {
    if (this.groups.length >= 10) throw new Error("too many graphic button groups");
    const group = new GadgetGroup(spec);
    this.groups.push(group);
    return group;
  }

  removeGroup(group: GadgetGroup): void {
    const index = this.groups.indexOf(group);
    if (index < 0) return;
    this.groups.splice(index, 1);
    for (const record of group.records) this.forgetRecord(record);
  }

  /** Retire tous les groupes (sortie de scène). */
  clear(): void {
    this.groups.length = 0;
    this.hoverRecord = this.pressedRecord = this.focusRecord = null;
    this.pressedButton = null;
    this.flash = null;
  }

  private forgetRecord(record: GadgetRecord): void {
    if (this.hoverRecord === record) this.hoverRecord = null;
    if (this.pressedRecord === record) {
      this.pressedRecord = null;
      this.pressedButton = null;
    }
    if (this.focusRecord === record) this.focusRecord = null;
    if (this.flash?.record === record) this.flash = null;
  }

  get hovered(): GadgetRecord | null {
    return this.hoverRecord;
  }

  get pressed(): GadgetRecord | null {
    return this.pressedRecord;
  }

  /** Enregistrement qui a le focus clavier (Tab). */
  get focused(): GadgetRecord | null {
    return this.focusRecord;
  }

  /** Premier enregistrement actif touché par le point (ordre d'ajout), ou `null`. */
  hitRecord(x: number, y: number): GadgetRecord | null {
    for (const group of this.groups) {
      if (!group.active) continue;
      for (const record of group.records) {
        if (record.hidden || record.disabled) continue;
        if (!rectContains(record.rect, x, y)) continue;
        if (record.hitTest && !record.hitTest(x, y)) continue;
        return record;
      }
    }
    return null;
  }

  // --- Souris ---

  /** Suit le survol (appelé à chaque tick avec la position vivante). */
  updatePointer(x: number, y: number, buttonHeld?: (button: MouseButton) => boolean): void {
    this.hoverRecord = this.hitRecord(x, y);
    // Le bouton n'est plus tenu (relâchement perdu : focus quitté, Alt-Tab…) : l'appui mémorisé est périmé.
    if (this.pressedRecord && this.pressedButton && buttonHeld && !buttonHeld(this.pressedButton)) {
      this.pressedRecord = null;
      this.pressedButton = null;
    }
    if (this.pressedRecord && !this.pressedRecord.enabled) {
      this.pressedRecord = null;
      this.pressedButton = null;
    }
  }

  /** Événement bouton de la file de `Input` ; renvoie vrai s'il a été pris par un gadget. */
  handleButton(event: ButtonEvent): boolean {
    if (event.down) {
      // Nouvel appui du même bouton alors qu'on en attend le relâchement : ce relâchement s'est perdu, l'appui est périmé.
      if (this.pressedRecord && event.button === this.pressedButton) {
        this.pressedRecord = null;
        this.pressedButton = null;
      }
      if (this.pressedRecord) return false;
      const record = this.hitRecord(event.x, event.y);
      if (!record) return false;
      this.hoverRecord = record;
      this.pressedRecord = record;
      this.pressedButton = event.button;
      this.playPressSound(record);
      if (record.group.activateOn === "press") this.activate(record, { source: "pointer", button: event.button });
      return true;
    }
    if (!this.pressedRecord || event.button !== this.pressedButton) return false;
    const record = this.pressedRecord;
    this.pressedRecord = null;
    this.pressedButton = null;
    if (record.group.activateOn === "release" && record.enabled && this.hitRecord(event.x, event.y) === record) {
      this.activate(record, { source: "pointer", button: event.button });
    }
    return true;
  }

  // --- Clavier ---

  /** Gestionnaire de touche `before` : Tab / Maj+Tab déplacent le focus, Entrée active le survol ou le focus. Vrai si consommée. */
  handleKey(event: KeyEvent): boolean {
    if (event.ctrl || event.alt) return false;
    if (event.code === "Tab") {
      const list = this.focusables();
      if (list.length === 0) return false;
      const at = this.focusRecord ? list.indexOf(this.focusRecord) : -1;
      const step = event.shift ? -1 : 1;
      const next = at < 0 ? (event.shift ? list.length - 1 : 0) : (at + step + list.length) % list.length;
      this.focusRecord = list[next]!;
      return true;
    }
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      const target = this.hoverRecord ?? this.focusRecord;
      if (!target || !target.enabled) return false;
      this.flash = { record: target, until: this.ticks + KEYBOARD_FLASH_TICKS };
      this.playPressSound(target);
      this.activate(target, { source: "keyboard" });
      return true;
    }
    return false;
  }

  /** Enregistrements du parcours Tab (ordre des groupes, puis des enregistrements). */
  focusables(): GadgetRecord[] {
    const list: GadgetRecord[] = [];
    for (const group of this.groups) if (group.active) for (const record of group.records) if (record.enabled && record.focusable) list.push(record);
    return list;
  }

  /** Un tick : clignotements et fin du clignotement d'Entrée. */
  tick(): void {
    this.ticks++;
    if (this.flash && this.ticks >= this.flash.until) this.flash = null;
    if (this.focusRecord && !this.focusRecord.enabled) this.focusRecord = null;
  }

  private activate(record: GadgetRecord, activation: GadgetActivation): void {
    const group = record.group;
    if (group.exclusive) {
      for (const other of group.records) other.selected = other === record;
    } else if (record.toggle) {
      record.selected = !record.selected;
    }
    group.onActivate?.(record.index, record, activation);
  }

  private playPressSound(record: GadgetRecord): void {
    const sound = typeof record.pressSound === "function" ? record.pressSound() : record.pressSound;
    if (sound !== undefined) this.playSound?.(sound, record);
  }

  // --- États visuels et dessin ---

  /** État visuel d'un enregistrement à cet instant. */
  visualOf(record: GadgetRecord): GadgetVisual | "hidden" {
    if (record.hidden) return "hidden";
    if (record.disabled) return "disabled";
    if (this.flash?.record === record) return "pressed";
    if (this.pressedRecord === record && this.hoverRecord === record) return "pressed";
    if (record.selected) return "selected";
    if (this.hoverRecord === record || this.focusRecord === record) return "hover";
    if (record.blinkPeriod > 0 && Math.floor(this.ticks / record.blinkPeriod) % 2 === 1) return "hover";
    return "normal";
  }

  /** Id `SHAP` de l'état (avec repli) ou `undefined` (rien à poser : la forme est dans le décor). */
  shapeIdFor(record: GadgetRecord, visual: GadgetVisual): number | undefined {
    if (!record.shapes) return undefined;
    for (const candidate of SHAPE_FALLBACK[visual]) {
      const id = record.shapes[candidate];
      if (id !== undefined) return id;
    }
    return undefined;
  }

  /** Forme à poser pour l'état (avec repli) et son origine : celle de `pressedRect` si c'est la forme « appuyé » qui est retenue. */
  private placementFor(record: GadgetRecord, visual: GadgetVisual): { id: number; x: number; y: number } | undefined {
    if (!record.shapes) return undefined;
    for (const candidate of SHAPE_FALLBACK[visual]) {
      const id = record.shapes[candidate];
      if (id === undefined) continue;
      const at = candidate === "pressed" && record.pressedRect ? record.pressedRect : { x: record.shapeX, y: record.shapeY };
      return { id, x: at.x, y: at.y };
    }
    return undefined;
  }

  /**
   * Mémorise le fond sous chaque bouton qui a des formes, une fois le décor peint : l'état suivant est posé sur ce fond
   * (une forme de survol plus petite que la précédente n'y laisse pas de reste). À rappeler si le décor change.
   */
  captureBackground(surface: Surface): void {
    for (const group of this.groups) {
      for (const record of group.records) {
        if (!record.shapes || !this.shapeSource) continue;
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const visual of Object.keys(SHAPE_FALLBACK) as GadgetVisual[]) {
          const placed = this.placementFor(record, visual);
          const shape = placed && this.shapeSource(placed.id);
          if (!placed || !shape) continue;
          left = Math.min(left, placed.x);
          top = Math.min(top, placed.y);
          right = Math.max(right, placed.x + shape.width);
          bottom = Math.max(bottom, placed.y + shape.height);
        }
        record.background = right > left ? surface.saveRect({ x: left, y: top, w: right - left, h: bottom - top }) : null;
      }
    }
  }

  /** Oublie ce qui est dessiné (la scène a repeint le décor) : tout sera reposé au prochain `draw`. */
  invalidate(): void {
    for (const group of this.groups) for (const record of group.records) record.drawn = null;
  }

  /** Redessine les enregistrements dont l'état a changé. Renvoie vrai si la surface a changé (la scène demande une présentation). */
  draw(surface: Surface): boolean {
    let changed = false;
    for (const group of this.groups) {
      for (const record of group.records) {
        if (!record.shapes) continue;
        const visual = this.visualOf(record);
        if (visual === record.drawn) continue;
        if ((record.drawn !== null || visual !== "normal") && record.background) {
          surface.restoreRect(record.background);
          changed = true;
        }
        record.drawn = visual;
        if (visual === "hidden") continue;
        const placed = this.placementFor(record, visual);
        const shape = placed && this.shapeSource?.(placed.id);
        if (placed && shape) {
          drawShape(surface, shape, placed.x, placed.y, 8);
          changed = true;
        }
      }
    }
    return changed;
  }
}

export const GADGETS = defineService<GadgetManager>("mathemagique.gadgets");
