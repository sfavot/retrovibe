/**
 * Morts du héros (vague K) : quelques morts connues des *Voyageurs du temps*, atteintes en s'écartant de la solution (`solution/`), puis la
 * suite proposée au joueur. Le jeu ne recharge rien de lui-même : le script affiche le message de mort, coupe les entrées et arrête la
 * marche (`disallowPlayerInput`, `endGlobalScript` des scripts de marche) ; le joueur passe par le menu système (deux boutons ou F10),
 * qui reste ouvert entrées coupées (`makeSystemMenu`, Sauver en moins) : Nouvelle partie (après confirmation) relance le jeu depuis le
 * démarrage, Charger ouvre le dialogue du site (`requestLoad`), et une sauvegarde prise avant la mort reprend la partie.
 *
 * `VOYAGEURS_FULL_GAME=0` les passe (elles rejouent le début de la solution).
 */

import { describe, expect, it } from "vitest";
import { parseSave } from "../../src/games/voyageurs/engine/save";
import { hasOriginalFiles } from "./engine/helpers";
import { Driver } from "./solution/driver";
import { playTo, stepIndex } from "./solution/play";
import { PHASES } from "./solution/walkthrough";

const enabled = hasOriginalFiles && process.env.VOYAGEURS_FULL_GAME !== "0";

/** Lignes du menu système du port et de sa confirmation. */
const NEW_GAME = 1;
const LOAD = 3;
const CONFIRM = 0;

/** Le héros est mort : message affiché, entrées coupées, plus de script de marche. */
function dead(d: Driver, message: string): boolean {
  return d.saw(message) && d.state.allowPlayerInput === 0 && !d.walking;
}

describe.skipIf(!enabled)("morts du héros, puis nouvelle partie ou chargement", () => {
  it("le plafond du passage secret (1989) écrase le héros qui ne tape pas le code ; Nouvelle partie relance le jeu", () => {
    const d = playTo("1.", stepIndex("1.", "Pave Numerique#88"));
    expect(d.bg).toBe("L4.PI1");
    d.until((x) => dead(x, "Le plafond était un peu bas"), "le plafond descend", 400);
    expect(d.saw("GULP !")).toBe(true);
    // Rien ne bouge plus : ni marche, ni sauvegarde.
    d.tick(50);
    expect(d.state.allowPlayerInput).toBe(0);
    expect(d.engine.canSave()).toBe(false);
    d.systemMenu(NEW_GAME, CONFIRM);
    d.until((x) => x.bg === "LOGO.PI1", "le démarrage", 200);
    // L'introduction se rejoue jusqu'à l'échafaudage, comme une partie neuve.
    d.run(PHASES[0]!.steps[0]!);
    expect(d.bg).toBe("L1.PI1");
    expect(d.has("seau d'eau#3")).toBe(false);
  }, 60_000);

  it("le marécage (Moyen Âge) engloutit le héros ; Charger ouvre le dialogue, la sauvegarde d'avant reprend la partie", () => {
    const d = playTo("2.", stepIndex("2.", "la boue (zone 4) tue"));
    expect(d.bg).toBe("L6.PI1");
    const save = parseSave(JSON.parse(JSON.stringify(d.engine.save())));
    expect(save).not.toBeNull();
    d.press("c 250 158 1");
    d.until((x) => dead(x, "GLOU GLOU"), "la boue", 300);
    d.systemMenu(LOAD);
    expect(d.host.loadRequests).toBe(1);
    // Le dialogue du site rend la sauvegarde choisie : la partie reprend avant la mort et se poursuit selon la solution.
    d.engine.load(save!);
    expect(d.state.allowPlayerInput).toBe(1);
    const marsh = PHASES[2]!.steps;
    for (const step of marsh.slice(stepIndex("2.", "la boue (zone 4) tue"), stepIndex("2.", "la clairière") + 1)) d.run(step);
    expect(d.bg).toBe("L7.PI1");
    expect(d.has("pendentif#8")).toBe(true);
  }, 60_000);

  it("la créature des égouts (4315) croque le héros qui ne l'arrose pas à temps", () => {
    const d = playTo("3.", stepIndex("3.", "le héros s'avance vers la créature"));
    d.until((x) => dead(x, "elle vous a croqué"), "la créature", 1500);
    expect(d.hero.x).toBeGreaterThanOrEqual(170);
    d.systemMenu(NEW_GAME, CONFIRM);
    d.until((x) => x.bg === "LOGO.PI1", "le démarrage", 200);
  }, 60_000);

  it("au tir (Crétacé), un Crughon qu'on laisse approcher abat le héros", () => {
    const d = playTo("4.", stepIndex("4.", "le tir : abattre"));
    d.until((x) => dead(x, "C'est ici que se termine votre périple"), "un tir de Crughon", 6000);
    expect(d.state.globals[1]).toBe(1);
  }, 60_000);
});
