import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebAudioBackend } from "../../src/games/teleportaschtroumpf/audio/web-audio";
import { MAX_VOLUME, VoiceChannel } from "../../src/games/teleportaschtroumpf/audio/voice";
import { Input } from "../../src/games/teleportaschtroumpf/engine/input";
import { SOUND_KEY, SoundPrefs } from "../../src/games/teleportaschtroumpf/ui/prefs";
import { FakeAudio, MemoryStorage } from "./engine-test-host";

class FakeNode {
  connect(): void {}
}

class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null;
  loop = false;
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}

class FakeContext {
  static last: FakeContext;
  state = "running";
  currentTime = 0;
  destination = new FakeNode();
  gainNode = Object.assign(new FakeNode(), { gain: { value: 1 } });
  constructor() {
    FakeContext.last = this;
  }
  createGain() {
    return this.gainNode;
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    return new FakeSource();
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
}

const sound = (seconds: number) => ({ samples: new Uint8Array(seconds * 4000).fill(128), sampleRate: 4000 });

describe("coupure du son (Web Audio)", () => {
  beforeEach(() => vi.stubGlobal("AudioContext", FakeContext));
  afterEach(() => vi.unstubAllGlobals());

  it("couper met le gain général à 0 sans arrêter les sons ; rétablir rend le volume du jeu", () => {
    const backend = new WebAudioBackend();
    backend.unlock();
    const gain = FakeContext.last.gainNode.gain;
    backend.setGain(0.5);
    backend.play(sound(10), true);
    backend.playEffect(sound(2));
    backend.setMuted(true);
    expect(gain.value).toBe(0);
    expect(backend.playing).toBe(true); // le moteur et les vidéos ne voient pas la coupure
    expect(backend.effectPlaying).toBe(true);
    backend.setMuted(false);
    expect(gain.value).toBe(0.5);
  });

  it("indépendante du volume 0 à 15 : changer le volume muet reste muet", () => {
    const backend = new WebAudioBackend();
    backend.setMuted(true); // avant le premier geste
    backend.unlock();
    const gain = FakeContext.last.gainNode.gain;
    expect(gain.value).toBe(0);
    const voice = new VoiceChannel(backend);
    voice.setVolume(7);
    expect(gain.value).toBe(0);
    backend.setMuted(false);
    expect(gain.value).toBeCloseTo(7 / MAX_VOLUME);
  });

  it("suspend fige la sortie et la position ; resume repart du même point", async () => {
    const backend = new WebAudioBackend();
    backend.unlock();
    const ctx = FakeContext.last;
    backend.play(sound(10), false);
    ctx.currentTime = 3;
    backend.suspend();
    expect(ctx.state).toBe("suspended");
    expect(backend.playing).toBe(true);
    expect(backend.position).toBe(3);
    backend.unlock(); // un geste pendant la pause ne relance pas le contexte
    expect(ctx.state).toBe("suspended");
    backend.resume();
    await new Promise((resolve) => setTimeout(resolve, 0)); // la reprise suit la promesse de suspension
    expect(ctx.state).toBe("running");
    ctx.currentTime = 4;
    expect(backend.position).toBe(4);
  });
});

describe("SoundPrefs", () => {
  it("son activé par défaut ; couper l'applique et le persiste", () => {
    const storage = new MemoryStorage();
    const audio = new FakeAudio(() => 0);
    const prefs = new SoundPrefs(storage, audio);
    expect(prefs.isEnabled()).toBe(true);
    expect(audio.muted).toBe(false);
    expect(prefs.toggle()).toBe(false);
    expect(audio.muted).toBe(true);
    expect(storage.get(SOUND_KEY)).toBe("0");
    expect(prefs.toggle()).toBe(true);
    expect(audio.muted).toBe(false);
    expect(storage.get(SOUND_KEY)).toBe("1");
  });

  it("la préférence est reprise au démarrage suivant", () => {
    const storage = new MemoryStorage();
    new SoundPrefs(storage, new FakeAudio(() => 0)).set(false);
    const audio = new FakeAudio(() => 0);
    const prefs = new SoundPrefs(storage, audio);
    expect(prefs.isEnabled()).toBe(false);
    expect(audio.muted).toBe(true);
  });

  it("reload suit le changement fait par un autre onglet, une seule fois", () => {
    const storage = new MemoryStorage();
    const audio = new FakeAudio(() => 0);
    const prefs = new SoundPrefs(storage, audio);
    expect(prefs.reload()).toBe(false);
    storage.set(SOUND_KEY, "0");
    expect(prefs.reload()).toBe(true);
    expect(audio.muted).toBe(true);
    expect(prefs.reload()).toBe(false);
  });

  it("le volume du jeu ne touche pas à la coupure", () => {
    const audio = new FakeAudio(() => 0);
    new SoundPrefs(new MemoryStorage(), audio).set(false);
    new VoiceChannel(audio).setVolume(3);
    expect(audio.muted).toBe(true);
    expect(audio.gain).toBeCloseTo(3 / MAX_VOLUME);
  });
});

describe("clavier du canvas", () => {
  it("F1, F2, Espace, Entrée, flèches et Échap sont pris par le jeu (l'hôte bloque alors le comportement du navigateur)", () => {
    const input = new Input();
    for (const code of ["F1", "F2", "Space", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape"]) {
      expect(input.keyDown(code), code).toBe(true);
      expect(input.keyUp(code), code).toBe(true);
    }
  });
});
