import type { OplSink } from "../../../../audio/opl-stream";
import type { AdlibOutput } from "../backend";
import { ADL_TICKS_PER_SECOND, AdlPlayer } from "./adl-player";

/** Au-delà de ce retard (ms), `update` oublie le surplus au lieu de rattraper (onglet resté en arrière-plan sans pause). */
const MAX_CATCH_UP_MS = 1000;

/**
 * Musique AdLib des jeux Coktel sur une puce externe (`OplSink`, la sortie OPL commune `src/audio/web-opl.ts` dans le
 * navigateur) : le lecteur ADL tourne sur le fil principal, cadencé par l'horloge du jeu à 1 000 ticks par seconde
 * (`AdLib(1000)`), et chaque écriture est datée par le numéro de son tick (`beginTick`) ; la sortie la rejoue à
 * l'échantillon près. Même schéma que les séquenceurs de BASS, FOTAQ ou Lure.
 *
 * - `update()` rattrape les ticks écoulés depuis l'appel précédent : l'hôte l'appelle à chaque image, et chaque commande
 *   du moteur l'appelle d'abord, pour tomber entre les bons ticks (comme sous le verrou de AdLib::onTimer).
 * - La fin du morceau (`onStopped`) est signalée pendant `update()`, au tick où ScummVM passe `_playing` à faux.
 * - Arrêt, fin, chargement et déchargement passent par AdLib::end / reset : toutes les voix sont coupées.
 */
export class OplAdlibOutput implements AdlibOutput {
  onStopped: (() => void) | null = null;
  private readonly player: AdlPlayer;
  /** Numéro du prochain tick (croissant pour toute la vie de la sortie, même d'un morceau à l'autre). */
  private nextTick = 0;
  private lastUpdate: number;
  private remainder = 0;

  constructor(
    private readonly sink: OplSink,
    /** Horloge du jeu en millisecondes (elle s'arrête pendant la pause). */
    private readonly now: () => number,
  ) {
    sink.beginTick?.(this.nextTick);
    this.player = new AdlPlayer(sink);
    this.player.onFinished = () => this.onStopped?.();
    this.lastUpdate = now();
  }

  /** Joue les ticks écoulés sur l'horloge du jeu (au plus une seconde de retard). */
  update(): void {
    const now = this.now();
    this.remainder += Math.min(MAX_CATCH_UP_MS, Math.max(0, now - this.lastUpdate));
    this.lastUpdate = now;
    const period = 1000 / ADL_TICKS_PER_SECOND;
    while (this.remainder >= period) {
      this.remainder -= period;
      this.sink.beginTick?.(++this.nextTick);
      this.player.onTimer();
    }
  }

  get playing(): boolean {
    return this.player.isPlaying();
  }

  load(data: Uint8Array): void {
    this.update();
    this.player.load(data);
  }

  unload(): void {
    this.update();
    this.player.unload();
  }

  setRepeating(count: number): void {
    this.update();
    this.player.setRepeating(count);
  }

  play(): void {
    this.update();
    this.player.startPlay();
  }

  stop(): void {
    this.update();
    this.player.stopPlay();
  }
}
