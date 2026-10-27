/**
 * Pattern Windows (scène 3, `PATFILL.DAT`) : coloriage de vitrail. Dix motifs, quinze couleurs, trois peintures sauvegardées par motif,
 * Robinet, Yuck ! (annuler / rétablir), kaléidoscope de palette, impression (téléchargement d'un PNG) et aide de Poly. Comportement
 * d'origine : `docs/mathemagique/screens/pattern-windows.md` ; règles pures : `pattern-windows-logic.ts`.
 *
 * Aucun `await` dans un tick : les attentes de l'original (jingle d'entrée, fondu de sortie, animations de Poly) sont des états.
 * Dessin : `canvas` = fond + texte + cellules + panneau des couleurs (sans bouton) ; `screen` = `canvas` puis gadgets. Une cellule peinte
 * n'est redessinée que dans son rectangle ; le reste (couleur, version, motif, Robinet, Yuck !) recompose tout le canevas.
 *
 * Écarts assumés (voir la section « Implémentation » de la fiche) : le sondage de la souris tient compte du chemin parcouru entre deux ticks
 * (un point par pixel parcouru) ; la pastille de nom ouvre le moniteur de connexion avec la palette du hub le temps du dialogue ;
 * Imprimer télécharge un PNG de la fenêtre (pas de boîte d'impression).
 */
import { TAG_SHAP } from "../../../data/mohawk/mohawk";
import { drawMask, drawShape, hitTestShape } from "../engine/graphics/blit";
import { parseFon, type FonFont } from "../engine/graphics/fon";
import type { PaletteCycler } from "../engine/graphics/palette";
import { Surface } from "../engine/graphics/surface";
import { drawText, measureText } from "../engine/graphics/text";
import { HotspotTable, rectFromEdges, type GadgetActivation, type GadgetGroup, type GadgetSpec } from "../engine/gadgets";
import type { KeyEvent } from "../engine/input";
import type { Archive } from "../engine/resources";
import { SceneId, type Scene, type SceneContext } from "../engine/scene";
import type { MathServices } from "../engine/services";
import type { SoundHandle } from "../engine/sound";
import { PATTERN_WINDOWS_POLY, POLY_ZONE } from "../game/poly-config";
import { PolyHelper, createScrPolyPorts, openPolyArchive, rosterIntroFlag } from "../game/poly";
import type { CertificatePort } from "./certificate";
import { MonitorOverlay, loadMonitorFont, type MonitorResult, type TextInputPort } from "./monitor";
import {
  BLANK_BYTE,
  COLOR_COUNT,
  PALETTE_FIRST,
  PATTERN_COUNT,
  PATTERN_STORAGE_BYTES,
  PRINT_EDGES,
  STORAGE_BYTES,
  VERSION_COUNT,
  applyFaucet,
  beginStroke,
  blankStorage,
  createPaintState,
  cropPixels,
  encodeIndexedPng,
  faucetMode,
  isColorful,
  layoutCells,
  nextColor,
  nextPattern,
  paintAt,
  parsePtrn,
  prevColor,
  prevPattern,
  printFileName,
  readStorage,
  takeSnapshot,
  toggleUndo,
  writeStorage,
  writeStorageCell,
  type CellDef,
  type FaucetMode,
  type PatternGeometry,
  type Stroke,
} from "./pattern-windows-logic";

// --- Ressources et constantes (pattern-windows.md §2, §3, §4) ---

const ARCHIVE = "PATFILL.DAT";
/** `MAINSCRN.DAT` : formes et sons du moniteur de connexion (pastille de nom). */
const MONITOR_ARCHIVE = "MAINSCRN.DAT";
/** Palette du hub (couleurs du moniteur) : `SHPL` 100 de `MAINSCRN.DAT`, entrées 10 à 208. */
const HUB_PALETTE_SHPL = 100;
const HUB_PALETTE_FIRST = 10;
const HUB_PALETTE_COUNT = 199;

const SHAPE_BACKGROUND = 40000;
const SHAPE_PANEL = 40001;
const SHAPE_FRAME = 40002;
const SHAPE_HAND = 40003;
const SHPL_DIGITS = 40100;
const SHPL_BUTTONS = 40150;
const STRL_NAMES = 40000;
const PTRN_BASE = 40500;
const PTRN_STEP = 500;

const SOUND = { music: 1001, jingle: 3110, print: 3038, color: 3039, arrows: 3040, version: 3041, name: 3044, yuck: 3053, helpA: 3012, helpB: 3013 } as const;

const FADE_TICKS = 30;
/** Garde-fou de l'attente du jingle d'entrée (2,39 s ≈ 141 ticks). */
const JINGLE_WAIT_MAX_TICKS = 400;
const BLINK_TICKS = 12;
const KALEIDOSCOPE = { first: PALETTE_FIRST, count: COLOR_COUNT, period: 8, duration: 300 } as const;
/** Un point de peinture par pixel parcouru : une cellule étroite n'est jamais enjambée (l'original sonde à chaque tour de boucle, bien plus vite qu'un tick). */
const STROKE_STEP = 1;
const TEXT_COLOR = 108;

const WINDOW_EDGES = [52, 46, 393, 387] as const;
/** Le verre : fenêtre de peinture `[52, 393[ × [46, 387[`. */
const GLASS = { x: 52, y: 46, w: 341, h: 341 } as const;
const PANEL_AT = { x: 408, y: 132 } as const;
const HAND_AT = { x: 337, y: 396 } as const;
const NAME_EDGES = [412, 53, 528, 68] as const;
const TITLE_EDGES = [429, 79, 512, 93] as const;

type ButtonRole = "print" | "kaleidoscope" | "left" | "right" | "faucet" | "help" | "yuck" | "exit";

interface ButtonDef {
  role: ButtonRole;
  edges: readonly [number, number, number, number];
  /** Rang de l'icône dans la `SHPL` 40150 (paires repos / appuyé). */
  icon: number;
  sound: number | null;
}

/** Les 8 boutons d'action (entrées 21 à 28, rappel `1060:008a`, `k` = rang + 1). */
const BUTTONS: readonly ButtonDef[] = [
  { role: "print", edges: [487, 369, 516, 397], icon: 0, sound: SOUND.print },
  { role: "kaleidoscope", edges: [418, 369, 447, 397], icon: 1, sound: SOUND.print },
  { role: "left", edges: [412, 73, 428, 93], icon: 2, sound: SOUND.arrows },
  { role: "right", edges: [512, 73, 527, 93], icon: 3, sound: SOUND.arrows },
  { role: "faucet", edges: [453, 369, 482, 397], icon: 4, sound: SOUND.print },
  { role: "help", edges: [496, 339, 525, 367], icon: 5, sound: null },
  { role: "yuck", edges: [408, 339, 437, 367], icon: 6, sound: SOUND.yuck },
  { role: "exit", edges: [448, 339, 484, 364], icon: 7, sound: null },
];

/** Les 15 pastilles : colonnes de 5, ordre colonne par colonne (la colonne du milieu est 16 px plus haut). */
function colorEdges(color: number): readonly [number, number, number, number] {
  const column = Math.floor(color / 5);
  const k = color % 5;
  if (column === 0) return [408, 148 + 39 * k, 448, 176 + 39 * k];
  if (column === 1) return [447, 132 + 39 * k, 487, 160 + 39 * k];
  return [491, 148 + 39 * k, 531, 176 + 39 * k];
}

/** Zones du mode aide (`DS:24ce`), dans l'ordre : rang 1 = Poly, puis les éléments expliqués. */
const HELP_ZONES: readonly (readonly [number, number, number, number])[] = [
  [317, 280, 388, 432],
  [487, 369, 516, 397],
  [418, 369, 447, 397],
  [453, 369, 482, 397],
  [496, 339, 525, 367],
  [408, 339, 437, 367],
  [448, 339, 484, 364],
  [410, 70, 528, 93],
  [410, 40, 528, 68],
  [430, 94, 509, 116],
  [408, 130, 531, 333],
  [44, 37, 399, 393],
];
const HELP_KEYS: readonly string[] = [POLY_ZONE, "print", "kaleidoscope", "faucet", "help", "yuck", "exit", "title", "name", "version", "colors", "window"];
const HELP_TABLE = HotspotTable.fromEdges(HELP_ZONES);

/** Clé de zone d'aide au point `(x, y)`, ou `null`. */
export function helpZoneAt(x: number, y: number): string | null {
  const rank = HELP_TABLE.hit(x, y);
  return rank === 0 ? null : HELP_KEYS[rank - 1]!;
}

function inside(edges: readonly [number, number, number, number], x: number, y: number): boolean {
  return x >= edges[0] && y >= edges[1] && x < edges[2] && y < edges[3];
}

// --- Sauvegarde du joueur ---

/** Variables de scène : celles du joueur courant dans le roster, ou une copie locale tant que personne n'est connecté. */
interface SaveData {
  pattern: number;
  versions: Uint8Array;
  color: number;
  storage: Uint8Array;
}

function localSave(): SaveData {
  return { pattern: 0, versions: new Uint8Array(PATTERN_COUNT), color: 0, storage: blankStorage() };
}

const clamp = (value: number, max: number) => (value >= 0 && value <= max ? value : 0);

// --- Scène ---

export interface PatternWindowsOptions {
  /** Remet le PNG du vitrail au joueur (navigateur : téléchargement) ; sans lui, le bouton Imprimer est inactif. */
  download?: Pick<CertificatePort, "download">;
  /** Clavier virtuel de la saisie du nom (moniteur de connexion). */
  textInput?: TextInputPort;
}

export function createPatternWindowsScene(services: MathServices, opts: PatternWindowsOptions = {}): Scene {
  return new PatternWindowsScene(services, opts);
}

type Flow =
  | { kind: "entering"; jingle: SoundHandle | null; ticks: number }
  | { kind: "normal" }
  | { kind: "leaving"; ticks: number; requested: boolean };

export class PatternWindowsScene implements Scene {
  private ctx!: SceneContext;
  private archive!: Archive;
  private mainscrn: Archive | null = null;
  private font10: FonFont | null = null;
  private font12: FonFont | null = null;
  private monitor: MonitorOverlay | null = null;
  private poly!: PolyHelper;
  private versions!: GadgetGroup;
  private actions!: GadgetGroup;
  private picks!: GadgetGroup;
  /** Fond seul (sert aux gadgets) et fond + texte + cellules + panneau. */
  private readonly base = new Surface();
  private readonly canvas = new Surface();

  private flow: Flow = { kind: "entering", jingle: null, ticks: 0 };
  private local = localSave();
  private save!: SaveData;
  private readonly state = createPaintState();
  private geometry!: PatternGeometry;
  private cells: CellDef[] = [];
  private stroke: { stroke: Stroke; x: number; y: number } | null = null;
  /** `DS:7042` : dernière cellule peinte (-1 : aucune depuis l'entrée). */
  private lastCell = -1;
  /** Ctrl enfoncé à l'entrée : les modes cachés du Robinet sont actifs. */
  private hiddenTools = false;
  private blinking = false;
  private blinkTicks = 0;
  private cycle: PaletteCycler | null = null;
  private opening = false;
  private openedThisTick = false;
  private lastPhase = "closed";
  private hubPalette: Uint8Array | null = null;

  constructor(
    private readonly services: MathServices,
    private readonly opts: PatternWindowsOptions,
  ) {}

  // --- Accès pour les tests et les outils ---

  get paintState() {
    return this.state;
  }
  get pattern(): number {
    return this.save.pattern;
  }
  get version(): number {
    return this.save.versions[this.save.pattern]!;
  }
  get color(): number {
    return this.save.color;
  }
  get cellDefs(): readonly CellDef[] {
    return this.cells;
  }
  get helper(): PolyHelper {
    return this.poly;
  }
  get flowKind(): Flow["kind"] {
    return this.flow.kind;
  }
  get kaleidoscopeActive(): boolean {
    return this.cycle?.active === true;
  }
  get arrowsBlinking(): boolean {
    return this.blinking;
  }
  get monitorOverlay(): MonitorOverlay | null {
    return this.monitor;
  }
  get lastPaintedCell(): number {
    return this.lastCell;
  }
  get hiddenToolsEnabled(): boolean {
    return this.hiddenTools;
  }

  // --- Cycle de vie ---

  async load(ctx: SceneContext): Promise<void> {
    const [, , mainscrn, font10, font12] = await Promise.all([
      ctx.resources.open(ARCHIVE),
      openPolyArchive(ctx.resources, PATTERN_WINDOWS_POLY),
      // Le moniteur est facultatif : sans son archive, la pastille de nom reste inerte (la scène ne doit pas échouer pour si peu).
      ctx.resources.open(MONITOR_ARCHIVE).catch(() => null),
      loadMonitorFont(ctx.host).catch(() => null),
      ctx.host.loadFile("NCSCLB12.FON").then((bytes) => parseFon(bytes)[0]!),
    ]);
    this.mainscrn = mainscrn;
    this.font10 = font10;
    this.font12 = font12;
  }

  enter(ctx: SceneContext): void {
    this.ctx = ctx;
    this.archive = ctx.resources.require(ARCHIVE);
    const { graphics, gadgets, pointer, scr, sound } = this.services;
    this.services.useArchive(this.archive);
    this.hiddenTools = ctx.input.ctrl;
    this.lastCell = -1;
    this.stroke = null;
    this.blinking = false;
    this.opening = false;
    this.openedThisTick = false;
    this.lastPhase = "closed";
    this.hubPalette = null;

    const { palette, screen } = graphics;
    for (const shpl of [SHAPE_BACKGROUND, 40200, 999]) palette.loadShpl(this.archive.shpl(shpl));
    this.base.pixels.set(this.archive.shap(SHAPE_BACKGROUND).pixels);

    this.bind();
    this.loadPattern();
    this.createGroups();
    this.syncVersionMarks();
    gadgets.captureBackground(this.base);

    this.monitor =
      this.mainscrn && this.font10
        ? new MonitorOverlay({
            ctx,
            services: this.services,
            archive: this.mainscrn,
            font: this.font10,
            textInput: this.opts.textInput,
            sceneGroups: () => [this.versions, this.actions, this.picks],
          })
        : null;

    this.poly = new PolyHelper(PATTERN_WINDOWS_POLY, {
      ports: createScrPolyPorts({
        config: PATTERN_WINDOWS_POLY,
        scr,
        archive: this.archive,
        surface: screen,
        cursor: pointer.cursor,
        onDirty: () => ctx.requestPresent(),
      }),
      rng: ctx.rng,
      introFlag: rosterIntroFlag(ctx.roster, PATTERN_WINDOWS_POLY.introFlag),
      onClosed: () => {
        this.ensureMusic();
        this.syncGroups();
        ctx.requestPresent();
      },
    });

    pointer.cursor.setBase("arrow");
    this.compose();
    palette.fadeFromBlack(FADE_TICKS);
    // Le jingle d'entrée est attendu avant que la scène soit active (`1060:06f4`) ; la musique démarre ensuite.
    this.flow = { kind: "entering", jingle: sound.playSound(this.archive, SOUND.jingle), ticks: 0 };
    this.syncGroups();
    ctx.requestPresent();
  }

  leave(ctx: SceneContext): void {
    this.monitor?.dispose();
    this.monitor = null;
    this.poly.abort();
    this.cycle?.stop(true);
    this.cycle = null;
    this.restoreHubPalette();
    if (ctx.roster.currentPlayerId !== 0) ctx.roster.save();
    this.services.endScene();
  }

  exit(): void {
    this.startLeave();
  }

  tick(ctx: SceneContext): void {
    this.ctx = ctx;
    const flow = this.flow;
    if (flow.kind === "leaving") {
      if (++flow.ticks >= FADE_TICKS && !flow.requested) {
        flow.requested = true;
        ctx.scenes.request(SceneId.hub);
      }
      return;
    }
    if (flow.kind === "entering") {
      if (++flow.ticks < JINGLE_WAIT_MAX_TICKS && this.services.sound.isPlaying(flow.jingle)) return;
      this.flow = { kind: "normal" };
      this.blinking = true;
      this.blinkTicks = 0;
      this.ensureMusic();
      this.syncGroups();
    }
    if (!this.monitorOpen) {
      if (this.cycle && !this.cycle.active) this.cycle = null;
      this.tickBlink();
      this.tickPainting();
      this.tickHelp();
    }
    this.syncGroups();
    this.openedThisTick = false;
    this.monitor?.tick();
  }

  key(event: KeyEvent): boolean {
    if (this.monitor?.isOpen) return this.monitor.key(event);
    if (this.flow.kind !== "normal" || this.poly.active || this.opening) return false;
    // `x` : couleur suivante, `z` : précédente ; sans son ; ignorées en mode aide (pattern-windows.md §6).
    if (event.key === "x" || event.key === "X") this.pickColor(nextColor(this.save.color));
    else if (event.key === "z" || event.key === "Z") this.pickColor(prevColor(this.save.color));
    else return false;
    return true;
  }

  // --- Sauvegarde ---

  /** Lit les variables du joueur courant (ou la copie locale) ; un vitrail jamais touché est rempli de `0x77`. */
  private bind(): void {
    const { roster, currentPlayerId: id } = this.ctx.roster;
    if (id === 0) {
      this.save = this.local;
      return;
    }
    const storage = roster.bytesOf(id, "patfillStainedGlass");
    if (storage.length !== STORAGE_BYTES) throw new Error("roster : stockage du vitrail de taille inattendue");
    // Un joueur neuf a des variables à zéro, pas le défaut de l'original (`1060:0d65` : octets à 0x77).
    if (storage.every((b) => b === 0)) storage.fill(BLANK_BYTE);
    const versions = new Uint8Array(PATTERN_COUNT);
    for (let i = 0; i < PATTERN_COUNT; i++) versions[i] = clamp(roster.getVar(id, "patfillVersion", i), VERSION_COUNT - 1);
    this.save = {
      pattern: clamp(roster.getVar(id, "patfillPattern"), PATTERN_COUNT - 1),
      versions,
      color: clamp(roster.getVar(id, "patfillColor"), COLOR_COUNT - 1),
      storage,
    };
  }

  /** Recopie motif, versions et couleur dans le roster (le stockage du vitrail y est une vue : déjà à jour). */
  private persistMeta(): void {
    const { roster, currentPlayerId: id } = this.ctx.roster;
    if (id === 0) return;
    roster.setVar(id, "patfillPattern", this.save.pattern);
    roster.setVar(id, "patfillColor", this.save.color);
    for (let i = 0; i < PATTERN_COUNT; i++) roster.setVar(id, "patfillVersion", this.save.versions[i]!, i);
  }

  /** Motif et version courants : `PTRN`, cellules, tampon de travail et instantané. */
  private loadPattern(): void {
    const { pattern } = this.save;
    this.geometry = parsePtrn(this.archive.raw("PTRN", PTRN_BASE + PTRN_STEP * pattern));
    this.cells = layoutCells(this.geometry, pattern);
    this.state.cells.set(readStorage(this.save.storage, pattern, this.version));
    takeSnapshot(this.state);
  }

  private persistCells(): void {
    writeStorage(this.save.storage, this.save.pattern, this.version, this.state.cells);
  }

  // --- Groupes de gadgets ---

  private createGroups(): void {
    const { gadgets } = this.services;
    this.versions = gadgets.addGroup({
      id: "versions",
      records: Array.from({ length: VERSION_COUNT }, (_, k): GadgetSpec => {
        const left = 436 + 28 * k;
        return {
          rect: rectFromEdges(left, 106, left + 11, 120),
          shapes: { normal: SHPL_DIGITS + 2 * k, pressed: SHPL_DIGITS + 2 * k + 1, selected: SHPL_DIGITS + 2 * k + 1 },
          pressSound: SOUND.version,
        };
      }),
      onActivate: (index) => this.onVersion(index - 1),
    });
    this.actions = gadgets.addGroup({
      id: "actions",
      records: BUTTONS.map(
        (def): GadgetSpec => ({
          rect: rectFromEdges(...def.edges),
          shapes: { normal: SHPL_BUTTONS + 2 * def.icon, pressed: SHPL_BUTTONS + 2 * def.icon + 1, selected: SHPL_BUTTONS + 2 * def.icon + 1 },
          pressSound: def.role === "help" ? () => (this.ctx.rng.range(1, 100) < 51 ? SOUND.helpB : SOUND.helpA) : (def.sound ?? undefined),
          disabled: def.role === "print" && !this.opts.download,
        }),
      ),
      onActivate: (index, _record, activation) => this.onButton(BUTTONS[index - 1]!.role, activation),
    });
    // Pastille de nom (entrée 1) puis les 15 couleurs (entrées 2 à 16) : sans forme (le décor les porte).
    this.picks = gadgets.addGroup({
      id: "picks",
      records: [
        { rect: rectFromEdges(...NAME_EDGES), pressSound: SOUND.name, focusable: false },
        ...Array.from({ length: COLOR_COUNT }, (_, c): GadgetSpec => ({ rect: rectFromEdges(...colorEdges(c)), pressSound: SOUND.color, focusable: false })),
      ],
      onActivate: (index) => (index === 1 ? this.openName() : this.pickColor(index - 2)),
    });
  }

  private get monitorOpen(): boolean {
    return this.monitor?.isOpen === true;
  }

  /** Les groupes réagissent quand rien d'autre ne tient la main : ni Poly, ni dialogue, ni entrée ou sortie. */
  private get groupsOpen(): boolean {
    return this.flow.kind === "normal" && !this.poly.active && !this.opening && !this.monitorOpen;
  }

  private syncGroups(): void {
    // Pendant le moniteur, ses propres règles (il neutralise nos groupes et rétablit leur état à la fermeture).
    if (this.monitorOpen) return;
    const open = this.groupsOpen;
    this.versions.active = open;
    this.actions.active = open;
    this.picks.active = open;
    // Le nom ne s'ouvre pas sans moniteur (archive absente).
    this.picks.record(1).disabled = this.monitor === null;
  }

  private syncVersionMarks(): void {
    for (let k = 0; k < VERSION_COUNT; k++) this.versions.record(k + 1).selected = k === this.version;
  }

  // --- Boutons ---

  /** Tout rappel de bouton commence par arrêter le kaléidoscope et le clignotement des flèches (`008a`). */
  private beginAction(): void {
    this.stopBlink();
    this.stopKaleidoscope();
  }

  private onButton(role: ButtonRole, activation: GadgetActivation): void {
    this.beginAction();
    switch (role) {
      case "print":
        this.print();
        break;
      case "kaleidoscope":
        this.startKaleidoscope();
        break;
      case "left":
        this.changePattern(prevPattern(this.save.pattern));
        break;
      case "right":
        this.changePattern(nextPattern(this.save.pattern));
        break;
      case "faucet":
        this.faucet(activation.source === "pointer");
        break;
      case "help":
        this.openHelp();
        break;
      case "yuck":
        if (toggleUndo(this.state)) {
          this.persistCells();
          this.compose();
        }
        break;
      case "exit":
        this.startLeave();
        break;
    }
  }

  private onVersion(version: number): void {
    // Les rappels du groupe des versions (`1060:0000`) arrêtent eux aussi le clignotement ; le kaléidoscope s'arrête par prudence (palette).
    this.beginAction();
    this.save.versions[this.save.pattern] = version;
    this.persistMeta();
    this.loadPattern();
    this.syncVersionMarks();
    this.compose();
  }

  private changePattern(pattern: number): void {
    this.save.pattern = pattern;
    this.persistMeta();
    this.loadPattern();
    this.syncVersionMarks();
    this.compose();
  }

  private pickColor(color: number): void {
    this.save.color = color;
    this.persistMeta();
    // L'instantané est repris à chaque changement de couleur (`03d5`, `1786`) : l'effacement revient à cet état.
    takeSnapshot(this.state);
    this.compose();
  }

  private faucet(pointer: boolean): void {
    takeSnapshot(this.state);
    const mode: FaucetMode = this.hiddenTools && pointer ? faucetMode(this.ctx.input.mouseX, this.ctx.input.mouseY) : 0;
    applyFaucet(this.state, mode, this.save.color, this.lastCell, this.geometry.cellsPerTile, this.ctx.rng);
    this.persistCells();
    this.compose();
  }

  // --- Kaléidoscope et clignotement ---

  private startKaleidoscope(): void {
    this.cycle = this.services.graphics.palette.startCycle({ ...KALEIDOSCOPE, restore: true });
  }

  private stopKaleidoscope(): void {
    if (!this.cycle) return;
    this.cycle.stop(true);
    this.cycle = null;
    this.ctx.requestPresent();
  }

  private stopBlink(): void {
    if (!this.blinking) return;
    this.blinking = false;
    this.setArrows(false);
  }

  private setArrows(on: boolean): void {
    for (const role of ["left", "right"] as const) this.actions.record(BUTTONS.findIndex((b) => b.role === role) + 1).selected = on;
  }

  /** Les flèches de motif alternent repos / appuyé toutes les 12 ticks jusqu'au premier clic. */
  private tickBlink(): void {
    if (!this.blinking) return;
    if (this.ctx.input.buttonEvents.some((e) => e.down)) {
      this.stopBlink();
      return;
    }
    if (++this.blinkTicks % BLINK_TICKS === 0) this.setArrows(!this.actions.record(3).selected);
  }

  // --- Peinture ---

  private hitCell = (cell: CellDef, dx: number, dy: number): boolean => hitTestShape(this.archive.shap(cell.maskId), dx, dy);

  private tickPainting(): void {
    const input = this.ctx.input;
    if (!this.groupsOpen) {
      this.stroke = null;
      return;
    }
    for (const event of input.buttonEvents) {
      if (event.button !== "left") continue;
      if (event.down) {
        if (!this.stroke && inside(WINDOW_EDGES, event.x, event.y)) {
          this.stroke = { stroke: beginStroke(this.state), x: event.x, y: event.y };
          this.paintPoint(event.x, event.y);
        }
      } else if (this.stroke) {
        this.extendStroke(event.x, event.y);
        this.stroke = null;
      }
    }
    if (this.stroke) {
      if (input.isButtonDown("left")) this.extendStroke(input.mouseX, input.mouseY);
      else this.stroke = null;
    }
  }

  /** Sonde le chemin du dernier point au point `(x, y)` : un sondage tous les `STROKE_STEP` px (un tick peut parcourir des dizaines de pixels). */
  private extendStroke(x: number, y: number): void {
    const s = this.stroke!;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x - s.x), Math.abs(y - s.y)) / STROKE_STEP));
    const fromX = s.x;
    const fromY = s.y;
    for (let k = 1; k <= steps; k++) this.paintPoint(Math.round(fromX + ((x - fromX) * k) / steps), Math.round(fromY + ((y - fromY) * k) / steps));
    s.x = x;
    s.y = y;
  }

  private paintPoint(x: number, y: number): void {
    const cell = paintAt(this.state, this.cells, this.hitCell, x, y, this.save.color, this.stroke!.stroke);
    if (cell < 0) return;
    this.lastCell = cell;
    writeStorageCell(this.save.storage, this.save.pattern, this.version, cell, this.state.cells[cell]!);
    this.redrawCell(this.cells[cell]!);
  }

  // --- Dessin ---

  private shape(id: number) {
    if (!this.archive.has(TAG_SHAP, id)) throw new Error(`${ARCHIVE} : forme ${id} absente`);
    return this.archive.shap(id);
  }

  /** Les tuiles du bord débordent de la fenêtre (motifs 1 à 8 : `PTRN` d'origine négative) : le dessin est écrêté au verre. */
  private drawCell(cell: CellDef): void {
    this.canvas.pushClip(GLASS);
    drawMask(this.canvas, this.shape(cell.maskId), cell.x, cell.y, PALETTE_FIRST + Math.min(this.state.cells[cell.index]!, COLOR_COUNT - 1));
    this.canvas.popClip();
  }

  private redrawCell(cell: CellDef): void {
    this.drawCell(cell);
    this.services.graphics.screen.copyFrom(this.canvas, { x: cell.x, y: cell.y, w: cell.width, h: cell.height });
    this.ctx.requestPresent();
  }

  private centered(font: FonFont, text: string, edges: readonly [number, number, number, number], color: number): void {
    const width = measureText(font, text);
    const x = edges[0] + Math.floor((edges[2] - edges[0] - width) / 2);
    const y = edges[1] + Math.floor((edges[3] - edges[1] - font.height) / 2);
    drawText(this.canvas, font, text, x, y, color);
  }

  /** Recompose le canevas (fond, nom, titre, cellules, cadre de la couleur, panneau) puis l'écran et les gadgets. Jamais pendant l'aide ni le moniteur. */
  private compose(): void {
    const { graphics, gadgets, scr } = this.services;
    this.canvas.copyFrom(this.base);
    const player = this.ctx.roster.currentPlayer;
    if (player && this.font10) this.centered(this.font10, player.name, NAME_EDGES, TEXT_COLOR);
    const title = this.archive.strl(STRL_NAMES)[this.save.pattern];
    if (title && this.font12) this.centered(this.font12, title, TITLE_EDGES, TEXT_COLOR);
    for (const cell of this.cells) this.drawCell(cell);
    // Le cadre de sélection est dessiné d'abord, le panneau (transparent autour des pastilles) le recouvre.
    const edges = colorEdges(this.save.color);
    drawShape(this.canvas, this.shape(SHAPE_FRAME), edges[0] - 2, edges[1] - 2, 8);
    drawShape(this.canvas, this.shape(SHAPE_PANEL), PANEL_AT.x, PANEL_AT.y, 8);
    if (this.poly?.active || this.monitorOpen) return;
    graphics.screen.copyFrom(this.canvas);
    gadgets.invalidate();
    gadgets.draw(graphics.screen);
    scr.redraw();
    this.ctx.requestPresent();
  }

  // --- Impression ---

  /** Imprimer : roster enregistré, puis le PNG de la fenêtre `(51, 45, 394, 388)` est remis au port de téléchargement. */
  private print(): void {
    const port = this.opts.download;
    if (!port) return;
    if (this.ctx.roster.currentPlayerId !== 0) this.ctx.roster.save();
    const { left, top, right, bottom } = PRINT_EDGES;
    const pixels = cropPixels(this.canvas.pixels, this.canvas.width, left, top, right, bottom);
    const png = encodeIndexedPng(right - left, bottom - top, pixels, this.services.graphics.palette.colors);
    const name = this.archive.strl(STRL_NAMES)[this.save.pattern] ?? "";
    port.download(new Blob([png as BlobPart], { type: "image/png" }), printFileName(name));
  }

  // --- Pastille de nom (moniteur de connexion) ---

  private openName(): void {
    const monitor = this.monitor;
    if (!monitor || monitor.isOpen || !this.mainscrn) return;
    this.beginAction();
    this.stroke = null;
    if (this.ctx.roster.currentPlayerId !== 0) this.ctx.roster.save();
    // Le moniteur dessine avec les couleurs du hub : la palette de la scène est rendue à la fermeture.
    const { palette } = this.services.graphics;
    this.hubPalette = palette.snapshot(HUB_PALETTE_FIRST, HUB_PALETTE_COUNT);
    palette.loadShpl(this.mainscrn.shpl(HUB_PALETTE_SHPL));
    monitor.open("signin", (result) => this.onMonitorClosed(result));
  }

  private restoreHubPalette(): void {
    if (!this.hubPalette) return;
    this.services.graphics.palette.restore(this.hubPalette, HUB_PALETTE_FIRST);
    this.hubPalette = null;
  }

  private onMonitorClosed(result: MonitorResult): void {
    this.restoreHubPalette();
    // Un autre joueur : ses motif, versions, couleur et vitrail (`03d5` : rechargement après `2d60 == 2`).
    this.bind();
    this.loadPattern();
    this.syncVersionMarks();
    this.syncGroups();
    this.compose();
    if (result.ambientChanged) {
      if (this.ctx.roster.roster.ambient) this.ensureMusic();
      else this.services.sound.stopAmbient();
    }
  }

  // --- Aide de Poly ---

  private openHelp(): void {
    if (this.poly.active || this.opening) return;
    const { gadgets, graphics, pointer, sound } = this.services;
    pointer.cancel();
    sound.stopMusic();
    this.opening = true;
    this.syncGroups();
    // Les boutons sont redessinés au repos avant l'arrivée de Poly : elle est composée par-dessus.
    gadgets.updatePointer(-1, -1);
    gadgets.draw(graphics.screen);
    this.poly.open();
    this.opening = false;
    this.openedThisTick = true;
    this.syncGroups();
    this.ctx.requestPresent();
  }

  private tickHelp(): void {
    if (!this.poly.active) {
      this.lastPhase = "closed";
      return;
    }
    const { scr } = this.services;
    // Pendant une animation bloquante, le lecteur gère lui-même le clic qui l'interrompt.
    if (!scr.blockedThisTick && !this.openedThisTick) {
      const input = this.ctx.input;
      const context = { variedImage: isColorful(this.state.cells, PATTERN_STORAGE_BYTES[this.save.pattern]!) };
      for (const event of input.buttonEvents) {
        if (event.down) this.poly.click(helpZoneAt(event.x, event.y) ?? "none", context);
      }
      if (this.poly.phase === "listening") this.poly.hover(helpZoneAt(input.mouseX, input.mouseY));
    }
    this.poly.tick();
    // La main « stop » est dessinée à la fin de la présentation (arrivée de Poly ou rappel d'inactivité).
    if (this.poly.phase === "listening" && this.lastPhase === "intro") {
      drawShape(this.services.graphics.screen, this.shape(SHAPE_HAND), HAND_AT.x, HAND_AT.y, 8);
      this.ctx.requestPresent();
    }
    this.lastPhase = this.poly.phase;
  }

  // --- Sortie, musique ---

  private startLeave(): void {
    if (this.flow.kind === "leaving") return;
    const { scr, sound, pointer, graphics } = this.services;
    this.monitor?.dispose();
    this.restoreHubPalette();
    this.poly.abort();
    this.stopKaleidoscope();
    this.stopBlink();
    this.stroke = null;
    if (this.ctx.roster.currentPlayerId !== 0) this.ctx.roster.save();
    scr.stopAll();
    sound.stopAll();
    sound.stopMusic();
    graphics.palette.fadeToBlack(FADE_TICKS);
    pointer.cursor.setBase("arrow");
    this.flow = { kind: "leaving", ticks: 0, requested: false };
    this.syncGroups();
  }

  private ensureMusic(): void {
    const { sound } = this.services;
    if (this.flow.kind !== "normal" || sound.musicPlaying) return;
    sound.playSound(this.archive, SOUND.music, { loop: true, ambient: true });
  }
}
