import { describe, expect, it } from "vitest";
import { parseHy8, type Hy8 } from "../../../src/games/teleportaschtroumpf/data/hy8";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import {
  BIRD_LEAVE_X,
  BIRD_START_X,
  STORK_BODY,
  STORK_BIRDS,
  STORK_CEILING,
  STORK_DURATION,
  STORK_GROUND,
  STORK_HEAD,
  StorkRun,
  StorkScene,
  birdCount,
  birdHits,
  createStork,
  type StorkKeys,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s34-stork";
import { hasOriginalFiles, listData, readData } from "../helpers";
import type { TestHost } from "../engine-test-host";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchOptions } from "./harness";

const NONE: StorkKeys = { up: false, down: false, left: false, right: false };
const keys = (k: Partial<StorkKeys>): StorkKeys => ({ ...NONE, ...k });

describe("S34 : zones de collision et nombre d'oiseaux (pur, `1b05:0cda`)", () => {
  it("3, 5 ou 7 oiseaux selon le niveau", () => {
    expect(STORK_BIRDS).toEqual([3, 5, 7]);
    expect([0, 1, 2].map(birdCount)).toEqual([3, 5, 7]);
    expect(birdCount(3)).toBe(3);
  });

  it("tête : x dans ]x − 50, x[ (strict), y dans ]y − 20, y + 3[ ; corps : x dans ]x − 48, x − 23[, y dans ]y − 35, y − 7[", () => {
    const hit = (box: typeof STORK_HEAD, bx: number, by: number) => birdHits(box, 100, 100, bx, by);
    // Tête : l'oiseau [bx, bx + 14] doit passer sous le bord droit (100) et dépasser le bord gauche (64).
    expect(hit(STORK_HEAD, 99, 90)).toBe(true);
    expect(hit(STORK_HEAD, 100, 90)).toBe(false);
    expect(hit(STORK_HEAD, 51, 90)).toBe(true);
    expect(hit(STORK_HEAD, 50, 90)).toBe(false);
    // Hauteur : [by − 10, by + 3] contre [83, 93].
    expect(hit(STORK_HEAD, 80, 102)).toBe(true);
    expect(hit(STORK_HEAD, 80, 103)).toBe(false);
    expect(hit(STORK_HEAD, 80, 81)).toBe(true);
    expect(hit(STORK_HEAD, 80, 80)).toBe(false);
    // Corps : bord droit 77, largeur 11, hauteur 15 → [66, 77] × [68, 83].
    expect(hit(STORK_BODY, 76, 80)).toBe(true);
    expect(hit(STORK_BODY, 77, 80)).toBe(false);
    expect(hit(STORK_BODY, 53, 80)).toBe(true);
    expect(hit(STORK_BODY, 52, 80)).toBe(false);
    expect(hit(STORK_BODY, 70, 92)).toBe(true);
    expect(hit(STORK_BODY, 70, 93)).toBe(false);
    expect(hit(STORK_BODY, 70, 66)).toBe(true);
    expect(hit(STORK_BODY, 70, 65)).toBe(false);
  });

  it("la requête est exigée : Game.openMinigame(34) d'abord", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createStork(game, () => undefined)).toThrow(/openMinigame\(34\)/);
  });
});

/** Tirages rejoués dans l'ordre : `script` d'abord, 0 ensuite ; `calls` garde les `n` demandés. */
class ScriptedRandom {
  calls: number[] = [];
  constructor(private script: number[] = []) {}
  below(n: number): number {
    this.calls.push(n);
    return Math.min(this.script.shift() ?? 0, n - 1);
  }
}

function loadHy8(): Hy8 {
  const [path] = listData((name) => name.toUpperCase() === "S34A001S.HY8");
  return parseHy8(readData(path));
}

describe.skipIf(!hasOriginalFiles)("S34 : règles de la cigogne et des oiseaux (`1b05:0929`, `05c7`, `0b96`)", () => {
  const hy8 = loadHy8();
  const make = (count = 3, script: number[] = []) => {
    const rng = new ScriptedRandom(script);
    const run = new StorkRun(hy8, count, rng, 0);
    return { run, rng };
  };

  it("initialisation : les tirages sont dans l'ordre de l'original", () => {
    const { run, rng } = make(2);
    // Image de départ de chaque oiseau (6 images), puis par oiseau : vitesse, seuil de déviation, sens, vitesse en y, amplitude ; enfin x et y.
    expect(rng.calls).toEqual([6, 6, 10, 200, 2, 5, 180, 10, 200, 2, 5, 180, 40, 40]);
    expect(run.birds).toHaveLength(2);
    expect(run.x).toBe(0x78);
    expect(run.y).toBe(0x78);
    expect(run.birds.map((b) => [b.x, b.y, b.active])).toEqual([[BIRD_START_X, 0, false], [BIRD_START_X, 0x2d, false]]);
  });

  it("initialisation : valeurs tirées (vitesse 3..12, seuil 110..309, sens, départ 120..159)", () => {
    const { run } = make(1, [0, 9, 199, 1, 4, 179, 39, 39]);
    expect(run.birds[0]).toMatchObject({ speed: 12, threshold: 309, velocity: -5, amplitude: -179 });
    expect(run.x).toBe(159);
    expect(run.y).toBe(159);
    const down = make(1, [0, 0, 0, 0, 4, 100]).run.birds[0];
    expect(down).toMatchObject({ velocity: 5, amplitude: 100, speed: 3, threshold: 0x6e });
  });

  it("bruitage de battement : demandé à la première image du battement (touche haut), puis seulement au repos contre le sol", () => {
    const { run } = make();
    run.step(NONE, 0, 0);
    expect(run.flapCue).toBe(false); // plané : rien
    run.step(keys({ up: true }), 0, 0);
    expect(run.flapCue).toBe(true); // début du battement
    run.step(NONE, 0, 0);
    expect(run.flapCue).toBe(false); // le battement se poursuit sans nouveau son
    // Sol atteint : une demande à chaque image de repos (la scène la filtre par « aucun bruitage ne sonne »).
    run.y = STORK_GROUND;
    run.flapping = false;
    run.step(NONE, 0, 0);
    expect(run.limit).toBe(true);
    expect(run.flapCue).toBe(true);
    expect(run.hitCue).toBe(false);
  });

  it("planer : la cigogne tombe de 2 par image et se dessine à l'ordonnée d'avant", () => {
    const { run } = make();
    run.step(NONE, 0, 0);
    expect(run.y).toBe(0x7a);
    expect(run.drawY).toBe(0x78);
    expect(run.sprite).toBe(hy8.animations[2].frames[0].sprite);
    run.step(NONE, 0, 0);
    expect(run.y).toBe(0x7c);
  });

  it("flèches : droite +7, gauche −7 (la droite puis la gauche), bas +5 en plus de la chute, bornes 0x39 et 0x13E", () => {
    const { run } = make();
    run.step(keys({ right: true }), 0, 0);
    expect(run.x).toBe(0x78 + 7);
    run.step(keys({ left: true }), 0, 0);
    run.step(keys({ left: true }), 0, 0);
    expect(run.x).toBe(0x78 - 7);
    run.step(keys({ left: true, right: true }), 0, 0);
    expect(run.x).toBe(0x78 - 7);
    const y = run.y;
    run.step(keys({ down: true }), 0, 0);
    expect(run.y).toBe(y + 5 + 2);
    for (let i = 0; i < 40; i++) run.step(keys({ left: true }), 0, 0);
    expect(run.x).toBe(0x39);
    for (let i = 0; i < 80; i++) run.step(keys({ right: true }), 0, 0);
    expect(run.x).toBe(0x13e);
  });

  it("sol : à 200 la cigogne s'arrête, plafond / sol lèvent le drapeau et jouent l'animation de repos", () => {
    const { run } = make();
    for (let i = 0; i < 60; i++) run.step(NONE, 0, 0);
    expect(run.y).toBe(STORK_GROUND);
    expect(run.limit).toBe(true);
    expect(hy8.animations[4].frames.map((f) => f.sprite)).toContain(run.sprite);
    run.step(NONE, 0, 0);
    expect(run.y).toBe(STORK_GROUND);
  });

  it("battement : 6 images (sprites 7 à 12) sans bouger, puis −28 ; une touche relâchée n'interrompt pas le battement", () => {
    const { run } = make();
    run.y = 100;
    run.step(keys({ up: true }), 0, 0);
    const seen = [run.sprite];
    for (let i = 0; i < 4; i++) {
      run.step(NONE, 0, 0);
      seen.push(run.sprite);
      expect(run.y).toBe(100);
      expect(run.flapping).toBe(true);
    }
    run.step(NONE, 0, 0);
    seen.push(run.sprite);
    expect(seen).toEqual([7, 8, 9, 10, 11, 12]);
    expect(run.flapping).toBe(false);
    expect(run.y).toBe(100 - 28);
    // Retour au plané.
    run.step(NONE, 0, 0);
    expect(run.y).toBe(100 - 28 + 2);
  });

  it("plafond : un battement sous y = 0x35 ramène à 0x25 et passe à l'animation de repos", () => {
    const { run } = make();
    run.y = 0x40;
    run.step(keys({ up: true }), 0, 0);
    expect(run.y).toBe(0x40);
    run.y = 0x30;
    run.step(NONE, 0, 0);
    expect(run.y).toBe(STORK_CEILING);
    expect(run.limit).toBe(true);
    expect(run.flapping).toBe(false);
    // Hors battement, le plafond est simplement 0x25 sans drapeau.
    run.y = 0x10;
    run.step(NONE, 0, 0);
    expect(run.y).toBe(STORK_CEILING + 2);
    expect(run.limit).toBe(false);
  });

  it("un oiseau part quand son délai (50 à 99) est écoulé et que 100 centièmes ont passé depuis le dernier départ", () => {
    const { run } = make(2);
    run.step(NONE, 100, 1);
    expect(run.birds.map((b) => b.active)).toEqual([false, false]);
    run.step(NONE, 101, 1);
    expect(run.birds.map((b) => b.active)).toEqual([true, false]);
    // Le second attend 100 centièmes de plus.
    run.step(NONE, 150, 1);
    expect(run.birds[1].active).toBe(false);
    run.step(NONE, 202, 2);
    expect(run.birds[1].active).toBe(true);
    // Le premier avance de sa vitesse par image (3) à partir de l'image suivant son départ, avec l'animation de l'oiseau.
    expect(run.birds[0].x).toBe(BIRD_START_X - 3 * 2);
    expect(hy8.animations[0].frames.map((f) => f.sprite)).toContain(run.birds[0].sprite);
  });

  it("le délai tiré (50 + 0..49) retarde le départ", () => {
    // 1 oiseau : 8 tirages d'initialisation, puis celui du délai à chaque image.
    const launched = (wait: number) => {
      const { run } = make(1, [0, 0, 0, 0, 0, 0, 0, 0, wait]);
      run.birds[0].timer = 200;
      run.step(NONE, 260, 1);
      return run.birds[0].active;
    };
    expect(launched(0)).toBe(true);
    expect(launched(9)).toBe(true);
    expect(launched(10)).toBe(false);
    expect(launched(49)).toBe(false);
  });

  it("un oiseau sorti à gauche (x ≤ −40) est relancé à droite, y 15..194, plus vite après 15 s", () => {
    const { run } = make(1, [0, 0, 0, 0, 0, 0, 0, 0]);
    const bird = run.birds[0];
    bird.active = true;
    bird.x = BIRD_LEAVE_X + 3 - 1;
    run.birds[0].speed = 3;
    run.step(NONE, 500, 3);
    expect(bird.active).toBe(false);
    expect(bird.x).toBe(BIRD_START_X);
    expect(bird.y).toBe(15);
    expect(bird.speed).toBe(3);
    bird.active = true;
    bird.x = BIRD_LEAVE_X;
    const later = make(1, [0, 0, 0, 0, 0, 0, 0, 0]).run;
    const b2 = later.birds[0];
    b2.active = true;
    b2.x = BIRD_LEAVE_X;
    later.step(NONE, 5000, 20);
    expect(b2.speed).toBe(7);
  });

  it("déviation : sous le seuil l'oiseau monte ou descend de sa vitesse jusqu'à y + amplitude, entre 15 et 200", () => {
    const { run } = make(1, [0, 0, 0, 0, 0, 0, 0, 0]);
    const bird = run.birds[0];
    run.x = 300; // loin de l'oiseau
    Object.assign(bird, { active: true, x: 120, y: 100, speed: 5, threshold: 110, velocity: 3, amplitude: 9 });
    run.step(NONE, 10, 1);
    expect(bird.x).toBe(115);
    expect(bird.deviating).toBe(false);
    run.step(NONE, 10, 1);
    expect(bird.x).toBe(110);
    run.step(NONE, 10, 1);
    expect(bird.x).toBe(105);
    expect(bird.deviating).toBe(true);
    expect(bird.target).toBe(109);
    expect(bird.y).toBe(103);
    run.step(NONE, 10, 1);
    run.step(NONE, 10, 1);
    expect(bird.y).toBe(109);
    // La cible est dépassée d'un pas (le test se fait avant le déplacement) : il s'arrête, puis repart vers une nouvelle cible.
    run.step(NONE, 10, 1);
    expect(bird.y).toBe(112);
    expect(bird.deviating).toBe(true);
    run.step(NONE, 10, 1);
    expect(bird.deviating).toBe(false);
    expect(bird.y).toBe(112);
    run.step(NONE, 10, 1);
    expect(bird.deviating).toBe(true);
    expect(bird.target).toBe(121);
    Object.assign(bird, { y: 12, deviating: true, velocity: -3, target: -50, x: 200 });
    run.step(NONE, 10, 1);
    expect(bird.y).toBe(15);
    expect(bird.deviating).toBe(false);
    Object.assign(bird, { y: 199, deviating: true, velocity: 3, target: 300, x: 200 });
    run.step(NONE, 10, 1);
    expect(bird.y).toBe(200);
    expect(bird.deviating).toBe(false);
  });

  it("un oiseau qui touche la tête (animation 3, 5 images) ou le corps (animation 5, 6 images) fait tomber la cigogne, puis l'échec", () => {
    // Tête : y dans ]y − 20, y + 3[ ; corps seul : y dans ]y − 35, y − 20].
    for (const [dx, dy, length] of [[-10, -5, 5], [-35, -30, 6]] as const) {
      const { run } = make(1);
      const bird = run.birds[0];
      run.x = 150;
      run.y = 100;
      // Placé juste à l'avance pour que le contact ait lieu pendant la prochaine image (la cigogne plane : y + 2).
      Object.assign(bird, { active: true, x: 150 + dx + 3, y: 102 + dy, speed: 3, threshold: -999 });
      run.step(NONE, 0, 1);
      expect(run.dying).toBe(true);
      expect(bird.hit).toBe(true);
      expect(bird.active).toBe(false);
      let frames = 0;
      let result: "stop" | void = undefined;
      while (!run.failed) {
        result = run.step(NONE, 0, 1);
        frames++;
        expect(frames).toBeLessThan(10);
      }
      expect(result).toBeUndefined();
      expect(frames).toBe(length);
      expect(run.dying).toBe(false);
      expect(run.end).toBe("failure");
      expect(run.step(NONE, 0, 1)).toBe("stop");
    }
  });

  it("après 28 s plus aucun oiseau ne part ; écran libre, la cigogne s'envole vers (438, 100) et la sortie réussit à x ≥ 300", () => {
    const { run } = make(2);
    let now = 10_000;
    const tick = (elapsed: number) => run.step(NONE, (now += 9), elapsed);
    tick(STORK_DURATION - 1);
    expect(run.birds[0].active).toBe(true);
    run.birds[0].x = BIRD_LEAVE_X + 1;
    // Un oiseau est encore en vol : pas de sortie ; il quitte l'écran à cette image.
    let result = tick(STORK_DURATION);
    expect(run.mayExit).toBe(true);
    expect(run.birds.every((b) => !b.active)).toBe(true);
    expect(run.end).toBeNull();
    const startX = run.x;
    const startY = run.y;
    tick(STORK_DURATION);
    // Un vingtième du chemin : (438 − x) / 20 en x, (100 − y) / 20 en y.
    expect(run.x).toBe(startX + Math.trunc((438 - startX) / 20));
    expect(run.y).toBe(startY + Math.trunc((100 - startY) / 20));
    let frames = 1;
    while (!run.succeeded) {
      result = tick(STORK_DURATION);
      if (++frames > 60) throw new Error("la sortie ne se termine pas");
    }
    expect(result).toBe("stop");
    expect(run.x).toBeGreaterThanOrEqual(0x12c);
    expect(run.end).toBe("success");
    // Les délais redémarrent à chaque image : aucun oiseau n'est reparti pendant la sortie.
    expect(run.birds.every((b) => !b.active)).toBe(true);
  });

  it("une chute commencée avant les 28 s se termine (pas de sortie pendant la chute)", () => {
    const { run } = make(1);
    const bird = run.birds[0];
    run.x = 150;
    run.y = 100;
    Object.assign(bird, { active: true, x: 143, y: 97, speed: 3, threshold: -999 });
    run.step(NONE, 5, STORK_DURATION - 1);
    expect(run.dying).toBe(true);
    run.step(NONE, 14, STORK_DURATION);
    expect(run.mayExit).toBe(false);
    for (let i = 0; i < 10; i++) run.step(NONE, 23 + i * 9, STORK_DURATION);
    expect(run.end).toBe("failure");
    expect(run.succeeded).toBe(false);
  });
});

// --- Pilote -----------------------------------------------------------------------------------------

/**
 * Pilote : regarde les oiseaux en vol (leur vitesse est constante, leur hauteur varie peu) et choisit chaque tick, parmi plané /
 * plongée / battement et gauche / rien / droite, ce qui évite le plus longtemps toute collision sur 8 images.
 */
function bot(run: { scene: unknown; host: TestHost }) {
  const scene = run.scene as StorkScene;
  const held: Record<string, boolean> = {};
  const set = (code: string, on: boolean) => {
    if ((held[code] ?? false) === on) return;
    held[code] = on;
    if (on) run.host.input.keyDown(code);
    else run.host.input.keyUp(code);
  };
  return () => {
    if (scene.stage !== "ride" || scene.currentFrame < 0) {
      for (const code of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) set(code, false);
      return;
    }
    const s = scene.state;
    const birds = s.birds.filter((b) => b.active);
    let best = { cost: Infinity, v: 0, h: 0 };
    for (const v of [0, 1, 2]) {
      for (const h of [0, 1, -1]) {
        let cost = (v === 0 ? 0 : 1) + (h === 0 ? 0 : 1);
        for (let t = 1; t <= 8; t++) {
          const x = Math.min(0x13e, Math.max(0x39, s.x + h * 7 * t));
          const y = Math.min(200, Math.max(0x25, v === 0 ? s.y + 2 * t : v === 1 ? s.y + 7 * t : t >= 6 ? s.y - 28 : s.y));
          if (birds.some((b) => birdHits(STORK_HEAD, x, y, b.x - b.speed * t, b.y) || birdHits(STORK_BODY, x, y, b.x - b.speed * t, b.y))) {
            cost += 1000 - t * 10;
            break;
          }
        }
        if (cost < best.cost) best = { cost, v, h };
      }
    }
    set("ArrowUp", best.v === 2);
    set("ArrowDown", best.v === 1);
    set("ArrowRight", best.h === 1);
    set("ArrowLeft", best.h === -1);
  };
}

/** Graines pour lesquelles le pilote réussit (les oiseaux sont tirés avec le hasard du jeu). */
const WINNING_SEEDS: Record<number, number> = { 0: 4, 1: 16, 2: 14 };

async function play(options: LaunchOptions) {
  const run = await launchMinigame(34, options);
  const scene = run.scene as StorkScene;
  const act = bot(run);
  await run.until(() => {
    act();
    return scene.stage !== "ride";
  }, 90_000);
  return { run, scene };
}

describe.skipIf(!hasOriginalFiles)("S34 La Cigogne : la traversée, l'issue", () => {
  it("le niveau donne 3, 5 ou 7 oiseaux ; l'indice de l'oiseau 3 (et il est consommé)", async () => {
    for (const level of [0, 1, 2]) {
      const run = await launchMinigame(34, { level, seed: 3 });
      expect((run.scene as StorkScene).state.birds).toHaveLength(STORK_BIRDS[level]);
    }
    const run = await launchMinigame(34, { level: 2, bonus: true, seed: 3 });
    expect((run.scene as StorkScene).state.birds).toHaveLength(3);
    expect(run.game.state.pending?.bonus).toBe(true);
    expect(run.game.state.bonusTag).toBe(0);
  }, 60_000);

  it("graine fixe : même départ, même traversée", async () => {
    const trace = async () => {
      const run = await launchMinigame(34, { seed: 9, level: 1 });
      const scene = run.scene as StorkScene;
      await run.run(4000);
      return JSON.stringify([scene.currentFrame, scene.state.x, scene.state.y, scene.state.birds.map((b) => [b.active, b.x, b.y, b.speed])]);
    };
    expect(await trace()).toBe(await trace());
  }, 60_000);

  it("sans rien toucher : elle tombe au sol, un oiseau la touche ; chute, fondu, vidéo s34b, aucun ingrédient", async () => {
    const run = await launchMinigame(34, { level: 1, seed: 1, audio: true });
    const scene = run.scene as StorkScene;
    const hit = await run.ctx.resources.voc("s34a004b.voc");
    expect(scene.stage).toBe("ride");
    await run.run(1500);
    run.shot("s34-depart");
    await run.until(() => scene.state.dying, 60_000);
    run.shot("s34-chute-0");
    await run.run(400);
    run.shot("s34-chute-1");
    expect(scene.state.y).toBe(STORK_GROUND);
    expect(run.outcome).toBeUndefined();
    const stages = new Set<string>();
    await run.until(() => {
      stages.add(scene.stage);
      return scene.stage === "result";
    }, 60_000);
    expect([...stages]).toEqual(expect.arrayContaining(["hitSound", "fadeOut", "result"]));
    expect(scene.state.end).toBe("failure");
    expect(run.host.audio.effects.some((p) => p.sound.samples === hit.samples)).toBe(true);
    await run.run(1000);
    run.shot("s34-echec-video");
    const outcome = await run.finish(60_000);
    expect(outcome).toEqual({ kind: "ingredient", success: false });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.ingredients).toBe(0);
  }, 120_000);

  it("pilote qui évite tout (niveaux 0, 1 et 2) : la cigogne sort à droite, c1 (hors objectif), ingrédient 0 donné", async () => {
    for (const level of [0, 1, 2]) {
      const { run, scene } = await play({ level, seed: WINNING_SEEDS[level], setup: (game) => (game.state.goal.ingredients &= ~1) });
      expect(scene.state.end).toBe("success");
      expect(scene.escaped).toBe(true);
      expect(scene.state.timeUp).toBe(true);
      expect(scene.currentFrame).toBeLessThan(373);
      expect(scene.stage).toBe("fadeOut");
      const files: string[] = [];
      run.host.loaded.forEach((f) => files.push(f));
      const outcome = await run.finish(60_000);
      expect(outcome).toEqual({ kind: "ingredient", success: true });
      run.game.resolveMinigame(outcome);
      expect(run.game.player.ingredients & 1).toBe(1);
    }
  }, 300_000);

  it("réussite : s34c2 quand l'ingrédient 0 fait partie de l'objectif, s34c1 sinon", async () => {
    const files = async (inGoal: boolean) => {
      const { run } = await play({ level: 0, seed: WINNING_SEEDS[0], setup: (game) => (inGoal ? (game.state.goal.ingredients |= 1) : (game.state.goal.ingredients &= ~1)) });
      await run.finish(60_000);
      return [...run.host.loaded].map((f) => f.toUpperCase().split("/").pop());
    };
    const withGoal = await files(true);
    expect(withGoal).toContain("S34C2.MUX");
    expect(withGoal).not.toContain("S34C1.MUX");
    const without = await files(false);
    expect(without).toContain("S34C1.MUX");
    expect(without).not.toContain("S34C2.MUX");
  }, 300_000);

  it("après 28 s aucun nouvel oiseau ne part, et la cigogne ne sort qu'une fois l'écran libre", async () => {
    const run = await launchMinigame(34, { level: 0, seed: WINNING_SEEDS[0] });
    const scene = run.scene as StorkScene;
    const act = bot(run);
    let launchedAfter = 0;
    let wasActive = scene.state.birds.map((b) => b.active);
    let exitedWithBird = false;
    await run.until(() => {
      act();
      const { birds, timeUp, succeeded } = scene.state;
      if (timeUp) {
        birds.forEach((b, i) => {
          if (b.active && !wasActive[i]) launchedAfter++;
        });
      }
      wasActive = birds.map((b) => b.active);
      if (succeeded && birds.some((b) => b.active)) exitedWithBird = true;
      return scene.stage !== "ride";
    }, 90_000);
    expect(scene.state.timeUp).toBe(true);
    expect(launchedAfter).toBe(0);
    expect(exitedWithBird).toBe(false);
    expect(scene.state.end).toBe("success");
  }, 120_000);

  it("clavier : haut bat des ailes, bas plonge, gauche / droite avancent (flèches et Q A Z X) ; un appui court compte", async () => {
    const run = await launchMinigame(34, { level: 0, seed: 2 });
    const scene = run.scene as StorkScene;
    await run.until(() => scene.currentFrame >= 1, 3000);
    const x0 = scene.state.x;
    run.host.input.keyDown("ArrowRight");
    await run.until(() => scene.state.x > x0 + 20, 3000);
    run.host.input.keyUp("ArrowRight");
    expect((scene.state.x - x0) % 7).toBe(0);
    const x1 = scene.state.x;
    run.host.input.keyDown("KeyZ"); // Z = gauche
    await run.until(() => scene.state.x < x1 - 14, 3000);
    run.host.input.keyUp("KeyZ");
    const y0 = scene.state.y;
    run.host.input.keyDown("KeyQ"); // Q = haut : battement
    await run.until(() => scene.state.flapping, 3000);
    run.host.input.keyUp("KeyQ");
    await run.until(() => !scene.state.flapping, 3000);
    expect(scene.state.y).toBeLessThan(y0);
    const before = scene.currentFrame;
    const x = scene.state.x;
    run.host.input.keyDown("ArrowLeft");
    await run.run(2 * (1000 / 60));
    run.host.input.keyUp("ArrowLeft");
    await run.until(() => scene.currentFrame > before, 2000);
    expect(scene.state.x).toBe(x - 7);
  }, 60_000);

  it("la traversée ne se passe pas (Échap, Espace sans effet) ; les vidéos de fin se passent", async () => {
    const run = await launchMinigame(34, { level: 1, seed: 1 });
    const scene = run.scene as StorkScene;
    await run.run(1000);
    await run.tap("Escape");
    await run.tap("Space");
    expect(scene.stage).toBe("ride");
    await run.until(() => scene.stage === "result", 60_000);
    await run.run(500);
    await run.tap("Escape");
    expect(await run.finish(5000)).toEqual({ kind: "ingredient", success: false });
  }, 120_000);

  it("captures : la cigogne et les oiseaux (niveau 2), battement, sortie", async () => {
    const run = await launchMinigame(34, { level: 2, seed: WINNING_SEEDS[2] });
    const scene = run.scene as StorkScene;
    const act = bot(run);
    let shots = 0;
    await run.until(() => {
      act();
      const frame = scene.currentFrame;
      if (shots === 0 && frame >= 60) (run.shot("s34-niveau2-60"), shots++);
      if (shots === 1 && frame >= 150) (run.shot("s34-niveau2-150"), shots++);
      if (shots === 2 && scene.state.mayExit && scene.state.x > 220) (run.shot("s34-sortie"), shots++);
      return scene.stage !== "ride";
    }, 90_000);
    expect(shots).toBeGreaterThanOrEqual(2);
  }, 120_000);
});

describe.skipIf(!hasOriginalFiles)("S34 La Cigogne : parcours depuis le plateau et depuis le mode libre", () => {
  const drive = async (scene: StorkScene, host: TestHost, step: () => Promise<void>) => {
    const act = bot({ scene, host });
    while (scene.stage === "ride") {
      act();
      await step();
    }
  };

  it("plateau, porte de l'écran 1 : oiseau heurté → rien n'est gagné, le tour est fini", async () => {
    const s = await enterFromBoard(34, "StorkScene", { seed: 1 });
    const scene = s.ctx.scenes.top as StorkScene;
    expect(s.game.state.pending).toMatchObject({ scene: 34, player: 0 });
    expect(s.game.state.phase).toBe("minigame");
    await s.until(() => scene.stage === "result", 90_000);
    expect(scene.state.end).toBe("failure");
    await s.run(800);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.state.phase).toBe("turn");
    expect(s.game.player.ingredients).toBe(0);
    expect(s.history).toContain("StorkScene");
  }, 180_000);

  it("plateau : traversée réussie → l'ingrédient 0 est donné", async () => {
    // Graine où le robot gagne en entrant par la porte (le déroulé du plateau, voix d'accroche comprise, change le tirage).
    const s = await enterFromBoard(34, "StorkScene", { seed: 10 });
    const scene = s.ctx.scenes.top as StorkScene;
    await drive(scene, s.host, () => s.run(32));
    expect(scene.state.end).toBe("success");
    await s.run(800);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.player.ingredients & 1).toBe(1);
    expect(s.game.player.ingredientCount).toBe(1);
    expect(s.game.state.pending).toBeNull();
  }, 180_000);

  it("mode libre : l'échec rend à la carte sur le même lieu sans rien appliquer", async () => {
    const run = await enterFromFreeMode(34, { seed: 5 });
    const scene = run.scene as StorkScene;
    expect(scene).toBeInstanceOf(StorkScene);
    expect(run.game.state.pending).toMatchObject({ scene: 34 });
    await run.until(() => scene.stage === "result", 90_000);
    await run.run(800);
    await run.tap("Escape");
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 30_000);
    expect(run.free.currentGame).toBeNull();
  }, 180_000);

  it("mode libre : traversée réussie, même retour à la carte", async () => {
    const run = await enterFromFreeMode(34, { seed: 1 });
    const scene = run.scene as StorkScene;
    await drive(scene, run.host, () => run.run(32));
    expect(scene.state.end).toBe("success");
    await run.run(800);
    await run.tap("Escape");
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 30_000);
  }, 180_000);
});
