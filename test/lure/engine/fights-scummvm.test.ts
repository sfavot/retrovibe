/**
 * Comparaison aux combats de ScummVM : trois combats du cochon (immobile, joué à la souris et au clavier, gagné) menés dans le banc
 * ScummVM (`scratchpad/scummvm-build/bench`, journal `LURE_FIGHT_TRACE` de fights.cpp) sont rejoués ici image par image : mêmes événements
 * (souris, touches), mêmes tirages du hasard de l'adversaire (ceux de ScummVM : le hasard avant le combat dépend du temps réel du banc),
 * et l'état après chaque tick (positions, images, coups reçus, séquences, curseur) doit être le même.
 * Fixture : `fixtures/fights-scummvm.json` (extraite par `bench/port/fights-extract.py`).
 */
import { describe, expect, it } from "vitest";
import type { LureAction, LureInput } from "../../../src/games/lure/engine/host";
import { Field, GameState, HotspotId } from "../../../src/games/lure/engine/ids";
import { FightsManager } from "../../../src/games/lure/engine/fights/index";
import fixture from "./fixtures/fights-scummvm.json";
import { Driver, hasOriginalFiles, makeEngine } from "./test-host";

type TraceEvent = [name: string, x: number, y: number, custom: number];
interface TraceFrame {
  e: TraceEvent[];
  r: number[];
  s: number[];
}
const FIELDS = fixture.fields;
const FIGHTS = fixture.fights as unknown as Record<string, { frames: TraceFrame[]; tail: number[] }>;


/** `kActionFight*` de ScummVM (lure.h) : numéro de l'action personnalisée, dans l'ordre de l'énumération. */
const ACTIONS: Record<number, LureAction> = {
  6: "fightMoveLeft",
  7: "fightMoveRight",
  8: "fightCursorLeftTop",
  9: "fightCursorLeftMiddle",
  10: "fightCursorLeftBottom",
  11: "fightCursorRightTop",
  12: "fightCursorRightMiddle",
  13: "fightCursorRightBottom",
};

/**
 * Le combat du cochon comme le banc le lance (`enter 6`). Le combat est monté dès l'entrée dans la pièce ; le texte d'entrée n'apparaît
 * qu'à la treizième image du combat (le banc le ferme par un clic, hors des images du combat).
 */
function startPigFight(seed = 1) {
  const { engine, host } = makeEngine({ seed });
  const driver = new Driver(engine, host);
  driver.ticks(3);
  engine.room.leaveRoom();
  engine.room.setRoomNumber(6);
  engine.world.requireActiveHotspot(HotspotId.PLAYER).roomNumber = 6;
  expect(engine.fights.isFighting).toBe(true);
  return { engine, host, driver, fights: engine.fights as FightsManager };
}

/** Traduit les événements de ScummVM en entrées de l'hôte (l'état du pointeur, comme `readInput` les relit). */
function toInputs(events: TraceEvent[], pointer: { x: number; y: number; buttons: number }): LureInput[] {
  const out: LureInput[] = [];
  const push = () => out.push({ type: "pointer", x: pointer.x, y: pointer.y, buttons: pointer.buttons });
  for (const [name, x, y, custom] of events) {
    if (name === "move") {
      pointer.x = x;
      pointer.y = y;
      push();
    } else if (name === "ldown" || name === "rdown") {
      pointer.x = x;
      pointer.y = y;
      pointer.buttons = name === "ldown" ? 1 : 2;
      push();
    } else if (name === "lup" || name === "rup") {
      const mask = name === "lup" ? 1 : 2;
      if ((pointer.buttons & mask) === 0) {
        // Relâchement sans appui connu (la fermeture du texte d'entrée) : un appui puis le relâchement, même effet sur les boutons.
        pointer.buttons = mask;
        push();
      }
      pointer.buttons = 0;
      push();
    } else if (name === "astart" || name === "aend") {
      const action = ACTIONS[custom];
      if (action) out.push({ type: name === "astart" ? "action" : "actionEnd", action });
    }
  }
  return out;
}

describe.skipIf(!hasOriginalFiles)("combats : même déroulement que ScummVM (cochon, hasard et entrées de ScummVM)", () => {
  for (const name of Object.keys(FIGHTS)) {
    it(`${name} : ${FIGHTS[name]!.frames.length} images identiques`, () => {
      const { frames, tail } = FIGHTS[name]!;
      const { engine, host, driver, fights } = startPigFight();
      const rng: number[] = [];
      // Les autres tirages de la pièce (séquences différées du décor : `randomToGeneral`) gardent le hasard du portage : ils ne touchent pas le combat.
      const realNumber = engine.rng.number.bind(engine.rng);
      engine.rng.number = (max: number) => {
        if (max !== 31) return realNumber(max);
        const value = rng.shift();
        expect(value, "tirage du hasard manquant").toBeDefined();
        return value!;
      };
      // L'état est relevé à la fin de chaque image du combat (comme `FT` : après le tick des hotspots, avant la suite de `nextFrame`).
      let snapshot: number[] = [];
      const loop = fights.fightLoop.bind(fights);
      fights.fightLoop = () => {
        loop();
        const p = engine.world.requireActiveHotspot(HotspotId.PLAYER);
        const e = engine.world.requireActiveHotspot(HotspotId.PIG);
        const pr = fights.record(HotspotId.PLAYER);
        const er = fights.record(HotspotId.PIG);
        snapshot = [p.x, p.y, p.frameNumber, e.x, e.y, e.frameNumber, pr.fwhits, er.fwhits, pr.fwseq_ad, er.fwseq_ad, pr.fwmove_number, er.fwdist, engine.room.cursor];
      };

      const pointer = { x: 160, y: 100, buttons: 0 };
      // Dans le banc, une image avant la première relevée ne fait avancer que le joueur (le cochon n'est pas encore au jeu à ce tick) : même
      // décalage d'une image entre eux qu'ici en faisant ce tick-là à la main.
      engine.world.fields.set(Field.CHARACTER_HOTSPOT_ID, HotspotId.PLAYER);
      engine.world.requireActiveHotspot(HotspotId.PLAYER).tick();
      let moved = false;
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i]!;
        // Le texte d'entrée bloque le monde : fermé par un clic, comme le banc, sans image de combat.
        while (engine.busy) driver.click(160, 100);
        expect(fights.isFighting, `image ${i} : le combat est fini trop tôt`).toBe(true);
        host.push(...toInputs(f.e, pointer));
        if (f.e.some((e) => e[0] === "move")) moved = true;
        rng.push(...f.r);
        // La suite de la dernière image de logique (le cochon tire encore une fois avant que la partie ne recommence) est dans le même tick.
        if (i === frames.length - 1) rng.push(...tail);
        driver.ticks(1);
        const expected = f.s.slice(0, snapshot.length);
        // Avant le premier mouvement de la souris, le curseur est celui de l'entrée dans la pièce (`room.cursor` : pas l'affaire des combats).
        const diff = FIELDS.map((field, k) => (field === "cursor" && !moved) || snapshot[k] === expected[k] ? "" : `${field} ${snapshot[k]} (ScummVM ${expected[k]})`).filter(Boolean);
        expect(diff, `image ${i}`).toEqual([]);
      }
      expect(rng, "tirages non consommés").toEqual([]);
      expect(fights.isFighting).toBe(false);
      if (name === "idle" || name === "play") expect(engine.gameState & GameState.RESTART).not.toBe(0);
    });
  }
});
