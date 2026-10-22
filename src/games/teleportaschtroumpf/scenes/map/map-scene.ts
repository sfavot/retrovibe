import type { Hy8 } from "../../data/hy8";
import type { Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import { TICKS_PER_SECOND } from "../../engine/clock";
import { voiceName } from "../../engine/paths";
import type { Scene, SceneContext } from "../../engine/scene";
import { VoiceLine } from "../board/voices";
import { MapImage } from "./image";
import { K_BACK, K_FIRST_LOCATION, SCROLL_STEP, cellOfK, moveSelection, sceneOfK, scrollOfK, scrolled } from "./view";

/**
 * Carte S02 (`1a3c:0225`) : fond défilant, marqueur, navigation. Voir `scenes/s02-map.ts` pour le contrat et
 * `docs/teleportaschtroumpf/screens-map.md` pour la RE.
 */
export type MapMode = "consult" | "free" | "wish";

export interface MapRequest {
  mode: MapMode;
  /** Mode `consult` : indice de zone 1..54 du pion. */
  zone?: number;
}

/** Secondes avant l'encouragement du puits (`1f33:019a(2) > 0xF`) et avant la sortie d'office (`> 0x23`), mode `wish`. */
const HINT_SECONDS = 16;
const TIMEOUT_SECONDS = 36;
/** Première voix d'encouragement du puits : `s13b` + 0x15 + `rand × 3`. */
const HINT_VOICE = 0x15;

type Phase = "browse" | "voice" | "done";

export class MapScene implements Scene {
  readonly step = 3;

  private frame: Mcg | null = null;
  private image: MapImage | null = null;
  private sprites: Hy8 | null = null;
  private beep: Voc | null = null;

  private phase: Phase = "browse";
  private k: number;
  private scroll = 0;
  private line: VoiceLine | null = null;
  /** La voix en cours peut être coupée par Espace (aide) ; celle du puits va jusqu'au bout. */
  private skippable = false;
  private start = 0;
  private hinted = false;

  constructor(
    private readonly request: MapRequest,
    private readonly onDone: (ctx: SceneContext, k: number) => void,
  ) {
    // `1a3c:002a` démarre sur « retour » (k = 1), `1a3c:0003` (puits) sur le premier lieu.
    this.k = request.mode === "wish" ? K_FIRST_LOCATION : K_BACK;
  }

  /** Lieu sélectionné (mode `free` et `wish`). */
  get selection(): number {
    return this.k;
  }

  /** Décalage vertical de la fenêtre sur le fond (0..311). */
  get scrollOffset(): number {
    return this.scroll;
  }

  get stage(): Phase {
    return this.phase;
  }

  /** Pixel du fond défilant, marqueur compris (pour les tests). */
  mapPixel(x: number, y: number): number {
    return this.image!.pixel(x, y);
  }

  async load(ctx: SceneContext): Promise<void> {
    [this.frame, this.image, this.sprites, this.beep] = await Promise.all([
      ctx.resources.mcg(this.frameFile()),
      MapImage.load(ctx),
      ctx.resources.hy8("s02a000s.hy8"),
      ctx.resources.voc("s07a001b.voc"),
    ]);
  }

  /** Fond du cadre : `s02a002d` (« Retour ») en consultation, `s02a007d` pour le puits (`DS:6EB3`), `s02a001d` en mode libre. */
  private frameFile(): string {
    switch (this.request.mode) {
      case "consult":
        return "s02a002d.mcg";
      case "wish":
        return "s02a007d.mcg";
      case "free":
        return "s02a001d.mcg";
    }
  }

  enter(ctx: SceneContext): void {
    this.begin(ctx);
    ctx.fade.blackout();
    ctx.fade.in();
  }

  /** Retour d'un mini-jeu (mode libre) : la carte revient telle qu'elle était, sur le même lieu. */
  resume(ctx: SceneContext): void {
    this.begin(ctx);
  }

  /** Redessine le cadre et replace fenêtre et marqueur (au premier affichage de la boucle de `1a3c:0225`). */
  private begin(ctx: SceneContext): void {
    const frame = this.frame!;
    ctx.palette.load(frame.palette);
    ctx.surface.drawMcg(frame, { asBackground: true });
    if (this.request.mode === "consult") {
      // `param_3 = 0` : la fenêtre part du haut du fond ; seul le marqueur de la zone du pion est posé.
      this.scroll = 0;
      this.image!.setMarker(this.sprites!, this.request.zone ?? 0);
    } else {
      this.placeSelection();
    }
    this.phase = "browse";
    this.line = null;
    this.start = ctx.clock.ticks;
  }

  private placeSelection(): void {
    this.scroll = scrollOfK(this.k);
    this.image!.setMarker(this.sprites!, cellOfK(this.k));
  }

  update(ctx: SceneContext): void {
    if (ctx.fade.active || this.phase === "done") return;
    if (this.phase === "voice") {
      if (this.line!.update(ctx, this.skippable && ctx.input.justPressed("validate"))) this.phase = "browse";
      return;
    }
    if (this.request.mode === "consult") this.scrollView(ctx);
    else this.moveMarker(ctx);
    if (this.request.mode === "wish" && this.timers(ctx)) return;
    if (ctx.input.justPressed("validate")) this.finish(ctx, this.k);
    else if (this.request.mode === "free" && ctx.input.justPressed("cancel")) this.help(ctx);
  }

  /** Consultation : haut / bas tenus font défiler de 5 pixels par image. */
  private scrollView(ctx: SceneContext): void {
    if (ctx.input.pressed("up")) this.scroll = scrolled(this.scroll, -SCROLL_STEP);
    if (ctx.input.pressed("down")) this.scroll = scrolled(this.scroll, SCROLL_STEP);
  }

  /** Sélection : haut = lieu suivant, bas = lieu précédent ; un changement fait défiler la carte d'un coup et joue le bip. */
  private moveMarker(ctx: SceneContext): void {
    const min = this.request.mode === "wish" ? K_FIRST_LOCATION : K_BACK;
    let k = this.k;
    if (ctx.input.justPressed("up")) k = moveSelection(k, 1, min);
    if (ctx.input.justPressed("down")) k = moveSelection(k, -1, min);
    if (k === this.k) return;
    this.k = k;
    this.placeSelection();
    // Le bip n'est lancé que si aucun son n'est en cours (`348d:0b42`).
    if (this.beep && !ctx.voice.voicePlaying) ctx.voice.play(this.beep);
  }

  /** Puits : voix d'encouragement à 16 s (une fois, 1 chance sur 3) ; à 36 s la carte rend « retour » d'office. */
  private timers(ctx: SceneContext): boolean {
    const seconds = (ctx.clock.ticks - this.start) / TICKS_PER_SECOND;
    if (!this.hinted && seconds >= HINT_SECONDS) {
      this.hinted = true;
      if (ctx.rng.below(3) === 0) {
        ctx.voice.stop();
        this.speak(ctx, voiceName("s13b", HINT_VOICE + ctx.rng.below(3)), false);
        return true;
      }
    }
    if (seconds >= TIMEOUT_SECONDS) {
      this.finish(ctx, K_BACK);
      return true;
    }
    return false;
  }

  /** Clic droit / Entrée (mode libre) : voix d'aide `s45v` du lieu (`DS:15E0[k]`) ; rien sur « retour » (entrée 0 de la table). */
  private help(ctx: SceneContext): void {
    const scene = sceneOfK(this.k);
    if (scene === undefined) return;
    ctx.voice.stop();
    this.speak(ctx, voiceName("s45v", scene), true);
  }

  private speak(ctx: SceneContext, file: string, skippable: boolean): void {
    this.line = new VoiceLine(ctx, file);
    this.skippable = skippable;
    this.phase = "voice";
  }

  /** Sortie : le son est coupé (`15f9:089f` 0x400000), le choix est rendu à l'appelant. */
  private finish(ctx: SceneContext, k: number): void {
    this.phase = "done";
    ctx.voice.stop();
    this.onDone(ctx, k);
  }

  render(ctx: SceneContext): void {
    ctx.surface.restoreBackground();
    this.image!.copyWindow(ctx.surface.work, this.scroll);
  }
}
