import type { Voc } from "../data/voc";
import { musicName } from "../engine/paths";
import { PictureScene, WaitScene } from "../engine/picture";
import type { Scene, SceneContext } from "../engine/scene";
import { VideoScene } from "../engine/video";

/** Attente après la vidéo du logo : jusqu'à 3 s (`1f33:02c0(3)`), passable. */
export const LOGO_WAIT_SECONDS = 3;
/** Le titre S05 reste affiché 1 s (`1f33:02c0(1)`). */
export const TITLE_HOLD_SECONDS = 1;

/** Fichiers lus d'avance pendant le logo, pour que l'enchaînement n'attende pas le réseau. */
const PREFETCH = ["s52d0.mux", "s06a.mux", "s05asphi.mux", "s05a.mcg", "s07a001d.mcg"] as const;

/**
 * Séquence de démarrage (engine.md §1.1 étape 8, §1.2, §9.12) :
 * logo S52D0 (image, vidéo, attente) → intro S06 (passable) → titre S05 (vidéo puis image 1 s) → menu.
 * Chaque scène enchaîne la suivante par `ctx.scenes.replace` ; les fondus sont ceux de l'original.
 */
export function createBootScene(): Scene {
  return new PictureScene({
    mcg: "s52d00.mcg",
    fadeIn: true,
    seconds: 0,
    load: async (ctx) => ctx.resources.prefetch(...PREFETCH),
    onEnd: (ctx) => ctx.scenes.replace(createLogoVideo()),
  });
}

function createLogoVideo(): Scene {
  return new VideoScene({
    file: "s52d0.mux",
    fadeOutAtEnd: true,
    onEnd: (ctx) => ctx.scenes.replace(new WaitScene({ seconds: LOGO_WAIT_SECONDS, onEnd: (c) => c.scenes.replace(createIntro()) })),
  });
}

function createIntro(): Scene {
  return new VideoScene({
    file: "s06a.mux",
    fadeOutAtEnd: true,
    onEnd: (ctx) => ctx.scenes.replace(createTitleVideo()),
  });
}

/** S05 : la vidéo (non passable : options 0) puis l'image fixe. */
function createTitleVideo(): Scene {
  return new VideoScene({
    file: "s05asphi.mux",
    skippable: false,
    onEnd: (ctx) => ctx.scenes.replace(createTitlePicture()),
  });
}

function createTitlePicture(): Scene {
  return new PictureScene({
    mcg: "s05a.mcg",
    seconds: TITLE_HOLD_SECONDS,
    fadeOutAtEnd: true,
    onEnd: (ctx) => ctx.scenes.replace(createMenuBackdrop()),
  });
}

/**
 * Scène provisoire (phase 2) : seulement le fond du menu S07, sans texte ni interaction, avec la musique de fond
 * `s52m00Nm.voc` (N tiré de 1 à 3, comme `21ee:0006`). Le menu réel la remplacera en phase 3.
 */
export function createMenuBackdrop(): Scene {
  let music: Voc | null = null;
  return new PictureScene({
    mcg: "s07a001d.mcg",
    fadeIn: true,
    load: async (ctx: SceneContext) => {
      music = await ctx.resources.voc(musicName(1 + ctx.rng.below(3)));
    },
    onEnter: (ctx) => ctx.voice.setMusic(music),
  });
}
