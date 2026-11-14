import { describe, expect, it } from "vitest";
import { MouseButton } from "../../../src/games/bass/engine/host";
import { CompactField as F } from "../../../src/games/bass/data/compact-fields";
import { Cpt, SF, Var } from "../../../src/games/bass/engine/ids";
import { parseSave, saveRefusal, type SaveData } from "../../../src/games/bass/engine/save";
import type { BassSound } from "../../../src/games/bass/engine/services";
import { TraceRecorder } from "../../../src/games/bass/engine/trace";
import { MemoryStorage, prefixedStorage } from "../../../src/engine/storage";
import { SAVE_PREFIX, createSaveSlots, describeSave, loadFromSlot, resultMessage, saveToSlot, summarizeSlots } from "../../../src/games/bass/ui/saves";
import { type Controlled, fingerprint, hasOriginalFiles, makeControlled, normalizeTrace } from "./harness";

/** Moteur au départ de la partie, avec sa trace. */
function start(): Controlled & { trace: TraceRecorder } {
  const trace = new TraceRecorder(1);
  const game = makeControlled({ trace });
  game.engine.startAfterIntro();
  return { ...game, trace };
}

/** Clic pour marcher (`b-start.txt`) : Foster est en marche quelques tours plus tard. */
function walking(): Controlled & { trace: TraceRecorder } {
  const game = start();
  game.push({ type: "move", x: 160, y: 100 });
  game.cycles(119);
  game.push({ type: "click", x: 200, y: 150, button: MouseButton.Left });
  game.cycles(30);
  return game;
}

/** Foster regarde la barre et parle (`talk-barre`) : la réplique dure du tour 86 au tour 113. */
function talking(): Controlled & { trace: TraceRecorder } {
  const game = start();
  game.push({ type: "move", x: 160, y: 100 });
  game.cycles(33);
  game.push({ type: "move", x: 17, y: 70 });
  game.cycles(9);
  game.push({ type: "click", x: 17, y: 70, button: MouseButton.Left });
  game.cycles(60);
  return game;
}

/** Sauvegarde `a`, la reprend dans un moteur neuf `b`, puis les fait jouer `more` tours : mêmes traces, même état. */
function roundTrip(a: Controlled & { trace: TraceRecorder }, more: number, options: { withText?: boolean } = {}): { a: Controlled; b: Controlled } {
  const save = a.control.capture();
  if (typeof save === "string") throw new Error(`sauvegarde refusée : ${save}`);
  const savedLines = a.trace.lines.length;
  const b = start();
  const traceB = b.trace;
  const loaded = b.control.load(JSON.parse(JSON.stringify(save)) as SaveData);
  expect(loaded).toBe(true);
  traceB.lines.length = 0;
  // Au moment de la sauvegarde l'état est celui de a ; le moteur restitué doit l'avoir.
  expect(fingerprint(b.engine, options.withText ?? true)).toBe(fingerprint(a.engine, options.withText ?? true));
  a.cycles(more);
  b.cycles(more);
  expect(normalizeTrace(traceB.lines)).toEqual(normalizeTrace(a.trace.lines.slice(savedLines)));
  expect(fingerprint(b.engine, options.withText ?? true)).toBe(fingerprint(a.engine, options.withText ?? true));
  return { a, b };
}

describe.skipIf(!hasOriginalFiles)("sauvegarde : aller-retour exact", () => {
  it("au départ de la partie", () => {
    const a = start();
    a.cycles(12);
    roundTrip(a, 60);
  });

  it("en pleine marche : la suite est la même, tour pour tour", () => {
    const a = walking();
    expect(a.engine.compacts.require(3)[0]).toBeGreaterThan(0);
    roundTrip(a, 120);
  });

  it("pendant un dialogue : la suite est la même (le texte à l'écran est effacé, comme dans ScummVM)", () => {
    const a = talking();
    const liveTexts = (g: Controlled): number[] => [...Array(11).keys()].map((i) => Cpt.TEXT_1 + i).filter((id) => g.engine.compacts.require(id)[F.status] !== 0);
    expect(liveTexts(a).length).toBeGreaterThan(0); // une réplique est bien affichée au moment de la sauvegarde
    roundTrip(a, 80, { withText: false });
  });

  it("le JSON passe par les emplacements du site : dix emplacements, description, version", () => {
    const a = walking();
    const slots = createSaveSlots(prefixedStorage(new MemoryStorage(), SAVE_PREFIX));
    expect(saveToSlot(a.control, slots, 3, Date.UTC(2026, 10, 14, 12, 30))).toBe("saved");
    const summaries = summarizeSlots(slots);
    expect(summaries).toHaveLength(10);
    expect(summaries[2]!.empty).toBe(false);
    expect(summaries[0]!.empty).toBe(true);
    const stored = slots.read(3)!;
    expect(describeSave(stored)).toMatch(/^Section \d – /);
    expect(parseSave(JSON.parse(JSON.stringify(stored.save)))).not.toBeNull();
    const b = start();
    expect(loadFromSlot(b.control, slots, 3)).toBe("loaded");
    expect(loadFromSlot(b.control, slots, 4)).toBe("empty");
    expect(fingerprint(b.engine)).toBe(fingerprint(a.engine));
    expect(resultMessage("loaded", "load")).toMatch(/chargée/);
  });

  it("une sauvegarde d'une autre version ou abîmée est un emplacement vide", () => {
    const a = walking();
    const store = prefixedStorage(new MemoryStorage(), SAVE_PREFIX);
    const slots = createSaveSlots(store);
    saveToSlot(a.control, slots, 1, 1000);
    const stored = JSON.parse(store.get("slot01")!) as { savedAt: number; save: SaveData };
    store.set("slot02", JSON.stringify({ ...stored, save: { ...stored.save, version: 2 } }));
    store.set("slot03", JSON.stringify({ ...stored, save: { ...stored.save, data: "???" } }));
    expect(slots.read(2)).toBeNull();
    expect(slots.read(3)).toBeNull();
    // Des données lisibles mais d'une autre taille de compacts : refusées avant toute modification.
    const b = start();
    const before = fingerprint(b.engine);
    expect(b.control.load({ ...stored.save, data: stored.save.data.slice(0, 400) })).toBe(false);
    expect(fingerprint(b.engine)).toBe(before);
  });
});

describe.skipIf(!hasOriginalFiles)("sauvegarde : refus", () => {
  it("refusée pendant un choix de réponse (SF_CHOOSING), dans LINC et dans les dernières pièces", () => {
    const a = start();
    a.cycles(3);
    expect(typeof a.control.capture()).toBe("object");
    a.engine.system.systemFlags |= SF.CHOOSING;
    expect(a.control.capture()).toBe("choosing");
    a.engine.system.systemFlags &= ~SF.CHOOSING;
    a.engine.vars[Var.SCREEN] = 101;
    expect(a.control.capture()).toBe("linc");
    for (const [screen, refused] of [[81, false], [82, true], [85, false], [89, true], [90, false]] as const) {
      a.engine.vars[Var.SCREEN] = screen;
      expect(saveRefusal(a.engine as never) !== null).toBe(refused);
    }
  });

  it("refusée pendant un effet bloquant (tour en cours)", () => {
    const a = start();
    // Un fondu est en cours dès le départ de la partie ou à la première pièce : on avance jusqu'au premier tour bloqué.
    let blocked = false;
    for (let i = 0; i < 4000 && !blocked; i++) {
      a.tick();
      blocked = a.engine.blocked;
    }
    if (blocked) expect(a.control.capture()).toBe("busy");
  });
});

/** Son qui note ce que la sauvegarde lui demande (effets, musique, rechargement de section après restitution). */
class SpySound implements BassSound {
  readonly restored: [number, number][] = [];
  readonly music: number[] = [];
  readonly sections: [number, boolean | undefined][] = [];
  readonly sfx = {
    savedSounds: [0x0502, 0xffff] as [number, number],
    restoreState: (saved: readonly [number, number]) => {
      this.restored.push([saved[0], saved[1]]);
    },
  };
  loadSection(section: number, gameRestored?: boolean): void {
    this.sections.push([section, gameRestored]);
  }
  startMusic(music: number): void {
    this.music.push(music);
  }
  startFx(): void {}
  stopFx(): void {}
  pauseFx(): void {}
  unPauseFx(): void {}
  checkFxQueue(): void {}
  startSpeech(): boolean {
    return false;
  }
  speechFinished(): boolean {
    return true;
  }
  stopSpeech(): void {}
}

describe.skipIf(!hasOriginalFiles)("sauvegarde : son", () => {
  it("garde les deux effets en cours et la musique ; la restitution les remet et recharge la section en le disant", () => {
    const a = makeControlled({ sound: new SpySound() });
    a.engine.startAfterIntro();
    a.cycles(5);
    a.engine.system.currentMusic = 7;
    const save = a.control.capture();
    if (typeof save === "string") throw new Error(save);
    const b = makeControlled({ sound: new SpySound() });
    b.engine.startAfterIntro();
    const sound = b.engine.sound as SpySound;
    sound.sections.length = 0;
    sound.music.length = 0;
    sound.restored.length = 0;
    expect(b.control.load(save)).toBe(true);
    expect(sound.restored).toEqual([[0x0502, 0xffff]]);
    expect(sound.music).toEqual([7]);
    expect(b.engine.system.currentMusic).toBe(7);
    expect(sound.sections).toHaveLength(1);
    expect(sound.sections[0]![1]).toBe(true); // SF_GAME_RESTORED : la file des effets est gardée
    expect(b.engine.system.systemFlags & SF.GAME_RESTORED).toBe(0);
  });

  it("musique coupée (SF_MUS_OFF) : la restitution ne la relance pas", () => {
    const a = makeControlled({ sound: new SpySound() });
    a.engine.startAfterIntro();
    const save = a.control.capture();
    if (typeof save === "string") throw new Error(save);
    const b = makeControlled({ sound: new SpySound() });
    b.engine.startAfterIntro();
    b.engine.system.systemFlags |= SF.MUS_OFF;
    (b.engine.sound as SpySound).music.length = 0;
    b.control.load(save);
    expect((b.engine.sound as SpySound).music).toEqual([]);
  });
});
