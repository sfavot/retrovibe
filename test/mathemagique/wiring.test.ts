import { describe, expect, it } from "vitest";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import { SceneId } from "../../src/games/mathemagique/engine/scene";
import { ROSTER_STORAGE_KEY } from "../../src/games/mathemagique/engine/roster";
import { installServices } from "../../src/games/mathemagique/engine/services";
import { registerScenes } from "../../src/games/mathemagique/scenes";
import type { HubScene } from "../../src/games/mathemagique/scenes/hub";
import { HUB_OBJECT, HUB_OBJECT_EDGES } from "../../src/games/mathemagique/scenes/hub-logic";
import { TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles } from "./helpers";

/** Le câblage de la vague H avec les vraies scènes et le vrai moniteur du hub (sans `openMonitor` de test). */

function boot(setup?: (host: TestHost) => void) {
  const host = new TestHost();
  host.audio.unlock();
  setup?.(host);
  const engine = new Engine(host, { seed: 3 });
  const services = installServices(engine);
  registerScenes(engine, services);
  engine.start();
  return { host, engine, services };
}
type Game = ReturnType<typeof boot>;

const sceneOf = (game: Game): SceneId | undefined => game.engine.scenes.currentId;
const hubOf = (game: Game): HubScene => game.engine.scenes.current as HubScene;
const key = (game: Game, k: string, code = k): void => game.host.press(code, { key: k });

/** Titre → porte → hub, puis l'accueil de Poly est passé par un clic : le moniteur de connexion s'ouvre. */
async function toSignIn(game: Game): Promise<HubScene> {
  await runFor(game.engine, game.host, 800);
  game.host.press("Space");
  await runFor(game.engine, game.host, 2500);
  game.host.click(290, 300);
  await runUntil(game.engine, game.host, () => sceneOf(game) === SceneId.hub, 30_000);
  await runFor(game.engine, game.host, 1200);
  game.host.click(520, 20);
  await runFor(game.engine, game.host, 1500);
  return hubOf(game);
}

/** Hub avec un joueur déjà connu (Zoe, qui a vu la présentation de Poly) : la connexion le présélectionne, Entrée la ferme. */
async function toRestingHub(): Promise<{ game: Game; hub: HubScene }> {
  const game = boot();
  const { roster } = game.engine.ctx.roster;
  const added = roster.addPlayer("Zoe");
  if (!added.ok) throw new Error("joueur refusé");
  roster.setVar(added.id, "hubPolyIntroSeen", 1);
  const hub = await toSignIn(game);
  expect(hub.monitorMode).toBe("signin");
  key(game, "Enter");
  await runFor(game.engine, game.host, 25_000);
  expect(hub.monitorOpen).toBe(false);
  return { game, hub };
}

/** Écran visible : la palette présentée n'est pas noire et l'image a du contenu. */
function visible(game: Game): boolean {
  const frame = game.host.frames[game.host.frames.length - 1]!;
  const lit = frame.palette.reduce((sum, v) => sum + v, 0);
  const drawn = frame.pixels.reduce((n, v) => n + (v === 0 ? 0 : 1), 0);
  return lit > 3000 && drawn > 20_000;
}

function center(object: number): [number, number] {
  const [l, t, r, b] = HUB_OBJECT_EDGES[object - 1]!;
  return [Math.floor((l + r) / 2), Math.floor((t + b) / 2)];
}

describe.skipIf(!hasOriginalFiles)("hub : moniteur branché", () => {
  it("l'accueil ouvre la connexion ; Léa se crée au clavier, la fermeture prévient le hub et enregistre", async () => {
    const game = boot();
    const hub = await toSignIn(game);
    expect(hub.monitorOpen).toBe(true);
    expect(hub.monitorMode).toBe("signin");
    // Roster vide : la saisie du nom commence tout de suite.
    for (const c of "léa") key(game, c, `Key${c.toUpperCase()}`);
    key(game, "Enter");
    await runFor(game.engine, game.host, 2500);
    expect(hub.monitorOpen).toBe(false);
    expect(hub.monitorMode).toBeNull();
    const { roster, currentPlayerId } = game.engine.ctx.roster;
    expect(roster.players().map((p) => p.name)).toEqual(["Léa"]);
    expect(currentPlayerId).toBe(roster.players()[0]!.id);
    expect(game.host.storage.get(ROSTER_STORAGE_KEY)).not.toBeNull();
  });

  it("les touches vont au moniteur tant qu'il est ouvert, pas à l'historique du hub", async () => {
    const game = boot();
    const hub = await toSignIn(game);
    const { h, x } = hub.history;
    key(game, "a", "KeyA");
    expect([hub.history.h, hub.history.x]).toEqual([h, x]);
  });

  it("Ctrl + clic sur Sign-in ouvre les préférences, un clic simple la connexion", async () => {
    const { game, hub } = await toRestingHub();

    game.host.click(247, 362);
    await runFor(game.engine, game.host, 1500);
    expect(hub.monitorMode).toBe("signin");
    key(game, "Enter");
    await runFor(game.engine, game.host, 3000);
    expect(hub.monitorOpen).toBe(false);

    game.host.input.moveMouse(247, 362);
    game.host.input.mouseDown("left", { ctrl: true });
    game.host.input.mouseUp("left", { ctrl: true });
    await runFor(game.engine, game.host, 1500);
    expect(hub.monitorMode).toBe("preferences");
  });

  it("l'appui long de l'hôte (hub.longPress) ouvre les préférences", async () => {
    const { game, hub } = await toRestingHub();
    hub.longPress(247, 362);
    await runFor(game.engine, game.host, 1500);
    expect(hub.monitorMode).toBe("preferences");
  });
});

describe.skipIf(!hasOriginalFiles)("hub ↔ activités", () => {
  const activities: [string, number, SceneId][] = [
    ["Stickler's Sketchbook (chevalet)", HUB_OBJECT.easel, SceneId.sticklers],
    ["Rocket Science (étagère)", HUB_OBJECT.shelf, SceneId.rockets],
    ["Pattern Palace (tableau)", HUB_OBJECT.frame, SceneId.patterns],
    ["Hidden (télévision)", HUB_OBJECT.television, SceneId.hidden],
  ];

  it.each(activities)("%s : le hub revient à l'écran, palette visible", async (_name, object, scene) => {
    const { game } = await toRestingHub();
    expect(visible(game)).toBe(true);

    game.host.click(...center(object));
    await runUntil(game.engine, game.host, () => sceneOf(game) === scene, 30_000);
    await runFor(game.engine, game.host, 3000);
    expect(game.engine.requestExit()).toBe(true);
    await runUntil(game.engine, game.host, () => sceneOf(game) === SceneId.hub, 60_000);
    await runFor(game.engine, game.host, 3000);
    expect(visible(game)).toBe(true);
  });

  it("Hall of Fame : EXIT revient à la scène d'où l'on vient (le hub), écran visible", async () => {
    const { game } = await toRestingHub();
    game.engine.scenes.request(SceneId.trophy);
    await runUntil(game.engine, game.host, () => sceneOf(game) === SceneId.trophy, 30_000);
    await runFor(game.engine, game.host, 2000);
    expect(visible(game)).toBe(true);
    game.host.click(519, 389);
    await runUntil(game.engine, game.host, () => sceneOf(game) === SceneId.hub, 30_000);
    await runFor(game.engine, game.host, 3000);
    expect(visible(game)).toBe(true);
  });
});
