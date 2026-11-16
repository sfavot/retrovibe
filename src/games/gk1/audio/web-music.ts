/**
 * Musique de Gabriel Knight dans le navigateur : le pilote General MIDI (`gm-driver.ts`) joue sur le synthétiseur du site
 * (`src/audio/web-gm-synth.ts`), daté par l'horloge du contexte audio (`docs/gk1/plan.md`, D9 et D13).
 *
 * Le gestionnaire de sons (`sound-manager.ts`) date chaque message sur une horloge qu'il suppose avancer comme le jeu : un tick
 * par soixantième de seconde. Trois cas rompent cette égalité, et cette classe les absorbe par un **décalage** entre l'horloge
 * qu'elle donne au gestionnaire (`now`) et celle du contexte :
 * - une image du jeu peut valoir plusieurs ticks (`engine/loop.ts` avance l'horloge à chaque tranche épuisée) : les ticks en
 *   trop sont du temps que le son n'a pas vécu, les messages suivants ne doivent pas partir d'autant plus tard ;
 * - le contexte audio peut être à l'arrêt alors que le jeu tourne (lecture automatique refusée, interruption sur téléphone) :
 *   son horloge est figée, celle du jeu non ;
 * - le synthétiseur n'est pas encore chargé (soundfont de 18 Mo, en tâche de fond).
 *
 * Tant que la sortie ne peut rien jouer, les messages sont abandonnés : le pilote garde l'état des canaux, et `onSync` le lui
 * fait renvoyer dès que la sortie est prête (les notes tenues à ce moment-là sont perdues, la suite est juste). Un arrêt bref du
 * contexte (la reprise après une pause prend une image ou deux) n'abandonne rien.
 *
 * Écart volontaire : rien de tel dans l'original, dont le pilote parlait à la carte son sans délai.
 */
import type { MidiSink } from "../../../audio/midi-sink";
import { WebGmSynth } from "../../../audio/web-gm-synth";
import { SONG_TICKS_PER_SECOND } from "./sci-song";

const MS_PER_TICK = 1000 / SONG_TICKS_PER_SECOND;
/** Images du jeu pendant lesquelles un contexte à l'arrêt garde ses messages (reprise après une pause). */
export const STALL_FRAMES = 15;

/** Ce que cette classe demande au synthétiseur (`WebGmSynth`). */
export interface GmPort extends MidiSink {
  readonly ready: boolean;
  load(): Promise<void>;
  close(): void;
}

export interface WebMusicOptions {
  /** Contexte audio de la page et nœud où brancher le synthétiseur (le gain général, celui du bouton « Son »). */
  ctx: AudioContext;
  output: AudioNode;
  /** URL de la soundfont General MIDI. */
  soundfontUrl: string;
  /** Horloge du jeu (`vm.ticks`). */
  ticks(): number;
  /** La sortie vient de devenir utilisable, ou de le redevenir : le pilote doit renvoyer son état (`GmDriver.attach`). */
  onSync(): void;
  /** Point d'injection des tests. */
  createSynth?(ctx: AudioContext, output: AudioNode): GmPort;
}

export class WebMusic implements MidiSink {
  private readonly synth: GmPort;
  /** Décalage acquis (ms) : temps du jeu que le contexte audio n'a pas vécu. */
  private shiftMs = 0;
  /** Horloge du jeu au début de l'image en cours, et ce que cette image vaut en temps réel (1 tick, 0 si le contexte est à l'arrêt). */
  private frameStart: number;
  private frameTicks = 0;
  private stalledFrames = 0;
  /** Des messages ont été abandonnés : l'état du synthétiseur n'est plus celui du pilote. */
  private needsSync = true;
  /** Le synthétiseur a reçu des messages avant l'abandon : il peut tenir des notes dont la fin a été perdue. */
  private stale = false;

  constructor(private readonly options: WebMusicOptions) {
    this.synth = (options.createSynth ?? ((ctx, output) => new WebGmSynth(ctx, output, { soundfontUrl: options.soundfontUrl })))(options.ctx, options.output);
    this.frameStart = options.ticks();
  }

  /** Charge le synthétiseur et sa soundfont en tâche de fond ; sans effet répété. */
  load(): void {
    void this.synth.load();
  }

  /** La musique s'entend : synthétiseur chargé, contexte en marche. */
  get audible(): boolean {
    return this.synth.ready && this.options.ctx.state === "running";
  }

  /** Horloge donnée au gestionnaire de sons (`SoundManager.clock`), en ms : celle du contexte, plus le décalage. */
  now(): number {
    return this.options.ctx.currentTime * 1000 + this.shift();
  }

  private shift(): number {
    return this.shiftMs + Math.max(0, this.options.ticks() - this.frameStart - this.frameTicks) * MS_PER_TICK;
  }

  /** À appeler avant chaque image du jeu (`runFrame`). */
  beginFrame(): void {
    this.shiftMs = this.shift();
    this.frameStart = this.options.ticks();
    const running = this.options.ctx.state === "running";
    this.frameTicks = running ? 1 : 0;
    this.stalledFrames = running ? 0 : this.stalledFrames + 1;
    if (!running || !this.synth.ready || !this.needsSync) return;
    if (this.stale) this.synth.reset();
    this.needsSync = this.stale = false;
    this.options.onSync();
  }

  send(message: Uint8Array, atMs?: number): void {
    if (!this.synth.ready || this.stalledFrames > STALL_FRAMES) {
      this.needsSync = true;
      return;
    }
    this.stale = true;
    this.synth.send(message, atMs === undefined ? undefined : atMs - this.shift());
  }

  reset(): void {
    this.synth.reset();
  }

  /** Page quittée : le synthétiseur est détruit (le contexte reste à l'appelant). */
  close(): void {
    this.synth.close();
  }
}
