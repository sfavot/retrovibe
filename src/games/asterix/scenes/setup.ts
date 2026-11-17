import { proposedObjects } from "../game/rules";
import { MAX_PLAYERS, createPlayer } from "../game/state";
import { SPRITE_ARROW } from "./board";
import { DOWN, LEFT, RIGHT, Runtime, UP, VOICES, colorBounds, type Script, type Zone } from "./runtime";
import { timeoutVoice } from "./screens";

/**
 * Réglages d'une partie (`docs/asterix/engine.md` §8) : choix des joueurs et de leurs niveaux M08 (`1abf:1532`), puis
 * durée et nombre d'objets M09 (`1abf:1f3e`).
 */

/** Curseur de M08 : 0..5 un emplacement, puis les pancartes JOUER et ANNULER. */
const PLAY = 6;
const CANCEL = 7;
const GREY = 0xb4;

/**
 * Écran des niveaux (`M08DB00{perso}.mcc`) du joueur en cours d'inscription. Bulle de gauche : Réflexion ; bulle de
 * droite : Action ; haut et bas changent le niveau (0 facile, 2 difficile, 1 au départ). Validation au clic ou après
 * 30 s ; Échap annule ce personnage. Rend `null` si le personnage est annulé, ou si une entrée réelle a interrompu la
 * démo (`1abf:1d6d` : le personnage n'est pas inscrit et l'écran des joueurs sera quitté).
 */
function* chooseLevels(rt: Runtime, character: number): Script<{ reflexion: number; action: number } | null> {
  const { palette, input } = rt.ctx;
  const picture = yield* rt.picture(`M08DB00${character}.mcc`, 6);
  const grey = (color: number): void => palette.setColor(color, GREY, GREY, GREY);
  const levels = [1, 1];
  let bubble = 0;
  // Couleurs : 112 et 118 les titres des bulles, 113 et 119 leur contour, 114..116 et 120..122 les trois niveaux.
  const paint = (): void => {
    for (let side = 0; side < 2; side++) {
      const base = 112 + side * 6;
      if (bubble === side) {
        rt.copyColor(base, 126);
        palette.setColor(base + 1, 0x19, 0x19, 0xeb);
      } else {
        grey(base);
        palette.setColor(base + 1, GREY, 0xd2, 0xeb);
      }
      for (let level = 0; level < 3; level++) {
        if (levels[side] === level) rt.copyColor(base + 2 + level, 126);
        else grey(base + 2 + level);
      }
    }
  };
  const neutral = (): void => {
    for (const base of [112, 118]) {
      rt.copyColor(base, 126);
      palette.setColor(base + 1, 0x19, 0x19, 0xeb);
    }
  };
  rt.copyColor(117, 127);
  rt.copyColor(123, 127);
  neutral();
  for (const color of [114, 115, 116, 120, 121, 122]) grey(color);
  yield* rt.fadeIn();
  rt.sound("move");
  // Zones (D11) : les six libellés de niveau ; cliquer ailleurs valide.
  const zones: (Zone | null)[] = [114, 115, 116, 120, 121, 122].map((color) => colorBounds(picture.pixels, [color], 3));
  rt.screen = "levels";
  rt.startChrono(0);
  let cancelled = false;
  for (;;) {
    if (input.justPressed("skip")) {
      cancelled = true;
      break;
    }
    const directions = rt.dirs();
    let moved = false;
    if (directions & LEFT && bubble !== 0) {
      moved = true;
      bubble = 0;
      rt.sound("step");
    }
    if (directions & RIGHT && bubble !== 1 && !moved) {
      moved = true;
      bubble = 1;
      rt.sound("step");
    }
    if (directions & UP && !moved) {
      moved = true;
      if (levels[bubble] > 0) {
        levels[bubble]--;
        rt.sound("move");
      }
    }
    if (directions & DOWN && !moved) {
      moved = true;
      if (levels[bubble] < 2) {
        levels[bubble]++;
        rt.sound("move");
      }
    }
    const click = rt.click(zones, true);
    if (typeof click === "number") {
      bubble = click < 3 ? 0 : 1;
      levels[bubble] = click % 3;
      rt.sound("move");
    }
    paint();
    if (moved) yield* rt.wait(0x2d);
    if (rt.chrono(0) === 7) {
      yield* rt.waitSound();
      yield* rt.voice(4, VOICES.setup);
    }
    if (rt.helpRequested()) rt.voiceKey = VOICES.setup;
    if (rt.demoStopped || click === "current" || rt.timedOut(30)) break;
    yield;
  }
  rt.screen = "";
  if (cancelled) return null;
  rt.sound("validate");
  yield* rt.waitRelease();
  // `1abf:1dd4` : démo interrompue, rien de plus (ni voix ni inscription).
  if (rt.demoStopped) return null;
  neutral();
  yield* rt.waitSound();
  yield* rt.voice(character + 6, VOICES.setup);
  return { reflexion: levels[0], action: levels[1] };
}

/**
 * `1abf:1532` : choix des joueurs, de 1 à 4 parmi six personnages, dans l'ordre d'inscription. Rend vrai (JOUER) ou faux
 * (ANNULER). À quatre inscrits le curseur est forcé sur JOUER ; JOUER sans joueur est refusé (`K08TE06`).
 *
 * En démo, rien n'est scripté : chaque clic simulé valide l'élément sous le curseur, que l'écran pose de lui-même sur le
 * dernier personnage libre puis, à quatre inscrits, sur JOUER ; l'écran des niveaux est validé tel quel (niveaux moyens).
 * Une entrée réelle vaut ANNULER (`1abf:18d6`), et fait quitter l'écran au retour des niveaux (`1abf:1eb9`).
 */
export function* choosePlayers(rt: Runtime): Script<boolean> {
  const { game, tables } = rt;
  const { palette, resources } = rt.ctx;
  const slots = tables.characterSlots;
  rt.voiceKey = VOICES.setup;
  yield* rt.fadeOut();
  const rings = yield* rt.load(resources.hy8("M08S.HY8"));
  const picture = yield* rt.load(resources.picture("M08DA000.mcc"));
  const showMain = function* (): Script {
    rt.draw(picture, 1);
    rt.copyColor(124, 126);
    rt.copyColor(125, 126);
    yield* rt.fadeIn();
  };
  yield* showMain();
  yield* rt.overlayVideo(8, 0);
  rt.commit();
  game.players = [];
  const taken = (slot: number): boolean => game.players.some((p) => p.character === slots[slot].character);
  const freeSlot = (): number => {
    for (let slot = slots.length - 1; slot >= 0; slot--) if (!taken(slot)) return slot;
    return PLAY;
  };
  // Zones (D11) : chaque personnage, puis les pancartes JOUER (couleur 124) et ANNULER (couleur 125).
  const zones: (Zone | null)[] = [
    // Bornées en bas à la ligne des pieds, au-dessus des pancartes.
    ...slots.map((slot) => ({ x1: slot.x - 29, y1: slot.y - 70, x2: slot.x - 3, y2: Math.min(slot.y + 45, 142) })),
    colorBounds(picture.pixels, [124], 6),
    colorBounds(picture.pixels, [125], 6),
  ];
  let cursor = 0;
  for (;;) {
    cursor = game.players.length === MAX_PLAYERS ? PLAY : freeSlot();
    rt.sound("move");
    yield* rt.waitSound();
    rt.screen = "players";
    rt.startChrono(0);
    for (;;) {
      rt.restore();
      // Une seule direction à la fois (`DS:4b69 & 0xf` comparé à une valeur exacte).
      const directions = rt.dirs() & 0xf;
      let moved = false;
      const move = (to: number): void => {
        rt.sound("move");
        moved = true;
        cursor = to;
      };
      if (directions === LEFT && cursor > 0) {
        if (cursor < PLAY) move(cursor - 1);
        else if (cursor === PLAY) move(CANCEL);
      }
      if (directions === RIGHT && !moved) {
        if (cursor < 5) move(cursor + 1);
        else if (cursor === CANCEL) move(PLAY);
      }
      if (directions === DOWN && cursor < PLAY && !moved) move(PLAY);
      if (directions === UP && cursor > 5 && game.players.length < MAX_PLAYERS && !moved) move(freeSlot());
      const click = rt.click(zones);
      if (typeof click === "number") cursor = click;
      // Un personnage déjà pris porte l'anneau de sa couleur ; la flèche montre l'emplacement sous le curseur.
      slots.forEach((slot, index) => {
        if (taken(index)) rt.sprite(rings, slot.character, slot.x - 0x20, slot.y - 0x3c);
      });
      if (cursor < PLAY) rt.sprite(rt.boardSprites, SPRITE_ARROW, slots[cursor].x - 0x16, slots[cursor].y - 0x1e);
      rt.copyColor(124, cursor === PLAY ? 127 : 126);
      rt.copyColor(125, cursor === CANCEL ? 127 : 126);
      if (moved) yield* rt.wait(0x19);
      if (rt.chrono(0) === 5 && game.players.length > 0 && game.players.length < MAX_PLAYERS) yield* rt.voice(game.players.length);
      // `1abf:18d6` : démo interrompue, le curseur passe sur ANNULER et l'écran est validé.
      if (rt.demoStopped) {
        cursor = CANCEL;
        break;
      }
      if (click !== null && (cursor > 5 || !taken(cursor))) break;
      yield;
    }
    rt.screen = "";
    rt.sound("validate");
    yield* rt.waitSound();
    yield* rt.waitRelease();
    if (cursor < PLAY) {
      const character = slots[cursor].character;
      const levels = yield* chooseLevels(rt, character);
      // Gourdes de départ : `3 − niveau Réflexion` (`createPlayer`).
      if (levels) game.players.push(createPlayer(character, levels.reflexion, levels.action));
      yield* rt.waitRelease();
      // `1abf:1eb9` : la démo interrompue quitte l'écran ici, comme par ANNULER.
      if (!rt.demoStopped) {
        // Retour à l'écran des joueurs sans fondu : image et palette d'origine, pancartes en teinte normale.
        rt.draw(picture);
        rt.copyColor(124, 126);
        rt.copyColor(125, 126);
        rt.commit();
        continue;
      }
    } else if (cursor === PLAY && game.players.length === 0) {
      yield* rt.waitSound();
      yield* rt.voice(5);
      if (!rt.demoStopped) continue;
    }
    palette.load(picture.palette);
    yield* rt.cleanup();
    yield* rt.waitSound();
    if (cursor !== PLAY || game.players.length === 0) return false;
    yield* rt.voice(game.players.length === 1 ? 0xd : 0xe);
    return true;
  }
}

/** Géométrie française des cadres de M09 (tables `DS:1fa6` à `DS:1ff2`, indice de langue 0). */
const SETTINGS = { lineX: 15, lineY: 8, lineStep: 34, lineWidth: 103, cellX: 121, cellStep: 44, cellWidth: 45, cellHeight: 27, objectsY: 42 };

/**
 * `1abf:1f3e` : durée (30, 60, 90 ou 120 minutes) et nombre d'objets (3, 5, 7 ou 9). 90 minutes sont proposées, avec le
 * nombre d'objets de la table `DS:201a` pour le nombre de joueurs ; changer la durée reprend la valeur de la table.
 * Validation au clic ou après 60 s (`K63TE38`).
 */
export function* settings(rt: Runtime): Script {
  const { game, session, tables } = rt;
  const players = game.players.length;
  const g = SETTINGS;
  rt.voiceKey = VOICES.setup;
  yield* rt.picture("M09DA000.mcg", 3);
  rt.commit();
  rt.sound("move");
  let duration = 2;
  let objects = proposedObjects(tables, players, duration);
  let line = 0;
  // Zones (D11) : les quatre durées puis les quatre nombres d'objets ; cliquer ailleurs valide.
  const zones: Zone[] = [0, 1].flatMap((row) =>
    [0, 1, 2, 3].map((i) => {
      const y = row === 0 ? g.lineY : g.objectsY;
      return { x1: g.cellX + g.cellStep * i, y1: y, x2: g.cellX + g.cellStep * i + g.cellWidth, y2: y + g.cellHeight };
    }),
  );
  const released = function* (direction: number): Script {
    while (rt.dirs() & direction) yield;
  };
  rt.screen = "settings";
  rt.startChrono(0);
  let clicked = false;
  for (;;) {
    rt.restore();
    rt.frame(g.lineX, g.lineY + g.lineStep * line, g.lineX + g.lineWidth, g.lineY + g.lineStep * line + g.cellHeight, 0);
    rt.frame(g.cellX + g.cellStep * duration, g.lineY, g.cellX + g.cellStep * duration + g.cellWidth, g.lineY + g.cellHeight, 0);
    rt.frame(g.cellX + g.cellStep * objects, g.objectsY, g.cellX + g.cellStep * objects + g.cellWidth, g.objectsY + g.cellHeight, 0);
    const directions = rt.dirs();
    let moved = false;
    if (directions & UP && line === 1) {
      moved = true;
      line = 0;
      rt.sound("step");
      yield* released(UP);
    }
    if (directions & DOWN && line === 0 && !moved) {
      moved = true;
      line = 1;
      rt.sound("step");
      yield* released(DOWN);
    }
    for (const [direction, delta] of [
      [RIGHT, 1],
      [LEFT, -1],
    ] as const) {
      if (!(directions & direction) || moved) continue;
      moved = true;
      if (line === 0) {
        if (duration + delta >= 0 && duration + delta <= 3) {
          duration += delta;
          objects = proposedObjects(tables, players, duration);
          rt.sound("move");
        }
      } else if (objects + delta >= 0 && objects + delta <= 3) {
        objects += delta;
        rt.sound("move");
      }
      yield* released(direction);
    }
    const click = rt.click(zones, true);
    if (typeof click === "number") {
      line = click < 4 ? 0 : 1;
      if (line === 0) {
        duration = click;
        objects = proposedObjects(tables, players, duration);
      } else objects = click - 4;
      rt.sound("move");
    }
    if (moved) {
      // Chaque déplacement relance le délai, puis 15 cs d'anti-rebond.
      rt.startChrono(0);
      yield* rt.wait(0xf);
    }
    if (rt.helpRequested()) rt.voiceKey = VOICES.setup;
    if (rt.chrono(0) === 7) yield* rt.voice(0xc);
    // `1abf:2347` : démo interrompue, l'écran est quitté sans validation ni réglage retenu.
    if (rt.demoStopped) {
      rt.screen = "";
      yield* rt.cleanup();
      return;
    }
    if (click === "current") {
      clicked = true;
      break;
    }
    if (rt.timedOut(60)) break;
    yield;
  }
  rt.screen = "";
  if (!clicked) yield* timeoutVoice(rt);
  rt.sound("validate");
  yield* rt.waitSound();
  yield* rt.waitRelease();
  game.duration = session.duration = 1800 * (duration + 1);
  game.objectsRequired = session.objectsRequired = 3 + 2 * objects;
  yield* rt.cleanup();
}
