/**
 * Scène du moteur réel (vague G2, `docs/fotaq/engine.md`, § 11) : implémente `Stage` (`services.ts`) avec les bobs, la marche, Joe,
 * les personnages et la caméra, **sans dessin** : l'état des bobs (`bobs.sorted`, `bobs.frames`, `horizontalScroll`) est ce que la
 * vague R lit pour composer l'image. Remplace `StubStage` dans le moteur.
 *
 * Correspondance avec ScummVM (engines/queen) : `setupRoom` = partie graphique de `Logic::setupRoom` ; `eraseRoom` = banques et
 * animations de `Logic::eraseRoom` ; `frame` = `Graphics::update` (tri des bobs, caméra, parallaxe) ; `moveJoe`, `stopJoe` = `Walk`.
 * Le reste est dans `bobs.ts`, `room-graphics.ts`, `actors.ts`, `joe.ts`, `walk.ts` et `camera.ts`.
 *
 * Vague R : le dessin est dans `render/` (`Renderer`, `Display`, `Palette`) ; cette classe le branche : `setupRoom` charge le décor,
 * le panneau et la lumière, `fadeOut` / `fadeIn` sont les fondus de palette (séquences de `FADE_TICKS` images), `setOutfit` change
 * la palette de Joe, `frame` fait tourner les couleurs et met à jour la lumière dynamique (`Display::update`), `render` compose
 * l'image et la présente à l'hôte. `eraseRoom` fige l'image : le fondu de sortie la montre encore alors que la table d'images est
 * déjà vide (comme ScummVM, où l'écran garde ses pixels). Les vagues T, C et L règlent les textes, le mode d'écran et le curseur
 * par `display` (`setText`, `fullscreen`, `cursorVisible`…) et `setBobText`.
 *
 * Écart : la position de Joe dans l'état (`g.state.joe`) est recopiée du bob 0 à chaque image.
 */

import { type Sequence, wait } from "../../../engine/sequence";
import { FADE_SPEED, FADE_TICKS } from "../render/palette";
import { Renderer, type RendererOptions } from "../render/renderer";
import { Bobs } from "./bobs";
import { Actors } from "./actors";
import { handleParallax, type RoomUpdate, scrollFor, SCREEN_WIDTH } from "./camera";
import { Joe } from "./joe";
import type { FotaqEngine } from "./loop";
import { roomBackdrop, roomName } from "./room";
import { RoomGraphics, ROOM_BANK_SLOT } from "./room-graphics";
import { Outfit, type Stage } from "./services";
import type { Direction, Grab } from "./state";
import { BamScene } from "./specials/bam";
import { Walk } from "./walk";

/** Emplacements des banques des personnes, fermés à la sortie d'une pièce (`Logic::eraseRoom`). */
const PERSON_BANK_SLOTS = [11, 10, 12];

/** Mode d'écran de la pièce affichée, pour la vague R (`Display::screenMode`). */
export interface ScreenMode {
  /** Panneau de commande : 0 plein écran, 1 panneau en bas, 2 panneau sans les verbes (`comPanel`). */
  comPanel: number;
  inCutaway: boolean;
}

export interface GameStageOptions {
  /** Options du rendu (curseur dessiné dans l'image ou laissé à l'hôte). */
  render?: RendererOptions;
  /** Un bob joue l'effet sonore de la pièce (`Sound::playSfx(currentRoomSfx)`) : numéro de l'effet. */
  onSfx?: (sfx: number) => void;
}

export class GameStage implements Stage {
  readonly bobs = new Bobs();
  readonly joe = new Joe(this.bobs);
  readonly walk = new Walk(this.bobs, this.joe);
  readonly actors = new Actors(this.bobs);
  readonly rooms = new RoomGraphics(this.bobs, this.actors);
  /** Animations propres à une pièce, par numéro (course de voiture, combat final : vague L). */
  readonly roomUpdates = new Map<number, RoomUpdate>();
  /** Animation de la course de voiture et du combat final (`BamScene`, `specials/bam.ts`) ; l'état est ici pour survivre aux pièces. */
  readonly bam = new BamScene();
  /** Tenue de Joe. */
  outfit: Outfit = Outfit.Normal;
  /** Rendu : décor, palettes, textes, panneau (vague R). */
  readonly renderer: Renderer;
  screenMode: ScreenMode = { comPanel: 1, inCutaway: false };
  /** Largeur du décor de la pièce (320 ou 640 : la caméra ne défile que si elle dépasse 320). */
  backdropWidth = SCREEN_WIDTH;
  /** Images de logique écoulées. */
  frames = 0;

  /** L'écran (décor, panneau, textes, palette) : les vagues T, C et L y posent leurs textes et règlent le mode d'écran. */
  get display() {
    return this.renderer.display;
  }

  constructor(private readonly options: GameStageOptions = {}) {
    this.renderer = new Renderer(options.render);
    this.bobs.onSfx = () => this.playRoomSfx();
  }

  /** `Sound::playSfx(currentRoomSfx())` : l'effet de la pièce (animations > 500 des bobs, des répliques et des cinématiques). */
  playRoomSfx(): void {
    this.options.onSfx?.(this.sfx);
  }

  /** Numéro de l'effet sonore de la pièce courante. */
  private sfx = 0;

  setupRoom(g: FotaqEngine, room: number, comPanel: number, inCutaway: boolean, furniture: number[]): void {
    const { data } = g;
    this.renderer.setupPanel(g.host, this.bobs.frames);
    this.backdropWidth = this.renderer.setupRoom(g.host, roomBackdrop(data, room), roomName(data, room), g.state.room);
    this.display.screenMode(comPanel, inCutaway);
    this.screenMode = { comPanel, inCutaway };
    this.sfx = data.jas.roomSfx[g.state.room] ?? 0;
    this.rooms.setupNewRoom(g, roomName(data, room), g.state.room, furniture);
  }

  eraseRoom(): void {
    this.bobs.frames.eraseFrames(false);
    this.bobs.frames.close(ROOM_BANK_SLOT);
    for (const slot of PERSON_BANK_SLOTS) this.bobs.frames.close(slot);
    this.actors.clearPersonFrames();
    this.actors.eraseAllAnims();
    this.display.frozen = true;
  }

  /** `Display::palFadeOut` : la palette de l'écran descend à zéro en `FADE_TICKS` images (tout de suite dans les pièces d'introduction). */
  *fadeOut(g: FotaqEngine): Sequence {
    const palette = this.display.palette;
    const { colors, from } = palette.beginFadeOut(g.state.room);
    if (!from) return;
    for (let step = FADE_TICKS - 1; step >= 0; step--) {
      palette.setFadeOut(colors, from, (step * FADE_SPEED) / FADE_TICKS);
      yield* wait(1);
    }
  }

  /** `Display::palFadeIn` : la palette de la pièce monte de zéro à son niveau en `FADE_TICKS` images (tout de suite dans les pièces d'introduction). */
  *fadeIn(g: FotaqEngine): Sequence {
    const palette = this.display.palette;
    const joe = this.bobs.bob(0);
    if (!palette.beginFadeIn(g.state.room, joe).fades) return;
    for (let step = 1; step <= FADE_TICKS; step++) {
      palette.setFadeIn((step * FADE_SPEED) / FADE_TICKS);
      yield* wait(1);
    }
    palette.endFadeIn();
  }

  placeJoe(g: FotaqEngine): void {
    this.joe.place(g);
  }

  /** Une image des bobs (`Graphics::update`) : animation, déplacement, tri, caméra, parallaxe ; la position de Joe suit son bob. */
  frame(g: FotaqEngine): void {
    this.frames++;
    this.bobs.sortBobs();
    if (this.bobs.cameraBob >= 0) g.horizontalScroll = scrollFor(this.bobs.bob(this.bobs.cameraBob).x, this.backdropWidth);
    handleParallax(g, this.bobs, g.state.room, this.roomUpdates);
    this.syncJoe(g);
    // `QueenEngine::update` : les couleurs qui tournent, puis la lumière dynamique d'après la position de Joe (`Display::update`).
    const palette = this.display.palette;
    palette.cycle(g.state.room);
    const joe = this.bobs.bob(0);
    if (palette.scrollable && joe.active) palette.dynalumUpdate(joe.x, joe.y);
  }

  private syncJoe(g: FotaqEngine): void {
    const bob = this.bobs.bob(0);
    if (!bob.active) return;
    g.state.joe.x = bob.x;
    g.state.joe.y = bob.y;
  }

  *moveJoe(g: FotaqEngine, facing: Direction, x: number, y: number, inCutaway: boolean): Sequence<number> {
    const result = yield* this.walk.moveJoe(g, facing, x, y, inCutaway);
    this.syncJoe(g);
    return result;
  }

  stopJoe(): void {
    this.walk.stopJoe();
  }

  *joeFace(g: FotaqEngine): Sequence {
    yield* this.joe.face(g);
  }

  *joeGrab(g: FotaqEngine, grab: Grab): Sequence {
    yield* this.joe.grab(g, grab);
  }

  refreshObject(g: FotaqEngine, object: number): void {
    this.rooms.refreshObject(g, object);
  }

  /** Le bob de l'objet est éteint (`Graphics::clearBob(findBob(object))`) ; ScummVM éteindrait Joe si l'objet n'avait pas de bob. */
  clearObjectBob(g: FotaqEngine, object: number): void {
    const bob = this.bobs.findBob(g, object);
    if (bob > 0) this.bobs.clearBob(bob);
  }

  setOutfit(_g: FotaqEngine, outfit: Outfit): void {
    this.outfit = outfit;
    this.joe.loadBanks(outfit);
    if (outfit === Outfit.Dress) this.display.palette.setJoeDress();
    else this.display.palette.setJoeNormal();
  }

  /** Compose l'image (`Renderer`) et la présente à l'hôte avec la palette montrée. */
  render(g: FotaqEngine): void {
    this.renderer.render(g, this.bobs.sorted, this.bobs.frames, this.rooms.pasteDowns);
    g.host.present(this.renderer.output, this.display.palette.shown);
  }

  /**
   * `Graphics::setBobText` : texte dit par le bob `bobNumber` (`flags` 0 : au-dessus de lui ; 1 : en `(textX, textY)` ; 2 : centré à
   * `textY`), posé dans la liste de textes de l'écran ; `color` : indice de palette.
   */
  setBobText(g: FotaqEngine, bobNumber: number, text: string, color: number, flags = 0, textX = 0, textY = 0): void {
    const bob = this.bobs.bob(bobNumber);
    const ref = this.bobs.frames.frame(bob.frameNum);
    const frame = ref ? this.renderer.bankFrame(g.host, ref.bank, ref.image) : undefined;
    const anchor = frame ? { x: bob.x, y: bob.y, scale: bob.scale, frameWidth: frame.width, frameHeight: frame.height } : null;
    this.display.setBobText(anchor, g.horizontalScroll, text, textX, textY, color, flags);
  }
}

/** La scène réelle du moteur : les répliques et les cinématiques (vagues T et C) lisent et règlent ses bobs, son écran et sa marche. */
export function requireGameStage(g: FotaqEngine): GameStage {
  if (!(g.stage instanceof GameStage)) throw new Error("les répliques et les cinématiques demandent la scène réelle (GameStage)");
  return g.stage;
}
