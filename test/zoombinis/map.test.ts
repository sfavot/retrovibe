import { describe, expect, it, vi } from "vitest";
import { createZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { FEATURES, FeatureFlag } from "../../src/games/zoombinis/engine/features";
import { ScreenId } from "../../src/games/zoombinis/engine/scene";
import { GRAPHICS, installServices, SCREEN_HEIGHT, SCREEN_WIDTH } from "../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_TEXT } from "../../src/games/zoombinis/engine/text";
import { ZOOMBINIS_SOUND } from "../../src/games/zoombinis/engine/sound";
import { createMapScene } from "../../src/games/zoombinis/scenes/map";
import type { GameState } from "../../src/games/zoombinis/game/state";
import { originalFiles } from "../support/original";
import { runFor, TestHost } from "./engine-test-host";

const original = originalFiles("zoombinis", "files.json");

/** Centres des lieux utilisés (`1530:1634`) : Zoombinîle, gorges allergiques, abri du rocher, aire de grozarbre, Zoombiniville, fosse de monte-pierre. */
const HOME = [60, 400] as const;
const GORGES = [170, 343] as const;
const ROCK = [236, 269] as const;
const GROZARBRE = [442, 211] as const;
const TOWN = [578, 65] as const;
const MENU_BUTTON = [600, 30] as const;

const SCRIPT = { marks: 1000, icons: 1001, legend: 1002, key: 1003, label: 1004, menu: 1005 };

describe.skipIf(!original.has)("carte (écran 1)", () => {
  /** La carte avec `setup` appliqué à la partie ; les écrans de destination sont des scènes vides qui notent leur entrée. */
  async function start(setup?: (game: GameState, session: { training: number; name: string | null }) => void) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 1 });
    const services = await installServices(engine);
    const entered: number[] = [];
    engine.register(ScreenId.map, createMapScene);
    for (const id of [ScreenId.picker, ScreenId.baseCamp, ScreenId.bcTwo, ScreenId.town, ScreenId.bridge, ScreenId.tunnels]) {
      engine.register(id, () => ({ enter: () => void entered.push(id), leave() {}, tick() {} }));
    }
    const text = engine.services.get(ZOOMBINIS_TEXT);
    const drawn: string[] = [];
    const draw = text.drawText.bind(text);
    vi.spyOn(text, "drawText").mockImplementation((surface, font, value, ...rest) => {
      drawn.push(value);
      return draw(surface, font, value, ...rest);
    });
    const queue = vi.spyOn(services.sound, "queue");
    setup?.(services.game.game, services.game.session);
    services.game.session.screen = ScreenId.picker;
    engine.start(ScreenId.map);
    await runFor(engine, host, 200);
    const features = engine.services.get(FEATURES);
    const feature = (script: number) => features.features.find((f) => f.scriptId === script)!;
    return { host, engine, services, entered, drawn, queue, features, feature, zoombinis: services.game };
  }

  /** Numéros de forme (`w`) des parties d'un objet. */
  const shapes = (feature: { parts: { w: number }[] }) => feature.parts.map((part) => part.w).sort((a, b) => a - b);

  it("affiche le fond et la palette de MAP.MHK avec ses six objets", async () => {
    const { host, engine, features, entered } = await start();
    expect(engine.error).toBeNull();
    expect(engine.scenes.currentId).toBe(ScreenId.map);
    expect(entered).toEqual([]);
    const frame = host.frames[host.frames.length - 1]!;
    expect(frame.pixels.length).toBe(SCREEN_WIDTH * SCREEN_HEIGHT);
    expect(frame.pixels.some((p) => p !== 0)).toBe(true);
    expect(frame.palette.slice(10 * 3, 246 * 3).some((v) => v !== 0)).toBe(true);
    expect(features.features.map((f) => f.scriptId).sort()).toEqual(Object.values(SCRIPT).sort());
    // Le bouton du menu occupe le coin haut droit.
    expect(features.features.find((f) => f.scriptId === SCRIPT.menu)!.rect).toEqual({ left: 588, top: 15, right: 625, bottom: 45 });
  });

  it("vide le groupe courant à l'entrée (S−0x56D2 = 0)", async () => {
    const { zoombinis } = await start((game) => {
      game.group.members = [{ attrs: [1, 1, 1, 1], id: 0, present: true, state: new Uint8Array(10) }];
    });
    expect(zoombinis.game.group.members).toEqual([]);
    expect(zoombinis.session.screen).toBe(ScreenId.map);
  });

  describe("lieux actifs", () => {
    it("partie neuve : aucun lieu à marquer ni icône, Zoombinîle seul est actif", async () => {
      const { feature, host, engine } = await start();
      expect(shapes(feature(SCRIPT.marks))).toEqual([]);
      expect(shapes(feature(SCRIPT.icons))).toEqual([]);
      // Zoombinîle est actif : survolé, sa marque (forme 109 = 16 + 0x5d) apparaît.
      host.input.moveMouse(...HOME);
      await runFor(engine, host, 100);
      expect(shapes(feature(SCRIPT.marks))).toEqual([0x6d]);
    });

    it("étape 1 terminée : marques et icônes de l'abri du rocher et des trois épreuves réussies, au niveau 0", async () => {
      const { feature } = await start((game) => {
        game.masks.stage1 = 1;
        game.successes[0] = 1;
        game.successes[1] = 1;
        game.successes[2] = 1;
      });
      // Lieux 2, 3, 4 et 5 = marques 1 à 4 ; icônes 17 à 20 (variante 0).
      expect(shapes(feature(SCRIPT.marks))).toEqual([1, 2, 3, 4]);
      expect(shapes(feature(SCRIPT.icons))).toEqual([17, 18, 19, 20]);
    });

    it("niveau 2 de l'étape 1 : tous ses lieux sont actifs, icônes de la variante 2 (+0x20)", async () => {
      const { feature } = await start((game) => {
        game.levels[0] = 2;
      });
      expect(shapes(feature(SCRIPT.marks))).toEqual([1, 2, 3, 4]);
      expect(shapes(feature(SCRIPT.icons))).toEqual([17 + 0x20, 18 + 0x20, 19 + 0x20, 20 + 0x20]);
    });

    it("l'aire de grozarbre s'active par l'étape 2 ou 3, avec une icône propre à chacune", async () => {
      const byTwo = await start((game) => {
        game.masks.stage2 = 1;
      });
      expect(shapes(byTwo.feature(SCRIPT.marks))).toEqual([11]);
      expect(shapes(byTwo.feature(SCRIPT.icons))).toEqual([24]);
      const byThree = await start((game) => {
        game.masks.stage3 = 1;
      });
      expect(shapes(byThree.feature(SCRIPT.marks))).toEqual([11]);
      expect(shapes(byThree.feature(SCRIPT.icons))).toEqual([28]);
    });

    it("entraînement : les 16 lieux sont actifs, variante du niveau", async () => {
      const { feature } = await start((_game, session) => {
        session.training = 3;
      });
      expect(shapes(feature(SCRIPT.marks))).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
      expect(shapes(feature(SCRIPT.icons))).toEqual(Array.from({ length: 16 }, (_, i) => 17 + i + 0x20));
    });
  });

  describe("survol", () => {
    it("montre le nom du lieu (STRL 2000) et met en valeur un lieu cliquable", async () => {
      const { host, engine, feature, drawn } = await start((game) => {
        game.masks.stage1 = 1;
        game.successes[0] = 1;
      });
      expect(feature(SCRIPT.label).flags & FeatureFlag.noDraw).not.toBe(0);
      host.input.moveMouse(...ROCK);
      await runFor(engine, host, 100);
      expect(feature(SCRIPT.label).flags & FeatureFlag.noDraw).toBe(0);
      expect(drawn).toContain("l'abri du rocher");
      // Marque du lieu 5 (forme 4) remplacée par sa version survolée (4 + 0x5d).
      expect(shapes(feature(SCRIPT.marks))).toEqual([1, 4 + 0x5d]);
      // Le bandeau est celui de SCRB 1004 (221 × 21 à 24, 436).
      expect(feature(SCRIPT.label).rect).toEqual({ left: 24, top: 436, right: 245, bottom: 457 });
      host.input.moveMouse(300, 20);
      await runFor(engine, host, 100);
      expect(feature(SCRIPT.label).flags & FeatureFlag.noDraw).not.toBe(0);
      expect(shapes(feature(SCRIPT.marks))).toEqual([1, 4]);
    });

    it("un lieu actif mais non cliquable donne son nom sans mise en valeur", async () => {
      const { host, engine, feature, drawn } = await start((game) => {
        game.masks.stage1 = 1;
        game.successes[0] = 1;
      });
      host.input.moveMouse(...GORGES);
      await runFor(engine, host, 100);
      expect(drawn).toContain("les gorges allergiques");
      expect(shapes(feature(SCRIPT.marks))).toEqual([1, 4]);
    });

    it("ignore un lieu inactif", async () => {
      const { host, engine, feature } = await start();
      host.input.moveMouse(...ROCK);
      await runFor(engine, host, 100);
      expect(feature(SCRIPT.label).flags & FeatureFlag.noDraw).not.toBe(0);
    });

    it("le rectangle d'un lieu est de ±20 × ±15 autour de son centre, bords droit et bas exclus", async () => {
      const { host, engine, feature } = await start();
      host.input.moveMouse(HOME[0] + 19, HOME[1] + 14);
      await runFor(engine, host, 50);
      expect(feature(SCRIPT.label).flags & FeatureFlag.noDraw).toBe(0);
      host.input.moveMouse(HOME[0] + 20, HOME[1]);
      await runFor(engine, host, 50);
      expect(feature(SCRIPT.label).flags & FeatureFlag.noDraw).not.toBe(0);
    });
  });

  describe("panneaux", () => {
    it("aventure : titre = nom de la partie, effectifs des quatre lieux, « touche terrain » et les quatre niveaux", async () => {
      const { drawn } = await start((game, session) => {
        session.name = "Suzanne";
        game.counters.camp1 = 12;
        game.counters.camp2 = 3;
        game.counters.town = 7;
      });
      expect(drawn).toEqual(expect.arrayContaining(["Suzanne", "zoombinîle", "abri rocher", "aire grozarbre", "zoombiniville"]));
      // 625 − (12 + 3 + 7) à Zoombinîle.
      expect(drawn).toEqual(expect.arrayContaining(["603", "12", "3", "7"]));
      expect(drawn).toEqual(expect.arrayContaining(["touche terrain", "pas si facile", "assez difficile", "très difficile", "mission impossible"]));
      expect(drawn).not.toContain("entraînement");
      expect(drawn).not.toContain("choisis un niveau");
    });

    it("entraînement : « entraînement » et « retour à la partie » selon l'avancement, « choisis un niveau », noms des 4 étapes", async () => {
      const fresh = await start((_game, session) => {
        session.training = 1;
      });
      expect(fresh.drawn).toEqual(expect.arrayContaining(["entraînement", "retour à la partie:", "aller à zoombinîle", "choisis un niveau"]));
      expect(fresh.drawn).toEqual(expect.arrayContaining(["le marais quajeux", "les monts\rdu désespoir", "la forêt\rde chaussée", "le gros, la brute\ret le gourmand"]));
      expect(fresh.drawn).not.toContain("touche terrain");
      expect(fresh.drawn).not.toContain("ou à l'abri du rocher");
      const far = await start((game, session) => {
        session.training = 2;
        game.masks.stage4 = 1;
      });
      expect(far.drawn).toContain("de base ou zoombini- ville");
      const camp = await start((game, session) => {
        session.training = 2;
        game.masks.stage1 = 1;
      });
      expect(camp.drawn).toContain("ou à l'abri du rocher");
    });

    it("aventure : seuls les noms des étapes dont un lieu est actif sont écrits dans le fond", async () => {
      const none = await start();
      expect(none.drawn).not.toContain("le marais quajeux");
      expect(none.drawn).not.toContain("le gros, la brute\ret le gourmand");
      const stageOne = await start((game) => {
        game.masks.stage1 = 1;
        game.successes[0] = 1;
      });
      expect(stageOne.drawn).toContain("le gros, la brute\ret le gourmand");
      expect(stageOne.drawn).not.toContain("le marais quajeux");
    });

    it("entraînement : la puce du niveau courant est en relief (forme + 4, décalée de −2, −2)", async () => {
      const { feature } = await start((_game, session) => {
        session.training = 3;
      });
      const raised = feature(SCRIPT.key).parts.find((part) => part.w === 86 + 4)!;
      expect(raised).toMatchObject({ x: 453 - 2, y: 427 - 2 });
      expect(feature(SCRIPT.key).parts.some((part) => part.w === 86)).toBe(false);
    });
  });

  describe("clics en aventure", () => {
    it("Zoombinîle mène au choix des Zoombinis (3), le son 998 est joué, le groupe est abandonné", async () => {
      const { host, engine, entered, queue, zoombinis } = await start();
      host.click(...HOME);
      await runFor(engine, host, 100);
      expect(queue).toHaveBeenCalledWith(998);
      expect(zoombinis.lastChange?.screen).toBe(ScreenId.picker);
      expect(entered).toEqual([ScreenId.picker]);
      expect(zoombinis.game.group.members).toEqual([]);
    });

    it("l'abri du rocher (étape 1 terminée) mène au camp 1 (4)", async () => {
      const { host, engine, entered } = await start((game) => {
        game.masks.stage1 = 1;
      });
      host.click(...ROCK);
      await runFor(engine, host, 100);
      expect(entered).toEqual([ScreenId.baseCamp]);
    });

    it("l'aire de grozarbre mène au camp 2 (5) et Zoombiniville (étape 4 terminée) à la ville (6)", async () => {
      const camp = await start((game) => {
        game.masks.stage3 = 2;
      });
      camp.host.click(...GROZARBRE);
      await runFor(camp.engine, camp.host, 100);
      expect(camp.entered).toEqual([ScreenId.bcTwo]);
      const town = await start((game) => {
        game.masks.stage4 = 1;
      });
      town.host.click(...TOWN);
      await runFor(town.engine, town.host, 100);
      expect(town.entered).toEqual([ScreenId.town]);
    });

    it("un lieu d'épreuve, même actif, ne se choisit pas à la carte", async () => {
      const { host, engine, entered, queue } = await start((game) => {
        game.masks.stage1 = 1;
        game.successes[0] = 1;
      });
      host.click(...GORGES);
      await runFor(engine, host, 100);
      expect(entered).toEqual([]);
      expect(engine.scenes.currentId).toBe(ScreenId.map);
      expect(queue).not.toHaveBeenCalled();
    });

    it("un lieu inactif ne répond pas", async () => {
      const { host, engine, entered } = await start();
      host.click(...ROCK);
      await runFor(engine, host, 100);
      expect(entered).toEqual([]);
    });

    it("le bouton du menu joue le son 999 et ne change pas d'écran (la boîte est branchée en G5)", async () => {
      const { host, engine, entered, queue } = await start();
      host.click(...MENU_BUTTON);
      await runFor(engine, host, 100);
      expect(queue).toHaveBeenCalledWith(999);
      expect(entered).toEqual([]);
      expect(engine.scenes.currentId).toBe(ScreenId.map);
    });

    it("Maj entre en entraînement au niveau 0 ; les touches 1 à 4 ne font rien en aventure", async () => {
      const { host, engine, zoombinis } = await start();
      host.press("Digit3", { key: "3" });
      await runFor(engine, host, 50);
      expect(zoombinis.session.training).toBe(0);
      host.press("ShiftLeft", { shift: true, key: "Shift" });
      await runFor(engine, host, 50);
      expect(zoombinis.session.training).toBe(1);
    });
  });

  describe("entraînement", () => {
    it("les touches 1 à 4 changent de niveau, Maj n'y change rien ; tout se recompose", async () => {
      const { host, engine, zoombinis, feature, drawn } = await start((_game, session) => {
        session.training = 1;
      });
      host.press("Digit4", { key: "4" });
      await runFor(engine, host, 50);
      expect(zoombinis.session.training).toBe(4);
      expect(shapes(feature(SCRIPT.icons))[0]).toBe(17 + 0x30);
      expect(feature(SCRIPT.key).parts.some((part) => part.w === 87 + 4)).toBe(true);
      host.press("ShiftLeft", { shift: true, key: "Shift" });
      await runFor(engine, host, 50);
      expect(zoombinis.session.training).toBe(4);
      expect(drawn).toContain("choisis un niveau");
    });

    it("cliquer une ligne du menu des niveaux choisit ce niveau", async () => {
      const { host, engine, zoombinis } = await start((_game, session) => {
        session.training = 1;
      });
      host.click(500, 430);
      await runFor(engine, host, 50);
      expect(zoombinis.session.training).toBe(3);
    });

    it("Maj puis un lieu d'épreuve : l'épreuve est demandée avec un groupe d'entraînement de 16 Zoombinis", async () => {
      const { host, engine, entered, zoombinis } = await start();
      host.press("ShiftLeft", { shift: true, key: "Shift" });
      await runFor(engine, host, 50);
      host.click(...GORGES);
      await runFor(engine, host, 100);
      expect(entered).toEqual([ScreenId.bridge]);
      expect(zoombinis.game.group.members).toHaveLength(16);
    });

    it("les camps et la ville ne répondent que s'ils sont atteints dans la partie", async () => {
      const { host, engine, entered } = await start((_game, session) => {
        session.training = 1;
      });
      host.click(...ROCK);
      await runFor(engine, host, 100);
      expect(entered).toEqual([]);
      expect(engine.scenes.currentId).toBe(ScreenId.map);
    });

    it("quitter l'entraînement par Zoombinîle rend la partie mise de côté à la première sortie", async () => {
      const { host, engine, entered, zoombinis } = await start((game) => {
        game.counters.camp1 = 3;
      });
      host.press("ShiftLeft", { shift: true, key: "Shift" });
      await runFor(engine, host, 50);
      host.click(...GORGES);
      await runFor(engine, host, 100);
      expect(entered).toEqual([ScreenId.bridge]);
      // L'épreuve d'entraînement abîme la partie…
      zoombinis.game.counters.camp1 = 99;
      zoombinis.game.masks.stage1 = 15;
      // … retour à la carte, puis Zoombinîle : la partie d'avant l'entraînement est restituée.
      engine.scenes.request(ScreenId.map);
      await runFor(engine, host, 100);
      expect(engine.scenes.currentId).toBe(ScreenId.map);
      expect(zoombinis.session.training).toBe(1);
      host.click(...HOME);
      await runFor(engine, host, 100);
      expect(zoombinis.session.training).toBe(0);
      expect(zoombinis.game.counters.camp1).toBe(3);
      expect(zoombinis.game.masks.stage1).toBe(0);
      expect(entered).toEqual([ScreenId.bridge, ScreenId.picker]);
    });
  });

  it("le dessin sort de la carte sans erreur et libère ses objets", async () => {
    const { host, engine, features } = await start((game) => {
      game.masks.stage1 = 1;
    });
    host.click(...HOME);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    expect(features.features).toHaveLength(0);
    expect(engine.services.get(GRAPHICS).screen.width).toBe(SCREEN_WIDTH);
    expect(engine.services.get(ZOOMBINIS_SOUND)).toBeDefined();
  });
});
