import type { WebSampleOutput } from "../../../audio/web-sample-output";
import type { PointClickHost, PointClickKey } from "../../../ui/point-click-app";
import { type GmPort, WebMusic } from "../audio/web-music";
import { type EventQueue, eventsOf, modifiersOf, MouseButton, SciKey, sciKeyOf } from "../engine/events";
import { soundDriverOf, soundManagerOf } from "../engine/kernel/sound";
import type { Vm } from "../engine/vm";
import { frameoutOf } from "../render/frameout";
import { rectContainsPoint } from "../render/rect";
import { seqPlayerOf } from "../render/seq-player";

export interface BrowserHostOptions {
  vm: Vm;
  /**
   * Sortie audio de la page, créée et débloquée dans le geste qui lance le jeu : son contexte porte le synthétiseur de la
   * musique, son gain général est celui du bouton « Son » et du volume.
   */
  output: WebSampleOutput;
  /** URL de la soundfont General MIDI. */
  soundfontUrl: string;
  /** Point d'injection des tests (`WebMusicOptions.createSynth`). */
  createSynth?(ctx: AudioContext, output: AudioNode): GmPort;
}

/**
 * Hôte du navigateur de Gabriel Knight, pour la page des jeux de pointer-et-cliquer (`docs/gk1/plan.md`, D7 à D9).
 *
 * - **Entrées** : la file des évènements de la machine virtuelle (`engine/events.ts`) reçoit la souris telle quelle (bouton
 *   droit = curseur suivant). Au doigt, un toucher est un clic gauche et un appui long un clic droit, là où le doigt est posé.
 *   Les touches vont toutes au jeu, traduites en codes SCI.
 * - **Barre d'icônes au doigt** : elle s'ouvre quand le curseur arrive en haut de l'écran, au-dessus de la pièce. Un doigt n'a
 *   pas de survol : son toucher y arrive d'un coup, et le clic ferait d'abord marcher Gabriel vers ce point. Un toucher hors de
 *   tout plan visible ne fait donc que déplacer le curseur ; la barre s'ouvre, et le toucher suivant choisit une icône.
 * - **Musique** : le pilote General MIDI du jeu joue sur le synthétiseur du site (`audio/web-music.ts`), dont l'horloge date
 *   les messages du gestionnaire de sons. Le bouton « Son » et le volume agissent sur le gain général : coupé, le son continue
 *   d'avancer, les scènes calées sur la musique ne se bloquent pas.
 * - **Pause** (onglet masqué, fenêtre ouverte) : boutons relâchés, contexte audio suspendu.
 *
 * Il ne touche pas au DOM : le canvas et ses évènements sont branchés par la page.
 */
export class BrowserHost implements PointClickHost {
  readonly input: EventQueue;
  readonly music: WebMusic;
  private readonly output: WebSampleOutput;
  private readonly vm: Vm;

  constructor(options: BrowserHostOptions) {
    const { vm, output } = options;
    this.output = output;
    this.vm = vm;
    this.input = eventsOf(vm);
    const { ctx, master } = output.connection();
    const driver = soundDriverOf(vm);
    const music = new WebMusic({
      ctx,
      output: master,
      soundfontUrl: options.soundfontUrl,
      ticks: () => vm.ticks,
      onSync: () => driver.attach(music),
      createSynth: options.createSynth,
    });
    this.music = music;
    soundManagerOf(vm).clock = () => music.now();
  }

  /**
   * Toucher (0) ou appui long (2) du doigt en (x, y) : un clic du bouton gauche ou du bouton droit. Hors de tout plan visible
   * (la bande au-dessus de la pièce, quand la barre d'icônes est fermée), un toucher ne fait que poser le curseur.
   */
  tap(button: 0 | 2, x: number, y: number): void {
    this.input.move(x, y);
    if (button === 0 && !seqPlayerOf(this.vm).playing && !this.onVisiblePlane(this.input.x, this.input.y)) return;
    const mouse = button === 0 ? MouseButton.Left : MouseButton.Right;
    this.input.down(mouse, x, y);
    this.input.up(mouse, x, y);
  }

  private onVisiblePlane(x: number, y: number): boolean {
    return frameoutOf(this.vm).planes.some((plane) => plane.priority >= 0 && rectContainsPoint(plane.screenRect, x, y));
  }

  /** Bouton « Passer » : comme Échap, qui interrompt la cinématique en cours. */
  skip(): void {
    this.input.keyDown(SciKey.Escape);
    this.input.keyUp(SciKey.Escape);
  }

  /** Touche enfoncée : le jeu la reçoit si elle a un code SCI. Les raccourcis du système (touche Cmd ou Windows) restent au navigateur. */
  key(event: KeyboardEvent): PointClickKey | undefined {
    const key = event.metaKey ? 0 : sciKeyOf(event);
    if (key === 0) return undefined;
    const modifiers = modifiersOf(event);
    return { engine: () => this.input.keyDown(key, modifiers) };
  }

  keyUp(event: KeyboardEvent): boolean {
    const key = event.metaKey ? 0 : sciKeyOf(event);
    if (key !== 0) this.input.keyUp(key, modifiersOf(event));
    return key !== 0;
  }

  get volume(): number {
    return this.output.volume;
  }

  /** Volume du son choisi par la joueuse (0 à 1). */
  setUserVolume(level: number): void {
    this.output.volume = level;
  }

  /** À appeler dans un geste de l'utilisatrice : le navigateur ne laisse démarrer le son qu'après. */
  unlock(): void {
    this.output.unlock();
  }

  setPaused(paused: boolean): void {
    if (paused) {
      this.input.releaseAll();
      this.output.suspend();
    } else this.output.resume();
  }

  /** Page quittée. */
  close(): void {
    this.music.close();
    this.output.close();
  }
}
