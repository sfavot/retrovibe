/**
 * Composition de l'image de *Lure of the Temptress* à partir de l'état du moteur sans tête (`LureEngine`) : la pièce (`room-view.ts`), puis
 * ce qui est posé par-dessus (barre de menus ou menu surgissant, boîte de texte, confirmation), le générique, le curseur ; et la palette
 * avec ses fondus de changement de pièce.
 *
 * Réécriture de `Room::update`, `Room::setRoomNumber` (partie dessin), `Menu::execute`, `PopupMenu::Show`, `Dialog::show`, `Game::getYN` et
 * `Game::doShowCredits` (engines/lure, ScummVM, GPL v3+). Le moteur est lu, jamais modifié, sauf `room.talkDialogHeight` (hauteur de la
 * bulle, dont dépend la détection du pointeur sur la bulle).
 *
 * Fondus : quand la pièce change (`room.changes`), l'image précédente (gardée) s'éteint, puis la nouvelle s'allume, par pas de 20 ms
 * (`palette.ts`). ScummVM bloque pendant ce temps ; l'hôte lit `fading` et suspend alors les ticks du moteur. Pendant un fondu, le curseur
 * est le disque (`Cursor.DISK`).
 *
 * Séquences plein écran (introduction, chute, tonneau, capture, fin) : tant que `engine.sequenceScreen` existe, l'image et la palette sont celles
 * de la séquence (`sequence.ts`) ; pour une séquence de partie, la dernière image de la pièce s'éteint d'abord (`fading`). La dernière image de la
 * séquence devient l'image que le changement de pièce suivant éteint (`lastImage`).
 *
 * Écarts volontaires : l'image est un tampon d'indices 320 x 200 (`output`) avec sa palette RVB de 768 octets (`palette`) ; le curseur y est
 * dessiné (`cursor: false` le laisse à l'hôte) ; le générique est montré avec sa palette, sans le fondu de ScummVM ; la boîte d'information
 * est toujours posée en (69, 61), comme `Dialog::show` (le « Statut » de ScummVM la centre en hauteur) ; la pièce sous une boîte de texte est celle
 * de l'image précédente, comme à l'écran de ScummVM (voir `render`).
 */

import { DiskResId } from "../data/ids";
import type { LureData } from "../data/lure-data";
import { parsePalette } from "../data/palette";
import { decodeScreen, SCREEN_HEIGHT, SCREEN_SIZE, SCREEN_WIDTH } from "../data/picture";
import type { LureEngine } from "../engine/game";
import type { SequenceScreen } from "../engine/sequences/screen";
import { Cursor } from "../engine/ids";
import { drawCursor } from "./cursors";
import { confirmDialog, infoDialog, popupDialog } from "./dialog";
import { drawMenuBar, loadMenuBarImage } from "./menus";
import { drawTalkSelect } from "./talk-select";
import { emptyPalette, fadeInStep, fadeOutStep, FADE_STEP_MS, RES_PALETTE_ENTRIES, roomPalette, rgb768 } from "./palette";
import { RoomView } from "./room-view";
import { SequenceView } from "./sequence";
import { Surface } from "./surface";

export interface RendererOptions {
  /** Dessiner le curseur dans l'image (défaut : oui). */
  cursor?: boolean;
}

/** Identifiant de la palette du générique (`CREDITS_RESOURCE_ID - 1`). */
const CREDITS_PALETTE_ID = DiskResId.credits - 1;

type Phase = "none" | "out" | "in";

export class LureRenderer {
  /** Image présentée : 320 x 200 indices, curseur compris (sauf `cursor: false`). */
  readonly output = new Uint8Array(SCREEN_SIZE);
  /** Palette présentée : 256 entrées RVB de 8 bits (768 octets), fondus compris. */
  readonly palette = new Uint8Array(768);

  private readonly view: RoomView;
  private readonly screen = new Surface(SCREEN_WIDTH, SCREEN_HEIGHT);
  private readonly menuBarImage: Uint8Array;
  private creditsScreen: Uint8Array | null = null;
  private creditsPalette: Uint8Array | null = null;

  private layerIds: readonly number[] | null = null;
  private target: Uint8Array = new Uint8Array(768);
  private seenChanges = 0;
  private phase: Phase = "none";
  private carryMs = 0;
  private readonly lastImage = new Uint8Array(SCREEN_SIZE);
  private lastPalette = new Uint8Array(768);
  private hasLast = false;
  private creditsShown = false;
  /** Dernière pièce dessinée hors boîte de texte (le fond des boîtes, voir `render`). */
  private readonly baseImage = new Uint8Array(SCREEN_SIZE);
  private hasBase = false;
  private readonly sequence = new SequenceView();

  constructor(
    private readonly data: LureData,
    private readonly options: RendererOptions = {},
  ) {
    this.view = new RoomView(data);
    this.menuBarImage = loadMenuBarImage(data);
  }

  /** Un fondu est en cours : l'hôte suspend les ticks du moteur (ScummVM est bloqué dans `paletteFadeIn` et `paletteFadeOut`). */
  get fading(): boolean {
    return this.phase !== "none" || this.sequence.fading;
  }

  /**
   * Compose l'image de `engine` dans `output` et `palette`. `elapsedMs` : temps écoulé depuis l'appel précédent (fait avancer les fondus).
   */
  render(engine: LureEngine, elapsedMs = 0): void {
    const room = engine.room;
    const sequenceScreen = engine.sequenceScreen;
    if (sequenceScreen) {
      this.renderSequence(engine, sequenceScreen, elapsedMs);
      return;
    }
    this.sequence.reset();
    if (room.layers.length === 0) {
      this.output.fill(0);
      this.palette.fill(0);
      return;
    }

    if (this.layerIds !== room.layers) this.enterRoom(engine);
    this.stepFade(elapsedMs);

    if (engine.showingCredits) {
      this.drawCredits();
      return;
    }
    if (this.creditsShown) {
      this.creditsShown = false;
      this.palette.set(this.target);
    }

    if (this.phase === "out") {
      this.output.set(this.lastImage);
      this.drawCursorIfWanted(engine, Cursor.DISK);
      return;
    }

    // ScummVM ne remontre pas la pièce sous une boîte de texte ou une confirmation : `Dialog::show` met la pièce à jour en mémoire (`room.update`)
    // mais ne copie à l'écran que la boîte, qui se pose donc sur l'image de l'image de logique précédente (sans la ligne d'état qui vient
    // d'être posée par le verbe, par exemple) ; la pièce à jour revient à la fermeture.
    if ((engine.dialogText !== null || engine.confirmText !== null) && this.hasBase) {
      this.screen.data.set(this.baseImage);
    } else {
      this.view.draw(engine, this.screen);
      this.baseImage.set(this.screen.data);
      this.hasBase = true;
    }
    this.drawOverlays(engine);
    this.output.set(this.screen.data);
    if (!this.fading) {
      this.lastImage.set(this.output);
      this.lastPalette.set(this.palette);
      this.hasLast = true;
    }
    this.drawCursorIfWanted(engine, this.phase !== "none" ? Cursor.DISK : engine.room.cursor);
  }

  /** Une séquence plein écran : son image et sa palette, le curseur seulement si elle le veut (disque pendant l'extinction de la pièce). */
  private renderSequence(engine: LureEngine, screen: SequenceScreen, elapsedMs: number): void {
    const previous = { image: this.lastImage, palette: this.lastPalette, valid: this.hasLast };
    const own = this.sequence.render(screen, previous, this.output, this.palette, elapsedMs);
    if (own) {
      this.lastImage.set(this.output);
      this.lastPalette.set(this.palette);
      this.hasLast = screen.fadeIntoRoom;
    }
    if (this.options.cursor === false) return;
    if (this.sequence.fading) drawCursor(this.output, SCREEN_WIDTH, SCREEN_HEIGHT, this.data.cursors, Cursor.DISK, engine.mouse.x, engine.mouse.y);
    else if (screen.showCursor) drawCursor(this.output, SCREEN_WIDTH, SCREEN_HEIGHT, this.data.cursors, Cursor.ARROW, engine.mouse.x, engine.mouse.y);
  }

  /** `Room::setRoomNumber` : nouvelle palette ; avec fondu (`room.changes`), l'ancienne image s'éteint d'abord. */
  private enterRoom(engine: LureEngine): void {
    const room = engine.room;
    this.layerIds = room.layers;
    this.target = roomPalette(this.data, room.layers[0]!);
    const fade = room.changes !== this.seenChanges && this.hasLast;
    this.seenChanges = room.changes;
    this.carryMs = 0;
    if (fade) {
      this.palette.set(this.lastPalette);
      this.phase = "out";
    } else {
      this.palette.set(this.target);
      this.phase = "none";
    }
  }

  /** Avance le fondu de `elapsedMs` : un pas toutes les 20 ms ; une phase finie passe à la suivante (sortant, entrant, fini). */
  private stepFade(elapsedMs: number): void {
    if (this.phase === "none") return;
    this.carryMs += elapsedMs;
    while (this.phase !== "none" && this.carryMs >= FADE_STEP_MS) {
      this.carryMs -= FADE_STEP_MS;
      if (this.phase === "out") {
        if (!fadeOutStep(this.palette, 255)) {
          emptyPalette(this.palette, RES_PALETTE_ENTRIES);
          this.phase = "in";
        }
      } else if (!fadeInStep(this.palette, this.target)) {
        this.phase = "none";
      }
    }
  }

  /** Barre de menus, menu surgissant, boîte d'information, confirmation. */
  private drawOverlays(engine: LureEngine): void {
    // Choix du joueur pendant une conversation (posé par le gestionnaire de dialogue dans ScummVM).
    drawTalkSelect(this.data, engine, this.screen);
    const view = engine.menuView;
    if (view?.kind === "bar") {
      drawMenuBar(this.data, this.menuBarImage, engine.menuBar, this.screen, view.menu, view.index);
    } else if (view?.kind === "popup") {
      const { surface, x, y } = popupDialog(this.data, view.entries, view.selected);
      surface.copyTo(this.screen, x, y);
    }
    if (engine.dialogText !== null) {
      const { surface, x, y } = infoDialog(this.data, engine.dialogText, engine.dialogCentered);
      surface.copyTo(this.screen, x, y);
    }
    if (engine.confirmText !== null) {
      const { surface, x, y } = confirmDialog(this.data, engine.confirmText);
      surface.copyTo(this.screen, x, y);
    }
  }

  /** Le générique (`Game::doShowCredits`) : l'écran `0x7800` avec la palette `0x77FF` (les entrées au-delà restent noires). */
  private drawCredits(): void {
    if (!this.creditsScreen) {
      const decoded = decodeScreen(this.data.resources.get(DiskResId.credits));
      this.creditsScreen = new Uint8Array(SCREEN_SIZE);
      this.creditsScreen.set(decoded.subarray(0, SCREEN_SIZE));
      const palette = new Uint8Array(768);
      palette.set(rgb768(parsePalette(this.data.resources.get(CREDITS_PALETTE_ID))).subarray(0, RES_PALETTE_ENTRIES * 3));
      this.creditsPalette = palette;
    }
    this.output.set(this.creditsScreen);
    this.palette.set(this.creditsPalette!);
    this.creditsShown = true;
  }

  /** Curseur : caché pendant les boîtes de texte et le générique, flèche pendant les menus. */
  private drawCursorIfWanted(engine: LureEngine, cursorNum: number): void {
    if (this.options.cursor === false) return;
    if (engine.dialogText !== null || engine.confirmText !== null || engine.showingCredits) return;
    const num = engine.menuView !== null && this.phase === "none" ? Cursor.ARROW : cursorNum;
    drawCursor(this.output, SCREEN_WIDTH, SCREEN_HEIGHT, this.data.cursors, num, engine.mouse.x, engine.mouse.y);
  }
}
