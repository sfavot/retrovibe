import { describe, expect, it } from "vitest";
import { lureData } from "./catalog-helper";
import { Coverage } from "../../../src/games/lure/data/cursor";
import { DIALOG_FRAME_SIZE, TALK_DIALOG_FRAME_SIZE, expandDialogFrame, expandTalkDialogFrame } from "../../../src/games/lure/data/dialog-frame";
import { SCHEDULE_ACTION_PARAMS, ResId } from "../../../src/games/lure/data/ids";
import {
  AUDIO_ICON_SIZE,
  DECODED_PATHS_HEIGHT,
  NONVISUAL_HOTSPOT_ID,
  DECODED_PATHS_WIDTH,
  ROOM_PATHS_SIZE,
  Segment,
  decompressPaths,
  parseActionLists,
  parseAnimData,
  parseAudioInitIcon,
  parseExitHotspotIds,
  parseHotspotOverrides,
  parseHotspotScriptOffsets,
  parseHotspots,
  parseMessages,
  parseNpcSchedules,
  parseRoomExitCoordinates,
  parseRoomExitHotspots,
  parseRoomExitJoins,
  parseRooms,
  parseSoundDescs,
  parseTalkData,
  parseTalkHeaders,
  parseUiStrings,
  scheduleSetByteLength,
} from "../../../src/games/lure/data/lure-dat";
import { hasOriginalFiles } from "./helpers";

const u16 = (...values: number[]): number[] => values.flatMap((v) => [v & 0xff, v >> 8]);

describe("lectures de lure.dat (données synthétiques)", () => {
  it("lit les verbes et corrige « Parle » en « Parle à » (D9)", () => {
    const strings = Uint8Array.from([...u16(13), ...[..."Prends\0\0Pousse\0Tire\0Actionne\0Ouvre\0Ferme\0Verrouille\0D\x7fverrouille\0Utilise\0Donne\0Parle \0Dis \x81\0"].map((c) => c.charCodeAt(0))]);
    const parsed = parseUiStrings(strings);
    expect(parsed[11]).toBe("Parle \x81");
    expect(parsed[0]).toBe("Prends");
    expect(parsed[1]).toBe("");
    expect(parsed).toHaveLength(13);
    const already = Uint8Array.from([...u16(12), ...[..."a\0b\0c\0d\0e\0f\0g\0h\0i\0j\0k\0Parle \x81\0"].map((c) => c.charCodeAt(0))]);
    expect(parseUiStrings(already)[11]).toBe("Parle \x81");
  });

  it("ramène « Vous  êtes sûr (o/n)? » à un seul espace (D9) sans toucher aux autres textes", () => {
    const strings = Uint8Array.from([...u16(3), ...[..."Vous  \x83tes s\x89r (o/n)?\0Vous avez \0les\0"].map((c) => c.charCodeAt(0))]);
    expect(parseUiStrings(strings)).toEqual(["Vous \x83tes s\x89r (o/n)?", "Vous avez ", "les"]);
  });

  it("lit les actions d'un emploi du temps avec le nombre de paramètres de la table de ScummVM", () => {
    // charOffsets [7] ; aucune action aléatoire ; un ensemble à l'offset 10 : action 1 (1 param), action 10 (2 params), fin
    const bytes = Uint8Array.from([...u16(7, 0xffff, 0xffff, 10, 0xffff, 1, 0x40, 10, 5, 6, 0)]);
    const parsed = parseNpcSchedules(bytes);
    expect(parsed.charOffsets).toEqual([7]);
    expect(parsed.randomActions).toEqual([]);
    expect(parsed.schedules).toEqual([{ id: 1, offset: 10, entries: [{ action: 1, params: [0x40] }, { action: 10, params: [5, 6] }] }]);
    expect(scheduleSetByteLength(parsed.schedules[0]!)).toBe(12);
    expect(SCHEDULE_ACTION_PARAMS).toHaveLength(41);
  });

  it("lit une action aléatoire : numéro de pièce, nombre d'actions et drapeaux de répétition", () => {
    const bytes = Uint8Array.from([...u16(0xffff, 3, 0x0102 | 0x0000, 0x30, 0x40, 0xffff, 0xffff)]);
    const parsed = parseNpcSchedules(bytes);
    expect(parsed.randomActions).toEqual([{ roomNumber: 3, actions: [{ id: 0x30, repeatable: true }, { id: 0x40, repeatable: false }] }]);
    expect(() => parseNpcSchedules(Uint8Array.from([...u16(0xffff, 3, 9, 0xffff)]))).toThrow(/plus de 8/);
  });

  it("refuse une action d'emploi du temps inconnue et une lecture hors de la ressource", () => {
    expect(() => parseNpcSchedules(Uint8Array.from([...u16(0xffff, 0xffff, 8, 0xffff, 41, 0)]))).toThrow(/inconnue/);
    expect(() => parseHotspots(Uint8Array.from([1, 0, 2]))).toThrow(RangeError);
    expect(() => parseAudioInitIcon(new Uint8Array(10))).toThrow(/taille/);
    expect(() => parseSoundDescs(new Uint8Array(7))).toThrow(/taille/);
  });

  it("lit les messages, les actions, les dialogues et les sorties", () => {
    // messages : personnage 1000 -> liste à l'offset 4 : (valeur 5, id 9), fin
    expect(parseMessages(Uint8Array.from([...u16(1000, 4, 5, 9, 0xffff)]))).toEqual([{ characterId: 1000, entries: [{ value: 5, id: 9 }] }]);
    // actions : enregistrement 0x10 -> liste à 6 : 1 action (verbe 1, séquence 0x20)
    expect(parseActionLists(Uint8Array.from([...u16(0x10, 6, 0xffff), ...u16(1), 1, 0x20, 0])).lists).toEqual([{ recordId: 0x10, actions: [{ action: 1, sequenceOffset: 0x20 }] }]);
    // joints : 13 octets
    expect(parseRoomExitJoins(Uint8Array.from([...u16(1), 2, 3, 4, 5, ...u16(2), 6, 7, 8, 9, 1, ...u16(0xffff)]))[0]).toMatchObject({ blocked: 1, hotspots: [{ hotspotId: 1, destFrame: 3, closeSound: 5 }, { hotspotId: 2, currentFrame: 6, openSound: 8 }] });
    expect(parseHotspotOverrides(Uint8Array.from([...u16(7, 1, 2, 3, 0xfffe, 0xffff)]))).toEqual([{ hotspotId: 7, xs: 1, xe: 2, ys: 3, ye: -2 }]);
    expect(parseExitHotspotIds(Uint8Array.from([5, 2, ...u16(0x2710), ...u16(0xffff)]))).toEqual([{ roomNumber: 5, hotspotIndex: 2, hotspotId: 0x2710 }]);
    expect(parseHotspotScriptOffsets(Uint8Array.from(u16(1, 2, 3)))).toEqual([1, 2, 3]);
    expect(parseSoundDescs(Uint8Array.from([1, 2, 3, 3, 5]))).toEqual([{ soundNumber: 1, channel: 2, numChannels: 3, flags: 3, volume: 5 }]);
  });

  it("lit les listes de dialogue : entrées et réponses de 6 octets terminées par 0xFFFF", () => {
    // 6 identifiants, puis un enregistrement (id 0x100, entrées à 8, réponses à 16), fin ; liste d'entrées à 8, réponses à 16
    const entry = [...u16(0x10, 0x20, 0x30)];
    expect(() => parseTalkData(Uint8Array.from([...u16(1, 2, 3, 4, 5, 6), ...u16(0x100, 8, 16, 0xffff)]))).toThrow(RangeError);
    const full = Uint8Array.from([...u16(1, 2, 3, 4, 5, 6), ...u16(0x100, 8, 16, 0xffff), ...entry, ...u16(0xffff), ...entry, ...u16(0xffff)]);
    const talk = parseTalkData(full);
    expect(talk.giveTalkIds).toEqual([1, 2, 3, 4, 5, 6]);
    expect(talk.records).toEqual([{ recordId: 0x100, entries: [{ preSequenceId: 0x10, descId: 0x20, postSequenceId: 0x30 }], responses: [{ preSequenceId: 0x10, descId: 0x20, postSequenceId: 0x30 }] }]);
    expect(parseTalkHeaders(Uint8Array.from([...u16(1000, 6, 0xffff, 0x100, 0xffff)])).headers).toEqual([{ hotspotId: 1000, entries: [0x100] }]);
  });

  it("Segment lit des mots à un décalage et refuse de sortir", () => {
    const segment = new Segment(Uint8Array.from([1, 2, 0xff, 0xff]));
    expect(segment.u16(0)).toBe(0x0201);
    expect(segment.i16(2)).toBe(-1);
    expect(segment.u8(1)).toBe(2);
    expect([...segment.slice(1, 2)]).toEqual([2, 0xff]);
    expect(() => segment.u16(3)).toThrow(RangeError);
  });
});

describe("decompressPaths (données synthétiques)", () => {
  it("décompresse la grille : marge vide et cases occupées étendues vers la gauche de la largeur du personnage", () => {
    const empty = decompressPaths(new Uint8Array(ROOM_PATHS_SIZE), 32);
    expect(empty).toHaveLength(DECODED_PATHS_WIDTH * DECODED_PATHS_HEIGHT);
    expect(empty.every((v) => v === 0)).toBe(true);
    const paths = new Uint8Array(ROOM_PATHS_SIZE);
    paths[4] = 0x01; // bloc le plus à droite de la première ligne (la grille est lue de droite à gauche : l'extension va vers la gauche)
    expect(decompressPaths(paths, 16).filter((v) => v === 0xffff)).toHaveLength(2);
    const wide = decompressPaths(paths, 32);
    expect(wide.filter((v) => v === 0xffff)).toHaveLength(4);
  });
});

describe.skipIf(!hasOriginalFiles)("lure.dat : chaque ressource lue jusqu'au dernier octet", () => {
  /** Plages non lues de chaque ressource, relevées en lisant avec les lecteurs du module. */
  function unreadRanges(): Map<number, Array<[number, number]>> {
    const { resources } = lureData();
    const res = (id: number): Uint8Array => resources.get(id);
    const out = new Map<number, Array<[number, number]>>();
    const run = (id: number, read: (bytes: Uint8Array, coverage: Coverage) => unknown): void => {
      const coverage = new Coverage(res(id).length);
      read(res(id), coverage);
      out.set(id, coverage.unread());
    };
    const pathCoverage = new Coverage(res(ResId.roomPaths).length);
    run(ResId.roomData, (b, c) => parseRooms(b, res(ResId.roomPaths), c, pathCoverage));
    out.set(ResId.roomPaths, pathCoverage.unread());
    run(ResId.npcSchedules, (b, c) => parseNpcSchedules(b, c));
    run(ResId.hotspotData, (b, c) => parseHotspots(b, c));
    run(ResId.hotspotOverrides, (b, c) => parseHotspotOverrides(b, c));
    run(ResId.roomExits, (b, c) => parseRoomExitHotspots(b, c));
    run(ResId.roomExitJoins, (b, c) => parseRoomExitJoins(b, c));
    run(ResId.animData, (b, c) => parseAnimData(b, c));
    run(ResId.hotspotScriptList, (b, c) => parseHotspotScriptOffsets(b, c));
    run(ResId.messagesList, (b, c) => parseMessages(b, c));
    run(ResId.actionList, (b, c) => parseActionLists(b, c));
    run(ResId.talkHeader, (b, c) => parseTalkHeaders(b, c));
    run(ResId.talkData, (b, c) => parseTalkData(b, c));
    run(ResId.exitCoordinates, (b, c) => parseRoomExitCoordinates(b, c));
    run(ResId.exitHotspotIds, (b, c) => parseExitHotspotIds(b, c));
    run(ResId.stringList, (b, c) => parseUiStrings(b, c));
    run(ResId.soundDesc, (b, c) => parseSoundDescs(b, c));
    run(ResId.audioInitIcon, (b, c) => parseAudioInitIcon(b, c));
    const dialog = new Coverage(DIALOG_FRAME_SIZE);
    expandDialogFrame(res(ResId.dialogFrame), 40, 30, dialog);
    out.set(ResId.dialogFrame, dialog.unread());
    const talk = new Coverage(TALK_DIALOG_FRAME_SIZE);
    expandTalkDialogFrame(res(ResId.talkDialogFrame), 20, talk);
    out.set(ResId.talkDialogFrame, talk.unread());
    // Lus en entier par construction : palettes (`parsePalette`), table de décodage (`CharacterDecoder`), segments (`Segment`).
    for (const id of [ResId.gamePalette, ResId.altPalette, ResId.scriptData, ResId.script2Data, ResId.fightData, ResId.stringDecoder]) out.set(id, []);
    return out;
  }

  /** Grille de cheminement d'une pièce absente de `0x3F05` : jamais lue (`create_lure` copie les 51 grilles de l'exécutable). */
  const absentRoomGrid = (room: number): [number, number] => [(room - 1) * ROOM_PATHS_SIZE, room * ROOM_PATHS_SIZE];

  it("ne laisse que du remplissage connu ou de la mémoire non initialisée, pour les 26 ressources", () => {
    const expected = new Map<number, Array<[number, number]>>([
      [ResId.roomData, [[92, 104]]],
      [ResId.npcSchedules, [[590, 608]]],
      [ResId.messagesList, [[1154, 1168]]],
      [ResId.actionList, [[1025, 1168]]],
      [ResId.talkHeader, [[1392, 1394]]],
      [ResId.talkData, [[1370, 1382]]],
      [ResId.dialogFrame, [[334, 336]]],
      [ResId.talkDialogFrame, [[43, 48]]],
      [ResId.roomPaths, [16, 26, 33, 37].map(absentRoomGrid).concat([[5880, 6120]])],
    ]);
    const unread = unreadRanges();
    expect(unread.size).toBe(26);
    for (const [id, ranges] of unread) expect(ranges, `ressource 0x${id.toString(16)}`).toEqual(expected.get(id) ?? []);
  });

  it("le remplissage connu vaut zéro, sauf les grilles des pièces 16, 26, 33 et 37 (copiées de l'exécutable)", () => {
    const { resources } = lureData();
    const zero = (id: number, from: number, to: number): boolean => resources.get(id).subarray(from, to).every((v) => v === 0);
    expect(zero(ResId.roomData, 92, 104)).toBe(true);
    expect(zero(ResId.messagesList, 1154, 1168)).toBe(true);
    expect(zero(ResId.dialogFrame, 334, 336)).toBe(true);
    expect(zero(ResId.talkDialogFrame, 43, 48)).toBe(true);
    expect(zero(ResId.roomPaths, 5880, 6120)).toBe(true);
    for (const room of [16, 26, 33, 37]) expect(zero(ResId.roomPaths, ...absentRoomGrid(room))).toBe(false);
  });

  it("les 175 octets non initialisés de create_lure valent 0xCD dans le bloc livré et ne changent rien à la lecture", () => {
    const { resources } = lureData();
    const zones: Array<[number, number, number]> = [
      [ResId.npcSchedules, 590, 608],
      [ResId.actionList, 1025, 1168],
      [ResId.talkHeader, 1392, 1394],
      [ResId.talkData, 1370, 1382],
    ];
    expect(zones.reduce((sum, [, from, to]) => sum + (to - from), 0)).toBe(175);
    for (const [id, from, to] of zones) expect(resources.get(id).subarray(from, to).every((v) => v === 0xcd), `0x${id.toString(16)}`).toBe(true);

    const scrambled = (id: number): Uint8Array => {
      const copy = resources.get(id).slice();
      for (const [zoneId, from, to] of zones) if (zoneId === id) for (let i = from; i < to; i++) copy[i] = (i * 37 + 11) & 0xff;
      return copy;
    };
    const same = (read: (bytes: Uint8Array) => unknown, id: number): void => expect(read(scrambled(id)), `0x${id.toString(16)}`).toEqual(read(resources.get(id)));
    same(parseNpcSchedules, ResId.npcSchedules);
    same(parseActionLists, ResId.actionList);
    same(parseTalkHeaders, ResId.talkHeader);
    same(parseTalkData, ResId.talkData);
  });
});

describe.skipIf(!hasOriginalFiles)("lure.dat : contenu", () => {
  it("compte les enregistrements de chaque table", () => {
    const d = lureData();
    expect(d.rooms.map((room) => room.roomNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25, 27, 28, 29, 30, 31, 32, 34, 35, 36, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
    ]);
    expect(d.hotspots).toHaveLength(211);
    expect(d.hotspotOverrides).toHaveLength(86);
    expect([...d.roomExitHotspots.values()].reduce((sum, list) => sum + list.length, 0)).toBeGreaterThan(0);
    expect(d.roomExitHotspots.size).toBe(47);
    expect(d.roomExitJoins).toHaveLength(12);
    expect(d.anims).toHaveLength(161);
    expect(d.hotspotScriptOffsets).toHaveLength(24);
    expect(d.schedules.schedules).toHaveLength(53);
    expect(d.schedules.charOffsets).toHaveLength(33);
    expect(d.schedules.randomActions).toHaveLength(39);
    expect(d.messages).toHaveLength(23);
    expect(d.actionLists.lists).toHaveLength(74);
    expect(d.talkHeaders.headers).toHaveLength(28);
    expect(d.talk.records).toHaveLength(226);
    expect(d.exitCoordinates).toHaveLength(49);
    expect(d.exitHotspotIds).toHaveLength(22);
    expect(d.uiStrings).toHaveLength(56);
    expect(d.soundDescs).toHaveLength(53);
    expect(d.audioInitIcon).toHaveLength(AUDIO_ICON_SIZE * AUDIO_ICON_SIZE);
    expect(d.cursors).toHaveLength(26 * 256);
    expect([d.scripts.length, d.scripts2.length, d.fights.length]).toEqual([0x2c57, 0x2800, 0x1850]);
  });

  it("correspond aux tables de create_lure : identifiants de « Donne » du français, verbes, nombre de paramètres", () => {
    const d = lureData();
    expect(d.talk.giveTalkIds).toEqual([0xd03e, 0xcff4, 0xd070, 0xd08a, 0xd0b0, 0xd0d6]); // `frenchGiveTalkIds`
    expect(d.uiStrings[0]).toBe("Prends");
    expect(d.uiStrings[8]).toBe("D\x7fverrouille");
    expect(d.uiStrings[12]).toBe("Dis \x81");
    expect(d.uiStrings[24]).toBe("Examine");
  });

  it("hotspots non visuels (>= 0x7530) : positions absurdes dans 0x3F07, rectangle pris dans les surcharges 0x3F08", () => {
    const d = lureData();
    const overrides = new Map(d.hotspotOverrides.map((o) => [o.hotspotId, o]));
    const nonVisual = d.hotspots.filter((h) => h.hotspotId >= NONVISUAL_HOTSPOT_ID);
    expect(nonVisual).toHaveLength(63);
    expect(nonVisual.filter((h) => overrides.has(h.hotspotId))).toHaveLength(60);
    const straw = d.hotspots.find((h) => h.hotspotId === 0x7538)!;
    expect([straw.startX, straw.startY, straw.height]).toEqual([32671, -128, 28215]);
    expect(overrides.get(0x7538)).toEqual({ hotspotId: 0x7538, xs: 184, xe: 209, ys: 152, ye: 168 });
    expect(overrides.get(0x755e)).toBeDefined();
    // les hotspots visuels ont des positions et tailles dans l'écran (seul `10040` dépasse : pièce 443, enregistrement sans emploi)
    const visible = d.hotspots.filter((h) => h.hotspotId < NONVISUAL_HOTSPOT_ID);
    expect(visible.filter((h) => h.startX < -50 || h.startX > 400 || h.width > 400 || h.height > 400).length).toBeLessThanOrEqual(1);
  });

  it("corrige « Parle » en « Parle à » : la ressource contient « Parle » (coquille de create_lure), le lecteur rend « Parle à »", () => {
    const d = lureData();
    const raw = d.resources.get(ResId.stringList);
    const text = Buffer.from(raw).toString("latin1");
    expect(text).toContain("Parle \0Dis \x81\0");
    expect(d.uiStrings[11]).toBe("Parle \x81");
  });

  it("corrige « Vous  êtes sûr (o/n)? » : deux espaces dans la ressource, un seul dans le texte du jeu (0/380)", () => {
    const d = lureData();
    const text = Buffer.from(d.resources.get(ResId.stringList)).toString("latin1");
    expect(text).toContain("Vous  \x83tes s\x89r (o/n)?\0");
    expect(d.uiStrings).toContain("Vous \x83tes s\x89r (o/n)?");
    expect(d.uiStrings.some((t) => t.startsWith("Vous  "))).toBe(false);
  });

  it("les emplois du temps se suivent sans trou : de 608 à 4 164, chaque ensemble finit où le suivant commence", () => {
    const { schedules } = lureData().schedules;
    expect(schedules[0]!.offset).toBe(608);
    for (let i = 0; i + 1 < schedules.length; i++) expect(schedules[i]!.offset + scheduleSetByteLength(schedules[i]!)).toBe(schedules[i + 1]!.offset);
    const last = schedules[schedules.length - 1]!;
    expect(last.offset + scheduleSetByteLength(last)).toBe(4164);
  });

  it("les identifiants d'entrée d'emploi du temps des hotspots désignent un ensemble et une instruction existants", () => {
    const d = lureData();
    for (const hotspot of d.hotspots) {
      if (hotspot.npcScheduleId === 0) continue;
      const set = d.schedules.schedules[(hotspot.npcScheduleId >> 10) - 1];
      expect(set, `hotspot ${hotspot.hotspotId}`).toBeDefined();
      expect(hotspot.npcScheduleId & 0x3ff, `hotspot ${hotspot.hotspotId}`).toBeLessThan(set!.entries.length);
    }
  });

  it("les références entre tables se résolvent : animations, listes d'actions, sorties, scripts, dialogues", () => {
    const d = lureData();
    const animRecords = new Set(d.anims.map((anim) => anim.animRecordId));
    const actionRecords = new Set(d.actionLists.lists.map((list) => list.recordId));
    for (const hotspot of d.hotspots) {
      if (hotspot.animRecordId !== 0) expect(animRecords.has(hotspot.animRecordId), `hotspot ${hotspot.hotspotId}`).toBe(true);
      if (hotspot.actionsOffset !== 0) expect(actionRecords.has(hotspot.actionsOffset), `hotspot ${hotspot.hotspotId}`).toBe(true);
    }
    for (const room of d.rooms) {
      expect(room.numLayers).toBeGreaterThan(0);
      for (let i = 0; i < room.numLayers; i++) expect(d.resources.has(room.layers[i]!), `pièce ${room.roomNumber}`).toBe(true);
      if (room.sequenceOffset !== 0xffff) expect(room.sequenceOffset).toBeLessThan(d.scripts.length);
      for (const exit of room.exits) if (exit.sequenceOffset !== 0xffff) expect(exit.sequenceOffset).toBeLessThan(d.scripts.length);
      expect(room.paths).toHaveLength(ROOM_PATHS_SIZE);
    }
    for (const list of d.actionLists.lists) for (const action of list.actions) expect(action.sequenceOffset & 0x7fff).toBeLessThan(d.scripts.length); // `>= 0x8000` : message
    const talkRecords = new Set(d.talk.records.map((record) => record.recordId));
    for (const id of d.talk.giveTalkIds) expect(talkRecords.has(id)).toBe(true);
    // Un seul dialogue cité par un en-tête n'existe pas : `create_lure` saute l'entrée spéciale (0xDA10 en français, « 0xD930 » en anglais).
    const missing = d.talkHeaders.headers.flatMap((header) => header.entries.filter((id) => id !== 0 && !talkRecords.has(id)).map((id) => `${header.hotspotId}:${id.toString(16)}`));
    expect(missing).toEqual(["1007:da10"]);
  });

  it("les animations de hotspots : 161 enregistrements, 149 identifiants dont 12 absents des disques et la palette 0xFF00", () => {
    const d = lureData();
    const ids = new Set(d.anims.map((anim) => anim.animId));
    expect(ids.size).toBe(149);
    const absent = [...ids].filter((id) => !d.resources.has(id)).sort((a, b) => a - b);
    expect(absent).toEqual([0, 2, 0xd6, 0x200, 0x2065, 0x452e, 0x6f43, 0x6f76, 0x706f, 0x7279, 0x7672, 0xffff]);
    expect(d.anims.filter((anim) => anim.animId === 0xff00)).toHaveLength(1);
  });

  it("les grilles de cheminement : 51 grilles de 120 octets, la grille d'une pièce est la sous-vue de 0x3F13", () => {
    const d = lureData();
    const all = d.resources.get(ResId.roomPaths);
    expect(all).toHaveLength(51 * ROOM_PATHS_SIZE);
    for (const room of d.rooms) expect([...room.paths]).toEqual([...all.subarray((room.roomNumber - 1) * 120, room.roomNumber * 120)]);
    const decoded = decompressPaths(d.rooms[0]!.paths, 32);
    expect(decoded).toHaveLength(DECODED_PATHS_WIDTH * DECODED_PATHS_HEIGHT);
    expect(decoded.some((v) => v === 0xffff)).toBe(true);
    expect(decoded.some((v) => v === 0)).toBe(true);
  });

  it("valeurs remarquables : le joueur est le premier hotspot, la cellule est la pièce 1 avec une sortie vers la pièce 2", () => {
    const d = lureData();
    expect(d.hotspots[0]).toMatchObject({ hotspotId: 0x3e8, roomNumber: 1, startX: 144, startY: 122, width: 32, height: 48 });
    expect(d.rooms[0]).toMatchObject({ roomNumber: 1, numLayers: 2, areaFlag: 0, sequenceOffset: 59 });
    expect(d.rooms[0]!.exits).toEqual([{ xs: 40, xe: 80, ys: 159, ye: 166, sequenceOffset: 0xffff, roomNumber: 2, direction: "down", x: 100, y: 128 }]);
    expect(d.rooms[0]!.layers.slice(0, 3)).toEqual([0x4100, 0x4101, 0x4102]);
    expect(d.roomExitJoins[0]).toEqual({
      hotspots: [
        { hotspotId: 0x2711, currentFrame: 3, destFrame: 3, openSound: 10, closeSound: 9 },
        { hotspotId: 0x2712, currentFrame: 3, destFrame: 4, openSound: 10, closeSound: 9 },
      ],
      blocked: 1,
    });
    expect(d.exitCoordinates[0]!.entries[0]).toEqual({ x: 22, y: 164, roomNumber: 2, hotspotIndexId: 128 });
  });
});
