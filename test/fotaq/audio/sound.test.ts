import { describe, expect, it } from "vitest";
import type { SampleChannel } from "../../../src/games/fotaq/audio/channel";
import { QueenSound, type MusicControl } from "../../../src/games/fotaq/audio/sound";

class FakeMusic implements MusicControl {
  readonly calls: string[] = [];
  queueTuneList(tune: number): void {
    this.calls.push(`queue ${tune}`);
  }
  playMusic(): void {
    this.calls.push("play");
  }
  stopSong(): void {
    this.calls.push("stop");
  }
  toggleVChange(): void {
    this.calls.push("toggle");
  }
}

class FakeChannel {
  readonly played: string[] = [];
  stops = 0;
  active = false;
  found = true;
  play(name: string): boolean {
    this.played.push(name);
    return this.found;
  }
  stop(): void {
    this.stops++;
  }
}

function setup() {
  const music = new FakeMusic();
  const sfx = new FakeChannel();
  const speech = new FakeChannel();
  const sound = new QueenSound({ music, sfx: sfx as unknown as SampleChannel, speech: speech as unknown as SampleChannel });
  return { music, sfx, speech, sound };
}

describe("QueenSound.playSong (PCSound::playSong)", () => {
  it("un morceau de musique (override 1) charge sa liste, la joue et est retenu", () => {
    const { music, sound } = setup();
    sound.playSong(1); // Hotel Gangsters : liste 1 (indice 0)
    expect(music.calls).toEqual(["queue 0", "play"]);
    expect(sound.lastOverride).toBe(1);
    sound.playSong(88); // Intro Credits
    expect(music.calls.slice(-2)).toEqual(["queue 90", "play"]);
    expect(sound.lastOverride).toBe(88);
  });

  it("un numéro nul ou négatif arrête la musique ; un numéro hors table est ignoré", () => {
    const { music, sound } = setup();
    sound.playSong(0);
    sound.playSong(-5);
    expect(music.calls).toEqual(["stop", "stop"]);
    sound.playSong(5000);
    expect(music.calls).toHaveLength(2);
  });

  it("un morceau dont la liste a un effet joue l'effet et rien d'autre", () => {
    const { music, sfx, sound } = setup();
    sound.playSong(25); // Open Door (standard) : liste 28, effet 1 = 116BSSSS
    expect(sfx.played).toEqual(["116BSSSS"]);
    expect(music.calls).toEqual([]);
    sound.sfxOn = false;
    sound.playSong(25);
    expect(sfx.played).toHaveLength(1); // effets coupés : rien, et la musique non plus
    expect(music.calls).toEqual([]);
  });

  it("override 2 sans effet bascule le volume (Vnormal) ; override 0 ne fait rien", () => {
    const { music, sound } = setup();
    sound.playSong(5); // Vnormal
    expect(music.calls).toEqual(["toggle"]);
    sound.playSong(4); // Waterfall On : override 0
    sound.playSong(22); // Waterfall Off : override 0
    expect(music.calls).toEqual(["toggle"]);
  });

  it("musique coupée : rien n'est joué ni retenu, et la rallumer rejoue le dernier morceau retenu", () => {
    const { music, sound } = setup();
    sound.playSong(3);
    sound.musicOn = false;
    sound.playSong(1);
    expect(sound.lastOverride).toBe(3);
    sound.musicOn = true;
    sound.playLastSong();
    expect(music.calls.slice(-2)).toEqual(["queue 2", "play"]);
  });
});

describe("QueenSound : effets et voix", () => {
  it("playSfx : 0 ne joue rien, un numéro hors table non plus, sinon le fichier de _sfxName", () => {
    const { sfx, sound } = setup();
    sound.playSfx(0);
    sound.playSfx(500);
    expect(sfx.played).toEqual([]);
    sound.playSfx(2);
    expect(sfx.played).toEqual(["105ASSSS"]);
    expect(sound.speechSfxExists).toBe(false);
  });

  it("playSpeech remplace les espaces par des zéros, met en majuscules et retient si le fichier existe", () => {
    const { speech, sound } = setup();
    sound.playSpeech("02 1P2 1");
    expect(speech.played).toEqual(["0201P201"]);
    expect(sound.speechSfxExists).toBe(true);
    speech.found = false;
    sound.playSpeech("c21a_012");
    expect(speech.played[1]).toBe("C21A_012");
    expect(sound.speechSfxExists).toBe(false);
  });

  it("voix coupées : playSpeech ne fait rien et ne touche pas speechSfxExists", () => {
    const { speech, sound } = setup();
    sound.speechOn = false;
    sound.playSpeech("020001P2");
    expect(speech.played).toEqual([]);
  });

  it("stopSpeech et stopSfx arrêtent leur voie", () => {
    const { sfx, speech, sound } = setup();
    sound.stopSpeech();
    sound.stopSfx();
    expect([speech.stops, sfx.stops]).toEqual([1, 1]);
  });
});
