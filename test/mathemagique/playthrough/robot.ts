import { Engine } from "../../../src/games/mathemagique/engine/engine";
import { Roster, ROSTER_STORAGE_KEY, RosterStore } from "../../../src/games/mathemagique/engine/roster";
import { SCENE_NAMES, SceneId, type Scene } from "../../../src/games/mathemagique/engine/scene";
import { installServices, type MathServices } from "../../../src/games/mathemagique/engine/services";
import { registerScenes } from "../../../src/games/mathemagique/scenes";
import type { CertificateEnvironment, CertificatePort } from "../../../src/games/mathemagique/scenes/certificate";
import type { HubScene } from "../../../src/games/mathemagique/scenes/hub";
import { FRAME_MS } from "../engine-test-host";
import { RobotHost } from "./host";

/** Un problème vu par le robot (graine, scène, tick du moteur : de quoi rejouer). */
export interface Violation {
  seed: number;
  scene: string;
  /** Tick du moteur (17 ms) depuis le démarrage. */
  tick: number;
  kind: string;
  detail: string;
}

/** Arrêt de la graine : trop d'erreurs, ou plafond de temps. */
export class Abort extends Error {}

/** Générateur seedé (mulberry32) : les choix du robot ne dépendent pas du hasard du jeu. */
export class Rng {
  constructor(private state: number) {}

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entier dans [0, n[. */
  below(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.below(items.length)]!;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.below(i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
}

export interface RobotOptions {
  seed: number;
  /** Plafond de temps réel d'une graine (secondes). */
  maxRealSeconds: number;
  /** Plafond de temps simulé d'une graine (secondes). */
  maxSimSeconds: number;
  /** Une image (ou une palette) d'un seul ton plus longtemps que cela, hors scènes tolérées, est signalée (secondes simulées). */
  uniformSeconds: number;
  /** Âge d'une scène (secondes simulées) à partir duquel sa palette doit être allumée. */
  litAfterSeconds: number;
  /** Durée au-delà de laquelle une animation qui tourne toujours est « coincée » (secondes simulées). */
  stuckAnimationSeconds: number;
  debug: boolean;
  log(message: string): void;
}

/** Palette « allumée » : somme des octets RVB présentés (cf. `wiring.test.ts` : > 3000). */
const LIT_PALETTE = 3000;
/** Ticks de 17 ms (`TICK_MS`). */
const TICK_MS = 17;
/** Scènes dont l'image peut être d'un seul ton un moment : le logo noir du titre et les fondus. */
const UNIFORM_EXEMPT = new Set<SceneId>([]);

/** Port de téléchargement factice : garde les noms de fichier. */
export class FakeCertificates implements CertificatePort {
  readonly files: { filename: string; size: number; type: string }[] = [];
  download(blob: Blob, filename: string): void {
    this.files.push({ filename, size: blob.size, type: blob.type });
  }
}

/** Contexte de dessin 2D factice : accepte tout appel, mesure le texte à 7 px par caractère, compte les appels. */
export function fakeCertificateEnvironment(stats: { canvases: [number, number][]; calls: number; pngs: number }): CertificateEnvironment {
  const context = new Proxy(
    {},
    {
      get(_target, name) {
        if (name === "measureText") return (text: string) => ({ width: text.length * 7 });
        return () => {
          stats.calls++;
        };
      },
      set() {
        return true;
      },
    },
  );
  return {
    createCanvas(width, height) {
      stats.canvases.push([width, height]);
      return {
        getContext: () => context as never,
        toPng: async () => {
          stats.pngs++;
          return new Blob(["png"], { type: "image/png" });
        },
      };
    },
    async loadFont() {},
  };
}

/** Compte les entrées et sorties de chaque scène (enveloppe de la fabrique). */
interface SceneLife {
  id: SceneId;
  enters: number;
  leaves: number;
}

/**
 * Le robot : amorce le jeu avec les vraies scènes et les vraies données sur l'hôte de test, simule des images à 60 Hz, et vérifie les
 * invariants à chaque image (voir `checkFrame`). Les parcours des activités sont dans `activities.ts` et `journey.ts` ; ce fichier porte
 * le socle (temps, clics, attentes, invariants, rapport).
 */
export class Robot {
  readonly host = new RobotHost();
  readonly engine: Engine;
  readonly services: MathServices;
  readonly rng: Rng;
  readonly certificates = new FakeCertificates();
  readonly certificateStats = { canvases: [] as [number, number][], calls: 0, pngs: 0 };
  readonly violations: Violation[] = [];
  /** Chemin suivi, en texte lisible. */
  readonly path: string[] = [];
  readonly sceneLives: SceneLife[] = [];
  frames = 0;
  private readonly seen = new Set<string>();
  private readonly startedAt = Date.now();
  private activeLife: SceneLife | null = null;
  private sceneEnteredAt = 0;
  private sceneCurrent: SceneId | undefined;
  private uniformSince: number | null = null;
  private blackSince: number | null = null;
  private lastSecondCheck = 0;
  private readonly animationFirstSeen = new Map<object, number>();
  private errorSeen: unknown = null;
  private strayNotes = 0;
  /** Maxima observés (rapport) : WAVE sortant en même temps, handles ouverts, WAVE en boucle. */
  readonly peaks = { live: 0, open: 0, loops: 0 };
  private exceptions = 0;
  /** Scène « logique » (étiquette de violation) : la dernière scène vue, même pendant un chargement. */
  private label = "démarrage";

  constructor(readonly options: RobotOptions) {
    this.rng = new Rng(options.seed * 7919 + 17);
    this.host.audio.unlock();
    this.engine = new Engine(this.host, {
      seed: options.seed,
      onError: (error, sceneId) => this.violate(`chargement de scène ${SCENE_NAMES[sceneId]}`, "chargement", `${describeError(error)}`),
    });
    this.services = installServices(this.engine);
    // Une note MIDI qui part alors que le service sonore n'a aucune musique en cours : séquenceur resté actif après une sortie de scène.
    this.host.audio.midi.onNoteOn = () => {
      if (!this.services.sound.musicPlaying && this.host.time - this.sceneEnteredAt > 1500) {
        if (++this.strayNotes === 1) this.problem("audio", "note MIDI jouée alors que le service sonore n'a aucune musique en cours");
      }
    };
    // Enveloppe chaque fabrique pour compter enter / leave.
    const register = this.engine.scenes.register.bind(this.engine.scenes);
    this.engine.scenes.register = (id, factory) => register(id, () => this.instrument(id, factory()));
    registerScenes(this.engine, this.services, {
      certificates: this.certificates,
      certificateEnvironment: fakeCertificateEnvironment(this.certificateStats),
    });
  }

  // --- Rapport ---

  get tick(): number {
    return Math.floor(this.host.time / TICK_MS);
  }

  get simSeconds(): number {
    return this.host.time / 1000;
  }

  get sceneName(): string {
    const id = this.engine.scenes.currentId;
    return id === undefined ? this.label : SCENE_NAMES[id];
  }

  get currentId(): SceneId | undefined {
    return this.engine.scenes.currentId;
  }

  note(step: string): void {
    this.path.push(step);
    if (this.options.debug) this.options.log(`  [${this.simSeconds.toFixed(1)} s] ${step}`);
  }

  violate(scene: string, kind: string, detail: string): void {
    const key = `${scene}|${kind}|${detail}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.violations.push({ seed: this.options.seed, scene, tick: this.tick, kind, detail });
    if (this.options.debug) this.options.log(`  !! ${scene} t${this.tick} ${kind} : ${detail}`);
  }

  /** Violation attribuée à la scène courante. */
  problem(kind: string, detail: string): void {
    this.violate(this.sceneName, kind, detail);
  }

  // --- Instrumentation des scènes ---

  private instrument(id: SceneId, scene: Scene): Scene {
    const life: SceneLife = { id, enters: 0, leaves: 0 };
    this.sceneLives.push(life);
    const enter = scene.enter.bind(scene);
    const leave = scene.leave.bind(scene);
    scene.enter = (ctx) => {
      if (this.activeLife) this.violate(SCENE_NAMES[id], "enter/leave", `enter de ${SCENE_NAMES[id]} alors que ${SCENE_NAMES[this.activeLife.id]} n'a pas été quittée`);
      life.enters++;
      if (life.enters > 1) this.violate(SCENE_NAMES[id], "enter/leave", "enter appelé deux fois sur la même instance");
      this.activeLife = life;
      this.sceneEnteredAt = this.host.time;
      this.uniformSince = null;
      this.blackSince = null;
      this.animationFirstSeen.clear();
      this.label = SCENE_NAMES[id];
      this.note(`entrée ${SCENE_NAMES[id]}`);
      enter(ctx);
    };
    scene.leave = (ctx) => {
      life.leaves++;
      if (this.activeLife !== life) this.violate(SCENE_NAMES[id], "enter/leave", "leave d'une scène qui n'est pas la scène active");
      if (life.leaves > 1) this.violate(SCENE_NAMES[id], "enter/leave", "leave appelé deux fois sur la même instance");
      this.activeLife = null;
      this.note(`sortie ${SCENE_NAMES[id]}`);
      leave(ctx);
    };
    return scene;
  }

  // --- Temps ---

  /** Simule `ms` millisecondes d'images à 60 Hz, invariants vérifiés après chaque image. */
  async run(ms: number): Promise<void> {
    const end = this.host.time + ms;
    while (this.host.time < end - 1e-9) {
      if (this.exceptions > 3) throw new Abort("trop d'exceptions");
      if (this.simSeconds > this.options.maxSimSeconds) {
        this.problem("temps", `plafond de temps simulé dépassé (${this.options.maxSimSeconds} s)`);
        throw new Abort("temps simulé");
      }
      if ((Date.now() - this.startedAt) / 1000 > this.options.maxRealSeconds) {
        this.problem("temps", `plafond de temps réel dépassé (${this.options.maxRealSeconds} s)`);
        throw new Abort("temps réel");
      }
      this.host.time += FRAME_MS;
      this.frames++;
      try {
        this.engine.frame(this.host.time);
      } catch (error) {
        this.exceptions++;
        this.problem("exception", describeError(error));
      }
      this.checkFrame();
      const loading = this.engine.whenLoaded;
      if (loading) await loading;
    }
  }

  /** Attend que `done()` soit vrai (au plus `limitMs` simulées). Renvoie faux et note une violation « bloqué » sinon. */
  async until(done: () => boolean, limitMs: number, what: string): Promise<boolean> {
    const end = this.host.time + limitMs;
    while (!done()) {
      if (this.host.time >= end) {
        this.problem("bloqué", `${what} (non atteint après ${Math.round(limitMs / 1000)} s simulées ; ${this.stateSummary()})`);
        return false;
      }
      await this.run(FRAME_MS);
    }
    return true;
  }

  /** Comme `until` mais sans violation si la condition n'arrive pas (attente optionnelle). */
  async tryUntil(done: () => boolean, limitMs: number): Promise<boolean> {
    const end = this.host.time + limitMs;
    while (!done()) {
      if (this.host.time >= end) return false;
      await this.run(FRAME_MS);
    }
    return true;
  }

  /** État utile au diagnostic d'un blocage : scène, pièce portée, animations, curseur. */
  stateSummary(): string {
    const scr = this.services.scr;
    const scene = this.engine.scenes.current as unknown as { phase?: string; flowKind?: string; inspect?: () => { state?: string; mode?: string } } | undefined;
    const detail = scene?.phase ?? scene?.flowKind ?? scene?.inspect?.().state ?? scene?.inspect?.().mode ?? "?";
    return `scène ${this.sceneName}/${detail}, pièce portée ${this.services.pointer.carried ? "oui" : "non"}, animations [${scr.running.map((a) => a.scrId).join(",")}]${scr.blocking ? " bloquantes" : ""}, curseur ${this.host.cursor ?? "?"}, chargement ${this.engine.loading ? "oui" : "non"}`;
  }

  /**
   * Sortie d'une activité par son bouton Exit : un clic fait pendant une animation non interruptible est ignoré (comme pour un joueur),
   * on réessaie donc de temps en temps ; le blocage n'est signalé que si rien n'y fait pendant plusieurs minutes simulées.
   */
  async leave(what: string, clickExit: () => Promise<void>, limitMs = 240_000): Promise<boolean> {
    const end = this.host.time + limitMs;
    while (this.host.time < end) {
      await this.closeMonitor();
      await clickExit();
      if (await this.tryUntil(() => this.currentId === SceneId.hub, 25_000)) return true;
    }
    this.problem("bloqué", `${what} (Exit sans effet pendant ${Math.round(limitMs / 1000)} s simulées ; ${this.stateSummary()})`);
    return false;
  }

  /** Le moniteur (nom du joueur) peut s'ouvrir d'un clic sur le nom dans le Bowling et Pattern Windows : OK le referme. */
  async closeMonitor(): Promise<void> {
    const scene = this.engine.scenes.current as unknown as { monitorOverlay?: { isOpen: boolean } | null } | undefined;
    for (let attempt = 0; attempt < 5 && scene?.monitorOverlay?.isOpen; attempt++) {
      await this.run(1000);
      await this.click(278, 284, 1500);
    }
    if (scene?.monitorOverlay?.isOpen) this.problem("bloqué", "le moniteur ouvert par un clic sur le nom ne se ferme pas avec OK");
  }

  // --- Entrées ---

  async click(x: number, y: number, ms = 100, mods: { ctrl?: boolean } = {}): Promise<void> {
    this.host.input.moveMouse(x, y);
    this.host.input.mouseDown("left", mods);
    this.host.input.mouseUp("left", mods);
    await this.run(ms);
  }

  async clickRight(x: number, y: number, ms = 100): Promise<void> {
    this.host.click(x, y, "right");
    await this.run(ms);
  }

  async press(code: string, key = code, ms = 60): Promise<void> {
    this.host.press(code, { key });
    await this.run(ms);
  }

  async type(text: string, ms = 60): Promise<void> {
    for (const c of text) {
      if (c === " ") this.host.press("Space", { key: " " });
      else if (/[0-9]/.test(c)) this.host.press(`Digit${c}`, { key: c });
      else this.host.press(`Key${c.toUpperCase()}`, { key: c });
      await this.run(ms);
    }
  }

  async move(x: number, y: number, ms = 60): Promise<void> {
    this.host.input.moveMouse(x, y);
    await this.run(ms);
  }

  // --- Invariants par image ---

  private checkFrame(): void {
    const id = this.engine.scenes.currentId;
    if (id !== this.sceneCurrent) this.sceneCurrent = id;

    // Erreur de chargement de scène / moteur arrêté.
    const error = this.engine.error;
    if (error && error.error !== this.errorSeen) {
      this.errorSeen = error.error;
      this.violate(SCENE_NAMES[error.sceneId], "chargement", describeError(error.error));
    }
    if (this.engine.failed) {
      this.problem("moteur", "Engine.failed : la première scène n'a pas pu être chargée");
      throw new Abort("engine.failed");
    }

    // Image uniforme / palette noire, hors scènes exemptées.
    const stats = this.host.lastStats;
    const age = this.host.time - this.sceneEnteredAt;
    if (stats && id !== undefined && !UNIFORM_EXEMPT.has(id)) {
      this.uniformSince = stats.uniform ? (this.uniformSince ?? this.host.time) : null;
      const dark = stats.paletteSum < LIT_PALETTE;
      this.blackSince = dark ? (this.blackSince ?? this.host.time) : null;
      const limit = this.options.uniformSeconds * 1000;
      if (this.uniformSince !== null && this.host.time - this.uniformSince > limit) {
        this.problem("image uniforme", `l'image présentée n'a qu'une couleur depuis ${((this.host.time - this.uniformSince) / 1000).toFixed(1)} s`);
        this.uniformSince = this.host.time;
      }
      if (this.blackSince !== null && this.host.time - this.blackSince > limit) {
        this.problem("palette noire", `palette présentée éteinte (somme ${stats.paletteSum}) depuis ${((this.host.time - this.blackSince) / 1000).toFixed(1)} s`);
        this.blackSince = this.host.time;
      }
    }
    if (age > this.options.litAfterSeconds * 1000 && stats && stats.paletteSum < LIT_PALETTE && !this.services.graphics.palette.fade && id !== undefined) {
      this.problem("palette noire", `${this.options.litAfterSeconds} s après l'entrée, sans fondu en cours, la palette présentée est noire (somme ${stats.paletteSum})`);
    }

    // Une fois par seconde simulée : son, animations.
    if (this.host.time - this.lastSecondCheck >= 1000) {
      this.lastSecondCheck = this.host.time;
      this.checkSecond(id);
    }
  }

  private checkSecond(id: SceneId | undefined): void {
    const audio = this.host.audio;
    audio.purgeFinished();
    const live = audio.liveWaves();
    const loops = live.filter((w) => w.loop);
    this.peaks.live = Math.max(this.peaks.live, live.length);
    this.peaks.open = Math.max(this.peaks.open, audio.openCount);
    this.peaks.loops = Math.max(this.peaks.loops, loops.length);
    if (live.length > 40) this.problem("audio", `${live.length} WAVE sortent en même temps (fuite de handles ?)`);
    if (loops.length > 4) this.problem("audio", `${loops.length} WAVE en boucle ouverts en même temps`);
    if (audio.openCount > 200) this.problem("audio", `${audio.openCount} handles WAVE ouverts et jamais arrêtés (fuite)`);
    if (audio.badStops > 0) this.problem("audio", `${audio.badStops} stopWave sur un handle jamais lancé`);

    // Animations qui tournent depuis trop longtemps (les boucles d'ambiance du hub sont voulues).
    if (id !== SceneId.hub) {
      const now = this.host.time;
      const alive = new Set<object>();
      for (const animation of this.services.scr.running) {
        alive.add(animation);
        const first = this.animationFirstSeen.get(animation) ?? now;
        this.animationFirstSeen.set(animation, first);
        if (now - first > this.options.stuckAnimationSeconds * 1000) {
          this.problem("animation coincée", `SCR ${animation.scrId} tourne depuis ${Math.round((now - first) / 1000)} s (durée annoncée ${animation.duration} ticks)`);
          this.animationFirstSeen.set(animation, now);
        }
      }
      for (const key of this.animationFirstSeen.keys()) if (!alive.has(key)) this.animationFirstSeen.delete(key);
    }
  }

  // --- Roster ---

  /** Le stockage se relit, le roster fait l'aller-retour, et (si `synced`) la mémoire est identique au stockage. */
  checkRoster(where: string, synced = true): void {
    const raw = this.host.storage.get(ROSTER_STORAGE_KEY);
    const memory = this.engine.ctx.roster.roster;
    if (raw === null) {
      if (memory.playerCount > 0 && synced) this.problem("roster", `${where} : ${memory.playerCount} joueur(s) en mémoire mais rien d'enregistré`);
      return;
    }
    const { roster: stored, status } = new RosterStore(this.host.storage).load();
    if (status !== "ok") {
      this.problem("roster", `${where} : le roster enregistré est illisible (${status})`);
      return;
    }
    const bytes = stored.encode();
    const again = Roster.decode(bytes).encode();
    if (bytes.length !== again.length || bytes.some((b, i) => b !== again[i])) this.problem("roster", `${where} : l'aller-retour décode / encode change le roster`);
    const names = (r: Roster) => r.players().map((p) => p.name).join(",");
    if (synced && names(stored) !== names(memory)) this.problem("roster", `${where} : joueurs enregistrés (${names(stored)}) ≠ joueurs en mémoire (${names(memory)})`);
    if (synced) {
      const current = this.engine.ctx.roster.currentPlayerId;
      if (current > 0) {
        if (stored.getMask(current) !== memory.getMask(current)) this.problem("roster", `${where} : masque des niveaux enregistré ${stored.getMask(current)} ≠ mémoire ${memory.getMask(current)}`);
        if (memory.getPlayer(current) && !stored.getPlayer(current)) this.problem("roster", `${where} : le joueur courant n'est pas dans le stockage`);
      }
      if (stored.clickAndStick !== memory.clickAndStick || stored.ambient !== memory.ambient || stored.bowlingTicks !== memory.bowlingTicks) {
        this.problem("roster", `${where} : préférences enregistrées (clic ${stored.clickAndStick}, ambiance ${stored.ambient}, bowling ${stored.bowlingTicks}) ≠ mémoire (${memory.clickAndStick}, ${memory.ambient}, ${memory.bowlingTicks})`);
      }
    }
    const players = memory.players();
    for (const p of players) {
      const grade = memory.grade(p.id);
      if (grade < 1 || grade > 25) this.problem("roster", `${where} : rang ${grade} hors de 1 à 25 pour ${p.name}`);
    }
  }

  // --- Fin de graine ---

  /** Contrôles de fin : enter / leave équilibrés, audio rendu, MIDI remis à zéro. */
  finish(): void {
    const midi = this.host.audio.midi;
    if (midi.noteOns > 0 && midi.resets === 0) this.violate(this.sceneName, "audio", `${midi.noteOns} notes MIDI jouées mais le MIDI n'a jamais été remis à zéro (reset)`);
    for (const life of this.sceneLives) {
      const open = life === this.activeLife ? 1 : 0;
      if (life.enters - life.leaves !== open) {
        this.violate(SCENE_NAMES[life.id], "enter/leave", `déséquilibre : ${life.enters} entrée(s), ${life.leaves} sortie(s)`);
      }
    }
  }

  get hub(): HubScene {
    return this.engine.scenes.current as HubScene;
  }

  get realSeconds(): number {
    return (Date.now() - this.startedAt) / 1000;
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}${error.stack ? ` @ ${error.stack.split("\n").find((l) => /src\/games/.test(l))?.trim() ?? ""}` : ""}`;
  return String(error);
}
