/**
 * Ressource `tBMP` de `MPC/PVG.MHK` : même format que `SHAP` (entête 8 octets + LZ 0x100 + RLE 0x10, voir `shap.ts`),
 * déduit des données (128 images décodées sans erreur ; le module qui les lit n'est pas dans MATH).
 */
import { decodeShap, type Shape } from "./shap";

export function decodeTbmp(bytes: Uint8Array): Shape {
  return decodeShap(bytes);
}
