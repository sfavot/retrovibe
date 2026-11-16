import { describe, expect, it } from "vitest";
import { type GmPort, STALL_FRAMES, WebMusic } from "../../../src/games/gk1/audio/web-music";
import { FakeAudioContext } from "../../support/fake-audio-context";

const MS_PER_TICK = 1000 / 60;
const NOTE_ON = Uint8Array.of(0x90, 60, 100);

function setup(options: { running?: boolean; ready?: boolean } = {}) {
  const ctx = new FakeAudioContext(!(options.running ?? true));
  const game = { ticks: 0 };
  const sent: { message: Uint8Array; at: number | undefined }[] = [];
  const log: string[] = [];
  const synth = {
    ready: options.ready ?? true,
    send: (message: Uint8Array, at?: number) => void sent.push({ message, at }),
    reset: () => void log.push("reset"),
    load: async () => void log.push("load"),
    close: () => void log.push("close"),
  } satisfies GmPort;
  const music = new WebMusic({
    ctx: ctx.asContext(),
    output: {} as AudioNode,
    soundfontUrl: "gm.sf2",
    ticks: () => game.ticks,
    onSync: () => void log.push("sync"),
    createSynth: () => synth,
  });
  /** Une image du jeu de `ticks` ticks, pendant laquelle le contexte audio avance de `audioMs`. */
  const frame = (ticks = 1, audioMs = MS_PER_TICK): void => {
    music.beginFrame();
    game.ticks += ticks;
    ctx.currentTime += audioMs / 1000;
  };
  return { ctx, game, sent, log, synth, music, frame };
}

describe("WebMusic", () => {
  it("contexte en marche, une image par tick : l'horloge est celle du contexte et les messages gardent leur date", () => {
    const { music, frame, sent, ctx, log } = setup();
    for (let i = 0; i < 60; i++) frame();
    expect(music.now()).toBeCloseTo(ctx.currentTime * 1000, 6);
    music.send(NOTE_ON, music.now() + 50);
    music.send(NOTE_ON);
    expect(sent[0].at).toBeCloseTo(ctx.currentTime * 1000 + 50, 6);
    expect(sent[1].at).toBeUndefined();
    // Le pilote a renvoyé son état une fois, à la première image où la sortie était prête.
    expect(log).toEqual(["sync"]);
  });

  it("une image de plusieurs ticks : l'horloge saute des ticks en trop, les messages suivants ne partent pas plus tard", () => {
    const { music, frame, sent, ctx, game } = setup();
    frame();
    music.beginFrame();
    const before = music.now();
    game.ticks += 1;
    expect(music.now()).toBeCloseTo(before, 6);
    // Trente tranches épuisées dans la même image : trente ticks que le son n'a pas vécus.
    game.ticks += 30;
    expect(music.now()).toBeCloseTo(before + 30 * MS_PER_TICK, 6);
    music.send(NOTE_ON, music.now() + 40);
    expect(sent[0].at).toBeCloseTo(ctx.currentTime * 1000 + 40, 6);
    // Le décalage reste acquis aux images suivantes.
    ctx.currentTime += MS_PER_TICK / 1000;
    frame();
    music.send(NOTE_ON, music.now() + 40);
    expect(sent[1].at).toBeCloseTo(ctx.currentTime * 1000 + 40, 6);
    expect(sent[1].at! - sent[0].at!).toBeCloseTo(2 * MS_PER_TICK, 6);
  });

  it("deux messages datés dans la même image longue gardent leur ordre et leur écart", () => {
    const { music, frame, sent, game } = setup();
    frame();
    music.beginFrame();
    game.ticks += 5;
    const first = music.now() + 40;
    music.send(NOTE_ON, first);
    game.ticks += 3;
    // Le gestionnaire de sons date le tick suivant trois ticks plus tard sur son horloge : c'est le même instant pour le synthétiseur.
    music.send(NOTE_ON, first + 3 * MS_PER_TICK);
    expect(sent[1].at).toBeCloseTo(sent[0].at!, 6);
  });

  it("synthétiseur pas encore chargé : messages abandonnés, puis l'état du pilote est renvoyé sans coupure", () => {
    const { music, frame, sent, synth, log } = setup({ ready: false });
    frame();
    music.send(NOTE_ON, 10);
    frame();
    expect(sent).toEqual([]);
    expect(music.audible).toBe(false);
    synth.ready = true;
    frame();
    expect(log).toEqual(["sync"]);
    expect(music.audible).toBe(true);
    music.send(NOTE_ON);
    expect(sent).toHaveLength(1);
    frame();
    expect(log).toEqual(["sync"]);
  });

  it("contexte à l'arrêt : l'horloge suit le jeu ; un arrêt bref ne perd rien", () => {
    const { music, frame, sent, ctx } = setup();
    frame();
    void ctx.suspend();
    const before = music.now();
    for (let i = 0; i < 3; i++) frame(1, 0);
    music.beginFrame();
    expect(music.now()).toBeCloseTo(before + 3 * MS_PER_TICK, 6);
    music.send(NOTE_ON, music.now() + 40);
    expect(sent[0].at).toBeCloseTo(ctx.currentTime * 1000 + 40, 6);
  });

  it("contexte à l'arrêt longtemps (lecture automatique refusée) : messages abandonnés, puis coupure nette et état renvoyé à la reprise", () => {
    const { music, frame, sent, ctx, log } = setup();
    frame();
    music.send(NOTE_ON);
    void ctx.suspend();
    for (let i = 0; i <= STALL_FRAMES; i++) frame(1, 0);
    music.send(NOTE_ON, music.now() + 40);
    music.send(NOTE_ON);
    expect(sent).toHaveLength(1);
    void ctx.resume();
    frame();
    expect(log).toEqual(["sync", "reset", "sync"]);
    music.send(NOTE_ON, music.now() + 40);
    expect(sent).toHaveLength(2);
    expect(sent[1].at).toBeCloseTo(ctx.currentTime * 1000 + 40, 6);
  });

  it("load et close passent au synthétiseur", () => {
    const { music, log } = setup();
    music.load();
    music.reset();
    music.close();
    expect(log).toEqual(["load", "reset", "close"]);
  });
});
