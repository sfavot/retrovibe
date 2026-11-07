import { describe, expect, it, vi } from "vitest";
import { ZOOMBINI_SCREENS, screenInfo } from "../../src/games/zoombinis/data/archives";
import { DIALOG } from "../../src/games/zoombinis/engine/dialog";
import { createZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { FEATURES, FeatureFlag } from "../../src/games/zoombinis/engine/features";
import { ScreenId, type Scene } from "../../src/games/zoombinis/engine/scene";
import { installServices } from "../../src/games/zoombinis/engine/services";
import { FIRST_PUZZLE, LAST_PUZZLE, nextScreen, stageOf } from "../../src/games/zoombinis/game/route";
import { makeZoombini, type GameState, type Session, type Zoombini } from "../../src/games/zoombinis/game/state";
import { campArrive, campExitAllowed, campLeave, takeFromShelf, townArrive } from "../../src/games/zoombinis/game/team";
import { createMapScene } from "../../src/games/zoombinis/scenes/map";
import { createPickerScene } from "../../src/games/zoombinis/scenes/picker";
import { BACKGROUNDS, createPuzzleStubScene } from "../../src/games/zoombinis/scenes/puzzle-stub";
import { createXferScene } from "../../src/games/zoombinis/scenes/xfer";
import { ZOOMBINIS_GAME } from "../../src/games/zoombinis/engine/game";
import { ZOOMBINIS_SOUND } from "../../src/games/zoombinis/engine/sound";
import { originalFiles } from "../support/original";
import { runFor, TestHost } from "./engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");

const S = ScreenId;
const TICK_MS = 17;
const PUZZLES = Array.from({ length: LAST_PUZZLE - FIRST_PUZZLE + 1 }, (_, i) => FIRST_PUZZLE + i);

/** Un groupe de `count` Zoombinis tous différents. */
function party(count: number): Zoombini[] {
  return Array.from({ length: count }, (_, i) => makeZoombini([1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + (i % 3), 1], i + 1));
}

type Setup = (game: GameState, session: Session) => void;

describe.skipIf(!original.has)("épreuve provisoire (écrans 7 à 18)", () => {
  /** L'épreuve `screen` avec un groupe de `size` Zoombinis ; les autres écrans sont des scènes vides qui notent leur entrée. */
  async function start(screen: number, size = 16, setup?: Setup) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 3 });
    const services = await installServices(engine);
    const entered: number[] = [];
    for (const id of Object.values(ScreenId)) {
      if (id === screen) engine.register(id, () => createPuzzleStubScene(screen));
      else engine.register(id, () => ({ enter: () => void entered.push(id), leave() {}, tick() {} }));
    }
    const zoombinis = services.game;
    zoombinis.game.group.members = party(size);
    zoombinis.game.stageUnbroken = true;
    setup?.(zoombinis.game, zoombinis.session);
    zoombinis.session.screen = screen;
    engine.start(screen as ScreenId);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    const press = async (code: string, mods: { ctrl?: boolean; alt?: boolean } = {}) => {
      host.press(code, { key: code, ...mods });
      await runFor(engine, host, TICK_MS * 6);
    };
    const features = engine.services.get(FEATURES);
    const snoids = () => features.features.filter((f) => f.hasFlag(FeatureFlag.snoid));
    return { host, engine, services, zoombinis, entered, press, features, snoids, dialog: engine.services.get(DIALOG) };
  }

  it("a un fond tBMP 640 × 480 et sa palette SHPL dans chacune des 12 archives (1000 pour BRIDGE seule, sinon le premier couple de même id)", async () => {
    for (const screen of PUZZLES) {
      const { host, engine, snoids, zoombinis } = await start(screen, 5);
      const name = screenInfo(screen)!.archive!;
      const archive = await engine.ctx.resources.open(name);
      const background = BACKGROUNDS[screen]!;
      expect(archive.has("SHPL", background), name).toBe(true);
      expect(archive.ids("SHPL").includes(background) && archive.ids("SHPL")[0] === background, name).toBe(true);
      const shape = archive.tbmp(background);
      expect([shape.width, shape.height], name).toEqual([640, 480]);
      expect(host.frames[host.frames.length - 1]!.pixels.some((p) => p !== 0), name).toBe(true);
      expect(snoids(), name).toHaveLength(5);
      expect(zoombinis.session.screen).toBe(screen);
    }
    expect(ZOOMBINI_SCREENS.filter((s) => s.role === "trial")).toHaveLength(12);
  });

  it("n'affiche que les membres présents, sur une ligne en bas de l'écran, dans l'écran (une fois entrés)", async () => {
    const { snoids, features, host, engine } = await start(FIRST_PUZZLE, 16, (game) => {
      game.group.members[3]!.present = false;
      game.group.members[9]!.present = false;
    });
    // 14 présents : 10 debout, 4 qui entrent à pied (30 ticks, puis 45 de plus pour chacun, puis la marche).
    await runFor(engine, host, 1000 * TICK_MS);
    expect(snoids()).toHaveLength(14);
    const rects = snoids().map((f) => f.rect!);
    for (const r of rects) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(640);
      expect(r.bottom).toBeGreaterThan(400);
    }
    expect(features.features.length).toBe(14);
  });

  describe("kit des épreuves", () => {
    it("arrivée échelonnée : les trois quarts debout, les autres à x = −50 puis en marche vers leur place", async () => {
      const { snoids, host, engine } = await start(S.tunnels, 16);
      const at = snoids().map((f) => f.rect!.right);
      // 12 debout dans l'écran ; 4 hors écran (à gauche).
      expect(at.filter((right) => right <= 0)).toHaveLength(4);
      await runFor(engine, host, 1000 * TICK_MS);
      expect(snoids().map((f) => f.rect!.right).filter((right) => right <= 0)).toHaveLength(0);
    });

    it("tous debout avec « moins d'action »", async () => {
      const { snoids } = await start(S.tunnels, 16, (game) => (game.options.lessAction = true));
      expect(snoids().map((f) => f.rect!.right).filter((right) => right <= 0)).toHaveLength(0);
    });

    it("glisser un Zoombini d'une place d'attente à une place libre (la rangée du dessus)", async () => {
      const { host, engine, snoids } = await start(S.tunnels, 6, (game) => {
        game.options.lessAction = true;
        game.options.magneticMouse = false;
      });
      const features = snoids();
      const first = features[0]!;
      const rect = first.rect!;
      const grab = { x: Math.floor((rect.left + rect.right) / 2), y: Math.floor((rect.top + rect.bottom) / 2) };
      const before = { left: rect.left, top: rect.top };
      host.input.moveMouse(grab.x, grab.y);
      host.input.mouseDown("left");
      await runFor(engine, host, 4 * TICK_MS);
      host.input.moveMouse(grab.x, grab.y - 48);
      await runFor(engine, host, 12 * TICK_MS);
      host.input.mouseUp("left");
      await runFor(engine, host, 8 * TICK_MS);
      // Posé sur la place libre du dessus (48 points plus haut).
      expect(first.rect!.top).toBe(before.top - 48);
      // (la pose d'attente 1 de l'état 4 n'a pas tout à fait la même largeur que la pose 0)
      expect(Math.abs(first.rect!.left - before.left)).toBeLessThanOrEqual(3);
      expect(engine.error).toBeNull();
    });

    it("le bouton carte de l'angle (région 600, 403) demande l'avertissement, puis mène à la carte", async () => {
      const { host, engine, zoombinis, dialog } = await start(S.pizza, 6);
      host.click(620, 420);
      await runFor(engine, host, 6 * TICK_MS);
      expect(dialog.isOpen).toBe(true);
      host.press("Enter");
      await runFor(engine, host, 6 * TICK_MS);
      expect(zoombinis.lastChange).toMatchObject({ screen: S.map });
    });

    it("lance la musique des épreuves qui en ont (le piège de cristal au niveau de l'étape), et aucune pour les autres", async () => {
      const smoke = await start(S.smoke, 4, (game) => (game.levels = [0, 0, 0, 1]));
      expect(smoke.engine.services.get(ZOOMBINIS_SOUND).lastMusicId).toBe(30031);
      const bridge = await start(S.bridge, 4);
      expect(bridge.engine.services.get(ZOOMBINIS_SOUND).lastMusicId).toBe(0);
    });

    it("une partie enregistrée pendant l'épreuve retrouve son groupe entier ; le crochet est retiré à la sortie", async () => {
      const { engine, zoombinis, press } = await start(S.ferry, 8);
      const dialogs = engine.services.get(DIALOG) as unknown as { beforeSave: (() => void)[] };
      expect(dialogs.beforeSave).toHaveLength(1);
      zoombinis.game.group.members = [];
      for (const hook of dialogs.beforeSave) hook();
      expect(zoombinis.game.group.members).toHaveLength(8);
      await press("KeyR");
      expect(dialogs.beforeSave).toHaveLength(0);
    });
  });

  describe("réussite sans perte (R)", () => {
    it.each(PUZZLES)("écran %i : mène à l'écran suivant par XFER, marque la réussite, garde le groupe", async (screen) => {
      const { press, zoombinis, engine } = await start(screen);
      await press("KeyR", {});
      const expected = nextScreen(screen, "success");
      expect(engine.error).toBeNull();
      expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: expected });
      expect(zoombinis.lastChange!.transfer).not.toBeNull();
      expect(engine.scenes.currentId).toBe(S.xfer);
      const { game } = zoombinis;
      expect(game.successes[screen - FIRST_PUZZLE]! & 1).toBe(1);
      expect(game.successes[screen - FIRST_PUZZLE]! & 0x10).toBe(0x10);
      expect(game.group.members.filter((z) => z.present)).toHaveLength(16);
      const { stage, last } = stageOf(screen);
      if (last) {
        expect(game.monuments[0]).toMatchObject({ stage, level: 1 });
        expect(game.levels[stage - 1]).toBe(1);
        expect(zoombinis.session.levelRaised).toBe(true);
      } else {
        expect(game.monuments.every((m) => m === null)).toBe(true);
        expect(game.levels[stage - 1]).toBe(0);
      }
    });
  });

  describe("réussite avec pertes (1 à 9)", () => {
    it.each(PUZZLES)("écran %i : 3 perdus, les derniers présents, rendus au dernier arrêt de l'étape", async (screen) => {
      const { press, zoombinis, engine } = await start(screen);
      const before = zoombinis.game.group.members.map((z) => z.attrs.join());
      await press("Digit3");
      expect(engine.error).toBeNull();
      expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(screen, "success") });
      const { game } = zoombinis;
      const { stage } = stageOf(screen);
      expect(game.group.members).toHaveLength(13);
      expect(game.group.members.every((z) => z.present)).toBe(true);
      expect(game.group.members.map((z) => z.attrs.join())).toEqual(before.slice(0, 13));
      const reserve = stage === 1 ? game.pickerGroup : stage === 4 ? game.camp2Group : game.camp1Group;
      expect(reserve.members.map((z) => z.attrs.join())).toEqual(before.slice(13));
      expect(reserve.members.every((z) => z.present)).toBe(true);
      if (stage === 1) expect([game.counters.camp1, game.counters.camp2]).toEqual([0, 0]);
      else if (stage === 4) expect([game.counters.camp1, game.counters.camp2]).toEqual([0, 3]);
      else expect([game.counters.camp1, game.counters.camp2]).toEqual([3, 0]);
      // Étape brisée : ni marque « sans perte », ni monument, ni montée de niveau.
      expect(game.successes[screen - FIRST_PUZZLE]!).toBe(1);
      expect(game.monuments.every((m) => m === null)).toBe(true);
      expect(game.levels).toEqual([0, 0, 0, 0]);
      expect(game.stageUnbroken).toBe(false);
    });

    it("les touches 1 à 9 du pavé numérique comptent aussi, et la perte est bornée à la taille du groupe moins 1", async () => {
      const pad = await start(FIRST_PUZZLE);
      await pad.press("Numpad2");
      expect(pad.zoombinis.game.group.members).toHaveLength(14);
      const small = await start(FIRST_PUZZLE, 3);
      await small.press("Digit9");
      expect(small.zoombinis.game.group.members).toHaveLength(1);
      expect(small.zoombinis.game.pickerGroup.members).toHaveLength(2);
      const alone = await start(FIRST_PUZZLE, 1);
      await alone.press("Digit5");
      expect(alone.zoombinis.game.group.members).toHaveLength(1);
      expect(alone.zoombinis.game.pickerGroup.members).toHaveLength(0);
      expect(alone.zoombinis.lastChange).toMatchObject({ target: S.tunnels });
    });

    it("la perte d'une dernière épreuve parfaite n'a ni monument ni niveau", async () => {
      const { press, zoombinis } = await start(S.pizza);
      await press("Digit1");
      expect(zoombinis.game.monuments.every((m) => m === null)).toBe(true);
      expect(zoombinis.game.levels).toEqual([0, 0, 0, 0]);
    });
  });

  describe("échec (E)", () => {
    it.each(PUZZLES)("écran %i : avertissement, puis carte sans réussite et groupe abandonné", async (screen) => {
      const { press, zoombinis, dialog, engine, entered } = await start(screen);
      await press("KeyE");
      expect(dialog.isOpen).toBe(true);
      expect(zoombinis.lastChange).toBeNull();
      await press("Enter");
      expect(engine.error).toBeNull();
      expect(dialog.isOpen).toBe(false);
      expect(zoombinis.lastChange).toMatchObject({ screen: S.map, target: null, transfer: null });
      expect(engine.scenes.currentId).toBe(S.map);
      expect(entered).toContain(S.map);
      const { game } = zoombinis;
      expect(game.group.members).toHaveLength(0);
      expect(game.successes[screen - FIRST_PUZZLE]).toBe(0);
      expect(game.pickerGroup.members).toHaveLength(0);
      expect(game.camp1Group.members).toHaveLength(0);
      expect(game.camp2Group.members).toHaveLength(0);
      expect(game.counters).toMatchObject({ camp1: 0, camp2: 0, town: 0 });
    });

    it("refuser l'avertissement garde l'épreuve en cours", async () => {
      const { press, zoombinis, dialog, engine } = await start(S.tunnels);
      await press("KeyE");
      expect(dialog.isOpen).toBe(true);
      await press("Escape");
      expect(dialog.isOpen).toBe(false);
      expect(zoombinis.lastChange).toBeNull();
      expect(engine.scenes.currentId).toBe(S.tunnels);
      await press("KeyR");
      expect(zoombinis.lastChange).toMatchObject({ target: S.pizza });
    });
  });

  it("ignore Ctrl, Alt, les autres touches et les touches pendant une boîte de dialogue", async () => {
    const { press, zoombinis, engine, dialog } = await start(S.ferry);
    await press("KeyR", { ctrl: true });
    await press("KeyR", { alt: true });
    await press("Digit2", { ctrl: true });
    await press("KeyE", { ctrl: true });
    await press("KeyX");
    await press("Digit0");
    expect(zoombinis.lastChange).toBeNull();
    expect(dialog.isOpen).toBe(false);
    expect(engine.scenes.currentId).toBe(S.ferry);
    await press("KeyE");
    await press("KeyR");
    expect(zoombinis.lastChange).toBeNull();
    expect(dialog.isOpen).toBe(true);
  });

  it("refuse un écran qui n'est pas une épreuve", () => {
    expect(() => createPuzzleStubScene(S.baseCamp)).toThrow(RangeError);
    expect(() => createPuzzleStubScene(S.picker)).toThrow(RangeError);
  });
});

describe.skipIf(!original.has)("parcours complet avec les épreuves provisoires", () => {
  /** Écran de camp factice : les règles de `team.ts`, comme `route.test.ts`, puis il part tout de suite (chemin A au camp 1). */
  function dummyCamp(camp: 1 | 2, screen: number): () => Scene {
    return () => ({
      enter(ctx) {
        const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
        const { game, session } = zoombinis;
        session.screen = screen;
        const arrival = campArrive(game, camp);
        const members = arrival.party;
        for (let i = 0; i < 625 && members.length < 16; i += 1) {
          const z = takeFromShelf(game, camp, i);
          if (z) members.push(z);
        }
        expect(campExitAllowed(game, camp, members.length)).toBe(true);
        campLeave(game, session, camp, members, false);
        zoombinis.goTo(ctx, nextScreen(screen, "success", "A"));
      },
      leave() {},
      tick() {},
    });
  }

  const dummyTown = (): Scene => ({
    enter(ctx) {
      const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
      zoombinis.session.screen = S.town;
      townArrive(zoombinis.game);
      zoombinis.goTo(ctx, nextScreen(S.town, "success"));
    },
    leave() {},
    tick() {},
  });

  it("du choix des Zoombinis à la ville : chemin A, un Zoombini perdu à la fumée, monuments et niveaux, retour à la carte", async () => {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 11 });
    const services = await installServices(engine);
    const visited: number[] = [];
    engine.register(S.picker, createPickerScene);
    const transfers: number[] = [];
    engine.register(S.xfer, () => {
      const scene = createXferScene();
      return { ...scene, enter: (ctx) => (transfers.push(S.xfer), scene.enter?.(ctx)) };
    });
    engine.register(S.map, createMapScene);
    engine.register(S.baseCamp, dummyCamp(1, S.baseCamp));
    engine.register(S.bcTwo, dummyCamp(2, S.bcTwo));
    engine.register(S.town, dummyTown);
    for (const screen of PUZZLES) engine.register(screen as ScreenId, () => createPuzzleStubScene(screen));
    const zoombinis = services.game;
    zoombinis.session.screen = S.picker;
    zoombinis.session.previous = S.map;
    zoombinis.game.resumeScreen = S.picker;
    engine.start(S.picker);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();

    // Choix : 16 Zoombinis par clics (attributs puis « ajouter »), puis départ.
    const attribute = (row: number, value: number): [number, number] => [3 + 39 * (value - 1) + 19, 304 + 44 * row + 20];
    const chosen = [0, 0, 0, 0];
    for (let i = 0; i < 16; i++) {
      const attrs = [1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + (i % 3), 1];
      for (let row = 0; row < 4; row++) {
        if (chosen[row] !== attrs[row]) {
          host.click(...attribute(row, attrs[row]!));
          await runFor(engine, host, 20 * TICK_MS);
        }
        chosen[row] = attrs[row]!;
      }
      host.click(232, 323);
      await runFor(engine, host, 20 * TICK_MS);
    }
    await runFor(engine, host, 20000);
    expect(zoombinis.game.group.members).toHaveLength(16);
    host.click(619, 459);

    /** Joue jusqu'à `screen` (les transitions sont écourtées d'un clic), 6000 ticks au plus. */
    const reach = async (screen: number) => {
      for (let i = 0; i < 6000 && engine.scenes.currentId !== screen; i++) {
        if (engine.scenes.currentId === S.xfer && engine.ctx.clock.ticks % 40 === 0) host.click(320, 240);
        await runFor(engine, host, TICK_MS);
        expect(engine.error).toBeNull();
        const id = engine.scenes.currentId as number;
        if (visited[visited.length - 1] !== id) visited.push(id);
      }
      expect(engine.scenes.currentId).toBe(screen);
      await runFor(engine, host, TICK_MS * 3);
    };
    const key = async (code: string) => {
      host.press(code, { key: code });
      await runFor(engine, host, TICK_MS * 3);
    };

    await reach(S.bridge);
    await key("KeyR");
    await reach(S.tunnels);
    await key("KeyR");
    await reach(S.pizza);
    await key("KeyR");
    await reach(S.ferry);
    expect(zoombinis.game.group.members).toHaveLength(16);
    // Étape 1 parfaite : monument et niveau 1.
    expect(zoombinis.game.levels).toEqual([1, 0, 0, 0]);
    expect(zoombinis.game.monuments[0]).toMatchObject({ stage: 1, level: 1 });
    await key("KeyR");
    await reach(S.lilly);
    await key("KeyR");
    await reach(S.slides);
    await key("KeyR");
    await reach(S.caves);
    await key("KeyR");
    await reach(S.smoke);
    await key("Digit1");
    await reach(S.maze2);
    expect(zoombinis.game.group.members).toHaveLength(15);
    await key("KeyR");
    await reach(S.map);

    const { game } = zoombinis;
    // Le perdu de l'étape 4 est rendu au camp 2 : 15 arrivent en ville, pas de monument ni de niveau pour l'étape brisée.
    expect(game.counters.town).toBe(15);
    expect(game.camp2Group.members).toHaveLength(1);
    expect(game.monuments.filter((m) => m !== null).map((m) => [m!.stage, m!.level])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(game.levels).toEqual([1, 1, 0, 0]);
    expect(game.masks.stage1).toBe(1);
    expect(game.masks.stage2).toBe(1);
    expect(game.masks.stage4).toBe(1);
    expect(game.group.members).toHaveLength(0);
    // Chemin attendu : choix, étape 1, camp 1, chemin A, camp 2, étape 4, ville, carte (avec les transitions intercalées, sauf de la ville à la carte).
    const screens = visited.filter((id) => id !== S.xfer);
    expect(screens).toEqual([S.picker, S.bridge, S.tunnels, S.pizza, S.baseCamp, S.ferry, S.lilly, S.slides, S.bcTwo, S.caves, S.smoke, S.maze2, S.town, S.map]);
    expect(transfers).toEqual(Array.from({ length: screens.length - 2 }, () => S.xfer));
  }, 180_000);
});
