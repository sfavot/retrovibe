import { DEFERRED_EVENT_BYTES, OBJECT_BYTES, ROOM_BYTES, SCORE_ENTRY_BYTES, WORLD_HEADER_WORDS, parseWorld } from "../data/world";
import { type GameObject, WorldState } from "./state";

/**
 * Écriture de l'état du monde au format `CFG` / `SVG` (`gm_save_world` `1d4a:0002`, `docs/armaeth/engine.md` § 10) :
 * en-tête de 54 octets, table de score, file d'événements, salles, puis objets. Les champs nommés de l'état remplacent
 * ceux du fichier d'origine ; tout le reste (octets sans rôle connu, mots 17 à 20 des salles) est recopié tel quel.
 */

/** Lit un fichier de monde (`A1FCFG.SYS`, `SVG001.STD`, `A1FTMP.SVG`, `svgNNN`) en état mutable. */
export function loadWorldState(bytes: Uint8Array): WorldState {
  return new WorldState(parseWorld(bytes));
}

/**
 * Objets dans l'ordre du moteur (`gm_save_world`) : liste d'interface (type 0), puis liste A de chaque salle, chaque objet suivi
 * de son contenu récursivement, tous dans l'ordre de parcours des listes. Le chargement insère en tête : chaque cycle
 * charger puis écrire inverse donc l'ordre des listes.
 */
function objectsInFileOrder(state: WorldState): GameObject[] {
  const out: GameObject[] = [];
  const visit = (obj: GameObject) => {
    out.push(obj);
    obj.contents.forEach(visit);
  };
  state.interfaceObjects.forEach(visit);
  // défaut de l'original reproduit (engine.md §12.5)
  for (const room of state.rooms) room.listA.forEach(visit);
  return out;
}

function writeObject(view: DataView, base: number, bytes: Uint8Array, obj: GameObject): void {
  bytes.set(obj.raw.subarray(0, OBJECT_BYTES), base);
  const u8 = (o: number, v: number) => view.setUint8(base + o, v);
  const u16 = (o: number, v: number) => view.setUint16(base + o, v & 0xffff, true);
  const i16 = (o: number, v: number) => view.setInt16(base + o, v, true);
  u16(0x00, obj.num);
  u16(0x02, obj.serial);
  u8(0x04, obj.typ);
  u8(0x05, obj.gst);
  u8(0x06, obj.mob);
  u8(0x07, obj.dep);
  u8(0x08, obj.txt);
  i16(0x0a, obj.light);
  i16(0x18, obj.value);
  i16(0x1a, obj.weight);
  i16(0x1c, obj.capacity);
  u8(0x1e, obj.pickable);
  u8(0x1f, obj.canContain);
  u8(0x2d, obj.ego);
  u8(0x2e, obj.fig);
  u8(0x2f, obj.hidden);
  u16(0x30, obj.animId);
  u8(0x52, obj.presence);
  u8(0x53, obj.plane);
  i16(0x54, obj.x);
  i16(0x56, obj.y);
  i16(0x58, obj.p);
  u8(0x5a, obj.ground);
  // gm_save_object : type 0 -> référence 0 ; salle -> id ; conteneur -> Ser. Cod est écrit tel qu'il est en mémoire.
  u8(0x5b, obj.location);
  u16(0x5c, obj.typ === 0 ? 0 : obj.holder ? obj.holder.serial : (obj.room?.id ?? obj.container));
  view.setInt8(base + 0x60, obj.speedX);
  view.setInt8(base + 0x61, obj.speedY);
  view.setInt8(base + 0x62, obj.speedP);
}

/** Écrit l'état au format du monde. Le nombre d'objets de l'en-tête est celui des objets effectivement écrits. */
export function serializeWorld(state: WorldState): Uint8Array {
  const objects = objectsInFileOrder(state);
  const size =
    2 * WORLD_HEADER_WORDS +
    2 +
    SCORE_ENTRY_BYTES * state.scoreTable.length +
    4 +
    DEFERRED_EVENT_BYTES * state.events.size +
    ROOM_BYTES * state.rooms.length +
    OBJECT_BYTES * objects.length;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let at = 0;
  const w16 = (v: number) => {
    view.setUint16(at, v & 0xffff, true);
    at += 2;
  };

  // En-tête : mots recopiés, champs nommés remplacés (engine.md § 10.4).
  const words = [...state.headerWords];
  words[2] = state.lastSerial;
  words[3] = (words[3] & 0xff00) | (state.dictionaryLetters & 0xff);
  words[4] = state.chapterLevel;
  words[5] = (words[5] & 0x00ff) | ((state.cadence.delay & 0xff) << 8);
  words[6] = (state.cadence.counter & 0xff) | ((state.cadence.pause & 0xff) << 8);
  words[7] = (state.clock.hour & 0xff) | ((state.clock.minute & 0xff) << 8);
  words[8] = state.clock.ticks;
  words[10] = state.score;
  words[11] = state.hero?.serial ?? 0;
  words[12] = state.currentRoom;
  words[13] = objects.length;
  words[14] = state.rooms.length;
  words.forEach(w16);

  w16(state.scoreTable.length);
  for (const e of state.scoreTable) {
    w16(e.id);
    w16(e.points);
    w16(e.sound);
    w16(e.repeats);
  }

  w16(state.events.capacity);
  w16(state.events.size);
  for (const e of state.events.entries) {
    w16(e.typ);
    w16(e.num);
    w16(e.serial);
    w16(e.event);
    w16(e.counter);
    w16(e.procedure);
  }

  for (const room of state.rooms) {
    const roomWords = [...room.words];
    roomWords[0] = room.id;
    roomWords[1] = room.lightOffset;
    roomWords[2] = (room.musicClass << 8) | (room.outdoor & 0xff);
    roomWords[3] = room.musicNumber;
    roomWords[4] = room.musicId;
    room.exits.forEach((v, i) => (roomWords[5 + i] = v));
    room.barriers.forEach((v, i) => (roomWords[11 + i] = v));
    roomWords.forEach(w16);
  }

  for (const obj of objects) {
    writeObject(view, at, bytes, obj);
    at += OBJECT_BYTES;
  }
  return bytes;
}
