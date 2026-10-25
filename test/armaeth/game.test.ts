import { describe, expect, it } from "vitest";
import { MessageTable, messageId } from "../../src/games/armaeth/data/text";
import { ArmaethEngine } from "../../src/games/armaeth/engine/engine";
import { FAMILY, HandlerRegistry, heroBehavior } from "../../src/games/armaeth/engine/handlers";
import type { GameObject } from "../../src/games/armaeth/engine/state";
import { DECOR_KEYS } from "../../src/games/armaeth/game/decor";
import { EVENT_KEYS } from "../../src/games/armaeth/game/events";
import { gameOptions, registerGame } from "../../src/games/armaeth/game/index";
import { REACTION_TABLE } from "../../src/games/armaeth/game/reactions";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { Player } from "./player";
import { TestHost } from "./test-host";

/** Assemblage des modules de jeu (`game/index.ts`) et branchements du moteur par défaut. */

/** Une partie neuve par salle : ~3 s seul, bien plus quand toute la suite tourne en parallèle (le délai par défaut de 5 s ne suffit plus). */
const HEAVY_TEST_TIMEOUT = 60_000;

const text = (cls: string, n: number) => new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS")).messages(messageId(cls, n));

describe("registerGame : toutes les familles, une seule procédure par clé", () => {
  const registry = new HandlerRegistry();
  registry.gates.fill(7); // les portes de chapitre sont ouvertes par `CM2` : on les ouvre pour lire les familles à porte
  const kit = registerGame(registry);

  it("verbes, objets, indirects, mots magiques, réactions", () => {
    for (const key of [5, 6, 7, 9, 10, 13, 14, 15, 16, 17, 20, 41, 42]) expect(registry.get(FAMILY.verb, key)).toBeDefined();
    expect(registry.get(FAMILY.direct, 21)).toBeDefined(); // gros coffre de chêne
    expect(registry.get(FAMILY.direct, 328)).toBeDefined(); // couronne
    expect(registry.get(FAMILY.indirect, 113)).toBeDefined(); // armoire
    for (const key of [1, 2, 3, 4, 5, 6]) expect(registry.get(FAMILY.name, key)).toBeDefined();
    for (const { keys } of REACTION_TABLE) for (const key of keys) expect(registry.get(FAMILY.reaction, key)).toBeDefined();
  });

  it("personnages (famille 2) dont le héros et la dépouille, décors (3), événements (8)", () => {
    for (const key of [1, 2, 3, 4, 12, 16, 18, 20, 101, 103, 104, 201, 207, 302, 303, 327, 333]) expect(registry.get(FAMILY.character, key)).toBeDefined();
    expect(registry.get(FAMILY.character, 1)).not.toBe(heroBehavior); // le héros de `hero.ts` remplace le noyau minimal
    for (const key of DECOR_KEYS) expect(registry.get(FAMILY.decor, key)).toBeDefined();
    for (const key of [1, 4, 101, 201, 303, 327, ...EVENT_KEYS]) expect(registry.get(FAMILY.event, key)).toBeDefined();
    expect(kit).toBeDefined();
  });
});

describe.skipIf(!hasOriginalFiles)("ArmaethEngine par défaut et moteur nu", () => {
  it("par défaut le registre porte les modules de jeu et les services ; `bare` garde le noyau", () => {
    const full = new ArmaethEngine(new TestHost(), { seed: 1 });
    expect(full.registry.get(FAMILY.character, 1)).not.toBe(heroBehavior);
    expect(full.registry.get(FAMILY.verb, 6)).toBeDefined();
    const services = (full as unknown as { services: { die?: unknown; playAnimation?: unknown } }).services;
    expect(typeof services.die).toBe("function");
    expect(typeof services.playAnimation).toBe("function");

    const bare = new ArmaethEngine(new TestHost(), { seed: 1, bare: true });
    expect(bare.registry.get(FAMILY.character, 1)).toBe(heroBehavior);
    expect(bare.registry.get(FAMILY.verb, 6)).toBeUndefined();
    expect((bare as unknown as { services: { die?: unknown } }).services.die).toBeUndefined();
  });

  it("`register` du demandeur passe après les modules de jeu et peut remplacer une clé", () => {
    const custom = () => 7;
    const engine = new ArmaethEngine(new TestHost(), { seed: 1, register: (r) => r.register(FAMILY.character, 1, custom) });
    expect(engine.registry.get(FAMILY.character, 1)).toBe(custom);
  });

  it("acceptsGround : le filtre de sols du héros (13a8:000a) remplace « type >= 2 »", () => {
    const p = new Player();
    p.skipIntro();
    const options = gameOptions();
    const services = (p.engine as unknown as { services: Parameters<NonNullable<typeof options.acceptsGround>>[3] }).services;
    const accepts = (type: number, body: GameObject) => options.acceptsGround!(type, 0, body, services);
    expect(accepts(0, p.hero)).toBe(false);
    expect(accepts(1, p.hero)).toBe(false);
    expect(accepts(2, p.hero)).toBe(true);
    expect(accepts(4, p.hero)).toBe(true); // l'eau : le héros nage
    const bear = p.state.findByNum(4)!;
    expect(accepts(4, bear)).toBe(false); // pas l'ours
    expect(accepts(37, bear)).toBe(true); // mais la zone des frelons, oui (`13a8`, sol 37)
  });

  it("un trajet de réaction « trop loin » : le héros marche (services du moteur), la commande est rejouée à l'arrivée", () => {
    const p = new Player();
    p.skipIntro();
    const key = p.state.createObject({ typ: 2, num: 6, pickable: 7, presence: 2, value: 1000, weight: 1 });
    p.state.moveToRoom(key, p.state.loadedRoom!);
    Object.assign(key, { x: 60, y: p.hero.y, p: p.hero.p, plane: p.hero.plane });
    expect(Math.abs(p.hero.x - key.x)).toBeGreaterThan(100);
    expect(p.say("prendre la clef")).toEqual([text("V", 15)]); // V008 est avalé par la marche, puis le rejeu prend la clef
    expect(key.holder).toBe(p.hero);
  });

  it("un clic qui ferme une fenêtre n'est pas aussi un clic dans la salle", () => {
    const p = new Player();
    p.skipIntro();
    p.host.type("regarder\r");
    p.run(4);
    expect(p.engine.windows.active).toBe(true);
    p.click(100, 100);
    expect(p.engine.windows.active).toBe(false);
    expect(p.engine.controller.refusing).toBe(false); // sinon : refus du curseur, ou message « plus de héros »
    expect(p.engine.controller.tool.num).toBe(1);
  });

  it("toute salle reçoit le héros envoyé par `trf` sans repli au hasard (le placement libre de `1b11:000c` suffit, y compris la salle 212)", () => {
    const probe = new Player();
    probe.skipIntro();
    const rooms = probe.state.rooms.map((r) => r.id).filter((id) => ![0, 20, 21, 22].includes(id));
    for (const room of rooms) {
      const p = new Player();
      p.skipIntro();
      p.engine.sendToRoom(room, true);
      p.run(60);
      expect(p.state.loadedRoom!.id).toBe(room);
      expect(p.state.hero!.room).toBe(p.state.loadedRoom);
      expect(p.engine.heroPlacementFallbacks).toBe(0);
    }
  }, HEAVY_TEST_TIMEOUT);

  it("pas de garde-fou : un trajet bloqué finit comme dans l'original (5, un recalcul, 5, puis G44 « Impossible d'aller plus loin »)", () => {
    // salle 8, héros en X pair au pied de la pile de bois : l'alignement sur la colonne 49 le laisse en X 196, où le couloir de la
    // pile (X 197 à 199 seulement, murs de la rangée 6 et masque de profondeur de P 56) est fermé ; en X impair il passe
    const p = new Player();
    p.skipIntro();
    p.engine.sendToRoom(8, true);
    p.run(60);
    const hero = p.hero;
    expect(hero.x % 2).toBe(0);
    const frames = p.engine as unknown as { pathEnd(obj: GameObject, result: number): boolean };
    const results: number[] = [];
    const original = frames.pathEnd.bind(p.engine);
    frames.pathEnd = (obj, result) => (results.push(result), original(obj, result));
    expect(p.say("ouvrir le coffret")).toContain(text("G", 44));
    expect(results).toEqual([5, 5]); // le premier blocage recalcule (`+0x43`), le second affiche G44
    expect(hero.path.defined).toBe(false);
    expect([hero.x, hero.p]).toEqual([196, 56]);
  });
});
