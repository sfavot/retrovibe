/**
 * Aide de Poly (tâche G3) : machine d'états pure, branchée sur le lecteur de scripts, le son et le curseur par de minces « ports ».
 *
 * Déroulé commun aux activités (hidden.md §3.7, patterns.md §3.8, sticklers.md §5.4, pattern-windows.md §1.7, rockets.md §1.8) :
 *  1. `open()` (bouton Help) : arrivée de Poly (non interruptible), puis la **grande présentation** la 1re fois du joueur dans l'activité
 *     (drapeau du roster « Poly a déjà présenté le jeu », posé à ce moment) ou la **courte** ensuite ; interruptibles par un clic ;
 *  2. l'aide « ? » : le curseur devient « ? » au survol d'un élément ; un clic sur un élément joue son explication
 *     (couche « avant », explication, couche « après » ; chaînes « puis » de Rockets / Pattern Windows) ;
 *     un clic interrompt l'animation en cours et **arrête la suite** ;
 *  3. si la présentation courte a été jouée et que rien n'est survolé ni cliqué pendant 300 ticks, la grande présentation est rejouée une fois ;
 *  4. un clic sur Poly lui fait dire une réplique (tirée sans mémoire, ou sans remise pour Pattern Windows), puis elle part : l'aide se referme.
 * Voix sur le canal `voice` (une seule à la fois, une nouvelle remplace l'ancienne). Aucune copy : tout est audio.
 *
 * `PolyHelper` ne connaît ni archive, ni surface, ni curseur : tout passe par `PolyPorts`. `createScrPolyPorts` est l'implémentation réelle
 * (`ScrPlayer` en mode bloquant, voix, fond sauvegardé, curseur « ? »). Les tests utilisent des ports factices.
 */
import type { Archive, Resources } from "../engine/resources";
import { SCR_FLAG, type ScrArchive, type ScrPlayer } from "../engine/scr-player";
import type { Rect, Surface, SavedRect } from "../engine/graphics/surface";
import type { CursorController } from "../engine/pointer";
import type { RosterState, RosterFieldName } from "../engine/roster";
import { NoRepeatPool, type MsvcRandom } from "../engine/rng";
import { POLY_ZONE, type PolyConfig, type PolyContext, type PolyTopic } from "./poly-config";

// --- Ports ---

/** Une animation de Poly en cours (`AnimationHandle` du lecteur en est une, adaptée). */
export interface PolyAnimation {
  /** Terminée ou interrompue. */
  readonly done: boolean;
  /** Interrompue (clic) plutôt que menée au bout. */
  readonly interrupted: boolean;
  interrupt(): void;
}

export interface PolyPorts {
  /** Joue le `\0SCR` `scr` de l'archive d'aide (décalage `y`, canal voix : à la charge du port). `interruptible` : un clic peut la couper. */
  play(scr: number, options: { interruptible: boolean }): PolyAnimation;
  /** L'aide s'ouvre : sauvegarde du fond sous Poly, curseur. */
  begin?(): void;
  /** L'aide se ferme (ou est abandonnée) : fond restauré, curseur normal. */
  end?(): void;
  /** Le survol est (ou n'est plus) sur un élément qui montre le « ? ». */
  setHelpHover?(on: boolean): void;
}

/** Accès à la variable du roster « Poly a déjà présenté le jeu ». */
export interface IntroFlag {
  get(): boolean;
  set(seen: boolean): void;
}

/** Drapeau d'une activité dans le roster du joueur courant (le roster est enregistré par la scène à sa sortie, ou tout de suite via `onFirstIntro`). */
export function rosterIntroFlag(state: RosterState, field: RosterFieldName): IntroFlag {
  return {
    get: () => state.currentPlayerId !== 0 && state.roster.getVar(state.currentPlayerId, field) !== 0,
    set: (seen) => {
      if (state.currentPlayerId !== 0) state.roster.setVar(state.currentPlayerId, field, seen ? 1 : 0);
    },
  };
}

export interface PolyDeps {
  ports: PolyPorts;
  rng: MsvcRandom;
  introFlag: IntroFlag;
  /** La grande présentation vient d'être lancée pour la première fois (Rockets sauvegarde le roster tout de suite ; les puzzles à la sortie de scène). */
  onFirstIntro?(): void;
  /** L'aide s'est refermée (Poly est partie) : la scène relance sa musique, réactive ses groupes, relance le préchargement. */
  onClosed?(): void;
}

// --- Machine d'états ---

export type PolyPhase = "closed" | "arriving" | "intro" | "listening" | "explaining" | "leaving";

type Role = "arrival" | "intro" | "idle" | "before" | "main" | "after" | "tip" | "departure";

interface Step {
  scr: number;
  role: Role;
  interruptible: boolean;
  /** Joué même si une étape précédente a été interrompue (départ de Poly). */
  essential: boolean;
}

type Sequence = "open" | "explain" | "exit";

export class PolyHelper {
  readonly config: PolyConfig;
  private readonly deps: PolyDeps;
  private readonly pool: NoRepeatPool | null;
  private _phase: PolyPhase = "closed";
  private queue: Step[] = [];
  private current: { step: Step; animation: PolyAnimation } | null = null;
  private sequence: Sequence = "open";
  /** Ticks depuis l'armement de la minuterie d'inactivité ; `null` : désarmée. */
  private idleTicks: number | null = null;
  private hovering = false;
  /** Armer la minuterie d'inactivité à la fin de la séquence d'ouverture (présentation courte jouée). */
  private idleOnComplete = false;
  private _firstIntroThisVisit = false;
  /** Journal des scripts lancés (diagnostic et tests). */
  readonly played: number[] = [];

  constructor(config: PolyConfig, deps: PolyDeps) {
    this.config = config;
    this.deps = deps;
    this.pool = config.exit.kind === "tips" && config.exit.pick === "pool" ? new NoRepeatPool(config.exit.count) : null;
  }

  get phase(): PolyPhase {
    return this._phase;
  }

  /**
   * Poly est à l'écran (`DS:32c2 ≠ 0`) : de l'ouverture à la fermeture de l'aide. La rotation (Espace, Rotate) est alors ignorée et la touche non consommée.
   */
  get active(): boolean {
    return this._phase !== "closed";
  }

  /** Le joueur a vu la grande présentation pour la première fois pendant cette visite (la scène enregistre alors le roster en sortant). */
  get firstIntroThisVisit(): boolean {
    return this._firstIntroThisVisit;
  }

  /** Script en cours, ou `null`. */
  get currentScr(): number | null {
    return this.current?.step.scr ?? null;
  }

  /** La minuterie d'inactivité est armée (présentation courte jouée, rien survolé ni cliqué). */
  get idleArmed(): boolean {
    return this.idleTicks !== null;
  }

  /** Bouton Help : ouvre l'aide. Sans effet si elle est déjà ouverte. */
  open(ctx: PolyContext = {}): void {
    if (this._phase !== "closed") return;
    const { config } = this;
    this.deps.ports.begin?.();
    this.idleTicks = null;
    this.sequence = "open";
    const first = !this.deps.introFlag.get();
    this.queue = [];
    if (config.arrival !== null && !ctx.polyPresent) this.queue.push({ scr: config.arrival, role: "arrival", interruptible: false, essential: true });
    this.queue.push({ scr: first ? config.introLong : config.introShort, role: "intro", interruptible: true, essential: false });
    if (first) {
      this.deps.introFlag.set(true);
      this._firstIntroThisVisit = true;
      this.deps.onFirstIntro?.();
    }
    this.idleOnComplete = !first && config.idleTicks > 0;
    this.advance();
  }

  /** Survol d'un élément de l'aide (`null` : rien). Montre le « ? » sur les éléments qui ont une explication (pas sur Poly) ; un survol désarme la minuterie. */
  hover(zone: string | null): void {
    if (this._phase === "closed") return;
    const on = zone !== null && zone !== POLY_ZONE && zone in this.config.topics;
    if (on !== this.hovering) {
      this.hovering = on;
      this.deps.ports.setHelpHover?.(on);
    }
    if (on) this.idleTicks = null;
  }

  /**
   * Clic sur un élément de l'aide : `zone` est une clé de `config.topics` ou `POLY_ZONE`. Renvoie vrai si le clic est consommé (toute l'aide capte
   * les clics tant qu'elle est ouverte) ; faux si l'aide est fermée ou si la zone n'a pas d'explication.
   * Pendant une animation : l'interrompt si elle l'est (la suite de la séquence est abandonnée), sinon l'ignore.
   */
  click(zone: string, ctx: PolyContext = {}): boolean {
    if (this._phase === "closed") return false;
    if (this.current) {
      if (this.current.step.interruptible) this.current.animation.interrupt();
      return true;
    }
    if (this._phase !== "listening") return true;
    this.idleTicks = null;
    if (zone === POLY_ZONE) {
      this.startExit(ctx);
      return true;
    }
    const topic = this.config.topics[zone];
    if (!topic) return false;
    this.startExplanation(topic, ctx);
    return true;
  }

  /** Un tick (17 ms) : suit l'animation en cours, enchaîne la suite, compte l'inactivité. */
  tick(): void {
    if (this._phase === "closed") return;
    if (this.current) {
      if (!this.current.animation.done) return;
      const interrupted = this.current.animation.interrupted;
      this.current = null;
      // Un clic qui interrompt une étape abandonne les suivantes (« puis » seulement si la précédente est allée au bout), sauf le départ de Poly.
      if (interrupted) this.queue = this.queue.filter((step) => step.essential);
      this.advance();
      return;
    }
    if (this._phase === "listening" && this.idleTicks !== null && ++this.idleTicks >= this.config.idleTicks) {
      this.idleTicks = null;
      this.sequence = "open";
      this.idleOnComplete = false;
      this.queue = [{ scr: this.config.introLong, role: "idle", interruptible: true, essential: false }];
      this.advance();
    }
  }

  /** Abandon silencieux (sortie de scène) : l'animation est coupée, rien n'est rappelé. */
  abort(): void {
    if (this._phase === "closed") return;
    this.current?.animation.interrupt();
    this.current = null;
    this.queue = [];
    this.close(false);
  }

  // --- Séquences ---

  private startExplanation(topic: PolyTopic, ctx: PolyContext): void {
    const { config } = this;
    const steps: Step[] = [];
    const push = (scr: number, role: Role) => steps.push({ scr, role, interruptible: true, essential: false });
    if (config.before !== null && topic.before !== false) push(config.before, "before");
    push(typeof topic.scr === "function" ? topic.scr(ctx) : topic.scr, "main");
    for (const scr of topic.then ?? []) push(scr, "main");
    if (config.after !== null && topic.after !== false) push(config.after, "after");
    this.sequence = "explain";
    this.queue = steps;
    this.advance();
  }

  private startExit(ctx: PolyContext): void {
    const { exit } = this.config;
    const steps: Step[] = [];
    if (exit.kind === "custom") {
      for (const scr of exit.sequence(ctx, this.deps.rng)) steps.push({ scr, role: "tip", interruptible: true, essential: false });
    } else {
      const compliment = exit.compliment;
      let scr: number;
      if (compliment && ctx.variedImage && this.deps.rng.range(0, 100) < compliment.chance) scr = compliment.scr;
      else {
        const r = this.pool ? this.pool.pick(this.deps.rng) : this.deps.rng.rand1(exit.count);
        scr = exit.table ? exit.table[r]! : exit.base + 50 * r;
      }
      steps.push({ scr, role: "tip", interruptible: true, essential: false });
      if (exit.departure !== null) steps.push({ scr: exit.departure, role: "departure", interruptible: false, essential: true });
    }
    this.sequence = "exit";
    this.queue = steps;
    this.advance();
  }

  private advance(): void {
    const next = this.queue.shift();
    if (!next) {
      this.complete();
      return;
    }
    this._phase = next.role === "arrival" ? "arriving" : next.role === "intro" || next.role === "idle" ? "intro" : this.sequence === "exit" ? "leaving" : "explaining";
    this.played.push(next.scr);
    const animation = this.deps.ports.play(next.scr, { interruptible: next.interruptible });
    this.current = { step: next, animation };
    // Une animation déjà terminée (script vide) passe à la suite au tick suivant.
  }

  private complete(): void {
    if (this.sequence === "exit") {
      this.close(true);
      return;
    }
    this._phase = "listening";
    if (this.sequence === "open" && this.idleOnComplete) {
      this.idleTicks = 0;
      this.idleOnComplete = false;
    }
  }

  private close(notify: boolean): void {
    this._phase = "closed";
    this.idleTicks = null;
    this.idleOnComplete = false;
    if (this.hovering) {
      this.hovering = false;
      this.deps.ports.setHelpHover?.(false);
    }
    this.deps.ports.end?.();
    if (notify) this.deps.onClosed?.();
  }
}

// --- Archive ---

/** Ouvre l'archive d'aide dans `Scene.load` (`POLLY.DAT` temporairement ; `PATFILL.DAT` / `NIM.DAT` sont celles de la scène, déjà ouvertes). */
export function openPolyArchive(resources: Resources, config: PolyConfig): Promise<Archive> {
  return resources.open(config.archive);
}

/** Libère `POLLY.DAT` quand la scène n'en a plus besoin (sortie de scène) ; sans effet sur l'archive propre de la scène. */
export function releasePolyArchive(resources: Resources, config: PolyConfig): void {
  if (config.temporaryArchive) resources.release(config.archive);
}

// --- Ports réels ---

export interface ScrPolyPortsDeps {
  config: PolyConfig;
  scr: ScrPlayer;
  /** L'archive d'aide ouverte (`Archive` convient). */
  archive: ScrArchive;
  /** Surface de jeu : le fond de `config.backgroundZone` y est sauvegardé à l'ouverture et rétabli à la fermeture. */
  surface: Surface;
  /** Contrôleur de curseur du pointeur (`pointer.cursor`) pour le « ? » du mode aide. */
  cursor?: CursorController;
  /** La surface a changé (fond rétabli) : `ctx.requestPresent`. */
  onDirty?: () => void;
}

/**
 * Ports branchés sur `ScrPlayer` : chaque script est lancé en mode **bloquant** (gadgets et pointeur gelés pendant l'animation, comme la boucle
 * `1090:111c`), avec les drapeaux des descripteurs de Poly (fond sauvegardé, MIDI conservé, attente des sons) et le drapeau « interruptible par clic » selon
 * l'étape ; voix sur le canal `voice`, décalage `y` de la configuration.
 */
export function createScrPolyPorts(deps: ScrPolyPortsDeps): PolyPorts {
  const { config, scr, archive, surface, cursor } = deps;
  let saved: SavedRect | null = null;
  return {
    play(id, { interruptible }) {
      const handle = scr.start(archive, id, {
        flags: SCR_FLAG.saveBackground | SCR_FLAG.keepMidi | SCR_FLAG.waitSounds | (interruptible ? SCR_FLAG.interruptible : 0),
        offsetY: config.offsetY,
        soundChannel: "voice",
        blocking: true,
      });
      return {
        get done() {
          return handle.done;
        },
        get interrupted() {
          return handle.state === "interrupted";
        },
        interrupt() {
          handle.interrupt();
        },
      };
    },
    begin() {
      if (config.backgroundZone) {
        const [left, top, right, bottom] = config.backgroundZone;
        const rect: Rect = { x: left, y: top, w: right - left, h: bottom - top };
        saved = surface.saveRect(rect);
      }
    },
    end() {
      if (saved) {
        surface.restoreRect(saved);
        saved = null;
        deps.onDirty?.();
      }
      cursor?.setHelpHover(false);
    },
    setHelpHover(on) {
      cursor?.setHelpHover(on);
    },
  };
}
