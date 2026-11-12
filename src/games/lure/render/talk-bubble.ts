/**
 * Bulle de conversation : `TalkDialog` (constructeur, `vgaTalkDialog`, `copyTo`, engines/lure/surface.cpp, ScummVM, GPL v3+). Le texte
 * s'écrit mot par mot, un mot par image de logique (un mot sur deux sans « texte rapide »).
 *
 * Le moteur (`Room.talkDialog`) ne retient que qui parle, à qui, de quoi et où ; la bulle est une affaire de rendu : `TalkBubble` compose le
 * texte (articles compris), fait les lignes, dessine le cadre `0x3F04` et avance la révélation à chaque image dessinée.
 *
 * Écarts volontaires : seule la variante VGA est portée ; un code sans glyphe est rendu comme une espace (voir `text.ts`) ; `getArticle` ne
 * connaît que le cas général (article = bits 13 à 15 du nom + 1), les cas allemand et espagnol ne concernent pas la version française.
 */

import { expandTalkDialogFrame, TALK_DIALOG_EDGE } from "../data/dialog-frame";
import type { LureData } from "../data/lure-data";
import { composeText } from "../data/strings";
import { UiString } from "../data/ids";
import { FONT_HEIGHT, TALK_DIALOG_WIDTH } from "../engine/ids";
import type { TalkDialogState } from "../engine/room";
import type { LureEngine } from "../engine/game";
import { Surface } from "./surface";
import { DIALOG_WHITE_COLOR, drawString, drawSubstring, textWidth, wordWrap } from "./text";

/** Hauteur de la bulle pour `numLines` lignes de texte : une ligne de nom, les lignes, les cadres. */
export function talkBubbleHeight(numLines: number): number {
  return (numLines + 1) * FONT_HEIGHT + TALK_DIALOG_EDGE * 4;
}

/** `TalkDialog::getArticle` pour le français : numéro d'article (à partir de 1) d'après les trois bits de poids fort du nom. */
export function articleOf(nameId: number): number {
  return ((nameId & 0xe000) >> 13) + 1;
}

/** Texte de la bulle, en codes du jeu : `StringData::getString(descId, …, itemName, destCharName, hotspotArticle, characterArticle)`. */
export function bubbleText(engine: LureEngine, dialog: TalkDialogState): string {
  const data = engine.data;
  const room = engine.room.roomNumber;
  const nameOf = (id: number): string => {
    const text = data.texts.decode(id, room);
    return text ? composeText(data.texts, text) : "";
  };
  const world = engine.world;
  let destCharName: string | undefined = "";
  let characterArticle = 0;
  // `res.getHotspot` de ScummVM rend nul pour un numéro sans hotspot (le serf du chevalet parle à `NOONE`, 0x3E7) : pas de nom.
  const dest = dialog.destCharacterId === 0 ? undefined : world.hotspot(dialog.destCharacterId);
  if (dest) {
    destCharName = nameOf(dest.nameId);
    characterArticle = articleOf(dest.nameId);
  }
  let itemName = "";
  let hotspotArticle = 0;
  const item = dialog.usedId === 0 ? undefined : world.hotspot(dialog.usedId);
  if (item) {
    itemName = nameOf(item.nameId & 0x1fff);
    hotspotArticle = articleOf(item.nameId);
  }
  const text = data.texts.decode(dialog.stringId, room);
  if (!text) return "";
  return composeText(data.texts, text, {
    hotspotName: itemName,
    characterName: destCharName,
    hotspotArticle,
    characterArticle,
    articles: data.uiStrings.slice(UiString.ARTICLE_LIST),
  });
}

export class TalkBubble {
  readonly surface: Surface;
  private readonly lines: string[];
  private endLine = 0;
  private endIndex = 0;
  private wordCountdown = 0;

  /** `name` : nom de celui qui parle (codes du jeu) ; `text` : ce qu'il dit. */
  constructor(
    private readonly data: LureData,
    readonly key: TalkDialogState,
    name: string,
    text: string,
  ) {
    this.lines = wordWrap(data.font, text, TALK_DIALOG_WIDTH - (TALK_DIALOG_EDGE + 3) * 2);
    const height = talkBubbleHeight(this.lines.length);
    this.surface = new Surface(TALK_DIALOG_WIDTH, height, expandTalkDialogFrame(data.talkDialogFrame, height));
    const charWidth = textWidth(data.font, name);
    drawString(data.font, this.surface, (TALK_DIALOG_WIDTH - charWidth) >> 1, TALK_DIALOG_EDGE + 2, name, true, DIALOG_WHITE_COLOR);
    this.syncBuilding();
  }

  /**
   * `TalkDialog::isBuilding` : le texte s'écrit encore. Le moteur le lit (`Hotspot.handleTalkDialog` : la bulle ne se compte pas à rebours
   * tant qu'elle s'écrit ; `Room.checkInTalkDialog` : on ne la ferme pas d'un clic avant la fin), il est donc tenu à jour sur la clé.
   */
  private syncBuilding(): void {
    this.key.building = this.endLine < this.lines.length;
  }

  get height(): number {
    return this.surface.height;
  }

  /** Tout le texte est écrit. */
  get complete(): boolean {
    return this.endLine >= this.lines.length;
  }

  /** La partie de `TalkDialog::copyTo` qui avance le texte : un appel par image de logique dessinée. */
  advance(fastText: boolean): void {
    if (this.endLine >= this.lines.length) {
      this.syncBuilding();
      return;
    }
    if (this.wordCountdown > 0) {
      this.wordCountdown--;
      return;
    }
    this.wordCountdown = fastText ? 0 : 1;
    const line = this.lines[this.endLine]!;
    let ch = 0;
    for (let wordFlag = false; !wordFlag; ) {
      ch = line.length > ++this.endIndex ? line.charCodeAt(this.endIndex) : 0;
      wordFlag = ch === 32 || ch === 0;
    }
    drawSubstring(this.data.font, this.surface, TALK_DIALOG_EDGE + 2, TALK_DIALOG_EDGE + 4 + (this.endLine + 1) * FONT_HEIGHT, line, this.endIndex, true);
    if (ch === 0) {
      this.endLine++;
      this.endIndex = -1;
    }
    this.syncBuilding();
  }
}
