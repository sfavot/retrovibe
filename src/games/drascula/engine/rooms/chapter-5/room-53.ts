import { animate } from "../../../cinematics/player";
import type { DrasculaEngine } from "../../loop";
import { freezeRoom, hiccup, setVisible } from "../../room-kit";
import { type Sequence, pause } from "../../sequence";
import { Track, Verb } from "../../state";
import { Flag, Item, Laboratory, Room } from "./ids";
import { updateVisible } from "./screen";

/**
 * Pièce 53, le laboratoire de Frankenstein. Réécriture de `room_53`, `animation_12_5` et `animation_12_5_frankenstein` (engines/drascula/
 * rooms.cpp et animation.cpp, ScummVM). Pas de `update_53` : le monstre sur la table (drapeau 1 bas), la prise (drapeau 2 bas) et
 * l'interrupteur (drapeau 9) sont dans `roomPreUpdates` de `drascula.dat`.
 *
 * Écarts à ScummVM :
 * - `animation_12_5` écrit sur l'écran : ici chaque image gèle la pièce (`freezeRoom`, qui est `updateRoom()`) et lui ajoute ses sprites
 *   sur l'image libre de la cinématique ; les feuilles `3an11_1.alg` et `auxfr.alg` sont lues sans toucher à `back` (ScummVM les y
 *   charge, puis remet `99.ALG`) ;
 * - la fiche (objet 16) qu'on tient reste en main même si on l'utilise sur un autre objet, qui la fait réapparaître par terre
 *   (`visible[3] = 1`) : repris tel quel de ScummVM ; `pickedObject = kVerbMove` après l'avoir branchée n'est pas repris, sans effet
 *   observable (le curseur est vide : `takeObject` est faux).
 */

/** Origines (x) des sprites de la renaissance : l'éclair (`rayX`), le monstre de la table (`frusky_x`) et le monstre debout (`elfrusky_x`). */
const RAY_X = [1, 46, 91, 136, 181, 226, 271, 181];
const FRUSKY_X = [100, 139, 178, 217, 100, 178, 217, 139, 100, 139];
const ELFRUSKY_X = [1, 68, 135, 1, 68, 135, 1, 68, 135, 68, 1, 135, 68, 135, 68];
/** Marche du monstre qui quitte le laboratoire (`animation_12_5_frankenstein`). */
const WALK_X = [1, 46, 91, 136, 181, 226, 271];
const WALK_FRAMES = 7;

/** `room_53` : prendre la fiche, brancher, y mettre la vis et le cerveau, et l'interrupteur. */
export function* room53(g: DrasculaEngine, objectId: number): Sequence<boolean> {
  const flags = g.flags;
  const picked = g.picked;
  if (picked === Verb.Pick && objectId === Laboratory.FloorPlug) {
    g.pickObject(Item.Plug);
    setVisible(g, Laboratory.FloorPlug, false);
  } else if (picked === Verb.Move && objectId === Laboratory.Switch) {
    flags[Flag.SwitchOn] = 1;
    if (flags[Flag.PlugConnected] === 1 && flags[Flag.ScrewFitted] === 1 && flags[Flag.BrainFitted] === 1) {
      yield* reanimate(g);
    } else {
      flags[Flag.SwitchOn] = 0;
      yield* g.talk(33);
    }
  } else if (picked === Item.Screw && objectId === Laboratory.Frankenstein) {
    flags[Flag.ScrewFitted] = 1;
    yield* g.talk(401);
    g.selectVerb(Verb.None);
    g.removeObject(Item.Screw);
  } else if (picked === Item.Brain && objectId === Laboratory.Frankenstein) {
    flags[Flag.BrainFitted] = 1;
    yield* g.talk(401);
    g.selectVerb(Verb.None);
    g.removeObject(Item.Brain);
  } else if (picked === Item.Plug && objectId === Laboratory.Socket) {
    flags[Flag.PlugConnected] = 1;
    g.selectVerb(Verb.None);
    updateVisible(g);
  } else if (picked === Item.Plug) {
    // Chapitre 5 : la fiche utilisée ailleurs reparaît par terre, la réponse revient à la pièce 0.
    setVisible(g, Laboratory.FloorPlug, true);
    return false;
  } else {
    return false;
  }
  return true;
}

/** Palette 6 bits d'une couleur : `adjustToVGA` (`(value & 0x3F) * (value > 0)`). */
const toVga = (value: number): number => (value > 0 ? value & 0x3f : 0);

/**
 * Les trois palettes de la renaissance (`bgPalette1` à `3`) : la palette du jeu dont les 128 premières couleurs sont assombries, par
 * passes de `8 - fade` (`fade` de 3 à 0) ; `bgPalette3` subit les quatre passes (26 en tout), `2` les trois dernières (21), `1` les deux
 * dernières (15).
 */
function flashPalettes(game: Int8Array): [Uint8Array, Uint8Array, Uint8Array] {
  const palettes = [0, 1, 2].map(() => Uint8Array.from(game, (value) => value & 0x3f));
  const [light, medium, dark] = palettes as [Uint8Array, Uint8Array, Uint8Array];
  for (let fade = 3; fade >= 0; fade--) {
    for (let i = 0; i < 128 * 3; i++) {
      dark[i] = toVga(dark[i] - 8 + fade);
      if (fade <= 2) medium[i] = toVga(medium[i] - 8 + fade);
      if (fade <= 1) light[i] = toVga(light[i] - 8 + fade);
    }
  }
  return [light, medium, dark];
}

/**
 * `animation_12_5` : l'éclair frappe (`rayo1.bin`, `rayo2.bin`), la pièce passe par ces palettes assombries pendant que le monstre
 * s'éveille (huit images), se lève (quinze), la scène de `frel.bin`, le monstre marche hors du laboratoire, le hoquet du héros qui sort
 * ; la pièce suivante est le couloir 57 (arrivée par la porte 104).
 */
export function* reanimate(g: DrasculaEngine): Sequence {
  const gfx = g.gfx;
  const palette = gfx.palette;
  const s = g.state;
  const hero = s.hero;

  g.host.playMusic(26);
  g.updateRoom();
  yield* pause(27);
  yield* animate(g, "rayo1.bin", 23);
  g.playEffect(5);
  yield* animate(g, "rayo2.bin", 17);
  hero.track = Track.Right;
  g.updateRoom();

  palette.useLight(palette.dark);
  const [light, medium, dark] = flashPalettes(palette.game);
  const rays = gfx.sheet("3an11_1.alg");

  for (let frame = 0; frame < 8; frame++) {
    palette.showExternal(frame === 2 || frame === 4 ? light : frame === 1 || frame === 5 || frame === 7 ? medium : dark);
    yield* pause(4);
    freezeRoom(g, { advance: true });
    gfx.canvas.copyRect(rays, RAY_X[frame], 1, 41, 0, 44, 44);
    gfx.canvas.copyRect(gfx.draw3, FRUSKY_X[frame], 113, 205, 50, 38, 86);
  }

  g.stopSound();

  for (let frame = 0; frame < 15; frame++) {
    if (frame === 1 || frame === 5) palette.show();
    else palette.showExternal(frame === 2 || frame === 4 || frame === 7 || frame === 9 ? light : medium);
    yield* pause(4);
    freezeRoom(g, { advance: true });
    gfx.canvas.copyRect(rays, ELFRUSKY_X[frame], 47, 192, 39, 66, 106);
  }

  yield* animate(g, "frel.bin", 16);
  gfx.clearRoom();
  palette.useLight(palette.bright);

  s.flags[Flag.FrankensteinAwake] = 1;
  yield* frankensteinWalks(g);

  g.playEffect(1);
  yield* hiccup(g, 12);
  yield* g.finishSound();

  yield* g.walkToPoint(40, 169);
  yield* g.walkToPoint(-14, 175);

  // Le héros arrive dans le couloir par la porte 104.
  g.doBreak = true;
  s.previousMusic = s.roomMusic;
  hero.visible = true;
  gfx.clearRoom();
  hero.track = Track.Right;
  hero.moving = false;
  hero.x = -1;
  s.objExit = 104;
  g.selectVerb(Verb.None);
  yield* g.enterRoom(Room.Corridor);
}

/** `animation_12_5_frankenstein` : le monstre traverse la pièce vers la gauche, de 5 pixels par image ; le héros se tourne à la fin du premier cycle. */
function* frankensteinWalks(g: DrasculaEngine): Sequence {
  const gfx = g.gfx;
  const sheet = gfx.sheet("auxfr.alg");
  let x = 199;
  let frame = 0;
  freezeRoom(g, { advance: true });
  gfx.canvas.copyRect(sheet, 1, 1, x, 81, 44, 87);
  yield* pause(15);
  g.host.playMusic(18);
  for (;;) {
    freezeRoom(g, { advance: true });
    gfx.canvas.copyRect(sheet, WALK_X[frame], 1, x, 81, 44, 87);
    x -= 5;
    frame++;
    if (x <= -45) break;
    if (frame === WALK_FRAMES) {
      frame = 0;
      g.state.hero.track = Track.Down;
    }
    yield* pause(6);
  }
}
