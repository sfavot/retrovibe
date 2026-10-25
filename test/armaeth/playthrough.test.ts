import { describe, expect, it } from "vitest";
import { Lcg } from "../../src/engine/rng";
import { MessageTable, messageId } from "../../src/games/armaeth/data/text";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { Player, snapshot } from "./player";

/**
 * Parties complètes sur le moteur muni de tous ses modules de jeu (`ArmaethEngine` par défaut, sans `bare`) : une vraie
 * ouverture de partie jouée comme un joueur (clics pour passer l'introduction, commandes tapées, clics des bottes, flèches), puis
 * une partie au hasard qui ne doit ni lever d'exception ni laisser de procédure manquante.
 */

const messages = () => new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS"));
const table = hasOriginalFiles ? messages() : null;
const text = (cls: string | number, n: number): string => table!.messages(messageId(cls, n));

describe.skipIf(!hasOriginalFiles)("partie : début du chapitre 1", () => {
  it("de l'introduction à la mort par les frelons et à la résurrection, salle par salle", () => {
    const p = new Player();

    // --- 1. l'introduction, passée à coups de clics --------------------------------------------------------------------------
    const intro = p.skipIntro();
    expect(intro).toHaveLength(12); // 10 paragraphes du récit (CM2), puis S13 et S14 (événement différé 2000, salle 1)
    expect(intro[0]).toMatch(/^Il y a longtemps/);
    expect(intro.slice(-2)).toEqual([text("S", 13), text("S", 14)]);
    const state = p.state;
    expect(state.loadedRoom!.id).toBe(1);
    expect(state.hero).toMatchObject({ num: 1, ego: 0, x: 219, p: 113 });
    expect(p.engine.missing.size).toBe(0);
    snapshot(p.host, "start-room1");

    // --- 2. la salle 1 : description, décors nommés, inventaire, mot inconnu ------------------------------------------------------
    expect(p.say("regarder")).toEqual([text("L", 1)]);
    // « cascade » désigne deux décors (9001 et 9005) : un message `I` chacun
    expect(p.say("regarder la cascade").sort()).toEqual([text("I", 1), text("I", 5)].sort());
    expect(p.say("regarder l'arbre")).toEqual([text("I", 3)]);
    expect(p.say("inventaire")).toEqual([text("V", 36)]);
    expect(p.say("regarder le dragon")).toEqual([text("S", 15)]);
    expect(p.say("prendre la cascade")).toEqual([text("V", 20)]);

    // --- 3. un clic des bottes : le héros marche jusqu'au point -----------------------------------------------------------------
    const startX = state.hero!.x;
    p.walkTo(100, 130);
    expect(Math.abs(state.hero!.x - 100)).toBeLessThanOrEqual(25);
    expect(state.hero!.x).toBeLessThan(startX - 80);
    expect(state.hero!.path.defined).toBe(false);
    snapshot(p.host, "walk-room1");

    // --- 4. sortir par la gauche : salles 17 puis 16 -------------------------------------------------------------------------------
    expect(p.leave("left")).toBe(true);
    expect(state.loadedRoom!.id).toBe(17);
    expect(p.say("regarder")).toEqual([text("L", 17)]);
    expect(p.leave("left")).toBe(true);
    expect(state.loadedRoom!.id).toBe(16);
    snapshot(p.host, "room16");

    // --- 5. la ruche : description de l'objet, puis les frelons --------------------------------------------------------------------
    expect(state.loadedRoom!.listA.map((o) => o.num).sort()).toEqual([1, 24]);
    expect(p.say("regarder la ruche")).toEqual([text(0, 24)]);
    p.walkTo(42, 117); // clic des bottes à l'est de la ruche (X 42, P 52)...
    expect(state.hero!.x).toBeGreaterThan(30);
    p.host.key({ type: "nav", key: "down" }); // ... flèche vers l'avant jusqu'à la hauteur de la ruche (P 75)...
    for (let i = 0; i < 400 && state.hero!.p < 75; i++) p.run(5);
    p.host.key({ type: "nav", key: "left" }); // ... puis vers la gauche : la bande de sol 37 (X 8..27, P 72..79) est celle des frelons
    let sting: string[] = [];
    for (let i = 0; i < 600 && state.hero; i++) {
      p.run(5);
      sting = sting.concat(p.drain(4));
    }
    sting = sting.concat(p.drain());
    expect(sting).toEqual([text("G", 14), text("G", 24)]);
    expect(state.hero).toBeNull();
    const corpse = state.objects.find((o) => o.num === 2)!;
    expect(corpse.room!.id).toBe(16);
    expect([corpse.ego, corpse.fig]).toEqual([0, 0]); // dépouille de la variante 0 (frelons), à la place du héros
    snapshot(p.host, "dead");
    expect(p.say("inventaire")).toEqual([text("S", 16)]); // « puisque vous n'existez plus »

    // --- 6. la résurrection (F4 / « continuer ») ----------------------------------------------------------------------------------
    expect(p.say("continuer")).toEqual([text("S", 24)]);
    expect(state.hero).toMatchObject({ num: 1, ego: 0 });
    expect(state.hero!.room!.id).toBe(16);
    expect(p.say("inventaire")).toEqual([text("V", 36)]);
    p.run(30);
    snapshot(p.host, "resurrected");

    // --- 7. le score : F6, aucun point gagné, et plus aucune procédure manquante --------------------------------------------------
    p.host.key({ type: "function", n: 6 });
    p.run(5);
    const [score] = p.drain();
    expect(score).toContain("0·points, pour un maximum possible de·725·points");
    expect(p.engine.missing.size).toBe(0);
  }, 60000);
});

describe.skipIf(!hasOriginalFiles)("partie : les premiers points (salles 5 et 11)", () => {
  it("arracher les ronces (+20, id 5) puis glisser la clef d'or dans la serrure de la stèle (+20, id 2) : 40 points", () => {
    const p = new Player();
    p.skipIntro();
    const go = (room: number) => {
      p.engine.sendToRoom(room, true); // jeton `trf` : le héros arrive par le placement libre
      for (let i = 0; i < 60 && p.state.loadedRoom?.id !== room; i++) {
        p.run(2);
        p.drain(3);
      }
      p.run(30);
      p.drain(5);
    };

    // --- salle 5 : le tapis de ronces est sur le plan 2 (trois plans tant que la stèle est fermée, `147f:000a`) -----------------------
    go(5);
    const hero = p.hero;
    p.walkTo(54, 122, 6000);
    p.walkTo(54, 122, 6000); // le premier clic s'arrête au bord du tapis (P 79), le second reste en place : la flèche finit la montée
    expect(hero.plane).toBe(2);
    expect(hero.ground).toBe(39); // « cases de l'arrachage des ronces » (`HERO.Sol == 0x27`)
    p.host.key({ type: "nav", key: "up" });
    for (let i = 0; i < 120; i++) p.run(5); // jusqu'au bord du tapis le plus proche des ronces (P 72, à portée : écart de P < 9)
    p.engine.resetMotion(hero);
    p.run(10);
    p.drain(10);
    expect(p.say("arracher les ronces")).toEqual([]);
    const discovery: string[] = [];
    for (let i = 0; i < 400 && p.state.score === 0; i++) {
      p.run(10);
      discovery.push(...p.drain(5));
    }
    expect(discovery).toEqual([text("G", 20)]); // la découverte de la stèle
    expect(p.state.score).toBe(20);
    expect(p.state.objects.find((o) => o.num === 16 && o.typ === 2)!.ego).toBe(5);
    expect(p.state.objects.some((o) => o.num === 20 && o.typ === 2)).toBe(false); // les ronces sont détruites

    // --- salle 11 : la clef d'or ; salle 5 : devant la serrure (sol 36) ------------------------------------------------------------
    go(11);
    expect(p.say("prendre la clef")).toEqual([text("V", 15)]);
    expect(p.hero.contents.map((o) => o.num)).toContain(6);
    go(5);
    p.walkTo(34, 118, 6000);
    expect(p.hero.ground).toBe(36);
    expect(p.say("ouvrir la stèle avec la clef")).toEqual([text("V", 60)]); // « ... le mécanisme reste bloqué »
    for (let i = 0; i < 100; i++) {
      p.run(10);
      p.drain(5);
    }
    expect(p.state.score).toBe(40);
    expect(p.state.objects.find((o) => o.num === 16 && o.typ === 2)!.ego).toBe(1);
    p.host.key({ type: "function", n: 6 });
    p.run(5);
    expect(p.drain()[0]).toContain("40·points, pour un maximum possible de·725·points");
    expect(p.engine.missing.size).toBe(0);
  }, 60000);
});

describe.skipIf(!hasOriginalFiles)("partie au hasard", () => {
  /** Mots tapés : des verbes et des noms du début du jeu, sans les commandes qui quittent ou rechargent la partie. */
  const WORDS = ["regarder", "prendre", "jeter", "ouvrir", "fermer", "fouiller", "inventaire", "lire", "parler", "monter", "descendre", "pousser", "tirer", "la", "le", "dans", "a", "cascade", "ruche", "pie", "nid", "ronces", "coffre", "coffret", "clef", "torche", "feu", "bois", "ours", "fouet", "pelle", "seau", "dalle", "arbre"];
  const KEYS = ["left", "right", "up", "down"] as const;
  /** Salles où l'on ne s'envoie pas : 0 (interface), 20 à 22 (écrans du titre et de la fin, sans terrain de marche). */
  const NOT_PLAYABLE = new Set([0, 20, 21, 22]);

  it("20 000 images de clics, de flèches et de commandes tirés d'une graine : aucune exception, aucune procédure manquante", () => {
    const rng = new Lcg(2024);
    const p = new Player({ seed: 7 });
    p.skipIntro();
    const reached = new Set<number>([p.state.loadedRoom!.id]);
    p.useBoots();
    const roomIds = p.state.rooms.map((r) => r.id).filter((id) => !NOT_PLAYABLE.has(id));
    for (let tick = 0; tick < 20000; tick++) {
      // toutes les 800 images le héros est envoyé dans une salle tirée au hasard (comme le jeton `trf` d'un script) : sans cela le
      // hasard ne sortirait guère de la salle de départ et les personnages des autres chapitres ne tourneraient jamais
      if (tick % 800 === 799 && p.state.hero) p.engine.sendToRoom(roomIds[rng.mod(roomIds.length)]!, true);
      if (tick % 20 === 0) {
        const roll = rng.mod(100);
        if (p.engine.windows.active) {
          // une fenêtre est ouverte : le joueur la ferme, au clic ou à Entrée, ou presse une touche quelconque
          if (roll < 50) p.host.pointer(8 + rng.mod(304), 20 + rng.mod(147), 1);
          else if (roll < 80) p.host.type("\r");
          else p.host.type("x");
        } else if (p.engine.inputLine.open && roll < 70) {
          // une phrase refusée reste dans la ligne de saisie : Échap la ferme, Retour arrière l'efface lettre à lettre
          p.host.type(roll < 55 ? "\x1b" : "\b");
        } else if (roll < 30) p.host.key({ type: "nav", key: KEYS[rng.mod(4)] });
        else if (roll < 55) p.host.pointer(8 + rng.mod(304), 20 + rng.mod(147), 1);
        else if (roll < 62) p.host.pointer(8 + rng.mod(304), 20 + rng.mod(147), 2);
        else if (roll < 70) p.host.pointer(rng.mod(320), rng.mod(20), 1); // la barre d'icônes : change d'outil
        else if (roll < 75) p.host.pointer(rng.mod(320), rng.mod(200), 0);
        else if (roll < 80) p.host.type("\r");
        else if (roll < 95) p.host.type(`${WORDS[rng.mod(WORDS.length)]} ${WORDS[rng.mod(WORDS.length)]} ${WORDS[rng.mod(WORDS.length)]}\r`);
        else p.host.key({ type: "function", n: [1, 4, 5, 6, 7, 8][rng.mod(6)]! }); // pas F2/F3 (sauvegarde) ni F9/F10 (quitter)
      }
      p.engine.tick();
      if (p.engine.state?.loadedRoom) reached.add(p.engine.state.loadedRoom.id);
    }
    expect(p.engine.quitRequested).toBe(false);
    expect(p.engine.frames).toBeGreaterThan(20000);
    expect([...p.engine.missing].filter((key) => /^[1-9]:/.test(key))).toEqual([]);
    expect(reached.size).toBeGreaterThanOrEqual(10); // le héros a visité une bonne partie du monde
  }, 60000);
});
