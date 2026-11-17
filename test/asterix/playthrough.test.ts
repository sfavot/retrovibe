import { describe, expect, it } from "vitest";
import { hasOriginalFiles } from "./helpers";
import { Robot, type RobotOptions, type RobotReport } from "./playthrough/robot";

/**
 * Parcours sans tête d'Astérix : des parties complètes, du menu principal au menu principal, jouées par un robot sur le
 * moteur de test (`playthrough/robot.ts`). Les mini-jeux portés sont joués par leur robot (`minigames/players.ts`), les
 * autres sont l'écran provisoire ; gagnés ou perdus selon la politique.
 *
 * Le temps est simulé : les quatre parties (jusqu'à 30 minutes de jeu chacune) se jouent en une quinzaine de secondes
 * réelles, donc le parcours fait partie de `npm test`.
 *
 *     npx vitest run test/asterix/playthrough.test.ts --reporter=verbose
 *
 * `PLAY_DEBUG=1` journalise les écrans rencontrés ; `PLAY_ONLY=n` ne joue que le scénario `n` (à partir de 0) ;
 * `ASTERIX_SHOTS=/un/dossier` écrit des captures (première apparition de chaque écran et de chaque type de case).
 */
const env = process.env;

const SCENARIOS: (RobotOptions & { name: string; expected: RobotReport["outcome"] })[] = [
  { name: "1 joueur, victoire", seed: 11, characters: [0], durationIndex: 3, aim: "victory", expected: "victoire" },
  { name: "4 joueurs, victoire", seed: 23, characters: [0, 1, 4, 5], durationIndex: 3, aim: "victory", expected: "victoire" },
  { name: "1 joueur, temps écoulé", seed: 5, characters: [3], durationIndex: 0, aim: "timeout", expected: "temps écoulé" },
  { name: "4 joueurs, temps écoulé", seed: 42, characters: [2, 3, 1, 0], durationIndex: 0, aim: "timeout", expected: "temps écoulé" },
];

function describeReport(name: string, r: RobotReport, realSeconds: number): string {
  const list = (record: Record<string | number, number>): string =>
    Object.entries(record)
      .map(([key, count]) => `${key}×${count}`)
      .join(", ");
  return [
    `${name} : ${r.outcome} après ${r.rounds} tours de table, ${r.simulatedSeconds} s simulées (${r.frames} images, ${realSeconds.toFixed(0)} s réelles)`,
    `  écrans : ${list(r.screens)}`,
    `  cases jouées (par type) : ${list(r.squares)}`,
    `  mini-jeux portés joués (par module) : ${list(r.minigames) || "aucun"}`,
    `  sauvegardes : ${r.saves} ; retour au menu : ${r.backToMenu ? "oui" : "NON"} ; fichiers manquants : ${r.missing.join(", ") || "aucun"}`,
  ].join("\n");
}

describe.skipIf(!hasOriginalFiles)("parties d'Astérix jouées par un robot", () => {
  SCENARIOS.forEach((scenario, index) => {
    it.skipIf(env.PLAY_ONLY !== undefined && Number(env.PLAY_ONLY) !== index)(scenario.name, { timeout: 3_600_000 }, async () => {
      const started = Date.now();
      const robot = new Robot({ ...scenario, log: env.PLAY_DEBUG === "1" ? (message) => console.log(message) : undefined });
      const report = await robot.play();
      console.log(describeReport(scenario.name, report, (Date.now() - started) / 1000));
      expect(report.missing).toEqual([]);
      expect(report.outcome).toBe(scenario.expected);
      expect(report.backToMenu).toBe(true);
      // Une sauvegarde par tour joué (le compteur de tours de table a une avance d'un sur les tours finis).
      expect(report.saves).toBeGreaterThanOrEqual(report.rounds - 1);
    });
  });
});
