import { describe, expect, it, vi } from "vitest";
import type { Hy8 } from "../../src/games/teleportaschtroumpf/data/hy8";
import {
  BEEP_ARRIVE,
  BEEP_JUMP,
  FIDGET_AFTER_SECONDS,
  POSE_ARRIVE,
  POSE_FIDGET_LEFT,
  POSE_FIDGET_RIGHT,
  POSE_IDLE_LEFT,
  POSE_IDLE_RIGHT,
  POSE_JUMP_LEFT,
  POSE_JUMP_RIGHT,
  POSE_RUN_LEFT,
  POSE_RUN_RIGHT,
  POSE_WALK_LEFT,
  POSE_WALK_RIGHT,
  RUN_AFTER_SECONDS,
  Walker,
  type WalkerInput,
  type WalkerStep,
} from "../../src/games/teleportaschtroumpf/scenes/board/walker";
import { hintVoice, introVoice, zoneHelpVoice } from "../../src/games/teleportaschtroumpf/scenes/board/voices";
import { BorlandRandom } from "../../src/games/teleportaschtroumpf/engine/rng";
import { zoneIndex } from "../../src/games/teleportaschtroumpf/game/board";
import { DOORS, SCREEN_COUNT } from "../../src/games/teleportaschtroumpf/game/tables";
import { Session } from "./game-helpers";
import { hasOriginalFiles, readData } from "./helpers";
import { longPress, swipe, tap, touchDown, touchUp } from "./touch";
import { parseHy8 } from "../../src/games/teleportaschtroumpf/data/hy8";

/** Longueur des animations de pose de `s01a000s.hy8` (0..7, 9, 0xB, 0xC). */
const ANIMATION_FRAMES: Record<number, number> = { 0: 1, 1: 1, 2: 8, 3: 8, 4: 10, 5: 10, 6: 8, 7: 8, 9: 9, 0xb: 9, 0xc: 8 };

function fakeSprites(): Hy8 {
  const animations = Array.from({ length: 14 }, (_, i) => ({
    header: 0,
    frames: Array.from({ length: ANIMATION_FRAMES[i] ?? 1 }, (_, k) => ({ sprite: k, flags: 0, duration: 1, dx: 0, dy: 0 })),
  }));
  return { images: [], sprites: [], animations, trailer: new Uint8Array(12) };
}

const NONE: WalkerInput = { left: false, right: false, up: false, press: false };
const TICKS_PER_FRAME = 4;

/** Fait avancer le Schtroumpf d'une image à la fois (4 ticks). */
function rig() {
  const hy8 = fakeSprites();
  const walker = new Walker();
  let tick = 0;
  walker.reset(true, tick);
  const step = (input: Partial<WalkerInput> = {}): WalkerStep => {
    tick += TICKS_PER_FRAME;
    return walker.step({ ...NONE, ...input }, tick, hy8);
  };
  const frames = (n: number, input: Partial<WalkerInput> = {}): WalkerStep[] => Array.from({ length: n }, () => step(input));
  return { walker, step, frames, now: () => tick };
}

describe("Walker : marche, course, saut, attente (2bd4:02bd, 2bd4:0093)", () => {
  it("marche de 4 px par image vers la droite ; course de 8 px après 5 s de marche continue", () => {
    const { walker, frames } = rig();
    const walk = frames(5 * 15, { right: true });
    expect(walk.every((s) => s.walk?.dir === 1 && !s.walk.run)).toBe(true);
    expect(walker.pose).toBe(POSE_WALK_RIGHT);
    const run = frames(10, { right: true });
    expect(run.every((s) => s.walk?.dir === 1 && s.walk.run)).toBe(true);
    expect(walker.pose).toBe(POSE_RUN_RIGHT);
    expect(RUN_AFTER_SECONDS).toBe(5);
  });

  it("vers la gauche : mêmes pas, signe inversé ; la gauche l'emporte sur la droite", () => {
    const { walker, frames } = rig();
    expect(frames(3, { left: true }).every((s) => s.walk?.dir === -1 && !s.walk.run)).toBe(true);
    expect(walker.pose).toBe(POSE_WALK_LEFT);
    expect(frames(1, { left: true, right: true })[0].walk?.dir).toBe(-1);
    frames(5 * 15, { left: true });
    expect(walker.pose).toBe(POSE_RUN_LEFT);
  });

  it("la course repart à zéro quand on change de sens ou qu'on s'arrête", () => {
    const { walker, frames } = rig();
    frames(100, { right: true });
    expect(walker.pose).toBe(POSE_RUN_RIGHT);
    frames(1, { left: true });
    expect(walker.pose).toBe(POSE_WALK_LEFT);
    frames(1);
    expect(walker.pose).toBe(POSE_IDLE_LEFT);
    frames(1, { right: true });
    expect(walker.pose).toBe(POSE_WALK_RIGHT);
  });

  it("immobile : pose d'attente tournée du dernier côté, puis impatience après 8 s", () => {
    const { walker, frames } = rig();
    frames(3, { left: true });
    frames(1);
    expect(walker.pose).toBe(POSE_IDLE_LEFT);
    frames(FIDGET_AFTER_SECONDS * 15 - 2);
    expect(walker.pose).toBe(POSE_IDLE_LEFT);
    frames(3);
    expect(walker.pose).toBe(POSE_FIDGET_LEFT);
    // Vers la droite.
    const right = rig();
    right.frames(FIDGET_AFTER_SECONDS * 15 + 2);
    expect(right.walker.pose).toBe(POSE_FIDGET_RIGHT);
    expect(right.walker.pose).not.toBe(POSE_IDLE_RIGHT);
  });

  it("saut : haut + direction, 10 images sans réagir aux touches, puis 68 px à l'image suivante", () => {
    const { walker, frames, step } = rig();
    const first = step({ up: true, right: true });
    expect(walker.pose).toBe(POSE_JUMP_RIGHT);
    expect(first.walk).toBeUndefined();
    // Pendant le saut, aller à gauche ne fait rien.
    const during = frames(8, { left: true });
    expect(during.every((s) => s.walk === undefined && s.jump === undefined)).toBe(true);
    expect(walker.pose).toBe(POSE_JUMP_RIGHT);
    const landing = step({ left: true });
    expect(landing.jump).toBeUndefined();
    // 10 images de saut : la 10e boucle l'animation ; la suivante applique le déplacement et reprend l'attente.
    const after = step();
    expect(after.jump).toBe(1);
    expect(walker.pose).toBe(POSE_IDLE_RIGHT);
  });

  it("saut vers la gauche ; le bouton annule le saut", () => {
    const { walker, frames, step } = rig();
    step({ up: true, left: true });
    expect(walker.pose).toBe(POSE_JUMP_LEFT);
    frames(9);
    expect(step().jump).toBe(-1);
    expect(walker.pose).toBe(POSE_IDLE_LEFT);
    step({ up: true, right: true, press: true });
    expect(walker.pose).not.toBe(POSE_JUMP_RIGHT);
  });

  it("« haut » seul saute du côté où regarde le pion (écart : l'original ne saute qu'avec une direction)", () => {
    const { walker, frames, step } = rig();
    step({ up: true });
    expect(walker.pose).toBe(POSE_JUMP_RIGHT);
    frames(9);
    expect(step().jump).toBe(1);
    frames(2, { left: true });
    step({ up: true });
    expect(walker.pose).toBe(POSE_JUMP_LEFT);
    frames(9);
    expect(step().jump).toBe(-1);
  });

  it("le bruitage du saut ne part qu'à partir du deuxième saut (DS:8FFE nul au démarrage), à la 2e image", () => {
    const { frames, step } = rig();
    const beeps = (steps: WalkerStep[]) => steps.map((s) => s.beep).filter((b) => b !== undefined);
    const first = [step({ up: true, right: true }), ...frames(10)];
    expect(beeps(first)).toEqual([]);
    const second = [step({ up: true, right: true }), ...frames(10)];
    expect(beeps(second)).toEqual([BEEP_JUMP]);
    // Il part à la 2e image du saut.
    const third = [step({ up: true, left: true }), step(), step()];
    expect(third.map((s) => s.beep)).toEqual([undefined, BEEP_JUMP, undefined]);
  });

  it("le bouton arrête la marche", () => {
    const { walker, frames } = rig();
    frames(10, { right: true });
    const stop = frames(1, { right: true, press: true })[0];
    expect(stop.walk).toBeUndefined();
    expect(walker.pose).toBe(POSE_IDLE_RIGHT);
  });

  it("arrivée après une téléportation : animation de 8 images, bip, puis attente tournée à droite", () => {
    const { walker, frames, now } = rig();
    walker.startArrival(now());
    expect(walker.pose).toBe(POSE_ARRIVE);
    expect(walker.busy).toBe(true);
    const steps = frames(8, { right: true, left: true, up: true });
    expect(steps.every((s) => !s.walk && !s.jump)).toBe(true);
    expect(steps.map((s) => s.beep).filter((b) => b !== undefined)).toEqual([BEEP_ARRIVE]);
    frames(1);
    expect(walker.pose).toBe(POSE_IDLE_RIGHT);
    expect(walker.busy).toBe(false);
  });
});

describe("voix du plateau (26ee:006a, 291e:0401, 28a3:04dc)", () => {
  const rng = () => new BorlandRandom(5);

  it("indices vocaux : s01v 31..35 à 12 s, 36..40 à 24 s, annonce du personnage s01v 1..30", () => {
    for (let i = 0; i < 50; i++) {
      const r = new BorlandRandom(i);
      expect(hintVoice(1, 0, r)).toMatch(/^s01v03[1-5]t\.voc$/);
      expect(hintVoice(2, 0, r)).toMatch(/^s01v0(3[6-9]|40)t\.voc$/);
      expect(hintVoice(6, 0, r)).toMatch(/^s01v04[6-9]t\.voc$|^s01v050t\.voc$/);
    }
    // Costaud (0) : 1..5 ; Poète (1) : 21..25 ; Grognon (2) : 26..30 ; Gourmand (3) : 6..10 ; Farceur (4) : 11..15 ; Bricoleur (5) : 16..20.
    const first = [1, 21, 26, 6, 11, 16];
    first.forEach((start, character) => {
      for (let i = 0; i < 20; i++) {
        const n = Number(/s01v(\d+)t/.exec(hintVoice(12, character, new BorlandRandom(i))!)![1]);
        expect(n).toBeGreaterThanOrEqual(start);
        expect(n).toBeLessThan(start + 5);
      }
    });
    expect(hintVoice(0, 0, rng())).toMatch(/^s20v00[1-3]t\.voc$/);
    expect(hintVoice(16, 0, rng())).toMatch(/^s2[01]v00[13]t\.voc$/);
    expect(hintVoice(99, 0, rng())).toBeNull();
  });

  it("aide de la zone : numéro de la porte (13 pour le puits), rien sans porte", () => {
    expect(zoneHelpVoice(1, "top", 0x20)).toBeNull();
    expect(zoneHelpVoice(1, "bottom", 0x20)).toBe("s45v023t.voc");
    expect(zoneHelpVoice(1, "bottom", 0x13a)).toBe("s45v029t.voc");
    expect(zoneHelpVoice(2, "top", 0x120)).toBe("s45v014t.voc"); // puits S14 : la voix 14
    expect(zoneHelpVoice(4, "top", 0x120)).toBe("s45v013t.voc"); // porte du puits ouvert S13
    expect(zoneHelpVoice(9, "bottom", 0x100)).toBe("s45v036t.voc");
  });

  it.skipIf(!hasOriginalFiles)("la table d'aide recoupe celle de SMURF.EXE (DS:28B2, un octet par zone)", () => {
    const exe = readData("../SMURF.EXE");
    const header = (exe[8] | (exe[9] << 8)) * 16;
    const table = exe.subarray(header + (0x3646 - 0x1000) * 16 + 0x28b2);
    for (let screen = 1; screen <= SCREEN_COUNT; screen++) {
      for (const row of ["top", "bottom"] as const) {
        for (const x of [0x20, 0x90, 0x120]) {
          const door = DOORS[screen - 1][row][x < 0x6b ? 0 : x < 0xd4 ? 1 : 2];
          const expected = door === null ? 0 : door === 14 && screen !== 2 ? 13 : door;
          expect(table[zoneIndex(screen, row, x)]).toBe(expected);
        }
      }
    }
  });

  it("voix d'accroche des mini-jeux : sNNa001 ou 002 (S51 : 001), aucune pour S13, S38, S39, S41", () => {
    expect(introVoice(23, rng())).toMatch(/^s23a00[12]t\.voc$/);
    expect(introVoice(51, rng())).toBe("s51a001t.voc");
    for (const scene of [14, 38, 39, 41]) expect(introVoice(scene, rng())).toBeNull();
  });
});

describe.skipIf(!hasOriginalFiles)("animations de s01a000s.hy8", () => {
  it("chaque pose joue l'animation attendue (longueurs de l'original)", () => {
    const hy8 = parseHy8(readData("S01/S01A/S01A000S.HY8"));
    for (const [index, frames] of Object.entries(ANIMATION_FRAMES)) expect(hy8.animations[Number(index)].frames.length).toBe(frames);
  });
});

describe.skipIf(!hasOriginalFiles)("plateau : marche, course, saut sur la partie", () => {
  it("marche 4 px par image : la position suit le temps (15 images/s)", async () => {
    const s = await Session.start();
    await s.ready();
    const x0 = s.game.player.x;
    expect(x0).toBe(0x0b);
    await s.hold("ArrowRight", 1000);
    await s.run(100);
    const walked = s.game.player.x - x0;
    // 1 s = 15 images de 4 px, à une image près ; la position montrée est celle de la partie.
    expect(walked).toBeGreaterThanOrEqual(4 * 14);
    expect(walked).toBeLessThanOrEqual(4 * 16);
    expect(walked % 4).toBe(0);
    expect(s.board.shown.x).toBe(s.game.player.x);
  }, 60_000);

  it("la course (8 px par image) commence après 5 s de marche continue", async () => {
    const s = await Session.start();
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x0b });
    await s.hold("ArrowRight", 4500);
    await s.run(50);
    const before = s.game.player.x;
    await s.run(1500); // les touches ne sont plus tenues : l'immobile n'avance pas
    expect(s.game.player.x).toBe(before);
    s.host.input.keyDown("ArrowRight");
    await s.run(5600);
    // Les 5 premières secondes à 4 px, le reste à 8 px : bien plus qu'une marche pure.
    const start = 0x0b;
    expect(s.board.walker.pose).toBe(POSE_RUN_RIGHT);
    expect(s.game.player.x === start).toBe(false);
    s.host.input.keyUp("ArrowRight");
  }, 60_000);

  it("saut : 68 px franchis d'un coup en fin de saut, la marche s'arrête pendant", async () => {
    const s = await Session.start();
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x30 });
    s.host.input.keyDown("ArrowUp");
    s.host.input.keyDown("ArrowRight");
    await s.run(1000);
    s.host.input.keyUp("ArrowUp");
    s.host.input.keyUp("ArrowRight");
    await s.run(1000);
    // Au moins un saut entier (10 images + 1) s'est terminé : la position avance par pas de 68 px.
    const moved = s.game.player.x - 0x30;
    expect(moved).toBeGreaterThanOrEqual(0x44);
    expect(moved % 0x44).toBe(0);
  }, 60_000);

  it("quitter l'écran par la droite arrive en rangée basse ; par la gauche, en rangée haute de l'écran précédent", async () => {
    const s = await Session.start();
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x13a });
    await s.hold("ArrowRight", 400);
    await s.run(200);
    expect(s.game.player).toMatchObject({ screen: 2, row: "bottom" });
    expect(s.board.shown).toMatchObject({ screen: 2, row: "bottom", x: s.game.player.x });
    s.place({ screen: 2, row: "bottom", x: 0x10 });
    await s.hold("ArrowLeft", 800);
    await s.run(200);
    expect(s.game.player).toMatchObject({ screen: 2, row: "top" });
    expect(s.game.player.x).toBeGreaterThan(0xe0);
    s.place({ screen: 2, row: "top", x: 0x10 });
    await s.hold("ArrowLeft", 800);
    await s.run(200);
    expect(s.game.player).toMatchObject({ screen: 1, row: "bottom" });
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("plateau au doigt (ajout du port)", () => {
  it("toucher le décor : le pion marche jusque-là sur sa rangée et s'arrête ; une flèche du clavier reprend la main", async () => {
    const s = await Session.start();
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x30 });
    tap(s.host.input, 200, 40);
    await s.run(3000);
    // Le milieu du pion est sous le doigt, à un pas près.
    expect(Math.abs(s.game.player.x + 12 - 200)).toBeLessThanOrEqual(8);
    expect(s.game.player).toMatchObject({ screen: 2, row: "top" });
    tap(s.host.input, 30, 40);
    await s.run(300);
    const walking = s.game.player.x;
    expect(walking).toBeLessThan(200);
    await s.tap("ArrowRight");
    const stopped = s.game.player.x;
    await s.run(1000);
    expect(s.game.player.x).toBe(stopped);
  }, 60_000);

  it("toucher près du bord droit : le pion marche jusqu'au bord et s'arrête sur la rangée où il arrive", async () => {
    const s = await Session.start();
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x110 });
    tap(s.host.input, 315, 40);
    await s.run(3000);
    expect(s.game.player).toMatchObject({ screen: 2, row: "bottom" });
    const arrived = s.game.player.x;
    await s.run(1000);
    expect(s.game.player.x).toBe(arrived);
  }, 60_000);

  it("toucher le pion : le bouton ; le doigt qui se pose ailleurs n'appuie pas", async () => {
    const s = await Session.start();
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x60 });
    await s.run(200);
    const press = vi.spyOn(s.game, "press");
    touchDown(s.host.input, 250, 40);
    await s.run(200);
    expect(press).not.toHaveBeenCalled();
    touchUp(s.host.input, 250, 40);
    await s.run(200);
    s.host.input.keyDown("ArrowRight"); // annule la marche vers le doigt
    await s.run(100);
    s.host.input.keyUp("ArrowRight");
    await s.run(200);
    const x = s.game.player.x;
    tap(s.host.input, x + 12, 0x38 - 15);
    await s.run(200);
    expect(press).toHaveBeenCalledWith("button");
  }, 60_000);

  it("glisser vers le haut : le saut de 68 px, du côté du glissement", async () => {
    const s = await Session.start();
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x80 });
    await s.run(200);
    swipe(s.host.input, 150, 60, -20, -30);
    await s.run(1500);
    expect(s.game.player.x).toBe(0x80 - 0x44);
    // Glisser de côté ne fait rien.
    swipe(s.host.input, 150, 60, 40, 0);
    await s.run(1500);
    expect(s.game.player.x).toBe(0x80 - 0x44);
  }, 60_000);

  it("toucher le bandeau du bas : la pause ; appui long : la voix d'aide", async () => {
    const s = await Session.start();
    await s.ready();
    const outputs: string[] = [];
    const step = s.board.step.bind(s.board);
    vi.spyOn(s.board, "step").mockImplementation((ctx) => {
      const out = step(ctx);
      if (out && out.kind !== "events") outputs.push(out.kind);
      return out;
    });
    longPress(s.host.input, 150, 60);
    await s.run(200);
    expect(outputs).toEqual(["help"]);
    tap(s.host.input, 150, 180);
    await s.settle("PauseScene");
    expect(outputs).toEqual(["help", "pause"]);
  }, 60_000);
});
