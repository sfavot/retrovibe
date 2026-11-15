import { describe, expect, it } from "vitest";
import { Tim3Music, type GmPort } from "../../../src/games/tim3/audio/music";
import { musicFileName } from "../../../src/games/tim3/audio/ids";
import { baseIndex, original } from "../data/real";

/** Piste HMI synthétique : en-tête de 0x57 + 4 octets, évènements à `dataOffset`. */
function track(events: number[]): number[] {
  const head = new Array(0x60).fill(0);
  [..."HMI-MIDITRACK"].forEach((c, i) => (head[i] = c.charCodeAt(0)));
  head[0x57] = 0x60;
  return [...head, ...events, 0x00, 0xff, 0x2f, 0x00];
}

function hmi(tracks: number[][]): Uint8Array {
  const table = 0x172;
  const first = table + 4 * tracks.length;
  const out = new Uint8Array(first + tracks.reduce((n, t) => n + t.length, 0));
  [..."HMI-MIDISONG061595"].forEach((c, i) => (out[i] = c.charCodeAt(0)));
  const view = new DataView(out.buffer);
  view.setUint16(0xd4, 120, true);
  view.setUint32(0xe4, tracks.length, true);
  view.setUint32(0xe8, table, true);
  let at = first;
  tracks.forEach((t, i) => {
    view.setUint32(table + 4 * i, at, true);
    out.set(t, at);
    at += t.length;
  });
  return out;
}

/** Une note à 0 tick (durée 16), boucle de 0 à 120 ticks (1 s), puis 1 note avant la fin de piste. */
const LOOPING = hmi([track([0x00, 0xfe, 0x14, 0xff, 0xff, 0x00, 0x90, 0x40, 0x7f, 0x10, 0x78, 0xfe, 0x15, 0x80, 0x01, 0x6e, 0, 0, 0])]);
const PLAIN = hmi([track([0x00, 0x90, 0x41, 0x7f, 0x10, 0x78, 0xb0, 0x07, 0x64])]);

function rig(files: Record<string, Uint8Array>, ready = true) {
  const sent: { message: number[]; at?: number }[] = [];
  const state = { ready, resets: 0, now: 0 };
  const port: GmPort = {
    get ready() {
      return state.ready;
    },
    now: () => state.now,
    send: (message, at) => sent.push({ message: [...message], at }),
    reset: () => {
      state.resets++;
    },
  };
  const music = new Tim3Music({ has: (n) => n in files, get: (n) => files[n] }, port);
  return { music, sent, state };
}

const noteOns = (sent: { message: number[] }[]) => sent.filter((m) => m.message[0] === 0x90 && m.message[2] > 0);

describe("Tim3Music", () => {
  it("joue le morceau demandé sur le synthétiseur, notes datées sur l'horloge audio", () => {
    const { music, sent } = rig({ [musicFileName(1000)]: LOOPING });
    music.play(1000);
    expect(music.current).toBe(1000);
    expect(music.playing).toBe(true);
    expect(noteOns(sent).map((m) => m.message[1])).toEqual([0x40]);
  });

  it("boucle sur les marqueurs du fichier (une note par tour)", () => {
    const { music, sent, state } = rig({ [musicFileName(1000)]: LOOPING });
    music.play(1000);
    for (let t = 0; t <= 3500; t += 50) {
      state.now = t;
      music.tick();
    }
    expect(noteOns(sent).length).toBeGreaterThanOrEqual(3);
    expect(music.playing).toBe(true);
  });

  it("joue une fois un morceau sans boucle puis s'arrête", () => {
    const { music, sent, state } = rig({ [musicFileName(1022)]: PLAIN });
    music.play(1022);
    for (let t = 0; t <= 3000; t += 50) {
      state.now = t;
      music.tick();
    }
    expect(noteOns(sent)).toHaveLength(1);
    expect(music.playing).toBe(false);
  });

  it("ne relance pas le morceau courant, change de morceau et coupe net à l'arrêt", () => {
    const { music, sent, state } = rig({ [musicFileName(1000)]: LOOPING, [musicFileName(1001)]: PLAIN });
    music.play(1000);
    const resets = state.resets;
    music.play(1000);
    expect(state.resets).toBe(resets);
    expect(noteOns(sent)).toHaveLength(1);
    music.play(1001);
    expect(state.resets).toBeGreaterThan(resets);
    expect(music.current).toBe(1001);
    expect(noteOns(sent).map((m) => m.message[1])).toEqual([0x40, 0x41]);
    const before = state.resets;
    music.stop();
    expect(state.resets).toBeGreaterThan(before);
    expect(music.current).toBe(0);
    expect(music.playing).toBe(false);
  });

  it("0, un numéro hors plage ou un fichier absent n'est pas une musique", () => {
    const { music, sent } = rig({ [musicFileName(1000)]: LOOPING });
    music.play(1000);
    music.play(0);
    expect(music.current).toBe(0);
    music.play(999);
    music.play(1005);
    expect(music.current).toBe(0);
    expect(sent.filter((m) => m.message[0] === 0x90).length).toBe(1);
  });

  it("attend que le synthétiseur soit prêt", () => {
    const { music, sent, state } = rig({ [musicFileName(1000)]: LOOPING }, false);
    music.play(1000);
    expect(music.playing).toBe(true);
    expect(sent).toHaveLength(0);
    music.tick();
    expect(sent).toHaveLength(0);
    state.ready = true;
    music.tick();
    expect(noteOns(sent)).toHaveLength(1);
  });
});

describe.skipIf(!original.has)("musiques réelles", () => {
  it("les 24 morceaux démarrent sur le synthétiseur ; 23 bouclent", () => {
    const index = baseIndex();
    let looping = 0;
    for (let n = 1000; n <= 1023; n++) {
      const { music, sent, state } = rig({ [musicFileName(n)]: index.get(musicFileName(n)) });
      music.play(n);
      state.now = 200;
      music.tick();
      expect(sent.length, `SX_${n}`).toBeGreaterThan(0);
      // 200 s de plus : joue encore s'il boucle
      for (let t = 400; t <= 200_000; t += 1000) {
        state.now = t;
        music.tick();
      }
      if (music.playing) looping++;
    }
    expect(looping).toBe(23);
  });
});
