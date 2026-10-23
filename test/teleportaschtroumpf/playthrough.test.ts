import { describe, expect, it } from "vitest";
import { hasOriginalFiles } from "./helpers";
import { Robot, type SeedReport } from "./playthrough/robot";

/**
 * Robot joueur du Téléportaschtroumpf : des parties complètes, du menu S07 au menu S07, jouées comme un joueur sur le moteur de test
 * (entrées clavier simulées, temps simulé à 60 Hz). Diagnostic long, ignoré par `npm test` : activé avec `PLAY=1`.
 *
 *     PLAY=1 npx vitest run test/teleportaschtroumpf/playthrough.test.ts
 *
 * Déroulé d'une graine : Jouer (S07), S09 avec 1 à 4 joueurs (`1 + graine % 4`), S08 avec des personnages et niveaux tirés par la graine,
 * l'annonce S19, puis le plateau. Sur le plateau le robot choisit une porte avec les tables de `game/` (`DOORS`, classes de zone), marche
 * aux flèches jusqu'à sa zone et appuie sur Espace ; les pièges et événements du plateau sont subis. Dans un mini-jeu il joue avec le
 * pilote de `playthrough/pilots.ts` quand il existe (S22, 23, 28, 29, 30, 36 : repris des tests de `minigames/`), sinon au hasard
 * (`playthrough/random.ts` : flèches, Espace, Échap, pointeur). La partie va jusqu'à la victoire (S11) ou la fin du temps (S42), puis le
 * robot vérifie le retour au menu et la lecture de la vidéo de fin.
 *
 * Aides forcées (toujours listées dans le rapport) : un mini-jeu qui n'est pas fini après `PLAY_FORCE_SECONDS` secondes simulées voit son
 * issue imposée (`scene.onDone`, réussite). Avec le mode « coup de pouce » (une graine sur deux par défaut, `PLAY_ASSIST=1` pour toutes,
 * `PLAY_ASSIST=0` pour aucune), chaque mini-jeu est forcé en réussite après 4 s : c'est ce qui mène à la victoire en un temps raisonnable,
 * le jeu honnête s'achevant presque toujours à la fin du temps.
 *
 * Garde-fous : plafond de temps simulé (`PLAY_MAX_SECONDS`, 4000 par défaut) et détection de blocage (même scène et mêmes pixels pendant
 * `PLAY_STUCK_SECONDS`, 60 par défaut : une relance, puis aide forcée dans un mini-jeu ou abandon de la graine à 2 ×).
 *
 * Environnement : `PLAY_SEEDS=n` (nombre de graines, 10 par défaut), `PLAY_FROM=n` (première graine, 1), `PLAY_ONLY=n` (une seule graine),
 * `PLAY_DEBUG=1` (journal des scènes, portes visées, mini-jeux et issues), `PLAY_ASSIST`, `PLAY_FORCE_SECONDS` (150), `PLAY_MAX_SECONDS`,
 * `PLAY_STUCK_SECONDS`.
 *
 * Un vrai bug du jeu qui empêche de jouer se lit dans le rapport (scène, graine, blocage) ; le robot ne le contourne pas dans le jeu.
 */

const env = process.env;
const number = (name: string, fallback: number): number => (env[name] ? Number(env[name]) : fallback);

function describeSeed(r: SeedReport): string {
  const minigames = r.minigames.map((m) => `S${m.scene}[${m.mode === "forcé" ? "forcé" : m.mode}: ${m.result}]`).join(" ");
  const lines = [
    `graine ${r.seed} : ${r.outcome} — ${r.players} joueur(s) (personnages ${r.characters}, niveaux ${r.levels}), ${r.assist ? "coup de pouce" : "jeu honnête"}`,
    `  durée : ${r.simSeconds} s simulées (${r.gameSeconds} s de partie, ${r.frames} images) ; retour au menu : ${r.returnedToMenu ? "oui" : "NON"} ; vidéo de fin : ${r.endVideo ? "oui" : "NON"}`,
    `  scènes visitées : ${r.scenes.join(", ")}`,
    `  mini-jeux (${r.minigames.length}) : ${minigames || "aucun"}`,
    `  aides forcées (${r.forced.length}) : ${r.forced.join(" ; ") || "aucune"}`,
    `  blocages : ${r.blockages.join(" ; ") || "aucun"}`,
  ];
  if (r.notes.length > 0) lines.push(`  notes : ${[...new Set(r.notes)].join(" ; ")}`);
  if (r.error) lines.push(`  erreur : ${r.error}`);
  return lines.join("\n");
}

describe.skipIf(!hasOriginalFiles || !env.PLAY)("parties du Téléportaschtroumpf jouées par un robot", () => {
  it("joue des parties complètes du menu au menu", { timeout: 3_600_000 }, async () => {
    const only = env.PLAY_ONLY ? Number(env.PLAY_ONLY) : null;
    const first = only ?? number("PLAY_FROM", 1);
    const last = only ?? first + number("PLAY_SEEDS", 10) - 1;
    const reports: SeedReport[] = [];
    for (let seed = first; seed <= last; seed++) {
      const assist = env.PLAY_ASSIST === undefined ? seed % 2 === 1 : env.PLAY_ASSIST === "1";
      const started = Date.now();
      const robot = new Robot({
        seed,
        assist,
        maxSimSeconds: number("PLAY_MAX_SECONDS", 4000),
        stuckSeconds: number("PLAY_STUCK_SECONDS", 60),
        forceAfterSeconds: number("PLAY_FORCE_SECONDS", 150),
        debug: env.PLAY_DEBUG === "1",
        log: (message) => console.log(message),
      });
      const report = await robot.play();
      reports.push(report);
      console.log(`${describeSeed(report)}\n  (${((Date.now() - started) / 1000).toFixed(0)} s réelles)`);
    }

    const count = (outcome: SeedReport["outcome"]) => reports.filter((r) => r.outcome === outcome).length;
    const played = new Map<number, { total: number; piloted: number; forced: number; won: number }>();
    for (const r of reports) {
      for (const m of r.minigames) {
        const entry = played.get(m.scene) ?? { total: 0, piloted: 0, forced: 0, won: 0 };
        entry.total++;
        if (m.mode === "pilote") entry.piloted++;
        if (m.mode === "forcé") entry.forced++;
        if (m.result !== "échec / rien") entry.won++;
        played.set(m.scene, entry);
      }
    }
    const coverage = [...played.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([scene, e]) => `S${scene} ×${e.total} (pilote ${e.piloted}, forcé ${e.forced}, gain ${e.won})`)
      .join(", ");
    console.log(
      [
        `RAPPORT : ${reports.length} graine(s) — victoire ${count("victoire")}, temps écoulé ${count("temps écoulé")}, abandon ${count("abandon")}, ` +
          `limite de ticks ${count("limite de ticks")}, blocage ${count("blocage")}, erreur ${count("erreur")}`,
        `mini-jeux joués : ${coverage || "aucun"}`,
        `aides forcées : ${reports.reduce((n, r) => n + r.forced.length, 0)}`,
      ].join("\n"),
    );

    // Une partie doit aller au bout : victoire ou fin du temps, retour au menu, vidéo de fin lue, sans blocage ni erreur.
    for (const r of reports) {
      expect(r.error, `graine ${r.seed}`).toBeUndefined();
      expect(["victoire", "temps écoulé"], `graine ${r.seed} : ${r.outcome} ${r.blockages.join(" ; ")}`).toContain(r.outcome);
      expect(r.returnedToMenu, `graine ${r.seed} : retour au menu`).toBe(true);
      expect(r.endVideo, `graine ${r.seed} : vidéo de fin`).toBe(true);
    }
  });
});
