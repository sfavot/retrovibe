import { describe, expect, it } from "vitest";
import { parseSong } from "../../../src/audio/smf";
import { readAdLibBank, readRolandBank, readSongBank, smfLayout } from "../../../src/games/fotaq/data/music";
import { hasOriginalFiles, readOriginal } from "../helpers";

/** SMF de format 0 : une piste, des notes simples puis la fin de piste. */
function smf(noteCount: number, options: { declaredExtra?: number; stub?: boolean } = {}): number[] {
  const track: number[] = [];
  for (let i = 0; i < noteCount; i++) track.push(0x10, 0x90, 60 + i, 100);
  track.push(0x00, 0xff, 0x2f, 0x00);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96];
  const length = track.length + (options.declaredExtra ?? 0);
  const chunk = [0x4d, 0x54, 0x72, 0x6b, (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff, ...track];
  const stub = [...header, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0x21, 0xc0];
  return options.stub ? [...stub, ...header, ...chunk] : [...header, ...chunk];
}

/** Compresse un SMF comme `AQ.RL` : dictionnaire de 256 mots de 16 bits, un indice par mot ; `skipFirst` pour `c`. */
function compress(data: number[], skipFirst: boolean): number[] {
  const padded = skipFirst ? [0, ...data] : [...data];
  if (padded.length % 2) padded.push(0);
  const dictionary: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < padded.length; i += 2) {
    const word = (padded[i] << 8) | padded[i + 1];
    let index = dictionary.indexOf(word);
    if (index < 0) {
      index = dictionary.length;
      dictionary.push(word);
    }
    indices.push(index);
  }
  expect(dictionary.length).toBeLessThanOrEqual(256);
  const table: number[] = [];
  for (let i = 0; i < 256; i++) {
    const word = dictionary[i] ?? 0;
    // Les mots du dictionnaire sont lus comme des mots petit-boutistes : octet bas d'abord.
    table.push((word >> 8) & 0xff, word & 0xff);
  }
  return [skipFirst ? 0x63 : 0x43, ...table, ...indices];
}

/** Table de morceaux : compte, entrées (bas, haut), 2 octets d'information, morceaux. */
function bank(songs: number[][]): Uint8Array {
  const tableEnd = 2 + songs.length * 4;
  const offsets: number[] = [];
  let position = tableEnd + 2;
  for (const song of songs) {
    offsets.push(position);
    position += song.length;
  }
  const out: number[] = [songs.length & 0xff, songs.length >> 8];
  for (const offset of offsets) out.push(offset & 0xf, 0, (offset >> 4) & 0xff, (offset >> 12) & 0xff);
  out.push(0x80, 0, ...songs.flat());
  // L'offset est (haut << 4) | bas avec deux mots petit-boutistes : on a posé bas = offset & 0xF, haut = offset >> 4.
  return Uint8Array.from(out);
}

describe("readSongBank (données synthétiques)", () => {
  const plain = smf(3);
  const stubbed = smf(2, { stub: true });
  const truncated = smf(4, { declaredExtra: 500 });

  it("lit une table de morceaux directs, compressés (C et c), avec souche et tronqués", () => {
    const songBank = readSongBank(bank([plain, compress(smf(5), false), compress(smf(6), true), stubbed, truncated]));
    expect(songBank.songs.map((song) => song.compression)).toEqual(["none", "dictionary", "dictionarySkipFirst", "none", "none"]);
    expect(songBank.songs.map((song) => song.defect)).toEqual([null, null, null, "stubPrefix", "truncated"]);
    expect(songBank.info).toEqual(Uint8Array.of(0x80, 0));
    expect(Array.from(songBank.songs[0].smf)).toEqual(plain);
    expect(Array.from(songBank.songs[1].smf.subarray(0, smf(5).length))).toEqual(smf(5));
    expect(Array.from(songBank.songs[2].smf.subarray(0, smf(6).length))).toEqual(smf(6));
    // La souche de 22 octets est retirée : il reste exactement le SMF correct.
    expect(Array.from(songBank.songs[3].smf)).toEqual(smf(2));
    for (const song of songBank.songs.slice(0, 4)) expect(song.layout.complete).toBe(true);
    expect(songBank.songs[4].layout).toMatchObject({ complete: false, tracks: [{ declared: expect.any(Number), available: expect.any(Number) }] });
  });

  it("décode les décalages (haut << 4) | bas", () => {
    // Un morceau placé au-delà de 64 Ko tient dans le segment haut ; ici un morceau de 70 000 octets les sépare.
    const big = smf(1);
    const filler = [...big, ...new Array(70_000).fill(0)];
    const songBank = readSongBank(bank([filler, plain]));
    expect(songBank.songs[0].offset).toBe(2 + 2 * 4 + 2);
    expect(songBank.songs[1].offset).toBe(songBank.songs[0].offset + filler.length);
    expect(Array.from(songBank.songs[1].smf)).toEqual(plain);
  });

  it("refuse une table vide, un morceau dans la table, et un SMF sans MThd", () => {
    expect(() => readSongBank(Uint8Array.of(0, 0))).toThrow(/invalide/);
    const bad = bank([plain]);
    bad[2] = 1;
    expect(() => readSongBank(bad)).toThrow(/invalide/);
    expect(() => readSongBank(bank([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]]))).toThrow(/MThd/);
  });

  it("garde les deux lecteurs (Roland, AdLib) sur le même format", () => {
    const bytes = bank([plain]);
    expect(readRolandBank(bytes).songs).toHaveLength(1);
    expect(readAdLibBank(bytes).songs).toHaveLength(1);
  });
});

describe("smfLayout (données synthétiques)", () => {
  it("donne le format, la division et la longueur de la piste, déclarée et présente", () => {
    expect(smfLayout(Uint8Array.from(smf(2)))).toMatchObject({ format: 0, trackCount: 1, division: 96, complete: true, trailing: 0 });
    const cut = Uint8Array.from(smf(2, { declaredExtra: 100 }));
    const layout = smfLayout(cut);
    expect(layout.complete).toBe(false);
    expect(layout.tracks[0].declared - layout.tracks[0].available).toBe(100);
  });
});

describe.skipIf(!hasOriginalFiles)("musique du jeu", () => {
  const roland = readRolandBank(readOriginal("AQ.RL"));
  const adlib = readAdLibBank(readOriginal("AQBANK.MUS"));

  it("compte 106 morceaux dans AQ.RL (14 compressés) et 102 dans AQBANK.MUS (44 compressés)", () => {
    expect(roland.songs).toHaveLength(106);
    expect(adlib.songs).toHaveLength(102);
    expect(roland.songs.filter((song) => song.compression !== "none")).toHaveLength(14);
    expect(adlib.songs.filter((song) => song.compression !== "none")).toHaveLength(44);
    expect(roland.songs.filter((song) => song.compression === "dictionarySkipFirst")).toHaveLength(6);
  });

  it("place le premier morceau juste après la table et deux octets d'information (80 00)", () => {
    expect(roland.songs[0].offset).toBe(2 + 106 * 4 + 2);
    expect(adlib.songs[0].offset).toBe(2 + 102 * 4 + 2);
    expect(Array.from(roland.info)).toEqual([0x80, 0]);
    expect(Array.from(adlib.info)).toEqual([0x80, 0]);
  });

  it("range les morceaux contigus, jusqu'à la fin du fichier", () => {
    for (const [songBank, name] of [[roland, "AQ.RL"], [adlib, "AQBANK.MUS"]] as const) {
      const size = readOriginal(name).length;
      let position = songBank.songs[0].offset;
      for (const song of songBank.songs) {
        expect(song.offset, `${name} ${song.index}`).toBe(position);
        position += song.length;
      }
      expect(position, name).toBe(size);
    }
  });

  it("donne un SMF valide à 105 morceaux sur 106 d'AQ.RL et aux 102 d'AQBANK.MUS", () => {
    const invalid: number[] = [];
    for (const song of roland.songs) {
      try {
        parseSong(song.smf);
      } catch {
        invalid.push(song.index);
      }
    }
    expect(invalid).toEqual([88]);
    for (const song of adlib.songs) expect(() => parseSong(song.smf), `AdLib ${song.index}`).not.toThrow();
  });

  it("explique les morceaux 48 et 88 d'AQ.RL : le 48 a une souche de 22 octets, le 88 est coupé à 5 120 octets", () => {
    const defects = roland.songs.filter((song) => song.defect);
    expect(defects.map((song) => [song.index, song.defect])).toEqual([
      [48, "stubPrefix"],
      [88, "truncated"],
    ]);
    // Le 48 : une souche (MThd + MTrk annonçant 8 640 octets) précède un SMF complet de 2 922 octets.
    const raw48 = readOriginal("AQ.RL").subarray(roland.songs[48].offset, roland.songs[48].offset + roland.songs[48].length);
    expect(raw48.length).toBe(2944);
    expect(String.fromCharCode(...raw48.subarray(22, 26))).toBe("MThd");
    expect(new DataView(raw48.buffer, raw48.byteOffset + 18, 4).getUint32(0, false)).toBe(8640);
    expect(roland.songs[48].smf).toHaveLength(2922);
    expect(roland.songs[48].layout).toMatchObject({ complete: true, trackCount: 1, trailing: 0 });
    expect(parseSong(roland.songs[48].smf).endMs).toBeGreaterThan(0);
    // Le 88 : 5 120 octets stockés, piste annoncée à 6 396 octets, 5 098 présents.
    const truncated = roland.songs[88];
    expect(truncated.length).toBe(5120);
    expect(truncated.layout.tracks[0]).toMatchObject({ declared: 6396, available: 5098 });
    expect(() => parseSong(truncated.smf)).toThrow(/tronquée/);
  });

  it("n'a aucun défaut dans la version AdLib, en une piste et à 420 ticks par noire", () => {
    for (const song of adlib.songs) {
      expect(song.defect, `AdLib ${song.index}`).toBeNull();
      expect(song.layout, `AdLib ${song.index}`).toMatchObject({ format: 0, trackCount: 1, division: 420, complete: true });
    }
  });

  it("annonce dans AQBANK.MUS une piste dont la longueur omet la fin de piste finale (00 FF 2F 00)", () => {
    for (const song of adlib.songs) {
      const tail = song.smf.subarray(song.smf.length - song.layout.trailing, song.smf.length);
      expect(Array.from(tail.subarray(0, 4)), `AdLib ${song.index}`).toEqual([0x00, 0xff, 0x2f, 0x00]);
    }
  });

  it("place les instruments AdLib dans les morceaux : le premier événement est un méta « spécifique » FF 7F", () => {
    for (const song of adlib.songs) {
      expect(Array.from(song.smf.subarray(22, 25)), `AdLib ${song.index}`).toEqual([0x00, 0xff, 0x7f]);
    }
  });

  it("en AQ.RL, un seul morceau a plusieurs pistes (7 pistes, format 1) ; les autres sont en format 0", () => {
    const multi = roland.songs.filter((song) => song.layout.trackCount > 1);
    expect(multi).toHaveLength(1);
    expect(multi[0].layout).toMatchObject({ format: 1, trackCount: 7, complete: true });
    expect(roland.songs.filter((song) => song.layout.format === 0)).toHaveLength(105);
  });

  it("donne des durées plausibles : jamais plus de dix minutes (le morceau 0 est un silence de quelques millisecondes)", () => {
    for (const song of [...roland.songs.filter((s) => s.index !== 88), ...adlib.songs]) {
      const { endMs } = parseSong(song.smf);
      expect(endMs, `morceau ${song.index}`).toBeGreaterThanOrEqual(0);
      expect(endMs, `morceau ${song.index}`).toBeLessThan(10 * 60 * 1000);
    }
  });
});
