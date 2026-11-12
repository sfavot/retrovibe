/**
 * Séquences plein écran jouées en cours de partie : la chute dans le trou, le tonneau et la capture par le Skorl. Chacune commence par le
 * fondu au noir de la pièce (fait par le rendu, `SequenceScreen.holdRoom`) et rend la main sur le dernier écran de l'animation, que le
 * changement de pièce suivant fond à son tour.
 *
 * Source (ScummVM, GPL v3+) : `Game::displayChuteAnimation`, `Game::displayBarrelAnimation`, `Game::execute` (cas `GS_CAUGHT`)
 * (engines/lure/game.cpp). Les effets sur l'état du jeu (champ de zone, personnages du village retirés) restent dans `game.ts`.
 *
 * Écarts volontaires : le curseur « disque » pendant le fondu est celui du rendu ; ces séquences se sautent comme dans ScummVM (clic :
 * animation suivante, Échap : toute la suite de la chute).
 */

import { type Sequence, wait } from "../../../../engine/sequence";
import { DiskResId } from "../../data/ids";
import { parsePalette } from "../../data/palette";
import type { LureContext } from "../context";
import { ScreenAnimation } from "./animation";
import { BARREL_SOUND, CATCH_FRAME_DELAY, CATCH_SOUNDS, CHUTE2_FRAME_DELAY, CHUTE2_LOOPS, CHUTE_SOUND } from "./ids";
import { SequenceKit } from "./kit";

/**
 * Début d'une séquence de partie : l'écran des séquences remplace la pièce, que le rendu fond au noir pendant l'attente d'une image
 * (l'hôte suspend les ticks, comme ScummVM bloqué dans `paletteFadeOut`).
 */
export function* beginFullScreen(kit: SequenceKit): Sequence {
  const screen = kit.screen;
  screen.holdRoom = true;
  screen.fadeIntoRoom = true;
  screen.showCursor = false;
  screen.pixels.fill(0);
  kit.emptyPalette();
  kit.port.setActive(true);
  yield* wait(1);
  screen.holdRoom = false;
  kit.sync();
}

/** Fin d'une séquence de partie : le rendu retrouve la pièce (qui apparaît en fondu depuis le dernier écran de la séquence). */
export function endFullScreen(kit: SequenceKit): void {
  kit.port.setActive(false);
}

/** `Game::displayChuteAnimation` (partie animée). */
export function* chuteSequence(ctx: LureContext): Sequence {
  const kit = new SequenceKit(ctx, ctx.sequences);
  yield* beginFullScreen(kit);
  try {
    const palette = parsePalette(ctx.data.resources.get(DiskResId.chutePalette));
    ctx.sound.killSounds();

    let animation = yield* ScreenAnimation.open(kit, DiskResId.chuteAnim, palette, { fadeIn: true });
    ctx.sound.playMusic(CHUTE_SOUND, true);
    let result = yield* animation.show();

    if (result !== "endIntro") {
      animation = yield* ScreenAnimation.open(kit, DiskResId.chute2Anim, palette, { fadeIn: true, frameDelay: CHUTE2_FRAME_DELAY, loops: CHUTE2_LOOPS });
      result = yield* animation.show();
    }
    if (result !== "endIntro") {
      animation = yield* ScreenAnimation.open(kit, DiskResId.chute3Anim, palette, { fadeIn: false });
      yield* animation.show();
    }
    ctx.sound.killSounds();
  } finally {
    endFullScreen(kit);
  }
}

/** `Game::displayBarrelAnimation` (partie animée). */
export function* barrelSequence(ctx: LureContext): Sequence {
  const kit = new SequenceKit(ctx, ctx.sequences);
  yield* beginFullScreen(kit);
  try {
    const palette = parsePalette(ctx.data.resources.get(DiskResId.barrelPalette));
    ctx.sound.killSounds();
    ctx.sound.playMusic(BARREL_SOUND, true);

    const animation = yield* ScreenAnimation.open(kit, DiskResId.barrelAnim, palette, { fadeIn: true });
    yield* animation.show();

    yield* kit.fadeOut();
    ctx.sound.killSounds();
  } finally {
    endFullScreen(kit);
  }
}

/** Capture par le Skorl (`GS_CAUGHT` de `Game::execute`). */
export function* captureSequence(ctx: LureContext): Sequence {
  const kit = new SequenceKit(ctx, ctx.sequences);
  yield* beginFullScreen(kit);
  try {
    const palette = parsePalette(ctx.data.resources.get(DiskResId.skorlCatchPalette));
    const animation = yield* ScreenAnimation.open(kit, DiskResId.skorlCatchAnim, palette, {
      fadeIn: true,
      frameDelay: CATCH_FRAME_DELAY,
      sounds: CATCH_SOUNDS,
    });
    yield* animation.show();
    yield* kit.fadeOut();
  } finally {
    endFullScreen(kit);
  }
}
