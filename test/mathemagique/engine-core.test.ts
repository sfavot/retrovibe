import { describe, expect, it } from "vitest";
import { Clock, MAX_CATCH_UP_TICKS, TICK_MS, msToTicks } from "../../src/games/mathemagique/engine/clock";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import type { Frame } from "../../src/games/mathemagique/engine/graphics/frame";
import { MsvcRandom, NoRepeatPool } from "../../src/games/mathemagique/engine/rng";
import {
  BONUS_LEVEL,
  MAX_PLAYERS,
  ROSTER_FIELDS,
  ROSTER_RECORD_SIZE,
  ROSTER_SIZE,
  ROSTER_STORAGE_KEY,
  Roster,
  RosterFormatError,
  RosterStore,
  canAppendNameChar,
  formatPlayerName,
  gradeOfMask,
  isValidPlayerName,
  type RosterFieldName,
} from "../../src/games/mathemagique/engine/roster";
import type { KeyEvent } from "../../src/games/mathemagique/engine/input";
import { SCENE_NAMES, SceneId, defineService, type Scene, type SceneContext } from "../../src/games/mathemagique/engine/scene";
import { FRAME_MS, TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles } from "./helpers";

/** Archive Mohawk minimale : un type `TEST` à deux ressources (ids 7 et 9). */
function tinyArchive(): Uint8Array {
  const abs = 28;
  const bytes = new Uint8Array(200);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("MHWK"), 0);
  bytes.set(new TextEncoder().encode("RSRC"), 8);
  view.setUint32(20, abs);
  view.setUint16(abs + 2, 1);
  bytes.set(new TextEncoder().encode("TEST"), abs + 4);
  view.setUint16(abs + 8, 20);
  view.setUint16(abs + 10, 40);
  view.setUint16(abs + 12, 50);
  view.setUint16(24, 50);
  view.setUint16(abs + 20, 2);
  view.setUint16(abs + 22, 7);
  view.setUint16(abs + 24, 1);
  view.setUint16(abs + 26, 9);
  view.setUint16(abs + 28, 2);
  view.setUint32(abs + 50, 2);
  view.setUint32(abs + 54, 150);
  view.setUint16(abs + 58, 3);
  view.setUint32(abs + 64, 153);
  view.setUint16(abs + 68, 2);
  bytes.set([1, 2, 3, 4, 5], 150);
  return bytes;
}

/** Scène de test qui journalise son cycle de vie dans `log`. */
class LogScene implements Scene {
  ticks = 0;
  constructor(
    readonly name: string,
    readonly log: string[],
    private readonly onTick?: (ctx: SceneContext, ticks: number) => void,
    readonly loader?: (ctx: SceneContext) => Promise<void>,
  ) {
    if (loader) this.load = loader;
  }
  load?: (ctx: SceneContext) => Promise<void>;
  key?: (event: KeyEvent, ctx: SceneContext) => boolean;
  exit?: (ctx: SceneContext) => void;
  enter(): void {
    this.log.push(`${this.name}.enter`);
  }
  leave(): void {
    this.log.push(`${this.name}.leave`);
  }
  tick(ctx: SceneContext): void {
    this.ticks++;
    this.log.push(`${this.name}.tick`);
    this.onTick?.(ctx, this.ticks);
  }
}

function setup(): { host: TestHost; engine: Engine } {
  const host = new TestHost();
  return { host, engine: new Engine(host, { seed: 0 }) };
}

describe("Clock", () => {
  it("tick de 17 ms : 1 s d'images à 60 Hz donne 58 ou 59 ticks, jamais de dérive", () => {
    const clock = new Clock();
    let count = 0;
    for (let i = 0; i <= 600; i++) {
      clock.update(i * (1000 / 60));
      while (clock.consume()) count++;
    }
    expect(TICK_MS).toBe(17);
    expect(count).toBe(Math.floor(10000 / 17));
    expect(clock.ticks).toBe(count);
  });

  it("le premier update ne fait que fixer l'origine", () => {
    const clock = new Clock();
    clock.update(123456);
    expect(clock.consume()).toBe(false);
  });

  it("abandonne le temps perdu au-delà du rattrapage maximal", () => {
    const clock = new Clock();
    clock.update(0);
    clock.update(10_000);
    let n = 0;
    while (clock.consume()) n++;
    expect(n).toBe(MAX_CATCH_UP_TICKS);
    clock.update(10_017);
    expect(clock.consume()).toBe(true);
    expect(clock.consume()).toBe(false);
  });

  it("resync : l'absence n'est pas rattrapée", () => {
    const clock = new Clock();
    clock.update(0);
    clock.resync();
    clock.update(5000);
    expect(clock.consume()).toBe(false);
    clock.update(5034);
    expect(clock.consume()).toBe(true);
  });

  it("Deadline et Timer comptent en ticks", () => {
    const clock = new Clock();
    const deadline = clock.deadline(3);
    const timer = clock.createTimer();
    expect(deadline.expired).toBe(false);
    clock.update(0);
    clock.update(17 * 2);
    while (clock.consume());
    expect(deadline.remaining).toBe(1);
    timer.freeze();
    clock.update(17 * 4);
    while (clock.consume());
    expect(deadline.expired).toBe(true);
    expect(timer.ticks).toBe(2);
    timer.resume();
    clock.update(17 * 5);
    while (clock.consume());
    expect(timer.ticks).toBe(3);
    deadline.restart(2);
    expect(deadline.remaining).toBe(2);
    expect(clock.deadline(0).expired).toBe(true);
    expect(msToTicks(17)).toBe(1);
    expect(msToTicks(18)).toBe(2);
  });
});

describe("SceneManager et Engine", () => {
  it("les 11 scènes ont les identifiants 0 à 10 et leurs noms", () => {
    expect(SCENE_NAMES).toEqual(["hub", "bowling", "rhythm", "patternWindows", "hidden", "patterns", "sticklers", "rockets", "title", "credits", "trophy"]);
    expect(SceneId.title).toBe(8);
    expect(SceneId.trophy).toBe(10);
  });

  it("changement différé : demandé pendant un tick, appliqué au début du tick suivant (leave puis enter)", async () => {
    const { host, engine } = setup();
    const log: string[] = [];
    engine.register(SceneId.hub, () => new LogScene("hub", log, (ctx, n) => n === 1 && ctx.scenes.request(SceneId.bowling)));
    engine.register(SceneId.bowling, () => new LogScene("bowling", log));
    engine.start(SceneId.hub);
    await runFor(engine, host, 17 * 5);
    expect(log.slice(0, 5)).toEqual(["hub.enter", "hub.tick", "hub.leave", "bowling.enter", "bowling.tick"]);
    expect(engine.scenes.currentId).toBe(SceneId.bowling);
  });

  it("une demande faite pendant enter est différée au tick suivant", async () => {
    const { host, engine } = setup();
    const log: string[] = [];
    const first = new LogScene("a", log);
    first.enter = function (this: LogScene) {
      log.push("a.enter");
      engine.scenes.request(SceneId.credits);
    };
    engine.register(SceneId.title, () => first);
    engine.register(SceneId.credits, () => new LogScene("b", log));
    engine.start();
    await runFor(engine, host, 17 * 4);
    expect(log.slice(0, 5)).toEqual(["a.enter", "a.tick", "a.leave", "b.enter", "b.tick"]);
  });

  it("load asynchrone : l'ancienne scène est gelée, le curseur est occupé, puis leave / enter dans le même tick", async () => {
    const { host, engine } = setup();
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    engine.register(SceneId.hub, () => new LogScene("hub", log, (ctx, n) => n === 1 && ctx.scenes.request(SceneId.rhythm)));
    engine.register(SceneId.rhythm, () => new LogScene("rhythm", log, undefined, async () => {
      log.push("rhythm.load");
      await gate;
    }));
    engine.start(SceneId.hub);
    for (let i = 0; i < 6; i++) engine.frame((host.time += 17));
    expect(engine.loading).toBe(true);
    expect(host.cursor).toBe("busy");
    await Promise.resolve();
    const frozen = log.length;
    for (let i = 0; i < 5; i++) engine.frame((host.time += 17));
    expect(log.length).toBe(frozen); // ancienne scène gelée
    expect(log).not.toContain("hub.leave");
    release();
    await engine.whenLoaded;
    for (let i = 0; i < 3; i++) engine.frame((host.time += 17));
    expect(engine.scenes.currentId).toBe(SceneId.rhythm);
    const at = log.indexOf("hub.leave");
    expect(log.slice(at, at + 3)).toEqual(["hub.leave", "rhythm.enter", "rhythm.tick"]);
    expect(log.indexOf("rhythm.load")).toBeLessThan(log.indexOf("hub.leave"));
    expect(host.cursor).toBe("arrow");
  });

  it("échec de load : l'ancienne scène reprend et l'erreur est remontée", async () => {
    const host = new TestHost();
    const errors: [unknown, number][] = [];
    const engine = new Engine(host, { seed: 0, onError: (e, id) => errors.push([e, id]) });
    const log: string[] = [];
    engine.register(SceneId.hub, () => new LogScene("hub", log, (ctx, n) => n === 1 && ctx.scenes.request(SceneId.hidden)));
    engine.register(SceneId.hidden, () => new LogScene("hidden", log, undefined, () => Promise.reject(new Error("boum"))));
    engine.start(SceneId.hub);
    await runFor(engine, host, 17 * 8);
    expect(engine.failed).toBe(false);
    expect(engine.scenes.currentId).toBe(SceneId.hub);
    expect(engine.error?.sceneId).toBe(SceneId.hidden);
    expect(errors).toHaveLength(1);
    expect((errors[0]![0] as Error).message).toBe("boum");
    expect(log.filter((l) => l === "hub.tick").length).toBeGreaterThan(2);
    expect(log).not.toContain("hub.leave");
  });

  it("échec du load de la première scène : le moteur s'arrête proprement", async () => {
    const { host, engine } = setup();
    engine.register(SceneId.title, () => new LogScene("t", [], undefined, () => Promise.reject(new Error("absent"))));
    engine.start();
    await runFor(engine, host, 17 * 5);
    expect(engine.failed).toBe(true);
    expect(() => engine.frame((host.time += 1000))).not.toThrow();
    expect(host.frames).toHaveLength(0);
  });

  it("une scène non enregistrée est une erreur de programmation explicite", () => {
    const { host, engine } = setup();
    engine.start(SceneId.trophy);
    engine.frame(0);
    expect(() => engine.frame(host.time + 100)).toThrow(/trophy/);
  });

  it("présente seulement quand une scène le demande", async () => {
    const { host, engine } = setup();
    const frame: Frame = { pixels: new Uint8Array(576 * 432), palette: new Uint8Array(768) };
    engine.setFrameSource(() => frame);
    engine.register(SceneId.title, () => new LogScene("t", [], (ctx, n) => n === 10 && ctx.requestPresent()));
    engine.start();
    await runFor(engine, host, 17 * 5);
    expect(host.frames).toHaveLength(1); // l'`enter` demande la première présentation
    await runFor(engine, host, 17 * 4);
    expect(host.frames).toHaveLength(1);
    await runFor(engine, host, 17 * 8);
    expect(host.frames).toHaveLength(2);
    expect(host.frames[1]!.pixels).toHaveLength(576 * 432);
  });

  it("services : fournis par clé typée, lus par les scènes", () => {
    const { engine } = setup();
    const KEY = defineService<{ n: number }>("test");
    expect(engine.services.has(KEY)).toBe(false);
    expect(() => engine.ctx.services.get(KEY)).toThrow(/test/);
    engine.services.provide(KEY, { n: 3 });
    expect(engine.ctx.services.get(KEY).n).toBe(3);
  });

  it("clavier : gadgets (before), scène, puis non consommées ; Ctrl+Q quitte", async () => {
    const { host, engine } = setup();
    const seen: string[] = [];
    const scene = new LogScene("t", []);
    scene.key = (ev) => {
      seen.push(`scene:${ev.code}`);
      return ev.code === "KeyA";
    };
    engine.register(SceneId.title, () => scene);
    engine.addKeyHandler("before", (ev) => {
      seen.push(`before:${ev.code}`);
      return ev.code === "KeyB";
    });
    engine.addKeyHandler("after", (ev) => {
      seen.push(`after:${ev.code}`);
      return false;
    });
    engine.start();
    await runFor(engine, host, 17 * 3);
    host.press("KeyB");
    host.press("KeyA");
    host.press("KeyC");
    await runFor(engine, host, 17 * 2);
    expect(seen).toEqual(["before:KeyB", "before:KeyA", "scene:KeyA", "before:KeyC", "scene:KeyC", "after:KeyC"]);
    expect(host.exited).toBe(false);
    host.press("KeyQ", { ctrl: true });
    await runFor(engine, host, 17 * 2);
    expect(host.exited).toBe(true);
  });

  it("exit : transmis à la scène courante, faux si elle n'en a pas", async () => {
    const { host, engine } = setup();
    const scene = new LogScene("t", []);
    engine.register(SceneId.title, () => scene);
    engine.start();
    await runFor(engine, host, 17 * 3);
    expect(engine.requestExit()).toBe(false);
    let called = 0;
    scene.exit = () => void called++;
    expect(engine.requestExit()).toBe(true);
    expect(called).toBe(1);
  });

  it("pause : plus de tick, pas de rattrapage à la reprise, audio suspendu", async () => {
    const { host, engine } = setup();
    const scene = new LogScene("t", []);
    engine.register(SceneId.title, () => scene);
    engine.start();
    await runFor(engine, host, 17 * 5);
    const before = scene.ticks;
    engine.setPaused(true);
    expect(host.audio.suspended).toBe(true);
    await runFor(engine, host, 5000);
    expect(scene.ticks).toBe(before);
    engine.setPaused(false);
    expect(host.audio.suspended).toBe(false);
    await runFor(engine, host, FRAME_MS * 3);
    expect(scene.ticks - before).toBeLessThanOrEqual(1);
  });

  it("la graine par défaut vient de l'horloge murale de l'hôte", () => {
    const host = new TestHost();
    host.unix = 1_700_000_123_456;
    const engine = new Engine(host);
    expect(engine.ctx.rng.current).toBe(1_700_000_123_456 >>> 0);
  });
});

describe("Input", () => {
  it("un clic plus court qu'une image n'est pas perdu : appui et relâchement arrivent au tick suivant", async () => {
    const { host, engine } = setup();
    const seen: string[] = [];
    engine.register(SceneId.title, () => new LogScene("t", [], (ctx) => {
      for (const e of ctx.input.buttonEvents) seen.push(`${e.button}:${e.down ? "down" : "up"}@${e.x},${e.y}`);
    }));
    engine.start();
    await runFor(engine, host, 17 * 3);
    host.click(100, 50);
    expect(host.input.isButtonDown("left")).toBe(false);
    await runFor(engine, host, 17 * 3);
    expect(seen).toEqual(["left:down@100,50", "left:up@100,50"]);
  });

  it("plusieurs clics dans la même image sont tous remis, dans l'ordre, avec leur position", async () => {
    const { host, engine } = setup();
    const seen: string[] = [];
    engine.register(SceneId.title, () => new LogScene("t", [], (ctx) => {
      if (ctx.input.justPressed("right")) seen.push("right");
      for (const e of ctx.input.buttonEvents) if (e.down) seen.push(`${e.button}@${e.x}`);
    }));
    engine.start();
    await runFor(engine, host, 17 * 3);
    host.click(10, 10);
    host.click(20, 10, "right");
    host.click(30, 10);
    await runFor(engine, host, 17 * 2);
    expect(seen).toEqual(["right", "left@10", "right@20", "left@30"]);
  });

  it("les événements ne sont remis qu'une fois ; les états tenus restent lisibles", async () => {
    const { host, engine } = setup();
    let presses = 0;
    engine.register(SceneId.title, () => new LogScene("t", [], (ctx) => void (presses += ctx.input.buttonEvents.length)));
    engine.start();
    await runFor(engine, host, 17 * 3);
    host.input.mouseDown("left");
    host.input.keyDown({ code: "Space", ctrl: true });
    await runFor(engine, host, 17 * 10);
    expect(presses).toBe(1);
    expect(host.input.isButtonDown("left")).toBe(true);
    expect(host.input.space).toBe(true);
    expect(host.input.ctrl).toBe(true);
    host.input.keyUp("Space", { ctrl: false });
    expect(host.input.space).toBe(false);
    expect(host.input.ctrl).toBe(false);
  });

  it("la position peut sortir de la zone de jeu", () => {
    const { host } = setup();
    host.input.moveMouse(-12.4, 500.6);
    expect([host.input.mouseX, host.input.mouseY]).toEqual([-12, 501]);
  });

  it("les clics arrivés avant la bascule ne touchent pas la scène qui arrive", async () => {
    const { host, engine } = setup();
    let seen = 0;
    engine.register(SceneId.title, () => new LogScene("t", [], (ctx, n) => n === 2 && ctx.scenes.request(SceneId.hub)));
    engine.register(SceneId.hub, () => new LogScene("h", [], (ctx) => void (seen += ctx.input.buttonEvents.length)));
    engine.start();
    await runFor(engine, host, 17 * 3);
    host.click(1, 1); // pendant que la demande est en attente
    await runFor(engine, host, 17 * 5);
    expect(engine.scenes.currentId).toBe(SceneId.hub);
    expect(seen).toBe(0);
  });
});

describe("MsvcRandom", () => {
  const draw = (seed: number, n: number, count: number, f: "rand" | "rand1" = "rand"): number[] => {
    const rng = new MsvcRandom(seed);
    return Array.from({ length: count }, () => rng[f](n));
  };

  it("vecteurs des docs", () => {
    expect(draw(0, 4, 8)).toEqual([3, 4, 1, 2, 3, 2, 0, 0]);
    expect(draw(0, 100, 8)).toEqual([38, 43, 72, 13, 11, 81, 83, 66]);
    expect(draw(0, 5, 8)).toEqual([2, 3, 0, 1, 1, 1, 1, 5]);
    expect(draw(1, 4, 8)).toEqual([1, 0, 4, 3, 2, 4, 3, 3]);
    expect(draw(1, 9, 5)).toEqual([1, 5, 4, 8, 7]);
    expect(draw(0, 4, 5, "rand1")).toEqual([2, 3, 2, 1, 3]);
  });

  it("premier état et premier rand(14)", () => {
    const rng = new MsvcRandom(0);
    rng.rand(14);
    expect(rng.current).toBe(0x269ec3);
    expect(new MsvcRandom(0).rand(14)).toBe(8);
  });

  it("rand(0) renvoie 0 sans avancer l'état ; range et below", () => {
    const rng = new MsvcRandom(7);
    const state = rng.current;
    expect(rng.rand(0)).toBe(0);
    expect(rng.rand1(1)).toBe(0);
    expect(rng.current).toBe(state);
    expect(new MsvcRandom(0).range(10, 20)).toBe(10 + new MsvcRandom(0).rand(10));
    expect(new MsvcRandom(0).below(4)).toBe(new MsvcRandom(0).rand(3));
  });

  it("garde les 16 bits hauts complets (pas de masque 0x7FFF)", () => {
    const rng = new MsvcRandom(0);
    let max = 0;
    for (let i = 0; i < 2000; i++) max = Math.max(max, rng.rand(65534));
    expect(max).toBeGreaterThan(0x7fff);
  });

  it("l'état se sauvegarde et se reprend", () => {
    const rng = new MsvcRandom(42);
    rng.rand(9);
    const saved = rng.current;
    const next = [rng.rand(99), rng.rand(99)];
    rng.seed(saved);
    expect([rng.rand(99), rng.rand(99)]).toEqual(next);
  });
});

describe("NoRepeatPool", () => {
  it("vecteurs des docs (graine 0)", () => {
    let rng = new MsvcRandom(0);
    let pool = new NoRepeatPool(3);
    expect(Array.from({ length: 7 }, () => pool.pick(rng))).toEqual([2, 0, 1, 1, 2, 0, 1]);
    rng = new MsvcRandom(0);
    pool = new NoRepeatPool(12);
    expect(Array.from({ length: 13 }, () => pool.pick(rng))).toEqual([2, 3, 6, 1, 7, 4, 5, 8, 9, 0, 10, 11, 10]);
  });

  it("aucune répétition avant d'avoir tout tiré, état partageable", () => {
    const rng = new MsvcRandom(99);
    const pool = new NoRepeatPool(19);
    const first = Array.from({ length: 19 }, () => pool.pick(rng));
    expect(new Set(first).size).toBe(19);
    expect(pool.state).toBe(2 ** 19 - 1);
    const copy = new NoRepeatPool(19);
    copy.state = pool.state;
    expect(copy.state).toBe(pool.state);
    pool.reset();
    expect(pool.state).toBe(0);
  });

  it("le masque initial exclut des valeurs ; un masque qui prend tout est une erreur", () => {
    const rng = new MsvcRandom(5);
    const pool = new NoRepeatPool(5, 0b00110);
    const picks = Array.from({ length: 3 }, () => pool.pick(rng));
    expect(picks.sort()).toEqual([0, 3, 4]);
    expect(() => new NoRepeatPool(2, 0b11).pick(rng)).toThrow();
    expect(() => new NoRepeatPool(33)).toThrow(RangeError);
  });
});

describe("Roster", () => {
  it("roster neuf : 222 384 octets, en-tête du modèle livré", () => {
    const roster = Roster.createEmpty();
    const bytes = roster.encode();
    expect(bytes).toHaveLength(222_384);
    expect(ROSTER_SIZE).toBe(41 * 5424);
    expect([...bytes.subarray(0, 12)]).toEqual([0, 0x20, 0, 0, 0, 0, 0x2a, 0x30, 0, 1, 0, 1]);
    expect(bytes.reduce((n, b) => n + (b ? 1 : 0), 0)).toBe(5); // seuls 5 octets non nuls, comme MWROSTER
    expect(roster.playerCount).toBe(0);
    expect(roster.bowlingTicks).toBe(10800);
    expect(roster.bowlingSeconds).toBe(180);
    expect(roster.clickAndStick).toBe(true);
    expect(roster.ambient).toBe(true);
  });

  it("aller-retour sur un roster synthétique complet", () => {
    const roster = Roster.createEmpty();
    const ana = roster.addPlayer("ana");
    const bob = roster.addPlayer("bob smith");
    expect(ana).toEqual({ ok: true, id: 1, name: "Ana" });
    expect(bob).toEqual({ ok: true, id: 2, name: "Bob Smith" });
    roster.setAchievement(1, 0, 0);
    roster.setAchievement(1, 5, BONUS_LEVEL);
    roster.setVar(2, "hubPolyIntroSeen", 1);
    roster.setVar(2, "bowlingStrikes", 9, 29);
    roster.setVar(2, "patfillColor", 14);
    roster.bytesOf(2, "patfillStainedGlass").set([1, 2, 3], 5259);
    roster.setBowlingSeconds(45);
    roster.clickAndStick = false;
    roster.ambient = false;

    const bytes = roster.encode();
    const copy = Roster.decode(bytes);
    expect(copy.encode()).toEqual(bytes);
    expect(copy.players().map((p) => p.name)).toEqual(["Ana", "Bob Smith"]);
    expect(copy.playerCount).toBe(2);
    expect(copy.hasAchievement(1, 5, BONUS_LEVEL)).toBe(true);
    expect(copy.getVar(2, "bowlingStrikes", 29)).toBe(9);
    expect(copy.getVar(2, "patfillColor")).toBe(14);
    expect([...copy.bytesOf(2, "patfillStainedGlass").subarray(5259, 5262)]).toEqual([1, 2, 3]);
    expect(copy.bowlingTicks).toBe(2700);
    expect(copy.clickAndStick).toBe(false);
    expect(copy.ambient).toBe(false);
    // decode copie : modifier la copie ne touche pas la source.
    copy.setVar(2, "patfillColor", 3);
    expect(bytes[2 * ROSTER_RECORD_SIZE + 5411]).toBe(14);
  });

  it("disposition binaire : entrée de 37 octets, masque petit-boutiste, variables gros-boutistes aux décalages documentés", () => {
    const roster = Roster.createEmpty();
    roster.addPlayer("Zed");
    roster.addPlayer("Amy");
    roster.setMask(2, 0x01020304);
    roster.setVar(2, "bowlingLevel", 0x1234, 5);
    roster.setVar(2, "rocketsHelpIntroSeen", 1);
    roster.setVar(2, "rhythmVariant", 3, 44);
    const bytes = roster.encode();
    const entry2 = 12 + 37;
    expect(bytes[entry2]).toBe(1);
    expect(String.fromCharCode(...bytes.subarray(entry2 + 1, entry2 + 4))).toBe("Amy");
    expect([...bytes.subarray(entry2 + 33, entry2 + 37)]).toEqual([4, 3, 2, 1]);
    const record = 2 * ROSTER_RECORD_SIZE;
    expect([...bytes.subarray(record + 14 + 10, record + 14 + 12)]).toEqual([0x12, 0x34]);
    expect([...bytes.subarray(record + 5420, record + 5422)]).toEqual([0, 1]);
    expect(bytes[record + 88 + 44]).toBe(3);
  });

  it("la table de variables est contiguë et tient dans 5422 octets", () => {
    const fields = Object.values(ROSTER_FIELDS).sort((a, b) => a.offset - b.offset);
    let end = 0;
    for (const f of fields) {
      expect(f.offset).toBe(end);
      end = f.offset + f.count * (f.kind === "u16" ? 2 : 1);
    }
    expect(end).toBe(5422);
    expect(() => Roster.createEmpty().getVar(1, "bowlingLevel", 6)).toThrow(RangeError);
    expect(() => Roster.createEmpty().bytesOf(1, "bowlingLevel" satisfies RosterFieldName)).toThrow(TypeError);
  });

  it("masque et rang : bit 5 × opération + niveau, rang 1 + niveaux 0 à 3 (bonus exclu), 1 à 25", () => {
    const roster = Roster.createEmpty();
    roster.addPlayer("A");
    expect(roster.grade(1)).toBe(1);
    roster.setAchievement(1, 2, 3);
    expect(roster.getMask(1)).toBe(1 << 13);
    expect(roster.hasAchievement(1, 2, 3)).toBe(true);
    expect(roster.hasAchievement(1, 2, 2)).toBe(false);
    roster.setAchievement(1, 0, BONUS_LEVEL);
    expect(roster.grade(1)).toBe(2);
    expect(gradeOfMask(0)).toBe(1);
    let all = 0;
    for (let op = 0; op < 6; op++) for (let level = 0; level < 4; level++) all |= 1 << (5 * op + level);
    expect(gradeOfMask(all >>> 0)).toBe(25);
    expect(gradeOfMask(0x3fffffff)).toBe(25);
    roster.setAchievement(1, 5, 4);
    expect(roster.getMask(1)).toBeGreaterThan(0);
    expect(() => roster.setAchievement(1, 6, 0)).toThrow(RangeError);
    expect(() => roster.setAchievement(1, 0, 5)).toThrow(RangeError);
  });

  it("règles de nom : mise en forme, caractères, longueur, doublons sensibles à la casse", () => {
    expect(formatPlayerName("jean luc  pierre")).toBe("Jean Luc  Pierre");
    expect(formatPlayerName("3d max")).toBe("3d Max");
    expect(formatPlayerName("a.b")).toBe("A.b");
    expect(isValidPlayerName("A".repeat(28))).toBe(true);
    expect(isValidPlayerName("A".repeat(29))).toBe(false);
    expect(isValidPlayerName(" Ana")).toBe(false);
    expect(isValidPlayerName(".Ana")).toBe(false);
    expect(isValidPlayerName("Zoé")).toBe(false);
    expect(isValidPlayerName("A-B")).toBe(false);
    expect(isValidPlayerName("")).toBe(false);
    expect(canAppendNameChar("", " ")).toBe(false);
    expect(canAppendNameChar("", "7")).toBe(true);
    expect(canAppendNameChar("A", ".")).toBe(true);
    expect(canAppendNameChar("A", "-")).toBe(false);
    expect(canAppendNameChar("A".repeat(28), "b")).toBe(false);
    expect(canAppendNameChar("Abc", "d", (t) => t.length < 4)).toBe(false);

    const roster = Roster.createEmpty();
    expect(roster.addPlayer("")).toEqual({ ok: false, reason: "empty" });
    expect(roster.addPlayer("é")).toEqual({ ok: false, reason: "invalid" });
    expect(roster.addPlayer("ana").ok).toBe(true);
    expect(roster.addPlayer("ana")).toEqual({ ok: false, reason: "duplicate" });
    expect(roster.addPlayer("ANA")).toEqual({ ok: true, id: 2, name: "ANA" }); // strcmp exact sur le nom mis en forme
    expect(roster.playerCount).toBe(2);
  });

  it("40 joueurs au plus ; un emplacement libéré est réutilisé ; supprimer efface tout", () => {
    const roster = Roster.createEmpty();
    for (let i = 1; i <= MAX_PLAYERS; i++) expect(roster.addPlayer(`P${i}`)).toMatchObject({ ok: true, id: i });
    expect(roster.addPlayer("Extra")).toEqual({ ok: false, reason: "full" });
    expect(roster.playerCount).toBe(40);
    roster.setAchievement(7, 1, 1);
    roster.setVar(7, "hubPolyIntroSeen", 1);
    expect(roster.removePlayer(7)).toBe(true);
    expect(roster.removePlayer(7)).toBe(false);
    expect(roster.playerCount).toBe(39);
    expect(roster.getPlayer(7)).toBeUndefined();
    expect(roster.addPlayer("Neuf")).toEqual({ ok: true, id: 7, name: "Neuf" });
    expect(roster.getMask(7)).toBe(0);
    expect(roster.getVar(7, "hubPolyIntroSeen")).toBe(0);
    expect(() => roster.getMask(0)).toThrow(RangeError);
    expect(() => roster.getMask(41)).toThrow(RangeError);
  });

  it("liste alphabétique, renommage avec les mêmes règles", () => {
    const roster = Roster.createEmpty();
    roster.addPlayer("Zoe");
    roster.addPlayer("amy");
    roster.addPlayer("Bob");
    expect(roster.players().map((p) => p.name)).toEqual(["Amy", "Bob", "Zoe"]);
    expect(roster.renamePlayer(1, "Zoe")).toEqual({ ok: true, name: "Zoe" });
    expect(roster.renamePlayer(1, "bob")).toEqual({ ok: false, reason: "duplicate" });
    expect(roster.renamePlayer(1, "")).toEqual({ ok: false, reason: "empty" });
    expect(roster.renamePlayer(9, "X")).toEqual({ ok: false, reason: "unknown" });
    expect(roster.renamePlayer(1, "yann")).toEqual({ ok: true, name: "Yann" });
  });

  it("timer du Bowling : 1 à 999 s seulement", () => {
    const roster = Roster.createEmpty();
    expect(roster.setBowlingSeconds(0)).toBe(false);
    expect(roster.setBowlingSeconds(1000)).toBe(false);
    expect(roster.setBowlingSeconds(999)).toBe(true);
    expect(roster.bowlingTicks).toBe(59940);
    expect(roster.setBowlingSeconds(1)).toBe(true);
    expect(roster.bowlingTicks).toBe(60);
  });

  it("decode refuse une mauvaise taille ou une mauvaise version", () => {
    expect(() => Roster.decode(new Uint8Array(10))).toThrow(RosterFormatError);
    const old = Roster.createEmpty().encode();
    old[1] = 0x10;
    expect(() => Roster.decode(old)).toThrow(/version/);
  });

  it("RosterStore : base64 dans HostStorage, statuts missing / ok / invalid", () => {
    const { host } = setup();
    const store = new RosterStore(host.storage);
    expect(store.load().status).toBe("missing");
    const roster = Roster.createEmpty();
    roster.addPlayer("Lea");
    roster.setVar(1, "patfillColor", 9);
    expect(store.save(roster)).toBe(true);
    const text = host.storage.get(ROSTER_STORAGE_KEY)!;
    expect(ROSTER_STORAGE_KEY).toBe("retrovibe:mathemagique:roster");
    expect(Buffer.from(text, "base64")).toHaveLength(ROSTER_SIZE);
    const loaded = store.load();
    expect(loaded.status).toBe("ok");
    expect(loaded.roster.encode()).toEqual(roster.encode());
    host.storage.set(ROSTER_STORAGE_KEY, "pas du base64 !!");
    const bad = store.load();
    expect(bad.status).toBe("invalid");
    expect(bad.roster.playerCount).toBe(0);
    expect(host.storage.get(ROSTER_STORAGE_KEY)).toBe("pas du base64 !!"); // pas écrasé tant qu'on ne sauvegarde pas
    store.clear();
    expect(store.load().status).toBe("missing");
  });

  it("le contexte du moteur charge le roster enregistré et le sauvegarde", () => {
    const host = new TestHost();
    const first = new Engine(host, { seed: 0 });
    const added = first.ctx.roster.roster.addPlayer("Ana");
    expect(added.ok).toBe(true);
    first.ctx.roster.currentPlayerId = 1;
    expect(first.ctx.roster.currentPlayer?.name).toBe("Ana");
    expect(first.ctx.roster.save()).toBe(true);
    const second = new Engine(host, { seed: 0 });
    expect(second.ctx.roster.loadStatus).toBe("ok");
    expect(second.ctx.roster.roster.players().map((p) => p.name)).toEqual(["Ana"]);
  });
});

describe("Resources (archives synthétiques)", () => {
  it("ouvre sans tenir compte de la casse, mémorise, et libère les archives de la scène quand elle quitte", async () => {
    const { host, engine } = setup();
    host.virtualFiles.set("a.dat", tinyArchive());
    host.virtualFiles.set("shared.dat", tinyArchive());
    host.virtualFiles.set("b.dat", tinyArchive());
    const names = () => engine.ctx.resources.openNames.sort();
    engine.register(SceneId.hub, () =>
      new LogScene("hub", [], (ctx, n) => n === 1 && ctx.scenes.request(SceneId.bowling), async (ctx) => {
        await ctx.resources.open("A.DAT");
        await ctx.resources.open("Shared.dat");
      }),
    );
    engine.register(SceneId.bowling, () =>
      new LogScene("bowling", [], undefined, async (ctx) => {
        await ctx.resources.open("B.DAT");
        await ctx.resources.open("SHARED.DAT"); // gardée : la nouvelle scène s'en sert aussi
      }),
    );
    engine.start(SceneId.hub);
    await runUntil(engine, host, () => engine.scenes.currentId === SceneId.hub);
    expect(names()).toEqual(["a.dat", "shared.dat"]);
    const archive = engine.ctx.resources.require("a.dat");
    expect(archive.has("TEST", 7)).toBe(true);
    expect(await engine.ctx.resources.open("a.DAT")).toBe(archive);
    expect(host.loaded.filter((p) => p.toLowerCase() === "a.dat")).toHaveLength(1);
    await runUntil(engine, host, () => engine.scenes.currentId === SceneId.bowling);
    expect(names()).toEqual(["b.dat", "shared.dat"]);
    expect(engine.ctx.resources.get("a.dat")).toBeUndefined();
    expect(() => engine.ctx.resources.require("a.dat")).toThrow(/open/);
  });

  it("une archive persistante survit aux scènes ; un échec d'ouverture n'est pas gardé", async () => {
    const { host, engine } = setup();
    host.virtualFiles.set("sys.dat", tinyArchive());
    const resources = engine.ctx.resources;
    await resources.open("SYS.DAT", "persistent");
    resources.beginSceneLoad();
    resources.commitScene();
    expect(resources.get("sys.dat")).toBeDefined();
    await expect(resources.open("manque.dat")).rejects.toThrow(/introuvable/);
    expect(resources.openNames).toEqual(["sys.dat"]);
    host.virtualFiles.set("manque.dat", tinyArchive());
    await expect(resources.open("manque.dat")).resolves.toBeDefined();
    resources.release("manque.dat");
    expect(resources.get("manque.dat")).toBeUndefined();
  });
});

describe.skipIf(!hasOriginalFiles)("Resources (fichiers du jeu)", () => {
  it("ouvre BOWLING.DAT (nom en casse mixte), décode et mémorise SHPL / SHAP / STRL / SCR", async () => {
    const { host, engine } = setup();
    const resources = engine.ctx.resources;
    const bowling = await resources.open("Bowling.dat");
    expect(bowling.ids("SHPL")).toContain(101);
    const shpl = bowling.shpl(101);
    expect(shpl.firstShapeId).toBe(101);
    expect(bowling.shpl(101)).toBe(shpl);
    const background = bowling.shap(101);
    expect(background).toMatchObject({ width: 576, height: 432 });
    expect(bowling.shap(101)).toBe(background);
    expect(bowling.strl(5000)).toHaveLength(25);
    expect(bowling.strl(5000)[0]).toMatch(/\w/);
    const scrId = bowling.ids("\0SCR")[0]!;
    expect(bowling.scr(scrId).frames.length).toBeGreaterThan(0);
    expect(() => bowling.shap(999999)).toThrow(/introuvable/);
    expect(host.loaded).toEqual(["Bowling.dat"]);
  });

  it("MILKYWAY.DAT (archive système, persistante) : curseurs et MIDI de transition", async () => {
    const { engine } = setup();
    const sys = await engine.ctx.resources.open("milkyway.dat", "persistent");
    expect(sys.has("CURS", 1)).toBe(true);
    expect(sys.has("\0SND", 65000)).toBe(true);
    expect(sys.midi(65000).smf.length).toBeGreaterThan(14);
    expect(() => sys.wave(65000)).toThrow(/WAVE/);
    expect(sys.sndBytes(65000).length).toBeGreaterThan(0);
  });

  it("une scène qui ouvre son DAT dans load : chargé avant l'enter, libéré au départ", async () => {
    const { host, engine } = setup();
    const log: string[] = [];
    engine.register(SceneId.title, () =>
      new LogScene("title", log, (ctx, n) => n === 1 && ctx.scenes.request(SceneId.credits), async (ctx) => {
        await ctx.resources.open("TITLE.DAT");
      }),
    );
    engine.register(SceneId.credits, () =>
      new LogScene("credits", log, undefined, async (ctx) => {
        await ctx.resources.open("credits.dat");
      }),
    );
    engine.start();
    await runUntil(engine, host, () => engine.scenes.currentId === SceneId.credits);
    expect(engine.ctx.resources.openNames).toEqual(["credits.dat"]);
    expect(host.loaded).toEqual(["TITLE.DAT", "credits.dat"]);
    expect(log.indexOf("title.leave")).toBeLessThan(log.indexOf("credits.enter"));
  });
});
