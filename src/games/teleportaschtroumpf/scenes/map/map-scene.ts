import type { Hy8 } from "../../data/hy8";
import type { Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import { TICKS_PER_SECOND } from "../../engine/clock";
import { SWIPE_MIN, type Input } from "../../engine/input";
import { insideArea, type MenuArea } from "../../engine/menu";
import { voiceName } from "../../engine/paths";
import type { Scene, SceneContext } from "../../engine/scene";
import { boundsOf, placeSprite } from "../../engine/sprites";
import { VoiceLine } from "../board/voices";
import { MapImage } from "./image";
import {
  K_BACK,
  K_FIRST_LOCATION,
  SCROLL_STEP,
  VIEW_ROWS,
  VIEW_TOP,
  cellOfK,
  locationAnchors,
  locationAt,
  moveSelection,
  sceneOfK,
  scrollOfK,
  scrolled,
  type LocationAnchor,
} from "./view";

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

/** Bandeau « Retour » du cadre de consultation (`s02a002d`, mesuré : pixels qui diffèrent de `s02a001d`), élargi pour le doigt. */
export const BACK_BUTTON: MenuArea = { x0: 112, y0: 173, x1: 207, y1: 199 };

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
  /** Doigt : ancres des lieux (`locationAt`). */
  private anchors: LocationAnchor[] = [];
  /** Doigt posé : sa hauteur et le décalage au posé ; `moved` une fois `SWIPE_MIN` dépassé (la carte suit alors le doigt). */
  private drag: { y: number; scroll: number; moved: boolean } | null = null;
  /** Le dernier glissement a fait défiler la carte en direct : son geste au relâchement ne la refait pas défiler. */
  private dragged = false;

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
    const sprites = this.sprites;
    this.anchors = locationAnchors((sprite) => boundsOf(placeSprite(sprites, sprite, false)));
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
    this.drag = null;
    this.dragged = false;
  }

  private placeSelection(): void {
    this.scroll = scrollOfK(this.k);
    this.image!.setMarker(this.sprites!, cellOfK(this.k));
  }

  update(ctx: SceneContext): void {
    if (ctx.fade.active || this.phase === "done") return;
    const { input } = ctx;
    if (this.phase === "voice") {
      // Au doigt, la voix d'aide se coupe d'un geste (le doigt qui se pose ne compte pas : son geste suit).
      const skip = input.validateNotTouch || input.touchGesture !== null;
      if (this.line!.update(ctx, this.skippable && skip)) this.phase = "browse";
      return;
    }
    if (this.request.mode === "consult") this.scrollView(ctx);
    else this.moveMarker(ctx);
    if (this.request.mode === "wish" && this.timers(ctx)) return;
    if (this.touch(ctx)) return;
    // Le doigt qui se pose envoie aussi « valider » : ignoré, son geste décide (`touch`).
    if (input.validateNotTouch) this.finish(ctx, this.k);
    else if (this.request.mode === "free" && input.justPressed("cancel")) this.help(ctx);
  }

  /**
   * Ajout du port, doigt (l'original n'a que le clavier) : glisser verticalement fait défiler la carte dans tous les modes ;
   * consultation : toucher le bandeau « Retour » sort ; sélection : toucher un lieu y va, l'appui long dit sa voix d'aide (mode
   * libre seul, comme Entrée). Un toucher ailleurs ne fait rien. Renvoie vrai si la carte est sortie ou parle.
   */
  private touch(ctx: SceneContext): boolean {
    const { input } = ctx;
    const gesture = input.touchGesture;
    if (gesture?.kind === "swipe") {
      // Glissement trop bref pour avoir été suivi image par image : il fait défiler d'un coup.
      if (!this.dragged) this.scroll = scrolled(this.scroll, -gesture.dy);
      this.dragged = false;
    }
    this.follow(input);
    if (!gesture || gesture.kind === "swipe") return false;
    if (this.request.mode === "consult") {
      if (gesture.kind !== "tap" || !insideArea(BACK_BUTTON, gesture.x, gesture.y)) return false;
      this.finish(ctx, K_BACK);
      return true;
    }
    const k = this.locationAt(gesture.x, gesture.y);
    if (k === null) return false;
    if (gesture.kind === "tap") {
      this.mark(k);
      this.finish(ctx, k);
      return true;
    }
    if (this.request.mode !== "free") return false;
    this.mark(k);
    this.help(ctx);
    return this.phase === "voice";
  }

  /** Doigt tenu : au-delà de `SWIPE_MIN` pixels de glissement vertical, la carte suit le doigt. */
  private follow(input: Input): void {
    const held = input.touchHeldAt;
    if (!held) {
      this.drag = null;
      return;
    }
    if (!this.drag) {
      this.drag = { y: held.y, scroll: this.scroll, moved: false };
      this.dragged = false;
      return;
    }
    const dy = held.y - this.drag.y;
    if (!this.drag.moved && Math.abs(dy) < SWIPE_MIN) return;
    this.drag.moved = this.dragged = true;
    this.scroll = scrolled(this.drag.scroll, -dy);
  }

  /** Lieu touché en (x, y) de l'écran (fenêtre de la carte seulement), selon le mode ; `null` hors d'un lieu. */
  private locationAt(x: number, y: number): number | null {
    if (y < VIEW_TOP || y >= VIEW_TOP + VIEW_ROWS) return null;
    const min = this.request.mode === "wish" ? K_FIRST_LOCATION : K_BACK;
    return locationAt(this.anchors, x, y - VIEW_TOP + this.scroll, min);
  }

  /** Sélection posée au doigt : le marqueur va sur le lieu, la fenêtre ne bouge pas sous le doigt. */
  private mark(k: number): void {
    this.k = k;
    this.image!.setMarker(this.sprites!, cellOfK(k));
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
    // Bruitage mélangé `348d:0b42` : le bip n'est lancé que si aucun bruitage ne sonne.
    if (this.beep && !ctx.voice.effectPlaying) ctx.voice.playEffect(this.beep);
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
