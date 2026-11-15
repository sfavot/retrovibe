import { describe, expect, it } from "vitest";
import { canvasMayTakeFocus, contentHeight, failureMessage, fitScale, shellScale } from "../../src/ui/game-shell";
import { MissingFilesError } from "../../src/ui/files";

describe("fitScale (échelle du canvas : entière dès 2×, sinon fractionnaire)", () => {
  it("prend la plus grande échelle entière qui tient", () => {
    expect(fitScale(1300, 1000, 640, 480)).toBe(2);
    expect(fitScale(1000, 1000, 320, 200)).toBe(3);
    expect(fitScale(640, 400, 320, 200)).toBe(2);
  });

  it("est limitée par la dimension la plus étroite", () => {
    expect(fitScale(3000, 400, 320, 200)).toBe(2);
    expect(fitScale(640, 3000, 320, 200)).toBe(2);
  });

  it("devient fractionnaire sous 2× : l'écran remplit la place au lieu de rester à 1×", () => {
    expect(fitScale(700, 500, 640, 480)).toBeCloseTo(1.0417);
    expect(fitScale(600, 1000, 320, 200)).toBeCloseTo(1.875);
    expect(fitScale(639.9, 1000, 320, 200)).toBeCloseTo(1.9997, 3);
  });

  it("devient fractionnaire sous 1, jamais nulle", () => {
    expect(fitScale(320, 1000, 640, 480)).toBeCloseTo(0.5);
    expect(fitScale(0, 0, 640, 480)).toBeGreaterThan(0);
  });

  it("reste fractionnaire au-dessus de 1 sans échelle entière", () => {
    expect(fitScale(1280, 720, 640, 480, false)).toBeCloseTo(1.5);
    expect(fitScale(320, 1000, 640, 480, false)).toBeCloseTo(0.5);
  });
});

describe("shellScale (mesures de la page -> échelle)", () => {
  // Fenêtre 700×500, écran 320×200 : 20 px de marge en haut, pied de page de 40 px sous l'écran (hauteur du conteneur = écran + 40).
  const base = { mainWidth: 700, mainTop: 20, mainHeight: 240, stageHeight: 200, viewportHeight: 500 };

  it("sans message de chargement, la place est vue en entier : 2×", () => {
    expect(shellScale(base, 320, 200)).toBe(2);
  });

  it("le message de chargement encore affiché (60 px de plus autour de l'écran) ferait tomber à 1× : il doit être masqué avant la mesure", () => {
    expect(shellScale({ ...base, mainHeight: base.mainHeight + 60 }, 320, 200)).toBeLessThan(2);
  });

  it("un pied de page plus haut sous l'écran réduit la place disponible", () => {
    expect(shellScale({ ...base, mainHeight: 240 + 160, viewportHeight: 800 }, 320, 200)).toBe(2);
    expect(shellScale({ ...base, mainHeight: 240 + 160 }, 320, 200)).toBeCloseTo(1.32);
  });

  it("fractionnaire sur demande", () => {
    expect(shellScale({ ...base, mainWidth: 1000, viewportHeight: 900 }, 640, 480, false)).toBeCloseTo(1.5125);
  });

  it("plein écran : la hauteur du contenu, et non celle du conteneur étiré à la fenêtre, garde l'échelle", () => {
    // Fenêtre 804×885, écran à 2× (400 px) et pied de page de 34 px, espacement 12, marges de 16 : le conteneur étiré mesure 885.
    const content = contentHeight([400, 34], 12, 16, 16);
    expect(content).toBe(478);
    const fullscreen = { mainWidth: 804, mainTop: 0, stageHeight: 400, viewportHeight: 885 };
    expect(shellScale({ ...fullscreen, mainHeight: content }, 320, 200)).toBe(2);
    // L'ancienne mesure (`offsetHeight` étiré) faisait rapetisser l'écran à chaque recalcul.
    expect(shellScale({ ...fullscreen, mainHeight: 885 }, 320, 200, false)).toBeLessThan(2);
  });
});

describe("contentHeight", () => {
  it("additionne les enfants, les espacements entre eux et les marges", () => {
    expect(contentHeight([200, 40], 12, 16, 16)).toBe(284);
    expect(contentHeight([200], 12, 16, 16)).toBe(232);
    expect(contentHeight([], 12, 16, 16)).toBe(32);
  });
});

describe("canvasMayTakeFocus", () => {
  const body = {} as Element;
  const canvas = {} as Element;
  const button = {} as Element;

  it("reprend le focus si personne ne l'a ou s'il l'a déjà", () => {
    expect(canvasMayTakeFocus(null, body, canvas)).toBe(true);
    expect(canvasMayTakeFocus(body, body, canvas)).toBe(true);
    expect(canvasMayTakeFocus(canvas, body, canvas)).toBe(true);
  });

  it("ne vole pas le focus d'un bouton ou d'un lien", () => {
    expect(canvasMayTakeFocus(button, body, canvas)).toBe(false);
  });
});

describe("failureMessage", () => {
  it("préfixe le détail de l'erreur", () => {
    expect(failureMessage(new Error("boum"), "Échec :", "absent")).toBe("Échec : boum");
    expect(failureMessage("texte", "Échec :")).toBe("Échec : texte");
  });

  it("donne son propre texte aux fichiers manquants", () => {
    expect(failureMessage(new MissingFilesError("x"), "Échec :", "absent")).toBe("absent");
    expect(failureMessage(new MissingFilesError("x"), "Échec :")).toBe("Échec : x");
  });
});
