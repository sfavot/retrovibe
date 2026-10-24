import { describe, expect, it } from "vitest";
import { extractMidi, isMidi, parseMidi } from "../../src/games/mathemagique/data/midi";
import { MohawkArchive, TAG_SND, TAG_SNDL, TAG_STRL } from "../../src/games/mathemagique/data/mohawk";
import { parseSndl } from "../../src/games/mathemagique/data/sndl";
import { parseStrl } from "../../src/games/mathemagique/data/strl";
import { isWave, parseWave, waveDuration, waveToFloat32 } from "../../src/games/mathemagique/data/wave";
import { archivePaths, hasOriginalFiles, readOriginal } from "./helpers";

const text = (s: string) => [...new TextEncoder().encode(s)];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];

function wave(samples: number[], extra: number[] = []): Uint8Array {
  const data = [...be16(11025), ...be32(samples.length), 8, 1, ...be16(0), ...be16(0), ...be32(0), ...be32(0), ...samples, ...extra];
  const body = [...text("WAVE"), ...text("Data"), ...be32(data.length), ...data];
  return Uint8Array.from([...text("MHWK"), ...be32(body.length), ...body]);
}

describe("parseWave (données synthétiques)", () => {
  it("lit l'entête, les échantillons et convertit en flottants", () => {
    const parsed = parseWave(wave([0x00, 0x80, 0xff]));
    expect(parsed).toMatchObject({ sampleRate: 11025, bitsPerSample: 8, channels: 1, encoding: 0, loopCount: 0 });
    expect([...parsed.samples]).toEqual([0, 0x80, 0xff]);
    expect([...waveToFloat32(parsed)]).toEqual([-1, 0, 127 / 128]);
    expect(waveDuration(parsed)).toBeCloseTo(3 / 11025);
  });

  it("ignore l'octet d'échantillon en trop déclaré par la taille du bloc", () => {
    expect(parseWave(wave([1, 2, 3], [9])).samples).toHaveLength(3);
  });

  it("lit les points de repère Cue# (nom complété à une longueur paire)", () => {
    const cue = [...be16(2), ...be32(5), 3, ...text("beg"), ...be32(9), 2, ...text("ab"), 0];
    const d = wave([1, 2]);
    const withCue = Uint8Array.from([...d.subarray(0, 12), ...text("Cue#"), ...be32(cue.length), ...cue, ...d.subarray(12)]);
    expect(parseWave(withCue).cues).toEqual([
      { sampleFrame: 5, name: "beg" },
      { sampleFrame: 9, name: "ab" },
    ]);
  });

  it("refuse un codage non pris en charge et une signature invalide", () => {
    const adpcm = wave([1, 2]);
    adpcm[12 + 8 + 9] = 1; // encodage u16 à l'offset 8 de Data
    expect(() => parseWave(adpcm)).toThrow(/codage 1/);
    expect(() => parseWave(new Uint8Array(40))).toThrow(/MHWK/);
  });
});

describe("parseMidi, parseStrl, parseSndl (données synthétiques)", () => {
  it("extrait le SMF et ignore Prg# et le bourrage", () => {
    const mthd = [...text("MThd"), ...be32(6), 0, 1, 0, 1, 1, 0xe0];
    const mtrk = [...text("MTrk"), ...be32(4), 0, 0xff, 0x2f, 0];
    const prg = [...text("Prg#"), ...be32(2), 0, 0];
    const bytes = Uint8Array.from([...text("MHWK"), ...be32(0), ...text("MIDI"), ...mthd, ...prg, ...mtrk, 0, 0, 0, 0]);
    expect(isMidi(bytes)).toBe(true);
    expect(isWave(bytes)).toBe(false);
    expect([...extractMidi(bytes)]).toEqual([...mthd, ...mtrk]);
    expect([...parseMidi(bytes).programs]).toEqual([0, 0]);
  });

  it("lit une STRL (compte u8, chaînes à NUL, bourrage ignoré)", () => {
    expect(parseStrl(Uint8Array.from([2, ...text("a b"), 0, ...text("c"), 0, 0xaa, 0xbb]))).toEqual(["a b", "c"]);
    expect(() => parseStrl(Uint8Array.from([3, ...text("a"), 0]))).toThrow(/STRL/);
  });

  it("lit une SNDL little-endian", () => {
    expect(parseSndl(Uint8Array.from([2, 0, 0xdc, 0x37, 0x01, 0x10, 0xff, 0xff]))).toEqual([0x37dc, 0x1001]);
    expect(() => parseSndl(Uint8Array.from([5, 0, 1, 0]))).toThrow(/SNDL/);
  });
});

describe.skipIf(!hasOriginalFiles)("sons du jeu", () => {
  const archives = archivePaths().map((path) => ({ path, archive: MohawkArchive.parse(readOriginal(path)) }));
  const sounds = archives.flatMap(({ path, archive }) =>
    archive.ids(TAG_SND).map((id) => ({ path, id, bytes: archive.get(TAG_SND, id) })),
  );

  it("sépare 1381 sons WAVE et 66 MIDI, sans autre type", () => {
    expect(sounds.filter((s) => isWave(s.bytes))).toHaveLength(1381);
    expect(sounds.filter((s) => isMidi(s.bytes))).toHaveLength(66);
    expect(sounds).toHaveLength(1381 + 66);
  });

  it("décode tous les WAVE : PCM 8 bits mono, 11025 Hz sauf un à 22050 Hz", () => {
    const rates = new Map<number, number>();
    let seconds = 0;
    for (const { path, id, bytes } of sounds.filter((s) => isWave(s.bytes))) {
      const w = parseWave(bytes);
      expect([w.bitsPerSample, w.channels, w.encoding], `${path} ${id}`).toEqual([8, 1, 0]);
      expect(w.samples.length, `${path} ${id}`).toBeGreaterThan(0);
      rates.set(w.sampleRate, (rates.get(w.sampleRate) ?? 0) + 1);
      seconds += waveDuration(w);
    }
    expect([...rates].sort((a, b) => a[0] - b[0])).toEqual([
      [11025, 1380],
      [22050, 1],
    ]);
    expect(seconds).toBeCloseTo(2830.9, 0);
  });

  it("décode un son précis (BOWLING.DAT, 22050 Hz) et la musique bouclée de TITLE.DAT", () => {
    const bowling = parseWave(archives.find((a) => a.path === "BOWLING.DAT")!.archive.get(TAG_SND, 14423));
    expect(bowling.sampleRate).toBe(22050);
    const title = parseWave(archives.find((a) => a.path === "TITLE.DAT")!.archive.get(TAG_SND, 1000));
    expect(title.sampleRate).toBe(11025);
    expect(title.samples).toHaveLength(192294);
    expect([title.loopCount, title.loopStart, title.loopEnd]).toEqual([1, 0, 192289]);
  });

  it("extrait des fichiers MIDI valides (MThd format 0 + un MTrk)", () => {
    for (const { path, id, bytes } of sounds.filter((s) => isMidi(s.bytes))) {
      const smf = extractMidi(bytes);
      const view = new DataView(smf.buffer, smf.byteOffset, smf.byteLength);
      expect(String.fromCharCode(...smf.subarray(0, 4)), `${path} ${id}`).toBe("MThd");
      expect(view.getUint32(4)).toBe(6);
      expect(view.getUint16(8)).toBe(0);
      expect(view.getUint16(10)).toBe(1);
      expect(String.fromCharCode(...smf.subarray(14, 18))).toBe("MTrk");
      expect(smf.length).toBe(14 + 8 + view.getUint32(18));
    }
    expect(archives.find((a) => a.path === "MIDIMPC.DAT")!.archive.count(TAG_SND)).toBe(45);
  });

  it("lit les STRL (TROPHY.DAT 5000, PATFILL.DAT 40000, BOWLING.DAT 1001)", () => {
    const get = (path: string, id: number) => parseStrl(archives.find((a) => a.path === path)!.archive.get(TAG_STRL, id));
    const trophy = get("TROPHY.DAT", 5000);
    expect(trophy).toHaveLength(25);
    expect(trophy[0]).toBe("Rookie Roller");
    expect(trophy[1]).toBe("Ball Polisher");
    expect(get("PATFILL.DAT", 40000).slice(0, 3)).toEqual(["Checker", "Triangles", "Crosses"]);
    expect(get("BOWLING.DAT", 1001)).toEqual(["seconds", "minutes", "hours", "days", "months", "years"]);
  });

  it("lit toutes les STRL en ASCII imprimable", () => {
    for (const { path, archive } of archives) {
      for (const id of archive.ids(TAG_STRL)) {
        for (const s of parseStrl(archive.get(TAG_STRL, id))) expect(s, `${path} ${id}`).toMatch(/^[\x20-\x7e]*$/);
      }
    }
  });

  it("lit les SNDL : un SNDL par écran, ids de sons de la même archive (hors 11 listes)", () => {
    let lists = 0;
    let missing = 0;
    for (const { archive } of archives) {
      for (const id of archive.ids(TAG_SNDL)) {
        lists++;
        if (!parseSndl(archive.get(TAG_SNDL, id)).every((snd) => archive.has(TAG_SND, snd))) missing++;
      }
    }
    expect(lists).toBe(725);
    expect(missing).toBe(11);
  });
});
