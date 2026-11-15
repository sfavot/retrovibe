import type { AdlibOutput, SoundBackend } from "../../../src/engine/coktel/audio/backend";
import type { SpeakerOutput } from "../../../src/engine/coktel/audio/pcspeaker";
import { HeadlessHost } from "../../../src/engine/coktel/host";
import { MemoryStorage } from "../../../src/engine/storage";
import { WeenGame, createWeenSystem } from "../../../src/games/ween/engine/ween";
import { readOriginalStk, type BenchInput } from "../engine/bench";

/** Appel reçu par le backend ou par le moteur de son, avec l'image et l'horloge du jeu au moment de l'appel. */
export interface AudioEvent {
  image: number;
  ms: number;
  /** `adl.load 1234`, `adl.play`, `pcm 8000@7714 x1`, `speaker.play 440 Infinity`, `composition [..]`... */
  what: string;
}

class StopRun extends Error {}

/** Joue Ween en mémoire, comme le banc (horloge exacte, 600 ms au départ), et note tout ce qui touche au son. */
export async function runAudio(
  stopImage: number,
  inputs: BenchInput[] = [],
  onImage?: (n: number, game: WeenGame) => void,
): Promise<{ events: AudioEvent[]; adls: Uint8Array[]; game: WeenGame; host: HeadlessHost }> {
  const host = new HeadlessHost({
    readFile: (name) => (name.toUpperCase() === "INTRO.STK" ? readOriginalStk() : undefined),
    exactTime: true,
  });
  host.time = 600;
  host.input.mouseX = 0;
  host.input.mouseY = 0;
  host.input.setMousePos = () => {};
  const events: AudioEvent[] = [];
  /** Fichiers ADL remis au lecteur, dans l'ordre. */
  const adls: Uint8Array[] = [];
  const note = (what: string) => void events.push({ image: host.images, ms: host.time, what });

  const adlib: AdlibOutput = {
    onStopped: null,
    load: (d) => {
      adls.push(d.slice());
      note(`adl.load ${d.length}`);
    },
    unload: () => note("adl.unload"),
    setRepeating: (n) => note(`adl.repeat ${n}`),
    play: () => note("adl.play"),
    stop: () => note("adl.stop"),
  };
  const speaker: SpeakerOutput = {
    play: (f, d) => note(`speaker.play ${f} ${d}`),
    stop: (d) => note(`speaker.stop ${d}`),
  };
  const backend: SoundBackend = {
    adlib,
    speaker,
    playSample: (pcm, rate, passes) => note(`pcm ${pcm.length}@${rate} x${passes}`),
    stopSample: (fade) => note(`pcm.stop ${fade}`),
    queuePcm: (pcm, rate) => note(`queue ${pcm.length}@${rate}`),
    clearQueue: () => note("clear"),
  };
  const system = createWeenSystem({ host, soundBackend: backend, store: new MemoryStorage() });
  const sound = system.sys.sound;
  const composition = sound.playComposition.bind(sound);
  sound.playComposition = (c, f) => {
    note(`composition [${c.filter((s) => s !== -1).join(",")}]`);
    return composition(c, f);
  };
  const waitEnd = sound.waitEndPlay.bind(sound);
  sound.waitEndPlay = () => {
    note("waitEndPlay");
    return waitEnd();
  };
  const game = new WeenGame(host, system.sys, { maxSteps: 50_000_000 });

  const pending: { image: number; apply: () => void }[] = [];
  for (const input of inputs) {
    if ("key" in input) pending.push({ image: input.image, apply: () => host.input.pushKey(0x011b) });
    else if ("move" in input) {
      const [x, y] = input.move;
      pending.push({ image: input.image, apply: () => Object.assign(host.input, { mouseX: x, mouseY: y }) });
    } else {
      const [x, y] = input.click;
      pending.push({ image: input.image, apply: () => Object.assign(host.input, { mouseX: x, mouseY: y, mouseButtons: 1 }) });
      pending.push({ image: input.image + 1, apply: () => (host.input.mouseButtons = 0) });
    }
  }
  pending.sort((a, b) => a.image - b.image);
  host.onImage = (n) => {
    onImage?.(n, game);
    while (pending.length && pending[0].image <= n) pending.shift()!.apply();
    if (n >= stopImage) throw new StopRun();
  };
  try {
    await game.start();
  } catch (e) {
    if (!(e instanceof StopRun)) throw e;
  }
  return { events, adls, game, host };
}
