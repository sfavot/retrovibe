/**
 * Point d'entrée des données du jeu : ouvre les quatre disques et `LURE-FR.DAT`, décode toutes les tables de `lure.dat`, les textes, la police
 * et les petites ressources de `DISK1.VGA`. Les images (écrans, animations) et les sons se décodent à la demande avec `picture.ts`, `anim.ts` et
 * `LureResources.get`.
 *
 * Écrit pour ce projet ; les sources de chaque lecteur sont citées dans leur module.
 */

import { LureResources, type LureFiles } from "./container";
import { CURSOR_SIZE, DiskResId, ResId } from "./ids";
import { LureFont } from "./font";
import { LureTexts } from "./strings";
import { parsePalette, type Palette } from "./palette";
import {
  Segment,
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
  type ActionLists,
  type HotspotAnimRecord,
  type HotspotOverride,
  type HotspotRecord,
  type MessageSet,
  type NpcSchedules,
  type RoomData,
  type RoomExitCoordinates,
  type RoomExitHotspot,
  type RoomExitIndexedHotspot,
  type RoomExitJoin,
  type SoundDesc,
  type TalkData,
  type TalkHeaders,
} from "./lure-dat";

export interface LureData {
  resources: LureResources;
  /** Palette du jeu (`0x3F01`, 256 couleurs) et sous-palette de remplacement (`0x3F02`, 68 couleurs). */
  gamePalette: Palette;
  altPalette: Palette;
  /** Cadres bruts des boîtes (`0x3F03`) et des bulles (`0x3F04`) : voir `dialog-frame.ts`. */
  dialogFrame: Uint8Array;
  talkDialogFrame: Uint8Array;
  rooms: RoomData[];
  schedules: NpcSchedules;
  hotspots: HotspotRecord[];
  hotspotOverrides: HotspotOverride[];
  roomExitHotspots: Map<number, RoomExitHotspot[]>;
  roomExitJoins: RoomExitJoin[];
  anims: HotspotAnimRecord[];
  /** Scripts : séquences (`0x3F0C`), animations des hotspots (`0x3F0D`) et combats (`0x3F16`), segments adressés par décalage. */
  scripts: Segment;
  scripts2: Segment;
  fights: Segment;
  hotspotScriptOffsets: number[];
  messages: MessageSet[];
  actionLists: ActionLists;
  talkHeaders: TalkHeaders;
  talk: TalkData;
  exitCoordinates: RoomExitCoordinates[];
  exitHotspotIds: RoomExitIndexedHotspot[];
  /** Textes de l'interface (verbes à l'indice `action - 1`, puis `UiString`), en codes du jeu. */
  uiStrings: string[];
  soundDescs: SoundDesc[];
  audioInitIcon: Uint8Array;
  texts: LureTexts;
  font: LureFont;
  /** 26 curseurs de 16 x 16 (ressource 1), concaténés. */
  cursors: Uint8Array;
}

export function loadLureData(files: LureFiles): LureData {
  const resources = new LureResources(files);
  const dat = (id: number): Uint8Array => resources.get(id);
  const rooms = parseRooms(dat(ResId.roomData), dat(ResId.roomPaths));
  const cursors = resources.get(DiskResId.cursors);
  if (cursors.length % CURSOR_SIZE !== 0) throw new Error("curseurs invalides : taille non multiple de 256");
  return {
    resources,
    gamePalette: parsePalette(dat(ResId.gamePalette)),
    altPalette: parsePalette(dat(ResId.altPalette)),
    dialogFrame: dat(ResId.dialogFrame),
    talkDialogFrame: dat(ResId.talkDialogFrame),
    rooms,
    schedules: parseNpcSchedules(dat(ResId.npcSchedules)),
    hotspots: parseHotspots(dat(ResId.hotspotData)),
    hotspotOverrides: parseHotspotOverrides(dat(ResId.hotspotOverrides)),
    roomExitHotspots: parseRoomExitHotspots(dat(ResId.roomExits)),
    roomExitJoins: parseRoomExitJoins(dat(ResId.roomExitJoins)),
    anims: parseAnimData(dat(ResId.animData)),
    scripts: new Segment(dat(ResId.scriptData)),
    scripts2: new Segment(dat(ResId.script2Data)),
    fights: new Segment(dat(ResId.fightData)),
    hotspotScriptOffsets: parseHotspotScriptOffsets(dat(ResId.hotspotScriptList)),
    messages: parseMessages(dat(ResId.messagesList)),
    actionLists: parseActionLists(dat(ResId.actionList)),
    talkHeaders: parseTalkHeaders(dat(ResId.talkHeader)),
    talk: parseTalkData(dat(ResId.talkData)),
    exitCoordinates: parseRoomExitCoordinates(dat(ResId.exitCoordinates)),
    exitHotspotIds: parseExitHotspotIds(dat(ResId.exitHotspotIds)),
    uiStrings: parseUiStrings(dat(ResId.stringList)),
    soundDescs: parseSoundDescs(dat(ResId.soundDesc)),
    audioInitIcon: parseAudioInitIcon(dat(ResId.audioInitIcon)),
    texts: new LureTexts(
      resources.get(DiskResId.names),
      [resources.get(DiskResId.strings), resources.get(DiskResId.strings2), resources.get(DiskResId.strings3)],
      dat(ResId.stringDecoder),
    ),
    font: new LureFont(resources.get(DiskResId.font)),
    cursors,
  };
}
