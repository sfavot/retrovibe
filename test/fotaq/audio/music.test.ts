import { describe, expect, it } from "vitest";
import { QUEEN_TICK_MS, QueenMusic } from "../../../src/games/fotaq/audio/music";
import { readAdLibBank } from "../../../src/games/fotaq/data/music";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { FLAT, Recorder, bankOf, instrument, noteOff, noteOn, sequencerValue, smf } from "./support";

const INSTR = instrument(0, FLAT, FLAT);

/** Un morceau de 4 ms x 25 = 100 ms par noire à 420 ticks/noire et 100 000 µs/noire : la noire = 100 ms. */
const FAST = 100_000;

function ticks(music: QueenMusic, count: number): void {
  for (let i = 0; i < count; i++) music.tick();
}

describe("QueenMusic : séquenceur", () => {
  it("envoie un événement au tick qui couvre sa date (250 Hz) et numérote les écritures par tick", () => {
    const sink = new Recorder();
    // Note On à 100 ms (une noire), Note Off une noire plus tard.
    const song = smf([INSTR, noteOn(420, 0, 60), noteOff(420, 0, 60)], { tempo: FAST });
    const music = new QueenMusic({ bank: bankOf(smf([]), song), sink });
    music.playSong(1);
    ticks(music, 1); // l'instrument (date 0) part au premier tick
    sink.clear();
    ticks(music, 23); // jusqu'à 96 ms : rien
    expect(sink.writes).toEqual([]);
    ticks(music, 1); // 100 ms = tick 25
    expect(sink.of(0xa0)).toEqual([{ tick: 25, reg: 0xa0, value: 0xb2 }]);
    expect(sink.of(0xb0).map((w) => [w.tick, w.value])).toEqual([
      [25, 0x00], // extinction avant la note (la voix n'avait pas encore de fréquence)
      [25, 0x2e],
    ]);
    ticks(music, 25);
    expect(sink.of(0xb0).at(-1)).toEqual({ tick: 50, reg: 0xb0, value: 0x0e });
    expect(QUEEN_TICK_MS).toBe(4);
  });

  it("advance(ms) convertit le temps réel en ticks de 4 ms, garde le reste, et plafonne le rattrapage à 1 s", () => {
    const music = new QueenMusic({ bank: bankOf(smf([])), sink: new Recorder() });
    music.advance(10);
    expect(music.tickCount).toBe(2);
    music.advance(2); // 2 + 2 = 4 ms de reste : un tick de plus
    expect(music.tickCount).toBe(3);
    music.advance(60_000);
    expect(music.tickCount).toBe(3 + 250);
    music.advance(-5);
    expect(music.tickCount).toBe(3 + 250);
  });

  it("à la fin de piste, coupe les notes tenues puis s'arrête", () => {
    const sink = new Recorder();
    const song = smf([INSTR, noteOn(0, 0, 60), noteOn(0, 1, 64)], { tempo: FAST });
    const music = new QueenMusic({ bank: bankOf(smf([]), song), sink });
    music.playSong(1);
    sink.clear();
    ticks(music, 1);
    expect(music.isPlaying).toBe(false);
    // fin à la date 0 : les deux notes sont démarrées puis coupées dans le même tick
    expect(sink.of(0xb0).at(-1)!.value & 0x20).toBe(0);
    expect(sink.of(0xb1).at(-1)!.value & 0x20).toBe(0);
  });

  it("stopMusic coupe les notes en cours et garde le morceau en file", () => {
    const sink = new Recorder();
    const song = smf([INSTR, noteOn(0, 2, 60), noteOff(4200, 2, 60)], { tempo: FAST });
    const music = new QueenMusic({ bank: bankOf(smf([]), song), sink });
    music.playSong(1);
    ticks(music, 2);
    expect(sink.of(0xb2).at(-1)!.value & 0x20).toBe(0x20);
    music.stopMusic();
    expect(music.isPlaying).toBe(false);
    expect(sink.of(0xb2).at(-1)!.value & 0x20).toBe(0);
  });

  it("un tempo à l'intérieur du morceau change la durée des notes suivantes", () => {
    const sink = new Recorder();
    const song = smf([INSTR, noteOn(420, 0, 60), { delta: 0, bytes: [0xff, 0x51, 3, 0x03, 0x0d, 0x40] }, noteOff(420, 0, 60)], { tempo: FAST });
    // 0x030d40 = 200 000 µs/noire : la deuxième noire dure 200 ms
    const music = new QueenMusic({ bank: bankOf(smf([]), song), sink });
    music.playSong(1);
    sink.clear();
    ticks(music, 25 + 50);
    expect(sink.of(0xb0).at(-1)).toMatchObject({ tick: 25 + 50 });
  });

  it("ignore les méta-événements de séquenceur mal formés et les SysEx", () => {
    const sink = new Recorder();
    const song = smf([{ delta: 0, bytes: [0xff, 0x7f, 3, 1, 2, 3] }, { delta: 0, bytes: [0xf0, 2, 0x7e, 0xf7] }, noteOn(0, 0, 60)]);
    const music = new QueenMusic({ bank: bankOf(smf([]), song), sink });
    music.playSong(1);
    expect(() => ticks(music, 3)).not.toThrow();
  });
});

describe("QueenMusic : file et listes de morceaux", () => {
  /** Quatre morceaux de 100 ms, repérables par la note qu'ils jouent. */
  function threeNoteBank() {
    const mk = (note: number) => smf([INSTR, noteOn(0, 0, note), noteOff(420, 0, note)], { tempo: FAST });
    return bankOf(smf([]), mk(60), mk(62), mk(64), mk(65));
  }

  /** Note du dernier Note On (A0 -> note) vu depuis `from`. */
  function notes(sink: Recorder): number[] {
    return sink.of(0xa0).map((w) => w.value);
  }

  it("playSong joue le morceau et s'arrête à sa fin (hors boucle)", () => {
    const sink = new Recorder();
    const music = new QueenMusic({ bank: threeNoteBank(), sink });
    music.playSong(1);
    sink.clear();
    ticks(music, 40);
    expect(music.isPlaying).toBe(false);
    expect(notes(sink)).toHaveLength(1);
  });

  it("l'indice 0 ne peut pas être joué (0 marque une place libre de la file)", () => {
    const music = new QueenMusic({ bank: threeNoteBank(), sink: new Recorder() });
    music.playSong(0);
    expect(music.isPlaying).toBe(false);
  });

  it("ignore un indice au-delà de la table (silence), comme le 176 de la course de voiture", () => {
    const music = new QueenMusic({ bank: threeNoteBank(), sink: new Recorder() });
    music.playSong(176);
    expect(music.isPlaying).toBe(false);
  });

  it("liste séquentielle (mode 1, liste 13 : 34, 36, 56) enchaîne puis boucle", () => {
    // Liste 13 de _tune = [34, 36, 56] en mode 0 ; la 14 = [87, 35] en mode 1. On teste une liste de deux morceaux valides : la 14.
    const mk = (note: number) => smf([INSTR, noteOn(0, 0, note), noteOff(420, 0, note)], { tempo: FAST });
    const files = [smf([])];
    for (let i = 1; i <= 100; i++) files.push(mk(40 + (i % 40)));
    const sink = new Recorder();
    const music = new QueenMusic({ bank: bankOf(...files), sink });
    music.queueTuneList(13); // « Temple Maze » : { 87, 35 }, mode 1
    music.playMusic();
    sink.clear();
    ticks(music, 25 * 4 + 5);
    // 86 puis 34 puis 86… (indices = numéro - 1) : la fin d'un morceau lance le suivant, le dernier relance le premier
    expect(notes(sink).length).toBeGreaterThanOrEqual(4);
    expect(music.isPlaying).toBe(true);
  });

  it("mode 0 : tirage au hasard d'un morceau de la liste, sans fin tant que la liste en compte plusieurs", () => {
    const mk = (note: number) => smf([INSTR, noteOn(0, 0, note), noteOff(420, 0, note)], { tempo: FAST });
    const files = [smf([])];
    for (let i = 1; i <= 100; i++) files.push(mk(30 + i / 2));
    const picks: number[] = [];
    const music = new QueenMusic({
      bank: bankOf(...files),
      sink: new Recorder(),
      random: (max) => {
        picks.push(max);
        return max;
      },
    });
    music.queueTuneList(19); // « Floda General » : { 89, 63, 64, 65 }, mode 0
    music.playMusic();
    expect(music.isPlaying).toBe(true);
    expect(music.currentSongIndex).toBe(64); // dernier de la liste (tirage = max) : 65 - 1
    ticks(music, 30);
    expect(music.isPlaying).toBe(true); // un autre morceau a été tiré
    expect(picks.every((max) => max === 3)).toBe(true);
  });

  it("la liste 3 (jungle) tire dans JUNGLE_LIST (15, 16, 17, 18, 7…14)", () => {
    const files = [smf([])];
    for (let i = 1; i <= 30; i++) files.push(smf([INSTR, noteOn(0, 0, 60 + (i % 10)), noteOff(420, 0, 60)], { tempo: FAST }));
    const music = new QueenMusic({ bank: bankOf(...files), sink: new Recorder(), random: () => 0 });
    music.queueTuneList(2);
    music.playMusic();
    expect(music.currentSongIndex).toBe(14); // JUNGLE_LIST[0] = 15 -> indice 14
  });

  it("2000 reprend le morceau d'avant (fanfare puis retour)", () => {
    const mk = (note: number) => smf([INSTR, noteOn(0, 0, note), noteOff(420, 0, note)], { tempo: FAST });
    const files = [smf([])];
    for (let i = 1; i <= 100; i++) files.push(mk(30 + (i % 50)));
    const music = new QueenMusic({ bank: bankOf(...files), sink: new Recorder() });
    music.queueTuneList(0); // « Hotel Gangsters » : { 32 } -> indice 31
    music.playMusic();
    expect(music.currentSongIndex).toBe(31);
    music.queueTuneList(31); // « Hotel Fanfare 2 » : { 69, 2000 }
    music.playMusic();
    expect(music.currentSongIndex).toBe(68);
    ticks(music, 30); // fin de la fanfare : 2000 -> morceau retenu par queueClear (l'indice 31 de la liste précédente)
    expect(music.currentSongIndex).toBe(31);
    expect(music.isPlaying).toBe(true);
  });

  it("1003 enchaîne une autre liste de morceaux (valeur - 1000)", () => {
    const mk = (note: number) => smf([INSTR, noteOn(0, 0, note), noteOff(420, 0, note)], { tempo: FAST });
    const files = [smf([])];
    for (let i = 1; i <= 110; i++) files.push(mk(30 + (i % 50)));
    const music = new QueenMusic({ bank: bankOf(...files), sink: new Recorder(), random: () => 0 });
    music.queueTuneList(50); // « Bud and Lou Theme » : { 94, 1003 }
    music.playMusic();
    expect(music.currentSongIndex).toBe(93);
    ticks(music, 30);
    expect(music.currentSongIndex).toBe(14); // liste 3 (jungle), premier tirage
  });

  it("toggleVChange divise puis multiplie par deux le volume général, que les morceaux « Vnormal… » demandent", () => {
    const music = new QueenMusic({ bank: threeNoteBank(), sink: new Recorder() });
    expect(music.volume).toBe(192);
    music.toggleVChange();
    expect(music.volume).toBe(96);
    music.toggleVChange();
    expect(music.volume).toBe(192);
    music.setVolume(400);
    expect(music.volume).toBe(255);
  });

  it("le mode rythme et le multiplicateur de pitch bend traversent le séquenceur (FF 7F types 2 et 3)", () => {
    const sink = new Recorder();
    const song = smf([sequencerValue(2, 1), sequencerValue(3, 4), INSTR, noteOn(0, 0, 60)]);
    const music = new QueenMusic({ bank: bankOf(smf([]), song), sink });
    music.playSong(1);
    sink.clear();
    ticks(music, 1);
    expect(sink.of(0xbd).some((w) => (w.value & 0x20) === 0x20)).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("QueenMusic : AQBANK.MUS", () => {
  it("joue sans erreur les 102 morceaux jusqu'à leur fin, ou 20 s pour les plus longs, avec des écritures valides", () => {
    const bank = readAdLibBank(readOriginal("AQBANK.MUS"));
    expect(bank.songs).toHaveLength(102);
    let withNotes = 0;
    for (let index = 1; index < bank.songs.length; index++) {
      const sink = new Recorder();
      const music = new QueenMusic({ bank, sink });
      music.playSong(index);
      let n = 0;
      while (music.isPlaying && n < 250 * 20) {
        music.tick();
        n++;
      }
      for (const w of sink.writes) {
        expect(w.reg).toBeGreaterThanOrEqual(1);
        expect(w.reg).toBeLessThanOrEqual(0xf5);
        expect(w.value).toBeGreaterThanOrEqual(0);
        expect(w.value).toBeLessThanOrEqual(255);
      }
      if (sink.of(0xa0).length > 0) withNotes++;
    }
    expect(withNotes).toBeGreaterThan(80);
  });

  it("le thème « Intro Credits » (indice 20) démarre par son instrument puis sa première note, aux écritures attendues", () => {
    const bank = readAdLibBank(readOriginal("AQBANK.MUS"));
    const sink = new Recorder();
    const music = new QueenMusic({ bank, sink });
    music.playSong(20);
    sink.clear();
    ticks(music, 250 * 5);
    // un instrument chargé avant toute note : écritures des registres 20/40/60/80 avant le premier A0
    const firstNote = sink.writes.findIndex((w) => w.reg >= 0xa0 && w.reg <= 0xa8);
    expect(firstNote).toBeGreaterThan(0);
    expect(sink.writes.slice(0, firstNote).some((w) => w.reg >= 0x20 && w.reg <= 0x35)).toBe(true);
  });
});
