import { describe, expect, it } from "vitest";
import { FotaqAudio, createSoundPrefs, type MusicOutput } from "../../../src/games/fotaq/audio/audio";
import type { SoundFiles } from "../../../src/games/fotaq/audio/voices";
import { FakeAudioContext } from "../../support/fake-audio-context";
import { ManualClock } from "../../support/fake-host";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { FLAT, Recorder, instrument, noteOn, smf } from "./support";

class FakeMusicOutput extends Recorder implements MusicOutput {
  muted = false;
  level = 1;
  unlocks = 0;
  suspends = 0;
  resumes = 0;
  closed = false;
  unlock() {
    this.unlocks++;
  }
  suspend() {
    this.suspends++;
  }
  resume() {
    this.resumes++;
  }
  close() {
    this.closed = true;
  }
  setMuted(muted: boolean) {
    this.muted = muted;
  }
  setVolume(level: number) {
    this.level = level;
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** AQBANK.MUS de poche : deux morceaux vides (indices 0 et 1) puis un morceau de musique (indice 2). */
function musicBytes(): Uint8Array {
  const songs = [smf([]), smf([]), smf([instrument(0, FLAT, FLAT), noteOn(0, 0, 60)], { tempo: 100_000 })];
  const tableEnd = 2 + songs.length * 4;
  const out: number[] = [songs.length, 0];
  let offset = tableEnd;
  for (const song of songs) {
    out.push(offset & 15, 0, offset >> 4, 0);
    offset += song.length;
  }
  return Uint8Array.from([...out, ...songs.flatMap((s) => [...s])]);
}

function setup() {
  const clock = new ManualClock();
  const ctx = new FakeAudioContext(false);
  const music = new FakeMusicOutput();
  const present = new Set(["020001P2", "116BSSSS"]);
  const loads: string[] = [];
  const files: SoundFiles = {
    has: (name) => present.has(name),
    load: async (name) => {
      loads.push(name);
      return Uint8Array.of(1, 2, 3);
    },
  };
  const audio = new FotaqAudio({ now: () => clock.now(), files, musicData: musicBytes(), music, createContext: () => ctx.asContext() });
  return { clock, ctx, music, audio, loads };
}

describe("FotaqAudio", () => {
  it("une voix dure sa durée décodée sur l'horloge du jeu, même coupée ou sans contexte débloqué", async () => {
    const { audio, ctx, clock } = setup();
    ctx.decoded = { sampleRate: 8000, length: 16_000, channels: 1 }; // 2 s
    audio.setMuted(true);
    audio.playSpeech("020001P2");
    expect(audio.speechActive).toBe(true);
    expect(audio.speechFound).toBe(true);
    await flush();
    clock.advance(1999);
    expect(audio.speechActive).toBe(true);
    clock.advance(1);
    expect(audio.speechActive).toBe(false);
  });

  it("une voix absente est signalée sans bloquer", () => {
    const { audio } = setup();
    audio.playSpeech("999999P9");
    expect(audio.speechFound).toBe(false);
    expect(audio.speechActive).toBe(false);
    expect(audio.hasSpeech("02 001P2")).toBe(true); // les espaces valent des zéros
    expect(audio.hasSpeech("020001p2")).toBe(true);
  });

  it("un décodage qui échoue ne bloque pas la réplique", async () => {
    const { audio, ctx } = setup();
    ctx.decodeFails = true;
    audio.playSpeech("020001P2");
    await flush();
    expect(audio.speechActive).toBe(false);
  });

  it("l'effet de la pièce (playSfx) joue le fichier de _sfxName ; effets coupés : rien", async () => {
    const { audio, loads } = setup();
    audio.playSfx(1);
    await flush();
    expect(loads).toEqual(["116BSSSS"]);
    audio.sfxOn = false;
    audio.playSfx(1);
    expect(loads).toHaveLength(1);
  });

  it("preload charge les voix annoncées une seule fois", async () => {
    const { audio, loads } = setup();
    expect(await audio.preload(["020001P2", "020001p2", "ABSENT"])).toBe(1);
    expect(loads).toEqual(["020001P2"]);
    audio.playSpeech("020001P2");
    expect(loads).toHaveLength(1);
  });

  it("la musique avance avec l'horloge de l'hôte, coupée ou non, et ne bouge pas pendant la suspension", () => {
    const { audio, clock, music } = setup();
    audio.playSong(1);
    audio.setMuted(true);
    music.clear();
    clock.advance(100);
    audio.update();
    // numéros de tick consécutifs depuis la fin de l'initialisation, à 250 Hz
    expect(music.tick).toBe(25);
    audio.suspend();
    clock.advance(10_000);
    audio.update();
    expect(music.tick).toBe(25);
    audio.resume();
    clock.advance(40);
    audio.update();
    expect(music.tick).toBe(35);
    expect([music.suspends, music.resumes]).toEqual([1, 1]);
  });

  it("playSong : un morceau de musique tourne ; le volume passe au gain de la sortie", () => {
    const { audio, music } = setup();
    // la table AQBANK.MUS de poche n'a que 3 morceaux : le morceau 1 du jeu (liste 1 = musique 32) est donc au-delà, silence
    audio.playSong(1);
    expect(audio.musicPlaying).toBe(false);
    expect(audio.lastSong).toBe(1);
    audio.volume = 0.25;
    expect(music.level).toBe(0.25);
    audio.volume = 3;
    expect(audio.volume).toBe(1);
  });

  it("la préférence « Son » coupe la voix et la musique ; unlock, suspend et close les atteignent", () => {
    const { audio, music, ctx } = setup();
    const store = new Map<string, string>();
    const storage = { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) };
    const prefs = createSoundPrefs(storage as never, audio);
    prefs.set(false);
    expect(music.muted).toBe(true);
    expect(store.get("retrovibe:fotaq:sound")).toBe("0");
    audio.unlock();
    expect(music.unlocks).toBe(1);
    expect(ctx.gains[0].gain.value).toBe(0);
    prefs.set(true);
    expect(music.muted).toBe(false);
    audio.close();
    expect(music.closed).toBe(true);
    expect(ctx.closed).toBe(true);
  });

  it("rallumer la musique relance le dernier morceau retenu, l'éteindre l'arrête", () => {
    const { audio } = setup();
    audio.lastSong = 3; // Jungle : liste 3, musiques 15…, hors de la table de poche
    audio.musicOn = false;
    expect(audio.musicOn).toBe(false);
    audio.musicOn = true;
    expect(audio.lastSong).toBe(3);
  });
});

describe.skipIf(!hasOriginalFiles)("FotaqAudio avec AQBANK.MUS", () => {
  it("le morceau 1 du jeu (Hotel Gangsters) joue la musique 32 de la banque d'origine", () => {
    const clock = new ManualClock();
    const music = new FakeMusicOutput();
    const files: SoundFiles = { has: () => false, load: async () => new Uint8Array() };
    const audio = new FotaqAudio({ now: () => clock.now(), files, musicData: readOriginal("AQBANK.MUS"), music });
    audio.playSong(1);
    expect(audio.musicPlaying).toBe(true);
    clock.advance(2000);
    audio.update();
    expect(music.of(0xa0).length).toBeGreaterThan(0);
    audio.playSong(0);
    expect(audio.musicPlaying).toBe(false);
  });
});
