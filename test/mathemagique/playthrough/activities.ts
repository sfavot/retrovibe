/** Rockets, Bowling, Rhythm Shop, Pattern Windows et le Hall of Fame : parcours du robot. */
import { hitTestShape } from "../../../src/games/mathemagique/engine/graphics/blit";
import { SceneId } from "../../../src/games/mathemagique/engine/scene";
import type { BowlingScene } from "../../../src/games/mathemagique/scenes/bowling";
import { LEVEL_SHAPES, OPERATION_EDGES } from "../../../src/games/mathemagique/scenes/bowling-view";
import { HUB_OBJECT } from "../../../src/games/mathemagique/scenes/hub-logic";
import { PatternWindowsScene } from "../../../src/games/mathemagique/scenes/pattern-windows";
import type { RhythmScene } from "../../../src/games/mathemagique/scenes/rhythm";
import { BUTTONS as RHYTHM_BUTTONS, edgesRect } from "../../../src/games/mathemagique/scenes/rhythm-view";
import { BIN_EDGES, pieceSpan, type BinId } from "../../../src/games/mathemagique/game/rhythm/pieces";
import type { RocketsScene } from "../../../src/games/mathemagique/scenes/rockets";
import { hitTestSlots, rocketMaskId } from "../../../src/games/mathemagique/scenes/rockets-logic";
import { monkey } from "./chaos";
import { helpSession } from "./help";
import { launch, centerOf } from "./hub";
import type { Robot } from "./robot";

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// --- Rockets -------------------------------------------------------------------------------------------------------------------

const ROCKETS = {
  poly: [500, 300],
  friend: [437, 360],
  polyButton: [366, 360],
  help: [275, 338],
  exit: [308, 338],
  reset: [290, 368],
  maxDigit: [284, 136],
  pad13: [150, 357],
  pad: [245, 375],
} as const satisfies Record<string, readonly [number, number]>;

async function rocketsIdle(r: Robot, scene: () => RocketsScene, what: string): Promise<boolean> {
  await r.run(100);
  return r.until(() => !scene().busy, 300_000, `Rockets : ${what}`);
}

/** Lance une fusée : un clic sur un pixel d'un emplacement plein que la zone de Poly (x ≥ 472) ne capte pas. */
async function launchRocket(r: Robot, scene: () => RocketsScene): Promise<boolean> {
  const s = scene();
  const archive = r.engine.ctx.resources.require("NIM.DAT");
  const mask = (type: number) => archive.shap(rocketMaskId(type));
  for (let j = s.state.slots.length - 1; j >= 0; j--) {
    const slot = s.state.slots[j]!;
    if (slot.type === null) continue;
    for (let y = slot.y; y < slot.y + slot.h; y++) {
      for (let x = slot.x; x < Math.min(slot.x + slot.w, 470); x++) {
        if (hitTestSlots(s.state.slots, x, y, mask) !== j) continue;
        const before = s.state.launched;
        r.host.click(x, y);
        if (!(await rocketsIdle(r, scene, "lancement d'une fusée"))) return false;
        // Contre Poly, la M-ième fusée de l'enfant déclenche le tour de Poly (qui en lance d'autres).
        const exact = s.state.mode === "friend";
        if (exact ? s.state.launched !== before + 1 : s.state.launched < before + 1) {
          r.problem("jeu", `Rockets : le clic sur l'emplacement ${j} n'a pas lancé de fusée (${before} → ${s.state.launched}, mode ${s.state.mode})`);
        }
        return true;
      }
    }
  }
  r.problem("jeu", "Rockets : aucune fusée n'est touchable alors que la partie n'est pas finie");
  return false;
}

async function playRocketsGame(r: Robot, scene: () => RocketsScene, mode: "poly" | "friend"): Promise<void> {
  const total = scene().state.total;
  if (mode === "poly" && r.rng.chance(0.4)) {
    r.host.click(...ROCKETS.poly); // Poly commence
    await rocketsIdle(r, scene, "Poly commence");
  }
  const perfect = r.rng.chance(0.5);
  for (let turn = 0; turn < 60 && scene().state.launched < total; turn++) {
    const state = scene().state;
    const M = state.maxTake;
    const left = total - state.launched;
    let take = 1 + r.rng.below(M);
    if (perfect && mode === "poly") take = left % (M + 1) || 1;
    take = Math.min(take, left);
    for (let i = 0; i < take && scene().state.launched < total; i++) {
      if (!(await launchRocket(r, scene))) return;
    }
    if (scene().state.launched >= total) break;
    if (mode === "poly" && scene().state.launchedThisTurn > 0 && scene().state.launchedThisTurn < M) {
      r.host.click(...ROCKETS.poly); // fin du tour : Poly joue
      if (!(await rocketsIdle(r, scene, "tour de Poly"))) return;
    }
  }
  if (scene().state.launched < total) {
    r.problem("bloqué", `Rockets (${mode}) : la partie de ${total} fusées ne se termine pas (lancées ${scene().state.launched})`);
    return;
  }
  if (scene().lastResult === null) r.problem("jeu", `Rockets (${mode}) : toutes les fusées sont lancées mais il n'y a pas de vainqueur`);
  r.note(`Rockets ${mode} : ${total} fusées, vainqueur ${String(scene().lastResult)}`);
  // Partie finie : un clic sur Poly rappelle que c'est fini, Reset recommence.
  if (mode === "poly") {
    r.host.click(...ROCKETS.poly);
    await rocketsIdle(r, scene, "Poly après la fin");
  }
  r.host.click(...ROCKETS.reset);
  await r.run(300);
  await rocketsIdle(r, scene, "Reset");
  if (scene().state.launched !== 0) r.problem("jeu", "Rockets : Reset laisse des fusées lancées");
}

export async function playRockets(r: Robot, withHelp: boolean): Promise<void> {
  if (!(await launch(r, HUB_OBJECT.shelf, SceneId.rockets, "Rockets"))) return;
  const scene = () => r.engine.scenes.current as RocketsScene;
  await r.run(500);
  if (!(await rocketsIdle(r, scene, "accueil de Poly"))) return;
  // Réglages : limite M (clic sur le chiffre), nombre de fusées (pavé ou « ? »).
  const clicksOnM = r.rng.below(4);
  for (let i = 0; i < clicksOnM; i++) {
    r.host.click(...ROCKETS.maxDigit);
    await rocketsIdle(r, scene, "changement de M");
  }
  if (r.rng.chance(0.5)) {
    r.host.click(...ROCKETS.pad13);
    await rocketsIdle(r, scene, "pavé");
  } else if (r.rng.chance(0.5)) {
    r.host.click(...ROCKETS.pad);
    await rocketsIdle(r, scene, "pavé « ? »");
  }
  if (withHelp) {
    await helpSession(r, "Rockets", ROCKETS.help, () => scene().helpOpen, ROCKETS.poly, [[250, 136], [300, 200]]);
    await rocketsIdle(r, scene, "après l'aide");
  }
  await playRocketsGame(r, scene, "poly");
  // Contre un ami, puis retour contre Poly.
  r.host.click(...ROCKETS.friend);
  await rocketsIdle(r, scene, "mode ami");
  if (scene().state.mode !== "friend") r.problem("jeu", "Rockets : le bouton Ami ne passe pas en mode ami");
  else await playRocketsGame(r, scene, "friend");
  r.host.click(...ROCKETS.polyButton);
  await rocketsIdle(r, scene, "retour contre Poly");
  if (scene().state.mode !== "poly") r.problem("jeu", "Rockets : le bouton Poly ne revient pas en mode Poly");
  r.checkRoster("Rockets", false);
  if (r.rng.chance(0.5) && r.currentId === SceneId.rockets) {
    await monkey(r, 4000, [[...ROCKETS.exit, 40], [...ROCKETS.help, 40]]);
    await rocketsIdle(r, scene, "après le singe");
  }
  if (r.currentId !== SceneId.rockets) return;
  await r.leave("Rockets : Exit → hub", () => r.click(...ROCKETS.exit, 200));
}

// --- Bowling -------------------------------------------------------------------------------------------------------------------

const GO: [number, number] = [463, 130];
const BOWLING = { help: [474, 176], exit: [86, 246], trophy: [508, 127], polly: [450, 400] } as const;

const answerSlot = (slot: number): [number, number] => [173 + 74 * slot, 169];
const center = (e: readonly [number, number, number, number]): [number, number] => [(e[0] + e[2]) >> 1, (e[1] + e[3]) >> 1];

async function bowlingAnswer(r: Robot, scene: () => BowlingScene, right: boolean, byKey: boolean): Promise<boolean> {
  const q = scene().currentQuestion;
  if (!q) {
    r.problem("jeu", "Bowling : partie en cours sans question affichée");
    return false;
  }
  const slot = right ? q.correctSlot : (q.correctSlot + 1 + r.rng.below(3)) % 4;
  if (byKey) {
    r.host.input.keyDown({ code: `Digit${slot + 1}`, key: String(slot + 1), ctrl: false, shift: false, alt: false });
    r.host.input.keyUp(`Digit${slot + 1}`, { ctrl: false, shift: false, alt: false });
    await r.run(100);
  } else await r.click(...answerSlot(slot), 100);
  return r.until(() => !scene().busy, 180_000, "Bowling : animation après une réponse");
}

/** Entre dans le Bowling, attend la scène prête. */
async function enterBowling(r: Robot): Promise<boolean> {
  if (!(await launch(r, HUB_OBJECT.curtain, SceneId.bowling, "Bowling"))) return false;
  return r.until(() => (r.engine.scenes.current as BowlingScene).ready, 120_000, "Bowling : scène prête");
}

async function chooseBowling(r: Robot, scene: () => BowlingScene, operation: number, level: number): Promise<void> {
  await r.click(...center(OPERATION_EDGES[operation]!), 150);
  if (scene().progressState.operation !== operation) r.problem("jeu", `Bowling : le clic sur l'opération ${operation} laisse l'opération ${scene().progressState.operation}`);
  await r.click(...center(LEVEL_SHAPES[level]!.edges), 150);
  if (scene().progressState.level !== level) r.problem("jeu", `Bowling : le clic sur le niveau ${level} laisse le niveau ${scene().progressState.level} (opération ${operation})`);
}

export async function playBowling(r: Robot, withHelp: boolean, withTrophy: boolean, fullLevel = false): Promise<void> {
  // Le joueur doit avoir réussi un niveau pour avoir un certificat : on lui en donne un avant d'entrer (l'état public du roster, comme
  // les tests) ; le Bowling garde son propre exemplaire du masque pendant la visite.
  const roster = r.engine.ctx.roster;
  if (withTrophy && roster.currentPlayerId > 0 && roster.roster.getMask(roster.currentPlayerId) === 0) {
    roster.roster.setAchievement(roster.currentPlayerId, r.rng.below(6), r.rng.below(4));
    roster.save();
  }
  if (!(await enterBowling(r))) return;
  const scene = () => r.engine.scenes.current as BowlingScene;
  const operation = r.rng.below(6);
  const level = r.rng.below(4);
  await chooseBowling(r, scene, operation, level);
  r.note(`Bowling opération ${operation} niveau ${scene().progressState.level}`);
  if (withHelp) {
    await r.click(...BOWLING.help, 300);
    if (!(await r.tryUntil(() => scene().helper.active, 8000))) r.problem("aide", "Bowling : le bouton d'aide n'ouvre pas Polly");
    else {
      await r.run(8000);
      for (let attempt = 0; attempt < 8 && scene().helper.active; attempt++) {
        await r.click(...BOWLING.polly, 200);
        await r.tryUntil(() => !scene().helper.active, 20_000);
        await r.run(3000);
      }
      if (scene().helper.active) r.problem("bloqué", "Bowling : l'aide de Polly ne se referme pas après un clic sur elle");
    }
  }
  // Quelques questions mêlant bonnes et mauvaises réponses (clic et clavier), puis STOP.
  await r.click(...GO, 150);
  if (!scene().playing) r.problem("jeu", "Bowling : GO ne lance pas la partie");
  else {
    const count = 3 + r.rng.below(4);
    for (let i = 0; i < count && scene().playing; i++) {
      if (!(await bowlingAnswer(r, scene, r.rng.chance(0.6), r.rng.chance(0.3)))) break;
    }
    if (scene().playing) {
      await r.click(...GO, 150);
      if (scene().playing) r.problem("jeu", "Bowling : GO pendant la partie (STOP) ne l'arrête pas");
    }
  }
  // Un strike : dix bonnes réponses de suite.
  await r.until(() => !scene().busy, 120_000, "Bowling : repos avant le strike");
  await r.click(...GO, 150);
  if (scene().playing) {
    const strikesBefore = scene().progressState.currentStrikes;
    for (let i = 0; i < 10 && scene().playing; i++) {
      if (!(await bowlingAnswer(r, scene, true, r.rng.chance(0.2)))) break;
    }
    await r.until(() => !scene().busy, 180_000, "Bowling : animation du strike");
    const gained = scene().progressState.currentStrikes - strikesBefore;
    if (gained !== 1 && scene().progressState.currentStrikes !== 0) r.problem("jeu", `Bowling : dix bonnes réponses de suite donnent ${gained} strike(s)`);
    r.note(`Bowling : strike (${scene().progressState.currentStrikes} au compteur)`);
  } else r.problem("jeu", "Bowling : GO ne relance pas la partie pour le strike");
  if (fullLevel) await finishBowlingLevel(r, scene, operation);
  r.checkRoster("Bowling", false);
  if (withTrophy) await visitTrophy(r);
  if (r.currentId !== SceneId.bowling) return;
  await r.until(() => scene().ready, 120_000, "Bowling : scène prête après le trophée");
  if (r.rng.chance(0.5)) {
    await monkey(r, 4000, [[...BOWLING.exit, 40], [...BOWLING.trophy, 30], [...BOWLING.help, 30]]);
    if (r.currentId !== SceneId.bowling) return;
    await r.until(() => !scene().busy, 180_000, "Bowling : après le singe");
  }
  await r.leave("Bowling : Exit → hub", () => r.click(...BOWLING.exit, 100));
}

/** Enchaîne les strikes jusqu'au dixième : le niveau est réussi, le bit du masque est écrit, le rang monte. */
async function finishBowlingLevel(r: Robot, scene: () => BowlingScene, operation: number): Promise<void> {
  const roster = r.engine.ctx.roster;
  const player = roster.currentPlayerId;
  const level = scene().progressState.level;
  if (level > 3 || player === 0) return;
  const gradeBefore = roster.roster.grade(player);
  const already = roster.roster.hasAchievement(player, operation, level);
  for (let round = 0; round < 14 && scene().progressState.level === level && scene().progressState.operation === operation; round++) {
    await r.until(() => !scene().busy, 180_000, "Bowling : repos avant un strike");
    await r.click(...GO, 150);
    if (!scene().playing) {
      r.problem("jeu", "Bowling : GO ne lance pas la partie (enchaînement des strikes)");
      return;
    }
    for (let i = 0; i < 10 && scene().playing; i++) {
      if (!(await bowlingAnswer(r, scene, true, false))) return;
    }
  }
  await r.until(() => !scene().busy, 180_000, "Bowling : animation de fin de niveau");
  if (scene().progressState.level === level && !already) {
    r.problem("jeu", `Bowling : 14 parties de dix bonnes réponses n'ont pas fini le niveau ${level} de l'opération ${operation} (strikes ${scene().progressState.currentStrikes})`);
    return;
  }
  if (!already) {
    if (!roster.roster.hasAchievement(player, operation, level)) r.problem("jeu", `Bowling : niveau ${level} de l'opération ${operation} réussi mais le bit du masque n'est pas écrit`);
    if (roster.roster.grade(player) <= gradeBefore && level < 4) r.problem("jeu", `Bowling : le rang ne monte pas après le niveau ${level} (${gradeBefore} → ${roster.roster.grade(player)})`);
    r.note(`Bowling : niveau ${level} de l'opération ${operation} réussi (rang ${roster.roster.grade(player)})`);
  }
  r.checkRoster("Bowling : niveau réussi", true);
}

/** Deuxième visite : durée de 2 s, GO, la partie s'arrête toute seule. */
export async function playBowlingTimeout(r: Robot): Promise<void> {
  if (!(await enterBowling(r))) return;
  const scene = () => r.engine.scenes.current as BowlingScene;
  await chooseBowling(r, scene, r.rng.below(6), 0);
  await r.click(...GO, 150);
  if (!scene().playing) r.problem("jeu", "Bowling : GO ne lance pas la partie chronométrée");
  else {
    const ticks = scene().gameTimer.totalTicks;
    if (ticks !== r.engine.ctx.roster.roster.bowlingTicks) r.problem("jeu", `Bowling : minuterie de ${ticks} ticks, préférence de ${r.engine.ctx.roster.roster.bowlingTicks}`);
    if (await r.until(() => !scene().playing, 60_000, "Bowling : fin de la partie au temps écoulé")) {
      await r.until(() => !scene().busy, 120_000, "Bowling : réaction de Gus au temps écoulé");
      r.note("Bowling : temps écoulé");
    }
  }
  await r.leave("Bowling (temps écoulé) : Exit → hub", () => r.click(...BOWLING.exit, 100));
}

/** Bowling → Hall of Fame → certificat (port factice) → retour au Bowling. */
async function visitTrophy(r: Robot): Promise<void> {
  const roster = r.engine.ctx.roster;
  await r.click(...BOWLING.trophy, 150);
  if (!(await r.until(() => r.currentId === SceneId.trophy, 90_000, "Bowling : trophée → Hall of Fame"))) return;
  await r.run(2000);
  const print = async (what: string) => {
    const files = r.certificates.files.length;
    await r.click(280, 390, 300);
    for (let i = 0; i < 40 && r.certificates.files.length === files; i++) await realSleep(25);
    if (r.certificates.files.length === files) {
      r.problem("certificat", `Hall of Fame : « Print My Certificate » (${what}) ne remet aucun fichier au port de téléchargement`);
      return;
    }
    const last = r.certificates.files.at(-1)!;
    if (!/^certificat-[a-z]+-.+\.png$/.test(last.filename) || last.type !== "image/png" || last.size === 0) r.problem("certificat", `Hall of Fame : fichier inattendu ${last.filename} (${last.type}, ${last.size} octets)`);
    r.note(`certificat remis (${what}) : ${last.filename}`);
  };
  // La cellule sélectionnée d'office, puis la cellule de l'opération gagnée choisie au clic.
  await print("sélection d'office");
  const gained = roster.roster.getMask(roster.currentPlayerId) !== 0;
  if (gained) {
    for (let op = 0; op < 6; op++) {
      if (![0, 1, 2, 3].some((level) => roster.roster.hasAchievement(roster.currentPlayerId, op, level))) continue;
      await r.click(172 + 60 * op + 20, 90, 150);
      await print(`cellule de l'opération ${op}`);
      break;
    }
  }
  // Page suivante puis précédente.
  await r.click(47, 60, 150);
  await r.click(47, 40, 150);
  await r.click(519, 390, 100);
  await r.until(() => r.currentId === SceneId.bowling, 90_000, "Hall of Fame : EXIT → Bowling");
}

// --- Rhythm Shop ---------------------------------------------------------------------------------------------------------------

async function rhythmButton(r: Robot, role: string): Promise<void> {
  const b = RHYTHM_BUTTONS.find((x) => x.role === role)!;
  const rect = edgesRect(b.edges);
  await r.click(rect.x + 5, rect.y + 5, 100);
}

async function rhythmMove(r: Robot, scene: () => RhythmScene, drag: boolean, from: BinId, fromIndex: number, to: BinId, toIndex = 0): Promise<void> {
  const s = scene().inspect();
  const words = from === "parts" ? s.parts : from === "pattern" ? s.pattern : s.fractionator;
  const span = pieceSpan(from, words, fromIndex);
  const sx = span.x + Math.min(10, span.w - 1);
  const sy = BIN_EDGES[from][1] + 20;
  let tx: number;
  if (to === "pattern") tx = pieceSpan("pattern", s.pattern, toIndex).x + 5;
  else tx = BIN_EDGES[to][0] + 20;
  const ty = BIN_EDGES[to][1] + 20;
  r.host.input.moveMouse(sx, sy);
  r.host.input.mouseDown("left");
  if (!drag) r.host.input.mouseUp("left");
  await r.run(100);
  r.host.input.moveMouse(tx, ty);
  await r.run(100);
  if (drag) r.host.input.mouseUp("left");
  else {
    r.host.input.mouseDown("left");
    r.host.input.mouseUp("left");
  }
  await r.run(100);
}

export async function playRhythm(r: Robot, drag: boolean, withHelp: boolean): Promise<void> {
  if (!(await launch(r, HUB_OBJECT.gear, SceneId.rhythm, "Rhythm Shop"))) return;
  const scene = () => r.engine.scenes.current as RhythmScene;
  const idle = () => r.until(() => scene().inspect().state === "idle", 120_000, "Rhythm Shop : repos");
  if (!(await idle())) return;
  const first = scene().inspect();
  if (withHelp) {
    await rhythmButton(r, "help");
    if (scene().inspect().state !== "help") r.problem("aide", "Rhythm Shop : le bouton d'aide n'ouvre pas Poly");
    else {
      await r.run(6000);
      for (let attempt = 0; attempt < 10 && scene().inspect().state === "help"; attempt++) {
        await r.click(300, 100, 300);
        await r.run(4000);
        await r.click(300, 250, 300);
        await r.run(8000);
        if (attempt > 1) await r.click(460, 350, 300); // la main stop / Poly met fin à l'aide
      }
      if (scene().inspect().state === "help") r.problem("bloqué", "Rhythm Shop : l'aide de Poly ne se referme pas");
      await idle();
    }
  }
  // Erreurs d'abord : un dépôt sur un bac interdit, une action sans pièce, outils par Tab.
  await rhythmMove(r, scene, drag, "parts", 0, "pattern", 0);
  await r.press("Tab", "Tab", 80);
  await rhythmButton(r, "doIt");
  await idle();
  if (first.songName === "Fanfare" && first.parts.length === 1 && first.parts[0] === 144) {
    // Fanfare, variante 0 : 144 → Fractionator, Cutter, puis chaque moitié dans le Pattern Bin.
    await rhythmMove(r, scene, drag, "parts", 0, "fractionator");
    await r.press("Digit1", "1", 60); // outil 1 : Cutter
    await rhythmButton(r, "doIt");
    await r.until(() => scene().inspect().fractionator.length === 2 || scene().inspect().state === "idle", 60_000, "Rhythm Shop : Cutter");
    await idle();
    await rhythmMove(r, scene, drag, "fractionator", 0, "pattern", 0);
    await rhythmMove(r, scene, drag, "fractionator", 0, "pattern", 1);
    if (await r.until(() => scene().inspect().state === "playing" || scene().inspect().state === "finale", 30_000, "Rhythm Shop : le motif complet lance le morceau")) {
      await r.until(() => scene().inspect().state === "finale" || scene().inspect().state === "idle", 300_000, "Rhythm Shop : fin du morceau");
      await idle();
      const variant = r.engine.ctx.roster.roster.getVar(r.engine.ctx.roster.currentPlayerId, "rhythmVariant", 0);
      r.note(`Rhythm Shop : Fanfare résolue (variante suivante ${variant})`);
    }
  } else r.note(`Rhythm Shop : morceau ${first.songName} (recette ${first.recipe.join(" ")}), pas de solution connue du robot`);
  // Morceaux suivant / précédent.
  await rhythmButton(r, "next");
  await rhythmButton(r, "previous");
  r.checkRoster("Rhythm Shop", false);
  if (r.rng.chance(0.5)) {
    const exit = edgesRect(RHYTHM_BUTTONS.find((x) => x.role === "exit")!.edges);
    const help = edgesRect(RHYTHM_BUTTONS.find((x) => x.role === "help")!.edges);
    await monkey(r, 4000, [[exit.x + 20, exit.y + 15, 50], [help.x + 15, help.y + 15, 40]]);
    if (r.currentId !== SceneId.rhythm) return;
    await r.tryUntil(() => scene().inspect().state === "idle", 120_000);
  }
  await r.leave("Rhythm Shop : Exit → hub", () => rhythmButton(r, "exit"));
}

// --- Pattern Windows -----------------------------------------------------------------------------------------------------------

const PW = {
  print: [501, 383],
  kaleidoscope: [432, 383],
  left: [420, 83],
  right: [519, 83],
  faucet: [467, 383],
  help: [510, 353],
  yuck: [422, 353],
  exit: [466, 351],
  poly: [350, 400],
} as const satisfies Record<string, readonly [number, number]>;

export async function playPatternWindows(r: Robot, drag: boolean, withHelp: boolean): Promise<void> {
  const skylights = [HUB_OBJECT.skylight1, HUB_OBJECT.skylight2, HUB_OBJECT.skylight3, HUB_OBJECT.skylight4];
  const skylight = r.rng.pick(skylights);
  if (!(await launch(r, skylight, SceneId.patternWindows, `Pattern Windows (lucarne ${skylight - 1})`))) return;
  const scene = () => r.engine.scenes.current as PatternWindowsScene;
  if (!(await r.until(() => scene().flowKind === "normal", 120_000, "Pattern Windows : fin de l'entrée"))) return;
  await r.run(500);
  const click = (p: readonly [number, number], ms = 100) => r.click(p[0], p[1], ms);
  const clickColor = async (color: number) => {
    const column = Math.floor(color / 5);
    const k = color % 5;
    await r.click([428, 467, 511][column]!, [162, 146, 162][column]! + 39 * k, 100);
  };
  const pointIn = (index: number): [number, number] | null => {
    const archive = r.engine.ctx.resources.require("PATFILL.DAT");
    const cells = scene().cellDefs;
    const cell = cells[index]!;
    for (let dy = 0; dy < cell.height; dy++) {
      for (let dx = 0; dx < cell.width; dx++) {
        if (!hitTestShape(archive.shap(cell.maskId), dx, dy)) continue;
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (x < 52 || y < 46 || x >= 393 || y >= 387) continue;
        const earlier = cells.slice(0, index).some((c) => x - c.x >= 0 && y - c.y >= 0 && x - c.x < c.width && y - c.y < c.height && hitTestShape(archive.shap(c.maskId), x - c.x, y - c.y));
        if (!earlier) return [x, y];
      }
    }
    return null;
  };
  // Motif, version, couleurs : quelques traits de peinture.
  const turns = r.rng.below(4);
  for (let i = 0; i < turns; i++) await click(r.rng.chance(0.7) ? PW.right : PW.left, 200);
  await r.click(441 + 28 * r.rng.below(3), 113, 150);
  r.note(`Pattern Windows motif ${scene().pattern} version ${scene().version} (${drag ? "glisser" : "cliquer-poser"})`);
  const strokes = 2 + r.rng.below(3);
  for (let s = 0; s < strokes; s++) {
    await clickColor(r.rng.below(15));
    const cells = scene().cellDefs.length;
    const points = Array.from({ length: 3 }, () => pointIn(r.rng.below(cells))).filter((p): p is [number, number] => p !== null);
    if (points.length === 0) continue;
    if (drag) {
      r.host.input.moveMouse(...points[0]!);
      r.host.input.mouseDown("left");
      await r.run(17);
      for (const p of points.slice(1)) {
        r.host.input.moveMouse(...p);
        await r.run(17);
      }
      r.host.input.mouseUp("left");
      await r.run(34);
    } else for (const p of points) await r.click(p[0], p[1], 50);
  }
  if (r.rng.chance(0.5)) {
    await click(PW.faucet, 200);
    await click(PW.yuck, 200);
  }
  if (r.rng.chance(0.5)) {
    await click(PW.kaleidoscope, 200);
    await r.until(() => !scene().kaleidoscopeActive, 30_000, "Pattern Windows : fin du kaléidoscope");
  }
  if (withHelp) {
    await helpSession(r, "Pattern Windows", PW.help, () => scene().helper.active, PW.poly, [[200, 200]]);
    await r.until(() => scene().flowKind === "normal", 60_000, "Pattern Windows : retour de l'aide");
  }
  // Imprimer : le PNG de la fenêtre part au port de téléchargement.
  const files = r.certificates.files.length;
  await click(PW.print, 300);
  for (let i = 0; i < 40 && r.certificates.files.length === files; i++) await realSleep(25);
  if (r.certificates.files.length === files) r.problem("certificat", "Pattern Windows : « Print » ne remet aucun fichier au port de téléchargement");
  else r.note(`vitrail enregistré : ${r.certificates.files.at(-1)!.filename}`);
  if (r.rng.chance(0.5)) {
    await monkey(r, 4000, [[...PW.exit, 40], [...PW.print, 30], [...PW.help, 30]]);
    if (r.currentId !== SceneId.patternWindows) return;
  }
  await r.leave("Pattern Windows : Exit → hub", () => click(PW.exit, 100));
  await hubSaved(r);
}

/** Le vitrail est dans le roster enregistré : relu depuis le stockage. */
async function hubSaved(r: Robot): Promise<void> {
  r.checkRoster("Pattern Windows enregistré", false);
}
void centerOf;
