import type { Muteable } from "../../../ui/sound-prefs";
import type { OplSink } from "./opl-driver";
import { OplWriteBuffer } from "./opl-stream";
import workletUrl from "./opl-worklet.ts?worker&url";

/**
 * `OplSink` navigateur : les écritures du séquenceur (50 Hz, indépendant des images du moteur) sont horodatées par tick du séquenceur, regroupées puis envoyées
 * à un AudioWorklet qui les applique à l'échantillon près dans l'émulateur OPL2 (voir `opl-stream.ts`). Le contexte
 * ne démarre qu'après un geste (règle des navigateurs) : `unlock()` depuis un gestionnaire d'événement utilisateur ;
 * les écritures faites avant sont gardées puis rejouées à la connexion du worklet.
 *
 * Latence : la synthèse tourne par blocs de 128 échantillons du contexte, plus 40 ms d'avance sur le premier tick
 * (gigue du fil principal) ; aucun tampon intermédiaire.
 */
export class WebOpl implements OplSink, Muteable {
  private readonly buffer = new OplWriteBuffer();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private node: AudioWorkletNode | null = null;
  /** Dernière valeur écrite de chaque registre avant que le worklet soit prêt (`-1` : jamais écrit), rejouée à sa connexion. */
  private readonly image = new Int16Array(256).fill(-1);
  private lastTick = 0;
  private flushQueued = false;
  private mutedFlag = false;
  /** Figé par `suspend()` (onglet masqué) : le contexte ne doit pas repartir avant `resume()`. */
  private suspended = false;
  /** Après `close()` : plus aucun contexte audio n'est créé (un geste tardif ne doit pas en rouvrir un). */
  private closed = false;

  beginTick(tick: number): void {
    this.buffer.beginTick(tick);
  }

  write(reg: number, value: number): void {
    this.buffer.write(reg, value);
    if (this.flushQueued) return;
    // Le moteur écrit de façon synchrone pendant un tick : un seul envoi à la fin, sans attendre le tick suivant.
    this.flushQueued = true;
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.flushQueued = false;
    const messages = this.buffer.take();
    if (this.node) {
      for (const message of messages) this.node.port.postMessage(message);
    } else {
      // Avant le premier geste : seul l'état final des registres compte, pas la suite des ticks.
      for (const message of messages) {
        this.lastTick = message.tick;
        for (const packed of message.writes) this.image[packed >> 8] = packed & 0xff;
      }
    }
  }

  private ensure(): AudioContext | null {
    if (this.closed) return null;
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.mutedFlag ? 0 : 1;
      this.master.connect(ctx.destination);
      if (this.suspended) void ctx.suspend();
      ctx.audioWorklet.addModule(workletUrl).then(
        () => {
          // Fermé entre-temps (jeu quitté pendant le chargement du worklet).
          if (this.ctx !== ctx) return;
          const node = new AudioWorkletNode(ctx, "armaeth-opl", { numberOfInputs: 0, outputChannelCount: [2] });
          node.connect(this.master!);
          this.node = node;
          this.replayImage(node);
        },
        (error) => console.warn("Musique AdLib indisponible", error),
      );
    }
    return this.ctx;
  }

  /** Envoie au worklet l'état des registres accumulé avant sa connexion, par numéro croissant. */
  private replayImage(node: AudioWorkletNode): void {
    const writes: number[] = [];
    for (let reg = 0; reg < 256; reg++) if (this.image[reg] >= 0) writes.push((reg << 8) | this.image[reg]);
    if (writes.length > 0) node.port.postMessage({ tick: this.lastTick, writes });
    this.image.fill(-1);
  }

  /** À appeler de façon synchrone dans un geste utilisateur : crée puis reprend le contexte. */
  unlock(): void {
    const ctx = this.ensure();
    if (ctx && !this.suspended && ctx.state === "suspended") void ctx.resume();
  }

  /** Coupe le son par le gain général : l'émulation continue, le timing reste identique. */
  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  suspend(): void {
    this.suspended = true;
    if (this.ctx?.state === "running") void this.ctx.suspend();
  }

  resume(): void {
    this.suspended = false;
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  /** Libère le contexte audio et le worklet (jeu quitté, page de dev redémarrée). Sans retour : plus aucun son ensuite. */
  close(): void {
    this.closed = true;
    const ctx = this.ctx;
    this.node?.port.close();
    this.node?.disconnect();
    this.master?.disconnect();
    this.node = null;
    this.master = null;
    this.ctx = null;
    this.image.fill(-1);
    if (ctx && ctx.state !== "closed") void ctx.close();
  }
}
