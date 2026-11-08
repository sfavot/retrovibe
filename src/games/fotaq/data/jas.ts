/**
 * Données logiques du jeu (`QUEEN.JAS`) : pièces, objets, inventaire, zones de marche, listes de commandes,
 * acteurs, animations.
 *
 * Sources (engines/queen/, ScummVM) : `Logic::readQueenJas` (ordre et contenu), `Grid::readDataFrom`,
 * `Command::readCommandsFrom`, `structs.h` (champs). Un en-tête de 20 octets de banque AMOS est sauté ; tout est
 * **grand-boutiste**. La lecture s'arrête sur la chaîne de version `CFM10` (`version`), 4 506 octets nuls
 * suivent et ne sont lus par personne.
 *
 * Numérotation : comme ScummVM, **les tableaux sont indexés par le numéro du jeu, à partir de 1** (`objects[n]`,
 * `items[n]`, `rooms[n]`…) ; l'élément 0 est un enregistrement nul. Les listes de commandes, d'objets, etc. des
 * enregistrements de commande se réfèrent à ces numéros.
 * Écarts volontaires :
 * - les enregistrements sont des objets nommés, pas des structures lues sur place ; `roomFirstObject` est le
 *   tableau `_roomData` de ScummVM (premier objet de chaque pièce moins un : les objets d'une pièce `r` sont
 *   `roomFirstObject[r] + 1` à `roomFirstObject[r] + rooms[r].objectCount`) ;
 * - si un compte vaut 0, ScummVM lit quand même un enregistrement dans l'élément 0 : le même nombre d'octets
 *   est lu ici (et l'élément 0 reçoit cet enregistrement), mais aucun compte du fichier français n'est nul ;
 * - le correctif de ScummVM (bug 3536) est reproduit : l'objet de commande 175 copie l'objet 309 dans le 308,
 *   pas dans le 307, comme le fichier le dit (`appliedFixes`) ;
 * - un acteur sans fichier (`file` nul) reçoit la banque 15 (celle des objets de la pièce), comme ScummVM ;
 * - la version n'est pas refusée si elle diffère : `version` la donne et le moteur décide.
 */

import { BinaryReader } from "../../../data/reader";

export const JAS_HEADER_SIZE = 20;

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface JasObject {
  /** Nom (< 0 : objet caché, 0 : objet supprimé). */
  name: number;
  x: number;
  y: number;
  /** Numéro de description. */
  description: number;
  /** Objet associé. */
  entryObject: number;
  room: number;
  /** État (direction de saisie, allumé, commande par défaut…). */
  state: number;
  /** Image : voir `GraphicData` (> 0 : bob allumé, > 5000 : collé dans le décor, <= -10 : éteint, -3 et -4 : personne). */
  image: number;
}

export interface JasItem {
  name: number;
  description: number;
  state: number;
  frame: number;
  /** Description sonore (> 0 si elle existe). */
  sfxDescription: number;
}

export interface JasGraphic {
  x: number;
  y: number;
  /** Première image (< 0 : animation décrite par une chaîne). */
  firstFrame: number;
  /** Dernière image (0 : image fixe, < 0 : animation en aller-retour). */
  lastFrame: number;
  speed: number;
}

export interface JasArea {
  /** Masque des zones voisines. */
  mapNeighbors: number;
  box: Box;
  bottomScaleFactor: number;
  topScaleFactor: number;
  /** Objet situé dans cette zone. */
  object: number;
}

export interface JasRoomGrid {
  /** Nombre d'objets de la pièce. */
  objectCount: number;
  /** Zones de marche de la pièce, numérotées à partir de 1 (l'élément 0 est nul). */
  areas: JasArea[];
}

export interface JasWalkOff {
  entryObject: number;
  /** Destination de marche. Comme dans ScummVM les coordonnées sont des `u16` : 65506 vaut -30 lu sur 16 bits signés. */
  x: number;
  y: number;
}

export interface JasObjectDescription {
  object: number;
  /** 0 : aléatoire en commençant par la première, 1 : aléatoire, 2 : séquentiel avec boucle, 3 : séquentiel jusqu'à la dernière. */
  type: number;
  lastDescription: number;
  lastSeenNumber: number;
}

export interface JasCommand {
  verb: number;
  object1: number;
  object2: number;
  /** Morceau à jouer (> 0 : avant l'action, < 0 : après). */
  song: number;
  /** Les quatre sous-listes à appliquer (zones, objets, inventaire, états). */
  setAreas: boolean;
  setObjects: boolean;
  setItems: boolean;
  setConditions: boolean;
  imageOrder: number;
  specialSection: number;
}

export interface JasCommandArea {
  /** Numéro de la liste de commandes. */
  id: number;
  /** Zone à éteindre (< 0) ou allumer (> 0). */
  area: number;
  room: number;
}

export interface JasCommandObject {
  id: number;
  /** > 0 : montrer, < 0 : cacher. */
  destination: number;
  /** > 0 : copier depuis cet objet, 0 : rien, -1 : supprimer la destination. */
  source: number;
}

export interface JasCommandInventory {
  id: number;
  /** < 0 : retirer, > 0 : ajouter. */
  destination: number;
  /** > 0 : valide. */
  source: number;
}

export interface JasCommandState {
  id: number;
  slot: number;
  value: number;
  speakValue: number;
}

export interface JasCommands {
  lists: JasCommand[];
  areas: JasCommandArea[];
  objects: JasCommandObject[];
  inventory: JasCommandInventory[];
  states: JasCommandState[];
}

export interface JasFurniture {
  room: number;
  /** Objet : 1 à 5000 fixe ou animé, au-delà de 5000 collé dans le décor. */
  object: number;
}

export interface JasActor {
  room: number;
  bobNumber: number;
  name: number;
  /** L'acteur est valide si l'état `stateSlot` vaut `stateValue`. */
  stateSlot: number;
  stateValue: number;
  /** Couleur du texte prononcé. */
  color: number;
  standingFrame: number;
  x: number;
  y: number;
  animation: number;
  bank: number;
  /** Numéro du nom de fichier (`GameTexts.actorFiles`). */
  file: number;
}

export interface JasGraphicAnimation {
  keyFrame: number;
  frame: number;
  speed: number;
}

export interface QueenJas {
  roomCount: number;
  nameCount: number;
  objectCount: number;
  descriptionCount: number;
  objects: JasObject[];
  roomFirstObject: number[];
  /** Numéro d'effet sonore de chaque pièce (à partir de 1). */
  roomSfx: number[];
  items: JasItem[];
  graphics: JasGraphic[];
  rooms: JasRoomGrid[];
  /** Boîte de chaque objet (`Grid::_objectBox`). */
  objectBoxes: Box[];
  walkOffs: JasWalkOff[];
  objectDescriptions: JasObjectDescription[];
  commands: JasCommands;
  /** Objet d'entrée de la partie ; sa pièce est la pièce de départ. */
  entryObject: number;
  furniture: JasFurniture[];
  actorAnimationCount: number;
  actorNameCount: number;
  actorFileCount: number;
  actors: JasActor[];
  graphicAnimations: JasGraphicAnimation[];
  /** Chaîne de version qui suit les données (`CFM10`). */
  version: string;
  /** Décalage dans le fichier où la lecture s'arrête (début de `version`). */
  endOffset: number;
  appliedFixes: string[];
}

/** Lit `count` enregistrements numérotés à partir de 1 ; l'élément 0 est nul (voir l'en-tête pour `count` = 0). */
function table<T>(count: number, zero: T, read: () => T): T[] {
  if (count === 0) return [read()];
  const out: T[] = [zero];
  for (let i = 0; i < count; i++) out.push(read());
  return out;
}

const NO_BOX: Box = { x1: 0, y1: 0, x2: 0, y2: 0 };

function readBox(reader: BinaryReader): Box {
  return { x1: reader.i16be(), y1: reader.i16be(), x2: reader.i16be(), y2: reader.i16be() };
}

export function parseQueenJas(bytes: Uint8Array): QueenJas {
  const reader = new BinaryReader(bytes);
  reader.offset = JAS_HEADER_SIZE;
  const roomCount = reader.u16be();
  const nameCount = reader.u16be();
  const objectCount = reader.u16be();
  const descriptionCount = reader.u16be();

  const objects = table<JasObject>(
    objectCount,
    { name: 0, x: 0, y: 0, description: 0, entryObject: 0, room: 0, state: 0, image: 0 },
    () => ({
      name: reader.i16be(),
      x: reader.u16be(),
      y: reader.u16be(),
      description: reader.u16be(),
      entryObject: reader.i16be(),
      room: reader.u16be(),
      state: reader.u16be(),
      image: reader.i16be(),
    }),
  );

  // `_roomData` : 0, puis `roomCount + 1` valeurs ; la dernière est remplacée par le nombre d'objets.
  const roomFirstObject = [0];
  for (let i = 0; i <= roomCount; i++) roomFirstObject.push(reader.u16be());
  roomFirstObject[roomCount + 1] = objectCount;

  const roomSfx = [0];
  for (let i = 0; i < roomCount; i++) roomSfx.push(reader.u16be());

  const itemCount = reader.u16be();
  const items = table<JasItem>(itemCount, { name: 0, description: 0, state: 0, frame: 0, sfxDescription: 0 }, () => ({
    name: reader.i16be(),
    description: reader.u16be(),
    state: reader.u16be(),
    frame: reader.u16be(),
    sfxDescription: reader.i16be(),
  }));

  const graphicCount = reader.u16be();
  const graphics = table<JasGraphic>(graphicCount, { x: 0, y: 0, firstFrame: 0, lastFrame: 0, speed: 0 }, () => ({
    x: reader.u16be(),
    y: reader.u16be(),
    firstFrame: reader.i16be(),
    lastFrame: reader.i16be(),
    speed: reader.u16be(),
  }));

  // Zones de marche (`Grid::readDataFrom`) : par pièce, puis une boîte par objet.
  const rooms: JasRoomGrid[] = [{ objectCount: 0, areas: [] }];
  for (let room = 1; room <= roomCount; room++) {
    const roomObjects = reader.i16be();
    const areaCount = reader.i16be();
    const areas: JasArea[] = [{ mapNeighbors: 0, box: NO_BOX, bottomScaleFactor: 0, topScaleFactor: 0, object: 0 }];
    for (let i = 0; i < areaCount; i++) {
      areas.push({
        mapNeighbors: reader.i16be(),
        box: readBox(reader),
        bottomScaleFactor: reader.u16be(),
        topScaleFactor: reader.u16be(),
        object: reader.u16be(),
      });
    }
    rooms.push({ objectCount: roomObjects, areas });
  }
  const objectBoxes: Box[] = [NO_BOX];
  for (let i = 0; i < objectCount; i++) objectBoxes.push(readBox(reader));

  const walkOffCount = reader.u16be();
  const walkOffs = table<JasWalkOff>(walkOffCount, { entryObject: 0, x: 0, y: 0 }, () => ({
    entryObject: reader.i16be(),
    x: reader.u16be(),
    y: reader.u16be(),
  }));

  const descriptionRecords = reader.u16be();
  const objectDescriptions = table<JasObjectDescription>(
    descriptionRecords,
    { object: 0, type: 0, lastDescription: 0, lastSeenNumber: 0 },
    () => ({ object: reader.u16be(), type: reader.u16be(), lastDescription: reader.u16be(), lastSeenNumber: reader.u16be() }),
  );

  // Commandes (`Command::readCommandsFrom`).
  const appliedFixes: string[] = [];
  const lists = table<JasCommand>(
    reader.u16be(),
    { verb: 0, object1: 0, object2: 0, song: 0, setAreas: false, setObjects: false, setItems: false, setConditions: false, imageOrder: 0, specialSection: 0 },
    () => ({
      verb: reader.u16be(),
      object1: reader.i16be(),
      object2: reader.i16be(),
      song: reader.i16be(),
      setAreas: reader.u16be() !== 0,
      setObjects: reader.u16be() !== 0,
      setItems: reader.u16be() !== 0,
      setConditions: reader.u16be() !== 0,
      imageOrder: reader.i16be(),
      specialSection: reader.i16be(),
    }),
  );
  const commandAreas = table<JasCommandArea>(reader.u16be(), { id: 0, area: 0, room: 0 }, () => ({
    id: reader.i16be(),
    area: reader.i16be(),
    room: reader.u16be(),
  }));
  const commandObjects = table<JasCommandObject>(reader.u16be(), { id: 0, destination: 0, source: 0 }, () => ({
    id: reader.i16be(),
    destination: reader.i16be(),
    source: reader.i16be(),
  }));
  const fixed = commandObjects[175];
  if (fixed && fixed.id === 320 && fixed.destination === 307 && fixed.source === 309) {
    fixed.destination = 308;
    appliedFixes.push("commande d'objet 175 : copie de 309 vers 308 et non 307 (bug 3536 de ScummVM)");
  }
  const commandInventory = table<JasCommandInventory>(reader.u16be(), { id: 0, destination: 0, source: 0 }, () => ({
    id: reader.i16be(),
    destination: reader.i16be(),
    source: reader.i16be(),
  }));
  const commandStates = table<JasCommandState>(reader.u16be(), { id: 0, slot: 0, value: 0, speakValue: 0 }, () => ({
    id: reader.i16be(),
    slot: reader.i16be(),
    value: reader.i16be(),
    speakValue: reader.u16be(),
  }));

  const entryObject = reader.u16be();

  const furnitureCount = reader.u16be();
  const furniture = table<JasFurniture>(furnitureCount, { room: 0, object: 0 }, () => ({ room: reader.i16be(), object: reader.i16be() }));

  const actorCount = reader.u16be();
  const actorAnimationCount = reader.u16be();
  const actorNameCount = reader.u16be();
  const actorFileCount = reader.u16be();
  const actors = table<JasActor>(
    actorCount,
    { room: 0, bobNumber: 0, name: 0, stateSlot: 0, stateValue: 0, color: 0, standingFrame: 0, x: 0, y: 0, animation: 0, bank: 0, file: 0 },
    () => {
      const actor: JasActor = {
        room: reader.i16be(),
        bobNumber: reader.i16be(),
        name: reader.u16be(),
        stateSlot: reader.i16be(),
        stateValue: reader.i16be(),
        color: reader.u16be(),
        standingFrame: reader.u16be(),
        x: reader.u16be(),
        y: reader.u16be(),
        animation: reader.u16be(),
        bank: reader.u16be(),
        file: reader.u16be(),
      };
      if (actor.file === 0) actor.bank = 15;
      return actor;
    },
  );

  const graphicAnimations = table<JasGraphicAnimation>(reader.u16be(), { keyFrame: 0, frame: 0, speed: 0 }, () => ({
    keyFrame: reader.i16be(),
    frame: reader.i16be(),
    speed: reader.u16be(),
  }));

  const endOffset = reader.offset;
  if (endOffset + 6 > bytes.length) throw new Error("QUEEN.JAS invalide : fichier tronqué");
  return {
    roomCount,
    nameCount,
    objectCount,
    descriptionCount,
    objects,
    roomFirstObject,
    roomSfx,
    items,
    graphics,
    rooms,
    objectBoxes,
    walkOffs,
    objectDescriptions,
    commands: { lists, areas: commandAreas, objects: commandObjects, inventory: commandInventory, states: commandStates },
    entryObject,
    furniture,
    actorAnimationCount,
    actorNameCount,
    actorFileCount,
    actors,
    graphicAnimations,
    version: reader.fixedString(6),
    endOffset,
    appliedFixes,
  };
}
