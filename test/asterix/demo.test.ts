import { describe, expect, it } from "vitest";
import type { IdefixState } from "../../src/games/asterix/scenes/minigames/m34";
import { DEMO_CLICK_READS } from "../../src/games/asterix/scenes/runtime";
import { SAVE_KEY } from "../../src/games/asterix/scenes/save";
import { launch, type Launched } from "./game-helpers";
import { hasOriginalFiles } from "./helpers";
import { playM34 } from "./minigames/m34-player";

/**
 * Menu principal d'Astérix : le jeu d'Idéfix hors partie et la démonstration automatique (`docs/asterix/engine.md` §1.3).
 * Après 60 s sans clic, le menu lance lui-même Idéfix, puis la règle du jeu, puis une partie ; une entrée réelle ramène
 * au menu, et la démo ne laisse aucune trace (sauvegarde, configuration de REJOUER, mémoires de séance).
 */

const MODULE_IDEFIX = 34;
/** Un point de la zone d'Idéfix au menu ((0x1c, 0x62), 0x37 × 0x4b). */
const IDEFIX = { x: 0x1c + 0x1b, y: 0x62 + 0x25 };
const DEMO_DELAY_MS = 60_000;

/** Vrai si le fichier (nom sans dossier) a été lu depuis le lancement. */
function loaded(run: Launched, name: string): boolean {
  return run.host.loaded.some((path) => path.toUpperCase().endsWith(`/${name}.VID`));
}

/** Du menu, sans aucune entrée, jusqu'au départ de la démo ; rend le temps simulé attendu. */
async function untilDemo(run: Launched): Promise<number> {
  expect(run.screen).toBe("menu");
  expect(run.rt.demo).toBe(false);
  const from = run.host.time;
  await run.until(() => run.rt.demo, DEMO_DELAY_MS + 5_000);
  return run.host.time - from;
}

/**
 * Écrans interactifs traversés depuis l'appel. En démo, un écran sans cadence est validé dès sa première lecture
 * d'entrées (clic simulé au premier tick) : il ne dure pas assez pour être vu d'un tick à l'autre.
 */
function recordScreens(run: Launched): Set<string> {
  const seen = new Set<string>();
  const { rt } = run;
  let current = rt.screen;
  Object.defineProperty(rt, "screen", {
    configurable: true,
    get: () => current,
    set: (screen: string) => {
      current = screen;
      seen.add(screen);
    },
  });
  return seen;
}

function idefixState(run: Launched): IdefixState {
  return run.rt.hint.state as IdefixState;
}

describe.skipIf(!hasOriginalFiles)("menu principal d'Astérix : Idéfix et démonstration", () => {
  it("clic sur Idéfix : son jeu hors partie, sans gain, puis retour au menu ; la démo suivante est la règle du jeu", async () => {
    const run = await launch({ seed: 3 });
    await run.untilScreen("menu");
    await run.click(IDEFIX.x, IDEFIX.y);
    await run.untilScreen("minigame");
    expect(run.rt.hint.module).toBe(MODULE_IDEFIX);
    expect(idefixState(run)).toMatchObject({ inGame: false, course: 0 });
    expect(run.rt.demo).toBe(false);
    const state = idefixState(run);
    await playM34(run, true);
    expect(state.won).toBe(true);
    await run.untilScreen("menu");
    // Hors partie : ni joueur ni gain, aucune sauvegarde.
    expect(run.game.runtime?.game).toBeUndefined();
    expect(run.host.storage.get(SAVE_KEY) ?? "").toBe("");
    expect(run.rt.missing).toEqual([]);

    // Après un clic réel sur Idéfix, la rotation de la démo passe à REGLE.
    expect(await untilDemo(run)).toBeGreaterThanOrEqual(DEMO_DELAY_MS - 100);
    await run.until(() => loaded(run, "M44AB.MUX"), 10_000);
    expect(run.screen).toBe("");
    // Une entrée réelle pendant la première vidéo : les deux autres ne sont pas jouées.
    await run.run(2_000);
    await run.tap("Space");
    await run.untilScreen("menu", 20_000);
    expect(run.rt.demo).toBe(false);
    expect(loaded(run, "M44AC.MUX")).toBe(false);
    // La règle du jeu a fait avancer la rotation : la démo suivante est une partie.
    await untilDemo(run);
    const seen = recordScreens(run);
    await run.until(() => seen.has("players"), 20_000);
    expect(run.rt.demo).toBe(true);
  });

  it("clic sur REGLE : les trois vidéos, et la démo suivante reste le jeu d'Idéfix", async () => {
    const run = await launch({ seed: 3 });
    await run.untilScreen("menu");
    for (let i = 0; i < 2; i++) {
      await run.tap("ArrowDown");
      await run.run(500);
    }
    await run.tap("Space");
    for (const name of ["M44AB.MUX", "M44AC.MUX", "M44AD.MUX"]) {
      await run.until(() => loaded(run, name), 20_000);
      await run.run(1_000);
      await run.tap("Space");
    }
    await run.untilScreen("menu", 20_000);
    expect(run.rt.demo).toBe(false);
    await untilDemo(run);
    await run.untilScreen("minigame", 20_000);
    expect(run.rt.hint.module).toBe(MODULE_IDEFIX);
    expect(idefixState(run).inGame).toBe(false);
  });

  it("démo, écran sans cadence : cent tirages et le clic simulé dès la première lecture du tick", async () => {
    const run = await launch({ seed: 3 });
    await run.untilScreen("menu");
    const { rt } = run;
    const { rng } = rt.ctx;
    const next = rng.next.bind(rng);
    let draws = 0;
    rng.next = () => {
      draws++;
      return next();
    };
    // Lectures faites ici même, entre deux ticks : le script du menu ne tourne pas, aucun autre tirage ne s'y mêle.
    rt.startDemo();
    rt.dirs();
    // `153c:0252` : la boucle d'origine fait plus de cent lectures par tick, donc un tour complet du compteur.
    expect(draws).toBe(DEMO_CLICK_READS);
    expect(rt.click()).toBe("current");
    // Une seule lecture comptée par tick : les suivantes ne tirent rien et ne posent pas d'autre clic.
    rt.dirs();
    expect(draws).toBe(DEMO_CLICK_READS);
    expect(rt.click()).toBeNull();
    // Au tick suivant, de nouveau cent tirages et un clic.
    draws = 0;
    await run.frame();
    expect(draws).toBeGreaterThanOrEqual(DEMO_CLICK_READS);
    rt.endDemo();
  });

  it("démo, boucle cadencée : une lecture comptée par image, le clic simulé toutes les cent images", async () => {
    const run = await launch({ seed: 3 });
    await run.untilScreen("menu");
    const { rt } = run;
    const { rng } = rt.ctx;
    const next = rng.next.bind(rng);
    let draws = 0;
    rng.next = () => {
      draws++;
      return next();
    };
    rt.startDemo();
    rt.beginFrames();
    for (let frame = 0; frame < DEMO_CLICK_READS; frame++) {
      // Les lectures d'une même image (directions, puis clic relu à chaque tick) n'en font qu'une.
      rt.dirs();
      expect(rt.click()).toBeNull();
      rt.dirs();
      expect(draws).toBe(frame + 1);
      rt.nextFrame();
    }
    // La 101e image pose le clic sans tirage ; le compteur repart à l'image suivante.
    rt.dirs();
    expect(draws).toBe(DEMO_CLICK_READS);
    expect(rt.click()).toBe("current");
    rt.nextFrame();
    rt.dirs();
    expect(draws).toBe(DEMO_CLICK_READS + 1);
    rt.endFrames();
    rt.endDemo();
  });

  it("60 s sans entrée : Idéfix, puis la règle du jeu, puis une partie que la première entrée réelle ramène au menu", { timeout: 600_000 }, async () => {
    const run = await launch({ seed: 3 });
    await run.untilScreen("menu");
    const { session } = run.rt;
    expect(session.noGameYet).toBe(true);

    // Première démo : le jeu d'Idéfix, hors partie, laissé à lui-même.
    expect(await untilDemo(run)).toBeGreaterThanOrEqual(DEMO_DELAY_MS - 100);
    await run.untilScreen("minigame", 20_000);
    expect(run.rt.hint.module).toBe(MODULE_IDEFIX);
    expect(idefixState(run).inGame).toBe(false);
    expect(run.rt.demo).toBe(true);
    await run.untilScreen("menu", 120_000);
    expect(run.rt.demo).toBe(false);

    // Deuxième démo : les trois vidéos de la règle du jeu, jusqu'au bout.
    await untilDemo(run);
    for (const name of ["M44AB.MUX", "M44AC.MUX", "M44AD.MUX"]) await run.until(() => loaded(run, name), 600_000);
    await run.untilScreen("menu", 600_000);
    expect(run.rt.demo).toBe(false);

    // Troisième démo : une partie. Les clics simulés inscrivent quatre personnages aux niveaux moyens, puis JOUER et
    // les réglages proposés (90 minutes).
    await untilDemo(run);
    const seen = recordScreens(run);
    await run.until(() => seen.has("turn"), 600_000);
    expect(run.rt.demo).toBe(true);
    expect(run.rt.demoInterrupted).toBe(false);
    expect(run.rt.game.players.map((p) => [p.character, p.reflexion, p.action])).toEqual([
      [0, 1, 1],
      [3, 1, 1],
      [4, 1, 1],
      [2, 1, 1],
    ]);
    expect(run.rt.game.duration).toBe(5400);
    expect([...seen]).toEqual(expect.arrayContaining(["players", "levels", "settings", "score", "turn"]));
    // La démo joue toute seule : le dé part au clic simulé, dès le premier tick du menu du tour.
    await run.until(() => seen.has("die"), 60_000);
    expect(run.host.storage.get(SAVE_KEY) ?? "").toBe("");

    // Une entrée réelle : le tour s'arrête après le déplacement et le menu revient, sans écran de fin.
    await run.tap("ArrowUp");
    expect(run.rt.demoStopped).toBe(true);
    seen.clear();
    await run.untilScreen("menu", 60_000);
    expect(seen.has("end")).toBe(false);
    expect(run.rt.demo).toBe(false);
    expect(run.host.storage.get(SAVE_KEY) ?? "").toBe("");
    // REJOUER garde la configuration sans partie préalable (Astérix seul, `1abf:13e5`), pas les quatre joueurs de la démo.
    expect(session.noGameYet).toBe(true);
    expect(session.saved).toEqual({ players: [{ character: 0, reflexion: 1, action: 1 }], duration: 7200, objectsRequired: 9 });
    expect(run.rt.missing).toEqual([]);

    // Après une partie, la rotation repart du jeu d'Idéfix.
    await untilDemo(run);
    await run.untilScreen("minigame", 20_000);
    expect(run.rt.hint.module).toBe(MODULE_IDEFIX);
  });

  it("une entrée réelle à l'écran des joueurs de la démo annule la partie", async () => {
    const run = await launch({ seed: 3 });
    await run.untilScreen("menu");
    // Idéfix au clic, perdu au premier obstacle : la rotation passe à REGLE, sautée, puis à la partie.
    await run.click(IDEFIX.x, IDEFIX.y);
    await run.untilScreen("minigame");
    await playM34(run, false);
    await run.untilScreen("menu");
    await untilDemo(run);
    await run.until(() => loaded(run, "M44AB.MUX"), 10_000);
    await run.run(1_000);
    await run.tap("Space");
    await run.untilScreen("menu", 20_000);
    await untilDemo(run);
    // Un premier personnage est inscrit par clic simulé (ses écrans sont validés au premier tick) ; une direction est
    // enfoncée pendant l'inscription du suivant, qui n'aboutit pas.
    const seen = recordScreens(run);
    await run.until(() => seen.has("players") && run.rt.game.players.length === 1, 60_000);
    await run.tap("ArrowLeft");
    await run.untilScreen("menu", 20_000);
    expect(run.rt.game.players.length).toBe(1);
    expect(run.rt.session.noGameYet).toBe(true);
    expect(run.host.storage.get(SAVE_KEY) ?? "").toBe("");
  });
});
