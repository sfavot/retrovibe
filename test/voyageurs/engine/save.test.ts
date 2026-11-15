import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { VoyageursEngine } from "../../../src/games/voyageurs/engine/game";
import { MemoryStorage, prefixedStorage } from "../../../src/engine/storage";
import { parseSave, SAVE_SLOT_COUNT, type VoyageursSave, voyageursSaveSlots } from "../../../src/games/voyageurs/engine/save";
import { readFont } from "../../../src/games/voyageurs/data/font";
import { FwRenderer } from "../../../src/games/voyageurs/render/renderer";
import { readOriginal } from "../data/helpers";
import { type BenchInput, hasOriginalFiles, makeEngine, parseBenchInputs } from "./helpers";

function inputs(name: string): BenchInput[] {
  return parseBenchInputs(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8"));
}

/** Moteur piloté comme `replay` (entrées du banc), mais arrêtable puis reprenable. */
function driven(queue: BenchInput[], lines: string[]) {
  let engine: VoyageursEngine | null = null;
  const onModalPoll = () => {
    while (engine && queue.length && queue[0]!.tick <= engine.ticks + 1) {
      const next = queue.shift()!;
      engine.input(...next.inputs);
      if (next.op !== "m") break;
    }
  };
  const made = makeEngine({ trace: (line) => lines.push(line), traceOps: true, onModalPoll });
  engine = made.engine;
  const e = engine;
  return {
    engine: e,
    queue,
    /** Avance jusqu'à la fin du tick `tick`, avant la livraison des entrées du suivant. */
    runTo(tick: number): void {
      let guard = 0;
      while (!(e.ticks >= tick && e.betweenTicks)) {
        if (e.betweenTicks) while (queue.length && queue[0]!.tick <= e.ticks + 1) e.input(...queue.shift()!.inputs);
        e.step();
        if (++guard > (tick + 10) * 400) throw new Error(`rejeu bloqué au tick ${e.ticks}`);
      }
    },
  };
}

/** Numéro de tick d'une ligne `TK`, `OP` ou `MW`. */
const tickOf = (line: string): number => Number(line.split(" ")[1]);

describe.skipIf(!hasOriginalFiles)("sauvegarde sur les vrais fichiers", () => {
  const SAVE_TICKS = [450, 462, 475, 500, 530];
  const LENGTH = 50;

  it("sauver, passer par JSON, restaurer dans un moteur neuf : mêmes traces (TK et OP) que la partie ininterrompue", () => {
    const lines: string[] = [];
    const original = driven(inputs("intro-first-scene.inputs"), lines);
    // Le moteur original ne s'arrête pas : on prend des sauvegardes au passage, avec les entrées restant à livrer.
    const taken: { tick: number; save: VoyageursSave; rest: BenchInput[] }[] = [];
    for (const tick of SAVE_TICKS) {
      original.runTo(tick);
      expect(original.engine.canSave(), `canSave au tick ${tick}`).toBe(true);
      const save = original.engine.save()!;
      expect(save).not.toBeNull();
      // Entrées pas encore livrées à ce moment.
      taken.push({ tick, save: JSON.parse(JSON.stringify(save)) as VoyageursSave, rest: [...original.queue] });
    }
    original.runTo(SAVE_TICKS[SAVE_TICKS.length - 1]! + LENGTH);

    for (const { tick, save, rest } of taken) {
      expect(parseSave(save)).not.toBeNull();
      const restoredLines: string[] = [];
      const restored = driven(rest, restoredLines);
      restored.engine.load(save);
      expect(restored.engine.ticks).toBe(tick);
      // Ré-enregistrer juste après la reprise donne la même sauvegarde (tout ce qui est sauvé a été restauré).
      expect(JSON.parse(JSON.stringify(restored.engine.save()))).toEqual(save);
      restored.runTo(tick + LENGTH);
      const expected = lines.filter((l) => tickOf(l) > tick && tickOf(l) <= tick + LENGTH);
      const got = restoredLines.filter((l) => tickOf(l) > tick && tickOf(l) <= tick + LENGTH);
      expect(expected.filter((l) => l.startsWith("TK"))).toHaveLength(LENGTH);
      expect(got).toEqual(expected);
    }
  });

  it("la reprise recharge les sprites dans les mêmes emplacements, avec les mêmes données", () => {
    const original = driven(inputs("intro-first-scene.inputs"), []);
    original.runTo(500);
    const save = original.engine.save()!;
    expect(save.anims.length).toBeGreaterThan(0);
    const restored = driven([], []);
    restored.engine.load(JSON.parse(JSON.stringify(save)));
    const a = original.engine.state.anims;
    const b = restored.engine.state.anims;
    expect(b.map((s) => s && s.resource + s.frameIdx)).toEqual(a.map((s) => s && s.resource + s.frameIdx));
    for (let i = 0; i < a.length; i++) {
      expect(b[i]?.data).toEqual(a[i]?.data);
      expect(b[i]?.mask).toEqual(a[i]?.mask);
    }
    expect(restored.engine.state.collision).toEqual(original.engine.state.collision);
    expect(restored.engine.state.messages).toEqual(original.engine.state.messages);
    expect(restored.engine.describe()).toEqual(original.engine.describe());
    expect(restored.engine.describe().bg).not.toBe("");
  });

  it("garde les palettes (transformPalette, rotatePalette) : même palette à l'écran au premier dessin après la reprise", () => {
    const font = readFont(readOriginal("TEXTE.DAT"));
    const renderer = new FwRenderer(font);
    const queue = inputs("intro-first-scene.inputs");
    const lines: string[] = [];
    let engine: VoyageursEngine | null = null;
    const onModalPoll = () => {
      while (engine && queue.length && queue[0]!.tick <= engine.ticks + 1) {
        const next = queue.shift()!;
        engine.input(...next.inputs);
        if (next.op !== "m") break;
      }
    };
    engine = makeEngine({ renderer, trace: (l) => lines.push(l), onModalPoll }).engine;
    const e = engine;
    while (!(e.ticks >= 450 && e.betweenTicks)) {
      if (e.betweenTicks) while (queue.length && queue[0]!.tick <= e.ticks + 1) e.input(...queue.shift()!.inputs);
      e.step();
    }
    renderer.transformPalette(2, 9, 1, -2, 3);
    renderer.rotatePalette(0, 5, 1);
    const save = JSON.parse(JSON.stringify(e.save())) as VoyageursSave;
    expect(save.palettes.active).toEqual(Array.from(renderer.palettes.active));
    expect(save.palettes.backup).toEqual(Array.from(renderer.palettes.backup));
    expect(parseSave(save)).not.toBeNull();
    expect(parseSave({ ...save, palettes: { ...save.palettes, active: save.palettes.active.map(() => 8) } })).toBeNull();

    const other = new FwRenderer(font);
    const restored = makeEngine({ renderer: other }).engine;
    restored.load(save);
    expect(other.getPalettes()).toEqual(save.palettes);
    e.runTick();
    restored.runTick();
    expect(Array.from(other.screenPalette)).toEqual(Array.from(renderer.screenPalette));
    expect(Array.from(other.screenPalette)).toEqual(save.palettes.active);
  });

  it("refuse de sauvegarder pendant un message, entrées bloquées, menu système désactivé ou menu ouvert", () => {
    // Premier message de l'intro, sans entrée : le moteur attend un clic (attente modale).
    const waiting = makeEngine().engine;
    let guard = 0;
    while (waiting.modal === null && ++guard < 100_000) waiting.step();
    expect(waiting.modal).not.toBeNull();
    expect(waiting.canSave()).toBe(false);
    expect(waiting.save()).toBeNull();

    const original = driven(inputs("intro-first-scene.inputs"), []);
    const { engine } = original;
    original.runTo(450);
    const { state } = engine;
    expect(engine.canSave()).toBe(true);
    state.waitForPlayerClick = 1;
    expect(engine.saveRefusal()).toBe("message");
    state.waitForPlayerClick = 0;
    state.overlays.push({ objIdx: 0, type: 2, x: 0, y: 0, width: 0, color: 0 });
    expect(engine.saveRefusal()).toBe("message");
    state.overlays.pop();
    state.allowPlayerInput = 0;
    expect(engine.saveRefusal()).toBe("input");
    state.allowPlayerInput = 1;
    state.disableSystemMenu = 1;
    expect(engine.saveRefusal()).toBe("systemMenu");
    state.disableSystemMenu = 0;
    engine.inMenu = true;
    expect(engine.saveRefusal()).toBe("menu");
    engine.inMenu = false;
    expect(engine.canSave()).toBe(true);
  });
});

describe("format de la sauvegarde", () => {
  it("parseSave refuse tout ce qui n'est pas une sauvegarde de la version 1", () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave("x")).toBeNull();
    expect(parseSave({})).toBeNull();
    expect(parseSave({ version: 2 })).toBeNull();
  });

  it.skipIf(!hasOriginalFiles)("passe par les emplacements du site (10, préfixe voyageurs:) et une sauvegarde tronquée vaut emplacement vide", () => {
    const original = driven(inputs("intro-first-scene.inputs"), []);
    original.runTo(500);
    const save = original.engine.save()!;
    const store = new MemoryStorage();
    const slots = voyageursSaveSlots(prefixedStorage(store, "voyageurs:"));
    expect(slots.count).toBe(SAVE_SLOT_COUNT);
    expect(slots.write(3, save, 1_700_000_000_000)).toBe(true);
    expect(slots.read(3)?.save).toEqual(save);
    expect(slots.read(4)).toBeNull();
    const broken = { ...JSON.parse(JSON.stringify(save)), globals: [1, 2, 3] };
    expect(parseSave(broken)).toBeNull();
  });
});
