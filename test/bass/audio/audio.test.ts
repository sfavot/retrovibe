import { describe, expect, it } from "vitest";
import type { OplSink } from "../../../src/audio/opl-stream";
import type { SoundFiles } from "../../../src/audio/voice-bank";
import { BassAudio, createSoundPrefs, type BassMusicDriver, type MusicOutput } from "../../../src/games/bass/audio/audio";
import { musicFile, sfxFile } from "../../../src/games/bass/data/ids";
import { FakeStorage, ManualClock } from "../../support/fake-host";
import { FakeAudioContext } from "../../support/fake-audio-context";
import { buildSfxFile, effectOfDef, standardSounds } from "./sfx-support";

class FakeMusicOutput implements MusicOutput {
  muted = false;
  unlocks = 0;
  suspends = 0;
  resumes = 0;
  closed = false;
  beginTick(): void {}
  write(): void {}
  unlock(): void {
    this.unlocks++;
  }
  suspend(): void {
    this.suspends++;
  }
  resume(): void {
    this.resumes++;
  }
  close(): void {
    this.closed = true;
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
}

class FakeDriver implements BassMusicDriver {
  readonly log: string[] = [];
  ticks = 0;
  volume = 127;
  section = 0;
  song = 0;
  loadSection(section: number): void {
    this.log.push(`load ${section}`);
    this.section = section;
  }
  startMusic(param: number): void {
    this.log.push(`start ${param}`);
    this.song = param;
  }
  stopMusic(): void {
    this.log.push("stop");
  }
  setVolume(volume: number): void {
    this.volume = volume;
  }
  tick(): void {
    this.ticks++;
  }
  getState() {
    return { section: this.section, song: this.song, volume: this.volume };
  }
  restoreState(state: { section: number; song: number; volume: number }): void {
    this.log.push(`restore ${state.section}/${state.song}/${state.volume}`);
    Object.assign(this, state);
  }
}

function setup(voices: SoundFiles<number> = { has: () => false, load: async () => new Uint8Array(0) }) {
  const clock = new ManualClock();
  const ctx = new FakeAudioContext();
  const music = new FakeMusicOutput();
  const driver = new FakeDriver();
  const loadedFiles: number[] = [];
  let screen = 1;
  const audio = new BassAudio({
    now: () => clock.now(),
    createContext: () => ctx.asContext(),
    voices,
    music,
    screen: () => screen,
    loadFile: (id) => (loadedFiles.push(id), buildSfxFile(standardSounds())),
    createMusic: (_sink: OplSink, loadFile) => {
      const load = driver.loadSection.bind(driver);
      driver.loadSection = (section) => (loadFile(section), load(section));
      return driver;
    },
  });
  return { audio, clock, ctx, music, driver, loadedFiles, setScreen: (s: number) => (screen = s) };
}

describe("BassAudio", () => {
  it("loadSection : fichiers de musique et d'effets de la section, et coupe la voix", async () => {
    const speechFiles: SoundFiles<number> = { has: () => true, load: () => new Promise(() => undefined) };
    const { audio, driver, loadedFiles } = setup(speechFiles);
    audio.startSpeech((1 << 12) | 5);
    expect(audio.speechFinished()).toBe(false);
    audio.loadSection(3);
    expect(loadedFiles).toEqual([musicFile(3), sfxFile(3)]);
    expect(driver.log).toEqual(["load 3"]);
    expect(audio.speechFinished()).toBe(true);
    audio.startMusic(2);
    expect(driver.log.at(-1)).toBe("start 2");
  });

  it("la musique avance à 50 ticks par seconde de l'horloge de l'hôte, reste fractionnaire, figée pendant la suspension", () => {
    const { audio, clock, driver, music } = setup();
    clock.advance(100);
    audio.update();
    expect(driver.ticks).toBe(5);
    clock.advance(30);
    audio.update();
    expect(driver.ticks).toBe(6); // 30 ms = 1 tick + 10 ms gardés
    clock.advance(10);
    audio.update();
    expect(driver.ticks).toBe(7);
    audio.suspend();
    clock.advance(60_000);
    audio.update();
    expect(driver.ticks).toBe(7);
    audio.resume();
    clock.advance(20);
    audio.update();
    expect(driver.ticks).toBe(8);
    expect(music.suspends).toBe(1);
    expect(music.resumes).toBe(1);
  });

  it("un trou de plusieurs secondes ne rattrape que 2 s de musique", () => {
    const { audio, clock, driver } = setup();
    clock.advance(30_000);
    audio.update();
    expect(driver.ticks).toBe(100);
  });

  it("effets : startFx joue sur le contexte audio, fxOff les coupe, la pièce vient de l'hôte", async () => {
    const { audio, ctx, setScreen } = setup();
    audio.unlock();
    await Promise.resolve();
    await Promise.resolve();
    audio.loadSection(1);
    const everywhere = effectOfDef(3);
    audio.startFx(everywhere, 0);
    expect(ctx.sources).toHaveLength(1);
    audio.fxOff = true;
    audio.startFx(everywhere, 1);
    expect(ctx.sources).toHaveLength(1);
    audio.fxOff = false;
    setScreen(30);
    audio.startFx(effectOfDef(2), 1); // pièce 1 seulement
    expect(ctx.sources).toHaveLength(1);
    audio.stopFx();
    expect(ctx.sources[0]!.stopped).toBe(true);
  });

  it("sauvegarde : effets retenus et musique ; restauration remet la file et la musique", () => {
    const first = setup();
    first.audio.loadSection(1);
    first.audio.startMusic(3);
    first.audio.startFx(effectOfDef(2), 0); // pièce 1, drapeau 0x20
    const state = first.audio.getState();
    expect(state.music).toEqual({ section: 1, song: 3, volume: 127 });
    expect(state.sounds[0]).not.toBe(0xffff);

    const second = setup();
    second.audio.restoreState(state);
    expect(second.driver.log).toEqual(["restore 1/3/127"]);
    second.audio.loadSection(1, true);
    second.audio.checkFxQueue();
    expect(second.ctx.sources).toHaveLength(0); // contexte pas encore créé : la lecture est logique seulement
    expect(second.audio.sfx.channelActive(0)).toBe(true);
  });

  it("réglages : volume de la musique (0 à 127, jamais un gain), voix coupées", () => {
    const { audio, driver } = setup();
    audio.musicVolume = 64;
    expect(driver.volume).toBe(64);
    expect(audio.musicVolume).toBe(64);
    audio.speechOn = false;
    expect(audio.startSpeech((1 << 12) | 5)).toBe(false);
  });

  it("coupure, déblocage et fermeture suivent la sortie de la musique et celle des échantillons", () => {
    const { audio, ctx, music, driver } = setup();
    audio.unlock();
    expect(music.unlocks).toBe(1);
    audio.setMuted(true);
    expect(music.muted).toBe(true);
    expect(ctx.gains[0]!.gain.value).toBe(0);
    audio.close();
    expect(music.closed).toBe(true);
    expect(ctx.closed).toBe(true);
    expect(driver.log.at(-1)).toBe("stop");
  });

  it("la préférence « Son » coupe tout (clé retrovibe:bass:sound)", () => {
    const { audio, music } = setup();
    const storage = new FakeStorage();
    const prefs = createSoundPrefs(storage, audio);
    prefs.set(false);
    expect(storage.get("retrovibe:bass:sound")).toBe("0");
    expect(music.muted).toBe(true);
  });
});
