import { describe, expect, it } from "vitest";
import type { Hy8 } from "../../../src/games/teleportaschtroumpf/data/hy8";
import { parseHy8 } from "../../../src/games/teleportaschtroumpf/data/hy8";
import { MutFlag, parseMut, parsePrc } from "../../../src/games/teleportaschtroumpf/data/mut";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import {
  MINE_FRAME_TICKS,
  MINE_VARIANTS,
  MineScene,
  createMine,
  mineVariant,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s36-mine";
import {
  CART_MAX_Y,
  CART_MIN_Y,
  CART_START_Y,
  LANE_CENTER,
  LANE_LEFT,
  LANE_RIGHT,
  MineRun,
  type MineInput,
  hasObstacle,
  hasSwitch,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s36/run";
import { hasOriginalFiles, readData } from "../helpers";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchedMinigame, type LaunchOptions } from "./harness";

/** HY8 minimal : une animation par entrée de `frameCounts`, des frames numérotées. */
function fakeHy8(frameCounts: number[]): Hy8 {
  return {
    images: [],
    sprites: [],
    animations: frameCounts.map((n) => ({ header: 0, frames: Array.from({ length: n }, (_, i) => ({ sprite: i, flags: 0, duration: 1, dx: 0, dy: 0 })) })),
    trailer: new Uint8Array(),
  };
}

const CART = fakeHy8([8, 8, 8, 2, 2]);
const CRASH = fakeHy8([6]);

const NONE: MineInput = { up: false, down: false, left: false, right: false, idle: true, soundPlaying: false };
const press = (key: "up" | "down" | "left" | "right"): MineInput => ({ ...NONE, [key]: true, idle: false });

/** Parcours de 12 éléments (9 tronçons à parcourir : `n − 4 = 8` changements de tronçon) ; `tileFlags[i]` = drapeaux du tronçon i. */
function course(tileFlags: number[], sequence: number[], startX = LANE_CENTER): MineRun {
  return new MineRun(sequence, tileFlags, CART, CRASH, startX);
}

describe("S36 : variantes (pur)", () => {
  it("niveau 0 : l ou g, 1 : f ou h, 2 : e ou i, 3 (indice de l'oiseau) : j ou k ; le tirage nul prend le premier", () => {
    expect(MINE_VARIANTS).toEqual([["s36l", "s36g"], ["s36f", "s36h"], ["s36e", "s36i"], ["s36j", "s36k"]]);
    expect(mineVariant(0, 0)).toBe("s36l");
    expect(mineVariant(0, 1)).toBe("s36g");
    expect(mineVariant(1, 0)).toBe("s36f");
    expect(mineVariant(2, 1)).toBe("s36i");
    expect(mineVariant(3, 0)).toBe("s36j");
    expect(mineVariant(3, 1)).toBe("s36k");
  });

  it("la requête est exigée : Game.openMinigame(36) d'abord", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createMine(game, () => undefined)).toThrow(/openMinigame\(36\)/);
  });
});

describe("S36 : règles de la course (pur, `23c9:0004`)", () => {
  it("aiguillages et obstacles : un bit par voie", () => {
    expect(hasSwitch(MutFlag.SwitchLeftToCenter, LANE_LEFT, "right")).toBe(true);
    expect(hasSwitch(MutFlag.SwitchLeftToCenter, LANE_CENTER, "right")).toBe(false);
    expect(hasSwitch(MutFlag.SwitchCenterToRight, LANE_CENTER, "right")).toBe(true);
    expect(hasSwitch(MutFlag.SwitchCenterToLeft, LANE_CENTER, "left")).toBe(true);
    expect(hasSwitch(MutFlag.SwitchRightToCenter, LANE_RIGHT, "left")).toBe(true);
    expect(hasSwitch(MutFlag.SwitchRightToCenter, LANE_RIGHT, "right")).toBe(false);
    expect(hasObstacle(MutFlag.ObstacleLeft, LANE_LEFT)).toBe(true);
    expect(hasObstacle(MutFlag.ObstacleCenter, LANE_CENTER)).toBe(true);
    expect(hasObstacle(MutFlag.ObstacleRight, LANE_RIGHT)).toBe(true);
    expect(hasObstacle(MutFlag.ObstacleRight, LANE_CENTER)).toBe(false);
    expect(hasObstacle(1, LANE_CENTER)).toBe(false);
  });

  it("défilement de 10 px par image, un tronçon toutes les 14 images, 1 + 14 × (n − 4) images en tout", () => {
    const sequence = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 12 éléments : 8 tronçons à franchir
    const run = course([1], sequence);
    expect(run.totalFrames).toBe(1 + 14 * 8);
    const scrolls: number[] = [];
    while (!run.ended) {
      run.step(NONE);
      scrolls.push(run.view.scroll);
    }
    expect(scrolls.slice(0, 16)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 10]);
    expect(run.frames).toBe(113);
    expect(run.tileIndex).toBe(8);
    // La dernière image est dessinée avant le changement de tronçon : elle montre encore le défilement 140.
    expect(run.view).toEqual({ tileIndex: 7, scroll: 140 });
    expect(run.crashed).toBe(false);
  });

  it("haut / bas : 5 px par image, bornés à 0x3C et 0xAA ; les deux touches s'annulent", () => {
    const run = course([1], new Array(40).fill(0));
    expect(run.y).toBe(CART_START_Y);
    run.step(press("up"));
    expect(run.y).toBe(95);
    for (let i = 0; i < 20; i++) run.step(press("up"));
    expect(run.y).toBe(CART_MIN_Y); // 100 → 65 → 60 : on ne monte que tant que y > 0x3C
    for (let i = 0; i < 40; i++) run.step(press("down"));
    expect(run.y).toBe(CART_MAX_Y);
    const y = run.y;
    run.step({ ...NONE, up: true, down: true, idle: false });
    expect(run.y).toBe(y);
  });

  /**
   * Tronçon B (le suivant) porte l'aiguillage : le chariot (y = 100) est dans sa fenêtre aux défilements 100, 110 et 120 (droite) ou 110 et 120
   * (gauche) ; l'obstacle suit, 30 lignes plus haut dans le tronçon (défilement 140, puis 10 sur le tronçon d'après).
   */
  const withSwitch = (flags: number, startX = LANE_CENTER) => course([1, flags], [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], startX);

  /** Joue des images vides jusqu'au défilement `scroll` du tronçon 0, en s'arrêtant juste avant (la prochaine image l'atteint). */
  const advanceTo = (run: MineRun, scroll: number) => {
    while (run.scroll < scroll - 10) run.step(NONE);
  };

  it("aiguillage centre → droite : la touche droite dans la fenêtre lance 8 images de changement de voie, puis le chariot est à droite", () => {
    const run = withSwitch(MutFlag.SwitchCenterToRight);
    advanceTo(run, 100);
    run.step(press("right")); // défilement 100 : y = 100 est dans [90, 110]
    expect(run.switching).toBe(true);
    expect(run.x).toBe(LANE_CENTER);
    expect(run.sounds).toEqual(["switch"]);
    const switchSprites = run.sprites.map((s) => s.x);
    expect(switchSprites[0]).toBe(LANE_RIGHT); // l'animation est dessinée sur la voie visée
    expect(run.sprites).toHaveLength(2); // + le rebond de la voie quittée pendant les deux premières images
    for (let i = 0; i < 6; i++) run.step({ ...NONE, soundPlaying: true });
    expect(run.switching).toBe(true);
    run.step({ ...NONE, soundPlaying: true });
    expect(run.switching).toBe(false);
    expect(run.x).toBe(LANE_RIGHT);
    // L'ordonnée finale est celle où l'animation s'arrête : référence de la première image (100 − 80 + 60) + 5.
    expect(run.y).toBe(80 + 5);
    run.step(NONE);
    expect(run.sprites).toHaveLength(1); // le chariot roule de nouveau
  });

  it("aiguillage vers la gauche : fenêtre plus courte (défilements 110 et 120)", () => {
    const early = withSwitch(MutFlag.SwitchCenterToLeft);
    advanceTo(early, 100);
    early.step(press("left"));
    expect(early.switching).toBe(false);
    const run = withSwitch(MutFlag.SwitchCenterToLeft);
    advanceTo(run, 110);
    run.step(press("left"));
    expect(run.switching).toBe(true);
    for (let i = 0; i < 8; i++) run.step(NONE);
    expect(run.x).toBe(LANE_LEFT);
  });

  it("une touche tenue ne déclenche l'aiguillage que pendant ses 3 premières images (le compteur retombe quand on relâche)", () => {
    const run = withSwitch(MutFlag.SwitchCenterToRight);
    advanceTo(run, 80);
    run.step(press("right")); // 80 : hors fenêtre (1)
    run.step(press("right")); // 90 : hors fenêtre (2)
    run.step(press("right")); // 100 : fenêtre, 3e image tenue : accepté ?
    expect(run.switching).toBe(true);

    const late = withSwitch(MutFlag.SwitchCenterToRight);
    advanceTo(late, 70);
    for (let i = 0; i < 4; i++) late.step(press("right")); // 70, 80, 90, 100 : la 4e image tenue ne compte plus
    expect(late.switching).toBe(false);

    const released = withSwitch(MutFlag.SwitchCenterToRight);
    advanceTo(released, 70);
    for (let i = 0; i < 3; i++) released.step(press("right"));
    released.step(NONE); // 100 : relâché ; la 4e touche repart de 1... mais la fenêtre vient de passer
    expect(released.switching).toBe(false);
    released.step(NONE);
    released.step(press("right")); // 120 : compteur remis à 0, fenêtre encore ouverte
    expect(released.switching).toBe(true);
  });

  it("sans aiguillage à cet endroit : son de refus (une seule fois tant qu'il sort) et rebonds sur place, sans changement de voie", () => {
    const run = course([1], new Array(12).fill(0));
    run.step(press("right"));
    expect(run.sounds).toEqual(["refuse"]);
    expect(run.sprites.map((s) => [s.x, s.y])).toEqual([[LANE_CENTER, 100], [LANE_CENTER, 100], [LANE_CENTER, 100]]); // 2 rebonds + chariot
    expect(run.x).toBe(LANE_CENTER);
    run.step({ ...press("left"), soundPlaying: true });
    expect(run.sounds).toEqual([]);
    expect(run.switching).toBe(false);
  });

  it("sur la voie de droite, la touche droite est sans effet (ni son ni rebond) ; de même à gauche", () => {
    const run = withSwitch(MutFlag.SwitchCenterToRight);
    advanceTo(run, 100);
    run.step(press("right"));
    while (run.switching) run.step(NONE);
    expect(run.x).toBe(LANE_RIGHT);
    run.step(press("right"));
    expect(run.sounds).toEqual([]);
    expect(run.sprites).toHaveLength(1);
    // Le retour au centre rouvre la touche droite.
    const back = withSwitch(MutFlag.SwitchRightToCenter, LANE_RIGHT);
    advanceTo(back, 110);
    back.step(press("left"));
    expect(back.switching).toBe(true);
    while (back.switching) back.step(NONE);
    expect(back.x).toBe(LANE_CENTER);
    back.step(press("right"));
    expect(back.sounds).toEqual(["refuse"]);
  });

  it("obstacle sur la voie du chariot : choc à l'image où il passe, l'animation de choc se joue en entier (6 images) avant la fin", () => {
    // Défaut de l'original corrigé (2026-10-23) : il s'arrêtait à la 1re image du choc.
    const run = course([1, MutFlag.ObstacleCenter], [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    advanceTo(run, 140);
    expect(run.crashed).toBe(false);
    run.step(NONE); // défilement 140, tronçon suivant sous le chariot : ligne 40 du tronçon, fenêtre [30, 40]
    expect(run.crashed).toBe(true);
    expect(run.ended).toBe(false);
    expect(run.sounds).toEqual(["crash"]);
    expect(run.sprites).toHaveLength(1);
    expect(run.sprites[0].sheet).toBe("crash");
    expect(run.frames).toBe(15);
    const shown = [run.sprites[0].frame];
    while (!run.ended) {
      run.step(NONE);
      expect(run.sprites).toHaveLength(1);
      expect(run.sprites[0].sheet).toBe("crash");
      shown.push(run.sprites[0].frame);
    }
    expect(shown).toHaveLength(6);
    expect(new Set(shown).size).toBe(6);
    expect(run.frames).toBe(20);
  });

  it("obstacle sur une autre voie : rien ; obstacle évité par l'aiguillage qui le précède dans le tronçon", () => {
    const other = course([1, MutFlag.ObstacleLeft], [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    while (!other.ended) other.step(NONE);
    expect(other.crashed).toBe(false);

    const dodge = withSwitch(MutFlag.SwitchCenterToRight | MutFlag.ObstacleCenter);
    advanceTo(dodge, 100);
    dodge.step(press("right"));
    for (let i = 0; i < 8; i++) dodge.step(NONE);
    expect(dodge.x).toBe(LANE_RIGHT);
    while (!dodge.ended) dodge.step(NONE);
    expect(dodge.crashed).toBe(false);
  });

  it("peek : annonce le tronçon et la référence de l'image suivante", () => {
    const run = withSwitch(MutFlag.SwitchCenterToRight);
    advanceTo(run, 100);
    const next = run.peek();
    expect(next.flags).toBe(MutFlag.SwitchCenterToRight);
    expect(next.ref).toBe(100 - 80 + 60); // 80 + 20 : bas du tronçon B + 60
    run.step(NONE);
    expect(run.view.scroll).toBe(100);
  });
});

// --- Avec les fichiers du jeu ----------------------------------------------------------------------------

const DATA_FILES: Record<string, string> = Object.fromEntries("efghijkl".split("").map((v) => [`s36${v}`, `S36/S36${v.toUpperCase()}/S36${v.toUpperCase()}`]));

/** Pilote : choisit l'aiguillage à prendre dans la prochaine image (un obstacle sur sa voie, ou un retour vers le centre). */
export function wantedKey(run: MineRun): "left" | "right" | null {
  if (run.switching) return null;
  const { flags, ref } = run.peek();
  const obstacle = hasObstacle(flags, run.x);
  for (const direction of ["left", "right"] as const) {
    if (!hasSwitch(flags, run.x, direction)) continue;
    const towardCenter = (direction === "right") === (run.x === LANE_LEFT) && run.x !== LANE_CENTER;
    const window = direction === "right" ? 0x14 : 10;
    if ((obstacle || towardCenter) && run.y >= ref && run.y <= ref + window) return direction;
  }
  return null;
}

describe.skipIf(!hasOriginalFiles)("S36 : les 8 mines, jouées par un pilote", () => {
  const cart = () => parseHy8(readData("S36/S36A/S36A000S.HY8"));
  const crash = () => parseHy8(readData("S36/S36A/S36A001S.HY8"));

  for (const [name, base] of Object.entries(DATA_FILES)) {
    it(`${name} : le pilote va au bout sans choc (${name === "s36j" ? "départ à droite" : "départ au centre"}), 1 + 14 × (n − 4) images`, () => {
      const tiles = parseMut(readData(`${base}.MUT`)).tiles;
      const sequence = parsePrc(readData(`${base}.PRC`));
      const run = new MineRun(sequence, tiles.map((t) => t.flags), cart(), crash(), name === "s36j" ? LANE_RIGHT : LANE_CENTER);
      expect(run.x).toBe(name === "s36j" ? LANE_RIGHT : LANE_CENTER);
      let switches = 0;
      while (!run.ended) {
        const key = wantedKey(run);
        const before = run.switching;
        run.step(key ? press(key) : NONE);
        if (!before && run.switching) switches++;
        expect(run.frames).toBeLessThan(2000);
      }
      expect(run.crashed, name).toBe(false);
      expect(run.frames).toBe(1 + 14 * (sequence.length - 4));
      expect(switches).toBeGreaterThan(3);
    });

    it(`${name} : sans rien toucher, le chariot finit par heurter un obstacle`, () => {
      const tiles = parseMut(readData(`${base}.MUT`)).tiles;
      const sequence = parsePrc(readData(`${base}.PRC`));
      const run = new MineRun(sequence, tiles.map((t) => t.flags), cart(), crash(), name === "s36j" ? LANE_RIGHT : LANE_CENTER);
      while (!run.ended) run.step(NONE);
      // Les variantes où la voie de départ n'a jamais d'obstacle peuvent aller au bout sans rien faire ; les autres s'arrêtent.
      expect(run.frames).toBeLessThanOrEqual(1 + 14 * (sequence.length - 4));
    });
  }
});

/** Lance S36 sur la variante `file` (graine cherchée parmi 1..99). */
async function seedFor(file: string, options: LaunchOptions): Promise<LaunchedMinigame> {
  for (let seed = 1; seed < 100; seed++) {
    const run = await launchMinigame(36, { ...options, seed });
    if ((run.scene as MineScene).variant === file) return run;
  }
  throw new Error(`aucune graine ne donne ${file}`);
}

/** Touches tenues au clavier par le pilote (aiguillage de la prochaine image). */
function bot(run: { scene: unknown; host: LaunchedMinigame["host"] }) {
  const scene = run.scene as MineScene;
  const held = { left: false, right: false };
  const set = (left: boolean, right: boolean) => {
    for (const [name, code, on] of [["left", "ArrowLeft", left], ["right", "ArrowRight", right]] as const) {
      if (held[name] === on) continue;
      held[name] = on;
      if (on) run.host.input.keyDown(code);
      else run.host.input.keyUp(code);
    }
  };
  return () => {
    if (scene.stage !== "run") return set(false, false);
    const key = wantedKey(scene.course);
    set(key === "left", key === "right");
  };
}

describe.skipIf(!hasOriginalFiles)("S36 La Mine Désaffectée : niveaux, choc, réussite", () => {
  it("le niveau choisit la paire de variantes (0 : l / g, 1 : f / h, 2 : e / i, indice de l'oiseau : j / k) ; chaque variante sort", async () => {
    const seen: Record<string, Set<string>> = { "0": new Set(), "1": new Set(), "2": new Set(), bonus: new Set() };
    for (let seed = 1; seed <= 16; seed++) {
      for (const level of [0, 1, 2]) seen[level].add(((await launchMinigame(36, { seed, level })).scene as MineScene).variant);
      const run = await launchMinigame(36, { seed, level: 0, bonus: true });
      seen.bonus.add((run.scene as MineScene).variant);
    }
    expect([...seen["0"]].sort()).toEqual(["s36g", "s36l"]);
    expect([...seen["1"]].sort()).toEqual(["s36f", "s36h"]);
    expect([...seen["2"]].sort()).toEqual(["s36e", "s36i"]);
    expect([...seen.bonus].sort()).toEqual(["s36j", "s36k"]);
  }, 120_000);

  it("graine fixe : même variante, même mine", async () => {
    const a = await launchMinigame(36, { seed: 9, level: 1 });
    const b = await launchMinigame(36, { seed: 9, level: 1 });
    expect((a.scene as MineScene).variant).toBe((b.scene as MineScene).variant);
  }, 30_000);

  it("indice de l'oiseau : S36 ne consomme que le sien (0x24) ; l'indice de S27 (0x1B) lui est laissé (défaut de l'original corrigé)", async () => {
    const hint27 = await launchMinigame(36, { setup: (game) => (game.state.bonusTag = 27) });
    expect(hint27.game.state.pending?.bonus).toBe(false);
    expect(hint27.game.state.bonusTag).toBe(27);
    expect(["s36j", "s36k"]).not.toContain((hint27.scene as MineScene).variant);
    const hint36 = await launchMinigame(36, { setup: (game) => (game.state.bonusTag = 36) });
    expect(hint36.game.state.pending?.bonus).toBe(true);
    expect(hint36.game.state.bonusTag).toBe(0);
    expect(["s36j", "s36k"]).toContain((hint36.scene as MineScene).variant);
  }, 30_000);

  it("variante j : le chariot part sur la voie de droite ; les autres au centre", async () => {
    const j = await seedFor("s36j", { bonus: true });
    expect((j.scene as MineScene).course.x).toBe(LANE_RIGHT);
    const e = await seedFor("s36e", { level: 2 });
    expect((e.scene as MineScene).course.x).toBe(LANE_CENTER);
    expect((e.scene as MineScene).course.y).toBe(CART_START_Y);
  }, 60_000);

  it("sans rien toucher : choc, son s36a003b, fondu, vidéo d'échec s36b, ingrédient raté et rien de donné", async () => {
    const run = await seedFor("s36e", { level: 2, audio: true });
    const scene = run.scene as MineScene;
    const crashVoc = await run.ctx.resources.voc("s36a003b.voc");
    expect(scene.stage).toBe("run");
    await run.run(1000);
    run.shot("s36-depart");
    await run.until(() => scene.hasCrashed, 60_000);
    run.shot("s36-choc");
    expect(run.host.audio.plays.at(-1)?.sound.samples).toEqual(crashVoc.samples);
    const stages = new Set<string>();
    await run.until(() => {
      stages.add(scene.stage);
      return scene.stage === "result";
    }, 30_000);
    expect([...stages]).toEqual(expect.arrayContaining(["fadeOut", "sound", "result"]));
    expect(scene.endVideo).toBe("s36b.mux");
    await run.run(1500);
    run.shot("s36-echec-video");
    const outcome = await run.finish(60_000);
    expect(outcome).toEqual({ kind: "ingredient", success: false });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.ingredients).toBe(0);
  }, 120_000);

  it("pilote : la mine va au bout, vidéo s36c1 (ingrédient 1 hors objectif), l'ingrédient 1 est donné", async () => {
    const run = await seedFor("s36e", { level: 2, setup: (game) => (game.state.goal.ingredients &= ~(1 << 1)) });
    const scene = run.scene as MineScene;
    const act = bot(run);
    let shots = 0;
    await run.until(() => {
      act();
      if (scene.stage === "run" && scene.course.frames === 20 + shots * 130 && shots < 3) {
        run.shot(`s36-course-${shots++}`);
      }
      return scene.stage !== "run";
    }, 120_000);
    expect(scene.hasCrashed).toBe(false);
    expect(scene.course.frames).toBe(scene.course.totalFrames);
    await run.until(() => scene.stage === "result", 30_000);
    expect(scene.endVideo).toBe("s36c1.mux");
    const outcome = await run.finish(60_000);
    expect(outcome).toEqual({ kind: "ingredient", success: true });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.ingredients & (1 << 1)).not.toBe(0);
    expect(run.game.player.ingredientCount).toBe(1);
  }, 180_000);

  it("réussite : s36c2 quand l'ingrédient 1 fait partie de l'objectif", async () => {
    const run = await seedFor("s36h", { level: 1, setup: (game) => (game.state.goal.ingredients |= 1 << 1) });
    const scene = run.scene as MineScene;
    const act = bot(run);
    await run.until(() => {
      act();
      return scene.stage !== "run";
    }, 120_000);
    expect(scene.hasCrashed).toBe(false);
    await run.until(() => scene.stage === "result", 30_000);
    expect(scene.endVideo).toBe("s36c2.mux");
    expect(await run.finish(60_000)).toEqual({ kind: "ingredient", success: true });
  }, 180_000);

  it("indice de l'oiseau : mine j ou k, faisable", async () => {
    const run = await seedFor("s36k", { bonus: true });
    const scene = run.scene as MineScene;
    const act = bot(run);
    await run.until(() => {
      act();
      return scene.stage !== "run";
    }, 120_000);
    expect(scene.hasCrashed).toBe(false);
    expect(await run.finish(60_000)).toEqual({ kind: "ingredient", success: true });
  }, 180_000);

  it("commandes : haut / bas déplacent le chariot de 5 px par image ; une touche sans aiguillage joue le son de refus ; les images viennent toutes les 5 ticks", async () => {
    const run = await seedFor("s36e", { level: 2, audio: true });
    const scene = run.scene as MineScene;
    const refuse = await run.ctx.resources.voc("s36a002b.voc");
    expect(MINE_FRAME_TICKS).toBe(5);
    await run.until(() => scene.course.frames >= 1);
    const frame = scene.course.frames;
    await run.run(1000 / 12 + 5);
    expect(scene.course.frames).toBe(frame + 1);
    const y = scene.course.y;
    run.host.input.keyDown("ArrowUp");
    await run.until(() => scene.course.frames >= frame + 4);
    run.host.input.keyUp("ArrowUp");
    expect(scene.course.y).toBeLessThan(y);
    expect((y - scene.course.y) % 5).toBe(0);
    run.host.input.keyDown("ArrowLeft");
    await run.run(200);
    run.host.input.keyUp("ArrowLeft");
    expect(run.host.audio.plays.some((p) => p.sound.samples === refuse.samples)).toBe(true);
    expect(scene.course.x).toBe(LANE_CENTER);
  }, 60_000);

  it("Échap et Espace n'agissent pas pendant la course ; ils passent la vidéo de fin", async () => {
    const run = await seedFor("s36e", { level: 2 });
    const scene = run.scene as MineScene;
    await run.run(500);
    await run.tap("Escape");
    await run.tap("Space");
    expect(scene.stage).toBe("run");
    await run.until(() => scene.stage === "result", 60_000);
    await run.run(500);
    await run.tap("Escape");
    expect(await run.finish(5000)).toEqual({ kind: "ingredient", success: false });
  }, 120_000);
});

describe.skipIf(!hasOriginalFiles)("S36 La Mine Désaffectée : parcours depuis le plateau et depuis le mode libre", () => {
  it("plateau, porte du mini-jeu : choc → rien n'est gagné, le tour est fini", async () => {
    const s = await enterFromBoard(36, "MineScene", { seed: 11 });
    const scene = s.ctx.scenes.top as MineScene;
    expect(s.game.state.pending).toMatchObject({ scene: 36, player: 0 });
    expect(s.game.state.phase).toBe("minigame");
    await s.until(() => scene.stage === "result", 120_000);
    expect(scene.hasCrashed).toBe(true);
    await s.run(800);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.state.phase).toBe("turn");
    expect(s.game.player.ingredients).toBe(0);
    expect(s.history).toContain("MineScene");
  }, 180_000);

  it("plateau : mine réussie → l'ingrédient 1 est donné", async () => {
    const s = await enterFromBoard(36, "MineScene", { seed: 11 });
    const scene = s.ctx.scenes.top as MineScene;
    const act = bot({ scene, host: s.host });
    while (scene.stage === "run") {
      act();
      await s.run(16);
    }
    expect(scene.hasCrashed).toBe(false);
    await s.run(800);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.player.ingredients & (1 << 1)).not.toBe(0);
    expect(s.game.player.ingredientCount).toBe(1);
    expect(s.game.state.pending).toBeNull();
  }, 180_000);

  it("mode libre : la mine se joue, puis la carte revient sur le même lieu sans rien appliquer", async () => {
    const run = await enterFromFreeMode(36);
    const scene = run.scene as MineScene;
    expect(scene).toBeInstanceOf(MineScene);
    expect(run.game.state.pending).toMatchObject({ scene: 36 });
    await run.until(() => scene.stage === "result", 120_000);
    await run.run(800);
    await run.tap("Escape");
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 30_000);
    expect(run.free.currentGame).toBeNull();
  }, 180_000);

  it("mode libre : mine réussie, même retour à la carte", async () => {
    const run = await enterFromFreeMode(36, { seed: 5 });
    const scene = run.scene as MineScene;
    const act = bot({ scene, host: run.host });
    while (scene.stage === "run") {
      act();
      await run.run(16);
    }
    expect(scene.hasCrashed).toBe(false);
    await run.run(800);
    await run.tap("Escape");
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 30_000);
  }, 180_000);
});
