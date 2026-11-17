import type { Sound } from "../../../engine/infogrames/audio/sound";
import { SQUARE_COUNT } from "../data/exe";
import {
  addSesterces,
  detritusDraw,
  detritusPath,
  pathToPrison,
  restDraw,
  spyForbidden,
  spyMove,
  step,
  surpriseDraw,
  trapDestination,
} from "../game/rules";
import { OBELIX, SQUARE, type Player } from "../game/state";
import { SPRITE_ARROW, SPRITE_PAWN } from "./board";
import type { Play } from "./game";
import { LEFT, RIGHT, Runtime, VOICES, zoneAround, type Script, type Zone } from "./runtime";
import {
  choosePlayer,
  confirm,
  drawMapPawns,
  drawScoreCounters,
  drawScoreTable,
  frameVisibleSquares,
  refreshMarble,
  refreshScoreCounters,
  showMarble,
  timeoutVoice,
} from "./screens";

/**
 * Cases du plateau (`docs/asterix/engine.md` §10), hors quiz et mini-jeux : prison, repos et jeux d'ambiance, espion,
 * pièges, Tullius Détritus, potion, Epidemaïs, devin, surprise.
 */

const BAND = 0x42;
/** Abscisse de la vignette selon la colonne de la case (rappels `20fa:000d`, `20fa:0112`). */
const PRISON_COLUMNS = [3, 0x62, 0xac] as const;
/** Abscisse de la vignette de la potion selon la colonne (`20fa:11b0`). */
const POTION_COLUMNS = [3, 0x56, 0xa6] as const;

/**
 * `1d24:0912(joueur, delta, attendre)` : variation de sesterces bornée à 0..99, un tintement par pièce gagnée ou perdue
 * (en attendant la fin de chacun si `wait`).
 */
export function* changeSesterces(rt: Runtime, player: Player, delta: number, wait: boolean): Script {
  const applied = addSesterces(player, delta);
  for (let i = 0; i < Math.abs(applied); i++) {
    rt.sound(applied > 0 ? "coinGain" : "coinLoss");
    if (wait) yield* rt.waitSound();
  }
}

// --- Prison (§10.1) -----------------------------------------------------------------------------------

/** `20fa:00d2` : arrivée en prison. Animation `M20AA` dans la vignette du pion (rappel `20fa:000d`), ni voix ni tirage. */
export function* prisonSquare(play: Play): Script {
  const { rt, board } = play;
  const player = board.player;
  player.inPrison = true;
  yield* rt.vignette("M20AA.MUX", 2, 3, PRISON_COLUMNS[player.pos % 3], board.rank * BAND + 3, 0x4c, 0x3e, "any");
}

/**
 * Sortie de prison : l'animation (`M20AJ` la porte brisée, rappel `20fa:000d` ; `M20AM` la sortie gratuite, rappel
 * `20fa:0112`) est jouée dans la vignette, l'écran obtenu devient le fond et le pion est redessiné.
 */
function* prisonExit(play: Play, video: string): Script {
  const { rt, board } = play;
  // `20fa:0112` pose toujours la vignette sur la bande du haut ; le pion y est au début de son tour.
  const y = video === "M20AM.MUX" ? 3 : board.rank * BAND + 3;
  yield* rt.vignette(video, 2, 3, PRISON_COLUMNS[board.player.pos % 3], y, 0x4c, 0x3e, "none");
  rt.commit();
  board.pawn();
}

/**
 * `20fa:02c1` : prisonnier au début de son tour ; rend vrai si le tour est perdu. Sans gourde : tour perdu à plusieurs,
 * sortie gratuite en solo. Avec une gourde : question oui/non ; oui, la gourde est dépensée et le tour continue ; non,
 * tour perdu à plusieurs, sortie gratuite en solo. Dans tous les cas le joueur n'est plus en prison ensuite.
 */
export function* prisonTurnStart(play: Play): Script<boolean> {
  const { rt, board } = play;
  const { game } = rt;
  const player = board.player;
  const solo = game.players.length < 2;
  let lost = false;
  rt.voiceKey = VOICES.prison;
  if (player.gourds === 0) {
    if (solo) yield* prisonExit(play, "M20AM.MUX");
    else {
      yield* rt.voice((rt.rnd() % 3) + 6);
      lost = true;
    }
  } else {
    const question = (rt.rnd() & 1) === 0 ? (rt.rnd() % 6) + 0xe : player.character;
    if (yield* confirm(rt, question, player.character)) {
      yield* board.show();
      rt.commit();
      player.gourds--;
      yield* prisonExit(play, "M20AJ.MUX");
    } else if (!solo) {
      yield* rt.voice((player.character === OBELIX ? rt.rnd() & 1 : rt.rnd() & 3) + 9);
      lost = true;
    } else {
      yield* board.show();
      rt.commit();
      if (player.character !== OBELIX) yield* rt.voice(0xd);
      yield* rt.voice(-0x14);
      yield* prisonExit(play, "M20AM.MUX");
    }
  }
  player.inPrison = false;
  return lost;
}

// --- Repos et jeux d'ambiance (§10.2) -----------------------------------------------------------------

/** Table `20fa:05d9` : vidéo de halte et vignette (abscisse source, abscisse à l'écran, largeur) par position. */
const HALTS: Readonly<Record<number, readonly [string, number, number, number]>> = {
  0x10: ["M21AA.MUX", 0x53, 0x54, 0x51],
  0x19: ["M21AD.MUX", 0x62, 0x63, 0x4e],
  0x21: ["M21AG.MUX", 2, 3, 0x4f],
  0x2d: ["M21AJ.MUX", 2, 3, 0x5a],
};

/** Recule (ou avance) un joueur case par case sur la carte : un bruitage et 30 cs par pas. */
function* walkOnMap(rt: Runtime, player: Player, path: readonly number[]): Script {
  for (const pos of path) {
    rt.sound("step");
    player.pos = pos;
    rt.restore();
    drawMapPawns(rt, false);
    yield* rt.wait(0x1e);
  }
}

/** Carte générale `M02DA000.MCG` avec les cadres des cases affichées, qui devient le fond. */
function* mapBackground(rt: Runtime): Script {
  yield* rt.picture("M02DA000.MCG");
  frameVisibleSquares(rt);
  rt.commit();
}

/**
 * `20fa:05e9` : case repos. Halte (animation dans la vignette), brigands une fois sur cinq, et à plusieurs les deux
 * jeux d'ambiance hors écran : les joueurs désignent eux-mêmes le perdant (qui recule jusqu'à la prison) ou le gagnant
 * (+1 sesterce).
 */
export function* restSquare(play: Play): Script {
  const { rt, board } = play;
  const { game, tables } = rt;
  const player = board.player;
  rt.voiceKey = VOICES.rest;
  const outcome = restDraw(game, rt.rnd);
  if (outcome === "halt" || outcome === "brigands") {
    const halt = HALTS[player.pos];
    rt.ctx.surface.commitBackground();
    if (halt) yield* rt.vignette(halt[0], halt[1], 3, halt[2], board.rank * BAND + 3, halt[3], 0x3e, "any");
    rt.restore();
    if (outcome === "brigands" && player.sesterces > 0) {
      yield* rt.voice(0);
      yield* changeSesterces(rt, player, -((rt.rnd() % 3) + 1), true);
    }
  } else if (outcome === "loserGame") {
    yield* rt.overlayVideo(0x15, 0xd, "none");
    yield* rt.picture("M03DB000.MCG");
    // `K21TE09` est lancée sans attente puis coupée au hasard après 5 à 15 s : c'est le signal du jeu.
    const signal = yield* rt.loadVoice(8);
    if (signal) rt.ctx.voice.play(signal);
    yield* rt.wait((rt.rnd() % 1000) + 500);
    rt.stopSound();
    yield* rt.wait(10);
    yield* drawScoreTable(rt, 0);
    drawScoreCounters(rt);
    rt.commit();
    yield* rt.overlayVideo(0x15, 0xf, "none");
    const loser = game.players[yield* choosePlayer(rt)];
    rt.restore();
    yield* rt.overlayVideo(0x15, 0x11, "none");
    yield* rt.cleanup();
    yield* mapBackground(rt);
    yield* walkOnMap(rt, loser, pathToPrison(tables, loser.pos));
    loser.inPrison = true;
    yield* rt.wait(0x32);
  } else {
    yield* rt.overlayVideo(0x15, (rt.rnd() & 1) === 0 ? 0xe : 0xc, "none");
    const clean = yield* drawScoreTable(rt, 0);
    drawScoreCounters(rt);
    rt.commit();
    yield* rt.overlayVideo(0x15, 0x10, "none");
    const winner = game.players[yield* choosePlayer(rt)];
    refreshScoreCounters(rt, clean);
    yield* rt.overlayVideo(0x15, 0x12, "none");
    yield* changeSesterces(rt, winner, 1, false);
    refreshScoreCounters(rt, clean);
    yield* rt.waitSound();
    yield* rt.wait(0x32);
  }
  yield* rt.cleanup();
}

// --- Espion Zérozérosix (§10.3) -----------------------------------------------------------------------

/** Position à l'écran du mini-pion du joueur pendant le choix de l'espion (`20fa:09c7`). */
function drawSpyPawn(rt: Runtime, player: Player): void {
  const cell = rt.tables.mapCells[player.pos];
  const [dx, dy] = player.pos === 0 ? [0x15, 0] : [-8, -5];
  rt.sprite(rt.mapSprites, player.character, cell.x * 0x1d + dx + 0xf, cell.y * 0x15 + dy + 0x11);
}

/** Zones (D11) : la cellule de chaque case permise sur la carte. */
function spyZones(play: Play): (Zone | null)[] {
  const { rt } = play;
  return Array.from({ length: SQUARE_COUNT }, (_, pos) => {
    if (spyForbidden(rt.tables, rt.game, pos)) return null;
    const cell = rt.tables.mapCells[pos];
    const [width, height] = pos === 0 ? [0x57, 0x20] : [0x1d, 0x15];
    return { x1: cell.x * 0x1d, y1: cell.y * 0x15 + 6, x2: cell.x * 0x1d + width - 1, y2: cell.y * 0x15 + 6 + height - 1 };
  });
}

/**
 * `20fa:0b83` : l'espion laisse choisir une case sur la carte. Le curseur part de la case suivante et suit le tracé du
 * circuit (`DS:2a3a`), en sautant les cases interdites ; sortie au clic ou après 30 s (`K63TE38`, case sous le curseur).
 * La case choisie sera jouée par l'appelant.
 */
export function* spySquare(play: Play): Script {
  const { rt, board } = play;
  const { session, tables } = rt;
  const player = board.player;
  const { resources, palette } = rt.ctx;
  const sounds: Sound[] = [];
  for (const name of ["m13b0000.voc", "m13b0001.voc", "m13b0002.voc"]) sounds.push(yield* rt.load(resources.sound(name)));
  yield* rt.picture("M02DA000.MCG", 3);
  // La carte passe dans les couleurs 128..255 (`1481:0007`), où la dessinent les introductions `M13A?`.
  rt.shiftUp();
  rt.commit();
  const shifted = palette.colors.slice();
  player.pos = step(player.pos, 1);
  let intro: number;
  do intro = rt.rnd() & 3;
  while (intro === session.lastSpyIntro);
  session.lastSpyIntro = intro;
  // Plein écran, sans effacer l'écran à la première palette (`15d7:06eb(0x0d, n, 0, 0x20000)`).
  yield* rt.moduleVideo(0xd, intro);
  rt.restore();
  frameVisibleSquares(rt);
  rt.commit();
  palette.colors.set(shifted);
  rt.ctx.voice.play(sounds[0]);
  yield* rt.wait(0x19);
  yield* rt.music("m13m.voc");
  const zones = spyZones(play);
  rt.screen = "spy";
  rt.startChrono(0);
  let clicked = false;
  let moved = false;
  while (!clicked && !rt.timedOut(30)) {
    rt.restore();
    drawSpyPawn(rt, player);
    if (moved) {
      yield* rt.wait(0x24);
      moved = false;
    }
    if (spyMove(tables, rt.game, rt.dirs())) {
      rt.effect(sounds[2]);
      moved = true;
    }
    const click = rt.click(zones);
    if (typeof click === "number") player.pos = click;
    if (click !== null) clicked = true;
    else yield;
  }
  rt.restore();
  drawSpyPawn(rt, player);
  yield* rt.music(null);
  if (clicked) {
    rt.ctx.voice.play(sounds[1]);
    yield* rt.waitSound();
  }
  rt.stopSound();
  yield* rt.wait(0x19);
  if (!clicked) yield* timeoutVoice(rt);
  yield* rt.fadeOut();
  yield* rt.cleanup();
  rt.screen = "";
}

// --- Pièges (§10.4) -----------------------------------------------------------------------------------

/** Vignette du piège par module de sa vidéo (`20fa:0e83`) : abscisse source, abscisse à l'écran, largeur. */
const TRAP_VIGNETTES: Readonly<Record<number, readonly [number, number, number]>> = {
  14: [0x6b, 0x6c, 0x51],
  15: [0xb2, 0xb3, 0x46],
  16: [2, 3, 0xf6],
  17: [2, 3, 0xf6],
  18: [0xa7, 0xa8, 0x51],
  19: [2, 3, 0x4c],
};

/** `1d24:0260` : secousse de l'écran, 16 allers et retours de 3 lignes, 2 ticks par position. */
function* shake(rt: Runtime): Script {
  const { work } = rt.ctx.surface;
  const still = work.slice();
  const lines = 3 * 320;
  rt.sound("shake");
  for (let i = 0; i < 16; i++) {
    work.set(still.subarray(lines));
    work.fill(0, work.length - lines);
    yield* rt.ticks(2);
    work.set(still);
    yield* rt.ticks(2);
    work.set(still.subarray(0, still.length - lines), lines);
    work.fill(0, 0, lines);
    yield* rt.ticks(2);
  }
  work.set(still);
}

/**
 * `20fa:0f38` : piège. Vidéo dans la bande de la case, puis le plateau est recalé sur la destination, le pion y tombe en
 * 4 images (25 pixels plus haut par image restante) et l'écran tremble. La case d'arrivée sera jouée par l'appelant.
 */
export function* trapSquare(play: Play): Script {
  const { rt, board } = play;
  const player = board.player;
  const trap = trapDestination(rt.tables, player.pos, rt.rnd);
  if (!trap) return;
  const rank = board.rank;
  player.pos = trap.destination;
  const [sx, dx, width] = TRAP_VIGNETTES[trap.module];
  yield* rt.vignette(`M${trap.module}AA.MUX`, sx, 3, dx, rank * BAND + 3, width, 0x3e, "any");
  rt.game.topRow = Math.floor(player.pos / 3);
  yield* board.show();
  rt.commit();
  for (let remaining = 3; remaining >= 0; remaining--) {
    rt.restore();
    // Cases 24 et 38 : le pion tombe derrière le décor, il n'apparaît qu'à l'arrivée.
    if (player.pos !== 0x17 && player.pos !== 0x25) {
      const centre = rt.tables.pawnCenters[player.pos];
      rt.sprite(rt.boardSprites, SPRITE_PAWN, centre.x - 0x20, centre.y + board.rank * BAND - 0x28 - remaining * 0x19);
    }
    yield;
  }
  yield* shake(rt);
  rt.stopSound();
}

// --- Tullius Détritus (§10.5) -------------------------------------------------------------------------

/**
 * `288f:000f(force_soi)` : Détritus. À 3 ou 4 joueurs (hors surprise) le joueur courant désigne une victime sur le
 * tableau de score ; sinon il subit lui-même. Quatre tours : potion, prison, reculer de 6, avancer de 6. Aucun effet de
 * case à l'arrivée : seul le drapeau de prison suit la case atteinte.
 */
export function* detritusSquare(play: Play, onSelf: boolean): Script {
  const { rt, board } = play;
  const { game, session, tables } = rt;
  const player = board.player;
  yield* rt.fadeOut();
  const { chooseVictim, trick } = detritusDraw(game, session, rt.rnd, onSelf);
  const move = function* (target: Player): Script {
    if (trick === 1) {
      yield* walkOnMap(rt, target, pathToPrison(tables, target.pos));
      target.inPrison = true;
    } else {
      yield* walkOnMap(rt, target, detritusPath(tables, target.pos, trick === 2 ? -1 : 1));
      target.inPrison = tables.board[target.pos] === SQUARE.prison;
    }
  };
  if (chooseVictim) {
    const clean = yield* drawScoreTable(rt, 0);
    drawScoreCounters(rt);
    rt.commit();
    // Vidéos `M38AD` (potion), `M38AA` (prison), `M38AB` (recule), `M38AC` (avance).
    yield* rt.overlayVideo(0x26, [3, 0, 1, 2][trick], "none");
    const victim = game.players[yield* choosePlayer(rt)];
    if (trick === 0) {
      // Vol de potion : aucune borne n'est revérifiée (sans effet si le joueur se désigne lui-même).
      player.gourds++;
      victim.gourds--;
      refreshScoreCounters(rt, clean);
      yield* rt.wait(100);
    } else {
      yield* rt.cleanup();
      yield* mapBackground(rt);
      rt.restore();
      drawMapPawns(rt, false);
      yield* move(victim);
    }
  } else {
    // Vidéos `M38AH` (potion), `M38AE` (prison), `M38AF` (recule), `M38AG` (avance).
    if (trick === 0) {
      const clean = yield* showMarble(rt, 0);
      rt.commit();
      yield* rt.overlayVideo(0x26, 7, "none");
      player.gourds--;
      refreshMarble(rt, clean);
    } else {
      yield* mapBackground(rt);
      yield* rt.overlayVideo(0x26, 3 + trick, "none");
      yield* move(player);
    }
    yield* rt.wait(100);
  }
  rt.ctx.surface.clear();
  yield* rt.cleanup();
}

// --- Potion (§10.6) -----------------------------------------------------------------------------------

/** `20fa:1223` : +1 gourde (5 au plus), animation `M37AA` dans la vignette, puis une voix selon le compte. */
export function* potionSquare(play: Play): Script {
  const { rt, board } = play;
  const player = board.player;
  rt.voiceKey = VOICES.potion;
  let voice: number;
  if (player.gourds < 5) {
    player.gourds++;
    yield* rt.vignette("M37AA.MUX", 2, 3, POTION_COLUMNS[player.pos % 3], board.rank * BAND + 3, 0x53, 0x3e, "any");
    if (player.gourds === 4 - player.reflexion || (player.character === OBELIX && player.gourds !== 5)) voice = player.character;
    else if (player.gourds === 5) voice = player.character + 0x10;
    else voice = (rt.rnd() & 3) + 6;
  } else {
    voice = player.character + 10;
  }
  yield* rt.voice(voice);
}

// --- Epidemaïs (§10.8) --------------------------------------------------------------------------------

/**
 * `20fa:14a9` : le marchand vend un objet pour 3 sesterces, un seul par passage ; il ne vend rien à qui a déjà ses
 * objets requis. Droite et gauche parcourent l'étal en boucle ; sortie au clic ou après 60 s (`K63TE36`, sans achat).
 */
export function* merchantSquare(play: Play): Script {
  const { rt, board } = play;
  const { game, tables } = rt;
  const player = board.player;
  const { resources, palette } = rt.ctx;
  const moveSound = yield* rt.load(resources.sound("b01-01b.voc"));
  const buySound = yield* rt.load(resources.sound("b41-01a.voc"));
  const complete = function* (): Script {
    yield* rt.voice(player.objectCount === game.objectsRequired ? 5 : 6, VOICES.marble);
  };
  rt.voiceKey = VOICES.merchant;
  yield* rt.picture("M41DA000.mcc", 3);
  rt.commit();
  let done = false;
  if (player.objectCount >= game.objectsRequired) {
    yield* complete();
    done = true;
  } else if (player.sesterces < 3) {
    yield* rt.overlayVideo(0x29, 2);
    done = true;
  } else {
    yield* rt.overlayVideo(0x29, rt.rnd() & 1);
    rt.ctx.voice.play(moveSound);
  }
  // Zones (D11) : chaque objet de l'étal, sous la flèche dessinée en (x − 32, y − 40).
  const zones = tables.stall.map((item) => zoneAround(item.x - 0x10, item.y - 0x14, 20, 24));
  let cursor = 0;
  while (!done) {
    while (rt.buttonHeld) yield;
    yield* rt.wait(0x32);
    rt.screen = "merchant";
    rt.startChrono(0);
    let clicked = false;
    for (;;) {
      const directions = rt.dirs();
      let moved = false;
      if (directions & RIGHT) {
        moved = true;
        rt.ctx.voice.play(moveSound);
        cursor = (cursor + 1) % tables.stall.length;
      }
      if (directions & LEFT && !moved) {
        moved = true;
        rt.ctx.voice.play(moveSound);
        cursor = (cursor + tables.stall.length - 1) % tables.stall.length;
      }
      if (rt.helpRequested()) rt.voiceKey = VOICES.merchant;
      const click = rt.click(zones);
      if (typeof click === "number") cursor = click;
      rt.restore();
      rt.sprite(rt.boardSprites, SPRITE_ARROW, tables.stall[cursor].x - 0x20, tables.stall[cursor].y - 0x28);
      if (moved) yield* rt.wait(0xf);
      if (click !== null) {
        clicked = true;
        break;
      }
      if (rt.timedOut(60)) break;
      yield;
    }
    rt.screen = "";
    if (!clicked) {
      yield* rt.voice(0x23, VOICES.panoramix);
      break;
    }
    yield* rt.waitRelease();
    const object = tables.stall[cursor].object;
    if (player.objects[object]) {
      // Objet déjà possédé : `M41AD` en surimpression (palette rétablie ensuite), puis retour à l'étal.
      const saved = palette.colors.slice();
      rt.restore();
      yield* rt.moduleVideo(0x29, 3, { overlay: true });
      rt.restore();
      palette.colors.set(saved);
      continue;
    }
    rt.ctx.voice.play(buySound);
    yield* rt.waitSound();
    player.objects[object] = true;
    player.objectCount++;
    yield* rt.picture(`M41DB00${object}.mcc`);
    rt.commit();
    if (player.objectCount >= game.objectsRequired) {
      yield* rt.voice(object + 6);
      yield* changeSesterces(rt, player, -3, true);
      yield* complete();
    } else {
      // Une fois sur deux, une des trois phrases génériques à la place de celle de l'objet.
      const voice = (rt.rnd() & 1) === 0 ? [5, 0xf, 0x10][rt.rnd() % 3] : object + 6;
      yield* rt.voice(voice);
      yield* changeSesterces(rt, player, -3, true);
    }
    done = true;
  }
  yield* rt.cleanup();
}

// --- Devin (§10.9) ------------------------------------------------------------------------------------

/** Remplit un gabarit de `sprintf` (`%s`, `%d`) des textes du devin. */
function format(template: string, ...values: (string | number)[]): string {
  let next = 0;
  return template.replace(/%[sd]/g, () => String(values[next++]));
}

/**
 * `20fa:192e` : le devin. Un joueur parie (0 à 5) sur le nombre de gourdes du prochain visiteur, quel qu'il soit ; un
 * pari juste rapporte 3 sesterces au parieur. Le visiteur qui n'est pas le parieur parie à son tour.
 */
export function* soothsayerSquare(play: Play): Script {
  const { rt, board } = play;
  const { game, tables } = rt;
  const player = board.player;
  const { resources } = rt.ctx;
  const moveSound = yield* rt.load(resources.sound("b01-01b.voc"));
  const validateSound = yield* rt.load(resources.sound("b13-12a.voc"));
  const sprites = yield* rt.load(resources.hy8("M39S.HY8"));
  const cursor = (bet: number): void => {
    rt.sprite(rt.boardSprites, SPRITE_ARROW, tables.soothsayer[bet].x - 0x1c, tables.soothsayer[bet].y - 0x24);
  };
  rt.voiceKey = VOICES.soothsayer;
  yield* rt.picture("M39DA000.MCC", 1);
  let welcome: number;
  if (game.bettor === -1) {
    rt.commit();
    game.bettor = game.current;
    welcome = game.players.length < 2 ? 3 : player.character + 10;
  } else {
    const bettor = game.players[game.bettor];
    const own = game.bettor === game.current;
    const right = player.gourds === game.bet;
    cursor(game.bet);
    rt.sprite(sprites, 0, -0x1c, -0x24);
    const [mine, theirs, exact, wrong] = tables.soothsayerTexts;
    rt.text(8, 0xf, own ? format(mine, game.bet) : format(theirs, tables.characterNames[bettor.character], game.bet));
    rt.text(8, 0x23, right ? exact : format(wrong, player.gourds));
    rt.commit();
    if (right && !own) {
      yield* rt.voice(bettor.character + 0x16);
      yield* changeSesterces(rt, bettor, 3, true);
      game.bettor = game.current;
    } else if (right) {
      yield* rt.voice(player.character + 4);
      yield* rt.overlayVideo(0x27, 1);
      yield* changeSesterces(rt, bettor, 3, true);
      game.bettor = -1;
    } else if (own) {
      yield* rt.voice(player.character + 4);
      yield* rt.overlayVideo(0x27, 0);
      game.bettor = -1;
    } else {
      yield* rt.voice(bettor.character + 0x10);
      game.bettor = game.current;
    }
    if (game.bettor !== -1) {
      yield* rt.picture("M39DA000.mcc");
      rt.commit();
    }
    welcome = 4;
  }
  if (game.bettor !== -1) {
    yield* rt.overlayVideo(0x27, welcome);
    while (rt.buttonHeld) yield;
    yield* rt.wait(0x32);
    rt.ctx.voice.play(moveSound);
    game.bet = 0;
    // Zones (D11) : les six groupes de gourdes.
    const zones = tables.soothsayer.map((group) => zoneAround(group.x - 0xc, group.y - 0x10, 20, 24));
    rt.screen = "soothsayer";
    rt.startChrono(0);
    let clicked = false;
    for (;;) {
      const directions = rt.dirs();
      let moved = false;
      if (directions & RIGHT) {
        moved = true;
        rt.ctx.voice.play(moveSound);
        game.bet = (game.bet + 1) % 6;
      }
      if (directions & LEFT && !moved) {
        moved = true;
        rt.ctx.voice.play(moveSound);
        game.bet = (game.bet + 5) % 6;
      }
      if (rt.helpRequested()) rt.voiceKey = VOICES.soothsayer;
      const click = rt.click(zones);
      if (typeof click === "number") game.bet = click;
      rt.restore();
      cursor(game.bet);
      if (moved) yield* rt.wait(0xf);
      if (click !== null) {
        clicked = true;
        break;
      }
      if (rt.timedOut(60)) break;
      yield;
    }
    rt.screen = "";
    if (!clicked) yield* timeoutVoice(rt);
    rt.restore();
    cursor(game.bet);
    rt.ctx.voice.play(validateSound);
    yield* rt.waitSound();
    yield* rt.voice((rt.rnd() % 3) + 0x1d);
  }
  yield* rt.cleanup();
  yield* rt.waitSound();
}

// --- Surprise (§10.10) --------------------------------------------------------------------------------

/**
 * `20fa:231b` : surprise. Question oui/non ; acceptée : Détritus « sur soi » une fois sur deux, sinon une gourde, des
 * sesterces ou l'espion. Rend vrai seulement si l'effet a été l'espion (la case choisie est alors jouée).
 */
export function* surpriseSquare(play: Play): Script<boolean> {
  const { rt, board } = play;
  const player = board.player;
  rt.voiceKey = VOICES.surprise;
  if (!(yield* confirm(rt, rt.rnd() % 5, player.character))) {
    yield* rt.voice((rt.rnd() % 6) + 5);
    yield* rt.cleanup();
    return false;
  }
  const outcome = surpriseDraw(player, rt.rnd);
  if (outcome === "detritus") {
    yield* rt.voice((rt.rnd() % 9) + 0x1a);
    yield* rt.cleanup();
    yield* detritusSquare(play, true);
    return false;
  }
  if (outcome === "spy") {
    yield* rt.voice((rt.rnd() % 6) + 0xb);
    yield* rt.cleanup();
    yield* spySquare(play);
    return true;
  }
  const clean = yield* showMarble(rt, 3);
  rt.commit();
  if (outcome === "gourd") {
    yield* rt.voice(0, VOICES.potion);
    player.gourds++;
    refreshMarble(rt, clean);
  } else {
    const coins = (rt.rnd() % 3) + 1;
    const voice = (coins - 1) * 3 + 0x11;
    yield* rt.voice(voice + (rt.rnd() % 3));
    for (let i = 0; i < coins; i++) {
      yield* changeSesterces(rt, player, 1, false);
      refreshMarble(rt, clean);
      yield* rt.waitSound();
    }
  }
  yield* rt.wait(100);
  yield* rt.cleanup();
  return false;
}
