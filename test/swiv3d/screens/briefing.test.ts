import { describe, expect, it } from "vitest";
import { briefingString, drawBriefing, parseBriefing, visibleTexts, type BriefingText } from "../../../src/games/swiv3d/screens/briefing";
import { BRIEFING_TEXT_MAX_WIDTH, TextRenderer, UI_HEIGHT, UI_WIDTH, dimRow } from "../../../src/games/swiv3d/ui-draw/text";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { loadGlobal } from "./support";

const scr = (text: string) => new TextEncoder().encode(text);

describe("briefing : lecture du .SCR", () => {
  it("nomme les champs : style b -> blanc, autre lettre -> gris ; l / c / autre -> gauche, centre, droite", () => {
    expect(parseBriefing(scr("200 0 108 367 295 370 g r\n22 2 270 367 24 9 b l\n22 0 1 2 160 5 b c"))).toEqual([
      { table: 200, id: 0, firstFrame: 108, lastFrame: 367, x: 295, y: 370, style: "g", align: "r" },
      { table: 22, id: 2, firstFrame: 270, lastFrame: 367, x: 24, y: 9, style: "b", align: "l" },
      { table: 22, id: 0, firstFrame: 1, lastFrame: 2, x: 160, y: 5, style: "b", align: "c" },
    ]);
  });

  it("montre un texte de sa première à sa dernière image incluses, images numérotées à partir de 1", () => {
    const texts = parseBriefing(scr("22 0 5 6 0 0 b l"));
    expect(visibleTexts(texts, 4)).toHaveLength(0);
    expect(visibleTexts(texts, 5)).toHaveLength(1);
    expect(visibleTexts(texts, 6)).toHaveLength(1);
    expect(visibleTexts(texts, 7)).toHaveLength(0);
  });
});

describe.skipIf(!hasOriginalFiles)("briefings du jeu (BR_TER0 à 3)", () => {
  const global = loadGlobal();
  const briefing = (n: number) => parseBriefing(readOriginal(`ANIMS/BR_TER${n}.SCR`));

  it("BR_TER0 : nom de la mission en gris à droite (295, 370), images 108 à 367", () => {
    const [name, north] = briefing(0);
    expect(name).toEqual({ table: 200, id: 0, firstFrame: 108, lastFrame: 367, x: 295, y: 370, style: "g", align: "r" });
    expect(north).toMatchObject({ table: 22, id: 2, x: 24, y: 9, style: "b", align: "l" });
  });

  it("apparition à tour de rôle : BR_TER0 montre 2 textes à l'image 108, 4 à 158, 6 à 320", () => {
    const texts = briefing(0);
    expect(visibleTexts(texts, 107)).toHaveLength(0);
    expect(visibleTexts(texts, 108)).toHaveLength(2);
    expect(visibleTexts(texts, 158)).toHaveLength(3);
    expect(visibleTexts(texts, 320)).toHaveLength(6);
    expect(visibleTexts(texts, 368)).toHaveLength(0);
  });

  it("la table 200 donne la mission courante, quel que soit l'id du fichier, dans la langue du pilote", () => {
    const [name] = briefing(1);
    expect(briefingString(global.strings, 1, name!, 1)).toBe("Chercher et Détruire");
    expect(briefingString(global.strings, 0, name!, 1)).toBe("Seek & Destroy");
    expect(briefingString(global.strings, 1, name!, 0)).toBe("Fastoche");
    const objective = briefing(1)[2]!;
    expect(objective).toMatchObject({ table: 20, id: 9 });
    expect(briefingString(global.strings, 1, objective, 3)).toBe("Objectif 1");
  });

  describe("tracé", () => {
    // Table de mélange factice : tout pixel de glyphe devient 1 + (ligne & 0x7f), le fond reste 0 : on lit où le texte est écrit.
    const blend = new Uint8Array(256 * 256);
    for (let row = 0; row < 256; row++) for (let d = 0; d < 256; d++) blend[(row << 8) | d] = row === 0 ? d : 1 + (row & 0x7f);
    const renderer = new TextRenderer(global.font, blend);

    const bbox = (fb: Uint8Array) => {
      let minX = UI_WIDTH, maxX = -1, minY = UI_HEIGHT, maxY = -1;
      for (let y = 0; y < UI_HEIGHT; y++) for (let x = 0; x < UI_WIDTH; x++) if (fb[y * UI_WIDTH + x] !== 0) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      return { minX, maxX, minY, maxY };
    };
    const draw = (text: BriefingText, mission = 0): Uint8Array => {
      const fb = new Uint8Array(UI_WIDTH * UI_HEIGHT);
      drawBriefing(fb, renderer, global.strings, 1, [text], text.firstFrame, mission);
      return fb;
    };
    const base: BriefingText = { table: 22, id: 0, firstFrame: 1, lastFrame: 9, x: 200, y: 100, style: "b", align: "l" };

    it("aligne à gauche : le texte commence au bord donné et s'étend vers la droite", () => {
      const width = renderer.width("Commencer");
      const box = bbox(draw(base));
      expect(box.minX).toBeGreaterThanOrEqual(200);
      expect(box.minX).toBeLessThan(204);
      expect(box.maxX).toBeLessThanOrEqual(200 + width + 2);
      expect(box.maxX).toBeGreaterThan(200 + width - 8);
    });

    it("aligne à droite : le texte finit au bord donné", () => {
      const width = renderer.width("Commencer");
      const box = bbox(draw({ ...base, align: "r", x: 295 }));
      expect(box.maxX).toBeLessThanOrEqual(295 + 2);
      expect(box.maxX).toBeGreaterThan(295 - 8);
      expect(box.minX).toBeGreaterThanOrEqual(295 - width);
    });

    it("centre sur x", () => {
      const box = bbox(draw({ ...base, align: "c", x: 160 }));
      expect((box.minX + box.maxX) / 2).toBeGreaterThan(160 - 6);
      expect((box.minX + box.maxX) / 2).toBeLessThan(160 + 6);
    });

    it("y est le point de dessin : le haut des glyphes est quelques pixels dessous (bord adouci en y + 3, face en y + 4)", () => {
      const box = bbox(draw({ ...base, y: 330 }));
      expect(box.minY - 330).toBeGreaterThanOrEqual(3);
      expect(box.minY - 330).toBeLessThanOrEqual(4);
      expect(box.maxY - box.minY + 1).toBeLessThanOrEqual(17);
    });

    it("le style g écrit des lignes de teinte divisée par deux, le style b les lignes d'origine", () => {
      const white = draw(base);
      const gray = draw({ ...base, style: "g" });
      expect(white).not.toEqual(gray);
      expect(dimRow(0x1f)).toBe(0x17);
      expect(dimRow(0xe5)).toBe(0xe2);
      // mêmes pixels touchés dans les deux styles
      expect(white.map((v) => (v ? 1 : 0))).toEqual(gray.map((v) => (v ? 1 : 0)));
    });

    it("coupe une chaîne à 280 pixels", () => {
      const long = "Le texte du briefing est vraiment beaucoup trop long pour tenir";
      const cut = renderer.truncate(long, BRIEFING_TEXT_MAX_WIDTH);
      expect(renderer.width(cut)).toBeLessThanOrEqual(BRIEFING_TEXT_MAX_WIDTH);
      expect(renderer.width(cut + long[cut.length])).toBeGreaterThan(BRIEFING_TEXT_MAX_WIDTH);
      expect(renderer.truncate("court", BRIEFING_TEXT_MAX_WIDTH)).toBe("court");
    });

    it("ne dessine rien hors de la plage d'images, ni hors de l'écran", () => {
      const fb = new Uint8Array(UI_WIDTH * UI_HEIGHT);
      drawBriefing(fb, renderer, global.strings, 1, [base], 10, 0);
      expect(fb.every((v) => v === 0)).toBe(true);
      expect(() => draw({ ...base, x: 310, y: 395 })).not.toThrow();
      expect(() => draw({ ...base, x: -50, y: -5 })).not.toThrow();
    });
  });
});
