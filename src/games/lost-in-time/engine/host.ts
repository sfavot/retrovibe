import type { Font } from "../data/font";
import type { Language } from "../data/tot";
import type { Resources } from "./resources";
import type { Script } from "./script";
import type { Variables } from "./variables";

/**
 * Frontière unique entre le moteur de scripts et l'extérieur : fichiers, horloge, entrées,
 * et les sous-systèmes (affichage, son, vidéo…) dont l'implémentation viendra plus tard.
 * Le moteur ne touche ni au DOM, ni à `fetch`, ni à `Date`.
 */

// --- Hôte --------------------------------------------------------------------------------------

export const MOUSE_NONE = 0;
export const MOUSE_LEFT = 1;
export const MOUSE_RIGHT = 2;
export const MOUSE_BOTH = 3;

/** État des entrées, en coordonnées 320x200. Les touches sont les codes du jeu (scan << 8 | ASCII). */
export interface InputState {
  mouseX: number;
  mouseY: number;
  /** MOUSE_NONE / MOUSE_LEFT / MOUSE_RIGHT / MOUSE_BOTH. */
  mouseButtons: number;
  /** Retire et retourne la plus ancienne touche en attente, 0 s'il n'y en a pas. */
  popKey(): number;
  clearKeys(): void;
  /** Replace le curseur (setMousePos). */
  setMousePos(x: number, y: number): void;
}

export interface Host {
  /** Charge un fichier ou une archive du jeu par nom ; undefined s'il n'existe pas. */
  loadFile(name: string): Promise<Uint8Array | undefined>;
  /** Taille d'un fichier sans le charger ; undefined s'il n'existe pas. */
  fileSize(name: string): Promise<number | undefined>;
  /** Millisecondes monotones. */
  now(): number;
  /** Résolu au prochain rafraîchissement (≈ 1/60 s) : la seule façon d'attendre. */
  nextFrame(): Promise<void>;
  readonly input: InputState;
  /** Entier dans [0, max[. */
  random(max: number): number;
  /** Date locale (pour renewTimeInVars). */
  date(): Date;
  language: Language;
}

/** Cadence d'animation (setFrameRate / waitEndFrame de Util). */
export class FrameTimer {
  frameRate = 12;
  frameWaitTime = 0;
  startFrameTime = 0;

  constructor(private readonly host: Pick<Host, "now" | "nextFrame">) {}

  setFrameRate(rate: number): void {
    if (rate === 0) rate = 1;
    this.frameRate = rate;
    this.frameWaitTime = Math.trunc(1000 / rate);
    this.startFrameTime = this.host.now();
  }

  notifyNewAnim(): void {
    this.startFrameTime = this.host.now();
  }

  /** Attend la fin de la durée d'une image (waitEndFrame). */
  async waitEndFrame(): Promise<void> {
    let time = this.host.now() - this.startFrameTime;
    if (time > 1000 || time < 0) {
      await this.host.nextFrame();
      this.startFrameTime = this.host.now();
      return;
    }
    let toWait: number;
    do {
      await this.host.nextFrame();
      time = this.host.now() - this.startFrameTime;
      toWait = this.frameWaitTime - time;
    } while (toWait > 0);
    this.startFrameTime = this.host.now();
  }
}

// --- Contexte offert aux sous-systèmes ------------------------------------------------------

/** Ce que les sous-systèmes voient de la machine virtuelle (toujours l'état courant). */
export interface VmContext {
  readonly host: Host;
  readonly timer: FrameTimer;
  readonly vars: Variables;
  readonly script: Script;
  readonly resources: Resources | null;
  readonly curTotFile: string;
  readonly animDataSize: number;
  /** Mode vidéo annoncé aux scripts (variable 15) ; o2_initScreen le remplace. */
  fakeVideoMode: number;
  /** Compteur de captures (capturePush / capturePop) du bloc courant. */
  captureCounter: number;
  /** 0 = rien, 1 = fin demandée, 2 = fin du jeu. */
  readonly terminate: number;
  cursorHotspotXVar: number;
  cursorHotspotYVar: number;
  /** script.call(offset) ; [before()] ; funcBlock(0) ; script.pop() */
  runFunction(offset: number, before?: () => void): Promise<void>;
  storeMouse(): void;
  /** Pause en millisecondes, par pas d'une image. */
  sleep(ms: number): Promise<void>;
  /** Demande de fermeture du jeu. */
  readonly quit: boolean;
  /** Souris vue par le jeu (dernier checkKeys avec synchronisation), en coordonnées 320x200. */
  readonly mouseX: number;
  readonly mouseY: number;
  readonly mouseButtons: number;
  /** Gestion de la souris demandée par le bloc de zones courant. */
  readonly handleMouse: number;
  /**
   * Game::checkKeys : anime (mult, sons), lit la souris et retourne la touche en attente.
   * `sync` faux : n'écrase pas la souris du jeu (attente du relâchement d'un bouton).
   */
  checkKeys(handleMouse: number, sync?: boolean): number;
  /** Un pas d'animation de palette (animPalette). */
  animPalette(): void;
  /** Inter::storeKey : écrit la touche (convertie) et l'état courant dans les variables 0 à 4 et 12. */
  storeKey(key: number): void;
  /**
   * Évalue `count` expressions de valeur à `offset` (call / readValExpr x count / pop),
   * sans modifier la position du script : coordonnées des zones recalculées.
   */
  evalCoords(offset: number, count: number): number[];
  /** Contenu d'un fichier des archives ouvertes (ou d'un fichier déjà chargé). */
  getFile(name: string): Uint8Array | undefined;
}

// --- Arguments décodés transmis aux sous-systèmes -----------------------------------------

export interface PrintTextArgs {
  x: number;
  y: number;
  backColor: number;
  frontColor: number;
  fontIndex: number;
  /** Texte d'un morceau, variables déjà substituées. */
  text: string;
  transparent: boolean;
  /** Ignore le décalage de fond (DRAW_PRINTTEXT | 0x10 des zones de saisie). */
  deltaVeto?: boolean;
}

export interface PaletteLoadArgs {
  /** Sous-commande (48..61). */
  cmd: number;
  /** Vrai si le bit 0x80 est absent (la palette est appliquée aussitôt). */
  applyNow: boolean;
  /** Octets de données qui suivent la commande dans le script. */
  data: Uint8Array;
}

export interface InitCursorArgs {
  width: number;
  height: number;
  count: number;
}

export interface SceneryLoadArgs {
  /** Index évalué dans le script. */
  index: number;
  /** Fonds par couche (statiques uniquement). */
  backs: number[];
  picsCount: number;
  resId: number;
  pics: { pictDescId: number; width: number; height: number; sprResId: number }[];
  /** Recherche d'un décor déjà chargé avec la même ressource (chargement par loadMult). */
  search: boolean;
}

export interface SoundKeyLoad {
  /** Numéro de la clé son dans la ressource. */
  keyIndex: number;
  /** Même ressource qu'une clé précédente : rien à charger. */
  duplicate: boolean;
  id: number;
  /** Nom du fichier .SND quand id vaut -1. */
  name: string | null;
}

export interface LoadMultArgs {
  /** Numéro d'emplacement de données mult (0 par défaut). */
  index: number;
  resId: number;
  statics: SceneryLoadArgs[];
  anims: SceneryLoadArgs[];
  soundKeys: SoundKeyLoad[];
  /** Section IMD : offset et nombre de mots des instructions, fichiers IMD (14 octets chacun). */
  imds: { execPos: number; execWords: number; files: Uint8Array | null } | null;
}

export interface MultObjectArgs {
  objIndex: number;
  x: number;
  y: number;
  /** 11 octets de données d'animation ; null quand l'octet est laissé tel quel. */
  data: (number | null)[];
}

export interface InitMultArgs {
  left: number;
  top: number;
  width: number;
  height: number;
  objCount: number;
  posXVar: number;
  posYVar: number;
  animDataVar: number;
}

export interface SoundLoadArgs {
  slot: number;
  adlib: boolean;
  /** Numéro de ressource, ou -1 pour un fichier nommé. */
  id: number;
  name: string | null;
}

export interface PlayImdArgs {
  /** Nom (8 caractères au plus) ; vide pour une commande sans vidéo. */
  name: string;
  x: number;
  y: number;
  startFrame: number;
  lastFrame: number;
  breakKey: number;
  flags: number;
  palStart: number;
  palEnd: number;
  /** 1 << (flags & 0x3F) */
  palCmd: number;
}

export interface ImdProps {
  startFrame: number;
  lastFrame: number;
  noBlock: boolean;
}

export interface HotspotInput {
  /** Décalage de la variable recevant le texte saisi. */
  keyVar: number;
  fontIndex: number;
  backColor: number;
  frontColor: number;
  length: number;
  str: Uint8Array | null;
}

export interface HotspotDef {
  index: number;
  /** Type de l'entrée (0 aucun, 1 déplacement, 2 clic, 3..10 saisie, 11/12 réactivation, 20/21 clic). */
  type: number;
  windowNum: number;
  /** Coordonnées lues dans le script (non ajustées au mode vidéo). */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Offset des expressions de coordonnées, 0 si les coordonnées sont immédiates. */
  funcPos: number;
  key: number;
  /** ids[i] : valeur écrite dans la variable « zone courante ». */
  id: number;
  flags: number;
  funcEnter: number;
  funcLeave: number;
  input: HotspotInput | null;
  /** Pour les types 11 et 12 : réactive les zones désactivées de ce type. */
  enable: "type1" | "type2" | null;
}

export interface HotspotBlock {
  handleMouse: number;
  /** Durée en secondes (octet +1). */
  duration: number;
  leaveWindowIndex: number;
  hotspotIndex1: number;
  hotspotIndex2: number;
  needRecalc: boolean;
  hotspots: HotspotDef[];
}

export interface AddHotspotArgs {
  id: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  flags: number;
  key: number;
  funcEnter: number;
  funcLeave: number;
  funcPos: number;
}

export interface GoblinPlaceArgs {
  index: number;
  x: number;
  y: number;
  state: number;
}

// --- Sous-systèmes ----------------------------------------------------------------------------

type Maybe<T> = T | Promise<T>;

/** Mesures d'une police pour la saisie de texte. */
export type FontMetrics = Pick<Font, "monospaced" | "charHeight" | "charWidthDefault" | "charWidth">;

export interface DrawSystem {
  /** Police chargée à cet index (zones de saisie) ; absent ou null : mesures par défaut 8x8. */
  fontMetrics?(index: number): FontMetrics | null | undefined;
  /** État de rendu utilisé pour placer les zones : décalage de capturePop (RENDERFLAG_CAPTUREPOP). */
  renderState?(): { capturePop: boolean; backDeltaX: number; backDeltaY: number };
  adjustCoords(kind: 0 | 1 | 2, a: number, b: number): [number, number];
  setRenderFlags(expr: number): void;
  setBackDelta(x: number, y: number): void;
  /** Texte du TOT n°id (peut exécuter la fonction de centrage du script). */
  printTotText(id: number): Promise<void>;
  printText(args: PrintTextArgs): void;
  loadSprite(resId: number, destSurface: number, transparency: number, x: number, y: number): void;
  copySprite(
    src: number,
    dest: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
    x: number,
    y: number,
    transparency: number,
  ): void;
  fillRect(surface: number, x: number, y: number, width: number, height: number, color: number, deltaVeto?: boolean): void;
  drawLine(surface: number, x1: number, y1: number, x2: number, y2: number, color: number): void;
  putPixel(surface: number, x: number, y: number, color: number): void;
  invalidate(surface: number, x: number, y: number, right: number, bottom: number): void;
  createSprite(index: number, width: number, height: number, flag: number): void;
  freeSprite(index: number): void;
  loadFont(index: number, name: string): void;
  freeFont(index: number): void;
  loadFontToSprite(index: number, sprite: number, base: number, width: number, height: number): void;
  freeFontToSprite(index: number): void;
  capturePush(left: number, top: number, width: number, height: number): void;
  capturePop(doDraw: boolean): void;
  /** `respectRenderFlags` : ne rien faire si le drapeau NOBLITINVALIDATED est posé. */
  blitInvalidated(respectRenderFlags?: boolean): void;
  setHotspotText(text: string): void;
  /** Efface le texte-ressource des polices-sprites au début d'un TOT. */
  resetFontToSprite(count: number): void;
  restoreMainSurfaces(): void;
  closeAllWin(): void;
  initScreen(videoMode: number, offY: number, width: number, height: number): void;
  scroll(startX: number, startY: number, endX: number, endY: number, stepX: number, stepY: number): Promise<void>;
  setScrollOffset(x: number, y: number): void;
  wobble(): Promise<void>;
  /** Sauvegarde / restauration des sprites, sons et polices (totSub de type 18). */
  backupMedia(env: number): void;
  restoreMedia(env: number): void;
}

export interface CursorSystem {
  initCursor(args: InitCursorArgs): void;
  initAnim(index: number, low: number, high: number, delay: number): void;
  clearAnim(index: number): void;
  load(resId: number, index: number): void;
  /** Cache l'animation de curseur (showCursor &= ~2). */
  hideAnim(): void;
  animate(mode: number): void;
  blit(): void;
}

export interface PaletteSystem {
  /** Asynchrone : les fondus de palette durent plusieurs images. */
  load(args: PaletteLoadArgs): Maybe<void>;
  /** Un pas d'animation de palette ; les plages sont tenues par le moteur de scripts. */
  animate(low: number, high: number, direction: 1 | -1): void;
  commitAnimation(): void;
}

export interface MultSystem {
  initAll(): void;
  zeroMultData(): void;
  loadMult(args: LoadMultArgs): void;
  playMult(dataIndex: number, startFrame: number, checkEscape: boolean): Promise<void>;
  freeMultKeys(index: number): void;
  multSub(values: number[]): void;
  /** Pas d'animation déclenché par la variable 58 à chaque lecture des touches (Game::checkKeys). */
  checkKeysTick(handleMouse: number): void;
  initMult(args: InitMultArgs): void;
  freeMult(): void;
  animate(): Promise<void>;
  loadMultObject(args: MultObjectArgs): void;
  // décors animés (scenery)
  loadStatic(args: SceneryLoadArgs): number;
  loadAnim(args: SceneryLoadArgs): number;
  freeStatic(index: number): void;
  freeAnim(index: number): void;
  renderStatic(index: number, layer: number): void;
  loadCurLayer(curStatic: number, curStaticLayer: number): void;
  updateAnim(layer: number, frame: number, animation: number, flags: number, deltaX: number, deltaY: number): void;
  getAnimLayerInfo(anim: number, layer: number, varDX: number, varDY: number, varUnk0: number, varFrames: number): void;
  getObjAnimSize(objIndex: number, varLeft: number, varTop: number, varRight: number, varBottom: number): void;
}

export interface GoblinSystem {
  freeObjects(): void;
  loadMapObjects(varOffset: number, id: number, data: number[]): void;
  moveGoblin(destX: number, destY: number, index: number): void;
  writeGoblinPos(varX: number, varY: number, index: number): void;
  stopGoblin(index: number): void;
  setGoblinState(index: number, state: number, type: number): void;
  placeGoblin(args: GoblinPlaceArgs): void;
}

export interface SoundSystem {
  isPlaying(): boolean;
  /** Joue un son chargé. Retourne la durée avant l'arrêt programmé si repCount est négatif. */
  play(slot: number, repCount: number, frequency: number): { endMs: number; fadeOut: number } | null;
  /** Arrête le canal ; `fadeLength` en dixièmes de seconde (0 = tout de suite). */
  stop(fadeLength: number): void;
  stopAdlib(): void;
  load(args: SoundLoadArgs): void;
  /**
   * Inter_v2::loadSound(search) pour les clés son de loadMult : réutilise l'emplacement qui porte déjà
   * cette ressource (bit 0x8000 posé dans le résultat), sinon prend le dernier libre ; 0 en cas d'échec.
   */
  loadSearch(id: number, name: string | null): number;
  freeSlot(slot: number): void;
  /** Environments::setMedia / getMedia : met de côté les emplacements de sons d'un environnement (totSub). */
  backupSlots(env: number): void;
  restoreSlots(env: number): void;
  /** Libère les sons SND/WAV chargés à la fin d'un TOT. */
  freeLoadedSamples(): void;
  waitEndPlay(): Promise<void>;
  /** Attend la fin du son en cours, puis enchaîne les emplacements de la liste. */
  playComposition(composition: number[], frequency: number): Maybe<void>;
  speakerOn(frequency: number, length: number): void;
  speakerOff(): void;
  infogramesLoadInstruments(file: string): void;
  infogramesLoadSong(file: string): void;
  infogramesPlay(): void;
  infogramesStop(): void;
}

export interface CdSystem {
  loadLic(name: string): void;
  unloadLic(): void;
  play(track: string): void;
  stop(): void;
  /** Position dans la piste en cours (-1 si plus rien ne joue) ; avec un nom, la position dans cette piste. */
  getTrackPos(track?: string): number;
  getCurrentTrack(): string;
}

export interface VideoSystem {
  /** Ouvre une vidéo ; retourne l'emplacement, ou -1 si elle est introuvable. */
  open(name: string, args: PlayImdArgs): Promise<number>;
  play(slot: number, props: ImdProps, args: PlayImdArgs): Promise<void>;
  close(slot: number): void;
  writeInfo(name: string, varX: number, varY: number, varFrames: number, varWidth: number, varHeight: number): Promise<void>;
  /** Rouvre les vidéos après la fermeture d'une archive. */
  reopenAll(): void;
}

export interface SaveSystem {
  /** 'none' : fichier ordinaire ; 'save' : sauvegarde ; 'exists' : présence seule ; 'ignore'. */
  getSaveMode(file: string): "none" | "save" | "exists" | "ignore";
  getSize(file: string): number;
  load(file: string, varOffset: number, size: number, offset: number): Maybe<boolean>;
  save(file: string, varOffset: number, size: number, offset: number): Maybe<boolean>;
}

/** Résultat de l'évaluation d'un bloc de zones : offset à rejoindre, null si le script est terminé. */
export interface HotspotContext {
  /** Appelle la fonction du script à `offset` (call / funcBlock(0) / pop). */
  call(offset: number): Promise<void>;
  /** Écrit la souris et l'état courant dans les variables 2 à 4. */
  storeMouse(): void;
  /** Vrai si la fin du script a été demandée. */
  isTerminated(): boolean;
  vars: Variables;
}

export interface HotspotSystem {
  /** Construit les zones du bloc, attend l'événement choisi et retourne l'offset du « leave » à exécuter. */
  evaluate(block: HotspotBlock, ctx: HotspotContext): Promise<number | null>;
  /** Ajoute une zone (o2_addHotspot). */
  add(args: AddHotspotArgs): number;
  remove(id: number): void;
  removeState(state: number): void;
  push(all: number, force: boolean): void;
  pop(): void;
  clear(): void;
  /** Vérifie la zone sous la souris (keyFunc 0). Retourne la touche. */
  check(handleMouse: number, delay: number): Promise<number>;
}

export interface Subsystems {
  draw: DrawSystem;
  cursor: CursorSystem;
  palette: PaletteSystem;
  mult: MultSystem;
  goblin: GoblinSystem;
  sound: SoundSystem;
  cd: CdSystem;
  video: VideoSystem;
  saves: SaveSystem;
  hotspots: HotspotSystem;
  /** Appelé une fois que la machine virtuelle est construite. */
  attach?(vm: VmContext): void;
}

// --- Sous-systèmes « vides » qui enregistrent les appels ----------------------------------

export interface RecordedCall {
  system: keyof Omit<Subsystems, "attach">;
  method: string;
  args: unknown[];
}

/** Valeurs de retour des méthodes qui en ont une ; tout le reste retourne undefined. */
const NULL_RETURNS: { [system: string]: { [method: string]: (...args: any[]) => unknown } } = {
  draw: { adjustCoords: (_kind: number, a: number, b: number) => [a, b] },
  mult: { loadStatic: () => 0, loadAnim: () => 0 },
  sound: { isPlaying: () => false, play: () => null },
  cd: { getTrackPos: () => -1, getCurrentTrack: () => "" },
  video: { open: () => Promise.resolve(-1) },
  saves: { getSaveMode: () => "none", getSize: () => 0, load: () => false, save: () => false },
  hotspots: { add: () => 0, check: () => Promise.resolve(0) },
};

/** Signal levé par les sous-systèmes d'exécution à blanc quand le jeu attend une action du joueur. */
export class WaitingForInput extends Error {
  constructor(readonly reason: string) {
    super(`en attente d'une action du joueur (${reason})`);
    this.name = "WaitingForInput";
  }
}

export interface NullSubsystemsOptions {
  /** Appelé à chaque appel enregistré ; peut lever (par exemple WaitingForInput). */
  onCall?(call: RecordedCall): void;
  /** Remplace le comportement d'un sous-système (par système, puis par méthode). */
  overrides?: { [system: string]: { [method: string]: (...args: any[]) => unknown } };
}

/** Sous-systèmes sans effet : chaque appel est enregistré dans `calls` et les retours sont neutres. */
export class NullSubsystems implements Subsystems {
  readonly calls: RecordedCall[] = [];
  draw!: DrawSystem;
  cursor!: CursorSystem;
  palette!: PaletteSystem;
  mult!: MultSystem;
  goblin!: GoblinSystem;
  sound!: SoundSystem;
  cd!: CdSystem;
  video!: VideoSystem;
  saves!: SaveSystem;
  hotspots!: HotspotSystem;
  vm: VmContext | null = null;

  constructor(private readonly options: NullSubsystemsOptions = {}) {
    for (const name of [
      "draw",
      "cursor",
      "palette",
      "mult",
      "goblin",
      "sound",
      "cd",
      "video",
      "saves",
      "hotspots",
    ] as const) {
      (this as unknown as Record<string, unknown>)[name] = this.recorder(name);
    }
  }

  attach(vm: VmContext): void {
    this.vm = vm;
  }

  /** Nombre d'appels enregistrés pour `system.method`. */
  count(system: RecordedCall["system"], method: string): number {
    return this.calls.filter((c) => c.system === system && c.method === method).length;
  }

  private recorder<T extends object>(system: RecordedCall["system"]): T {
    const record = (method: string, args: unknown[]): void => {
      const call: RecordedCall = { system, method, args };
      this.calls.push(call);
      this.options.onCall?.(call);
    };
    return new Proxy({} as T, {
      get: (_target, property) => {
        const method = String(property);
        return (...args: unknown[]) => {
          record(method, args);
          const override = this.options.overrides?.[system]?.[method] ?? NULL_RETURNS[system]?.[method];
          return override ? override(...args) : undefined;
        };
      },
    });
  }
}

// --- Hôte sans affichage (tests, exécution à blanc) ---------------------------------------

/** Entrées simulées : file de touches et état de la souris. */
export class HeadlessInput implements InputState {
  mouseX = 152;
  mouseY = 92;
  mouseButtons = MOUSE_NONE;
  private readonly keys: number[] = [];

  pushKey(key: number): void {
    this.keys.push(key);
  }

  popKey(): number {
    return this.keys.shift() ?? 0;
  }

  clearKeys(): void {
    this.keys.length = 0;
  }

  setMousePos(x: number, y: number): void {
    this.mouseX = x;
    this.mouseY = y;
  }
}

export interface HeadlessHostOptions {
  /** Fournit le contenu d'un fichier du jeu ; undefined s'il n'existe pas. */
  readFile(name: string): Promise<Uint8Array | undefined> | Uint8Array | undefined;
  language?: Language;
  /** Durée simulée d'une image (ms). */
  frameMs?: number;
  seed?: number;
}

/** Hôte déterministe : horloge simulée (avancée par nextFrame), hasard à graine, date fixe. */
export class HeadlessHost implements Host {
  readonly input = new HeadlessInput();
  language: Language;
  time = 0;
  frames = 0;
  private seed: number;

  constructor(private readonly options: HeadlessHostOptions) {
    this.language = options.language ?? "fr";
    this.seed = options.seed ?? 1;
  }

  async loadFile(name: string): Promise<Uint8Array | undefined> {
    return this.options.readFile(name);
  }

  async fileSize(name: string): Promise<number | undefined> {
    return (await this.options.readFile(name))?.length;
  }

  now(): number {
    return this.time;
  }

  nextFrame(): Promise<void> {
    this.time += this.options.frameMs ?? 16;
    this.frames++;
    return Promise.resolve();
  }

  random(max: number): number {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    return (this.seed >>> 8) % max;
  }

  date(): Date {
    return new Date(1995, 5, 15, 12, 0, 0);
  }
}
