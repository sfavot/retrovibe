/**
 * Table des animations de strike (`1108:0974`, screens/bowling.md §1.9) : 69 ids `\0SCR` de `BOWLING.DAT` suivis du mot `0xFFFF`
 * (la table du segment de données compte 70 mots). Indices 0 à 48 : animations courantes ; 49 à 68 : « spéciales » (3e, 6e et 10e strike).
 * Lue dans le segment de données de `MATH` (segment NE 34, décalage `0974`).
 */
export const STRIKE_SCRIPTS: readonly number[] = [
  10200, 10300, 10400, 10500, 10600, 10700, 10900, 11000, 11100, 11200, 11400, 11500, 11700, 11800, 12000, 12100, 12200, 12400, 12500, 12600,
  12700, 13200, 13300, 13400, 13500, 13600, 13700, 13800, 13900, 14000, 14100, 14200, 14400, 14500, 14600, 14700, 14800, 15000, 15100, 15400,
  15800, 16000, 16200, 16400, 16600, 16900, 17400, 17500, 17900,
  // spéciales
  10000, 10100, 10800, 11300, 11600, 11900, 12300, 12800, 12900, 13000, 13100, 14300, 14900, 15200, 15300, 15500, 15600, 15700, 15900, 16100,
];

/** Animation de strike qui ne rejoue pas la pose finale de Gus (`1010:397f` : comparaison avec `3200h`). */
export const STRIKE_WITHOUT_EPILOGUE = 12800;

/** Id du script `SCR` de l'animation `index` (0 à 68, `StrikeResult.animation`). */
export function strikeScriptId(index: number): number {
  const id = STRIKE_SCRIPTS[index];
  if (id === undefined) throw new RangeError(`animation de strike ${index} hors de 0 à ${STRIKE_SCRIPTS.length - 1}`);
  return id;
}
