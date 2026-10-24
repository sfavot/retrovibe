/**
 * Robot de parcours de Math Workshop (tâche J3). Diagnostic long, ignoré par `npm test` : activé avec `PLAY=1`.
 *
 *     PLAY=1 npx vitest run test/mathemagique/playthrough
 *
 * Pour chaque graine, le robot démarre le jeu sur l'hôte de test avec les vraies scènes et les vraies données (titre, crédits un coup
 * sur trois, hub, création d'un joueur), visite chaque activité depuis le hub en cliquant les objets du décor, la joue jusqu'à sa fin
 * naturelle (puzzles résolus avec les deux modes de souris, Rockets contre Poly et contre un ami, Bowling avec un strike et un temps
 * écoulé, Rhythm Shop, Pattern Windows, Hall of Fame et certificat sur un port factice, aide de Poly), règle les préférences, revient
 * au hub après chaque activité et quitte par le sifflet. Les choix (vignette, niveau, opération, motif, couleurs, ordre) sont tirés
 * d'un générateur seedé : une graine = un parcours rejouable.
 *
 * Invariants vérifiés à chaque image (`robot.ts`) : aucune exception ni échec de chargement du moteur, image présentée jamais d'un seul
 * ton ni palette éteinte au-delà de `PLAY_UNIFORM_SECONDS`, palette allumée `PLAY_LIT_SECONDS` après l'entrée d'une scène, aucune animation
 * qui tourne plus de `PLAY_STUCK_SECONDS`, roster relisible et identique à son enregistrement au retour au hub, sons WAVE sans fuite,
 * enter / leave des scènes équilibrés, temps réel et simulé bornés. Le test échoue s'il y a une violation.
 *
 * Environnement : `PLAY_SEEDS=n` (nombre de graines, 10 par défaut), `PLAY_FROM=n` (première graine, 1), `PLAY_ONLY=n` (une seule graine),
 * `PLAY_DEBUG=1` (journal du parcours et des violations), `PLAY_MAX_REAL_SECONDS` (600), `PLAY_MAX_SIM_SECONDS` (7200),
 * `PLAY_UNIFORM_SECONDS` (4), `PLAY_LIT_SECONDS` (8), `PLAY_STUCK_SECONDS` (300).
 */
import { describe, expect, it } from "vitest";
import { hasOriginalFiles } from "../helpers";
import { playSeed, type SeedReport } from "./journey";
import { Robot } from "./robot";

const env = process.env;
const number = (name: string, fallback: number): number => (env[name] ? Number(env[name]) : fallback);

function describeSeed(r: SeedReport): string {
  const lines = [
    `graine ${r.seed} : ${r.violations.length === 0 ? "ok" : `${r.violations.length} violation(s)`} — ${r.visited.length} activité(s) revenues au hub, sifflet ${r.completed ? "oui" : "NON"}, ${r.certificates} fichier(s) remis`,
    `  durée : ${r.simSeconds.toFixed(0)} s simulées, ${r.frames} images, ${r.realSeconds.toFixed(1)} s réelles`,
    `  audio : ${r.audio.waves} WAVE lancés (au plus ${r.audio.live} à la fois, ${r.audio.open} handles ouverts, ${r.audio.loops} en boucle), ${r.audio.notes} notes MIDI, ${r.audio.resets} reset`,
    `  chemin : ${r.path.filter((p) => !/^(entrée|sortie) /.test(p)).join(" > ")}`,
  ];
  for (const v of r.violations) lines.push(`  VIOLATION graine ${v.seed}, scène ${v.scene}, tick ${v.tick} [${v.kind}] ${v.detail}`);
  return lines.join("\n");
}

describe.skipIf(!hasOriginalFiles || !env.PLAY)("parties de Math Workshop jouées par un robot", () => {
  it("joue le jeu du titre au sifflet, activité par activité", { timeout: 3_600_000 }, async () => {
    const only = env.PLAY_ONLY ? Number(env.PLAY_ONLY) : null;
    const first = only ?? number("PLAY_FROM", 1);
    const last = only ?? first + number("PLAY_SEEDS", 10) - 1;
    const reports: SeedReport[] = [];
    for (let seed = first; seed <= last; seed++) {
      const robot = new Robot({
        seed,
        maxRealSeconds: number("PLAY_MAX_REAL_SECONDS", 600),
        maxSimSeconds: number("PLAY_MAX_SIM_SECONDS", 7200),
        uniformSeconds: number("PLAY_UNIFORM_SECONDS", 4),
        litAfterSeconds: number("PLAY_LIT_SECONDS", 8),
        stuckAnimationSeconds: number("PLAY_STUCK_SECONDS", 300),
        debug: env.PLAY_DEBUG === "1",
        log: (message) => console.log(message),
      });
      const report = await playSeed(robot);
      reports.push(report);
      console.log(describeSeed(report));
    }
    const total = reports.reduce((n, r) => n + r.violations.length, 0);
    const kinds = new Map<string, number>();
    for (const r of reports) for (const v of r.violations) kinds.set(`${v.scene} / ${v.kind}`, (kinds.get(`${v.scene} / ${v.kind}`) ?? 0) + 1);
    console.log(
      [
        `RAPPORT : ${reports.length} graine(s), ${total} violation(s), ${reports.filter((r) => r.violations.length > 0).length} graine(s) en défaut`,
        ...[...kinds.entries()].sort().map(([k, n]) => `  ${k} ×${n}`),
        `activités revenues au hub : ${reports.reduce((n, r) => n + r.visited.length, 0)}, sifflet : ${reports.filter((r) => r.completed).length}/${reports.length}`,
      ].join("\n"),
    );
    expect(reports.flatMap((r) => r.violations.map((v) => `graine ${v.seed}, scène ${v.scene}, tick ${v.tick} [${v.kind}] ${v.detail}`))).toEqual([]);
  });
});
