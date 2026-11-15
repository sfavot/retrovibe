/**
 * Services de zone et de création de pièces : désormais dans le noyau (`engine/zone.ts`). Ce module les réexporte pour
 * les handlers de la famille, avec `extra`, vue sur les champs de `Part` qui vivaient ici dans une table annexe
 * (+0xB8 / +0xB9 = `ropeAnchor[8]` / `[9]`, +0xC8 / +0xCC = `fC8` / `fCC`).
 */
import { computeEdgeAngles } from "../../move";
import type { Part } from "../../part";

export { addMobile, boxScan, chain, createPart, hotspotScan, imageScan, usesBox, wakeInBeam } from "../../zone";

export interface Extra {
  /** +0xB8 / +0xB9 : point d'accroche (octets signés). */
  anchorX: number;
  anchorY: number;
  /** +0xC8 / +0xCC : écart par rapport à la pièce qui a trouvé celle-ci (434cc4). */
  relX: number;
  relY: number;
}

export function extra(p: Part): Extra {
  return {
    get anchorX() {
      return p.ropeAnchor[8]!;
    },
    set anchorX(v: number) {
      p.ropeAnchor[8] = v;
    },
    get anchorY() {
      return p.ropeAnchor[9]!;
    },
    set anchorY(v: number) {
      p.ropeAnchor[9] = v;
    },
    get relX() {
      return p.fC8;
    },
    set relX(v: number) {
      p.fC8 = v;
    },
    get relY() {
      return p.fCC;
    },
    set relY(v: number) {
      p.fCC = v;
    },
  };
}

export { computeEdgeAngles };
