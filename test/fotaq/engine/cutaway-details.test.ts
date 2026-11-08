import { describe, expect, it } from "vitest";
import { type Cutaway, parseCutaway } from "../../../src/games/fotaq/data/cut";
import { parseVoiceName } from "../../../src/games/fotaq/data/files";
import { roomSpeechNames } from "../../../src/games/fotaq/engine/preload";
import type { SpecialMove } from "../../../src/games/fotaq/engine/script";
import { Item } from "../../../src/games/fotaq/engine/state";
import { dataFiles, hasOriginalFiles, listOriginal, readOriginal } from "../helpers";
import { clickAt, cutawayContext, enableActors, perform, requiredStates, runToEnd } from "./contexts";
import { realPlayer } from "./test-host";

const cuts = new Map<string, Cutaway>();
if (hasOriginalFiles) for (const path of dataFiles("CUT")) cuts.set(path.toUpperCase(), parseCutaway(readOriginal(path), () => false));

/** Mouvements spéciaux que la cinématique déclenche à l'arrivée à ses enregistrements (`!moveTo && specialMove > 0 && objectNumber >= 0`). */
function staticSpecialMoves(cut: Cutaway): number[] {
  return cut.objects.filter((o) => !o.moveToX && !o.moveToY && o.specialMove > 0 && o.objectNumber >= 0 && !o.roomFade).map((o) => o.specialMove);
}

describe.skipIf(!hasOriginalFiles)("points d'accroche de la vague L", () => {
  it("chaque mouvement spécial d'une cinématique est appelé une fois par enregistrement qui le cite, dans l'ordre", () => {
    const callsByFile = new Map<string, number[]>();
    const all = new Set<number>();
    for (const [file, cut] of cuts) {
      const calls: number[] = [];
      const specialMoves: Record<number, SpecialMove> = {};
      for (let n = 1; n <= 39; n++) {
        specialMoves[n] = function* () {
          calls.push(n);
        };
      }
      const context = cutawayContext(file);
      const { player, engine } = realPlayer({ room: context.room, script: { specialMoves } });
      player.settle();
      for (const [slot, value] of requiredStates(context.list)) engine.state.gameStates[slot] = value;
      enableActors(engine, context.room);
      for (const object of cut.objects) if (object.room > 0) enableActors(engine, object.room);
      perform(player, engine.playCutaway(file));
      callsByFile.set(file, calls);
      for (const n of calls) all.add(n);
      expect(calls, file).toEqual(staticSpecialMoves(cut));
    }
    // Le 35 n'est cité par aucune cinématique, le 1 (C25B) n'a pas de fonction ; tous les autres numéros de 2 à 39 sont lancés au moins par une
    // cinématique ou par ses états finaux (voir le test suivant).
    const called = [...all].sort((a, b) => a - b);
    expect(called).not.toContain(35);
    expect(called.length).toBeGreaterThan(30);
  }, 60_000);

  it("un mouvement du fichier d'une cinématique sautée est aussi lancé (section de fin)", () => {
    // C75B (éclair, dirigeable) cite des mouvements à l'arrivée ; sautée, elle lance en plus celui de ses états finaux s'il y en a un.
    let skippedExtra = 0;
    for (const [file, cut] of cuts) {
      if (!cut.skippable || cut.extra.trailer[0] <= 0) continue;
      const calls: number[] = [];
      const specialMoves: Record<number, SpecialMove> = {};
      for (let n = 1; n <= 39; n++) {
        specialMoves[n] = function* () {
          calls.push(n);
        };
      }
      const context = cutawayContext(file);
      const { player, engine, host } = realPlayer({ room: context.room, script: { specialMoves } });
      player.settle();
      enableActors(engine, context.room);
      for (const object of cut.objects) if (object.room > 0) enableActors(engine, object.room);
      perform(player, engine.playCutaway(file), { onTick: (tick) => (tick === 2 ? host.push({ type: "action", action: "skipCutaway" }) : undefined) });
      if (calls.includes(cut.extra.trailer[0])) skippedExtra++;
    }
    expect(skippedExtra).toBeGreaterThan(0);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("retour à la pièce de départ", () => {
  it("une cinématique qui change de pièce ramène Joe à sa pièce et à sa place, newRoom remis à zéro", () => {
    let checked = 0;
    for (const [file, cut] of cuts) {
      const rooms = new Set(cut.objects.map((o) => o.room).filter((room) => room > 0));
      const context = cutawayContext(file);
      if (cut.finalRoom !== 0 || cut.anotherCutaway || /\.DOG$/i.test(cut.talkFile) || rooms.size === 0 || (rooms.size === 1 && rooms.has(context.room))) continue;
      if (cut.joeFinal.room !== 0 && cut.joeFinal.room !== context.room) continue;
      const { player, engine, stage } = realPlayer({ room: context.room });
      player.settle();
      const start = { x: stage.bobs.bob(0).x, y: stage.bobs.bob(0).y, entry: engine.state.entryObject };
      for (const [slot, value] of requiredStates(context.list)) engine.state.gameStates[slot] = value;
      enableActors(engine, context.room);
      for (const room of rooms) enableActors(engine, room);
      perform(player, engine.playCutaway(file));
      expect(engine.state.room, file).toBe(context.room);
      expect(engine.state.newRoom, file).toBe(0);
      expect(engine.state.joe.cutFacing, file).toBe(0);
      // Joe est à la place qu'il avait en entrant dans la pièce (ou à celle que la cinématique lui donne en fin), s'il n'est pas entré par un objet.
      const final = cut.joeFinal.x || cut.joeFinal.y ? { x: cut.joeFinal.x, y: cut.joeFinal.y } : start;
      if (start.entry === 0) expect([stage.bobs.bob(0).x, stage.bobs.bob(0).y], file).toEqual([final.x, final.y]);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  }, 60_000);

  it("jouée depuis une commande (prendre la clef, pièce 73), c73d.CUT remet la pièce, Joe et la commande en ordre", () => {
    const rig = realPlayer({ entryObject: 584 });
    const { player, engine, host, state, stage } = rig;
    player.settle();
    const before = { room: state.room, x: stage.bobs.bob(0).x, y: stage.bobs.bob(0).y };
    expect(before.room).toBe(73);
    // Verbe « prendre » (6), objet 581 : la clef, tant que l'état 145 manque, c73d.CUT est jouée.
    clickAt(player, 5 * 20 + 10, 175);
    const box = engine.data.jas.objectBoxes[581];
    clickAt(player, Math.trunc((box.x1 + box.x2) / 2), Math.trunc((box.y1 + box.y2) / 2));
    runToEnd(player);
    expect(state.room).toBe(73);
    expect(state.newRoom).toBe(0);
    expect(engine.input.cutawayRunning).toBe(false);
    expect(host.spoken.some((voice) => voice.name.startsWith("C73D"))).toBe(true);
    expect(engine.command.line).toBeNull();
    // Le jeu reprend la main : un nouveau survol se lit.
    player.run(2);
    expect(engine.joeWalk).toBe(0);
    expect(engine.warnings).toEqual([]);
    // La clef n'est pas prise (la condition manque).
    expect(engine.inventory.has(Item.Journal + 55)).toBe(false);
  });

  it("les objets de l'hôtel sont retirés de l'inventaire à la première cinématique finie dans la pièce 1", () => {
    const { player, engine, state } = realPlayer({ room: 1 });
    player.settle();
    engine.inventory.insert(Item.Crowbar);
    expect(engine.inventory.has(Item.Crowbar)).toBe(true);
    perform(player, engine.playCutaway("C1A.CUT"));
    expect(state.room).toBe(1);
    expect(engine.inventory.has(Item.Crowbar)).toBe(false);
    expect(state.gameStates[3]).toBe(1);
  });
});

describe.skipIf(!hasOriginalFiles)("voix de la scène (préchargement)", () => {
  it("chaque pièce donne les voix de ses dialogues et cinématiques, qui existent presque toutes", () => {
    const files = new Set(listOriginal((name) => name.endsWith(".mp3")).map((path) => path.replace(/^voices\//, "").replace(/\.mp3$/, "")));
    const { engine } = realPlayer({ room: 1 });
    let total = 0;
    let found = 0;
    let rooms = 0;
    for (let room = 1; room <= engine.data.jas.roomCount; room++) {
      const names = roomSpeechNames(engine, room);
      if (names.length > 0) rooms++;
      for (const name of names) {
        total++;
        if (files.has(name)) found++;
        // Aucun nom n'est une forme inconnue.
        expect(parseVoiceName(name).kind, name).not.toBe("effect");
      }
    }
    expect(rooms).toBeGreaterThan(60);
    expect(total).toBeGreaterThan(2000);
    // Les rares noms sans fichier sont des bruitages dits (« CLIC », « snap ») et trois voix d'un dialogue (clé 29).
    expect(total - found).toBeLessThan(20);
  });

  it("l'hôte reçoit les voix de la pièce quand elle s'affiche, et pas pendant une cinématique", () => {
    const { player, host } = realPlayer({ entryObject: 584 });
    player.settle();
    expect(host.preloads.length).toBeGreaterThan(0);
    const names = host.preloads[0];
    // Pièce 73 : le dialogue du portier (`laris.DOG`, clé 20) et la cinématique de la clef.
    expect(names.some((name) => name.startsWith("C73D"))).toBe(true);
    expect(names.length).toBeGreaterThan(20);
  });
});
