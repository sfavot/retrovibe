/**
 * Le château (pièces 42 à 49) joué par de vrais clics, de l'arrivée dans la cave à la fin du jeu (`test/lure/solution/zone-castle.ts`) :
 * (a) d'une traite, (b) avec une sauvegarde et une reprise sur un moteur neuf après chaque étape.
 */
import { describe, expect, it } from "vitest";
import type { FightsManager } from "../../../../src/games/lure/engine/fights/index";
import type { LureEngine } from "../../../../src/games/lure/engine/game";
import { HotspotId } from "../../../../src/games/lure/engine/ids";
import { captureSave, parseSave, restoreSave } from "../../../../src/games/lure/engine/save";
import { Play, type Step } from "../../solution/runner";
import { CF, HS, ZONE_CASTLE_PHASES, setupCastleStart } from "../../solution/zone-castle";
import { type TestHost, hasOriginalFiles, makeEngine } from "../test-host";

const TELL_ACTION = 0x1000;

/** Ce qui doit être vrai à la fin de chaque phase de la solution (les clés sont les noms de `ZONE_CASTLE_PHASES`). */
const CHECKS: Record<string, (engine: LureEngine, host: TestHost, play: Play) => void> = {
  "cuisine : présentations, tenailles et graisse": (engine, _host, play) => {
    expect(play.inventory().sort()).toEqual(expect.arrayContaining(["Graisse", "Tenailles"]));
    expect(engine.room.roomNumber).toBe(43);
    expect(engine.world.fields.get(CF.WINE)).toBe(0);
  },
  "cave : le vin coule": (engine) => {
    expect(engine.room.roomNumber).toBe(42);
    expect(engine.world.fields.get(CF.WINE)).toBe(1);
    expect(engine.world.getActiveHotspot(HS.BUNG)).toBeFalsy();
  },
  "Minnow prévient le Skorl": (engine) => {
    expect(engine.world.fields.get(CF.TALK_INDEX)).toBe(1);
    expect(engine.world.fields.get(CF.WINE)).toBe(1);
  },
  "se cacher en bas de la pièce 46": (engine) => {
    // Le Skorl du réfectoire a disparu, le Skorl de la cave boit au tonneau (il n'en revient jamais), celui qui descendait est retiré.
    expect(engine.room.roomNumber).toBe(46);
    expect(engine.world.fields.get(CF.SKORL_AT_BARREL)).toBe(1);
    expect(engine.world.requireHotspot(HS.SKORL_GUARD).roomNumber).toBe(0xffff);
    expect(engine.world.getActiveHotspot(HS.SKORL_DRINKING)).toBeTruthy();
    expect(engine.world.getActiveHotspot(HotspotId.CASTLE_SKORL)).toBeFalsy();
    // Le vin coule encore : le Skorl est arrivé à temps.
    expect(engine.world.fields.get(CF.WINE)).toBe(1);
  },
  "Minnow : comment retrouver Séléna ?": (engine) => {
    expect(engine.world.fields.get(CF.TALK_INDEX)).toBe(5);
    expect(engine.world.requireHotspot(HS.MINNOW).actions & TELL_ACTION).toBe(TELL_ACTION);
  },
  "salle à grille : levier et treuil": (engine) => {
    expect(engine.room.roomNumber).toBe(48);
    expect(engine.world.fields.get(CF.LEVER_GREASED)).toBe(1);
    expect(engine.world.fields.get(CF.WINCH_DONE)).toBe(1);
    expect(engine.world.requireHotspot(HS.MINNOW).roomNumber).toBe(48);
  },
  "le chemin du pont-levis": (engine) => {
    expect(engine.room.roomNumber).toBe(49);
    expect(engine.world.fields.get(70)).toBe(1);
    expect((engine.fights as FightsManager).isFighting).toBe(true);
  },
  "combat contre le Skorl et fin du jeu": (engine, host) => {
    expect((engine.fights as FightsManager).record(HS.SKORL_FIGHTER).fwhits).toBe(5);
    expect(host.exits).toBe(1);
  },
};

/**
 * Les étapes après lesquelles le moteur refuse la sauvegarde : l'arrivée dans la cave (changement de pièce en cours), une conversation
 * qui attend un choix, le combat (qui commence à l'arrivée dans la pièce 49), la sortie et la séquence finale.
 */
function unsavable(step: Step): boolean {
  if ("wait" in step || "skipUntil" in step) return true;
  if ("verb" in step) return step.verb === "Parle à";
  if ("go" in step) return step.room === 49;
  if ("walk" in step) return step.walk[0] === 10 && step.walk[1] === 190;
  return false;
}

/** Un moteur neuf qui reprend `save` (pointeur rendu comme le ferait l'hôte), rejoué par un nouveau joueur. */
function resume(save: NonNullable<ReturnType<typeof captureSave>>, previous: LureEngine): { engine: LureEngine; host: TestHost; play: Play } {
  const { engine, host } = makeEngine();
  expect(restoreSave(engine, save)).toBe(true);
  Object.assign(engine.mouse, previous.mouse);
  engine.room.mouseX = previous.mouse.x;
  engine.room.mouseY = previous.mouse.y;
  return { engine, host, play: new Play(engine, host) };
}

describe.skipIf(!hasOriginalFiles)("le château, joué de la pièce 42 à la fin du jeu", () => {
  it("les phases ont toutes leurs vérifications", () => {
    expect(ZONE_CASTLE_PHASES.map((p) => p.name).sort()).toEqual(Object.keys(CHECKS).sort());
  });

  it("(a) d'une traite : tenailles, vin, Skorl saoul, treuil, combat, fin du jeu", () => {
    const { engine, host } = makeEngine();
    engine.tick();
    setupCastleStart(engine);
    const play = new Play(engine, host);
    for (const phase of ZONE_CASTLE_PHASES) {
      play.run(phase.steps);
      CHECKS[phase.name]!(engine, host, play);
    }
    // Le texte du jeu a bien été lu : les tenailles, le bondon, le combat.
    const text = play.log.dialogs.join("\n");
    expect(text).toContain("Le bondon tombe; le vin commence à couler du fût.");
    expect(text).toContain("Vous envelopez le levier tout rouillé avec le morceau de graisse.");
    expect(text).toContain("Une énorme bête apparaît et vous barre la route.");
    expect(host.exits).toBe(1);
  });

  it("(b) avec une sauvegarde et une reprise sur un moteur neuf après chaque étape", () => {
    let { engine, host } = makeEngine();
    engine.tick();
    setupCastleStart(engine);
    let play = new Play(engine, host);
    const dialogs: string[] = [];
    let resumes = 0;
    let skipped = 0;
    let steps = 0;
    for (const phase of ZONE_CASTLE_PHASES) {
      for (const step of phase.steps as Step[]) {
        play.run([step]);
        steps++;
        // La sauvegarde est refusée en combat ; la reprise se fait sur un moteur qui n'a jamais tourné, par du vrai JSON.
        const save = captureSave(engine);
        if (save === null) {
          expect(unsavable(step), `sauvegarde refusée après ${JSON.stringify(step).slice(0, 70)}`).toBe(true);
          skipped++;
          continue;
        }
        const parsed = parseSave(JSON.parse(JSON.stringify(save)));
        expect(parsed).toEqual(save);
        dialogs.push(...play.log.dialogs);
        const next = resume(parsed!, engine);
        engine = next.engine;
        host = next.host;
        play = next.play;
        resumes++;
      }
      CHECKS[phase.name]!(engine, host, play);
    }
    dialogs.push(...play.log.dialogs);
    expect(resumes).toBe(steps - skipped);
    expect(resumes).toBeGreaterThan(30);
    expect(dialogs.join("\n")).toContain("Le bondon tombe; le vin commence à couler du fût.");
    expect(host.exits).toBe(1);
  });
});
