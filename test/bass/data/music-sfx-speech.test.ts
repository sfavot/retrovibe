import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SPEECH_SECTION_BASE, musicFile, sfxFile } from "../../../src/games/bass/data/ids";
import { MusicFile, NON_LOOPING_SONG_COUNT, isNonLoopingSong, scanChannel } from "../../../src/games/bass/data/music-file";
import { SFX_MAX_RATE, SfxFile } from "../../../src/games/bass/data/sfx-file";
import { speechFileOfText, voicePath, voicePathOfText } from "../../../src/games/bass/data/speech";
import { hasOriginalFiles, skyDisk } from "./helpers";

const SONGS_PER_SECTION = [2, 4, 4, 3, 11, 6, 1];
const SFX_PER_SECTION = [2, 26, 26, 26, 29, 27, 26];

describe("scanChannel", () => {
  it("lit delta, notes, voix OPL, arguments des opcodes 0x9x et s'arrête sur 0x91", () => {
    // delta 0 voix 3 ; delta 0x81 0x00 (=128) note 0x30 vél 0x40 ; delta 1 instrument 5 ; delta 0 point de boucle ; delta 2 arrêt
    const data = Uint8Array.of(0, 0x83, 0x81, 0x00, 0x30, 0x40, 1, 0x92, 5, 0, 0x9c, 2, 0x91, 0xaa);
    const r = scanChannel(data, 0);
    expect(r).toEqual({ end: "stop", endOffset: 13, events: 5, duration: 131, loopPoint: 11 });
  });

  it("s'arrête sur la boucle 0x98, refuse un opcode inconnu, un delta trop long et un flux tronqué", () => {
    expect(scanChannel(Uint8Array.of(0, 0x99, 0, 0x98), 0).end).toBe("loop");
    expect(() => scanChannel(Uint8Array.of(0, 0x94), 0)).toThrow(/inconnu/);
    expect(() => scanChannel(Uint8Array.of(0, 0x9d), 0)).toThrow(/inconnu/);
    expect(() => scanChannel(Uint8Array.of(0x80, 0x80, 0x80, 0x80, 0x00, 0x91), 0)).toThrow(/delta/);
    expect(() => scanChannel(Uint8Array.of(0, 0x30), 0)).toThrow(/fin de fichier/);
  });
});

describe("morceaux sans boucle", () => {
  it("en compte 13", () => {
    expect(NON_LOOPING_SONG_COUNT).toBe(13);
    expect(isNonLoopingSong(4, 11)).toBe(true);
    expect(isNonLoopingSong(4, 4)).toBe(false);
    expect(isNonLoopingSong(3, 1)).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("fichiers de musique AdLib (vrais fichiers)", () => {
  const files = SONGS_PER_SECTION.map((_, s) => new MusicFile(skyDisk().load(musicFile(s))));

  it("les 7 fichiers se lisent, avec les morceaux annoncés", () => {
    expect(files.map((f) => f.songCount)).toEqual(SONGS_PER_SECTION);
    expect(files.every((f) => f.musicDataLoc === 0x1207)).toBe(true);
    expect(files.reduce((n, f) => n + f.songCount, 0)).toBe(31);
  });

  it("chaque morceau a 7 à 10 canaux et chaque flux va jusqu'à sa marque de fin", () => {
    for (const [s, f] of files.entries()) {
      for (const song of f.songs()) {
        expect(song.channelOffsets.length, `section ${s} morceau ${song.number}`).toBeGreaterThanOrEqual(7);
        expect(song.channelOffsets.length).toBeLessThanOrEqual(10);
        expect(song.tempo0).toBeGreaterThan(0);
        for (const offset of song.channelOffsets) {
          const scan = f.scan(offset);
          expect(scan.endOffset).toBeLessThanOrEqual(f.data.length);
          expect(scan.events).toBeGreaterThan(0);
        }
      }
    }
  });

  it("la séquence d'initialisation se termine par 00 00 et les tables tiennent dans le fichier", () => {
    for (const f of files) {
      expect(f.initSequence().length).toBeGreaterThan(0);
      expect(f.frequencyTable()).toHaveLength(0x300);
      expect(f.outputLevelTable).toHaveLength(0x81);
      expect(f.registerMirror).toHaveLength(0x100);
      expect(f.instrumentMap).toHaveLength(0x80);
      expect(f.instrument(0).bindedEffect).toBeTypeOf("number");
    }
  });
});

describe.skipIf(!hasOriginalFiles)("fichiers d'effets sonores (vrais fichiers)", () => {
  const files = SFX_PER_SECTION.map((_, s) => new SfxFile(skyDisk().load(sfxFile(s))));

  it("signatures valides et nombres de sons attendus", () => {
    expect(files.map((f) => f.soundsTotal)).toEqual(SFX_PER_SECTION);
  });

  it("chaque échantillon tient dans le fichier, taux plafonnés à 11 025, boucle dans l'échantillon", () => {
    for (const f of files) {
      for (let n = 0; n < f.soundsTotal; n++) {
        const s = f.sound(n);
        expect(s.rate).toBeGreaterThan(0);
        expect(s.rate).toBeLessThanOrEqual(SFX_MAX_RATE);
        expect(s.offset + s.size).toBeLessThanOrEqual(f.data.length);
        expect(s.loop).toBeLessThanOrEqual(s.size);
        expect(f.sample(n)).toHaveLength(s.size);
      }
    }
  });

  it("refuse un rang hors table", () => {
    expect(() => files[0]!.sample(2)).toThrow(RangeError);
  });
});

describe("voix", () => {
  it("convertit un numéro de texte en fichier puis en chemin", () => {
    expect(speechFileOfText(0)).toBe(50000);
    expect(speechFileOfText(7)).toBe(50007);
    expect(speechFileOfText((1 << 12) | 5)).toBe(50000 + SPEECH_SECTION_BASE[1] + 5);
    expect(speechFileOfText((7 << 12) | 10)).toBe(50000 + 5230 + 10);
    expect(voicePath(50007)).toBe("voices/50007.mp3");
    expect(voicePathOfText((2 << 12) | 3)).toBe("voices/51103.mp3");
    expect(speechFileOfText(8 << 12)).toBeUndefined();
    expect(voicePathOfText(0xf000)).toBeUndefined();
    expect(() => voicePath(100)).toThrow(RangeError);
  });

  const dir = "original/bass/voices";
  it.skipIf(!existsSync(dir))("tous les MP3 du dossier correspondent à un numéro de texte de section 0 à 7", () => {
    const names = readdirSync(dir).filter((n) => n.endsWith(".mp3"));
    expect(names.length).toBeGreaterThan(3000);
    const bases = [...SPEECH_SECTION_BASE.map((b) => 50000 + b), 55278];
    for (const name of names) {
      const id = Number(name.slice(0, -4));
      expect(voicePath(id)).toBe(`voices/${name}`);
      expect(id).toBeGreaterThanOrEqual(50000);
      expect(id).toBeLessThan(bases[bases.length - 1]!);
      // Le rang dans la section retrouve le même fichier.
      const section = bases.findIndex((b, i) => id >= b && id < bases[i + 1]!);
      expect(speechFileOfText((section << 12) | (id - bases[section]!))).toBe(id);
    }
  });
});
