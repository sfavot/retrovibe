import { describe, expect, it } from "vitest";
import { type PcxImage } from "../../../src/games/fotaq/data/pcx";
import { BACKDROP_W, Display, ROOM_ZONE_HEIGHT, SCREEN_W, centerText, type TextAnchor } from "../../../src/games/fotaq/render/display";
import { textWidth } from "../../../src/games/fotaq/render/font";

function pcx(width: number, height: number, value: (x: number, y: number) => number): PcxImage {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = value(x, y);
  return { width, height, pixels, palette: new Uint8Array(768) };
}

describe("écran : décor, panneau, mode d'écran", () => {
  it("le décor est copié à partir du défilement : 150 lignes et le panneau, ou 200 lignes en plein écran", () => {
    const display = new Display();
    display.setupPanel(pcx(320, 40, (_x, y) => 100 + y));
    display.setupRoom(pcx(640, 200, (x, y) => (x + y) % 251), 7, null);
    expect([display.bdWidth, display.bdHeight]).toEqual([640, 200]);
    display.screenMode(1, false);
    expect(display.fullscreen).toBe(false);
    display.prepareScreen(100);
    const screen = display.screen.pixels;
    expect(screen[5 * SCREEN_W + 7]).toBe((100 + 7 + 5) % 251);
    expect(screen[149 * SCREEN_W + 319]).toBe((100 + 319 + 149) % 251);
    // Panneau : les 10 premières lignes sont noires (ligne de commande), l'image PANEL.PCX commence à la ligne 10.
    expect(screen[150 * SCREEN_W + 3]).toBe(0);
    expect(screen[159 * SCREEN_W + 3]).toBe(0);
    expect(screen[160 * SCREEN_W + 3]).toBe(100);
    expect(screen[199 * SCREEN_W + 3]).toBe(139);
    display.fullscreen = true;
    display.prepareScreen(320);
    expect(screen[199 * SCREEN_W + 0]).toBe((320 + 199) % 251);
    expect(screen[150 * SCREEN_W + 3]).toBe((323 + 150) % 251);
  });

  it("screenMode : 1 panneau ; 2 en cinématique plein écran si le décor fait 200 lignes ; 0 ne change rien", () => {
    const display = new Display();
    display.setupRoom(pcx(320, 150, () => 1), 1, null);
    expect(display.fullscreen).toBe(true);
    display.screenMode(0, false);
    expect(display.fullscreen).toBe(true);
    display.screenMode(1, false);
    expect(display.fullscreen).toBe(false);
    display.screenMode(2, false);
    expect(display.fullscreen).toBe(false);
    display.screenMode(2, true);
    expect(display.fullscreen).toBe(false); // décor de 150 lignes
    display.setupRoom(pcx(320, 200, () => 1), 1, null);
    display.screenMode(2, true);
    expect(display.fullscreen).toBe(true);
    expect(display.gameHeight).toBe(200);
    display.fullscreen = false;
    expect(display.gameHeight).toBe(ROOM_ZONE_HEIGHT);
  });

  it("un nouveau décor vide l'ancien (noir sous un décor de 150 lignes) et dégèle l'image", () => {
    const display = new Display();
    display.setupRoom(pcx(640, 200, () => 9), 7, null);
    display.frozen = true;
    display.setupRoom(pcx(320, 150, () => 5), 1, null);
    expect(display.frozen).toBe(false);
    expect(display.backdrop.pixels[10 * BACKDROP_W + 10]).toBe(5);
    expect(display.backdrop.pixels[160 * BACKDROP_W + 10]).toBe(0);
    expect(display.backdrop.pixels[10 * BACKDROP_W + 400]).toBe(0);
  });
});

describe("liste de textes (setText, setTextCentered, clearTexts, drawTexts)", () => {
  it("une entrée par ordonnée ; x et y valent au moins 1 ; hors de l'écran ignoré", () => {
    const display = new Display();
    display.textCurrentColor(7);
    display.setText(0, 0, "ab");
    expect(display.textAt(1)).toMatchObject({ x: 1, text: "ab", color: 7, outlined: true });
    display.setText(5, 199, "bas");
    expect(display.textAt(199).text).toBe("bas");
    display.setText(5, 200, "hors");
    display.setText(9, 199, "remplace", false);
    expect(display.textAt(199)).toMatchObject({ x: 9, text: "remplace", outlined: false });
    display.textColor(199, 3);
    expect(display.textAt(199).color).toBe(3);
    display.clearTexts(0, 198);
    expect(display.textAt(1).text).toBe("");
    expect(display.textAt(199).text).toBe("remplace");
    display.clearTexts(150, 199);
    expect(display.textAt(199).text).toBe("");
  });

  it("texte centré : abscisse (320 - largeur) / 2 ; un texte trop large perd son premier et son dernier caractère jusqu'à tenir", () => {
    const text = "Ouvrir la porte";
    expect(centerText(text).x).toBe(Math.trunc((320 - textWidth(text)) / 2));
    // 45 « W » (8 pixels chacun) : deux caractères de moins à chaque tour jusqu'à 39 (312 pixels, abscisse 4).
    expect(centerText("W".repeat(45))).toEqual({ x: 4, text: "W".repeat(39) });
    const display = new Display();
    display.textCurrentColor(4);
    display.setTextCentered(151, text, false);
    expect(display.textAt(151)).toMatchObject({ x: centerText(text).x, text, color: 4, outlined: false });
  });

  it("drawTexts écrit le texte dans l'image (contour compris) ; une entrée sautée n'est pas écrite", () => {
    const display = new Display();
    display.textCurrentColor(9);
    display.setText(10, 100, "I", true);
    display.setText(10, 120, "I", true);
    display.drawTexts(120);
    const pixel = (x: number, y: number): number => display.screen.pixels[y * SCREEN_W + x];
    expect(pixel(10, 100)).toBe(9); // « I » : ligne du haut F0 = quatre pixels
    expect(pixel(13, 100)).toBe(9);
    expect(pixel(14, 100)).toBe(16); // contour à droite
    expect(pixel(9, 99)).toBe(16);
    expect(pixel(10, 120)).toBe(0);
    expect(pixel(14, 120)).toBe(0);
  });
});

describe("texte au-dessus d'un personnage (Graphics::setBobText)", () => {
  const anchor: TextAnchor = { x: 160, y: 100, scale: 100, frameWidth: 20, frameHeight: 40 };
  const lines = (display: Display): { x: number; y: number; text: string }[] => {
    const out: { x: number; y: number; text: string }[] = [];
    for (let y = 0; y < 200; y++) if (display.textAt(y).text) out.push({ x: display.textAt(y).x, y, text: display.textAt(y).text });
    return out;
  };

  it("texte court : au-dessus de la tête (16 pixels + une ligne), centré sur le personnage, point final ajouté", () => {
    const display = new Display();
    display.setBobText(anchor, 0, "Salut", 0, 0, 14, 0);
    const width = textWidth("Salut.");
    expect(lines(display)).toEqual([{ x: 160 - Math.trunc(width / 2), y: 100 - 40 - 16 - 9, text: "Salut." }]);
    expect(display.textAt(35).color).toBe(14);
    expect(display.textAt(35).outlined).toBe(true);
  });

  it("pas de point après une ponctuation ni après une lettre accentuée (char signé en C++)", () => {
    const display = new Display();
    display.setBobText(anchor, 0, "Où ça ?", 0, 0, 1, 0);
    expect(lines(display)[0].text).toBe("Où ça ?");
    const accent = new Display();
    accent.setBobText(anchor, 0, "Voilà", 0, 0, 1, 0);
    expect(lines(accent)[0].text).toBe("Voilà");
  });

  it("coupe en lignes de plus de 20 caractères à l'espace suivante, lignes centrées entre elles, 9 pixels d'interligne", () => {
    const display = new Display();
    display.setBobText(anchor, 0, "aaaaaaaaaaaaaaaaaaaaaaaa bbbb cccccccccccccccccccccc dd", 0, 0, 1, 0);
    const out = lines(display);
    expect(out.map((l) => l.text)).toEqual(["aaaaaaaaaaaaaaaaaaaaaaaa ", "bbbb cccccccccccccccccccccc ", "dd."]);
    expect(out.map((l) => l.y)).toEqual([100 - 40 - 16 - 27, 100 - 40 - 16 - 27 + 9, 100 - 40 - 16 - 27 + 18]);
    const max = Math.max(...out.map((l) => textWidth(l.text)));
    out.forEach((l) => expect(l.x).toBe(160 - Math.trunc(max / 2) + Math.trunc((max - textWidth(l.text)) / 2)));
  });

  it("l'échelle réduit la hauteur de l'image ; le défilement est retiré de l'abscisse", () => {
    const display = new Display();
    display.setBobText({ ...anchor, x: 500, scale: 50 }, 320, "Hop", 0, 0, 1, 0);
    expect(lines(display)).toEqual([{ x: 180 - Math.trunc(textWidth("Hop.") / 2), y: 100 - 20 - 16 - 9, text: "Hop." }]);
  });

  it("en haut de l'écran le texte se colle au bord (y = 0) et se décale d'un côté ; hors des bords il est ramené de 4 pixels", () => {
    const left = new Display();
    left.setBobText({ ...anchor, x: 50, y: 30 }, 0, "Hello", 0, 0, 1, 0);
    expect(lines(left)).toEqual([{ x: 50 + 10, y: 1, text: "Hello." }]); // y vaut 1 (setText), x décalé de la moitié de la largeur de l'image
    const right = new Display();
    right.setBobText({ ...anchor, x: 250, y: 30 }, 0, "Hello", 0, 0, 1, 0);
    expect(lines(right)).toEqual([{ x: 250 - 10 - textWidth("Hello."), y: 1, text: "Hello." }]);
    const edge = new Display();
    edge.setBobText({ ...anchor, x: 2 }, 0, "Salut", 0, 0, 1, 0);
    expect(lines(edge)[0].x).toBe(4);
    const farRight = new Display();
    farRight.setBobText({ ...anchor, x: 318 }, 0, "Salut", 0, 0, 1, 0);
    expect(lines(farRight)[0].x).toBe(320 - textWidth("Salut.") - 4);
  });

  it("flags 1 : en (x, y) ; flags 2 : centré sur l'écran ; texte vide : rien", () => {
    const at = new Display();
    at.setBobText(null, 0, "Ici", 100, 80, 3, 1);
    expect(lines(at)).toEqual([{ x: 100, y: 80, text: "Ici." }]);
    const centered = new Display();
    centered.setBobText(null, 0, "Au centre", 0, 60, 3, 2);
    expect(lines(centered)).toEqual([{ x: 160 - Math.trunc(textWidth("Au centre.") / 2), y: 60, text: "Au centre." }]);
    const empty = new Display();
    empty.setBobText(anchor, 0, "", 0, 0, 3, 0);
    expect(lines(empty)).toEqual([]);
    const noBob = new Display();
    noBob.setBobText(null, 0, "Sans bob", 0, 0, 3, 0);
    expect(lines(noBob)).toEqual([]);
  });
});
