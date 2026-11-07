import type { DrasculaRenderer, RoomPainter } from "../../../render/renderer";
import type { DrasculaEngine } from "../../loop";
import type { GameState } from "../../state";
import { Anim, Flag } from "./ids";

/**
 * Le dessin de la chambre d'Igor (pièce 26) : `update_26_pre` et `update_26` de ScummVM (engines/drascula/rooms.cpp), séparés en
 * dessin (`bedroomPainter`, `drawBedroomPre`) et avance (`tickBedroom`) comme partout dans le portage (`docs/drascula/rooms.md` § 4).
 * Le rectangle d'Igor au repos, ceux de la porte et de la perruque sont des lignes de `roomPreUpdates` de `drascula.dat`.
 */

/** Ticks entre deux tirages du clignement d'Igor (`difference >= 10`). */
const BLINK_TICKS = 10;

/** Dessine dans `screen` ce que `update_26_pre` ajoute : le clignement, les poses d'Igor pendant sa conversation, Igor debout. */
export function drawBedroomPre(r: DrasculaRenderer, screen: DrasculaRenderer["screen"], s: GameState): void {
  const { draw3 } = r;
  const { anim, flags } = s;
  if (anim[Anim.Blinking] === 5 && flags[Flag.Ready] === 0) screen.copyBackground(draw3, 52, 172, 226, 106, 3, 4);
  // `animation_1_4` : Igor se lève (première image) puis se tient debout (seconde image, aussi le drapeau 20).
  if (anim[Anim.IgorPose] === 1) screen.copyBackground(draw3, 131, 133, 199, 95, 50, 66);
  if (flags[Flag.IgorStanding] === 1 || anim[Anim.IgorPose] === 2) screen.copyBackground(draw3, 182, 133, 199, 95, 50, 66);
  // `room_26` : Igor garde sa perruque (une image, la même que celle de son visage au repos).
  if (anim[Anim.WigGuard] === 1) screen.copyBackground(draw3, 80, 78, 199, 94, 38, 27);
}

/** `update_26_pre` (clignement, poses) et `update_26` (le héros déguisé, puis le premier plan). */
export const bedroomPainter: RoomPainter = {
  pre(r, s) {
    drawBedroomPre(r, r.screen, s);
  },
  post(r, s) {
    const { screen, back, draw3 } = r;
    if (s.flags[Flag.Disguised] === 1) screen.copyRect(back, 93, 1, s.hero.x, s.hero.y, 45, 78);
    screen.copyRect(draw3, 233, 107, 17, 102, 66, 92);
  },
};

/** Partie « avance » de `update_26_pre` : le clignement est retiré toutes les 100 ms. */
export function tickBedroom(g: DrasculaEngine): void {
  const s = g.state;
  if (s.room?.number !== 26 || !g.gfx.roomSprites || g.gfx.owner !== "room") return;
  if (g.ticks - s.savedTime < BLINK_TICKS) return;
  s.anim[Anim.Blinking] = g.rng.inclusive(10);
  s.savedTime = g.ticks;
}
