import { BinaryReader } from "../../../data/reader";

/**
 * État du monde : `A1FCFG.SYS` (état initial), `SVG001.STD` (identique octet pour octet), `A1FTMP.SVG`
 * (instantané de même format) et les sauvegardes `svgNNN`. Lecture : `gm_load_world` `192e:0008`,
 * écriture : `gm_save_world` `1d4a:0002`. Disposition (certain, total exact 21 868 octets pour `CFG`) :
 * en-tête de 54 octets, table de score (8 octets), file d'événements différés (12 octets), salles de 42 octets,
 * objets de 144 octets. Le moteur est décrit dans `docs/armaeth/engine.md` (§ 5, § 6, § 9.3) ; la « table de zones »
 * des premières études est en fait la table de score.
 */

export const WORLD_SIGNATURE = [0x786b, 0x00ca] as const;
export const WORLD_HEADER_WORDS = 27;
export const SCORE_ENTRY_BYTES = 8;
export const DEFERRED_EVENT_BYTES = 12;
export const ROOM_BYTES = 42;
export const OBJECT_BYTES = 144;
/** Nombre d'emplacements de sortie d'une salle. */
export const EXIT_SLOTS = 6;
/** Emplacement opposé de chaque emplacement de sortie (`DGROUP:4ba0`, `1aba:0310`) : les sorties sont symétriques. */
export const OPPOSITE_EXIT = [2, 3, 0, 1, 5, 4] as const;

export interface WorldHeader {
  /** Les 27 mots de l'en-tête de 54 octets, tels quels. Les nommés ci-dessous en sont des vues. */
  words: number[];
  /** Mot 2 : dernier numéro de série d'objet attribué (`++DGROUP:4b4a` à la création d'un objet). */
  lastSerial: number;
  /** Mot 3, octet bas : nombre de lettres significatives du dictionnaire (`DGROUP:4b4c`, lu par `gm_dic_lookup`). */
  dictionaryLetters: number;
  /** Mot 4 : chapitre * 100 + niveau (`DGROUP:4b4e`, 3 à l'état initial). */
  chapterLevel: number;
  /** Mot 10 : score courant (`DGROUP:4b5a`, 0 à l'état initial). */
  score: number;
  /** Mot 11 : numéro de série de l'objet héros (`DGROUP:4b5c`). */
  heroSerial: number;
  /** Mot 12 : identifiant de la salle courante (`DGROUP:4b5e`). */
  currentRoom: number;
  /** Mot 13 : nombre d'objets (`DGROUP:4b60`). */
  objectCount: number;
  /** Mot 14 : nombre de salles (`DGROUP:4b62`). */
  roomCount: number;
}

/**
 * Entrée de la table de score (`DGROUP:5218`, section 2 du monde, 8 octets), lue par `2255:00e8` (`engine.md` § 9.3).
 * `id = chapitre * 100 + indice` (0-5, 100-108, 200-205, 300-313 dans `CFG`).
 */
export interface ScoreEntry {
  id: number;
  /** Points à attribuer (5, 10, 20, 30, 40 ou 50) ; la valeur est passée en négatif une fois attribuée. */
  points: number;
  /** Jingle à jouer à l'attribution (0 = aucun ; 11, 12, 13, 15 dans `CFG`). */
  sound: number;
  /** Répétitions restantes du jingle (0 dans `CFG`). */
  repeats: number;
}

/**
 * Entrée de la file d'événements différés (`23a2:0002` / `23a2:0250`, section 3 du monde, 12 octets) :
 * `{Typ, Num, Ser, événement, compteur, procédure}` (`engine.md` § 9.3). Le compteur décroît à chaque tic.
 */
export interface DeferredEvent {
  typ: number;
  num: number;
  serial: number;
  event: number;
  counter: number;
  procedure: number;
}

/**
 * Salle : 42 octets (`engine.md` § 5.1). Les mots 17 à 20 (octets 0x22-0x2A) sont les têtes de deux listes
 * d'objets, remises à zéro au chargement : sans valeur dans le fichier.
 */
export interface WorldRoom {
  /** Mot 0 : identifiant de scène (`gm_find_scene` `1e0e:0000`). */
  id: number;
  /** +0x02 : décalage de lumière (0 sauf salle 7 : -32). */
  lightOffset: number;
  /** +0x04 : non nul = extérieur (reçoit la lumière du jour). */
  outdoor: number;
  /** +0x05, +0x06, +0x08 : classe (`M`), identifiant et numéro de la musique (`audio.md`). */
  musicClass: number;
  musicId: number;
  musicNumber: number;
  /** +0x0A : indice (dans la table des salles) de la salle voisine par emplacement 0..5, 0 = pas de sortie. */
  exits: number[];
  /** +0x16 : code de barrage par emplacement (0 = libre), évalué par `1414:0006`. */
  barriers: number[];
  /** Les 21 mots de l'enregistrement (offset = 2 × indice). */
  words: number[];
}

/**
 * Objet : 144 octets (0x90). Les noms viennent de la fenêtre de débogage `gm_dump_object` `1265:0008`
 * (`engine.md` § 6.1, qui remplace la table de `re-index.md`) ; le nom du jeu est donné entre parenthèses.
 * Les pointeurs lointains (`+0x5C`, `+0x7C..+0x8F`) ne valent rien hors mémoire : le fichier y met l'id de salle
 * ou la série du conteneur.
 */
export interface WorldObject {
  /** +0x00 `Num` : identifiant de la ressource sprite et de `DEF` ; clé des tables de comportement. */
  num: number;
  /** +0x02 `Ser` : numéro de série, unique. */
  serial: number;
  /** +0x04 `Typ` : 0 = `INT`, 1 = `DEC`, 2 = `OBJ` (famille de sprites). */
  typ: number;
  /** +0x05 `Gst` : 7 = l'objet a une procédure de comportement. */
  gst: number;
  /** +0x06 `Mob` : 0 statique, 1 animé sur place, 2 mobile. */
  mob: number;
  /** +0x07 `Dep` : classe de déplacement. */
  dep: number;
  /** +0x08 `Txt` : classe de description (0 : soumis au test de profondeur). */
  txt: number;
  /** +0x0A `Lum` : lumière émise (16 ou 32 pour les torches). */
  light: number;
  /** +0x18 `Val` : valeur (>= 10 : trésor, compté à l'écran de fin). */
  value: number;
  /** +0x1A `Pds` : poids. */
  weight: number;
  /** +0x1C `Chg` : capacité (charge maximale du contenu). */
  capacity: number;
  /** +0x1E `Ram` : 7 = ramassable. */
  pickable: number;
  /** +0x1F `Ctn` : 7 = peut contenir d'autres objets. */
  canContain: number;
  /** +0x2D `Ego` : classe d'IA. */
  ego: number;
  /** +0x2E `Fig` : indice d'animation. */
  fig: number;
  /** +0x2F `Inv` : non nul = objet invisible, dessiné en transparence (couleur du fond + valeur ; voir `objects.md`, pilote `VGA.EXE`). */
  hidden: number;
  /** +0x30 `Anm` : non nul = ressource d'animation `ANM` de cet identifiant. */
  animId: number;
  /** +0x52 `Xyp` : présence (0 absent, 1 salle non chargée, 2 posé dans la salle chargée, 6/8/0x0B icônes). */
  presence: number;
  /** +0x53 `N` : plan de marche (0..2). */
  plane: number;
  /** +0x54, +0x56, +0x58 `X`, `Y`, `P` : X au centre, Y au pied, P profondeur (mots signés ; X <= 320). */
  x: number;
  y: number;
  p: number;
  /** +0x5A `Sol` : type de case sous les pieds. */
  ground: number;
  /** +0x5B `Cod` : 1 = dans une salle, 2 = dans un objet, 3 = objet d'interface rattaché à la salle d'indice 0, 4 = transitoire. */
  location: number;
  /** +0x5C : identifiant de la salle (`location` = 1) ou numéro de série de l'objet contenant (`location` = 2). */
  container: number;
  /** +0x60, +0x61, +0x62 `Hor`, `Ver`, `Prf` : vitesse (-1, 0, +1) selon X, Y, P. */
  speedX: number;
  speedY: number;
  speedP: number;
  /** Les 144 octets (champs non nommés : +0x0C `Ftn`, +0x20.. `Mc1..4`, +0x34.. `Rep/Nbr/Sys/Bag`, trajet +0x63..+0x77...). */
  raw: Uint8Array;
}

export interface World {
  header: WorldHeader;
  /** Table de score (35 entrées dans `CFG`, maximum 725). */
  scoreTable: ScoreEntry[];
  /** File d'événements différés (`DGROUP:523a`) : capacité et entrées (vide dans `CFG` et `TMP.SVG`). */
  deferredEvents: { capacity: number; events: DeferredEvent[] };
  rooms: WorldRoom[];
  objects: WorldObject[];
}

/** Score maximal : somme des valeurs absolues de la table de score (725 dans `CFG`, `2255:00e8` avec l'argument -1). */
export function maxScore(world: World): number {
  return world.scoreTable.reduce((sum, entry) => sum + Math.abs(entry.points), 0);
}

/** Lit un état du monde ; lève si la signature ou les tailles sont fausses ou s'il reste des octets. */
export function parseWorld(bytes: Uint8Array): World {
  const r = new BinaryReader(bytes);
  const need = (size: number) => {
    if (r.length - r.offset < size) throw new Error("Monde invalide : fichier tronqué");
  };
  need(2 * WORLD_HEADER_WORDS);
  const words: number[] = [];
  for (let i = 0; i < WORLD_HEADER_WORDS; i++) words.push(r.u16());
  if (words[0] !== WORLD_SIGNATURE[0] || words[1] !== WORLD_SIGNATURE[1]) throw new Error("Monde invalide : signature");
  const header: WorldHeader = {
    words,
    lastSerial: words[2],
    dictionaryLetters: words[3] & 0xff,
    chapterLevel: words[4],
    score: words[10],
    heroSerial: words[11],
    currentRoom: words[12],
    objectCount: words[13],
    roomCount: words[14],
  };

  need(2);
  const scoreCount = r.u16();
  if (scoreCount < 1 || scoreCount > 100) throw new Error(`Monde invalide : ${scoreCount} entrées de score`);
  need(SCORE_ENTRY_BYTES * scoreCount);
  const scoreTable: ScoreEntry[] = [];
  for (let i = 0; i < scoreCount; i++) scoreTable.push({ id: r.u16(), points: r.i16(), sound: r.u16(), repeats: r.u16() });

  need(4);
  const capacity = r.u16();
  const eventCount = r.u16();
  need(DEFERRED_EVENT_BYTES * eventCount);
  const events: DeferredEvent[] = [];
  for (let i = 0; i < eventCount; i++) {
    events.push({ typ: r.u16(), num: r.u16(), serial: r.u16(), event: r.u16(), counter: r.u16(), procedure: r.u16() });
  }

  need(ROOM_BYTES * header.roomCount);
  const rooms: WorldRoom[] = [];
  for (let i = 0; i < header.roomCount; i++) {
    const roomWords: number[] = [];
    for (let w = 0; w < ROOM_BYTES / 2; w++) roomWords.push(r.u16());
    const slots = (from: number) => roomWords.slice(from, from + EXIT_SLOTS);
    rooms.push({
      id: roomWords[0],
      lightOffset: (roomWords[1] << 16) >> 16,
      outdoor: roomWords[2] & 0xff,
      musicClass: roomWords[2] >> 8,
      musicId: roomWords[3],
      musicNumber: roomWords[4],
      exits: slots(5),
      barriers: slots(11),
      words: roomWords,
    });
  }

  need(OBJECT_BYTES * header.objectCount);
  const objects: WorldObject[] = [];
  for (let i = 0; i < header.objectCount; i++) {
    const raw = r.bytesView(OBJECT_BYTES);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    objects.push({
      num: view.getUint16(0, true),
      serial: view.getUint16(2, true),
      typ: raw[4],
      gst: raw[5],
      mob: raw[6],
      dep: raw[7],
      txt: raw[8],
      light: view.getInt16(0x0a, true),
      value: view.getInt16(0x18, true),
      weight: view.getInt16(0x1a, true),
      capacity: view.getInt16(0x1c, true),
      pickable: raw[0x1e],
      canContain: raw[0x1f],
      ego: raw[0x2d],
      fig: raw[0x2e],
      hidden: raw[0x2f],
      animId: view.getUint16(0x30, true),
      presence: raw[0x52],
      plane: raw[0x53],
      x: view.getInt16(0x54, true),
      y: view.getInt16(0x56, true),
      p: view.getInt16(0x58, true),
      ground: raw[0x5a],
      location: raw[0x5b],
      container: view.getUint16(0x5c, true),
      speedX: view.getInt8(0x60),
      speedY: view.getInt8(0x61),
      speedP: view.getInt8(0x62),
      raw,
    });
  }
  if (!r.isAtEnd) throw new Error(`Monde invalide : ${r.length - r.offset} octets en trop`);
  return { header, scoreTable, deferredEvents: { capacity, events }, rooms, objects };
}
