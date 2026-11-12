/**
 * Inventaire des 337 ressources des quatre disques : à quel type appartient chacune, et lesquelles le portage ignore.
 *
 * Attribution : par références (calques des pièces `RoomData.layers`, identifiants d'animations des `HotspotAnimRecord`) et par les
 * identifiants que le moteur de ScummVM cite (`luredefs.h`, `intro.cpp`, `game.cpp`, `scripts.cpp`, `surface.cpp` : introduction, séquences
 * plein écran, fin, générique, redémarrage, tonneau, chute, capture par le Skorl). Les palettes de pièce suivent la règle
 * `(écran & 0xFFE0) - 1` (`RoomLayer`) : ce sont les ressources de 660 octets (220 couleurs ; `0x9BFF` en a 128).
 *
 * Mesuré : tous les disques sont attribués (aucune ressource « inconnue »). Cas particuliers :
 * - `0x400E` (37 504 octets) n'est citée par aucune table du jeu ni par le moteur de ScummVM : `unused`, format non identifié ;
 * - `0x0003` (920 octets) a la taille de la police (`0x0004`) mais ScummVM ne la lit jamais : `font-unused` ;
 * - `0x0A` et `0x0F` sont du code x86 (pilotes de son du DOS), jamais exécuté : `driver-code`, ignoré ;
 * - le sous-ensemble Roland (`0x0B`, `0x0C`, `0x30`, `0xFF10`) et la protection de copie (`0x4138` à `0x413C`, D2) sont ignorés ;
 * - `0xFF00` est la palette de la fin, mais un enregistrement d'animation (hotspot `30012`) la désigne aussi comme animation : jamais
 *   activé, `Hotspot::setAnimation` planterait (`numEntries >= 1`).
 *
 * Écrit pour ce projet ; pas de référence ScummVM pour le classement lui-même.
 */

import { DiskResId } from "./ids";
import type { LureResources } from "./container";
import type { HotspotAnimRecord, RoomData } from "./lure-dat";

export type ResourceKind =
  | "lure-dat"
  | "palette"
  | "palette-collection"
  /** Écran de 320 x 192 (calque de pièce, écran d'introduction, générique, redémarrage). */
  | "screen"
  /** Image de sprites d'un hotspot (`decodeAnimation`). */
  | "animation"
  /** Écran de départ d'une séquence plein écran (`AnimationSequence`), et sa ressource « lignes » `id + 1`. */
  | "sequence-screen"
  | "sequence-lines"
  | "sound-adlib"
  | "sound-roland"
  | "driver-code"
  | "protection"
  | "cursors"
  | "font"
  | "font-unused"
  | "menu-bar"
  | "names"
  | "strings"
  | "unused"
  | "unknown";

export interface CatalogEntry {
  id: number;
  /** 0 pour `lure.dat`, sinon 1 à 4. */
  disk: number;
  size: number;
  kind: ResourceKind;
  /** Vrai pour ce que le portage ne lit pas (Roland, protection, code x86, ressource sans emploi). */
  ignored: boolean;
}

const IGNORED: ReadonlySet<ResourceKind> = new Set<ResourceKind>(["sound-roland", "driver-code", "protection", "font-unused", "unused"]);

/** Séquences plein écran : écran de départ (la ressource `id + 1` porte les lignes). */
const SEQUENCE_SCREENS = [0x40, 0x42, 0x44, 0x24, 0x46, 0x48, 0x404d, 0x404f, 0x4051, 0x4061, 0xe9f1, 0xff01, 0xff03, 0xff05];

/** Écrans de l'introduction, du générique et du redémarrage (identifiants cités par le moteur). */
const NAMED_SCREENS = [0x18, 0x1a, 0x1c, 0x1e, 0x22, 0x7800, 0x7900];

/** Animations de remplacement de la zone (`Disk::getEntry` inverse le bit `0x8000` quand `AREA_FLAG` est non nul). */
const AREA_ANIMATIONS = [0xc008, 0xc120, 0xc311, 0xc410];

export function classifyResources(res: LureResources, rooms: readonly RoomData[], anims: readonly HotspotAnimRecord[]): CatalogEntry[] {
  const explicit = new Map<number, ResourceKind>();
  const set = (kind: ResourceKind, ...ids: number[]): void => ids.forEach((id) => explicit.set(id, kind));
  set("cursors", DiskResId.cursors);
  set("font-unused", DiskResId.fontAlt);
  set("font", DiskResId.font);
  set("menu-bar", DiskResId.menu);
  set("names", DiskResId.names);
  set("strings", DiskResId.strings, DiskResId.strings2, DiskResId.strings3);
  set("palette-collection", DiskResId.introPalettes);
  set("driver-code", 0x0a, 0x0f);
  set("sound-roland", DiskResId.rolandMainSysex, DiskResId.rolandMainSound, DiskResId.rolandIntroSound, DiskResId.rolandEndgameSound);
  set("sound-adlib", DiskResId.adlibMainSound, DiskResId.adlibIntroSound, DiskResId.adlibEndgameSound);
  set("protection", 0x4138, 0x4139, 0x413a, 0x413b, 0x413c);
  set("unused", 0x400e);
  set("palette", 0xff00);
  set("screen", ...NAMED_SCREENS);
  set("animation", ...AREA_ANIMATIONS);
  set("sequence-screen", ...SEQUENCE_SCREENS);
  set("sequence-lines", 0x23, ...SEQUENCE_SCREENS.map((id) => id + 1));

  const layers = new Set(rooms.flatMap((room) => room.layers));
  const animIds = new Set(anims.map((anim) => anim.animId));

  return res.allIds().map((id): CatalogEntry => {
    const disk = id >> 8 === 0x3f ? 0 : ((id >> 14) & 3) + 1;
    const size = res.size(id);
    let kind: ResourceKind;
    if (disk === 0) kind = "lure-dat";
    else if (explicit.has(id)) kind = explicit.get(id)!;
    else if (layers.has(id)) kind = "screen";
    else if (animIds.has(id)) kind = "animation";
    else if (size === RES_PALETTE_BYTES || id === 0x9bff) kind = "palette";
    else kind = "unknown";
    return { id, disk, size, kind, ignored: IGNORED.has(kind) };
  });
}

const RES_PALETTE_BYTES = 220 * 3;
