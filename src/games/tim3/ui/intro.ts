/**
 * Intro du jeu, sans DOM : logo Sierra (42a3c2) puis titre animé (42a590), comme au lancement de TIMWIN.EXE (43b16c). Les crédits
 * (419e88) suivent si rien n'a été passé ; ils sont une fenêtre `.ITF` (`ui/credits.ts`).
 *
 * Enchaînement d'origine (`docs/tim3/ui.md` § Parcours d'entrée) :
 * 1. Logo : `SIERRA.BMP` (palette `SIERRA.PAL`), deux attentes de 16 ms, puis l'air de Sierra (`SX_3400.WAV`, 13,3 s). Tant qu'il
 *    joue, l'image reste fixe ; ensuite les images 1 à 75 de `SIERRA.ANM`, une toutes les 48 ms (avec leurs sons), et l'air est coupé.
 * 2. Titre : `TITLE.BMP` et la bande `TITLE2.ANM` (palette `TTLDARK.PAL`), 48 ms, musique 1000, 48 ms, puis les images de `TITLE.ANM`
 *    toutes les 48 ms ; la palette passe à `TTLLITE.PAL` à l'image qui ouvre l'état 5 ; la dernière image reste 60 tours.
 * 3. Un clic ou une touche, à tout moment, passe **toute** la suite : depuis le logo, le titre et les crédits sont sautés ; depuis le
 *    titre, les crédits. Le jeu joue cette intro à chaque lancement (aucune option ne la retire).
 */
import type { Anm } from "../data/anm";
import type { ResourceIndex } from "../data/volume";
import { drawAnmImage, imageCount, stateStart } from "../render/anm-draw";
import type { RenderAssets } from "../render/assets";
import { INTRO_FRAME_MS, LOGO, TITLE, drawFullBitmap, frameSounds, screenLut, type FrameSound } from "../render/front";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../render/screen";
import { Surface } from "../render/surface";

/** Ce que l'intro demande au son. */
export interface IntroSound {
  effect(sound: FrameSound): void;
  stopEffect(id: number): void;
  music(id: number): void;
}

/** Attentes de 16 ms avant l'air de Sierra (42a432 … 42a45d : deux 43b6aa(1)). */
const LOGO_LEAD_MS = 2 * 16;
/** Un retard de plus d'une seconde (onglet masqué) : les images rattrapées ne jouent pas leurs sons. */
const SOUND_LATE_MS = 1000;

export type IntroPhase = "logo" | "title" | "done";

export class IntroPlayer {
  readonly surface = new Surface(SCREEN_WIDTH, SCREEN_HEIGHT);
  lut: Uint32Array;
  phase: IntroPhase = "logo";
  /** Vrai si un clic ou une touche a passé l'intro (pas de crédits ensuite). */
  skipped = false;
  /** À redessiner. */
  dirty = true;
  private logo: Anm | null;
  private title: Anm | null;
  private readonly titleDark: Uint32Array;
  private readonly lite: Uint32Array;
  /** Image suivante de l'animation en cours, et son heure. */
  private image = 1;
  private due = 0;
  /** Tours restants sur la dernière image du titre (−1 : pas encore à la fin). */
  private hold = -1;
  private started = false;

  constructor(
    private readonly assets: RenderAssets,
    index: ResourceIndex,
    private readonly sound: IntroSound,
    /** Durée de l'air de Sierra (ms) : l'animation du logo attend qu'il soit fini. */
    private readonly jingleMs: number,
  ) {
    this.lut = screenLut(index, LOGO.palette);
    this.titleDark = screenLut(index, TITLE.dark);
    this.lite = screenLut(index, TITLE.lite);
    this.logo = assets.anm(LOGO.anm);
    this.title = assets.anm(TITLE.anm);
  }

  /** Avance jusqu'à `now` ; renvoie la phase. */
  update(now: number): IntroPhase {
    if (!this.started) this.startLogo(now);
    while (this.phase !== "done" && now >= this.due) this.step(now);
    return this.phase;
  }

  /** Clic ou touche : fin de l'intro, sans les crédits. */
  skip(): void {
    if (this.phase === "done") return;
    this.skipped = true;
    this.finish();
  }

  private startLogo(now: number): void {
    this.started = true;
    this.surface.clear(0);
    drawFullBitmap(this.surface, this.assets, LOGO.bitmap);
    this.dirty = true;
    this.sound.effect({ id: LOGO.jingle, priority: 1, flags: 0 });
    this.image = 1;
    this.due = now + LOGO_LEAD_MS + this.jingleMs;
  }

  private startTitle(now: number): void {
    this.phase = "title";
    this.lut = this.titleDark;
    this.surface.clear(0);
    drawFullBitmap(this.surface, this.assets, TITLE.bitmap);
    const strip = this.assets.anm(TITLE.strip);
    if (strip) drawAnmImage(this.surface, this.assets, strip, 0, 0, TITLE.stripY);
    this.dirty = true;
    // 42a5f0 … 42a63a : 48 ms, musique, 48 ms, puis l'animation.
    this.sound.music(TITLE.music);
    this.image = 1;
    this.hold = -1;
    this.due = now + 2 * INTRO_FRAME_MS;
  }

  private play(anm: Anm, image: number, now: number): void {
    if (now - this.due > SOUND_LATE_MS) return;
    for (const s of frameSounds(anm, image)) this.sound.effect(s);
  }

  private step(now: number): void {
    if (this.phase === "logo") {
      const anm = this.logo;
      if (!anm || this.image >= imageCount(anm)) {
        // 42a53a : fin du logo, l'air est coupé (41151e(0xD48)).
        this.sound.stopEffect(LOGO.jingle);
        this.startTitle(this.due + INTRO_FRAME_MS);
        return;
      }
      drawAnmImage(this.surface, this.assets, anm, this.image, 0, 0);
      this.play(anm, this.image, now);
      this.image++;
      this.dirty = true;
      this.due += INTRO_FRAME_MS;
      return;
    }
    const anm = this.title;
    if (!anm) return this.finish();
    if (this.hold < 0) {
      drawAnmImage(this.surface, this.assets, anm, this.image, 0, 0);
      this.play(anm, this.image, now);
      if (stateStart(anm, this.image) === TITLE.liteState) this.lut = this.lite;
      this.dirty = true;
      if (this.image + 1 < imageCount(anm)) this.image++;
      else this.hold = TITLE.hold;
    } else if (--this.hold <= 0) return this.finish();
    this.due += INTRO_FRAME_MS;
  }

  private finish(): void {
    this.sound.stopEffect(LOGO.jingle);
    this.phase = "done";
  }
}
