/**
 * Courroie (8) : points des deux brins entre les poulies de deux pièces. Traduit de TIMWIN.EXE 438c70 ; slot 7 43f460
 * (création). Correspondance OpenTIM (GPL-3.0, TEMIM) : `c_src/main.c` `belt_set_four_pos`, `structures/BeltData.csv`.
 */
import type { BeltData, Part } from "../../part";

/**
 * 438c70 : points des brins de la courroie. Pour chaque pièce : centre de sa poulie (+0x88/+0x89 relatifs à la position)
 * moins son rayon (+0x8C) ; les brins passent de part et d'autre, décalés selon que la courroie est plutôt verticale.
 */
export function updateBeltEnds(belt: BeltData | null): void {
  if (!belt) return;
  const a = belt.end1!;
  const b = belt.end2 ?? a;
  const pos = belt.pos;
  pos[0] = (a.f88 + a.px - a.f8C) | 0;
  pos[1] = (a.f89 + a.py - a.f8C) | 0;
  pos[2] = (b.f88 + b.px - b.f8C) | 0;
  pos[3] = (b.f89 + b.py - b.f8C) | 0;
  const vertical = Math.abs(pos[0] - pos[2]) < Math.abs(pos[1] - pos[3]) ? 1 : 0;
  const horizontal = 1 - vertical;
  const da = (a.f8C + a.f8C) | 0;
  const db = (b.f8C + b.f8C) | 0;
  let ox1: number;
  let oy1: number;
  let ox2: number;
  let oy2: number;
  let sx1: number;
  let sy1: number;
  let sx2: number;
  let sy2: number;
  if (vertical) {
    ox1 = da;
    oy1 = da;
    ox2 = db;
    oy2 = db;
    sx1 = 0;
    sy1 = da >> 1;
    sx2 = 0;
    sy2 = db >> 1;
  } else {
    ox1 = da >> 1;
    oy1 = da;
    ox2 = db >> 1;
    oy2 = db;
    sx1 = da >> 1;
    sy1 = 0;
    sx2 = db >> 1;
    sy2 = 0;
  }
  pos[4] = (pos[0] + ox1 + vertical) | 0;
  pos[5] = (oy1 + pos[1] + horizontal) | 0;
  pos[6] = (pos[2] + ox2 + vertical) | 0;
  pos[7] = (oy2 + pos[3] + horizontal) | 0;
  pos[0] = (pos[0] + sx1 - vertical) | 0;
  pos[1] = (pos[1] + sy1 - horizontal) | 0;
  pos[2] = (pos[2] + sx2 - vertical) | 0;
  pos[3] = (pos[3] + sy2 - horizontal) | 0;
}

/** Courroie de la pièce de l'autre côté (OpenTIM `other_belt_part`). */
export function otherBeltEnd(p: Part): Part | null {
  const b = p.belt;
  if (!b) return null;
  return b.end1 === p ? b.end2 : b.end1;
}
