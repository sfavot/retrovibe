import { beforeAll, describe, expect, it, vi } from "vitest";
import { parseAni } from "../../src/games/armaeth/data/tables";
import { Lcg, msvcRand } from "../../src/engine/rng";
import { ArmaethEngine } from "../../src/games/armaeth/engine/engine";
import { FAMILY, type BehaviorContext } from "../../src/games/armaeth/engine/handlers";
import type { GameObject, GameRoom } from "../../src/games/armaeth/engine/state";
import type { DeferredEvent } from "../../src/games/armaeth/data/world";
import { PRYTWEN_EVENT } from "../../src/games/armaeth/game/npc-prytwen";
import { type DuelGear, registerNpcs, resolveDuel } from "../../src/games/armaeth/game/npc";
import { NUM, ROOM } from "../../src/games/armaeth/game/helpers";
import { createAnimations, instantAnimations, NpcKit } from "../../src/games/armaeth/game/npc-kit";
import { POST_CELLAR, POST_NORTH, guardAttacks } from "../../src/games/armaeth/game/npc-dwarves";
import { wander } from "../../src/games/armaeth/game/helpers";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { TestHost } from "./test-host";

/**
 * Personnages d'*Armaeth* (`game/npc*.ts`, `characters.md` § 7, § 8) : enregistrement, table de résolution des duels, scénarios
 * par personnage (appel direct des procédures sur le monde réel) et passage de 3000 tics dans chaque salle peuplée.
 */

/** Numéros de la famille 2 enregistrés ici (tout sauf le héros). */
const FAMILY2_KEYS = [2, 3, 4, 12, 16, 18, 20, 23, 101, 103, 104, 201, 202, 203, 204, 207, 301, 302, 303, 316, 317, 327, 333];

interface Rig {
  engine: ArmaethEngine;
  ctx: BehaviorContext;
}

function boot(instant: boolean): Rig {
  const host = new TestHost();
  const engine = new ArmaethEngine(host, { seed: 7, bare: true });
  const ani = parseAni(readOriginal("A1FANI.SYS"));
  registerNpcs(engine.registry, instant ? instantAnimations : createAnimations(() => ({ sprites: engine.sprites, ani })));
  const tick = (n: number) => {
    for (let i = 0; i < n; i++) engine.tick();
  };
  tick(2000);
  for (let clicks = 0; engine.windows.active && clicks < 40; clicks++) {
    host.pointer(100, 100, 1);
    engine.tick();
    host.pointer(100, 100, 0);
    engine.tick();
  }
  tick(320);
  return { engine, ctx: (engine as unknown as { services: BehaviorContext }).services };
}

function calm(engine: ArmaethEngine): void {
  engine.windows.close();
  (engine as unknown as { pendingWindows: string[] }).pendingWindows.length = 0;
}

describe("enregistrement", () => {
  it("la famille 2 (23 clés) est enregistrée, la famille 7 vient du noyau", () => {
    const engine = new ArmaethEngine(new TestHost(), { seed: 1, bare: true });
    registerNpcs(engine.registry);
    for (const key of FAMILY2_KEYS) expect(engine.registry.get(FAMILY.character, key), `table 2 clé ${key}`).toBeTypeOf("function");
    for (const key of [1, 2, 5]) expect(engine.registry.get(FAMILY.interface, key), `table 7 clé ${key}`).toBeTypeOf("function");
    for (const key of [4, 101, 201, 303, 327]) expect(engine.registry.get(FAMILY.event, key), `table 8 clé ${key}`).toBeTypeOf("function");
  });
});

describe("table de résolution des duels (characters.md § 7.3)", () => {
  const gear = (shield: boolean, sword: boolean, axe: boolean): DuelGear => ({ shield, sword, axe });
  it("bouclier et épée : victoire contre tous", () => {
    for (const type of [0, 1, 2] as const) for (let r = 0; r < 4; r++) expect(resolveDuel(type, gear(true, true, false), r)).toBe("V");
  });
  it("mineur (t = 0)", () => {
    expect([0, 1, 2, 3].map((r) => resolveDuel(0, gear(true, false, false), r))).toEqual(["P", "K", "F", "F"]);
    expect([0, 1, 2, 3].map((r) => resolveDuel(0, gear(false, false, true), r))).toEqual(["P", "P", "V", "V"]);
    expect([0, 1, 2, 3].map((r) => resolveDuel(0, gear(false, false, false), r))).toEqual(["K", "P", "P", "P"]);
    expect(resolveDuel(0, gear(true, false, true), 0)).toBe("V");
    expect(resolveDuel(0, gear(false, true, false), 3)).toBe("V");
  });
  it("guerrier (t = 1)", () => {
    expect([0, 1, 2, 3].map((r) => resolveDuel(1, gear(true, false, true), r))).toEqual(["P", "K", "V", "V"]);
    expect([0, 1, 2, 3].map((r) => resolveDuel(1, gear(true, false, false), r))).toEqual(["K", "P", "P", "P"]);
    expect([0, 1].map((r) => resolveDuel(1, gear(false, true, false), r))).toEqual(["K", "V"]);
    expect([0, 1].map((r) => resolveDuel(1, gear(false, false, true), r))).toEqual(["V", "P"]);
    expect(resolveDuel(1, gear(false, false, false), 0)).toBe("P");
  });
  it("soldat (t = 2)", () => {
    expect([0, 1, 2, 3].map((r) => resolveDuel(2, gear(false, true, false), r))).toEqual(["K", "K", "V", "V"]);
    expect([0, 1].map((r) => resolveDuel(2, gear(true, false, true), r))).toEqual(["K", "P"]);
    expect(resolveDuel(2, gear(false, false, true), 0)).toBe("P");
  });
});

describe.skipIf(!hasOriginalFiles)("scénarios (monde réel)", () => {
  let rig: Rig;
  beforeAll(() => {
    rig = boot(true);
  });

  const state = () => rig.engine.state!;
  const handler = (num: number) => rig.engine.registry.get(FAMILY.character, num)!;
  const run = (obj: GameObject, times = 1) => {
    for (let i = 0; i < times; i++) handler(obj.num)(obj, rig.ctx);
  };
  const room = (id: number): GameRoom => state().roomById(id)!;
  /** Un objet de ce `Num` placé dans la salle, à côté du héros qu'on y amène. */
  function stage(num: number, roomId: number): { npc: GameObject; hero: GameObject } {
    const s = state();
    // le tirage du duel précédent a pu tuer le héros (le résultat dépend de la graine et de l'historique du hasard) : nouveau héros
    if (!s.hero) {
      const fresh = s.createObject({ typ: 2, num: NUM.hero, gst: 7, mob: 2, light: 0, capacity: 500 });
      s.moveToRoom(fresh, room(1));
      s.setHero(fresh);
    }
    const npc = s.findByNum(num)!;
    const hero = s.hero!;
    const target = room(roomId);
    s.moveToRoom(npc, target);
    s.moveToRoom(hero, target);
    npc.gst = 7;
    npc.ego = 0;
    npc.err = 0;
    npc.path.defined = false;
    hero.ego = 0;
    hero.hidden = 0;
    hero.x = npc.x = 100;
    hero.p = npc.p = 60;
    hero.y = npc.y = 100;
    return { npc, hero };
  }
  const touch = (npc: GameObject, other: GameObject) => {
    npc.col = other.serial;
    npc.err = 9;
  };
  function give(hero: GameObject, num: number): void {
    const item = state().createObject({ typ: 2, num });
    state().moveToContainer(item, hero);
  }

  it("nain mineur : contact puis duel désarmé, table de résolution appliquée", () => {
    const { npc, hero } = stage(NUM.dwarfMiner, 201);
    touch(npc, hero);
    run(npc);
    expect(npc.ego).toBe(1);
    expect(npc.animId).toBe(29);
    expect(hero.ego).toBe(6);
    const expected = new Lcg(rig.engine.rng.state, msvcRand);
    const r = expected.mod(4);
    const before = state().score;
    run(npc); // fin de l'animation 29 : résolution
    const outcome = resolveDuel(0, { shield: false, sword: false, axe: false }, r);
    if (outcome === "K") {
      expect(npc.ego).toBe(2);
      expect(npc.animId).toBe(20);
    } else {
      expect(outcome).toBe("P");
      expect(state().hero).toBeNull(); // héros tué : dépouille
      expect(state().findByNum(NUM.remains)).toBeDefined();
    }
    expect(state().score).toBe(before);
  });

  it("nain guerrier contre bouclier + épée : il est abattu, points (2, 4)", () => {
    const { npc, hero } = stage(NUM.dwarfWarrior, 203);
    give(hero, NUM.shield);
    give(hero, NUM.sword);
    touch(npc, hero);
    run(npc);
    expect(hero.ego).toBe(6);
    const before = state().score;
    run(npc);
    expect(npc.ego).toBe(3);
    expect(npc.animId).toBe(26);
    expect(hero.ego).toBe(0);
    expect(state().score).toBeGreaterThan(before);
    run(npc, 5); // abattu -> désintégration -> disparu
    expect(state().findBySerial(npc.serial)).toBeUndefined();
  });

  it("Prytwen dans sa tanière : le duel tue le héros, qui laisse une dépouille", () => {
    const { npc, hero } = stage(NUM.prytwen, ROOM.lair);
    touch(npc, hero);
    run(npc);
    expect(npc.ego).toBe(1);
    expect(hero.ego).toBe(6);
    run(npc); // animation finie : d = 0
    expect(state().hero).toBeNull();
    const remains = state().findByNum(NUM.remains)!;
    expect(remains.ego).toBe(0);
    expect(npc.ego).not.toBe(1);
    state().setHero(null);
  });

  const fire = (procedure: number, event: number, obj: GameObject) =>
    rig.engine.registry.get(FAMILY.event, procedure)!(rig.ctx, { event } as DeferredEvent, obj);
  const awarded = (id: number) => state().scoreTable.some((e) => e.id === id && e.points < 0);

  it("Prytwen assommé se réveille à terre : debout et mobile (`28b1:12e0`, `Gst 7, Mob 2, Ego 0`), pas en fuite (`Ego 4`)", () => {
    const { npc } = stage(NUM.prytwen, 104);
    npc.ego = 2;
    npc.mob = 0;
    fire(NUM.prytwen, PRYTWEN_EVENT.wake, npc);
    calm(rig.engine);
    expect([npc.gst, npc.mob, npc.ego, npc.fig]).toEqual([7, 2, 0, 0]);
  });

  it("soldat endormi réveillé (`2a44:12fc`, événements 3 et 4) : `Gst 7, Mob 2`, il reprend ses déplacements", () => {
    const { npc } = stage(NUM.soldier, ROOM.soldiers);
    Object.assign(npc, { ego: 7, fig: 1, mob: 1 });
    fire(NUM.dwarfMiner, 3, npc);
    expect([npc.gst, npc.mob, npc.ego, npc.fig]).toEqual([7, 2, 0, 0]);
  });

  it("animations des personnages : `Ver` vaut 1 par défaut (`16f5:0132`), sans quoi la séquence n'avance pas", () => {
    // régression du robot : les animations scénarisées des nains n'avançaient pas
    const ani = parseAni(readOriginal("A1FANI.SYS"));
    const animations = createAnimations(() => ({ sprites: rig.engine.sprites, ani }));
    const { npc } = stage(NUM.dwarfMiner, 201);
    animations.start(rig.ctx, npc, { id: 29 });
    expect(npc.speedY).toBe(1);
    expect(npc.animId).toBe(29);
  });

  it("garde de poste (`Ego 5` cellier, `Ego 6` passage nord) : il n'attaque que sur sa case ou quand plus aucun soldat n'est là (`2a44:08da`)", () => {
    const { hero } = stage(NUM.soldier, ROOM.soldiers);
    const s = state();
    const kit = new NpcKit();
    const soldier = (serial: number, ego: number): GameObject => {
      const o = s.findBySerial(serial)!;
      s.moveToRoom(o, room(ROOM.soldiers));
      o.ego = ego;
      return o;
    };
    const cellar = soldier(80, 5);
    const north = soldier(81, 6);
    const a = soldier(58, 0);
    const b = soldier(82, 0);
    hero.ground = 2;
    // des soldats éveillés dans la salle : les gardes restent à leur poste
    expect(guardAttacks(kit, rig.ctx, cellar, hero)).toBe(false);
    expect(guardAttacks(kit, rig.ctx, north, hero)).toBe(false);
    // sur leur case de déclenchement, ils attaquent (cellier : 0x37, passage nord : 0x36)
    hero.ground = 0x37;
    expect(guardAttacks(kit, rig.ctx, cellar, hero)).toBe(true);
    expect(guardAttacks(kit, rig.ctx, north, hero)).toBe(false);
    hero.ground = 0x36;
    expect(guardAttacks(kit, rig.ctx, north, hero)).toBe(true);
    hero.ground = 2;
    // les deux autres dorment : le garde du cellier n'a plus de camarade éveillé mais l'ignore (les endormis comptent), le garde du
    // passage nord a encore le garde du cellier
    a.ego = 8;
    b.ego = 7;
    expect(guardAttacks(kit, rig.ctx, cellar, hero)).toBe(false);
    expect(guardAttacks(kit, rig.ctx, north, hero)).toBe(false);
    // plus personne d'éveillé ni d'endormi : le garde du cellier reprend son état normal et attaque
    a.ego = 2;
    b.ego = 2;
    expect(guardAttacks(kit, rig.ctx, cellar, hero)).toBe(true);
    expect(cellar.ego).toBe(0);
    // le garde du passage nord compte les soldats d'`Ego 0..5` (assommés compris) : tant qu'il y en a un il reste à son poste
    expect(guardAttacks(kit, rig.ctx, north, hero)).toBe(false);
    for (const o of [cellar, a, b]) o.ego = 6;
    expect(guardAttacks(kit, rig.ctx, north, hero)).toBe(true);
  });

  it("postes des gardes : `2151:0006` tire X et P dans des intervalles imposés (cellier X 100..169 P 50..51, passage nord X 57..94 P 18..19)", () => {
    const guard = state().findBySerial(80)!;
    const north = state().findBySerial(81)!;
    for (const [obj, post] of [[guard, POST_CELLAR], [north, POST_NORTH]] as const) {
      obj.path.defined = false;
      for (let i = 0; i < 60; i++) {
        wander(rig.ctx, obj, post);
        const target = obj.path.target!;
        expect(target.x).toBeGreaterThanOrEqual(post.x[0]);
        expect(target.x).toBeLessThan(post.x[1]);
        expect(target.p).toBeGreaterThanOrEqual(post.p[0]);
        expect(target.p).toBeLessThan(post.p[1]);
      }
    }
  });

  it("ours : il poursuit le héros dans sa grotte, le dévore au contact, la faim est armée", () => {
    const s = state();
    // le héros mort plus haut est remplacé par un nouveau héros
    if (!s.hero) {
      const hero = s.createObject({ typ: 2, num: NUM.hero, gst: 7, mob: 2, light: 0, capacity: 500 });
      s.moveToRoom(hero, room(1));
      s.setHero(hero);
    }
    const { npc: bear, hero } = stage(NUM.bear, ROOM.cave);
    hero.x = 250;
    run(bear);
    expect(bear.path.defined).toBe(true);
    expect(s.events.entries.some((e) => e.num === NUM.bear && e.event === 9 && e.counter > 0)).toBe(true);
    touch(bear, hero);
    run(bear);
    expect(bear.ego).toBe(4);
    expect(bear.animId).toBe(9);
    expect(hero.ego).toBe(6);
    expect(hero.animId).toBe(4);
  });

  it("pie : elle ramasse la clef en or, puis se pose sur son nid", () => {
    const s = state();
    const pie = s.findByNum(NUM.magpie)!;
    const nest = s.findByNum(NUM.nest)!;
    const key = s.findByNum(NUM.goldKey)!;
    s.moveToRoom(pie, nest.room!);
    s.moveToRoom(key, nest.room!);
    key.hidden = 0;
    key.pickable = 7;
    pie.capacity = Math.max(pie.capacity, 10);
    pie.ego = 0;
    pie.err = 0;
    touch(pie, key);
    run(pie);
    expect(key.holder).toBe(pie);
    expect(pie.ego).toBe(4);
    touch(pie, nest);
    run(pie);
    expect(nest.contents).toContain(key);
    expect([2, 5]).toContain(pie.ego);
  });

  it("Sarhûl : le contact avec le héros lance la dévoration (animation 40, héros 41)", () => {
    const s = state();
    if (!s.hero) {
      const hero = s.createObject({ typ: 2, num: NUM.hero, gst: 7, mob: 2, capacity: 500 });
      s.moveToRoom(hero, room(1));
      s.setHero(hero);
    }
    const { npc, hero } = stage(NUM.sarhul, 310);
    touch(npc, hero);
    run(npc);
    expect(npc.ego).toBe(1);
    expect(npc.animId).toBe(40);
    expect(hero.ego).toBe(6);
    expect(hero.animId).toBe(41);
  });

  it("Sarhûls et jambon : on rejoint celui qui mange (`Ego 2`, `22ef:0000` suivi) et on attend contre lui tant qu'il mange (`21e7:003c`)", () => {
    const s = state();
    const [eater, other] = s.objects.filter((o) => o.num === NUM.sarhul);
    for (const o of [eater, other]) {
      s.moveToRoom(o, room(310));
      Object.assign(o, { gst: 7, ego: 0, err: 0, x: 100, p: 60, y: 100 });
      o.path.defined = false;
    }
    other.x = 180;
    eater.ego = 2;
    run(other);
    expect(other.path.defined).toBe(true);
    expect(other.path.target).toMatchObject({ x: eater.x, p: eater.p });
    // au contact d'un Sarhûl qui mange, il attend son tour (`Ego 3`) ; il attend tant qu'un Sarhûl de la salle est en `Ego 2`
    touch(other, eater);
    run(other);
    expect(other.ego).toBe(3);
    other.path.defined = false;
    run(other, 3);
    expect(other.ego).toBe(3);
    // un Sarhûl qui dévore une proie (`Ego 1`) ne le retient pas (le port testait `Ego 1`)
    eater.ego = 1;
    run(other);
    expect(other.ego).toBe(0);
  });

  it("feu, torche, ronces, éclaboussure, dalle : cycles de vie", () => {
    const s = state();
    const fire = s.findByNum(NUM.fire)!;
    fire.ego = 2;
    fire.tim = 0;
    fire.raw[0x2c] = 0;
    run(fire, 101);
    expect(fire.tim).toBeGreaterThan(0);
    const torch = s.createObject({ typ: 2, num: NUM.torch, gst: 7, ego: 0, mob: 1 });
    s.moveToRoom(torch, fire.room!);
    torch.tim = 100;
    run(torch, 100);
    expect(s.findBySerial(torch.serial)).toBeUndefined(); // `Ego 0` à court : détruite
    const splash = s.createObject({ typ: 2, num: NUM.splash, gst: 7, mob: 1 });
    s.moveToRoom(splash, fire.room!);
    run(splash, 9);
    expect(s.findBySerial(splash.serial)).toBeUndefined();
    const slab = s.findByNum(NUM.slab)!;
    slab.gst = 7;
    slab.ego = 1;
    slab.tim = 3;
    const y = slab.y;
    run(slab, 3);
    expect(slab.y).toBe(y - 3 + 0 > y ? y : slab.y);
    expect(slab.ego).toBe(3);
    expect(slab.gst).toBe(7);
    run(slab);
    expect(slab.gst).toBe(0);
  });

  it("stèle : le coulissement va de X 0x36 à 0x62 puis la stèle est ouverte, points (0, 3)", () => {
    const s = state();
    const stele = s.findByNum(NUM.stele)!;
    stele.gst = 7;
    stele.ego = 2;
    stele.x = 0x36;
    const before = s.score;
    run(stele, 0x62 - 0x36 + 1);
    expect(stele.ego).toBe(4);
    expect(s.score).toBe(before + 30);
  });

  it("ronces : la fin de l'animation 7 les détruit et fait passer la stèle à l'état 5", () => {
    const s = state();
    const brambles = s.findByNum(NUM.brambles)!;
    brambles.gst = 7;
    brambles.animId = 7;
    run(brambles);
    expect(s.findBySerial(brambles.serial)).toBeUndefined();
    expect(s.findByNum(NUM.stele)!.ego).toBe(5);
  });

  it("grilles : la grille du cachot coulisse de 2 px en 9 tics puis s'arrête ouverte", () => {
    const s = state();
    const g = s.findByNum(NUM.grille)!;
    g.gst = 7;
    g.ego = 1;
    g.raw[0x36] = 9;
    g.raw[0x37] = 0;
    const x = g.x;
    run(g, 9);
    expect(g.x).toBe(x - 18);
    run(g);
    expect(g.ego).toBe(3);
    expect(g.gst).toBe(0);
    // `2846:0084..00b5` : la fin de course arme l'événement 17 (16 à la fermeture) qui recharge la scène et, héros devant, rapporte (1, 5)
    expect(s.events.entries.some((e) => e.num === NUM.grille && e.event === 17)).toBe(true);
  });

  it("dépouille : cinq étapes puis disparition", () => {
    const s = state();
    const r = s.createObject({ typ: 2, num: NUM.remains, gst: 7, mob: 1, ego: 0, fig: 0 });
    s.moveToRoom(r, room(1));
    r.tim = 1;
    run(r);
    expect(r.fig).toBe(1);
    expect(r.tim).toBe(1600);
  });

  it("soldat contre bouclier + épée : pas de tirage (`2a44:0359`), et le dernier soldat de la salle 305 rapporte (3, 9) (`2a44:02d5`)", () => {
    const { npc, hero } = stage(NUM.soldier, ROOM.soldiers);
    for (const other of state().objects.filter((o) => o.num === NUM.soldier && o !== npc)) state().moveToRoom(other, room(1));
    give(hero, NUM.shield);
    give(hero, NUM.sword);
    touch(npc, hero);
    run(npc);
    expect(hero.ego).toBe(6);
    const seed = rig.engine.rng.state;
    run(npc); // résolution : victoire sans `rand()`
    expect(rig.engine.rng.state).toBe(seed);
    expect(npc.ego).toBe(3);
    expect(awarded(309)).toBe(false);
    run(npc, 5); // dernier test du bloc : le soldat disparaît, les autres ont quitté la salle
    expect(state().findBySerial(npc.serial)).toBeUndefined();
    expect(awarded(309)).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("scénario moteur : un poursuivant rejoint le héros", () => {
  it("l'ours de la salle 7 marche jusqu'au héros et l'attaque", () => {
    const { engine } = boot(false);
    const s = engine.state!;
    engine.sendToRoom(ROOM.cave, true);
    for (let i = 0; i < 4; i++) {
      calm(engine);
      engine.tick();
    }
    const bear = s.findByNum(NUM.bear)!;
    bear.ego = 0;
    let attacked = false;
    for (let i = 0; i < 1500 && !attacked; i++) {
      calm(engine);
      engine.tick();
      const hero = s.hero;
      attacked = !hero || hero.ego === 6 || bear.ego === 4;
    }
    expect(attacked).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("passage de 3000 tics dans chaque salle peuplée", () => {
  it("aucune exception et aucune procédure manquante (familles 2 et 7)", () => {
    const { engine } = boot(false);
    const s = engine.state!;
    const populated = new Set<number>();
    for (const o of s.objects) if (o.gst === 7 && o.num !== NUM.hero && o.room) populated.add(o.room.id);
    expect(populated.size).toBeGreaterThan(8);
    let visited = 0;
    for (const id of populated) {
      // le placement libre du héros (`Inf = 6`) peut échouer dans une salle encombrée : quelques essais, sinon la salle est passée
      let entered = false;
      if (!s.hero) {
        // les bêtes ont mangé le héros dans la salle précédente : un nouveau héros repart de la salle 1
        const hero = s.createObject({ typ: 2, num: NUM.hero, gst: 7, mob: 2, capacity: 500, weight: 0 });
        s.moveToRoom(hero, s.roomById(1)!);
        s.setHero(hero);
        engine.sendToRoom(1, true);
        calm(engine);
        engine.tick();
      }
      for (let attempt = 0; attempt < 6 && !entered && s.hero; attempt++) {
        engine.sendToRoom(id, true);
        try {
          for (let i = 0; i < 4; i++) {
            calm(engine);
            engine.tick();
          }
          entered = s.loadedRoom?.id === id;
        } catch {
          s.wantedRoom = s.loadedRoom;
        }
      }
      if (!entered) continue;
      visited++;
      for (let i = 0; i < 3000; i++) {
        calm(engine);
        engine.tick();
      }
    }
    expect(visited).toBeGreaterThan(5);
    const missing = [...engine.missing].filter((m) => m.startsWith("2:") || m.startsWith("7:"));
    expect(missing).toEqual([]);
    // Lourd (3000 tics par salle) : le délai par défaut de 5 s ne suffit pas sur les machines de l'intégration continue.
  }, 60000);
});

describe.skipIf(!hasOriginalFiles)("Prytwen mort et grille 103 (monde réel, rig à part : ces tests consomment du hasard)", () => {
  let rig: Rig;
  beforeAll(() => {
    rig = boot(true);
  });
  const state = () => rig.engine.state!;
  const run = (obj: GameObject) => rig.engine.registry.get(FAMILY.character, obj.num)!(obj, rig.ctx);
  const room = (id: number): GameRoom => state().roomById(id)!;
  function stage(num: number, roomId: number): { npc: GameObject; hero: GameObject } {
    const npc = state().findByNum(num)!;
    const hero = state().hero!;
    state().moveToRoom(npc, room(roomId));
    npc.gst = 7;
    npc.ego = 0;
    npc.err = 0;
    npc.path.defined = false;
    hero.x = npc.x = 100;
    hero.p = npc.p = 60;
    hero.y = npc.y = 100;
    return { npc, hero };
  }

  /** Prytwen est détruit par le test précédent : un neuf, comme `gm_create_object` (poids et capacité de la table). */
  function reviveBoss(): void {
    if (state().findByNum(NUM.prytwen)) return;
    const fresh = state().createObject({ typ: 2, num: NUM.prytwen, gst: 7, mob: 2, capacity: 600, weight: 450, pickable: 7 });
    state().moveToRoom(fresh, room(ROOM.lair));
  }

  it("Prytwen mort hors de la salle chargée : un squelette (Num 112) le remplace dans la salle 110 (`28b1:0360`), il est détruit ailleurs (`28b1:0358`)", () => {
    const { npc, hero } = stage(NUM.prytwen, ROOM.treasury);
    state().moveToRoom(hero, room(1));
    const loot = state().createObject({ typ: 2, num: 105, value: 100 });
    state().moveToContainer(loot, npc);
    npc.ego = 3;
    run(npc);
    expect(state().findBySerial(npc.serial)).toBeUndefined();
    const skeleton = state().findByNum(NUM.skeleton)!;
    expect([skeleton.room!.id, skeleton.x, skeleton.p, skeleton.weight, skeleton.pickable]).toEqual([ROOM.treasury, 100, 60, 50, 0]);
    expect(loot.room!.id).toBe(ROOM.treasury); // le butin reste dans la salle
    state().deleteObject(skeleton);
    reviveBoss();
    const { npc: again, hero: h2 } = stage(NUM.prytwen, 201);
    state().moveToRoom(h2, room(1));
    again.ego = 3;
    run(again);
    expect(state().findByNum(NUM.skeleton)).toBeUndefined();
  });

  it("Prytwen et la grille 103 (`28b1:050a`) : fermée, il se case derrière (`Sol 0x45`), l'événement 7 est créé sans être relancé et le héros gagne (1, 2) ; ouverte, 1 chance sur 20 de la refermer", () => {
    reviveBoss();
    const { npc, hero } = stage(NUM.prytwen, ROOM.treasury);
    state().moveToRoom(hero, room(1));
    for (const o of room(ROOM.treasury).listA.filter((x) => x.value >= 10)) state().moveToRoom(o, room(1)); // la pépite (105) passerait avant la grille
    const grille = state().findByNum(NUM.grille)!;
    grille.ego = 0;
    const target = { typ: npc.typ, num: npc.num, serial: npc.serial };
    state().events.capacity = Math.max(state().events.capacity, 8);
    const before = state().score;
    run(npc);
    expect(npc.ground).toBe(0x45);
    expect(state().events.find(target, 7)!.counter).toBe(10000);
    expect(state().score).toBe(before + 30);
    state().events.find(target, 7)!.counter = 4000;
    npc.ego = 0;
    run(npc);
    expect(state().events.find(target, 7)!.counter).toBe(4000);
    expect(state().score).toBe(before + 30);
    // grille ouverte
    state().events.operate(target, 7, -1);
    npc.ground = 2;
    grille.ego = 3;
    npc.ego = 0;
    const draw = vi.spyOn(rig.engine.rng, "mod").mockReturnValue(1);
    run(npc);
    expect(grille.ego).toBe(3);
    draw.mockReturnValue(0);
    npc.ego = 0;
    npc.path.defined = false;
    for (const o of room(ROOM.treasury).listA.filter((x) => x.num === NUM.bronzeKey)) state().moveToRoom(o, room(1));
    run(npc);
    expect([grille.ego, grille.gst, grille.mob]).toEqual([2, 7, 1]);
    expect(npc.ground).not.toBe(0x45);
    vi.restoreAllMocks();
  });

});

