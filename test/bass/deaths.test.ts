/**
 * Morts de Foster dans *Beneath a Steel Sky* : comment le jeu les amène, et ce que fait l'écran de fin de partie (écran 102) ensuite.
 *
 * **Mécanique d'origine** (scripts désassemblés de `sky.dsk`, `engine/disasm.ts`) : tous les chemins de mort finissent par
 * `fnSetAlternate(DEATH_SCRIPT)` (`var[414]` = script 59, module 0). Ce script ôte Foster de la scène (`fnMoveItems`), pose l'écran 102
 * (`fnDrawScreen(159)`), la musique 1 et rend la souris. L'écran 102 a trois zones : `restart_butt` (script 60 : animation, puis
 * `fnRestartGame`), `restore_butt` (script 61 : `fnRestoreGame` en boucle, un tour après chaque annulation) et `exit_butt` (script 62 :
 * `fnQuitToDos`). Les appels à `fnSetAlternate(var[414])` sont dans les scripts 55 (lecteur de cartes volées, section 1), 4105 (escalier
 * de l'usine, section 0), 8284 (prise électrique, écran 18), 8436 (console du réacteur, écran 16), 16729 (trou du métro, écran 48), 20497,
 * 20619, 20754 (console de l'écran 76) et 20860 (fin : Foster n'est plus, LINC).
 *
 * **Morts jouées ici**, avec de vrais clics, sur les vrais fichiers, sans jamais écrire l'état du jeu :
 * 1. dès le départ : clic droit sur l'escalier (`upstairs`, script 4105) : Foster monte l'escalier branlant et tombe ;
 * 2. le trou du métro (écran 48, `sc48_hole`, script 16729) : « quelque chose D'HORRIBLE ! », section 3 ;
 * 3. la dernière pièce (écran 81, `sc81_father`, script 20860) : n'importe quel objet sur Overmann : « Foster n'est plus… Je suis LINC ».
 * Des recherches exhaustives (clic droit ou objet tenu sur chaque zone de chaque écran de la solution) n'en ont pas trouvé d'autres sans
 * un montage précis (scripts 55, 8284, 8436, 20754 demandent un état particulier de l'histoire).
 *
 * **Suite de la mort** : l'écran 102 ne se sauvegarde pas (écran ≥ 101) ; « Recommencer » remet une partie neuve (rejouable jusqu'au bout),
 * « Restituer » fige le jeu et demande la restitution à l'hôte (`requestRestore`) : annulée, l'écran 102 reste (le script 61 attend un nouveau clic) ; une sauvegarde reprise
 * ramène le joueur vivant dans la partie, qui se termine ; « Quitter » rend la main à l'hôte (`exit`). Voir `docs/bass/engine.md` § 19 et 20.
 */

import { describe, expect, it } from "vitest";
import { Var } from "../../src/games/bass/engine/ids";
import { parseSave, type SaveData } from "../../src/games/bass/engine/save";
import { hasOriginalFiles, makeEngine } from "./engine/helpers";
import { Driver } from "./solution/driver";
import { PHASES } from "./solution/walkthrough";

const enabled = hasOriginalFiles && process.env.BASS_FULL_GAME !== "0";
const DEATH_SCREEN = 102;

function start(): Driver {
  const { engine, host } = makeEngine();
  engine.startAfterIntro();
  const driver = new Driver(engine, host);
  driver.cycle(3);
  return driver;
}

/** Joue la solution jusqu'au premier état où le joueur a la main et où `ready` est vrai ; rend le nombre d'étapes jouées. */
function playUntil(driver: Driver, ready: (d: Driver) => boolean): number {
  let steps = 0;
  for (const phase of PHASES) {
    for (const step of phase.steps) {
      driver.run(step);
      steps++;
      if (driver.idle && ready(driver)) return steps;
    }
  }
  throw new Error("état voulu jamais atteint");
}

/** Joue toute la solution (ou ses `phases`) ; au bout, le générique est affiché. */
function playAll(driver: Driver, phases = PHASES, skip = 0): void {
  let n = 0;
  for (const phase of phases) {
    for (const step of phase.steps) {
      if (n++ < skip) continue;
      driver.run(step);
    }
  }
}

/** Laisse passer des tours jusqu'à ce que `until` soit vrai (au plus `max`). */
function cycleUntil(driver: Driver, until: () => boolean, max: number, what: string): number {
  for (let i = 0; i < max; i++) {
    if (until()) return i;
    driver.cycle();
  }
  throw new Error(`${what} : non atteint en ${max} tours ; ${driver.state()}`);
}

/** Sauvegarde du jeu en cours, passée par du vrai JSON (comme le site). */
function snapshot(driver: Driver): SaveData {
  const save = driver.engine.control.capture();
  expect(typeof save, "sauvegarde refusée").not.toBe("string");
  const parsed = parseSave(JSON.parse(JSON.stringify(save)));
  expect(parsed).not.toBeNull();
  return parsed!;
}

const onDeathScreen = (d: Driver) => () => d.screen === DEATH_SCREEN && d.idle;

/** Mort 1 : au départ, clic droit sur l'escalier. Rend le joueur sur l'écran de fin de partie. */
function dieOnStairs(): Driver {
  const driver = start();
  expect(driver.screen).toBe(0);
  driver.click(driver.find("upstairs"), "right");
  cycleUntil(driver, onDeathScreen(driver), 600, "écran de fin de partie");
  return driver;
}

const metroHole = (d: Driver): boolean => d.screen === 48 && d.reachable("sc48_hole");
const lastRoom = (d: Driver): boolean => d.screen === 81 && d.reachable("sc81_father");

/** Objets de l'inventaire (`o0` = var 69, 30 emplacements). */
function inventory(driver: Driver): number[] {
  return Array.from({ length: 30 }, (_, i) => driver.engine.vars[69 + i]!);
}

function zoneNames(driver: Driver): string[] {
  return driver
    .hotspots()
    .map((h) => h.name)
    .sort();
}

describe.skipIf(!enabled)("morts de Foster", () => {
  describe("1. l'escalier de l'usine, au départ", () => {
    it("Foster monte, la souris est coupée pendant la chute, puis l'écran 102 s'ouvre sans texte", () => {
      const driver = start();
      expect(driver.engine.vars[106]).toBe(2); // Foster est sur la passerelle du haut (VAR 106 = niveau)
      // Regarder l'escalier ne risque rien : « Ces escaliers ne m'ont pas l'air très SURS... »
      driver.click(driver.find("upstairs"), "left");
      driver.waitIdle();
      expect(driver.texts).toContain("Ces escaliers ne m'ont pas l'air très SURS...");
      expect(driver.screen).toBe(0);

      driver.click(driver.find("upstairs"), "right");
      let locked = false;
      const cycles = cycleUntil(
        driver,
        () => {
          if (driver.engine.vars[Var.MOUSE_STATUS] === 0) locked = true;
          return driver.screen === DEATH_SCREEN && driver.idle;
        },
        600,
        "écran de fin de partie",
      );
      expect(locked).toBe(true);
      // Une centaine de tours : marche jusqu'à l'escalier, animation de la chute (script 4105), pause de 10 tours, script 59.
      expect(cycles).toBeGreaterThanOrEqual(100);
      expect(cycles).toBeLessThan(300);
      expect(driver.texts).toHaveLength(1); // aucune réplique de plus
      expect(driver.engine.vars[Var.MOUSE_STATUS]).toBe(6); // souris rendue
      expect(driver.engine.system.currentMusic).toBe(1);
    });

    it("l'écran de fin de partie : trois boutons, pas d'autre zone, pas de sauvegarde possible", () => {
      const driver = dieOnStairs();
      expect(zoneNames(driver)).toEqual(["exit_butt", "restart_butt", "restore_butt"]);
      expect(driver.engine.host.pollInput()).toEqual([]);
      // `saveRefusal` : l'écran 102 est un terminal (≥ 101), le site dit pourquoi ; rien n'est sauvegardé, rien ne change.
      const before = driver.engine.cycleCount;
      expect(typeof driver.engine.control.capture()).toBe("string");
      driver.cycle(5);
      expect(driver.screen).toBe(DEATH_SCREEN);
      expect(driver.engine.cycleCount).toBe(before + 5);
    });

    it("« Recommencer » : partie neuve, au départ, l'escalier tue de nouveau", () => {
      const driver = dieOnStairs();
      driver.click(driver.find("restart_butt"), "left");
      cycleUntil(driver, () => driver.screen === 0 && driver.idle, 600, "retour au départ");
      // État de départ : Foster sur la passerelle, section 0, mêmes objets qu'une partie neuve.
      expect(driver.engine.vars[Var.CUR_SECTION]).toBe(0);
      expect(driver.engine.vars[106]).toBe(2);
      expect(inventory(driver)).toEqual(inventory(start()));
      expect(zoneNames(driver)).toEqual(expect.arrayContaining(["upstairs", "bar", "door"]));
      expect(driver.host.exited).toBe(false);
      // Et la partie neuve se joue vraiment : le même escalier tue de nouveau.
      driver.click(driver.find("upstairs"), "right");
      cycleUntil(driver, onDeathScreen(driver), 600, "seconde mort");
    });

    it("« Quitter » : l'hôte reçoit la sortie (fnQuitToDos), sans recommencer", () => {
      const driver = dieOnStairs();
      expect(driver.host.exited).toBe(false);
      driver.click(driver.find("exit_butt"), "left");
      cycleUntil(driver, () => driver.host.exited, 600, "sortie");
      expect(driver.host.exited).toBe(true);
    });

    it("« Restituer » : le jeu se fige et demande la restitution ; annulée, l'écran reste ; une sauvegarde de la partie ramène Foster vivant", () => {
      // Sauvegarde prise juste avant la mort (au départ).
      const driver = start();
      const saved = snapshot(driver);
      driver.click(driver.find("upstairs"), "right");
      cycleUntil(driver, onDeathScreen(driver), 600, "écran de fin de partie");
      const { engine, host } = driver;

      expect(host.restoreRequests).toBe(0);
      driver.click(driver.find("restore_butt"), "left");
      cycleUntil(driver, () => host.restoreRequests === 1, 200, "demande de restitution");
      // Le dialogue du site est ouvert : le jeu est figé (ni horloge ni tour).
      const frozen = engine.cycleCount;
      const time = engine.timeMs;
      driver.tick(200);
      expect(engine.cycleCount).toBe(frozen);
      expect(engine.timeMs).toBe(time);
      expect(host.restoreRequests).toBe(1);

      // Dialogue fermé sans rien choisir : le jeu reprend sur l'écran de fin de partie (le script 61 revient à `fnAwaitSync`, il attend un
      // nouveau clic sur le bouton : rien n'est redemandé tout seul).
      engine.control.finishDialog();
      driver.cycle(100);
      expect(driver.screen).toBe(DEATH_SCREEN);
      expect(zoneNames(driver)).toEqual(["exit_butt", "restart_butt", "restore_butt"]);
      expect(host.restoreRequests).toBe(1);
      expect(host.exited).toBe(false);
      driver.click(driver.find("restore_butt"), "left");
      cycleUntil(driver, () => host.restoreRequests === 2, 200, "nouvelle demande");

      // Une sauvegarde choisie : la partie reprend là où elle était, vivante, et l'escalier est toujours là.
      expect(engine.control.load(saved)).toBe(true);
      engine.control.finishDialog();
      cycleUntil(driver, () => driver.screen === 0 && driver.idle, 300, "partie restituée");
      driver.cycle(20);
      expect(host.restoreRequests).toBe(2); // plus de demande une fois la partie reprise
      expect(engine.vars[106]).toBe(2);
      expect(zoneNames(driver)).toEqual(expect.arrayContaining(["upstairs", "bar", "door"]));
      // La partie restituée se joue : un premier pas de la solution fonctionne.
      driver.run(PHASES[0]!.steps[0]!);
    });
  });

  describe("2. le trou du métro (CUR_SECTION 3)", () => {
    it("« quelque chose D'HORRIBLE ! », puis l'écran de fin de partie", () => {
      const driver = start();
      playUntil(driver, metroHole);
      expect(driver.engine.vars[Var.CUR_SECTION]).toBe(3);
      driver.click(driver.find("sc48_hole"), "right");
      cycleUntil(driver, onDeathScreen(driver), 3000, "écran de fin de partie");
      expect(driver.texts.at(-1)).toBe("Il y a quelque chose là-dedans... quelque chose D'HORRIBLE!");
      expect(zoneNames(driver)).toEqual(["exit_butt", "restart_butt", "restore_butt"]);
    }, 60_000);

    it("restitution d'une sauvegarde de juste avant, puis fin de la partie par la solution", () => {
      const driver = start();
      const steps = playUntil(driver, metroHole);
      const saved = snapshot(driver);
      driver.click(driver.find("sc48_hole"), "right");
      cycleUntil(driver, onDeathScreen(driver), 3000, "écran de fin de partie");

      driver.click(driver.find("restore_butt"), "left");
      cycleUntil(driver, () => driver.host.restoreRequests === 1, 200, "demande de restitution");
      expect(driver.engine.control.load(saved)).toBe(true);
      driver.engine.control.finishDialog();
      cycleUntil(driver, () => driver.screen === 48 && driver.idle, 300, "partie restituée");
      expect(driver.reachable("sc48_hole")).toBe(true);

      // La solution reprend où elle en était (le trou est évité) et va au bout.
      playAll(driver, PHASES, steps);
      expect(driver.texts.join("\n")).toContain("Copyright 1994 Revolution Software Limited");
      expect(driver.screen).toBe(85);
      expect(driver.host.exited).toBe(false);
    }, 120_000);

    it("« Recommencer » après une mort tardive : partie neuve, la solution rejouée du début passe les quatre premières phases", () => {
      const driver = start();
      playUntil(driver, metroHole);
      driver.click(driver.find("sc48_hole"), "right");
      cycleUntil(driver, onDeathScreen(driver), 3000, "écran de fin de partie");
      driver.click(driver.find("restart_butt"), "left");
      cycleUntil(driver, () => driver.screen === 0 && driver.idle, 600, "retour au départ");
      expect(driver.engine.vars[Var.CUR_SECTION]).toBe(0);
      expect(inventory(driver)).toEqual(inventory(start()));

      // Le hasard n'est pas remis à la graine par `restartGame` (comme dans ScummVM) : la solution, réglée sur la graine 1, n'est sûre que
      // tant que les personnages qui se promènent (Mme Piermont, phase 6) ne comptent pas ; les phases 1 à 4 (section 0 à 2) passent.
      playAll(driver, PHASES.slice(0, 4));
      expect(driver.engine.vars[Var.CUR_SECTION]).toBeGreaterThanOrEqual(1);
      expect(driver.texts.join("\n")).toContain("Ouf! Voilà une heureuse EVASION!");
      expect(driver.texts.join("\n")).toContain("C'est un travail pour... CAPITAINE SOUDEUR!");
      expect(driver.host.exited).toBe(false);
    }, 120_000);
  });

  describe("3. la dernière pièce : un objet sur Overmann (CUR_SECTION 4)", () => {
    it("« Foster n'est plus… Je suis LINC. Je suis le FUTUR. », puis l'écran de fin de partie", () => {
      const driver = start();
      playUntil(driver, lastRoom);
      expect(driver.engine.vars[Var.CUR_SECTION]).toBe(4);
      driver.run({ use: "spanner", on: "sc81_father" });
      cycleUntil(driver, onDeathScreen(driver), 3000, "écran de fin de partie");
      const text = driver.texts.join("\n");
      expect(text).toContain("Foster n'est plus...");
      expect(text).toContain("Je suis LINC.");
      expect(text).toContain("Je suis le FUTUR.");
      expect(text).not.toContain("Copyright 1994 Revolution Software Limited");
      expect(zoneNames(driver)).toEqual(["exit_butt", "restart_butt", "restore_butt"]);
    }, 60_000);

    it("restituer la sauvegarde de juste avant : la bonne fin est encore possible", () => {
      const driver = start();
      const steps = playUntil(driver, lastRoom);
      const saved = snapshot(driver);
      driver.run({ use: "spanner", on: "sc81_father" });
      cycleUntil(driver, onDeathScreen(driver), 3000, "écran de fin de partie");
      driver.click(driver.find("restore_butt"), "left");
      cycleUntil(driver, () => driver.host.restoreRequests === 1, 200, "demande de restitution");
      expect(driver.engine.control.load(saved)).toBe(true);
      driver.engine.control.finishDialog();
      cycleUntil(driver, () => driver.screen === 81 && driver.idle, 300, "partie restituée");

      playAll(driver, PHASES, steps);
      expect(driver.texts.join("\n")).toContain("Copyright 1994 Revolution Software Limited");
      expect(driver.screen).toBe(85);
    }, 120_000);
  });
});
