import { describe, expect, it } from "vitest";
import { copy } from "../../../src/games/gk1/copy";

describe("textes de la page de Gabriel Knight", () => {
  it("le nom accessible du bouton « Menu » commence par son libellé et annonce chaque entrée du menu", () => {
    expect(copy.menuLabel.startsWith(copy.menu)).toBe(true);
    for (const entry of [copy.save, copy.load, copy.volume, copy.pause, copy.helpLink, copy.titleScreen]) expect(copy.menuLabel.toLowerCase()).toContain(entry.toLowerCase());
  });

  it("la présentation et l'aide ne disent plus que seul le début du jeu est jouable", () => {
    for (const text of [copy.description, ...copy.helpHow]) expect(text).not.toMatch(/portage (est )?en cours|début du (jeu|premier jour)/i);
  });
});
