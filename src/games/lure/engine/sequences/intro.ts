/**
 * Introduction : logo, présentation, titre, puis les écrans animés (« le royaume était en paix »…), les images de la bataille et l'écran
 * final, avec leur musique ; Échap l'abandonne, un clic ou une autre touche passe l'écran ou l'attente en cours.
 *
 * Source (ScummVM, GPL v3+) : `Introduction::show`, `showScreen`, `interruptableDelay`, `playMusic` (engines/lure/intro.cpp), `LureEngine::go`
 * (engines/lure/lure.cpp : sections sonores et premier affichage du jeu).
 *
 * Écarts volontaires : voir `kit.ts` (horloge du moteur, fondus par image de logique) ; AdLib seulement : `initCustomTimbres` (MT-32) n'existe
 * pas ; la protection de copie et le paramètre de démarrage (`boot_param`) ne sont pas portés. Sans musique d'introduction (son muet),
 * le fondu de 3 s est tenu à l'horloge du moteur. La ressource finale (écran `0x22`, 33,3 s) se saute comme le reste.
 */

import type { Sequence } from "../../../../engine/sequence";
import { DiskResId } from "../../data/ids";
import { parsePalette, parsePaletteCollection } from "../../data/palette";
import { loadGameScreen } from "../../data/picture";
import { ScreenAnimation } from "./animation";
import {
  INTRO_ANIMS,
  INTRO_BATTLE_ANIM,
  INTRO_BATTLE_BLACK_MS,
  INTRO_BATTLE_PALETTE_INDEX,
  INTRO_BATTLE_SHOW_MS,
  INTRO_FADE_LEAD_MS,
  INTRO_FAST_ANIM,
  INTRO_FAST_FRAME_DELAY,
  INTRO_FINAL_MS,
  INTRO_FINAL_PALETTE,
  INTRO_FINAL_SCREEN,
  INTRO_MUSIC_GAP_MS,
  INTRO_SCREEN_MS,
  INTRO_START_SCREENS,
  NO_SOUND,
} from "./ids";
import type { LureContext } from "../context";
import { SequenceKit } from "./kit";

/** `Introduction::showScreen` : l'écran, sa palette en fondu, l'attente, puis le fondu sortant ; vrai si Échap abandonne l'introduction. */
function* showScreen(kit: SequenceKit, screenId: number, paletteId: number, delayMs: number, fadeOut = true): Sequence<boolean> {
  const resources = kit.ctx.data.resources;
  kit.screen.pixels.set(loadGameScreen(resources.get(screenId)));
  yield* kit.fadeIn(parsePalette(resources.get(paletteId)));
  const aborted = yield* kit.introDelay(delayMs);
  if (fadeOut) yield* kit.fadeOut();
  return aborted;
}

/** `Introduction::show` ; vrai si l'introduction a été abandonnée. */
export function* introduction(kit: SequenceKit): Sequence<boolean> {
  const { ctx } = kit;
  const sound = ctx.sound;
  kit.emptyPalette();

  // Société, jeu, puis écran de titre (sans fondu sortant, il reste pendant le fondu de la musique).
  for (let i = 0; i < 3; i++) {
    const id = INTRO_START_SCREENS[i]!;
    if (yield* showScreen(kit, id, id + 1, INTRO_SCREEN_MS)) return true;
  }
  const title = INTRO_START_SCREENS[3];
  if (yield* showScreen(kit, title, title + 1, INTRO_SCREEN_MS, false)) return true;
  yield* kit.fadeOut();

  const palettes = parsePaletteCollection(ctx.data.resources.get(DiskResId.introPalettes), DiskResId.introPalettes);
  let currentSound = NO_SOUND;

  /** `Introduction::playMusic` : vrai si Échap interrompt le fondu ou l'attente qui suit. */
  const playMusic = function* (soundNumber: number, fadeOut: boolean): Sequence<boolean> {
    let result = false;
    if (soundNumber !== NO_SOUND && currentSound !== soundNumber) {
      if (fadeOut) {
        result = yield* kit.fadeOutMusic();
        if (!result) result = yield* kit.introDelay(INTRO_MUSIC_GAP_MS);
      } else {
        sound.killSounds();
      }
      if (!result) {
        currentSound = soundNumber;
        sound.playMusic(currentSound, true);
      }
    }
    return result;
  };

  // Écrans animés.
  for (const [index, record] of INTRO_ANIMS.entries()) {
    yield* playMusic(record.soundNumber, false);

    const animation = yield* ScreenAnimation.open(kit, record.resourceId, palettes[record.paletteIndex]!, {
      fadeIn: index === 0,
      frameDelay: record.resourceId === INTRO_FAST_ANIM ? INTRO_FAST_FRAME_DELAY : undefined,
    });

    if (record.initialPause !== 0 && (yield* kit.introDelay((record.initialPause * 1000) / 50))) return true;

    let result = false;
    const abort = yield* animation.show();
    if (abort === "none") {
      if (record.endingPause !== 0) {
        if (record.soundTransitionPause !== 0) {
          let pause = (record.soundTransitionPause * 1000) / 50;
          if (record.fadeOutSound) pause -= INTRO_FADE_LEAD_MS;
          // Attente avant de passer au morceau suivant.
          result = yield* kit.introDelay(pause);
        }
        if (!result) result = yield* playMusic(record.soundNumber2, record.fadeOutSound);
        // Attente restante avant l'animation suivante.
        if (!result) result = yield* kit.introDelay(((record.endingPause - record.soundTransitionPause) * 1000) / 50);
      }
    } else if (abort === "endIntro") {
      result = true;
    }
    if (result) {
      sound.killSounds();
      return true;
    }
  }

  // Dernier écran animé.
  yield* kit.fadeOut();

  // Images de la bataille, une à une : l'image, 2 s, fondu au noir, 0,5 s de noir.
  let result = false;
  const battle = yield* ScreenAnimation.open(kit, INTRO_BATTLE_ANIM, palettes[INTRO_BATTLE_PALETTE_INDEX]!, { fadeIn: false });
  do {
    result = yield* kit.introDelay(INTRO_BATTLE_SHOW_MS);
    yield* kit.fadeOut();
    if (!result) result = yield* kit.introDelay(INTRO_BATTLE_BLACK_MS);
    if (result) break;
  } while (battle.step());

  // Écran final.
  if (!result) yield* showScreen(kit, INTRO_FINAL_SCREEN, INTRO_FINAL_PALETTE, INTRO_FINAL_MS);

  sound.killSounds();
  return false;
}

/**
 * `LureEngine::go` autour de l'introduction : section sonore « introduction », l'écran des séquences, puis l'écran vidé (`_screen->empty()`)
 * et la section « jeu » avant la partie.
 */
export function* playIntroduction(ctx: LureContext): Sequence {
  const kit = new SequenceKit(ctx, ctx.sequences);
  const { port, screen } = kit;
  screen.holdRoom = false;
  screen.fadeIntoRoom = false;
  screen.showCursor = true;
  port.setActive(true);
  ctx.sound.loadSection?.("intro");
  try {
    yield* introduction(kit);
  } finally {
    ctx.sound.killSounds();
    screen.pixels.fill(0);
    ctx.sound.loadSection?.("main");
    port.setActive(false);
  }
}
