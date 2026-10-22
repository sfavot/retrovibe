import { Archive } from "../data/archive";
import type { Language } from "../data/tot";
import { FrameTimer, MOUSE_NONE, type Host, type Subsystems, type VmContext } from "./host";
import { Interpreter } from "./interpreter";
import { loadResources, type FileSource, type Resources } from "./resources";
import { Script } from "./script";
import type { Variables } from "./variables";

const ENVIRONMENT_COUNT = 20;

/** Global::_soundFlags au démarrage : sons et musique activés. */
export const DEFAULT_SOUND_FLAGS = 0x4000 | 1 | 4 | 8;

const LANGUAGE_INDEX: Record<Language, number> = { fr: 0, de: 1, gb: 2, es: 3, it: 4, us: 5 };

/** Archives ouvertes (STK / ITK) et fichiers ordinaires déjà chargés ; les plus récentes d'abord. */
export class DataFiles implements FileSource {
  private readonly slots: ({ archive: Archive; name: string; base: boolean } | null)[] = [];
  private readonly plain = new Map<string, Uint8Array>();

  constructor(private readonly host: Host) {}

  get archiveNames(): string[] {
    return this.slots.filter((s) => s).map((s) => s!.name);
  }

  /** Ouvre une archive (extension .STK par défaut). `base` : archive de base (INTRO.STK…) plutôt que de données. */
  async openArchive(name: string, base: boolean): Promise<boolean> {
    if (!name.includes(".")) name += ".STK";
    const data = await this.host.loadFile(name);
    if (!data) return false;
    const entry = { archive: new Archive(data), name, base };
    const free = this.slots.indexOf(null);
    if (free >= 0) this.slots[free] = entry;
    else this.slots.push(entry);
    return true;
  }

  /** Ferme la dernière archive ouverte du type demandé. */
  closeArchive(base: boolean): boolean {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      if (this.slots[i] && this.slots[i]!.base === base) {
        this.slots[i] = null;
        return true;
      }
    }
    return false;
  }

  get(name: string): Uint8Array | undefined {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const data = this.slots[i]?.archive.get(name);
      if (data) return data;
    }
    return this.plain.get(name.toUpperCase());
  }

  has(name: string): boolean {
    for (let i = this.slots.length - 1; i >= 0; i--) if (this.slots[i]?.archive.has(name)) return true;
    return this.plain.has(name.toUpperCase());
  }

  /** Comme `get`, mais va chercher un fichier ordinaire auprès de l'hôte s'il n'est dans aucune archive. */
  async fetch(name: string): Promise<Uint8Array | undefined> {
    const known = this.get(name);
    if (known) return known;
    const data = await this.host.loadFile(name);
    if (data) this.plain.set(name.toUpperCase(), data);
    return data;
  }

  /** Taille d'un fichier (-1 s'il n'existe pas), sans charger les fichiers ordinaires. */
  async sizeOf(name: string): Promise<number> {
    const known = this.get(name);
    if (known) return known.length;
    return (await this.host.fileSize(name)) ?? -1;
  }
}

interface Environment {
  variables: Variables | null;
  script: Script | null;
  resources: Resources | null;
  totFile: string;
  cursorHotspotX: number;
  cursorHotspotY: number;
}

export interface GameOptions {
  /** Nombre maximal d'instructions (garde-fou). */
  maxSteps?: number;
  startTot?: string;
  startArchive?: string;
}

/**
 * Cycle de vie des TOT (Game) : chargement, environnements empilés (totSub / switchTotSub),
 * boucle playTot, arrêt. Le jeu démarre comme l'original sur INTRO.TOT.
 */
export class Game implements VmContext {
  readonly files: DataFiles;
  readonly timer: FrameTimer;
  readonly inter: Interpreter;

  script = new Script();
  resources: Resources | null = null;
  curTotFile = "";
  totToLoad = "";
  startTimeKey = 0;
  handleMouse = 0;
  mouseX = 152;
  mouseY = 92;
  mouseButtons = MOUSE_NONE;
  cursorHotspotXVar = -1;
  cursorHotspotYVar = -1;
  animDataSize = 0;
  quit = false;
  soundFlags = DEFAULT_SOUND_FLAGS;
  fakeVideoMode = 0x14;
  readonly startTot: string;
  readonly startArchive: string;

  private readonly environments: Environment[] = [];
  private numEnvironments = 0;
  private curEnvironment = 0;

  constructor(
    readonly host: Host,
    readonly sys: Subsystems,
    options: GameOptions = {},
  ) {
    this.files = new DataFiles(host);
    this.timer = new FrameTimer(host);
    this.inter = new Interpreter(this);
    this.inter.maxSteps = options.maxSteps ?? Infinity;
    this.startTot = options.startTot ?? "INTRO.TOT";
    this.startArchive = options.startArchive ?? "INTRO.STK";
    for (let i = 0; i < ENVIRONMENT_COUNT; i++) {
      this.environments.push({ variables: null, script: null, resources: null, totFile: "", cursorHotspotX: 0, cursorHotspotY: 0 });
    }
    sys.attach?.(this);
  }

  // --- VmContext ---
  get vars(): Variables {
    return this.inter.vars;
  }

  get terminate(): number {
    return this.inter.terminate;
  }

  get captureCounter(): number {
    return this.inter.frame.captureCounter;
  }

  set captureCounter(value: number) {
    this.inter.frame.captureCounter = value;
  }

  runFunction(offset: number, before?: () => void): Promise<void> {
    return this.inter.runFunction(offset, before);
  }

  storeMouse(): void {
    this.inter.storeMouse();
  }

  sleep(ms: number): Promise<void> {
    return this.inter.sleep(ms);
  }

  checkKeys(handleMouse: number, sync = true): number {
    return this.inter.checkKeys(handleMouse, sync);
  }

  animPalette(): void {
    this.inter.animPalette();
  }

  storeKey(key: number): void {
    this.inter.storeKey(key);
  }

  evalCoords(offset: number, count: number): number[] {
    return this.inter.evalCoords(offset, count);
  }

  getFile(name: string): Uint8Array | undefined {
    return this.files.get(name);
  }

  /** Demande l'arrêt du jeu (fermeture de la page). */
  abort(): void {
    this.quit = true;
  }

  variablesDeleted(vars: Variables | null): void {
    for (const e of this.environments) if (e.variables === vars) e.variables = null;
  }

  // --- démarrage ---

  /** Démarre le jeu comme l'original : INTRO.STK, polices, puis le TOT de départ. */
  async start(): Promise<void> {
    this.host.input.setMousePos(152, 92);
    this.mouseX = 152;
    this.mouseY = 92;
    this.startTimeKey = this.host.now();

    await this.files.openArchive(this.startArchive, true);

    const inf = this.files.get("intro.inf");
    const fonts = inf
      ? new TextDecoder("latin1").decode(inf).split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 8).map((l) => `${l.trim()}.let`)
      : ["jeulet1.let", "jeulet2.let", "jeucar1.let", "jeumath.let"];
    fonts.forEach((f, i) => this.sys.draw.loadFont(i, f));

    const tot = this.files.get(this.startTot);
    if (!tot) throw new Error(`${this.startTot} introuvable`);
    this.inter.allocateVars(new DataView(tot.buffer, tot.byteOffset, tot.byteLength).getUint32(0x2c, true));
    this.curTotFile = this.startTot;

    await this.playTot(-2);
    this.sys.cursor.blit();
  }

  /**
   * Exécute le TOT `name` seul à partir de la fonction d'entrée (utile aux tests) :
   * les archives nécessaires doivent déjà être ouvertes.
   */
  async runTot(name: string): Promise<void> {
    this.startTimeKey = this.host.now();
    this.curTotFile = name.toUpperCase().endsWith(".TOT") ? name : `${name}.TOT`;
    await this.playTot(0);
  }

  // --- environnements ---

  private envSet(env: number): void {
    if (env >= ENVIRONMENT_COUNT) return;
    const e = this.environments[env];
    e.cursorHotspotX = this.cursorHotspotXVar;
    e.cursorHotspotY = this.cursorHotspotYVar;
    e.script = this.script;
    e.resources = this.resources;
    e.variables = this.inter.variables;
    e.totFile = this.curTotFile;
  }

  private envGet(env: number): void {
    if (env >= ENVIRONMENT_COUNT) return;
    const e = this.environments[env];
    this.cursorHotspotXVar = e.cursorHotspotX;
    this.cursorHotspotYVar = e.cursorHotspotY;
    this.script = e.script ?? new Script();
    this.resources = e.resources;
    this.inter.variables = e.variables;
    this.curTotFile = e.totFile;
  }

  /**
   * Charge un TOT dans un nouvel environnement et l'exécute (totSub).
   * Bits de `flags` : 1 = variables neuves, 2 = ne pas réinitialiser (playTot(-1)), 0x20 = garder
   * les zones de la souris, 0x80 = réutiliser l'environnement d'un TOT déjà empilé.
   */
  async totSub(flags: number, totFile: string): Promise<void> {
    flags = (flags << 24) >> 24;
    if (flags === 16 || flags === 17) return;
    if (this.numEnvironments >= ENVIRONMENT_COUNT) throw new Error("totSub : trop d'environnements imbriqués");

    this.envSet(this.numEnvironments);
    if (flags === 18) {
      this.sys.draw.backupMedia(this.numEnvironments);
      this.sys.sound.backupSlots(this.numEnvironments);
      this.inter.variables = null;
    }

    const curBackupPos = this.curEnvironment;
    this.numEnvironments++;
    this.curEnvironment = this.numEnvironments;

    this.script = new Script();
    this.resources = null;
    if (flags & 5) this.inter.variables = null;
    this.curTotFile = `${totFile}.TOT`;

    if (flags & 0x80) {
      let matched = false;
      for (let env = 0; env < this.curEnvironment - 1; env++) {
        if (this.environments[env].totFile.toLowerCase() === this.curTotFile.toLowerCase()) {
          this.envGet(env);
          this.curEnvironment = env;
          matched = true;
          break;
        }
      }
      if (matched) {
        if (this.inter.terminate !== 0) return;
        if (!(flags & 0x20)) this.sys.hotspots.push(0, true);
        await this.playTot(flags & 0x0f);
        if (this.inter.terminate < 2) this.inter.terminate = 0;
        if (!(flags & 0x20)) {
          this.sys.hotspots.clear();
          this.sys.hotspots.pop();
        }
      }
    } else {
      if (this.inter.terminate !== 0) return;
      if (!(flags & 0x20)) this.sys.hotspots.push(0, true);
      if (flags === 18 || flags & 0x06) await this.playTot(-1);
      else await this.playTot(0);
      if (this.inter.terminateLevel() !== 2) this.inter.terminate = 0;
      if (!(flags & 0x20)) {
        this.sys.hotspots.clear();
        this.sys.hotspots.pop();
      }
      if (flags & 5 && this.inter.variables) this.inter.delocateVars();
    }

    this.numEnvironments--;
    this.curEnvironment = curBackupPos;
    this.envGet(this.numEnvironments);
    if (flags === 18) {
      this.sys.draw.restoreMedia(this.numEnvironments);
      this.sys.sound.restoreSlots(this.numEnvironments);
    }
    this.animDataSize = this.script.animDataSize;
  }

  /** Exécute une fonction d'un environnement déjà empilé (`index` relatif, 0 = l'appelant). */
  async switchTotSub(index: number, func: number): Promise<void> {
    if (this.numEnvironments - index < 1) return;
    const newPos = this.curEnvironment - index - (index >= 0 ? 1 : 0);
    if (newPos >= ENVIRONMENT_COUNT) return;

    const curBackupPos = this.curEnvironment;
    const backupedCount = this.numEnvironments;
    if (this.curEnvironment === this.numEnvironments) this.envSet(this.numEnvironments++);

    this.curEnvironment -= index;
    if (index >= 0) this.curEnvironment--;

    this.envGet(this.curEnvironment);
    if (this.inter.terminate !== 0) return;

    this.sys.hotspots.push(0, true);
    await this.playTot(func);
    if (this.inter.terminateLevel() !== 2) this.inter.terminate = 0;
    this.sys.hotspots.pop();

    this.curEnvironment = curBackupPos;
    this.numEnvironments = backupedCount;
    this.envGet(this.curEnvironment);
  }

  // --- boucle principale ---

  /**
   * function > 0 : exécute cette fonction du script courant ; <= 0 : charge et exécute les TOT
   * successifs (-2 : début du jeu, -1 : sans réinitialisation des sous-systèmes).
   */
  async playTot(func: number): Promise<void> {
    const inter = this.inter;
    const sys = this.sys;
    const oldFrame = inter.frame;
    this.script.push();
    inter.frame = { nestLevel: 0, breakFromLevel: -1, captureCounter: 0 };

    if (func <= 0) {
      while (!this.quit) {
        if (inter.variables) sys.cursor.animate(4);

        if (func !== -1) {
          inter.initControlVars(1);
          sys.draw.resetFontToSprite(4);
          sys.mult.initAll();
          sys.mult.zeroMultData();
          sys.draw.restoreMainSurfaces();
        } else inter.initControlVars(0);

        this.cursorHotspotXVar = -1;
        this.totToLoad = "";

        if (this.curTotFile === "" && !this.script.loaded) break;

        if (func === -2) {
          sys.video.close(-1);
          func = 0;
        }

        const res = loadResources(this.files, this.curTotFile, this.host.language);
        if (!res) {
          sys.cursor.blit();
          inter.terminate = 2;
          break;
        }
        this.script.load(this.curTotFile, res.tot.script, res.tot.header);
        this.resources = res;

        this.animDataSize = this.script.animDataSize;
        if (!inter.variables) inter.allocateVars(this.script.variablesCount & 0xffff);

        this.script.seek(this.script.functionOffset(0));
        inter.renewTimeInVars();

        if (inter.variables) {
          const v = inter.vars;
          v.writeVar32(13, 1);
          v.writeVar32(14, this.soundFlags);
          v.writeVar32(15, this.fakeVideoMode);
          v.writeVar32(16, LANGUAGE_INDEX[this.host.language]);
        }

        await inter.callSub(2);

        if (this.totToLoad !== "") inter.terminate = 0;
        sys.draw.blitInvalidated();
        this.script.unload();
        this.resources = null;

        for (let i = 0; i < inter.frame.captureCounter; i++) sys.draw.capturePop(false);

        if (func !== -1) {
          sys.goblin.freeObjects();
          sys.sound.stop(0);
          sys.sound.freeLoadedSamples();
        }
        sys.draw.closeAllWin();

        if (this.totToLoad === "") break;
        this.curTotFile = this.totToLoad;
      }
    } else {
      inter.initControlVars(0);
      inter.frame.captureCounter = oldFrame.captureCounter;
      if (func > 13) this.script.seek(func);
      else this.script.seek(this.script.functionOffset(func + 1));
      await inter.callSub(2);
      if (inter.terminate !== 0) inter.terminate = 2;
      oldFrame.captureCounter = inter.frame.captureCounter;
    }

    this.curTotFile = "";
    inter.frame = oldFrame;
    this.script.pop();
  }
}
