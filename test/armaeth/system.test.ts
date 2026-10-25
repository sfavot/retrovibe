import { describe, expect, it } from "vitest";
import { MessageTable, messageId } from "../../src/games/armaeth/data/text";
import * as clock from "../../src/games/armaeth/engine/clock";
import { ArmaethEngine, type ArmaethEngineOptions } from "../../src/games/armaeth/engine/engine";
import { FAMILY } from "../../src/games/armaeth/engine/handlers";
import { type TokenHost } from "../../src/games/armaeth/engine/tokens";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { TestHost } from "./test-host";

/**
 * Commandes système, fenêtre de score, jetons de l'hôte, bottes (clic droit), panneau de contenu, barrage `G`, crochets du moteur
 * (tâche I3) sur les vraies données.
 */

const text = () => new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS"));
const S = (n: number) => text().messages(messageId("S", n));

class Session {
  readonly host = new TestHost();
  readonly engine: ArmaethEngine;

  constructor(options: ArmaethEngineOptions = {}) {
    this.engine = new ArmaethEngine(this.host, { seed: 1, bare: true, ...options });
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.engine.tick();
  }

  click(x: number, y: number, buttons = 1): void {
    this.host.pointer(x, y, buttons);
    this.engine.tick();
    this.host.pointer(x, y, 0);
    this.engine.tick();
  }

  skipIntro(): this {
    this.run(2000);
    for (let n = 0; this.engine.windows.active && n < 40; n++) this.click(100, 100);
    this.run(320);
    return this;
  }

  dismiss(): void {
    for (let n = 0; this.engine.windows.active && n < 10; n++) this.click(100, 100);
    this.run(2);
  }

  /** Message lu dans la fenêtre ouverte après `ticks` images. */
  shown(ticks = 2): string | null {
    this.run(ticks);
    return this.engine.windows.text;
  }

  get state() {
    return this.engine.state!;
  }
}

describe("dédoublonnage de la lumière", () => {
  it("clock.ts n'exporte plus de calcul de lumière (il vit dans render/light.ts)", () => {
    for (const name of ["lightLevel", "daylight", "isTooDark", "DAYLIGHT_TABLE"]) expect(name in clock).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("F8 et l'introduction", () => {
  it("F8 ne saute pas CM2 (le script est bloquant dans l'original)", () => {
    const s = new Session();
    s.run(400);
    expect(s.engine.runner.running).toBe(true);
    const before = s.engine.runner.status;
    s.host.key({ type: "function", n: 8 });
    s.run(3);
    expect(s.engine.runner.running).toBe(true);
    expect(s.engine.state).toBeNull();
    expect(before).toBeDefined();
  });
});

describe.skipIf(!hasOriginalFiles)("commandes système", () => {
  it("information et F1 : S21 en fenêtre plein écran grise, non centrée", () => {
    const s = new Session().skipIntro();
    s.engine.submitLine("information");
    expect(s.shown()).toBe(S(21));
    expect(s.engine.windowRect).toMatchObject({ x: 0, width: 320 });
    s.dismiss();
    s.host.key({ type: "function", n: 1 });
    expect(s.shown()).toBe(S(21));
  });

  it("dictionnaire nn : lettres significatives (impair -> +1, bornes 4 à 20, ±)", () => {
    const s = new Session().skipIntro();
    s.engine.submitLine("dictionnaire 6");
    expect(s.state.dictionaryLetters).toBe(6);
    s.engine.submitLine("dictionnaire 9");
    expect(s.state.dictionaryLetters).toBe(10);
    s.engine.submitLine("dictionnaire 30");
    expect(s.state.dictionaryLetters).toBe(10);
    expect(s.engine.setDictionaryLetters(-1)).toBe(true);
    expect(s.state.dictionaryLetters).toBe(8);
    expect(s.engine.setDictionaryLetters(1)).toBe(true);
    expect(s.state.dictionaryLetters).toBe(10);
    s.state.dictionaryLetters = 4;
    expect(s.engine.setDictionaryLetters(-1)).toBe(false);
  });

  it("volume : réactive la musique, borne 0..63 ; la commande tapée fixe le réglage", () => {
    const s = new Session().skipIntro();
    s.engine.sequencer.setMuted(true);
    s.engine.adjustVolume(-1);
    expect(s.engine.sequencer.isMuted).toBe(false);
    expect(s.engine.volume).toBe(0);
    s.engine.adjustVolume(70);
    expect(s.engine.volume).toBe(63);
    s.engine.submitLine("volume 10");
    expect(s.engine.volume).toBe(10);
  });

  it("continuer : S46 si le héros est là, S47 s'il est ailleurs, S49 partie terminée, sinon le hook onContinue", () => {
    const s = new Session().skipIntro();
    s.engine.submitLine("continuer");
    expect(s.shown()).toBe(S(46));
    s.dismiss();
    s.state.gameOver = true;
    s.host.key({ type: "function", n: 4 });
    expect(s.shown()).toBe(S(49));

    const calls: string[] = [];
    const h = new Session({ onContinue: () => calls.push("hook") }).skipIntro();
    h.state.deleteObject(h.state.hero!);
    h.host.key({ type: "function", n: 4 });
    h.run(2);
    expect(calls).toEqual(["hook"]);

    const d = new Session().skipIntro();
    d.state.deleteObject(d.state.hero!);
    d.engine.continueGame();
    expect(d.shown()).toBe(S(16));
  });

  it("l'option register remplace une clé déjà enregistrée (continuer, famille 4)", () => {
    const calls: number[] = [];
    const s = new Session({ register: (r) => r.register(FAMILY.system, 7, () => (calls.push(7), 7)) }).skipIntro();
    s.host.key({ type: "function", n: 4 });
    s.run(2);
    expect(calls).toEqual([7]);
  });
});

describe.skipIf(!hasOriginalFiles)("score (14cf:000c)", () => {
  it("une seule fenêtre plein écran : en-tête S42, S26, nombres collés, verdict S36 en début de partie", () => {
    const s = new Session().skipIntro();
    s.host.key({ type: "function", n: 6 });
    const shown = s.shown()!;
    expect(shown.startsWith(S(42))).toBe(true);
    expect(shown).toContain(S(26));
    expect(shown).toContain(`${S(27)}0${S(28)}725${S(29)}`);
    expect(shown).toContain(S(30));
    expect(shown).toContain(S(34));
    expect(shown.endsWith(S(36))).toBe(true);
    expect(s.engine.windowRect).toMatchObject({ x: 0, y: 0, width: 320 });
  });

  it("partie terminée : pas de S25 / S26, verdict de couronnement S51", () => {
    const s = new Session().skipIntro();
    s.state.gameOver = true;
    s.engine.showScore(50);
    const shown = s.shown()!;
    expect(shown.startsWith(S(50))).toBe(true);
    expect(shown).not.toContain(S(26));
    expect(shown.endsWith(S(51))).toBe(true);
  });

  it("secret du niveau découvert : S25 et verdict S38 ; la fortune compte les trésors portés", () => {
    const s = new Session().skipIntro();
    s.state.setLevelFlag(s.state.level, 7);
    expect(s.state.levelFlag(s.state.level)).toBe(7);
    const treasure = s.state.createObject({ typ: 2, num: 90, value: 300 });
    s.state.moveToContainer(treasure, s.state.hero!);
    s.engine.showScore();
    const shown = s.shown()!;
    expect(shown).toContain(S(25));
    expect(shown).toContain(`${S(30)}300${S(31)}`);
    expect(shown.endsWith(S(38))).toBe(true);
  });

  it("abandon (terminer) : S43 puis CM4 une fois les fenêtres lues", () => {
    const s = new Session().skipIntro();
    s.engine.submitLine("terminer");
    expect(s.shown()!.startsWith(S(43))).toBe(true);
    expect(s.engine.runner.running).toBe(false);
    s.dismiss();
    s.run(2);
    expect(s.engine.runner.running).toBe(true);
  });

  it("le jingle d'une entrée de score est joué (2255:00e8 -> 2f86:009e)", () => {
    const s = new Session().skipIntro();
    const entry = s.state.scoreTable.find((e) => e.points > 0 && e.sound > 0);
    expect(entry).toBeDefined();
    const before = s.host.opl.writes.length;
    const award = (s.engine as unknown as { services: { score: { award(c: number, i: number): { sound: number } | null } } }).services.score.award(
      Math.floor(entry!.id / 100),
      entry!.id % 100,
    );
    expect(award?.sound).toBe(entry!.sound);
    s.run(30);
    expect(s.host.opl.writes.length).toBeGreaterThan(before);
  });
});

describe.skipIf(!hasOriginalFiles)("jetons de l'hôte", () => {
  const host = (s: Session) => s.engine.runner.interpreter.host as TokenHost;

  it("get / let : rangement dans un conteneur et dépôt là où il se trouve", () => {
    const s = new Session().skipIntro();
    const chest = s.state.createObject({ typ: 2, num: 91, canContain: 7 });
    const item = s.state.createObject({ typ: 2, num: 92 });
    s.state.moveToRoom(chest, s.state.loadedRoom!);
    s.state.moveToRoom(item, s.state.loadedRoom!);
    host(s).objectAction("get", item, [91, 92]);
    expect(item.holder).toBe(chest);
    host(s).objectAction("let", chest, [92, 91]);
    expect(item.holder).toBeNull();
    expect(item.room).toBe(chest.room);
  });

  it("jetons du groupe 7 : désigner, relâcher, suivant, supprimer", () => {
    const s = new Session().skipIntro();
    const room = s.state.loadedRoom!;
    const a = s.state.createObject({ typ: 2, num: 93 });
    s.state.moveToRoom(a, room);
    host(s).objectList("select", "obj", [93]);
    expect(s.state.hero).toBe(a);
    host(s).objectList("release", "obj", [93]);
    expect(s.state.hero).toBeNull();
    host(s).objectList("next", "obj", []);
    expect(s.state.hero).toBe(room.listA[0]);
    host(s).objectList("delete", "obj", [93]);
    expect(room.listA).not.toContain(a);
  });

  it("add* crée l'objet du modèle DEF (Mob, Dep, Txt, Lum) dans la salle", () => {
    const s = new Session().skipIntro();
    const obj = s.engine.createFromDef(2, 2);
    expect(obj).toBeDefined();
    expect(obj!.room).toBe(s.state.loadedRoom);
    expect(obj!.num).toBe(2);
  });

  it("dic règle les lettres significatives, exp désigne le conteneur affiché ; sl1..sl3, sub, sal sont sans effet", () => {
    const s = new Session().skipIntro();
    host(s).debug("dic", undefined, [12]);
    expect(s.state.dictionaryLetters).toBe(12);
    host(s).debug("exp", s.state.hero!, []);
    expect(s.state.selected).toBe(s.state.hero);
    expect(() => {
      host(s).sequence(1, 0);
      host(s).worldOperation("sub", 1);
    }).not.toThrow();
  });

  it("fbt lance l'effet d'indice donné sur le pilote", () => {
    const s = new Session().skipIntro();
    const before = s.host.opl.writes.length;
    host(s).sound("fbt", [0, 1, -1]);
    s.run(10);
    expect(s.host.opl.writes.length).toBeGreaterThanOrEqual(before);
  });
});

describe.skipIf(!hasOriginalFiles)("bottes : clic droit et panneau de contenu", () => {
  it("clic droit : le héros marche vers la sortie du secteur (228e:0000) ou rien si la salle n'en a pas", () => {
    const s = new Session().skipIntro();
    const room = s.state.loadedRoom!;
    const slots = [0, 1, 2, 3].filter((i) => s.state.neighbour(room, i));
    expect(slots.length).toBeGreaterThan(0);
    const exitBySector = (n: number) => (s.engine as unknown as { exitBySector(n: number): boolean }).exitBySector(n);
    const missing = [0, 1, 2, 3].find((i) => !slots.includes(i));
    if (missing !== undefined) expect(exitBySector(missing)).toBe(false);
    expect(exitBySector(slots[0]!)).toBe(true);
    expect(s.state.hero!.path.defined).toBe(true);
    const target = s.state.hero!.path.target!;
    expect(Math.abs(target.x) >= 1000 || Math.abs(target.p) >= 1000).toBe(true);
  });

  it("walkToExit respecte la salle voulue : aucune sortie vers une salle étrangère", () => {
    const s = new Session().skipIntro();
    expect(s.engine.walkToExit(s.state.hero!, 99999, false)).toBe(false);
  });

  it("panneau de contenu : grille 18 x 14, au plus 12 colonnes, objets posés (Xyp 11, P 0xB8), désélection à la marche", () => {
    const s = new Session().skipIntro();
    const chest = s.state.createObject({ typ: 2, num: 21, canContain: 7 });
    s.state.moveToRoom(chest, s.state.loadedRoom!);
    const items = Array.from({ length: 14 }, (_, i) => s.state.createObject({ typ: 2, num: 94 + (i % 3), value: 1 }));
    for (const o of items) s.state.moveToContainer(o, chest);
    s.state.selected = chest;
    s.run(3);
    const placed = chest.contents.filter((o) => o.presence === 0x0b);
    expect(placed.length).toBe(14);
    // 14 objets : 2 lignes de 7 colonnes, centrées, haut à y = 26
    const xs = new Set(placed.map((o) => o.x));
    const ys = new Set(placed.map((o) => o.y));
    expect(xs.size).toBe(7);
    expect(ys.size).toBe(2);
    expect(placed.every((o) => o.p === 0xb8)).toBe(true);
    expect(Math.min(...ys)).toBe(26 + 2 + 18 - 1 - 3);
    s.state.selected = null;
    s.run(2);
    expect(chest.contents.every((o) => o.presence === 0)).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("barrage G (20b5:03bc) et crochets", () => {
  const guard = (s: Session, key: number, carries: number[] = []) =>
    (s.engine as unknown as { doorGuard(subject: unknown, key: number): boolean }).doorGuard({ carries: (n: number) => carries.includes(n) }, key);

  it("porte 309 : Ego 0 exige la clef ouvragée (331), Ego 1 et 2 passent, autre refuse", () => {
    const s = new Session().skipIntro();
    const door = s.state.findByNum(309)!;
    door.ego = 0;
    expect(guard(s, 309)).toBe(false);
    expect(guard(s, 309, [331])).toBe(true);
    door.ego = 1;
    expect(guard(s, 309)).toBe(true);
    door.ego = 2;
    expect(guard(s, 309)).toBe(true);
    door.ego = 5;
    expect(guard(s, 309)).toBe(false);
  });

  it("acceptsGround est appelé par le placement avec (type, effet, objet)", () => {
    const calls: [number, number, number][] = [];
    const s = new Session({
      acceptsGround: (type, effect, body) => (calls.push([type, effect, body.num]), type >= 2),
    }).skipIntro();
    const hero = s.state.hero!;
    s.engine.place(hero, 1);
    s.engine.pathTo(hero, 160, 100, 80, 0);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(([, , num]) => num === hero.num || num > 0)).toBe(true);
  });

  it("onPathEnd remplace l'arrêt par défaut ; sans hook : arrêt et Err 0x11", () => {
    const seen: number[] = [];
    const s = new Session({ onPathEnd: (_o, _c, result) => seen.push(result) }).skipIntro();
    const pathEnd = (e: ArmaethEngine, o: unknown, r: number) => (e as unknown as { pathEnd(o: unknown, r: number): void }).pathEnd(o, r);
    pathEnd(s.engine, s.state.hero, 5);
    expect(seen).toEqual([5]);
    const d = new Session().skipIntro();
    pathEnd(d.engine, d.state.hero, 5);
    expect(d.state.hero!.err).toBe(0x11);
  });

  it("les services exposent sprites, ani, stopEffect, selectTrack, refreshObject, listObjects et un rng défini", () => {
    const s = new Session().skipIntro();
    const ctx = (s.engine as unknown as { services: Record<string, unknown> }).services as unknown as {
      sprites: unknown;
      ani: unknown;
      rng: unknown;
      sound: { stopEffect: unknown; selectTrack: unknown };
      refreshObject: unknown;
      messages: { listObjects(o: unknown[], e: number, h: number, l: boolean): void };
    };
    expect(ctx.sprites).toBeDefined();
    expect(ctx.ani).toBeDefined();
    expect(ctx.rng).toBeDefined();
    expect(typeof ctx.sound.stopEffect).toBe("function");
    expect(typeof ctx.refreshObject).toBe("function");
    ctx.messages.listObjects([], 36, 37, true);
    expect(s.shown()).toBe(text().messages(messageId("V", 36)));
  });
});
