import { describe, expect, it } from "vitest";
import { exitHotspotId } from "../../../src/games/lure/engine/exits";
import type { LureEngine } from "../../../src/games/lure/engine/game";
import type { Hotspot } from "../../../src/games/lure/engine/hotspot";
import { CharacterMode, CurrentAction, HotspotId } from "../../../src/games/lure/engine/ids";
import { LureMovement } from "../../../src/games/lure/engine/movement";
import { ORIGINAL_PATHFIND_COUNTDOWN, type PathFinderState } from "../../../src/games/lure/engine/pathfinder";
import type { PausedCharacter } from "../../../src/games/lure/engine/paused-list";
import { Driver, type TestHost, hasOriginalFiles, makeEngine } from "./test-host";

/** PNJ du village (emplois du temps du gestionnaire 2) : forgeron, Gwen, Mallin, les deux moines, Wayne. */
const VILLAGERS = [HotspotId.BLACKSMITH, HotspotId.GWEN, HotspotId.MALLIN, HotspotId.MONK1, HotspotId.MONK2, HotspotId.WAYNE];
const MINUTE = 750; // images de 80 ms

/** Le joueur entre dans `room` par le chemin du jeu (`playerNewPos`, `playerChangeRoom`) ; `y` est celui du pied. */
function enterRoom(engine: LureEngine, room: number, x: number, footY: number): void {
  engine.world.fields.playerNewPos = { roomNumber: room, x, y: footY - 48 };
  engine.tick();
}

/** Ferme les boîtes de texte éventuelles, puis avance d'une image. */
function step(engine: LureEngine): void {
  if (engine.busy) (engine.host as TestHost).push({ type: "pointer", x: 160, y: 100, buttons: 1 }, { type: "pointer", x: 160, y: 100, buttons: 0 });
  engine.tick();
}

/** Pose un personnage en un point libre de sa pièce, sans action ni attente. */
function place(h: Hotspot, room: number, x: number, y: number): void {
  h.setOccupied(false);
  h.currentActions.clear();
  h.characterMode = CharacterMode.NONE;
  h.delayCtr = 0;
  h.roomNumber = room;
  h.setPosition(x, y);
  h.setOccupied(true);
}

describe.skipIf(!hasOriginalFiles)("Diermot marche (playerAnimHandler, LureMovement)", () => {
  it("dans la cellule, « Ouvre la porte » par de vrais clics : il marche pas à pas jusqu'à la porte, puis le verbe s'exécute", () => {
    const { engine, host } = makeEngine();
    const d = new Driver(engine, host);
    d.ticks(2);
    const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
    const start = { x: player.x, y: player.y };
    const door = d.centerOf(0x2711);
    d.hover(door.x, door.y);
    d.click(door.x, door.y, "right");
    d.choose("Ouvre");

    const track: Array<{ x: number; y: number; action: number; frame: number }> = [];
    for (let i = 0; i < 300 && engine.dialogText === null; i++) {
      engine.tick();
      track.push({ x: player.x, y: player.y, action: player.currentActions.action(), frame: player.frameNumber });
    }
    expect(d.dialog()).toBe("La porte est verrouillée.");
    // Recherche de chemin d'un trait (budget 0, comme ScummVM), puis un pas par image.
    const walking = track.filter((t) => t.action === CurrentAction.WALKING);
    expect(walking.length).toBeGreaterThan(10);
    for (let i = 1; i < track.length; i++) {
      expect(Math.abs(track[i]!.x - track[i - 1]!.x)).toBeLessThanOrEqual(8);
      expect(Math.abs(track[i]!.y - track[i - 1]!.y)).toBeLessThanOrEqual(8);
    }
    expect(new Set(walking.map((t) => t.frame)).size).toBeGreaterThan(2);
    expect(Math.abs(player.x - start.x) + Math.abs(player.y - start.y)).toBeGreaterThan(40);
    // Arrivé : `characterWalkingCheck` ne demande plus de marcher vers la porte.
    expect(player.characterWalkingCheck(0x2711)).toBe(false);
    expect(engine.world.getExitJoin(0x2711)!.blocked).toBe(1);
  });

  it("un clic gauche sur le sol : il y marche, puis s'arrête (pile vide, case occupée)", () => {
    const { engine, host } = makeEngine();
    const d = new Driver(engine, host);
    d.ticks(2);
    const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
    d.click(200, 170);
    expect(player.currentActions.action()).not.toBe(CurrentAction.NO_ACTION);
    d.ticks(200);
    expect(player.currentActions.isEmpty()).toBe(true);
    expect(player.characterMode).toBe(CharacterMode.IDLE);
    expect(Math.abs(player.x + 16 - 200)).toBeLessThan(24);
    expect(Math.abs(player.y + player.heightCopy - 170)).toBeLessThan(16);
  });

  it("trajets entre toutes les sorties de chaque pièce : chaque marche se termine, la plupart prennent la sortie", () => {
    const { engine, data } = makeEngine();
    engine.tick();
    // Le Skorl de la cellule (groupe L2) rôde de pièce en pièce et, toutes les portes ouvertes, prendrait la sortie des briques
    // (séquence de sortie du joueur) : hors jeu, comme les autres PNJ de ce test.
    engine.world.deactivateHotspot(HotspotId.SKORL);
    engine.world.requireHotspot(HotspotId.SKORL).roomNumber = 0xffff;
    const outcomes = { exit: 0, stop: 0 };
    const roomsLeft = new Set<number>();
    for (const room of data.rooms) {
      const r = room.roomNumber;
      const coords = data.exitCoordinates[r - 1];
      if (!coords) continue;
      const arrivals: Array<[number, number]> = [];
      for (const other of data.rooms) {
        for (const e of other.exits) {
          if (e.roomNumber === r && e.sequenceOffset === 0xffff && !arrivals.some(([x, y]) => x === e.x && y === e.y)) arrivals.push([e.x, e.y]);
        }
      }
      const dests = coords.entries.filter((e, i) => (e.x !== 0 || e.y !== 0) && coords.entries.findIndex((f) => f.x === e.x && f.y === e.y) === i);
      for (const [ax, ay] of arrivals) {
        for (const dest of dests) {
          enterRoom(engine, r, ax, ay);
          while (engine.busy) step(engine);
          expect(engine.room.roomNumber).toBe(r);
          for (const join of engine.world.state.exitJoins) join.blocked = 0;
          const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
          player.stopWalking();
          // Comme un clic sur la sortie (`handleLeftClick`).
          const door = exitHotspotId(engine, r, dest.hotspotIndexId);
          player.walkTo((dest.x & 0xfff8) | 5, dest.y & 0xfff8, door);
          let t = 0;
          for (; t < 800 && engine.room.roomNumber === r && !player.currentActions.isEmpty(); t++) step(engine);
          expect(t, `pièce ${r} (${ax}, ${ay}) → (${dest.x}, ${dest.y}) : marche sans fin`).toBeLessThan(800);
          if (engine.room.roomNumber !== r) {
            outcomes.exit++;
            roomsLeft.add(r);
            // Sortie ordinaire vers sa pièce, ou sortie à séquence (égout, chute…) qui choisit la pièce.
            const ok = room.exits.some((e) => e.roomNumber === engine.room.roomNumber || e.sequenceOffset !== 0xffff);
            expect(ok, `pièce ${r} → ${engine.room.roomNumber}`).toBe(true);
          } else {
            outcomes.stop++;
          }
        }
      }
    }
    // 274 trajets : 240 prennent la sortie ; 34 s'arrêtent avant (chemin partiel : sortie hors de la zone de marche depuis ce point
    // d'arrivée, à comparer au banc ScummVM) ; chaque pièce qui a des arrivées est quittée au moins une fois.
    expect(outcomes.exit + outcomes.stop).toBe(274);
    expect(outcomes.exit).toBeGreaterThanOrEqual(240);
    expect(roomsLeft.size).toBeGreaterThanOrEqual(40);
  });
});

describe.skipIf(!hasOriginalFiles)("personnages autonomes (standardCharacterAnimHandler, followerAnimHandler)", () => {
  it("Ratpouch (suiveur) rejoint le joueur dans la pièce voisine, puis y fait ses actions aléatoires", () => {
    const { engine } = makeEngine();
    engine.tick();
    enterRoom(engine, 10, 150, 168);
    const ratpouch = engine.world.activateHotspot(HotspotId.RATPOUCH)!;
    for (let i = 0; i < 150; i++) step(engine);
    place(ratpouch, 10, 157, 128);
    enterRoom(engine, 11, 290, 135);
    let arrivedAt = -1;
    const positions = new Set<string>();
    for (let t = 0; t < 1500; t++) {
      step(engine);
      if (arrivedAt < 0 && ratpouch.roomNumber === 11) arrivedAt = t;
      if (ratpouch.roomNumber === 11) positions.add(`${ratpouch.x},${ratpouch.y}`);
    }
    expect(arrivedAt).toBeGreaterThan(0);
    expect(arrivedAt).toBeLessThan(MINUTE / 10);
    expect(engine.world.getActiveHotspot(HotspotId.RATPOUCH)).toBe(ratpouch);
    // Actions aléatoires de la pièce 11 (déplacements au hasard entre deux attentes).
    expect(positions.size).toBeGreaterThan(20);
  });

  it("les PNJ du village vivent dix minutes de jeu sans se bloquer (emplois du temps parcourus, changements de pièce)", () => {
    const { engine, host } = makeEngine();
    engine.tick();
    enterRoom(engine, 10, 150, 168);
    for (const id of VILLAGERS) engine.world.activateHotspot(id);
    const track = new Map(
      VILLAGERS.map((id) => [id, { rooms: new Set<number>(), entries: new Set<number>(), order: [] as number[], still: 0, stillMax: 0, last: "" }]),
    );
    for (let t = 0; t < 10 * MINUTE; t++) {
      step(engine);
      for (const id of VILLAGERS) {
        const h = engine.world.requireActiveHotspot(id);
        const tr = track.get(id)!;
        tr.rooms.add(h.roomNumber);
        const pos = `${h.roomNumber}:${h.x},${h.y}`;
        tr.still = pos === tr.last ? tr.still + 1 : 0;
        tr.stillMax = Math.max(tr.stillMax, tr.still);
        tr.last = pos;
        for (const entry of h.currentActions.entries) if (entry.support?.kind === "schedule") tr.entries.add(entry.support.id);
        const set = h.res.npcScheduleId >> 10;
        const own = [...h.currentActions.entries].reverse().find((e) => e.support?.kind === "schedule" && e.support.id >> 10 === set);
        const entryId = own?.support?.kind === "schedule" ? own.support.id : -1;
        if (entryId >= 0 && tr.order[tr.order.length - 1] !== entryId) tr.order.push(entryId);
      }
    }
    for (const id of VILLAGERS) {
      const tr = track.get(id)!;
      const name = id.toString(16);
      expect(tr.rooms.size, `${name} : pièces`).toBeGreaterThanOrEqual(4);
      expect(tr.stillMax, `${name} : immobile`).toBeLessThan(MINUTE / 2);
      expect(tr.entries.size, `${name} : emploi du temps`).toBeGreaterThanOrEqual(5);
    }
    // Mallin et les deux moines font le tour de leur emploi du temps : presque toutes les entrées, puis retour en arrière (boucle).
    for (const id of [HotspotId.MALLIN, HotspotId.MONK1, HotspotId.MONK2]) {
      const set = engine.world.requireHotspot(id).npcScheduleId >> 10;
      const size = engine.data.schedules.schedules[set - 1]!.entries.length;
      const order = track.get(id)!.order;
      expect(new Set(order).size, id.toString(16)).toBeGreaterThanOrEqual(size - 4);
      expect(order.some((e, i) => i > 0 && e < order[i - 1]!), id.toString(16)).toBe(true);
    }
    expect(host.logs.filter((l) => !l.startsWith("gestionnaire") && !/^porte 27[0-9a-f]{2} inactive$/.test(l))).toEqual([]);
  });

  it("deux PNJ qui se croisent : attente notée, l'un s'écarte, aucun blocage", () => {
    const { engine } = makeEngine();
    engine.tick();
    enterRoom(engine, 10, 293, 152);
    const gwen = engine.world.activateHotspot(HotspotId.GWEN)!;
    const mallin = engine.world.activateHotspot(HotspotId.MALLIN)!;
    place(gwen, 10, 37, 120);
    place(mallin, 10, 229, 120);
    gwen.walkTo(229, 168);
    mallin.walkTo(37, 168);
    const paused: PausedCharacter[][] = [];
    let t = 0;
    for (; t < 300 && !(gwen.currentActions.isEmpty() && mallin.currentActions.isEmpty()); t++) {
      step(engine);
      if (engine.world.state.pausedList.length > 0) paused.push(structuredClone(engine.world.state.pausedList));
    }
    expect(t).toBeLessThan(300);
    // Mallin heurte Gwen : il note l'attente, elle s'arrête (pauseCtr), il part au hasard pour s'écarter.
    expect(paused.flat().some((p) => p.srcCharId === HotspotId.MALLIN && p.destCharId === HotspotId.GWEN)).toBe(true);
    // Ils se sont croisés.
    expect(gwen.x).toBeGreaterThan(mallin.x);
    for (let i = 0; i < 40; i++) step(engine);
    expect(engine.world.state.pausedList).toEqual([]);
    expect(gwen.pauseCtr + mallin.pauseCtr).toBe(0);
  });
});

describe.skipIf(!hasOriginalFiles)("état de la marche sérialisable", () => {
  /** Aller-retour JSON de tout l'état propre à la marche (recherches, tronçons, attentes, comptes à rebours des suiveurs). */
  function roundTrip(engine: LureEngine): void {
    const world = engine.world;
    const snapshot = JSON.stringify({
      paused: world.state.pausedList,
      hotspots: world.activeHotspots.map((h) => ({ id: h.hotspotId, pf: h.pathFinder, countdown: h.followerCountdown })),
    });
    const parsed = JSON.parse(snapshot) as { paused: PausedCharacter[]; hotspots: Array<{ id: number; pf: PathFinderState; countdown: number }> };
    world.state.pausedList = parsed.paused;
    parsed.hotspots.forEach((s, i) => {
      const h = world.activeHotspots[i]!;
      expect(h.hotspotId).toBe(s.id);
      h.pathFinder = s.pf;
      h.followerCountdown = s.countdown;
    });
  }

  function positions(engine: LureEngine): string {
    return JSON.stringify(engine.world.activeHotspots.map((h) => [h.hotspotId, h.roomNumber, h.x, h.y, h.frameNumber, h.currentActions.entries]));
  }

  it("relu en pleine marche (recherche découpée en cours), le monde suit la même suite", () => {
    const make = () => {
      const { engine, host } = makeEngine({ movement: (ctx) => new LureMovement(ctx, ORIGINAL_PATHFIND_COUNTDOWN) });
      engine.tick();
      enterRoom(engine, 10, 150, 168);
      for (const id of VILLAGERS) engine.world.activateHotspot(id);
      const d = new Driver(engine, host);
      return { engine, d };
    };
    const a = make();
    const b = make();
    // Le joueur part vers l'autre bout de la pièce ; on avance jusqu'à une recherche interrompue.
    a.d.click(60, 160);
    b.d.click(60, 160);
    let t = 0;
    const searching = (e: LureEngine) => e.world.activeHotspots.some((h) => h.pathFinder.inProgress);
    for (; t < 2000 && !searching(a.engine); t++) {
      step(a.engine);
      step(b.engine);
    }
    expect(searching(a.engine)).toBe(true);
    expect(searching(b.engine)).toBe(true);
    roundTrip(b.engine);
    for (let i = 0; i < 3 * MINUTE; i++) {
      step(a.engine);
      step(b.engine);
      if (i % 25 === 0) expect(positions(b.engine), `image ${i}`).toBe(positions(a.engine));
    }
    expect(b.engine.rng.state).toBe(a.engine.rng.state);
  });
});
