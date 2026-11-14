/**
 * Gestionnaire de textes du jeu (`BassText`) : `Text::lowTextManager`, `fnSetFont`, `fnTextModule`, `fnPointerText`, `logicCursor`, plus les
 * modes texte / voix du panneau de contrôle.
 *
 * Référence : ScummVM engines/sky/text.cpp (`Text::lowTextManager`, `displayText`, `fnSetFont`, `fnTextModule`, `fnPointerText`,
 * `logicCursor`, `changeTextSpriteColor`) et sky.cpp (`SF_ALLOW_TEXT`, `SF_ALLOW_SPEECH`), GPL v3 ou ultérieure ; lu puis réécrit. Le
 * décodage (Huffman, rustines), les polices et la mise en page sont dans `data/` ; ce module les relie aux compacts de texte
 * (`CPT_TEXT_1` à `CPT_TEXT_11`, compacts 23 à 33) et aux emplacements `_itemList` 274 à 284 où ScummVM range les sprites de texte.
 *
 * Construction : le moteur crée ce service par défaut, une fois ses compacts, son cache d'objets et ses variables construits ; pour en injecter
 * un autre, `BassEngineOptions.text` accepte une fabrique `(engine) => BassText`.
 *
 * Écarts volontaires :
 * - langue fixée à la construction (français par défaut, D4) ; les polices sont chargées à la demande ;
 * - plus de 11 textes à l'écran en même temps : ScummVM sortirait de la plage des compacts de texte (écriture dans un compact étranger) ;
 *   ici le dernier compact de texte est réutilisé et le fait est journalisé ;
 * - `numLetters` (durée d'une réplique sans voix) vient de `layoutText` (`TextLayout.numLetters`) ;
 * - une police ou un texte invalide lève une erreur (ScummVM lirait au-delà de ses tampons).
 */

import { CompactField as F } from "../data/compact-fields";
import type { SkyDisk } from "../data/disk";
import { FONT_SPECS, SkyFont } from "../data/font";
import { LANGUAGE_FRENCH } from "../data/ids";
import { changeTextSpriteColor, renderText, TextAlign } from "../data/text-layout";
import { SkyTexts } from "../data/text";
import type { Compacts, CompactView } from "./compacts";
import type { ItemCache } from "./files";
import { Cpt, FIRST_TEXT_COMPACT, L, SF, ST, TOP_LEFT_X, TOP_LEFT_Y, Var } from "./ids";
import type { BassText, DisplayedText } from "./services";
import type { ScriptVars } from "./vars";

/** `FIRST_TEXT_BUFFER` : premier emplacement de `_itemList` des sprites de texte. */
export const FIRST_TEXT_BUFFER = 274;
/** Nombre de compacts de texte (`CPT_TEXT_1` à `CPT_TEXT_11`). */
export const TEXT_COMPACT_COUNT = Cpt.TEXT_11 - Cpt.TEXT_1 + 1;
/** `TEXT_MOUSE_WIDTH` : largeur du texte qui suit le pointeur. */
export const TEXT_MOUSE_WIDTH = 0x80;

export interface BassTextOptions {
  disk: Pick<SkyDisk, "load">;
  /** Ce que le service lit du moteur. */
  compacts: Compacts;
  items: Pick<ItemCache, "items">;
  vars: ScriptVars;
  /** Langue des textes (`Language`) ; français par défaut. */
  language?: number;
  /** Journal du moteur (`BassEngine.log`). */
  log?: (message: string) => void;
}

/** Texte formé : `DisplayedText` du moteur avec `textWidth` (largeur de la dernière ligne, `DisplayedText::textWidth`). */
export interface FormedText extends DisplayedText {
  readonly textWidth: number;
}

export class BassTextManager implements BassText {
  private readonly texts: SkyTexts;
  private readonly fonts: (SkyFont | undefined)[] = [];
  private curFont = 0;
  private mouseOfsX = 0;
  private mouseOfsY = 0;

  constructor(private readonly options: BassTextOptions) {
    this.texts = new SkyTexts(options.disk as SkyDisk, options.language ?? LANGUAGE_FRENCH);
  }

  /** Texte brut d'un numéro (codes du jeu, rustines de la langue appliquées) : `Text::getText`. */
  getText(textNum: number): string {
    return this.texts.getText(textNum);
  }

  /** Police en cours (`_curCharSet`). */
  get font(): number {
    return this.curFont;
  }

  setFont(font: number): void {
    if (!Number.isInteger(font) || font < 0 || font >= FONT_SPECS.length) throw new RangeError(`fnSetFont : police ${font} invalide`);
    this.curFont = font;
  }

  private currentFont(): SkyFont {
    let font = this.fonts[this.curFont];
    if (!font) {
      font = new SkyFont(this.options.disk.load(FONT_SPECS[this.curFont]!.file), this.curFont);
      this.fonts[this.curFont] = font;
    }
    return font;
  }

  /** `lowTextManager` : forme le sprite du texte `textNum` dans le premier compact de texte libre. */
  lowTextManager(textNum: number, width: number, logicNum: number, color: number, center: boolean): FormedText {
    const { compacts, items, vars } = this.options;
    const font = this.currentFont();
    const rendered = renderText(this.texts.getText(textNum), font, center ? TextAlign.center : TextAlign.left, width, color);

    let compactNum = FIRST_TEXT_COMPACT;
    while (compacts.require(compactNum)[F.status] !== 0) {
      if (compactNum === Cpt.TEXT_11) {
        this.options.log?.(`lowTextManager : plus de compact de texte libre, ${compactNum} réutilisé`);
        break;
      }
      compactNum++;
    }
    const cpt = compacts.require(compactNum);
    cpt[F.flag] = compactNum - FIRST_TEXT_COMPACT + FIRST_TEXT_BUFFER;
    items.items[cpt[F.flag]!] = rendered.data;
    cpt[F.logic] = logicNum;
    cpt[F.status] = ST.LOGIC | ST.FOREGROUND | ST.RECREATE;
    cpt[F.screen] = vars[Var.SCREEN]! & 0xffff;

    return {
      compactNum,
      numLetters: rendered.layout.numLetters,
      width: rendered.layout.width,
      height: rendered.layout.height,
      sprite: rendered.data,
      textWidth: rendered.layout.lastLineWidth,
    };
  }

  /** `fnTextModule` : texte de LINC (police des liens) dont la zone est décrite par le compact `textInfoId`. */
  textModule(textInfoId: number, textNo: number): void {
    const { compacts, vars } = this.options;
    this.setFont(1);
    const info = compacts.require(textInfoId);
    const text = this.lowTextManager(textNo, info[1]!, info[2]!, 209, false);
    vars[Var.RESULT] = text.compactNum;
    const textCompact = compacts.require(text.compactNum);
    textCompact[F.xcood] = info[3]!;
    textCompact[F.ycood] = info[4]!;
    this.setFont(0);
  }

  /** `fnPointerText` : nom de l'objet pointé, qui suit le curseur (`L_CURSOR`). */
  pointerText(pointedId: number, mouseX: number, mouseY: number): void {
    const { compacts, vars } = this.options;
    const pointed = compacts.require(pointedId);
    const text = this.lowTextManager(pointed[F.cursorText]!, TEXT_MOUSE_WIDTH, L.CURSOR, 242, false);
    vars[Var.CURSOR_ID] = text.compactNum;
    if (vars[Var.MENU]) {
      this.mouseOfsY = TOP_LEFT_Y - 2;
      this.mouseOfsX = mouseX < 150 ? TOP_LEFT_X + 24 : TOP_LEFT_X - 8 - text.textWidth;
    } else {
      this.mouseOfsY = TOP_LEFT_Y - 10;
      this.mouseOfsX = mouseX < 150 ? TOP_LEFT_X + 13 : TOP_LEFT_X - 8 - text.textWidth;
    }
    this.logicCursor(compacts.require(text.compactNum), mouseX, mouseY);
  }

  /** `logicCursor` : place le texte du pointeur près de la souris, sans passer au-dessus de la zone de jeu. */
  logicCursor(cpt: CompactView, mouseX: number, mouseY: number): void {
    cpt[F.xcood] = (mouseX + this.mouseOfsX) & 0xffff;
    cpt[F.ycood] = (mouseY + this.mouseOfsY) & 0xffff;
    if (cpt[F.ycood]! < TOP_LEFT_Y) cpt[F.ycood] = TOP_LEFT_Y;
  }

  /** `changeTextSpriteColor` (`fnHighlight`) ; un sprite absent (texte déjà effacé) est ignoré. */
  changeTextSpriteColor(sprite: Uint8Array | null, pen: number): void {
    if (sprite) changeTextSpriteColor(sprite, pen & 0xff);
  }
}

// --- Modes texte / voix (D4) ---

/** Les trois modes du panneau de contrôle : sous-titres seuls, voix seule, les deux (défaut). */
export type TextVoiceMode = "text" | "voice" | "both";

/**
 * Drapeaux du moteur pour un mode (`BassEngineOptions.subtitles` et `speech`). Les textes sont français et les voix anglaises
 * (combinaison native, D4). En mode « voix », une réplique sans fichier de voix affiche quand même son texte (`stdSpeak`).
 */
export function textVoiceOptions(mode: TextVoiceMode): { subtitles: boolean; speech: boolean } {
  return { subtitles: mode !== "voice", speech: mode !== "text" };
}

/** Mode déduit des drapeaux ; sans texte ni voix (aucun mode du panneau), le texte seul. */
export function textVoiceModeOf(systemFlags: number): TextVoiceMode {
  const text = (systemFlags & SF.ALLOW_TEXT) !== 0;
  const speech = (systemFlags & SF.ALLOW_SPEECH) !== 0;
  if (text && speech) return "both";
  return speech ? "voice" : "text";
}

/** Applique un mode en cours de partie : drapeaux du moteur et, si fournie, autorisation des voix du son (`BassAudio.speechOn`). */
export function applyTextVoiceMode(system: { systemFlags: number }, mode: TextVoiceMode, audio?: { speechOn: boolean }): void {
  const { subtitles, speech } = textVoiceOptions(mode);
  system.systemFlags = (system.systemFlags & ~(SF.ALLOW_TEXT | SF.ALLOW_SPEECH)) >>> 0;
  if (subtitles) system.systemFlags |= SF.ALLOW_TEXT;
  if (speech) system.systemFlags |= SF.ALLOW_SPEECH;
  if (audio) audio.speechOn = speech;
}
