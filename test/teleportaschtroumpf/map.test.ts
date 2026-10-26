import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import type { Scene, SceneContext } from "../../src/games/teleportaschtroumpf/engine/scene";
import type { Game } from "../../src/games/teleportaschtroumpf/game/rules";
import { MAP_CELLS, MAP_LOCATIONS } from "../../src/games/teleportaschtroumpf/game/tables";
import { FreeModeScene, MapScene, createFreeModeScene, createMapScene } from "../../src/games/teleportaschtroumpf/scenes/s02-map";
import { BACK_BUTTON } from "../../src/games/teleportaschtroumpf/scenes/map/map-scene";
import { boundsOf, placeSprite } from "../../src/games/teleportaschtroumpf/engine/sprites";
import {
  MAP_ROWS,
  MAP_SEGMENTS,
  SCROLL_MAX,
  VIEW_TOP,
  cellOfK,
  locationAnchors,
  locationAt,
  markerOfCell,
  moveSelection,
  sceneOfK,
  scrollOfK,
  scrolled,
} from "../../src/games/teleportaschtroumpf/scenes/map/view";
import { TestHost } from "./engine-test-host";
import { advance } from "./game-helpers";
import { hasOriginalFiles } from "./helpers";
import { longPress, swipe, tap, touchDown, touchMove, touchUp } from "./touch";

/** Mini-jeux lancés par le mode libre : le registre est remplacé par une scène qui rend la main sur Espace. */
const launched = vi.hoisted(() => ({ list: [] as { id: number; scene: number | undefined; level: number }[] }));
vi.mock("../../src/games/teleportaschtroumpf/scenes/minigames", () => ({
  createMinigame: (id: number, game: Game, onDone: (ctx: SceneContext, outcome: { kind: "none" }) => void): Scene => {
    launched.list.push({ id, scene: game.state.pending?.scene, level: game.state.pending?.level ?? -1 });
    return {
      step: 1,
      enter: () => undefined,
      update: (ctx) => {
        if (ctx.input.justPressed("validate")) onDone(ctx, { kind: "none" });
      },
      render: () => undefined,
    };
  },
}));

describe("carte S02 : tables et géométrie (pur)", () => {
  it("le fond défilant fait 481 lignes et la fenêtre atteint son bas au décalage maximal", () => {
    expect(MAP_SEGMENTS.reduce((sum, s) => sum + s.rows, 0)).toBe(MAP_ROWS);
    expect(SCROLL_MAX + 170).toBe(MAP_ROWS);
  });

  it("lieux : retour = case 1, puis les cases de MAP_LOCATIONS ; scène = table de l'exécutable", () => {
    expect(cellOfK(1)).toBe(1);
    expect(sceneOfK(1)).toBeUndefined();
    for (const loc of MAP_LOCATIONS) {
      expect(cellOfK(loc.k)).toBe(loc.cell);
      expect(sceneOfK(loc.k)).toBe(loc.scene);
    }
    expect(() => cellOfK(19)).toThrow(RangeError);
  });

  it("décalage : bas pour k < 5, centré (y − 0x78) de 5 à 16, haut pour 17 et 18", () => {
    for (const k of [1, 2, 3, 4]) expect(scrollOfK(k)).toBe(SCROLL_MAX);
    expect(scrollOfK(5)).toBe(MAP_CELLS[10][1] - 0x78);
    expect(scrollOfK(16)).toBe(MAP_CELLS[40][1] - 0x78);
    for (const k of [17, 18]) expect(scrollOfK(k)).toBe(0);
    for (let k = 1; k <= 18; k++) {
      expect(scrollOfK(k)).toBeGreaterThanOrEqual(0);
      expect(scrollOfK(k)).toBeLessThanOrEqual(SCROLL_MAX);
    }
  });

  it("le marqueur est dans la fenêtre pour chaque lieu et la zone 54 lit la mine", () => {
    for (let k = 1; k <= 18; k++) {
      const { footY } = markerOfCell(cellOfK(k));
      expect(footY).toBeGreaterThanOrEqual(scrollOfK(k) + 40);
      expect(footY).toBeLessThanOrEqual(scrollOfK(k) + 169);
    }
    expect(markerOfCell(54)).toEqual(markerOfCell(53));
    expect(markerOfCell(53)).toEqual({ x: 273 - 30, footY: 85 - 20, sprite: 1 });
  });

  it("sélection bornée, défilement borné", () => {
    expect(moveSelection(18, 1, 1)).toBe(18);
    expect(moveSelection(1, -1, 1)).toBe(1);
    expect(moveSelection(2, -1, 2)).toBe(2);
    expect(moveSelection(5, 1, 1)).toBe(6);
    expect(scrolled(3, -5)).toBe(0);
    expect(scrolled(SCROLL_MAX - 2, 5)).toBe(SCROLL_MAX);
  });
});

async function launch(scene: Scene, { audio = false } = {}) {
  const host = new TestHost();
  host.audio.enabled = audio;
  const engine = new Engine(host, { seed: 7 });
  await engine.start(scene);
  await advance(engine, host, 600);
  const press = async (code: string, ms = 120) => {
    host.input.keyDown(code);
    await advance(engine, host, ms);
    host.input.keyUp(code);
    await advance(engine, host, 120);
  };
  const top = () => engine.ctx.scenes.top?.constructor.name;
  const idle = async () => {
    while (engine.loading || engine.ctx.scenes.transitioning || engine.ctx.fade.active) await advance(engine, host, 50);
    await advance(engine, host, 200);
  };
  return { host, engine, press, top, idle };
}

describe.skipIf(!hasOriginalFiles)("carte S02 : consultation (202)", () => {
  it("affiche la zone du pion, défile par pas de 5 pixels sans dépasser 0 et 311, et rend k = 1 sur Espace", async () => {
    const results: number[] = [];
    const map = new MapScene({ mode: "consult", zone: 5 }, (_c, k) => results.push(k));
    const t = await launch(map);
    expect(t.host.loaded.some((f) => /S02A002D\.MCG/i.test(f))).toBe(true);
    expect(map.scrollOffset).toBe(0);
    // Le marqueur de la case 5 (129, 455) n'est pas dans la fenêtre de départ : il est peint dans le fond, plus bas.
    const marker = markerOfCell(5);
    expect(map.mapPixel(marker.x - 10, marker.footY - 20)).toBeDefined();

    t.host.input.keyDown("ArrowDown");
    await advance(t.engine, t.host, 4000);
    t.host.input.keyUp("ArrowDown");
    expect(map.scrollOffset).toBe(SCROLL_MAX);
    t.host.input.keyDown("ArrowUp");
    await advance(t.engine, t.host, 300);
    t.host.input.keyUp("ArrowUp");
    expect(map.scrollOffset % 5).toBe(SCROLL_MAX % 5);
    expect(map.scrollOffset).toBeLessThan(SCROLL_MAX);
    t.host.input.keyDown("KeyQ");
    await advance(t.engine, t.host, 5000);
    t.host.input.keyUp("KeyQ");
    expect(map.scrollOffset).toBe(0);

    await t.press("Enter"); // pas d'aide en consultation
    expect(results).toEqual([]);
    await t.press("Space");
    expect(results).toEqual([1]);
  }, 60_000);

  it("la fenêtre de l'écran montre les lignes du fond à partir du décalage (marqueur compris)", async () => {
    const map = new MapScene({ mode: "consult", zone: 53 }, () => undefined);
    const t = await launch(map);
    // Zone 53 = la mine (273, 85) : marqueur dans la fenêtre de départ ; chaque ligne de l'écran 6..175 reprend le fond.
    const shown = t.host.lastPresentation.surface;
    for (const row of [0, 40, 100, 169]) {
      for (const x of [0, 150, 319]) expect(shown[(6 + row) * 320 + x]).toBe(map.mapPixel(x, row));
    }
    t.host.input.keyDown("ArrowDown");
    await advance(t.engine, t.host, 500);
    t.host.input.keyUp("ArrowDown");
    await advance(t.engine, t.host, 100);
    const scrolledShown = t.host.lastPresentation.surface;
    for (const x of [0, 150, 319]) expect(scrolledShown[(6 + 60) * 320 + x]).toBe(map.mapPixel(x, map.scrollOffset + 60));
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("carte S02 : sélection (mode libre et puits)", () => {
  it("haut / bas changent de lieu, bornés à 1..18, avec le bon décalage ; Espace rend k", async () => {
    const results: number[] = [];
    const map = new MapScene({ mode: "free" }, (_c, k) => results.push(k));
    const t = await launch(map);
    expect(t.host.loaded.some((f) => /S02A001D\.MCG/i.test(f))).toBe(true);
    expect(map.selection).toBe(1);
    expect(map.scrollOffset).toBe(SCROLL_MAX);
    await t.press("ArrowDown");
    expect(map.selection).toBe(1);
    for (let n = 1; n <= 7; n++) await t.press("ArrowUp");
    expect(map.selection).toBe(8);
    expect(map.scrollOffset).toBe(scrollOfK(8));
    await t.press("KeyA");
    expect(map.selection).toBe(7);
    for (let n = 0; n < 20; n++) await t.press("KeyQ", 60);
    expect(map.selection).toBe(18);
    expect(map.scrollOffset).toBe(0);
    expect(results).toEqual([]);
    await t.press("Space");
    expect(results).toEqual([18]);
  }, 120_000);

  it("le bip de navigation (s07a001b) accompagne chaque changement de lieu, pas une butée", async () => {
    const t = await launch(new MapScene({ mode: "free" }, () => undefined), { audio: true });
    const beep = (await t.engine.ctx.resources.voc("s07a001b.voc")).samples;
    const before = t.host.audio.effects.length;
    await t.press("ArrowDown"); // butée basse
    expect(t.host.audio.effects.length).toBe(before);
    await t.press("ArrowUp");
    expect(t.host.audio.effects.length).toBe(before + 1);
    expect(t.host.audio.effects.at(-1)?.sound.samples).toBe(beep);
  }, 60_000);

  it("Entrée joue la voix d'aide s45v du lieu ; rien sur « retour »", async () => {
    const t = await launch(new MapScene({ mode: "free" }, () => undefined), { audio: true });
    const plays = () => t.host.audio.plays.length;
    const start = plays();
    await t.press("Enter");
    expect(plays()).toBe(start);
    await t.press("ArrowUp"); // lieu 2 = scène 23
    const afterBeep = plays();
    await t.press("Enter");
    expect(plays()).toBe(afterBeep + 1);
    const voice = (await t.engine.ctx.resources.voc("s45v023t.voc")).samples;
    expect(t.host.audio.plays.at(-1)?.sound.samples).toBe(voice);
  }, 60_000);

  it("puits : démarre sur le premier lieu, pas de retour dans la sélection, sortie d'office à 36 s avec k = 1", async () => {
    const results: number[] = [];
    const map = new MapScene({ mode: "wish" }, (_c, k) => results.push(k));
    const t = await launch(map);
    expect(t.host.loaded.some((f) => /S02A007D\.MCG/i.test(f))).toBe(true);
    expect(map.selection).toBe(2);
    await t.press("ArrowDown");
    expect(map.selection).toBe(2);
    await t.press("Enter"); // pas d'aide au puits
    expect(map.stage).toBe("browse");
    await advance(t.engine, t.host, 34_000);
    expect(results).toEqual([]);
    await advance(t.engine, t.host, 3_000);
    expect(results).toEqual([1]);
  }, 120_000);

  it("puits : Espace rend le lieu choisi", async () => {
    const results: number[] = [];
    const t = await launch(new MapScene({ mode: "wish" }, (_c, k) => results.push(k)));
    await t.press("ArrowUp");
    await t.press("ArrowUp");
    await t.press("Space");
    expect(results).toEqual([4]);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("mode libre « Schtroumpf »", () => {
  it("chaque lieu lance le mini-jeu de la table, puis la carte revient sur le même lieu ; k = 1 rend la main", async () => {
    launched.list.length = 0;
    let done = false;
    const free = createFreeModeScene(() => (done = true)) as FreeModeScene;
    const t = await launch(free);
    expect(t.top()).toBe("FreeModeScene");
    for (const loc of MAP_LOCATIONS) {
      await t.press("ArrowUp");
      expect(free.shown.selection).toBe(loc.k);
      await t.press("Space");
      await t.idle();
      expect(launched.list.at(-1)).toMatchObject({ id: loc.scene, scene: loc.scene });
      expect(free.stage).toBe("minigame");
      await t.press("Space"); // le mini-jeu (remplacé) rend la main
      await t.idle();
      expect(t.top()).toBe("FreeModeScene");
      expect(free.stage).toBe("map");
      expect(free.shown.selection).toBe(loc.k);
      expect(free.shown.scrollOffset).toBe(scrollOfK(loc.k));
    }
    expect(launched.list.map((l) => l.id)).toEqual(MAP_LOCATIONS.map((l) => l.scene));
    expect(launched.list.every((l) => l.level >= 0 && l.level <= 2)).toBe(true);
    expect(done).toBe(false);
    for (let k = 18; k > 1; k--) await t.press("ArrowDown", 60);
    expect(free.shown.selection).toBe(1);
    await t.press("Space");
    expect(done).toBe(true);
  }, 300_000);

  it("la voix d'accroche sNNa est jouée avant le mini-jeu", async () => {
    launched.list.length = 0;
    const free = createFreeModeScene(() => undefined) as FreeModeScene;
    const t = await launch(free, { audio: true });
    await t.press("ArrowUp"); // lieu 2 = scène 23
    await t.press("Space");
    expect(launched.list).toEqual([]);
    await t.idle();
    const voices = await Promise.all(["s23a001t.voc", "s23a002t.voc"].map((n) => t.engine.ctx.resources.voc(n)));
    expect(voices.some((v) => t.host.audio.plays.some((p) => p.sound.samples === v.samples))).toBe(true);
    await advance(t.engine, t.host, 15_000);
    await t.idle();
    expect(launched.list).toHaveLength(1);
  }, 120_000);

  it("createMapScene rend une carte indépendante du mode libre", () => {
    expect(createMapScene({ mode: "free" }, () => undefined)).toBeInstanceOf(MapScene);
  });
});

describe.skipIf(!hasOriginalFiles)("carte S02 : au doigt", () => {
  /** Point de l'écran sur le lieu `k` (milieu du segment marqueur → case), pour le décalage courant de la carte. */
  async function spot(t: Awaited<ReturnType<typeof launch>>, map: MapScene, k: number) {
    const sprites = await t.engine.ctx.resources.hy8("s02a000s.hy8");
    const a = locationAnchors((sprite) => boundsOf(placeSprite(sprites, sprite, false))).find((l) => l.k === k)!;
    return { x: Math.round((a.mx + a.cx) / 2), y: Math.round((a.my + a.cy) / 2) - map.scrollOffset + VIEW_TOP };
  }
  const gesture = async (t: Awaited<ReturnType<typeof launch>>, act: () => void) => {
    act();
    await advance(t.engine, t.host, 200);
  };

  it("chaque lieu a sa zone : le milieu de son segment le désigne, sans ambiguïté", async () => {
    const t = await launch(new MapScene({ mode: "free" }, () => undefined));
    const sprites = await t.engine.ctx.resources.hy8("s02a000s.hy8");
    const anchors = locationAnchors((sprite) => boundsOf(placeSprite(sprites, sprite, false)));
    for (const a of anchors) expect(locationAt(anchors, (a.mx + a.cx) / 2, (a.my + a.cy) / 2, 1)).toBe(a.k);
    // Puits : la maison (retour) ne compte pas.
    const back = anchors[0];
    expect(locationAt(anchors, back.mx, back.my, 2)).toBeNull();
  }, 60_000);

  it("mode libre : toucher un lieu y va ; le doigt qui se pose seul ne valide rien", async () => {
    const results: number[] = [];
    const map = new MapScene({ mode: "free" }, (_c, k) => results.push(k));
    const t = await launch(map);
    const { x, y } = await spot(t, map, 3);
    touchDown(t.host.input, x, y);
    await advance(t.engine, t.host, 200);
    expect(results).toEqual([]);
    touchUp(t.host.input, x, y);
    await advance(t.engine, t.host, 200);
    expect(results).toEqual([3]);
    expect(map.selection).toBe(3);
  }, 60_000);

  it("mode libre : toucher la maison rend « retour » ; toucher hors d'un lieu ou hors de la fenêtre ne fait rien", async () => {
    const results: number[] = [];
    const map = new MapScene({ mode: "free" }, (_c, k) => results.push(k));
    const t = await launch(map);
    const sprites = await t.engine.ctx.resources.hy8("s02a000s.hy8");
    const anchors = locationAnchors((sprite) => boundsOf(placeSprite(sprites, sprite, false)));
    // Un point de la fenêtre loin de tout lieu.
    let empty: { x: number; y: number } | null = null;
    for (let y = VIEW_TOP; y < VIEW_TOP + 170 && !empty; y += 5) {
      for (let x = 0; x < 320 && !empty; x += 5) if (locationAt(anchors, x, y - VIEW_TOP + map.scrollOffset, 1) === null) empty = { x, y };
    }
    await gesture(t, () => tap(t.host.input, empty!.x, empty!.y));
    await gesture(t, () => tap(t.host.input, 160, 190)); // cadre
    expect(results).toEqual([]);
    expect(map.selection).toBe(1);
    const house = await spot(t, map, 1);
    await gesture(t, () => tap(t.host.input, house.x, house.y));
    expect(results).toEqual([1]);
  }, 60_000);

  it("mode libre : l'appui long sur un lieu le sélectionne et dit sa voix d'aide, un geste la coupe ; rien sur la maison", async () => {
    const results: number[] = [];
    const map = new MapScene({ mode: "free" }, (_c, k) => results.push(k));
    const t = await launch(map, { audio: true });
    const plays = () => t.host.audio.plays.length;
    const house = await spot(t, map, 1);
    const before = plays();
    await gesture(t, () => longPress(t.host.input, house.x, house.y));
    expect(plays()).toBe(before);
    expect(map.stage).toBe("browse");
    const cake = await spot(t, map, 2);
    await gesture(t, () => longPress(t.host.input, cake.x, cake.y));
    expect(map.selection).toBe(2);
    expect(map.stage).toBe("voice");
    expect(t.host.audio.plays.at(-1)?.sound.samples).toBe((await t.engine.ctx.resources.voc("s45v023t.voc")).samples);
    await gesture(t, () => tap(t.host.input, cake.x, cake.y)); // coupe la voix sans valider
    expect(map.stage).toBe("browse");
    expect(results).toEqual([]);
  }, 60_000);

  it("glisser fait défiler la carte (doigt suivi image par image, ou d'un coup au relâchement), puis on touche un lieu du haut", async () => {
    const results: number[] = [];
    const map = new MapScene({ mode: "free" }, (_c, k) => results.push(k));
    const t = await launch(map);
    expect(map.scrollOffset).toBe(SCROLL_MAX);
    // Doigt tenu : la carte ne bouge pas sous le seuil, puis suit le doigt (vers le bas = haut de la carte).
    touchDown(t.host.input, 160, 40);
    await advance(t.engine, t.host, 100);
    touchMove(t.host.input, 160, 46);
    await advance(t.engine, t.host, 100);
    expect(map.scrollOffset).toBe(SCROLL_MAX);
    touchMove(t.host.input, 160, 140);
    await advance(t.engine, t.host, 100);
    expect(map.scrollOffset).toBe(SCROLL_MAX - 100);
    touchUp(t.host.input, 160, 140);
    await advance(t.engine, t.host, 100);
    expect(map.scrollOffset).toBe(SCROLL_MAX - 100);
    // Glissement d'un coup, borné en haut.
    await gesture(t, () => swipe(t.host.input, 160, 20, 0, 150));
    expect(map.scrollOffset).toBe(SCROLL_MAX - 250);
    await gesture(t, () => swipe(t.host.input, 160, 20, 0, 150));
    expect(map.scrollOffset).toBe(0);
    expect(results).toEqual([]);
    const mine = await spot(t, map, 18);
    await gesture(t, () => tap(t.host.input, mine.x, mine.y));
    expect(results).toEqual([18]);
  }, 60_000);

  it("puits : toucher un lieu le rend ; la maison et l'appui long ne font rien", async () => {
    const results: number[] = [];
    const map = new MapScene({ mode: "wish" }, (_c, k) => results.push(k));
    const t = await launch(map);
    const house = await spot(t, map, 1);
    await gesture(t, () => tap(t.host.input, house.x, house.y));
    const cake = await spot(t, map, 2);
    await gesture(t, () => longPress(t.host.input, cake.x, cake.y));
    expect(map.stage).toBe("browse");
    expect(results).toEqual([]);
    const next = await spot(t, map, 4);
    await gesture(t, () => tap(t.host.input, next.x, next.y));
    expect(results).toEqual([4]);
  }, 60_000);

  it("consultation : glisser fait défiler, toucher la carte ne fait rien, toucher « Retour » sort", async () => {
    const results: number[] = [];
    const map = new MapScene({ mode: "consult", zone: 5 }, (_c, k) => results.push(k));
    const t = await launch(map);
    await gesture(t, () => swipe(t.host.input, 160, 150, 0, -100));
    expect(map.scrollOffset).toBe(100);
    await gesture(t, () => tap(t.host.input, 160, 100));
    await gesture(t, () => longPress(t.host.input, 160, 185));
    expect(results).toEqual([]);
    await gesture(t, () => tap(t.host.input, (BACK_BUTTON.x0 + BACK_BUTTON.x1) / 2, 189));
    expect(results).toEqual([1]);
  }, 60_000);
});
