/**
 * Constantes des formats SCI2 de Gabriel Knight (`docs/gk1/formats.md`) : numéros de types, méthodes de compression, signatures.
 * Valeurs relues dans `engines/sci/resource/resource.h` et `resource_intern.h` de ScummVM (GPL v3 ou ultérieure).
 */

/** Type d'une ressource, tel qu'écrit dans la map et l'en-tête de volume (bit 7 levé). */
export const ResourceType = {
  View: 0x80,
  Pic: 0x81,
  Script: 0x82,
  Text: 0x83,
  Sound: 0x84,
  Vocab: 0x86,
  Font: 0x87,
  Cursor: 0x88,
  Patch: 0x89,
  Bitmap: 0x8a,
  Palette: 0x8b,
  Audio: 0x8d,
  Sync: 0x8e,
  Message: 0x8f,
  Map: 0x90,
  Heap: 0x91,
} as const;
export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];

const TYPE_NAMES: Record<number, string> = Object.fromEntries(Object.entries(ResourceType).map(([name, value]) => [value, name.toLowerCase()]));

/** Nom d'un type (`view`, `heap`…), ou son numéro en hexadécimal s'il est inconnu. */
export function resourceTypeName(type: number): string {
  return TYPE_NAMES[type] ?? `0x${type.toString(16)}`;
}

/** Extension d'un fichier de patch (`PATCHES/316.SND`) → type. Seules celles que le CD utilise ou pourrait utiliser. */
export const PATCH_EXTENSIONS: Readonly<Record<string, ResourceType>> = {
  V56: ResourceType.View,
  P56: ResourceType.Pic,
  SCR: ResourceType.Script,
  HEP: ResourceType.Heap,
  SND: ResourceType.Sound,
  VOC: ResourceType.Vocab,
  FON: ResourceType.Font,
  PAT: ResourceType.Patch,
  PAL: ResourceType.Palette,
  MSG: ResourceType.Message,
  MAP: ResourceType.Map,
};

/** Méthodes de compression de l'en-tête de volume. Ce CD n'en utilise pas d'autre. */
export const COMPRESSION_NONE = 0;
export const COMPRESSION_LZS = 32;

/** Fin de la table des types de `RESOURCE.MAP`. */
export const MAP_END_OF_TYPES = 0xff;
/** En-tête de volume : type, numéro, taille compressée, taille décompressée, méthode. */
export const VOLUME_HEADER_SIZE = 13;

/** Numéros des vocabulaires. */
export const VOCAB_PROPERTY_OFFSETS = 994;
export const VOCAB_CLASS_TABLE = 996;
export const VOCAB_SELECTOR_NAMES = 997;
export const VOCAB_OPCODE_NAMES = 998;

/** Numéros des patchs sonores. */
export const PATCH_MT32 = 1;
export const PATCH_ADLIB = 3;
export const PATCH_GENERAL_MIDI = 4;

/** Map des bruitages numériques (les autres maps sont des modules audio36). */
export const SFX_MAP_NUMBER = 65535;

/** Premier mot de tout objet d'un heap. */
export const OBJECT_MAGIC = 0x1234;
/** Bit « classe » de la propriété `-info-`. */
export const INFO_CLASS = 0x8000;
/** Bit « clone » de `-info-` (jamais dans les fichiers : posé par `Clone`). */
export const INFO_CLONE = 0x0001;
/** Valeur de `-script-` (espèce) d'une instance. */
export const SPECIES_INSTANCE = 0xffff;
/** `-super-` d'une classe racine. */
export const NO_SUPERCLASS = 0xffff;

/** Compression d'un cel de vue, de pic ou d'image SEQ. */
export const CEL_RAW = 0;
export const CEL_RLE = 0x8a;

/** Octet de résolution d'une vue (@5) : 320×200, 640×480, 640×400. */
export const VIEW_RESOLUTION_320X200 = 0;
export const VIEW_RESOLUTION_640X480 = 1;
export const VIEW_RESOLUTION_640X400 = 2;

/** Boucle de vue sans source (pas un miroir). */
export const LOOP_NOT_MIRRORED = 0xff;

/** Sons : type de la « piste » d'en-tête, fin de liste, canal d'échantillon numérique, canal de contrôle. */
export const SOUND_TRACK_HEADER = 0xf0;
export const SOUND_END = 0xff;
export const SOUND_DIGITAL_CHANNEL = 0xfe;
export const SOUND_CONTROL_CHANNEL = 15;
export const SOUND_END_OF_TRACK = 0xfc;

/** Périphériques des pistes d'un son (identifiants des pilotes d'origine, `docs/gk1/formats.md` § 10). Le 11 n'est pas identifié. */
export const SoundDevice = {
  AdLib: 0,
  AmigaMac: 6,
  GeneralMidi: 7,
  Cms: 9,
  Mt32: 12,
  PcSpeaker: 18,
  Tandy: 19,
} as const;

/** Toile des cinématiques SEQ. */
export const SEQ_WIDTH = 320;
export const SEQ_HEIGHT = 200;
