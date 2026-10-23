import type { Hy8 } from "../../../data/hy8";
import { parsePal, type Mcg } from "../../../data/mcg";
import type { Voc } from "../../../data/voc";
import { voiceName } from "../../../engine/paths";
import type { Scene, SceneContext } from "../../../engine/scene";
import { OverlayVideo } from "./overlay-video";

/**
 * Promenade du Schtroumpf à lunettes (`1fc6:085f(vidéo)`, vidéo 9 à 24) : l'écran du lieu (`s38a00Nd.mcg`, N = 0 si le joueur était à l'écran 2, 1 sinon),
 * la réplique `s38a00Mt` (M selon le personnage), puis la vidéo `s38a` ou `s38b` (tirage `rand × 2`, 0 = `s38b`) en surimpression avec la palette
 * `s38a0NKd.pal` ; à l'image 0xB5 (`s38a`) ou 0x6F (`s38b`) la vue bascule sur la carte `s02a00{4,5,6}d.mcg`, où le pion du lieu d'arrivée est posé
 * 2,5 s.
 */

/** Carte (`s02a00Nd.mcg`) par vidéo 9..24 (`CS:1fc6:0bfc`). */
export const WALK_MAPS: readonly number[] = [4, 6, 5, 6, 5, 5, 5, 6, 4, 4, 4, 6, 5, 6, 4, 6];
/** Sprite de `s02a000s.hy8`, abscisse et ordonnée du pion par vidéo 9..24 (`CS:1fc6:0bdc`, `1fc6:0ac4..0b91`). */
export const WALK_PAWNS: readonly (readonly [number, number, number])[] = [
  [0, 0x75, 0xa4], [1, 0x62, 0x83], [0, 0xdb, 0xa3], [0, 0x2f, 0x2e], [1, 0x4f, 0xaf], [0, 0xbf, 0x83], [1, 0xa7, 0xa9], [1, 0x98, 0x7e],
  [1, 0x11c, 0xaf], [1, 0x79, 0x5d], [1, 0x53, 0x8f], [0, 0x94, 0x41], [1, 0x4b, 0x5f], [1, 0xfa, 0x85], [1, 0xf6, 0x48], [0, 0xf4, 0x57],
];
/** Voix de la réplique par personnage (`DS:1CEC`) : `s38a00{1 + n}t`. */
export const WALK_VOICES: readonly number[] = [0, 4, 5, 1, 2, 3];
/** Images où la vue bascule sur la carte (`1fc6:1762`) : `s38a`, `s38b`. */
export const WALK_CUT: Readonly<Record<"a" | "b", number>> = { a: 0xb5, b: 0x6f };
const HOLD_TICKS = 150;

export type WalkPhase = "fadeIn" | "talk" | "video" | "hold" | "done";

export class WalkScene implements Scene {
  readonly step = 1;
  private mcg!: Mcg;
  private map!: Mcg;
  private sprites!: Hy8;
  private voice!: Voc;
  private pal!: Uint8Array;
  private video!: OverlayVideo;
  private phase: WalkPhase = "fadeIn";
  private choice: "a" | "b" = "a";
  private cut = false;
  private since = 0;
  private done = false;

  /**
   * @param video numéro de vidéo 9..24 ; @param oldScreen écran du joueur avant le déplacement ; @param character personnage du joueur.
   */
  constructor(
    private readonly videoNumber: number,
    private readonly oldScreen: number,
    private readonly character: number,
    private readonly onDone: (ctx: SceneContext) => void,
  ) {}

  get stage(): WalkPhase {
    return this.phase;
  }

  /** Vidéo choisie (pour les tests) : `a` ou `b`. */
  get clip(): "a" | "b" {
    return this.choice;
  }

  get hasCut(): boolean {
    return this.cut;
  }

  async load(ctx: SceneContext): Promise<void> {
    const n = this.oldScreen === 2 ? 0 : 1;
    // `rand × 2 == 0` : `s38b` ; le tirage se fait au chargement, la vidéo à lire en dépend.
    this.choice = ctx.rng.below(2) === 0 ? "b" : "a";
    const k = this.choice === "a" ? 1 : 2;
    const index = this.videoNumber - 9;
    [this.mcg, this.map, this.sprites, this.voice, this.video, this.pal] = await Promise.all([
      ctx.resources.mcg(`s38a00${n}d.mcg`),
      ctx.resources.mcg(`s02a00${WALK_MAPS[index]}d.mcg`),
      ctx.resources.hy8("s02a000s.hy8"),
      ctx.resources.voc(voiceName("s38a", 1 + WALK_VOICES[this.character])),
      OverlayVideo.load(ctx, this.choice === "a" ? "s38a.mux" : "s38b.mux"),
      ctx.resources.bytes(`s38a0${n}${k}d.pal`).then(parsePal),
    ]);
  }

  enter(ctx: SceneContext): void {
    this.phase = "fadeIn";
    this.cut = false;
    this.done = false;
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    ctx.fade.blackout();
    ctx.fade.in();
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "fadeIn":
        if (ctx.fade.active) return;
        this.phase = "talk";
        ctx.voice.play(this.voice);
        return;
      case "talk":
        // `1f33:03a7(0)` : on attend la fin de la réplique, sans pouvoir la couper.
        if (ctx.voice.voicePlaying) return;
        this.phase = "video";
        ctx.palette.load(this.pal);
        this.video.start(ctx);
        return;
      case "video":
        this.video.update(
          ctx,
          (image) => (image >= WALK_CUT[this.choice] ? this.map.pixels : this.mcg.pixels),
          (image) => {
            if (image >= WALK_CUT[this.choice] && !this.cut) {
              this.cut = true;
              ctx.palette.load(this.map.palette);
            }
          },
        );
        if (this.video.ended) {
          // Fin de la vidéo : la carte et le pion (`1fc6:0a76..0b99`).
          if (!this.cut) ctx.palette.load(this.map.palette);
          this.cut = true;
          ctx.surface.drawMcg(this.map, { asBackground: true });
          const [sprite, x, y] = WALK_PAWNS[this.videoNumber - 9];
          ctx.surface.drawSprite(this.sprites, sprite, x, y);
          this.phase = "hold";
          this.since = ctx.clock.ticks;
        }
        return;
      case "hold":
        if (ctx.clock.ticks - this.since >= HOLD_TICKS && !this.done) {
          this.done = true;
          this.phase = "done";
          this.onDone(ctx);
        }
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    if (this.phase === "video" && this.video.shown >= 0 && !this.video.ended) ctx.surface.drawFullScreen(this.video.pixels);
  }

  exit(ctx: SceneContext): void {
    this.video?.stop(ctx);
  }
}
