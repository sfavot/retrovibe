import { describe, expect, it } from "vitest";
import { MessageTable, messageId } from "../../src/games/armaeth/data/text";
import { loadWorldState, serializeWorld } from "../../src/games/armaeth/engine/save";
import type { GameObject, WorldState } from "../../src/games/armaeth/engine/state";
import { EngineAbort } from "../../src/games/armaeth/engine/update";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { Player } from "./player";

/**
 * Minas Thyl (`game/npc-minas.ts`, `characters.md` § 7.5) jouée sur le moteur complet : la capture du héros dans son antre et la
 * séquence du chaudron (`2dd9:0858`, `0c80`, `02da`), la reprise de la baguette (`2dd9:0afc`) et les autres issues du contact. Les
 * scènes sont des mondes sauvegardés (A1FCFG.SYS modifié puis chargé comme une partie sauvegardée) : le héros n'est jamais téléporté
 * en cours de partie. Les contacts sont provoqués comme le moteur le fait (`Col` = série de l'objet touché, `Err 9`).
 */

const table = hasOriginalFiles ? new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS")) : null;
const g = (n: number): string => table!.messages(messageId("G", n));

const LAIR = 301;
const HALL = 302;

interface Scene {
  p: Player;
  state: WorldState;
  hero: GameObject;
  minas: GameObject;
  /** Messages lus depuis le début de la scène (`pump`). */
  said: string[];
}

/** Monde de départ modifié par `setup`, chargé comme une sauvegarde (hero et Minas Thyl dans `roomId`, côte à côte). */
function scene(roomId: number, setup: (state: WorldState, hero: GameObject, minas: GameObject) => void = () => {}, quiet = false): Scene {
  const world = loadWorldState(readOriginal("A1FCFG.SYS"));
  const hero = world.hero!;
  const minas = world.findByNum(303)!;
  const room = world.roomById(roomId)!;
  world.moveToRoom(hero, room);
  world.moveToRoom(minas, room);
  world.currentRoom = roomId;
  hero.x = 100;
  hero.y = 100;
  hero.p = 60;
  minas.x = 135;
  minas.y = 100;
  minas.p = 56;
  setup(world, hero, minas);
  // `quiet` : Minas Thyl « pilotée » (`Ctl` +0x40) ne décide rien (`2dd9:03e8`) : seuls les contacts provoqués agissent
  if (quiet) minas.raw[0x40] = 1;
  const p = new Player();
  p.skipIntro();
  p.host.storage.write("scene", serializeWorld(world));
  p.engine.loadGame("scene");
  p.run(30);
  const state = p.engine.state!;
  const s: Scene = { p, state, hero: state.hero!, minas: state.findByNum(303)!, said: [] };
  s.said.push(...p.drain());
  if (quiet) s.said.length = 0;
  return s;
}

/** Comme `scene`, Minas Thyl ne décide rien : seuls les contacts provoqués agissent. */
const quietScene = (roomId: number, setup?: (state: WorldState, hero: GameObject, minas: GameObject) => void): Scene => scene(roomId, setup, true);

/** Fait avancer `frames` images en lisant les messages. */
function pump(s: Scene, frames: number): void {
  for (let i = 0; i < frames; i += 5) {
    s.p.run(5);
    s.said.push(...s.p.drain(2));
  }
}

/** Fait avancer jusqu'à `done()` (au plus `max` images). */
function until(s: Scene, done: () => boolean, max = 3000): boolean {
  for (let i = 0; i < max && !done(); i += 5) pump(s, 5);
  return done();
}

/** Contact tel que le moteur le signale à Minas Thyl : `Col` = série de l'objet touché, `Err 9`. */
function touch(s: Scene, other: GameObject): void {
  s.minas.col = other.serial;
  s.minas.err = 9;
  // une image à la fois : le contact remet `Err` à 0 dans le tic qui le traite, on s'arrête là (le tic suivant ferait avancer Minas Thyl)
  for (let i = 0; i < 16 && s.minas.err === 9; i++) {
    s.p.run(1);
    s.said.push(...s.p.drain(1));
  }
  s.said.push(...s.p.drain(2));
}

const give = (state: WorldState, holder: GameObject, ...nums: number[]): void => {
  for (const num of nums) state.moveToContainer(state.findByNum(num)!, holder);
};
const holds = (holder: GameObject, num: number): boolean => holder.contents.some((o) => o.num === num);
/** Octets libres de Minas Thyl (`+0x20` a eu la baguette, `+0x42` avertissements, `+0x43` pacte proposé). */
const field = (o: GameObject, offset: number): number => o.raw[offset]!;

describe.skipIf(!hasOriginalFiles)("Minas Thyl : la capture dans l'antre et le chaudron (2dd9:0954, 0c80, 02da)", () => {
  it("sans baguette, elle vient vers le héros (G321), le saisit dans l'antre (G323), vide ses poches (G366) et l'emmène au chaudron", () => {
    const s = scene(LAIR, (w, hero) => give(w, hero, 6, 109));
    const cauldron = s.state.findByNum(306)!;
    expect(s.minas.ego).toBe(0);
    expect(s.hero.contents.map((o) => o.num).sort((a, b) => a - b)).toEqual([6, 109]);

    expect(until(s, () => s.minas.ego === 4, 200)).toBe(true);
    // elle marche vers le chaudron en le suivant (le joueur a perdu la main)
    const snap = { mob: s.minas.mob, walking: s.minas.path.defined, control: s.state.moveEnabled };
    pump(s, 20);
    // le héros : animation 1 (10 pas de 250 tics, partenaire Minas), `Ego 6`, posé sur le chaudron, poches vides
    expect(s.hero.ego).toBe(6);
    expect(s.hero.animId).toBe(1);
    expect([s.hero.x, s.hero.y, s.hero.p]).toEqual([cauldron.x, cauldron.y, cauldron.p]);
    expect(s.hero.contents).toHaveLength(0);
    expect(holds(s.minas, 6) && holds(s.minas, 109)).toBe(true);
    expect(snap).toEqual({ mob: 2, walking: true, control: false });
    expect(s.said).toEqual([g(321), g(323), g(366)]);
  });

  it("arrivée au chaudron : animation 34 (G364), elle prend sa place (P + 2), le chaudron bout (Ego 1)", () => {
    const s = scene(LAIR);
    const cauldron = s.state.findByNum(306)!;
    expect(until(s, () => s.minas.animId === 34, 400)).toBe(true);
    pump(s, 10);
    expect(s.minas.ego).toBe(6);
    expect([s.minas.x, s.minas.y, s.minas.p]).toEqual([cauldron.x, cauldron.y, cauldron.p + 2]);
    expect(cauldron.ego).toBe(1);
    expect(s.said).toContain(g(364));
    // la victime est liée (`Bag`) : le héros vit encore pendant les 16 boucles de l'animation
    expect(s.state.hero).toBe(s.hero);
  });

  it("fin de l'animation : G307, le héros est remplacé par une dépouille de variante 2, Minas Thyl recule de 4 et reprend Ego 0 ; le chaudron redevient Ego 0 avec la dépouille", () => {
    const s = scene(LAIR);
    const cauldron = s.state.findByNum(306)!;
    const score = s.state.score;
    expect(until(s, () => s.state.hero === null, 1500)).toBe(true);
    // Minas Thyl au tic même de la dépouille (le tic suivant la fait marcher)
    const after = { p: s.minas.p, ego: s.minas.ego, mob: s.minas.mob };
    pump(s, 10);
    expect(s.said).toEqual([g(321), g(323), g(364), g(307)]);
    const remains = s.state.findByNum(2)!;
    expect(remains.room?.id).toBe(LAIR);
    expect(remains.ego).toBe(2);
    expect([remains.x, remains.y, remains.p]).toEqual([cauldron.x, cauldron.y, cauldron.p + 2]);
    expect(after).toEqual({ p: cauldron.p - 2, ego: 0, mob: 2 });
    expect(s.state.score).toBe(score);
    // 5 étapes de 100 tics : le chaudron ne cesse de bouillir qu'avec la dépouille
    expect(cauldron.ego).toBe(1);
    expect(until(s, () => cauldron.ego === 0, 6000)).toBe(true);
  });

  it("le héros invisible n'est pas capturé : elle sent « quelque chose » (G337) et se tourne vers lui", () => {
    const s = quietScene(LAIR, (_w, hero) => {
      hero.hidden = 1;
    });
    touch(s, s.hero);
    expect(s.said).toEqual([g(337)]);
    expect(s.minas.ego).toBe(0);
    expect(s.hero.ego).toBe(0);
  });

  it("le héros dans un état qui ne se capture pas (Ego 4, chute) est ignoré ; Minas Thyl en Ego 5 ne capture pas non plus", () => {
    const s = quietScene(LAIR);
    s.hero.ego = 4;
    touch(s, s.hero);
    expect(s.said).toEqual([]);
    expect(s.minas.ego).not.toBe(4);
    const t = quietScene(LAIR, (_w, _hero, minas) => {
      minas.ego = 5;
    });
    touch(t, t.hero);
    expect(t.said).toEqual([]);
    expect(t.hero.ego).toBe(0);
  });
});

describe.skipIf(!hasOriginalFiles)("Minas Thyl : le contact avec le héros hors de l'antre (2dd9:0a1e..0afc)", () => {
  it("sans baguette sur lui : le pacte (G325) une seule fois, puis G326 ; elle passe Ego 5", () => {
    const s = quietScene(HALL);
    touch(s, s.hero);
    expect(s.said).toEqual([g(325)]);
    expect(s.minas.ego).toBe(5);
    expect(field(s.minas, 0x43)).toBe(1);
    s.minas.ego = 0;
    s.said.length = 0;
    touch(s, s.hero);
    expect(s.said).toEqual([g(326)]);
    expect(field(s.minas, 0x43)).toBe(2);
  });

  it("si elle a déjà eu puis reperdu sa baguette, le pacte devient G369", () => {
    const s = quietScene(HALL, (_w, _hero, minas) => {
      minas.raw[0x20] = 7;
    });
    touch(s, s.hero);
    expect(s.said).toEqual([g(369)]);
  });

  it("la baguette sur lui, l'épée aussi : exigence G327 (G343 si elle n'a plus le talisman) ; Ego 5, rien n'est pris", () => {
    const s = quietScene(HALL, (w, hero) => give(w, hero, 320, 314));
    touch(s, s.hero);
    expect(s.said).toEqual([g(327)]);
    expect(s.minas.ego).toBe(5);
    expect(holds(s.hero, 320)).toBe(true);

    const t = quietScene(HALL, (w, hero, minas) => {
      give(w, hero, 320, 314);
      w.deleteObject(minas.contents.find((o) => o.num === 321)!);
    });
    touch(t, t.hero);
    expect(t.said).toEqual([g(343)]);
  });

  it("la baguette sans l'épée, première fois : reprise (G328), objets convoités pris (G331), +0x20 = 7, 3 avertissements, disparition (anim 45, G329)", () => {
    const s = quietScene(HALL, (w, hero) => give(w, hero, 320, 313, 6));
    touch(s, s.hero);
    expect(s.said).toEqual([g(328), g(331), g(329)]);
    expect(holds(s.minas, 320)).toBe(true);
    expect(holds(s.minas, 313)).toBe(true);
    expect(holds(s.hero, 6)).toBe(true); // la clef d'or ne l'intéresse pas
    expect(holds(s.hero, 320) || holds(s.hero, 313)).toBe(false);
    expect(field(s.minas, 0x20)).toBe(7);
    expect(field(s.minas, 0x42)).toBe(3);
    expect(s.minas.ego).toBe(6);
    expect(s.minas.animId).toBe(45);
    expect(s.state.hero).toBe(s.hero);
  });

  it("la baguette sans l'épée, sans autre objet convoité : pas de G331", () => {
    const s = quietScene(HALL, (w, hero) => give(w, hero, 320));
    touch(s, s.hero);
    expect(s.said).toEqual([g(328), g(329)]);
  });

  it("la baguette sans l'épée, quand elle l'a déjà eue : elle la reprend et jette le sort de crapaud (G365) ; le héros devient crapaud", () => {
    const s = quietScene(HALL, (w, hero, minas) => {
      give(w, hero, 320);
      minas.raw[0x20] = 7;
    });
    touch(s, s.hero);
    expect(s.said.slice(0, 1)).toEqual([g(365)]);
    expect(holds(s.minas, 320)).toBe(true);
    expect(s.minas.ego).toBe(1);
    expect(s.state.hero?.num).toBe(327);
  });

  it("avec la baguette : trois avertissements (G319, G318, G317) en Ego 2, puis le sort de crapaud (G324)", () => {
    const s = quietScene(HALL, (w, _hero, minas) => {
      give(w, minas, 320);
      minas.raw[0x42] = 3;
    });
    const seen: string[] = [];
    for (const expected of [319, 318, 317]) {
      s.minas.ego = 0;
      s.said.length = 0;
      touch(s, s.hero);
      seen.push(...s.said);
      expect(s.said).toEqual([g(expected)]);
      // `Ego 2` (G317..G319) puis, dans le même tic, l'état 2 lance l'animation d'apparition (44, `Ego 6`)
      expect(s.minas.ego).toBe(6);
      expect(s.minas.animId).toBe(44);
      s.minas.animId = 0;
    }
    expect(field(s.minas, 0x42)).toBe(0);
    s.minas.ego = 0;
    s.said.length = 0;
    touch(s, s.hero);
    expect(s.said[0]).toBe(g(324));
    expect(s.state.hero?.num).toBe(327);
    expect(seen).toHaveLength(3);
  });

  it("avec la baguette, si elle suit le héros : elle attend ce qu'il offre (G368, Ego 5)", () => {
    const s = quietScene(HALL, (w, _hero, minas) => give(w, minas, 320));
    s.minas.raw[0x7a] = s.hero.serial & 0xff;
    s.minas.raw[0x7b] = s.hero.serial >> 8;
    touch(s, s.hero);
    expect(s.said).toEqual([g(368)]);
    expect(s.minas.ego).toBe(5);
  });
});

describe.skipIf(!hasOriginalFiles)("Minas Thyl : les autres contacts (2dd9:0858)", () => {
  it("l'émeraude : elle la ramasse (hors de l'antre) ; dans l'antre elle ne ramasse que la baguette et le talisman", () => {
    const s = quietScene(HALL, (w, hero) => {
      const emerald = w.findByNum(313)!;
      w.moveToRoom(emerald, hero.room!);
      emerald.x = 120;
      emerald.y = 100;
      emerald.p = 58;
    });
    const emerald = s.state.findByNum(313)!;
    touch(s, emerald);
    expect(emerald.holder).toBe(s.minas);

    const lair = quietScene(LAIR, (w, hero) => {
      const emerald = w.findByNum(313)!;
      w.moveToRoom(emerald, hero.room!);
      const wand = w.findByNum(320)!;
      w.moveToRoom(wand, hero.room!);
    });
    touch(lair, lair.state.findByNum(313)!);
    expect(lair.state.findByNum(313)!.holder).toBeNull();
    touch(lair, lair.state.findByNum(320)!);
    expect(lair.state.findByNum(320)!.holder).toBe(lair.minas);
    expect(field(lair.minas, 0x20)).toBe(7);
  });

  it("un nain libre (Ego 0) : avec la baguette, sort de crapaud (G324) ; sans, elle lui fait les poches (G330)", () => {
    const withWand = quietScene(HALL, (w, hero, minas) => {
      give(w, minas, 320);
      const dwarf = w.findByNum(201)!;
      w.moveToRoom(dwarf, hero.room!);
      dwarf.ego = 0;
    });
    const dwarf = withWand.state.findByNum(201)!;
    touch(withWand, dwarf);
    expect(withWand.said).toEqual([g(324)]);
    expect(withWand.minas.ego).toBe(1);

    const bare = quietScene(HALL, (w, hero) => {
      const d = w.findByNum(201)!;
      w.moveToRoom(d, hero.room!);
      d.ego = 0;
      give(w, d, 313);
    });
    touch(bare, bare.state.findByNum(201)!);
    expect(bare.said).toEqual([g(330)]);
    expect(holds(bare.minas, 313)).toBe(true);
  });

  it("le Sarhûl : avec la baguette elle disparaît (animation 45, sans message)", () => {
    let serial = 0;
    const s = quietScene(HALL, (w, hero, minas) => {
      give(w, minas, 320);
      const sarhul = w.findByNum(302)!;
      serial = sarhul.serial;
      w.moveToRoom(sarhul, hero.room!);
    });
    touch(s, s.state.findBySerial(serial)!);
    expect(s.minas.ego).toBe(6);
    expect(s.minas.animId).toBe(45);
    expect(s.said).toEqual([]);
  });
});

describe.skipIf(!hasOriginalFiles)("Minas Thyl : la décision (2dd9:03e0..0842)", () => {
  it("avec la baguette hors de l'antre, le héros en vue : disparition (animation 45) avec l'avertissement G319, puis G318, G317, enfin le sort (G320)", () => {
    const s = scene(HALL, (w, _hero, minas) => {
      give(w, minas, 320);
      minas.raw[0x42] = 3;
    });
    expect(until(s, () => s.minas.animId === 45, 60)).toBe(true);
    expect(s.said).toEqual([g(319)]);
    expect(field(s.minas, 0x42)).toBe(2);
    expect(s.minas.ego).toBe(6);

    const t = scene(HALL, (w, _hero, minas) => give(w, minas, 320));
    expect(until(t, () => t.state.hero?.num === 327, 60)).toBe(true);
    expect(t.said[0]).toBe(g(320));
  });

  it("avec la baguette dans l'antre : elle dit G322 et va vers le héros (suivi), sans l'avertir", () => {
    const s = scene(LAIR, (w, _hero, minas) => give(w, minas, 320));
    expect(until(s, () => s.minas.path.defined, 60)).toBe(true);
    expect(s.said[0]).toBe(g(322));
    expect(s.minas.raw[0x42]).toBe(0);
  });

  it("hors de la salle chargée, dans l'antre, elle dépose son butin (Sol 0x53) mais garde la baguette et le talisman", () => {
    const s = scene(HALL, (w, _hero, minas) => {
      w.moveToRoom(minas, w.roomById(LAIR)!);
      give(w, minas, 6, 109, 320);
    });
    expect(s.minas.room?.id).toBe(LAIR);
    expect(until(s, () => !holds(s.minas, 6), 60)).toBe(true);
    const key = s.state.findByNum(6)!;
    expect(key.room?.id).toBe(LAIR);
    expect(key.ground).toBe(0x53);
    expect(s.state.findByNum(109)!.room?.id).toBe(LAIR);
    expect(holds(s.minas, 320) && holds(s.minas, 321)).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("Minas Thyl : fin d'attente (2dd9:0182) et animation 1 du héros sans fin (2594:0276)", () => {
  it("Ego 5, séquence finie, aucune sortie possible : elle disparaît (animation 45), baguette ou non (le pointeur de pile lu en 2dd9:01c3 n'est jamais nul)", () => {
    for (const withWand of [false, true]) {
      const s = quietScene(HALL, (w, _hero, minas) => {
        const lair = w.roomById(LAIR)!;
        lair.exits.fill(0); // `228e:0000` n'a aucune sortie à choisir : il rend 0 et `2dd9:01c3` est atteint
        w.moveToRoom(minas, lair); // hors de la salle chargée : la séquence est finie d'office (`1833:0336`)
        minas.ego = 5;
        minas.fig = 5;
        minas.mob = 1;
        if (withWand) give(w, minas, 320);
      });
      expect(until(s, () => s.minas.animId === 45, 200)).toBe(true);
      expect(s.minas.ego).toBe(6);
      expect(field(s.minas, 0x2c)).toBe(0);
    }
  });

  it("animation 1 du héros capturé : si Minas Thyl n'arrive jamais au chaudron, la table 2594:0276 n'a pas d'issue pour l'id 1 : gm_abort(0x42) (« * Err 066 * »)", () => {
    const s = scene(LAIR);
    expect(until(s, () => s.hero.animId === 1, 400)).toBe(true);
    s.minas.gst = 0; // Minas Thyl ne bouge plus : l'animation de 10 pas de 250 tics va à son terme
    let failure: unknown;
    try {
      pump(s, 20000); // 2500 tics de monde à 7 images ; les fenêtres de message arrêtent le monde : `pump` les lit
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(EngineAbort);
    expect((failure as EngineAbort).code).toBe(0x42);
  });
});

describe.skipIf(!hasOriginalFiles)("Minas Thyl : la lave (2dd9:002e, 1440, 1510, 0358)", () => {
  it("posée sur la lave (Err 0x11), elle sombre 10 tics plus tard : G309 (le héros est là), puis G308, +40 points (3, 0) ; elle disparaît en laissant ce qu'elle porte", () => {
    const s = quietScene(HALL, (w, _hero, minas) => give(w, minas, 320));
    const score = s.state.score;
    s.minas.ground = 0x34;
    s.minas.err = 0x11;
    expect(until(s, () => s.minas.animId === 36, 400)).toBe(true);
    pump(s, 20);
    expect(s.minas.ego).toBe(6);
    expect(s.said).toEqual([g(309)]);
    expect(until(s, () => s.state.findByNum(303) === undefined || s.state.findByNum(303)!.room === null, 600)).toBe(true);
    pump(s, 20);
    expect(s.said).toContain(g(308));
    expect(s.state.score).toBe(score + 40);
    // ce qu'elle portait reste dans la salle
    expect(s.state.findByNum(320)!.holder).toBeNull();
    expect(s.state.findByNum(320)!.room?.id).toBe(HALL);
  });

  it("le héros dans une autre salle entend la voix (G370 au lieu de G309)", () => {
    const s = quietScene(HALL, (w, hero, minas) => {
      w.moveToRoom(hero, w.roomById(1)!);
      w.currentRoom = 1;
      w.moveToRoom(minas, w.roomById(HALL)!);
    });
    s.minas.ground = 0x34;
    s.minas.err = 0x11;
    expect(until(s, () => s.minas.animId === 36, 400)).toBe(true);
    pump(s, 20);
    expect(s.said).toEqual([g(370)]);
  });
});
