import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoundEngine } from "../../../src/engine/coktel/audio/sound";
import { SPEAKER_GAIN } from "../../../src/engine/coktel/audio/pcspeaker";
import { WebAudioSoundBackend } from "../../../src/engine/coktel/audio/web-audio";
import { disassemble, opcodeTable } from "../../../src/engine/coktel/opcodes";
import { loadResources } from "../../../src/engine/coktel/resources";
import { Script } from "../../../src/engine/coktel/script";
import { FakeAudioContext } from "../../support/fake-audio-context";
import { hasOriginalFiles, loadIntro } from "../helpers";
import { runAudio } from "./harness";

/**
 * Haut-parleur du PC de Ween (`o1_speakerOn` / `o1_speakerOff`, `inter_v1.cpp:1480-1505`, sans le contournement de Gobliins 2).
 * Appels dans les TOT : `MENU` @4038-4054 (deux bips), `EMAJ1031` @133-135 (trois `speakerOff`, aucun `speakerOn`),
 * `INTRO` @1508 / `INTRO5` @2183 (grille de protection, sautée au banc comme ici).
 */
describe.skipIf(!hasOriginalFiles)("haut-parleur : chemin réel du script", () => {
  it("MENU : le bloc des deux bips (@4033) joue 500 Hz puis 100 Hz, 50 ms chacun, sur l'horloge du jeu", async () => {
    const { events, game, host } = await runAudio(60, [{ image: 20, key: "ESC" }]);
    expect(game.curTotFile.toUpperCase()).toBe("MENU.TOT");
    const start = events.length;
    const t0 = host.time;
    host.onImage = null;
    // Bloc d'instructions de MENU.TOT (en-tête type 1, 6 commandes, 19 octets) : speakerOn(500), keyFunc(50), speakerOff, speakerOn(100), keyFunc(50), speakerOff
    expect(Array.from(game.inter.script.data.slice(4033, 4036))).toEqual([1, 6, 19]);
    await game.inter.runFunction(4033);
    expect(events.slice(start).map((e) => [e.ms - t0, e.what])).toEqual([
      [0, "speaker.play 500 Infinity"],
      [0, "speaker.stop 50"], // o1_keyFunc(50) : PCSpeaker::onUpdate, la note finit avec l'attente
      [50, "speaker.stop 0"], // o1_speakerOff
      [50, "speaker.play 100 Infinity"],
      [50, "speaker.stop 50"],
      [100, "speaker.stop 0"],
    ]);
    expect(host.time - t0).toBe(100);
    const speaker = (game.sys.sound as SoundEngine).speaker;
    expect([speaker.frequency, speaker.playing]).toEqual([100, false]);
  });

  it("EMAJ1031 : trois speakerOff à l'entrée de la salle, jamais de speakerOn (aucun bip)", () => {
    const res = loadResources(loadIntro(), "EMAJ1031.TOT", "fr")!;
    const ops = disassemble(new Script("EMAJ1031.TOT", res.tot.script, res.tot.header), res, [], opcodeTable(2));
    const speaker = ops.filter((o) => o.name.includes("speaker"));
    expect(speaker.map((o) => [o.offset, o.name])).toEqual([
      [133, "o1_speakerOff"],
      [134, "o1_speakerOff"],
      [135, "o1_speakerOff"],
    ]);
  });
});

/** Sortie navigateur : oscillateur carré au gain de ScummVM, remplacé par chaque nouvelle note, durée finie ou arrêt différé. */
class FakeOscillator {
  type = "";
  frequency = { value: 0 };
  started = false;
  stops: (number | undefined)[] = [];
  onended: (() => void) | null = null;
  constructor(readonly context: SpeakerContext) {}
  connect<T>(node: T): T {
    return node;
  }
  start(): void {
    this.started = true;
  }
  stop(at?: number): void {
    this.stops.push(at);
  }
}

class SpeakerContext extends FakeAudioContext {
  audioWorklet = { addModule: () => new Promise<void>(() => {}) };
  oscillators: FakeOscillator[] = [];
  constructor() {
    super();
    contexts.push(this);
  }
  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator(this);
    this.oscillators.push(osc);
    return osc;
  }
}
const contexts: SpeakerContext[] = [];

describe("haut-parleur : sortie Web Audio", () => {
  beforeEach(() => {
    contexts.length = 0;
    vi.stubGlobal("AudioContext", SpeakerContext);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("onde carrée à la fréquence demandée, arrêt différé, note suivante qui remplace la précédente", () => {
    const backend = new WebAudioSoundBackend({ now: () => 0 });
    backend.unlock();
    const ctx = contexts[0];
    backend.speaker.play(500, Infinity);
    const [first] = ctx.oscillators;
    expect([first.type, first.frequency.value, first.started, first.stops]).toEqual(["square", 500, true, []]);
    expect(ctx.gains.at(-1)!.gain.value).toBeCloseTo(SPEAKER_GAIN, 10);
    backend.speaker.stop(50); // fin de note 50 ms plus loin (keyFunc)
    expect(first.stops).toEqual([0.05]);
    backend.speaker.stop(0);
    expect(first.stops).toHaveLength(2);
    backend.speaker.play(100, 5);
    const second = ctx.oscillators[1];
    expect([second.frequency.value, second.stops]).toEqual([100, [0.005]]);
    backend.speaker.play(1000, Infinity); // remplace la note en cours
    expect(second.stops).toHaveLength(2);
    expect(ctx.oscillators[2].frequency.value).toBe(1000);
  });
});
