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

  it("le volume général s'applique en direct, borné, au contexte créé plus tard, et s'efface devant la coupure", async () => {
    const { ctx, output } = setup();
    output.volume = 0.4;
    output.unlock();
    await flush();
    expect(ctx.gains[0].gain.value).toBe(0.4);
    output.volume = 2;
    expect(output.volume).toBe(1);
    output.volume = 0.25;
    output.setMuted(true);
    expect(ctx.gains[0].gain.value).toBe(0);
    output.setMuted(false);
    expect(ctx.gains[0].gain.value).toBe(0.25);
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

  it("passes : un nombre fini de passes, une durée multipliée, une lecture bornée", async () => {
    const { clock, ctx, output } = setup();
    output.unlock();
    await flush();
    const voice = output.play(SECOND, { passes: 3 });
    expect(voice.duration).toBe(1);
    expect(ctx.sources[0].loop).toBe(true);
    expect(ctx.sources[0].startArgs).toEqual([0, 0, 3]);
    clock.advance(2999);
    expect(voice.playing).toBe(true);
    clock.advance(1);
    expect(voice.playing).toBe(false);
    const once = output.play(SECOND, { passes: 1 });
    expect(ctx.sources[1].loop).toBe(false);
    expect(ctx.sources[1].startArgs).toEqual([]);
    expect(once.playing).toBe(true);
    output.play(SECOND, { passes: Infinity });
    expect(ctx.sources[2].loop).toBe(true);
    expect(ctx.sources[2].startArgs).toEqual([]);
  });

  it("stop(fondu) : la source passe par un gain qui descend à 0, la voix s'achève avec le fondu", async () => {
    const { clock, ctx, output } = setup();
    output.unlock();
    await flush();
    ctx.currentTime = 10;
    const voice = output.play(SECOND, { loop: true });
    voice.stop(0.5);
    const fade = ctx.gains[1];
    expect(fade.ramps).toEqual([{ value: 0, at: 10.5 }]);
    expect(ctx.sources[0].stopAt).toBe(10.5);
    expect(ctx.sources[0].stopped).toBe(true);
    expect(voice.playing).toBe(true);
    clock.advance(499);
    expect(voice.playing).toBe(true);
    clock.advance(1);
    expect(voice.playing).toBe(false);
    voice.stop(0.5); // sans effet : un seul fondu
    expect(ctx.gains).toHaveLength(2);
  });

  it("stop(fondu) puis stop() coupe net ; sans source, stop(fondu) arrête simplement la voix", () => {
    const { ctx, output } = setup();
    const silent = output.play(SECOND);
    silent.stop(1);
    expect(silent.playing).toBe(false);
    output.unlock();
    ctx.state = "running";
    const voice = output.play(SECOND, { loop: true });
    voice.stop(1);
    voice.stop();
    expect(voice.playing).toBe(false);
    expect(output.activeCount).toBe(0);
  });

  it("onContext reçoit le contexte et le gain général une fois ; connection() les rend sans geste", () => {
    const ctx = new FakeAudioContext();
    const seen: unknown[][] = [];
    const output = new WebSampleOutput({
      now: () => 0,
      createContext: () => ctx.asContext(),
      onContext: (c, master) => seen.push([c, master]),
    });
    expect(seen).toHaveLength(0);
    const first = output.connection();
    expect(ctx.state).toBe("suspended");
    expect(first.master).toBe(ctx.gains[0]);
    output.unlock();
    output.connection();
    expect(seen).toEqual([[ctx, ctx.gains[0]]]);
  });

  it("un contexte créé pendant la suspension de l'onglet est suspendu aussi", async () => {
    const ctx = new FakeAudioContext(false); // déjà autorisé : démarre running
    const output = new WebSampleOutput({ now: () => 0, createContext: () => ctx.asContext() });
    output.suspend();
    output.connection();
    await flush();
    expect(ctx.state).toBe("suspended");
  });

  it("close() libère le contexte", async () => {
    const { ctx, output } = setup();
    output.unlock();
    await flush();
    output.close();
    expect(ctx.closed).toBe(true);
  });

  it("decode rend un échantillon mono à la fréquence du contexte, sans toucher aux octets reçus", async () => {
    const { ctx, output } = setup();
    ctx.decoded = { sampleRate: 48000, length: 480, channels: 2 };
    const bytes = new Uint8Array([1, 2, 3, 4, 5]).subarray(1, 4);
    const sample = await output.decode(bytes);
    expect(sample.rate).toBe(48000);
    expect(sample.data).toHaveLength(480);
    expect(sample.data[0]).toBeCloseTo(0.1); // premier canal seulement
    expect([...new Uint8Array(ctx.decodedInputs[0])]).toEqual([2, 3, 4]);
    expect([...bytes]).toEqual([2, 3, 4]);
    // le contexte existe (suspendu) : on peut précharger avant le geste, puis unlock le reprend
    expect(ctx.state).toBe("suspended");
    expect(output.play(sample).playing).toBe(true);
    expect(ctx.sources).toHaveLength(0);
  });

  it("decode refuse un fichier illisible", async () => {
    const { ctx, output } = setup();
    ctx.decodeFails = true;
    await expect(output.decode(new Uint8Array(3))).rejects.toThrow();
  });
});

describe("WebSampleOutput : volume par voix et boucle sur la fin (M3)", () => {
  it("sans volume, aucun gain n'est ajouté (comportement inchangé) ; avec volume, un gain par voix", async () => {
    const { ctx, output } = setup();
    output.unlock();
    await flush();
    output.play(SECOND);
    expect(ctx.gains).toHaveLength(1); // le gain général seul
    output.play(SECOND, { volume: 0.25 });
    expect(ctx.gains).toHaveLength(2);
    expect(ctx.gains[1].gain.value).toBe(0.25);
    output.play(SECOND, { volume: 7 }); // borné à 1 : pas de gain ajouté
    expect(ctx.gains).toHaveLength(2);
  });

  it("un volume de 1 n'ajoute pas de gain", async () => {
    const { ctx, output } = setup();
    output.unlock();
    await flush();
    output.play(SECOND, { volume: 1 });
    expect(ctx.gains).toHaveLength(1);
  });

  it("loopStart : lecture complète puis boucle de [loopStart, fin[, jusqu'à stop()", async () => {
    const { clock, ctx, output } = setup();
    output.unlock();
    await flush();
    const voice = output.play(SECOND, { loopStart: 6000 });
    const source = ctx.sources[0] as unknown as { loop: boolean; loopStart: number; loopEnd: number; startArgs: number[] };
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(0.75);
    expect(source.loopEnd).toBe(1);
    expect(source.startArgs).toEqual([]);
    clock.advance(60_000);
    expect(voice.playing).toBe(true);
    voice.stop();
    expect(voice.playing).toBe(false);
  });

  it("loopStart hors de l'échantillon est ignoré (lecture simple)", async () => {
    const { clock, ctx, output } = setup();
    output.unlock();
    await flush();
    const voice = output.play(SECOND, { loopStart: 8000 });
    expect((ctx.sources[0] as unknown as { loop: boolean }).loop).toBe(false);
    clock.advance(1000);
    expect(voice.playing).toBe(false);
  });

  it("l'arrêt progressif d'une voix à gain passe par son gain", async () => {
    const { ctx, output } = setup();
    output.unlock();
    await flush();
    const voice = output.play(SECOND, { volume: 0.5 });
    voice.stop(0.5);
    expect(ctx.gains[2].ramps).toEqual([{ value: 0, at: 0.5 }]);
  });
});
