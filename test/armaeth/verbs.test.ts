import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ArmaethEngine } from "../../src/games/armaeth/engine/engine";
import { FAMILY } from "../../src/games/armaeth/engine/handlers";
import type { GameObject } from "../../src/games/armaeth/engine/state";
import { registerVerbs } from "../../src/games/armaeth/game/verbs";
import { parseDictionary } from "../../src/games/armaeth/data/dictionary";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { TestHost } from "./test-host";

/** Verbes d'*Armaeth* (objects.md § 3) joués de bout en bout par `submitLine` sur les vraies données. */

/** `V008`, `V015`... : identifiant lisible d'un message. */
function label(id: number): string {
  const cls = Math.floor(id / 1000);
  const n = String(id % 1000).padStart(3, "0");
  return cls >= 30 ? `${cls}:${n}` : `${String.fromCharCode(64 + cls)}${n}`;
}

class Session {
  readonly host = new TestHost();
  readonly engine = new ArmaethEngine(this.host, { seed: 1, bare: true });
  shown: string[] = [];
  private snapshot: Uint8Array | null = null;

  constructor() {
    this.run(2000);
    for (let i = 0; this.engine.windows.active && i < 40; i++) this.click();
    this.run(320);
    registerVerbs(this.engine.registry);
    (this.engine as unknown as { sayId: (id: number) => void }).sayId = (id) => void this.shown.push(label(id));
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.engine.tick();
  }

  click(): void {
    this.host.pointer(100, 100, 1);
    this.engine.tick();
    this.host.pointer(100, 100, 0);
    this.engine.tick();
  }

  /** Mémorise le monde au départ, puis y revient avant chaque test. */
  mark(): void {
    this.engine.saveGame("test");
    this.snapshot = this.host.storage.read("test");
  }

  reset(): void {
    this.host.storage.write("test", this.snapshot!);
    this.engine.loadGame("test");
    this.run(6);
    this.shown = [];
    vi.restoreAllMocks();
  }

  get state() {
    return this.engine.state!;
  }

  get hero(): GameObject {
    return this.state.hero!;
  }

  /** Objet neuf dans la salle chargée, à côté du héros. */
  put(num: number, fields: Partial<GameObject> = {}): GameObject {
    const obj = this.state.createObject({ typ: 2, num, pickable: 7, presence: 2, ...fields });
    this.state.moveToRoom(obj, this.state.loadedRoom!);
    obj.x = this.hero.x;
    obj.y = this.hero.y;
    obj.p = this.hero.p;
    obj.plane = this.hero.plane;
    return obj;
  }

  /** Objet neuf dans l'inventaire du héros. */
  give(num: number, fields: Partial<GameObject> = {}): GameObject {
    const obj = this.state.createObject({ typ: 2, num, pickable: 7, presence: 8, ...fields });
    this.state.moveToContainer(obj, this.hero);
    return obj;
  }

  say(line: string): string[] {
    this.shown = [];
    this.engine.submitLine(line);
    return this.shown;
  }
}

describe.skipIf(!hasOriginalFiles)("verbes (famille 0)", () => {
  let s: Session;
  beforeAll(() => {
    s = new Session();
    s.mark();
  });
  beforeEach(() => s.reset());

  it("registerVerbs : 13 clés, politique 3 pour regarder, fouiller et zwygks, 0 pour les autres", () => {
    const policy = (key: number) => s.engine.registry.get(FAMILY.verb, key)!.policy;
    for (const key of [5, 6, 7, 9, 10, 13, 14, 15, 16, 17, 20, 41, 42]) expect(s.engine.registry.get(FAMILY.verb, key)).toBeDefined();
    expect([5, 7, 41].map(policy)).toEqual([3, 3, 3]);
    expect([6, 9, 10, 15, 17, 20, 42].map(policy)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("prendre la clef : elle entre dans l'inventaire, V015", () => {
    const key = s.put(6, { value: 1000, weight: 1 });
    expect(s.say("prendre la clef")).toEqual(["V015"]);
    expect(key.holder).toBe(s.hero);
    expect(s.say("prendre la clef")).toEqual(["V039"]); // déjà tenue
  });

  it("prendre : non ramassable V020, trop lourd V021", () => {
    s.put(6, { pickable: 0 });
    expect(s.say("prendre la clef")).toEqual(["V020"]);
  });

  it("prendre : trop lourd V021 (poids du contenu du héros + objet > capacité)", () => {
    s.put(6, { weight: s.hero.capacity + 1 });
    expect(s.say("prendre la clef")).toEqual(["V021"]);
  });

  it("prendre loin : réaction « trop loin » armée et V008", () => {
    const key = s.put(6);
    key.x = s.hero.x + 150;
    let target: GameObject | null = null;
    vi.spyOn(s.engine, "armReaction").mockImplementation((_ctx, t) => ((target = t), false));
    expect(s.say("prendre la clef")).toEqual(["V008"]);
    expect(target).toBe(key);
    expect(key.holder).toBeNull();
  });

  it("prendre la clef dans le coffre : transfert si le coffre contient la clef, V022 sinon", () => {
    const chest = s.put(21, { canContain: 7, ego: 2, pickable: 0, capacity: 500 });
    const key = s.put(22);
    expect(s.say("prendre la clef dans le coffre")).toEqual(["V022"]);
    s.state.moveToContainer(key, chest);
    expect(s.say("prendre la clef dans le coffre")).toEqual(["V015"]);
    expect(key.holder).toBe(s.hero);
  });

  it("mettre / jeter : l'objet tenu retourne dans la salle, sinon V024", () => {
    const key = s.give(6);
    s.put(22);
    expect(s.say("jeter la clef")).toEqual(["V015"]);
    expect(key.holder).toBeNull();
    expect(key.room).toBe(s.state.loadedRoom);
    expect(s.say("jeter la clef")).toEqual(["V024"]);
  });

  it("mettre la clef dans le coffre : aucun contrôle de capacité (verbe), V015", () => {
    const chest = s.put(21, { canContain: 7, ego: 2, pickable: 0 });
    const key = s.give(6);
    expect(s.say("mettre la clef dans le coffre")).toEqual(["V015"]);
    expect(key.holder).toBe(chest);
  });

  it("inventaire : en-tête V037 et objets non cachés, sinon V036", () => {
    const calls: { empty: number; header: number; nums: number[] }[] = [];
    vi.spyOn(s.engine, "listObjects").mockImplementation((objects, empty, header) => void calls.push({ empty, header, nums: objects.map((o) => o.num) }));
    s.give(6);
    s.give(22, { hidden: 7 });
    s.say("inventaire");
    expect(calls.at(-1)).toMatchObject({ empty: 36, header: 37, nums: expect.arrayContaining([6]) });
    expect(calls.at(-1)!.nums).not.toContain(22);
  });

  it("regarder un décor nommé : le message du décor de la salle (classe 4 : D, classe 9 : I), V026 si le décor n'y est pas", () => {
    // salle 1 : « cascade » désigne deux points sensibles (9001 et 9005), « arbre » un seul (9003)
    expect(s.say("regarder la cascade").sort()).toEqual(["I001", "I005"]);
    expect(s.say("regarder l'arbre")).toEqual(["I003"]);
    // un nom de décor (classe 4 ou 9) qui n'est pas dans la salle chargée
    const here = new Set(s.engine.currentScene!.hotspots.map((h) => h.messageId));
    const absent = parseDictionary(readOriginal("A1FDIC.SYS")).find((e) => [4, 9].includes(Math.floor(e.code / 1000)) && !here.has(e.code))!;
    expect(s.say(`regarder ${absent.word}`)).toEqual(["V026"]);
  });

  it("regarder la clef : la description (30 + Ego, Num) est affichée en fin de commande", () => {
    s.put(6, { ego: 0 });
    expect(s.say("regarder la clef")).toEqual(["30:006"]);
  });

  it("regarder dans le coffre : le contenu devient le panneau sélectionné ; coffre vide V033", () => {
    const chest = s.put(21, { canContain: 7, pickable: 0 });
    expect(s.say("regarder dans le coffre")).toEqual(["V033"]);
    s.state.moveToContainer(s.put(22), chest);
    s.say("regarder dans le coffre");
    expect(s.state.selected).toBe(chest);
  });

  it("fouiller le coffre = regarder dedans", () => {
    const chest = s.put(21, { canContain: 7, pickable: 0 });
    s.state.moveToContainer(s.put(22), chest);
    s.say("fouiller le coffre");
    expect(s.state.selected).toBe(chest);
  });

  it("briser et lire sans gestionnaire d'objet : V052 et V098", () => {
    s.put(6);
    expect(s.say("briser la clef")).toEqual(["V052"]);
    expect(s.say("lire la clef")).toEqual(["V098"]);
  });

  it("monter : échelle (Sol 7..10) → Ver = +1 ; ailleurs V044", () => {
    s.hero.ground = 8;
    expect(s.say("monter")).toEqual([]);
    expect(s.hero.speedY).toBe(1);
    s.hero.ground = 1;
    s.hero.dep = 0;
    expect(s.say("monter")).toEqual(["V044"]);
  });

  it("zwygks : l'objet désigné entre dans l'inventaire même éloigné", () => {
    const far = s.put(7);
    far.x += 300;
    s.say("zwygks doublons");
    expect(far.holder).toBe(s.hero);
  });
});
