import { describe, expect, it } from "vitest";
import { OPL_LEAD_SECONDS, OplStream, OplWriteBuffer, type OplChip } from "../../src/games/armaeth/audio/opl-stream";

const RATE = 50_000; // un tick = 1000 échantillons, un bloc de 128 ne tombe pas pile sur un tick

/** Puce factice : chaque échantillon vaut la dernière valeur écrite (registre 0x10), les écritures sont journalisées avec leur position. */
class FakeChip implements OplChip {
  position = 0;
  level = 0;
  log: { reg: number; value: number; at: number }[] = [];
  writeReg(reg: number, value: number): void {
    this.log.push({ reg, value, at: this.position });
    if (reg === 0x10) this.level = value;
  }
  generate(buffer: Int16Array, offset: number, length: number): void {
    buffer.fill(this.level * 256, offset, offset + length);
    this.position += length;
  }
}

const pack = (reg: number, value: number) => (reg << 8) | value;
const LEAD = Math.round(RATE * OPL_LEAD_SECONDS); // 2000

function setup() {
  const chip = new FakeChip();
  return { chip, stream: new OplStream(RATE, chip) };
}

/** Rend `total` échantillons par blocs de `block`. */
function run(stream: OplStream, total: number, block = 128): Float32Array {
  const out = new Float32Array(total);
  for (let done = 0; done < total; done += block) stream.render(out.subarray(done, Math.min(total, done + block)));
  return out;
}

describe("OplWriteBuffer", () => {
  it("regroupe les écritures par tick, dans l'ordre", () => {
    const buffer = new OplWriteBuffer();
    buffer.beginTick(3);
    buffer.write(0x20, 1);
    buffer.write(0xb0, 0x31);
    buffer.beginTick(4);
    buffer.beginTick(5);
    buffer.write(0x40, 7);
    expect(buffer.take()).toEqual([
      { tick: 3, writes: [pack(0x20, 1), pack(0xb0, 0x31)] },
      { tick: 5, writes: [pack(0x40, 7)] },
    ]);
    expect(buffer.take()).toEqual([]);
  });

  it("écrit au tick 0 avant tout beginTick (initialisation)", () => {
    const buffer = new OplWriteBuffer();
    buffer.write(1, 0x20);
    expect(buffer.take()).toEqual([{ tick: 0, writes: [pack(1, 0x20)] }]);
  });
});

describe("OplStream", () => {
  it("la première écriture tombe après l'avance, à l'échantillon près, quel que soit le découpage en blocs", () => {
    for (const block of [1, 100, 128, 997]) {
      const { chip, stream } = setup();
      stream.schedule(7, [pack(0x10, 5)]);
      run(stream, 5000, block);
      expect(chip.log).toEqual([{ reg: 0x10, value: 5, at: LEAD }]);
    }
  });

  it("espace les ticks de 20 ms (1000 échantillons ici) et garde l'ordre dans un tick", () => {
    const { chip, stream } = setup();
    stream.schedule(10, [pack(0x10, 1), pack(0x11, 2)]);
    stream.schedule(11, [pack(0x10, 3)]);
    stream.schedule(13, [pack(0x10, 4)]);
    run(stream, 6000);
    expect(chip.log).toEqual([
      { reg: 0x10, value: 1, at: LEAD },
      { reg: 0x11, value: 2, at: LEAD },
      { reg: 0x10, value: 3, at: LEAD + 1000 },
      { reg: 0x10, value: 4, at: LEAD + 3000 },
    ]);
  });

  it("applique l'écriture avant l'échantillon de sa date (la sortie change exactement là)", () => {
    const { stream } = setup();
    stream.schedule(0, [pack(0x10, 64)]);
    const out = run(stream, LEAD + 10, 333);
    expect(out[LEAD - 1]).toBe(0);
    expect(out[LEAD]).toBe(64 * 256 / 32768);
  });

  it("des ticks livrés en retard sont recalés derrière la position de lecture, sans perdre d'écriture", () => {
    const { chip, stream } = setup();
    stream.schedule(0, [pack(0x10, 1)]);
    run(stream, 10_000);
    // le moteur a pris 100 ms de retard : le tick 1 est déjà dans le passé
    stream.schedule(1, [pack(0x10, 2)]);
    stream.schedule(2, [pack(0x10, 3)]);
    run(stream, 10_000);
    expect(chip.log.map((w) => [w.value, w.at])).toEqual([
      [1, LEAD],
      [2, 10_000 + LEAD],
      [3, 10_000 + LEAD + 1000],
    ]);
  });

  it("recale aussi quand les ticks arrivent bien trop en avance (reprise après une pause)", () => {
    const { chip, stream } = setup();
    stream.schedule(0, [pack(0x10, 1)]);
    run(stream, 3000);
    stream.schedule(500, [pack(0x10, 2)]); // 10 s plus loin
    expect(stream.pending).toBe(1);
    run(stream, 3000);
    expect(chip.log[1]).toEqual({ reg: 0x10, value: 2, at: 3000 + LEAD });
    expect(stream.pending).toBe(0);
  });

  it("clear oublie les écritures en attente et le calage", () => {
    const { chip, stream } = setup();
    stream.schedule(0, [pack(0x10, 1)]);
    stream.clear();
    run(stream, 3000);
    expect(chip.log).toEqual([]);
    stream.schedule(40, [pack(0x10, 9)]);
    run(stream, 3000);
    expect(chip.log).toEqual([{ reg: 0x10, value: 9, at: 3000 + LEAD }]);
  });
});
