import { VoiceChannel } from "../audio/voice";
import { Clock } from "./clock";
import type { Host } from "./host";
import { loadOptions } from "./options";
import { Fade, Palette } from "./palette";
import { Resources } from "./resources";
import { BorlandRandom } from "./rng";
import { SceneManager, type Scene, type SceneContext } from "./scene";
import { Surface } from "./surface";

/** Bips préchargés (`305a:0008`) : `s52d001b.voc`, `s01a002b.voc`, `s01a001b.voc`, dans cet ordre. */
export const BEEP_FILES = ["s52d001b.voc", "s01a002b.voc", "s01a001b.voc"] as const;

/** Répétition des touches de volume : bloquée 20 ticks entre deux pas (`DS:6120`). */
const VOLUME_REPEAT_TICKS = 20;

export interface EngineOptions {
  /** Graine du hasard ; défaut : `unixSeconds() & 0xFFFF` comme l'original. */
  seed?: number;
}

/**
 * Moteur : assemble l'horloge, la surface, la palette, les entrées, la voie son et le gestionnaire de scènes autour
 * d'un `Host`. L'hôte appelle `frame(now)` à chaque image affichée ; tout le reste (60 ticks/s, scènes, fondus,
 * présentation) se déroule à l'intérieur. Aucune boucle bloquante.
 */
export class Engine {
  readonly ctx: SceneContext;
  private readonly clock = new Clock();
  private readonly surface = new Surface();
  private readonly palette = new Palette();
  private readonly fade = new Fade(this.palette);
  private readonly voice: VoiceChannel;
  private readonly scenes: SceneManager;
  private readonly displayPalette = new Uint8Array(768);
  private volumeCooldown = 0;
  private fadeWasActive = false;
  private presented = false;
  private paused = false;

  constructor(
    private readonly host: Host,
    options: EngineOptions = {},
  ) {
    this.voice = new VoiceChannel(host.audio);
    this.scenes = new SceneManager(() => this.ctx);
    this.ctx = {
      host,
      clock: this.clock,
      rng: new BorlandRandom(options.seed ?? host.unixSeconds() & 0xffff),
      surface: this.surface,
      palette: this.palette,
      fade: this.fade,
      input: host.input,
      voice: this.voice,
      resources: new Resources(host),
      options: loadOptions(host.storage),
      scenes: this.scenes,
    };
  }

  /** Vrai pendant le chargement des ressources d'une scène. */
  get loading(): boolean {
    return this.scenes.loading;
  }

  /** Promesse du chargement en cours, `null` sinon (utile pour un hôte ou un test qui veut attendre). */
  get whenLoaded(): Promise<void> | null {
    return this.scenes.whenLoaded;
  }

  /** Précharge les bips puis lance la première scène. */
  async start(scene: Scene): Promise<void> {
    const beeps = await Promise.all(BEEP_FILES.map((name) => this.ctx.resources.voc(name)));
    this.voice.setBeeps(beeps);
    this.scenes.replace(scene);
  }

  /** Vrai entre `setPaused(true)` et `setPaused(false)`. */
  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Pause de l'hôte (onglet masqué) : plus aucun tick ni son, `frame` ne fait rien. À la reprise le jeu repart du
   * même point : l'absence n'est pas rattrapée et le son reprend là où il s'était arrêté, donc vidéos et sons restent
   * synchronisés. Sans rapport avec la touche « pause » du jeu (action `pause`, gérée par les scènes).
   */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) this.host.audio.suspend();
    else {
      this.clock.resync();
      this.host.audio.resume();
    }
  }

  /**
   * Une image affichée : avance l'horloge, joue les ticks dus (entrées globales, son, fondu, scène),
   * dessine la scène si besoin et présente le résultat à l'hôte.
   */
  frame(nowMs: number): void {
    if (this.paused) return;
    this.clock.update(nowMs);
    let changed = !this.presented;
    while (this.clock.consume()) this.tick();
    if (this.scenes.render()) changed = true;
    const fading = this.fade.active;
    if (fading || this.fadeWasActive) changed = true;
    this.fadeWasActive = fading;
    if (changed) {
      this.host.present(this.surface.work, this.palette.display(this.displayPalette));
      this.presented = true;
    }
  }

  private tick(): void {
    const { input, voice } = this.ctx;
    if (this.volumeCooldown > 0) this.volumeCooldown--;
    else if (input.pressed("volumeUp") !== input.pressed("volumeDown")) {
      voice.setVolume(voice.volume + (input.pressed("volumeUp") ? 1 : -1));
      this.volumeCooldown = VOLUME_REPEAT_TICKS;
    }
    voice.update();
    this.fade.tick();
    this.scenes.tick();
  }
}
