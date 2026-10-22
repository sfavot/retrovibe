import { describe, expect, it } from "vitest";
import { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import { STORAGE_KEY, loadOptions } from "../../src/games/teleportaschtroumpf/engine/options";
import type { Scene, SceneContext } from "../../src/games/teleportaschtroumpf/engine/scene";
import type { GameScene } from "../../src/games/teleportaschtroumpf/scenes/game";
import { createMenuScene } from "../../src/games/teleportaschtroumpf/scenes/s07-menu";
import { createCharactersScene, type CharactersResult } from "../../src/games/teleportaschtroumpf/scenes/s08-characters";
import { createPlayersScene } from "../../src/games/teleportaschtroumpf/scenes/s09-players";
import { END_MESSAGES, createParentsScene } from "../../src/games/teleportaschtroumpf/scenes/s04-parents";
import { encodeCp437 } from "../../src/data/cp437";
import { TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles } from "./helpers";

/** Moteur sur une scène, avec les gestes de l'utilisateur. `audio` faux : sortie son verrouillée, aucune voix à attendre. */
async function startScene(scene: Scene, { audio = false, seed = 7 } = {}) {
  const host = new TestHost();
  host.audio.enabled = audio;
  const engine = new Engine(host, { seed });
  await engine.start(scene);
  const top = () => engine.ctx.scenes.top?.constructor.name;
  /** Attend la scène `name`, la fin des chargements et des fondus. */
  const settle = async (name: string) => {
    await runUntil(engine, host, () => top() === name && !engine.loading && !engine.ctx.scenes.transitioning && !engine.ctx.fade.active);
    await runFor(engine, host, 100);
  };
  const press = async (code: string, ms = 100) => {
    host.input.keyDown(code);
    await runFor(engine, host, ms);
    host.input.keyUp(code);
    await runFor(engine, host, 100);
  };
  const click = async (button = 0, ms = 100) => {
    host.input.mouseDown(button);
    await runFor(engine, host, ms);
    host.input.mouseUp(button);
    await runFor(engine, host, 100);
  };
  const moveTo = async (x: number, y: number) => {
    host.input.mouseMove(x, y);
    await runFor(engine, host, 100);
  };
  const center = (rect: { x: number; y: number; w: number; h: number }) => moveTo(rect.x + rect.w / 2, rect.y + rect.h / 2);
  return { host, engine, top, settle, press, click, moveTo, center, ctx: engine.ctx as SceneContext };
}

/** Abscisses des silhouettes de `s09a001d.mcg` (pour poser le pointeur ailleurs que sur le choix courant). */
const SILHOUETTE_X = [82, 132, 182, 232];

const playedVoc = async (t: Awaited<ReturnType<typeof startScene>>, name: string) => (await t.ctx.resources.voc(name)).samples;
const lastPlayed = (t: Awaited<ReturnType<typeof startScene>>) => t.host.audio.plays.at(-1)?.sound.samples;

describe.skipIf(!hasOriginalFiles)("S09 : nombre de joueurs", () => {
  async function players(options?: Parameters<typeof startScene>[1]) {
    const results: number[] = [];
    const t = await startScene(createPlayersScene((_, n) => void results.push(n)), options);
    await t.settle("PlayersScene");
    // Voix d'accueil, pause, voix du premier choix : sans son, seule la pause de 15 cs compte.
    await runFor(t.engine, t.host, options?.audio ? 12_000 : 400);
    return { ...t, results };
  }

  it("rend 1 joueur au premier clic, sans toucher à rien d'autre", async () => {
    const t = await players();
    await t.press("Space");
    await runFor(t.engine, t.host, 200);
    expect(t.results).toEqual([1]);
  });

  it("droite / gauche changent le nombre sans rebouclage, Espace valide", async () => {
    const t = await players();
    await t.press("ArrowRight");
    await t.press("ArrowRight");
    await t.press("Space");
    expect(t.results).toEqual([3]);

    const u = await players();
    for (let i = 0; i < 6; i++) await u.press("ArrowRight"); // borné à 4
    await u.press("Space");
    expect(u.results).toEqual([4]);

    const v = await players();
    await v.press("ArrowLeft"); // déjà à 1
    await v.press("ArrowRight");
    await v.press("ArrowLeft");
    await v.press("ArrowLeft");
    await v.press("Space");
    expect(v.results).toEqual([1]);
  });

  it("les touches Q/A/Z/X de l'original fonctionnent aussi", async () => {
    const t = await players();
    await t.press("KeyX");
    await t.press("KeyX");
    await t.press("KeyZ");
    await t.press("Space");
    expect(t.results).toEqual([2]);
  });

  it("colore les silhouettes choisies", async () => {
    const t = await players();
    const pixel = () => t.host.lastPresentation.surface[75 * 320 + 132]; // intérieur de la 2e silhouette
    const brown = pixel();
    await t.press("ArrowRight");
    expect(pixel()).not.toBe(brown);
    await t.press("ArrowLeft");
    expect(pixel()).toBe(brown);
  });

  it("souris : la position du pointeur ne compte pas ; le clic gauche valide le nombre courant", async () => {
    const t = await players();
    await t.moveTo(SILHOUETTE_X[3], 75); // sur la 4e silhouette : sans effet
    await t.press("ArrowRight");
    await t.moveTo(SILHOUETTE_X[0], 75);
    await t.click(0);
    expect(t.results).toEqual([2]);
  });

  it("avec le son : voix d'accueil, puis voix du choix, puis voix de validation ; aucune musique", async () => {
    const t = await players({ audio: true });
    expect(t.host.audio.plays.length).toBeGreaterThanOrEqual(2); // accueil et « 1 joueur »
    const hint = await playedVoc(t, "s09v004t.voc");
    expect(t.host.audio.plays.map((p) => p.sound.samples)).toContain(hint);
    // Pas de musique à l'écran : la boucle de la voie ne relance rien.
    expect(t.host.audio.plays.every((p) => !p.loop)).toBe(true);
    await t.press("ArrowRight");
    await runFor(t.engine, t.host, 8000);
    const two = await playedVoc(t, "s09v005t.voc");
    expect(t.host.audio.plays.some((p) => p.sound.samples === two)).toBe(true);
    const before = t.host.audio.plays.length;
    await t.press("Space");
    expect(t.host.audio.plays.length).toBe(before + 1);
    const confirm = lastPlayed(t);
    expect([await playedVoc(t, "s09v009t.voc"), await playedVoc(t, "s09v010t.voc")]).toContain(confirm);
    await runFor(t.engine, t.host, 12000);
    expect(t.results).toEqual([2]);
  }, 60_000);
});

/** Associe un indice de sprite de personnage (4 à 9) au personnage de jeu (`21ee:0a0c..0a57`). */
const SPRITE_CHARACTER = [4, 0, 5, 2, 1, 3];

describe.skipIf(!hasOriginalFiles)("S08 : personnages et niveaux", () => {
  async function characters(count: number, options?: Parameters<typeof startScene>[1]) {
    const results: CharactersResult[] = [];
    const t = await startScene(createCharactersScene(count, (_, r) => void results.push(r)), options);
    await t.settle("CharactersScene");
    await runFor(t.engine, t.host, 300);
    return { ...t, results };
  }

  /** Valide le joueur courant et attend la fin de la capsule (et de la voix du joueur suivant). */
  async function validate(t: Awaited<ReturnType<typeof characters>>) {
    await t.press("Space");
    await runFor(t.engine, t.host, 1500);
  }

  it("un joueur : Espace valide le personnage de départ au niveau 1, puis « Jouer » rend la mise en place", async () => {
    const t = await characters(1);
    await validate(t);
    expect(t.results).toEqual([]);
    await t.press("Space"); // bouton Jouer
    expect(t.results).toHaveLength(1);
    const [result] = t.results;
    expect(result.action).toBe("play");
    if (result.action !== "play") return;
    expect(result.players).toHaveLength(1);
    expect(result.players[0].level).toBe(1);
    expect(SPRITE_CHARACTER).toContain(result.players[0].character);
  });

  it("droite / gauche changent de personnage avec rebouclage ; haut / bas le niveau (1 au départ, rebouclage)", async () => {
    const start = await characters(1);
    await validate(start);
    await start.press("Space");
    const first = (start.results[0] as Extract<CharactersResult, { action: "play" }>).players[0].character;
    const index = SPRITE_CHARACTER.indexOf(first);

    const next = await characters(1);
    await next.press("ArrowRight");
    await validate(next);
    await next.press("Space");
    expect((next.results[0] as Extract<CharactersResult, { action: "play" }>).players[0].character).toBe(SPRITE_CHARACTER[(index + 1) % 6]);

    const previous = await characters(1);
    await previous.press("ArrowLeft");
    await validate(previous);
    await previous.press("Space");
    expect((previous.results[0] as Extract<CharactersResult, { action: "play" }>).players[0].character).toBe(SPRITE_CHARACTER[(index + 5) % 6]);

    const levels: number[] = [];
    for (const keys of [["ArrowUp"], ["ArrowDown"], ["ArrowUp", "ArrowUp"], ["ArrowDown", "ArrowDown"]]) {
      const t = await characters(1);
      for (const key of keys) await t.press(key);
      await validate(t);
      await t.press("Space");
      levels.push((t.results[0] as Extract<CharactersResult, { action: "play" }>).players[0].level ?? -1);
    }
    expect(levels).toEqual([2, 0, 0, 2]);
  });

  it("quatre joueurs : personnages tous différents, niveaux et ordre conservés", async () => {
    const t = await characters(4);
    const chosenLevels = [0, 2, 1, 0];
    for (const level of chosenLevels) {
      if (level === 2) await t.press("ArrowUp");
      if (level === 0) await t.press("ArrowDown");
      await validate(t);
    }
    await t.press("Space");
    const [result] = t.results;
    expect(result.action).toBe("play");
    if (result.action !== "play") return;
    expect(result.players.map((p) => p.level)).toEqual(chosenLevels);
    expect(new Set(result.players.map((p) => p.character)).size).toBe(4);
    expect(result.players.every((p) => p.character >= 0 && p.character <= 5)).toBe(true);
  }, 60_000);

  it("un personnage pris n'est plus proposé : le second joueur parcourt les 5 autres", async () => {
    const seconds = new Set<number>();
    let first = -1;
    for (let steps = 0; steps < 5; steps++) {
      const t = await characters(2);
      await validate(t);
      for (let i = 0; i < steps; i++) await t.press("ArrowRight");
      await validate(t);
      await t.press("Space");
      const [result] = t.results;
      if (result.action !== "play") throw new Error("play attendu");
      first = result.players[0].character;
      seconds.add(result.players[1].character);
    }
    expect(seconds.size).toBe(5);
    expect(seconds.has(first)).toBe(false);
  }, 60_000);

  it("boutons : haut / bas avec rebouclage ; Annuler → back, Retour → menu", async () => {
    const back = await characters(1);
    await validate(back);
    await back.press("ArrowDown");
    await back.press("Space");
    expect(back.results).toEqual([{ action: "back" }]);

    const menu = await characters(1);
    await validate(menu);
    await menu.press("ArrowUp"); // rebouclage : Jouer → Retour
    await menu.press("Space");
    expect(menu.results).toEqual([{ action: "menu" }]);
  }, 60_000);

  it("boutons de la souris : gauche valide le bouton courant, la position du pointeur ne compte pas", async () => {
    const t = await characters(1);
    await validate(t);
    const text = (entry: number) => [...t.ctx.palette.colors.subarray(entry * 3, entry * 3 + 3)];
    const normal = text(122);
    await t.moveTo(270, 175); // sur le bouton Retour : sans effet
    expect(text(122)).toEqual(normal);
    await t.click(0);
    expect(t.results).toHaveLength(1);
    expect(t.results[0].action).toBe("play");
  }, 60_000);

  it("clic droit / Entrée : voix du personnage puis du niveau, sans valider", async () => {
    const t = await characters(1, { audio: true });
    const before = t.host.audio.plays.length;
    await t.press("Enter");
    expect(t.host.audio.plays.length).toBe(before + 1);
    await runFor(t.engine, t.host, 15000);
    expect(t.host.audio.plays.length).toBe(before + 2);
    expect(t.results).toEqual([]);
    expect(t.top()).toBe("CharactersScene");
    // Niveau 1 par défaut : voix `s08v016t.voc`.
    expect(lastPlayed(t)).toBe(await playedVoc(t, "s08v016t.voc"));
  }, 60_000);

  it("la capsule se pose : le fond garde le personnage, la couleur de niveau est copiée sur l'emplacement", async () => {
    const t = await characters(1);
    const entry = 0x72;
    const color = () => [...t.ctx.palette.colors.subarray(entry * 3, entry * 3 + 3)];
    const native = color();
    await t.press("ArrowUp"); // niveau 2 : rouge
    expect(color()).not.toEqual(native);
    const mcg = await t.ctx.resources.mcg("s08a001d.mcg");
    expect(color()).toEqual([...mcg.palette.subarray(119 * 3, 119 * 3 + 3)]);
    await t.press("ArrowDown");
    expect(color()).toEqual(native);
  });
});

describe.skipIf(!hasOriginalFiles)("S04 : menu parents", () => {
  async function parents(seed?: Partial<{ durationIndex: number; pauseIndex: number; messageIndex: number; lastGameMinutes: number }>) {
    let done = 0;
    const host = new TestHost();
    host.audio.enabled = false;
    const engine = new Engine(host, { seed: 3 });
    Object.assign(engine.ctx.options, seed);
    await engine.start(createParentsScene(() => void done++));
    const t = {
      host,
      engine,
      ctx: engine.ctx,
      get done() {
        return done;
      },
      press: async (code: string) => {
        host.input.keyDown(code);
        await runFor(engine, host, 100);
        host.input.keyUp(code);
        await runFor(engine, host, 100);
      },
      click: async (button = 0) => {
        host.input.mouseDown(button);
        await runFor(engine, host, 100);
        host.input.mouseUp(button);
        await runFor(engine, host, 100);
      },
      moveTo: async (x: number, y: number) => {
        host.input.mouseMove(x, y);
        await runFor(engine, host, 100);
      },
      center: async (rect: { x: number; y: number; w: number; h: number }) => {
        host.input.mouseMove(rect.x + rect.w / 2, rect.y + rect.h / 2);
        await runFor(engine, host, 100);
      },
      /** Durée de l'animation du cadran. */
      settle: () => runFor(engine, host, 500),
      lit: () => [119, 120, 121].filter((e) => engine.ctx.palette.colors[e * 3] === 0x10 && engine.ctx.palette.colors[e * 3 + 1] === 0xa4),
    };
    await runFor(engine, host, 1000);
    return t;
  }
  const saved = (t: Awaited<ReturnType<typeof parents>>) => loadOptions(t.host.storage);

  it("affiche les options enregistrées, première ligne en surbrillance", async () => {
    const t = await parents({ durationIndex: 2, pauseIndex: 3, messageIndex: 5 });
    expect(t.lit()).toEqual([119]);
    const fresh = await parents();
    // Le cadran et la jauge dépendent des valeurs : les images diffèrent.
    expect(t.host.lastPresentation.surface).not.toEqual(fresh.host.lastPresentation.surface);
  });

  it("haut / bas changent de ligne sans rebouclage ; gauche / droite la valeur, bornée pour durée et pause", async () => {
    const t = await parents();
    await t.press("ArrowUp");
    expect(t.lit()).toEqual([119]);
    await t.press("ArrowLeft");
    for (let i = 0; i < 5; i++) {
      await t.press("ArrowRight");
      await t.settle();
    }
    await t.press("ArrowDown");
    expect(t.lit()).toEqual([120]);
    for (let i = 0; i < 6; i++) await t.press("ArrowRight");
    await t.press("ArrowDown");
    await t.press("ArrowDown");
    expect(t.lit()).toEqual([121]);
    await t.press("ArrowLeft"); // le message reboucle : 0 → 8
    await t.press("Space");
    expect(t.done).toBe(1);
    expect(saved(t)).toEqual({ durationIndex: 3, pauseIndex: 4, messageIndex: 8, lastGameMinutes: 0 });
  }, 60_000);

  it("le message reboucle dans les deux sens ; la validation conserve la date de la dernière partie", async () => {
    const t = await parents({ messageIndex: 8, lastGameMinutes: 12345 });
    await t.press("ArrowDown");
    await t.press("ArrowDown");
    await t.press("ArrowRight"); // 8 → 0
    await t.press("ArrowRight"); // 0 → 1
    await t.press("Space");
    expect(saved(t)).toEqual({ durationIndex: 0, pauseIndex: 0, messageIndex: 1, lastGameMinutes: 12345 });
    expect(t.ctx.options.messageIndex).toBe(1);
    expect(t.host.storage.get(STORAGE_KEY)).not.toBeNull();
  });

  it("n'écrit rien tant qu'on ne valide pas ; Échap ne quitte pas", async () => {
    const t = await parents();
    await t.press("ArrowRight");
    await t.press("Escape");
    expect(t.done).toBe(0);
    expect(t.host.storage.get(STORAGE_KEY)).toBeNull();
  });

  it("le changement de ligne joue le bip, pas le changement de valeur", async () => {
    const t = await parents();
    const plays = () => t.host.audio.plays.length;
    t.host.audio.enabled = true;
    const before = plays();
    await t.press("ArrowRight");
    await t.settle();
    expect(plays()).toBe(before);
    await t.press("ArrowDown");
    expect(plays()).toBe(before + 1);
    await t.press("ArrowDown");
    await t.press("ArrowDown"); // déjà sur la dernière ligne
    expect(plays()).toBe(before + 2);
  });

  it("la durée anime le cadran (7 images) puis se fige sur l'image suivante", async () => {
    const t = await parents();
    const frames = new Set<string>();
    t.host.input.keyDown("ArrowRight");
    await runFor(t.engine, t.host, 1000, () => frames.add(Buffer.from(t.host.lastPresentation.surface.subarray(55 * 320, 90 * 320)).toString("base64")));
    t.host.input.keyUp("ArrowRight");
    expect(frames.size).toBeGreaterThanOrEqual(6);
  });

  it("le texte du message est écrit en bas et change avec la valeur", async () => {
    const t = await parents();
    const band = () => Buffer.from(t.host.lastPresentation.surface.subarray(178 * 320, 200 * 320)).toString("base64");
    const first = band();
    await t.press("ArrowDown");
    await t.press("ArrowDown");
    await t.press("ArrowRight");
    expect(band()).not.toBe(first);
  });

  it("souris : seul le clic gauche (valider) agit, sans tenir compte de la position du pointeur", async () => {
    const t = await parents();
    await t.moveTo(120, 100); // sur la ligne de la pause : sans effet
    expect(t.lit()).toEqual([119]);
    await t.click(2); // clic droit : sans effet
    await t.click(0);
    expect(t.done).toBe(1);
    expect(saved(t)).toEqual({ durationIndex: 0, pauseIndex: 0, messageIndex: 0, lastGameMinutes: 0 });
  }, 60_000);

  it("tous les messages se codent en CP437 et ont chacun un glyphe", async () => {
    for (const message of END_MESSAGES) expect(encodeCp437(message).includes(0x3f)).toBe(false);
    expect(END_MESSAGES).toHaveLength(9);
  });
});

describe.skipIf(!hasOriginalFiles)("parcours S07 → Jouer → S09 → S08 → partie", () => {
  it("enchaîne les vrais écrans et aboutit à la partie", async () => {
    const host = new TestHost();
    host.audio.enabled = false;
    const engine = new Engine(host, { seed: 11 });
    await engine.start(createMenuScene());
    const top = () => engine.ctx.scenes.top?.constructor.name;
    const settle = async (name: string) => {
      await runUntil(engine, host, () => top() === name && !engine.loading && !engine.ctx.scenes.transitioning && !engine.ctx.fade.active);
      await runFor(engine, host, 100);
    };
    const press = async (code: string) => {
      host.input.keyDown(code);
      await runFor(engine, host, 100);
      host.input.keyUp(code);
      await runFor(engine, host, 100);
    };
    await settle("MenuScene");
    for (let i = 0; i < 3; i++) await press("ArrowDown"); // Jouer
    await press("Space");
    await settle("PlayersScene");
    await runFor(engine, host, 400); // pause entre la voix d'accueil et le choix
    await press("ArrowRight");
    await press("Space"); // 2 joueurs
    await settle("CharactersScene");
    await press("ArrowUp"); // joueur 1 : niveau 2
    await press("Space");
    await runFor(engine, host, 1500);
    await press("ArrowDown"); // joueur 2 : niveau 0
    await press("Space");
    await runFor(engine, host, 1500);
    await press("Space"); // Jouer
    await settle("GameScene");
    expect(host.loaded.some((path) => /S01A001D\.MCG/i.test(path))).toBe(true);
    // Les joueurs, personnages et niveaux choisis à S08 sont ceux de la partie.
    const { players } = (engine.ctx.scenes.top as GameScene).game.state;
    expect(players.map((p) => p.level)).toEqual([2, 0]);
  }, 60_000);
});
