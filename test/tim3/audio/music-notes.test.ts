/**
 * Notes tenues : les 24 morceaux rejoués sans son sur un synthétiseur modèle, qui compte les voix comme `spessasynth` (chaque note-off
 * relâche la plus ancienne note-on de sa touche, la pédale CC64 retient les voix relâchées). À chaque fin de tour, fin de morceau,
 * arrêt ou changement de morceau, aucune note commencée avant ne doit rester active.
 */
import { describe, expect, it } from "vitest";
import { parseHmi } from "../../../src/audio/hmi";
import { musicFileName } from "../../../src/games/tim3/audio/ids";
import { Tim3Music, type GmPort } from "../../../src/games/tim3/audio/music";
import { baseIndex, original } from "../data/real";

/** Synthétiseur modèle : messages datés joués dans l'ordre de leur heure (ordre d'envoi à heure égale), voix comptées par touche. */
class ModelSynth implements GmPort {
  ready = true;
  clock = 0;
  private queue: { at: number; seq: number; message: number[] }[] = [];
  private seq = 0;
  /** Voix par canal et touche : heures de départ, de la plus ancienne à la plus récente. */
  private readonly voices = new Map<number, number[]>();
  /** Voix relâchées mais retenues par la pédale. */
  private readonly held = new Map<number, number[]>();
  private readonly sustain = new Array<boolean>(16).fill(false);
  /** Voix dont le relâché est arrivé avant la note-on (ordre inversé). */
  stray = 0;

  now(): number {
    return this.clock;
  }

  send(message: Uint8Array, at?: number): void {
    this.queue.push({ at: at ?? this.clock, seq: this.seq++, message: [...message] });
  }

  reset(): void {
    this.queue = [];
    this.voices.clear();
    this.held.clear();
    this.sustain.fill(false);
  }

  /** Joue les messages jusqu'à `t` compris. */
  advance(t: number): void {
    this.clock = Math.max(this.clock, t);
    this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    while (this.queue.length > 0 && this.queue[0].at <= t) this.apply(this.queue.shift()!);
  }

  private apply({ at, message: [status, a, b] }: { at: number; message: number[] }): void {
    const type = status & 0xf0;
    const channel = status & 0x0f;
    const key = (channel << 7) | a;
    if (type === 0x90 && b > 0) {
      const list = this.voices.get(key) ?? [];
      list.push(at);
      this.voices.set(key, list);
    } else if (type === 0x80 || type === 0x90) {
      const start = this.voices.get(key)?.shift();
      if (start === undefined) return;
      if (this.sustain[channel]) this.held.set(key, [...(this.held.get(key) ?? []), start]);
    } else if (type === 0xb0 && a === 64) {
      this.sustain[channel] = b >= 64;
      if (!this.sustain[channel]) for (const k of [...this.held.keys()]) if (k >> 7 === channel) this.held.delete(k);
    } else if (type === 0xb0 && (a === 123 || a === 120)) {
      for (const k of [...this.voices.keys()]) if (k >> 7 === channel) this.voices.delete(k);
    }
  }

  /** Voix encore actives commencées avant `t`. */
  soundingSince(t: number): string[] {
    const out: string[] = [];
    for (const map of [this.voices, this.held])
      for (const [k, starts] of map) for (const s of starts) if (s < t) out.push(`canal ${k >> 7} touche ${k & 0x7f} (depuis ${Math.round(s)} ms)`);
    return out;
  }

  get active(): number {
    let n = 0;
    for (const map of [this.voices, this.held]) for (const s of map.values()) n += s.length;
    return n;
  }
}

/** Joue `ms` millisecondes, une image toutes les 16 ms. */
function run(music: Tim3Music, synth: ModelSynth, ms: number): void {
  const end = synth.clock + ms;
  for (let t = synth.clock; ; t = Math.min(t + 16, end)) {
    synth.clock = t;
    music.tick();
    synth.advance(t);
    if (t >= end) break;
  }
}

describe.skipIf(!original.has)("musiques réelles : aucune note tenue", () => {
  const index = original.has ? baseIndex() : null;
  const songs = Array.from({ length: 24 }, (_, i) => 1000 + i);

  it.each(songs)("SX_%i : rien ne reste tenu après chaque tour, à la fin, à l'arrêt et au changement", (n) => {
    const synth = new ModelSynth();
    const music = new Tim3Music({ has: (name) => index!.has(name), get: (name) => index!.get(name) }, synth);
    const song = parseHmi(index!.get(musicFileName(n)));
    music.play(n);
    const start = 20; // `startDelayMs` du séquenceur
    if (song.loop) {
      const first = start + song.loop.endMs;
      const lap = song.loop.endMs - song.loop.startMs;
      for (let k = 0; k < 3; k++) {
        const wrap = first + k * lap;
        run(music, synth, wrap + 1 - synth.clock);
        expect(synth.soundingSince(wrap - 1), `tour ${k + 1}`).toEqual([]);
      }
    } else {
      run(music, synth, start + song.endMs + 50 - synth.clock);
      expect(music.playing).toBe(false);
      expect(synth.active, "fin du morceau").toBe(0);
    }
    // Changement de morceau en pleine lecture, puis arrêt.
    music.play(n === 1000 ? 1001 : 1000);
    synth.advance(synth.clock);
    expect(synth.soundingSince(synth.clock + 1), "changement").toEqual([]);
    run(music, synth, 3000);
    music.stop();
    run(music, synth, 500);
    expect(synth.active, "arrêt").toBe(0);
  });
});
