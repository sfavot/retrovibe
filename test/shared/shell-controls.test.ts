import { describe, expect, it } from "vitest";
import { CONTROL_SLOT, ICON_SIZE, type ControlSize, controlHandle, placeControls, trapTarget } from "../../src/ui/shell-controls";

const icons = (count: number): ControlSize[] => Array.from({ length: count }, () => ICON_SIZE);
const base = { logicalWidth: 320, logicalHeight: 200, start: icons(2), end: icons(1) };

describe("placeControls (barre du bas ou colonnes de côté)", () => {
  it("iPad 1000×750 : barre sous l'écran, échelle ≈ 3,07 (l'ancienne disposition donnait ≈ 2,4)", () => {
    const layout = placeControls({ ...base, availableWidth: 984, availableHeight: 734 });
    expect(layout.placement).toBe("bottom");
    expect(layout.scale).toBeCloseTo(3.07, 1);
  });

  it("téléphone 844×390 : colonnes de côté, échelle limitée par la hauteur (≈ 1,9)", () => {
    const layout = placeControls({ ...base, availableWidth: 828, availableHeight: 374 });
    expect(layout.placement).toBe("sides");
    expect(layout.scale).toBeCloseTo(374 / 200, 2);
  });

  it("téléphone en portrait 390×844 : barre du bas, l'écran prend toute la largeur", () => {
    const layout = placeControls({ ...base, availableWidth: 374, availableHeight: 828 });
    expect(layout.placement).toBe("bottom");
    expect(layout.scale).toBeCloseTo(374 / 320, 2);
  });

  it("égalité : la barre du bas l'emporte", () => {
    // Largeur limitante pour les deux placements si la hauteur est abondante ; ici, 320 × 2 de large, les colonnes en coûtent.
    const layout = placeControls({ ...base, availableWidth: 640, availableHeight: 10000 });
    expect(layout.placement).toBe("bottom");
  });

  it("une seule colonne réservée quand le groupe de début est vide", () => {
    const both = placeControls({ ...base, availableWidth: 700, availableHeight: 400, start: icons(1) });
    const endOnly = placeControls({ ...base, availableWidth: 700, availableHeight: 400, start: [] });
    expect(endOnly.placement).toBe("sides");
    expect(endOnly.scale).toBeGreaterThan(both.scale);
    expect(both.placement).toBe("sides");
    expect(both.scale).toBeCloseTo((700 - 2 * CONTROL_SLOT) / 320, 2);
    expect(endOnly.scale).toBeCloseTo(2, 2);
  });

  it("des colonnes plus hautes que la place disponible ne sont pas possibles", () => {
    const layout = placeControls({ ...base, availableWidth: 900, availableHeight: 150, start: icons(5) });
    expect(layout.placement).toBe("bottom");
  });

  it("l'échelle ne déforme jamais le ratio et ne déborde pas de la place (tronquée au millième)", () => {
    const layout = placeControls({ ...base, availableWidth: 997, availableHeight: 613 });
    expect(320 * layout.scale).toBeLessThanOrEqual(997);
    expect(layout.scale).toBeGreaterThan(0);
    expect(placeControls({ ...base, availableWidth: 0, availableHeight: 0 }).scale).toBeGreaterThan(0);
  });
});

function fakeButton() {
  const attributes = new Map<string, string>();
  let writes = 0;
  return {
    attributes,
    get writes() {
      return writes;
    },
    style: {
      display: "",
      _visibility: "",
      get visibility() {
        return this._visibility;
      },
      set visibility(value: string) {
        writes++;
        this._visibility = value;
      },
    },
    disabled: false,
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
  };
}

describe("placeControls avec des blocs propres au jeu (manche, boutons d'action)", () => {
  const stick = { width: 112, height: 112 };
  const buttons = { width: 136, height: 136 };
  const swiv = { logicalWidth: 320, logicalHeight: 240, start: [stick], end: [buttons, ICON_SIZE] };

  it("la barre du bas réserve la hauteur du bloc le plus haut", () => {
    const layout = placeControls({ ...swiv, availableWidth: 984, availableHeight: 734 });
    expect(layout.placement).toBe("bottom");
    expect(layout.scale).toBeCloseTo((734 - 136 - 8) / 240, 2);
  });

  it("téléphone en paysage : colonnes de côté, les blocs ne chevauchent pas l'écran", () => {
    const layout = placeControls({ ...swiv, availableWidth: 828, availableHeight: 374 });
    expect(layout.placement).toBe("sides");
    expect(layout.scale).toBeCloseTo(374 / 240, 2);
    expect(320 * layout.scale + 112 + 8 + 136 + 8).toBeLessThanOrEqual(828);
  });

  it("portrait : barre du bas, largeur minimale de la rangée donnée", () => {
    const layout = placeControls({ ...swiv, availableWidth: 374, availableHeight: 828 });
    expect(layout.placement).toBe("bottom");
    expect(layout.rowWidth).toBe(112 + 136 + 44 + 3 * 8);
    expect(layout.rowWidth).toBeLessThanOrEqual(374);
  });
});

describe("placeControls avec un panneau et un bloc qui change de forme (Indy)", () => {
  const pad = { width: 136, height: 64, sides: { width: 64, height: 136 } };
  const panel = { sideWidth: 232, bottomHeight: 176 };
  const indy = { logicalWidth: 1, logicalHeight: 1, start: [pad], end: [ICON_SIZE], panel };

  it("iPad en paysage : colonnes, le bloc empilé ne coûte que sa largeur de colonne", () => {
    const layout = placeControls({ ...indy, availableWidth: 984, availableHeight: 734 });
    expect(layout.placement).toBe("sides");
    expect(layout.scale).toBeCloseTo(984 - (64 + 8) - (232 + 8) - (44 + 8), 0);
  });

  it("téléphone en paysage : écran carré limité par la hauteur", () => {
    const layout = placeControls({ ...indy, availableWidth: 828, availableHeight: 374 });
    expect(layout.placement).toBe("sides");
    expect(layout.scale).toBeCloseTo(374, 0);
  });

  it("portrait : bande du panneau et rangée du bloc sous l'écran, limité par la largeur sur téléphone", () => {
    const layout = placeControls({ ...indy, availableWidth: 374, availableHeight: 828 });
    expect(layout.placement).toBe("bottom");
    expect(layout.scale).toBeCloseTo(374, 0);
  });

  it("portrait iPad : limité par la hauteur, le panneau et la rangée sont réservés", () => {
    const layout = placeControls({ ...indy, availableWidth: 734, availableHeight: 984 });
    expect(layout.placement).toBe("bottom");
    expect(layout.scale).toBeCloseTo(984 - 64 - 8 - 176 - 8, 0);
  });
});

describe("poignée d'un contrôle", () => {
  it("masqué, le bouton garde sa place (visibility) ; visible, la propriété est vidée", () => {
    const button = fakeButton();
    const handle = controlHandle(button);
    handle.setVisible(false);
    expect(button.style.visibility).toBe("hidden");
    handle.setVisible(true);
    expect(button.style.visibility).toBe("");
  });

  it("n'écrit que lorsque l'état change (appelée à chaque image)", () => {
    const button = fakeButton();
    const handle = controlHandle(button);
    handle.setVisible(true);
    handle.setVisible(true);
    expect(button.writes).toBe(0);
    handle.setVisible(false);
    handle.setVisible(false);
    expect(button.writes).toBe(1);
  });

  it("avec collapse, le bouton sort du flux (display) et la barre est replacée ; sans collapse, rien n'est replacé", () => {
    const button = fakeButton();
    let relayouts = 0;
    const handle = controlHandle(button, true, () => relayouts++);
    handle.setVisible(false);
    handle.setVisible(false);
    expect(button.style.display).toBe("none");
    expect(button.style.visibility).toBe("");
    expect(relayouts).toBe(1);
    handle.setVisible(true);
    expect(button.style.display).toBe("");
    expect(relayouts).toBe(2);
    const plain = fakeButton();
    let plainRelayouts = 0;
    controlHandle(plain, false, () => plainRelayouts++).setVisible(false);
    expect(plain.style.visibility).toBe("hidden");
    expect(plainRelayouts).toBe(0);
  });

  it("grisé et enfoncé", () => {
    const button = fakeButton();
    const handle = controlHandle(button);
    handle.setDisabled(true);
    expect(button.disabled).toBe(true);
    handle.setPressed(true);
    expect(button.attributes.get("aria-pressed")).toBe("true");
    handle.setPressed(false);
    expect(button.attributes.get("aria-pressed")).toBe("false");
  });
});

describe("trapTarget (focus piégé dans le menu)", () => {
  it("avance, puis boucle du dernier au premier", () => {
    expect(trapTarget(3, 0, false)).toBe(1);
    expect(trapTarget(3, 2, false)).toBe(0);
  });

  it("recule avec Maj, et boucle du premier au dernier", () => {
    expect(trapTarget(3, 2, true)).toBe(1);
    expect(trapTarget(3, 0, true)).toBe(2);
  });

  it("focus hors de la fenêtre : on y entre par le premier (ou le dernier avec Maj)", () => {
    expect(trapTarget(3, -1, false)).toBe(0);
    expect(trapTarget(3, -1, true)).toBe(2);
    expect(trapTarget(0, -1, false)).toBe(-1);
  });
});
