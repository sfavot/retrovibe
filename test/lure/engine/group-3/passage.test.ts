/**
 * Passage de la zone village : de la sortie de la cellule (état mis en place par `startVillage` : première entrée dans la pièce 7, qui
 * installe le village) jusqu'à la porte de la boutique de Goewin (pièce 19) déverrouillée par Ratpouch avec le crochet de Grub (`TALK_INDEX` 5), la solution
 * jouée par de vrais clics
 * (`test/lure/solution/zone-village.ts`), puis la même chose avec une sauvegarde et une reprise (moteur neuf, vrai JSON) à chaque étape.
 * La suite de la zone (le laboratoire de Taidgh, le thé, Goewin) est décrite dans `docs/lure/group-3.md`.
 */

import { describe, expect, it } from "vitest";
import type { LureEngine } from "../../../../src/games/lure/engine/game";
import { Field, HotspotId } from "../../../../src/games/lure/engine/ids";
import { captureSave, parseSave, restoreSave } from "../../../../src/games/lure/engine/save";
import { Play } from "../../solution/runner";
import { VILLAGE_STEPS, VillageField, startVillage } from "../../solution/zone-village";
import { hasOriginalFiles, makeEngine } from "../test-host";

const CROCHET = 0x271b;
const FLACON = 0x271d;
const POTION = 0x2728;
const LIVRE = 0x2723;

/** Ce que la solution doit avoir produit à la fin de la zone : le départ de la zone grottes et monastère (`setupCavesStart`). */
function expectVillageDone(engine: LureEngine): void {
  const world = engine.world;
  expect(world.fields.get(Field.TALK_INDEX)).toBe(15);
  // Goewin libérée a donné le sort (la Potion), préparé avec la Cobane : celui qui convient au dragon (champ 56 = 0).
  expect(world.fields.get(VillageField.SPELL)).toBe(3);
  expect(world.fields.get(56)).toBe(0);
  expect(world.requireHotspot(POTION).roomNumber).toBe(HotspotId.PLAYER);
  expect(world.fields.get(VillageField.GOEWIN_FREED)).toBe(1);
  // Le joueur a été Séléna, puis a repris son apparence ; le crochet est à Ratpouch, la porte de la boutique a été déverrouillée.
  expect(world.fields.get(VillageField.DISGUISE_LEFT)).toBe(0);
  expect(world.requireHotspot(CROCHET).roomNumber).toBe(HotspotId.RATPOUCH);
  // Le livre rouge est chez Toby, la statuette au joueur, le Flacon vidé puis bu.
  expect(world.requireHotspot(LIVRE).roomNumber).not.toBe(HotspotId.PLAYER);
  expect(world.requireHotspot(FLACON).roomNumber).toBe(HotspotId.PLAYER);
  // Sur la place avec Ratpouch.
  expect(engine.room.roomNumber).toBe(14);
  expect(world.requireHotspot(HotspotId.RATPOUCH).roomNumber).toBe(14);
  // Luthern, Morkus, Grub, Eileain, Toby connaissent leur nom : plus des étrangers.
  for (const id of [0x3eb, 0x421, 0x422, 0x442, 0x3f0]) expect(world.requireHotspot(id).nameId).not.toBe(world.requireHotspot(0x3ea).nameId);
}

describe.skipIf(!hasOriginalFiles)("passage de la zone village", () => {
  it("la solution jouée par de vrais clics, de la sortie de la cellule au sort de Goewin (TALK_INDEX 15), sur la place avec Ratpouch", () => {
    const { engine, host } = makeEngine();
    startVillage(engine);
    expect(engine.room.roomNumber).toBe(7);
    expect(engine.world.fields.get(Field.TALK_INDEX)).toBe(1);
    const play = new Play(engine, host);
    play.run(VILLAGE_STEPS);
    expectVillageDone(engine);
    expect(play.log.steps).toBe(VILLAGE_STEPS.length);
    // Les barmen ont tourné pendant ce temps sans erreur : la journalisation n'a rien de non porté.
    expect(engine.journal.lines.filter((l) => /non port/.test(l) && /\(L3\)/.test(l))).toEqual([]);
    // Les bulles montrent les noms substitués (le journal ne garde plus « Hey, , attendez! » du texte brut).
    const text = play.log.dialogs.join("\n");
    expect(text).toContain("Hey, Etranger, attendez!");
    expect(text).not.toMatch(/(^|<[^>]*: ), /m);
  }, 120_000);

  it("la même, avec une sauvegarde et une reprise (moteur neuf, vrai JSON) à chaque étape", () => {
    let { engine, host } = makeEngine();
    startVillage(engine);
    let play = new Play(engine, host);
    let resumes = 0;
    VILLAGE_STEPS.forEach((step, i) => {
      try {
        play.run([step]);
      } catch (e) {
        throw new Error(`étape ${i} ${JSON.stringify(step)} : ${(e as Error).message} (pièce ${engine.room.roomNumber}, curseur ${engine.room.cursorState}, dialogue ${engine.world.talkState}, occupé ${engine.busy})`);
      }
      play.settle();
      const save = captureSave(engine);
      if (!save) return; // un dialogue ou une séquence est encore en cours : pas de sauvegarde à cette étape (comme dans le jeu)
      const parsed = parseSave(JSON.parse(JSON.stringify(save)));
      expect(parsed, `étape ${i}`).not.toBeNull();
      const next = makeEngine();
      expect(restoreSave(next.engine, parsed!), `étape ${i}`).toBe(true);
      engine = next.engine;
      host = next.host;
      play = new Play(engine, host);
      resumes++;
    });
    expect(resumes).toBeGreaterThan(VILLAGE_STEPS.length / 2);
    expectVillageDone(engine);
  }, 240_000);

  it("les barmen sont à leur poste et servent quand on les sert, dans la partie jouée", () => {
    const { engine } = makeEngine();
    startVillage(engine);
    for (const id of [HotspotId.SID, HotspotId.NELLIE, HotspotId.EWAN]) {
      const h = engine.world.requireHotspot(id);
      expect(h.tickProcId).toBe(24);
    }
  });
});
