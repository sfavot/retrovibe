/**
 * Avance rapide à l'entrée d'une pièce (`Room::setRoomNumber`) : `(getMillis() - exitTime) / 1000` secondes de ticks, au plus 300, calculé
 * par ScummVM sur 32 bits **non signés**. Les pièces 6, 7, 41 à 46 et 49 ont une heure de sortie initiale `0xFFFFF` : à la première entrée,
 * avant 1 048 575 ms de jeu, la différence boucle et l'avance est de 300 secondes. Constaté au banc (trace `LURE_TRACE`, scénario
 * `l-trace-a4`, commande `enter 7` à 8,6 s) : à la première image dans la pièce 7, le moine 0x3EE est déjà dans la pièce 14 en marche,
 * alors que ses données le placent dans la 36.
 */
import { describe, expect, it } from "vitest";
import { CharacterMode, HotspotId, IDLE_COUNTDOWN_SIZE, TickProc } from "../../../src/games/lure/engine/ids";
import { catchUpTicks } from "../../../src/games/lure/engine/room";
import { hasOriginalFiles, makeEngine } from "./test-host";

describe("nombre de ticks d'avance rapide (`catchUpTicks`)", () => {
  it("une seconde par tick, au plus 300 ; aucune pour une heure de sortie 0 ou 0xFFFF ; différence sur 32 bits non signés", () => {
    expect(catchUpTicks(0, 500_000)).toBe(0);
    expect(catchUpTicks(0xffff, 500_000)).toBe(0);
    expect(catchUpTicks(10_000, 52_999)).toBe(42);
    expect(catchUpTicks(10_000, 900_000)).toBe(300);
    expect(catchUpTicks(0xfffff, 8_600)).toBe(300);
  });
});

const MONK = 0x3ee;

function enter7(ticksBefore: number) {
  const { engine } = makeEngine();
  for (let i = 0; i < ticksBefore; i++) engine.tick();
  engine.room.leaveRoom();
  engine.room.setRoomNumber(7);
  engine.world.requireActiveHotspot(0x3e8).roomNumber = 7;
  return engine;
}

describe.skipIf(!hasOriginalFiles)("avance rapide à l'entrée d'une pièce", () => {
  it("première entrée dans la pièce 7 (heure de sortie 0xFFFFF) à 8,6 s : 300 secondes d'avance, le moine a quitté la pièce 36", () => {
    const engine = enter7(108);
    expect(engine.world.state.rooms.find((r) => r.roomNumber === 7)!.exitTime).toBe(0xfffff);
    const monk = engine.world.getActiveHotspot(MONK);
    expect(monk).not.toBeNull();
    expect(monk!.roomNumber).not.toBe(36);
  });

  it("heure de sortie 0 (jamais quittée) : pas d'avance, le moine est encore dans sa pièce de départ", () => {
    const { engine } = makeEngine();
    for (let i = 0; i < 108; i++) engine.tick();
    engine.world.state.rooms.find((r) => r.roomNumber === 7)!.exitTime = 0;
    engine.room.leaveRoom();
    engine.room.setRoomNumber(7);
    expect(engine.world.requireActiveHotspot(MONK).roomNumber).toBe(36);
  });

  /**
   * Retour d'une vue à distance (`Room::setRoomNumber` sans `Game::changeRoom`) : l'avance rapide rattrape tout le temps écoulé depuis
   * l'entrée du joueur dans sa pièce. **Écart voulu** : ScummVM n'y appelle que `Game::tick`, sans `pausedList().countdown()` ; un suiveur
   * oisif heurté y restait figé (`pauseCtr` = 15) et `followerAnimHandler` empilait une action aléatoire de la pièce à chaque fin
   * d'attente, jusqu'à l'arrêt « NPC character got an excessive number of pending actions » (constaté au banc, scénario `l-trace-remote`,
   * `docs/lure/group-3.md`). Le portage décompte la liste à chaque tick de rattrapage : le suiveur reprend son activité.
   */
  it("retour d'une vue à distance : un suiveur oisif heurté n'est plus figé pendant le rattrapage et n'empile pas (écart à ScummVM)", () => {
    const { engine } = makeEngine();
    for (let i = 0; i < 100; i++) engine.tick();
    const world = engine.world;
    const room = engine.room;
    room.leaveRoom();
    room.setRoomNumber(19);
    world.requireActiveHotspot(HotspotId.PLAYER).roomNumber = 19;
    const ratpouch = world.activateHotspot(HotspotId.RATPOUCH)!;
    world.requireHotspot(HotspotId.RATPOUCH).flags &= ~0x20;
    ratpouch.setPosition(250, 100);
    ratpouch.roomNumber = 19;
    expect(ratpouch.tickProcId).toBe(TickProc.FOLLOWER);
    ratpouch.currentActions.clear();
    ratpouch.characterMode = CharacterMode.IDLE;
    // Le joueur vient de le heurter (`PausedCharacterList::check`).
    world.state.pausedList.push({ srcCharId: HotspotId.PLAYER, destCharId: HotspotId.RATPOUCH, counter: IDLE_COUNTDOWN_SIZE });
    ratpouch.pauseCtr = IDLE_COUNTDOWN_SIZE;
    // Le joueur est entré dans la pièce 19 il y a 200 secondes ; il regarde la pièce 35, puis revient.
    world.requireRoom(19).exitTime = (room.clockMs() - 200_000) >>> 0;
    let maxStack = 0;
    let pausedTicks = 0;
    const tick = engine.tickHotspots.bind(engine);
    engine.tickHotspots = () => {
      tick();
      if (!engine.preloadFlag) return;
      maxStack = Math.max(maxStack, ratpouch.currentActions.size);
      if (ratpouch.pauseCtr > 1) pausedTicks++;
    };
    room.setRoomNumber(35);
    room.setRoomNumber(19);
    // ScummVM : figé les 200 ticks, au moins 8 actions empilées (le banc en montre jusqu'à 21).
    expect(pausedTicks).toBeLessThan(IDLE_COUNTDOWN_SIZE);
    expect(maxStack).toBeLessThanOrEqual(3);
    expect(world.state.pausedList.some((p) => p.destCharId === HotspotId.RATPOUCH)).toBe(false);
  });
});
