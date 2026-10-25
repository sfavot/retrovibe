import { OplRecorder } from "../../src/games/armaeth/audio/opl-driver";
import type { ArmaethFrame, ArmaethHost, ArmaethStorage, HostInput, HostKey } from "../../src/games/armaeth/engine/host";
import { readOriginal } from "./helpers";

/** Sauvegardes en mémoire. */
export class MemoryStorage implements ArmaethStorage {
  readonly slots = new Map<string, Uint8Array>();

  read(slot: string): Uint8Array | null {
    return this.slots.get(slot)?.slice() ?? null;
  }

  write(slot: string, bytes: Uint8Array): void {
    this.slots.set(slot, bytes.slice());
  }
}

/**
 * Hôte de test : fichiers de `original/armaeth/`, horloge manuelle, écritures OPL enregistrées, dernière image présentée,
 * sauvegardes en mémoire et file d'entrées scriptée (`pollInput` vide la file à chaque tic).
 */
export class TestHost implements ArmaethHost {
  readonly opl = new OplRecorder();
  readonly storage = new MemoryStorage();
  /** Dernière image présentée (copie). */
  lastFrame: ArmaethFrame | null = null;
  presented = 0;
  quitCalls = 0;
  clock = 0;
  private readonly queue: HostInput[] = [];
  private readonly cache = new Map<string, Uint8Array>();

  readFile(name: string): Uint8Array {
    let bytes = this.cache.get(name);
    if (!bytes) this.cache.set(name, (bytes = readOriginal(name)));
    return bytes;
  }

  now(): number {
    return this.clock;
  }

  advance(ms: number): void {
    this.clock += ms;
  }

  present(frame: ArmaethFrame): void {
    this.presented++;
    this.lastFrame = { pixels: frame.pixels.slice(), palette: frame.palette.slice() };
  }

  pollInput(): readonly HostInput[] {
    return this.queue.splice(0);
  }

  quit(): void {
    this.quitCalls++;
  }

  // --- entrées scriptées -----------------------------------------------------------------------------------------------------

  push(...inputs: HostInput[]): void {
    this.queue.push(...inputs);
  }

  key(key: HostKey): void {
    this.queue.push({ type: "key", key });
  }

  /** Caractères tapés ; `\r` Entrée, `\x1b` Échap, `\b` Retour arrière. */
  type(text: string): void {
    for (const char of text) this.key({ type: "char", char });
  }

  /** Position et boutons de la souris (1 gauche, 2 droit). */
  pointer(x: number, y: number, buttons = 0, ctrl = false): void {
    this.queue.push({ type: "pointer", x, y, buttons, ctrl });
  }
}
