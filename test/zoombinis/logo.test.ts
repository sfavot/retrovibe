import { beforeEach, describe, expect, it, vi } from "vitest";
import { createZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { ScreenId } from "../../src/games/zoombinis/engine/scene";
import { installServices } from "../../src/games/zoombinis/engine/services";
import { createLogoScene, LOGO_FILE, resetLogoFilm } from "../../src/games/zoombinis/scenes/logo";
import { originalFiles } from "../support/original";
import { runFor, TestHost } from "./engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");

describe.skipIf(!original.has)("logo (écran 0)", () => {
  beforeEach(() => resetLogoFilm());

  /** Écrans d'arrivée remplacés par des scènes vides, qui notent leur entrée. */
  async function start(setup?: (services: Awaited<ReturnType<typeof installServices>>) => void, host = new TestHost()) {
    const engine = createZoombinisEngine(host, { seed: 1 });
    const services = await installServices(engine);
    const entered: number[] = [];
    engine.register(ScreenId.logo, createLogoScene);
    for (const id of [ScreenId.map, ScreenId.picker, ScreenId.baseCamp, ScreenId.bridge]) {
      engine.register(id, () => ({ enter: () => void entered.push(id), leave() {}, tick() {} }));
    }
    setup?.(services);
    engine.start();
    await runFor(engine, host, 100);
    return { host, engine, services, entered };
  }

  it("joue LOGO025.mp4 sur l'hôte et reste sur le logo tant que le film dure", async () => {
    const { host, engine, entered } = await start();
    expect(host.videos.map((video) => video.path)).toEqual([LOGO_FILE]);
    expect(LOGO_FILE).toBe("LOGO025.mp4");
    await runFor(engine, host, 2000);
    expect(engine.scenes.currentId).toBe(ScreenId.logo);
    expect(entered).toEqual([]);
    expect(host.videos[0]!.ended).toBe(false);
    expect(engine.error).toBeNull();
  });

  it("un clic arrête le film et demande le choix des Zoombinis pour une partie neuve (écran 3)", async () => {
    const { host, engine, services, entered } = await start();
    host.click(300, 200);
    await runFor(engine, host, 100);
    expect(host.videos[0]!.stopped).toBe(true);
    expect(services.game.lastChange?.screen).toBe(ScreenId.picker);
    expect(engine.scenes.currentId).toBe(ScreenId.picker);
    expect(entered).toEqual([ScreenId.picker]);
    expect(services.game.session.screen).toBe(ScreenId.picker);
  });

  it("une touche arrête le film, pas un modificateur seul", async () => {
    const first = await start();
    first.host.press("ShiftLeft", { shift: true, key: "Shift" });
    await runFor(first.engine, first.host, 100);
    expect(first.engine.scenes.currentId).toBe(ScreenId.logo);
    expect(first.host.videos[0]!.ended).toBe(false);
    first.host.press("Space", { key: " " });
    await runFor(first.engine, first.host, 100);
    expect(first.host.videos[0]!.stopped).toBe(true);
    expect(first.engine.scenes.currentId).toBe(ScreenId.picker);
  });

  it("la fin du film mène à l'écran de reprise", async () => {
    const { host, engine, entered } = await start();
    host.videos[0]!.finish();
    await runFor(engine, host, 100);
    expect(host.videos[0]!.stopped).toBe(false);
    expect(entered).toEqual([ScreenId.picker]);
    expect(engine.scenes.currentId).toBe(ScreenId.picker);
  });

  it("reprend une partie chargée là où elle s'était arrêtée (carte, camp, épreuve avec un groupe) sinon au choix", async () => {
    const onMap = await start((services) => {
      services.game.game.resumeScreen = ScreenId.map;
    });
    onMap.host.click(10, 10);
    await runFor(onMap.engine, onMap.host, 100);
    expect(onMap.entered).toEqual([ScreenId.map]);
    // `1160:0521` lève `[970a]` (pas de transition) ; la carte ne le consomme pas (`changeScreen`).
    expect(onMap.services.game.session.resuming).toBe(true);

    const inPuzzle = await start((services) => {
      services.game.game.resumeScreen = ScreenId.bridge;
      services.game.game.group.members = [{ attrs: [1, 1, 1, 1], id: 0, present: true, state: new Uint8Array(10) }];
    });
    inPuzzle.host.click(10, 10);
    await runFor(inPuzzle.engine, inPuzzle.host, 100);
    expect(inPuzzle.entered).toEqual([ScreenId.bridge]);

    // Une épreuve sans groupe retombe sur le choix des Zoombinis.
    const emptyGroup = await start((services) => {
      services.game.game.resumeScreen = ScreenId.bridge;
    });
    emptyGroup.host.click(10, 10);
    await runFor(emptyGroup.engine, emptyGroup.host, 100);
    expect(emptyGroup.entered).toEqual([ScreenId.picker]);
  });

  it("ne joue le film qu'une fois par chargement de page", async () => {
    const first = await start();
    expect(first.host.videos).toHaveLength(1);
    first.host.click(10, 10);
    await runFor(first.engine, first.host, 100);
    const second = await start();
    expect(second.host.videos).toHaveLength(0);
    expect(second.entered).toEqual([ScreenId.picker]);
  });

  it("saute un film illisible", async () => {
    const host = new TestHost();
    host.videoPlayable = false;
    const { entered } = await start(undefined, host);
    expect(entered).toEqual([ScreenId.picker]);
  });

  it("Ctrl+Q quitte tout de suite, sans changer d'écran", async () => {
    const { host, engine, entered } = await start();
    host.press("KeyQ", { ctrl: true, key: "q" });
    await runFor(engine, host, 100);
    expect(host.exited).toBe(true);
    expect(host.videos[0]!.stopped).toBe(true);
    expect(entered).toEqual([]);
  });
});
