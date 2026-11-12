import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../../src/engine/storage";
import { gameTextToUnicode } from "../../../src/games/lure/data/charset";
import type { LureEngine } from "../../../src/games/lure/engine/game";
import type { Hotspot } from "../../../src/games/lure/engine/hotspot";
import { CharacterMode, HotspotId } from "../../../src/games/lure/engine/ids";
import { LureMovement } from "../../../src/games/lure/engine/movement";
import { ORIGINAL_PATHFIND_COUNTDOWN } from "../../../src/games/lure/engine/pathfinder";
import {
  HOTSPOT_DERIVED,
  HOTSPOT_FLAGS,
  HOTSPOT_NUMBERS,
  SAVE_VERSION,
  type SaveData,
  canSave,
  captureSave,
  parseSave,
  restoreSave,
} from "../../../src/games/lure/engine/save";
import { SilentSound } from "../../../src/games/lure/engine/services";
import { createSaveSlots, describeSave, loadFromSlot, placeOf, saveToSlot, summarizeSlots } from "../../../src/games/lure/ui/saves";
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

/** Capture, aller-retour par du vrai JSON (ce que fait un emplacement), puis lecture validée. */
function snapshot(engine: LureEngine): SaveData {
  const save = captureSave(engine);
  expect(save).not.toBeNull();
  const parsed = parseSave(JSON.parse(JSON.stringify(save)));
  expect(parsed).toEqual(save);
  return parsed!;
}

/** Un moteur neuf qui reprend `save` (sans avoir tourné une seule image). */
function resumed(save: SaveData, options: Parameters<typeof makeEngine>[0] = {}, pointer?: LureEngine): { engine: LureEngine; host: TestHost } {
  const { engine, host } = makeEngine(options);
  expect(restoreSave(engine, save)).toBe(true);
  // Le pointeur n'est pas dans la sauvegarde : c'est celui de la souris, que l'hôte rend au moteur (ici, celui du témoin).
  if (pointer) {
    Object.assign(engine.mouse, pointer.mouse);
    engine.room.mouseX = pointer.mouse.x;
    engine.room.mouseY = pointer.mouse.y;
  }
  return { engine, host };
}

/** L'état complet, tel que la sauvegarde le voit (une image où la sauvegarde est refusée est comparée comme telle). */
const full = (engine: LureEngine): string => JSON.stringify(captureSave(engine));

/** Chemin de la première différence entre deux valeurs JSON (message d'échec lisible). */
function firstDiff(a: unknown, b: unknown, path = ""): string | null {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return Object.is(a, b) ? null : `${path} : ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const diff = firstDiff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}/${key}`);
    if (diff) return diff;
  }
  return null;
}

/** Fait tourner le témoin et le moteur repris `images` images en comparant leur état complet toutes les `every` images. */
function expectSameRun(witness: LureEngine, resumedEngine: LureEngine, images: number, every = 25): void {
  for (let i = 0; i < images; i++) {
    step(witness);
    step(resumedEngine);
    if (i % every === 0) expect(firstDiff(captureSave(resumedEngine), captureSave(witness)), `image ${i}`).toBeNull();
  }
  expect(resumedEngine.rng.state).toBe(witness.rng.state);
  expect(full(resumedEngine)).toBe(full(witness));
}

describe.skipIf(!hasOriginalFiles)("sauvegarde : aller-retour", () => {
  it("la cellule du début : l'état capturé, repris dans un moteur neuf puis recapturé, est le même", () => {
    const { engine, host } = makeEngine();
    const d = new Driver(engine, host);
    d.ticks(5);
    const save = snapshot(engine);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.room).toBe(1);
    expect(save.roomName).not.toBe("");
    expect(save.active.some((a) => a.values.hotspotId === HotspotId.PLAYER)).toBe(true);

    const other = resumed(save);
    expect(snapshot(other.engine)).toEqual(save);
    expect(other.engine.room.roomNumber).toBe(1);
    expect(other.engine.world.activeHotspots.map((h) => h.hotspotId)).toEqual(engine.world.activeHotspots.map((h) => h.hotspotId));
  });

  it("une sauvegarde reprise dans un moteur déjà en jeu efface ce qui n'y était pas", () => {
    const a = makeEngine();
    new Driver(a.engine, a.host).ticks(3);
    const early = snapshot(a.engine);
    // Le même moteur joue : le joueur marche, le hasard avance, une porte se joue.
    const d = new Driver(a.engine, a.host);
    d.click(200, 170);
    d.ticks(60);
    expect(full(a.engine)).not.toBe(JSON.stringify(early));
    expect(restoreSave(a.engine, early)).toBe(true);
    expect(snapshot(a.engine)).toEqual(early);
  });

  it("une bulle de parole (hotspot dynamique) est reprise avec son personnage", () => {
    const { engine, host } = makeEngine();
    new Driver(engine, host).ticks(3);
    engine.world.setTalkingCharacter(HotspotId.PLAYER);
    const bubble = engine.world.activeHotspots.find((h) => h.data === null);
    expect(bubble).toBeDefined();
    const save = snapshot(engine);
    expect(save.active.some((a) => a.special)).toBe(true);
    const other = resumed(save);
    expect(other.engine.world.activeHotspots.filter((h) => h.data === null)).toHaveLength(1);
    expect(snapshot(other.engine)).toEqual(save);
    expectSameRun(engine, other.engine, 100);
  });

  it("toute propriété d'un hotspot d'exécution est sauvegardée ou déduite (rien d'oublié)", () => {
    const { engine, host } = makeEngine();
    new Driver(engine, host).ticks(3);
    engine.world.setTalkingCharacter(HotspotId.PLAYER);
    const known = new Set<string>([...HOTSPOT_NUMBERS, ...HOTSPOT_FLAGS, ...HOTSPOT_DERIVED]);
    for (const h of engine.world.activeHotspots) {
      for (const key of Object.keys(h)) expect(known.has(key), `propriété « ${key} » de Hotspot ni sauvegardée ni déduite`).toBe(true);
    }
  });

  it("le titre de la pièce sert de description (avec la date), « Pièce N » sinon", () => {
    const { engine, host } = makeEngine();
    new Driver(engine, host).ticks(3);
    const save = snapshot(engine);
    const text = describeSave({ savedAt: Date.UTC(2026, 10, 12, 10, 30), save });
    // `roomName` porte toute la description de la pièce : la ligne n'en garde que le titre en capitales (`placeOf`).
    expect(text.startsWith(placeOf(save))).toBe(true);
    expect(save.roomName.startsWith(placeOf(save))).toBe(true);
    expect(text).toContain("2026");
    expect(describeSave({ savedAt: 0, save: { ...save, roomName: "" } }).startsWith("Pièce 1")).toBe(true);
    // Le nom est celui du texte de la pièce, en Unicode.
    const room = engine.room.roomData!;
    expect(save.roomName).toBe(gameTextToUnicode(engine.text(room.data.descId)).trim());
  });
});

describe.skipIf(!hasOriginalFiles)("sauvegarde : reprise exacte", () => {
  /** Deux moteurs identiques au village, PNJ activés, le joueur dans la pièce 10. */
  function village(options: Parameters<typeof makeEngine>[0] = {}): LureEngine {
    const { engine } = makeEngine(options);
    engine.tick();
    enterRoom(engine, 10, 150, 168);
    for (const id of VILLAGERS) engine.world.activateHotspot(id);
    return engine;
  }

  it("en pleine marche de Diermot : le moteur repris suit la même suite d'états et de hasard que le témoin", () => {
    const witness = village();
    const driver = new Driver(witness, witness.host as TestHost);
    driver.click(60, 160);
    const player = witness.world.requireActiveHotspot(HotspotId.PLAYER);
    let t = 0;
    for (; t < 200 && player.pathFinder.list.length === 0; t++) step(witness);
    for (let i = 0; i < 4; i++) step(witness);
    expect(player.pathFinder.list.length).toBeGreaterThan(0);
    const frame = player.frameNumber;
    const save = snapshot(witness);

    const other = resumed(save, {}, witness);
    const copy = other.engine.world.requireActiveHotspot(HotspotId.PLAYER);
    expect(copy.pathFinder).toEqual(player.pathFinder);
    expect(copy.frameNumber).toBe(frame);
    expect(canSave(other.engine)).toBe(true);
    expectSameRun(witness, other.engine, 3 * MINUTE);
  });

  it("en pleine recherche de chemin découpée (budget de l'exécutable d'origine) : la recherche reprend où elle en était", () => {
    const options = { movement: (ctx: ConstructorParameters<typeof LureMovement>[0]) => new LureMovement(ctx, ORIGINAL_PATHFIND_COUNTDOWN) };
    const witness = village(options);
    new Driver(witness, witness.host as TestHost).click(60, 160);
    const searching = () => witness.world.activeHotspots.some((h) => h.pathFinder.inProgress);
    for (let t = 0; t < 2000 && !searching(); t++) step(witness);
    expect(searching()).toBe(true);
    const save = snapshot(witness);
    expect(save.active.some((a) => a.pathFinder.inProgress)).toBe(true);

    const other = resumed(save, options, witness);
    expectSameRun(witness, other.engine, 3 * MINUTE);
  });

  it("pendant un trajet de PNJ hors écran dans le village : même suite pendant quelques minutes de jeu", () => {
    const witness = village();
    const offscreen = () =>
      VILLAGERS.some((id) => {
        const h = witness.world.requireActiveHotspot(id);
        return h.roomNumber !== 10 && h.pathFinder.list.length > 0;
      });
    let t = 0;
    for (; t < 6 * MINUTE && !offscreen(); t++) step(witness);
    expect(offscreen()).toBe(true);
    const save = snapshot(witness);
    expect(save.rng).toBe(witness.rng.state);

    const other = resumed(save, {}, witness);
    expectSameRun(witness, other.engine, 5 * MINUTE, 50);
  });

  it("deux PNJ qui se croisent : la liste d'attente (`pausedList`) est reprise, la même suite s'ensuit", () => {
    const { engine } = makeEngine();
    engine.tick();
    enterRoom(engine, 10, 293, 152);
    const gwen = engine.world.activateHotspot(HotspotId.GWEN)!;
    const mallin = engine.world.activateHotspot(HotspotId.MALLIN)!;
    place(gwen, 10, 37, 120);
    place(mallin, 10, 229, 120);
    gwen.walkTo(229, 168);
    mallin.walkTo(37, 168);
    for (let t = 0; t < 300 && engine.world.state.pausedList.length === 0; t++) step(engine);
    expect(engine.world.state.pausedList.length).toBeGreaterThan(0);
    const save = snapshot(engine);
    expect(save.pausedList).toEqual(engine.world.state.pausedList);
    const other = resumed(save, {}, engine);
    expect(other.engine.world.state.pausedList).toEqual(engine.world.state.pausedList);
    expectSameRun(engine, other.engine, MINUTE, 10);
  });

  it("Ratpouch (suiveur) : le compte à rebours de ses actions aléatoires est repris", () => {
    const { engine } = makeEngine();
    engine.tick();
    enterRoom(engine, 10, 150, 168);
    const ratpouch = engine.world.activateHotspot(HotspotId.RATPOUCH)!;
    for (let i = 0; i < 150; i++) step(engine);
    place(ratpouch, 10, 157, 128);
    enterRoom(engine, 11, 290, 135);
    let t = 0;
    for (; t < 1500 && !(ratpouch.roomNumber === 11 && ratpouch.followerCountdown > 0); t++) step(engine);
    expect(ratpouch.followerCountdown).toBeGreaterThan(0);
    const save = snapshot(engine);
    const other = resumed(save, {}, engine);
    expect(other.engine.world.requireActiveHotspot(HotspotId.RATPOUCH).followerCountdown).toBe(ratpouch.followerCountdown);
    expectSameRun(engine, other.engine, 2 * MINUTE);
  });

  it("une porte ouverte, un objet pris et l'horloge du jeu survivent à la reprise (champs, hotspots, pièces, portes)", () => {
    const { engine, host } = makeEngine();
    const d = new Driver(engine, host);
    d.ticks(2);
    d.click(200, 170);
    d.ticks(40);
    engine.world.fields.set(30, 7);
    engine.world.fields.numGroats = 12;
    engine.world.getExitJoin(0x2711)!.blocked = 0;
    engine.world.requireActiveHotspot(0x2711).layer = 0;
    engine.world.requireRoom(1).exitTime = 1234;
    const save = snapshot(engine);
    const other = resumed(save);
    expect(other.engine.world.fields.get(30)).toBe(7);
    expect(other.engine.world.fields.numGroats).toBe(12);
    expect(other.engine.world.getExitJoin(0x2711)!.blocked).toBe(0);
    expect(other.engine.world.requireHotspot(0x2711).layer).toBe(0);
    expect(other.engine.world.requireRoom(1).exitTime).toBe(1234);
    expect(other.engine.ticks).toBe(engine.ticks);
  });
});

describe.skipIf(!hasOriginalFiles)("sauvegarde : refus et emplacements", () => {
  it("refusée pendant une séquence (boîte de texte), acceptée une fois qu'elle est fermée", () => {
    const { engine, host } = makeEngine();
    const d = new Driver(engine, host);
    d.ticks(2);
    expect(canSave(engine)).toBe(true);
    const door = d.centerOf(0x2711);
    d.hover(door.x, door.y);
    d.click(door.x, door.y, "right");
    d.choose("Ouvre");
    d.untilDialog();
    expect(engine.busy).toBe(true);
    expect(canSave(engine)).toBe(false);
    expect(captureSave(engine)).toBeNull();

    const slots = createSaveSlots(new MemoryStorage());
    expect(saveToSlot(engine, slots, 1, 1000)).toBe("busy");
    expect(slots.read(1)).toBeNull();

    d.dismiss();
    d.ticks(2);
    expect(saveToSlot(engine, slots, 1, 1000)).toBe("saved");
  });

  it("refusée en vue à distance et pendant un combat, mais pas la reprise", () => {
    const { engine, host } = makeEngine({ fights: { isFighting: true, fightLoop() {}, reset() {} } });
    new Driver(engine, host).ticks(2);
    expect(canSave(engine)).toBe(false);

    const remote = makeEngine();
    new Driver(remote.engine, remote.host).ticks(2);
    remote.engine.world.fields.set(8, 5);
    expect(canSave(remote.engine)).toBe(false);
  });

  it("refusée quand une conversation commence et attend la fin d'une bulle (le dialogue actif n'est pas sauvegardé)", () => {
    // Vu en jouant le village avec une reprise à chaque étape : « Parle à » le Skorl de la mairie pendant qu'une bulle est affichée,
    // la sauvegarde était acceptée (talkState NONE) puis la reprise levait « gestionnaire de dialogue sans dialogue actif ».
    const { engine, host } = makeEngine();
    new Driver(engine, host).ticks(2);
    const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
    expect(canSave(engine)).toBe(true);
    player.setTickProc(37);
    expect(engine.world.talkState).toBe(0);
    expect(canSave(engine)).toBe(false);
    expect(captureSave(engine)).toBeNull();
  });

  it("emplacements : sauvegarder puis charger dans un moteur neuf, descriptions, dix emplacements", () => {
    const { engine, host } = makeEngine();
    new Driver(engine, host).ticks(5);
    const store = new MemoryStorage();
    const slots = createSaveSlots(store);
    expect(slots.count).toBe(10);
    expect(saveToSlot(engine, slots, 3, 5000)).toBe("saved");
    expect(saveToSlot(engine, slots, 11, 5000)).toBe("failed");
    expect([...store.data.keys()]).toEqual(["slot03"]);

    const summaries = summarizeSlots(slots);
    expect(summaries).toHaveLength(10);
    expect(summaries[2]!.empty).toBe(false);
    expect(summaries[2]!.description).toContain(placeOf(slots.read(3)!.save));
    expect(summaries[0]).toMatchObject({ empty: true, description: "Emplacement 1" });

    const other = makeEngine();
    expect(loadFromSlot(other.engine, slots, 3)).toBe("loaded");
    expect(full(other.engine)).toBe(full(engine));
    expect(loadFromSlot(other.engine, slots, 4)).toBe("empty");
  });

  it("une sauvegarde qui désigne une pièce ou un hotspot inconnu est refusée sans toucher au moteur", () => {
    const { engine, host } = makeEngine();
    new Driver(engine, host).ticks(5);
    const good = snapshot(engine);
    const other = makeEngine();
    new Driver(other.engine, other.host).ticks(9);
    const before = full(other.engine);
    expect(restoreSave(other.engine, { ...good, room: 9999 })).toBe(false);
    expect(restoreSave(other.engine, { ...good, hotspotData: [{ index: 99999, fields: {}, schedule: [] }] })).toBe(false);
    expect(restoreSave(other.engine, { ...good, active: [{ ...good.active[0]!, original: 0x3 }] })).toBe(false);
    expect(full(other.engine)).toBe(before);
  });
});

describe("sauvegarde : valeur illisible = emplacement vide", () => {
  function slotsWith(text: string | null) {
    const store = new MemoryStorage();
    if (text !== null) store.set("slot01", text);
    return createSaveSlots(store);
  }

  it("JSON cassé, valeur vide, autre version, champ manquant : rien (jamais d'exception)", () => {
    for (const text of [
      "{pas du json",
      "null",
      "42",
      "{}",
      JSON.stringify({ savedAt: 1, save: { version: 999 } }),
      JSON.stringify({ savedAt: 1, save: { version: SAVE_VERSION } }),
      JSON.stringify({ savedAt: "hier", save: { version: SAVE_VERSION } }),
    ]) {
      const slots = slotsWith(text);
      expect(slots.read(1), text).toBeNull();
      expect(summarizeSlots(slots)[0]!.empty).toBe(true);
    }
    expect(parseSave(undefined)).toBeNull();
    expect(parseSave([])).toBeNull();
    expect(slotsWith(null).latest()).toBeNull();
  });

  it.skipIf(!hasOriginalFiles)("une sauvegarde valide dont un champ est abîmé est refusée", () => {
    const { engine, host } = makeEngine();
    new Driver(engine, host).ticks(5);
    const good = snapshot(engine);
    expect(parseSave({ ...good, fields: good.fields.slice(1) })).toBeNull();
    expect(parseSave({ ...good, rng: "x" })).toBeNull();
    expect(parseSave({ ...good, active: [{ ...good.active[0]!, pathFinder: { inUse: 1 } }] })).toBeNull();
    expect(parseSave({ ...good, display: { destRoomNumber: 0, cursorState: 0, talkDialog: 3 } })).toBeNull();
    expect(parseSave({ ...good, hotspotData: [{ index: 0, fields: { x: "a" }, schedule: [] }] })).toBeNull();
    // Une valeur lisible d'une version inconnue : emplacement vide.
    const store = new MemoryStorage();
    store.set("slot02", JSON.stringify({ savedAt: 1, save: { ...good, version: SAVE_VERSION + 1 } }));
    expect(createSaveSlots(store).read(2)).toBeNull();
  });
});

describe.skipIf(!hasOriginalFiles)("sauvegarde : sons à relancer", () => {
  /** Faux son : retient ce qu'on lui demande de relancer. */
  class FakeSound extends SilentSound {
    restored: number[] | null = null;
    constructor(private readonly active: number[]) {
      super();
    }
    activeSoundNumbers(): number[] {
      return this.active;
    }
    restoreSounds(soundNumbers: readonly number[]): void {
      this.restored = [...soundNumbers];
    }
  }

  it("les numéros des sons actifs sont sauvegardés et relancés au chargement (`restoreSounds`)", () => {
    const a = makeEngine({ sound: new FakeSound([3, 17, 5]) });
    new Driver(a.engine, a.host).ticks(3);
    const save = snapshot(a.engine);
    expect(save.sounds).toEqual([3, 17, 5]);

    const fake = new FakeSound([]);
    const b = makeEngine({ sound: fake });
    expect(restoreSave(b.engine, save)).toBe(true);
    expect(fake.restored).toEqual([3, 17, 5]);
  });

  it("un son muet (sans `activeSoundNumbers`) ne sauvegarde aucun son et la reprise réussit", () => {
    const a = makeEngine();
    new Driver(a.engine, a.host).ticks(3);
    const save = snapshot(a.engine);
    expect(save.sounds).toEqual([]);
    expect(restoreSave(makeEngine().engine, save)).toBe(true);
  });

  it("« Texte rapide » et « Son » sont repris avec la partie, menus compris", () => {
    const a = makeEngine();
    new Driver(a.engine, a.host).ticks(3);
    a.engine.fastTextFlag = true;
    a.engine.menuBar.setFastText(true);
    const save = snapshot(a.engine);
    const b = makeEngine();
    expect(restoreSave(b.engine, save)).toBe(true);
    expect(b.engine.fastTextFlag).toBe(true);
    expect(b.engine.menuBar.fastText).toBe(true);
    expect(b.engine.soundFlag).toBe(true);
  });
});
