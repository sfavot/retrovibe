import { describe, expect, it, vi } from "vitest";
import { MohawkArchive } from "../../../src/data/mohawk/mohawk";
import { decodeTbmp } from "../../../src/data/mohawk/tbmp";
import { DIALOG } from "../../../src/games/zoombinis/engine/dialog";
import { createZoombinisEngine } from "../../../src/games/zoombinis/engine/engine";
import { FEATURES } from "../../../src/games/zoombinis/engine/features";
import { ScreenId } from "../../../src/games/zoombinis/engine/scene";
import { installServices } from "../../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_SOUND } from "../../../src/games/zoombinis/engine/sound";
import {
  FAIRY_GAUGE,
  cellIndex,
  dropRows,
  shortestPath,
  type Cell,
  type LillyState,
  type Toad,
} from "../../../src/games/zoombinis/game/puzzles/lilly";
import { nextScreen } from "../../../src/games/zoombinis/game/route";
import { makeZoombini, type Attrs, type Zoombini } from "../../../src/games/zoombinis/game/state";
import { createLillyScene, type LillyProbe } from "../../../src/games/zoombinis/scenes/puzzles/lilly";
import { BUTTON_GO, BUTTON_MAP } from "../../../src/games/zoombinis/scenes/puzzle-kit";
import { originalFiles } from "../../support/original";
import { runFor, TestHost } from "../engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");
const S = ScreenId;
const TICK_MS = 17;

describe.skipIf(!original.has)("écran des têtards tatoués (createLillyScene)", () => {
  interface Config {
    level?: number;
    size?: number;
    magnetic?: boolean;
    lessAction?: boolean;
    seed?: number;
  }

  async function start(config: Config = {}) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: config.seed ?? 11 });
    const services = await installServices(engine);
    const entered: number[] = [];
    let probe!: LillyProbe;
    for (const id of Object.values(S)) {
      if (id === S.lilly) engine.register(id, () => createLillyScene((p) => (probe = p)));
      else engine.register(id, () => ({ enter: () => void entered.push(id), leave() {}, tick() {} }));
    }
    const sound = engine.services.get(ZOOMBINIS_SOUND);
    const queued: number[] = [];
    const queue = sound.queue.bind(sound);
    sound.queue = (id: number) => {
      queued.push(id);
      queue(id);
    };
    const zoombinis = services.game;
    const size = config.size ?? 8;
    zoombinis.game.group.members = Array.from({ length: size }, (_, i) =>
      makeZoombini([1 + (i % 5), 1 + (i % 4), 1 + (i % 3), 1 + ((i * 2) % 5)] as Attrs, i + 1),
    );
    zoombinis.game.stageUnbroken = true;
    zoombinis.game.levels[1] = config.level ?? 0;
    zoombinis.game.options.lessAction = config.lessAction ?? true;
    zoombinis.game.options.magneticMouse = config.magnetic ?? false;
    zoombinis.session.screen = S.lilly;
    engine.start(S.lilly);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    const ticks = (n: number) => runFor(engine, host, n * TICK_MS);
    const until = async (done: () => boolean, limit = 3000) => {
      for (let waited = 0; !done() && waited < limit; waited += 5) await ticks(5);
      expect(done()).toBe(true);
    };
    const features = engine.services.get(FEATURES);
    const state = (): LillyState => probe.state;

    /** Point (centre du rectangle) où prendre un objet. */
    const centre = (feature: { rect: { left: number; right: number; top: number; bottom: number } | null }) => {
      const rect = feature.rect!;
      return { x: Math.floor((rect.left + rect.right) / 2), y: Math.floor((rect.top + rect.bottom) / 2) };
    };
    /** Glisse le crapaud `index` jusqu'au nénuphar de la rangée `row` de la colonne 0 (relâché, ou cliqué en transport collé). */
    async function dragToad(index: number, row: number, magnetic = false) {
      const grab = centre(probe.toads[index]!.feature);
      host.input.moveMouse(grab.x, grab.y);
      host.input.mouseDown("left");
      await ticks(3);
      const to = probe.origin(0, row);
      host.input.moveMouse(to.x, to.y);
      await ticks(6);
      host.input.mouseUp("left");
      await ticks(4);
      if (magnetic) {
        expect(probe.carrying).toBe("toad");
        host.input.mouseDown("left");
        await ticks(1);
        host.input.mouseUp("left");
        await ticks(4);
      }
    }
    /** Fait un nénuphar de chemin : couloir de la rangée `row` de la colonne 0 à la colonne 11 en B = 0, ailleurs B = 3. */
    function corridor(row: number, free: readonly Cell[] = Array.from({ length: 12 }, (_, col) => ({ col, row }))) {
      for (const lily of state().pond.cells) lily.attrs = [0, 3, 0];
      for (const c of free) state().pond.cells[cellIndex(c.col, c.row)]!.attrs[1] = 0;
      features.invalidate();
    }
    const toadB0 = () => probe.toads.find((v) => v.toad.kind === 2 && v.toad.value === 0)!;
    const press = (rect: { left: number; top: number }) => host.click(rect.left + 5, rect.top + 5);
    return { host, engine, services, zoombinis, entered, queued, probe: () => probe, ticks, until, features, state, centre, dragToad, corridor, toadB0, press };
  }

  /** Le crapaud qui traverse le plus vite : un chemin existe depuis une rangée libre de la colonne 0. */
  function passing(state: LillyState): { toad: Toad; row: number } {
    for (const toad of state.toads) {
      const path = shortestPath(state.pond, toad.kind, toad.value);
      if (path && dropRows(state, toad.index).includes(path[0]!.row)) return { toad, row: path[0]!.row };
    }
    throw new Error("aucun crapaud ne passe");
  }

  it("entre sur le fond 5000 : 12 crapauds au repos, les jetons du groupe, l'étang dessiné, « suite » grisé ; la fée seulement aux niveaux 2 à 4", async () => {
    for (const level of [0, 1, 2, 3]) {
      const t = await start({ level, size: 8 });
      const probe = t.probe();
      expect(probe.state.level).toBe(level);
      expect(probe.toads).toHaveLength(12);
      for (const view of probe.toads) {
        expect(view.phase).toBe("rest");
        expect(view.feature.rect, `niveau ${level}`).not.toBeNull();
      }
      expect(probe.tokens).toHaveLength(8);
      expect(probe.kit.goEnabled).toBe(false);
      expect(probe.state.fairy.perGauge).toBeGreaterThan(0);
      expect(probe.wand !== null).toBe(level >= 1);
      // Le fond (tBMP 5000) est recouvert par les nénuphars : beaucoup de pixels diffèrent à l'emplacement de l'étang.
      const archive = MohawkArchive.parse(original.read("LILLY.MHK"));
      const background = decodeTbmp(archive.get("tBMP", 5000));
      const frame = t.host.frames[t.host.frames.length - 1]!;
      let different = 0;
      for (let y = 80; y < 420; y++) for (let x = 140; x < 540; x++) if (frame.pixels[y * 640 + x] !== background.pixels[y * 640 + x]) different++;
      expect(different, `niveau ${level}`).toBeGreaterThan(8000);
      // Voix d'accueil : 20075 au niveau 1, sinon l'une des trois ; jingle 997 au niveau 1 seulement.
      expect(t.queued).toContain(probe.welcome);
      if (level === 0) expect(probe.welcome).toBe(20075);
      else expect([20075, 20076, 20077]).toContain(probe.welcome);
      expect(t.queued.includes(997)).toBe(level === 0);
      expect(t.engine.error).toBeNull();
    }
  });

  it("introduction : tant que le verrou est posé, on ne prend pas de crapaud ; il tombe à la fin de l'introduction", async () => {
    const t = await start({ level: 0, size: 8 });
    const probe = t.probe();
    expect(probe.lock).toBe(1);
    const grab = t.centre(probe.toads[0]!.feature);
    t.host.input.moveMouse(grab.x, grab.y);
    t.host.input.mouseDown("left");
    await t.ticks(3);
    expect(probe.carrying).toBeNull();
    t.host.input.mouseUp("left");
    await t.until(() => probe.lock === 0, 600);
    t.host.input.moveMouse(grab.x, grab.y);
    t.host.input.mouseDown("left");
    await t.ticks(3);
    expect(probe.carrying).toBe("toad");
    t.host.input.mouseUp("left");
    await t.ticks(3);
  });

  it("un dépôt valide : le jeton marche, le crapaud se tend puis traverse jusqu'à la berge droite, le Zoombini est sauvé et « suite » s'allume", async () => {
    const t = await start({ level: 0, size: 4 });
    const probe = t.probe();
    await t.until(() => probe.lock === 0, 600);
    const { toad, row } = passing(probe.state);
    const view = probe.toads[toad.index]!;
    await t.dragToad(toad.index, row);
    expect(view.phase).toBe("setup");
    expect(probe.state.launched).toBe(1);
    expect(probe.state.pond.cells[cellIndex(0, row)]!.occupied).toBe(true);
    // Le jeton marche (`10019 + rangée`), puis le crapaud se tend (`10000`) et saute.
    expect(probe.tokens[0]!.feature!.scriptId).toBe(10019 + row);
    await t.until(() => view.phase === "ready" || view.phase === "hop");
    expect(probe.tokens[0]!.feature).toBeNull();
    await t.until(() => view.phase === "arriving", 6000);
    expect(toad.col).toBe(11);
    expect(probe.hops.length).toBeGreaterThanOrEqual(11);
    // Les sauts sont espacés d'au moins 30 ticks (cadence de `10f8:20bc`).
    for (let i = 1; i < probe.hops.length; i++) expect(probe.hops[i]!.at - probe.hops[i - 1]!.at).toBeGreaterThanOrEqual(30);
    expect(view.feature.scriptId).toBe(10031 + toad.row);
    await t.until(() => probe.state.arrivals === 1, 400);
    expect(probe.state.saved[0]).toBe(true);
    expect(probe.kit.goEnabled).toBe(true);
    expect(probe.state.pond.cells[cellIndex(11, toad.row)]!.occupied).toBe(false);
    // La première traversée finie : sortie 10057, scène de la berge, retour 10058, puis le crapaud est de nouveau au repos et saisissable.
    const seen = new Set<number>();
    for (let i = 0; i < 4000 && view.phase !== "rest"; i += 5) {
      await t.ticks(5);
      seen.add(view.feature.scriptId);
    }
    expect(view.phase).toBe("rest");
    expect(seen.has(10057)).toBe(true);
    expect(seen.has(10058)).toBe(true);
    expect([10060, 10061, 10062, 10063, 10064, 10065].some((id) => seen.has(id))).toBe(true);
    expect(view.feature.scriptId).toBe(10043 + toad.index);
    expect(toad).toMatchObject({ trips: 1, retired: false });
    expect(probe.state.pond.landing[toad.row]).toBe(false);
    expect(t.engine.error).toBeNull();
  }, 60_000);

  it("réutilisation d'un crapaud : deux traversées exactement, puis il disparaît (10059, événement 54) et ne peut plus être pris", async () => {
    const t = await start({ level: 0, size: 3 });
    const probe = t.probe();
    await t.until(() => probe.lock === 0, 600);
    t.corridor(5);
    const view = t.toadB0();
    const { toad } = view;
    for (let trip = 1; trip <= 2; trip++) {
      expect(view.phase).toBe("rest");
      await t.dragToad(toad.index, 5);
      expect(probe.state.launched).toBe(trip);
      await t.until(() => probe.state.arrivals === trip, 8000);
      if (trip === 1) await t.until(() => view.phase === "rest", 4000);
    }
    expect(toad).toMatchObject({ trips: 2, retired: true });
    await t.until(() => view.phase === "gone", 3000);
    expect(view.feature.destroyed).toBe(true);
    expect(probe.state.saved).toEqual([true, true, false]);
    expect(probe.state.pond.landing[5]).toBe(false);
    // Détruit : rien à prendre à sa place de repos.
    expect(probe.carrying).toBeNull();
    const grab = REST[toad.index]!;
    t.host.input.moveMouse(grab.x - 5, grab.y - 5);
    t.host.input.mouseDown("left");
    await t.ticks(3);
    expect(probe.carrying).toBeNull();
    t.host.input.mouseUp("left");
  }, 60_000);

  it("un crapaud dans une impasse erre sans fin, sans échec : aucune arrivée, il reste sur l'étang", async () => {
    const t = await start({ level: 0, size: 3 });
    const probe = t.probe();
    await t.until(() => probe.lock === 0, 600);
    // Couloir de la rangée 5 coupé à la colonne 6.
    t.corridor(5, Array.from({ length: 12 }, (_, col) => ({ col, row: 5 })).filter((c) => c.col !== 6));
    const view = t.toadB0();
    await t.dragToad(view.toad.index, 5);
    await t.until(() => probe.hops.length >= 20, 6000);
    expect(probe.state.arrivals).toBe(0);
    expect(view.toad.col).toBeLessThan(6);
    expect(view.toad.active).toBe(true);
    expect(["ready", "hop"]).toContain(view.phase);
    expect(probe.kit.goEnabled).toBe(false);
    expect(probe.state.saved.some(Boolean)).toBe(false);
    expect(t.engine.error).toBeNull();
  }, 60_000);

  it("un dépôt refusé (mauvais nénuphar, ou hors de l'étang) renvoie le crapaud à sa place de repos", async () => {
    const t = await start({ level: 0, size: 3 });
    const probe = t.probe();
    await t.until(() => probe.lock === 0, 600);
    t.corridor(5);
    const view = t.toadB0();
    // Rangée 4 : nénuphar de la première colonne de la mauvaise valeur.
    await t.dragToad(view.toad.index, 4);
    expect(view.phase).toBe("rest");
    expect(probe.state.launched).toBe(0);
    expect(probe.state.pond.cells[cellIndex(0, 4)]!.occupied).toBe(false);
    expect(view.feature.position).toEqual(REST[view.toad.index]);
    // Hors de toute zone.
    const grab = t.centre(view.feature);
    t.host.input.moveMouse(grab.x, grab.y);
    t.host.input.mouseDown("left");
    await t.ticks(3);
    t.host.input.moveMouse(400, 300);
    await t.ticks(3);
    t.host.input.mouseUp("left");
    await t.ticks(4);
    expect(view.phase).toBe("rest");
    expect(probe.carrying).toBeNull();
    expect(view.feature.position).toEqual(REST[view.toad.index]);
    expect(t.engine.error).toBeNull();
  });

  it("pendant le glisser, le nénuphar de dépôt valide est éclairé ; pas un nénuphar qui ne convient pas", async () => {
    const t = await start({ level: 0, size: 3 });
    const probe = t.probe();
    await t.until(() => probe.lock === 0, 600);
    t.corridor(5);
    const view = t.toadB0();
    const grab = t.centre(view.feature);
    t.host.input.moveMouse(grab.x, grab.y);
    t.host.input.mouseDown("left");
    await t.ticks(3);
    const good = probe.origin(0, 5);
    t.host.input.moveMouse(good.x, good.y);
    await t.ticks(3);
    expect(probe.haloRow).toBe(5);
    const bad = probe.origin(0, 4);
    t.host.input.moveMouse(bad.x, bad.y);
    await t.ticks(3);
    expect(probe.haloRow).toBeNull();
    t.host.input.mouseUp("left");
    await t.ticks(4);
    expect(probe.carrying).toBeNull();
  });

  it("souris aimantée (partie neuve) : le glisser prend seulement le crapaud, le clic suivant le dépose", async () => {
    const t = await start({ level: 0, size: 3, magnetic: true });
    const probe = t.probe();
    await t.until(() => probe.lock === 0, 600);
    t.corridor(5);
    const view = t.toadB0();
    const grab = t.centre(view.feature);
    t.host.input.moveMouse(grab.x, grab.y);
    t.host.input.mouseDown("left");
    await t.ticks(3);
    const to = probe.origin(0, 5);
    t.host.input.moveMouse(to.x, to.y);
    await t.ticks(3);
    t.host.input.mouseUp("left");
    await t.ticks(5);
    // Relâché sur le bon nénuphar : rien n'est déposé, le crapaud est toujours en main.
    expect(probe.carrying).toBe("toad");
    expect(probe.state.launched).toBe(0);
    t.host.input.mouseDown("left");
    await t.ticks(2);
    t.host.input.mouseUp("left");
    await t.ticks(4);
    expect(probe.carrying).toBeNull();
    expect(probe.state.launched).toBe(1);
    expect(view.phase === "setup" || view.phase === "ready" || view.phase === "hop").toBe(true);
  });

  it("la fée (niveau 2) : la baguette choisit deux nénuphars libres, un échange les permute ; hors de l'étang elle retourne à son repos", async () => {
    const t = await start({ level: 1, size: 4 });
    const probe = t.probe();
    await t.until(() => probe.lock === 0, 600);
    const wand = probe.wand!;
    expect(wand.scriptId).toBe(10078);
    const state = probe.state;
    const a: Cell = { col: 3, row: 2 };
    const b: Cell = { col: 7, row: 8 };
    const attrsA = [...state.pond.cells[cellIndex(a.col, a.row)]!.attrs];
    const attrsB = [...state.pond.cells[cellIndex(b.col, b.row)]!.attrs];
    const grab = t.centre(wand);
    t.host.input.moveMouse(grab.x, grab.y);
    t.host.input.mouseDown("left");
    await t.ticks(3);
    expect(probe.carrying).toBe("fairy");
    // Le point chaud de la baguette est décalé de (+27, +22) : on la lâche sur le premier nénuphar (relâcher agit quand la souris n'est pas aimantée).
    const hot = (cell: Cell) => {
      const o = probe.origin(cell.col, cell.row);
      return { x: o.x + 16 - 27, y: o.y + 14 - 22 };
    };
    const click = async (cell: Cell) => {
      const at = hot(cell);
      t.host.input.moveMouse(at.x, at.y);
      await t.ticks(2);
      t.host.input.mouseDown("left");
      await t.ticks(1);
      t.host.input.mouseUp("left");
      await t.ticks(2);
    };
    const at = hot(a);
    t.host.input.moveMouse(at.x, at.y);
    await t.ticks(3);
    t.host.input.mouseUp("left");
    await t.ticks(2);
    expect(probe.picks).toEqual([a]);
    expect(probe.exchanging).toBe(true);
    expect(probe.carrying).toBe("fairy");
    await click(b);
    expect(probe.picks).toHaveLength(2);
    await t.until(() => !probe.exchanging, 200);
    expect(state.pond.cells[cellIndex(a.col, a.row)]!.attrs).toEqual(attrsB);
    expect(state.pond.cells[cellIndex(b.col, b.row)]!.attrs).toEqual(attrsA);
    expect(state.fairy.total).toBe(1);
    expect(t.queued.filter((id) => id >= 12000 && id <= 12003)).toHaveLength(2);
    // Hors de l'étang : la baguette retourne à son repos.
    t.host.input.moveMouse(20, 20);
    await t.ticks(2);
    t.host.input.mouseDown("left");
    await t.ticks(1);
    t.host.input.mouseUp("left");
    await t.ticks(4);
    expect(probe.carrying).toBeNull();
    expect(wand.position).toEqual({ x: 0x26, y: 0x19f });
    expect(t.engine.error).toBeNull();
  });

  it("la fée répare un chemin : après l'échange le crapaud passe, et la jauge baisse d'un cran au bon nombre d'échanges", async () => {
    const t = await start({ level: 1, size: 2 });
    const probe = t.probe();
    await t.until(() => probe.lock === 0, 600);
    const state = probe.state;
    // Couloir de la rangée 5 coupé à la colonne 6 ; la case voisine (6, 6) est de la bonne valeur : on l'échange avec (6, 5).
    t.corridor(5, [...Array.from({ length: 12 }, (_, col) => ({ col, row: 5 })).filter((c) => c.col !== 6), { col: 6, row: 6 }]);
    const view = t.toadB0();
    const grab = t.centre(probe.wand!);
    t.host.input.moveMouse(grab.x, grab.y);
    t.host.input.mouseDown("left");
    await t.ticks(3);
    const cells = [{ col: 6, row: 5 }, { col: 6, row: 6 }];
    for (const [i, cell] of cells.entries()) {
      const o = probe.origin(cell.col, cell.row);
      t.host.input.moveMouse(o.x + 16 - 27, o.y + 14 - 22);
      await t.ticks(2);
      if (i > 0) t.host.input.mouseDown("left");
      await t.ticks(1);
      t.host.input.mouseUp("left");
      await t.ticks(2);
    }
    await t.until(() => !probe.exchanging, 200);
    expect(state.fairy.total).toBe(1);
    // Fin du transport : un clic hors de l'étang.
    t.host.input.moveMouse(20, 20);
    t.host.input.mouseDown("left");
    await t.ticks(1);
    t.host.input.mouseUp("left");
    await t.ticks(4);
    expect(probe.carrying).toBeNull();
    await t.dragToad(view.toad.index, 5);
    await t.until(() => probe.state.arrivals === 1, 10_000);
    expect(state.saved[0]).toBe(true);
    // La jauge passe d'un cran tous les `perGauge` échanges : un seul échange et `perGauge` > 1 ne la change pas.
    expect(state.fairy.gauge).toBe(state.fairy.perGauge === 1 ? 1 : 0);
    expect(probe.wand!.scriptId).toBe(10078 + state.fairy.gauge);
    expect(FAIRY_GAUGE).toBe(6);
  }, 60_000);

  it("grenouilles (niveau 4) : la première naît à 600 ticks d'une fois l'introduction finie, sur un nénuphar d'entrée qu'elle occupe, et un crapaud n'y saute pas", async () => {
    const t = await start({ level: 3, size: 6 });
    const probe = t.probe();
    await t.until(() => probe.lock === 0, 600);
    expect(probe.state.info.entries.length).toBe(3);
    expect(probe.frogs).toHaveLength(0);
    await t.until(() => probe.frogs.length > 0, 1200);
    const view = probe.frogs[0]!;
    const entry = probe.state.info.entries[view.frog.entry]!;
    expect(view.frog.col).toBe(entry.col);
    expect(probe.state.pond.cells[cellIndex(entry.col, 0)]!.occupied).toBe(true);
    expect(view.feature.scriptId).toBe(10067);
    await t.until(() => view.phase === "ready" || view.phase === "hop" || view.phase === "exit", 600);
    // Les grenouilles sont immobiles tant qu'un échange n'a pas touché leur valeur (champ de distance nul, étude §2.7) : elles occupent seulement leur case.
    await t.ticks(300);
    expect(view.frog.row).toBe(0);
    expect(view.frog.alive).toBe(true);
    expect(t.engine.error).toBeNull();
  }, 60_000);

  it("« suite » : son 996, puis l'écran suivant ; les Zoombinis dont le crapaud n'est pas arrivé sont perdus et rendus au camp 1", async () => {
    const t = await start({ level: 0, size: 4 });
    const probe = t.probe();
    await t.until(() => probe.lock === 0, 600);
    // Sans arrivée, « suite » est grisé : le clic ne fait rien.
    t.press(BUTTON_GO);
    await t.ticks(10);
    expect(probe.leaving).toBe(false);
    t.corridor(5);
    const view = t.toadB0();
    await t.dragToad(view.toad.index, 5);
    await t.until(() => probe.state.arrivals === 1, 8000);
    const before = t.zoombinis.game.counters.camp1;
    t.queued.length = 0;
    t.press(BUTTON_GO);
    await t.ticks(5);
    expect(probe.leaving).toBe(true);
    expect(t.queued).toContain(996);
    await t.until(() => t.zoombinis.lastChange !== null, 1500);
    expect(t.zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.lilly, "success") });
    expect(t.zoombinis.game.group.members.filter((z: Zoombini) => z.present)).toHaveLength(1);
    expect(t.zoombinis.game.counters.camp1 - before).toBe(3);
    expect(t.zoombinis.game.successes[S.lilly - 7]! & 1).toBe(1);
    expect(t.engine.error).toBeNull();
  }, 60_000);

  it("le bouton carte ouvre l'avertissement ; confirmé, l'épreuve est abandonnée et la carte s'affiche", async () => {
    const t = await start();
    t.press(BUTTON_MAP);
    await t.ticks(10);
    expect(t.engine.services.get(DIALOG).isOpen).toBe(true);
    t.host.press("Enter");
    await t.ticks(30);
    expect(t.zoombinis.lastChange).toMatchObject({ screen: S.map });
  });

  it("une partie enregistrée pendant l'épreuve retrouve le groupe entier ; le crochet est retiré à la sortie", async () => {
    const t = await start({ level: 0, size: 4 });
    const probe = t.probe();
    const dialogs = t.engine.services.get(DIALOG) as unknown as { beforeSave: (() => void)[] };
    expect(dialogs.beforeSave).toHaveLength(1);
    await t.until(() => probe.lock === 0, 600);
    t.corridor(5);
    await t.dragToad(t.toadB0().toad.index, 5);
    await t.ticks(20);
    t.zoombinis.game.group.members = [];
    for (const hook of dialogs.beforeSave) hook();
    expect(t.zoombinis.game.group.members).toHaveLength(4);
    expect(t.zoombinis.game.group.members.every((z) => z.present)).toBe(true);
    // Retour à la carte : le crochet est retiré.
    t.press(BUTTON_MAP);
    await t.ticks(10);
    t.host.press("Enter");
    await t.ticks(30);
    expect(dialogs.beforeSave).toHaveLength(0);
  });

  it("F1 rejoue la voix d'accueil", async () => {
    const t = await start({ level: 0, size: 4 });
    const probe = t.probe();
    await t.ticks(400);
    t.queued.length = 0;
    t.host.press("F1");
    await t.ticks(5);
    expect(t.queued).toContain(probe.welcome);
  });
});

/** Positions de repos des crapauds (`DS2:23e8`). */
const REST: readonly { x: number; y: number }[] = [
  { x: 66, y: 118 },
  { x: 60, y: 147 },
  { x: 46, y: 177 },
  { x: 58, y: 205 },
  { x: 44, y: 232 },
  { x: 52, y: 262 },
  { x: 39, y: 289 },
  { x: 18, y: 313 },
  { x: 47, y: 327 },
  { x: 17, y: 345 },
  { x: 43, y: 363 },
  { x: 53, y: 393 },
];
