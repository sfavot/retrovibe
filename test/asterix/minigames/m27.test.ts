import { describe, expect, it } from "vitest";
import { registerMinigame } from "../../../src/games/asterix/scenes/minigame";
import {
  DANGER_FRAMES,
  GAIN,
  MARKER_START,
  MARKER_WIN,
  MARKER_ZONES,
  MAX_POS,
  MIN_POS,
  MODULE,
  MOVE_HIT,
  MOVE_LEFT,
  MOVE_NONE,
  MOVE_RIGHT,
  START_POS,
  tempete,
  videoName,
  zoneOf,
  type TempeteState,
} from "../../../src/games/asterix/scenes/minigames/m27";
import type { Launched } from "../game-helpers";
import { hasOriginalFiles } from "../helpers";
import { launchMinigame, minigamePlayer, minigameState, untilMinigameOver } from "./harness";
import { DANGER_FIRST, DANGER_LAST, playM27, wavesOf, type Wave } from "./m27-player";

/**
 * Mini-jeu de la Tempête (`docs/asterix/minigames/m27.md`) : lancé seul par sa case, joué au clavier ou au clic sur le
 * moteur de test. L'état lu est celui que le mini-jeu expose aux robots (`rt.hint.state`).
 */
registerMinigame(MODULE, tempete);

const loaded = (run: Launched, name: string): boolean => run.host.loaded.some((path) => path.toUpperCase().includes(name));

/** Avance jusqu'à ce que le jeu ait traité l'image `frame` de la vidéo. */
const untilFrame = (run: Launched, state: TempeteState, frame: number): Promise<void> => run.until(() => state.frame >= frame || run.screen !== "minigame", 60_000);

/** Appuie sur `key` et attend la fin du mouvement ; rend le nombre d'images de vidéo qu'il a pris. */
async function move(run: Launched, state: TempeteState, key: string): Promise<number> {
  await run.until(() => state.phase !== 0 && state.move === MOVE_NONE);
  await run.tap(key);
  await run.until(() => state.move !== MOVE_NONE, 500);
  const started = state.frame;
  await run.until(() => state.move === MOVE_NONE, 2_000);
  return state.frame - started + 1;
}

/** Va à la position `pos`, un mouvement à la fois. */
async function goTo(run: Launched, state: TempeteState, pos: number): Promise<void> {
  while (state.pos !== pos) await move(run, state, pos < state.pos ? "ArrowLeft" : "ArrowRight");
}

/** Lance le mini-jeu sur la vidéo voulue (la variante dépend du tirage : on essaie quelques graines). */
async function launchVideo(action: number, variant: number): Promise<Launched> {
  for (let seed = 1; seed <= 20; seed++) {
    const run = await launchMinigame({ module: MODULE, action }, { seed });
    if (minigameState<TempeteState>(run).video === videoName(action, variant)) return run;
  }
  throw new Error(`aucune graine ne tire ${videoName(action, variant)}`);
}

describe.skipIf(!hasOriginalFiles)("Astérix, mini-jeu de la Tempête (M27)", () => {
  it("la case 11 lance le mini-jeu inscrit, après son annonce ; le jeu s'ouvre au marqueur −1", async () => {
    const run = await launchMinigame({ module: MODULE, action: 0 });
    expect(run.rt.hint.module).toBe(MODULE);
    expect(minigamePlayer(run).pos).toBe(10);
    expect(["K60TE16", "K60TE17", "K60TE18"].some((name) => loaded(run, name))).toBe(true);
    expect(loaded(run, "M27SR.HY8")).toBe(true);
    expect(loaded(run, "M27S.PAL")).toBe(true);
    const state = minigameState<TempeteState>(run);
    expect(state).toMatchObject({ phase: 0, pos: START_POS, move: MOVE_NONE, hit: false, won: false, danger: [0, 0, 0] });
    expect([videoName(0, 0), videoName(0, 1)]).toContain(state.video);
    const waves = await wavesOf(run, state.video);
    expect(waves[0].value).toBe(MARKER_START);
    // Avant l'ouverture, les flèches ne font rien ; le marqueur lu à l'image F est traité à l'image F + 1.
    await untilFrame(run, state, 2);
    await run.tap("ArrowLeft");
    await untilFrame(run, state, waves[0].frame);
    expect(state).toMatchObject({ phase: 0, pos: START_POS, move: MOVE_NONE });
    await untilFrame(run, state, waves[0].frame + 1);
    expect(state.phase).toBe(MARKER_START);
    run.shot("m27-depart");
  });

  for (const action of [0, 1, 2]) {
    it(`niveau Action ${action} : les deux vidéos du niveau, victoire au marqueur 5, ${GAIN} sesterce`, async () => {
      const seen = new Map<string, Wave[]>();
      for (let seed = 1; seed <= 12 && seen.size < 2; seed++) {
        const run = await launchMinigame({ module: MODULE, action }, { seed });
        const state = minigameState<TempeteState>(run);
        if (seen.has(state.video)) continue;
        const waves = await wavesOf(run, state.video);
        seen.set(state.video, waves);
        // Dangers armés pendant la partie, relevés image par image.
        const armed: number[] = [];
        let before = [0, 0, 0];
        let last = -1;
        const watch = run.frame.bind(run);
        run.frame = async () => {
          await watch();
          if (state.frame === last) return;
          last = state.frame;
          state.danger.forEach((value, zone) => {
            if (value > before[zone]) armed.push(zone);
          });
          before = [...state.danger];
        };
        await playM27(run, true);
        expect(state).toMatchObject({ won: true, hit: false, phase: MARKER_WIN });
        expect(armed).toEqual(waves.flatMap((wave) => MARKER_ZONES[wave.value] ?? []));
        if (seen.size === 1) run.shot(`m27-fin-niveau-${action}`);
        await untilMinigameOver(run);
        expect(minigamePlayer(run).sesterces).toBe(GAIN);
        expect(loaded(run, "M27AG.MUX")).toBe(true);
        expect(loaded(run, "M27AH.MUX")).toBe(false);
        expect(run.rt.missing).toEqual([]);
      }
      expect([...seen.keys()].sort()).toEqual([videoName(action, 0), videoName(action, 1)]);
      // Toutes les vidéos frappent au centre et finissent par le marqueur 5.
      for (const waves of seen.values()) {
        expect(waves.some((wave) => wave.value === 2)).toBe(true);
        expect(waves.at(-1)?.value).toBe(MARKER_WIN);
      }
      const count = [...seen.values()].map((waves) => waves.filter((wave) => MARKER_ZONES[wave.value]).length);
      // Niveaux 0 et 1 : 7 ou 9 vagues ; niveau 2 : 14 ou 13 (un marqueur « 8 » sans effet dans `M27AF`).
      expect(count.sort()).toEqual(action === 2 ? [13, 14] : [7, 9]);
    }, 30_000);
  }

  it("défaite : sans bouger, la première vague du centre touche ; aucun sesterce, la vidéo du naufrage", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 7 });
    const state = minigameState<TempeteState>(run);
    const waves = await wavesOf(run, state.video);
    const centre = waves.find((wave) => wave.value === 2)!;
    minigamePlayer(run).sesterces = 3;
    await untilFrame(run, state, centre.frame + DANGER_FIRST - 1);
    expect(state.hit).toBe(false);
    expect(state.danger[1]).toBe(DANGER_FRAMES - 1);
    await untilFrame(run, state, centre.frame + DANGER_FIRST);
    expect(state).toMatchObject({ hit: true, pos: START_POS, won: false });
    run.shot("m27-touche");
    // La vidéo s'arrête sur cette image ; la barque touchée (deux images de 16 ticks), puis la fin.
    await run.until(() => state.move === MOVE_HIT, 500);
    expect(state.frame).toBe(centre.frame + DANGER_FIRST);
    await run.run(100);
    run.shot("m27-barque-touchee");
    await playM27(run, false);
    expect(state).toMatchObject({ hit: true, over: true, won: false });
    expect(state.frame).toBe(centre.frame + DANGER_FIRST);
    run.shot("m27-naufrage");
    await run.until(() => loaded(run, "M27AH.MUX"));
    await run.run(1_500);
    run.shot("m27-perdu");
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(3);
    expect(loaded(run, "M27AG.MUX")).toBe(false);
    expect(loaded(run, "M27B0000")).toBe(true);
    expect(run.rt.missing).toEqual([]);
  });

  it("un mouvement dure 8 images, la position ne change qu'à la fin, bornée de 2 à 6 ; un appui pendant un mouvement est perdu", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 3 });
    const state = minigameState<TempeteState>(run);
    await run.until(() => state.phase !== 0);
    await run.tap("ArrowRight");
    await run.until(() => state.move !== MOVE_NONE, 500);
    expect(state).toMatchObject({ move: MOVE_RIGHT, pos: START_POS });
    const started = state.frame;
    // Appui en plein mouvement : perdu.
    await untilFrame(run, state, started + 3);
    await run.tap("ArrowLeft");
    expect(state).toMatchObject({ move: MOVE_RIGHT, pos: START_POS });
    run.shot("m27-mouvement");
    await run.until(() => state.move === MOVE_NONE, 2_000);
    expect(state.frame - started + 1).toBe(8);
    expect(state.pos).toBe(START_POS + 1);
    await run.run(300);
    expect(state).toMatchObject({ move: MOVE_NONE, pos: START_POS + 1 });
    // Bornes.
    await goTo(run, state, MAX_POS);
    await run.tap("ArrowRight");
    await run.run(300);
    expect(state).toMatchObject({ move: MOVE_NONE, pos: MAX_POS });
    expect(await move(run, state, "ArrowLeft")).toBe(8);
    expect(state.pos).toBe(MAX_POS - 1);
    expect(state.move).toBe(MOVE_NONE);
    expect(MOVE_LEFT).not.toBe(MOVE_RIGHT);
    expect([MIN_POS, 3, 4, 5, MAX_POS].map(zoneOf)).toEqual([0, 1, 1, 1, 2]);
  });

  // Chaque marqueur frappe sa zone pendant quatre images, de F + 2 à F + 5 : on s'y trouve à la première ou à la dernière.
  const SIDES = [
    { name: "à gauche (marqueur 1)", value: 1, pos: MIN_POS, safe: 3 },
    { name: "à droite (marqueur 3)", value: 3, pos: MAX_POS, safe: 5 },
  ];
  for (const { name, value, pos, safe } of SIDES) {
    it(`une vague ${name} touche la barque du bord, pas sa voisine`, async () => {
      // Barque voisine : la vague passe. La même partie, barque au bord : touchée à la première image du danger.
      for (const place of [safe, pos]) {
        const run = await launchVideo(0, 0);
        const state = minigameState<TempeteState>(run);
        const waves = await wavesOf(run, state.video);
        const wave = waves.find((candidate) => candidate.value === value)!;
        const earlier = waves.filter((candidate) => candidate.frame < wave.frame && MARKER_ZONES[candidate.value]);
        // Dans `M27AA`, aucune vague avant celle-ci ne frappe la position visée : on s'y place tout de suite.
        expect(earlier.every((candidate) => !MARKER_ZONES[candidate.value].includes(zoneOf(place)))).toBe(true);
        await goTo(run, state, place);
        await untilFrame(run, state, wave.frame + DANGER_LAST + 1);
        if (place === safe) {
          expect(state).toMatchObject({ hit: false, pos: safe });
          expect(state.danger).toEqual([0, 0, 0]);
        } else {
          expect(state).toMatchObject({ hit: true, pos });
          expect(state.frame).toBe(wave.frame + DANGER_FIRST);
        }
      }
    });
  }

  it("la dernière image du danger touche encore, la suivante plus", async () => {
    for (const late of [0, 1]) {
      // `M27AA` : la première vague frappe à gauche. On entre dans sa zone depuis la position voisine, à l'image voulue.
      const run = await launchVideo(0, 0);
      const state = minigameState<TempeteState>(run);
      const first = (await wavesOf(run, state.video)).find((wave) => MARKER_ZONES[wave.value])!;
      expect(MARKER_ZONES[first.value]).toEqual([0]);
      await goTo(run, state, MIN_POS + 1);
      // La position est jugée à l'image `arrival` : le mouvement, lu à l'image `arrival − 8`, finit à l'image `arrival − 1`.
      const arrival = first.frame + DANGER_LAST + late;
      await untilFrame(run, state, arrival - 9);
      await run.tap("ArrowLeft");
      await run.until(() => state.move !== MOVE_NONE, 500);
      expect(state.frame).toBe(arrival - 8);
      await run.until(() => state.move === MOVE_NONE || state.hit, 2_000);
      expect(state).toMatchObject({ frame: arrival - 1, pos: MIN_POS, hit: false });
      await untilFrame(run, state, arrival + 1);
      expect(state.hit).toBe(late === 0);
    }
  });

  it("clic ou toucher direct (D11) : moitié gauche de l'écran vers la gauche, moitié droite vers la droite", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 3 });
    const state = minigameState<TempeteState>(run);
    await run.until(() => state.phase !== 0);
    await run.click(40, 150);
    await run.until(() => state.move !== MOVE_NONE, 500);
    expect(state.move).toBe(MOVE_LEFT);
    await run.until(() => state.move === MOVE_NONE, 2_000);
    expect(state.pos).toBe(START_POS - 1);
    await run.click(290, 30);
    await run.until(() => state.move !== MOVE_NONE, 500);
    expect(state.move).toBe(MOVE_RIGHT);
    await run.until(() => state.move === MOVE_NONE, 2_000);
    expect(state.pos).toBe(START_POS);
    // Espace, sans position, ne commande rien.
    await run.tap("Space");
    await run.run(300);
    expect(state).toMatchObject({ move: MOVE_NONE, pos: START_POS });
  });
});
