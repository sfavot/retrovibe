/**
 * Le professeur animé des fenêtres d'aide (`HELP.ITF`) et de fin de catégorie (`BINSOLVE.ITF`), lu dans TIMWIN.EXE (rien d'autre ne le
 * dessine : à l'ouverture d'un puzzle, PUZZDISP joue seulement la voix du but, 425f6b → 424684 ; les indices ont leur propre portrait,
 * `HINTPROF.ANM`, dans `HINT.ITF`).
 *
 * - **Départ** (423e50, contrôle et voix) : `PROFAMBT.ANM` (attente) et `PROFSPCH.ANM` (parole) chargés, la voix en cours coupée, la
 *   voix demandée préparée (4247c0) ; le contrôle est animé à chaque passe de la boucle des contrôles (drapeau 1, rappel 4241ae) et
 *   dessiné par 424089. Voix 4564 (`help/064`, « manuel on-line ») : 423e50 s'arrête là, le contrôle garde son image d'ITF ; voix 4684 :
 *   remplacée par 4000 (`profesor/000`).
 * - **Les quatre premières passes** (`[0x47fa00]` = 4, la première pendant 423e50) : corps au repos (état 5) et bouche fermée (état 27),
 *   puis la voix part (424684).
 * - **Parole** (4241ae) : à chaque passe, les évènements de synchro dont l'instant est passé s'appliquent (`mouth()` de l'audio) :
 *   bouche = image de l'état de la forme, geste = première image de son état ; sans nouveau geste, le corps avance d'une image et
 *   revient au début de l'état 5 à la fin de l'état. Voix finie (4116f5) ou synchro épuisée : 42452c enchaîne la suite de quatre voix
 *   (63 → 184, 84 → 185, 87 → 186, 106 → 187) ; sinon la bouche se ferme une passe, puis le professeur revient à l'attente et la voix
 *   est coupée.
 * - **Attente** (4244b2) : image de l'état 32 de `PROFAMBT.ANM` ; à chaque passe l'image avance, et au bout de son état on revient au
 *   début de l'état 32 et un compteur (60 au départ) baisse ; à 0, un des 13 états de la table `0x472be4` est tiré au hasard (jamais le
 *   même que le précédent, 4520a4 % 13), puis le compteur repart à 40 + hasard % 80.
 * - **Clic sur le professeur** (4241ae, bouton gauche, hors des quatre premières passes) : la voix demandée au départ est rejouée.
 * - **Appui sur un autre contrôle que les flèches** (`[0x490f08]` hors 23119, 23120) : retour à l'attente, voix coupée. Sans effet dans le
 *   port : les boutons de ces fenêtres les ferment.
 * - **Dessin** (424089) : le rectangle du contrôle, rempli de la couleur logique 11, découpe le dessin ; l'image (attente, ou corps puis
 *   bouche) est posée **retournée de gauche à droite** (dernier argument 1 de 44b094) avec son origine en (x + `unknown12` − 396,
 *   y + `unknown14`) : le professeur regarde vers le texte, à gauche.
 * - Fin (423f9d) : voix coupée, musique remise.
 *
 * Écart : le jeu baisse la musique pendant la voix (41177b(2, 1) et (1000, 1) dans 424684) ; le port garde la musique à son niveau.
 */
import type { Anm } from "../data/anm";
import type { ItfControl } from "../data/itf";
import { helpVoice, professorVoice, type VoiceRef } from "../audio/ids";
import { GESTURE_REST_STATE, MOUTH_REST_STATE, type MouthPose } from "../audio/lipsync";
import { FLIP_X, drawAnmImage, stateStart } from "../render/anm-draw";
import type { RenderAssets } from "../render/assets";
import type { Rect } from "../render/editor-overlay";
import { imageOfState } from "../render/itf-draw";
import { mapColor } from "../render/palette";
import type { Surface } from "../render/surface";

export const PROFESSOR_IDLE_ANM = "PROFAMBT.ANM";
export const PROFESSOR_SPEECH_ANM = "PROFSPCH.ANM";
/** États d'attente de `PROFAMBT.ANM` (table `0x472be4`) ; le premier est le repos. */
export const IDLE_STATES: readonly number[] = [32, 32, 33, 34, 31, 15, 19, 30, 22, 23, 25, 26, 27];
/** Passes avant la voix (`[0x47fa00]`), la première comprise. */
export const START_PASSES = 4;
/** Boucles de repos avant le premier geste d'attente (`[0x481010]` = 0x3c), puis 40 + hasard % 80. */
export const FIRST_IDLE_LOOPS = 60;
/** Décalage de l'origine du dessin (424089 : `add esi, -0x18c`). */
export const PROFESSOR_DX = -396;
/** Fond du contrôle (424089 : 413388(0xb)). */
export const PROFESSOR_FILL = 11;
/** Suites des voix d'aide (42452c : 4563, 4584, 4587, 4606 → 4684 à 4687). */
export const HELP_CHAIN: Readonly<Record<number, number>> = { 63: 184, 84: 185, 87: 186, 106: 187 };
/** 423e50 : la voix 4564 ne lance pas le professeur. */
export const HELP_SILENT = 64;
/** 423e50 : la voix 4684 devient 4000. */
const HELP_TO_PROFESSOR = 184;

/** Ce que le professeur demande au son (`Tim3Audio`). */
export interface ProfessorAudio {
  playVoice(ref: VoiceRef): boolean;
  stopVoice(): void;
  readonly voiceActive: boolean;
  mouth(): MouthPose;
}

/** Hasard entier positif (4520a4, `rand`). */
export type Random = () => number;

const defaultRandom: Random = () => Math.floor(Math.random() * 0x8000);

type Phase = { kind: "start"; left: number } | { kind: "speaking"; body: number; mouth: number; gestureMs: number } | { kind: "idle"; frame: number };

/** Le professeur doit-il s'animer pour cette voix (423e50) ? Faux pour `help/064`. */
export function professorStarts(voice: VoiceRef | null): boolean {
  return !(voice?.archive === "help" && voice.index === HELP_SILENT);
}

export class Professor {
  private phase: Phase;
  private readonly idle: Anm | null;
  private readonly speech: Anm | null;
  /** Boucles de repos avant le prochain geste d'attente (`[0x481010]`) et index du dernier tiré (`[0x47f9d4]`). */
  private loops = FIRST_IDLE_LOOPS;
  private lastIdle = 0;
  /** Voix en cours (une suite remplace la voix demandée). */
  private current: VoiceRef | null;
  /** La suite a déjà servi (42452c remet `[0x47f9e8]` à 0 : une seule fois, même après un clic qui rejoue la voix). */
  private chained = false;
  private stopped = false;

  constructor(
    assets: RenderAssets,
    private readonly audio: ProfessorAudio,
    /** Voix demandée (`null` : aucune, BINSOLVE). */
    readonly voice: VoiceRef | null,
    private readonly random: Random = defaultRandom,
  ) {
    this.idle = assets.anm(PROFESSOR_IDLE_ANM);
    this.speech = assets.anm(PROFESSOR_SPEECH_ANM);
    this.current = voice?.archive === "help" && voice.index === HELP_TO_PROFESSOR ? professorVoice(0) : voice;
    // 423e50 coupe la voix en cours, puis appelle 4241ae une première fois.
    audio.stopVoice();
    this.phase = { kind: "start", left: START_PASSES };
    this.pass();
  }

  /** Le professeur parle (ou va parler). */
  get speaking(): boolean {
    return this.phase.kind !== "idle";
  }

  /** Images à dessiner : `idle` (attente) ou `body` et `mouth` (parole), dans `PROFAMBT.ANM` et `PROFSPCH.ANM`. */
  get images(): { idle: number } | { body: number; mouth: number } {
    const p = this.phase;
    if (p.kind === "idle") return { idle: p.frame };
    if (p.kind === "start") return { body: this.first(this.speech, GESTURE_REST_STATE), mouth: this.first(this.speech, MOUTH_REST_STATE) };
    return { body: p.body, mouth: p.mouth };
  }

  private first(anm: Anm | null, state: number): number {
    return anm ? Math.max(0, imageOfState(anm, state)) : 0;
  }

  /** Une passe de la boucle des contrôles (50 ms) : vrai pour redessiner. */
  pass(): boolean {
    if (this.stopped) return false;
    const p = this.phase;
    if (p.kind === "start") {
      p.left--;
      if (p.left === 0) this.say();
      return true;
    }
    if (p.kind === "speaking") return this.speakPass(p);
    return this.idlePass(p);
  }

  /** 424684 : la voix part ; la parole commence au repos. */
  private say(): void {
    if (this.current) this.audio.playVoice(this.current);
    this.phase = { kind: "speaking", body: this.first(this.speech, GESTURE_REST_STATE), mouth: this.first(this.speech, MOUTH_REST_STATE), gestureMs: 0 };
  }

  private speakPass(p: Extract<Phase, { kind: "speaking" }>): boolean {
    if (!this.audio.voiceActive) {
      // 42452c : suite de la voix, sinon bouche fermée une passe, puis l'attente.
      const next = !this.chained && this.current?.archive === "help" ? HELP_CHAIN[this.current.index] : undefined;
      if (next !== undefined) {
        this.chained = true;
        this.current = helpVoice(next);
        this.say();
        return true;
      }
      const rest = this.first(this.speech, MOUTH_REST_STATE);
      if (p.mouth !== rest) {
        p.mouth = rest;
        return true;
      }
      this.toIdle();
      return true;
    }
    const pose = this.audio.mouth();
    const before = p.body;
    if (pose.gestureStartMs !== p.gestureMs) {
      p.gestureMs = pose.gestureStartMs;
      p.body = this.first(this.speech, pose.gestureState);
    }
    p.mouth = this.first(this.speech, pose.mouthState);
    if (p.body === before && this.speech) {
      p.body++;
      if (stateStart(this.speech, p.body) !== 0) p.body = this.first(this.speech, GESTURE_REST_STATE);
    }
    return true;
  }

  private toIdle(): void {
    this.audio.stopVoice();
    this.loops = FIRST_IDLE_LOOPS;
    this.phase = { kind: "idle", frame: this.first(this.idle, IDLE_STATES[0]!) };
  }

  private idlePass(p: Extract<Phase, { kind: "idle" }>): boolean {
    if (!this.idle) return false;
    p.frame++;
    if (stateStart(this.idle, p.frame) === 0) return true;
    p.frame = this.first(this.idle, IDLE_STATES[0]!);
    this.loops--;
    if (this.loops === 0) {
      let i = this.lastIdle;
      while (i === this.lastIdle) i = this.random() % IDLE_STATES.length;
      p.frame = this.first(this.idle, IDLE_STATES[i]!);
      this.lastIdle = i;
      this.loops = 40 + (this.random() % 80);
    }
    return true;
  }

  /** Clic sur le professeur (4241ae, `[0x47fa00]` = 0) : la voix demandée repart du début. */
  replay(): void {
    if (this.stopped || this.phase.kind === "start") return;
    this.current = this.voice;
    this.audio.stopVoice();
    this.say();
  }

  /** Fermeture de la fenêtre (423f9d) : voix coupée. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.audio.stopVoice();
  }

  /** 424089 : fond du contrôle, puis le professeur retourné, découpé au rectangle du contrôle (`rect` : sur la surface). */
  draw(surface: Surface, assets: RenderAssets, control: Pick<ItfControl, "unknown12" | "unknown14">, rect: Rect): void {
    const clip = surface.setClip(rect.x, rect.y, rect.width, rect.height);
    surface.fillRect(rect.x, rect.y, rect.width, rect.height, mapColor(PROFESSOR_FILL));
    const x = rect.x + control.unknown12 + PROFESSOR_DX;
    const y = rect.y + control.unknown14;
    const images = this.images;
    if ("idle" in images) {
      if (this.idle) drawAnmImage(surface, assets, this.idle, images.idle, x, y, FLIP_X);
    } else if (this.speech) {
      drawAnmImage(surface, assets, this.speech, images.body, x, y, FLIP_X);
      drawAnmImage(surface, assets, this.speech, images.mouth, x, y, FLIP_X);
    }
    surface.restoreClip(clip);
  }
}
