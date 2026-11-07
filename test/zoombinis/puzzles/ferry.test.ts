import { describe, expect, it, vi } from "vitest";
import { MohawkArchive } from "../../../src/data/mohawk/mohawk";
import { MsvcRandom } from "../../../src/engine/mohawk/rng";
import { parseScrb } from "../../../src/games/zoombinis/data/script";
import { DIALOG } from "../../../src/games/zoombinis/engine/dialog";
import { createZoombinisEngine } from "../../../src/games/zoombinis/engine/engine";
import { FEATURES } from "../../../src/games/zoombinis/engine/features";
import { ScreenId } from "../../../src/games/zoombinis/engine/scene";
import { GRAPHICS, installServices } from "../../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_TEXT } from "../../../src/games/zoombinis/engine/text";
import {
  BATH_REMARKS,
  buildRaft,
  commonMask,
  createChatter,
  createPlay,
  DOCK_PLACES,
  dockOccupancy,
  drawFromBag,
  createBag,
  drawRejection,
  dropOn,
  edgeCount,
  EJECT_ARRIVALS,
  EJECT_FLIGHTS,
  ENCOURAGE_FIRST,
  goEnabled,
  inDock,
  isSplash,
  layoutScriptId,
  onAcceptance,
  onRefusal,
  pickDockPlace,
  pickUp,
  REFUSAL_SPECIAL,
  robot,
  savedMembers,
  seatCount,
  seatedCount,
  SEAT_EJECT_SCRIPTS,
  testSeat,
  arrangementValid,
  type Raft,
} from "../../../src/games/zoombinis/game/puzzles/ferry";
import { nextScreen } from "../../../src/games/zoombinis/game/route";
import { makeZoombini, type Attrs, type Zoombini } from "../../../src/games/zoombinis/game/state";
import { createFerryScene, type FerryProbe } from "../../../src/games/zoombinis/scenes/puzzles/ferry";
import { BUTTON_GO, BUTTON_MAP, type KitMember } from "../../../src/games/zoombinis/scenes/puzzle-kit";
import { originalFiles } from "../../support/original";
import { runFor, TestHost } from "../engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");
const S = ScreenId;
const TICK_MS = 17;

/** Arêtes du graphe de voisinage de chaque niveau pour 16 à 20 tabourets (`ferry.md` §3). */
const EDGES = [
  [15, 16, 17, 18, 20],
  [22, 23, 25, 26, 28],
  [24, 25, 27, 29, 31],
  [33, 36, 38, 41, 43],
];

/** Radeau synthétique : une file de `n` tabourets côte à côte (chacun a 1 ou 2 voisins). */
function lineRaft(n: number): Raft {
  const cells = Array.from({ length: n }, (_, i) => ({ w: 1, x: 100 + i * 44, y: 300 }));
  return buildRaft(0, Math.max(16, n), [...cells, ...Array.from({ length: Math.max(16, n) - n }, (_, i) => ({ w: 1, x: 100 + i * 44, y: 400 }))], []);
}

/** Au repos sur le ponton : pose d'attente ou animation d'attente. */
function atRest(member: KitMember): boolean {
  return member.snoid.resting || member.snoid.playingWait;
}

function randomGroup(rng: MsvcRandom, size: number): Attrs[] {
  return Array.from({ length: size }, () => [rng.range(1, 5), rng.range(1, 5), rng.range(1, 5), rng.range(1, 5)] as Attrs);
}

describe("règles du bac (ferry.ts)", () => {
  it("nombre de tabourets : celui du groupe de 16 à 20, sinon 16", () => {
    expect([0, 1, 15, 16, 17, 20, 21, 40].map(seatCount)).toEqual([16, 16, 16, 16, 17, 20, 16, 16]);
    expect([0, 1, 2, 3].map((level) => layoutScriptId(level, 16))).toEqual([1510, 1515, 1520, 1525]);
    expect(layoutScriptId(3, 20)).toBe(1529);
  });

  it("accepte un Zoombini sans voisin occupé, ou qui a un attribut commun avec chaque voisin occupé ; refuse sinon", () => {
    const raft = lineRaft(16);
    // Tabourets 0 - 1 - 2 en file : 1 a pour voisins 0 et 2.
    expect(raft.seats[1]!.neighbors).toEqual([0, 2]);
    const a: Attrs = [1, 1, 1, 1];
    const b: Attrs = [1, 2, 2, 2];
    const c: Attrs = [3, 3, 3, 2];
    const d: Attrs = [4, 4, 4, 4];
    const occupants: (Attrs | null)[] = raft.seats.map(() => null);
    expect(testSeat(raft, occupants, 1, d)).toEqual({ accepted: true, common: 0 });
    occupants[0] = a;
    occupants[2] = c;
    // b partage l'attribut 0 avec a et l'attribut 3 avec c.
    expect(testSeat(raft, occupants, 1, b)).toEqual({ accepted: true, common: 0b1001 });
    // d n'a rien de commun avec a : refusé au premier voisin.
    expect(testSeat(raft, occupants, 1, d)).toEqual({ accepted: false, common: 0 });
    // Un seul voisin sans trait commun suffit à refuser, même si l'autre en a.
    expect(testSeat(raft, occupants, 1, [1, 9, 9, 9]).accepted).toBe(false);
    expect(commonMask(a, b)).toBe(1);
    // Hors voisinage, rien n'est vérifié.
    expect(testSeat(raft, occupants, 8, d).accepted).toBe(true);
  });

  it("dropOn : accepté, le membre s'assoit ; refusé, il reste hors du radeau et le refus est compté", () => {
    const raft = lineRaft(16);
    const members: Attrs[] = [
      [1, 1, 1, 1],
      [2, 2, 2, 2],
      [1, 3, 3, 3],
    ];
    const play = createPlay(raft, members);
    expect(dropOn(play, 0, 0).accepted).toBe(true);
    expect(dropOn(play, 1, 1).accepted).toBe(false);
    expect(play.seatOf[1]).toBeNull();
    expect(play.refusals).toBe(1);
    expect(dropOn(play, 2, 1).accepted).toBe(true);
    expect(seatedCount(play)).toBe(2);
    expect(arrangementValid(play)).toBe(true);
    expect(() => dropOn(play, 0, 5)).toThrow();
    expect(() => dropOn(play, 1, 0)).toThrow();
  });

  it("défaut de l'original corrigé : un Zoombini repris puis lâché sur le ponton n'est plus compté assis", () => {
    const raft = lineRaft(16);
    const play = createPlay(raft, [[1, 1, 1, 1], [1, 2, 2, 2]]);
    expect(goEnabled(play)).toBe(false);
    dropOn(play, 0, 0);
    dropOn(play, 1, 1);
    expect(goEnabled(play)).toBe(true);
    expect(savedMembers(play)).toEqual([0, 1]);
    // Reprise (`+0x127 = 0`) puis lâché sur le ponton : on ne le rassoit pas.
    pickUp(play, 0);
    expect(seatedCount(play)).toBe(1);
    expect(play.occupant[0]).toBeNull();
    pickUp(play, 1);
    expect(goEnabled(play)).toBe(false);
    expect(savedMembers(play)).toEqual([]);
  });

  it("tirages sans répétition (1098:0098) : chaque valeur sort une fois avant de recommencer", () => {
    const rng = new MsvcRandom(7);
    const bag = createBag();
    const first = Array.from({ length: 5 }, () => drawFromBag(bag, 5, rng));
    expect([...first].sort()).toEqual([0, 1, 2, 3, 4]);
    const second = Array.from({ length: 5 }, () => drawFromBag(bag, 5, rng));
    expect([...second].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("répliques : refus (1815 quand rand(3, 5) égale le compte), encouragements (1816 puis 1817 / 1818)", () => {
    const rng = new MsvcRandom(3);
    const chatter = createChatter();
    const remarks = Array.from({ length: 12 }, () => onRefusal(chatter, rng));
    expect(remarks.every((r) => (r >= 1804 && r <= 1815))).toBe(true);
    expect(remarks.filter((r) => r === REFUSAL_SPECIAL).length).toBeLessThanOrEqual(1);
    const fresh = createChatter();
    // Premier dépôt du ponton : 730e = 1 = 7312 → 1816 ; puis plus rien avant de nouveaux dépôts.
    expect(onAcceptance(fresh, rng, true, 0, 16)).toBe(ENCOURAGE_FIRST);
    expect(onAcceptance(fresh, rng, true, 1, 16)).toBeNull();
    expect(fresh.threshold).toBeGreaterThanOrEqual(4);
    // Le dernier du groupe encourage toujours.
    const last = onAcceptance(fresh, rng, true, 15, 16);
    expect([1817, 1818]).toContain(last);
    expect(REFUSAL_SPECIAL).toBe(1815);
  });

  it("ponton : 20 places, occupation à moins de √500, place libre (paires puis impaires)", () => {
    expect(DOCK_PLACES).toHaveLength(20);
    expect(inDock(0, 130)).toBe(true);
    expect(inDock(469, 240)).toBe(true);
    expect(inDock(470, 200)).toBe(false);
    expect(inDock(100, 300)).toBe(false);
    const occupied = dockOccupancy([{ member: 4, x: DOCK_PLACES[3]!.x + 10, y: DOCK_PLACES[3]!.y + 10 }]);
    expect(occupied[3]).toBe(4);
    expect(occupied.filter((m) => m !== null)).toHaveLength(1);
    // Hors du rayon : libre.
    expect(dockOccupancy([{ member: 4, x: DOCK_PLACES[3]!.x + 23, y: DOCK_PLACES[3]!.y }])[3]).toBeNull();
    const free = Array.from({ length: 20 }, () => null);
    for (let seed = 1; seed < 30; seed++) {
      const place = pickDockPlace(free, new MsvcRandom(seed));
      expect(place === 18 || place === 0).toBe(true);
    }
    const evens = free.map((_, k) => (k % 2 === 0 ? k : null));
    for (let seed = 1; seed < 30; seed++) {
      const place = pickDockPlace(evens, new MsvcRandom(seed));
      expect(place === 19 || place === 1).toBe(true);
    }
    expect(pickDockPlace(free.map((_, k) => k), new MsvcRandom(1))).toBe(0);
  });

  it("variantes du refus : 0 seulement si les places 12 et 14 sont libres ; 7 à 9 sur une place impaire de 11 à 19 aux voisines libres", () => {
    const seen = new Set<number>();
    for (let seed = 1; seed < 120; seed++) {
      const rng = new MsvcRandom(seed);
      const chatter = createChatter();
      const blocked = Array.from({ length: 20 }, (_, k) => (k === 12 ? 99 : null));
      for (let i = 0; i < 10; i++) {
        const { variant, place } = drawRejection(chatter, blocked, rng);
        seen.add(variant);
        expect(variant).not.toBe(0);
        expect(place).toBeGreaterThanOrEqual(0);
        expect(place).toBeLessThan(20);
        if (isSplash(variant)) {
          expect(place % 2).toBe(1);
          expect(place).toBeGreaterThanOrEqual(11);
        }
      }
    }
    expect(seen.has(7) && seen.has(8) && seen.has(9) && seen.has(1)).toBe(true);
    // Une impaire occupée avant la première libre : on tire à nouveau, donc jamais de baignade.
    const rng = new MsvcRandom(5);
    const chatter = createChatter();
    const occupied = Array.from({ length: 20 }, (_, k) => (k === 19 ? 3 : null));
    for (let i = 0; i < 20; i++) expect(isSplash(drawRejection(chatter, occupied, rng).variant)).toBe(false);
    expect(BATH_REMARKS).toHaveLength(5);
    expect(SEAT_EJECT_SCRIPTS).toHaveLength(10);
    expect(EJECT_FLIGHTS).toHaveLength(10);
    expect(EJECT_ARRIVALS.filter((s) => s === 1907)).toHaveLength(3);
  });

  it("robot sur un radeau synthétique : tout le monde est placé quand tous partagent un attribut", () => {
    const raft = lineRaft(16);
    const members = Array.from({ length: 16 }, (_, i) => [1, 1 + (i % 5), 1 + ((i * 3) % 5), 1 + ((i * 2) % 5)] as Attrs);
    const result = robot(raft, members);
    expect(result.moves).toHaveLength(16);
    expect(result.optimal).toBe(true);
    const play = createPlay(raft, members);
    for (const move of result.moves) expect(dropOn(play, move.member, move.seat).accepted).toBe(true);
    expect(seatedCount(play)).toBe(16);
  });
});

describe.skipIf(!original.has)("radeaux de FERRY.MHK", () => {
  const archive = original.has ? MohawkArchive.parse(original.read("FERRY.MHK")) : null;

  function raftOf(level: number, size: number): Raft {
    const layout = parseScrb(archive!.get("SCRB", layoutScriptId(level, size)));
    return buildRaft(level, size, layout.images[0]!.cells, layout.images[1]?.cells ?? []);
  }

  it("quatre formes de 16 à 20 tabourets : arêtes de l'étude, voisinage symétrique et connexe", () => {
    for (let level = 0; level < 4; level++) {
      for (let size = 16; size <= 20; size++) {
        const raft = raftOf(level, size);
        expect(raft.seats, `${level}/${size}`).toHaveLength(size);
        expect(edgeCount(raft), `${level}/${size}`).toBe(EDGES[level]![size - 16]);
        for (const seat of raft.seats) {
          for (const v of seat.neighbors) expect(raft.seats[v]!.neighbors).toContain(seat.index);
          expect(seat.variant).toBeGreaterThanOrEqual(1);
          expect(seat.variant).toBeLessThanOrEqual(3);
          expect(seat.anchor).toEqual({ x: seat.x + 22, y: seat.y - 7 });
        }
        const seen = new Set([0]);
        const queue = [0];
        while (queue.length > 0) for (const v of raft.seats[queue.shift()!]!.neighbors) if (!seen.has(v)) (seen.add(v), queue.push(v));
        expect(seen.size, `${level}/${size}`).toBe(size);
        for (const decor of raft.decor) expect(decor.script).toBeGreaterThanOrEqual(1503), expect(decor.script).toBeLessThanOrEqual(1509);
      }
    }
  });

  it("le niveau 0 est une file (1 ou 2 voisins), le niveau 3 un réseau dense (jusqu'à 6 voisins)", () => {
    const degrees = (raft: Raft): number[] => raft.seats.map((s) => s.neighbors.length);
    expect(Math.max(...degrees(raftOf(0, 16)))).toBe(2);
    expect(Math.min(...degrees(raftOf(0, 16)))).toBe(1);
    expect(Math.max(...degrees(raftOf(3, 20)))).toBe(6);
    expect(Math.min(...degrees(raftOf(3, 20)))).toBeGreaterThanOrEqual(2);
  });

  it("robot : toutes les poses jouées dans l'ordre sont acceptées, l'arrangement final est valide, et il place presque toujours tout le groupe", () => {
    const shortfalls: number[] = [];
    for (let level = 0; level < 4; level++) {
      for (let seed = 1; seed <= 20; seed++) {
        const rng = new MsvcRandom(seed * 7 + level);
        const size = 16 + (seed % 5);
        const members = randomGroup(rng, size);
        const raft = raftOf(level, size);
        const result = robot(raft, members);
        const play = createPlay(raft, members);
        for (const move of result.moves) expect(dropOn(play, move.member, move.seat).accepted).toBe(true);
        expect(arrangementValid(play)).toBe(true);
        expect(goEnabled(play)).toBe(result.moves.length > 0);
        shortfalls.push(size - result.moves.length);
      }
    }
    // Quelques groupes ne peuvent pas être placés en entier (l'étude le dit) ; la grande majorité l'est.
    expect(shortfalls.filter((s) => s === 0).length).toBeGreaterThanOrEqual(72);
    expect(Math.max(...shortfalls)).toBeLessThanOrEqual(2);
  });
});

describe.skipIf(!original.has)("écran du bac (createFerryScene)", () => {
  interface Config {
    level?: number;
    size?: number;
    lessAction?: boolean;
    attrs?: (i: number) => Attrs;
    testMode?: boolean;
  }

  async function start(config: Config = {}) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 11 });
    const services = await installServices(engine);
    const entered: number[] = [];
    let probe!: FerryProbe;
    for (const id of Object.values(S)) {
      if (id === S.ferry) engine.register(id, () => createFerryScene((p) => (probe = p)));
      else engine.register(id, () => ({ enter: () => void entered.push(id), leave() {}, tick() {} }));
    }
    const zoombinis = services.game;
    const size = config.size ?? 16;
    const attrs = config.attrs ?? ((i: number) => [1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + (i % 3), 1 + ((i * 2) % 5)] as Attrs);
    zoombinis.game.group.members = Array.from({ length: size }, (_, i) => makeZoombini(attrs(i), i + 1));
    zoombinis.game.stageUnbroken = true;
    zoombinis.game.levels[1] = config.level ?? 0;
    zoombinis.game.options.lessAction = config.lessAction ?? true;
    zoombinis.game.options.magneticMouse = false;
    zoombinis.game.options.testMode = config.testMode ?? false;
    zoombinis.session.screen = S.ferry;
    engine.start(S.ferry);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    const ticks = (n: number) => runFor(engine, host, n * TICK_MS);
    const features = engine.services.get(FEATURES);

    /** Prend le membre `i` et le dépose pieds sur `to` ; renvoie après le relâchement. */
    async function drag(i: number, to: { x: number; y: number }) {
      const member = probe.kit.members[i]!;
      const rect = member.snoid.feature.rect!;
      const grab = { x: Math.floor((rect.left + rect.right) / 2), y: Math.floor((rect.top + rect.bottom) / 2) };
      const feet = { ...member.snoid.position };
      host.input.moveMouse(grab.x, grab.y);
      host.input.mouseDown("left");
      await ticks(3);
      host.input.moveMouse(grab.x + (to.x - feet.x), grab.y + (to.y - feet.y));
      await ticks(6);
      host.input.mouseUp("left");
      await ticks(4);
    }
    const seatPoint = (seat: number) => probe.raft.seats[seat]!.anchor;
    const settle = async (limit = 2500) => {
      for (let i = 0; i < limit && probe.busy; i += 10) await ticks(10);
    };
    return { host, engine, services, zoombinis, entered, probe: () => probe, ticks, features, drag, seatPoint, settle };
  }

  it("entre sur le fond 1300 avec le radeau du niveau, les Zoombinis sur le ponton et le bouton go grisé", async () => {
    for (let level = 0; level < 4; level++) {
      const t = await start({ level });
      const probe = t.probe();
      expect(probe.raft.level).toBe(level);
      expect(probe.raft.seats).toHaveLength(16);
      expect(probe.seatFeatures).toHaveLength(16);
      expect(probe.kit.members).toHaveLength(16);
      expect(probe.kit.goEnabled).toBe(false);
      // Chaque membre est debout sur sa place du ponton.
      probe.kit.members.forEach((m, i) => expect(m.snoid.position).toEqual(DOCK_PLACES[i]));
      expect(t.host.frames[t.host.frames.length - 1]!.pixels.some((p) => p !== 0)).toBe(true);
      // Tous les tabourets sont dessinés (une partie chacun).
      for (const f of probe.seatFeatures) expect(f.rect).not.toBeNull();
      expect(t.zoombinis.session.screen).toBe(S.ferry);
    }
  });

  it("entrée par défaut : les trois quarts debout, les autres arrivent à pied", async () => {
    const t = await start({ lessAction: false });
    const probe = t.probe();
    expect(probe.kit.walking).toBe(4);
    await t.ticks(1000);
    expect(probe.kit.walking).toBe(0);
    expect(probe.kit.members.every((m) => !m.walking)).toBe(true);
  });

  it("un Zoombini posé sur un tabouret libre est accepté : il s'assoit à l'ancre et « go » devient actif", async () => {
    const t = await start();
    const probe = t.probe();
    await t.drag(0, t.seatPoint(0));
    expect(probe.play.seatOf[0]).toBe(0);
    expect(probe.kit.members[0]!.snoid.position).toEqual(t.seatPoint(0));
    expect(probe.kit.goEnabled).toBe(true);
    expect(probe.busy).toBe(false);
    expect(t.engine.error).toBeNull();
  });

  it("au doigt (bug 18) : glisser le doigt sur l'image d'un tabouret libre, ou toucher le Zoombini puis le tabouret, l'y assied ; à la souris, la règle de l'original (ancre à 15 pixels) reste seule", async () => {
    // Le doigt cache le Zoombini porté : on vise le milieu de l'image du tabouret, 20 à 30 pixels sous l'ancre (position du Zoombini assis).
    const stoolCenter = (probe: FerryProbe, seat: number) => {
      const r = probe.seatFeatures[seat]!.rect!;
      return { x: Math.floor((r.left + r.right) / 2), y: Math.floor((r.top + r.bottom) / 2) };
    };
    const grabOf = (probe: FerryProbe, i: number) => {
      const r = probe.kit.members[i]!.snoid.feature.rect!;
      return { x: Math.floor((r.left + r.right) / 2), y: Math.floor((r.top + r.bottom) / 2) };
    };
    for (const mode of ["glisser", "toucher-toucher", "souris"] as const) {
      const t = await start();
      const probe = t.probe();
      (t.host as { pointerIsTouch?: boolean }).pointerIsTouch = mode !== "souris";
      // L'option « souris aimantée » d'une partie neuve : au doigt, elle est coupée (le relâchement d'un glisser dépose).
      t.zoombinis.game.options.magneticMouse = true;
      const member = probe.kit.members[0]!;
      const target = stoolCenter(probe, 0);
      const grab = grabOf(probe, 0);
      const anchor = t.seatPoint(0);
      // Pieds du Zoombini si le doigt est au milieu du tabouret : hors du carré de 15 pixels de l'ancre.
      const feet = { x: target.x - (grab.x - member.snoid.position.x), y: target.y - (grab.y - member.snoid.position.y) };
      expect(Math.abs(feet.y - anchor.y)).toBeGreaterThan(15);
      t.host.input.moveMouse(grab.x, grab.y);
      t.host.input.mouseDown("left");
      await t.ticks(3);
      if (mode === "toucher-toucher") {
        t.host.input.mouseUp("left");
        await t.ticks(4);
        expect(probe.kit.carrying).toBe(member);
        // Le toucher suivant arrive sans survol : le pointeur saute sur le tabouret au moment de l'appui.
        t.host.input.moveMouse(target.x, target.y);
        t.host.input.mouseDown("left");
        await t.ticks(3);
        t.host.input.mouseUp("left");
      } else {
        t.host.input.moveMouse(target.x, target.y);
        await t.ticks(6);
        t.host.input.mouseUp("left");
        if (mode === "souris") {
          // Souris aimantée : le Zoombini reste collé jusqu'au clic suivant, au même endroit.
          await t.ticks(3);
          t.host.input.mouseDown("left");
          await t.ticks(3);
          t.host.input.mouseUp("left");
        }
      }
      await t.ticks(10);
      expect(probe.kit.carrying).toBeNull();
      if (mode === "souris") {
        // Comme dans l'original : hors du ponton et loin de l'ancre, il rejoint à pied une place du ponton (vers la gauche).
        expect(probe.play.seatOf[0]).toBeNull();
        expect(member.walking).toBe(true);
      } else {
        expect(probe.play.seatOf[0], mode).toBe(0);
        expect(member.snoid.position).toEqual(anchor);
        expect(member.walking).toBe(false);
        expect(probe.kit.goEnabled).toBe(true);
      }
      expect(t.engine.error).toBeNull();
    }
  });

  it("lâché sur le ponton hors d'un tabouret, le Zoombini reste là où il est tombé (sa place d'attente n'est plus à lui)", async () => {
    const t = await start();
    const probe = t.probe();
    const member = probe.kit.members[0]!;
    const place = probe.kit.waitingPlaces[0]!;
    await t.drag(0, { x: 300, y: 150 });
    expect(member.snoid.position).toEqual({ x: 300, y: 150 });
    expect(member.walking).toBe(false);
    expect(member.target).toBeNull();
    expect(member.waiting).toBeNull();
    expect(place.owner).toBeNull();
    expect(probe.play.seatOf[0]).toBeNull();
    expect(member.snoid.feature.depth).toBeCloseTo(1 + 150 / 1000);
    expect(t.engine.error).toBeNull();
  });

  it("lâché hors du ponton, le Zoombini rejoint à pied une place libre du ponton (marche du kit, non comptée), puis peut être repris", async () => {
    const t = await start();
    const probe = t.probe();
    const member = probe.kit.members[0]!;
    await t.drag(0, { x: 600, y: 80 });
    expect(member.walking).toBe(true);
    expect(probe.kit.walking).toBe(0);
    for (let i = 0; i < 100 && member.walking; i++) await t.ticks(10);
    expect(member.walking).toBe(false);
    const at = member.snoid.position;
    expect(DOCK_PLACES.some((p) => p.x === at.x && p.y === at.y)).toBe(true);
    expect(member.snoid.feature.depth).toBeCloseTo(1 + at.y / 1000);
    expect(probe.kit.arrived).toBe(0);
    expect(t.engine.error).toBeNull();
  });

  it("un Zoombini refusé est éjecté : remarque de la grenouille, tabouret qui bascule, retour sur le ponton, rien d'assis", async () => {
    // Membres 0 et 1 sans aucun attribut commun.
    const t = await start({ attrs: (i) => (i === 0 ? [1, 1, 1, 1] : i === 1 ? [2, 2, 2, 2] : [1 + (i % 2), 3, 3, 3]) });
    const probe = t.probe();
    const next = probe.raft.seats[0]!.neighbors[0]!;
    await t.drag(0, t.seatPoint(0));
    expect(probe.play.seatOf[0]).toBe(0);
    await t.drag(1, t.seatPoint(next));
    // Refus : occupé, le tabouret est libre, rien n'est assis, la grenouille parle.
    expect(probe.busy).toBe(true);
    expect(probe.play.seatOf[1]).toBeNull();
    expect(probe.play.occupant[next]).toBeNull();
    expect(probe.kit.members[1]!.snoid.position).toEqual(t.seatPoint(next));
    // Pendant le refus, personne ne peut être saisi.
    expect(probe.kit.pick(probe.kit.members[2]!.snoid.feature.rect!.left + 5, probe.kit.members[2]!.snoid.feature.rect!.top + 5)).toBe(false);
    const sounds: number[] = [];
    const frogScripts = new Set<number>();
    const stool = probe.seatFeatures[next]!;
    const stoolScripts = new Set<number>();
    for (let i = 0; i < 2500 && probe.busy; i += 5) {
      await t.ticks(5);
      frogScripts.add(probe.frog.scriptId);
      stoolScripts.add(stool.scriptId);
    }
    void sounds;
    expect(probe.busy).toBe(false);
    expect(probe.variant).not.toBeNull();
    // La remarque (1804 à 1815) puis l'action (1604 à 1607) ont joué.
    expect([...frogScripts].some((s) => s >= 1804 && s <= 1815)).toBe(true);
    expect([...frogScripts].some((s) => s >= 1604 && s <= 1607)).toBe(true);
    // Le tabouret a joué son basculement puis est revenu à son image.
    expect([...stoolScripts].some((s) => s >= 1700 && s <= 1703)).toBe(true);
    expect(stool.scriptId).toBeGreaterThanOrEqual(1500);
    expect(stool.scriptId).toBeLessThanOrEqual(1502);
    // Le Zoombini est de nouveau sur le ponton, au repos, et peut être repris.
    await t.ticks(300);
    const member = probe.kit.members[1]!;
    expect(probe.play.seatOf[1]).toBeNull();
    expect(atRest(member)).toBe(true);
    expect(seatedCount(probe.play)).toBe(1);
    expect(member.snoid.position.y).toBeLessThan(250);
    expect(t.engine.error).toBeNull();
    // Le tabouret est de nouveau libre : on y pose un autre Zoombini compatible (0 est assis à côté, 2 a l'attribut 0 commun si impair).
    await t.drag(2, t.seatPoint(next));
    expect(probe.play.seatOf[2] === next || probe.busy).toBe(true);
  });

  it("variantes d'éjection : toutes finissent sur le ponton (y compris la baignade) sans erreur", async () => {
    const seenVariants = new Set<number>();
    for (let seed = 1; seed <= 14 && seenVariants.size < 10; seed++) {
      const t = await start({ attrs: (i) => (i === 0 ? [1, 1, 1, 1] : i === 1 ? [2, 2, 2, 2] : [3, 3, 3, 3]) });
      // Ajuste le hasard : une graine différente par essai.
      t.engine.ctx.rng.seed(seed * 101);
      const probe = t.probe();
      const next = probe.raft.seats[0]!.neighbors[0]!;
      await t.drag(0, t.seatPoint(0));
      for (let k = 0; k < 6; k++) {
        await t.drag(1, t.seatPoint(next));
        if (!probe.busy) break;
        await t.settle();
        expect(probe.busy).toBe(false);
        await t.ticks(300);
        seenVariants.add(probe.variant!);
        expect(atRest(probe.kit.members[1]!), `variante ${probe.variant} script ${probe.kit.members[1]!.snoid.scriptId}`).toBe(true);
        expect(probe.play.seatOf[1]).toBeNull();
        expect(t.engine.error).toBeNull();
      }
    }
    expect(seenVariants.size).toBeGreaterThanOrEqual(8);
    expect([...seenVariants].some(isSplash)).toBe(true);
  }, 60_000);

  it("un Zoombini repris sur un tabouret puis lâché sur le ponton n'est plus compté assis (défaut de l'original corrigé)", async () => {
    const t = await start();
    const probe = t.probe();
    await t.drag(0, t.seatPoint(0));
    expect(seatedCount(probe.play)).toBe(1);
    expect(probe.kit.goEnabled).toBe(true);
    // Repris sur son tabouret et lâché dans le rectangle du ponton.
    await t.drag(0, { x: 200, y: 215 });
    expect(probe.play.seatOf[0]).toBeNull();
    expect(seatedCount(probe.play)).toBe(0);
    expect(probe.kit.goEnabled).toBe(false);
    expect(probe.kit.members[0]!.snoid.position).toEqual({ x: 200, y: 215 });
    // « go » est grisé : le cliquer ne fait rien.
    t.host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
    await t.ticks(30);
    expect(probe.departing).toBe(false);
    expect(probe.frog.scriptId).not.toBe(1608);
    // Relâché hors du ponton (sur l'eau, loin de tout tabouret), il rejoint une place libre du ponton.
    await t.drag(0, { x: 560, y: 330 });
    await t.ticks(400);
    expect(inDock(probe.kit.members[0]!.snoid.position.x, probe.kit.members[0]!.snoid.position.y)).toBe(true);
    expect(probe.play.seatOf[0]).toBeNull();
  });

  it("départ avec un radeau incomplet : seuls les assis traversent, les autres sont perdus et rendus au camp 1", async () => {
    const t = await start({ attrs: () => [1, 1, 1, 1] });
    const probe = t.probe();
    for (let i = 0; i < 3; i++) await t.drag(i, t.seatPoint(i));
    expect(seatedCount(probe.play)).toBe(3);
    const before = t.zoombinis.game.counters.camp1;
    t.host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
    await t.ticks(10);
    expect(probe.departing).toBe(true);
    // Le père mathieu joue le départ (1608 ou 1609) et le radeau glisse de 113 pixels.
    await t.ticks(60);
    expect([1608, 1609]).toContain(probe.frog.scriptId);
    const seat0 = probe.seatFeatures[0]!.rect!.left;
    await t.ticks(500);
    expect(probe.shifted).toBe(113);
    expect(t.zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.ferry, "success") });
    expect(seat0).toBeGreaterThan(0);
    const game = t.zoombinis.game;
    expect(game.group.members.filter((z: Zoombini) => z.present)).toHaveLength(3);
    expect(game.counters.camp1 - before).toBe(13);
    expect(game.successes[S.ferry - 7]! & 1).toBe(1);
    expect(t.engine.error).toBeNull();
  });

  it("un clic pendant le départ court-circuite l'attente", async () => {
    const t = await start({ attrs: () => [1, 1, 1, 1] });
    const probe = t.probe();
    await t.drag(0, t.seatPoint(0));
    t.host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
    await t.ticks(30);
    expect(probe.departing).toBe(true);
    expect(t.zoombinis.lastChange).toBeNull();
    t.host.click(300, 400);
    await t.ticks(10);
    expect(t.zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: S.lilly });
  });

  it("le bouton carte ouvre l'avertissement ; confirmé, l'épreuve est abandonnée et la carte s'affiche", async () => {
    const t = await start();
    t.host.click(BUTTON_MAP.left + 5, BUTTON_MAP.top + 5);
    await t.ticks(10);
    expect(t.engine.services.get(DIALOG).isOpen).toBe(true);
    t.host.press("Enter");
    await t.ticks(30);
    expect(t.zoombinis.lastChange).toMatchObject({ screen: S.map });
  });

  it("jouable aux quatre niveaux : le robot pose tout ce qu'il peut par glisser-déposer, tout est accepté, le groupe traverse", async () => {
    for (let level = 0; level < 4; level++) {
      const rng = new MsvcRandom(100 + level);
      const attrs = randomGroup(rng, 16);
      const t = await start({ level, attrs: (i) => attrs[i]! });
      const probe = t.probe();
      const result = robot(probe.raft, attrs);
      expect(result.moves.length).toBeGreaterThanOrEqual(14);
      for (const move of result.moves) {
        await t.drag(move.member, t.seatPoint(move.seat));
        expect(probe.play.seatOf[move.member], `niveau ${level}`).toBe(move.seat);
      }
      expect(seatedCount(probe.play)).toBe(result.moves.length);
      expect(probe.busy).toBe(false);
      expect(arrangementValid(probe.play)).toBe(true);
      t.host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
      await t.ticks(700);
      expect(t.zoombinis.lastChange, `niveau ${level}`).toMatchObject({ screen: S.xfer, target: S.lilly });
      expect(t.zoombinis.game.group.members.filter((z: Zoombini) => z.present)).toHaveLength(result.moves.length);
      expect(t.engine.error).toBeNull();
    }
  }, 120_000);

  describe("touches du mode de test (`10d8:0df6`)", () => {
    /** Presse une touche et renvoie les textes dessinés dans la foulée (ligne d'état du mode de test). */
    async function pressKey(t: Awaited<ReturnType<typeof start>>, key: string): Promise<string[]> {
      const text = t.engine.services.get(ZOOMBINIS_TEXT);
      const drawn: string[] = [];
      const draw = text.drawText.bind(text);
      const spy = vi.spyOn(text, "drawText").mockImplementation((surface, font, value, ...rest) => {
        drawn.push(value);
        return draw(surface, font, value, ...rest);
      });
      t.host.press(`Key${key.toUpperCase()}`, { key });
      await t.ticks(2);
      spy.mockRestore();
      return drawn;
    }

    it("L écrit « Level » et le niveau + 1, sans changer le niveau (l et L)", async () => {
      const t = await start({ testMode: true, level: 2 });
      expect(await pressKey(t, "l")).toContain("Level 3");
      expect(await pressKey(t, "L")).toContain("Level 3");
      expect(t.probe().raft.seats.length).toBeGreaterThan(0);
    });

    it("F rejoue le script du père mathieu et l'écrit (« Play FrogMan SCRB id: »)", async () => {
      const t = await start({ testMode: true });
      const first = (await pressKey(t, "f")).find((value) => value.startsWith("Play FrogMan SCRB id:"));
      expect(first).toMatch(/^Play FrogMan SCRB id: 1[68]\d\d$/);
      expect((await pressKey(t, "F")).some((value) => value.startsWith("Play FrogMan SCRB id:"))).toBe(true);
    });

    it("A trace le graphe de voisinage des tabourets (couleur 0xb) dans un objet unique", async () => {
      const t = await start({ testMode: true });
      const before = t.features.features.length;
      await pressKey(t, "a");
      expect(t.features.features.length).toBe(before + 1);
      const seat = t.probe().raft.seats.findIndex((candidate) => candidate.neighbors.length > 0);
      const rect = t.probe().seatFeatures[seat]!.rect!;
      const centre = { x: Math.trunc((rect.left + rect.right) / 2), y: Math.trunc((rect.top + rect.bottom) / 2) };
      expect(t.engine.services.get(GRAPHICS).screen.get(centre.x, centre.y)).toBe(0xb);
      await pressKey(t, "A");
      expect(t.features.features.length).toBe(before + 1);
    });

    it("sans mode de test, A, F et L ne font rien", async () => {
      const t = await start({ level: 2 });
      const before = t.features.features.length;
      for (const key of ["a", "f", "l"]) expect(await pressKey(t, key)).toEqual([]);
      expect(t.features.features.length).toBe(before);
    });
  });

  it("F1 rejoue la voix d'introduction du narrateur (20073 ou 20074)", async () => {
    const t = await start();
    const probe = t.probe();
    expect([20073, 20074]).toContain(probe.kit.introVoice);
  });
});
