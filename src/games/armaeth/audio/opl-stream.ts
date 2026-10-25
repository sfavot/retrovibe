/**
 * Partie pure de la sortie OPL2 navigateur : horodatage des écritures par tick du séquenceur (50 Hz) et rendu à
 * l'échantillon près. Elle tourne telle quelle dans l'AudioWorklet (`opl-worklet.ts`) et dans les tests ; `web-opl.ts`
 * n'en garde que la colle Web Audio.
 */

/** Puce OPL2 (l'émulateur de Lost in Time, `Opl2`, la satisfait). */
export interface OplChip {
  writeReg(reg: number, value: number): void;
  /** Rend `length` échantillons 16 bits mono dans `buffer` à partir de `offset`. */
  generate(buffer: Int16Array, offset: number, length: number): void;
}

/** Cadence du pilote musical (IRQ0) : un tick toutes les 20 ms, quelle que soit la cadence des images du moteur. */
export const OPL_TICK_RATE = 50;

/** Avance gardée entre la position de lecture et la première écriture d'une séquence (absorbe la gigue du fil principal). */
export const OPL_LEAD_SECONDS = 0.04;

/** Au-delà de cette avance, les ticks reçus ne sont plus à leur place (reprise après une pause) : on recale. */
export const OPL_MAX_LEAD_SECONDS = 0.5;

/** Message du fil principal vers le worklet : écritures d'un tick, chacune empaquetée `(registre << 8) | valeur`. */
export interface OplMessage {
  tick: number;
  writes: number[];
}

/** Regroupe les écritures reçues entre deux envois, par tick. */
export class OplWriteBuffer {
  private tick = 0;
  private messages: OplMessage[] = [];
  private current: OplMessage | null = null;

  beginTick(tick: number): void {
    this.tick = tick;
    this.current = null;
  }

  write(reg: number, value: number): void {
    if (!this.current) {
      this.current = { tick: this.tick, writes: [] };
      this.messages.push(this.current);
    }
    this.current.writes.push(((reg & 0xff) << 8) | (value & 0xff));
  }

  /** Messages accumulés depuis le dernier appel (vide s'il n'y en a pas). */
  take(): OplMessage[] {
    const messages = this.messages;
    this.messages = [];
    this.current = null;
    return messages;
  }
}

interface Pending {
  at: number;
  packed: number;
}

/**
 * File d'écritures datées en échantillons et rendu mono flottant. Le tick `n` tombe à l'échantillon
 * `base + round(n * fréquence / 50)` : la première séquence fixe `base` pour qu'elle sonne `OPL_LEAD_SECONDS` après
 * la position de lecture ; si le moteur prend du retard (écriture déjà passée) ou de l'avance (au-delà de
 * `OPL_MAX_LEAD_SECONDS`), `base` est recalé de la même façon.
 */
export class OplStream {
  private readonly queue: Pending[] = [];
  private head = 0;
  private base: number | null = null;
  private readonly scratch = new Int16Array(128);
  private readonly lead: number;
  private readonly maxLead: number;
  /** Nombre d'échantillons rendus depuis le début (ou le dernier `reset`). */
  position = 0;

  constructor(
    readonly sampleRate: number,
    private readonly chip: OplChip,
  ) {
    this.lead = Math.round(sampleRate * OPL_LEAD_SECONDS);
    this.maxLead = Math.round(sampleRate * OPL_MAX_LEAD_SECONDS);
  }

  /** Échantillon (relatif à `base`) du début du tick `tick`. */
  private tickSample(tick: number): number {
    return Math.round((tick * this.sampleRate) / OPL_TICK_RATE);
  }

  /** Échantillon absolu où tombent les écritures du tick `tick` (recale `base` au besoin). */
  private placeTick(tick: number): number {
    const rel = this.tickSample(tick);
    let at = this.base === null ? -1 : this.base + rel;
    if (this.base === null || at < this.position || at > this.position + this.maxLead) {
      this.base = this.position + this.lead - rel;
      at = this.position + this.lead;
    }
    return at;
  }

  /** Programme les écritures (`(registre << 8) | valeur`) d'un tick. */
  schedule(tick: number, writes: ArrayLike<number>): void {
    const at = this.placeTick(tick);
    // Insertion stable : un recalage peut ramener `at` avant des écritures déjà en attente.
    let index = this.queue.length;
    while (index > this.head && this.queue[index - 1].at > at) index--;
    const items: Pending[] = [];
    for (let i = 0; i < writes.length; i++) items.push({ at, packed: writes[i] });
    this.queue.splice(index, 0, ...items);
  }

  /** Écritures encore en attente. */
  get pending(): number {
    return this.queue.length - this.head;
  }

  /** Rend `length` échantillons dans `out` : chaque écriture est appliquée juste avant l'échantillon de sa date. */
  render(out: Float32Array, offset = 0, length = out.length - offset): void {
    let done = 0;
    while (done < length) {
      let n = length - done;
      const next = this.queue[this.head];
      if (next) {
        const wait = next.at - this.position;
        if (wait <= 0) {
          this.chip.writeReg(next.packed >> 8, next.packed & 0xff);
          this.head++;
          continue;
        }
        n = Math.min(n, wait);
      }
      n = Math.min(n, this.scratch.length);
      this.chip.generate(this.scratch, 0, n);
      for (let i = 0; i < n; i++) out[offset + done + i] = this.scratch[i] / 32768;
      done += n;
      this.position += n;
    }
    if (this.head > 256 && this.head * 2 > this.queue.length) {
      this.queue.splice(0, this.head);
      this.head = 0;
    }
  }

  /** Oublie les écritures en attente et le calage (la puce, elle, garde son état). */
  clear(): void {
    this.queue.length = 0;
    this.head = 0;
    this.base = null;
  }
}
