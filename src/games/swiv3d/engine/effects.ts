/**
 * Effets visuels pour le rendu (`world.effects()`). Dans l'exe les explosions, impacts et fumées sont de vrais objets du pool
 * (modèle ≥ 11000, `+0x50` = image) : ils restent des objets (donc comptés par `liveObjects`) et cette vue les expose sous la
 * forme attendue par le rendu des sprites `GLOBAL 504`.
 */
import type { GameObject } from "./objects";

export interface Effect {
  /** `impact` : éclat de balle ou d'éclat au sol (modèle 11000) ; `explosion` : explosions, fumées et traînées (11001-11004). */
  kind: "explosion" | "impact";
  /** Planche de sprites `GLOBAL` : 504 (images 64×64 mises à l'échelle). La planche 505 (balles, modèles 10000-10999) est celle d'objets ordinaires. */
  set: 504 | 505;
  /** Image dans la planche (`+0x50` de l'objet). */
  frame: number;
  /** Position Q8 (comme les objets). */
  x: number;
  y: number;
  z: number;
  /** Série de taille : `modèle - 11000` (0 = impact, 1 = fumée de missile, 2 = petite explosion, 3 = grande explosion, 4 = fumée montante). */
  size: number;
}

/** Modèles de sprite d'effet (`0x2af8`-`0x2afc` = 11000-11004). */
export const FX_MODEL_FIRST = 11000;
export const FX_MODEL_LAST = 11004;

export function toEffect(o: GameObject): Effect {
  const size = o.model - FX_MODEL_FIRST;
  return {
    kind: size === 0 ? "impact" : "explosion",
    set: 504,
    frame: o.state,
    x: o.x,
    y: o.y,
    z: o.z,
    size,
  };
}
