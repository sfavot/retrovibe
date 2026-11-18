import { announceVoice, initGame, saveSetup, squareVisible, step, testVictory } from "../game/rules";
import { SQUARE } from "../game/state";
import { Board, DIE_X, DIE_Y, SPRITE_ARROW } from "./board";
import { minigameSquare } from "./minigame";
import { quizSquare } from "./quiz";
import { DOWN, Runtime, UP, VOICES, type Script, type Zone } from "./runtime";
import { clearSave, writeSave, SAVE_VERSION, type GameSave } from "./save";
import { drawScoreCounters, drawScoreTable, marble, pause, scoreScreen, showMap } from "./screens";
import { choosePlayers, settings } from "./setup";
import {
  detritusSquare,
  merchantSquare,
  potionSquare,
  prisonSquare,
  prisonTurnStart,
  restSquare,
  soothsayerSquare,
  spySquare,
  surpriseSquare,
  trapSquare,
} from "./squares";

/**
 * Partie d'Astérix (`docs/asterix/engine.md` §9) : boucle de partie `1abf:2431`, tour d'un joueur `1abf:0f99`, annonce,
 * menu du tour, dé, déplacement et écran de fin.
 */

/** Contexte d'une partie : le socle et l'écran de jeu. */
export interface Play {
  rt: Runtime;
  board: Board;
}

/** Zones (D11) du menu du tour : le dé, le marbre de route (plaque grise) et la carte (plaque rose) du panneau droit. */
const TURN_ZONES: readonly Zone[] = [
  { x1: 262, y1: 84, x2: 312, y2: 116 },
  { x1: 258, y1: 120, x2: 312, y2: 154 },
  { x1: 258, y1: 158, x2: 312, y2: 192 },
];
/** Position du curseur flèche pour chaque choix (la flèche est dessinée en (x − 32, y − 40)). */
const TURN_ARROWS: readonly (readonly [number, number])[] = [
  [0x142, 0x8d],
  [0x146, 0xa9],
  [0x146, 0xd0],
];

/**
 * `1abf:01b4(v)` : lance la voix d'annonce sans attendre et fait clignoter le pion par pas de 10 cs, 8 pas au moins puis
 * jusqu'à la fin de la voix. Un clic gauche coupe la voix (pas un clic simulé de la démo) ; sans voix (`v < 0`), il
 * arrête aussitôt le clignotement (`1abf:022f`).
 */
function* announce(play: Play, voice: number): Script {
  const { rt, board } = play;
  if (voice >= 0) {
    const sound = yield* rt.loadVoice(voice);
    if (sound) rt.ctx.voice.play(sound);
  }
  rt.restore();
  for (let i = 0; ; ) {
    yield* board.drawPawn();
    if (i % 2 !== 0) rt.restore();
    if (yield* rt.waitOrClick(10)) {
      if (voice < 0) return;
      // `1abf:0233` : en démo, un clic simulé ne coupe pas l'annonce ; il faut une entrée réelle.
      if (!rt.demo || rt.demoInterrupted) {
        yield* board.drawPawn();
        rt.stopSound();
        yield* rt.waitRelease();
        break;
      }
    }
    i++;
    if (i > 7 && (voice < 0 || !rt.ctx.voice.voicePlaying)) break;
  }
  if (voice >= 0) yield* rt.wait(10);
}

/**
 * `1abf:08e4` : menu du tour. Curseur sur le dé (0), le marbre de route (1) ou la carte (2). Rend vrai pour lancer le dé
 * (ou si la partie s'arrête : FIN, abandon), faux après 15 s sans clic. Consulter le marbre ou la carte relance le délai.
 */
function* turnMenu(play: Play): Script<boolean> {
  const { rt, board } = play;
  const { game } = rt;
  let cursor = 0;
  rt.sound("move");
  yield* rt.wait(6);
  rt.screen = "turn";
  rt.startChrono(0);
  for (;;) {
    rt.restore();
    const directions = rt.dirs();
    let moved = false;
    if (directions & UP) {
      moved = true;
      if (cursor > 0) {
        rt.sound("move");
        cursor--;
      }
    }
    if (directions & DOWN && !moved) {
      moved = true;
      if (cursor < 2) {
        rt.sound("move");
        cursor++;
      }
    }
    const click = rt.click(TURN_ZONES);
    if (typeof click === "number") cursor = click;
    yield* board.drawPawn();
    rt.sprite(rt.boardSprites, SPRITE_ARROW, TURN_ARROWS[cursor][0] - 0x20, TURN_ARROWS[cursor][1] - 0x28);
    if (moved) yield* rt.wait(0xf);
    // Touche P, ou les deux boutons : pause M48, qui n'use pas le temps de partie.
    if (rt.ctx.input.justPressed("pause") || (rt.ctx.input.pressed("validate") && rt.ctx.input.pressed("cancel"))) {
      rt.sound("validate");
      yield* rt.waitRelease();
      yield* rt.cleanup();
      yield* rt.waitSound();
      yield* pause(rt);
      yield* board.show();
      rt.commit();
      rt.screen = "turn";
      rt.startChrono(0);
      cursor = 0;
      continue;
    }
    if (click !== null || rt.timedOut(15)) {
      if (click === null) {
        rt.screen = "";
        return false;
      }
      if (cursor === 0) {
        yield* rt.waitRelease();
        rt.screen = "";
        return true;
      }
      rt.sound("validate");
      yield* rt.waitSound();
      yield* rt.waitRelease();
      yield* rt.cleanup();
      if (cursor === 1) {
        yield* marble(rt);
        if (!game.abandoned && !game.quit) {
          yield* board.show();
          rt.commit();
          rt.sound("move");
        }
      } else {
        yield* showMap(rt);
        yield* board.show();
        rt.commit();
        rt.sound("move");
        yield* rt.waitSound();
      }
      rt.screen = "turn";
      rt.startChrono(0);
      cursor = 0;
    }
    if (game.quit || game.abandoned) {
      rt.screen = "";
      return true;
    }
    yield;
  }
}

/**
 * `1abf:0016` : le dé. Il n'y a pas de tirage direct : la face avance d'un cran toutes les 12 ticks ; un clic (ou 10 s)
 * arme un compteur de 3 à 6 crans (`3 + (rnd() & 3)`), et le dé s'arrête quand il tombe à zéro.
 */
function* rollDie(play: Play): Script<number> {
  const { rt, board } = play;
  const { game } = rt;
  let countdown = -1;
  let clicked = false;
  rt.screen = "die";
  rt.startChrono(0);
  do {
    rt.sound("dice");
    if (countdown > 0) countdown--;
    game.die = game.die < 6 && game.die > 0 ? game.die + 1 : 1;
    // L'image « en mouvement » (sprite pair) n'apparaît qu'un instant avant la face fixe.
    rt.restore();
    yield* board.drawPawn();
    rt.sprite(rt.boardSprites, game.die * 2, DIE_X, DIE_Y);
    if (rt.click() !== null) clicked = true;
    yield;
    rt.restore();
    yield* board.drawPawn();
    for (let tick = 1; tick < 12; tick++) {
      if (rt.click() !== null) clicked = true;
      yield;
    }
    if (rt.click() !== null) clicked = true;
    if (countdown < 0 && (clicked || rt.chrono(0) > 10)) countdown = (rt.rnd() & 3) + 3;
  } while (countdown !== 0);
  rt.stopSound();
  yield* rt.waitRelease();
  rt.screen = "";
  return game.die;
}

/**
 * `1abf:00f9(n)` : déplace le pion de `n` cases (signé), 0,3 s d'attente puis 0,3 s par case, un bruitage par case.
 * Aucun effet au passage. Rend le type de la case d'arrivée.
 */
function* movePawn(play: Play, count: number): Script<number> {
  const { rt, board } = play;
  const player = board.player;
  for (let i = 0; i <= Math.abs(count); i++) {
    if (i > 0) {
      rt.sound("step");
      player.pos = step(player.pos, Math.sign(count));
    }
    for (let frame = 0; frame < 3; frame++) {
      rt.restore();
      yield* board.drawPawn();
      yield* rt.wait(10);
    }
  }
  return rt.tables.board[player.pos];
}

/** `1abf:0f99` : tour complet du joueur courant (§9.4). */
function* playTurn(play: Play): Script {
  const { rt, board } = play;
  const { game, session } = rt;
  const player = board.player;
  game.topRow = Math.floor(player.pos / 3);
  yield* board.show();
  rt.commit();

  // Annonce (§9.5) : aucune voix en solo ni pour un prisonnier qui a une gourde.
  rt.voiceKey = VOICES.turn;
  yield* announce(play, announceVoice(game, session, rt.rnd));

  if (player.inPrison) {
    rt.restore();
    if (yield* prisonTurnStart(play)) return;
    rt.voiceKey = VOICES.turn;
  }

  // Menu du tour et règle du délai (§9.6) : rappel au premier délai de 15 s, tour perdu au second (à plusieurs).
  let roll = yield* turnMenu(play);
  if (!roll) {
    rt.voiceKey = VOICES.turn;
    if (game.players.length < 2) {
      if (rt.rnd() % 3 === 0) yield* rt.voice(0x65);
    } else {
      yield* rt.voice(player.character + 0x66);
    }
    roll = yield* turnMenu(play);
    if (!roll) {
      if (game.players.length > 1) {
        rt.voiceKey = VOICES.turn;
        yield* rt.voice(player.character + 0x6c);
        return;
      }
      // En solo le dé part tout seul.
      roll = true;
    }
  }
  // Démo interrompue par une entrée réelle : le tour s'arrête après le menu (`1abf:10cd`, `1abf:1141`).
  if (game.quit || game.abandoned || rt.demoStopped) return;

  const face = yield* rollDie(play);
  yield* movePawn(play, face);
  // Avec tous ses objets on gagne dès l'arrivée : la case n'est pas jouée (§9.9).
  if (testVictory(game)) return;
  // `1abf:1199`.
  if (rt.demoStopped) return;

  // Effet de la case d'arrivée (table `1abf:13cf`) ; espion, piège et surprise-espion font jouer la nouvelle case.
  let chained = false;
  for (;;) {
    let again = false;
    if (chained) {
      if (!squareVisible(game.topRow, player.pos)) game.topRow = Math.floor(player.pos / 3);
      yield* board.show();
      rt.commit();
      rt.restore();
      for (let i = 0; i < 7; i++) {
        yield* board.drawPawn();
        if (i % 2 !== 0) rt.restore();
        yield* rt.wait(10);
      }
      chained = false;
    }
    const square = rt.tables.board[player.pos];
    yield* rt.cleanup();
    if (square === SQUARE.rest) yield* restSquare(play);
    else if (square === SQUARE.prison) yield* prisonSquare(play);
    else if (square === SQUARE.game) yield* minigameSquare(play);
    else if (square === SQUARE.trap) {
      yield* trapSquare(play);
      again = true;
    } else if (square === SQUARE.detritus) yield* detritusSquare(play, false);
    else if (square === SQUARE.potion) yield* potionSquare(play);
    else if (square === SQUARE.spy) {
      yield* spySquare(play);
      chained = true;
    } else if (square === SQUARE.country) yield* quizSquare(play);
    else if (square === SQUARE.merchant) yield* merchantSquare(play);
    else if (square === SQUARE.soothsayer) yield* soothsayerSquare(play);
    else if (square === SQUARE.surprise) chained = yield* surpriseSquare(play);
    testVictory(game);
    if (!chained && !again) return;
    // `1abf:13b8` : la démo interrompue ne joue pas la case suivante.
    if (game.quit || game.abandoned || game.victory || rt.demoStopped) return;
  }
}

/**
 * `1abf:0d1c(nom)` : incruste le portrait du vainqueur. Ses 128 premières couleurs vont dans les couleurs 128..255, et
 * tout pixel différent de `0x7d` est posé sur l'écran avec `0x80` de plus.
 */
function* inlayPortrait(rt: Runtime, name: string): Script {
  const portrait = yield* rt.load(rt.ctx.resources.picture(name));
  const { work } = rt.ctx.surface;
  rt.ctx.palette.colors.set(portrait.palette.subarray(0, 384), 384);
  for (let i = 0; i < work.length; i++) {
    if (portrait.pixels[i] !== 0x7d) work[i] = (portrait.pixels[i] + 0x80) & 0xff;
  }
}

/** `1abf:0da3` : écran de fin, victoire d'un joueur ou temps écoulé (César gagne). */
function* endScreen(rt: Runtime): Script {
  const { game } = rt;
  rt.screen = "end";
  if (!game.victory) {
    yield* drawScoreTable(rt, 3);
    drawScoreCounters(rt);
    rt.commit();
    yield* rt.overlayVideo(0x2a, 0);
    yield* rt.overlayVideo(0xc, 0);
    yield* rt.voice(6, VOICES.panoramix);
    yield* rt.waitClick(4);
  } else {
    const winner = game.players[game.winner].character;
    rt.voiceKey = VOICES.victory;
    yield* drawScoreTable(rt, 3);
    drawScoreCounters(rt);
    rt.commit();
    yield* inlayPortrait(rt, `M11DA00${winner}.mcc`);
    yield* rt.voice(0xb);
    yield* rt.voice(winner);
    yield* rt.voice((rt.rnd() % 5) + 6);
    rt.restore();
    yield* rt.voice(6, VOICES.panoramix);
    yield* rt.waitClick(4);
    // Le tableau passe dans les couleurs 128..255, sous la vidéo de victoire en surimpression.
    rt.shiftUp();
    rt.commit();
    yield* rt.moduleVideo(0xb, 0, { overlay: true });
    yield* rt.fadeOut(32);
    yield* rt.picture("M11AB.mcc");
    rt.commit();
    yield* rt.moduleVideo(0xb, 1, { overlay: true, keepPalette: true });
  }
  yield* rt.cleanup();
  rt.screen = "";
}

/**
 * `1abf:2431` : une partie entière. `replay` : REJOUER (sans les écrans de réglage) ; `resume` : reprise d'une partie
 * sauvegardée, au début du tour où elle s'était arrêtée. Rend faux si la partie a été annulée à l'écran des joueurs.
 *
 * Partie de démo (`rt.demo`) : elle ne mémorise pas la configuration de REJOUER (`1abf:24b7`), ne baisse pas
 * `session.noGameYet` (`1abf:256e`) et ne touche pas à la sauvegarde du navigateur (décision D6). Une entrée réelle
 * l'arrête : pendant les réglages la partie est annulée (`1abf:244e`, `1abf:2460`), ensuite elle s'arrête à la fin du
 * tour en cours, sans écran de fin (`1abf:25c5`, `1abf:2607`).
 */
export function* playGame(rt: Runtime, replay: boolean, resume: GameSave | null = null): Script<boolean> {
  const { session } = rt;
  const { storage } = rt.ctx.host;
  if (resume) {
    rt.game = structuredClone(resume.state);
    rt.ctx.rng.seed(resume.rng);
    session.saved = structuredClone(resume.setup);
    session.duration = resume.state.duration;
    session.objectsRequired = resume.state.objectsRequired;
    session.shownRow = -1;
    // Une vraie partie est en cours : sans cela, après un rechargement de la page, la boucle ne baisserait `DS:1a02`
    // qu'au tour de table suivant, et un REJOUER venu avant (FIN, victoire) lancerait Astérix seul (`1abf:13e5`).
    session.noGameYet = false;
  } else {
    // La sauvegarde précédente n'est remplacée qu'au premier tour (`writeSave`) : ANNULER à l'écran des joueurs la garde.
    rt.game = initGame(session, rt.rnd, replay);
    if (!replay) {
      if (!(yield* choosePlayers(rt)) || rt.demoStopped) return false;
      yield* settings(rt);
      if (rt.demoStopped) return false;
    }
  }
  const { game } = rt;
  const board = new Board(rt);
  const play: Play = { rt, board };
  yield* board.loadPortraits();
  if (!replay && !resume && !rt.demo) saveSetup(session, game);

  // Le chrono 1 (temps de partie) démarre ici, après les réglages.
  rt.startChrono(1);
  if (resume) rt.shiftChrono(1, -resume.elapsed);

  do {
    game.abandoned = false;
    // Décision D6 : la partie est sauvegardée au début de chaque tour (pas une partie de démo).
    if (!rt.demo) {
      writeSave(storage, {
        version: SAVE_VERSION,
        state: structuredClone(game),
        rng: rt.ctx.rng.current,
        elapsed: rt.elapsedCentiseconds(1),
        setup: structuredClone(session.saved),
      });
    }
    if (game.current === 0) {
      // Début d'un tour de table : moins de 60 s restantes, c'est le dernier.
      game.elapsedRead = rt.chrono(1);
      if (game.duration - game.elapsedRead < 60) game.lastRound = true;
      if (game.round === 1 || game.players.length > 1) yield* scoreScreen(rt, game.round === 1);
      if (!rt.demo) session.noGameYet = false;
      game.beforeFirstRound = false;
    }
    yield* playTurn(play);
    yield* rt.cleanup();
    const wasLast = game.current === game.players.length - 1;
    game.current++;
    if (wasLast) {
      game.current = 0;
      game.round++;
      if (game.lastRound) game.over = true;
    }
  } while (!game.over && !game.quit && !rt.demoStopped);

  if (!rt.demo) clearSave(storage);
  // `1abf:2607` : la démo interrompue revient au menu sans écran de fin ni voix d'adieu.
  if (rt.demoStopped) return true;
  if (!game.quit) yield* endScreen(rt);
  else {
    // FIN demandée : aucune image, seulement les voix d'adieu de Panoramix.
    yield* rt.voice(game.players.length < 2 ? 5 : (rt.rnd() & 1) + 4, VOICES.panoramix);
  }
  return true;
}
