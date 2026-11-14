import { type IntroAudio, type IntroDisk, type IntroVoice, BassIntro, INTRO_TICK_MS } from "../../../src/games/bass/engine/sequences/intro";
import type { IntroCommand } from "../../../src/games/bass/engine/sequences/intro-script";
import { IntroCanvas } from "../../../src/games/bass/engine/sequences/intro-screen";

/** Image de 64 000 octets, palette de 768, séquence de `frames` images vides (chacune parcourt les 61 440 pixels sans rien copier). */
export function flirtData(frames: number): Uint8Array {
  const frame = [...new Array<number>(240).fill(0xff), 240, 0];
  return Uint8Array.from([frames, ...Array.from({ length: frames }, () => frame).flat()]);
}

/** Disque de test : chaque identifiant est un fichier dont la nature est donnée par `kinds`. */
export class FakeDisk implements IntroDisk {
  readonly loads: number[] = [];
  private readonly files = new Map<number, Uint8Array>();

  constructor(readonly voiceMs = 1000) {}

  set(id: number, data: Uint8Array): this {
    this.files.set(id, data);
    return this;
  }

  has(id: number): boolean {
    return this.files.has(id);
  }

  load(id: number): Uint8Array {
    const data = this.files.get(id);
    if (!data) throw new Error(`fichier ${id} absent`);
    this.loads.push(id);
    return new Uint8Array(data);
  }

  image(id: number, value = 7): this {
    return this.set(id, new Uint8Array(64000).fill(value));
  }
  palette(id: number, value = 63): this {
    return this.set(id, new Uint8Array(768).fill(value));
  }
  flirt(id: number, frames = 5): this {
    return this.set(id, flirtData(frames));
  }
  voice(id: number, ms = this.voiceMs): this {
    return this.set(id, new Uint8Array(Math.round((ms * 11025) / 1000)).fill(200));
  }
  background(id: number, payload = 5000): this {
    return this.set(id, new Uint8Array(256 + payload + 768).fill(150));
  }

  /** Les fichiers de l'écran de Virgin. */
  virgin(): this {
    return this.image(60110).palette(60111);
  }
}

export interface Entry {
  /** Millisecondes de l'introduction. */
  ms: number;
  what: string;
}

/** L'introduction branchée sur des espions : écran réel (`IntroCanvas`) dont les appels sont journalisés, son enregistré. */
export function harness(disk: FakeDisk, script: readonly IntroCommand[], options: { pollSkip?: () => boolean; log?: (message: string) => void } = {}) {
  const log: Entry[] = [];
  let intro!: BassIntro;
  const note = (what: string): void => {
    log.push({ ms: intro.clockMs, what });
  };

  class SpyScreen extends IntroCanvas {
    override showScreen(image: Uint8Array, fullscreen: boolean): void {
      note(`showScreen ${image[0]} ${fullscreen}`);
      super.showScreen(image, fullscreen);
    }
    override setPalette(vga: Uint8Array): void {
      note("setPalette");
      super.setPalette(vga);
    }
    override beginFadeUp(vga: Uint8Array): void {
      note("beginFadeUp");
      super.beginFadeUp(vga);
    }
    override fadeUpStep(step: number): void {
      if (step === 1 || step === 32) note(`fadeUpStep ${step}`);
      super.fadeUpStep(step);
    }
    override fadeDownStep(): void {
      note("fadeDownStep");
      super.fadeDownStep();
    }
    override startSequence(data: Uint8Array, now: number): void {
      note(`startSequence ${data[0]}`);
      super.startSequence(data, now);
    }
    override stopSequence(): void {
      note("stopSequence");
      super.stopSequence();
    }
    override clearBottom(): void {
      note("clearBottom");
      super.clearBottom();
    }
  }

  const voices: { pcm: Uint8Array; stopped: boolean; endAt: number }[] = [];
  const audio: IntroAudio & { background: { pcm: Uint8Array; loop: boolean }[]; stopped: boolean } = {
    background: [],
    stopped: false,
    loadSection: (section) => note(`loadSection ${section}`),
    startMusic: (song) => note(`startMusic ${song}`),
    playVoice(pcm) {
      const voice = { pcm, stopped: false, endAt: intro.clockMs + (pcm.length / 11025) * 1000 };
      voices.push(voice);
      note(`playVoice ${pcm.length}`);
      const handle: IntroVoice = {
        get playing() {
          return !voice.stopped && intro.clockMs < voice.endAt;
        },
        stop() {
          voice.stopped = true;
          note("voice stopped");
        },
      };
      return handle;
    },
    playBackground(pcm, loop) {
      audio.background.push({ pcm, loop });
      note(`playBackground ${pcm.length} ${loop}`);
    },
    stopBackground() {
      note("stopBackground");
    },
  };

  const canvas = new SpyScreen();
  intro = new BassIntro({ disk, audio, screen: canvas, script, pollSkip: options.pollSkip, log: options.log });

  /** Avance tick par tick jusqu'à la fin ; rend le temps (ms) de fin. */
  function runToEnd(maxTicks = 100_000): number {
    intro.start();
    let end = intro.clockMs;
    for (let t = 0; intro.running; t++) {
      if (t > maxTicks) throw new Error("introduction sans fin");
      end = intro.clockMs;
      intro.tick();
    }
    return end;
  }

  /** Temps du premier appel `what` ; échoue s'il n'y en a pas. */
  const at = (what: string | RegExp, nth = 0): number => {
    const hits = log.filter((e) => (typeof what === "string" ? e.what === what : what.test(e.what)));
    const hit = hits[nth];
    if (!hit) throw new Error(`appel ${String(what)} absent : ${log.map((e) => `${e.ms} ${e.what}`).join(" | ")}`);
    return hit.ms;
  };

  return { intro, log, audio, voices, canvas, runToEnd, at, TICK_MS: INTRO_TICK_MS };
}
