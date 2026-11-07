import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackPlayer } from "../../src/audio/track-player";

/** Faux HTMLAudioElement : pas de lecture réelle, seulement l'état. */
class FakeAudio {
  paused = true;
  ended = false;
  muted = false;
  volume = 1;
  preload = "";
  src = "";
  readyState = 4;
  currentTime = 0;
  addEventListener(): void {}
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

describe("TrackPlayer", () => {
  let audio: FakeAudio;
  let player: TrackPlayer;

  beforeEach(() => {
    vi.useFakeTimers();
    audio = new FakeAudio();
    player = new TrackPlayer(() => audio as unknown as HTMLAudioElement);
  });
  afterEach(() => vi.useRealTimers());

  it("lit une plage depuis start et prévient à la fin, sans prévenir sur stop()", () => {
    const onEnded = vi.fn();
    player.onEnded = onEnded;
    player.play("a.mp3", { start: 10, end: 20 });
    expect(audio.src).toBe("a.mp3");
    expect(audio.currentTime).toBe(10);
    expect(player.playing).toBe(true);
    audio.currentTime = 20;
    vi.advanceTimersByTime(40);
    expect(player.playing).toBe(false);
    expect(onEnded).toHaveBeenCalledTimes(1);
    player.play("a.mp3", { start: 0, end: 5 });
    player.stop();
    vi.advanceTimersByTime(200);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("le volume se règle entre 0 et 1, indépendamment de la coupure, et survit à une nouvelle piste", () => {
    expect(player.volume).toBe(1);
    player.volume = 0.25;
    expect(audio.volume).toBe(0.25);
    player.volume = 3;
    expect(player.volume).toBe(1);
    player.volume = -1;
    expect(player.volume).toBe(0);
    player.volume = 0.5;
    player.play("a.mp3");
    expect(player.volume).toBe(0.5);
    expect(player.muted).toBe(false);
  });

  it("piste entière : la fin du fichier déclenche onEnded", () => {
    const onEnded = vi.fn();
    player.onEnded = onEnded;
    player.play("Track02.mp3");
    audio.ended = true;
    vi.advanceTimersByTime(40);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("en boucle : revient à start sans s'arrêter ni prévenir", () => {
    const onEnded = vi.fn();
    player.onEnded = onEnded;
    player.play("a.mp3", { start: 2, end: 8, loop: true });
    audio.currentTime = 8;
    vi.advanceTimersByTime(40);
    expect(audio.currentTime).toBe(2);
    expect(audio.paused).toBe(false);
    expect(onEnded).not.toHaveBeenCalled();
    player.stop();
  });

  it("suspend garde playing, resume reprend à la même position", () => {
    player.play("a.mp3", { start: 0, end: 60 });
    audio.currentTime = 20;
    player.suspend();
    expect(audio.paused).toBe(true);
    expect(player.playing).toBe(true);
    player.resume();
    expect(audio.paused).toBe(false);
    expect(audio.currentTime).toBe(20);
    player.stop();
  });
});
