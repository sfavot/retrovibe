import { PALETTE_BYTES } from "../../../ui/indexed-canvas";

/**
 * Offset fichier de la palette dans `AM1.EXE` : `DGROUP:5512` (`1005:00af`), soit 224 624 + 0x5512. DGROUP commence à
 * l'offset 224 624 (voir `docs/armaeth/re-index.md`). Le pointeur de palette n'est écrit qu'une fois (`1005:00af`) :
 * le moteur n'a qu'une palette, passée au pilote vidéo (entrée `+0x4a` de sa table) par `gm_init_video` et reposée par
 * la boucle principale, les scripts et les fondus.
 */
export const PALETTE_OFFSET = 246402;

/** Tables de recoloration de 256 octets juste avant la palette (`DGROUP:5312` et `5412`, `1f94:0119` et `1f94:0141`). */
export const RECOLOR_TYPE1_OFFSET = 245890;
export const RECOLOR_TYPE2_OFFSET = 246146;

/** Taille d'AM1.EXE (version CD) : garde-fou contre un autre exécutable. */
const EXE_BYTES = 254892;

export interface RecolorTables {
  /** `DGROUP:5312` : couches de type 1 en mode VGA. */
  type1: Uint8Array;
  /** `DGROUP:5412` : couches de type 2 hors mode VGA (jamais appliquée en VGA, conservée pour mémoire). */
  type2: Uint8Array;
}

function check(exe: Uint8Array): void {
  if (exe.length !== EXE_BYTES)
    throw new Error(
      `AM1.EXE inattendu : ${exe.length} octets au lieu de ${EXE_BYTES}`,
    );
}

/** Palette VGA 6 bits de 256 couleurs (768 valeurs de 0 à 63), à convertir par `vga6ToRgb8`. L'entrée 255 est la clé de transparence des sprites. */
export function readDefaultPalette(exe: Uint8Array): Uint8Array {
  check(exe);
  const palette = exe.slice(PALETTE_OFFSET, PALETTE_OFFSET + PALETTE_BYTES);
  if (palette.some((v) => v > 63))
    throw new Error("Palette AM1.EXE invalide : valeur supérieure à 63");
  return palette;
}

export function readRecolorTables(exe: Uint8Array): RecolorTables {
  check(exe);
  return {
    type1: exe.slice(RECOLOR_TYPE1_OFFSET, RECOLOR_TYPE1_OFFSET + 256),
    type2: exe.slice(RECOLOR_TYPE2_OFFSET, RECOLOR_TYPE2_OFFSET + 256),
  };
}
