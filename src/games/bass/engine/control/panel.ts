/**
 * Panneau de contrôle dessiné par le jeu (F5) : volume de la musique, vitesse du jeu, effets, texte / voix, « Sauvegarder » et « Restituer »
 * (dialogues du site), « Recommencer » et « Quitter », avec les sprites 60500 à 60510 et la police 60520 d'origine.
 *
 * Référence : ScummVM engines/sky/control.cpp (`Control::doControlPanel`, `initPanel`, `buttonControl`, `drawMainPanel`, `drawTextCross`,
 * `animClick`, `handleClick`, `getYesNo`, `doMusicSlide`, `doSpeedSlide`, `toggleFx`, `toggleText`, `ConResource`, `TextResource`,
 * `ControlStatus`), GPL v3 ou ultérieure, lus puis réécrits. Les parties du remake iOS, de l'aide et de la liste de sauvegardes d'origine ne sont
 * pas portées (D5).
 *
 * Le panneau est une **séquence** (`src/engine/sequence.ts`) : une reprise par tick de 20 ms (`ANIM_DELAY`), pendant laquelle le jeu est figé
 * (`GameControl`). Les entrées du tick lui sont données par `feed` ; rien n'est lu dans l'hôte.
 *
 * Dessin : à chaque reprise le panneau est recomposé en entier dans un tampon de 320 x 200 (panneau, boutons, curseurs, croix, texte d'état,
 * texte du bouton survolé) puis envoyé à l'écran (`PanelDisplay`, `renderControlPanel`). ScummVM ne redessine que ce qui change et restaure le
 * fond sous les textes (`TextResource::_oldScreen`) ; le résultat est le même, sans dépendre de l'ordre des restaurations.
 *
 * Écarts volontaires :
 * - « Sauvegarder » et « Restituer » ouvrent les dialogues du site (`PanelHooks.dialog`) au lieu de la liste de noms tapés ;
 * - « Quitter » ramène à l'écran titre (`PanelHooks.quit`) ; les deux questions (« Recommencer ? », « Quitter ? ») viennent de `copy.ts`
 *   (ScummVM les écrit en anglais dans le code) ;
 * - un clic seul compte même si le relâchement arrive dans le même tick (toucher) ; Échap répond « non » à une question oui / non
 *   (ScummVM n'attend qu'un clic) ;
 * - les réglages modifiés sont signalés à l'hôte (`PanelHooks.changed`) pour être mémorisés (ScummVM : `ConfMan`).
 */

import { type Sequence, wait } from "../../../../engine/sequence";
import { SkyFont } from "../../data/font";
import { SpriteFile } from "../../data/sprite";
import { renderText, TextAlign } from "../../data/text-layout";
import { DATA_FILE_HEADER_SIZE } from "../../data/header";
import { Cursor, SF } from "../ids";
import type { SystemVars } from "../logic";
import type { Mouse } from "../mouse";
import { MouseButton, type BassInput } from "../host";
import { applyTextVoiceMode, type TextVoiceMode } from "../text";
import {
  CROSS_HEIGHT,
  CROSS_IMAGE,
  CROSS_SPEECH_AT,
  CROSS_TEXT_AT,
  CROSS_TRANSPARENT,
  CROSS_WIDTH,
  MPNL_X,
  MPNL_Y,
  MUSIC_SLIDE_BOTTOM,
  MUSIC_SLIDE_TOP,
  NO_ZONE,
  PAN_LINE_WIDTH,
  PANEL_FONT,
  PANEL_TEXT_BASE,
  PANEL_TEXT_COLOR,
  PANEL_TEXT_MAX_Y,
  PanelFile,
  PanelText,
  SPEED_MULTIPLY,
  SPEED_SLIDE_BOTTOM,
  SPEED_SLIDE_TOP,
  STATUS_WIDTH,
  YES_NO_ROW,
  YES_NO_TEXT_COLOR,
  YES_ZONE,
} from "./layout";

export const PANEL_WIDTH = 320;
export const PANEL_HEIGHT = 200;
/** Lignes envoyées à l'écran (`renderControlPanel` : `GAME_SCREEN_HEIGHT`). */
export const PANEL_SHOWN_HEIGHT = 192;
/** Durée d'un bouton enfoncé (`CLICK_DELAY` de 150 ms, en ticks de 20 ms). */
const CLICK_TICKS = 8;

/** Où le panneau est montré : palette 60510 d'abord, puis une image par tick. `null` côté moteur sans image (`NullScreen`). */
export interface PanelDisplay {
  /** Palette du panneau (`Screen::setPalette(60510)`) : 768 octets VGA sur 6 bits. */
  setPalette(vga: Uint8Array): void;
  /** `renderControlPanel` : les 192 premières lignes de `buffer` (320 x 200). */
  show(buffer: Uint8Array): void;
}

/** Réglages du son que le panneau modifie (`BassAudio`) ; absents dans un moteur sans son. */
export interface PanelAudio {
  musicVolume: number;
  fxOff: boolean;
  speechOn: boolean;
}

/** Ce que le panneau demande à `GameControl`. */
export interface PanelHooks {
  /** `loadSaveAllowed` : sauvegarder et restituer sont-ils possibles maintenant ? */
  saveAllowed(): boolean;
  /** Ouvre le dialogue du site et attend sa fermeture : ce qui s'est passé. `unavailable` : l'hôte n'en a pas. */
  dialog(kind: "save" | "restore"): Sequence<"saved" | "restored" | "cancelled" | "unavailable">;
  /** « Recommencer » confirmé (`Control::restartGame`). */
  restart(): void;
  /** « Quitter » confirmé (retour à l'écran titre). */
  quit(): void;
  /** Un réglage a changé : à signaler à l'hôte. */
  changed(): void;
}

export interface PanelOptions {
  loadFile(id: number): Uint8Array;
  /** `Text::getText` : texte du jeu (section 7 pour le panneau). */
  getText(textNum: number): string;
  system: SystemVars;
  mouse: Mouse;
  display: PanelDisplay | null;
  audio: PanelAudio | null;
  hooks: PanelHooks;
  /** Questions oui / non (`copy.ts`). */
  restartQuestion: string;
  quitQuestion: string;
  /** Volume de la musique (0 à 127) à l'ouverture, quand il n'y a pas de service son. */
  musicVolume: () => number;
  setMusicVolume(volume: number): void;
}

/** Action d'une ressource cliquable (`onClick` de `createResource`). */
type Click = "none" | "exit" | "restore" | "save" | "quit" | "restart" | "fx" | "text" | "speed" | "music";

/** `ConResource` : un sprite, ses images, sa place absolue, le texte du jeu qui l'accompagne, son action. */
class Resource {
  constructor(
    readonly sprite: SpriteFile,
    readonly frames: number,
    public cur: number,
    public x: number,
    public y: number,
    readonly text: number,
    readonly click: Click,
  ) {}

  isMouseOver(mx: number, my: number): boolean {
    return mx >= this.x && my >= this.y && mx <= this.x + this.sprite.width && my <= this.y + this.sprite.height;
  }

  draw(buf: Uint8Array, mask: boolean): void {
    const { width, height } = this.sprite;
    const pixels = this.sprite.frame(this.cur);
    for (let row = 0; row < height; row++) {
      const dest = (this.y + row) * PANEL_WIDTH + this.x;
      if (dest < 0 || dest + width > buf.length) continue;
      const src = row * width;
      if (mask) {
        for (let col = 0; col < width; col++) if (pixels[src + col]) buf[dest + col] = pixels[src + col]!;
      } else buf.set(pixels.subarray(src, src + width), dest);
    }
  }
}

/** Texte formé (`DisplayedText`) : sprite sans en-tête de largeur `width`. */
interface TextSprite {
  pixels: Uint8Array;
  width: number;
  height: number;
}

export class ControlPanel {
  private font: SkyFont | null = null;
  private res!: {
    panel: Resource;
    exit: Resource;
    slide: Resource;
    slide2: Resource;
    slode: Resource;
    restore: Resource;
    save: Resource;
    quit: Resource;
    restart: Resource;
    fx: Resource;
    text: Resource;
    bodge: Resource;
    yesNo: Resource;
    look: Resource[];
  };
  private readonly buf = new Uint8Array(PANEL_WIDTH * PANEL_HEIGHT);
  private events: readonly BassInput[] = [];
  private mx = 160;
  private my = 96;
  private clicked = false;
  private held = false;
  private escape = false;
  private quitPanel = false;
  /** Texte du bouton survolé (`_text`, `_curButtonText`) et sa place. */
  private hover: { id: number; sprite: TextSprite } | null = null;
  /** Texte d'état (`ControlStatus`). */
  private status: TextSprite | null = null;
  /** Question oui / non en cours. */
  private question: { sprite: TextSprite; y: number } | null = null;
  private open = false;

  constructor(private readonly options: PanelOptions) {}

  /** Le panneau est ouvert (séquence en cours). */
  get isOpen(): boolean {
    return this.open;
  }

  /** Le panneau a demandé sa fermeture (bouton, Échap, restitution…). */
  close(): void {
    this.quitPanel = true;
  }

  /** Entrées du tick qui vient (`SkyEngine::delay` les transmet au panneau). */
  feed(events: readonly BassInput[]): void {
    this.events = events;
  }

  // --- Ressources ---

  private text(num: number): string {
    return this.options.getText(PANEL_TEXT_BASE + num);
  }

  private makeFont(): SkyFont {
    this.font ??= new SkyFont(this.options.loadFile(60520), PANEL_FONT);
    return this.font;
  }

  /** `displayText` : le texte du jeu `PANEL_TEXT_BASE + num` (ou une chaîne) dans la police du panneau. */
  private formText(text: string, align: TextAlign, width: number, color: number): TextSprite {
    const rendered = renderText(text, this.makeFont(), align, width, color);
    const pixels = rendered.data.subarray(DATA_FILE_HEADER_SIZE, DATA_FILE_HEADER_SIZE + width * rendered.layout.height);
    return { pixels, width, height: rendered.layout.height };
  }

  /** `initPanel` : ressources aux positions de `createResource` (décalage `MPNL_X`, `MPNL_Y`). */
  private init(): void {
    const sprite = (file: number): SpriteFile => new SpriteFile(this.options.loadFile(file));
    const files = {
      panel: sprite(PanelFile.panel),
      button: sprite(PanelFile.button),
      yesNo: sprite(PanelFile.yesNo),
      slide2: sprite(PanelFile.slide2),
      slode2: sprite(PanelFile.slode2),
      bodge: sprite(PanelFile.musicBodge),
    };
    const volY = Math.floor((127 - this.options.musicVolume()) / 4) + 59 - MPNL_Y;
    let spdY = Math.floor((this.options.system.gameSpeed - 2) / SPEED_MULTIPLY);
    spdY += MPNL_Y + 83; // position initiale du curseur de vitesse (ScummVM y ajoute encore `MPNL_Y`)
    const make = (file: SpriteFile, frames: number, cur: number, x: number, y: number, text: number, click: Click): Resource =>
      new Resource(file, frames, cur, x + MPNL_X, y + MPNL_Y, text ? PANEL_TEXT_BASE + text : 0, click);
    const res = {
      panel: make(files.panel, 1, 0, 0, 0, 0, "none"),
      exit: make(files.button, 3, 0, 16, 125, PanelText.exit, "exit"),
      slide: make(files.slide2, 1, 0, 19, spdY, PanelText.speedSlide, "speed"),
      slide2: make(files.slide2, 1, 0, 19, volY, PanelText.musicSlide, "music"),
      slode: make(files.slode2, 1, 0, 9, 49, 0, "none"),
      restore: make(files.button, 3, 0, 58, 19, PanelText.restore, "restore"),
      save: make(files.button, 3, 0, 58, 39, PanelText.save, "save"),
      quit: make(files.button, 3, 0, 58, 59, PanelText.quit, "quit"),
      restart: make(files.button, 3, 0, 58, 79, PanelText.restart, "restart"),
      fx: make(files.button, 3, 0, 58, 99, PanelText.fx, "fx"),
      text: make(files.button, 3, 0, 58, 119, PanelText.textAndSpeech, "text"),
      bodge: make(files.bodge, 2, 1, 98, 115, 0, "none"),
      yesNo: make(files.yesNo, 1, 0, -2, 40, 0, "none"),
    };
    this.res = { ...res, look: [res.exit, res.restore, res.save, res.quit, res.restart, res.fx, res.text, res.slide, res.slide2] };
  }

  // --- Dessin ---

  /** `drawMainPanel` + texte d'état + texte du bouton survolé ou question en cours : l'image du tick. */
  private compose(): void {
    const { buf, res } = this;
    buf.fill(0);
    res.fx.cur = this.options.system.systemFlags & SF.FX_OFF ? 0 : 2;
    res.panel.draw(buf, false);
    for (const button of [res.exit, res.save, res.restore, res.quit, res.restart, res.fx, res.text]) button.draw(buf, false);
    res.slode.draw(buf, true);
    res.slide.draw(buf, true);
    res.slide2.draw(buf, true);
    res.bodge.draw(buf, true);
    this.drawTextCross();
    if (this.status) this.drawText(this.status, 64, 163);
    if (this.question) {
      res.yesNo.draw(buf, true);
      this.drawText(this.question.sprite, MPNL_X + 2, this.question.y);
    } else if (this.hover) {
      this.drawText(this.hover.sprite, this.mx + 12, Math.max(this.my - 16, 0));
    }
  }

  /** `drawTextCross` : `bodge` sans masque, puis une croix sur la voix et / ou le texte désactivés. */
  private drawTextCross(): void {
    const flags = this.options.system.systemFlags;
    this.res.bodge.draw(this.buf, false);
    if (!(flags & SF.ALLOW_SPEECH)) this.drawCross(CROSS_SPEECH_AT.x, CROSS_SPEECH_AT.y);
    if (!(flags & SF.ALLOW_TEXT)) this.drawCross(CROSS_TEXT_AT.x, CROSS_TEXT_AT.y);
  }

  private drawCross(x: number, y: number): void {
    for (let row = 0; row < CROSS_HEIGHT; row++) {
      for (let col = 0; col < CROSS_WIDTH; col++) {
        const pixel = CROSS_IMAGE[row * CROSS_WIDTH + col]!;
        if (pixel !== CROSS_TRANSPARENT) this.buf[(y + row) * PANEL_WIDTH + x + col] = pixel;
      }
    }
  }

  /** `TextResource::drawToScreen` : sprite masqué, rogné à `PAN_LINE_WIDTH`, au bord droit et à `GAME_SCREEN_HEIGHT`. */
  private drawText(text: TextSprite, x: number, y: number): void {
    const width = Math.max(0, Math.min(text.width, PAN_LINE_WIDTH, PANEL_WIDTH - x));
    const height = Math.max(0, Math.min(text.height, PANEL_TEXT_MAX_Y - y));
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const pixel = text.pixels[row * text.width + col]!;
        if (pixel) this.buf[(y + row) * PANEL_WIDTH + x + col] = pixel;
      }
    }
  }

  private render(): void {
    this.compose();
    this.options.display?.show(this.buf);
  }

  /** Image du dernier dessin (tests : comparaison au banc). */
  get image(): Uint8Array {
    return this.buf;
  }

  // --- Entrées ---

  /** Un tick de 20 ms (`delay(ANIM_DELAY)`) : le dessin est envoyé, puis les entrées du tick sont lues. */
  private *pump(): Sequence {
    this.render();
    yield* wait(1);
    this.collect();
  }

  /** `Control::delay` : position du pointeur, clic (appui seul) et maintien du bouton, Échap. */
  private collect(): void {
    const { mouse, system } = this.options;
    this.clicked = false;
    for (const event of this.events) {
      switch (event.type) {
        case "move":
        case "click":
        case "release":
          this.mx = event.x;
          this.my = event.y;
          if (!(system.systemFlags & SF.MOUSE_LOCKED)) mouse.moved(event.x, event.y);
          if (event.type === "click" && event.button === MouseButton.Left) {
            this.clicked = true;
            this.held = true;
          } else if (event.type === "release") this.held = false;
          break;
        case "action":
          if (event.action === "skip") this.escape = true;
          break;
      }
    }
    this.events = [];
  }

  // --- Séquence ---

  /** `doControlPanel` : ouvre le panneau, le fait vivre jusqu'à sa fermeture. L'appelant remet l'écran, le curseur et la police ensuite. */
  *run(): Sequence {
    const { mouse, system, display } = this.options;
    this.open = true;
    try {
      this.init();
      this.quitPanel = false;
      this.escape = false;
      this.held = false;
      this.hover = null;
      this.status = null;
      this.question = null;
      this.mx = mouse.x;
      this.my = mouse.y;
      display?.setPalette(this.options.loadFile(PanelFile.palette));
      mouse.sprite(Cursor.NORMAL, 0, 0);
      this.res.fx.cur = system.systemFlags & SF.FX_OFF ? 0 : 2;

      while (!this.quitPanel) {
        yield* this.pump();
        if (this.quitPanel) break;
        if (this.escape) break;
        yield* this.scan();
      }
    } finally {
      this.open = false;
      this.events = [];
    }
  }

  /** Recherche du bouton sous le pointeur (`_controlPanLookList`) : texte d'aide, puis action au clic. */
  private *scan(): Sequence {
    let over: Resource | null = null;
    for (const button of this.res.look) {
      if (!button.isMouseOver(this.mx, this.my)) continue;
      over = button;
      this.buttonControl(button);
      if (this.clicked && button.click !== "none") {
        yield* this.handleClick(button);
        if (this.quitPanel) return;
      }
      this.clicked = false;
    }
    if (!over) this.buttonControl(null);
  }

  /** `buttonControl` : le texte du jeu du bouton survolé suit le pointeur. */
  private buttonControl(button: Resource | null): void {
    if (!button || !button.text) {
      this.hover = null;
      return;
    }
    if (this.hover?.id !== button.text) {
      this.hover = { id: button.text, sprite: this.formText(this.options.getText(button.text), TextAlign.left, PAN_LINE_WIDTH, PANEL_TEXT_COLOR) };
    }
  }

  /** `animClick` : le bouton reste enfoncé 150 ms. */
  private *animClick(button: Resource): Sequence {
    if (button.cur === button.frames - 1) return;
    button.cur++;
    for (let t = 0; t < CLICK_TICKS; t++) yield* this.pump();
    button.cur--;
  }

  /** `handleClick`. */
  private *handleClick(button: Resource): Sequence {
    const { hooks } = this.options;
    switch (button.click) {
      case "exit":
        yield* this.animClick(button);
        this.quitPanel = true;
        return;
      case "restore":
      case "save": {
        if (!hooks.saveAllowed()) return; // pas de sauvegarde pendant un choix (`loadSaveAllowed`)
        yield* this.animClick(button);
        const kind = button.click === "save" ? "save" : "restore";
        const outcome = yield* hooks.dialog(kind);
        if (outcome === "saved" || outcome === "restored") this.quitPanel = true;
        return;
      }
      case "speed":
        yield* this.dragSpeed();
        return;
      case "music":
        yield* this.dragMusic();
        return;
      case "fx":
        this.toggleFx();
        return;
      case "text":
        yield* this.animClick(button);
        this.toggleText();
        return;
      case "restart":
        yield* this.animClick(button);
        if (yield* this.askYesNo(this.options.restartQuestion)) {
          hooks.restart();
          this.quitPanel = true;
        }
        return;
      case "quit":
        yield* this.animClick(button);
        if (yield* this.askYesNo(this.options.quitQuestion)) {
          hooks.quit();
          this.quitPanel = true;
        }
        return;
      default:
        return;
    }
  }

  // --- Réglages ---

  /** `doSpeedSlide` : le curseur suit le pointeur tant que le bouton est maintenu ; la vitesse est posée au relâchement. */
  private *dragSpeed(): Sequence {
    const slide = this.res.slide;
    const ofsY = slide.y - this.my;
    let speedDelay = (slide.y - SPEED_SLIDE_TOP) * SPEED_MULTIPLY + 2;
    while (this.held) {
      yield* this.pump();
      let newY = ofsY + this.my;
      if (newY < SPEED_SLIDE_TOP) newY = SPEED_SLIDE_TOP;
      if (newY > SPEED_SLIDE_BOTTOM) newY = SPEED_SLIDE_BOTTOM;
      if (newY === 110 || newY === 108) newY = 109; // cran du milieu élargi, comme ScummVM
      if (newY !== slide.y) {
        slide.y = newY;
        speedDelay = (newY - SPEED_SLIDE_TOP) * SPEED_MULTIPLY + 2;
      }
      this.buttonControl(slide);
    }
    this.options.system.gameSpeed = speedDelay;
    this.options.hooks.changed();
  }

  /** `doMusicSlide` : le volume suit le curseur en direct. */
  private *dragMusic(): Sequence {
    const slide = this.res.slide2;
    const ofsY = slide.y - this.my;
    while (this.held) {
      yield* this.pump();
      let newY = ofsY + this.my;
      if (newY < MUSIC_SLIDE_TOP) newY = MUSIC_SLIDE_TOP;
      if (newY > MUSIC_SLIDE_BOTTOM) newY = MUSIC_SLIDE_BOTTOM;
      if (newY !== slide.y) {
        slide.y = newY;
        const step = (newY - MUSIC_SLIDE_TOP) * 4;
        this.options.setMusicVolume(step >= 128 ? 0 : 127 - step);
      }
      this.buttonControl(slide);
    }
    this.options.hooks.changed();
  }

  /** `toggleFx`. */
  private toggleFx(): void {
    const { system, audio, hooks } = this.options;
    system.systemFlags = (system.systemFlags ^ SF.FX_OFF) >>> 0;
    const off = (system.systemFlags & SF.FX_OFF) !== 0;
    if (audio) audio.fxOff = off;
    this.setStatus(off ? PanelText.fxOff : PanelText.fxOn);
    hooks.changed();
  }

  /** `toggleText` : texte seul, puis voix seule, puis texte et voix. */
  private toggleText(): void {
    const { system, audio, hooks } = this.options;
    const flags = system.systemFlags & (SF.ALLOW_TEXT | SF.ALLOW_SPEECH);
    let next: TextVoiceMode;
    let message: number;
    if (flags === SF.ALLOW_TEXT) {
      next = "voice";
      message = PanelText.speechOnly;
    } else if (flags === SF.ALLOW_SPEECH) {
      next = "both";
      message = PanelText.textAndSpeech;
    } else {
      next = "text";
      message = PanelText.textOnly;
    }
    applyTextVoiceMode(system, next, audio ?? undefined);
    this.setStatus(message);
    hooks.changed();
  }

  /** `ControlStatus::setToText` : le texte d'état, centré. */
  private setStatus(textNum: number): void {
    this.status = this.formText(this.text(textNum), TextAlign.center, STATUS_WIDTH, PANEL_TEXT_COLOR);
  }

  // --- Question oui / non ---

  /** `getYesNo` : la question dans le cadre oui / non ; le curseur devient une croix sur une réponse. */
  private *askYesNo(question: string): Sequence<boolean> {
    const { mouse } = this.options;
    const width = this.res.yesNo.sprite.width - 8;
    const sprite = this.formText(question, TextAlign.center, width, YES_NO_TEXT_COLOR);
    this.question = { sprite, y: MPNL_Y + 44 + ((28 - sprite.height) >> 1) };
    this.hover = null;
    this.clicked = false;
    this.escape = false;
    let answer: boolean | null = null;
    let cursor: number = Cursor.NORMAL;
    mouse.sprite(cursor, 0, 0);
    while (answer === null) {
      yield* this.pump();
      let want: number = Cursor.NORMAL;
      if (this.my >= YES_NO_ROW.top && this.my <= YES_NO_ROW.bottom) {
        if (this.mx >= YES_ZONE.left && this.mx <= YES_ZONE.right) {
          want = Cursor.CROSS;
          if (this.clicked) answer = true;
        } else if (this.mx >= NO_ZONE.left && this.mx <= NO_ZONE.right) {
          want = Cursor.CROSS;
          if (this.clicked) answer = false;
        }
      }
      if (this.escape) answer = false;
      if (want !== cursor) {
        cursor = want;
        mouse.sprite(cursor, 0, 0);
      }
    }
    this.question = null;
    this.escape = false;
    this.clicked = false;
    mouse.sprite(Cursor.NORMAL, 0, 0);
    return answer;
  }
}
