import { afterEach, describe, expect, it, vi } from "vitest";
import { SPL_INSTRUMENT_OFFSET } from "../../../src/games/voyageurs/data/spl";
import { FADE_MS, TrackMusicOutput, createRecordingAudio } from "../../../src/games/voyageurs/audio/audio";

afterEach(() => vi.useRealTimers());

function splFile(): Uint8Array {
  return new Uint8Array(SPL_INSTRUMENT_OFFSET + 80);
}

describe("VoyageursSound (sorties enregistrées)", () => {
  it("la séquence de musique de l'intro passe par la sortie", () => {
    const { audio, music } = createRecordingAudio();
    audio.loadMusic("DUGGER.DAT");
    audio.playMusic();
    audio.setBgMusic(1);
    expect(music.commands).toEqual([
      { op: "play", file: "music/track19.mp3", loop: true },
      { op: "play", file: "music/track20.mp3", loop: true },
    ]);
    expect(audio.musicTrace).toBe("21,20,1");
  });

  it("playSample n'arrête pas la musique CD et date les écritures à l'horloge de l'hôte", () => {
    let now = 1234.4;
    const { audio, music, opl } = createRecordingAudio(() => now);
    audio.loadMusic("FWARS.DAT");
    audio.playMusic();
    const before = music.commands.length;
    now = 2000;
    audio.playSample(0, splFile(), 63);
    expect(music.commands).toHaveLength(before);
    const last = opl.writes.at(-1)!;
    expect(last[0]).toBe(2000);
    expect(opl.writes[0]![0]).toBe(1234); // initialisation de la carte à la création
    now = 3000;
    audio.stopSample(0);
    expect(opl.writes.at(-1)![0]).toBe(3000);
  });

  it("coupure, volume, pause et fermeture sont transmis aux deux sorties", () => {
    const { audio, music, opl } = createRecordingAudio();
    audio.setMuted(true);
    audio.setMusicVolume(0.5);
    expect(music.muted && opl.muted).toBe(true);
    expect(music.volume).toBe(0.5);
    audio.close();
    expect(music.closed && opl.closed).toBe(true);
    expect(music.commands.at(-1)).toEqual({ op: "stop" });
  });
});

/** Faux élément média : assez pour `TrackPlayer`. */
function fakeAudio(): { element: HTMLAudioElement; state: { src: string; volume: number; muted: boolean; paused: boolean; plays: number } } {
  const state = { src: "", volume: 1, muted: false, paused: true, plays: 0 };
  const element = {
    set src(v: string) {
      state.src = v;
    },
    get src() {
      return state.src;
    },
    preload: "",
    currentTime: 0,
    ended: false,
    readyState: 4,
    get volume() {
      return state.volume;
    },
    set volume(v: number) {
      state.volume = v;
    },
    get muted() {
      return state.muted;
    },
    set muted(v: boolean) {
      state.muted = v;
    },
    get paused() {
      return state.paused;
    },
    play() {
      state.paused = false;
      state.plays++;
      return Promise.resolve();
    },
    pause() {
      state.paused = true;
    },
    addEventListener() {},
  };
  return { element: element as unknown as HTMLAudioElement, state };
}

describe("TrackMusicOutput", () => {
  function make() {
    vi.useFakeTimers();
    const { element, state } = fakeAudio();
    const out = new TrackMusicOutput({ trackUrl: (file) => `/voyageurs/${file}`, createAudio: () => element });
    return { out, state };
  }

  it("lit la piste en flux depuis l'URL du jeu", () => {
    const { out, state } = make();
    out.play("music/track19.mp3", true);
    expect(state.src).toBe("/voyageurs/music/track19.mp3");
    expect(state.paused).toBe(false);
    out.stop();
    expect(state.paused).toBe(true);
  });

  it("un fondu baisse le volume puis lance la piste suivante, volume rétabli", () => {
    const { out, state } = make();
    out.setVolume(0.8);
    out.play("music/track19.mp3", true);
    out.fade({ file: "music/track22.mp3", loop: true });
    vi.advanceTimersByTime(FADE_MS / 2);
    expect(state.volume).toBeLessThan(0.8);
    expect(state.src).toBe("/voyageurs/music/track19.mp3");
    vi.advanceTimersByTime(FADE_MS);
    expect(state.src).toBe("/voyageurs/music/track22.mp3");
    expect(state.volume).toBeCloseTo(0.8);
  });

  it("un ordre pendant le fondu l'annule", () => {
    const { out, state } = make();
    out.play("music/track19.mp3", true);
    out.fade(null);
    vi.advanceTimersByTime(100);
    out.play("music/track20.mp3", true);
    vi.advanceTimersByTime(FADE_MS * 2);
    expect(state.src).toBe("/voyageurs/music/track20.mp3");
    expect(state.paused).toBe(false);
    expect(state.volume).toBe(1);
  });

  it("fondu sans lecture : joue ou coupe tout de suite", () => {
    const { out, state } = make();
    out.fade({ file: "music/track21.mp3", loop: true });
    expect(state.src).toBe("/voyageurs/music/track21.mp3");
    out.stop();
    out.fade(null);
    expect(state.paused).toBe(true);
  });

  it("la coupure garde la lecture", () => {
    const { out, state } = make();
    out.play("music/track19.mp3", true);
    out.setMuted(true);
    expect(state.muted).toBe(true);
    expect(state.paused).toBe(false);
  });
});
