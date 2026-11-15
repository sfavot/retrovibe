import { describe, expect, it } from "vitest";
import { findNote } from "../../../src/games/croisiere/audio/adlib-driver";
import { CroisiereSound, SOUND_STATE_SIZE } from "../../../src/games/croisiere/audio/sound";
import { ADL_SIZE } from "../../../src/games/croisiere/data/music";
import { LogSink } from "./log-sink";

const MODULE_HEADER = 2400;

/** Instrument mélodique : un opérateur de 13 mots (keyScaling, multiplicateur, feedback, attaque, sustain, tenue, déclin, relâche, niveau, AM, vibrato, enveloppe, connexion). */
function adl(options: { mode?: number; channel?: number; amDepth?: number; level?: number } = {}): Uint8Array {
  const out = new Uint8Array(ADL_SIZE);
  out[0] = options.mode ?? 0;
  out[1] = options.channel ?? 0;
  out[4] = options.amDepth ?? 0;
  const view = new DataView(out.buffer);
  for (const base of [6, 32]) {
    [1, 2, 3, 4, 5, 1, 6, 7, options.level ?? 20, 0, 0, 0, 0].forEach((w, i) => view.setUint16(base + 2 * i, w, true));
  }
  return out;
}

/** Module à `orders` ordres sur `patterns` motifs ; tempo 180 : eventsDelay 6, donc une ligne tous les 7 ticks. `events` : [motif, ligne, voix, période, instrument]. */
function module(events: [number, number, number, number, number][], orders = [0], patterns = 1, tempo = 180): Uint8Array {
  const out = new Uint8Array(MODULE_HEADER + patterns * 1024);
  out[0] = 80;
  out.set(Array.from("TEST.H32", (c) => c.charCodeAt(0)), 20);
  out[470] = orders.length;
  out[471] = tempo;
  out.set(orders, 472);
  for (const [pattern, row, voice, freq, instrument] of events) {
    const at = MODULE_HEADER + pattern * 1024 + row * 16 + voice * 4;
    out.set([freq >> 8, freq & 0xff, instrument << 4, 0], at);
  }
  return out;
}

function setup(mod: Uint8Array, instrument = adl()) {
  const sink = new LogSink();
  const files: Record<string, Uint8Array> = { SONG: mod, "TEST.ADL": instrument };
  const sound = new CroisiereSound(sink, (name) => files[name]);
  return { sink, sound, files };
}

const regs = (sink: LogSink, reg: number) => sink.writes.filter((w) => w.reg === reg);

describe("pilote AdLib", () => {
  it("écrit la séquence d'initialisation de la carte à la construction", () => {
    const { sink } = setup(module([]));
    expect(sink.writes.slice(0, 3).map((w) => [w.reg, w.value])).toEqual([[0xbd, 0x20], [0x08, 0x40], [0xb0, 0]]);
    expect(sink.writes.slice(-2).map((w) => [w.reg, w.value])).toEqual([[1, 0x20], [1, 0]]);
    // 2 + 9 + 9 + 5 * 18 + 2
    expect(sink.writes).toHaveLength(112);
  });

  it("retrouve la note d'une période (première période <= fréquence)", () => {
    expect(findNote(0x6a6)).toEqual({ note: 2, octave: 1 });
    expect(findNote(0xeee)).toEqual({ note: 0, octave: 0 });
    expect(findNote(0x10000)).toEqual({ note: 0, octave: 0 });
    expect(findNote(1)).toEqual({ note: 11, octave: 7 });
  });
});

describe("lecteur de modules", () => {
  it("programme le timbre puis déclenche la note, une ligne tous les eventsDelay + 1 ticks", () => {
    const { sink, sound } = setup(module([[0, 0, 0, 0x6a6, 1], [0, 1, 0, 0x6a6, 0]]));
    expect(sound.loadSong("song")).toBe(0);
    sound.playSong();
    sound.tick(6);
    expect(sink.writes.filter((w) => w.tick >= 0)).toHaveLength(0);
    sound.tick(1); // 7e tick : première ligne (compteur > 6)
    const first = sink.writes.filter((w) => w.tick === 6);
    expect(first.map((w) => w.reg)).toContain(0xb0);
    // période 0x6A6 : note 14, F-number 0x181, octave 1, déclenchement mélodique
    expect(regs(sink, 0xa0).at(-1)!.value).toBe(0x81);
    expect(regs(sink, 0xb0).at(-1)!.value).toBe(0x20 | (1 << 2) | 1);
    // volume 80 -> 100 -> *192/128 = 150 plafonné à 127 : niveau de sortie du porteur
    expect(regs(sink, 0x43).at(-1)!.value).toBe((63 - Math.trunc((2 * (63 - 20) * 127 + 127) / 254)) | (1 << 6)); // | keyScaling << 6
    sound.tick(7); // ligne 1 : période 0x6A6, instrument inchangé
    expect(sink.writes.filter((w) => w.tick === 13 && w.reg === 0xb0).length).toBe(2); // arrêt puis note
  });

  it("fait le fondu en 50 lignes puis arrête, décharge et pose songPlayed", () => {
    const { sink, sound } = setup(module([[0, 0, 0, 0x6a6, 1]]));
    sound.loadSong("SONG");
    expect(sound.songPlayed()).toBe(false);
    sound.playSong();
    sound.tick(10);
    sound.fadeSong();
    expect(sound.isPlaying).toBe(false);
    let ticks = 0;
    while (!sound.songPlayed()) {
      sound.tick();
      ticks++;
      expect(ticks).toBeLessThan(1000);
    }
    // prochaine ligne 4 ticks après le fondu (ligne au tick 6, fondu au tick 10), puis 49 lignes de 7 ticks (la 50e porte le compteur de 1 à 101)
    expect(ticks).toBe(4 + 49 * 7);
    expect(sound.songLoaded).toBe(false);
    expect(sound.songExist("song")).toBe(true);
    const writes = sink.writes.length;
    sound.playSong(); // déjà joué : ne relance pas
    sound.tick(20);
    expect(sink.writes).toHaveLength(writes);
  });

  it("LoadSong pendant un fondu en attend la fin et rend les ticks consommés", () => {
    const { sound } = setup(module([[0, 0, 0, 0x6a6, 1]]));
    sound.loadSong("SONG");
    sound.playSong();
    sound.fadeSong();
    const waited = sound.loadSong("SONG");
    expect(waited).toBeGreaterThan(250);
    expect(sound.ticks).toBe(waited);
    expect(sound.songLoaded).toBe(true);
    expect(sound.songPlayed()).toBe(false);
  });

  it("boucle sur les ordres, et SongSize prend effet au PlaySong suivant", () => {
    const { sink, sound } = setup(module([[0, 0, 0, 0x6a6, 1], [1, 0, 0, 0x6a6, 1]], [0, 1], 2));
    sound.loadSong("SONG");
    expect(sound.songSize(() => 1)).toBe(2);
    expect(sound.songSize(() => 200)).toBe(1); // hors 1..127 : inchangé
    sound.playSong();
    sound.tick(7 * 64 * 2 + 1);
    // un seul ordre : le motif 0 revient toutes les 64 lignes (ticks 6 et 454), jamais le motif 1
    expect(sink.writes.filter((w) => w.reg === 0xa0 && w.tick >= 0)).toHaveLength(2);
    expect(sound.songSize(() => 99)).toBe(1);
    const noModule = setup(module([]));
    expect(noModule.sound.songSize(() => 5)).toBe(0);
  });

  it("SetPattern modifie la table d'ordre, SongLoop rend l'ancienne valeur, SongExist compare le nom en majuscules", () => {
    const { sound } = setup(module([], [0], 2));
    sound.setPattern(0, 1); // sans module : ignoré
    sound.loadSong("song");
    sound.setPattern(0, 1);
    expect(sound.songLoop(true)).toBe(false);
    expect(sound.songLoop(false)).toBe(true);
    expect(sound.songExist("SONG")).toBe(true);
    expect(sound.songExist("autre")).toBe(false);
    expect(sound.songExist(null)).toBe(false);
  });

  it("SetVolume garde 63 - valeur et rend l'ancien >> 2", () => {
    const { sound } = setup(module([]));
    expect(sound.setVolume(10)).toBe(0);
    expect(sound.setVolume(99)).toBe(53 >> 2);
    expect(sound.setVolume(-1)).toBe(0);
  });

  it("un module introuvable laisse la place nette, StopSong et PlaySong sont sans effet", () => {
    const { sound } = setup(module([]));
    sound.loadSong("ABSENT");
    expect(sound.songLoaded).toBe(false);
    sound.playSong();
    sound.stopSong();
    expect(sound.isPlaying).toBe(false);
    expect(sound.songExist("absent")).toBe(true);
  });

  it("FreeSong décharge et rend songPlayed vrai", () => {
    const { sound } = setup(module([[0, 0, 0, 0x6a6, 1]]));
    sound.loadSong("SONG");
    sound.playSong();
    sound.tick(7);
    sound.freeSong();
    expect(sound.songLoaded).toBe(false);
    expect(sound.songPlayed()).toBe(true);
  });

  it("sérialise comme doSync et reprend le morceau là où il en était", () => {
    const { sink, sound, files } = setup(module([[0, 0, 0, 0x6a6, 1], [0, 8, 0, 0x6a6, 1]]));
    sound.loadSong("SONG");
    sound.playSong();
    sound.tick(25); // lignes aux ticks 6, 13 et 20
    sound.setVolume(7);
    const bytes = sound.serialize();
    expect(bytes).toHaveLength(SOUND_STATE_SIZE);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("SONG");
    const view = new DataView(bytes.buffer);
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => view.getInt16(33 + 2 * i, true))).toEqual([1, 0, 0, 48, 0, 1, 56]);

    const other = new CroisiereSound(sink, (name) => files[name]);
    expect(other.deserialize(bytes)).toBe(0);
    expect(other.getState()).toEqual(sound.getState());
    other.tick(7 * 4);
    expect(other.songLoaded).toBe(true);
    expect(() => other.deserialize(bytes.subarray(0, 10))).toThrow(RangeError);
  });
});

describe("bruitages", () => {
  it("PlayFX joue le timbre sur la voix 4 à la note 48, StopFX coupe", () => {
    const { sink, sound } = setup(module([]));
    const before = sink.writes.length;
    sound.playFX(adl());
    const added = sink.writes.slice(before);
    // voix 4 : modulateur 0x29 (opérateur 9), porteur 0x2C (opérateur 12) ; note 48 = octave 4, demi-ton 0
    expect(added.map((w) => w.reg)).toEqual([0x29, 0x49, 0x69, 0x89, 0xc4, 0xe9, 0x2c, 0x4c, 0x6c, 0x8c, 0xec, 0xa4, 0xb4]);
    expect(added.at(-2)).toMatchObject({ reg: 0xa4, value: 0x57 });
    expect(added.at(-1)).toMatchObject({ reg: 0xb4, value: 0x20 | (4 << 2) | 1 });
    sound.loopFX(undefined);
    sound.playFX(undefined);
    const mark = sink.writes.length;
    sound.stopFX(4);
    expect(sink.writes.slice(mark)).toEqual([{ tick: -1, reg: 0xb4, value: 0 }]);
    sound.stopFX(-1);
    expect(sink.writes.slice(mark + 1).map((w) => w.reg)).toEqual([0xb0, 0xb1, 0xb2, 0xb3]);
    expect(() => sound.stopFX(5)).toThrow(RangeError);
  });

  it("une note fixe (amDepth) remplace la note 48", () => {
    const { sink, sound } = setup(module([]));
    sound.playFX(adl({ amDepth: 12 }));
    expect(sink.writes.at(-1)).toMatchObject({ reg: 0xb4, value: 0x20 | (1 << 2) | 1 });
  });

  it("un timbre de percussion programme sa voix et le bit de 0xBD", () => {
    const { sink, sound } = setup(module([]));
    sound.playFX(adl({ mode: 1, channel: 8 }));
    expect(regs(sink, 0xbd).at(-1)!.value).toBe(0x20 | (1 << 2)); // 1 << (10 - 8), les bits précédents effacés
    expect(sink.writes.at(-3)).toMatchObject({ reg: 0xa8 });
  });
});
