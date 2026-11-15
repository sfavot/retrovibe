import { describe, expect, it } from "vitest";
import { Opl2 } from "../../src/audio/opl2";
import { OplStream, OplWriteBuffer, type OplSink } from "../../src/audio/opl-stream";
import { ADL_TICKS_PER_SECOND } from "../../src/engine/coktel/audio/adlib/adl-player";
import { OplAdlibOutput } from "../../src/engine/coktel/audio/adlib/output";
import { hasOriginalFiles } from "../ween/helpers";
import { weenAdls } from "../ween/audio/adl-trace";

/**
 * Musique AdLib des jeux Coktel sur la sortie OPL commune : aucune note ne reste tenue après un arrêt, une fin naturelle,
 * un chargement ou un déchargement pendant la lecture (AdLib::end → reset : allOff puis initOPL, `sound/adlib.cpp`).
 */

/** Puce qui garde la dernière valeur de chaque registre. */
class RegisterMirror implements OplSink {
  readonly regs = new Uint8Array(256);
  write(reg: number, value: number): void {
    this.regs[reg] = value;
  }
  /** Voix encore « key on » : mélodiques (bit 5 de 0xB0-0xB8) et percussions (bits 0-4 de 0xBD). */
  held(): string[] {
    const held: string[] = [];
    for (let v = 0; v < 9; v++) if (this.regs[0xb0 + v] & 0x20) held.push(`voix ${v}`);
    if (this.regs[0xbd] & 0x1f) held.push(`percussions 0x${(this.regs[0xbd] & 0x1f).toString(16)}`);
    return held;
  }
}

/** Morceau : `mode` 0 = mélodique, sinon percussions ; une note tenue sur chaque voix de `voices`, puis une longue attente sans coupure. */
function heldSong(mode: number, voices: number[], endMarker = true): Uint8Array {
  const timbre = new Uint16Array(28);
  // attaque rapide, son tenu (sustaining), relâchement nul : sans coupure, la note durerait toujours
  const op = (level: number) => [0, 1, 0, 15, 0, 1, 0, 0, level, 0, 0, 0, 1];
  timbre.set([...op(20), ...op(0)], 0);
  const song = [0x00];
  for (const v of voices) song.push(0x00 | v, 60, 127, 0); // note sur la voix v, sans délai
  song.push(0xb0, 127, 0x80 | 0x03, 0xff); // volume de la voix 0, puis 1 023 ticks d'attente
  if (endMarker) song.push(0xff);
  const bytes = new Uint8Array(3 + 56 + song.length);
  bytes.set([mode, 0, 0]);
  bytes.set(new Uint8Array(timbre.buffer), 3);
  bytes.set(song, 59);
  return bytes;
}

function setup() {
  const chip = new RegisterMirror();
  let ms = 0;
  const out = new OplAdlibOutput(chip, () => ms);
  let stopped = 0;
  out.onStopped = () => stopped++;
  return {
    chip,
    out,
    advance(dt: number) {
      ms += dt;
      out.update();
    },
    stopped: () => stopped,
  };
}

const CASES = [
  { name: "mélodique", mode: 0, voices: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  { name: "percussions", mode: 1, voices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
];

describe.each(CASES)("OplAdlibOutput, morceau $name : aucune note tenue", ({ mode, voices }) => {
  it("pendant la lecture, les notes sont bien tenues (le contrôle voit quelque chose)", () => {
    const { chip, out, advance } = setup();
    out.load(heldSong(mode, voices));
    out.play();
    advance(100);
    expect(chip.held().length).toBeGreaterThan(0);
  });

  it("après un arrêt", () => {
    const { chip, out, advance, stopped } = setup();
    out.load(heldSong(mode, voices));
    out.setRepeating(-1);
    out.play();
    advance(500);
    out.stop();
    expect(chip.held()).toEqual([]);
    expect(out.playing).toBe(false);
    advance(5000);
    expect(chip.held()).toEqual([]);
    expect(stopped()).toBe(0); // arrêt demandé : pas de fin signalée (comme `_playing` remis par stopPlay)
  });

  it("après la fin naturelle (marqueur 0xFF ou fin des données), signalée une fois", () => {
    for (const endMarker of [true, false]) {
      const { chip, out, advance, stopped } = setup();
      out.load(heldSong(mode, voices, endMarker));
      out.play();
      advance(500);
      expect(chip.held().length).toBeGreaterThan(0);
      advance(1000);
      expect(out.playing).toBe(false);
      expect(stopped()).toBe(1);
      expect(chip.held()).toEqual([]);
    }
  });

  it("entre deux passages d'une répétition, puis à la fin", () => {
    const { chip, out, advance, stopped } = setup();
    out.load(heldSong(mode, voices));
    out.setRepeating(1);
    out.play();
    advance(900);
    // tick par tick jusqu'au second passage : la fin du premier coupe tout avant la reprise
    const silentTicks: number[] = [];
    for (let t = 900; t < 1100; t++) {
      advance(1);
      if (chip.held().length === 0) silentTicks.push(t);
    }
    expect(silentTicks.length).toBeGreaterThan(0);
    expect(out.playing).toBe(true);
    expect(chip.held().length).toBeGreaterThan(0); // second passage en cours
    advance(1100);
    expect(stopped()).toBe(1);
    expect(chip.held()).toEqual([]);
  });

  it("après un chargement ou un déchargement pendant la lecture", () => {
    for (const change of ["load", "unload"] as const) {
      const { chip, out, advance, stopped } = setup();
      out.load(heldSong(mode, voices));
      out.setRepeating(-1);
      out.play();
      advance(300);
      if (change === "load") out.load(heldSong(0, [0, 1]));
      else out.unload();
      expect(chip.held(), change).toEqual([]);
      advance(3000);
      expect(chip.held(), change).toEqual([]);
      expect(out.playing).toBe(false);
      expect(stopped()).toBe(0);
    }
  });
});

describe("OplAdlibOutput sur la sortie du navigateur (OplStream + Opl2)", () => {
  it("le son s'éteint après l'arrêt, même avec des images irrégulières", () => {
    const RATE = 48_000;
    const stream = new OplStream(RATE, new Opl2(RATE), ADL_TICKS_PER_SECOND);
    const buffer = new OplWriteBuffer();
    const sink: OplSink = {
      beginTick: (tick) => buffer.beginTick(tick),
      write: (reg, value) => buffer.write(reg, value),
    };
    const flush = () => {
      for (const m of buffer.take()) stream.schedule(m.tick, m.writes);
    };
    let ms = 0;
    const out = new OplAdlibOutput(sink, () => ms);
    out.load(heldSong(1, [0, 1, 2, 6, 7, 8, 9, 10]));
    out.setRepeating(-1);
    out.play();
    const rms = (buf: Float32Array) => Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    // une image de 16 à 40 ms, puis le même temps de son
    const frame = (dt: number): Float32Array => {
      ms += dt;
      out.update();
      flush();
      const buf = new Float32Array((dt * RATE) / 1000);
      stream.render(buf);
      return buf;
    };
    let playing = 0;
    for (let i = 0; i < 40; i++) playing += rms(frame([16, 40, 17, 25][i % 4]));
    expect(playing).toBeGreaterThan(0);
    out.stop();
    flush();
    for (let i = 0; i < 300; i++) frame(20); // 6 s : les notes coupées s'éteignent (relâchement du piano par défaut)
    expect(rms(frame(1000))).toBe(0);
  });
});

describe.skipIf(!hasOriginalFiles)("OplAdlibOutput, musiques de Ween : aucune note tenue", () => {
  const adls = hasOriginalFiles ? weenAdls() : [];

  it.each([0, 1, 2, 3, 4, 5])("morceau %i : arrêt, chargement et déchargement à plusieurs moments, fin naturelle", (i) => {
    for (const at of [1_000, 7_777, 15_000]) {
      for (const change of ["stop", "load", "unload"] as const) {
        const { chip, out, advance } = setup();
        out.load(adls[i]);
        out.setRepeating(-1);
        out.play();
        advance(at);
        if (change === "stop") out.stop();
        else if (change === "load") out.load(adls[(i + 1) % adls.length]);
        else out.unload();
        expect(chip.held(), `${change} à ${at} ms`).toEqual([]);
      }
    }
    const { chip, out, advance, stopped } = setup();
    out.load(adls[i]);
    out.play();
    while (out.playing) advance(1000);
    expect(stopped()).toBe(1);
    expect(chip.held()).toEqual([]);
  });
});
