import { describe, expect, it } from "vitest";
import type { OplSink } from "../../../src/audio/opl-stream";
import { AdlibMusic } from "../../../src/games/bass/audio/adlib-music";

/** Fichier de musique minimal à la disposition de la v0.0372 : un morceau, un canal, un instrument. */
function buildMusicFile(stream: number[], freq0 = 0x123): Uint8Array {
  const data = new Uint8Array(0x1400);
  const view = new DataView(data.buffer);
  const musicDataLoc = 0x1300;
  const instrumentLoc = 0x1100;
  view.setUint16(0x1201, musicDataLoc, true);
  view.setUint16(0x1205, instrumentLoc, true);
  view.setUint16(0x7fe, freq0, true); // table des fréquences : seule l'entrée 0 compte ici
  data.set([0x00, 0x03], 0xdfe); // voix 0 : opérateurs 0x00 et 0x03
  for (let i = 0; i < 0x81; i++) data[0xe10 + i] = i; // niveaux de sortie : identité
  data.set([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0, 0, 0x10, 0x3f, 0], instrumentLoc + 0x80); // instrument 0
  data[0xe91] = 0xbd; // séquence d'initialisation : (0xBD, 0xC0) puis 00 00
  data[0xe92] = 0xc0;
  data[musicDataLoc] = 1; // un morceau
  view.setUint16(musicDataLoc + 1, 3, true); // table des morceaux
  view.setUint16(musicDataLoc + 3, 5, true); // morceau 1
  data.set([0x78, 0xc0, 1], musicDataLoc + 5);
  view.setUint16(musicDataLoc + 8, 0x10, true); // canal 0
  data.set(stream, musicDataLoc + 0x10);
  return data;
}

// delta 0 voix 0 ; instrument 0 ; note 0x30 vélocité 0x40 ; 10 plus tard : coupure ; arrêt
const STREAM = [0, 0x80, 0, 0x92, 0, 0, 0x30, 0x40, 10, 0x99, 0, 0x91];

function setup(stream = STREAM) {
  const writes: Array<[number, number, number]> = [];
  let tick = 0;
  const sink: OplSink = { write: (reg, value) => void writes.push([tick, reg, value]) };
  const file = buildMusicFile(stream);
  const music = new AdlibMusic(sink, () => file.slice());
  return { music, writes, run: (n: number) => { for (let i = 0; i < n; i++) { music.tick(); tick++; } } };
}

describe("AdlibMusic (fichier synthétique)", () => {
  it("envoie la séquence d'initialisation au chargement de la section", () => {
    const { music, writes } = setup();
    music.loadSection(0);
    expect(writes).toEqual([[0, 0xbd, 0xc0]]);
  });

  it("instrument, fréquence et niveaux de sortie, puis coupure de la note ; le miroir supprime l'écriture de 0xC0 (déjà à 0)", () => {
    const { music, writes, run } = setup();
    music.loadSection(0);
    writes.length = 0;
    music.startMusic(1);
    run(1); // le morceau démarre au tick suivant la demande
    expect(writes.map(([t, r, v]) => [t, r, v])).toEqual([
      [0, 0x60, 1], [0, 0x63, 2], [0, 0x80, 3], [0, 0x83, 4], [0, 0xe0, 7], [0, 0xe3, 8], [0, 0x20, 5], [0, 0x23, 6],
      [0, 0xa0, 0x23], [0, 0xb0, 0x25], // note 0x30 : octave 1, fréquence 0x123 -> 0x523
      [0, 0x43, 32], [0, 0x40, 0x10], // niveau = ((0x41 * 0x40) << 1) * 256 >> 8 * 254 >> 16 = 32
    ]);
    writes.length = 0;
    run(1);
    expect(writes).toEqual([[1, 0xb0, 0x05]]);
    expect(music.musicIsPlaying()).toBe(false);
    expect(music.giveCurrentMusic()).toBe(1);
  });

  it("le volume de la musique entre dans le niveau de sortie", () => {
    const { music, writes, run } = setup();
    music.loadSection(0);
    music.setVolume(63);
    music.startMusic(1);
    run(1);
    // ((0x41 * 0x40) << 1) = 8320 ; * 256 >> 8 = 8320 ; * (63 << 1) >> 16 = 15
    expect(writes.find(([, r]) => r === 0x43)![2]).toBe(15);
  });

  it("arrête le morceau (startMusic(0)) en coupant la note en cours", () => {
    const { music, writes, run } = setup([0, 0x80, 0, 0x92, 0, 0, 0x30, 0x40, 100, 0x91]);
    music.loadSection(0);
    music.startMusic(1);
    run(1);
    writes.length = 0;
    music.startMusic(0);
    run(1);
    expect(writes).toEqual([[1, 0xb0, 0x05]]);
    expect(music.giveCurrentMusic()).toBe(0);
  });

  it("sauvegarde et restauration : section, morceau, volume", () => {
    const { music, run } = setup();
    music.loadSection(0);
    music.setVolume(50);
    music.startMusic(1);
    run(1);
    const state = music.getState();
    expect(state).toEqual({ section: 0, song: 1, volume: 50 });
    const other = setup();
    other.music.restoreState(state);
    other.run(1);
    expect(other.music.getState()).toEqual(state);
    expect(other.music.musicIsPlaying()).toBe(true);
  });

  it("numérote les ticks pour le flux OPL et refuse un morceau inexistant", () => {
    const begun: number[] = [];
    const file = buildMusicFile(STREAM);
    const music = new AdlibMusic({ write: () => undefined, beginTick: (n) => void begun.push(n) }, () => file.slice());
    music.tick(); // sans section : rien à jouer, mais le tick est compté
    music.loadSection(0);
    music.tick();
    expect(begun).toEqual([0, 1]);
    expect(music.tickNumber).toBe(2);
    expect(() => music.startMusic(2)).toThrow(/morceau 2/);
  });
});
