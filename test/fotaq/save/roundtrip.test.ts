import { describe, expect, it } from "vitest";
import { Outfit } from "../../../src/games/fotaq/engine/services";
import { saveToSlot } from "../../../src/games/fotaq/ui/saves";
import { hasOriginalFiles } from "../helpers";
import { FULL_GAME_START, PLAY_ORDER } from "../solutions";
import { CheckpointWalkthrough, type Swap } from "./checkpoint";

/** Un écran de jeu : 320 x 150 pixels. */
const ROOM_PIXELS = 320 * 150;
/** Pièces d'arrivée de chaque passage de la partie complète (`test/fotaq/full-game.test.ts`). */
const ARRIVALS = ["6a:70", "4a:75", "5a:1", "1a-1c:17", "2a:22", "1d:17", "3a+4b:41", "2b:21", "4c:69", "5b+6c:110"];

/** Joue la partie complète avec une bascule vers un moteur neuf aux repos choisis par `when`. */
function playWithSwaps(
  when: (rest: number, indexInPassage: number, w: CheckpointWalkthrough) => boolean,
  observe?: (w: CheckpointWalkthrough) => void,
) {
  const w = new CheckpointWalkthrough({ ...FULL_GAME_START });
  let firstOfPassage = 0;
  w.when = (rest, index, walk) => when(rest, index - firstOfPassage, walk);
  if (observe) w.observers.push(() => observe(w));
  const arrivals: string[] = [];
  const perPassage: number[] = [];
  for (const passage of PLAY_ORDER) {
    const before = w.swaps.length;
    firstOfPassage = w.savable.length;
    try {
      passage.play(w);
    } catch (error) {
      throw new Error(`passage ${passage.id} (${passage.what}), après ${w.swaps.length} bascules : ${(error as Error).message}`);
    }
    arrivals.push(`${passage.id}:${w.room}`);
    perPassage.push(w.swaps.length - before);
    expect(w.engine.warnings, `avertissements du moteur après ${passage.id}`).toEqual([]);
  }
  return { w, arrivals, perPassage };
}

describe.skipIf(!hasOriginalFiles)("sauvegardes : aller-retour pendant la partie complète", () => {
  it("sauvegarder, recharger dans un moteur neuf, comparer l'état et l'image, finir la partie : au début de chaque passage et un repos sur deux", () => {
    // Les trois premiers repos de chaque passage (son début : un passage reprend là où le précédent finit), puis un sur deux.
    const { w, arrivals, perPassage } = playWithSwaps((_rest, index) => index < 3 || index % 2 === 0);
    // Un moteur neuf à chaque bascule, et la partie va jusqu'au bout comme sans sauvegarde.
    expect(arrivals).toEqual(ARRIVALS);
    expect(w.engine.ended).toBe(true);
    expect(w.host.exits).toBe(1);
    expect(w.talk.warnings).toEqual([]);

    // Plusieurs repos à l'intérieur de chaque passage (l'introduction et le crash n'ont aucun repos : tout s'y joue en cinématique ou en dialogue).
    const withRests = PLAY_ORDER.map((passage, i) => ({ id: passage.id, swaps: perPassage[i] })).filter((p) => !["6a", "5a"].includes(p.id));
    for (const { id, swaps } of withRests) expect(swaps, `passage ${id}`).toBeGreaterThanOrEqual(2);
    expect(w.swaps.length).toBeGreaterThan(150);

    // L'état repris est exactement celui qui a été sauvegardé, à chaque bascule.
    expect(w.swaps.filter((s) => s.differences.length > 0).map((s) => `repos ${s.rest} (pièce ${s.room}) : ${s.differences.join(" ; ")}`)).toEqual([]);

    // L'image : identique, sauf des restes de cinématiques et de répliques que la reprise n'a pas (voir `engine.md` § 12) : au plus
    // quelques pour cent de l'écran, et presque toujours rien.
    const different = w.swaps.filter((s) => s.pixelDiff > 0);
    expect(different.length / w.swaps.length).toBeLessThan(0.1);
    expect(Math.max(...w.swaps.map((s) => s.pixelDiff)) / ROOM_PIXELS).toBeLessThan(0.04);

    // La tenue, la lumière et le dernier morceau sont repris, et une sauvegarde de dix emplacements tient dans le stockage du navigateur.
    expect(w.swaps.every((s) => s.stageOutfit === s.outfit && s.dark === s.save.lightsOff && s.lastSong === s.save.lastSong)).toBe(true);
    expect(Math.max(...w.swaps.map((s) => s.bytes)) * 10).toBeLessThan(1_000_000);
    const kinds = (test: (s: Swap) => boolean) => w.swaps.filter(test).length;
    expect(kinds((s) => s.outfit === Outfit.Dress), "des reprises en robe").toBeGreaterThan(0);
    expect(kinds((s) => s.save.lastSong > 0), "des reprises avec de la musique").toBeGreaterThan(0);
  }, 300_000);

  it("refuse de sauvegarder pendant une cinématique, un dialogue, une réplique ou une marche, et ne touche pas à l'emplacement", () => {
    const seen = { cutscene: 0, dialogue: 0, busy: 0 };
    let probes = 0;
    const { w } = playWithSwaps(
      () => false,
      (walk) => {
        const { engine } = walk;
        if (!engine.busy && !engine.input.cutawayRunning) return;
        const kind = engine.input.cutawayRunning ? "cutscene" : engine.input.dialogueRunning ? "dialogue" : "busy";
        seen[kind]++;
        expect(engine.canSave, kind).toBe(false);
        expect(engine.saveGame(), kind).toBeNull();
        if (probes++ % 50 === 0) {
          expect(saveToSlot(engine, walk.slots, 2, 0), kind).toBe("busy");
          expect(walk.slots.read(2)).toBeNull();
        }
      },
    );
    expect(w.engine.ended).toBe(true);
    expect(seen.cutscene).toBeGreaterThan(1000);
    expect(seen.dialogue).toBeGreaterThan(100);
    expect(seen.busy).toBeGreaterThan(1000);
  }, 300_000);
});
