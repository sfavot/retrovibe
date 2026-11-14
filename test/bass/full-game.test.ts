/**
 * Partie complète de *Beneath a Steel Sky* (vague K) jouée par de vrais clics (`solution/driver.ts`), du départ après l'introduction
 * (Échap : Foster sur la passerelle de l'usine) jusqu'au générique de fin, sur les vrais fichiers, sans jamais écrire l'état du jeu :
 * (a) d'une traite ; (b) avec, après chaque étape, une sauvegarde, un aller-retour en vrai JSON et une reprise dans un moteur neuf (quand le
 * jeu accepte de sauvegarder : pas pendant un choix de dialogue, dans LINC, dans les dernières pièces ni pendant un effet).
 *
 * La solution (`solution/walkthrough.ts`) est en données : zones nommées comme dans `sky.cpt`, objets de l'inventaire, fragments des
 * répliques françaises. Le jeu ne se termine pas de lui-même : après la séquence de fin, le générique (script 74) tourne en boucle ; la partie
 * est finie quand sa dernière ligne (« Copyright 1994 Revolution Software Limited ») s'affiche.
 *
 * Durée (vitest) : (a) environ 1 s, (b) environ 5 s. `BASS_FULL_GAME=0` les passe toutes les deux. Voir `docs/bass/engine.md` § 20.
 */

import { describe, expect, it } from "vitest";
import type { BassEngine } from "../../src/games/bass/engine/game";
import type { TestHost } from "../../src/games/bass/engine/host";
import { Var } from "../../src/games/bass/engine/ids";
import { parseSave } from "../../src/games/bass/engine/save";
import { hasOriginalFiles, makeEngine } from "./engine/helpers";
import { Driver } from "./solution/driver";
import { PHASES } from "./solution/walkthrough";

const enabled = hasOriginalFiles && process.env.BASS_FULL_GAME !== "0";

/** Moteur au départ de la partie (introduction passée par Échap, comme `startGameAfterIntro` sur l'issue « skipped »). */
function start(): Driver {
  const { engine, host } = makeEngine();
  engine.startAfterIntro();
  const driver = new Driver(engine, host);
  driver.cycle(3);
  return driver;
}

/**
 * Moteur neuf qui reprend la partie de `driver` après un aller-retour de la sauvegarde en vrai JSON ; `null` si le jeu refuse. La grille de
 * cheminement est rechargée du disque comme dans ScummVM : la suite peut prendre quelques tours d'écart (`engine.md` § 20).
 */
function resume(driver: Driver): Driver | null {
  const save = driver.engine.control.capture();
  if (typeof save === "string") return null;
  const parsed = parseSave(JSON.parse(JSON.stringify(save)));
  expect(parsed).not.toBeNull();
  const { engine, host } = makeEngine();
  engine.startAfterIntro();
  expect(engine.control.load(parsed!)).toBe(true);
  // Le pointeur de la machine (celui que l'hôte déplace) n'est pas dans la sauvegarde : il reste où le joueur l'a laissé.
  engine.mouse.pointerX = driver.engine.mouse.pointerX;
  engine.mouse.pointerY = driver.engine.mouse.pointerY;
  const next = new Driver(engine, host);
  next.texts.push(...driver.texts);
  return next;
}

interface Played {
  driver: Driver;
  steps: number;
  resumes: number;
  /** Sections (`CUR_SECTION`) et écrans traversés. */
  sections: Set<number>;
  screens: Set<number>;
}

/** Joue la solution entière ; `afterStep` peut remplacer le joueur (reprise). */
function play(afterStep?: (driver: Driver) => Driver | null): Played {
  let driver = start();
  const out: Played = { driver, steps: 0, resumes: 0, sections: new Set(), screens: new Set() };
  for (const phase of PHASES) {
    for (const [index, step] of phase.steps.entries()) {
      try {
        driver.run(step);
      } catch (e) {
        throw new Error(`« ${phase.name} », étape ${index} (${JSON.stringify(step).slice(0, 100)}) : ${(e as Error).message}`);
      }
      out.steps++;
      out.sections.add(driver.engine.vars[Var.CUR_SECTION]!);
      out.screens.add(driver.screen);
      const next = afterStep?.(driver);
      if (next) {
        driver = next;
        out.resumes++;
      }
    }
  }
  out.driver = driver;
  return out;
}

/** Lignes du journal du moteur qui signalent une souche ou un texte manquant. */
function stubLines(engine: BassEngine): string[] {
  return engine.journal.filter((line) => /souche|non port|non formé|inconnu/i.test(line));
}

function expectEnding(played: Played, host: TestHost): void {
  const { driver } = played;
  const text = driver.texts.join("\n");
  // Quelques jalons de chaque section.
  expect(text).toContain("Ouf! Voilà une heureuse EVASION!");
  expect(text).toContain("J'ai l'impression que Reich a eu le souffle COUPE!");
  expect(text).toContain("C'est un travail pour... CAPITAINE SOUDEUR!");
  expect(text).toContain("Agent autorisé dans tous les secteurs.");
  expect(text).toContain("Oh, non. Pas elle... pas Anita...");
  expect(text).toContain("Le nom de l'agent est EDUARDO.");
  expect(text).toContain("Le METRO! C'est un peu comme un TERRIER creusé par des LAPINS GEANTS!");
  expect(text).toContain("Humains UN, Androïdes ZERO!");
  expect(text).toContain("Ha! Le VIRUS a fait PLANTER le programme!");
  expect(text).toContain("ROBERT? Oh, mon FILS!");
  expect(text).toContain("Copyright 1994 Revolution Software Limited");
  expect([...played.sections].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(driver.screen).toBe(85);
  expect(host.exited).toBe(false);
  expect(stubLines(driver.engine)).toEqual([]);
}

describe.skipIf(!enabled)("partie complète : du départ après l'introduction au générique de fin", () => {
  it("(a) d'une traite, par de vrais clics", () => {
    const played = play();
    expect(played.steps).toBe(PHASES.reduce((n, p) => n + p.steps.length, 0));
    expectEnding(played, played.driver.host);
    // ~90 000 tours de jeu (2 heures de jeu à 80 ms le tour).
    expect(played.driver.engine.cycleCount).toBeGreaterThan(80_000);
  }, 120_000);

  it("(b) avec une sauvegarde et une reprise dans un moteur neuf après chaque étape", () => {
    const played = play((driver) => resume(driver));
    expectEnding(played, played.driver.host);
    expect(played.resumes).toBeGreaterThan(played.steps / 2);
  }, 300_000);
});
