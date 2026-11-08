import { describe, expect, it } from "vitest";
import { parseCredits } from "../../../src/games/fotaq/data/credits";
import { CreditsRunner } from "../../../src/games/fotaq/engine/credits";
import { Display } from "../../../src/games/fotaq/render/display";
import { hasOriginalFiles, readOriginal } from "../helpers";

/** Texte de l'écran, ligne par ligne. */
const texts = (display: Display): string[] => {
  const out: string[] = [];
  for (let y = 0; y < 200; y++) if (display.textAt(y).text) out.push(display.textAt(y).text);
  return out;
};

describe("générique (Credits::update)", () => {
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

  it("une page s'affiche d'un coup, reste N x 10 images, puis s'efface ; la fin arrête le générique", () => {
    const display = new Display();
    const runner = new CreditsRunner(parseCredits(bytes(".c\n.i 3\nPremiere\nPage\n.p 1\nSeconde\n.p 1\nEN\n")));
    runner.update(display);
    expect(texts(display)).toEqual(["Premiere", "Page"]);
    expect(display.textAt(0).color).toBe(0);
    for (let i = 0; i < 9; i++) runner.update(display);
    expect(texts(display)).toEqual(["Premiere", "Page"]);
    runner.update(display);
    expect(texts(display)).toEqual([]);
    runner.update(display);
    expect(texts(display)).toEqual(["Seconde"]);
    for (let i = 0; i < 10; i++) runner.update(display);
    expect(texts(display)).toEqual([]);
    expect(runner.running).toBe(true);
    runner.update(display);
    expect(runner.running).toBe(false);
  });

  it("`.p 0` attend le changement de pièce", () => {
    const display = new Display();
    const runner = new CreditsRunner(parseCredits(bytes("Titre\n.p 0\nSuite\n.p 1\nEN\n")));
    runner.update(display);
    for (let i = 0; i < 50; i++) runner.update(display);
    expect(texts(display)).toEqual(["Titre"]);
    runner.nextRoom(display);
    expect(texts(display)).toEqual([]);
    runner.update(display);
    expect(texts(display)).toEqual(["Suite"]);
  });

  it.skipIf(!hasOriginalFiles)("les deux génériques du jeu se déroulent jusqu'à leur fin", () => {
    for (const file of ["CREDIT1.CRD", "CREDIT2.CRD"]) {
      const credits = parseCredits(readOriginal(file));
      const display = new Display();
      const runner = new CreditsRunner(credits);
      let frames = 0;
      let shown = 0;
      while (runner.running && frames++ < 20_000) {
        runner.update(display);
        runner.nextRoom(display);
        if (texts(display).length > 0) shown++;
      }
      expect(runner.running, file).toBe(false);
      expect(shown, file).toBeGreaterThan(100);
    }
  });
});
