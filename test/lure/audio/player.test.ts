import { describe, expect, it } from "vitest";
import { parseSong } from "../../../src/audio/smf";
import { META_END_OF_TRACK, META_SEQUENCER } from "../../../src/games/lure/audio/adlib-multisource";
import { SmfPlayer, TIMER_PERIOD_US, type MidiTarget } from "../../../src/games/lure/audio/smf-player";
import { buildSmf, instrument, noteOff, noteOn, tempo } from "./smf-builder";

/** Pilote factice : note les appels avec le numéro de l'appel de minuterie en cours. */
class Recorder implements MidiTarget {
  timer = 0;
  readonly calls: string[] = [];
  send(source: number, status: number, data1: number, data2: number): void {
    this.calls.push(`${this.timer} send ${source} ${status.toString(16)} ${data1} ${data2}`);
  }
  metaEvent(source: number, type: number, data: Uint8Array): void {
    this.calls.push(`${this.timer} meta ${source} ${type.toString(16)} ${data.length}`);
  }
  deinitSource(source: number): void {
    this.calls.push(`${this.timer} deinit ${source}`);
  }
}

function play(smf: Uint8Array, options: { loop?: boolean; timers: number; source?: number }): Recorder {
  const target = new Recorder();
  const player = new SmfPlayer(target);
  player.start(parseSong(smf), options.source ?? 1, options.loop ?? false);
  for (target.timer = 1; target.timer <= options.timers; target.timer++) player.tick();
  return target;
}

describe("lecteur SMF : minuterie de 250 Hz", () => {
  it("une minuterie dure 4 ms", () => {
    expect(TIMER_PERIOD_US).toBe(4000);
  });

  it("96 ticks par noire à 120 bpm : 5 208 µs par tick (arrondi de ScummVM), un événement part à l'appel qui contient sa date", () => {
    // Note off au tick 96 : 96 * 5208 = 499 968 µs ; 124 appels couvrent 496 000 µs, le 125e 500 000 µs.
    const target = play(buildSmf([noteOn(0, 60), noteOff(96, 60)]), { timers: 130 });
    expect(target.calls.filter((c) => c.includes("send"))).toEqual(["1 send 1 90 60 100", "125 send 1 80 60 0"]);
  });

  it("un événement de tempo du fichier change la durée des ticks suivants", () => {
    // 250 000 µs par noire : (250 000 + 24) / 96 = 2 604 µs par tick ; tick 96 à 249 984 µs, soit le 63e appel.
    const target = play(buildSmf([tempo(0, 250_000), noteOn(0, 60), noteOff(96, 60)]), { timers: 70 });
    expect(target.calls.filter((c) => c.includes("send"))).toEqual(["1 send 1 90 60 100", "63 send 1 80 60 0"]);
  });

  it("420 ticks par noire (les sons du jeu) : 1 190 µs par tick", () => {
    // Tick 420 : 420 * 1 190 = 499 800 µs, soit le 125e appel.
    const target = play(buildSmf([noteOn(0, 60), noteOff(420, 60)], { division: 420 }), { timers: 130 });
    expect(target.calls.filter((c) => c.includes("send"))[1]).toBe("125 send 1 80 60 0");
  });

  it("un Note On de vélocité 0 part comme un Note Off", () => {
    // 10 ticks : 52 080 µs, soit le 14e appel.
    const target = play(buildSmf([noteOn(0, 60), { delta: 10, bytes: [0x90, 60, 0] }]), { timers: 20 });
    expect(target.calls.filter((c) => c.includes("send"))).toEqual(["1 send 1 90 60 100", "14 send 1 80 60 0"]);
  });

  it("transmet les méta-événements du séquenceur (instruments) au pilote", () => {
    const target = play(buildSmf([instrument(0, 3, new Array<number>(28).fill(1)), noteOn(0, 60)]), { timers: 2 });
    expect(target.calls[0]).toBe(`1 meta 1 ${META_SEQUENCER.toString(16)} 34`);
  });

  it("sans boucle : à la fin de piste, la source est rendue au pilote et le morceau s'arrête", () => {
    const smf = buildSmf([noteOn(0, 60), noteOff(24, 60)], { endDelta: 24 });
    const target = new Recorder();
    const player = new SmfPlayer(target);
    const playback = player.start(parseSong(smf), 2, false);
    for (target.timer = 1; target.timer <= 100; target.timer++) player.tick();
    expect(playback.playing).toBe(false);
    expect(target.calls.filter((c) => c.includes("deinit") || c.includes(`meta 2 ${META_END_OF_TRACK.toString(16)}`))).toEqual([expect.stringMatching(/ deinit 2$/), expect.stringMatching(/ meta 2 2f 0$/)]);
    // Plus aucun événement après la fin.
    const count = target.calls.length;
    for (let i = 0; i < 20; i++) player.tick();
    expect(target.calls).toHaveLength(count);
  });

  it("avec boucle : notes tenues coupées à la fin, reprise du tick 0 à l'appel suivant, jamais rendue au pilote", () => {
    // Fin de piste au tick 48 (249 984 µs, 63e appel) avec une note encore tenue ; le début rejoue à l'appel suivant (reste de l'intervalle perdu).
    const smf = buildSmf([noteOn(0, 60), noteOn(0, 64, 100, 2)], { endDelta: 48 });
    const target = play(smf, { loop: true, timers: 130 });
    const sends = target.calls.filter((c) => c.includes("send"));
    expect(sends.slice(0, 2)).toEqual(["1 send 1 90 60 100", "1 send 1 92 64 100"]);
    // Notes coupées dans l'ordre des notes puis des canaux, à l'appel de la fin de piste (63).
    expect(sends.slice(2, 4)).toEqual(["63 send 1 80 60 0", "63 send 1 82 64 0"]);
    expect(sends.slice(4, 6)).toEqual(["64 send 1 90 60 100", "64 send 1 92 64 100"]);
    // La deuxième boucle suit le même rythme : 63 appels + 1 de reprise.
    expect(sends.slice(8, 10)).toEqual(["127 send 1 90 60 100", "127 send 1 92 64 100"]);
    expect(target.calls.some((c) => c.includes("deinit"))).toBe(false);
  });

  it("deux sources jouent en même temps sans se gêner", () => {
    const target = new Recorder();
    const player = new SmfPlayer(target);
    player.start(parseSong(buildSmf([noteOn(0, 60), noteOff(24, 60)])), 0, true);
    player.start(parseSong(buildSmf([noteOn(0, 70), noteOff(48, 70)])), 5, false);
    for (target.timer = 1; target.timer <= 130; target.timer++) player.tick();
    expect(target.calls.filter((c) => c.includes("send 5"))).toEqual(["1 send 5 90 70 100", "63 send 5 80 70 0"]);
    expect(target.calls.filter((c) => c.includes("send 0")).length).toBeGreaterThan(4);
  });

  it("pause : les notes sont coupées, le temps du morceau s'arrête, la reprise ne rejoue pas ce qui est passé", () => {
    const smf = buildSmf([noteOn(0, 60), noteOff(96, 60)]);
    const target = new Recorder();
    const player = new SmfPlayer(target);
    player.start(parseSong(smf), 1, false);
    for (target.timer = 1; target.timer <= 10; target.timer++) player.tick();
    player.pause();
    expect(target.calls.at(-1)).toBe("11 send 1 80 60 0");
    for (; target.timer <= 400; target.timer++) player.tick();
    expect(target.calls).toHaveLength(2);
    player.resume();
    for (; target.timer <= 530; target.timer++) player.tick();
    // Le Note Off du fichier arrive 115 appels après la reprise : 10 appels déjà joués (40 000 µs), il en faut 115 de plus pour atteindre 499 968 µs.
    expect(target.calls.filter((c) => c.includes("send"))).toEqual(["1 send 1 90 60 100", "11 send 1 80 60 0", "515 send 1 80 60 0"]);
  });

  it("retirer un morceau coupe ses notes et rend sa source", () => {
    const target = new Recorder();
    const player = new SmfPlayer(target);
    const playback = player.start(parseSong(buildSmf([noteOn(0, 60), noteOff(96, 60)])), 3, false);
    target.timer = 1;
    player.tick();
    player.remove(playback);
    expect(target.calls).toEqual(["1 send 3 90 60 100", "1 send 3 80 60 0", "1 deinit 3"]);
  });
});
