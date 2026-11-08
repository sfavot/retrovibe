import { describe, expect, it } from "vitest";
import { SAVE_VERSION, type SaveData, matchesGame, parseSave, restoreState, snapshotState } from "../../../src/games/fotaq/engine/save";
import { BamFlag } from "../../../src/games/fotaq/engine/specials/bam";
import { GAME_STATE_COUNT, INVENTORY_SLOTS, TALK_SELECTED_COUNT, createGameState } from "../../../src/games/fotaq/engine/state";
import { gameData } from "../engine/test-host";
import { hasOriginalFiles } from "../helpers";

const STOPPED = { flag: BamFlag.Stop, index: 0, screenShaked: false, fightTable: 0 };

/** Une partie où chaque famille de données a une valeur qui n'est pas celle du départ. */
function sampleSave(): SaveData {
  const data = gameData();
  const state = createGameState(data);
  state.room = 73;
  state.entryObject = 584;
  state.objects[10].name = -state.objects[10].name;
  state.objects[10].image = -12;
  state.items[3].name = 0;
  state.areas[22][2].mapNeighbors = -5;
  state.areas[22][2].box.x2 = 301;
  state.walkOffs[1].x = 65506;
  state.objectDescriptions[1].lastSeenNumber = 2;
  state.gameStates[19] = 2;
  state.gameStates[GAME_STATE_COUNT - 1] = -7;
  state.talkSelected[5] = { hasTalkedTo: true, values: [1, -1, 0, 3] };
  state.inventory = [58, 3, 0, 9];
  state.joe = { x: 62, y: 107, startX: 0, startY: 0, facing: 4, prevFacing: 3, cutFacing: 0, scale: 57 };
  state.puzzleAttemptCount = 2;
  return snapshotState(state, { lastSong: 3, bam: { flag: BamFlag.Play, index: 41, screenShaked: true, fightTable: 2 }, lightsOff: true });
}

describe.skipIf(!hasOriginalFiles)("sauvegarde : instantané et lecture", () => {
  it("l'instantané survit à JSON et se relit à l'identique", () => {
    const save = sampleSave();
    expect(save.version).toBe(SAVE_VERSION);
    expect(parseSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it("l'état repris est celui qui a été sauvegardé, sans partager de structure avec lui", () => {
    const data = gameData();
    const state = createGameState(data);
    state.room = 22;
    state.objects[10].name = 0;
    state.areas[22][2].box.x2 = 301;
    state.joe.x = 140;
    state.joe.facing = 2;
    const save = snapshotState(state, { lastSong: 0, bam: STOPPED, lightsOff: false });
    const restored = restoreState(save);
    expect(restored.objects).toEqual(state.objects);
    expect(restored.areas).toEqual(state.areas);
    expect(restored.gameStates).toEqual(state.gameStates);
    expect(restored.talkSelected).toEqual(state.talkSelected);
    expect(restored.inventory).toEqual(state.inventory);
    expect(restored.walkOffs).toEqual(state.walkOffs);
    expect(restored.items).toEqual(state.items);
    expect(restored.objectDescriptions).toEqual(state.objectDescriptions);
    // Rien n'est partagé : ni avec l'état d'origine, ni d'une reprise à l'autre.
    state.objects[10].name = 9;
    state.areas[22][2].box.x2 = 1;
    state.gameStates[0] = 5;
    expect(save.objects[10][0]).toBe(0);
    expect(save.areas[22][2][3]).toBe(301);
    expect(save.gameStates[0]).toBe(0);
    const again = restoreState(save);
    again.objects[10].name = 77;
    again.areas[22][2].box.y1 = 77;
    expect(restoreState(save).objects[10].name).toBe(0);
    expect(restoreState(save).areas[22][2].box.y1).not.toBe(77);
  });

  it("les champs transitoires ne sont pas sauvegardés : pièce demandée, déplacement de Joe en attente ; la pièce quittée est la pièce courante", () => {
    const save = sampleSave();
    expect(Object.keys(save)).not.toEqual(expect.arrayContaining(["newRoom", "oldRoom"]));
    const state = restoreState(save);
    expect(state).toMatchObject({ room: 73, oldRoom: 73, newRoom: 0, entryObject: 584, puzzleAttemptCount: 2 });
    expect(state.joe).toEqual({ x: 62, y: 107, startX: 0, startY: 0, facing: 4, prevFacing: 3, cutFacing: 4, scale: 57 });
    expect(state.walkOffs[1].x).toBe(65506);
    expect(state.talkSelected[5]).toEqual({ hasTalkedTo: true, values: [1, -1, 0, 3] });
    expect(state.gameStates[GAME_STATE_COUNT - 1]).toBe(-7);
  });

  it("la sauvegarde d'une partie est compacte : de l'ordre de quelques dizaines de kilo-octets", () => {
    expect(JSON.stringify(sampleSave()).length).toBeLessThan(100_000);
  });

  it("la sauvegarde correspond aux données chargées ; une autre taille de table, une pièce ou un objet hors des tables, non", () => {
    const data = gameData();
    const save = sampleSave();
    expect(matchesGame(save, data)).toBe(true);
    expect(matchesGame({ ...save, objects: save.objects.slice(1) }, data)).toBe(false);
    expect(matchesGame({ ...save, items: [...save.items, save.items[0]] }, data)).toBe(false);
    expect(matchesGame({ ...save, areas: save.areas.slice(1) }, data)).toBe(false);
    expect(matchesGame({ ...save, areas: save.areas.map((rows, i) => (i === 22 ? rows.slice(1) : rows)) }, data)).toBe(false);
    expect(matchesGame({ ...save, room: data.jas.roomCount + 1 }, data)).toBe(false);
    expect(matchesGame({ ...save, entryObject: save.objects.length }, data)).toBe(false);
    expect(matchesGame({ ...save, inventory: [save.items.length, 0, 0, 0] }, data)).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("sauvegarde : une valeur qui n'en est pas une est refusée", () => {
  const broken = (change: (save: Record<string, unknown>) => void): unknown => {
    const save = JSON.parse(JSON.stringify(sampleSave())) as Record<string, unknown>;
    change(save);
    return save;
  };
  const rows = (save: Record<string, unknown>, key: string) => save[key] as unknown[][];

  it.each([
    ["null", null],
    ["un nombre", 3],
    ["une chaîne", "{}"],
    ["un tableau", []],
    ["un objet vide", {}],
    ["une autre version", broken((s) => (s.version = SAVE_VERSION + 1))],
    ["l'ancienne version 0", broken((s) => (s.version = 0))],
    ["sans version", broken((s) => delete s.version)],
    ["une version en texte", broken((s) => (s.version = "1"))],
    ["sans pièce", broken((s) => delete s.room)],
    ["une pièce 0", broken((s) => (s.room = 0))],
    ["une pièce fractionnaire", broken((s) => (s.room = 2.5))],
    ["une pièce en texte", broken((s) => (s.room = "2"))],
    ["un objet d'entrée négatif", broken((s) => (s.entryObject = -1))],
    ["des objets qui ne sont pas un tableau", broken((s) => (s.objects = {}))],
    ["une ligne d'objet trop courte", broken((s) => rows(s, "objects")[3].pop())],
    ["une ligne d'objet trop longue", broken((s) => rows(s, "objects")[3].push(0))],
    ["un champ d'objet en texte", broken((s) => (rows(s, "objects")[3][1] = "3"))],
    ["un champ d'objet fractionnaire", broken((s) => (rows(s, "objects")[3][1] = 3.5))],
    ["une ligne d'objet qui est un nombre", broken((s) => (rows(s, "objects")[3] = 4 as never))],
    ["des objets d'inventaire abîmés", broken((s) => (rows(s, "items")[1] = [1]))],
    ["des zones abîmées", broken((s) => (rows(s, "areas")[22] = [[1, 2]] as never))],
    ["des zones qui ne sont pas des listes", broken((s) => (s.areas = "x"))],
    ["des points de sortie abîmés", broken((s) => (rows(s, "walkOffs")[1] = [1, 2]))],
    ["des descriptions abîmées", broken((s) => (rows(s, "objectDescriptions")[1] = []))],
    ["trop peu d'états du jeu", broken((s) => (s.gameStates = [0, 1]))],
    ["un état du jeu en texte", broken((s) => ((s.gameStates as unknown[])[3] = "1"))],
    ["trop de mémoires de dialogue", broken((s) => rows(s, "talkSelected").push([0, 0, 0, 0, 0]))],
    ["une mémoire de dialogue de la mauvaise largeur", broken((s) => (rows(s, "talkSelected")[0] = [0, 0, 0]))],
    ["`hasTalkedTo` qui n'est ni 0 ni 1", broken((s) => (rows(s, "talkSelected")[0][0] = 2))],
    ["un inventaire trop long", broken((s) => (s.inventory = new Array(INVENTORY_SLOTS + 1).fill(0)))],
    ["un inventaire en texte", broken((s) => (s.inventory = "0000"))],
    ["sans Joe", broken((s) => delete s.joe)],
    ["un Joe sans échelle", broken((s) => delete (s.joe as Record<string, unknown>).scale)],
    ["un Joe dont un champ n'est pas un nombre", broken((s) => ((s.joe as Record<string, unknown>).x = "10"))],
    ["une orientation de Joe hors des quatre", broken((s) => ((s.joe as Record<string, unknown>).facing = 9))],
    ["des essais du puzzle en texte", broken((s) => (s.puzzleAttemptCount = "2"))],
    ["un dernier morceau négatif", broken((s) => (s.lastSong = -1))],
    ["une course sans état", broken((s) => delete s.bam)],
    ["un état de course inconnu", broken((s) => ((s.bam as Record<string, unknown>).flag = 3))],
    ["une secousse en nombre", broken((s) => ((s.bam as Record<string, unknown>).screenShaked = 1))],
    ["une ligne de course négative", broken((s) => ((s.bam as Record<string, unknown>).index = -1))],
    ["une lumière en nombre", broken((s) => (s.lightsOff = 1))],
  ])("%s", (_name, value) => {
    expect(parseSave(value)).toBeNull();
  });

  it("les champs en trop sont ignorés (ils ne sont pas copiés dans la partie)", () => {
    const value = broken((s) => (s.extra = "x")) as Record<string, unknown>;
    const save = parseSave(value)!;
    expect(save).not.toBeNull();
    expect("extra" in save).toBe(false);
    expect(TALK_SELECTED_COUNT).toBe(save.talkSelected.length);
  });
});
