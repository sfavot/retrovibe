/**
 * Morts du héros (vague K) : les morts des *Voyageurs du temps* repérées dans les scripts, atteintes en s'écartant de la solution
 * (`solution/`), puis la suite proposée au joueur. Le jeu ne recharge rien de lui-même : le script affiche le message de mort, coupe les
 * entrées et arrête la marche (`disallowPlayerInput`, `endGlobalScript` des scripts de marche) ; le joueur passe par le menu système (deux
 * boutons ou F10), qui reste ouvert entrées coupées (`makeSystemMenu`, Sauver en moins) : Nouvelle partie (après confirmation) relance le
 * jeu depuis le démarrage, Charger ouvre le dialogue du site (`requestLoad`), et une sauvegarde prise avant la mort reprend la partie.
 *
 * Quelques scripts de mort laissent tourner le script de marche (10) : l'alarme du labo et le compte à rebours n'arrêtent que les scripts
 * qui déplacent le héros (36, 37), la sécurité du navi-port ne fait qu'effacer la cible de marche ; le comité d'accueil n'affiche que son
 * message (aucun script ne tourne plus, entrées laissées permises). Le héros ne bouge plus dans tous les cas. Chaque scénario a été rejoué
 * au banc ScummVM (mêmes entrées) : lignes `TK` identiques jusqu'à la mort (walkthrough.md).
 *
 * Protection (D7) : `compareGlobalVar 255` répond toujours « égal » ; la globale 255 n'est comparée qu'à l'entrée du cloître (script 3 de
 * PART02B), de la cabine (L42) et du vaisseau-bombe (PART04B), comme un contrôle préalable : les fautes du cloître (« Infidèle ! ») et les
 * moines (« ESPION ! ») restent atteignables.
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

/**
 * Ticks entre la main rendue dans le vaisseau-bombe (PART04B) et le message de fin du compte à rebours (script 34 : 6 × 6 × 10 × 10
 * ticks, plus son installation) ; la même valeur au banc ScummVM.
 */
const COUNTDOWN_TICKS = 3606;
const CONFIRM = 0;

/**
 * Le héros est mort : message affiché, entrées coupées, plus de script de marche (`walkKept` : le script de mort laisse tourner le script
 * de marche 10, comme dans ScummVM).
 */
function dead(d: Driver, message: string, walkKept = false): boolean {
  return d.saw(message) && d.state.allowPlayerInput === 0 && d.walking === walkKept;
}

/** Plus rien ne bouge : le héros reste en place et les entrées restent coupées pendant `ticks` ticks. */
function frozen(d: Driver, ticks = 50, input = 0): void {
  const { x, y } = d.hero;
  d.tick(ticks);
  expect([d.hero.x, d.hero.y]).toEqual([x, y]);
  expect(d.state.allowPlayerInput).toBe(input);
}

/** Sauvegarde de la partie en cours, après un aller-retour en JSON (comme celle du site). */
function saved(d: Driver) {
  const save = parseSave(JSON.parse(JSON.stringify(d.engine.save())));
  expect(save).not.toBeNull();
  return save!;
}

/** Joue les étapes de la partie `phase`, de `from` à `to` compris. */
function runSteps(d: Driver, phase: string, from: number, to: number): void {
  const p = PHASES.find((x) => x.name.startsWith(phase))!;
  for (const step of p.steps.slice(from, to + 1)) d.run(step);
}

/** Chiffres du compteur du vaisseau-bombe (objets 208 à 211, script 34 de PART04B). */
function countdown(d: Driver): number[] {
  return [208, 209, 210, 211].map((idx) => d.state.objects[idx]!.frame);
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
  it("l'alarme du labo (1989) : le garde rattrape le héros qui reste là avec les documents ; Nouvelle partie", () => {
    const d = playTo("1.", stepIndex("1.", "la plate-forme : téléportation"));
    expect(d.has("documents#109")).toBe(true);
    // Le garde (110) ne franchit pas le creux du sol : il faut remonter sur le palier de gauche pour qu'il atteigne le héros.
    d.run({ walk: [176, 147] });
    d.run({ walk: [176, 134] });
    d.press("c 100 136 1");
    d.until((x) => dead(x, "La curiosité est un vilain défaut", true), "le garde", 600);
    expect(d.state.globalScripts.some((s) => s.index === 36 || s.index === 37)).toBe(false);
    frozen(d);
    d.systemMenu(NEW_GAME, CONFIRM);
    d.until((x) => x.bg === "LOGO.PI1", "le démarrage", 200);
  }, 60_000);

  it("les moustiques (marécage) piquent le héros qui passe sans insecticide ; Charger reprend avant la mort", () => {
    const from = stepIndex("2.", "les moustiques tuent");
    const d = playTo("2.", from);
    const save = saved(d);
    d.press("c 100 138 1");
    d.until((x) => dead(x, "les moustiques ont eu raison de vous"), "les moustiques", 300);
    expect(d.hero.x).toBeLessThanOrEqual(124);
    frozen(d);
    d.systemMenu(LOAD);
    expect(d.host.loadRequests).toBe(1);
    d.engine.load(save);
    runSteps(d, "2.", from, stepIndex("2.", "Eclat#7"));
    expect(d.has("pendentif#8")).toBe(true);
  }, 60_000);

  it("les moines du village : sans habit (globale 200 = 0), ESPION !", () => {
    const d = playTo("2.", stepIndex("2.", "tunique#22"));
    expect(d.state.globals[200]).toBe(0);
    d.run({ walk: [6, 150], idle: false });
    d.until((x) => dead(x, "ESPION ! ESPION !"), "les moines", 600);
    expect(d.bg).toBe("L8.PI1");
    expect(d.saw("franchement HOSTILE")).toBe(true);
    frozen(d);
  }, 60_000);

  it("les loups : la zone sous le goulot tue tant que le loup électronique n'a pas pris sa décharge", () => {
    const d = playTo("2.", stepIndex("2.", "loup électronique"));
    d.press("c 103 145 1");
    d.until((x) => dead(x, "TROP PRES !"), "les loups", 300);
    expect(d.bg).toBe("L12.PI1");
    frozen(d);
  }, 60_000);

  it("les moines du monastère : en habit de paysan (globale 200 = 1), ESPION ! dès l'entrée", () => {
    const from = stepIndex("2.", "habit de moine");
    const d = playTo("2.", from);
    runSteps(d, "2.", from + 1, stepIndex("2.", "entrée du monastère"));
    expect(d.state.globals[200]).toBe(1);
    d.until((x) => dead(x, "ESPION ! ESPION !"), "les moines", 600);
    expect(d.state.names.prc).toBe("PART02B.PRC");
    frozen(d);
  }, 60_000);

  it("le cloître : un pas dans le sens interdit est une faute (« Infidèle ! »), puis ESPION ! ; Nouvelle partie", () => {
    const d = playTo("2.", stepIndex("2.", "le tour du cloître"));
    expect(d.state.globals[200]).toBe(2);
    d.press("c 221 144 1");
    d.until((x) => dead(x, "ESPION ! ESPION !"), "les moines", 600);
    expect(d.saw("Infidèle ! Infidèle !")).toBe(true);
    frozen(d);
    d.systemMenu(NEW_GAME, CONFIRM);
    d.until((x) => x.bg === "LOGO.PI1", "le démarrage", 200);
  }, 60_000);

  it("la sécurité du navi-port (4315) arrête le héros qui revient du quai", () => {
    const d = playTo("3.", stepIndex("3.", "[30,158]"));
    expect(d.bg).toBe("L23.PI1");
    d.run({ walk: [160, 162], idle: false });
    d.until((x) => x.bg === "L22.PI1" && x.idle, "retour au navi-port", 600);
    d.press("c 161 194 1");
    d.until((x) => dead(x, "Et c'est ainsi que s'achève votre voyage", true), "la sécurité", 600);
    expect(d.saw("HALTE PLUS UN GESTE ! SECURITE !")).toBe(true);
    frozen(d);
  }, 60_000);

  it("le gaz de la cellule étouffe le héros qui ne bouche pas le conduit ; Nouvelle partie", () => {
    const d = playTo("3.", stepIndex("3.", "le journal bouche le conduit"));
    d.until((x) => dead(x, "le gaz s'est répandu dans toute la pièce"), "le gaz", 100);
    frozen(d);
    d.systemMenu(NEW_GAME, CONFIRM);
    d.until((x) => x.bg === "LOGO.PI1", "le démarrage", 200);
  }, 60_000);

  it("le comité d'accueil attend le héros dans la cabine si la caméra n'est pas aveuglée ; Charger", () => {
    const from = stepIndex("4.", "la caméra aveuglée");
    const d = playTo("4.", from);
    runSteps(d, "4.", from + 1, stepIndex("4.", "le couvercle se referme"));
    d.until((x) => x.saw("Le comité d'accueil est déja en place"), "le comité d'accueil", 3000);
    // Le script n'affiche que le message : plus aucun script ne tourne, les entrées restent permises (comme dans ScummVM).
    d.tick(5);
    expect(d.bg).toBe("L42.PI1");
    expect(d.state.globalScripts).toHaveLength(0);
    frozen(d, 50, 1);
    d.systemMenu(LOAD);
    expect(d.host.loadRequests).toBe(1);
  }, 60_000);

  it("les Crughons de la cabine repèrent le héros qui n'a pas avalé la pilule", () => {
    const d = playTo("4.", stepIndex("4.", "invisible pendant 180 ticks"));
    d.until((x) => dead(x, "c'est la fin de tous vos espoirs"), "les Crughons", 300);
    expect(d.saw("UN ESPION ! HALTE !")).toBe(true);
    frozen(d);
  }, 60_000);

  it("le compte à rebours du vaisseau-bombe : la Terre perdue si la bombe n'est pas reprogrammée ; la pause le fige", () => {
    const d = playTo("5.", 0);
    const start = d.engine.ticks;
    d.tick(100);
    // Pause du menu système : 30 s de temps virtuel sans aucun tick, compteur figé.
    const digits = countdown(d);
    expect(d.pause(3000)).toBe(0);
    expect(countdown(d)).toEqual(digits);
    d.until((x) => dead(x, "La bombe vient de détruire le dernier pole", true), "la fin du compte à rebours", 4000);
    expect(d.engine.ticks - start).toBe(COUNTDOWN_TICKS);
    frozen(d);
  }, 60_000);

  it("le compte à rebours : la bombe reprogrammée, le héros qui ne fuit pas reste à bord", () => {
    const d = playTo("5.", stepIndex("5.", "retour dans le labyrinthe, salle 71") + 1);
    expect(d.has("carte magnetique#14")).toBe(false);
    d.until((x) => dead(x, "Notre flotte vient d'être anéantie", true), "la fin du compte à rebours", 4000);
    frozen(d);
  }, 60_000);
});
