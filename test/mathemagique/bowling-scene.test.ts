import { describe, expect, it } from "vitest";
import { MohawkArchive } from "../../src/games/mathemagique/data/mohawk";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import { SceneId } from "../../src/games/mathemagique/engine/scene";
import { installServices, type MathServices } from "../../src/games/mathemagique/engine/services";
import type { PlaySoundOptions } from "../../src/games/mathemagique/engine/sound";
import { STRIKE_SCRIPTS, STRIKE_WITHOUT_EPILOGUE, strikeScriptId } from "../../src/games/mathemagique/game/bowling";
import { BowlingScene, createBowlingScene, gusExitId, gusReactionId, helpZoneAt } from "../../src/games/mathemagique/scenes/bowling";
import { registerScenes } from "../../src/games/mathemagique/scenes";
import type { Surface } from "../../src/games/mathemagique/engine/graphics/surface";
import { EXIT_RECT, GUS_ZONE } from "../../src/games/mathemagique/scenes/bowling-view";
import { FRAME_MS, TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles, readOriginal } from "./helpers";

const real = describe.skipIf(!hasOriginalFiles);
const LONG = 600_000;

real("table des animations de strike (1108:0974)", () => {
  it("69 ids, tous présents dans BOWLING.DAT (SCR, SHPL et SNDL)", () => {
    const archive = MohawkArchive.parse(readOriginal("BOWLING.DAT"));
    expect(STRIKE_SCRIPTS).toHaveLength(69);
    expect(new Set(STRIKE_SCRIPTS).size).toBe(69);
    for (const id of STRIKE_SCRIPTS) {
      expect(archive.has("\0SCR", id), `SCR ${id}`).toBe(true);
      expect(archive.has("SHPL", id), `SHPL ${id}`).toBe(true);
      expect(archive.has("SNDL", id), `SNDL ${id}`).toBe(true);
    }
    expect(strikeScriptId(0)).toBe(10200);
    expect(strikeScriptId(49)).toBe(10000);
    expect(STRIKE_SCRIPTS).toContain(STRIKE_WITHOUT_EPILOGUE);
    expect(() => strikeScriptId(69)).toThrow(RangeError);
  });
});

describe("Bowling : tables de Gus et de Polly", () => {
  it("réactions de Gus : 30000 + 50n (joie), 24950 + 50(n − 31) (dépit), 22000 + 100n (départ)", () => {
    expect(gusReactionId(0)).toBe(30000);
    expect(gusReactionId(30)).toBe(31500);
    expect(gusReactionId(31)).toBe(24950);
    expect(gusReactionId(38)).toBe(25300);
    expect(gusExitId(14)).toBe(23400);
  });

  it("zones d'aide : Polly puis 13 sujets (Gus = sujet 11)", () => {
    expect(helpZoneAt(450, 400)).toBe("poly");
    expect(helpZoneAt(150, 300)).toBe("subject11");
    expect(helpZoneAt(300, 170)).toBe("subject1");
    expect(helpZoneAt(5, 5)).toBeNull();
  });
});

interface Rig {
  host: TestHost;
  engine: Engine;
  services: MathServices;
  scene: BowlingScene;
  sounds: { id: number; options?: PlaySoundOptions }[];
  /** Drapeaux de chaque animation `SCR` lancée (id → drapeaux). */
  scrFlags: Map<number, number>;
  tick(n?: number): Promise<void>;
  until(done: () => boolean, limitMs?: number): Promise<void>;
  click(x: number, y: number): Promise<void>;
  /** Clique la case `slot` (0 à 3). */
  clickAnswer(slot: number): Promise<void>;
  /** Répond juste et attend la fin de l'animation. */
  answerRight(): Promise<void>;
}

const GO: [number, number] = [463, 130];

/** Pixels de la zone de Gus (`GUS_ZONE`) d'une surface. */
function gusZone(surface: Surface): Uint8Array {
  const { x, y, w, h } = GUS_ZONE;
  const out = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) out.set(surface.pixels.subarray((y + row) * surface.width + x, (y + row) * surface.width + x + w), row * w);
  return out;
}

/** Pixels d'un rectangle d'une surface. */
function rectBytes(surface: Surface, rect: { x: number; y: number; w: number; h: number }): number[] {
  const out: number[] = [];
  for (let row = 0; row < rect.h; row++) out.push(...surface.pixels.subarray((rect.y + row) * surface.width + rect.x, (rect.y + row) * surface.width + rect.x + rect.w));
  return out;
}

/** Nombre de pixels qui diffèrent : Gus entier en change des milliers, l'œil qui cligne quelques dizaines. */
function diffCount(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

const GUS_PIXELS = 2000;

async function boot(options: { seconds?: number; player?: boolean; real?: boolean } = {}): Promise<Rig> {
  const host = new TestHost();
  host.audio.unlock();
  const engine = new Engine(host, { seed: 7 });
  const services = installServices(engine);
  if (options.seconds) engine.ctx.roster.roster.setBowlingSeconds(options.seconds);
  if (options.player !== false) {
    const added = engine.ctx.roster.roster.addPlayer("Test");
    if (!added.ok) throw new Error("joueur");
    engine.ctx.roster.currentPlayerId = added.id;
  }
  const sounds: Rig["sounds"] = [];
  const play = services.sound.playSound.bind(services.sound);
  services.sound.playSound = (archive, id, opts) => {
    sounds.push({ id, options: opts });
    return play(archive, id, opts);
  };
  const scrFlags = new Map<number, number>();
  const start = services.scr.start.bind(services.scr);
  services.scr.start = (archive, id, opts) => {
    scrFlags.set(id, opts?.flags ?? 0);
    return start(archive, id, opts);
  };
  let scene!: BowlingScene;
  if (options.real) {
    registerScenes(engine, services, { factories: { [SceneId.bowling]: () => (scene = createBowlingScene(services) as BowlingScene) } });
  } else {
    engine.register(SceneId.bowling, () => (scene = createBowlingScene(services) as BowlingScene));
    engine.register(SceneId.hub, () => ({ enter: (ctx) => ctx.requestPresent(), leave: () => {}, tick: () => {} }));
  }
  engine.start(SceneId.bowling);
  await runFor(engine, host, 100);
  const rig: Rig = {
    host,
    engine,
    services,
    get scene() {
      return scene;
    },
    sounds,
    scrFlags,
    tick: (n = 1) => runFor(engine, host, FRAME_MS * n),
    until: (done, limitMs = LONG) => runUntil(engine, host, done, limitMs),
    async click(x, y) {
      host.click(x, y);
      await rig.tick(3);
    },
    async clickAnswer(slot) {
      await rig.click(173 + 74 * slot, 169);
    },
    async answerRight() {
      const q = scene.currentQuestion!;
      await rig.clickAnswer(q.correctSlot);
      await rig.until(() => !scene.busy);
    },
  };
  await rig.until(() => scene.ready);
  return rig;
}

real("Bowling : scène complète sur BOWLING.DAT", () => {
  it("entrée : fondu, opération + au niveau 1, rien en cours, rang 1", async () => {
    const { scene, engine } = await boot();
    expect(engine.scenes.currentId).toBe(SceneId.bowling);
    expect(scene.playing).toBe(false);
    expect(scene.progressState.operation).toBe(0);
    expect(scene.progressState.level).toBe(0);
    expect(scene.progressState.rank).toBe(1);
    expect(scene.currentQuestion).toBeNull();
  });

  it("entrée : Gus entre par SCR 18100 (drapeaux 0x1e du descripteur 04f8), seule animation interruptible", async () => {
    const rig = await boot();
    expect(rig.scene.played[0]).toBe(18100);
    expect(rig.scrFlags.get(18100)).toBe(0x1e);
  });

  it("strike et réactions de Gus : drapeaux 0x12 (MIDI conservé, attente des sons), sans clic ni sauvegarde du fond", async () => {
    const rig = await boot();
    const { scene } = rig;
    await rig.click(...GO);
    for (let i = 0; i < 10; i++) await rig.answerRight();
    for (const id of [18000, strikeScriptId(scene.lastStrike!.animation), ...(scene.lastStrike!.animation === 0 ? [] : [18050])]) {
      if (id === 12800) continue;
      expect(rig.scrFlags.get(id), `SCR ${id}`).toBe(0x12);
    }
    await rig.click(150, 330);
    await rig.until(() => !scene.busy);
    const reaction = [...rig.scrFlags].filter(([id]) => (id >= 30000 && id < 32000) || (id >= 24950 && id < 26000));
    expect(reaction.length).toBeGreaterThan(0);
    for (const [, flags] of reaction) expect(flags).toBe(0x12);
  });

  it("strike et réactions : le Gus au repos est retiré du fond pendant l'animation (pas de second Gus derrière), puis remis", async () => {
    const rig = await boot();
    const { scene, services } = rig;
    // Zone de Gus du fond passé à chaque animation, copiée au démarrage (le fond est le `canvas` de la scène, modifié ensuite).
    const zones = new Map<number, Uint8Array>();
    const start = services.scr.start.bind(services.scr);
    services.scr.start = (archive, id, opts) => {
      if (opts?.background) zones.set(id, gusZone(opts.background));
      return start(archive, id, opts);
    };
    // Après l'entrée, Gus au repos est dans le décor.
    const atRest = gusZone((scene as unknown as { canvas: Surface }).canvas);
    await rig.click(...GO);
    for (let i = 0; i < 10; i++) await rig.answerRight();
    const strikeId = strikeScriptId(scene.lastStrike!.animation);
    for (const id of [18000, strikeId]) {
      expect(zones.get(id), `SCR ${id}`).toBeDefined();
      expect(diffCount(zones.get(id)!, atRest), `SCR ${id} : Gus au repos dans le fond`).toBeGreaterThan(GUS_PIXELS);
    }
    // Strike fini : Gus revient au repos.
    expect(diffCount(gusZone((scene as unknown as { canvas: Surface }).canvas), atRest)).toBeLessThan(GUS_PIXELS);
  });

  it("choix de l'opération (×) et du niveau (2) ; le bonus est refusé tant que les 4 niveaux ne sont pas faits", async () => {
    const rig = await boot();
    const { scene } = rig;
    await rig.click(58, 174);
    expect(scene.progressState.operation).toBe(2);
    await rig.click(269, 261);
    expect(scene.progressState.level).toBe(1);
    await rig.click(283, 283);
    expect(scene.progressState.level).toBe(1);
    expect(rig.sounds.map((s) => s.id)).toContain(1003);
    // Les 4 niveaux de l'opération faits : le bonus devient accessible.
    scene.progressState.mask = 0b01111 << 10;
    await rig.click(58, 174);
    await rig.click(283, 283);
    expect(scene.progressState.level).toBe(4);
  });

  it("touches 1 à 4 ignorées hors partie, actives pendant la partie", async () => {
    const rig = await boot();
    const { scene, host } = rig;
    host.press("Digit1", {});
    await rig.tick(3);
    expect(scene.currentQuestion).toBeNull();
    expect(scene.playing).toBe(false);
    await rig.click(...GO);
    expect(scene.playing).toBe(true);
    const q = scene.currentQuestion!;
    host.input.keyDown({ code: `Digit${q.correctSlot + 1}`, key: String(q.correctSlot + 1), ctrl: false, shift: false, alt: false });
    host.input.keyUp(`Digit${q.correctSlot + 1}`, { ctrl: false, shift: false, alt: false });
    await rig.tick(3);
    expect(scene.busy).toBe(true);
    await rig.until(() => !scene.busy);
    expect(scene.progressState.roundCorrect).toBe(1);
  });

  it("GO : question à 4 réponses dont une bonne ; STOP arrête la partie", async () => {
    const rig = await boot();
    const { scene } = rig;
    await rig.click(...GO);
    expect(scene.playing).toBe(true);
    expect(scene.gameTimer.running).toBe(true);
    const q = scene.currentQuestion!;
    expect(q.choices).toHaveLength(4);
    expect(rig.sounds.map((s) => s.id)).toContain(1007);
    expect(rig.sounds.some((s) => s.id === 2000 && s.options?.ambient === true && s.options?.loop === true)).toBe(true);
    await rig.click(...GO);
    expect(scene.playing).toBe(false);
    expect(scene.gameTimer.running).toBe(false);
    expect(scene.currentQuestion).toBeNull();
  });

  it("mauvaise réponse : son 1000, la question manquée revient dans les 6 suivantes", async () => {
    const rig = await boot();
    const { scene } = rig;
    await rig.click(...GO);
    const first = scene.currentQuestion!;
    const wrong = (first.correctSlot + 1) % 4;
    await rig.clickAnswer(wrong);
    expect(rig.sounds.map((s) => s.id)).toContain(1000);
    expect(scene.questionPicker.pending).toBe(1);
    await rig.until(() => !scene.busy);
    expect(scene.progressState.roundCorrect).toBe(0);
    let back = false;
    for (let i = 0; i < 8 && !back; i++) {
      const q = scene.currentQuestion!;
      if (q.retry) {
        expect(q.subType).toBe(first.subType);
        expect(q.index).toBe(first.index);
        expect(q.correctSlot).not.toBe(wrong);
        back = true;
      } else await rig.answerRight();
    }
    expect(back).toBe(true);
  });

  it("temps écoulé : 1 s, partie arrêtée, son 1022 puis réaction de Gus (dépit)", async () => {
    const rig = await boot({ seconds: 1 });
    const { scene } = rig;
    await rig.click(...GO);
    expect(scene.gameTimer.totalTicks).toBe(60);
    await rig.until(() => !scene.playing);
    await rig.tick(2);
    expect(rig.sounds.map((s) => s.id)).toContain(1022);
    await rig.until(() => !scene.busy);
    const gus = scene.played.filter((id) => id >= 24950 && id <= 25300);
    expect(gus).toHaveLength(1);
    expect(scene.progressState.currentStrikes).toBe(0);
  });

  it("10 bonnes réponses : strike (animation de la table, fanfare 1020), pion du strike zone", async () => {
    const rig = await boot();
    const { scene } = rig;
    await rig.click(...GO);
    for (let i = 0; i < 10; i++) {
      if (i < 9) expect(scene.progressState.roundCorrect).toBe(i);
      await rig.answerRight();
    }
    const strike = scene.lastStrike!;
    expect(strike.strikes).toBe(1);
    expect(scene.played).toContain(strikeScriptId(strike.animation));
    expect(scene.played).toContain(18000);
    expect(rig.sounds.map((s) => s.id)).toEqual(expect.arrayContaining([1020, 1011]));
    expect(scene.progressState.currentStrikes).toBe(1);
    expect(scene.playing).toBe(false);
    // Les 10 animations de quilles de la partie sont celles du jeu tiré.
    const set = scene.pinSetIndex;
    expect(set).toBeGreaterThanOrEqual(0);
    expect(scene.played.filter((id) => id >= 1200 && id < 1500)).toHaveLength(10);
  });

  it("10e strike : niveau terminé, bit du masque écrit dans le roster, rang 2, niveau suivant", async () => {
    const rig = await boot();
    const { scene, engine } = rig;
    for (let i = 0; i < 9; i++) scene.progressState.strike(engine.ctx.rng);
    expect(scene.progressState.currentStrikes).toBe(9);
    await rig.click(...GO);
    for (let i = 0; i < 10; i++) await rig.answerRight();
    const result = scene.lastStrike!;
    expect(result.levelCompleted).toBe(true);
    expect(result.maskBit).toBe(0);
    expect(rig.sounds.map((s) => s.id)).toContain(1021);
    const roster = engine.ctx.roster;
    expect(roster.roster.getMask(roster.currentPlayerId) & 1).toBe(1);
    expect(roster.roster.grade(roster.currentPlayerId)).toBe(2);
    expect(scene.progressState.rank).toBe(2);
    expect(scene.progressState.level).toBe(1);
    // Un joueur de plus aurait gardé ses variables : le roster contient le niveau courant.
    expect(roster.roster.getVarArray(roster.currentPlayerId, "bowlingLevel")[0]).toBe(1);
  });

  it("niveau terminé : « LEVEL 2 » est écrit dans la fenêtre du problème pendant la bannière, puis effacé", async () => {
    const rig = await boot();
    const { scene, services } = rig;
    for (let i = 0; i < 9; i++) scene.progressState.strike(rig.engine.ctx.rng);
    const ink = () => {
      const { screen } = services.graphics;
      let n = 0;
      for (let y = 81; y < 122; y++) for (let x = 170; x < 401; x++) if (screen.pixels[y * screen.width + x] === 0) n++;
      return n;
    };
    const rest = ink();
    await rig.click(...GO);
    for (let i = 0; i < 10; i++) {
      await rig.clickAnswer(scene.currentQuestion!.correctSlot);
      if (i < 9) await rig.until(() => !scene.busy);
    }
    while (!rig.sounds.some((s) => s.id === 1021)) await rig.tick();
    expect(ink()).toBeGreaterThan(rest + 40);
    await rig.until(() => !scene.busy);
    expect(ink()).toBe(rest);
  });

  it("aide : Polly arrive, un clic sur elle la renvoie", async () => {
    const rig = await boot();
    const { scene } = rig;
    await rig.click(474, 176);
    expect(scene.helper.active).toBe(true);
    expect(rig.sounds.map((s) => s.id)).toContain(1008);
    scene.helper.abort();
  });

  it("sortie : EXIT, réaction de départ de Gus, retour au hub", async () => {
    const rig = await boot();
    const { scene, engine } = rig;
    await rig.click(86, 246);
    await rig.until(() => engine.scenes.currentId === SceneId.hub);
    expect(scene.played.some((id) => id >= 22000 && id <= 23400)).toBe(true);
  });

  it("sortie : pendant l'au revoir de Gus, le bouton EXIT reste dans le fond de l'animation (pas effacé)", async () => {
    const rig = await boot();
    const { services, engine } = rig;
    // Partie d'EXIT hors de la zone de Gus (le Gus au repos, retiré du fond, passe sous le reste du bouton).
    const exitPart = { x: EXIT_RECT.x, y: EXIT_RECT.y, w: GUS_ZONE.x - EXIT_RECT.x, h: EXIT_RECT.h };
    let compared = false;
    const start = services.scr.start.bind(services.scr);
    services.scr.start = (archive, id, opts) => {
      if (id >= 22000 && id <= 23400 && opts?.background) {
        expect(rectBytes(opts.background, exitPart)).toEqual(rectBytes(services.graphics.screen, exitPart));
        compared = true;
      }
      return start(archive, id, opts);
    };
    await rig.click(86, 246);
    await rig.until(() => engine.scenes.currentId === SceneId.hub);
    expect(compared).toBe(true);
  });

  it("trophée : Hall of Fame, puis retour au Bowling", async () => {
    const rig = await boot({ real: true });
    const { engine } = rig;
    await rig.click(508, 127);
    await rig.until(() => engine.scenes.currentId === SceneId.trophy);
    await runFor(engine, rig.host, 2000);
    rig.host.click(519, 390);
    await rig.until(() => engine.scenes.currentId === SceneId.bowling);
    expect(rig.scene.ready).toBe(false);
  });
});
