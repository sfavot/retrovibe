import { describe, expect, it } from "vitest";
import { DEFAULT_SOUND_VOLUME, LURE_MAX_SOURCES, SF_IN_USE, SF_RESTORE, SoundManager, TICK_MS, type BellsArea } from "../../../src/games/lure/audio/sound";
import type { SoundDesc } from "../../../src/games/lure/data/lure-dat";
import { buildSection, buildSmf, instrument, noteOff, noteOn } from "./smf-builder";
import { RecordingSink } from "./scenario";

/** 0 : 0,5 s ; 1 : 10 s ; 2 à 11 : 0,5 s. */
const SHORT = buildSmf([noteOn(0, 60), noteOff(96, 60)]);
const BNK = [1, 2, 3, 12, 5, 1, 7, 4, 20, 1, 1, 1, 0, 2, 1, 0, 15, 6, 1, 3, 5, 10, 0, 1, 0, 1, 1, 2];
const LONG = buildSmf([instrument(0, 0, BNK), noteOn(0, 60), noteOff(1920, 60)]);
const files = [SHORT, LONG, ...Array.from({ length: 10 }, () => SHORT)];
const empty = buildSection([SHORT]);

const desc = (soundNumber: number, over: Partial<SoundDesc> = {}): SoundDesc => ({ soundNumber, channel: 0, numChannels: 4, flags: SF_IN_USE, volume: DEFAULT_SOUND_VOLUME, ...over });

function manager(options: { descs?: SoundDesc[]; soundEnabled?: () => boolean; preloading?: () => boolean; area?: BellsArea } = {}) {
  const sink = new RecordingSink();
  const warnings: string[] = [];
  const descs = options.descs ?? files.map((_, i) => desc(i));
  const sound = new SoundManager({ sections: { main: buildSection(files), intro: empty, ending: empty }, descs, sink, warn: (m) => warnings.push(m), ...options });
  sound.loadSection("main");
  return { sound, sink, warnings };
}

describe("SoundManager : sources", () => {
  it("la musique prend la source 0, chaque bruitage la première source libre de 1 à 9", () => {
    const { sound } = manager();
    sound.playMusic(1, true);
    sound.addSound(0);
    sound.addSound(2);
    sound.addSound(3);
    expect(sound.playing).toEqual([
      { soundNumber: 1, source: 0 },
      { soundNumber: 0, source: 1 },
      { soundNumber: 2, source: 2 },
      { soundNumber: 3, source: 3 },
    ]);
    expect(sound.sourcesInUse.slice(0, 5)).toEqual([true, true, true, true, false]);
  });

  it("sans source libre un son n'est pas joué (avertissement) ; une source finie est rendue", () => {
    const { sound, warnings } = manager();
    for (let i = 0; i < LURE_MAX_SOURCES - 1; i++) sound.addSound(2 + (i % 10));
    expect(sound.playing).toHaveLength(9);
    sound.addSound(0);
    expect(warnings).toEqual(["Insufficient sources to play sound 0"]);
    expect(sound.playing).toHaveLength(9);
    sound.advance(600);
    expect(sound.isSoundActive(2)).toBe(false);
    expect(sound.playing).toHaveLength(0);
    sound.addSound(1);
    expect(sound.playing).toEqual([{ soundNumber: 1, source: 1 }]);
  });

  it("un son de la musique sur la source 0 peut être relancé : deux morceaux partagent la source", () => {
    const { sound } = manager();
    sound.playMusic(1, true);
    sound.playMusic(0, true);
    expect(sound.playing.map((p) => p.source)).toEqual([0, 0]);
  });
});

describe("SoundManager : sons actifs et description 0x3F18", () => {
  it("addSound retient la description, le son finit sur l'horloge de l'hôte", () => {
    const { sound } = manager();
    sound.addSound(0);
    expect(sound.activeSoundNumbers()).toEqual([0]);
    expect(sound.isSoundActive(0)).toBe(true);
    sound.advance(450);
    expect(sound.isSoundActive(0)).toBe(true);
    sound.advance(100);
    expect(sound.isSoundActive(0)).toBe(false);
    expect(sound.activeSoundNumbers()).toEqual([]);
  });

  it("une description sans voix AdLib (bits 2 et 3 de numChannels) ne joue pas et n'est pas retenue", () => {
    const { sound } = manager({ descs: [desc(0, { numChannels: 0b0011 }), desc(1, { numChannels: 0b1000 })] });
    sound.addSound(0);
    expect(sound.playing).toEqual([]);
    expect(sound.activeSoundNumbers()).toEqual([]);
    sound.addSound(1);
    expect(sound.playing).toHaveLength(1);
  });

  it("son désactivé (soundFlag) : retenu mais muet, puis retiré au premier tidy ; préchargement : rien", () => {
    const { sound } = manager({ soundEnabled: () => false });
    sound.addSound(0);
    expect(sound.playing).toEqual([]);
    expect(sound.activeSoundNumbers()).toEqual([0]);
    expect(sound.isSoundActive(0)).toBe(false);
    expect(sound.activeSoundNumbers()).toEqual([]);

    const loading = manager({ preloading: () => true });
    loading.sound.addSound(0);
    expect(loading.sound.activeSoundNumbers()).toEqual([]);
    expect(loading.sound.playing).toEqual([]);
  });

  it("le bit 7 du numéro demande une boucle ; l'arrêt et le test comparent les 7 bits bas", () => {
    const { sound } = manager({ descs: [desc(0x80)] });
    sound.addSound(0);
    sound.advance(900);
    // 0,5 s de morceau : sans boucle il serait fini.
    expect(sound.isSoundActive(0x80)).toBe(true);
    expect(sound.playing).toEqual([{ soundNumber: 0, source: 1 }]);
    sound.killSound(0x80);
    expect(sound.isSoundActive(0x80)).toBe(false);
  });

  it("addSound2 ne relance pas un son qui joue, sauf le 6 (torture chinoise) qui repart de zéro", () => {
    const { sound, sink } = manager();
    sound.addSound2(1);
    sound.addSound2(1);
    expect(sound.playing).toHaveLength(1);
    sound.addSound2(6);
    sound.advance(200);
    const before = sink.writes.length;
    sound.addSound2(6);
    expect(sound.playing.filter((p) => p.soundNumber === 6)).toHaveLength(1);
    // Le son 6 a été arrêté puis relancé : sa source est la même, la lecture repart du début.
    sound.advance(8);
    expect(sink.writes.length).toBeGreaterThanOrEqual(before);
  });

  it("stopSound et killSound arrêtent un son ; killSounds coupe tout", () => {
    const { sound } = manager();
    sound.addSound(1);
    sound.addSound(2);
    sound.addSound(3);
    sound.stopSound(1);
    expect(sound.playing.map((p) => p.soundNumber)).toEqual([2, 3]);
    sound.killSound(2);
    expect(sound.playing.map((p) => p.soundNumber)).toEqual([3]);
    sound.killSounds();
    expect(sound.playing).toEqual([]);
    expect(sound.activeSoundNumbers()).toEqual([]);
    expect(sound.sourcesInUse.some(Boolean)).toBe(false);
  });

  it("removeSounds (changement de pièce) n'arrête que les sons SF_IN_USE", () => {
    const { sound } = manager({ descs: [desc(0, { flags: SF_IN_USE }), desc(1, { flags: 0 }), desc(2, { flags: SF_IN_USE | SF_RESTORE })] });
    sound.addSound(0);
    sound.addSound(1);
    sound.addSound(2);
    sound.removeSounds();
    expect(sound.playing.map((p) => p.soundNumber)).toEqual([1]);
  });

  it("le volume d'un son est retenu (80h par défaut) mais ne change rien aux écritures AdLib", () => {
    const { sound } = manager({ descs: [desc(0, { volume: 0x40 })] });
    sound.addSound(0);
    expect(sound.volumeOf(0)).toBe(0x40);
    sound.setVolume(0, 15);
    expect(sound.volumeOf(0)).toBe(15);
    sound.playMusic(1, true);
    expect(sound.volumeOf(1)).toBe(DEFAULT_SOUND_VOLUME);
  });

  it("charger une section coupe tout ; un son hors de la section est refusé", () => {
    const { sound } = manager();
    sound.addSound(1);
    sound.loadSection("intro");
    expect(sound.playing).toEqual([]);
    expect(sound.section).toBe("intro");
    expect(() => sound.playMusic(5, true)).toThrow();
    expect(() => sound.addSound(99)).toThrow();
  });
});

describe("SoundManager : sauvegarde (SF_RESTORE)", () => {
  const descs = [desc(0, { flags: SF_IN_USE | SF_RESTORE }), desc(1, { flags: SF_IN_USE }), desc(0x82, { flags: SF_RESTORE }), desc(3, { numChannels: 0, flags: SF_RESTORE })];

  it("expose les numéros des sons actifs", () => {
    const { sound } = manager({ descs });
    sound.addSound(0);
    sound.addSound(1);
    sound.addSound(2);
    expect(sound.activeSoundNumbers()).toEqual([0, 1, 0x82]);
  });

  it("à la restitution, seuls les sons marqués SF_RESTORE sont relancés ; les autres numéros sont oubliés", () => {
    const { sound } = manager({ descs });
    sound.addSound(1);
    sound.restoreSounds([0, 1, 0x82, 3, 0x55]);
    // 1 : sans SF_RESTORE ; 3 : sans voix AdLib ; 0x55 : sans description.
    expect(sound.playing.map((p) => p.soundNumber).sort()).toEqual([0, 2]);
    expect(sound.activeSoundNumbers()).toEqual([0, 0x82]);
    expect(sound.descIndexOf(0x82)).toBe(2);
  });

  it("restoreSounds coupe d'abord les sons en cours", () => {
    const { sound } = manager({ descs });
    sound.addSound(1);
    sound.restoreSounds([]);
    expect(sound.playing).toEqual([]);
  });
});

describe("SoundManager : cloches (bellsBodge)", () => {
  function withArea(roomFlag: number | undefined, field: number) {
    const state = { field };
    const area: BellsArea = { roomAreaFlag: () => roomFlag, getAreaField: () => state.field, setAreaField: (v) => (state.field = v) };
    // Comme dans les données du jeu, la description 2 (cloches en boucle) n'est pas SF_IN_USE : sinon `removeSounds` la couperait aussitôt.
    return { state, ...manager({ descs: files.map((_, i) => desc(i, i === 2 ? { flags: SF_RESTORE } : {})), area }) };
  }

  it("zone 1 : lance le son 2 et coupe le 33 ; la zone retenue est mise à jour", () => {
    const { sound, state } = withArea(1, 0);
    sound.playMusic(1, true);
    sound.removeSounds();
    expect(state.field).toBe(1);
    expect(sound.activeSoundNumbers()).toContain(2);
    expect(sound.playing.some((p) => p.soundNumber === 2)).toBe(true);
  });

  it("zone 0 ou 2 : coupe le son 1 (la zone 2 baisse aussi le volume du son 0)", () => {
    for (const flag of [0, 2]) {
      const { sound } = withArea(flag, 5);
      sound.addSound(1);
      expect(sound.playing).toHaveLength(1);
      sound.removeSounds();
      expect(sound.playing).toEqual([]);
    }
  });

  it("zone inchangée ou pièce inconnue : rien", () => {
    const same = withArea(1, 1);
    same.sound.removeSounds();
    expect(same.sound.activeSoundNumbers()).toEqual([]);
    const unknown = withArea(undefined, 0);
    unknown.sound.removeSounds();
    expect(unknown.state.field).toBe(0);
  });
});

describe("SoundManager : horloge", () => {
  it("avance par ticks de 4 ms numérotés pour WebOpl", () => {
    const { sound, sink } = manager();
    expect(TICK_MS).toBe(4);
    sound.advance(10);
    expect(sound.tickCount).toBe(2);
    sound.advance(2);
    expect(sound.tickCount).toBe(3);
    expect(sink.writes.every((w) => w.tick <= 3)).toBe(true);
  });

  it("un retard de plus d'une seconde (onglet en arrière-plan) est oublié", () => {
    const { sound } = manager();
    sound.advance(60_000);
    expect(sound.tickCount).toBe(250);
  });

  it("pause : le temps des sons s'arrête et les notes sont coupées ; reprise : il repart", () => {
    const { sound, sink } = manager();
    sound.addSound(0);
    sound.advance(100);
    const before = sink.writes.length;
    sound.pause();
    expect(sink.writes.length).toBeGreaterThan(before);
    sound.advance(5000);
    expect(sound.isSoundActive(0)).toBe(true);
    sound.resume();
    sound.advance(600);
    expect(sound.isSoundActive(0)).toBe(false);
  });

  it("fondu de sortie (introduction) : 3 s, puis tout est coupé et le volume des sources redevient neutre", () => {
    const { sound, sink } = manager();
    sound.playMusic(1, true);
    sound.addSound(1);
    sound.advance(100);
    sound.startFadeOut();
    expect(sound.fading).toBe(true);
    const before = sink.writes.length;
    for (let i = 0; i < 28; i++) sound.advance(100);
    expect(sound.fading).toBe(true);
    // Le niveau des opérateurs est réécrit pendant le fondu (toutes les 25 ms environ).
    expect(sink.writes.length).toBeGreaterThan(before);
    for (let i = 0; i < 3; i++) sound.advance(100);
    expect(sound.fading).toBe(false);
    sound.finishFadeOut();
    expect(sound.playing).toEqual([]);
    expect(sound.sourcesInUse.some(Boolean)).toBe(false);
  });

  it("un fondu interrompu par le joueur va à son volume final avant la coupure", () => {
    const { sound } = manager();
    sound.playMusic(1, true);
    sound.startFadeOut();
    sound.advance(500);
    sound.finishFadeOut(true);
    expect(sound.fading).toBe(false);
    expect(sound.playing).toEqual([]);
  });

  it("continuePlaying et trashReverb ne font rien", () => {
    const { sound, sink } = manager();
    const before = sink.writes.length;
    sound.continuePlaying();
    sound.trashReverb();
    expect(sink.writes).toHaveLength(before);
  });
});
