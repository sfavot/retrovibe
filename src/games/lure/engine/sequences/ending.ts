/**
 * Fin du jeu (méthode native 14 `endgameSequence`, appelée en sortant de la pièce 49 quand le Skorl est vaincu) : l'animation du château
 * avec ses sons, la musique de fin, le défilé, l'écran final qui attend une touche, puis la partie est finie (`quitGame`).
 *
 * Source (ScummVM, GPL v3+) : `Script::endgameSequence` (engines/lure/scripts.cpp).
 *
 * Écarts volontaires : AdLib seulement (la fin du MT-32 a sa propre section sonore) ; `quitGame` est `host.exit()` ; une fois la partie
 * quittée, la séquence ne rend jamais la main (le moteur reste figé sur l'écran noir jusqu'à ce que l'hôte ferme le jeu).
 */

import { type Sequence, waitUntil } from "../../../../engine/sequence";
import { DiskResId } from "../../data/ids";
import { parsePalette } from "../../data/palette";
import type { LureContext } from "../context";
import { ScreenAnimation } from "./animation";
import { beginFullScreen } from "./fullscreen";
import { ENDGAME_CREDITS_MS, ENDGAME_FRAME_DELAY, ENDGAME_PAUSE_MS, ENDGAME_SOUND_AFTER, ENDGAME_SOUND_FINAL, ENDGAME_SOUNDS } from "./ids";
import { SequenceKit } from "./kit";

export function* endgameSequence(ctx: LureContext): Sequence {
  const kit = new SequenceKit(ctx, ctx.sequences);
  const sound = ctx.sound;
  yield* beginFullScreen(kit);

  try {
    sound.killSounds();
    const palette = parsePalette(ctx.data.resources.get(DiskResId.endgamePalette));

    let animation = yield* ScreenAnimation.open(kit, DiskResId.endgameAnim, palette, { fadeIn: true, frameDelay: ENDGAME_FRAME_DELAY, sounds: ENDGAME_SOUNDS });
    const result = yield* animation.show();

    sound.killSounds();
    if (result === "none") {
      sound.playMusic(ENDGAME_SOUND_AFTER, false);
      yield* kit.interruptableDelay(ENDGAME_PAUSE_MS);
    }
    sound.killSounds();

    sound.loadSection?.("ending");
    sound.playMusic(ENDGAME_SOUND_FINAL, true);

    animation = yield* ScreenAnimation.open(kit, DiskResId.endgameAnim + 2, palette, { fadeIn: false });
    yield* animation.show();
    yield* kit.interruptableDelay(ENDGAME_CREDITS_MS);

    animation = yield* ScreenAnimation.open(kit, DiskResId.endgameAnim + 4, palette, { fadeIn: false });
    yield* animation.show();
    // Attend une touche.
    yield* kit.waitForKey();

    yield* kit.fadeOut();
    kit.port.exit();
    // La partie est finie : le moteur reste sur l'écran noir (jusqu'à ce que l'hôte ferme le jeu ou qu'une partie soit restituée).
    yield* waitUntil(() => false);
  } finally {
    kit.port.setActive(false);
  }
}
