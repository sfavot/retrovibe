import { describe, expect, it } from "vitest";
import { QueenAdLibDriver } from "../../../src/games/fotaq/audio/adlib-driver";
import { FLAT, Recorder } from "./support";

function metaInstrument(channel: number, modulator: number[], carrier: number[], waves: [number, number] = [0, 0]): Uint8Array {
  return Uint8Array.from([0, 0, 0x3f, 0, 1, channel, ...modulator, ...carrier, ...waves]);
}

function open() {
  const sink = new Recorder();
  const driver = new QueenAdLibDriver(sink);
  driver.open();
  return { sink, driver };
}

describe("QueenAdLibDriver", () => {
  it("initialise la carte comme adlibSetupCard : registres à zéro, mode d'onde, rythme éteint", () => {
    const { sink } = open();
    // 245 écritures de remise à zéro (registres 1 à 0xF5) d'abord, puis registre 4 à 6.
    expect(sink.writes.slice(0, 245).every((w, i) => w.reg === i + 1 && w.value === 0)).toBe(true);
    expect(sink.writes[245]).toEqual({ tick: 0, reg: 4, value: 6 });
    expect(sink.of(1).at(-1)?.value).toBe(0x20); // sélection de forme d'onde active
    expect(sink.of(0xbd).at(-1)?.value).toBe(0); // ni rythme ni profondeurs
    // les neuf voix sont éteintes (bit 5 de B0 à zéro)
    for (let voice = 0; voice < 9; voice++) expect(sink.of(0xb0 + voice).at(-1)!.value & 0x20).toBe(0);
  });

  it("joue un do central : A0 = 0xB2, B0 = 0x2E (note 60 - 12, octave 3, touche)", () => {
    const { sink, driver } = open();
    driver.send(0x90, 60, 100);
    expect(sink.of(0xa0).at(-1)!.value).toBe(0xb2); // 690 & 0xFF
    expect(sink.of(0xb0).at(-1)!.value).toBe(0x2e); // (690 >> 8) & 3 | 3 << 2 | 0x20
    driver.send(0x80, 60, 0);
    expect(sink.of(0xb0).at(-1)!.value).toBe(0x0e);
  });

  it("un Note On de vélocité 0 coupe la note ; un Note On coupe d'abord la note en cours", () => {
    const { sink, driver } = open();
    driver.send(0x91, 72, 90);
    sink.clear();
    driver.send(0x91, 74, 90);
    const b1 = sink.of(0xb1).map((w) => w.value & 0x20);
    expect(b1).toEqual([0, 0x20]); // extinction puis touche
    sink.clear();
    driver.send(0x91, 74, 0);
    expect(sink.of(0xb1).map((w) => w.value & 0x20)).toEqual([0]);
  });

  it("grimpe d'un octave : la note 72 donne l'octave 4, A0 identique à celui du do central", () => {
    const { sink, driver } = open();
    driver.send(0x90, 72, 100);
    expect(sink.of(0xa0).at(-1)!.value).toBe(0xb2);
    expect(sink.of(0xb0).at(-1)!.value).toBe(0x32); // octave 4 : 2 | 4 << 2 | 0x20
  });

  it("une fréquence négative de la table passe à l'octave suivant, une note trop basse relève l'octave et divise la fréquence", () => {
    const { sink, driver } = open();
    driver.send(0x90, 71, 100); // pas 11 : table[176] = -373 -> octave 3 + 1, A0 = -373 & 255, bits 0-1 de B0 = (-373 >> 8) & 3
    expect(sink.of(0xa0).at(-1)!.value).toBe(139);
    expect(sink.of(0xb0).at(-1)!.value).toBe(0x32);
    driver.send(0x80, 71, 0);
    driver.send(0x90, 12, 100); // note 0 : octave -1 relevé à 0 et fréquence 690 >> 1 = 345
    expect(sink.of(0xa0).at(-1)!.value).toBe(345 & 0xff);
    expect(sink.of(0xb0).at(-1)!.value).toBe(0x20 | (345 >> 8));
  });

  it("le pitch bend (cmd 6, 14 bits) décale la fréquence ; le centre 8192 ne change rien", () => {
    const { sink, driver } = open();
    driver.send(0x90, 60, 100);
    const centre = sink.of(0xa0).at(-1)!.value;
    driver.send(0xe0, 0x00, 0x40); // 0x40 << 7 = 8192
    expect(sink.of(0xa0).at(-1)!.value).toBe(centre);
    driver.send(0xe0, 0x7f, 0x7f); // maximum : +8191 -> (8191 >> 5) = 255 pas de 1/16 de demi-ton
    expect(sink.of(0xa0).at(-1)!.value).not.toBe(centre);
  });

  it("charge un instrument (FF 7F type 1) : registres 20, 40, 60, 80, C0 et E0 du modulateur et de la porteuse du canal 0", () => {
    const { sink, driver } = open();
    sink.clear();
    const modulator = [2, 3, 5, 7, 9, 1, 4, 6, 10, 1, 0, 1, 0]; // ksl 2, mul 3, fb 5, ar 7, sl 9, sustain 1, dr 4, rr 6, tl 10, am 1, vib 0, ksr 1, conn 0
    const carrier = [1, 2, 0, 15, 8, 0, 3, 5, 0, 0, 1, 0, 1];
    driver.metaEvent(metaInstrument(0, modulator, carrier, [2, 1]));
    // canal MIDI 0 = canaux d'opérateurs 0 (modulateur, décalage 0) et 3 (porteuse, décalage 3)
    expect(sink.of(0x20).at(-1)!.value).toBe(3 | 0x80 | 0x20 | 0x10); // mul 3, AM, son tenu, KSR
    expect(sink.of(0x23).at(-1)!.value).toBe(2 | 0x40); // mul 2, vibrato
    expect(sink.of(0x60).at(-1)!.value).toBe((7 << 4) | 4);
    expect(sink.of(0x80).at(-1)!.value).toBe((9 << 4) | 6);
    expect(sink.of(0x63).at(-1)!.value).toBe((15 << 4) | 3);
    expect(sink.of(0xc0).at(-1)!.value).toBe((5 << 1) | 1); // rétroaction 5, connexion additive (conn = 0)
    expect(sink.of(0xe0).at(-1)!.value).toBe(2);
    expect(sink.of(0xe3).at(-1)!.value).toBe(1);
  });

  it("le niveau (registre 40) suit le niveau de l'instrument, la vélocité et le volume de canal", () => {
    const { sink, driver } = open();
    const modulator = [1, 1, 0, 15, 5, 0, 1, 3, 20, 0, 0, 0, 1]; // tl 20, connexion FM : le modulateur ne suit pas la vélocité
    const carrier = [2, 1, 0, 15, 5, 0, 1, 3, 10, 0, 0, 0, 1]; // tl 10
    driver.metaEvent(metaInstrument(0, modulator, carrier));
    driver.send(0x90, 60, 127);
    // modulateur : 63 - 20 = 43 (pas mis à l'échelle), puis x128*2 >> 8 = 43 ; 63 - 43 = 20, ksl 1 -> 20 | 1 << 6
    expect(sink.of(0x40).at(-1)!.value).toBe(20 | (1 << 6));
    // porteuse : 63 - 10 = 53 ; (127 * 53 + 64) >> 7 = 53 ; 63 - 53 = 10, ksl 2 -> 10 | 2 << 6
    expect(sink.of(0x43).at(-1)!.value).toBe(10 | (2 << 6));
    // vélocité 64 : porteuse (64 * 53 + 64) >> 7 = 27 ; 63 - 27 = 36
    driver.send(0x90, 60, 64);
    expect(sink.of(0x43).at(-1)!.value).toBe(36 | (2 << 6));
    // Dn (cmd 5) règle le volume du canal comme une vélocité
    driver.send(0xd0, 127, 0);
    expect(sink.of(0x43).at(-1)!.value).toBe(10 | (2 << 6));
  });

  it("setVolume baisse les niveaux (table de volumes des canaux : volume / 4 + 64)", () => {
    const { sink, driver } = open();
    driver.metaEvent(metaInstrument(0, FLAT, FLAT));
    driver.send(0x90, 60, 127);
    const loud = sink.of(0x43).at(-1)!.value & 63;
    driver.setVolume(96); // 96 * 64 / 256 + 64 = 88 sur 128
    driver.send(0x90, 60, 127);
    const soft = sink.of(0x43).at(-1)!.value & 63;
    expect(63 - soft).toBeLessThan(63 - loud);
  });

  it("mode rythme (FF 7F type 2) : onze canaux, bit 5 de BD ; les canaux 9 et 10 allument leur bit de percussion", () => {
    const { sink, driver } = open();
    driver.metaEvent(Uint8Array.from([0, 0, 0x3f, 0, 2, 1]));
    expect(sink.of(0xbd).at(-1)!.value & 0x20).toBe(0x20);
    // Comme dans ScummVM, les canaux 7 et 8 gardent une voix mélodique (`channel < 9`) ; seuls 9 et 10 sont des percussions
    // (bit `1 << (4 - (canal - 6))` de BD : 2 et 1).
    driver.send(0x99, 40, 100);
    expect(sink.of(0xbd).at(-1)!.value).toBe(0x20 | 0x02);
    driver.send(0x89, 40, 0);
    expect(sink.of(0xbd).at(-1)!.value).toBe(0x20);
    driver.send(0x9a, 40, 100);
    expect(sink.of(0xbd).at(-1)!.value).toBe(0x20 | 0x01);
    // un canal sans voix (11 et plus) est ignoré
    sink.clear();
    driver.send(0x9b, 40, 100);
    expect(sink.writes).toEqual([]);
  });

  it("ignore les messages sans effet (contrôleur, programme, pression par touche), les SysEx et les méta mal formés", () => {
    const { sink, driver } = open();
    sink.clear();
    driver.send(0xb0, 7, 100);
    driver.send(0xc0, 5, 0);
    driver.send(0xa0, 60, 50);
    driver.send(0xf0, 0, 0);
    driver.metaEvent(Uint8Array.from([0, 0, 0x3f, 0, 1, 0, 1, 2])); // trop court
    driver.metaEvent(Uint8Array.from([1, 2, 3, 4, 5, 6]));
    driver.metaEvent(Uint8Array.from([0, 0, 0x3f, 0, 9, 1]));
    expect(sink.writes).toEqual([]);
  });
});
