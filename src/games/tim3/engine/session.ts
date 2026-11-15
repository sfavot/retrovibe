/**
 * Session de jeu, sans navigateur : un puzzle (ou le Labo) en édition ou en marche.
 *
 * - **Démarrer** (419825 → 435658(1) → 4359a4) : copie complète de l'état d'édition, puis 43ada7 (`World.start`) et un pas
 *   toutes les 32 ms (D10). Après chaque pas, test de but (436dc6) et compte à rebours de fin (`SolvedCountdown`).
 * - **Arrêter** (435658(0)) : la machine reprend **exactement** l'état d'édition copié au démarrage (pièces créées ou détruites
 *   pendant la marche comprises).
 * - **Puzzle réussi** (0x4815b0 = 0x200) : la machine s'arrête et revient à l'état d'édition, le puzzle est noté résolu.
 * - Sons des pièces : l'exe les joue au dessin, quand l'image affichée d'une pièce change (44b094 → 44b548 : commandes `sound`
 *   de l'image de l'ANM) ; quelques handlers les demandent eux-mêmes (`World.sound` / `stopSound`, crochets `onSound`). La
 *   session relève les deux après chaque pas, dans l'ordre (`drainEffects`) ; l'hôte coupe les effets à l'arrêt (ambiances
 *   en boucle).
 * - Progression (D11) : puzzles résolus et dernier puzzle, stockage préfixé `tim3:` ; puzzles maison résolus (`HomeProgress`).
 * - Labo : le puzzle maison (`LabPuzzle` : but, indices, conditions). 419803 teste le but en marche aussi au Labo (modes 1, 6 et 8) :
 *   s'il est atteint, la machine s'arrête et GENERIC 31178 le dit (au lieu de PUZZSOLV).
 */
import { PART_LOCKED, type Level, type LevCondition, type LevHint } from "../data/lev";
import { DEFAULT_GRAVITY, DEFAULT_PRESSURE, applyAtmosphere } from "./gravity";
import { Editor } from "./editor";
import { LabPuzzle } from "./lab-puzzle";
import { GOAL_MET, GoalTest, SolvedCountdown, type GoalResult } from "./goals";
import { F0C, type Part } from "./part";
import { insertSorted } from "./lists";
import { step } from "./step";
import type { TypeTable } from "./types";
import { World } from "./world";
import type { HostStorage } from "../../../engine/storage";

/** Durée d'un pas de simulation (4359a4 attend 32 ms entre deux pas ; plan D10). */
export const STEP_MS = 32;

/** Catégories de puzzles, dans l'ordre de `LEVELS.INF` (préfixe des LEV, nombre). Les puzzles HH sont reportés (D12). */
export const CATEGORIES = [
  { prefix: "TLEV", count: 40 },
  { prefix: "ELEV", count: 26 },
  { prefix: "MLEV", count: 30 },
  { prefix: "HLEV", count: 31 },
  { prefix: "RLEV", count: 29 },
] as const;

export interface PuzzleRef {
  /** Nom du LEV sans extension (`TLEV1`). */
  name: string;
  /** Index dans `LEVELS.INF` et dans les archives de voix (0 à 155). */
  index: number;
  /** Catégorie (0 : travaux pratiques … 4 : très difficiles). */
  category: number;
  /** Numéro dans la catégorie, à partir de 1. */
  number: number;
}

/** Les 156 puzzles, dans l'ordre du jeu. */
export function puzzleList(): PuzzleRef[] {
  const out: PuzzleRef[] = [];
  CATEGORIES.forEach((c, category) => {
    for (let n = 1; n <= c.count; n++) out.push({ name: `${c.prefix}${n}`, index: out.length, category, number: n });
  });
  return out;
}

// ------------------------------------------------------------------ copie de l'état d'édition

/**
 * Copie profonde d'un monde (pièces, listes, cordes, courroies, générateur, état des collisions), en gardant partagés la
 * table des types, le registre des handlers et les polygones des types. Les références entre pièces sont conservées.
 */
export function cloneWorld(world: World): World {
  const memo = new Map<unknown, unknown>();
  memo.set(world.types, world.types);
  memo.set(world.handlers, world.handlers);
  for (const d of world.types.byType) for (const p of d.polygons ?? []) memo.set(p, p);
  const copy = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    const known = memo.get(v);
    if (known !== undefined) return known;
    if (ArrayBuffer.isView(v)) {
      const out = (v as unknown as { slice(): unknown }).slice();
      memo.set(v, out);
      return out;
    }
    if (v instanceof WeakMap || v instanceof WeakSet) return v;
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      memo.set(v, out);
      for (const x of v) out.push(copy(x));
      return out;
    }
    if (v instanceof Map) {
      const out = new Map();
      memo.set(v, out);
      for (const [k, x] of v) out.set(copy(k), copy(x));
      return out;
    }
    if (v instanceof Set) {
      const out = new Set();
      memo.set(v, out);
      for (const x of v) out.add(copy(x));
      return out;
    }
    const out = Object.create(Object.getPrototypeOf(v) as object) as Record<string, unknown>;
    memo.set(v, out);
    for (const key of Object.keys(v)) out[key] = copy((v as Record<string, unknown>)[key]);
    return out;
  };
  return copy(world) as World;
}

// ------------------------------------------------------------------ progression

/** Noms des puzzles du jeu (`TLEV1` … `RLEV29`) : toute autre valeur lue ou écrite est ignorée. */
const PUZZLE_NAMES: ReadonlySet<string> = new Set(CATEGORIES.flatMap((c) => Array.from({ length: c.count }, (_, i) => `${c.prefix}${i + 1}`)));

/**
 * Progression (D11) : clés `solved` (noms séparés par des virgules) et `last` d'un stockage déjà préfixé par `tim3:`. Seuls les
 * noms de puzzles du jeu sont gardés : une valeur étrangère ou corrompue est ignorée, jamais levée.
 */
export class Progress {
  private readonly solved: Set<string>;

  constructor(private readonly storage: HostStorage) {
    this.solved = new Set((storage.get("solved") ?? "").split(",").filter((s) => PUZZLE_NAMES.has(s)));
  }

  isSolved(name: string): boolean {
    return this.solved.has(name);
  }

  markSolved(name: string): void {
    if (this.solved.has(name) || !PUZZLE_NAMES.has(name)) return;
    this.solved.add(name);
    this.storage.set("solved", [...this.solved].join(","));
  }

  /** Nombre de puzzles résolus parmi `names`. */
  count(names: readonly string[]): number {
    return names.filter((n) => this.solved.has(n)).length;
  }

  get last(): string | null {
    const v = this.storage.get("last");
    return v && PUZZLE_NAMES.has(v) ? v : null;
  }

  set last(name: string | null) {
    if (name === null) this.storage.remove("last");
    else if (PUZZLE_NAMES.has(name)) this.storage.set("last", name);
  }

  /** Premier puzzle non résolu après `name` (dans l'ordre du jeu), sinon le suivant, sinon `null`. */
  next(name: string): PuzzleRef | null {
    const list = puzzleList();
    const i = list.findIndex((p) => p.name === name);
    if (i < 0) return list[0] ?? null;
    return list.slice(i + 1).find((p) => !this.solved.has(p.name)) ?? list[i + 1] ?? null;
  }
}

// ------------------------------------------------------------------ puzzles maison

/** Catégorie des puzzles maison (`DOSBIN` : `DB_USER`, « Puzzles Personnels » 31054 = 31048 + 6 ; icône `PD_HOME` de `PUZZDISP`). */
export const HOME_CATEGORY = 6;

/** Puzzle maison : la machine de l'emplacement `slot` du Labo (`HOME<slot>`), hors de l'ordre du jeu (`index` −1). */
export function homePuzzleRef(slot: number): PuzzleRef {
  return { name: `HOME${slot}`, index: -1, category: HOME_CATEGORY, number: slot };
}

/** Emplacement d'un puzzle maison, `null` pour un puzzle du jeu. */
export function homeSlot(ref: PuzzleRef): number | null {
  return ref.category === HOME_CATEGORY ? ref.number : null;
}

/**
 * Puzzles maison résolus (clé `homeSolved` sous `tim3:`) : un emplacement et la date de sa sauvegarde, pour qu'une autre machine
 * enregistrée au même emplacement reparte non résolue. Valeurs étrangères ignorées.
 */
export class HomeProgress {
  private readonly solved: Set<string>;

  constructor(private readonly storage: HostStorage) {
    this.solved = new Set((storage.get("homeSolved") ?? "").split(",").filter((s) => /^\d{1,2}@\d{1,16}$/.test(s)));
  }

  private static key(slot: number, savedAt: number): string {
    return `${slot}@${Math.trunc(savedAt)}`;
  }

  isSolved(slot: number, savedAt: number): boolean {
    return this.solved.has(HomeProgress.key(slot, savedAt));
  }

  markSolved(slot: number, savedAt: number): void {
    const key = HomeProgress.key(slot, savedAt);
    if (this.solved.has(key)) return;
    // Une seule entrée par emplacement : l'ancienne machine de l'emplacement est oubliée.
    for (const k of [...this.solved]) if (k.startsWith(`${slot}@`)) this.solved.delete(k);
    this.solved.add(key);
    this.storage.set("homeSolved", [...this.solved].join(","));
  }
}

// ------------------------------------------------------------------ Labo

export interface LabSettings {
  gravity: number;
  pressure: number;
  /** Couleur de fond du LEV (couleur logique 1 à 15 : globe, 41ce47). */
  background: number;
  /** Musique (1000 à 1023, 0 = aucune). */
  music: number;
}

export const DEFAULT_LAB: LabSettings = { gravity: DEFAULT_GRAVITY, pressure: DEFAULT_PRESSURE, background: 3, music: 1000 };

/** Niveau vide du Labo (version 0x114, aucune condition de réussite). */
export function labLevel(settings: LabSettings): Level {
  const hint: LevHint = { x: 0, y: 0, flip: 0, text: "" };
  const free: LevCondition = { partIndex: -1, state1: 0, state2: 0, count: 0, rectX: 0, rectY: 0, rectWidth: 0, rectHeight: 0 };
  return {
    version: 0x114,
    prefix: { unknown04: 0, backgroundColor: settings.background },
    title: "",
    goal: "",
    hintCount: 0,
    hints: Array.from({ length: 8 }, () => ({ ...hint })),
    info: { pressure: settings.pressure, gravity: settings.gravity, unknown04: 568, unknown06: 378, music: settings.music, unknown0E: 0 },
    fixedParts: [],
    movingParts: [],
    solution: { unknown00: 0, conditions: Array.from({ length: 8 }, () => ({ ...free })), delay: 0 },
  };
}

// ------------------------------------------------------------------ session

export type SessionMode = "edit" | "run";

/** Ce qu'un pas de marche a produit. */
export interface TickResult {
  /** Résultat du test de but (0 : aucun but, 1 : pas encore, 2 : atteint). */
  goal: GoalResult;
  /** Le puzzle vient d'être résolu (la machine est arrêtée et revenue à l'état d'édition). */
  solved: boolean;
}

/** Effet sonore à jouer (`playEffect(id, priority, flags)`), ou à arrêter (`stop` : `stopEffect(id)`, 41151e). */
export interface EffectRequest {
  id: number;
  priority: number;
  flags: number;
  stop?: boolean;
}

export interface SessionOptions {
  puzzle?: PuzzleRef;
  lab?: LabSettings;
  /**
   * Reprise d'une aire gardée (`engine/save.ts`) : index (dans le niveau) des pièces posées par le joueur, écrites verrouillées
   * pour rester dans l'aire au chargement et déverrouillées ici.
   */
  unlock?: readonly number[];
  /**
   * Reprise d'un puzzle : nombre de pièces du LEV d'origine. Les pièces d'index supérieur (créées par l'éditeur : partenaire
   * d'une télécommande) sont rangées dans la liste que dit leur type (+0x0C & 0x4000, 43965b), pas dans celle de leur index.
   */
  originalCount?: number;
}

export class Tim3Session {
  world: World;
  editor: Editor;
  goals: GoalTest;
  readonly countdown = new SolvedCountdown();
  mode: SessionMode = "edit";
  /** Pas effectués depuis le démarrage. */
  steps = 0;
  /** Le but a été atteint au moins une fois dans cet essai. */
  goalReached = false;
  readonly puzzle: PuzzleRef | null;
  readonly lab: LabSettings | null;
  /** Labo : but, indices et conditions du puzzle maison. */
  readonly labPuzzle: LabPuzzle | null;
  /** Copie de l'état d'édition prise au démarrage. */
  private snapshot: World | null = null;
  /** Pièces de l'aire au démarrage, dans l'ordre des listes (la copie les a dans le même ordre : `LabPuzzle.remap`). */
  private startOrder: Part[] = [];
  private readonly shownFrames = new WeakMap<Part, number>();
  private effects: EffectRequest[] = [];

  constructor(
    readonly types: TypeTable,
    readonly level: Level,
    options: SessionOptions = {},
  ) {
    this.puzzle = options.puzzle ?? null;
    this.lab = options.lab ? { ...options.lab } : null;
    this.world = new World(types);
    this.world.loadLevel(level);
    if (options.unlock?.length) {
      const free = new Set(options.unlock);
      for (const p of this.world.staticThenMobile()) if (free.has(p.levIndex)) p.flags14 &= ~PART_LOCKED;
    }
    if (options.originalCount !== undefined) {
      for (const p of [...this.world.staticThenMobile()]) {
        if (p.levIndex < options.originalCount) continue;
        const target = p.flags0C & 0x4000 ? this.world.statics : this.world.mobiles;
        const from = p.flags0C & F0C.IN_STATIC ? this.world.statics : this.world.mobiles;
        if (target === from) continue;
        from.remove(p);
        insertSorted(target, p, types, false);
      }
    }
    this.attach();
    this.editor = new Editor(this.world, { lab: this.lab !== null });
    this.goals = GoalTest.fromLevel(level, this.world);
    this.labPuzzle = this.lab ? LabPuzzle.fromLevel(level, this.world) : null;
  }

  /** Sons demandés par les handlers (41126d, 41151e : `World.sound` / `stopSound`) : dans la file de la session. */
  private attach(): void {
    this.world.onSound = (e) => {
      if (this.running) this.effects.push({ id: e.id, priority: e.priority, flags: e.flags });
    };
    this.world.onStopSound = (id) => {
      if (this.running) this.effects.push({ id, priority: 0, flags: 0, stop: true });
    };
  }

  /** Couleur de fond (1 à 11). */
  /** Couleur de fond changée au globe en mode Jeu (41cc25 l'écrit dans le niveau en mémoire) ; `null` : celle du LEV. */
  private puzzleBackground: number | null = null;

  get background(): number {
    return this.lab?.background ?? this.puzzleBackground ?? this.level.prefix?.backgroundColor ?? 3;
  }

  /** Globe : couleur de fond (Labo : réglage du Labo ; Jeu : gardée jusqu'au prochain chargement du puzzle). */
  setBackground(color: number): void {
    if (this.lab) this.lab.background = color;
    else this.puzzleBackground = color;
  }

  get music(): number {
    return this.lab?.music ?? this.level.info.music;
  }

  get running(): boolean {
    return this.mode === "run";
  }

  /** Labo : nouveaux réglages (gravité et pression s'appliquent aux types : 434141). */
  setLab(settings: Partial<LabSettings>): void {
    if (!this.lab || this.running) return;
    Object.assign(this.lab, settings);
    this.world.gravity = this.lab.gravity;
    this.world.pressure = this.lab.pressure;
    applyAtmosphere(this.types, this.lab.gravity, this.lab.pressure);
  }

  /** Démarrer : copie de l'état d'édition, pièce tenue rendue au bac, 43ada7, test de but remis à zéro (436dbe). */
  start(): void {
    if (this.running) return;
    this.editor.release();
    this.labPuzzle?.prune(this.world);
    this.startOrder = [...this.world.statics, ...this.world.mobiles];
    this.snapshot = cloneWorld(this.world);
    if (this.lab) applyAtmosphere(this.types, this.lab.gravity, this.lab.pressure);
    if (this.labPuzzle) this.goals = this.labPuzzle.goalTest();
    this.world.start();
    this.goals.reset();
    this.countdown.reset();
    this.steps = 0;
    this.goalReached = false;
    this.effects = [];
    for (const p of this.world.staticThenMobile()) this.shownFrames.set(p, p.frame);
    this.mode = "run";
  }

  /** Arrêter : l'état d'édition copié au démarrage revient tel quel. */
  stop(): void {
    if (!this.running || !this.snapshot) return;
    this.world = this.snapshot;
    this.snapshot = null;
    this.world.running = false;
    this.attach();
    this.editor = new Editor(this.world, { lab: this.lab !== null });
    this.goals = GoalTest.fromLevel(this.level, this.world);
    this.labPuzzle?.remap(this.startOrder, [...this.world.statics, ...this.world.mobiles]);
    this.startOrder = [];
    this.effects = [];
    this.mode = "edit";
  }

  /** Un pas (433334, 43abff, 436dc6) et la fin de puzzle de 4359a4. */
  tick(): TickResult {
    if (!this.running) return { goal: 0, solved: false };
    step(this.world);
    this.steps++;
    // La file du pas (`World.sounds`) n'est lue par personne d'autre : vidée pour ne pas grossir pendant la marche.
    this.world.sounds.length = 0;
    this.collectEffects();
    if (this.labPuzzle && !this.labPuzzle.hasGoal) return { goal: 0, solved: false };
    const goal = this.goals.check(this.world);
    if (goal === GOAL_MET) this.goalReached = true;
    const solved = this.countdown.update(goal);
    if (solved) this.stop();
    return { goal, solved };
  }

  /** Commandes son des images qui viennent de changer (44b548), dans l'ordre de dessin des listes. */
  private collectEffects(): void {
    for (const p of this.world.staticThenMobile()) {
      if (p.flags10 & 0x2000) continue;
      const before = this.shownFrames.get(p);
      if (before === p.frame) continue;
      this.shownFrames.set(p, p.frame);
      const anim = this.types.anims[p.type];
      if (!anim || before === undefined) continue;
      const anm = anim.anm;
      if (p.frame >>> 0 >= anim.count) continue;
      const frame = anm.frames[anm.sequence.length ? anm.sequence[p.frame]! : p.frame];
      for (const c of frame?.commands ?? []) {
        if (c.op === "sound") this.effects.push({ id: c.sound, priority: 1, flags: 0 });
        else if (c.op === "soundEx") this.effects.push({ id: c.sound, priority: c.unknown04, flags: c.unknown06 });
      }
    }
  }

  /** Effets demandés depuis le dernier appel. */
  drainEffects(): EffectRequest[] {
    const out = this.effects;
    this.effects = [];
    return out;
  }
}
