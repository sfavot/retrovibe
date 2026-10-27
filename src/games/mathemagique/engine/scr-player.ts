/**
 * Lecteur d'animations `\0SCR` : joue plusieurs scripts à la fois sur une surface de scène (`1090:0094` de `MATH`, scr.md, engine.md §3).
 *
 * Modèle (un tick du moteur = un `step()` par animation, jamais d'`await`) :
 *  - l'animation a sa propre horloge `time` (ticks depuis le démarrage) ; les opcodes de cellule, `hook` et `render` s'exécutent tout de suite,
 *    `frame`, `sound` et `END` attendent la fin de l'image précédente (`time >= frameEnd`) ;
 *  - une image **présente l'état des cellules tel qu'il est quand l'opcode `frame` est atteint** ; le dessin se fait à ce moment-là
 *    (`render` n'a donc pas d'effet visible : l'original pré-compose dans un port caché, ici la surface est directement visible) ;
 *  - `start` exécute la première étape tout de suite (`1090:13e1`) : l'image 0 est visible dès l'appel, le `n`-ième `step()` suivant
 *    est au tick `n` du script. `END` est atteint au tick `duration` (98 pour `MAINSCRN` 1000) : l'animation est alors `done`.
 *
 * Drapeaux du descripteur (octet `+7`, `SCR_FLAG`) : 1 sauvegarde le fond de la zone et le restaure avant chaque image ; 2 ne coupe pas
 * le MIDI en cours (sinon, en mode bloquant, `stopMusic` au départ : hypothèse) ; 4 à l'interruption, avance jusqu'à l'état final ; 8 interruptible par clic ou
 * touche (seulement en mode `blocking`, comme la boucle `1090:111c`) ; 16 attend la fin de tous les sons lancés avant de terminer ;
 * 32 restaure le fond à la fin. Le bit 6 (lu par `06fa`, rôle non établi) est ignoré.
 *
 * Composition : à chaque tick où une animation a changé, le lecteur restaure les fonds sauvegardés (ordre inverse de démarrage), puis dessine
 * toutes les animations dans l'ordre `z` croissant (à égalité : ordre de démarrage), chacune écrêtée à sa zone. Une animation terminée sans
 * restauration laisse sa dernière image sur la surface (elle n'est plus redessinée) ; les animations qui sauvegardent le fond doivent donc
 * se terminer dans l'ordre inverse du démarrage si leurs zones se recouvrent.
 *
 * Sons : par le `SoundService` (ou tout objet de même forme) ; la `SNDL` résolue est préchargée au départ. Hooks : `onHook(hook, arg, anim)`,
 * non bloquants (le hook 0 de l'original est le rappel de redessin ou de cycle de palette de la scène).
 *
 * Mode bloquant (« jouer jusqu'au bout », `1090:111c`) sans `await` : la scène démarre l'animation avec `blocking: true` (ou
 * `playBlocking`), passe dans un état « lecture » et ne fait rien d'autre tant que `handle.state === "running"` ; le lecteur gèle alors
 * gadgets et pointeur (`blockedThisTick`) comme la boucle d'attente de l'original, et applique le drapeau 8. À la fin (terminée ou
 * interrompue), `onEnd` est appelé depuis le tick, avant `Scene.tick`.
 */
import { isModifierOnlyKey, type Input } from "./input";
import { TAG_SHAP, TAG_SHPL, TAG_SND, TAG_SNDL } from "../../../data/mohawk/mohawk";
import { resolveScrResources, SCR_CELL_COUNT, SCR_INITIAL_FLAGS, SCR_OFFSCREEN, type ScrClip, type ScrOp, type ScrScript } from "../data/scr";
import type { ShapeList } from "../../../data/mohawk/shpl";
import type { Shape } from "../../../data/mohawk/shap";
import { drawShape } from "./graphics/blit";
import type { Rect, SavedRect, Surface } from "./graphics/surface";
import { defineService } from "./scene";
import type { PlaySoundOptions, PreloadSet, SoundChannel, SoundHandle, WaveArchive } from "./sound";

/** Drapeaux de l'octet `+7` du descripteur d'animation (engine.md §3.5). */
export const SCR_FLAG = {
  saveBackground: 0x01,
  keepMidi: 0x02,
  fastForwardOnInterrupt: 0x04,
  interruptible: 0x08,
  waitSounds: 0x10,
  restoreBackground: 0x20,
} as const;

/** Ce que le lecteur lit d'une archive (`Archive` de `resources.ts` convient). */
export interface ScrArchive extends WaveArchive {
  scr(id: number): ScrScript;
  shpl(id: number): ShapeList;
  shap(id: number): Shape;
  sndl(id: number): number[];
  has(tag: string, id: number): boolean;
  ids(tag: string): number[];
}

/** Ce que le lecteur demande au service sonore (`SoundService` convient). */
export interface ScrSoundPort {
  playSound(archive: WaveArchive, id: number, options?: PlaySoundOptions): SoundHandle | null;
  isPlaying(handle: SoundHandle): boolean;
  stop(handle: SoundHandle): void;
  stopMusic(): void;
  preload?(archive: WaveArchive, ids: readonly number[]): PreloadSet;
}

export type AnimationState = "running" | "done" | "interrupted";

export interface ScrStartOptions {
  /** Drapeaux du descripteur (`SCR_FLAG`), défaut 0. */
  flags?: number;
  /** Décalage de toute l'animation (zone et cellules) : +40 en `y` pour les scripts de Poly. */
  offsetX?: number;
  offsetY?: number;
  /** Remplace la zone du script (repère écran) avant le décalage : lancement des fusées de NIM. */
  clipOverride?: ScrClip;
  /** `SHPL` forcée (descripteur `{ id SHPL, décalage }`) ; défaut : `resolveScrResources`. */
  shplOverride?: number;
  /** `SNDL` forcée ; défaut : `resolveScrResources`. */
  sndlOverride?: number;
  /** Ordre de dessin : les petits `z` d'abord (dessous). Défaut 0, puis ordre de démarrage. */
  z?: number;
  /** Recommence dès la fin (animations d'ambiance du hub). */
  loop?: boolean;
  /** Mode « jouer jusqu'au bout » : gèle gadgets et pointeur, active le drapeau 8. */
  blocking?: boolean;
  /** Canal des sons (`voice` pour Poly et Gus), défaut `effect`. */
  soundChannel?: SoundChannel;
  /** Sons d'ambiance : coupés si « Ambient Sounds » est décoché. */
  ambientSounds?: boolean;
  /** Rappel des hooks 0 à 3 (opcodes `0x10`–`0x13`), non bloquant. */
  onHook?: (hook: number, arg: number, animation: AnimationHandle) => void;
  /** Appelé une fois, du tick, quand l'animation sort de `running` (terminée ou interrompue). */
  onEnd?: (animation: AnimationHandle) => void;
  /** Ne pas exécuter la première étape tout de suite. */
  deferFirstStep?: boolean;
  /**
   * Fond propre de la scène : la zone en est recopiée avant chaque image (pas de traînées), sans le drapeau 1. Équivaut au tampon que
   * `1010:0dc5` place à `+8` du descripteur (`*DAT_4cac`) et que le Bowling donne à toutes ses animations ; ce drapeau 1, lui, fait en plus
   * sauvegarder le fond à l'instant du démarrage (`1090:06fa`, `10a8:0eb8`).
   */
  background?: Surface;
}

export interface AnimationHandle {
  readonly scrId: number;
  readonly state: AnimationState;
  /** Terminée ou interrompue. */
  readonly done: boolean;
  /** Ticks écoulés depuis le démarrage (nombre de `step()` faits). */
  readonly time: number;
  /** Images présentées. */
  readonly frameIndex: number;
  /** Somme des `count` des images présentées (compteur de l'avance rapide `1090:0432`). */
  readonly logicalIndex: number;
  /** Durée du script en ticks. */
  readonly duration: number;
  /** Zone effective (écran, décalages compris). */
  readonly clip: Readonly<ScrClip>;
  /** Un tick. Appelé par le lecteur ; à n'appeler soi-même que sur une animation que le lecteur ne pilote pas. */
  step(): void;
  /** Coupe l'animation (clic du joueur) : avance rapide si le drapeau 4 est posé, arrête ses sons, restaure le fond si le drapeau 32 est posé. */
  interrupt(): void;
  /**
   * Saute sans attendre jusqu'à l'image dont le compteur logique atteint `logical` (`1090:0432`) : cellules à l'état de cette image, sans sons
   * ni hooks. Au-delà de la dernière image (`Infinity`) l'animation est terminée.
   */
  fastForward(logical?: number): void;
  /** Remet le script au début, cellules vidées (`1090:138c`) ; `runFirstStep` exécute tout de suite la première étape. */
  rewind(runFirstStep?: boolean): void;
  /** Appelle `callback` à la fin (tout de suite si c'est déjà fait). */
  whenEnded(callback: (animation: AnimationHandle) => void): void;
}

interface Cell {
  shape: number;
  flags: number;
  x: number;
  y: number;
}

function emptyCell(): Cell {
  return { shape: 0, flags: SCR_INITIAL_FLAGS, x: SCR_OFFSCREEN, y: SCR_OFFSCREEN };
}

interface Owner {
  readonly surface: Surface;
  readonly sound: ScrSoundPort | undefined;
  markDirty(): void;
  finished(animation: ScrAnimation, rewound?: boolean): void;
}

interface ArchiveIds {
  shpl: Set<number>;
  sndl: Set<number>;
}

const idCache = new WeakMap<object, ArchiveIds>();

function archiveIds(archive: ScrArchive): ArchiveIds {
  let ids = idCache.get(archive);
  if (!ids) {
    ids = { shpl: new Set(archive.ids(TAG_SHPL)), sndl: new Set(archive.ids(TAG_SNDL)) };
    idCache.set(archive, ids);
  }
  return ids;
}

class ScrAnimation implements AnimationHandle {
  state: AnimationState = "running";
  time = 0;
  frameIndex = 0;
  logicalIndex = 0;
  readonly clip: ScrClip;
  readonly script: ScrScript;
  readonly flags: number;
  readonly blocking: boolean;
  readonly z: number;
  readonly seq: number;
  /** État courant des 32 cellules (les opcodes de cellule le modifient tout de suite). */
  private readonly cells: Cell[] = Array.from({ length: SCR_CELL_COUNT }, emptyCell);
  /** Cellules visibles de la dernière image présentée : c'est ce que `draw` dessine (les opcodes qui suivent `frame` préparent l'image suivante). */
  private presented: Cell[] = [];
  private readonly ops: readonly ScrOp[];
  private readonly loop: boolean;
  private readonly shplId: number | undefined;
  private shapeList: ShapeList | undefined;
  private pc = 0;
  private frameEnd = 0;
  private scriptEnded = false;
  private saved: SavedRect | null = null;
  private readonly sounds: SoundHandle[] = [];
  private callbacks: ((animation: AnimationHandle) => void)[] = [];
  private frameOps: number[] | null = null;
  /** Position dans `Player.active` à la fin : restauration à faire à la prochaine composition. */
  pendingRestore = false;

  constructor(
    private readonly owner: Owner,
    private readonly archive: ScrArchive,
    readonly scrId: number,
    private readonly options: ScrStartOptions,
    seq: number,
  ) {
    this.script = archive.scr(scrId);
    this.ops = this.script.ops;
    this.flags = options.flags ?? 0;
    this.blocking = options.blocking ?? false;
    this.loop = (options.loop ?? false) && this.script.duration > 0;
    this.z = options.z ?? 0;
    this.seq = seq;
    const base = options.clipOverride ?? this.script.clip;
    const dx = options.offsetX ?? 0;
    const dy = options.offsetY ?? 0;
    this.clip = { top: base.top + dy, bottom: base.bottom + dy, left: base.left + dx, right: base.right + dx };
    const ids = archiveIds(archive);
    this.shplId = options.shplOverride ?? resolveScrResources(scrId, ids).shplId;
    if (this.flags & (SCR_FLAG.saveBackground | SCR_FLAG.restoreBackground)) this.saved = owner.surface.saveRect(this.zone);
    if (options.onEnd) this.callbacks.push(options.onEnd);
    this.preloadSounds(ids);
    // Drapeau 2 (`1090:111c`) : la lecture jusqu'au bout coupe le MIDI en cours, sauf s'il est posé.
    if (this.blocking && !(this.flags & SCR_FLAG.keepMidi)) owner.sound?.stopMusic();
  }

  get zone(): Rect {
    return { x: this.clip.left, y: this.clip.top, w: this.clip.right - this.clip.left, h: this.clip.bottom - this.clip.top };
  }

  get done(): boolean {
    return this.state !== "running";
  }

  get duration(): number {
    return this.script.duration;
  }

  // --- Étapes ---

  step(): void {
    if (this.state !== "running") return;
    if (this.scriptEnded) this.settle();
    else this.run();
    this.time++;
  }

  private run(): void {
    for (;;) {
      if (this.pc >= this.ops.length) {
        if (this.time < this.frameEnd) return;
        if (this.loop) {
          this.restart();
          continue;
        }
        this.scriptEnded = true;
        this.settle();
        return;
      }
      const op = this.ops[this.pc]!;
      switch (op.op) {
        case "frame":
          if (this.time < this.frameEnd) return;
          this.frameIndex++;
          this.logicalIndex += op.count;
          this.frameEnd = this.time + op.count * op.delay;
          this.present();
          break;
        case "sound":
          if (this.time < this.frameEnd) return;
          this.playSound(op.id);
          break;
        case "wait":
          this.frameEnd = Math.max(this.frameEnd, this.time) + op.ticks;
          break;
        case "stopSound":
        case "waitSound":
        case "waitMidi":
        case "render":
        case "skip":
          // Absents des 995 scripts (stopSound, waitSound, waitMidi, skip) ou sans effet visible ici (render).
          break;
        case "hook":
          this.options.onHook?.(op.hook, op.arg, this);
          break;
        case "flags": {
          const cell = this.cells[op.cell]!;
          cell.flags = ((cell.flags & op.mask) | op.or) & 0xffff;
          break;
        }
        case "position": {
          const cell = this.cells[op.cell]!;
          cell.x = op.x;
          cell.y = op.y;
          break;
        }
        case "shape":
          if (op.shape === 0) this.cells[op.cell] = emptyCell();
          else this.cells[op.cell]!.shape = op.shape;
          break;
      }
      this.pc++;
      if (this.state !== "running") return;
    }
  }

  /** Script terminé : attend les sons si le drapeau 16 est posé, puis clôt. */
  private settle(): void {
    if (this.flags & SCR_FLAG.waitSounds && this.owner.sound && this.sounds.some((s) => this.owner.sound!.isPlaying(s))) return;
    this.finish("done");
  }

  private restart(): void {
    for (let i = 0; i < SCR_CELL_COUNT; i++) this.cells[i] = emptyCell();
    this.presented = [];
    this.pc = 0;
    this.time = 0;
    this.frameEnd = 0;
    this.frameIndex = 0;
    this.logicalIndex = 0;
    this.scriptEnded = false;
  }

  private finish(state: "done" | "interrupted"): void {
    if (this.state !== "running") return;
    this.state = state;
    this.pendingRestore = (this.flags & SCR_FLAG.restoreBackground) !== 0;
    this.owner.finished(this);
    this.owner.markDirty();
    const callbacks = this.callbacks;
    this.callbacks = [];
    for (const callback of callbacks) callback(this);
  }

  // --- Commandes ---

  interrupt(): void {
    if (this.state !== "running") return;
    if (this.flags & SCR_FLAG.fastForwardOnInterrupt) this.settleCells(Infinity);
    this.stopSounds();
    this.finish("interrupted");
  }

  fastForward(logical = Infinity): void {
    if (this.state !== "running") return;
    const reachedEnd = this.settleCells(logical);
    if (reachedEnd) {
      this.scriptEnded = true;
      this.finish("done");
    }
  }

  /**
   * Met les cellules dans l'état de l'image de compteur logique `>= logical` (l'état de la dernière image si aucune) et place le
   * compteur de programme juste après. Renvoie vrai si la fin du script est atteinte.
   */
  private settleCells(logical: number): boolean {
    const frames = this.script.frames;
    this.frameOps ??= this.ops.flatMap((op, index) => (op.op === "frame" ? [index] : []));
    const target = frames.findIndex((f) => f.logicalIndex >= logical);
    const last = frames.length - 1;
    const index = target === -1 ? last : target;
    for (let i = 0; i < SCR_CELL_COUNT; i++) this.cells[i] = emptyCell();
    if (index >= 0) {
      const frame = frames[index]!;
      for (const c of frame.cells) this.cells[c.cell] = { shape: c.shape, flags: c.flags, x: c.x, y: c.y };
      this.frameIndex = index + 1;
      this.logicalIndex = frame.logicalIndex + frame.count;
      this.frameEnd = this.time + frame.duration;
      this.pc = this.frameOps[index]! + 1;
    }
    this.present();
    return target === -1;
  }

  /** Mémorise les cellules visibles : l'image est « présentée » dans cet état, quoi que les opcodes suivants changent. */
  private present(): void {
    this.presented = this.cells.filter((c) => c.shape !== 0).map((c) => ({ ...c }));
    this.owner.markDirty();
  }

  rewind(runFirstStep = false): void {
    const wasEnded = this.state !== "running";
    this.restart();
    this.state = "running";
    this.pendingRestore = false;
    this.stopSounds();
    if (this.saved) this.owner.surface.restoreRect(this.saved);
    if (wasEnded) this.owner.finished(this, true);
    if (runFirstStep) this.step();
    this.owner.markDirty();
  }

  whenEnded(callback: (animation: AnimationHandle) => void): void {
    if (this.state !== "running") callback(this);
    else this.callbacks.push(callback);
  }

  /** Arrêt sans rappel (sortie de scène). */
  cancel(restoreBackground: boolean): void {
    if (this.state !== "running") return;
    this.state = "interrupted";
    this.callbacks = [];
    this.stopSounds();
    if (restoreBackground && this.saved) this.owner.surface.restoreRect(this.saved);
  }

  // --- Sons ---

  private preloadSounds(ids: ArchiveIds): void {
    const sound = this.owner.sound;
    if (!sound?.preload) return;
    let sndl = this.options.sndlOverride;
    if (sndl === undefined) sndl = resolveScrResources(this.scrId, ids).sndlId;
    if (sndl !== undefined && ids.sndl.has(sndl)) sound.preload(this.archive, this.archive.sndl(sndl));
  }

  private playSound(id: number): void {
    const sound = this.owner.sound;
    if (!sound || !this.archive.mohawk.has(TAG_SND, id)) return;
    const handle = sound.playSound(this.archive, id, { channel: this.options.soundChannel, ambient: this.options.ambientSounds });
    if (handle) this.sounds.push(handle);
  }

  private stopSounds(): void {
    const sound = this.owner.sound;
    if (sound) for (const handle of this.sounds) sound.stop(handle);
    this.sounds.length = 0;
  }

  // --- Dessin ---

  /** Rétablit le fond sauvegardé (avant de redessiner, ou à la fin avec le drapeau 32). */
  restoreBackground(surface: Surface): void {
    const clean = this.options.background;
    if (clean) {
      const zone = this.zone;
      surface.copyFrom(clean, zone, zone.x, zone.y);
    } else if (this.saved) surface.restoreRect(this.saved);
  }

  get restoresEachFrame(): boolean {
    return (this.flags & SCR_FLAG.saveBackground) !== 0 || this.options.background !== undefined;
  }

  draw(surface: Surface): void {
    if (this.shplId === undefined) return;
    surface.pushClip(this.zone);
    try {
      this.shapeList ??= this.archive.shpl(this.shplId);
      for (const cell of this.presented) {
        if (cell.shape === 0 || cell.x === SCR_OFFSCREEN) continue;
        if (cell.shape > this.shapeList.shapeCount) continue; // POLLY 35900 : forme hors de la SHPL (l'original lève une erreur)
        const id = this.shapeList.firstShapeId + cell.shape - 1;
        if (!this.archive.has(TAG_SHAP, id)) continue;
        // Quartet bas = mode de blit : 0 copie brute, 8 (et 0xa au premier dessin) saute l'index 0.
        drawShape(surface, this.archive.shap(id), this.clip.left + cell.x, this.clip.top + cell.y, (cell.flags & 0xf) === 0 ? 0 : 8);
      }
    } finally {
      surface.popClip();
    }
  }
}

export interface ScrPlayerOptions {
  /** Surface où l'on dessine (le port de travail de la scène). */
  surface: Surface | (() => Surface);
  sound?: ScrSoundPort;
  /** Appelé quand la surface a changé (le moteur présentera l'image). */
  onDirty?: () => void;
}

export class ScrPlayer {
  private readonly active: ScrAnimation[] = [];
  private readonly pendingEnded: ScrAnimation[] = [];
  private seq = 0;
  private dirty = false;
  private composing = false;
  /** Profondeur des étapes en cours : la composition attend leur fin (une seule fois par tick) ; hors étape, un changement est composé tout de suite. */
  private stepping = 0;
  /** Vrai si une animation bloquante tournait au début du tick : gadgets et pointeur ne traitent pas leurs événements. */
  blockedThisTick = false;

  constructor(private readonly options: ScrPlayerOptions) {}

  private get surface(): Surface {
    return typeof this.options.surface === "function" ? this.options.surface() : this.options.surface;
  }

  /** Démarre une animation. L'image 0 est dessinée tout de suite (sauf `deferFirstStep`). */
  start(archive: ScrArchive, scrId: number, options: ScrStartOptions = {}): AnimationHandle {
    const owner: Owner = {
      surface: this.surface,
      sound: this.options.sound,
      markDirty: () => {
        this.dirty = true;
        if (this.stepping === 0) this.compose();
      },
      finished: (animation, rewound = false) => {
        if (rewound) {
          if (!this.active.includes(animation)) this.active.push(animation);
        } else this.pendingEnded.push(animation);
      },
    };
    const animation = new ScrAnimation(owner, archive, scrId, options, this.seq++);
    this.active.push(animation);
    if (!options.deferFirstStep) {
      this.stepping++;
      try {
        animation.step();
      } finally {
        this.stepping--;
      }
    }
    this.compose();
    return animation;
  }

  /** Mode bloquant : `then` est appelé du tick quand l'animation se termine ou est interrompue (voir l'en-tête). */
  playBlocking(archive: ScrArchive, scrId: number, options: ScrStartOptions, then: (animation: AnimationHandle) => void): AnimationHandle {
    return this.start(archive, scrId, { ...options, blocking: true, onEnd: (animation) => {
      options.onEnd?.(animation);
      then(animation);
    } });
  }

  /** Animations en cours (dans l'ordre de démarrage). */
  get running(): readonly AnimationHandle[] {
    return this.active.filter((a) => a.state === "running");
  }

  /** Une animation bloquante tourne (gadgets et touches des gadgets gelés). */
  get blocking(): boolean {
    return this.active.some((a) => a.state === "running" && a.blocking);
  }

  /** Un tick : interruptions par clic ou touche, étape de chaque animation, puis composition. */
  tick(input?: Input): void {
    this.blockedThisTick = this.blocking;
    const snapshot = [...this.active];
    if (input && this.blockedThisTick) {
      const pressed = input.buttonEvents.some((e) => e.down) || input.keyEvents.some((e) => !e.repeat && !isModifierOnlyKey(e.key));
      if (pressed) for (const a of snapshot) if (a.state === "running" && a.blocking && a.flags & SCR_FLAG.interruptible) a.interrupt();
    }
    this.stepping++;
    try {
      for (const animation of snapshot) animation.step();
    } finally {
      this.stepping--;
    }
    this.compose();
  }

  /** Redessine toutes les animations (la scène vient de repeindre le fond). */
  redraw(): void {
    this.dirty = true;
    this.compose();
  }

  /** Sortie de scène : arrête tout sans rappel ; `restoreBackground` rétablit les fonds sauvegardés. */
  stopAll(restoreBackground = false): void {
    const reverse = [...this.active].reverse();
    for (const animation of reverse) animation.cancel(restoreBackground);
    this.active.length = 0;
    this.pendingEnded.length = 0;
    this.dirty = false;
    if (restoreBackground) this.options.onDirty?.();
  }

  private compose(): void {
    if (!this.dirty || this.composing) return;
    this.composing = true;
    try {
      this.dirty = false;
      const surface = this.surface;
      const ordered = [...this.active].sort((a, b) => a.z - b.z || a.seq - b.seq);
      for (const animation of [...ordered].reverse()) {
        // Une animation qui vient de finir remplace sa dernière image : fond rétabli (drapeau 1 ou 32), puis dernière image dessinée sauf drapeau 32.
        if (animation.state === "running" ? animation.restoresEachFrame : animation.pendingRestore || animation.restoresEachFrame) animation.restoreBackground(surface);
      }
      for (const animation of ordered) {
        if (animation.state !== "running" && animation.pendingRestore) continue;
        animation.draw(surface);
      }
      for (const animation of this.pendingEnded) {
        animation.pendingRestore = false;
        const index = this.active.indexOf(animation);
        if (index >= 0 && animation.state !== "running") this.active.splice(index, 1);
      }
      this.pendingEnded.length = 0;
    } finally {
      this.composing = false;
    }
    this.options.onDirty?.();
  }
}

export const SCR_PLAYER = defineService<ScrPlayer>("mathemagique.scr-player");
