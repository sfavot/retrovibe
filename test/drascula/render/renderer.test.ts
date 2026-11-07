import { describe, expect, it } from "vitest";
import { createGameState } from "../../../src/games/drascula/engine/state";
import { createRoomState } from "../../../src/games/drascula/engine/room";
import { scaledSize } from "../../../src/games/drascula/engine/perspective";
import { DrasculaData } from "../../../src/games/drascula/engine/resources";
import { layoutCenteredText } from "../../../src/games/drascula/render/font";
import { scummvmRgb8, TextColor } from "../../../src/games/drascula/render/palette";
import { type FrameInput, DrasculaRenderer, iconsSheet } from "../../../src/games/drascula/render/renderer";
import { Plane, TRANSPARENT } from "../../../src/games/drascula/render/plane";
import { hasOriginalFiles } from "../helpers";
import { TestHost } from "../engine/test-host";
import { ROOM_CHAPTERS } from "../engine/rooms";

/** Rendu seul (sans moteur) sur les fichiers du jeu, avec l'état d'un chapitre. */
function setup(chapter: number, roomNumber: number) {
  const host = new TestHost();
  const data = new DrasculaData((name) => host.readFile(name));
  const verbs = Array.from({ length: 6 }, (_, i) => data.text("textverbs", i));
  const renderer = new DrasculaRenderer((name) => host.readFile(name), data.dat, data.text("textmisc", 3), verbs);
  const state = createGameState(chapter);
  renderer.startChapter(chapter);
  state.room = createRoomState(data.room(roomNumber, chapter), chapter);
  renderer.enterRoom(state.room, chapter);
  state.hero.x = 100;
  state.hero.y = 60;
  const input = (patch: Partial<FrameInput> = {}): FrameInput => ({
    state,
    mouseX: 160,
    mouseY: 100,
    subtitle: null,
    main: false,
    cursorVisible: false,
    ...patch,
  });
  return { host, data, renderer, state, input };
}

/** Pixels de `a` et de `b` qui diffèrent dans le rectangle. */
function differences(a: Plane, b: Plane, x: number, y: number, width: number, height: number): number {
  let count = 0;
  for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) if (a.at(col, row) !== b.at(col, row)) count++;
  return count;
}

describe.skipIf(!hasOriginalFiles)("images et palettes d'un chapitre (startChapter, enterRoom)", () => {
  it("début du chapitre 1 : 96.ALG donne les 256 couleurs, le héros de face, 99.ALG de dos, 97.ALG de côté, 95.ALG la police", () => {
    const { renderer } = setup(1, 62);
    expect([...renderer.front.pixels]).toEqual([...renderer.image(96).pixels]);
    expect([...renderer.back.pixels]).toEqual([...renderer.image(99).pixels]);
    expect([...renderer.extra.pixels]).toEqual([...renderer.image(97).pixels]);
    expect([...renderer.table.pixels]).toEqual([...renderer.image("95.alg").pixels]);
    expect([...renderer.cursor.pixels]).toEqual([...renderer.image(99).pixels]);
  });

  it("une pièce : décor en HALF_PAL, feuille annexe dans draw3, lumière bright", () => {
    const { renderer, state } = setup(1, 62);
    const room = renderer.image(62);
    const reserved = renderer.image(96);
    expect([...renderer.bg.pixels]).toEqual([...room.pixels]);
    expect([...renderer.draw3.pixels.subarray(320 * 30)]).toEqual([...renderer.image(state.room!.disk).pixels.subarray(320 * 30)]);
    const shown = renderer.palette.shown;
    // 128 premières couleurs : celles du décor ; 128 dernières : la réserve de 96.ALG (les couleurs de lumière 235 à 252 mises à part)
    expect([...shown.subarray(0, 128 * 3)]).toEqual([...scummvmRgb8(room.palette).subarray(0, 128 * 3)]);
    expect([...shown.subarray(128 * 3, 235 * 3)]).toEqual([...scummvmRgb8(reserved.palette).subarray(128 * 3, 235 * 3)]);
    expect([...shown.subarray(253 * 3, 254 * 3)]).toEqual([...scummvmRgb8(reserved.palette).subarray(253 * 3, 254 * 3)]);
  });

  it("le niveau de la fiche assombrit la lumière : bright sous la base, dark (niveau + 2) sous bright", () => {
    const { data } = setup(1, 62);
    const sum = (palette: Int8Array): number => palette.slice(235 * 3, 253 * 3).reduce((total, value) => total + value, 0);
    const levels = ROOM_CHAPTERS.map(([room, chapter]) => ({ room, chapter, level: data.room(room, chapter).paletteLevel }));
    const leveled = levels.find((entry) => entry.level > 0);
    expect(leveled, "au moins une pièce a un niveau de palette").toBeDefined();
    const plain = levels.find((entry) => entry.level === 0)!;
    const dark = setup(leveled!.chapter, leveled!.room).renderer.palette;
    const light = setup(plain.chapter, plain.room).renderer.palette;
    expect([...light.bright.subarray(235 * 3, 253 * 3)]).toEqual([...light.defaults.subarray(235 * 3, 253 * 3)]);
    expect(sum(dark.bright)).toBeLessThan(sum(dark.defaults));
    expect(sum(dark.dark)).toBeLessThan(sum(dark.bright));
    expect(sum(light.dark)).toBeLessThan(sum(light.bright));
  });

  it("chapitre 2 : les images du héros viennent de la fiche (ou 97, 96, 99 par défaut)", () => {
    const withHero = ROOM_CHAPTERS.filter(([, chapter]) => chapter === 2).find(([room]) => setup(2, room).state.room!.hero !== null)!;
    const { renderer, state } = setup(2, withHero[0]);
    const [front, extra, , back] = state.room!.hero!.surfaces;
    expect([...renderer.front.pixels]).toEqual([...renderer.image(front).pixels]);
    expect([...renderer.extra.pixels]).toEqual([...renderer.image(extra).pixels]);
    expect([...renderer.back.pixels]).toEqual([...renderer.image(back).pixels]);
    const plain = ROOM_CHAPTERS.filter(([, chapter]) => chapter === 2).find(([room]) => setup(2, room).state.room!.hero === null)!;
    const defaults = setup(2, plain[0]).renderer;
    expect([...defaults.front.pixels]).toEqual([...defaults.image(96).pixels]);
    expect([...defaults.extra.pixels]).toEqual([...defaults.image(97).pixels]);
  });

  it("les 57 pièces se chargent et se composent dans leur chapitre, avec leur décor", () => {
    expect(ROOM_CHAPTERS.length).toBe(57);
    for (const [room, chapter] of ROOM_CHAPTERS) {
      const { renderer, state, input } = setup(chapter, room);
      state.hero.visible = true;
      renderer.compose(input({ main: true, cursorVisible: true }));
      expect(renderer.screen.pixels.some((pixel) => pixel !== 0), `pièce ${room}`).toBe(true);
    }
  });
});

describe.skipIf(!hasOriginalFiles)("composition d'une image", () => {
  it("sans héros ni mise à jour, l'image est le décor tel quel", () => {
    const { renderer, state, input, data } = setup(1, 62);
    state.hero.visible = false;
    renderer.compose(input());
    // la pièce 62 n'a aucune mise à jour dans `drascula.dat`
    const covered = [...data.dat.roomPreUpdates, ...data.dat.roomUpdates].filter((u) => u.room === 62);
    expect(covered).toHaveLength(0);
    expect(differences(renderer.screen, renderer.bg, 0, 0, 320, 200)).toBe(0);
  });

  it("roomPreUpdates et roomUpdates : un rectangle de la feuille annexe recopié quand le drapeau a la bonne valeur", () => {
    // pièce 3 (chapitre 2) : drapeau 3 à 1, rectangle 23 x 53 pris en (258, 110) de la feuille annexe, posé en (85, 44), copie opaque (type 0)
    const { renderer, state, input } = setup(2, 3);
    state.hero.x = 250;
    state.hero.y = 150;
    state.flags[3] = 0;
    renderer.compose(input());
    const before = differences(renderer.screen, renderer.bg, 85, 44, 23, 53);
    state.flags[3] = 1;
    renderer.compose(input());
    for (const [x, y] of [[0, 0], [22, 0], [0, 52], [22, 52], [11, 26]]) expect(renderer.screen.at(85 + x, 44 + y)).toBe(renderer.draw3.at(258 + x, 110 + y));
    expect(before).toBe(0);
  });

  it("type 1 : copie sans les pixels transparents (pièce 18, drapeau 24)", () => {
    const { renderer, state, input } = setup(2, 18);
    state.hero.x = -500;
    state.flags[24] = 0;
    renderer.compose(input());
    const baseline = new Plane();
    baseline.load(renderer.screen.pixels);
    state.flags[24] = 1;
    renderer.compose(input());
    let checked = 0;
    for (let y = 0; y < 130; y++) {
      for (let x = 0; x < 142; x++) {
        const source = renderer.draw3.at(177 + x, 1 + y);
        if (source !== TRANSPARENT) {
          expect(renderer.screen.at(69 + x, 29 + y)).toBe(source);
          checked++;
        } else {
          expect(renderer.screen.at(69 + x, 29 + y)).toBe(baseline.at(69 + x, 29 + y));
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("le héros est dessiné après roomPreUpdates et avant roomUpdates", () => {
    const { renderer, state, input } = setup(1, 62);
    renderer.painters[1] = {
      62: {
        pre: (r) => r.screen.pixels.fill(1, 0, 320),
        post: (r) => r.screen.pixels.fill(2, 320, 640),
      },
    };
    renderer.compose(input());
    expect(renderer.screen.at(5, 0)).toBe(1);
    expect(renderer.screen.at(5, 1)).toBe(2);
    expect(state.hero.visible).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("héros réduit selon la perspective", () => {
  function heroAt(feetY: number, track: number) {
    const ctx = setup(1, 62);
    const factors = ctx.state.room!.factors!;
    const hero = ctx.state.hero;
    const size = scaledSize(factors[feetY]);
    hero.width = size.width;
    hero.height = size.height;
    hero.x = 120;
    hero.y = feetY - size.height;
    hero.track = track;
    hero.moving = false;
    ctx.renderer.compose(ctx.input());
    return { ...ctx, hero, size, factor: factors[feetY] };
  }

  it("de face : le facteur à l'ordonnée des pieds réduit les 43 x 70 de 96.ALG (rangée 72)", () => {
    const high = heroAt(100, 3);
    const low = heroAt(170, 3);
    expect(high.factor).toBeLessThan(low.factor);
    expect(high.size.height).toBeLessThan(low.size.height);
    for (const { renderer, hero, size, factor } of [high, low]) {
      // le pixel (0, 0) du héros réduit est celui de la source ; la dernière colonne et ligne sont prises à (newW-1) x pas
      const source = renderer.front;
      const stepX = 43 / size.width;
      const stepY = 70 / size.height;
      const sample = (m: number, n: number) => source.at(Math.trunc(m * stepX), 72 + Math.trunc(n * stepY));
      for (const [m, n] of [[0, 0], [size.width - 1, 0], [0, size.height - 1], [size.width - 1, size.height - 1], [size.width >> 1, size.height >> 1]]) {
        const expected = sample(m, n);
        const got = renderer.screen.at(hero.x + m, hero.y + n);
        // un pas qui tombe pile sur une frontière peut différer d'un pixel : on tolère le voisin d'accumulation `float`
        const alternatives = [expected, source.at(Math.trunc(m * stepX) + 1, 72 + Math.trunc(n * stepY)), source.at(Math.trunc(m * stepX) - 1, 72 + Math.trunc(n * stepY))];
        if (expected !== TRANSPARENT) expect(alternatives, `facteur ${factor}`).toContain(got);
      }
      // hors du rectangle réduit, le décor n'est pas touché
      expect(renderer.screen.at(hero.x + size.width, hero.y + size.height)).toBe(renderer.bg.at(hero.x + size.width, hero.y + size.height));
    }
  });

  it("à 100 %, le héros est la source telle quelle, transparent compris", () => {
    const ctx = setup(1, 62);
    const hero = ctx.state.hero;
    Object.assign(hero, { x: 40, y: 20, width: 43, height: 70, track: 3, moving: false });
    ctx.state.room!.factors = new Array<number>(202).fill(100);
    ctx.renderer.compose(ctx.input());
    for (let y = 0; y < 70; y++) {
      for (let x = 0; x < 43; x++) {
        const source = ctx.renderer.front.at(x, 72 + y);
        expect(ctx.renderer.screen.at(40 + x, 20 + y)).toBe(source === TRANSPARENT ? ctx.renderer.bg.at(40 + x, 20 + y) : source);
      }
    }
  });

  it("l'orientation choisit la feuille et la rangée : gauche 97 rangée 0, droite 97 rangée 72, dos 99, face 96", () => {
    const ctx = setup(1, 62);
    ctx.state.room!.factors = new Array<number>(202).fill(100);
    const hero = ctx.state.hero;
    const cases = [
      [0, ctx.renderer.extra, 0],
      [1, ctx.renderer.extra, 72],
      [2, ctx.renderer.back, 72],
      [3, ctx.renderer.front, 72],
    ] as const;
    for (const [track, sheet, row] of cases) {
      Object.assign(hero, { x: 40, y: 20, width: 43, height: 70, track, moving: false });
      ctx.renderer.compose(ctx.input());
      expect(differences(ctx.renderer.screen, ctx.renderer.bg, 40, 20, 43, 70), `orientation ${track}`).toBeGreaterThan(300);
      for (let y = 0; y < 70; y += 7) {
        for (let x = 0; x < 43; x += 5) {
          const source = sheet.at(x, row + y);
          if (source !== TRANSPARENT) expect(ctx.renderer.screen.at(40 + x, 20 + y), `orientation ${track}`).toBe(source);
        }
      }
    }
  });

  it("en marche, l'image prend la colonne frameX de l'image de marche", () => {
    const ctx = setup(1, 62);
    ctx.state.room!.factors = new Array<number>(202).fill(100);
    const hero = ctx.state.hero;
    const frameX = ctx.data.dat.frameX;
    Object.assign(hero, { x: 40, y: 20, width: 43, height: 70, track: 3, moving: true, frame: 3 });
    ctx.renderer.compose(ctx.input());
    let compared = 0;
    for (let y = 0; y < 70; y++) {
      for (let x = 0; x < 43; x++) {
        const source = ctx.renderer.front.at(frameX[3] + x, 72 + y);
        if (source !== TRANSPARENT) {
          expect(ctx.renderer.screen.at(40 + x, 20 + y)).toBe(source);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(300);
  });

  it("héros invisible : rien (sauf aux chapitres 2 et 3) ; chapitre 3 avec le drapeau 0 : l'image fixe de draw3", () => {
    const ctx = setup(1, 62);
    ctx.state.hero.visible = false;
    ctx.state.hero.x = 40;
    ctx.state.hero.y = 20;
    ctx.renderer.compose(ctx.input());
    expect(differences(ctx.renderer.screen, ctx.renderer.bg, 0, 0, 320, 200)).toBe(0);

    const three = setup(3, 20);
    three.state.flags[0] = 1;
    Object.assign(three.state.hero, { x: 150, y: 70 });
    three.renderer.compose(three.input());
    expect(three.renderer.screen.at(150 - 20 + 38, 70 - 1 + 44)).toBe(three.renderer.draw3.at(113 + 38, 54 + 44) === TRANSPARENT ? three.renderer.bg.at(150 - 20 + 38, 70 - 1 + 44) : three.renderer.draw3.at(113 + 38, 54 + 44));
  });

  it("chapitre 2 : taille de la pièce, sans perspective", () => {
    const ctx = setup(2, 14);
    const hero = ctx.state.hero;
    Object.assign(hero, { x: 100, y: 60, width: 39, height: 64, track: 3, moving: false });
    ctx.renderer.compose(ctx.input());
    for (let y = 0; y < 64; y += 3) {
      for (let x = 0; x < 39; x += 2) {
        const source = ctx.renderer.front.at(x, 72 + y);
        expect(ctx.renderer.screen.at(100 + x, 60 + y)).toBe(source === TRANSPARENT ? ctx.renderer.bg.at(100 + x, 60 + y) : source);
      }
    }
  });
});

describe.skipIf(!hasOriginalFiles)("texte et interface", () => {
  it("réplique : texte centré en jaune, mis en page comme centerText", () => {
    const ctx = setup(1, 62);
    ctx.state.hero.visible = false;
    const text = "C'EST LA DEUXIèME PORTE LA PLUS GRANDE QUE J'AI VUE DANS MA VIE.";
    ctx.renderer.compose(ctx.input({ subtitle: { text, x: 150, y: 80, color: TextColor.Yellow } }));
    const lines = layoutCenteredText(text, 150, 80);
    expect(lines.length).toBeGreaterThan(1);
    const expected = new Plane();
    expected.load(ctx.renderer.bg.pixels);
    for (const line of lines) ctx.renderer.font.print(expected, ctx.renderer.table, line.text, line.x, line.y);
    expect(differences(ctx.renderer.screen, expected, 0, 0, 320, 200)).toBe(0);
    expect([...ctx.renderer.palette.shown.subarray(254 * 3, 254 * 3 + 3)]).toEqual([252, 252, 84]);
    // des pixels de texte (254) existent, et uniquement là
    expect(ctx.renderer.screen.pixels.filter((pixel) => pixel === 254).length).toBeGreaterThan(100);
  });

  it("nom survolé : vert clair, centré sur la souris ; rouge pour le héros ; rien dans l'inventaire", () => {
    const ctx = setup(1, 62);
    ctx.state.hero.visible = false;
    Object.assign(ctx.state, { hasName: true, textName: "TAVERNIER", takeObject: true, pickedObject: 1 });
    ctx.renderer.compose(ctx.input({ main: true, mouseX: 130, mouseY: 70 }));
    expect([...ctx.renderer.palette.shown.subarray(254 * 3, 254 * 3 + 3)]).toEqual([0x16 * 4, 0x3f * 4, 0x16 * 4]);
    const line = layoutCenteredText("TAVERNIER", 130, 70)[0];
    const expected = new Plane();
    expected.load(ctx.renderer.bg.pixels);
    ctx.renderer.font.print(expected, ctx.renderer.table, line.text, line.x, line.y);
    expect(differences(ctx.renderer.screen, expected, 0, line.y, 320, 6)).toBe(0);

    ctx.state.textName = ctx.data.text("textmisc", 3);
    ctx.renderer.compose(ctx.input({ main: true, mouseX: 130, mouseY: 70 }));
    expect([...ctx.renderer.palette.shown.subarray(254 * 3, 254 * 3 + 3)]).toEqual([0x38 * 4, 0, 0]);
  });

  it("barre des verbes : sept icônes de 99.ALG, celle sous la souris à la rangée 0", () => {
    const ctx = setup(1, 62);
    ctx.state.hero.visible = false;
    ctx.state.menuBar = true;
    const bar = ctx.data.dat.verbBarX;
    ctx.renderer.compose(ctx.input({ main: true, mouseX: 100, mouseY: 10 }));
    for (let n = 0; n < 7; n++) {
      const row = n === 2 ? 0 : 25; // 100 est entre 96 et 141 : troisième icône
      let seen = 0;
      for (let y = 0; y < 25; y++) {
        for (let x = 0; x < 40; x++) {
          const source = ctx.renderer.cursor.at(40 * n + x, row + y);
          if (source !== TRANSPARENT) {
            expect(ctx.renderer.screen.at(bar[n] + x, 2 + y)).toBe(source);
            seen++;
          }
        }
      }
      expect(seen, `icône ${n}`).toBeGreaterThan(50);
    }
  });

  it("inventaire : fond de la case et icône de l'objet à la place de la case, verbes dans les cases 1 à 6", () => {
    const ctx = setup(1, 62);
    ctx.state.hero.visible = false;
    ctx.state.menuScreen = true;
    for (let n = 1; n <= 6; n++) ctx.state.inventory[n] = n;
    ctx.state.inventory[7] = 28;
    ctx.renderer.compose(ctx.input({ main: true, mouseX: 6, mouseY: 12 }));
    const { itemLocations, menuPoints } = ctx.data.dat;
    const icons = ctx.renderer.sheet(iconsSheet(1));
    for (const [slot, object] of [[1, 1], [6, 6], [7, 28]]) {
      const at = itemLocations[slot];
      const icon = menuPoints[object];
      let compared = 0;
      for (let y = 0; y < 25; y++) {
        for (let x = 0; x < 40; x++) {
          const source = icons.at(icon.x + x, icon.y + y);
          if (source !== TRANSPARENT) {
            expect(ctx.renderer.screen.at(at.x + x, at.y + y), `case ${slot}`).toBe(source);
            compared++;
          }
        }
      }
      expect(compared).toBeGreaterThan(100);
    }
    // la souris sur la case 1 : son nom (textverbs) s'écrit au-dessus
    expect(ctx.renderer.screen.pixels.filter((pixel) => pixel === 254).length).toBeGreaterThan(20);
  });

  it("curseur : l'icône du verbe tenu, ou celle de l'objet de l'inventaire, autour du point chaud (20, 17)", () => {
    const ctx = setup(1, 62);
    ctx.state.hero.visible = false;
    ctx.state.takeObject = true;
    ctx.state.pickedObject = 2;
    ctx.renderer.compose(ctx.input({ cursorVisible: true, mouseX: 200, mouseY: 120 }));
    let compared = 0;
    for (let y = 0; y < 25; y++) {
      for (let x = 0; x < 40; x++) {
        const source = ctx.renderer.cursor.at(80 + x, 171 + y);
        if (source !== TRANSPARENT) {
          expect(ctx.renderer.screen.at(180 + x, 103 + y)).toBe(source);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(50);

    ctx.state.pickedObject = 28;
    ctx.renderer.compose(ctx.input({ cursorVisible: true, mouseX: 200, mouseY: 120 }));
    const icon = ctx.data.dat.menuPoints[28];
    const icons = ctx.renderer.sheet("icons.alg");
    let object = 0;
    for (let y = 0; y < 25; y++) {
      for (let x = 0; x < 40; x++) {
        const source = icons.at(icon.x + x, icon.y + y);
        if (source !== TRANSPARENT) {
          expect(ctx.renderer.screen.at(180 + x, 103 + y)).toBe(source);
          object++;
        }
      }
    }
    expect(object).toBeGreaterThan(50);

    ctx.renderer.compose(ctx.input({ cursorVisible: false, mouseX: 200, mouseY: 120 }));
    expect(differences(ctx.renderer.screen, ctx.renderer.bg, 180, 103, 40, 25)).toBe(0);
  });

  it("fin de chapitre : écran noir et palette noire", () => {
    const { renderer } = setup(1, 62);
    renderer.endChapter();
    expect(renderer.screen.pixels.every((pixel) => pixel === 0)).toBe(true);
    expect(renderer.palette.shown.filter((v) => v !== 0)).toHaveLength(3);
  });
});
