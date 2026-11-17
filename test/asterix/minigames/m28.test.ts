import { describe, expect, it } from "vitest";
import { registerMinigame } from "../../../src/games/asterix/scenes/minigame";
import {
  BOX,
  DELAY_BASE,
  DRIFT_MAX,
  DRIFT_MIN,
  DRIFT_STEP,
  DURATION,
  FIRST_DELAY,
  FRAME_TICKS,
  GAIN,
  MODULE_PIRATES,
  MODULE_SANGLIERS,
  PHASE_APPEARING,
  PHASE_HIT,
  PHASE_IDLE,
  PHASE_LEAVING,
  PHASE_WAITING,
  SPOT_COUNT,
  script,
  targetBox,
  type SangliersState,
} from "../../../src/games/asterix/scenes/minigames/m28";
import type { Launched } from "../game-helpers";
import { hasOriginalFiles } from "../helpers";
import { launchMinigame, minigamePlayer, minigameState, untilMinigameOver } from "./harness";
import { aim, playM28, playM29, shootTarget, targetUp } from "./m28-player";

/**
 * Mini-jeux des Sangliers et des Pirates (`docs/asterix/minigames/m28.md`) : un seul script (`24e3:0406`), lancé par la
 * case 20 (argument 0) ou la case 52 (argument 1), joué à la souris, au doigt ou au clavier sur le moteur de test.
 * L'inscription définitive est dans `scenes/minigames/index.ts` ; elle est refaite ici pour que ce fichier se suffise.
 */
registerMinigame(MODULE_SANGLIERS, script);
registerMinigame(MODULE_PIRATES, script);

const TICK_MS = 1000 / 60;
const FRAME_MS = FRAME_TICKS * TICK_MS;

const loaded = (run: Launched, name: string): boolean => run.host.loaded.some((path) => path.toUpperCase().includes(name));

const GAMES = [
  {
    name: "Sangliers (M28)",
    module: MODULE_SANGLIERS,
    player: playM28,
    position: 19,
    announce: "K60TE19",
    picture: "M28DA000.MCC",
    won: ["M28DB000.MCC", "M28AB.MUX"],
    lost: ["M28DB001.MCC", "M28AC.MUX"],
    /** Images de l'animation de sortie (les deux variantes). */
    appearFrames: 5,
  },
  {
    name: "Pirates (M29)",
    module: MODULE_PIRATES,
    player: playM29,
    position: 51,
    announce: "K60TE22",
    picture: "M29DA000.MCC",
    won: ["M29AA.MUX"],
    lost: ["M29DB000.MCC", "M29AB.MUX"],
    appearFrames: 4,
  },
] as const;

/** Avance jusqu'à la sortie d'une cible. */
async function untilTarget(run: Launched, state: SangliersState): Promise<void> {
  await run.until(() => targetUp(state), 10_000);
}

/** Point de l'écran hors de la zone de tir de la cible courante. */
function beside(state: SangliersState): { x: number; y: number } {
  const box = targetBox(state);
  return { x: box.x1 > 40 ? box.x1 - 20 : box.x2 + 20, y: aim(state).y };
}

describe.skipIf(!hasOriginalFiles)("Astérix, mini-jeux des Sangliers (M28) et des Pirates (M29)", () => {
  for (const game of GAMES) {
    describe(game.name, () => {
      it("sa case lance le mini-jeu inscrit, après son annonce", async () => {
        const run = await launchMinigame({ module: game.module });
        const state = minigameState<SangliersState>(run);
        expect(run.rt.hint.module).toBe(game.module);
        expect(minigamePlayer(run).pos).toBe(game.position);
        expect(loaded(run, game.announce)).toBe(true);
        expect(loaded(run, game.picture)).toBe(true);
        expect(state).toMatchObject({ game: game.module - MODULE_SANGLIERS, phase: PHASE_IDLE, missed: false, delay: FIRST_DELAY, hits: 0 });
        expect(state.spots).toHaveLength(SPOT_COUNT);
        // La flèche du jeu est à l'écran, au centre, dans sa couleur.
        const { surface } = run.host.lastPresentation;
        expect(surface[102 * 320 + 161]).toBe(0xff);
        expect([...run.rt.ctx.palette.colors.subarray(0xff * 3, 0x100 * 3)]).toEqual([0x80, 0, 0x80]);
        run.shot(`m${game.module}-depart`);
      });

      for (const action of [0, 1, 2]) {
        it(`niveau Action ${action} : victoire après ${DURATION} s sans faute, ${GAIN} sesterce, zone et délais du niveau`, async () => {
          const run = await launchMinigame({ module: game.module, action }, { seed: 200 + action });
          const state = minigameState<SangliersState>(run);
          const started = run.host.time;
          // Première cible : quand le chrono 3 (parti un peu avant la phase jouable) dépasse 2 secondes.
          await untilTarget(run, state);
          expect(run.host.time - started).toBeGreaterThan(2_500);
          expect(run.host.time - started).toBeLessThan(3_100);
          // Zone de tir du niveau (retournée avec un sanglier en miroir).
          const sides = [BOX.left - BOX.perLevel.left * action, BOX.right - BOX.perLevel.right * action];
          expect([state.left, state.right]).toEqual(state.mirrored ? sides.reverse() : sides);
          expect(state.top).toBe(BOX.top - BOX.perLevel.top * action);
          expect(state.bottom).toBe(BOX.bottom - BOX.perLevel.bottom * action);
          const spots = new Set<number>();
          while (run.screen === "minigame") {
            if (!targetUp(state)) {
              await run.frame();
              continue;
            }
            spots.add(state.spot);
            // Aucune cible ne sort après la fin du temps.
            expect(run.host.time - started).toBeLessThan((DURATION + 1) * 1000);
            // Cible touchée une fois sortie : la suivante sort `4 − niveau` secondes après la fin de cette sortie (chrono 3).
            await run.until(() => state.phase === PHASE_WAITING, 1_000);
            const waiting = run.host.time;
            expect(await shootTarget(run, state)).toBe(true);
            expect(state).toMatchObject({ phase: PHASE_HIT, missed: false });
            await run.until(() => state.phase !== PHASE_HIT, 1_000);
            expect(state).toMatchObject({ phase: PHASE_IDLE, mirrored: false, delay: DELAY_BASE - action });
            await run.until(() => targetUp(state) || run.screen !== "minigame", 10_000);
            if (run.screen === "minigame") expect(Math.abs(run.host.time - waiting - (DELAY_BASE - action + 1) * 1000)).toBeLessThanOrEqual(2 * FRAME_MS);
          }
          expect(state).toMatchObject({ missed: false, phase: PHASE_IDLE });
          expect(state.hits).toBeGreaterThanOrEqual(5);
          expect(state.hits).toBeLessThanOrEqual(13);
          expect(spots.size).toBeGreaterThan(2);
          expect(run.host.time - started).toBeGreaterThanOrEqual((DURATION - 1) * 1000);
          // La cible suivante sort `4 − niveau` secondes après la fin de la sortie de la précédente (chrono 3), à une image près.
          run.shot(`m${game.module}-gagne-fin-du-jeu`);
          await untilMinigameOver(run);
          expect(minigamePlayer(run).sesterces).toBe(GAIN);
          for (const file of game.won) expect(loaded(run, file)).toBe(true);
          for (const file of game.lost) expect(loaded(run, file)).toBe(false);
          expect(run.rt.missing).toEqual([]);
        });

        it(`niveau Action ${action} : une cible laissée repart après ${action === 0 ? 3 : 2} s, et c'est perdu`, async () => {
          const run = await launchMinigame({ module: game.module, action }, { seed: 300 + action });
          const state = minigameState<SangliersState>(run);
          await untilTarget(run, state);
          const appeared = run.host.time;
          await run.until(() => state.phase === PHASE_WAITING, 1_000);
          // La sortie dure toute son animation, puis la cible attend `stay + 1` secondes entières.
          expect(Math.abs(run.host.time - appeared - game.appearFrames * FRAME_MS)).toBeLessThanOrEqual(FRAME_MS);
          expect(state.stay).toBe(action === 0 ? 2 : 1);
          const waiting = run.host.time;
          run.shot(`m${game.module}-cible-variante${state.variant}-niveau${action}`);
          await run.until(() => state.phase === PHASE_LEAVING, 5_000);
          expect(Math.abs(run.host.time - waiting - (state.stay + 1) * 1000)).toBeLessThanOrEqual(2 * FRAME_MS);
          expect(state.missed).toBe(false);
          await game.player(run, false);
          expect(state).toMatchObject({ missed: true, phase: PHASE_IDLE, hits: 0 });
          await untilMinigameOver(run);
          expect(minigamePlayer(run).sesterces).toBe(0);
          for (const file of game.lost) expect(loaded(run, file)).toBe(true);
          for (const file of game.won) expect(loaded(run, file)).toBe(false);
          expect(run.rt.missing).toEqual([]);
        });
      }

      it("touchée pendant sa sortie, une cible ne relance pas le chrono 3 : la suivante sort dès la fin de sa chute", async () => {
        const run = await launchMinigame({ module: game.module, action: 1 }, { seed: 21 });
        const state = minigameState<SangliersState>(run);
        await untilTarget(run, state);
        await run.until(() => state.phase === PHASE_WAITING, 1_000);
        expect(await shootTarget(run, state)).toBe(true);
        await run.until(() => state.phase === PHASE_IDLE, 1_000);
        await untilTarget(run, state);
        expect(state.phase).toBe(PHASE_APPEARING);
        expect(await shootTarget(run, state)).toBe(true);
        await run.until(() => state.phase === PHASE_IDLE, 1_000);
        const fallen = run.host.time;
        await untilTarget(run, state);
        expect(run.host.time - fallen).toBeLessThanOrEqual(2 * FRAME_MS);
        expect(state.hits).toBe(2);
      });

      it("tirer sans cible fait perdre aussitôt", async () => {
        const run = await launchMinigame({ module: game.module }, { seed: 11 });
        const state = minigameState<SangliersState>(run);
        const started = run.host.time;
        await run.click(160, 100);
        await run.until(() => run.screen !== "minigame", 500);
        expect(state).toMatchObject({ missed: true, phase: PHASE_IDLE, hits: 0 });
        expect(run.host.time - started).toBeLessThan(500);
        await untilMinigameOver(run);
        expect(minigamePlayer(run).sesterces).toBe(0);
        for (const file of game.lost) expect(loaded(run, file)).toBe(true);
      });

      it("tirer à côté de la cible fait perdre : elle repart au plus tôt, puis la partie s'arrête", async () => {
        const run = await launchMinigame({ module: game.module, action: 0 }, { seed: 12 });
        const state = minigameState<SangliersState>(run);
        await untilTarget(run, state);
        await run.until(() => state.phase === PHASE_WAITING, 1_000);
        const waiting = run.host.time;
        const { x, y } = beside(state);
        await run.click(x, y);
        await run.until(() => state.missed, 500);
        expect(state).toMatchObject({ phase: PHASE_WAITING, stay: 0, hits: 0 });
        // Une fois la faute commise, les tirs ne comptent plus : la cible ne peut plus être touchée.
        const center = aim(state);
        await run.click(center.x, center.y);
        await run.until(() => state.phase === PHASE_LEAVING, 2_000);
        expect(run.host.time - waiting).toBeLessThan(1_000 + 2 * FRAME_MS);
        expect(run.screen).toBe("minigame");
        await run.until(() => run.screen !== "minigame", 2_000);
        expect(state).toMatchObject({ missed: true, phase: PHASE_IDLE, hits: 0 });
        await untilMinigameOver(run);
        expect(minigamePlayer(run).sesterces).toBe(0);
      });

      it("tirer sur une cible qui repart fait perdre, même en plein dessus", async () => {
        const run = await launchMinigame({ module: game.module, action: 2 }, { seed: 13 });
        const state = minigameState<SangliersState>(run);
        await run.until(() => state.phase === PHASE_LEAVING, 10_000);
        const { x, y } = aim(state);
        run.host.input.pointerHovering = true;
        run.host.input.mouseMove(x, y);
        run.host.input.mouseDown(0);
        await run.frame();
        run.host.input.mouseUp(0);
        await run.until(() => state.missed, 500);
        expect(state.hits).toBe(0);
      });

      it("un tir pendant la chute d'une cible touchée est ignoré", async () => {
        const run = await launchMinigame({ module: game.module, action: 1 }, { seed: 14 });
        const state = minigameState<SangliersState>(run);
        await untilTarget(run, state);
        expect(await shootTarget(run, state)).toBe(true);
        expect(state.phase).toBe(PHASE_HIT);
        run.shot(`m${game.module}-touche-variante${state.variant}`);
        run.host.input.mouseMove(5, 5);
        run.host.input.mouseDown(0);
        await run.frame();
        run.host.input.mouseUp(0);
        await run.until(() => state.phase === PHASE_IDLE, 1_000);
        expect(state).toMatchObject({ missed: false, hits: 1 });
        expect(run.screen).toBe("minigame");
      });

      it("la zone de tir : bornes exclues, juste dedans touche, sur le bord manque", async () => {
        for (const [edge, hit] of [
          ["inside", true],
          ["border", false],
        ] as const) {
          const run = await launchMinigame({ module: game.module, action: 2 }, { seed: 15 });
          const state = minigameState<SangliersState>(run);
          await untilTarget(run, state);
          const box = targetBox(state);
          const { x, y } = state.spots[state.spot];
          // La zone suit l'emplacement de la table, décalé de (−32, −40) comme le sprite.
          expect(box.x2 - box.x1).toBe(Math.min(x - 32, state.left) + state.right);
          expect(box.y2).toBe(y - 40 + state.bottom);
          await run.click(edge === "inside" ? box.x2 - 1 : box.x2, Math.min(199, box.y2 - 1));
          await run.until(() => state.missed || state.phase === PHASE_HIT, 500);
          expect(state.missed).toBe(!hit);
        }
      });

      it("les sesterces gagnés s'ajoutent, une défaite n'en retire pas", async () => {
        for (const win of [true, false]) {
          const run = await launchMinigame({ module: game.module, action: 2 }, { seed: 16 });
          minigamePlayer(run).sesterces = 5;
          await game.player(run, win);
          await untilMinigameOver(run);
          expect(minigamePlayer(run).sesterces).toBe(win ? 5 + GAIN : 5);
        }
      });

      it("au clavier : le pointeur dérive d'un bord à l'autre, les flèches le déplacent, Espace tire là où il est", async () => {
        const run = await launchMinigame({ module: game.module, action: 0 }, { seed: 17 });
        const state = minigameState<SangliersState>(run);
        const { input } = run.host;
        expect(input.pointerHovering).toBe(false);
        // Dérive seule : 2 pixels par tick vers la droite.
        const x0 = input.mouseX;
        await run.run(10 * TICK_MS);
        expect(input.mouseX - x0).toBeGreaterThanOrEqual(9 * DRIFT_STEP);
        expect(input.mouseX - x0).toBeLessThanOrEqual(11 * DRIFT_STEP);
        expect(input.mouseY).toBe(100);
        // Flèche gauche tenue : 4 pixels par tick contre la dérive, soit 2 vers la gauche.
        const x1 = input.mouseX;
        input.keyDown("ArrowLeft");
        await run.run(10 * TICK_MS);
        input.keyUp("ArrowLeft");
        expect(x1 - input.mouseX).toBeGreaterThanOrEqual(9 * DRIFT_STEP);
        expect(x1 - input.mouseX).toBeLessThanOrEqual(11 * DRIFT_STEP);
        await untilTarget(run, state);
        const keys = { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false };
        const hold = (code: keyof typeof keys, down: boolean): void => {
          if (keys[code] === down) return;
          keys[code] = down;
          if (down) input.keyDown(code);
          else input.keyUp(code);
        };
        // Vise aux flèches, tire avec Espace une fois le pointeur dans la zone.
        while (targetUp(state)) {
          const box = targetBox(state);
          const target = aim(state);
          hold("ArrowLeft", input.mouseX > target.x + 4);
          hold("ArrowRight", input.mouseX < target.x - 8);
          hold("ArrowUp", input.mouseY > target.y + 4);
          hold("ArrowDown", input.mouseY < target.y - 4);
          if (input.mouseX > box.x1 + 8 && input.mouseX < box.x2 - 8 && input.mouseY > box.y1 + 4 && input.mouseY < Math.min(200, box.y2) - 4) {
            input.keyDown("Space");
            await run.frame();
            input.keyUp("Space");
          }
          await run.frame();
        }
        for (const code of Object.keys(keys) as (keyof typeof keys)[]) hold(code, false);
        expect(state).toMatchObject({ phase: PHASE_HIT, missed: false, hits: 1 });
        run.shot(`m${game.module}-clavier`);
      });

      it("sans souris, le pointeur fait demi-tour à 300 puis à 20, sans jamais changer de hauteur", async () => {
        const run = await launchMinigame({ module: game.module, action: 0 }, { seed: 17 });
        const { input } = run.host;
        const turns: number[] = [];
        let previous = input.mouseX;
        let direction = 1;
        const end = run.host.time + 5_500;
        while (run.host.time < end) {
          await run.frame();
          const moved = Math.sign(input.mouseX - previous);
          if (moved !== 0 && moved !== direction) {
            turns.push(previous);
            direction = moved;
          }
          previous = input.mouseX;
          expect(input.mouseY).toBe(100);
        }
        expect(run.screen).toBe("minigame");
        expect(turns).toEqual([DRIFT_MAX, DRIFT_MIN]);
      });

      it("clic direct (D11) : sous une vraie souris le pointeur ne dérive pas ; au doigt, le tir part où le doigt se pose", async () => {
        const run = await launchMinigame({ module: game.module, action: 2 }, { seed: 18 });
        const state = minigameState<SangliersState>(run);
        const { input } = run.host;
        input.pointerHovering = true;
        input.mouseMove(40, 60);
        await run.run(500);
        expect([input.mouseX, input.mouseY]).toEqual([40, 60]);
        // La flèche du jeu suit la souris.
        expect(run.host.lastPresentation.surface[62 * 320 + 41]).toBe(0xff);
        await untilTarget(run, state);
        expect(await shootTarget(run, state)).toBe(true);
        expect(state).toMatchObject({ phase: PHASE_HIT, hits: 1 });
        // Doigt : pas de survol, le pointeur dérive entre deux touchers, mais le tir vaut pour le point touché.
        input.pointerHovering = false;
        await run.until(() => state.phase === PHASE_IDLE, 1_000);
        await untilTarget(run, state);
        const { x, y } = aim(state);
        input.mouseMove(x, y);
        input.mouseDown(0, true);
        await run.frame();
        input.mouseUp(0);
        await run.until(() => state.phase !== PHASE_APPEARING && state.phase !== PHASE_WAITING, 500);
        expect(state).toMatchObject({ phase: PHASE_HIT, hits: 2, missed: false });
      });
    });
  }

  it("un sanglier sur deux est en miroir, zone de tir retournée avec lui ; jamais un pirate", async () => {
    for (const game of GAMES) {
      const run = await launchMinigame({ module: game.module, action: 1 }, { seed: 19 });
      const state = minigameState<SangliersState>(run);
      const seen = new Set<boolean>();
      const variants = new Set<number>();
      while (run.screen === "minigame") {
        if (targetUp(state)) {
          seen.add(state.mirrored);
          variants.add(state.variant);
          expect(state.left).toBe(state.mirrored ? BOX.right - BOX.perLevel.right : BOX.left - BOX.perLevel.left);
          run.shot(`m${game.module}-emplacement${state.spot}-variante${state.variant}${state.mirrored ? "-miroir" : ""}`);
        }
        if (!(await shootTarget(run, state))) await run.frame();
      }
      expect([...seen].sort()).toEqual(game.module === MODULE_SANGLIERS ? [false, true] : [false]);
      expect([...variants].sort()).toEqual([0, 1]);
    }
  });

  it("images de fin (captures)", async () => {
    for (const game of GAMES) {
      for (const win of [true, false]) {
        const run = await launchMinigame({ module: game.module }, { seed: 20 });
        await game.player(run, win);
        for (let i = 0; i < 16 && run.screen !== "menu"; i++) {
          await run.run(500);
          run.shot(`m${game.module}-${win ? "gagne" : "perdu"}-fin${String(i).padStart(2, "0")}`);
        }
        await untilMinigameOver(run);
        expect(run.rt.missing).toEqual([]);
      }
    }
  });
});
