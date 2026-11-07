import { describe, expect, it } from "vitest";
import { WebSampleOutput } from "../../src/audio/web-sample-output";
import { FakeAudioContext } from "../support/fake-audio-context";
import { ManualClock } from "../support/fake-host";

/** 1 s à 8 kHz. */
const SECOND = { data: new Float32Array(8000), rate: 8000 };

function setup(autoplay = true) {
  const clock = new ManualClock();
  const ctx = new FakeAudioContext(autoplay);
  const output = new WebSampleOutput({ now: () => clock.now(), createContext: () => ctx.asContext() });
  return { clock, ctx, output };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe("WebSampleOutput", () => {
  it("ne crée le contexte qu'à unlock et le reprend", async () => {
    const { ctx, output } = setup();
    expect(ctx.gains).toHaveLength(0);
    output.unlock();
    await flush();
    expect(ctx.gains).toHaveLength(1);
    expect(ctx.state).toBe("running");
    output.unlock();
    expect(ctx.gains).toHaveLength(1);
  });

  it("une voix dure sa durée sur l'horloge de l'hôte, avec ou sans contexte", () => {
    const { clock, ctx, output } = setup();
    const silent = output.play(SECOND); // avant unlock : aucun son, mais le temps passe
    expect(silent.duration).toBe(1);
    expect(silent.playing).toBe(true);
    expect(ctx.sources).toHaveLength(0);
    clock.advance(999);
    expect(silent.playing).toBe(true);
    clock.advance(1);
    expect(silent.playing).toBe(false);
  });

  it("joue une source quand le contexte tourne, la coupe à stop()", async () => {
    const { ctx, output } = setup();
    output.unlock();
    await flush();
    const voice = output.play(SECOND);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].started).toBe(true);
    voice.stop();
    expect(ctx.sources[0].stopped).toBe(true);
    expect(voice.playing).toBe(false);
    expect(output.activeCount).toBe(0);
  });

  it("n'envoie pas de source dans un contexte bloqué par l'autoplay, mais la voix dure", () => {
    const { clock, ctx, output } = setup();
    output.unlock(); // resume() n'a pas encore abouti hors micro-tâches : état encore suspendu
    ctx.state = "suspended";
    const voice = output.play(SECOND);
    clock.advance(500);
    expect(voice.playing).toBe(true);
  });

  it("relève la fréquence trop basse comme createMonoBuffer et calcule la durée en conséquence", async () => {
    const { output } = setup();
    output.unlock();
    await flush();
    expect(output.play({ data: new Float32Array(3000), rate: 1000 }).duration).toBe(1);
  });

  it("couper le son ne change ni la durée ni les sources, et s'applique au contexte créé plus tard", async () => {
    const { clock, ctx, output } = setup();
    output.setMuted(true);
    output.unlock();
    await flush();
    expect(ctx.gains[0].gain.value).toBe(0);
    const voice = output.play(SECOND);
    clock.advance(400);
    output.setMuted(false);
    expect(ctx.gains[0].gain.value).toBe(1);
    expect(ctx.sources[0].stopped).toBe(false);
    clock.advance(599);
    expect(voice.playing).toBe(true);
    clock.advance(1);
    expect(voice.playing).toBe(false);
    output.setMuted(true);
    expect(output.muted).toBe(true);
  });

  it("suspend fige les voix, resume ajoute le temps d'absence", async () => {
    const { clock, ctx, output } = setup();
    output.unlock();
    await flush();
    const voice = output.play(SECOND);
    clock.advance(300);
    output.suspend();
    await flush();
    expect(ctx.state).toBe("suspended");
    clock.advance(10_000);
    expect(voice.playing).toBe(true);
    output.resume();
    await flush();
    expect(ctx.state).toBe("running");
    clock.advance(699);
    expect(voice.playing).toBe(true);
    clock.advance(1);
    expect(voice.playing).toBe(false);
  });

  it("une boucle dure jusqu'à stop(), stopAll() arrête tout, un échantillon vide ne joue pas", async () => {
    const { clock, output } = setup();
    output.unlock();
    await flush();
    const loop = output.play(SECOND, { loop: true });
    const other = output.play(SECOND);
    clock.advance(60_000);
    expect(loop.playing).toBe(true);
    expect(other.playing).toBe(false);
    expect(output.play({ data: new Float32Array(0), rate: 8000 }).playing).toBe(false);
    output.stopAll();
    expect(loop.playing).toBe(false);
    expect(output.activeCount).toBe(0);
  });

  it("close() libère le contexte", async () => {
    const { ctx, output } = setup();
    output.unlock();
    await flush();
    output.close();
    expect(ctx.closed).toBe(true);
  });
});
