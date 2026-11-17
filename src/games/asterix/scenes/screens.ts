import type { Hy8 } from "../../../engine/infogrames/data/hy8";
import { SQUARE_COUNT } from "../data/exe";
import { marbleRemark, removeCurrentPlayer, scoreComment, squareVisible } from "../game/rules";
import { SPRITE_ARROW, SPRITE_CHECK, SPRITE_CROSS } from "./board";
import { DOWN, LEFT, RIGHT, Runtime, UP, VOICES, colorBounds, type Script, type Zone } from "./runtime";

/**
 * Écrans communs de la partie (`docs/asterix/engine.md` §9.10 à §9.12, §3.6) : confirmation oui/non, désignation d'un
 * joueur, carte générale, écran de score et commentaires de Panoramix, marbre de route, pause.
 */

/** Voix de délai « Panoramix choisit à ta place » : `K63TE38` (§5.3). */
const TIMEOUT_VOICE = 0x25;

/** `K63TE38` avec la clé 607, puis la clé de l'appelant est rétablie. */
export function* timeoutVoice(rt: Runtime): Script {
  const key = rt.voiceKey;
  yield* rt.voice(TIMEOUT_VOICE, VOICES.panoramix);
  rt.voiceKey = key;
}

/** Les deux bulles de M49 prennent la teinte normale : couleurs 122, 123 (OUI) et 124, 125 (NON) recopiées de 126, 127. */
function resetBubbles(rt: Runtime): void {
  rt.copyColor(122, 126);
  rt.copyColor(123, 127);
  rt.copyColor(124, 126);
  rt.copyColor(125, 127);
}

/**
 * `1d24:0006(voix, image)` : question oui/non sur `M49DA00{image}.mcc`. NON est à gauche et choisi par défaut ; la bulle
 * choisie prend la couleur 126, l'autre est grisée. Sortie au clic ou après 60 s (alors `K63TE38`, choix gardé).
 * `voice < 0` : l'écran est déjà affiché, aucune voix.
 */
export function* confirm(rt: Runtime, voice: number, image: number): Script<boolean> {
  const { palette } = rt.ctx;
  const name = `M49DA00${image}.mcc`;
  const picture = yield* rt.load(rt.ctx.resources.picture(name));
  if (voice >= 0) {
    yield* rt.voice(voice);
    yield* rt.fadeOut();
    rt.draw(picture, 1);
    resetBubbles(rt);
    yield* rt.fadeIn();
    rt.commit();
  }
  // Zones (D11) : NON (couleurs 124, 125) puis OUI (122, 123).
  const zones = [colorBounds(picture.pixels, [124, 125]), colorBounds(picture.pixels, [122, 123])];
  rt.screen = "confirm";
  rt.sound("move");
  let yes = false;
  let refresh = true;
  const paint = (): void => {
    const grey = 0xb4;
    if (yes) {
      rt.copyColor(122, 126);
      palette.setColor(124, grey, grey, grey);
    } else {
      rt.copyColor(124, 126);
      palette.setColor(122, grey, grey, grey);
    }
  };
  rt.startChrono(0);
  let clicked = false;
  for (;;) {
    paint();
    if (refresh) {
      yield* rt.wait(0x14);
      refresh = false;
    }
    rt.helpRequested();
    const directions = rt.dirs();
    if (directions & LEFT && yes) {
      yes = false;
      rt.sound("move");
      refresh = true;
    }
    if (directions & RIGHT && !yes) {
      yes = true;
      rt.sound("move");
      refresh = true;
    }
    const click = rt.click(zones);
    if (typeof click === "number") yes = click === 1;
    if (click !== null) {
      clicked = true;
      break;
    }
    if (rt.timedOut(60)) break;
    yield;
  }
  if (!clicked) yield* timeoutVoice(rt);
  rt.sound("validate");
  yield* rt.waitRelease();
  paint();
  yield* rt.cleanup();
  yield* rt.waitSound();
  rt.screen = "";
  return yes;
}

/** Ordonnée de la ligne du joueur `j` sur l'écran de score (`DS:2144`). */
function scoreRow(rt: Runtime, j: number): number {
  return rt.tables.scoreRows[rt.game.players.length - 1][j];
}

/** `1d24:0f93` : bandeau de chaque joueur (sprite du personnage de `m03sb.hy8`). */
function drawScoreBanners(rt: Runtime, banners: Hy8): void {
  rt.game.players.forEach((player, j) => rt.sprite(banners, player.character, 0, scoreRow(rt, j) - 10));
}

/** `1d24:0ff2` : temps restant en minutes, puis gourdes, sesterces et objets de chaque joueur. */
export function drawScoreCounters(rt: Runtime): void {
  const { game } = rt;
  let minutes = 0;
  if (!game.over || game.victory) {
    game.elapsedRead = rt.chrono(1);
    minutes = Math.max(1, Math.trunc((game.duration - game.elapsedRead) / 60) + 1);
  }
  rt.text(0x46, 0x4a, `${minutes}/${Math.trunc(game.duration / 60)}`);
  game.players.forEach((player, j) => {
    const y = scoreRow(rt, j);
    rt.text(0xac, y, String(player.gourds));
    rt.text(0xe4, y, String(player.sesterces));
    rt.text(0x11c, y, `${player.objectCount}/${game.objectsRequired}`);
  });
}

/**
 * Tableau des joueurs sur `M03DB000.mcg` avec ses bandeaux, sans les compteurs. Rend une copie de cet écran nu (le
 * tampon C de l'original), sur laquelle les compteurs se redessinent après un gain ou une perte.
 */
export function* drawScoreTable(rt: Runtime, flags: number): Script<Uint8Array> {
  const banners = yield* rt.load(rt.ctx.resources.hy8("m03sb.hy8"));
  yield* rt.picture("M03DB000.mcg", flags);
  drawScoreBanners(rt, banners);
  return rt.ctx.surface.work.slice();
}

/** Compteurs redessinés sur le tableau nu, qui redevient le fond. */
export function refreshScoreCounters(rt: Runtime, clean: Uint8Array): void {
  rt.ctx.surface.work.set(clean);
  drawScoreCounters(rt);
  rt.commit();
}

/** Zones (D11) des lignes de joueurs du tableau de score. */
function scoreZones(rt: Runtime): Zone[] {
  return rt.game.players.map((_, j) => ({ x1: 0, y1: scoreRow(rt, j) - 37, x2: 319, y2: scoreRow(rt, j) - 8 }));
}

/**
 * `1d24:0a44(voix)` : désignation d'un joueur sur le tableau de score déjà affiché. Sélection initiale `rnd() % nb` ;
 * sortie au clic ou après 20 s (alors `K63TE38`, le joueur sous le curseur est retenu).
 */
export function* choosePlayer(rt: Runtime): Script<number> {
  const count = rt.game.players.length;
  const zones = scoreZones(rt);
  rt.sound("move");
  let selected = rt.rnd() % count;
  rt.screen = "choosePlayer";
  rt.startChrono(0);
  let clicked = false;
  for (;;) {
    rt.restore();
    const directions = rt.dirs();
    let moved = false;
    if (directions & UP) {
      moved = true;
      if (selected > 0) {
        rt.sound("move");
        selected--;
      }
    }
    if (directions & DOWN && !moved) {
      moved = true;
      if (selected < count - 1) {
        rt.sound("move");
        selected++;
      }
    }
    rt.helpRequested();
    const click = rt.click(zones);
    if (typeof click === "number") selected = click;
    rt.sprite(rt.boardSprites, SPRITE_ARROW, 100, scoreRow(rt, selected));
    if (moved) yield* rt.wait(0xf);
    if (click !== null) {
      clicked = true;
      break;
    }
    if (rt.timedOut(20)) break;
    yield;
  }
  rt.sound("validate");
  if (clicked) yield* rt.waitRelease();
  else yield* timeoutVoice(rt);
  yield* rt.waitSound();
  rt.screen = "";
  return selected;
}

/** `1d24:0cb0` : cadre de couleur `0x6d` autour de chacune des 9 cases affichées à l'écran de jeu. */
export function frameVisibleSquares(rt: Runtime): void {
  for (let pos = 0; pos < SQUARE_COUNT; pos++) {
    if (!squareVisible(rt.game.topRow, pos)) continue;
    const cell = rt.tables.mapCells[pos];
    const [width, height] = pos === 0 ? [0x57, 0x20] : [0x1d, 0x15];
    rt.frame(cell.x * 0x1d, cell.y * 0x15 + 6, cell.x * 0x1d + width, cell.y * 0x15 + height + 6, 0x6d);
  }
}

/**
 * `1d24:0d21(clignoter)` : un mini-pion par joueur sur la carte ; plusieurs joueurs sur la même case sont décalés selon
 * leur rang. Le pion du joueur courant clignote (masqué quand `horloge & 0x20` est nul).
 */
export function drawMapPawns(rt: Runtime, blink: boolean): void {
  const { game, tables } = rt;
  const offsets = [
    [-8, -5],
    [8, -5],
    [-8, 5],
    [8, 5],
  ];
  for (let pos = 0; pos < SQUARE_COUNT; pos++) {
    let rank = 0;
    game.players.forEach((player, j) => {
      if (player.pos !== pos) return;
      const [ox, oy] = offsets[Math.min(rank, 3)];
      rank++;
      if (j === game.current && blink && (rt.cs & 0x20) === 0) return;
      const cell = tables.mapCells[pos];
      const dx = pos === 0 ? ox + 0x1d : ox;
      const dy = pos === 0 ? oy + 5 : oy;
      rt.sprite(rt.mapSprites, player.character, cell.x * 0x1d + dx + 0xf, cell.y * 0x15 + dy + 0x11);
    });
  }
}

/** `1d24:0e08` : carte générale, jusqu'au clic ou 60 s. */
export function* showMap(rt: Runtime): Script {
  yield* rt.picture("m02da000.mcg", 3);
  frameVisibleSquares(rt);
  rt.commit();
  rt.screen = "map";
  rt.startChrono(0);
  do {
    rt.restore();
    drawMapPawns(rt, true);
    rt.helpRequested();
    yield;
  } while (rt.click() === null && !rt.timedOut(60));
  rt.sound("validate");
  yield* rt.waitSound();
  yield* rt.waitRelease();
  rt.restore();
  drawMapPawns(rt, true);
  rt.game.topRow = Math.floor(rt.game.players[rt.game.current].pos / 3);
  yield* rt.cleanup();
  rt.screen = "";
}

/**
 * `1d24:112b(force)` : écran de score, avec selon le moment un commentaire de Panoramix (voix `K63TE…` ou vidéo `M42A…`
 * en surimpression). Sans commentaire et sans `force`, rien n'est affiché.
 */
export function* scoreScreen(rt: Runtime, force: boolean): Script {
  const { game, session } = rt;
  rt.voiceKey = VOICES.panoramix;
  const firstRound = game.round === 1;
  const elapsed = rt.chrono(1);
  const comment = scoreComment(game, session, rt.rnd, elapsed);
  const commented = comment.voice >= 0 || comment.video !== -1;
  if (!force && !commented) return;
  yield* drawScoreTable(rt, 3);
  drawScoreCounters(rt);
  if (commented) {
    session.lastComment = elapsed;
    if (comment.video === -1) yield* rt.voice(comment.voice);
    else yield* rt.overlayVideo(0x2a, comment.video);
  }
  // Attente : 3 s au tour 1 ou hors du bouton SCORE, 8 s sinon.
  const delay = firstRound || !force ? 3 : 8;
  rt.screen = "score";
  rt.startChrono(0);
  do {
    rt.helpRequested();
    yield;
  } while (rt.click() === null && !rt.timedOut(delay));
  rt.sound("validate");
  yield* rt.waitRelease();
  yield* rt.cleanup();
  yield* rt.waitSound();
  rt.screen = "";
}

/** `1d24:151d` : compteurs du joueur courant sur son marbre de route, et une croix sur chaque objet acquis. */
export function drawMarbleCounters(rt: Runtime): void {
  const { game, tables } = rt;
  const player = game.players[game.current];
  rt.text(0x2e, 0x3c, String(player.sesterces));
  rt.text(0x63, 0x36, String(player.gourds));
  rt.text(0xa1, 0x38, `${player.objectCount}/${game.objectsRequired}`);
  player.objects.forEach((owned, k) => {
    if (owned) rt.sprite(rt.boardSprites, SPRITE_CROSS, tables.marbleObjects[k].x - 0x20, tables.marbleObjects[k].y - 0x28);
  });
}

/**
 * Marbre de route du joueur courant (`M03DA00{perso}.mcg`) avec ses compteurs. Rend une copie du marbre nu (le tampon C
 * de l'original), sur laquelle les compteurs se redessinent.
 */
export function* showMarble(rt: Runtime, flags = 3): Script<Uint8Array> {
  yield* rt.picture(`M03DA00${rt.game.players[rt.game.current].character}.mcg`, flags);
  const clean = rt.ctx.surface.work.slice();
  drawMarbleCounters(rt);
  return clean;
}

/** Compteurs redessinés sur le marbre nu, qui redevient le fond. */
export function refreshMarble(rt: Runtime, clean: Uint8Array): void {
  rt.ctx.surface.work.set(clean);
  drawMarbleCounters(rt);
  rt.commit();
}

/** Zones (D11) des cinq boutons du marbre : RETOUR, CARTE, SCORE, ABANDON, FIN. */
const MARBLE_ZONES: readonly Zone[] = [0, 1, 2, 3, 4].map((s) => ({ x1: 188, y1: 36 + 30 * s, x2: 318, y2: 58 + 30 * s }));

/**
 * `1d24:161b` : marbre de route. Remarque d'entrée `K62TE…`, puis cinq boutons (coche en (295, 40 + 30s)) ; 30 s sans
 * clic : sortie comme RETOUR. ABANDON retire le joueur (`1d24:0be9`) ; FIN arrête la partie pour tous.
 */
export function* marble(rt: Runtime): Script {
  const { game } = rt;
  const character = (): number => game.players[game.current].character;
  rt.voiceKey = VOICES.marble;
  yield* showMarble(rt);
  rt.commit();
  const remark = marbleRemark(game);
  if (remark !== -1) yield* rt.voice(remark);
  rt.sound("move");
  yield* rt.waitSound();
  rt.screen = "marble";
  rt.startChrono(0);
  let selected = 0;
  const redisplay = function* (): Script {
    yield* showMarble(rt);
    rt.commit();
    rt.sound("move");
    rt.voiceKey = VOICES.marble;
    rt.startChrono(0);
    selected = 0;
    rt.screen = "marble";
  };
  for (;;) {
    rt.restore();
    const directions = rt.dirs();
    let moved = false;
    if (directions & UP) {
      moved = true;
      if (selected > 0) {
        selected--;
        rt.sound("move");
      }
    }
    if (directions & DOWN && !moved) {
      moved = true;
      if (selected < 4) {
        selected++;
        rt.sound("move");
      }
    }
    if (rt.helpRequested()) rt.voiceKey = VOICES.marble;
    const click = rt.click(MARBLE_ZONES);
    if (typeof click === "number") selected = click;
    rt.sprite(rt.boardSprites, SPRITE_CHECK, 0x127, selected * 0x1e + 0x28);
    if (moved) yield* rt.wait(0xf);
    if (click === null && !rt.timedOut(30)) {
      yield;
      continue;
    }
    if (click === null) break;
    rt.sound("validate");
    yield* rt.waitSound();
    if (selected === 0) break;
    yield* rt.waitRelease();
    yield* rt.cleanup();
    if (selected === 1) {
      yield* showMap(rt);
      break;
    }
    if (selected === 2) {
      yield* scoreScreen(rt, true);
      break;
    }
    if (selected === 3) {
      rt.voiceKey = VOICES.abandon;
      if (!(yield* confirm(rt, character(), character()))) {
        yield* redisplay();
        continue;
      }
      if (game.players.length < 2) {
        game.quit = true;
        break;
      }
      removeCurrentPlayer(game);
      if (game.players.length === 1) {
        // Le dernier joueur choisit de continuer seul ou non.
        const last = game.players[0].character;
        yield* rt.picture(`M49DA00${last}.MCC`);
        resetBubbles(rt);
        rt.commit();
        yield* rt.voice(last + 7);
        yield* rt.voice(6);
        game.quit = !(yield* confirm(rt, -6, last));
      }
      break;
    }
    // FIN : à plusieurs `K63TE44`, en solo la question de l'abandon.
    const solo = game.players.length < 2;
    rt.voiceKey = solo ? VOICES.abandon : VOICES.panoramix;
    if (yield* confirm(rt, solo ? character() : 0x2b, character())) {
      game.quit = true;
      break;
    }
    yield* redisplay();
  }
  yield* rt.waitRelease();
  yield* rt.cleanup();
  rt.screen = "";
}

/**
 * `1abf:07f4` : pause M48 (image `M48DA000.MCC`, vidéo `M48a.mux` en boucle jusqu'à une entrée). Le temps passé en pause
 * est rendu au chrono de partie. La séquence secrète et le menu caché ne sont pas portés (décision D9).
 */
export function* pause(rt: Runtime): Script {
  yield* rt.picture("M48DA000.MCC");
  rt.commit();
  rt.screen = "pause";
  const start = rt.cs;
  yield* rt.video("M48a.mux", { loop: true });
  yield* rt.waitRelease();
  rt.shiftChrono(1, rt.cs - start);
  rt.screen = "";
}
