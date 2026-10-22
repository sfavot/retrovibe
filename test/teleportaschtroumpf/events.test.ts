import { describe, expect, it } from "vitest";
import { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import { expandName } from "../../src/games/teleportaschtroumpf/engine/paths";
import { BorlandRandom } from "../../src/games/teleportaschtroumpf/engine/rng";
import type { Scene } from "../../src/games/teleportaschtroumpf/engine/scene";
import { Game, newGame, type GameEvent } from "../../src/games/teleportaschtroumpf/game/rules";
import { hasIngredient } from "../../src/games/teleportaschtroumpf/game/state";
import type { MinigameOutcome } from "../../src/games/teleportaschtroumpf/game/state";
import { HAZARDS, WISH_DESTINATIONS, type Position } from "../../src/games/teleportaschtroumpf/game/tables";
import { BoardEventScene, approachX, createBoardEventScene, createWellScene } from "../../src/games/teleportaschtroumpf/scenes/events";
import { pickClip } from "../../src/games/teleportaschtroumpf/scenes/events/clips";
import { SPOKEN_OFFSET, WELL_SLOTS, WellScene } from "../../src/games/teleportaschtroumpf/scenes/events/well";
import { TestHost } from "./engine-test-host";
import { Session, advance, advanceUntil } from "./game-helpers";
import { hasOriginalFiles, listData } from "./helpers";

type Hazard = Extract<GameEvent, { type: "hazard" }>;
type Release = Extract<GameEvent, { type: "release" }>;

function oneGame(seed = 7): Game {
  return newGame({ players: [{ character: 0 }] }, new BorlandRandom(seed));
}

function pos(screen: number, row: "top" | "bottom", x: number): Position {
  return { screen, row, x };
}

const hazard = (kind: Hazard["kind"], scene: number, from: Position, to: Position): Hazard => ({ type: "hazard", player: 0, kind, scene, from, to });
const release = (from: Release["from"]): Release => ({ type: "release", player: 0, from });

async function launch(scene: Scene, audio = false) {
  const host = new TestHost();
  host.audio.enabled = audio;
  const engine = new Engine(host, { seed: 7 });
  await engine.start(scene);
  return { host, engine };
}

const muxPath = (name: string) => expandName(name)!.replace(/^DATA\//, "");

describe("choix de la vidéo et de la voix (pur)", () => {
  const rng = () => new BorlandRandom(3);

  it("chaque événement de HAZARDS a ses deux vidéos, selon le côté d'où arrive le pion", () => {
    for (const h of HAZARDS) {
      const range = h.walk ?? h.press ?? h.dwell ?? h.counted!;
      const to = h.effect.kind === "teleport" ? h.effect.to : pos(h.screen, h.row, 0);
      const left = pickClip(hazard(h.kind, h.scene, pos(h.screen, h.row, range[0]), to), pos(h.screen, h.row, range[0]), to, true, rng());
      const right = pickClip(hazard(h.kind, h.scene, pos(h.screen, h.row, range[1]), to), pos(h.screen, h.row, range[1]), to, true, rng());
      expect(left, `${h.kind} ${h.screen}${h.row}`).not.toBeNull();
      expect(right).not.toBeNull();
      expect(left!.video).toMatch(new RegExp(`^s${h.scene}[a-o]\\.mux$`));
      if (h.kind !== "rocket") expect(left!.video).not.toBe(right!.video);
      else expect(left!.video).toBe(right!.video);
    }
  });

  it("la frontière est le point d'arrêt : x ≤ cible → vidéo a, au-delà → vidéo b", () => {
    const from = (x: number) => pos(4, "bottom", x);
    const to = pos(9, "top", 0x10);
    const at = (x: number) => pickClip(hazard("trap", 15, from(x), to), from(x), to, true, rng())!.video;
    expect(at(0xad)).toBe("s15a.mux");
    expect(at(0xae)).toBe("s15b.mux");
    expect(approachX(hazard("trap", 15, from(0xa0), to), from(0xa0), to)).toBe(0xad);
  });

  it("les pièges d'un même écran se distinguent par l'écran d'arrivée", () => {
    const from = pos(8, "top", 0x40);
    const video = (to: Position) => pickClip(hazard("trap", 15, from, to), from, to, true, rng())!.video;
    expect(video(pos(7, "top", 0x10))).toBe("s15i.mux");
    expect(video(pos(5, "top", 0x10))).toBe("s15k.mux");
    expect(video(pos(3, "bottom", 0x75))).toBe("s15m.mux");
  });

  it("voix : préfixe et plage de numéros de chaque routine", () => {
    const voices = (h: Hazard, to: Position) => new Set(Array.from({ length: 80 }, (_, i) => pickClip(h, h.from, to, true, new BorlandRandom(i * 104729))!.voice));
    const at = pos(4, "bottom", 0xa0);
    const trap = voices(hazard("trap", 15, at, pos(9, "top", 0x10)), pos(9, "top", 0x10));
    expect([...trap].sort()).toEqual(["s15a001t.voc", "s15a002t.voc", "s15a003t.voc", "s15a004t.voc"]);
    const bridge = voices(hazard("bridge", 16, pos(7, "bottom", 0x80), pos(8, "bottom", 0x10)), pos(8, "bottom", 0x10));
    expect([...bridge].sort()).toEqual(["s16a001t.voc", "s16a002t.voc", "s16a003t.voc"]);
    const jail = pickClip(hazard("jail", 20, pos(3, "bottom", 0xa0), pos(3, "bottom", 0xac)), pos(3, "bottom", 0xa0), pos(3, "bottom", 0xac), true, rng());
    expect(jail?.voice).toBeNull();
    const well = pickClip(hazard("wellDoor", 13, pos(4, "top", 0xe0), pos(4, "top", 0x116)), pos(4, "top", 0xe0), pos(4, "top", 0x116), true, rng());
    expect(well).toMatchObject({ video: "s13a.mux", voice: null });
  });

  it("libérations : prison par écran, Turlusiphon selon le regard", () => {
    const jails: Record<number, string> = { 3: "s20c", 5: "s20f", 7: "s20i", 8: "s20l", 9: "s20o" };
    for (const [screen, file] of Object.entries(jails)) {
      const at = pos(Number(screen), "bottom", 0x40);
      expect(pickClip(release("jail"), at, at, true, rng())?.video).toBe(`${file}.mux`);
    }
    const siphons: Record<number, [string, string]> = { 3: ["s21b", "s21d"], 5: ["s21f", "s21h"], 6: ["s21j", "s21l"] };
    for (const [screen, [right, left]] of Object.entries(siphons)) {
      const at = pos(Number(screen), "bottom", 0x40);
      expect(pickClip(release("turlusiphon"), at, at, true, rng())?.video).toBe(`${right}.mux`);
      expect(pickClip(release("turlusiphon"), at, at, false, rng())?.video).toBe(`${left}.mux`);
    }
    const nowhere = pos(1, "top", 0x10);
    expect(pickClip(release("jail"), nowhere, nowhere, true, rng())).toBeNull();
  });

  it.skipIf(!hasOriginalFiles)("toutes les vidéos et voix existent dans les données du jeu", () => {
    const present = new Set(listData(() => true).map((p) => p.toUpperCase()));
    const videos = new Set<string>();
    const voices = new Set<string>();
    const all: EventRequestPair[] = [];
    for (const h of HAZARDS) {
      const range = h.walk ?? h.press ?? h.dwell ?? h.counted!;
      const to = h.effect.kind === "teleport" ? h.effect.to : pos(h.screen, h.row, 0);
      for (const x of range) all.push([hazard(h.kind, h.scene, pos(h.screen, h.row, x), to), pos(h.screen, h.row, x), to]);
    }
    for (const screen of [3, 5, 7, 8, 9]) all.push([release("jail"), pos(screen, "bottom", 0), pos(screen, "bottom", 0)]);
    for (const screen of [3, 5, 6]) all.push([release("turlusiphon"), pos(screen, "bottom", 0), pos(screen, "bottom", 0)]);
    for (const [event, before, after] of all) {
      for (const facing of [true, false]) {
        for (let seed = 0; seed < 30; seed++) {
          const clip = pickClip(event, before, after, facing, new BorlandRandom(seed * 104729))!;
          videos.add(clip.video);
          if (clip.voice) voices.add(clip.voice);
        }
      }
    }
    for (const video of videos) expect(present.has(muxPath(video).toUpperCase()), video).toBe(true);
    // `s17a004t` et `s18a004t` n'existent pas : l'original les demande aussi (tirage 1 à 4 pour 3 fichiers), la voix est alors muette.
    const missing = [...voices].filter((v) => !present.has(muxPath(v).toUpperCase()));
    expect(missing.sort()).toEqual(["s17a004t.voc", "s18a004t.voc"]);
    // Les 54 vidéos S13 à S21 : 6 + 2 + 14 + 2 + 1 + 2 + 15 + 12, soit toutes celles de ces scènes.
    expect(videos.size).toBe(54);
  });
});

type EventRequestPair = [Hazard | Release, Position, Position];

describe.skipIf(!hasOriginalFiles)("BoardEventScene : la vidéo de l'événement, la voix, puis la main est rendue", () => {
  const cases: [string, Hazard | Release, Position, Position, string, RegExp | null | undefined][] = [
    ["piège S15 (arrivée par la gauche)", hazard("trap", 15, pos(4, "bottom", 0xa0), pos(9, "top", 0x10)), pos(4, "bottom", 0xa0), pos(9, "top", 0x10), "S15/S15A/S15A.MUX", /S15A00[1-4]T\.VOC/],
    ["piège S15 (arrivée par la droite)", hazard("trap", 15, pos(4, "bottom", 0xb8), pos(9, "top", 0x10)), pos(4, "bottom", 0xb8), pos(9, "top", 0x10), "S15/S15B/S15B.MUX", /S15A00[1-4]T\.VOC/],
    ["lac S18", hazard("ice", 18, pos(4, "bottom", 0x110), pos(6, "bottom", 0x10)), pos(4, "bottom", 0x110), pos(6, "bottom", 0x10), "S18/S18B/S18B.MUX", undefined],
    ["pont S16", hazard("bridge", 16, pos(7, "bottom", 0x80), pos(8, "bottom", 0x10)), pos(7, "bottom", 0x80), pos(8, "bottom", 0x10), "S16/S16A/S16A.MUX", /S16A00[1-3]T\.VOC/],
    ["fusée S17", hazard("rocket", 17, pos(6, "bottom", 0xa0), pos(2, "bottom", 0x10)), pos(6, "bottom", 0xa0), pos(2, "bottom", 0x10), "S17/S17A/S17A.MUX", undefined],
    ["puits S14", hazard("wellFall", 14, pos(2, "top", 0x110), pos(5, "bottom", 0xde)), pos(2, "top", 0x110), pos(5, "bottom", 0xde), "S14/S14B/S14B.MUX", /S14A00[1-4]T\.VOC/],
    ["prison S20", hazard("jail", 20, pos(3, "bottom", 0xa0), pos(3, "bottom", 0xac)), pos(3, "bottom", 0xa0), pos(3, "bottom", 0xac), "S20/S20A/S20A.MUX", null],
    ["Turlusiphon S21", hazard("turlusiphon", 21, pos(3, "bottom", 0x105), pos(3, "bottom", 0x109)), pos(3, "bottom", 0x105), pos(3, "bottom", 0x109), "S21/S21A/S21A.MUX", /S21V00[1-3]T\.VOC/],
    ["porte du puits S13", hazard("wellDoor", 13, pos(6, "top", 0x20), pos(6, "top", 0x41)), pos(6, "top", 0x20), pos(6, "top", 0x41), "S13/S13C/S13C.MUX", null],
    ["libération de la prison", release("jail"), pos(5, "bottom", 0x106), pos(5, "bottom", 0x106), "S20/S20F/S20F.MUX", null],
    ["libération du Turlusiphon", release("turlusiphon"), pos(6, "bottom", 0x100), pos(6, "bottom", 0x100), "S21/S21J/S21J.MUX", null],
  ];

  it.each(cases)("%s", async (_name, event, before, after, video, voice) => {
    const game = oneGame();
    game.player.facingRight = true;
    let done = false;
    const scene = createBoardEventScene({ game, event, before, after }, () => (done = true));
    const { host, engine } = await launch(scene);
    await advanceUntil(engine, host, () => done, 60_000);
    expect(host.loaded.map((f) => f.toUpperCase())).toContain(`DATA/${video}`);
    const voices = host.loaded.filter((f) => /\.VOC$/i.test(f) && !/S52M|S52D|S01A00/i.test(f));
    // `undefined` : voix tirée parmi 4 pour 3 fichiers (S17, S18), éventuellement muette.
    if (voice) expect(voices.some((f) => voice.test(f))).toBe(true);
    else if (voice === null) expect(voices).toEqual([]);
    expect((scene as BoardEventScene).clipInfo?.video).toBe(video.split("/")[2].toLowerCase());
  }, 60_000);

  it("la vidéo n'est pas passable (Échap, Espace) mais dure sa durée", async () => {
    const game = oneGame();
    const at = pos(4, "bottom", 0xa0);
    let done = false;
    const { host, engine } = await launch(createBoardEventScene({ game, event: hazard("trap", 15, at, pos(9, "top", 0x10)), before: at, after: pos(9, "top", 0x10) }, () => (done = true)));
    await advance(engine, host, 300);
    for (const key of ["Escape", "Space", "Enter"]) {
      host.input.keyDown(key);
      await advance(engine, host, 100);
      host.input.keyUp(key);
    }
    expect(done).toBe(false);
    await advanceUntil(engine, host, () => done, 60_000);
  }, 60_000);

  it("la voix finit l'événement : la main n'est rendue qu'à la fin du son", async () => {
    const game = oneGame();
    const at = pos(7, "bottom", 0x80);
    const to = pos(8, "bottom", 0x10);
    let done = false;
    const { host, engine } = await launch(createBoardEventScene({ game, event: hazard("bridge", 16, at, to), before: at, after: to }, () => (done = true)), true);
    // La vidéo a son propre son : le second son lancé est la voix.
    await advanceUntil(engine, host, () => host.audio.plays.length >= 2, 60_000);
    expect(host.loaded.some((f) => /S16A00[1-3]T\.VOC/i.test(f))).toBe(true);
    expect(host.audio.playing).toBe(true);
    expect(done).toBe(false);
    await advanceUntil(engine, host, () => done, 60_000);
    expect(host.audio.playing).toBe(false);
  }, 90_000);

  it("combinaison inconnue : rend la main sans rien jouer", async () => {
    const game = oneGame();
    const at = pos(1, "top", 0x10);
    let done = false;
    const { host, engine } = await launch(createBoardEventScene({ game, event: release("jail"), before: at, after: at }, () => (done = true)));
    await advance(engine, host, 200);
    expect(done).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("partie : les événements sont joués sur le plateau", () => {
  it("piège de marche : vidéo, puis le pion arrive à l'écran 9", async () => {
    const s = await Session.start();
    await s.ready();
    s.place(pos(4, "bottom", 0x90));
    s.host.input.keyDown("ArrowRight");
    await s.settle("BoardEventScene");
    s.host.input.keyUp("ArrowRight");
    expect(s.host.loaded.some((f) => /S15[AB]\.MUX/i.test(f))).toBe(true);
    await s.ready();
    expect(s.game.player).toMatchObject({ screen: 9, row: "top" });
    expect(s.board.shown).toMatchObject({ screen: 9, row: "top" });
  }, 90_000);

  it("prison : animation de la cage, tour passé, libération animée (S20)", async () => {
    const s = await Session.start();
    await s.ready();
    s.place(pos(3, "bottom", 0xa0));
    s.setElapsedTurn(15);
    await s.settle("BoardEventScene");
    expect(s.host.loaded.some((f) => /S20[AB]\.MUX/i.test(f))).toBe(true);
    await s.until(() => s.board.shown.look === "jail");
    await s.settle("BoardEventScene"); // libération
    expect(s.host.loaded.some((f) => /S20C\.MUX/i.test(f))).toBe(true);
    await s.ready();
    expect(s.game.player.status).toBe(0);
  }, 180_000);

  it("puits ouvert : animation de la porte (S13), puis le puits interactif", async () => {
    const s = await Session.start();
    await s.ready();
    s.game.state.turn.wellOpen = true;
    s.place(pos(4, "top", 0xe0));
    await s.tap("Space");
    await s.settle("BoardEventScene");
    expect(s.host.loaded.some((f) => /S13[AB]\.MUX/i.test(f))).toBe(true);
    // Le puits (voyage ou ingrédient, tiré au hasard) est joué ; sans son, la voix passe vite, mais ni la carte (36 s sans choix)
    // ni le choix d'ingrédient (36 s aussi) ne se terminent seuls avant leur délai.
    await s.until(() => s.history.includes("WellScene"));
    await s.ready();
    expect(s.game.state.pending).toBeNull();
  }, 90_000);
});

/** Un puits ouvert : le joueur est devant la porte et a appuyé ; `mode` force le vœu (tiré au hasard dans l'original). */
function openWell(mode: "ingredient" | "travel", owned: number[] = []): Game {
  const game = oneGame();
  game.state.turn.wellOpen = true;
  Object.assign(game.player, { screen: 4, row: "top", x: 0xe0 });
  game.press("button");
  game.state.pending!.wellMode = mode;
  for (const i of owned) {
    game.player.ingredients |= 1 << i;
    game.player.ingredientCount += 1;
  }
  return game;
}

describe.skipIf(!hasOriginalFiles)("puits aux vœux S13", () => {
  async function inPick(game: Game, audio = false) {
    const outcomes: MinigameOutcome[] = [];
    const scene = createWellScene(game, (_ctx, o) => outcomes.push(o)) as WellScene;
    const { host, engine } = await launch(scene, audio);
    // Intro, fondu, puis Échap passe la vidéo `s13g` (la seule passable de ce puits).
    await advanceUntil(engine, host, () => scene.stage === "video" && host.loaded.some((f) => /S13G\.MUX/i.test(f)) && !engine.ctx.fade.active, 60_000);
    await advance(engine, host, 400);
    host.input.keyDown("Escape");
    await advance(engine, host, 100);
    host.input.keyUp("Escape");
    await advanceUntil(engine, host, () => scene.stage === "pick", 60_000);
    return { scene, host, engine, outcomes };
  }

  const centre = (i: number) => ({ x: WELL_SLOTS[i].x + 16, y: WELL_SLOTS[i].y + 16 });
  const click = async (host: TestHost, engine: Engine) => {
    host.input.mouseDown(0);
    await advance(engine, host, 100);
    host.input.mouseUp(0);
    await advance(engine, host, 100);
  };

  it("ingrédient : la case sous le curseur est encadrée, le clic donne l'ingrédient manquant", async () => {
    const game = openWell("ingredient");
    const { scene, host, engine, outcomes } = await inPick(game);
    expect(host.loaded.map((f) => f.toUpperCase())).toEqual(expect.arrayContaining(["DATA/S13/S13A/S13A000S.HY8", "DATA/S13/S13G/S13G.MUX"]));
    host.input.mouseMove(2, 2);
    await advance(engine, host, 100);
    expect(scene.hovered).toBeNull();
    const target = 5;
    host.input.mouseMove(centre(target).x, centre(target).y);
    await advance(engine, host, 200);
    expect(scene.hovered).toBe(target);
    // Cadre : extérieur 0x7f, intérieur 0x7e (`2daf:0462`).
    const { x, y } = WELL_SLOTS[target];
    const px = (cx: number, cy: number) => engine.ctx.surface.work[cy * 320 + cx];
    expect(px(x + 5, y - 1)).toBe(0x7f);
    expect(px(x + 5, y)).toBe(0x7e);
    // Le curseur prend ses couleurs (128, 129) dans `s13g.pal`, pas dans la vidéo (magenta).
    expect([...engine.ctx.palette.colors.subarray(128 * 3, 128 * 3 + 3)]).toEqual([0, 142, 189]);
    await click(host, engine);
    await advanceUntil(engine, host, () => outcomes.length > 0, 60_000);
    expect(outcomes).toEqual([{ kind: "well", ingredient: target, destination: null }]);
    game.resolveMinigame(outcomes[0]);
    expect(hasIngredient(game.player, target)).toBe(true);
    expect(game.state.pending).toBeNull();
  }, 120_000);

  it("ingrédient : la voix de confirmation est celle de la table (s13c 7 + décalage)", async () => {
    for (const target of [0, 6]) {
      const game = openWell("ingredient");
      const { host, engine, outcomes } = await inPick(game);
      host.loaded.length = 0;
      host.input.mouseMove(centre(target).x, centre(target).y);
      await advance(engine, host, 100);
      await click(host, engine);
      await advanceUntil(engine, host, () => outcomes.length > 0, 60_000);
      const wanted = `S13C0${String(7 + SPOKEN_OFFSET[target]).padStart(2, "0")}T.VOC`;
      expect(host.loaded.some((f) => f.toUpperCase().endsWith(wanted))).toBe(true);
    }
  }, 180_000);

  it("ingrédient déjà possédé : une voix, rien n'est choisi, on peut continuer", async () => {
    const game = openWell("ingredient", [3]);
    const { scene, host, engine, outcomes } = await inPick(game);
    host.loaded.length = 0;
    host.input.mouseMove(centre(3).x, centre(3).y);
    await advance(engine, host, 100);
    await click(host, engine);
    expect(host.loaded.some((f) => /S13C01[6-9]T\.VOC|S13C020T\.VOC/i.test(f))).toBe(true);
    await advance(engine, host, 500);
    expect(outcomes).toEqual([]);
    expect(scene.stage).toBe("pick");
    // Une autre case libre : choix.
    host.input.mouseMove(centre(1).x, centre(1).y);
    await advance(engine, host, 100);
    await click(host, engine);
    await advanceUntil(engine, host, () => outcomes.length > 0, 60_000);
    expect(outcomes[0]).toMatchObject({ ingredient: 1 });
  }, 120_000);

  it("bip au changement de case, pas à chaque image", async () => {
    const game = openWell("ingredient");
    const { host, engine } = await inPick(game, true);
    host.audio.stop();
    const before = host.audio.plays.length;
    host.input.mouseMove(centre(2).x, centre(2).y);
    await advance(engine, host, 300);
    const after = host.audio.plays.length;
    expect(after).toBe(before + 1);
    await advance(engine, host, 1000);
    expect(host.audio.plays.length).toBe(after); // même case : pas de nouveau bip
  }, 180_000);

  it("36 s sans choix : rien n'est donné", async () => {
    const game = openWell("ingredient");
    const { host, engine, outcomes } = await inPick(game);
    host.input.mouseMove(2, 2); // hors des cases
    await advanceUntil(engine, host, () => outcomes.length > 0, 60_000);
    expect(outcomes).toEqual([{ kind: "well", ingredient: null, destination: null }]);
    const before = game.player.ingredients;
    game.resolveMinigame(outcomes[0]);
    expect(game.player.ingredients).toBe(before);
  }, 120_000);

  it("voyage : le lieu choisi sur la carte déplace le pion (WISH_DESTINATIONS)", async () => {
    const game = openWell("travel");
    const outcomes: MinigameOutcome[] = [];
    const { host, engine } = await launch(createWellScene(game, (_ctx, o) => outcomes.push(o)));
    // Vraie carte S02 en mode « wish » : elle part du premier lieu (k = 2) ; haut = lieu suivant, Espace valide.
    await advanceUntil(engine, host, () => host.loaded.some((f) => /S02A007D\.MCG/i.test(f)) && !engine.ctx.fade.active, 60_000);
    await advance(engine, host, 1500);
    for (let i = 0; i < 4; i++) {
      host.input.keyDown("ArrowUp");
      await advance(engine, host, 150);
      host.input.keyUp("ArrowUp");
      await advance(engine, host, 150);
    }
    host.input.keyDown("Space");
    await advance(engine, host, 150);
    host.input.keyUp("Space");
    await advanceUntil(engine, host, () => outcomes.length > 0, 60_000);
    expect(outcomes).toEqual([{ kind: "well", destination: 6, ingredient: null }]);
    expect(host.loaded.some((f) => /S13A00[12]T\.VOC/i.test(f))).toBe(true);
    expect(host.loaded.some((f) => /S13B01[89]T\.VOC|S13B020T\.VOC/i.test(f))).toBe(true);
    game.resolveMinigame(outcomes[0]);
    expect(game.player).toMatchObject(WISH_DESTINATIONS[4]);
  }, 60_000);

  it("voyage : carte quittée sans choix, le pion ne bouge pas", async () => {
    const game = openWell("travel");
    const outcomes: MinigameOutcome[] = [];
    const { host, engine } = await launch(createWellScene(game, (_ctx, o) => outcomes.push(o)));
    await advanceUntil(engine, host, () => outcomes.length > 0, 60_000);
    expect(outcomes).toEqual([{ kind: "well", ingredient: null, destination: null }]);
    expect(host.loaded.some((f) => /S13B02[45]T\.VOC/i.test(f))).toBe(true);
    const before = { ...game.player };
    game.resolveMinigame(outcomes[0]);
    expect(game.player).toMatchObject({ screen: before.screen, row: before.row, x: before.x });
  }, 60_000);

  it("puits fermé : jamais de requête, la porte ne fait rien", () => {
    const game = oneGame();
    game.state.turn.wellOpen = false;
    Object.assign(game.player, { screen: 4, row: "top", x: 0xe0 });
    const events = game.press("button");
    expect(events.some((e) => e.type === "minigame")).toBe(false);
    expect(game.state.pending).toBeNull();
  });
});
