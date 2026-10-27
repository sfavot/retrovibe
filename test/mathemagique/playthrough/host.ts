import type { PcmSound, WaveHandle } from "../../../src/engine/mohawk/audio/sink";
import type { Frame } from "../../../src/games/mathemagique/engine/graphics/frame";
import type { CursorKind } from "../../../src/games/mathemagique/engine/host";
import { FakeAudio, FakeMidi, TestHost } from "../engine-test-host";

/** MIDI factice qui ne garde rien en mémoire (un robot joue des heures de musique) : il compte. */
export class CountingMidi extends FakeMidi {
  noteOns = 0;
  sent = 0;
  /** Appelé pour chaque note jouée (note-on de vélocité > 0). */
  onNoteOn: (() => void) | null = null;

  override send(message: Uint8Array): void {
    this.sent++;
    if ((message[0]! & 0xf0) === 0x90 && message[2]! > 0) {
      this.noteOns++;
      this.onNoteOn?.();
    }
  }
}

/** Puits audio factice qui sait combien de WAVE sont ouverts (lancés, ni arrêtés ni finis) et combien tournent en boucle. */
export class CountingAudio extends FakeAudio {
  override readonly midi = new CountingMidi();
  private readonly open = new Map<WaveHandle, { loop: boolean; at: number; sound: PcmSound }>();
  started = 0;
  stoppedCount = 0;
  /** Arrêts d'un handle qui n'a jamais été lancé. */
  badStops = 0;
  private maxHandle = 0;

  override playWave(sound: PcmSound, loop: boolean): WaveHandle {
    const handle = super.playWave(sound, loop);
    this.started++;
    this.maxHandle = Math.max(this.maxHandle, handle);
    this.open.set(handle, { loop, at: this.now(), sound });
    // `waves` du parent garderait tous les sons : on ne garde pas d'historique.
    this.waves.length = 0;
    this.stopped.length = 0;
    return handle;
  }

  override stopWave(handle: WaveHandle): void {
    if (handle < 1 || handle > this.maxHandle) this.badStops++;
    this.open.delete(handle);
    this.stoppedCount++;
    super.stopWave(handle);
    this.stopped.length = 0;
  }

  /** Handles ouverts qui sortent encore du son (les finis sont purgés au passage). */
  liveWaves(): { handle: WaveHandle; loop: boolean; ageMs: number }[] {
    const live: { handle: WaveHandle; loop: boolean; ageMs: number }[] = [];
    for (const [handle, info] of this.open) {
      if (this.isWavePlaying(handle)) live.push({ handle, loop: info.loop, ageMs: this.now() - info.at });
    }
    return live;
  }

  /** Handles jamais arrêtés et dont le son est fini : le moteur les oublie sans `stopWave` (pas une fuite en soi, un compteur). */
  get openCount(): number {
    return this.open.size;
  }

  /** Purge les sons non bouclés finis (le navigateur libère le nœud à la fin du son). */
  purgeFinished(): void {
    for (const [handle, info] of this.open) {
      if (!info.loop && !this.isWavePlaying(handle)) this.open.delete(handle);
    }
  }
}

export interface FrameStats {
  /** Tous les pixels ont le même indice. */
  uniform: boolean;
  /** Somme des octets de la palette présentée. */
  paletteSum: number;
  /** Instant (ms simulées) de la présentation. */
  at: number;
}

/**
 * Hôte du robot : comme `TestHost` mais sans accumuler les images (249 Ko chacune) ni les curseurs ; il garde les statistiques de la
 * dernière image présentée et la dernière image elle-même.
 */
export class RobotHost extends TestHost {
  override readonly audio = new CountingAudio(() => this.time);
  presented = 0;
  lastStats: FrameStats | null = null;
  lastPixels: Uint8Array | null = null;
  lastPalette: Uint8Array | null = null;
  private lastCursor: CursorKind | undefined;

  override present(frame: Frame): void {
    this.presented++;
    const first = frame.pixels[0]!;
    let uniform = true;
    for (let i = 1; i < frame.pixels.length; i++) {
      if (frame.pixels[i] !== first) {
        uniform = false;
        break;
      }
    }
    let paletteSum = 0;
    for (let i = 0; i < frame.palette.length; i++) paletteSum += frame.palette[i]!;
    this.lastStats = { uniform, paletteSum, at: this.time };
    this.lastPixels ??= new Uint8Array(frame.pixels.length);
    this.lastPixels.set(frame.pixels);
    this.lastPalette ??= new Uint8Array(frame.palette.length);
    this.lastPalette.set(frame.palette);
  }

  override setCursor(cursor: CursorKind): void {
    this.lastCursor = cursor;
  }

  override get cursor(): CursorKind | undefined {
    return this.lastCursor;
  }
}
