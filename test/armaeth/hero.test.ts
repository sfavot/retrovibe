import { beforeAll, describe, expect, it, vi } from "vitest";
import { MessageTable, messageId } from "../../src/games/armaeth/data/text";
import { parseAni } from "../../src/games/armaeth/data/tables";
import { ArmaethEngine } from "../../src/games/armaeth/engine/engine";
import type { BehaviorContext } from "../../src/games/armaeth/engine/handlers";
import type { GameObject } from "../../src/games/armaeth/engine/state";
import { HERO_ANIMATIONS, acceptsGround, continueGame, registerCorpse, registerHero } from "../../src/games/armaeth/game/hero";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { TestHost } from "./test-host";

/** Le héros complet (`246c:000a` et états) branché sur le moteur, sur les vraies données. */

const messages = () => new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS"));

class Session {
  readonly host = new TestHost();
  readonly engine = new ArmaethEngine(this.host, { seed: 1, bare: true });

  constructor() {
    registerHero(this.engine.registry, {
      sprites: this.engine.sprites,
      ani: parseAni(readOriginal("A1FANI.SYS")),
      limits: () => this.engine.currentTerrain?.limits ?? null,
    });
    registerCorpse(this.engine.registry);
  }

  /** `ticks` images ; les fenêtres de message ouvertes sont validées au fur et à mesure. */
  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      this.engine.tick();
      if (this.engine.windows.active) this.click();
    }
  }

  /** Avance jusqu'à ce que la condition soit vraie (au plus `max` images). */
  until(cond: () => boolean, max = 6000): void {
    for (let i = 0; i < max && !cond(); i++) this.run(1);
    expect(cond()).toBe(true);
  }

  click(): void {
    this.host.pointer(100, 100, 1);
    this.engine.tick();
    this.host.pointer(100, 100, 0);
    this.engine.tick();
  }

  skipIntro(): void {
    this.run(2000);
    while (this.engine.windows.active) this.click();
    this.run(320);
  }

  get hero(): GameObject {
    return this.engine.state!.hero!;
  }

  get ctx(): BehaviorContext {
    return (this.engine as unknown as { services: BehaviorContext }).services;
  }
}

describe.skipIf(!hasOriginalFiles)("héros complet (fichiers du jeu)", () => {
  let s: Session;
  beforeAll(() => {
    s = new Session();
    s.skipIntro();
  });

  it("le héros enregistré remplace le noyau minimal : marche aux flèches et reste sur le sol", () => {
    const hero = s.hero;
    expect(hero.ego).toBe(0);
    const x0 = hero.x;
    s.host.key({ type: "nav", key: "left" });
    s.run(60);
    expect(hero.x).toBeLessThan(x0);
    s.host.key({ type: "nav", key: "left" });
    s.run(20);
    expect(hero.ego).toBe(0);
    expect(s.engine.missing.has("2:1")).toBe(false);
  });

  it("bottes : le trajet du clic est suivi jusqu'à l'arrivée", () => {
    const hero = s.hero;
    s.host.pointer(284, 10, 1);
    s.run(2);
    s.host.pointer(284, 10, 0);
    s.run(2);
    s.host.pointer(150, 130, 1);
    s.run(2);
    s.host.pointer(150, 130, 0);
    s.run(2);
    expect(hero.path.defined).toBe(true);
    s.run(1000);
    expect(hero.path.defined).toBe(false);
    expect(Math.abs(hero.x - 146)).toBeLessThanOrEqual(3);
    expect(hero.err).toBe(0);
  });

  it("sortie de salle : le bord gauche de la salle 1 mène à la salle 17", () => {
    const t = new Session();
    t.skipIntro();
    t.host.key({ type: "nav", key: "left" });
    for (let i = 0; i < 80 && t.engine.state!.loadedRoom!.id === 1; i++) t.run(20);
    expect(t.engine.state!.loadedRoom!.id).toBe(17);
    t.run(5);
    expect(t.hero.room).toBe(t.engine.state!.loadedRoom);
  });

  it("chute : Err 5 sans trajet entre dans Ego 4 (Dep 3) ; un atterrissage court assomme 100 tics puis la marche reprend", () => {
    const t = new Session();
    t.skipIntro();
    const hero = t.hero;
    hero.err = 5;
    t.until(() => hero.ego === 4, 20);
    expect(hero.dep).toBe(3);
    // atterrissage : Err 7, Inf = type 2, Tim = 3 tics de chute
    hero.err = 7;
    hero.info = 2;
    hero.tim = 3;
    t.until(() => hero.ego === 5, 20);
    expect(hero.mob).toBe(1);
    expect(hero.dep).toBe(0);
    expect(t.engine.state!.moveEnabled).toBe(false);
    t.run(10);
    expect(hero.ego).toBe(5);
    // le KO dure 100 tics de monde (7 images chacun)
    t.run(800);
    expect(hero.ego).toBe(0);
    expect(hero.mob).toBe(2);
    expect(t.engine.state!.moveEnabled).toBe(true);
  });

  it("atterrissage long sur le sol : animation 43, jingle E4, dépouille variante 0 qui garde l'inventaire", () => {
    const t = new Session();
    t.skipIntro();
    const play = vi.spyOn(t.engine.sequencer, "play");
    const hero = t.hero;
    const item = t.engine.state!.createObject({ typ: 2, num: 6, gst: 0, mob: 0, weight: 1, pickable: 7 });
    t.engine.state!.moveToContainer(item, hero);
    hero.err = 5;
    t.until(() => hero.ego === 4, 20);
    hero.err = 7;
    hero.info = 2;
    hero.tim = 20;
    t.until(() => hero.ego === 6, 20);
    expect(hero.animId).toBe(43);
    t.until(() => t.engine.state!.hero === null);
    expect(play.mock.calls.some((c) => c[0] === 0x0e && c[1] === "E" && c[2] === 4)).toBe(true);
    const corpse = t.engine.state!.findByNum(2)!;
    expect(corpse).toBeDefined();
    expect(corpse.ego).toBe(0);
    expect(corpse.contents).toContain(item);
    expect(corpse.tim).toBeGreaterThan(1000);
  });

  it("eau glacée (Sol 47) : noyade, jingle E4, héros détruit et contenu détruit ; S16 puis résurrection (S24, centre de la salle)", () => {
    const t = new Session();
    t.skipIntro();
    const play = vi.spyOn(t.engine.sequencer, "play");
    const hero = t.hero;
    const item = t.engine.state!.createObject({ typ: 2, num: 6, gst: 0, mob: 0, weight: 1, pickable: 7 });
    t.engine.state!.moveToContainer(item, hero);
    hero.ground = 47;
    hero.err = 0x11;
    t.until(() => hero.ego === 6, 20);
    expect(hero.animId).toBe(2);
    t.until(() => t.engine.state!.hero === null);
    expect(t.engine.state!.findByNum(2)).toBeUndefined();
    expect(t.engine.state!.findBySerial(item.serial)).toBeUndefined();
    expect(play.mock.calls.some((c) => c[0] === 0x0e && c[1] === "E" && c[2] === 4)).toBe(true);

    // sans héros, toute commande affiche S16 (les fenêtres de mort sont d'abord validées)
    for (let i = 0; i < 10 && (t.engine.windows.active || t.engine.pendingWindowCount > 0); i++) {
      t.click();
      t.run(1);
    }
    t.engine.submitLine("regarder");
    t.engine.tick();
    expect(t.engine.windows.text).toBe(messages().messages(messageId("S", 16)));
    t.click();
    t.run(2);

    // `continuer` (F4) : S46/S47 si le héros existe, sinon recréation avec S24
    expect(continueGame(t.ctx, { sprites: t.engine.sprites, limits: () => t.engine.currentTerrain!.limits })).toBe("created");
    const back = t.engine.state!.hero!;
    expect(back.num).toBe(1);
    const limits = t.engine.currentTerrain!.limits;
    expect([back.x, back.p, back.presence]).toEqual([Math.trunc(limits.xMax / 2), Math.trunc(limits.pMax / 2), 1]);
    expect(back).toMatchObject({ gst: 7, mob: 2, ego: 0, weight: 800, capacity: 500 });
    t.engine.tick();
    expect(t.engine.windows.text).toBe(messages().messages(messageId("S", 24)));
    t.click();
    t.run(20);
    expect(back.presence).toBe(2); // posé par le déplacement
    expect(back.room).toBe(t.engine.state!.loadedRoom);
    expect(back.ego).toBe(0);
    // un deuxième `continuer` avec le héros présent n'en crée pas un autre
    expect(continueGame(t.ctx)).toBe("present");
    expect(t.engine.state!.objects.filter((o) => o.num === 1)).toHaveLength(1);
  });

  it("frelons (Sol 37, visible) : dépouille variante 0 qui garde l'inventaire ; invisible : rien", () => {
    const t = new Session();
    t.skipIntro();
    const hero = t.hero;
    const item = t.engine.state!.createObject({ typ: 2, num: 6, gst: 0, mob: 0, weight: 1, pickable: 7 });
    t.engine.state!.moveToContainer(item, hero);
    hero.ground = 37;
    hero.hidden = 1;
    hero.err = 0x11;
    t.run(2);
    expect(hero.ego).toBe(0);
    hero.hidden = 0;
    hero.err = 0x11;
    t.until(() => hero.animId === 5, 20);
    t.until(() => t.engine.state!.hero === null);
    const corpse = t.engine.state!.findByNum(2)!;
    expect(corpse.contents).toContain(item);
  });

  it("Err 0x0E : disparition, héros détruit sans reste", () => {
    const t = new Session();
    t.skipIntro();
    t.hero.err = 0x0e;
    t.until(() => t.engine.state!.hero === null, 30);
    expect(t.engine.state!.findByNum(2)).toBeUndefined();
  });

  it("eau profonde (Sol 5) : Ego 1, Fig 3 et événement différé 10 armé ; Sol 2 : retour à Ego 0", () => {
    const t = new Session();
    t.skipIntro();
    const hero = t.hero;
    hero.ground = 5;
    hero.err = 0x11;
    t.until(() => hero.ego === 1, 20);
    expect(hero.fig).toBe(3);
    const event = t.engine.state!.events.entries.find((e) => e.event === 10)!;
    expect(event.procedure).toBe(1);
    expect(event.counter).toBeGreaterThan(800); // sans charge m = 100 : 900 tics
    hero.ground = 2;
    hero.err = 0x11;
    t.until(() => hero.ego === 0, 20);
    expect(hero.fig).toBe(0);
  });

  it("table des animations : 15 conséquences documentées", () => {
    expect(Object.keys(HERO_ANIMATIONS)).toHaveLength(15);
  });

  it("acceptsGround : eau réservée au héros nageant, sol vide refusé, types non listés acceptés", () => {
    expect(acceptsGround(1, 0, 5)).toBe(true);
    expect(acceptsGround(1, 4, 5)).toBe(false);
    expect(acceptsGround(1, 6, 5, { anm: 19 })).toBe(true);
    expect(acceptsGround(4, 0, 5)).toBe(false);
    expect(acceptsGround(23, 0, 3)).toBe(true);
    expect(acceptsGround(201, 0, 38)).toBe(false);
    expect(acceptsGround(1, 8, 35)).toBe(false);
    expect(acceptsGround(1, 0, 35)).toBe(true);
    expect(acceptsGround(1, 0, 0)).toBe(false);
    expect(acceptsGround(1, 0, 2)).toBe(true);
    expect(acceptsGround(4, 0, 12)).toBe(true);
  });
});
