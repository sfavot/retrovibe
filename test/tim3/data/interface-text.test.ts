import { describe, expect, it } from "vitest";
import { interfaceText, parseLines } from "../../../src/games/tim3/data/text";
import { TOOLBAR_TEXT } from "../../../src/games/tim3/ui/toolbar";
import { frenchIndex, original } from "./real";

describe("textes de INTRFACE.RES par identifiant", () => {
  it("une ligne terminée par « \\ » continue sur la suivante et ne compte qu'une fois", () => {
    const lines = ["a", "b \\", "c \\", "d", "e"];
    expect([31001, 31002, 31003, 31004].map((id) => interfaceText(lines, id))).toEqual(["a", "b c d", "e", ""]);
  });

  it.skipIf(!original.has)("confirmations de la barre et rubrique « PROGRAM PART » (FRENCH.DAT)", () => {
    const lines = parseLines(frenchIndex().get("INTRFACE.RES"));
    expect(interfaceText(lines, 31114)).toBe("Oui");
    expect(interfaceText(lines, 31115)).toBe("Non");
    expect(interfaceText(lines, TOOLBAR_TEXT.openPlay)).toBe("Êtes-vous sûr de vouloir ouvrir le mode Jeu?");
    expect(interfaceText(lines, TOOLBAR_TEXT.openLab)).toBe("Êtes-vous sûr de vouloir rejoindre le Labo du Professeur Tim?");
    expect(interfaceText(lines, TOOLBAR_TEXT.showSolution)).toBe("Votre solution sera effacée quand la mienne apparaîtra. Désirez-vous continuer?");
    expect(interfaceText(lines, TOOLBAR_TEXT.clearLab)).toBe("Les modifications du puzzle seront effacées. Désirez-vous continuer?");
    expect(interfaceText(lines, 31334)).toBe("Terminé");
    expect(interfaceText(lines, 31341)).toBe("Friction");
    expect(interfaceText(lines, 31342)).toMatch(/^Vous ne pouvez pas choisir cette boîte/);
    expect(interfaceText(lines, 31343)).toMatch(/^Vous ne pouvez pas choisir ce ballon/);
  });

  it.skipIf(!original.has)("titres 21xxx et libellés 31xxx de PUZZSOLV et GENERIC", () => {
    const lines = parseLines(frenchIndex().get("INTRFACE.RES"));
    // 4213b9 ne garde que les trois derniers chiffres : titres 21xxx, libellés 31xxx, textes 1xxx.
    expect(interfaceText(lines, 21060)).toBe("Vous avez résolu le puzzle!");
    expect([31061, 31062, 31063].map((id) => interfaceText(lines, id))).toEqual(["Même Puzzle", "Rejouer la Solution", "Puzzle Suivant"]);
    expect([31107, 31108, 1110].map((id) => interfaceText(lines, id))).toEqual(["OK", "Annuler", "Texte de l'interface"]);
    expect(interfaceText(lines, 2393)).toBe("Message");
  });
});
