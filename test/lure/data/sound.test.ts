import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSong } from "../../../src/audio/smf";
import { Coverage } from "../../../src/games/lure/data/cursor";
import { classifyResources } from "../../../src/games/lure/data/catalog";
import {
  ADLIB_SECTION_IDS,
  decompressSound,
  normalizeMidiFile,
  parseSequencerMeta,
  parseSoundSection,
  readSoundSections,
  soundDescTarget,
  songSequencerMetas,
} from "../../../src/games/lure/data/sound";
import { hasOriginalFiles, lureResources } from "./helpers";
import { lureData } from "./catalog-helper";

const u32 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24];

/** SMF minimal : une piste « note on / note off », longueur de piste sans l'événement de fin (comme les sons du jeu). */
const MIDI = [
  ...[..."MThd"].map((c) => c.charCodeAt(0)), 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x60,
  ...[..."MTrk"].map((c) => c.charCodeAt(0)), 0, 0, 0, 8, 0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0, 0x00, 0xff, 0x2f, 0x00,
];

/** Compresse (dictionnaire de 256 mots, un indice par paire d'octets) : le dictionnaire ne contient que les mots utiles. */
function compress(data: number[], marker: string): number[] {
  const words = new Map<string, number>();
  const dictionary = new Array<number>(512).fill(0);
  const indices: number[] = [];
  for (let i = 0; i < data.length; i += 2) {
    const key = `${data[i]},${data[i + 1] ?? 0}`;
    if (!words.has(key)) {
      const slot = words.size;
      words.set(key, slot);
      dictionary[slot * 2] = data[i]!;
      dictionary[slot * 2 + 1] = data[i + 1] ?? 0;
    }
    indices.push(words.get(key)!);
  }
  return [marker.charCodeAt(0), ...dictionary, ...indices];
}

/** Section à `sounds.length` sons contigus. */
function section(sounds: number[][]): Uint8Array {
  const headerSize = 2 + sounds.length * 4 + 2;
  const offsets: number[] = [];
  let at = headerSize;
  for (const s of sounds) {
    offsets.push(at);
    at += s.length;
  }
  return Uint8Array.from([sounds.length, 0, ...offsets.flatMap(u32), 0x80, 0x00, ...sounds.flat()]);
}

describe("sons (données synthétiques)", () => {
  it("laisse un son non compressé tel quel", () => {
    const { data, compression } = decompressSound(Uint8Array.from(MIDI));
    expect(compression).toBe("none");
    expect(data).toEqual(Uint8Array.from(MIDI));
  });

  it("décompresse 'C' (tout le flux) et 'c' (le premier octet est un remplissage)", () => {
    const stored = compress(MIDI, "C");
    expect(decompressSound(Uint8Array.from(stored))).toEqual({ data: Uint8Array.from(MIDI), compression: "C" });
    // longueur impaire avec le remplissage : le dernier mot est complété par un zéro
    const padded = compress([0, ...MIDI], "c");
    const { data, compression } = decompressSound(Uint8Array.from(padded));
    expect(compression).toBe("c");
    expect(data).toEqual(Uint8Array.from([...MIDI, 0]));
    expect(() => decompressSound(Uint8Array.from([0x43, 1, 2, 3]))).toThrow("dictionnaire");
  });

  it("corrige la longueur de piste qui omet la fin de piste et compte le remplissage", () => {
    const midi = normalizeMidiFile(Uint8Array.from([...MIDI, 0]))!;
    expect(midi.trailing).toBe(1);
    expect(midi.smf.length).toBe(MIDI.length);
    expect(midi.smf[MIDI.indexOf(8, 18)]).toBe(8 + 4);
    const song = parseSong(midi.smf);
    expect(song.events.at(-1)?.kind).toBe("end");
    expect(song.endTick).toBe(0x60);
    expect(normalizeMidiFile(Uint8Array.from([...MIDI.slice(0, -4)]))).toBeUndefined();
    expect(normalizeMidiFile(Uint8Array.from([1, 2, 3]))).toBeUndefined();
  });

  it("découpe une section et marque tous ses octets lus", () => {
    const bytes = section([MIDI, compress([0, ...MIDI], "c"), MIDI]);
    const coverage = new Coverage(bytes.length);
    const parsed = parseSoundSection(bytes, coverage);
    expect(parsed.sounds.map((s) => s.compression)).toEqual(["none", "c", "none"]);
    expect(parsed.sounds[1]!.smf).toEqual(parsed.sounds[0]!.smf);
    expect(parsed.sounds.map((s) => s.trailing)).toEqual([0, 1, 0]);
    expect(coverage.unread()).toEqual([]);
  });

  it("refuse une section mal formée", () => {
    const good = section([MIDI, MIDI]);
    const bad = (edit: (b: Uint8Array) => void) => {
      const copy = Uint8Array.from(good);
      edit(copy);
      return () => parseSoundSection(copy);
    };
    expect(bad((b) => (b[1] = 1))).toThrow("second octet");
    expect(bad((b) => (b[2 + 8] = 0))).toThrow("marque");
    expect(bad((b) => (b[2] += 1))).toThrow("position inattendue");
    expect(bad((b) => (b[b.length - 1] = 5))).toThrow("MIDI invalide");
    expect(() => parseSoundSection(good.subarray(0, 1))).toThrow("trop courte");
  });

  it("décode les méta-événements FF 7F", () => {
    const head = [0, 0, 0x3f, 0];
    const definition = Array.from({ length: 28 }, (_, i) => i);
    const instrument = parseSequencerMeta(Uint8Array.from([...head, 1, 5, ...definition]));
    expect(instrument).toEqual({ kind: "instrument", channel: 5, definition: Uint8Array.from(definition) });
    expect(parseSequencerMeta(Uint8Array.from([...head, 2, 0]))).toEqual({ kind: "rhythm", on: false });
    expect(parseSequencerMeta(Uint8Array.from([...head, 3, 12]))).toEqual({ kind: "pitchBendSensitivity", semitones: 12 });
    expect(() => parseSequencerMeta(Uint8Array.from([...head, 4, 0]))).toThrow("type 4");
    expect(() => parseSequencerMeta(Uint8Array.from([...head, 1, 5, 1, 2]))).toThrow("instrument de");
    expect(() => parseSequencerMeta(Uint8Array.from([...head, 1, 16, ...definition]))).toThrow("canal");
    expect(() => parseSequencerMeta(Uint8Array.from([1, 0, 0x3f, 0, 3, 1]))).toThrow("signature");
  });

  it("sépare le numéro de son et la boucle d'une description", () => {
    expect(soundDescTarget({ soundNumber: 138 })).toEqual({ index: 10, loop: true });
    expect(soundDescTarget({ soundNumber: 53 })).toEqual({ index: 53, loop: false });
  });
});

describe.skipIf(!hasOriginalFiles)("sections de sons d'origine", () => {
  const sections = () => readSoundSections(lureResources());

  it("compte les sons de chaque section et la compression", () => {
    const s = sections();
    expect(s.main.sounds).toHaveLength(73);
    expect(s.intro.sounds).toHaveLength(4);
    expect(s.ending.sounds).toHaveLength(1);
    const compressed = (name: keyof typeof s) => s[name].sounds.filter((x) => x.compression !== "none").map((x) => `${x.index}${x.compression}`);
    expect(compressed("main")).toEqual(["1c", "25c", "59c", "60c"]);
    expect(compressed("intro")).toEqual(["2C"]);
    expect(compressed("ending")).toEqual([]);
  });

  it("lit chaque section jusqu'au dernier octet", () => {
    for (const id of Object.values(ADLIB_SECTION_IDS)) {
      const bytes = lureResources().get(id);
      const coverage = new Coverage(bytes.length);
      parseSoundSection(bytes, coverage);
      expect(coverage.unread()).toEqual([]);
    }
  });

  it("donne pour chaque son un SMF valide dont les FF 7F sont de type 1, 2 ou 3", () => {
    let instruments = 0;
    for (const sound of Object.values(sections()).flatMap((s) => s.sounds)) {
      const song = parseSong(sound.smf);
      expect(song.format).toBe(0);
      expect(song.events.at(-1)?.kind).toBe("end");
      expect(sound.trailing).toBeLessThanOrEqual(1);
      const metas = songSequencerMetas(song);
      expect(metas.filter((m) => m.kind === "pitchBendSensitivity")).toHaveLength(1);
      expect(metas.filter((m) => m.kind === "rhythm" && m.on)).toEqual([]);
      instruments += metas.filter((m) => m.kind === "instrument").length;
    }
    expect(instruments).toBe(214 + 101 + 59);
  });

  it("donne les mêmes octets décompressés que ScummVM (sha-1 de la suite des sons, comparée à sound.cpp compilé hors dépôt)", () => {
    const sha = (name: keyof ReturnType<typeof sections>) => {
      const hash = createHash("sha1");
      for (const sound of sections()[name].sounds) hash.update(decompressSound(sound.stored).data);
      return hash.digest("hex");
    };
    expect(sha("main")).toBe("bd6f032f633ce960a57259f083ea47691e2b91be");
    expect(sha("intro")).toBe("a43bef049043144eba6c0451ea7bf9781b3257d7");
    expect(sha("ending")).toBe("4eb79c5bf5a7820885b7aa46c1973a9a116e0ea3");
  });

  it("met les 53 descriptions 0x3F18 en relation avec des sons de la section principale", () => {
    const d = lureData();
    const main = sections().main;
    expect(d.soundDescs).toHaveLength(53);
    const targets = d.soundDescs.map(soundDescTarget);
    for (const t of targets) expect(t.index).toBeLessThan(main.sounds.length);
    expect(targets.filter((t) => t.loop)).toHaveLength(12);
    expect(new Set(targets.map((t) => t.index)).size).toBe(47);
  });

  it("retrouve les trois sections AdLib du catalogue", () => {
    const d = lureData();
    const ids = classifyResources(d.resources, d.rooms, d.anims).filter((e) => e.kind === "sound-adlib").map((e) => e.id);
    expect(ids.sort((a, b) => a - b)).toEqual(Object.values(ADLIB_SECTION_IDS).sort((a, b) => a - b));
  });
});
