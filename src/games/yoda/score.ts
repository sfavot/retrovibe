/**
 * « Force Factor » de Yoda Stories (WebFun `engine/score.ts`), sur 1000 :
 * temps (200) + secteurs visités (100) + difficulté (400) + puzzles résolus (300), plus 0 à 8 au hasard sous 1000.
 */
export interface ForceFactorInput {
  /** Temps de jeu (secondes). */
  seconds: number;
  /** Taille du monde (1 à 3) : le temps attendu est de 5 minutes par unité. */
  worldSize: number;
  visitedSectors: number;
  totalSectors: number;
  /** 0 à 100. */
  difficulty: number;
  solvedPuzzles: number;
  totalPuzzles: number;
  /** Tirage `rand() % 9` de l'original. */
  bonus: number;
}

const clamp = (min: number, value: number, max: number) => Math.min(max, Math.max(min, value));
const ratioScore = (part: number, total: number) => clamp(10, Math.ceil((total > 0 ? part / total : 0) * 10) * 10, 100);

export function forceFactor(s: ForceFactorInput): number {
  const overtime = Math.floor(s.seconds / 60) - 5 * s.worldSize;
  const time = clamp(0, 200 - 20 * overtime, 200);
  const visited = ratioScore(s.visitedSectors, s.totalSectors);
  const difficulty = s.difficulty < 0 || s.difficulty > 100 ? 0 : clamp(1, Math.ceil(s.difficulty / 10), 10) * 40;
  const puzzles = ratioScore(s.solvedPuzzles, s.totalPuzzles) * 3;
  let score = time + visited + difficulty + puzzles;
  if (score < 1000) score += s.bonus;
  return clamp(0, score, 1000);
}
