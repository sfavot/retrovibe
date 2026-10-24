import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import { ROSTER_BACKUP_KEY, ROSTER_STORAGE_KEY, RosterState, RosterStore, Roster } from "../../src/games/mathemagique/engine/roster";
import { SceneId, type Scene, type SceneContext } from "../../src/games/mathemagique/engine/scene";
import { installServices } from "../../src/games/mathemagique/engine/services";
import { registerScenes } from "../../src/games/mathemagique/scenes";
import { createBowlingScene, type BowlingScene } from "../../src/games/mathemagique/scenes/bowling";
import type { HubScene } from "../../src/games/mathemagique/scenes/hub";
import { MemoryStorage, TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles } from "./helpers";

/** Scène synthétique : journalise ses étapes ; `load` facultatif. */
function stub(log: string[], name: string, load?: () => Promise<void>, onTick?: (ctx: SceneContext) => void): Scene {
  const scene: Scene = {
    enter: (ctx) => {
      log.push(`${name}.enter`);
      ctx.requestPresent();
    },
    leave: () => void log.push(`${name}.leave`),
    tick: (ctx) => onTick?.(ctx),
  };
  if (load) scene.load = load;
  return scene;
}

/** Images à la main (un `runFor` attendrait un chargement volontairement bloqué). */
function frames(engine: Engine, host: TestHost, n: number): void {
  for (let i = 0; i < n; i++) engine.frame((host.time += 17));
}

/** Journalise l'identifiant de chaque scène entrée. */
function trackEntries(engine: Engine): SceneId[] {
  const entered: SceneId[] = [];
  const previous = engine.scenes.onEntered;
  engine.scenes.onEntered = () => {
    entered.push(engine.scenes.currentId!);
    previous?.();
  };
  return entered;
}

describe("échec de chargement d'une scène suivante", () => {
  it("expose l'erreur du moteur pendant que l'ancienne scène reste là (l'hôte doit alors s'arrêter)", async () => {
    const host = new TestHost();
    const engine = new Engine(host, { seed: 0 });
    const log: string[] = [];
    engine.register(SceneId.hub, () => stub(log, "hub", undefined, (ctx) => ctx.clock.ticks === 3 && ctx.scenes.request(SceneId.rhythm)));
    engine.register(SceneId.rhythm, () => stub(log, "rhythm", () => Promise.reject(new Error("fichier absent"))));
    engine.start(SceneId.hub);
    expect(engine.error).toBeNull();
    await runFor(engine, host, 400);
    expect(engine.scenes.currentId).toBe(SceneId.hub);
    expect(engine.error?.sceneId).toBe(SceneId.rhythm);
    expect((engine.error?.error as Error).message).toBe("fichier absent");
  });
});

describe("SceneManager.request idempotent", () => {
  it("une demande égale à la scène en chargement ou déjà demandée est ignorée", async () => {
    const host = new TestHost();
    const engine = new Engine(host, { seed: 0 });
    const log: string[] = [];
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    engine.register(SceneId.hub, () => stub(log, "hub"));
    engine.register(SceneId.trophy, () => stub(log, "trophy", async () => {
      loads++;
      await gate;
    }));
    engine.start(SceneId.hub);
    await runFor(engine, host, 100);
    engine.scenes.request(SceneId.trophy);
    engine.scenes.request(SceneId.trophy); // déjà demandée
    frames(engine, host, 5); // le chargement attend `gate` : pas de runFor
    expect(engine.scenes.isLoading).toBe(true);
    engine.scenes.request(SceneId.trophy); // en cours de chargement
    expect(engine.scenes.pending).toBeNull();
    release();
    await runFor(engine, host, 200);
    expect(loads).toBe(1);
    expect(log.filter((l) => l === "trophy.enter")).toHaveLength(1);
    expect(engine.scenes.currentId).toBe(SceneId.trophy);
  });

  it("une demande différente pendant un chargement est toujours gardée", async () => {
    const host = new TestHost();
    const engine = new Engine(host, { seed: 0 });
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    engine.register(SceneId.hub, () => stub(log, "hub"));
    engine.register(SceneId.trophy, () => stub(log, "trophy", () => gate));
    engine.register(SceneId.bowling, () => stub(log, "bowling"));
    engine.start(SceneId.hub);
    await runFor(engine, host, 100);
    engine.scenes.request(SceneId.trophy);
    frames(engine, host, 5);
    engine.scenes.request(SceneId.bowling);
    expect(engine.scenes.pending).toBe(SceneId.bowling);
    release();
    await runFor(engine, host, 300);
    expect(engine.scenes.currentId).toBe(SceneId.bowling);
  });
});

describe("Resources.abortSceneLoad", () => {
  it("libère les archives ouvertes par le chargement raté, garde celles de l'ancienne scène et les persistantes", async () => {
    const host = new TestHost();
    for (const name of ["a.dat", "b.dat", "c.dat", "d.dat"]) host.virtualFiles.set(name, new Uint8Array(0));
    const engine = new Engine(host, { seed: 0 });
    const { resources } = engine.ctx;
    // Les octets vides ne sont pas une archive Mohawk : on court-circuite le décodage via un faux `open`.
    const fake = (name: string) => ({ name }) as never;
    const entries = (resources as unknown as { entries: Map<string, unknown> }).entries;
    const add = (key: string, scope: "scene" | "persistent", epoch: number) => entries.set(key, { scope, epoch, promise: Promise.resolve(fake(key)), archive: fake(key) });
    add("old.dat", "scene", 0);
    add("keep.dat", "persistent", 0);
    resources.beginSceneLoad();
    void resources.open("old.dat"); // rouverte par le chargement
    add("new.dat", "scene", 1);
    add("pers.dat", "persistent", 1);
    resources.abortSceneLoad();
    expect(resources.openNames.sort()).toEqual(["keep.dat", "old.dat", "pers.dat"]);
    // L'ancienne scène quitte ensuite normalement : son archive est libérée.
    resources.commitScene();
    expect(resources.openNames.sort()).toEqual(["keep.dat", "pers.dat"]);
  });

  it("via le gestionnaire : un load qui échoue après avoir ouvert une archive ne la laisse pas ouverte", async () => {
    const host = new TestHost();
    const engine = new Engine(host, { seed: 0 });
    const log: string[] = [];
    engine.register(SceneId.hub, () => stub(log, "hub", undefined, (ctx) => ctx.clock.ticks === 3 && ctx.scenes.request(SceneId.rhythm)));
    engine.register(
      SceneId.rhythm,
      () =>
        stub(log, "rhythm", async () => {
          await engine.ctx.resources.open("MILKYWAY.DAT").catch(() => undefined);
          throw new Error("boum");
        }),
    );
    host.virtualFiles.set("milkyway.dat", new Uint8Array(0));
    engine.start(SceneId.hub);
    await runFor(engine, host, 400);
    expect(engine.error?.sceneId).toBe(SceneId.rhythm);
    expect(engine.ctx.resources.openNames).toEqual([]);
  });
});

describe("roster : sécurité des données", () => {
  const warn = () => vi.spyOn(console, "warn").mockImplementation(() => {});

  it("contenu illisible : copie de secours avant le premier écrasement, une seule fois, avec avertissement", () => {
    const spy = warn();
    const storage = new MemoryStorage();
    storage.set(ROSTER_STORAGE_KEY, "pas-du-base64-valide!!");
    const state = new RosterState(new RosterStore(storage));
    expect(state.loadStatus).toBe("invalid");
    expect(storage.get(ROSTER_BACKUP_KEY)).toBeNull();
    state.save();
    expect(storage.get(ROSTER_BACKUP_KEY)).toBe("pas-du-base64-valide!!");
    expect(storage.get(ROSTER_STORAGE_KEY)).not.toBe("pas-du-base64-valide!!");
    expect(spy).toHaveBeenCalled();
    // Une copie existe : elle n'est jamais remplacée.
    storage.set(ROSTER_STORAGE_KEY, "autre-contenu-illisible");
    new RosterState(new RosterStore(storage)).save();
    expect(storage.get(ROSTER_BACKUP_KEY)).toBe("pas-du-base64-valide!!");
    spy.mockRestore();
  });

  it("contenu valide ou absent : pas de copie, pas d'avertissement", () => {
    const spy = warn();
    const storage = new MemoryStorage();
    const state = new RosterState(new RosterStore(storage));
    state.save();
    state.save();
    expect(storage.get(ROSTER_BACKUP_KEY)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("deux onglets : une écriture faite entre-temps est signalée puis remplacée (dernier gagnant)", () => {
    const spy = warn();
    const storage = new MemoryStorage();
    const a = new RosterState(new RosterStore(storage));
    const b = new RosterState(new RosterStore(storage));
    a.roster.addPlayer("Anna");
    a.save();
    expect(spy).not.toHaveBeenCalled();
    b.roster.addPlayer("Bob");
    b.save();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(Roster.decode(Uint8Array.from(atob(storage.get(ROSTER_STORAGE_KEY)!), (c) => c.charCodeAt(0))).players().map((p) => p.name)).toEqual(["Bob"]);
    // b a écrit : il est à jour, la suite ne prévient plus.
    b.save();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("écriture impossible : avertissement une seule fois", () => {
    const spy = warn();
    const storage = new MemoryStorage();
    storage.set = () => false;
    const state = new RosterState(new RosterStore(storage));
    expect(state.save()).toBe(false);
    expect(state.save()).toBe(false);
    expect(state.saved).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("services.endScene", () => {
  it("restaure les couleurs tournées par un cycle de palette en fin de scène", () => {
    const host = new TestHost();
    const engine = new Engine(host, { seed: 0 });
    const services = installServices(engine);
    const { palette } = services.graphics;
    palette.setColor(10, 1, 2, 3);
    palette.setColor(11, 4, 5, 6);
    const before = palette.snapshot(10, 2);
    palette.startCycle({ first: 10, count: 2, period: 1 });
    palette.tick();
    expect(Array.from(palette.snapshot(10, 2))).not.toEqual(Array.from(before));
    services.endScene();
    expect(Array.from(palette.snapshot(10, 2))).toEqual(Array.from(before));
  });
});

describe.skipIf(!hasOriginalFiles)("scènes réelles", () => {
  it("Bowling → Trophée : un double clic ne charge le Hall of Fame qu'une fois ; double Exit : un seul retour au Bowling", async () => {
    const host = new TestHost();
    host.audio.unlock();
    const engine = new Engine(host, { seed: 7 });
    const services = installServices(engine);
    const added = engine.ctx.roster.roster.addPlayer("Test");
    if (!added.ok) throw new Error("joueur");
    engine.ctx.roster.currentPlayerId = added.id;
    registerScenes(engine, services);
    engine.start(SceneId.bowling);
    const entered = trackEntries(engine);
    await runUntil(engine, host, () => (engine.scenes.current as BowlingScene | undefined)?.ready === true, 600_000);
    entered.length = 0;
    host.click(508, 127);
    host.click(508, 127);
    await runUntil(engine, host, () => engine.scenes.currentId === SceneId.trophy);
    await runFor(engine, host, 3000);
    expect(entered).toEqual([SceneId.trophy]);
    host.click(519, 390);
    host.click(519, 390);
    await runUntil(engine, host, () => engine.scenes.currentId === SceneId.bowling);
    await runFor(engine, host, 3000);
    expect(entered).toEqual([SceneId.trophy, SceneId.bowling]);
  });

  it("hub : un appui long pendant le clip bloquant de Poly est ignoré (pas de connexion à la place des préférences)", async () => {
    const host = new TestHost();
    host.audio.unlock();
    const engine = new Engine(host, { seed: 3 });
    const services = installServices(engine);
    const monitor: string[] = [];
    registerScenes(engine, services, { openMonitor: (mode) => monitor.push(mode) });
    engine.start(SceneId.hub);
    await runFor(engine, host, 2000);
    const hub = engine.scenes.current as HubScene;
    host.click(520, 20); // passe l'accueil
    await runFor(engine, host, 300);
    if (hub.monitorOpen) hub.monitorClosed();
    await runFor(engine, host, 12_000);
    monitor.length = 0;
    // Sans joueur, une activité fait parler Poly (clip bloquant).
    host.click(330, 280);
    await runFor(engine, host, 400);
    expect(services.scr.blocking).toBe(true);
    hub.longPress(247, 362);
    expect(monitor).toEqual([]);
    expect(services.scr.blocking).toBe(true);
    // Un clic passe le clip : une seule ouverture, en connexion.
    host.click(520, 20);
    await runFor(engine, host, 300);
    expect(monitor).toEqual(["signin"]);
  });

  it("Bowling : « Ambient Sounds » rallumé en pleine partie relance la musique", async () => {
    const host = new TestHost();
    host.audio.unlock();
    const engine = new Engine(host, { seed: 7 });
    const services = installServices(engine);
    const added = engine.ctx.roster.roster.addPlayer("Test");
    if (!added.ok) throw new Error("joueur");
    engine.ctx.roster.currentPlayerId = added.id;
    let scene!: BowlingScene;
    engine.register(SceneId.bowling, () => (scene = createBowlingScene(services) as BowlingScene));
    engine.register(SceneId.hub, () => stub([], "hub"));
    engine.start(SceneId.bowling);
    await runUntil(engine, host, () => scene?.ready === true, 600_000);
    host.click(463, 130); // GO
    await runFor(engine, host, 200);
    expect(scene.playing).toBe(true);
    expect(services.sound.musicPlaying).toBe(true);
    const closed = (scene as unknown as { onMonitorClosed(r: { ambientChanged: boolean }): void }).onMonitorClosed.bind(scene);
    engine.ctx.roster.roster.ambient = false;
    closed({ ambientChanged: true });
    expect(services.sound.musicPlaying).toBe(false);
    engine.ctx.roster.roster.ambient = true;
    closed({ ambientChanged: true });
    expect(services.sound.musicPlaying).toBe(true);
  });
});
