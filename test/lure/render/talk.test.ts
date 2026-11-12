import { describe, expect, it } from "vitest";
import type { LureData } from "../../../src/games/lure/data/lure-data";
import { TALK_DIALOG_Y } from "../../../src/games/lure/engine/ids";
import type { TalkDialogState } from "../../../src/games/lure/engine/room";
import type { TalkSelectView } from "../../../src/games/lure/engine/talk";
import { infoDialog } from "../../../src/games/lure/render/dialog";
import { Surface } from "../../../src/games/lure/render/surface";
import { TalkBubble, bubbleText } from "../../../src/games/lure/render/talk-bubble";
import { gameTextToUnicode } from "../../../src/games/lure/data/charset";
import { makeEngine } from "../engine/test-host";
import { drawTalkSelectView, talkSelectHeight } from "../../../src/games/lure/render/talk-select";
import { DIALOG_TEXT_COLOR, DIALOG_WHITE_COLOR } from "../../../src/games/lure/render/text";
import { hasOriginalFiles } from "../data/helpers";
import { lureData } from "../data/catalog-helper";

function key(): TalkDialogState {
  return { srcCharacterId: 0x3e8, destCharacterId: 0, usedId: 0, stringId: 0, x: 0, y: TALK_DIALOG_Y, building: false };
}

/** Mots d'un texte (la bulle les révèle un par un). */
function words(text: string): number {
  return text.split(" ").filter(Boolean).length;
}

function ticksToComplete(bubble: TalkBubble, fast: boolean, max = 1000): number {
  let n = 0;
  while (!bubble.complete && n < max) {
    bubble.advance(fast);
    n++;
  }
  return n;
}

describe.skipIf(!hasOriginalFiles)("bulle de parole (TalkDialog)", () => {
  const text = "Je ne sais pas du tout ce que vous voulez dire";
  const data: LureData = hasOriginalFiles ? lureData() : (undefined as never);

  it("`building` : vrai tant que le texte s'écrit (le moteur n'ouvre pas le décompte), faux à la fin", () => {
    const k = key();
    const bubble = new TalkBubble(data, k, "Diermot", text);
    expect(k.building).toBe(true);
    expect(bubble.complete).toBe(false);
    ticksToComplete(bubble, true);
    expect(bubble.complete).toBe(true);
    expect(k.building).toBe(false);
  });

  it("un mot par image avec le texte rapide, un mot sur deux sans", () => {
    const n = words(text);
    const fast = new TalkBubble(data, key(), "Diermot", text);
    // Un mot par image ; le dernier mot de chaque ligne ferme la ligne (même image).
    expect(ticksToComplete(fast, true)).toBe(n);
    const slow = new TalkBubble(data, key(), "Diermot", text);
    expect(ticksToComplete(slow, false)).toBe(2 * n - 1);
  });

  it("le texte écrit change la surface (rien d'écrit au départ)", () => {
    const bubble = new TalkBubble(data, key(), "Diermot", text);
    const before = Uint8Array.from(bubble.surface.data);
    bubble.advance(true);
    expect(Uint8Array.from(bubble.surface.data)).not.toEqual(before);
    const done = new TalkBubble(data, key(), "Diermot", text);
    ticksToComplete(done, true);
    const afterWords = Uint8Array.from(done.surface.data);
    done.advance(true);
    expect(Uint8Array.from(done.surface.data)).toEqual(afterWords);
  });

  it("une bulle plus longue est plus haute (une ligne de plus : 8 pixels)", () => {
    const short = new TalkBubble(data, key(), "Diermot", "Oui");
    const long = new TalkBubble(data, key(), "Diermot", text.repeat(3));
    expect(long.height).toBeGreaterThan(short.height);
    expect((long.height - short.height) % 8).toBe(0);
  });
});

describe.skipIf(!hasOriginalFiles)("choix du joueur (talk-select)", () => {
  const data: LureData = hasOriginalFiles ? lureData() : (undefined as never);
  const line = (t: string): string => t;
  const view: TalkSelectView = { lines: [line("Bonjour"), line("Au revoir"), line("Autre chose")], selected: 2, entries: [0, 1, 2] };

  function screen(): Surface {
    const s = new Surface(320, 200);
    s.data.fill(7);
    return s;
  }

  function colorsIn(s: Surface, top: number): Set<number> {
    const out = new Set<number>();
    for (let y = top; y < top + 8; y++) for (let x = 0; x < 320; x++) out.add(s.data[y * 320 + x]!);
    return out;
  }

  it("fond noir de toute la largeur sur les lignes 1 à n (sous la barre de menus), le reste de l'écran est intact", () => {
    const s = screen();
    drawTalkSelectView(data, view, s);
    for (let y = 0; y < 8; y++) expect(s.data[y * 320 + 5]).toBe(7);
    for (let y = 8; y < 8 * 4; y++) expect(s.data[y * 320 + 319]).toBe(0);
    for (let y = 8 * 4; y < 200; y++) expect(s.data[y * 320 + 5]).toBe(7);
  });

  it("la ligne survolée est en blanc, les autres en texte de boîte", () => {
    const s = screen();
    drawTalkSelectView(data, view, s);
    expect(colorsIn(s, 8).has(DIALOG_TEXT_COLOR)).toBe(true);
    expect(colorsIn(s, 8).has(DIALOG_WHITE_COLOR)).toBe(false);
    expect(colorsIn(s, 16).has(DIALOG_WHITE_COLOR)).toBe(true);
    expect(colorsIn(s, 16).has(DIALOG_TEXT_COLOR)).toBe(false);
    expect(colorsIn(s, 24).has(DIALOG_TEXT_COLOR)).toBe(true);
  });

  it("aucune ligne survolée : toutes en texte de boîte ; au plus 4 lignes dessinées", () => {
    const s = screen();
    drawTalkSelectView(data, { lines: ["a", "b", "c", "d", "e"], selected: 0, entries: [0, 1, 2, 3, 4] }, s);
    for (const top of [8, 16, 24, 32]) expect(colorsIn(s, top).has(DIALOG_WHITE_COLOR)).toBe(false);
    for (let x = 0; x < 320; x++) expect(s.data[40 * 320 + x]).toBe(7);
    expect(talkSelectHeight(5)).toBe(40);
    expect(talkSelectHeight(3)).toBe(32);
  });
});

describe.skipIf(!hasOriginalFiles)("boîte d'information et statut", () => {
  const data: LureData = hasOriginalFiles ? lureData() : (undefined as never);

  it("en (69, 61) ; « Statut » : centrée en hauteur, (200 - hauteur) / 2", () => {
    const plain = infoDialog(data, "La Cellule\n\nVous avez rien");
    expect(plain.y).toBe(61);
    const status = infoDialog(data, "La Cellule\n\nVous avez rien", true);
    expect(status.x).toBe(69);
    expect(status.y).toBe(Math.trunc((200 - status.surface.height) / 2));
    expect(status.surface.height).toBe(plain.surface.height);
  });
});

describe.skipIf(!hasOriginalFiles)("texte de la bulle (bubbleText) : noms substitués comme `TalkDialog`", () => {
  /** Le premier texte « Hey, %s, attendez! » des données (le nom de l'interlocuteur est substitué). */
  function heyStringId(engine: ReturnType<typeof makeEngine>["engine"]): number {
    for (let id = 1; id < 0x2000; id++) {
      let text = "";
      try {
        text = gameTextToUnicode(engine.text(id));
      } catch {
        continue; // numéro sans texte
      }
      if (text === "Hey, , attendez!") return id; // `engine.text` ne substitue rien : le nom est absent
    }
    throw new Error("texte « Hey, %s, attendez! » introuvable");
  }

  it("le nom de l'interlocuteur (un étranger : « Etranger ») remplace %s, comme au banc ScummVM (« Hey, Etranger, »)", () => {
    const { engine } = makeEngine();
    engine.tick();
    const dialog = { ...key(), destCharacterId: 0x3eb, stringId: heyStringId(engine) };
    expect(gameTextToUnicode(bubbleText(engine, dialog))).toBe("Hey, Etranger, attendez!");
  });

  it("un interlocuteur sans hotspot (le serf du chevalet parle à NOONE, 0x3E7) : nom vide, sans erreur (getHotspot nul de ScummVM)", () => {
    const { engine } = makeEngine();
    engine.tick();
    const dialog = { ...key(), srcCharacterId: 0x411, destCharacterId: 0x3e7, usedId: 0x3e7, stringId: heyStringId(engine) };
    expect(gameTextToUnicode(bubbleText(engine, dialog))).toBe("Hey, , attendez!");
  });
});
