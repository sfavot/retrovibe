import { voiceName } from "../../engine/paths";
import type { Scene, SceneContext } from "../../engine/scene";
import { VideoBackdrop, VideoScene } from "../../engine/video";
import { VoiceLine } from "../board/voices";

/** Une vidéo d'une séquence, passable (Échap, Espace, clic) ou non. */
export interface Clip {
  file: string;
  skippable: boolean;
}

/**
 * Enchaîne des vidéos MUX dans une seule scène : la première se charge pendant le fondu d'entrée de la scène (comme une
 * `VideoScene` seule), les suivantes pendant l'écran figé entre deux clips. Fondu au noir à la fin de la dernière seulement
 * (sauf `fadeOut: false`).
 * `plan` est appelé au chargement, ce qui permet de tirer les clips au hasard avec `ctx.rng`. Avec `overlay`, toutes les
 * vidéos sont en surimpression sur l'écran d'avant la séquence (`154c:097b` : `13fc:0002(+1)` puis `0x1040` / `0x1c40`) ;
 * `fadeOut: false` rend la main sur la dernière image, sans fondu.
 */
export class ClipSequence implements Scene {
  readonly step = 1;
  private clips: Clip[] = [];
  private index = 0;
  private current!: VideoScene;
  private ended = false;
  /** Clip suivant en cours de chargement (`ready` vrai une fois lu). */
  private next: { scene: VideoScene; ready: boolean } | null = null;
  private readonly backdrop: VideoBackdrop | undefined;
  private readonly fadeOut: boolean;

  constructor(
    private readonly plan: (ctx: SceneContext) => Clip[],
    private readonly onDone: (ctx: SceneContext) => void,
    options: { overlay?: boolean; fadeOut?: boolean } = {},
  ) {
    this.backdrop = options.overlay ? new VideoBackdrop() : undefined;
    this.fadeOut = options.fadeOut ?? true;
  }

  async load(ctx: SceneContext): Promise<void> {
    this.clips = this.plan(ctx);
    this.index = 0;
    this.current = this.create(0);
    await this.current.load(ctx);
  }

  enter(ctx: SceneContext): void {
    this.backdrop?.capture(ctx);
    this.ended = false;
    this.current.enter(ctx);
  }

  update(ctx: SceneContext): void {
    if (this.next) {
      if (!this.next.ready) return;
      this.current = this.next.scene;
      this.next = null;
      this.ended = false;
      this.current.enter(ctx);
      return;
    }
    this.current.update(ctx);
    if (!this.ended) return;
    this.current.exit(ctx);
    if (this.index + 1 >= this.clips.length) {
      this.ended = false;
      this.onDone(ctx);
      return;
    }
    this.index++;
    const scene = this.create(this.index);
    const pending = { scene, ready: false };
    this.next = pending;
    scene.load(ctx).then(
      () => (pending.ready = true),
      () => (pending.ready = true),
    );
  }

  render(ctx: SceneContext): void {
    this.current.render(ctx);
  }

  exit(ctx: SceneContext): void {
    if (!this.ended) this.current.exit(ctx);
  }

  private create(index: number): VideoScene {
    const clip = this.clips[index];
    return new VideoScene({
      file: clip.file,
      skippable: clip.skippable,
      fadeOutAtEnd: this.fadeOut && index === this.clips.length - 1,
      backdrop: this.backdrop,
      onEnd: () => {
        this.ended = true;
      },
    });
  }
}

/** Une réplique parlée (`s42vNNNt.voc`) par-dessus le plateau, qu'un clic coupe (`1f33:03a7(1)`). Ne dessine rien. */
export class CommentVoiceScene implements Scene {
  readonly step = 1;
  private line: VoiceLine | null = null;
  private done = false;

  constructor(
    private readonly code: number,
    private readonly onDone: (ctx: SceneContext) => void,
  ) {}

  enter(ctx: SceneContext): void {
    this.line = new VoiceLine(ctx, voiceName("s42v", this.code));
    this.done = false;
  }

  update(ctx: SceneContext): void {
    if (this.done) return;
    if (!this.line!.update(ctx, ctx.input.justPressed("validate"))) return;
    this.done = true;
    this.onDone(ctx);
  }

  render(): void {}
}
