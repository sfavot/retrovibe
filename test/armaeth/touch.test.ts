import { describe, expect, it, vi } from "vitest";
import { HoldToggle, TEXT_SENTINEL, snapTouchTarget, textFieldKeys } from "../../src/games/armaeth/ui/touch";

const chars = (text: string) => [...text].map((char) => ({ type: "char", char }));
const back = { type: "char", char: "\b" };

describe("textFieldKeys : champ de saisie caché -> touches du jeu", () => {
  it("les caractères ajoutés arrivent un à un, espaces et accents compris", () => {
    expect(textFieldKeys(TEXT_SENTINEL, `${TEXT_SENTINEL}regarder`)).toEqual(chars("regarder"));
    expect(textFieldKeys(TEXT_SENTINEL, `${TEXT_SENTINEL}prendre la clé`)).toEqual(chars("prendre la clé"));
    expect(textFieldKeys(TEXT_SENTINEL, `${TEXT_SENTINEL}ç`)).toEqual(chars("ç"));
  });

  it("effacer le caractère permanent donne un retour arrière", () => {
    expect(textFieldKeys(TEXT_SENTINEL, "")).toEqual([back]);
  });

  it("composition : seule la fin qui change est rejouée (retour arrière puis lettre accentuée)", () => {
    expect(textFieldKeys(" cafe", " café")).toEqual([back, ...chars("é")]);
    expect(textFieldKeys(" cafe", " cafe ")).toEqual(chars(" "));
    expect(textFieldKeys(" mange", " manger")).toEqual(chars("r"));
  });

  it("une lettre composée hors du BMP ne compte que pour un retour arrière", () => {
    expect(textFieldKeys(" a😀", " a")).toEqual([back]);
  });

  it("saut de ligne : Entrée ; caractères de contrôle ignorés ; texte inchangé : rien", () => {
    expect(textFieldKeys(" a", " a\n")).toEqual([{ type: "char", char: "\r" }]);
    expect(textFieldKeys(" a", " a\u0007\u007f")).toEqual([]);
    expect(textFieldKeys(" a", " a")).toEqual([]);
  });
});

describe("HoldToggle : « Tenir » (Ctrl + clic au doigt)", () => {
  it("bascule à chaque appui sur le bouton et prévient du changement", () => {
    const toggle = new HoldToggle();
    const changes = vi.fn();
    toggle.onChange = changes;
    expect(toggle.armed).toBe(false);
    toggle.toggle();
    expect(toggle.armed).toBe(true);
    toggle.toggle();
    expect(toggle.armed).toBe(false);
    expect(changes.mock.calls).toEqual([[true], [false]]);
  });

  it("le prochain clic le consomme, une seule fois", () => {
    const toggle = new HoldToggle();
    const changes = vi.fn();
    toggle.onChange = changes;
    expect(toggle.consume()).toBe(false);
    expect(changes).not.toHaveBeenCalled();
    toggle.toggle();
    expect(toggle.consume()).toBe(true);
    expect(toggle.armed).toBe(false);
    expect(toggle.consume()).toBe(false);
    expect(changes.mock.calls).toEqual([[true], [false]]);
  });
});

describe("snapTouchTarget : toucher -> centre de la case d'icône / d'inventaire", () => {
  it("barre du haut : un toucher entre deux cases ou à côté va au centre de la plus proche", () => {
    expect(snapTouchTarget(35, 10)).toEqual({ x: 35, y: 10 }); // déjà le centre de la case 0
    expect(snapTouchTarget(46, 9)).toEqual({ x: 35, y: 10 }); // espace entre cases 0 et 1, plus près de 0
    expect(snapTouchTarget(48, 9)).toEqual({ x: 59, y: 10 }); // plus près de la case 1
    expect(snapTouchTarget(290, 3)).toEqual({ x: 284, y: 10 }); // dernière case (x0 = 274), tolérance 6
  });

  it("extrémités : tolérance de 6 px au-delà du bord, rien au-delà", () => {
    expect(snapTouchTarget(19, 10)).toEqual({ x: 35, y: 10 }); // 25 - 6
    expect(snapTouchTarget(18, 10)).toEqual({ x: 18, y: 10 });
    expect(snapTouchTarget(300, 10)).toEqual({ x: 284, y: 10 }); // bord 294 + 6
    expect(snapTouchTarget(301, 10)).toEqual({ x: 301, y: 10 });
    // grand vide entre les deux groupes (x 141..177) : seules les marges des cases voisines comptent
    expect(snapTouchTarget(160, 10)).toEqual({ x: 160, y: 10 });
    expect(snapTouchTarget(146, 10)).toEqual({ x: 131, y: 10 });
    expect(snapTouchTarget(172, 10)).toEqual({ x: 188, y: 10 });
  });

  it("marge verticale : jusqu'à 6 px dans la salle sous la barre, pas au-delà", () => {
    expect(snapTouchTarget(35, 0)).toEqual({ x: 35, y: 10 });
    expect(snapTouchTarget(35, 25)).toEqual({ x: 35, y: 10 });
    expect(snapTouchTarget(35, 26)).toEqual({ x: 35, y: 26 });
    expect(snapTouchTarget(35, 60)).toEqual({ x: 35, y: 60 });
  });

  it("inventaire : 12 cases x0 = 18 + 24k, marge de 6 px dans la salle au-dessus", () => {
    expect(snapTouchTarget(30, 190)).toEqual({ x: 28, y: 190 });
    expect(snapTouchTarget(41, 199)).toEqual({ x: 52, y: 190 });
    expect(snapTouchTarget(28, 176)).toEqual({ x: 28, y: 190 });
    expect(snapTouchTarget(28, 175)).toEqual({ x: 28, y: 175 });
    expect(snapTouchTarget(12, 190)).toEqual({ x: 28, y: 190 }); // 18 - 6
    expect(snapTouchTarget(11, 190)).toEqual({ x: 11, y: 190 });
    expect(snapTouchTarget(292, 190)).toEqual({ x: 292, y: 190 }); // dernière case x0 = 282 -> centre 292
    expect(snapTouchTarget(298, 190)).toEqual({ x: 292, y: 190 });
    expect(snapTouchTarget(309, 190)).toEqual({ x: 309, y: 190 });
  });

  it("scène : un toucher au milieu de la salle n'est jamais modifié", () => {
    for (const [x, y] of [[160, 100], [35, 40], [10, 22 + 5], [300, 170]]) expect(snapTouchTarget(x, y)).toEqual({ x, y });
  });
});
