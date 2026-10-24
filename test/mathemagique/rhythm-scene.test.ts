import { describe, expect, it } from "vitest";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import { SceneId, type Scene } from "../../src/games/mathemagique/engine/scene";
import { installServices, type MathServices } from "../../src/games/mathemagique/engine/services";
import { ERROR_LINES } from "../../src/games/mathemagique/game/rhythm/errors";
import { type BinId, BIN_EDGES, pieceSpan } from "../../src/games/mathemagique/game/rhythm/pieces";
import { createRhythmScene, type RhythmScene } from "../../src/games/mathemagique/scenes/rhythm";
import { BUTTONS, edgesRect, toolRect } from "../../src/games/mathemagique/scenes/rhythm-view";
import { dancePoses, planDance } from "../../src/games/mathemagique/scenes/rhythm-dance";
import { MsvcRandom } from "../../src/games/mathemagique/engine/rng";
import { TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles } from "./helpers";

class HubStub implements Scene {
  constructor(private readonly services: () => MathServices) {}
  enter(): void {}
  leave(): void {
    this.services().endScene();
  }
  tick(): void {}
}

async function boot(options: { drag?: boolean } = {}) {
  const host = new TestHost();
  host.audio.unlock();
  const engine = new Engine(host, { seed: 5 });
  const services = installServices(engine);
  let scene!: RhythmScene;
  engine.register(SceneId.hub, () => new HubStub(() => services));
  engine.register(SceneId.rhythm, () => (scene = createRhythmScene(services)));
  if (options.drag) engine.ctx.roster.roster.clickAndStick = false;
  const added = engine.ctx.roster.roster.addPlayer("Test");
  if (!added.ok) throw new Error("joueur");
  engine.ctx.roster.currentPlayerId = added.id;
  engine.start(SceneId.rhythm);
  await runFor(engine, host, 100);
  const api = {
    host,
    engine,
    services,
    playerId: added.id,
    get scene() {
      return scene;
    },
    run: (ms: number) => runFor(engine, host, ms),
    until: (done: () => boolean) => runUntil(engine, host, done, 60_000),
    async idle() {
      await runUntil(engine, host, () => scene.inspect().state === "idle", 60_000);
    },
    async click(x: number, y: number) {
      host.click(x, y);
      await runFor(engine, host, 100);
    },
    async button(role: string) {
      const b = BUTTONS.find((x) => x.role === role)!;
      const r = edgesRect(b.edges);
      await api.click(r.x + 5, r.y + 5);
    },
    /** Déplace une pièce : prise dans `from`, dépôt sur `to` (indice de case pour le Pattern Bin). */
    async move(drag: boolean, from: BinId, fromIndex: number, to: BinId, toIndex = 0) {
      const s = api.scene.inspect();
      const words = from === "parts" ? s.parts : from === "pattern" ? s.pattern : s.fractionator;
      const span = pieceSpan(from, words, fromIndex);
      const sx = span.x + Math.min(10, span.w - 1);
      const sy = BIN_EDGES[from][1] + 20;
      let tx: number;
      if (to === "pattern") {
        const t = pieceSpan("pattern", s.pattern, toIndex);
        tx = t.x + 5;
      } else tx = BIN_EDGES[to][0] + 20;
      const ty = BIN_EDGES[to][1] + 20;
      host.input.moveMouse(sx, sy);
      if (drag) host.input.mouseDown("left");
      else host.input.mouseDown("left"), host.input.mouseUp("left");
      await api.run(100);
      host.input.moveMouse(tx, ty);
      await api.run(100);
      if (drag) host.input.mouseUp("left");
      else host.input.mouseDown("left"), host.input.mouseUp("left");
      await api.run(100);
    },
  };
  return api;
}

type Api = Awaited<ReturnType<typeof boot>>;

const midiNoteOns = (api: Api) => api.host.audio.midi.messages.filter((m) => (m.message[0]! & 0xf0) === 0x90 && m.message[2]! > 0).length;

/** Fanfare (`[72, 72]`, variante 0) : 144 → Fractionator, Cutter ×2, puis chaque moitié sur son emplacement. */
async function solveFanfare(api: Api, drag: boolean): Promise<void> {
  await api.move(drag, "parts", 0, "fractionator");
  expect(api.scene.inspect().fractionator).toEqual([144]);
  await api.button("doIt");
  expect(api.scene.inspect().tool).toBe("cut");
  await api.idle();
  expect(api.scene.inspect().fractionator).toEqual([72, 72]);
  await api.move(drag, "fractionator", 0, "pattern", 0);
  await api.move(drag, "fractionator", 0, "pattern", 1);
}

describe("Rhythm Shop : danse (pur)", () => {
  it("4, 8 ou 12 mesures, jamais trois familles identiques de suite, une pose par pas", () => {
    for (let seed = 0; seed < 40; seed++) {
      const plan = planDance(new MsvcRandom(seed), seed % 2 ? 120 : 90);
      expect([4, 8, 12]).toContain(plan.measures);
      for (let m = 2; m < plan.measures; m++) expect(plan.families[m] === plan.families[m - 1] && plan.families[m] === plan.families[m - 2]).toBe(false);
      for (const n of [12, 16, 24]) {
        const poses = dancePoses(plan, 1, n);
        expect(poses).toHaveLength(n);
        for (const p of poses) expect(p).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe.skipIf(!hasOriginalFiles)("Rhythm Shop : scène (vraies données)", () => {
  it("entrée : animation d'accueil puis Fanfare, recette et bacs", async () => {
    const api = await boot();
    expect(api.scene.inspect().state).toBe("entering");
    await api.idle();
    const s = api.scene.inspect();
    expect(s.songName).toBe("Fanfare");
    expect(s.recipe).toEqual(["(2) 1/2 bars"]);
    expect(s.parts).toEqual([144]);
    expect(s.pattern).toEqual([-72, -72]);
    expect(api.host.frames.length).toBeGreaterThan(0);
  });

  for (const drag of [false, true]) {
    it(`victoire (${drag ? "glisser" : "cliquer-poser"}) : le morceau joue avec danse, variante suivante, animation finale`, async () => {
      const api = await boot({ drag });
      await api.idle();
      await solveFanfare(api, drag);
      expect(api.scene.inspect().state).toBe("playing");
      expect(api.scene.inspect().dancing).toBe(true);
      await api.until(() => midiNoteOns(api) > 0);
      // Un seul séquenceur : la lecture passe par le SoundService (poignée de musique), pas par un lecteur propre à la scène.
      expect(api.services.sound.musicPlaying).toBe(true);
      expect(api.engine.ctx.roster.roster.getVar(api.playerId, "rhythmVariant", 0)).toBe(1);
      await api.until(() => api.scene.inspect().state === "finale");
      expect(api.scene.inspect().reaction).not.toBeNull();
      await api.idle();
      // Prochaine fois, la variante 1 est servie.
      await api.button("next");
      await api.button("previous");
      expect(api.scene.inspect().variant).toBe(1);
    }, 60_000);
  }

  it("un clic pendant Play Pattern coupe la musique du SoundService", async () => {
    const api = await boot();
    await api.idle();
    await solveFanfare(api, false);
    await api.until(() => api.services.sound.musicPlaying);
    await api.run(300);
    await api.click(300, 100);
    await api.until(() => !api.services.sound.musicPlaying);
    expect(api.services.sound.musicPlaying).toBe(false);
  }, 60_000);

  it("pendant Play Pattern, Ctrl+touche ne coupe pas le morceau (il revient au moteur, ex. Ctrl+Q)", async () => {
    const api = await boot();
    await api.idle();
    await solveFanfare(api, false);
    await api.until(() => api.services.sound.musicPlaying);
    await api.run(300);
    api.host.press("KeyA", { ctrl: true, key: "a" });
    await api.run(100);
    expect(api.scene.inspect().state).toBe("playing");
  }, 60_000);

  it("dépôt erroné : refusé sans réaction ; Cutter avec deux pièces : réplique d'Algebird du type 5", async () => {
    const api = await boot();
    await api.idle();
    // Boogi Woogi (indice 2), variante 0 : Cutter seulement.
    await api.button("next");
    await api.button("next");
    expect(api.scene.inspect().songName).toBe("Boogi Woogi");
    await api.move(false, "parts", 0, "pattern", 0);
    expect(api.scene.inspect().parts).toEqual([144]);
    expect(api.scene.inspect().reactions).toEqual([]);
    await api.move(false, "parts", 0, "fractionator");
    await api.button("doIt");
    await api.idle();
    expect(api.scene.inspect().fractionator).toEqual([72, 72]);
    await api.button("doIt");
    const r = api.scene.inspect().reactions;
    expect(r).toHaveLength(1);
    expect(ERROR_LINES[5]).toContain(r[0]!);
  }, 60_000);

  it("Help : la zone du Parts Bin joue son SCR de RSHELP", async () => {
    const api = await boot();
    await api.idle();
    await api.button("help");
    expect(api.scene.inspect().state).toBe("help");
    // Arrivée (non interruptible) puis présentation : des clics l'interrompent.
    await api.until(() => api.scene.inspect().polyPhase === "listening" || api.scene.inspect().polyPhase === "intro");
    while (api.scene.inspect().polyPhase !== "listening") await api.click(300, 100);
    await api.click(300, 250);
    await api.until(() => api.scene.inspect().polyPlayed.includes(1900));
    expect(api.scene.inspect().polyPlayed).toContain(1900);
  }, 60_000);

  it("Exit : réplique d'Algebird, fondu, retour au hub", async () => {
    const api = await boot();
    await api.idle();
    await api.button("exit");
    expect(api.scene.inspect().state).toBe("exiting");
    expect(ERROR_LINES[10]).toContain(api.scene.inspect().reactions[0]!);
    await api.until(() => api.engine.scenes.currentId === SceneId.hub);
    expect(api.engine.scenes.currentId).toBe(SceneId.hub);
  }, 60_000);

  it("outils : Tab et touches 1-9 changent l'outil actif", async () => {
    const api = await boot();
    await api.idle();
    const before = api.scene.inspect().activeTool;
    api.host.press("Tab");
    await api.run(50);
    expect(api.scene.inspect().activeTool).not.toBe(before);
    api.host.press("Digit1");
    await api.run(50);
    expect(api.scene.inspect().activeTool).toBe(0);
    void toolRect;
  });
});
