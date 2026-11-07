import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../../src/engine/storage";
import { DrasculaAudio, createSoundPrefs } from "../../../src/games/drascula/audio/audio";
import { trackFile } from "../../../src/games/drascula/audio/music";
import type { SoundFiles } from "../../../src/games/drascula/audio/voice";
import type { DrasculaHost } from "../../../src/games/drascula/engine/host";
import { FakeAudioContext } from "../../support/fake-audio-context";
import { ManualClock } from "../../support/fake-host";

// L'audio doit pouvoir servir de partie « son » de l'hôte.
type SoundPart = Pick<DrasculaHost, "playSound" | "stopSound" | "soundActive" | "playMusic" | "stopMusic" | "musicPlaying">;
const _check = (audio: DrasculaAudio): SoundPart => audio;
void _check;

class FakeAudio {
  paused = true;
  ended = false;
  muted = false;
  preload = "";
  src = "";
  readyState = 4;
  currentTime = 0;
  plays = 0;
  addEventListener(): void {}
  play(): Promise<void> {
    this.paused = false;
    this.plays++;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

/** Fichier `.ALS` de `samples` échantillons utiles (+ 64 octets de marge) : dure samples / 11 025 s. */
const als = (samples: number): Uint8Array => new Uint8Array(samples + 64).fill(0x80);

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe("DrasculaAudio", () => {
  let clock: ManualClock;
  let ctx: FakeAudioContext;
  let element: FakeAudio;
  let audio: DrasculaAudio;
  let files: Map<string, Uint8Array>;
  let loads: Array<() => void>;
  let deferred: boolean;

  const src: SoundFiles = {
    has: (name) => files.has(name.toLowerCase()),
    load: (name) => {
      const bytes = files.get(name.toLowerCase())!;
      if (!deferred) return bytes;
      return new Promise<Uint8Array>((resolve) => loads.push(() => resolve(bytes)));
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    clock = new ManualClock();
    ctx = new FakeAudioContext();
    element = new FakeAudio();
    deferred = false;
    loads = [];
    files = new Map([
      ["214.als", als(11025)], // 1 s
      ["s3.als", als(5512)], // ~0,5 s
    ]);
    audio = new DrasculaAudio({
      now: () => clock.now(),
      files: src,
      trackUrl: (file) => `./drascula/${file}`,
      createContext: () => ctx.asContext(),
      createAudio: () => element as unknown as HTMLAudioElement,
    });
  });

  describe("voix et effets", () => {
    it("une voix est en cours pendant sa durée puis se termine (attente de fin de voix)", () => {
      expect(audio.playSound("214.ALS")).toBe(true);
      expect(audio.soundActive()).toBe(true);
      clock.advance(999);
      expect(audio.soundActive()).toBe(true);
      clock.advance(1);
      expect(audio.soundActive()).toBe(false);
    });

    it("un fichier absent rend faux et ne laisse aucun son en cours", () => {
      expect(audio.playSound("999.als")).toBe(false);
      expect(audio.soundActive()).toBe(false);
    });

    it("un nouveau son remplace l'ancien sur l'unique voie, stopSound l'arrête", async () => {
      audio.unlock();
      await flush();
      audio.playSound("214.als");
      audio.playSound("s3.als");
      expect(ctx.sources[0].stopped).toBe(true);
      expect(ctx.sources[1].stopped).toBe(false);
      clock.advance(600); // fin de s3, bien avant celle de 214
      expect(audio.soundActive()).toBe(false);
      audio.playSound("214.als");
      audio.stopSound();
      expect(audio.soundActive()).toBe(false);
    });

    it("saute les 32 octets de marge de chaque bout", async () => {
      audio.unlock();
      await flush();
      audio.playSound("214.als");
      expect(ctx.sources[0].buffer?.length).toBe(11025);
    });

    it("un chargement différé est « en cours » dès l'appel, démarre à l'arrivée du fichier", async () => {
      deferred = true;
      audio.unlock();
      await flush();
      expect(audio.playSound("214.als")).toBe(true);
      expect(audio.soundActive()).toBe(true);
      expect(ctx.sources).toHaveLength(0);
      clock.advance(200);
      loads[0]();
      await flush();
      expect(ctx.sources).toHaveLength(1);
      clock.advance(999);
      expect(audio.soundActive()).toBe(true);
      clock.advance(1);
      expect(audio.soundActive()).toBe(false);
    });

    it("un chargement périmé (son remplacé ou arrêté) ne joue rien", async () => {
      deferred = true;
      audio.unlock();
      await flush();
      audio.playSound("214.als");
      audio.stopSound();
      loads[0]();
      await flush();
      expect(ctx.sources).toHaveLength(0);
      expect(audio.soundActive()).toBe(false);
    });

    it("un chargement qui échoue libère la voie", async () => {
      const load = src.load;
      src.load = () => Promise.reject(new Error("404"));
      try {
        audio.playSound("214.als");
        await flush();
        expect(audio.soundActive()).toBe(false);
      } finally {
        src.load = load;
      }
    });
  });

  describe("coupure du son", () => {
    it("ne décale pas le temps du jeu : la voix dure autant, coupée ou non", async () => {
      audio.unlock();
      await flush();
      audio.setMuted(true);
      audio.playSound("214.als");
      clock.advance(500);
      expect(audio.soundActive()).toBe(true);
      audio.setMuted(false);
      clock.advance(499);
      expect(audio.soundActive()).toBe(true);
      clock.advance(1);
      expect(audio.soundActive()).toBe(false);
      expect(ctx.gains[0].gain.value).toBe(1);
    });

    it("coupe aussi la musique sans l'arrêter", () => {
      audio.playMusic(7);
      audio.setMuted(true);
      expect(element.muted).toBe(true);
      expect(audio.musicPlaying()).toBe(true);
      expect(element.paused).toBe(false);
    });

    it("la préférence « Son » est persistée et appliquée au démarrage", () => {
      const storage = new MemoryStorage();
      const prefs = createSoundPrefs(storage, audio);
      expect(prefs.isEnabled()).toBe(true);
      prefs.set(false);
      expect(storage.get("retrovibe:drascula:sound")).toBe("0");
      expect(element.muted).toBe(true);
      const other = new DrasculaAudio({
        now: () => clock.now(),
        files: src,
        trackUrl: (f) => f,
        createContext: () => ctx.asContext(),
        createAudio: () => element as unknown as HTMLAudioElement,
      });
      expect(createSoundPrefs(storage, other).isEnabled()).toBe(false);
      other.unlock();
      expect(ctx.gains.at(-1)?.gain.value).toBe(0);
    });
  });

  describe("musique", () => {
    it("joue la piste de la pièce : track<n>.mp3 depuis le début", () => {
      audio.playMusic(7);
      expect(element.src).toBe("./drascula/track7.mp3");
      expect(element.currentTime).toBe(0);
      expect(audio.musicPlaying()).toBe(true);
      expect(audio.musicTrack).toBe(7);
      audio.playMusic(28);
      expect(element.src).toBe("./drascula/track28.mp3");
      expect(trackFile(28)).toBe("track28.mp3");
    });

    it("rend faux à la fin de la piste (la boucle principale la relance), pas avant", () => {
      audio.playMusic(7);
      vi.advanceTimersByTime(1000);
      expect(audio.musicPlaying()).toBe(true);
      element.ended = true;
      vi.advanceTimersByTime(40);
      expect(audio.musicPlaying()).toBe(false);
      element.ended = false;
      element.currentTime = 99;
      audio.playMusic(7); // relance
      expect(element.currentTime).toBe(0);
      expect(audio.musicPlaying()).toBe(true);
    });

    it("rien ne se relance tant que le flux n'a pas démarré (autoplay, chargement)", () => {
      element.readyState = 0;
      audio.playMusic(9);
      expect(audio.musicPlaying()).toBe(true);
    });

    it("stopMusic arrête ; une piste inconnue arrête aussi", () => {
      audio.playMusic(7);
      audio.stopMusic();
      expect(audio.musicPlaying()).toBe(false);
      expect(element.paused).toBe(true);
      audio.playMusic(7);
      audio.playMusic(0);
      expect(audio.musicPlaying()).toBe(false);
      audio.playMusic(32);
      expect(audio.musicPlaying()).toBe(false);
      expect(audio.musicTrack).toBe(0);
    });

    it("unlock relance un flux bloqué ; suspend / resume mettent en pause et reprennent", () => {
      audio.playMusic(7);
      element.paused = true; // bloqué par l'autoplay
      audio.unlock();
      expect(element.paused).toBe(false);
      audio.suspend();
      expect(element.paused).toBe(true);
      expect(audio.musicPlaying()).toBe(true);
      audio.resume();
      expect(element.paused).toBe(false);
    });
  });

  describe("pause de l'onglet", () => {
    it("une voix ne vieillit pas pendant la pause", async () => {
      audio.unlock();
      await flush();
      audio.playSound("214.als");
      clock.advance(400);
      audio.suspend();
      clock.advance(60_000);
      expect(audio.soundActive()).toBe(true);
      audio.resume();
      await flush();
      clock.advance(599);
      expect(audio.soundActive()).toBe(true);
      clock.advance(1);
      expect(audio.soundActive()).toBe(false);
    });
  });
});
