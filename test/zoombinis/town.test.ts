import { describe, expect, it, vi } from "vitest";
import { createZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { FEATURES, FeatureFlag, type Feature } from "../../src/games/zoombinis/engine/features";
import { ScreenId } from "../../src/games/zoombinis/engine/scene";
import { installServices } from "../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_TEXT } from "../../src/games/zoombinis/engine/text";
import { makeZoombini, type GameState } from "../../src/games/zoombinis/game/state";
import { townArrive } from "../../src/games/zoombinis/game/team";
import {
  BUILDING_TYPES,
  cardLines,
  createTownScene,
  DATE_FORMAT,
  decorHeight,
  eventBudget,
  hotspotOf,
  monumentLayer,
  shiftRing,
  storyStart,
  treeLimit,
} from "../../src/games/zoombinis/scenes/town";
import { originalFiles } from "../support/original";
import { runFor, TestHost } from "./engine-test-host";

const original = originalFiles("zoombinis", "files.json");

describe("règles de Zoombiniville", () => {
  it("le décor est un anneau de 1 920 : un pas de 320 dans un sens puis dans l'autre ramène à la case de départ", () => {
    expect(shiftRing(100, 1)).toBe(-220);
    expect(shiftRing(100, -1)).toBe(420);
    expect(shiftRing(-300, 1)).toBe(1300);
    expect(shiftRing(1500, -1)).toBe(-100);
    for (const x of [-320, -1, 0, 319, 640, 1279, 1599]) {
      expect(shiftRing(shiftRing(x, 1), -1)).toBe(x);
      let around = x;
      for (let i = 0; i < 6; i++) around = shiftRing(around, 1);
      expect(around).toBe(x);
    }
  });

  it("arbres, évènements et objets décoratifs suivent la population", () => {
    expect([0, 100, 312, 624, 625].map(treeLimit)).toEqual([25, 33, 52, 80, 80]);
    expect([0, 1, 156, 157, 312, 313, 624, 625].map(eventBudget)).toEqual([0, 1, 1, 4, 4, 6, 6, 8]);
    expect([8000, 8008, 8010, 8018, 8022, 8030, 8032, 8040].map(decorHeight)).toEqual([
      [170, 280],
      [40, 280],
      [110, 260],
      [-10, 100],
      [230, 310],
      [140, 290],
      [190, 280],
      [100, 200],
    ]);
    expect([0, 1, 2, 3, 4].map(storyStart)).toEqual([3000, 3000, 3001, 3002, 3000]);
  });

  it("les 16 types de bâtiments sont une permutation ; l'emplacement 4 est le beffroi (type 13)", () => {
    expect([...BUILDING_TYPES].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(BUILDING_TYPES[4]).toBe(13);
  });

  it("la couche des monuments ne garde que les bâtiments des emplacements remplis et donne leur rectangle de survol", () => {
    const parts = [
      { w: 7, x: -88, y: 300 },
      { w: 11, x: 252, y: 137 },
      { w: 15, x: 61, y: 310 },
      { w: 23, x: 169, y: 377 },
    ];
    const none = monumentLayer(parts, new Array(16).fill(null));
    expect(none.parts).toEqual([{ w: 23, x: 169, y: 377 }]);
    expect(none.hotspots).toEqual([]);
    expect(none.clock).toBe(false);
    const monuments = new Array<{ stage: number; level: number; year: number; month: number; day: number } | null>(16).fill(null);
    monuments[4] = { stage: 1, level: 1, year: 1996, month: 10, day: 28 };
    const some = monumentLayer(parts, monuments);
    expect(some.parts.map((p) => p.w)).toEqual([11, 23]);
    expect(some.clock).toBe(true);
    expect(some.hotspots).toEqual([{ slot: 4, box: hotspotOf(4, 252, 137) }]);
    expect(hotspotOf(4, 252, 137)).toEqual({ x1: 289, y1: 350, x2: 345, y2: 378 });
  });
});

describe.skipIf(!original.has)("Zoombiniville (écran 6)", () => {
  /** Les 16 monuments possibles : étape et niveau cycliques, la date du 28 octobre 1996. */
  const STAGES: [number, number][] = [[1, 1], [1, 2], [2, 1], [1, 3], [3, 1], [2, 2], [4, 1], [1, 4], [3, 2], [2, 3], [4, 2], [3, 3]];

  /** Verse `count` Zoombinis à la population (16 par arrivée, comme les groupes de l'original). */
  function populate(game: GameState, count: number): void {
    for (let n = 0; n < count; n += 16) {
      game.group.members = Array.from({ length: Math.min(16, count - n) }, (_, i) => makeZoombini([1 + ((n + i) % 5), 1 + (((n + i) >> 2) % 5), 1 + ((n + i) % 3), 1 + ((n + i * 3) % 5)], n + i + 1));
      townArrive(game);
    }
  }

  /** Zoombiniville avec `population` habitants déjà arrivés (sauf `arriving` qui arrivent à l'entrée), `monuments` emplacements remplis et la colonne `scroll`. */
  async function start(options: { population?: number; arriving?: number; monuments?: number; scroll?: number; setup?: (game: GameState) => void } = {}) {
    const { population = 0, arriving = 0, monuments = 0, scroll = 0, setup } = options;
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 7 });
    const services = await installServices(engine);
    const game = services.game.game;
    populate(game, population);
    for (let k = 0; k < monuments; k++) game.monuments[k] = { stage: STAGES[k]![0], level: STAGES[k]![1], year: 1996, month: 10, day: 28 };
    game.townScroll = scroll;
    setup?.(game);
    game.group.members = Array.from({ length: arriving }, (_, i) => makeZoombini([1 + (i % 5), 2, 3, 1 + (i % 4)], 1000 + i));
    const entered: number[] = [];
    engine.register(ScreenId.town, () => createTownScene({ now: () => new Date(2026, 9, 28, 10, 35) }));
    engine.register(ScreenId.map, () => ({ enter: () => void entered.push(ScreenId.map), leave() {}, tick() {} }));
    const queue = vi.spyOn(services.sound, "queue");
    services.game.session.screen = ScreenId.town;
    engine.start(ScreenId.town);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    const features = engine.services.get(FEATURES);
    const residents = (): Feature[] => features.features.filter((f) => f.hasFlag(FeatureFlag.snoid));
    const byScript = (script: number): Feature[] => features.features.filter((f) => f.scriptId === script);
    const click = async (x: number, y: number, ms = 100) => {
      host.click(x, y);
      await runFor(engine, host, ms);
    };
    const text = engine.ctx.services.get(ZOOMBINIS_TEXT);
    return { host, engine, services, game, features, residents, byScript, click, queue, entered, text, session: services.game.session };
  }

  it("ville vide : décor des six colonnes, aucun habitant ni bâtiment, bouton de la carte, récit d'arrivée, un clic sur le décor ne montre rien", async () => {
    const { host, features, residents, byScript, click, queue, services } = await start();
    const frame = host.frames[host.frames.length - 1]!;
    expect(frame.pixels.some((p) => p !== 0)).toBe(true);
    expect(features.features.map((f) => f.scriptId)).toEqual(expect.arrayContaining([1000, 1001, 1002, 1003, 6000]));
    expect(residents()).toHaveLength(0);
    expect(features.features.some((f) => f.scriptId >= 4000 && f.scriptId < 4008)).toBe(false);
    // Aucun monument : la couche des bâtiments est vide ; les arbres se limitent à la partie 25.
    expect(byScript(1001)[0]!.parts.filter((p) => p.w >= 7 && p.w <= 22)).toEqual([]);
    expect(byScript(1002)[0]!.parts.every((p) => p.w <= 25)).toBe(true);
    // Arrivée sans dernière épreuve : mémoire de dialogue ignorée, récit 3000 + (0 − 1 & 0xfff) % 3.
    expect(queue).toHaveBeenCalledWith(3000);
    queue.mockClear();
    await click(400, 380);
    expect(features.features.some((f) => f.scriptId >= 1004 && f.scriptId <= 1007)).toBe(false);
    expect(queue).not.toHaveBeenCalled();
    expect(services.game.game.counters.town).toBe(0);
  });

  it("arrivée : les survivants rejoignent la population, les perdus non, le groupe est vidé", async () => {
    const { game } = await start({ population: 32, arriving: 4 });
    expect(game.counters.town).toBe(36);
    expect(game.population.count).toBe(36);
    expect(game.group.members).toHaveLength(0);
  });

  it("ville peuplée : 20 habitants au plus (en petit), un petit décor par 37 habitants au-dessus de 20, arbres selon la population", async () => {
    const { residents, features, byScript } = await start({ population: 300, monuments: 12, scroll: 2 });
    expect(residents()).toHaveLength(20);
    const scenery = features.features.filter((f) => f.scriptId >= 4000 && f.scriptId < 4008);
    expect(scenery).toHaveLength(7);
    expect(scenery.every((f) => f.delay >= 4 && f.delay <= 6 && f.hasFlag(FeatureFlag.relative))).toBe(true);
    // 300 habitants : 24 + 56 × 300 / 625 + 1 = 51 ; les deux couches d'arbres ne dépassent pas ce numéro.
    const limit = treeLimit(300);
    expect(limit).toBe(51);
    for (const id of [1002, 1003]) expect(byScript(id)[0]!.parts.every((p) => p.w <= limit)).toBe(true);
    expect(byScript(1002)[0]!.parts.length).toBeGreaterThan(0);
  });

  it("l'horloge du beffroi montre l'heure de l'hôte, seulement aux colonnes 1 et 2 ; un clic dessus lance un tour de cadran (délai 2)", async () => {
    const column2 = await start({ population: 300, monuments: 12, scroll: 2 });
    const [clock] = column2.byScript(6000);
    // 10 h 35 : aiguille des minutes 35 / 5 = 7 (partie 8), des heures 10 (partie 23), posées en (307, 218), ancres `REGS` retranchées.
    expect(clock!.parts.map((p) => p.w)).toEqual([8, 23]);
    expect(clock!.parts[0]!.x).toBeLessThanOrEqual(0x133);
    expect(clock!.delay).toBe(6);
    expect(clock!.rect).not.toBeNull();
    const rect = clock!.rect!;
    await column2.click((rect.left + rect.right) >> 1, (rect.top + rect.bottom) >> 1, 100);
    expect(column2.byScript(6000)[0]!.delay).toBe(2);
    // 144 aiguilles de 2 ticks (un tour de cadran de 12 h), puis retour à l'heure de l'hôte et au délai de 6.
    await runFor(column2.engine, column2.host, 8000);
    expect(column2.byScript(6000)[0]!.delay).toBe(6);
    expect(column2.byScript(6000)[0]!.parts.map((p) => p.w)).toEqual([8, 23]);

    const column0 = await start({ population: 300, monuments: 12, scroll: 0 });
    expect(column0.byScript(6000)[0]!.parts).toEqual([]);
    const column1 = await start({ population: 300, monuments: 12, scroll: 1 });
    expect(column1.byScript(6000)[0]!.parts).toHaveLength(2);
    const without = await start({ population: 300, monuments: 4, scroll: 2 });
    expect(without.byScript(6000)[0]!.parts).toEqual([]);
  });

  it("fiche d'un monument : un clic sur le bâtiment l'ouvre (style et textes de l'emplacement), gèle la ville, un clic la ferme", async () => {
    const { engine, click, host, residents, text, queue, byScript } = await start({ population: 300, monuments: 12, scroll: 2 });
    // Colonne 2 : la maison rouge (partie 18 en (168, 288) : emplacement 11, survol centré en (235, 407)).
    host.input.moveMouse(235, 407);
    await runFor(engine, host, 100);
    expect(host.cursor).toBe("curs1");
    host.input.moveMouse(100, 200);
    await runFor(engine, host, 50);
    expect(host.cursor).toBe("system");
    const speaking = residents().map((f) => f.active);
    queue.mockClear();
    await click(235, 407);
    // Emplacement 11 : style 2 (`DS:3A0C`), donc le `SCRB` 1005, posé en (140, 101).
    const [card] = byScript(1005);
    expect(card).toBeDefined();
    expect(card!.rect).toEqual({ left: 140, top: 101, right: 499, bottom: 389 });
    expect(queue).toHaveBeenCalledWith(999);
    expect(residents().every((f) => !f.active)).toBe(true);
    // Les cinq lignes : type, exploit, « quand le voyage était », niveau, date.
    const lines = cardLines(text.strings, 11, { stage: 2, level: 3, year: 1996, month: 10, day: 28 });
    expect(lines[0]).toBe(text.strings.get(2014, BUILDING_TYPES[11]! + 1));
    expect(lines[1]).toBe(text.strings.get(2016, 4 + 3));
    expect(lines[2]).toBe("quand le voyage était:");
    expect(lines[3]).toBe("très difficile");
    expect(lines[4]).toBe("28 octobre 1996");
    // Un clic quelconque la ferme et réveille les habitants.
    queue.mockClear();
    await click(300, 150);
    expect(byScript(1005)).toHaveLength(0);
    expect(queue).toHaveBeenCalledWith(999);
    expect(residents().map((f) => f.active)).toEqual(speaking);
    // Un clic à côté de tout bâtiment (hors bords) ne fait rien.
    queue.mockClear();
    await click(400, 100);
    expect(queue).not.toHaveBeenCalled();
  });

  it("la fiche dessine les cinq lignes dans leurs rectangles, cernées, couleurs du style", async () => {
    const { host, click, engine } = await start({ population: 300, monuments: 12, scroll: 2 });
    await click(235, 407, 60);
    const frame = host.frames[host.frames.length - 1]!;
    // Texte factice : blocs pleins ; style 2 : contour 199, texte 45. Le centre de chaque ligne (hauts de `DS:3A1E` + 22 sous le haut de la fiche) est de l'encre.
    const inks = new Set<number>();
    for (let y = 101; y < 389; y++) for (let x = 140; x < 499; x++) inks.add(frame.pixels[y * 640 + x]!);
    expect(inks.has(45)).toBe(true);
    expect(inks.has(199)).toBe(true);
    for (const [from, to] of [[0, 36], [36, 196], [196, 210], [210, 230], [230, 244]] as const) {
      expect(frame.pixels[(101 + 22 + ((from + to) >> 1)) * 640 + 319]).toBe(45);
    }
    expect(engine.error).toBeNull();
  });

  it("défilement : un clic à droite (x ≥ 561) ou à gauche (x < 80) change de colonne avec bouclage, décale les objets en monde, le son 999", async () => {
    const { game, click, queue, features, byScript } = await start({ population: 300, monuments: 12, scroll: 0 });
    const scenery = features.features.filter((f) => f.scriptId >= 4000 && f.scriptId < 4008);
    const before = scenery.map((f) => f.position.x);
    queue.mockClear();
    await click(600, 240);
    expect(game.townScroll).toBe(1);
    expect(queue).toHaveBeenCalledWith(999);
    expect(scenery.map((f) => f.position.x)).toEqual(before.map((x) => shiftRing(x, 1)));
    expect(byScript(1000)[0]!.image).toBe(1);
    expect(byScript(1001)[0]!.image).toBe(1);
    for (let i = 0; i < 5; i++) await click(600, 240);
    expect(game.townScroll).toBe(0);
    expect(scenery.map((f) => f.position.x)).toEqual(before.map(shiftAround));
    await click(40, 240);
    expect(game.townScroll).toBe(5);
    expect(byScript(1000)[0]!.image).toBe(5);
    // Hors de la bande (bord haut) ou au milieu : rien.
    queue.mockClear();
    await click(600, 10);
    await click(320, 240);
    expect(game.townScroll).toBe(5);
    expect(queue).not.toHaveBeenCalled();
  });

  it("la colonne mémorisée (S+0x1E) est reprise à l'arrivée, les objets en monde décalés d'autant", async () => {
    const { byScript, features } = await start({ population: 300, monuments: 12, scroll: 3 });
    expect(byScript(1000)[0]!.image).toBe(3);
    const scenery = features.features.filter((f) => f.scriptId >= 4000 && f.scriptId < 4008);
    const positions = scenery.map((f) => f.position.x);
    const base = await start({ population: 300, monuments: 12, scroll: 0 });
    const home = base.features.features.filter((f) => f.scriptId >= 4000 && f.scriptId < 4008).map((f) => f.position.x);
    expect(positions).toEqual(home.map((x) => shiftRing(shiftRing(shiftRing(x, 1), 1), 1)));
  });

  it("les habitants dansent : un évènement fait jouer à un habitant visible son SCRS de danse (5000 à 5004)", { timeout: 120_000 }, async () => {
    const { engine, host, residents, services } = await start({ population: 300, monuments: 12, scroll: 0 });
    services.game.game.options.lessAction = false;
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      await runFor(engine, host, 200);
      for (const f of residents()) if (f.scriptId >= 5000 && f.scriptId <= 5004) seen.add(f.scriptId);
    }
    expect(seen.size).toBeGreaterThan(0);
    await runFor(engine, host, 5000);
    expect(engine.error).toBeNull();
  });

  it("objets décoratifs : aucun sous 101 habitants, jusqu'à 3 à la fois au-dessus, ils disparaissent à la fin de leur animation", { timeout: 120_000 }, async () => {
    const few = await start({ population: 100, monuments: 4 });
    await runFor(few.engine, few.host, 3000);
    expect(few.features.features.some((f) => f.scriptId >= 8000)).toBe(false);

    const many = await start({ population: 330, monuments: 4 });
    let peak = 0;
    const total = new Set<number>();
    for (let i = 0; i < 400; i++) {
      await runFor(many.engine, many.host, 100);
      const decor = many.features.features.filter((f) => f.scriptId >= 8000 && f.scriptId <= 8043);
      peak = Math.max(peak, decor.length);
      for (const f of decor) total.add(f.id);
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(3);
    // 330 habitants : 1 + 2 + 3 = 6 objets à produire en tout.
    expect(total.size).toBe(6);
    expect(many.features.features.some((f) => f.scriptId >= 8000 && f.scriptId <= 8043)).toBe(false);
  });

  it("fin de partie à 625 : phrase finale 3003, objets décoratifs 20 puis 40, récit 3000 à 3002 en boucle ensuite, la ville reste jouable", { timeout: 120_000 }, async () => {
    // Voix coupées : les phrases durent plus de 100 s, on veut seulement l'enchaînement (une phrase finie dès qu'elle est dite).
    const { engine, host, queue, features, game, click } = await start({ population: 609, arriving: 16, monuments: 12, setup: (g) => void (g.options.effects = false) });
    expect(game.counters.town).toBe(625);
    expect(queue.mock.calls[0]![0]).toBe(3003);
    const told: number[] = [];
    const decorSeen = new Set<number>();
    const watch = () => {
      for (const f of features.features) if (f.scriptId >= 8000 && f.scriptId <= 8043) decorSeen.add(f.id);
    };
    for (let i = 0; i < 300; i++) {
      await runFor(engine, host, 100);
      watch();
    }
    // 20 objets à produire à l'arrivée : ils sont tous passés en 30 s.
    expect(decorSeen.size).toBe(20);
    for (let i = 0; i < 120; i++) {
      await runFor(engine, host, 1000);
      watch();
    }
    for (const call of queue.mock.calls) if (call[0] >= 3000 && call[0] <= 3003) told.push(call[0]);
    expect(told.slice(0, 5)).toEqual([3003, 3000, 3001, 3002, 3000]);
    // À la fin de chaque phrase le budget est remis à 40 (`1188:0ce5`) : la ville continue d'être animée.
    expect(decorSeen.size).toBeGreaterThan(20);
    expect(engine.error).toBeNull();
    await click(600, 240);
    expect(game.townScroll).toBe(1);
  });

  it("phrases : le récit et le tirage sans répétition alternent après un silence de 150 à 300 ticks", { timeout: 120_000 }, async () => {
    const { engine, host, queue } = await start({ population: 610, monuments: 4, setup: (g) => void (g.options.effects = false) });
    for (let i = 0; i < 200; i++) await runFor(engine, host, 1000);
    const said = queue.mock.calls.map((call) => call[0]).filter((id) => (id >= 3000 && id <= 3003) || (id >= 0x4e79 && id <= 0x4e7d));
    expect(said.length).toBeGreaterThan(4);
    said.forEach((id, i) => {
      if (i === 0) return;
      const story = id >= 3000 && id <= 3003;
      expect(story, `phrase ${i} : ${id}`).toBe(i % 2 === 0);
    });
    // Au-delà de 600 habitants le dernier son du tirage n'est pas dit.
    expect(said.filter((id) => id === 0x4e7d)).toHaveLength(0);
    expect(said.filter((id) => id >= 0x4e79 && id <= 0x4e7c).length).toBeGreaterThan(0);

    const first = await start({ population: 20, monuments: 0 });
    expect(first.queue.mock.calls[0]![0]).toBe(3000);
  });

  it("la phrase d'arrivée après l'épreuve finale suit la mémoire de dialogue (1 à 3 : 20086 à 20088), et la visite est comptée", async () => {
    const first = await (async () => {
      const host = new TestHost();
      host.audio.unlock();
      const engine = createZoombinisEngine(host, { seed: 7 });
      const services = await installServices(engine);
      services.game.session.lastFinal = ScreenId.maze2;
      populate(services.game.game, 48);
      engine.register(ScreenId.town, createTownScene);
      engine.register(ScreenId.map, () => ({ enter() {}, leave() {}, tick() {} }));
      const queue = vi.spyOn(services.sound, "queue");
      services.game.session.screen = ScreenId.town;
      engine.start(ScreenId.town);
      await runFor(engine, host, 100);
      return { queue, game: services.game.game, session: services.game.session };
    })();
    expect(first.queue.mock.calls[0]![0]).toBe(0x4e76);
    expect(first.game.dialogMemory[15]).toBe(1);
    expect(first.session.lastFinal).toBe(0);
  });

  it("le bouton de la carte (600, 403)-(640, 440) joue le son 999, s'enfonce deux ticks, puis demande la carte et range le groupe", async () => {
    const { host, engine, click, queue, entered, session, game } = await start({ population: 100, monuments: 3 });
    queue.mockClear();
    host.click(620, 420);
    await runFor(engine, host, 17);
    expect(queue).toHaveBeenCalledWith(999);
    expect(entered).toEqual([]);
    await runFor(engine, host, 200);
    expect(entered).toEqual([ScreenId.map]);
    expect(session.screen).toBe(ScreenId.map);
    expect(session.previous).toBe(ScreenId.town);
    expect(game.group.flagA).toBe(true);
    expect(game.group.members).toHaveLength(0);
    void click;
  });

  it("touches du mode de test : Suppr remplit les monuments, 0 les vide, ←/→ ajoutent ou retirent 5 arbres ; sans mode de test elles ne font rien", async () => {
    const inactive = await start({ population: 300, monuments: 0, scroll: 2 });
    inactive.host.press("Delete");
    await runFor(inactive.engine, inactive.host, 100);
    expect(inactive.game.monuments.every((m) => m === null)).toBe(true);

    const { game, host, engine, byScript } = await start({ population: 300, monuments: 0, scroll: 2, setup: (g) => void (g.options.testMode = true) });
    host.press("Delete");
    await runFor(engine, host, 100);
    expect(game.monuments.every((m) => m !== null)).toBe(true);
    expect(game.monuments[0]).toMatchObject({ stage: 1, level: 1 });
    expect(game.monuments[5]).toMatchObject({ stage: 2, level: 2 });
    expect(byScript(1001)[0]!.parts.length).toBeGreaterThan(3);
    const trees = () => byScript(1002)[0]!.parts.length + byScript(1003)[0]!.parts.length;
    const before = trees();
    host.press("ArrowRight");
    await runFor(engine, host, 100);
    expect(trees()).toBeGreaterThan(before);
    host.press("Digit0");
    await runFor(engine, host, 100);
    expect(game.monuments.every((m) => m === null)).toBe(true);
    expect(byScript(1001)[0]!.parts.filter((p) => p.w >= 7 && p.w <= 22)).toEqual([]);
  });

  it("le format de date est celui de l'exécutable", () => {
    expect(DATE_FORMAT).toBe("%d %s %d");
  });
});

/** Six pas vers la droite : un tour complet de l'anneau. */
function shiftAround(x: number): number {
  let out = x;
  for (let i = 0; i < 6; i++) out = shiftRing(out, 1);
  return out;
}
