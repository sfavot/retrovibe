import { describe, expect, it, vi } from "vitest";
import { createZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { FEATURES, FeatureFlag, type Feature } from "../../src/games/zoombinis/engine/features";
import { ScreenId } from "../../src/games/zoombinis/engine/scene";
import { installServices } from "../../src/games/zoombinis/engine/services";
import { makeZoombini, type GameState, type Zoombini } from "../../src/games/zoombinis/game/state";
import { depositToReserve, type Camp } from "../../src/games/zoombinis/game/team";
import { createBaseCampScene, createBcTwoScene } from "../../src/games/zoombinis/scenes/camp";
import { originalFiles } from "../support/original";
import { runFor, TestHost } from "./engine-test-host";

const original = originalFiles("zoombinis", "files.json");

type Pt = readonly [number, number];

/** Les 16 places (`DS:06e4`, `DS:0930`). */
const PLACES: Record<Camp, readonly Pt[]> = {
  1: [[404, 334], [389, 354], [362, 339], [350, 363], [323, 348], [304, 367], [280, 350], [262, 368], [238, 346], [221, 366], [193, 352], [176, 371], [152, 351], [133, 369], [110, 341], [94, 361]],
  2: [[490, 372], [458, 359], [450, 384], [412, 376], [393, 398], [365, 386], [348, 405], [321, 389], [304, 410], [278, 397], [264, 417], [234, 400], [218, 420], [197, 398], [177, 418], [152, 403]],
};

/** Boutons (`DS:04ac`, `DS:0764`) : centres des sorties, de la carte et des quatre flèches. */
const BUTTONS: Record<Camp, { exits: Pt[]; map: Pt; arrows: Pt[]; zone: [number, number, number, number]; cell: (column: number, row: number) => Pt }> = {
  1: {
    exits: [[618, 328], [618, 404]],
    map: [618, 366],
    arrows: [[27, 141], [43, 141], [265, 141], [281, 141]],
    zone: [55, 19, 255, 252],
    cell: (column, row) => [[75, 115, 155, 195, 235][column]!, [[39, 86, 133, 180, 227], [40, 87, 134, 181, 228], [39, 86, 133, 180, 227], [36, 83, 130, 177, 224], [31, 78, 125, 172, 219]][column]![row]!],
  },
  2: {
    exits: [[618, 338]],
    map: [618, 376],
    arrows: [[122, 164], [137, 161], [343, 151], [355, 154]],
    zone: [112, 0, 377, 293],
    cell: (column, row) => [[163, 203, 243, 283, 323][column]!, [[55, 102, 149, 196, 243], [55, 102, 150, 196, 243], [54, 102, 149, 196, 243], [52, 99, 146, 193, 240], [46, 93, 141, 187, 235]][column]![row]!],
  },
};

const SCENES = { 1: createBaseCampScene, 2: createBcTwoScene } as const;
const SCREENS = { 1: ScreenId.baseCamp, 2: ScreenId.bcTwo } as const;
const EXIT_SCREENS: Record<Camp, readonly ScreenId[]> = { 1: [ScreenId.ferry, ScreenId.fleens], 2: [ScreenId.caves] };
/** Numéros de trajet `XFER` des sorties (`TRANSFER_ROUTES`). */
const TRANSFERS: Record<Camp, readonly number[]> = { 1: [5, 9], 2: [13] };

/** Un Zoombini de type `i` (types distincts pour `i` < 625). */
const type = (i: number): [number, number, number, number] => [1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + (Math.floor(i / 25) % 5), 1 + (Math.floor(i / 125) % 5)];
const zoombini = (i: number, present = true): Zoombini => makeZoombini(type(i), i + 1, present);

describe.skipIf(!original.has).each([1, 2] as const)("camp de base %i", (camp) => {
  const screen = SCREENS[camp];
  const buttons = BUTTONS[camp];
  const counter = (game: GameState): number => (camp === 1 ? game.counters.camp1 : game.counters.camp2);
  const reserve = (game: GameState) => (camp === 1 ? game.camp1 : game.camp2);
  const groupReserve = (game: GameState) => (camp === 1 ? game.camp1Group : game.camp2Group);

  /**
   * Le camp, atteint depuis `from` avec l'état préparé par `setup` (groupe du tampon : survivants à l'arrivée, `present` faux = perdus).
   * Les écrans de sortie sont des scènes vides qui notent leur entrée.
   */
  async function start(setup?: (game: GameState, session: { previous: number; lastFinal: number; training: number }) => void, from: number = ScreenId.xfer, ms = 100) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 11 });
    const services = await installServices(engine);
    const entered: number[] = [];
    engine.register(screen, SCENES[camp]);
    for (const id of [ScreenId.map, ScreenId.xfer, ...EXIT_SCREENS[camp]]) engine.register(id, () => ({ enter: () => void entered.push(id), leave() {}, tick() {} }));
    const queue = vi.spyOn(services.sound, "queue");
    setup?.(services.game.game, services.game.session);
    services.game.session.screen = screen;
    services.game.session.previous = from;
    engine.start(screen);
    await runFor(engine, host, ms);
    expect(engine.error).toBeNull();
    const features = engine.services.get(FEATURES);
    const zoombinis = services.game;
    const all = () => features.features.filter((f) => f.hasFlag(FeatureFlag.snoid));
    /** Les Zoombinis du groupe (profondeur au-dessus de 1) et ceux du présentoir (0,2). */
    const group = () => all().filter((f) => f.depth > 1);
    const shelf = () => all().filter((f) => f.depth < 1);
    const click = async (at: Pt, wait = 40) => {
      host.click(at[0], at[1]);
      await runFor(engine, host, wait);
    };
    /** Glisser-déposer : appui en `from`, déplacement, relâchement en `to`. */
    const drag = async (from: Pt, to: Pt, wait = 400) => {
      host.input.moveMouse(from[0], from[1]);
      host.input.mouseDown("left");
      await runFor(engine, host, 60);
      host.input.moveMouse((from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
      await runFor(engine, host, 60);
      host.input.moveMouse(to[0], to[1]);
      await runFor(engine, host, 60);
      host.input.mouseUp("left");
      await runFor(engine, host, wait);
    };
    /** Point au milieu du corps du Zoombini qui tient sur la place `i`. */
    const onPlace = (i: number): Pt | undefined => {
      const [x, y] = PLACES[camp][i]!;
      const found = group().find((f) => f.rect && Math.abs((f.rect.left + f.rect.right) / 2 - x) < 12 && Math.abs((f.rect.top + f.rect.bottom) / 2 - y) < 14);
      return found && [x, y];
    };
    return { host, engine, services, zoombinis, entered, queue, features, all, group, shelf, click, drag, onPlace };
  }

  const members = (n: number, first = 0) => Array.from({ length: n }, (_, i) => zoombini(first + i));

  it("arrivée d'un groupe de 16 sans perdus : compté au camp, trois quarts debout, le dernier quart entre à pied par la gauche", async () => {
    const { zoombinis, group, engine, host } = await start((game, session) => {
      game.group.members = members(16);
      game.counters.created = 16;
      session.lastFinal = 0;
    });
    const { game } = zoombinis;
    expect(counter(game)).toBe(16);
    expect(group()).toHaveLength(16);
    expect(game.group.members).toEqual([]);
    expect(reserve(game).count).toBe(0);
    // Douze sont déjà sur leurs places ; les quatre derniers attendent hors de l'écran, à gauche.
    const visible = group().filter((f) => f.rect!.right > 0);
    expect(visible).toHaveLength(12);
    await runFor(engine, host, 200);
    expect(group().filter((f) => f.rect!.right > 0).length).toBeGreaterThanOrEqual(12);
    await runFor(engine, host, 30000);
    for (const [x, y] of PLACES[camp]) {
      expect(group().some((f) => x >= f.rect!.left - 10 && x <= f.rect!.right + 10 && y >= f.rect!.top - 10 && y <= f.rect!.bottom + 20)).toBe(true);
    }
    expect(group().every((f) => !f.active)).toBe(true);
  });

  it("arrivée avec des perdus : les survivants forment le groupe, les perdus sont versés sur le présentoir (cinq par colonne)", async () => {
    const { zoombinis, group, shelf, features } = await start((game) => {
      // Comme `exitPuzzle` : les survivants dans le tampon, les perdus dans la réserve de groupe du camp (déjà comptés).
      game.group.members = members(13);
      groupReserve(game).members = [zoombini(500), zoombini(501), zoombini(502)];
      game.counters.created = 16;
      if (camp === 1) game.counters.camp1 = 3;
      else game.counters.camp2 = 3;
    });
    const { game } = zoombinis;
    // 3 perdus déjà comptés par `exitPuzzle`, plus 13 survivants.
    expect(counter(game)).toBe(16);
    expect(group()).toHaveLength(13);
    expect(reserve(game).count).toBe(3);
    expect(shelf()).toHaveLength(3);
    expect(reserve(game).entries.slice(0, 3).map((e) => e?.attrs)).toEqual([type(500), type(501), type(502)]);
    // Trois Zoombinis dans la première colonne, du haut vers le bas.
    const centers = shelf().map((f) => [(f.rect!.left + f.rect!.right) / 2, (f.rect!.top + f.rect!.bottom) / 2] as const);
    expect(centers.every(([x]) => Math.abs(x - buttons.cell(0, 0)[0]) < 12)).toBe(true);
    expect(centers.map(([, y]) => y).sort((a, b) => a - b)).toEqual(centers.map(([, y]) => y).sort((a, b) => a - b));
    expect(features.features.some((f) => f.scriptId === (camp === 1 ? 1200 : 7000))).toBe(true);
  });

  it("retour de la carte : le groupe laissé revient debout sur ses places, sans marcher et sans changer le compteur", async () => {
    const { zoombinis, group, host, engine } = await start((game) => {
      groupReserve(game).members = members(16);
      groupReserve(game).flagA = false;
      game.counters.created = 16;
      if (camp === 1) game.counters.camp1 = 16;
      else game.counters.camp2 = 16;
    }, ScreenId.map);
    expect(group()).toHaveLength(16);
    expect(group().every((f) => f.rect!.right > 0)).toBe(true);
    await runFor(engine, host, 300);
    expect(group().every((f) => !f.active)).toBe(true);
    expect(counter(zoombinis.game)).toBe(16);
  });

  it("déposer un Zoombini du groupe sur le présentoir : il quitte le groupe, l'entrée est dans la réserve, la sortie est refusée", async () => {
    const { zoombinis, group, shelf, drag, onPlace, click, engine, host, queue, entered } = await start(
      (game) => {
        groupReserve(game).members = members(16);
        game.counters.created = 16;
      },
      ScreenId.map,
    );
    const from = onPlace(5)!;
    expect(from).toBeDefined();
    await drag(from, buttons.cell(3, 1));
    const { game } = zoombinis;
    expect(group()).toHaveLength(15);
    expect(reserve(game).count).toBe(1);
    expect(shelf()).toHaveLength(1);
    expect(reserve(game).entries.filter((e) => e !== null).map((e) => e!.attrs)).toEqual([type(5)]);
    // Quinze Zoombinis : la sortie est refusée par une phrase d'aide, l'écran ne change pas.
    queue.mockClear();
    await click(buttons.exits[0]!, 60);
    expect(queue.mock.calls.some(([id]) => (camp === 1 ? [0x4e51] : [0x4e74, 0x4e75, 0x4e72]).includes(id))).toBe(true);
    expect(queue).not.toHaveBeenCalledWith(996);
    await runFor(engine, host, 3000);
    expect(engine.scenes.currentId).toBe(screen);
    expect(entered).toEqual([]);
  });

  it("reprendre un Zoombini du présentoir : l'entrée est vidée, il rejoint une place libre du groupe ; hors d'une place il retourne à son entrée", async () => {
    const { zoombinis, group, shelf, drag, onPlace } = await start((game) => {
      groupReserve(game).members = members(15);
      depositToReserve(reserve(game), [zoombini(300), zoombini(301)]);
      game.counters.created = 17;
      if (camp === 1) game.counters.camp1 = 17;
      else game.counters.camp2 = 17;
    }, ScreenId.map);
    const { game } = zoombinis;
    expect(group()).toHaveLength(15);
    expect(shelf()).toHaveLength(2);
    // Lâché dans le décor, loin de toute place et du présentoir : il retourne à son entrée.
    await drag(buttons.cell(0, 1), [560, 120]);
    expect(reserve(game).count).toBe(2);
    expect(group()).toHaveLength(15);
    // Lâché sur la place libre (la 16e) : il rejoint le groupe.
    const free = PLACES[camp][15]!;
    expect(onPlace(15)).toBeUndefined();
    await drag(buttons.cell(0, 0), free);
    expect(reserve(game).count).toBe(1);
    expect(group()).toHaveLength(16);
    expect(reserve(game).entries.filter((e) => e !== null).map((e) => e!.attrs)).toEqual([type(301)]);
    expect(shelf()).toHaveLength(1);
  });

  it("compléter un groupe de 14 avec deux Zoombinis du présentoir : la sortie s'ouvre", async () => {
    const { zoombinis, group, drag, click, engine, host, queue, entered } = await start((game) => {
      groupReserve(game).members = members(14);
      depositToReserve(reserve(game), [zoombini(400), zoombini(401), zoombini(402)]);
      game.counters.created = 17;
      if (camp === 1) game.counters.camp1 = 17;
      else game.counters.camp2 = 17;
    }, ScreenId.map);
    const { game } = zoombinis;
    await drag(buttons.cell(0, 0), PLACES[camp][14]!);
    await drag(buttons.cell(0, 1), PLACES[camp][15]!);
    expect(group()).toHaveLength(16);
    expect(reserve(game).count).toBe(1);
    queue.mockClear();
    await click(buttons.exits[0]!, 60);
    expect(queue).toHaveBeenCalledWith(996);
    await runFor(engine, host, 30000);
    expect(entered).toEqual([ScreenId.xfer]);
    expect(zoombinis.lastChange).toEqual({ screen: ScreenId.xfer, target: EXIT_SCREENS[camp][0], transfer: TRANSFERS[camp][0] });
    // Le groupe de 16 part dans le tampon et dans la réserve de groupe du camp ; le reste reste au camp.
    expect(game.group.members).toHaveLength(16);
    expect(groupReserve(game).members).toHaveLength(16);
    expect(counter(game)).toBe(17 - 16);
    expect(reserve(game).count).toBe(1);
  });

  it("chaque sortie est refusée avec 15 Zoombinis (phrase d'aide) puis acceptée avec 16 : son 996, écran de transition, groupe dans le tampon", async () => {
    for (const [index, target] of EXIT_SCREENS[camp].entries()) {
      const { zoombinis, click, drag, engine, host, queue, entered } = await start(
        (game) => {
          groupReserve(game).members = members(15);
          depositToReserve(reserve(game), [zoombini(600)]);
          game.counters.created = 16;
          if (camp === 1) game.counters.camp1 = 16;
          else game.counters.camp2 = 16;
        },
        ScreenId.map,
      );
      queue.mockClear();
      await click(buttons.exits[index]!, 60);
      expect(queue).not.toHaveBeenCalledWith(996);
      expect(queue.mock.calls.some(([id]) => id >= 20000 && id < 30000)).toBe(true);
      await runFor(engine, host, 2000);
      expect(engine.scenes.currentId).toBe(screen);
      expect(entered).toEqual([]);
      // Le seizième vient du présentoir.
      await drag(buttons.cell(0, 0), PLACES[camp][15]!);
      queue.mockClear();
      await click(buttons.exits[index]!, 60);
      expect(queue).toHaveBeenCalledWith(996);
      // Tant que le son de départ joue, l'écran reste ; puis il change.
      expect(entered).toEqual([]);
      await runFor(engine, host, 40000);
      expect(entered).toEqual([ScreenId.xfer]);
      expect(zoombinis.lastChange).toEqual({ screen: ScreenId.xfer, target, transfer: TRANSFERS[camp][index] });
      expect(zoombinis.game.group.members).toHaveLength(16);
      expect(counter(zoombinis.game)).toBe(0);
      expect(groupReserve(zoombinis.game).flagA).toBe(true);
    }
  });

  it("un clic pendant le départ fait changer d'écran tout de suite", async () => {
    const { zoombinis, click, engine, host } = await start(
      (game) => {
        groupReserve(game).members = members(16);
        game.counters.created = 16;
      },
      ScreenId.map,
    );
    await click(buttons.exits[0]!, 40);
    expect(zoombinis.lastChange).toBeNull();
    await click([300, 100], 60);
    expect(zoombinis.lastChange?.target).toBe(EXIT_SCREENS[camp][0]);
    expect(engine.scenes.currentId).toBe(ScreenId.xfer);
    void host;
  });

  it("le bouton carte garde le groupe et le compteur, sans dialogue ; le groupe revient debout à l'entrée suivante", async () => {
    const { zoombinis, click, engine, host, entered, group } = await start((game) => {
      game.group.members = members(16);
      game.counters.created = 16;
    });
    await click(buttons.map, 100);
    expect(engine.scenes.currentId).toBe(ScreenId.map);
    expect(entered).toEqual([ScreenId.map]);
    const { game } = zoombinis;
    expect(groupReserve(game).members).toHaveLength(16);
    expect(game.group.members).toEqual([]);
    expect(counter(game)).toBe(16);
    zoombinis.session.screen = ScreenId.map;
    engine.scenes.request(screen);
    await runFor(engine, host, 200);
    expect(engine.scenes.currentId).toBe(screen);
    expect(group()).toHaveLength(16);
    expect(counter(game)).toBe(16);
  });

  it("le présentoir défile avec les flèches : colonne par colonne (pas de 1) ou cinq par cinq (pas de 5), borné, le son 2000 puis 2001", async () => {
    const { zoombinis, click, shelf, queue } = await start((game) => {
      depositToReserve(reserve(game), members(60, 100));
      game.counters.created = 60;
    }, ScreenId.map);
    const { game } = zoombinis;
    expect(reserve(game).scroll).toBe(0);
    expect(shelf()).toHaveLength(25);
    queue.mockClear();
    // Flèche de droite, pas de 1 : une colonne.
    await click(buttons.arrows[2]!, 600);
    expect(reserve(game).scroll).toBe(1);
    expect(queue).toHaveBeenCalledWith(2000);
    // Pas de 5.
    await click(buttons.arrows[3]!, 1500);
    expect(reserve(game).scroll).toBe(6);
    // Retour à gauche par pas de 5, puis de 1 : de nouveau au début, et la flèche reste sans effet à la limite.
    await click(buttons.arrows[0]!, 1500);
    expect(reserve(game).scroll).toBe(1);
    await click(buttons.arrows[1]!, 600);
    expect(reserve(game).scroll).toBe(0);
    // À gauche de la première colonne : tout le présentoir recule d'une colonne (`10b0:17df`), une colonne vide apparaît.
    await click(buttons.arrows[1]!, 1500);
    expect(reserve(game).scroll).toBe(0);
    expect(reserve(game).entries.slice(0, 5).every((e) => e === null)).toBe(true);
    expect(reserve(game).entries[5]!.attrs).toEqual(type(100));
    // Puis la flèche reste sans effet : plus de page à gauche.
    await click(buttons.arrows[1]!, 1500);
    expect(reserve(game).scroll).toBe(0);
    expect(reserve(game).entries[5]!.attrs).toEqual(type(100));
    // La colonne vide est à gauche : le premier Zoombini affiché est dans la deuxième colonne.
    const first = shelf().map((f) => f.rect!.left).sort((a, b) => a - b)[0]!;
    expect(first).toBeGreaterThan(buttons.cell(0, 0)[0] + 5);
    expect(queue).toHaveBeenCalledWith(2001);
  });

  it("arrivée d'un groupe : un défilement à droite du dernier Zoombini verse le présentoir au premier emplacement libre, la page des arrivants est affichée", async () => {
    const { zoombinis, shelf } = await start((game) => {
      depositToReserve(reserve(game), members(40, 100));
      game.group.members = members(10, 200);
      groupReserve(game).members = [zoombini(700), zoombini(701)];
      game.counters.created = 52;
    });
    const { game } = zoombinis;
    // 40 entrées : les deux perdus sont derrière, à partir de l'entrée 40 ; le présentoir est calé sur leur page.
    expect(reserve(game).count).toBe(42);
    expect(reserve(game).entries[40]!.attrs).toEqual(type(700));
    // `(40 + 1) / 5` = 8, ramené à la dernière page possible (10 colonnes, donc 5).
    expect(reserve(game).scroll).toBe(5);
    expect(shelf().length).toBeGreaterThanOrEqual(2);
  });

  it("décor : les cinq objets mémorisent leur image dans la partie (camp 1) ; zones de clic qui rejouent ou changent de script (camp 2)", async () => {
    const { zoombinis, click, features, engine, host } = await start();
    const { game } = zoombinis;
    if (camp === 1) {
      const mushroom = (k: number): Feature => features.features.find((f) => f.scriptId === 1111 + k)!;
      const at = (f: Feature): Pt => [Math.round((f.rect!.left + f.rect!.right) / 2), Math.round((f.rect!.top + f.rect!.bottom) / 2)];
      expect(game.campDecor).toEqual([0, 0, 0, 0, 0]);
      await click(at(mushroom(0)), 200);
      expect(game.campDecor[0]).toBe(1);
      await click(at(mushroom(0)), 200);
      await click(at(mushroom(3)), 200);
      expect(game.campDecor[0]).toBe(2);
      expect(game.campDecor[3]).toBe(1);
      expect(mushroom(0).image).toBe(2);
      // Les cinq images tournent : 5 clics = retour à l'image 0.
      for (let i = 0; i < 3; i++) await click(at(mushroom(0)), 200);
      expect(game.campDecor[0]).toBe(0);
      // Quitter le camp puis y revenir : l'image mémorisée est restituée.
      await click(at(mushroom(0)), 200);
      await click(at(mushroom(0)), 200);
      expect(game.campDecor[0]).toBe(2);
      await click(buttons.map, 100);
      zoombinis.session.screen = ScreenId.map;
      engine.scenes.request(screen);
      await runFor(engine, host, 300);
      expect(features.features.find((f) => f.scriptId === 1111)!.image).toBe(2);
      expect(features.features.find((f) => f.scriptId === 1114)!.image).toBe(1);
    } else {
      const feature = (script: number) => features.features.find((f) => f.scriptId === script);
      // Zone 1 : trois scripts à tour de rôle (6011, 6012, 6013, puis de nouveau 6011) ; pas de reprise tant que l'objet joue.
      const zone1: Pt = [495, 205];
      expect(feature(6011)).toBeDefined();
      await click(zone1, 60);
      expect(feature(6012)).toBeDefined();
      await click(zone1, 60);
      expect(feature(6012)).toBeDefined();
      await runFor(engine, host, 30000);
      await click(zone1, 60);
      expect(feature(6013)).toBeDefined();
      await runFor(engine, host, 30000);
      await click(zone1, 60);
      expect(feature(6011)).toBeDefined();
      // Zone 3 : deux scripts alternés (6002 puis 6003).
      const zone3: Pt = [480, 310];
      expect(feature(6002)).toBeDefined();
      await click(zone3, 60);
      expect(feature(6003)).toBeDefined();
      await runFor(engine, host, 30000);
      await click(zone3, 60);
      expect(feature(6002)).toBeDefined();
      // Pas d'état mémorisé dans la partie pour ce camp.
      expect(game.campDecor).toEqual([0, 0, 0, 0, 0]);
    }
  });

  it("décor animé : l'objet à clic en file rejoue sa réaction (camp 1), les zones rejouent leur script (camp 1)", async () => {
    const { features, click, engine, host } = await start();
    const playing = (f: Feature | undefined) => f?.active === true;
    if (camp === 1) {
      const bird = features.features.find((f) => f.scriptId === 1106)!;
      expect(playing(bird)).toBe(false);
      await click([545, 100], 60);
      expect(playing(bird)).toBe(true);
      // Pas de rejeu tant qu'il joue.
      await runFor(engine, host, 20000);
      expect(playing(bird)).toBe(false);
      // L'insecte (1104, lecture au hasard en file) joue sa réaction 1105 au clic, puis reprend.
      const insect = features.features.find((f) => f.scriptId === 1104)!;
      await click([Math.round((insect.rect!.left + insect.rect!.right) / 2), Math.round((insect.rect!.top + insect.rect!.bottom) / 2)], 60);
      expect(insect.scriptId).toBe(1105);
    } else {
      const frog = features.features.find((f) => f.scriptId === 6000)!;
      expect(playing(frog)).toBe(false);
      await click([530, 280], 60);
      expect(playing(frog)).toBe(true);
      await runFor(engine, host, 30000);
      // Après l'animation du terrier, l'image finale (script 6001) reste.
      expect(frog.scriptId).toBe(6001);
    }
  });

  it("phrase d'accueil : seulement à l'arrivée après une étape finie ; hors des fins de jeu elle vient de la table du camp", async () => {
    const silent = await start((game) => {
      game.group.members = members(16);
      game.counters.created = 16;
    });
    expect(silent.queue.mock.calls.filter(([id]) => id >= 20000 && id < 30000)).toEqual([]);
    const spoken = await start((game, session) => {
      game.group.members = members(16);
      game.counters.created = 16;
      session.lastFinal = camp === 1 ? 9 : 12;
    });
    const ids = spoken.queue.mock.calls.map(([id]) => id).filter((id) => id >= 20000 && id < 30000);
    expect(ids).toEqual([camp === 1 ? 0x4e51 : 0x4e72]);
    expect(spoken.zoombinis.session.lastFinal).toBe(0);
    expect(spoken.zoombinis.game.dialogMemory[camp === 1 ? 4 : 11]! & 0xfff).toBe(1);
  });

  it("une écriture de la partie range le groupe du camp dans sa réserve (`11a0:141e`)", async () => {
    const { zoombinis, engine } = await start((game) => {
      game.group.members = members(16);
      game.counters.created = 16;
    });
    const { DIALOG } = await import("../../src/games/zoombinis/engine/dialog");
    const dialogs = engine.services.get(DIALOG) as unknown as { beforeSave: (() => void)[] };
    for (const hook of dialogs.beforeSave) hook();
    expect(groupReserve(zoombinis.game).members).toHaveLength(16);
  });

  it("deux écrans de camp se suivent sans reste d'état : features et personnages détruits à la sortie", async () => {
    const { features, click, engine, host } = await start((game) => {
      game.group.members = members(16);
      game.counters.created = 16;
    });
    await click(buttons.map, 100);
    await runFor(engine, host, 50);
    expect(features.features.filter((f) => f.hasFlag(FeatureFlag.snoid))).toHaveLength(0);
  });
});
