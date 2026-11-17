import { describe, expect, it } from "vitest";
import { registerMinigame } from "../../../src/games/asterix/scenes/minigame";
import {
  DURATION,
  FACING_LEFT,
  FACING_RIGHT,
  FROM_LEFT,
  FROM_RIGHT,
  GAIN,
  HERO_HIGH,
  HERO_HIT_HIGH,
  HERO_HIT_LOW,
  HERO_IDLE,
  HERO_LOW,
  KIND_HIGH,
  KIND_LOW,
  MODULE,
  ROMANS,
  ROMAN_GUARD,
  ROMAN_HIGH,
  ROMAN_KO_HIGH,
  ROMAN_KO_LOW,
  ROMAN_LOW,
  bagarre,
  heroIdle,
  type BagarreState,
  type Roman,
} from "../../../src/games/asterix/scenes/minigames/m32";
import type { Launched } from "../game-helpers";
import { hasOriginalFiles } from "../helpers";
import { launchMinigame, minigamePlayer, minigameState, untilMinigameOver } from "./harness";
import { arrived, decide, facingRoman, playM32, playM32ByTouch, turnKey } from "./m32-player";

/**
 * Mini-jeu de la Bagarre (`docs/asterix/minigames/m32.md`) : lancé seul par sa case, joué au clavier ou au clic sur le
 * moteur de test. L'inscription définitive est dans `scenes/minigames/index.ts` ; elle est refaite ici pour que le test
 * ne dépende pas de l'ordre des portages.
 */
registerMinigame(MODULE, bagarre);

const loaded = (run: Launched, name: string): boolean => run.host.loaded.some((path) => path.toUpperCase().includes(name));

/** Vidéo du perdant attendue pour chaque animation du joueur touché. */
const LOSS_VIDEO: Readonly<Record<number, string>> = { 8: "M32AE", 9: "M32AF", 10: "M32AC", 11: "M32AD" };
const ALL_VIDEOS = ["M32AB", "M32AC", "M32AD", "M32AE", "M32AF"];

/** Avance d'une image de jeu (une image de la vidéo `M32AA`). */
async function gameFrame(run: Launched, state: BagarreState): Promise<void> {
  const frames = state.frames;
  await run.until(() => state.frames !== frames || run.screen !== "minigame", 2_000);
}

/** Premier Romain arrivé, une fois le joueur tourné du côté voulu (`towards` : face à lui, ou dos à lui). */
async function untilArrival(run: Launched, state: BagarreState, towards: boolean): Promise<Roman> {
  await run.until(() => state.romans.some((roman) => roman.active), 10_000);
  const roman = state.romans.find((candidate) => candidate.active)!;
  if (facingRoman(state, roman) !== towards) {
    await run.tap(towards ? turnKey(roman) : roman.side === FROM_LEFT ? "ArrowRight" : "ArrowLeft");
    await run.until(() => heroIdle(state) && state.input === 0, 2_000);
  }
  expect(facingRoman(state, roman)).toBe(towards);
  await run.until(() => arrived(roman), 5_000);
  return roman;
}

/** Lance des parties jusqu'à en trouver une dont le premier Romain a le coup voulu. */
async function launchWithFirstKind(kind: number, action: number): Promise<Launched> {
  for (let seed = 1; seed < 40; seed++) {
    const run = await launchMinigame({ module: MODULE, action }, { seed });
    const state = minigameState<BagarreState>(run);
    await run.until(() => state.romans.some((roman) => roman.active), 10_000);
    if (state.romans.find((roman) => roman.active)!.kind === kind) return launchMinigame({ module: MODULE, action }, { seed });
  }
  throw new Error("aucune graine ne convient");
}

describe.skipIf(!hasOriginalFiles)("Astérix, mini-jeu de la Bagarre (M32)", () => {
  it("la case 42 lance le mini-jeu inscrit, après son annonce", async () => {
    const run = await launchMinigame({ module: MODULE });
    const state = minigameState<BagarreState>(run);
    expect(run.rt.hint.module).toBe(MODULE);
    expect(minigamePlayer(run).pos).toBe(41);
    expect(loaded(run, "K60TE3")).toBe(true);
    expect(loaded(run, "M32DA000.MCC")).toBe(true);
    expect(state).toMatchObject({ facing: FACING_LEFT, heroAnim: HERO_IDLE, heroHit: false, lost: false, won: false });
    expect(state.romans).toHaveLength(ROMANS);
    // Délais d'entrée : 15 à 19, 25 à 29 et 35 à 39 images.
    state.romans.forEach((roman, i) => {
      expect(roman.active).toBe(false);
      expect(roman.delay).toBeGreaterThanOrEqual(15 + 10 * i);
      expect(roman.delay).toBeLessThanOrEqual(19 + 10 * i);
    });
    await run.until(() => state.frames > 0, 2_000);
    expect(loaded(run, "M32AA.MUX")).toBe(true);
    run.shot("m32-debut");
  });

  // Graines où le robot gagne : au niveau 2, deux Romains arrivés presque ensemble des deux côtés sont imparables.
  for (const [action, seed] of [
    [0, 1],
    [1, 1],
    [2, 1],
  ] as const) {
    it(`niveau Action ${action} : victoire après ${DURATION} s, ${GAIN} sesterce, délais du niveau`, async () => {
      const run = await launchMinigame({ module: MODULE, action }, { seed });
      const state = minigameState<BagarreState>(run);
      minigamePlayer(run).sesterces = 5;
      const started = run.host.time;
      const before = state.romans.map((roman) => ({ ...roman }));
      const guards: number[] = [];
      const exits: number[] = [];
      const sides = new Set<number>();
      const kinds = new Set<number>();
      let knockedOut = 0;
      let frames = state.frames;
      let shots = 0;
      while (run.screen === "minigame") {
        const key = decide(state);
        if (key) await run.tap(key);
        else await run.frame();
        if (state.frames === frames) continue;
        frames = state.frames;
        state.romans.forEach((roman, i) => {
          const was = before[i];
          if (roman.active && !was.active) {
            sides.add(roman.side);
            kinds.add(roman.kind);
            // Aucun Romain n'entre après la fin du temps ; il entre par un bord, selon son côté.
            expect(run.host.time - started).toBeLessThan((DURATION + 0.2) * 1000);
            expect(roman.x).toBe(roman.side === FROM_LEFT ? 72 - 3 * i : 312 + 3 * i);
            expect(roman.anim).toBe(roman.kind + roman.side);
          }
          if (roman.active && roman.anim >= ROMAN_GUARD && was.anim < ROMAN_GUARD) {
            guards.push(roman.delay);
            // Trois cycles de marche de 30 pixels : arrêté à 30 ou 36 pixels de l'abscisse 192.
            expect(Math.abs(roman.x - 0xc0)).toBe(30 + (roman.side === FROM_LEFT ? 3 * i : 3 * i));
          }
          if (roman.active && roman.anim >= ROMAN_KO_HIGH && was.anim < ROMAN_KO_HIGH) {
            knockedOut++;
            if (shots++ < 2) run.shot(`m32-niveau${action}-coup${shots}`);
          }
          if (!roman.active && was.active) exits.push(roman.delay);
          before[i] = { ...roman };
        });
      }
      expect(state).toMatchObject({ won: true, lost: false, heroHit: false });
      expect(run.host.time - started).toBeGreaterThan(DURATION * 1000 - 20);
      // Garde : (2 − niveau) × 3 + 2 images, plus un tirage de (2 − niveau) × 2 + 2 valeurs.
      const guardMin = (2 - action) * 3 + 2;
      expect(Math.min(...guards)).toBeGreaterThanOrEqual(guardMin);
      expect(Math.max(...guards)).toBeLessThanOrEqual(guardMin + (2 - action) * 2 + 1);
      // Retour d'un Romain assommé : (7 − niveau) × 5 images, plus 0 à 4.
      expect(Math.min(...exits)).toBeGreaterThanOrEqual((7 - action) * 5);
      expect(Math.max(...exits)).toBeLessThanOrEqual((7 - action) * 5 + 4);
      expect(knockedOut).toBeGreaterThanOrEqual(8);
      expect(exits).toHaveLength(knockedOut);
      expect([...sides].sort()).toEqual([FROM_RIGHT, FROM_LEFT]);
      expect([...kinds].sort()).toEqual([KIND_HIGH, KIND_LOW]);
      await run.run(1_500);
      run.shot(`m32-niveau${action}-gagne`);
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(5 + GAIN);
      expect(ALL_VIDEOS.filter((name) => loaded(run, name))).toEqual(["M32AB"]);
      expect(run.rt.missing).toEqual([]);
    });
  }

  for (const facing of [FACING_LEFT, FACING_RIGHT]) {
    it(`défaite sans se défendre, regard ${facing === FACING_LEFT ? "à gauche" : "à droite"} : vidéo selon le coup reçu, aucun sesterce perdu`, async () => {
      const seen = new Set<number>();
      for (let seed = 1; seed <= 12 && seen.size < 2; seed++) {
        const run = await launchMinigame({ module: MODULE, action: seed % 3 }, { seed });
        const state = minigameState<BagarreState>(run);
        minigamePlayer(run).sesterces = 3;
        const started = run.host.time;
        if (facing === FACING_RIGHT) {
          await run.tap("ArrowRight");
          await run.until(() => heroIdle(state), 2_000);
        }
        expect(state.facing).toBe(facing);
        await run.until(() => state.heroHit, 20_000);
        const hitBy = state.romans.find((roman) => roman.active && roman.anim >= ROMAN_LOW && roman.anim < ROMAN_KO_HIGH)!;
        expect(state.heroAnim).toBe(facing + (hitBy.kind === KIND_LOW ? HERO_HIT_LOW : HERO_HIT_HIGH));
        if (!seen.has(state.heroAnim)) run.shot(`m32-touche-${state.heroAnim}`);
        // Les commandes sont mortes après le coup.
        await run.tap("ArrowUp");
        expect(state.heroAnim).toBeGreaterThanOrEqual(HERO_HIT_LOW);
        await playM32(run, false);
        expect(state).toMatchObject({ lost: true, won: false });
        expect(run.host.time - started).toBeLessThan(DURATION * 1000);
        seen.add(state.heroAnim);
        await run.run(1_500);
        if (seed === 1) run.shot(`m32-perdu-${state.heroAnim}`);
        await untilMinigameOver(run);
        expect(minigamePlayer(run).sesterces).toBe(3);
        expect(ALL_VIDEOS.filter((name) => loaded(run, name))).toEqual([LOSS_VIDEO[state.heroAnim]]);
        expect(run.rt.missing).toEqual([]);
      }
      // Les deux coups (bas et haut) ont été reçus, chacun avec sa vidéo.
      expect([...seen].sort((a, b) => a - b)).toEqual([facing + HERO_HIT_LOW, facing + HERO_HIT_HIGH]);
    });
  }

  it("un coup de poing n'assomme que les Romains arrivés du côté regardé", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 2 });
    const state = minigameState<BagarreState>(run);
    const roman = await untilArrival(run, state, false);
    await run.tap("ArrowUp");
    await run.until(() => heroIdle(state) && state.input === 0, 3_000);
    // Dos au Romain : le coup part dans le vide, le Romain reste en garde ou frappe.
    expect(roman.active).toBe(true);
    expect(roman.anim).toBeLessThan(ROMAN_KO_HIGH);
    await run.until(() => state.heroHit, 5_000);
  });

  it("un coup de poing donné avant l'arrivée du Romain part dans le vide", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 2 });
    const state = minigameState<BagarreState>(run);
    await run.until(() => state.romans.some((roman) => roman.active), 10_000);
    const roman = state.romans.find((candidate) => candidate.active)!;
    if (!facingRoman(state, roman)) {
      await run.tap(turnKey(roman));
      await run.until(() => heroIdle(state) && state.input === 0, 2_000);
    }
    await run.tap("ArrowDown");
    await run.until(() => state.heroAnim === state.facing + HERO_LOW, 1_000);
    await run.until(() => heroIdle(state), 3_000);
    expect(roman.anim).toBeLessThan(ROMAN_GUARD);
    expect(roman.active).toBe(true);
  });

  for (const [kind, key, anim, knockOut] of [
    [KIND_LOW, "ArrowDown", HERO_LOW, ROMAN_KO_LOW],
    [KIND_HIGH, "ArrowUp", HERO_HIGH, ROMAN_KO_HIGH],
  ] as const) {
    it(`Romain en garde : le coup ${kind === KIND_LOW ? "bas" : "haut"} l'assomme à sa troisième image`, async () => {
      const run = await launchWithFirstKind(kind, 0);
      const state = minigameState<BagarreState>(run);
      const roman = await untilArrival(run, state, true);
      expect(roman.kind).toBe(kind);
      await run.tap(key);
      await run.until(() => state.heroAnim === state.facing + anim, 1_000);
      const start = state.frames;
      await run.until(() => roman.anim >= ROMAN_KO_HIGH, 2_000);
      expect(roman.anim).toBe(roman.side + knockOut);
      expect(state.frames - start).toBe(2);
      // Sept images plus tard il est sorti ; le joueur est revenu en attente.
      await run.until(() => !roman.active, 2_000);
      expect(state.heroHit).toBe(false);
    });
  }

  it("coup bas d'un Romain : le coup de poing bas donné au départ du coup le pare, le haut non", async () => {
    for (const [key, parried] of [
      ["ArrowDown", true],
      ["ArrowUp", false],
    ] as const) {
      const run = await launchWithFirstKind(KIND_LOW, 0);
      const state = minigameState<BagarreState>(run);
      const roman = await untilArrival(run, state, true);
      // Le coup part : on répond à l'image même, le coup de poing commence une image après le coup du Romain.
      await run.until(() => roman.anim === roman.side + ROMAN_LOW, 5_000);
      await run.tap(key);
      await run.until(() => state.heroHit || roman.anim >= ROMAN_KO_HIGH, 2_000);
      expect(state.heroHit).toBe(!parried);
      if (parried) expect(roman.anim).toBe(roman.side + ROMAN_KO_LOW);
      else expect(state.heroAnim).toBe(state.facing + HERO_HIT_LOW);
    }
  });

  it("coup haut d'un Romain : il porte 4 images après son départ, un coup de poing donné à son départ l'arrête", async () => {
    const run = await launchWithFirstKind(KIND_HIGH, 0);
    const state = minigameState<BagarreState>(run);
    const roman = await untilArrival(run, state, true);
    await run.until(() => roman.anim === roman.side + ROMAN_HIGH, 5_000);
    const start = state.frames;
    await run.tap("ArrowDown");
    await run.until(() => state.heroHit || roman.anim >= ROMAN_KO_HIGH, 2_000);
    expect(state.heroHit).toBe(false);
    expect(roman.anim).toBe(roman.side + ROMAN_KO_LOW);
    expect(state.frames - start).toBeLessThan(4);
  });

  it("une direction donnée pendant une animation est perdue ; les demi-tours ne se font que du bon côté", async () => {
    const run = await launchMinigame({ module: MODULE });
    const state = minigameState<BagarreState>(run);
    await run.tap("ArrowRight");
    await run.until(() => state.heroAnim === 0, 1_000);
    expect(state.facing).toBe(FACING_RIGHT);
    // Pendant le demi-tour (trois images), le coup demandé est oublié.
    await run.tap("ArrowUp");
    await run.until(() => heroIdle(state), 2_000);
    await gameFrame(run, state);
    await gameFrame(run, state);
    expect(state).toMatchObject({ heroAnim: FACING_RIGHT + HERO_IDLE, input: 0 });
    await run.tap("ArrowLeft");
    await run.until(() => state.heroAnim === 1, 1_000);
    expect(state.facing).toBe(FACING_LEFT);
    await run.until(() => heroIdle(state), 2_000);
    // Haut et bas ensemble : le coup haut l'emporte.
    run.host.input.keyDown("ArrowDown");
    run.host.input.keyDown("ArrowUp");
    await run.until(() => !heroIdle(state), 1_000);
    run.host.input.keyUp("ArrowDown");
    run.host.input.keyUp("ArrowUp");
    expect(state.heroAnim).toBe(FACING_LEFT + HERO_HIGH);
  });

  it("clic ou toucher direct (D11) : un clic du côté du Romain le fait assommer, demi-tour compris ; partie gagnée au clic seul", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 3 });
    const state = minigameState<BagarreState>(run);
    // Dos au premier Romain : un seul clic de son côté, en bas, fait le demi-tour puis le coup bas.
    const roman = await untilArrival(run, state, false);
    const facing = state.facing;
    await run.click(roman.side === FROM_LEFT ? 30 : 290, 180);
    await run.until(() => state.heroAnim < HERO_IDLE, 1_000);
    expect(state.facing).toBe(1 - facing);
    await run.until(() => state.heroAnim >= HERO_HIGH, 2_000);
    expect(state.heroAnim).toBe(state.facing + HERO_LOW);
    await run.until(() => heroIdle(state), 3_000);
    // Face à lui (ou à vide) : un clic du côté regardé, en haut, donne le coup haut.
    await run.click(state.facing === FACING_LEFT ? 30 : 290, 60);
    await run.until(() => !heroIdle(state), 1_000);
    expect(state.heroAnim).toBe(state.facing + HERO_HIGH);

    const touch = await launchMinigame({ module: MODULE }, { seed: 1 });
    const touched = minigameState<BagarreState>(touch);
    await playM32ByTouch(touch);
    expect(touched).toMatchObject({ won: true, heroHit: false });
    await untilMinigameOver(touch);
    expect(minigamePlayer(touch).sesterces).toBe(GAIN);
  });
});
