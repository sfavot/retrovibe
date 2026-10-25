import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { encodePng } from "../../scripts/lib/png.mjs";
import { readRecolorTables } from "../../src/games/armaeth/data/palette";
import { readScene } from "../../src/games/armaeth/data/scene";
import { MessageTable, messageId } from "../../src/games/armaeth/data/text";
import { readSceneArchive } from "../../src/games/armaeth/data/vga-archive";
import { currentFrame } from "../../src/games/armaeth/engine/animation";
import { ArmaethEngine, DEFAULT_SAVE_SLOT } from "../../src/games/armaeth/engine/engine";
import { EventOp } from "../../src/games/armaeth/engine/events";
import { groundHeight } from "../../src/games/armaeth/engine/ground";
import { FAMILY, HandlerRegistry, defaultVerb } from "../../src/games/armaeth/engine/handlers";
import { parseCommand } from "../../src/games/armaeth/engine/parser";
import { loadWorldState } from "../../src/games/armaeth/engine/save";
import { layoutWindow, wrapText } from "../../src/games/armaeth/engine/windows";
import { parseDictionary } from "../../src/games/armaeth/data/dictionary";
import { parseGph } from "../../src/games/armaeth/data/font";
import { parseAccentTable, parsePlainMessages } from "../../src/games/armaeth/data/text";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { TestHost } from "./test-host";

/**
 * Moteur d'*Armaeth* sans navigateur, sur les vraies données : démarrage (`CM1`, titre, distribution, récit), écran de jeu,
 * marche, bottes, saisie, score, sauvegarde. Les images clés sont écrites en PNG dans `ARMAETH_PNG_DIR` si la variable existe.
 */

const PNG_DIR = process.env.ARMAETH_PNG_DIR;

function snapshot(host: TestHost, name: string, scale = 1): void {
  if (!PNG_DIR || !host.lastFrame) return;
  mkdirSync(PNG_DIR, { recursive: true });
  const { pixels, palette } = host.lastFrame;
  const out = new Uint8Array(320 * scale * 200 * scale);
  for (let y = 0; y < 200 * scale; y++) for (let x = 0; x < 320 * scale; x++) out[y * 320 * scale + x] = pixels[Math.floor(y / scale) * 320 + Math.floor(x / scale)];
  writeFileSync(join(PNG_DIR, `${name}.png`), encodePng(320 * scale, 200 * scale, { indexed: out, palette }));
}

const messages = () => new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS"));

/** Fraction des pixels de l'image de la scène retrouvés à l'écran. */
function sceneMatch(host: TestHost, sceneId: number): number {
  const file = `A1F${String(Math.floor(sceneId / 100)).padStart(2, "0")}${String.fromCharCode(65 + Math.floor((sceneId % 100) / 5))}.VGA`;
  const recolorType1 = readRecolorTables(readOriginal("AM1.EXE")).type1;
  const scene = readScene(readSceneArchive(readOriginal(file)).bytes(sceneId), { recolorType1 });
  const image = scene.layers.find((l) => l.type !== 0)!;
  const screen = host.lastFrame!.pixels;
  let same = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (screen[(image.y + y) * 320 + image.x + x] === image.pixels[y * image.width + x]) same++;
  return same / (image.width * image.height);
}

class Session {
  readonly host = new TestHost();
  readonly engine = new ArmaethEngine(this.host, { seed: 1, bare: true });

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.engine.tick();
  }

  /** Un clic : appui puis relâchement sur deux images. */
  click(x: number, y: number, buttons = 1): void {
    this.host.pointer(x, y, buttons);
    this.engine.tick();
    this.host.pointer(x, y, 0);
    this.engine.tick();
  }

  /** Passe les écrans du démarrage jusqu'à l'écran de jeu ; rend le nombre de clics donnés au récit. */
  skipIntro(): number {
    this.run(2000);
    const clicks = this.clickThroughWindows();
    this.run(300); // `wat 40` après le dernier paragraphe, puis `rsv -1`
    this.run(20);
    return clicks;
  }

  /** Clique tant qu'une fenêtre est ouverte ; rend le nombre de clics. */
  clickThroughWindows(): number {
    let clicks = 0;
    while (this.engine.windows.active && clicks < 40) {
      this.click(100, 100);
      clicks++;
    }
    return clicks;
  }

  get hero() {
    return this.engine.state!.hero!;
  }
}

describe.skipIf(!hasOriginalFiles)("moteur : démarrage et écran de jeu (fichiers du jeu)", () => {
  let s: Session;
  beforeAll(() => {
    s = new Session();
  });

  it("CM1 puis le titre : la scène 21 est présentée et la musique M1 démarre", () => {
    s.run(5);
    expect(s.engine.state).toBeNull();
    expect(s.engine.runner.running).toBe(true);
    expect(s.engine.shownScene).toBe(21);
    expect(sceneMatch(s.host, 21)).toBeGreaterThan(0.99);
    expect(s.engine.sequencer.isMusicPlaying()).toBe(true);
    expect(s.host.opl.writes.length).toBeGreaterThan(0);
    snapshot(s.host, "01-title");
  });

  it("la distribution suit après 80 tics BIOS : la scène 20", () => {
    s.run(205); // 80 tics BIOS à 18,2 Hz = 220 images à 50 Hz
    expect(s.engine.shownScene).toBe(21);
    s.run(20);
    expect(s.engine.shownScene).toBe(20);
    expect(sceneMatch(s.host, 20)).toBeGreaterThan(0.95);
    snapshot(s.host, "02-cast");
  });

  it("le récit s'affiche en fenêtres sur la scène 20 ; chaque clic passe une page", () => {
    s.run(165);
    expect(s.engine.windows.active).toBe(true);
    expect(s.engine.windowRect).toMatchObject({ x: 62, y: 66, width: 196 });
    expect(s.engine.windows.text).toMatch(/^Il y a longtemps/);
    snapshot(s.host, "03-intro", 2);
    const clicks = s.clickThroughWindows();
    expect(clicks).toBeGreaterThanOrEqual(10);
    expect(clicks).toBeLessThan(20);
    expect(s.engine.windows.active).toBe(false);
    expect(s.engine.state).toBeNull(); // `wat 40` sur la scène 20 seule
    s.run(300);
    expect(s.engine.runner.running).toBe(false);
    expect(s.engine.state).not.toBeNull();
    s.run(20);
  });

  it("le clic qui ouvre une fenêtre ne la ferme pas : il faut relâcher le bouton", () => {
    const t = new Session();
    t.run(400);
    expect(t.engine.windows.active).toBe(true);
    t.host.pointer(100, 100, 1);
    t.run(3);
    t.host.pointer(100, 100, 0);
    t.run(2);
    const text = t.engine.windows.text;
    t.host.pointer(100, 100, 1);
    t.run(3);
    expect(t.engine.windows.text).not.toBe(text);
  });

  it("écran de jeu : la salle de départ, le héros à sa place, le cadre intact", () => {
    const e = s.engine;
    expect(e.state!.loadedRoom!.id).toBe(1);
    expect(e.currentScene!.header).toMatchObject({ x: 0, y: 10, width: 320, height: 180 });
    expect(s.hero).toMatchObject({ num: 1, x: 219, y: 146, p: 113 });
    // le héros est dessiné : ses pixels opaques sont à l'écran
    const frame = currentFrame(s.hero, e.sprites)!;
    const left = s.hero.x - (frame.width >> 1);
    const top = s.hero.y + e.currentScene!.header.y - frame.height + 1;
    let drawn = 0;
    let opaque = 0;
    for (let y = 0; y < frame.height; y++)
      for (let x = 0; x < frame.width; x++) {
        const v = frame.pixels[y * frame.width + x];
        if (v === 0xff) continue;
        opaque++;
        const at = (top + y) * 320 + left + (s.hero.anim.mirror ? frame.width - 1 - x : x) + e.currentScene!.header.x;
        if (e.screen[at] === v) drawn++;
      }
    expect(drawn / opaque).toBeGreaterThan(0.9);
    // cadre : icônes du haut (page 0) et cases d'inventaire
    const rows = [5, 6, 7, 8].map((y) => e.screen.slice(y * 320 + 25, y * 320 + 45));
    expect(rows.every((r) => new Set(r).size > 1)).toBe(true);
    // événement d'introduction de niveau armé à la première image (la file de CFG a une capacité 0)
    expect(e.state!.events.size).toBe(1);
    expect(e.state!.events.capacity).toBe(5);
    expect(e.state!.events.entries[0]).toMatchObject({ event: 100, procedure: 2000, num: 0 });
    snapshot(s.host, "04-game", 2);
  });

  it("flèches : le héros marche à 2 pixels par tic de monde et reste sur le sol", () => {
    const { hero } = s;
    const terrain = s.engine.currentTerrain!;
    const x0 = hero.x;
    s.host.key({ type: "nav", key: "left" });
    s.run(1);
    expect(hero.speedX).toBe(-1);
    let worldTicks = 0;
    let previous = hero.x;
    for (let i = 0; i < 140; i++) {
      s.run(1);
      if (hero.x !== previous) worldTicks++;
      previous = hero.x;
      expect(Math.abs(hero.y - groundHeight(terrain.grid, hero.plane, hero.x, hero.p))).toBeLessThanOrEqual(4);
    }
    // un tic de monde toutes les 7 images (20 en 140 images), plus celui que force la touche (`engine.md` § 12.1)
    expect(worldTicks).toBe(20);
    expect(x0 - hero.x).toBe(42);
    expect(hero.p).toBe(113);
    snapshot(s.host, "05-walk", 2);
    s.host.key({ type: "nav", key: "left" }); // rappuyer arrête
    s.run(20);
    const stopped = hero.x;
    s.run(30);
    expect(hero.x).toBe(stopped);
    expect(hero.speedX).toBe(0);
  });

  it("bottes : un clic sur l'icône puis un clic dans la salle font marcher le héros jusqu'au point", () => {
    const { hero } = s;
    s.click(284, 10); // icône 198 (bottes), dernière case de la page 0
    expect(s.engine.controller.tool).toEqual({ num: 198, variant: 0 });
    s.click(150, 130);
    expect(hero.path.defined).toBe(true);
    expect(hero.path.target).toMatchObject({ x: 146, p: 63 });
    const before = [hero.x, hero.p];
    s.run(60);
    expect([hero.x, hero.p]).not.toEqual(before);
    s.run(900);
    expect(hero.path.defined).toBe(false);
    expect(Math.abs(hero.x - 146)).toBeLessThanOrEqual(3);
    expect(hero).toMatchObject({ p: 63 });
    snapshot(s.host, "06-boots", 2);
  });

  it("saisie : « regarder » ouvre la ligne, Entrée affiche le message du verbe par défaut", () => {
    const e = s.engine;
    s.host.type("regarder");
    s.run(2);
    expect(e.inputLine).toMatchObject({ open: true, text: "regarder" });
    expect(e.modal).toBe(true);
    snapshot(s.host, "07-input", 2);
    s.host.type("\r");
    s.run(2);
    expect(e.inputLine.open).toBe(false);
    expect(e.windows.active).toBe(true);
    expect(e.windows.text).toBe(messages().messages(messageId("V", 23)));
    snapshot(s.host, "08-message", 2);
    s.host.type("\r");
    s.run(2);
    expect(e.windows.active).toBe(false);
    expect(e.modal).toBe(false);
  });

  it("un mot inconnu affiche S015 et garde la phrase dans la ligne", () => {
    const e = s.engine;
    s.host.type("zorglub\r");
    s.run(2);
    expect(e.windows.text).toBe(messages().messages(messageId("S", 15)));
    expect(e.inputLine).toMatchObject({ open: true, text: "zorglub" });
    s.host.type("\r\x1b");
    s.run(3);
    expect(e.inputLine.open).toBe(false);
  });

  it("F6 : le score et le maximum possible", () => {
    const e = s.engine;
    s.host.key({ type: "function", n: 6 });
    s.run(2);
    expect(e.windows.active).toBe(true);
    expect(e.windows.text).toContain("725");
    expect(e.windows.text).toMatch(/^Votre situation/);
    snapshot(s.host, "09-score", 2);
    s.host.type("\r");
    s.run(2);
    expect(e.modal).toBe(false);
  });

  it("sauvegarde et restauration par le stockage de l'hôte (F2, F3)", () => {
    const e = s.engine;
    const { hero } = s;
    s.host.key({ type: "function", n: 2 });
    s.run(1);
    const saved = s.host.storage.read(DEFAULT_SAVE_SLOT)!;
    expect(saved).toHaveLength(21868);
    const stored = loadWorldState(saved).hero!;
    const [x, y, p] = [stored.x, stored.y, stored.p];
    s.host.key({ type: "nav", key: "right" });
    s.run(100);
    expect(hero.x).toBeGreaterThan(x);
    s.host.key({ type: "function", n: 3 });
    s.run(3);
    const restored = e.state!.hero!;
    expect(restored).not.toBe(hero);
    expect([restored.x, restored.y, restored.p]).toEqual([x, y, p]);
    expect(e.state!.loadedRoom!.id).toBe(1);
    expect(restored.speedX).toBe(0);
    expect(e.state!.events.size).toBeLessThanOrEqual(1);
  });

  it("l'événement d'introduction échoit 60 tics de monde plus tard ; la file vide libère sa table", () => {
    const t = new Session();
    t.skipIntro();
    expect(t.engine.state!.events.size).toBe(1);
    t.run(500);
    expect(t.engine.state!.events.size).toBe(0);
    expect(t.engine.state!.events.capacity).toBe(0);
    expect(t.engine.missing.has("8:2000")).toBe(true); // procédure `21cc:008e` : à brancher (tâche I2)
  });

  it("franchir le bord gauche de la salle 1 charge la salle 17 : le héros arrive à droite, serial remis", () => {
    const t = new Session();
    t.skipIntro();
    const hero = t.hero;
    t.host.key({ type: "nav", key: "left" });
    for (let i = 0; i < 80 && t.engine.state!.loadedRoom!.id === 1; i++) t.run(20);
    expect(t.engine.state!.loadedRoom!.id).toBe(17);
    t.run(5);
    expect(hero.x).toBeGreaterThan(250);
    expect(hero.serial).toBe(158);
    expect(hero.room).toBe(t.engine.state!.loadedRoom);
    expect(hero.speedX).toBe(-1);
    expect(t.engine.state!.firstFrame).toBe(false);
    snapshot(t.host, "10-room17", 2);
  });

  it("les procédures absentes sont notées, pas fatales ; en mode strict elles arrêtent le moteur", () => {
    const t = new Session();
    t.skipIntro();
    t.run(20);
    expect(t.engine.missing.size).toBeGreaterThan(0);
    expect([...t.engine.missing]).toContain("2:201");
    const host = new TestHost();
    const strict = new ArmaethEngine(host, { seed: 1, bare: true, strictBehaviors: true });
    let thrown: unknown;
    try {
      for (let i = 0; i < 2000 && !strict.state; i++) strict.tick();
      for (let i = 0; i < 40; i++) {
        host.pointer(100, 100, i % 2);
        strict.tick();
      }
      for (let i = 0; i < 200; i++) strict.tick();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: "EngineAbort" });
  });
});

describe.skipIf(!hasOriginalFiles)("moteur : exécution des phrases (gm_execute_command)", () => {
  const dictionary = parseDictionary(readOriginal("A1FDIC.SYS"));
  const accents = parseAccentTable(parsePlainMessages(readOriginal("MSGINT")));
  const parse = (text: string) => parseCommand(text, dictionary, accents);

  function game(): Session {
    const t = new Session();
    t.skipIntro();
    return t;
  }

  it("les noms de classe 15 sont résolus : le gestionnaire de l'objet passe avant celui du verbe, un succès arrête (politique 0)", () => {
    const t = game();
    const calls: string[] = [];
    // `Num 1` est le héros (drapeau A = 7) ; la porte de chapitre 0 est ouverte par `CM2` (`cle 0 7`)
    t.engine.registry.register(FAMILY.direct, 1, (ctx) => {
      calls.push(`direct:${ctx.direct.object?.serial}`);
      return 7;
    });
    t.engine.registry.register(FAMILY.verb, 6, {
      policy: 0,
      run: () => {
        calls.push("verb");
        return 7;
      },
    });
    t.engine.execute({ status: "ok", normalized: "", verb: 22006, preposition: 0, direct: [15001], indirect: [] });
    expect(calls).toEqual(["direct:158"]);
    expect(t.engine.pendingWindowCount).toBe(0);
    expect(t.engine.windows.active).toBe(false);
  });

  it("un refus d'objet désactive le verbe et son message (priorité 3) l'emporte sur le verbe par défaut", () => {
    const t = game();
    const calls: string[] = [];
    t.engine.registry.register(FAMILY.direct, 1, (ctx) => {
      calls.push("direct");
      ctx.disableVerb();
      ctx.messages.enqueue(3, "V", 8);
      return 0;
    });
    t.engine.registry.register(FAMILY.verb, 6, {
      policy: 0,
      run: (ctx) => {
        calls.push("verb");
        ctx.messages.enqueue(0, "V", 23);
        return 0;
      },
    });
    t.engine.execute({ status: "ok", normalized: "", verb: 22006, preposition: 0, direct: [15001], indirect: [] });
    t.run(1);
    expect(calls).toEqual(["direct"]);
    expect(t.engine.windows.text).toBe(messages().messages(messageId("V", 8)));
  });

  it("l'indirect passe avant le direct ; les objets résolus parcourent toutes les combinaisons pour un verbe de politique 3", () => {
    const t = game();
    const calls: string[] = [];
    t.engine.registry.register(FAMILY.indirect, 1, () => (calls.push("indirect"), 0));
    t.engine.registry.register(FAMILY.direct, 1, () => (calls.push("direct"), 0));
    t.engine.registry.register(FAMILY.verb, 5, {
      policy: 3,
      run: () => (calls.push("verb"), 7),
    });
    t.engine.execute({ status: "ok", normalized: "", verb: 22005, preposition: 1, direct: [15001], indirect: [15001] });
    expect(calls).toEqual(["indirect", "direct", "verb"]);
  });

  it("sans succès ni message en file : S015 ; avec succès : rien n'est affiché", () => {
    const t = game();
    t.engine.registry.register(FAMILY.verb, 5, { policy: 0, run: () => 0 });
    t.engine.execute({ status: "ok", normalized: "", verb: 22005, preposition: 0, direct: [], indirect: [] });
    t.run(1);
    expect(t.engine.windows.text).toBe(messages().messages(messageId("S", 15)));
    t.host.type("\r");
    t.run(2);
    t.engine.registry.register(FAMILY.verb, 5, { policy: 0, run: () => 7 });
    t.engine.execute({ status: "ok", normalized: "", verb: 22005, preposition: 0, direct: [], indirect: [] });
    t.run(1);
    expect(t.engine.windows.active).toBe(false);
  });

  it("le verbe sans gestionnaire propre retombe sur le verbe par défaut (V023 sans nom, V029 avec un nom)", () => {
    const t = game();
    t.engine.submitLine("ouvrir");
    t.run(1);
    expect(t.engine.windows.text).toBe(messages().messages(messageId("V", 23)));
    t.host.type("\r");
    t.run(2);
    t.engine.execute(parse("ouvrir homme"));
    t.run(1);
    // « homme » (Num 101) n'est pas dans la salle : V026 (rien de tel ici) n'est pas porté, le défaut dit V029
    expect(t.engine.windows.active).toBe(true);
  });

  it("la porte de chapitre ferme les familles 1, 2, 5 et 9 : succès silencieux tant que `cle` ne l'a pas ouverte", () => {
    const registry = new HandlerRegistry();
    registry.register(FAMILY.direct, 101, () => 1);
    expect(registry.resolve(FAMILY.direct, 101)).toBeUndefined();
    registry.gates[1] = 7;
    expect(registry.resolve(FAMILY.direct, 101)).toBeDefined();
    expect(registry.resolve(FAMILY.verb, 5)).toBeUndefined();
    expect(registry.resolve(FAMILY.verb, 1)).toBe(defaultVerb);
  });

  it("la file d'événements grandit de 5 quand elle est pleine (la capacité de CFG est 0)", () => {
    const t = game();
    const queue = t.engine.state!.events;
    queue.entries.length = 0;
    queue.capacity = 0;
    const services = (t.engine as unknown as { services: { events: { operate: (...args: unknown[]) => number | undefined } } }).services;
    for (let i = 0; i < 7; i++) expect(services.events.operate({ typ: 2, num: 9, serial: 100 + i }, 15, EventOp.Set, 2, 1)).toBe(2);
    expect(queue.size).toBe(7);
    expect(queue.capacity).toBe(10);
  });
});

describe("fenêtres de message (mise en page de gm_draw_text)", () => {
  const font = hasOriginalFiles ? parseGph(readOriginal("A1FGPH.SYS")) : null;

  it.skipIf(!hasOriginalFiles)("coupe aux mots, ■ termine la ligne, un mot trop large est coupé", () => {
    expect(wrapText(font!, "un deux■■trois", 309)).toEqual(["un deux", "", "trois"]);
    expect(wrapText(font!, "a b", 309)).toEqual(["a b"]);
    const long = "x".repeat(200);
    const lines = wrapText(font!, long, 100);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(long);
    expect(wrapText(font!, "fin■", 309)).toEqual(["fin"]);
  });

  it.skipIf(!hasOriginalFiles)("fenêtre par défaut : centrée, y = 21, au plus 20 lignes par page ; ttl 62 66 196 120 : 14 lignes", () => {
    const text = Array.from({ length: 45 }, (_, i) => `ligne ${i}`).join("■");
    const centered = layoutWindow(font!, { text, window: null, centered: true });
    expect(centered.pages.map((p) => p.lines.length)).toEqual([20, 20, 5]);
    expect(centered.pages[0].rect).toMatchObject({ y: 21, height: 7 * 22 });
    expect(centered.pages[0].rect.x * 2 + centered.pages[0].rect.width).toBe(320);
    const fixed = layoutWindow(font!, { text, window: { x: 62, y: 66, width: 196, height: 120 }, centered: false });
    expect(fixed.pages[0].lines).toHaveLength(14);
    expect(fixed.pages[0].rect).toMatchObject({ x: 62, y: 66, width: 196 });
  });
});
