/**
 * Partie complète des *Voyageurs du temps* (vague K) jouée par de vraies entrées (`solution/driver.ts`), du démarrage (introduction
 * comprise) jusqu'au générique de fin, sur les vrais fichiers, sans jamais écrire l'état du jeu : (a) d'une traite ; (b) avec, après chaque
 * étape, une sauvegarde, un aller-retour en vrai JSON et une reprise dans un moteur neuf (quand le jeu accepte de sauvegarder : pas pendant
 * un message, un menu ou une cinématique qui bloque les entrées).
 *
 * La solution (`solution/walkthrough.ts`) est en données : objets `nom#index` de la table OBJ, points de marche, attentes. Le jeu ne se
 * termine pas de lui-même : le générique (script 35 de PART04B) défile en boucle sur le décor L44 ; la partie est finie quand il défile
 * après le dernier message (« AU REVOIR ... ET A BIENTOT ! »). Protection : la comparaison de la globale 255 répond toujours « égal » (D7) ;
 * les moines ne tuent pas le héros (contrôlé ici : la partie passe le monastère).
 *
 * La partie (a) est celle que le banc ScummVM rejoue (`solution/scummvm-replay.test.ts`) : ses entrées doivent rester celles de
 * `solution/fixtures/scummvm-inputs.txt`. Durée (vitest) : (a) environ 1 s, (b) environ 3 s (322 reprises sur 328 étapes). `VOYAGEURS_FULL_GAME=0` les passe toutes les deux.
 */

import { describe, expect, it } from "vitest";
import { hasOriginalFiles } from "./engine/helpers";
import { readSolutionFixture } from "./solution/bench";
import { formatInput, parseInputs } from "./solution/inputs";
import { type Played, playSolution, playTo, STEP_COUNT } from "./solution/play";
import { PHASES } from "./solution/walkthrough";

const enabled = hasOriginalFiles && process.env.VOYAGEURS_FULL_GAME !== "0";

/** Jalons de chaque partie (textes français du jeu). */
const MILESTONES = [
  "Vous vous trouvez sur un échafaudage",
  "UN PASSAGE SECRET",
  "OUF , C'EST LE BON CODE",
  "Marécages",
  "Excellente initiative",
  "Bien joué ! Ce loup électronique",
  "ivre mort",
  "La fille de Torin",
  "Lo'Ann",
  "Judicieuse idée",
  "LES CRUGHONS",
  "HOURRA ! La voie est Libre",
  "Vous vous installez dans le caisson",
  "Vous entrez dans la caisse",
  "LE SCORZUUM A EXPLOSE IL Y A 65 MILLIONS D'ANNEES",
  "AU REVOIR ... ET A BIENTOT !",
];

/** Les décors de chaque partie, jusqu'au générique. */
const SCENES = ["L1.PI1", "L5.PI1", "L6.PI1", "L13.PI1", "L17.PI1", "L19.PI1", "L21.PI1", "L27.PI1", "L33.PI1", "L34.PI1", "L42.PI1", "L45.PI1", "L44.PI1"];

function expectEnding(played: Played): void {
  const { driver } = played;
  for (const text of MILESTONES) expect(driver.saw(text), text).toBe(true);
  for (const bg of SCENES) expect(played.backgrounds.has(bg), bg).toBe(true);
  // Générique : décor L44, lignes du générique (objets 1 à 22 de GENF.ANI) qui défilent, entrées coupées, sans message d'échec.
  expect(driver.state.names.prc).toBe("PART04B.PRC");
  expect(driver.bg).toBe("L44.PI1");
  expect(driver.state.allowPlayerInput).toBe(0);
  expect(driver.texts.filter((t) => t.startsWith("[échec]"))).toEqual([]);
  // Protection (D7) : les moines n'ont jamais démasqué le héros, ni ne l'ont pris en faute dans le cloître.
  expect(driver.saw("ESPION ! ESPION !")).toBe(false);
  expect(driver.saw("Infidèle")).toBe(false);
  expect(driver.host.exited).toBe(false);
  expect(driver.engine.quitRequested).toBe(false);
}

describe.skipIf(!enabled)("partie complète : du démarrage au générique de fin", () => {
  it("(a) d'une traite, par de vraies entrées ; ce sont celles que rejoue le banc ScummVM", () => {
    const played = playSolution();
    expect(played.steps).toBe(STEP_COUNT);
    expectEnding(played);
    // ~16 000 ticks (environ 30 minutes de jeu à 110 ms le tick, messages lus sans attendre).
    expect(played.driver.engine.ticks).toBeGreaterThan(15_000);
    const fixture = parseInputs(readSolutionFixture("scummvm-inputs.txt")).map(formatInput);
    expect(played.driver.record.map(formatInput)).toEqual(fixture);
  }, 120_000);

  it("(b) avec une sauvegarde et une reprise dans un moteur neuf après chaque étape", () => {
    const played = playSolution((driver) => driver.resumed());
    expectEnding(played);
    expect(played.resumes).toBeGreaterThan(played.steps * 0.9);
    // La reprise est exacte : chaque étape finit au même tick que dans la partie d'une traite.
    expect(played.stepTicks).toEqual(playSolution().stepTicks);
  }, 300_000);

  it("(c) pas de sauvegarde entre l'ouverture du bundle d'une partie et son premier décor (le fond viendrait du mauvais bundle)", () => {
    // Fin de PART01 : PART02 est ouvert et ses scripts chargés, le décor est encore L5 (labo), absent de PART02.
    const d = playTo("2.", 0);
    expect(d.state.names.part).toBe("PART02");
    expect(d.bg).toBe("L5.PI1");
    expect(d.engine.saveRefusal()).toBe("busy");
    d.run(PHASES[2]!.steps[0]!);
    expect(d.bg).toBe("L6.PI1");
    expect(d.engine.saveRefusal()).toBeNull();
  }, 60_000);
});
