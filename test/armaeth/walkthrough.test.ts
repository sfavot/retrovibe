import { describe, expect, it } from "vitest";
import { MessageTable, messageId } from "../../src/games/armaeth/data/text";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { LAVA_PATH, Robot, RobotSetback } from "./robot";
import { castle, chapiterAndCrown, craterTrap, guardRoom, penSarhuls, riverAndLair, talisman, toSarhulPit, witchLair } from "./solution";

/**
 * Solution complète d'*Armaeth* jouée par un robot sur le moteur sans tête, du titre jusqu'au couronnement (`docs/armaeth/walkthrough.md`).
 * Le robot n'utilise que des actions de joueur : commandes tapées, clics des bottes, flèches, touches F2 / F3 (sauvegarde et
 * restauration, pour recommencer un passage à hasard : l'ours, les frelons) ; il lit l'état du monde comme le joueur lit l'écran, jamais
 * de téléportation ni de modification d'état. La graine du hasard est fixe : la partie est la même à chaque exécution.
 *
 * Les chapitres s'enchaînent dans un même moteur (les `it` d'un fichier tournent dans l'ordre) : chacun vérifie l'étape atteinte
 * (salle, score, objets portés) avant de passer au suivant.
 */

// Graine 36 : le face-à-face `2273:000c` fidèle (le personnage mobile s'écarte, bug 39) change les déplacements de tous les personnages,
// donc tout le déroulé du hasard ; la 10 échoue dès le chapitre 0. Parmi les graines 1 à 36, 16 et 36
// passent jusqu'au verdict ; 36 est la plus rapide.
const SEED = Number(process.env.SEED ?? 36);
const table = hasOriginalFiles ? new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS")) : null;
const text = (cls: string | number, n: number): string => table!.messages(messageId(cls, n));

describe.skipIf(!hasOriginalFiles)("solution complète : du titre au couronnement", () => {
  const p = new Robot({ seed: SEED });
  const has = (num: number): boolean => !!p.state.hero && p.hero.contents.some((o) => o.num === num);
  const object = (num: number) => p.state.objects.find((o) => o.num === num)!;
  /** Les points de l'entrée `id` (chapitre * 100 + indice) ont été attribués (`2255:00e8` les rend négatifs). */
  const awarded = (id: number): boolean => p.state.scoreTable.some((e) => e.id === id && e.points < 0);
  /** Attend `ticks` images en lisant les messages qui tombent. */
  const wait = (ticks: number): string[] => {
    const read: string[] = [];
    for (let i = 0; i < ticks; i += 5) {
      p.run(5);
      read.push(...p.drain(2));
    }
    return read;
  };

  it("chapitre 0 : la forêt, la clef d'or, le levier de l'ours et la stèle (score 100)", () => {
    p.skipIntro();
    expect(p.roomId).toBe(1);

    // --- la cabane (salle 3) : le fouet (contre l'ours) et le seau (pour la couronne, chapitre 3) ---------------------------------
    p.goTo(3);
    expect(p.say("prendre le fouet")).toEqual([text("V", 15)]);
    expect(p.say("prendre le seau")).toEqual([text("V", 15)]);

    // --- la clef d'or est par terre dans la salle 11 (la pie la prend parfois : elle est là au début) ------------------------------
    p.goTo(11);
    expect(p.say("prendre la clef")).toEqual([text("V", 15)]);

    // --- les torches (le château est dans le noir) : le tas de bois de la salle 8 n'est accessible que par la prairie, atteinte depuis la
    //     salle 14 en grimpant à l'échelle, en suivant la corniche puis en se laissant tomber dans la poche, qu'on quitte par la glissade.
    //     On entre dans la salle 14 par la droite (salle 13) : le héros y est posé en X impair (297) et le garde jusqu'à la prairie (la
    //     marche avance de 2 en X) ; seul un X impair passe le couloir de la pile jusqu'au coffret (X 197 à 199 en P 56, `room8.test.ts`).
    //     Vérifié sous DOSBox-X avec une sauvegarde fabriquée (`dosbox.md` § 4.5) : de (216, 146, 127) le héros d'origine s'arrête en
    //     haut de l'escalier, en X 196, comme le port ; de (217, 146, 127) il arrive au coffret ---------------------------------------
    p.goTo(13, new Set([14, 16]));
    p.goTo(14, new Set([16]));
    expect(p.hero.x % 2).toBe(1);
    p.attempt(
      "pile de bois et coffret",
      20,
      () => {
        for (let k = 0; k < 4 && p.hero.ground !== 7; k++) p.walkTo(122, 125, 4000); // pied de l'échelle (cases 7 de la rangée P 72, de Y 86 à Y 126 : la pente suit l'échelle)
        p.need(p.hero.ground === 7, "pas au pied de l'échelle");
        p.vertical("-"); // monter ...
        p.until(() => p.hero.y <= 82, 800);
        p.vertical("-"); // ... s'arrêter à la hauteur de la corniche (zone de Y 79 à 82) ...
        p.arrow("left"); // ... la suivre vers la gauche ...
        p.until(() => p.hero.x <= 40, 1200);
        p.arrow("left"); // ... s'arrêter au-dessus de la poche et lâcher prise (« Oups, vous perdez prise ! »)
        p.vertical("=");
        p.until(() => p.hero.ego === 5 || p.hero.ego === 0, 400);
        p.until(() => p.hero.ego === 0, 1500); // KO de 100 tics
        p.run(10);
        for (let k = 0; k < 6 && p.roomId === 14 && p.hero.ground !== 29 && p.hero.ego === 0; k++) p.walkTo(41, 150, 3000); // la pente (case 29)
        p.until(() => p.roomId === 8, 800); // la glissade mène au bord bas de la salle 14 : prairie de la salle 8
        p.until(() => p.hero.ego === 0, 1500);
        p.run(10);
        for (const [x, yy] of [[217, 140], [220, 145], [214, 135]]) {
          if (p.hero.ground === 65) break;
          p.walkTo(x, yy, 6000); // sur le tas de bois (case 65)
        }
        p.need(p.hero.ground === 65, "pas sur la pile de bois");
        for (let k = 0; k < 3; k++) p.say("prendre du bois");
        p.need(p.hero.contents.filter((o) => o.num === 12).length === 3, "pas de bois");
        // le coffret, en haut de la pile (fermé à clef, clef d'or) : la première commande fait marcher le héros jusqu'à lui et n'est rejouée
        // qu'avec le dernier sens de « clef » essayé, sans objet (`V046`, observé aussi sous DOSBox-X) ; la seconde l'ouvre. La clef d'or
        // (valeur 1000) posée dedans rapporte (0, 0) (`2566:0112`, valeur >= 50), puis on la reprend : elle sert encore (stèle, herse)
        p.say("ouvrir le coffret avec la clef");
        p.need(p.say("ouvrir le coffret avec la clef").includes(text("V", 15)), "coffret fermé");
        p.say("mettre la clef dans le coffret");
        p.need(p.state.score === 5, "coffret : pas de points");
        p.say("prendre la clef dans le coffret");
      },
      () => has(6) && p.state.score === 5 && p.hero.contents.filter((o) => o.num === 12).length === 3,
    );
    expect(has(6)).toBe(true);
    expect(awarded(0)).toBe(true);
    expect(p.hero.contents.filter((o) => o.num === 12)).toHaveLength(3);

    // le feu de la combe (salle 18) : braises (Ego 2) ; on y met une torche pour le raviver (+20), puis on allume une autre au feu (+5)
    p.goTo(18);
    const fire = object(18);
    for (const [x, yy] of [[138, 133], [140, 134], [150, 134], [145, 138]]) {
      if ((p.engine as unknown as { inReach(o: unknown): boolean }).inReach(fire)) break;
      p.walkTo(x, yy, 3000); // à côté du feu, pas dedans (le héros qui marche sur la case de feu est brûlé)
    }
    expect(p.say("mettre la torche dans le feu")).toEqual([text("V", 28)]);
    expect(p.state.score).toBe(25);
    expect(p.say("allumer la torche avec le feu")).toEqual([text("V", 15)]);
    expect(p.state.score).toBe(30);
    expect(p.hero.contents.filter((o) => o.num === 12 && o.ego < 4)).toHaveLength(1); // une torche allumée, une éteinte
    expect(fire.ego).toBe(3);

    // la salle 16 est évitée : la ruche et les frelons (mort par piqûres, `G14`)
    p.goTo(5, new Set([16]));

    // --- les ronces de la salle 5 : le héros se place sur le tapis, « arracher les ronces » ---------------------------------------
    for (let k = 0; k < 4 && p.hero.ground !== 39; k++) p.walkTo(54, 130, 6000);
    expect(p.hero.ground).toBe(39);
    p.say("arracher les ronces");
    wait(400);
    expect(p.state.score).toBe(50);
    expect(object(16).ego).toBe(5); // stèle découverte

    // --- la clef d'or dans la serrure : le mécanisme se met en marche mais reste bloqué ---------------------------------------
    for (const [x, y] of [[34, 118], [36, 120], [38, 118]]) {
      if (p.hero.ground === 36) break;
      p.walkTo(x, y, 6000);
    }
    expect(p.hero.ground).toBe(36);
    expect(p.say("ouvrir la stèle avec la clef")).toEqual([text("V", 60)]);
    wait(100);
    expect(p.state.score).toBe(70);
    expect(object(16).ego).toBe(1);

    // --- le levier de l'ours, puis la stèle. Passage à hasard (l'ours rôde, suit le héros de salle en salle, un coup de fouet sur cinq est
    //     manqué) : la partie est sauvegardée (F2) et restaurée (F3) en cas de mort, comme le ferait le joueur --------------------------------
    const y = (depth: number) => Math.round(depth * 0.545 + 34); // y écran d'une profondeur P dans la salle 7
    const need = (condition: boolean, why: string): void => {
      if (!condition || !p.state.hero) throw new RobotSetback(why);
    };
    const tries = p.attempt(
      "levier de l'ours et stèle",
      30,
      () => {
        // la grotte (salle 7) : dans sa grotte l'ours attaque toujours le héros qu'il voit (`26da:0364`) ; le joueur qui l'y trouve en
        // entrant ressort aussitôt et attend dans la salle 6 qu'il soit parti
        const bear = object(4);
        p.goTo(6);
        for (let k = 0; k < 12; k++) {
          p.goTo(7, new Set(), true);
          if (bear.room !== p.state.loadedRoom) break;
          p.goTo(6, new Set(), true);
          wait(400);
          if (!p.state.hero) throw new RobotSetback("mort en attendant l'ours");
        }
        need(p.roomId === 7 && bear.room !== p.state.loadedRoom, "l'ours garde sa grotte");
        let last = -1000;
        p.watcher = () => {
          // dans la grotte, le joueur lit aussitôt les fenêtres du fouet (le jeu est arrêté tant qu'elles sont ouvertes)
          if (p.engine.windows.active && p.roomId === 7) {
            p.readWindow();
            return;
          }
          const near = p.state.hero && bear.room === p.state.loadedRoom && bear.ego < 2 && Math.abs(bear.x - p.hero.x) < 38 && Math.abs(bear.p - p.hero.p) < 14;
          if (near && p.engine.frames - last > 40 && p.hero.ego === 0) {
            last = p.engine.frames;
            p.host.type("fouetter l'ours\r");
          }
        };
        // on passe par le bas de la salle : la case de pente de (X 76, P 80) fait glisser le héros dans le vide
        const through = (waypoints: [number, number][]) => {
          for (const [x, depth] of waypoints) {
            for (let k = 0; k < 16 && p.state.hero; k++) {
              p.walkTo(x, y(depth), 1500);
              p.drain(2);
              if (p.state.hero && Math.abs(p.hero.x - x) < 8) break;
              p.run(60); // l'ours, pris au contact du héros dans le couloir, ne repart qu'avec un peu de temps
            }
          }
        };
        through([[150, 100], [110, 100], [110, 92], [60, 88]]);
        for (let k = 0; k < 8 && p.state.hero && !has(11); k++) p.say("prendre le levier");
        need(has(11), "pas de levier");
        through([[110, 100], [150, 100]]);
        for (let k = 0; k < 4 && p.state.hero && p.roomId === 7; k++) p.exit("right");
        need(p.roomId === 6, "l'ours n'a pas laissé sortir");

        // retour à la stèle : devant (sol 44), « pousser la stèle avec le levier » (+30 à la fin du coulissement)
        p.goTo(5, new Set([16]));
        for (const [x, yy] of [[28, 128], [27, 131], [29, 125], [28, 134]]) {
          if (p.hero.ground === 44) break;
          p.walkTo(x, yy, 6000);
        }
        need(p.hero.ground === 44, "pas devant la stèle");
        need(p.say("pousser la stèle avec le levier").includes(text("V", 63)), "la stèle ne s'ouvre pas");
        wait(1500);
        need(object(16).ego === 4, "stèle fermée");

        // l'escalier : à droite de la serrure, les cases 80 descendent jusqu'au bord bas, d'où la salle 101
        p.arrow("right");
        p.until(() => p.roomId !== 5, 800);
      },
      () => p.roomId === 101,
    );
    p.watcher = null;
    expect(tries).toBeGreaterThan(0);
    expect(has(11)).toBe(true);
    expect(object(16).ego).toBe(4);
    expect(p.roomId).toBe(101);
    expect(p.state.score).toBe(100);
    expect(p.engine.missing.size).toBe(0);
  }, 120_000);

  it("chapitre 1 : le château, la torchère du trône et la dalle (score 140)", () => {
    expect(p.roomId).toBe(101);
    // la lueur de la torche suffit : le château est dans le noir, mais le héros porte une torche allumée
    expect(p.state.darkRoom).toBe(false);
    p.attempt(
      "torchère du trône",
      20,
      () => {
        p.goTo(108); // 101 -> 111 -> 108 (le trône)
        // la torchère piégée (`Ego 1`) est celle de gauche, à X 143 contre le mur du fond ; derrière le socle du trône le héros ne s'en
        // approche pas assez : on se place devant (profondeur 16, la première rangée libre), à portée (écart de profondeur < 9)
        p.walkTo(143, 76, 4000);
        p.arrow("up");
        p.until(() => p.hero.p <= 16, 600);
        p.arrow("up"); // arrêt
        p.run(5);
        expect(p.say("tirer la torchère")).toEqual([text("V", 133 - 19)]);
        wait(500);
        expect(object(104).ego).toBe(3); // la dalle est ouverte
        expect(p.state.score).toBe(140);
      },
      () => p.roomId === 108 && object(104).ego === 3,
    );
    expect(p.roomId).toBe(108);
    expect(p.state.score).toBe(140);
  }, 120_000);

  it("chapitre 2 : le dôme, la corniche effondrée et la herse de granite (score 180)", () => {
    expect(p.roomId).toBe(108);
    p.attempt(
      "herse du dôme",
      30,
      () => {
        const dwarvesHere = () => p.state.objects.some((o) => ((o.num >= 201 && o.num <= 204) || o.num === 301) && o.room === p.state.loadedRoom);
        for (let k = 0; k < 12; k++) {
          p.enterDome();
          if (!dwarvesHere()) break;
          p.leaveDomeUp();
          p.goTo(101);
          wait(4000);
          if (!p.state.hero) throw new RobotSetback("mort en attendant");
          p.goTo(108);
        }
        expect(p.roomId).toBe(202);
        p.crossGapDown();
        for (const [x, yy] of [[230, 62], [262, 95], [290, 112], [296, 98]]) {
          p.walkTo(x, yy, 6000);
          p.drain();
          if (!p.state.hero) throw new RobotSetback("mort sur la rampe");
        }
        // la hache est sur la rampe (`Num 206`, `Val 20` : un nain la ramasse s'il passe avant le héros) : on la prend tout de suite
        if (!p.say("prendre la hache").includes(text("V", 15))) throw new RobotSetback("hache déjà prise par un nain");
        const closedY = object(207).y;
        const said = p.say("tinhuel");
        // « Les nains ont bloqué le mécanisme » (V213, herse `Ego 4`) : on recommence depuis la sauvegarde
        if (!said.some((m) => m === text("V", 214) || m === text("V", 215))) throw new RobotSetback(`herse : ${said.join(" / ")}`);
        wait(600);
        // régression `29fd:0000` : la herse levée reste levée (placer en mode 2, sans recherche de sol)
        expect(object(207).ego).toBe(3);
        expect(object(207).y).toBeLessThan(closedY);
      },
      () => p.state.score >= 180,
    );
    expect(p.state.score).toBe(180);
  }, 120_000);

  it("chapitre 3 (a) : la hache de la rampe, la poterne du puits et le bouclier de la niche (score 195)", () => {
    expect(object(207).ego).toBe(3); // herse ouverte
    expect(has(206)).toBe(true); // prise sur la rampe au chapitre 2
    p.crossGapUp();
    p.leaveDomeUp();
    expect(p.roomId).toBe(108);
    p.attempt(
      "puits",
      30,
      () => {
        p.goTo(102);
        p.run(30);
      },
      () => p.roomId === 102,
    );

    // le puits : la margelle (cases 40) puis la corde ; en `Dep 4` le héros est posé sur la zone de la corde, il faut rappuyer sur `=`
    // (la première pression est effacée par l'entrée en escalade, `Ver 0`)
    for (const [x, yy] of [[90, 100], [90, 90], [88, 80], [80, 85], [100, 85], [90, 70]]) {
      if (p.hero.ground === 40) break;
      p.walkTo(x, yy, 800);
      p.run(20);
    }
    expect(p.hero.ground).toBe(40);
    p.vertical("=");
    p.run(20);
    p.vertical("=");
    // la niche est à mi-puits (Y 34 à 48 sous la poterne, salle 212)
    expect(p.until(() => p.roomId === 212 && p.hero.y >= 38, 600)).toBe(true);
    p.vertical("=");
    p.run(10);
    expect(p.say("casser la poterne avec la hache")).toEqual([text("V", 222)]);
    expect(p.state.score).toBe(190);
    expect(p.say("prendre le bouclier dans la niche")).toEqual([text("V", 15)]);
    expect(p.state.score).toBe(195);
    expect(has(205)).toBe(true);

    // la remontée : au sommet de la corde le héros, remis à la marche, est posé sur la margelle (régression de `1b11:04ed`, vérifiée
    // sous DOSBox-X : il se tenait sur la zone de la corde et retombait dans le puits)
    p.vertical("-");
    expect(p.until(() => p.roomId === 102, 900)).toBe(true);
    expect(p.until(() => p.hero.ego === 0, 600)).toBe(true);
    p.run(60);
    expect(p.roomId).toBe(102);
    expect(p.hero.ego).toBe(0);
    expect(p.hero.ground).toBe(40);
  }, 120_000);

  it("chapitre 3 (b) : le trousseau, la bouteille de l'antre, Prytwen enfermé dans la geôle, l'inscription (score 305)", () => {
    p.attempt(
      "trousseau",
      30,
      () => {
        p.goTo(104);
        p.run(30);
        expect(p.say("prendre le trousseau")).toEqual([text("V", 15)]);
      },
      () => has(108),
    );
    expect(has(108)).toBe(true);
    // la bouteille d'hydromel de l'armoire (mort dans l'antre et « continuer »), Prytwen sorti à la suite du héros, mis KO (+10 +40), porté
    // (+10) et enfermé dans la geôle (+30 à son réveil), l'inscription (+5 +5), la grille rouverte de l'intérieur (+10)
    castle(p);
    expect(has(332)).toBe(true);
    expect(p.state.score).toBe(305);
    expect(p.roomId).toBe(104);
  }, 120_000);

  it("chapitre 3 (c) : la planche de la salle de Minas Thyl (304) (score 315)", () => {
    p.attempt(
      "planche",
      40,
      () => {
        p.goTo(106);
        // la voûte du fond (sortie haute vers 103) est à gauche : les clics de bord mènent à la sortie de droite (107) ; on se place sous la
        // voûte (P 15) puis flèche haut
        p.walkTo(36, 44, 1500);
        p.arrow("up");
        p.until(() => p.roomId !== 106, 600);
        p.stop();
        p.run(30);
        p.goTo(108);
        p.downToRamp();
        p.walkTo(230, 62, 4000);
        p.drain();
        for (const room of p.route(302)!) p.hop(room);
        // les vapeurs de la salle 304 éteignent les torches (`147f:0352`, `G373`) : on les laisse ici, allumées
        p.dropTorches();
        p.enterLava();
        // Minas Thyl vient à la rencontre du héros (sans baguette elle ne propose que son pacte : `G325`, puis attend : `Ego 5`)
        for (let k = 0; k < 8 && p.state.hero && !has(308); k++) p.say("prendre la planche");
        if (!has(308)) throw new RobotSetback("pas de planche");
        // retour par le même chemin (les geysers de la salle tuent parfois : l'essai recommence depuis la sauvegarde)
        p.lavaWalk([...LAVA_PATH].reverse().slice(1));
        p.goTo(302, new Set(), true);
        p.takeTorches();
      },
      // Minas Thyl, restée où le héros l'a laissée, ne doit pas être dans son antre (301) : elle y capturerait le héros
      () => has(308) && p.roomId === 302,
    );
    expect(has(308)).toBe(true);
    expect(p.roomId).toBe(302);
    // un nain guerrier tué en duel sur la route de la mine (`2a44:06c6`, +10)
    expect(awarded(204)).toBe(true);
    expect(p.state.score).toBe(315);
  }, 120_000);

  it("chapitre 3 (d) : la salle de garde et la mine, la planche posée en travers du gouffre, l'épée d'orichalque et l'émeraude (score 335)", () => {
    expect(p.roomId).toBe(302);
    expect(has(308)).toBe(true);
    // la salle de garde 305 : les nains de la route de retour (205, 206, 207, 203, 202) puis les gardes, qui dorment 1 fois sur 4
    p.crossAll(312);
    expect(p.roomId).toBe(312);
    p.attempt(
      "épée",
      30,
      () => {
        // le pont vermoulu (`Sol 53`) ne porte que 40 de charge, la planche comprise (20) : le superflu reste sur la plateforme de gauche
        for (const item of ["le seau", "la hache", "le bouclier", "le fouet", "le levier"]) p.say(`jeter ${item}`);
        for (const [x, yy] of [[118, 106], [160, 100], [198, 98]]) p.walkTo(x, yy, 3000);
        if (p.hero.ground !== 0x3e) throw new RobotSetback("pas au bout de la plateforme du centre");
        // la planche (« poser » n'est pas dans le dictionnaire : `mettre`) au bord du gouffre, score(3, 2) : +20
        if (!p.say("mettre la planche").includes(text("V", 306))) throw new RobotSetback("planche non posée");
        for (const [x, yy] of [[215, 98], [240, 98], [285, 98]]) p.walkTo(x, yy, 3000);
        // l'épée et l'émeraude (convoitée par Minas Thyl : l'appât du piège de la salle 303) sont dans la crevasse de la plateforme de
        // droite ; au retour le pont porte l'épée (30), l'émeraude (5), les clefs et la bouteille
        p.say("regarder dans le trou");
        p.say("prendre l'épée dans le trou");
        p.say("prendre l'emeraude dans le trou");
        if (!has(314) || !has(313)) throw new RobotSetback("pas d'épée ou d'émeraude");
        for (const [x, yy] of [[240, 98], [160, 100], [118, 106], [40, 100]]) p.walkTo(x, yy, 3000);
        for (const item of ["le bouclier", "le seau", "la hache"]) p.say(`prendre ${item}`);
      },
      () => has(314) && has(313) && has(205) && has(25) && has(206),
    );
    expect(object(308).ego).toBe(1);
    expect(p.state.score).toBe(335);
  }, 120_000);

  it("chapitre 3 (e) : le garde du cellier, la clef ouvragée, la grille de fer, la vanne du puits et les soldats de la salle de garde (score 365)", () => {
    // l'épée et le bouclier donnent toujours la victoire en duel (`2a44:02de`) : on traverse sans attendre les nains
    p.crossAll(305);
    p.attempt(
      "garde du cellier",
      30,
      () => {
        const guard = p.state.objects.find((o) => o.num === 301 && o.contents.some((c) => c.num === 331))!;
        // la case 0x37 devant la grille déclenche le garde (`Ego 5`, `2a44:08fe`) : il attaque, l'épée le transperce et la clef tombe
        p.walkTo(140, p.floor(140, 52), 3000);
        p.until(() => !p.state.objects.includes(guard) || !p.state.hero, 1500);
        p.run(300);
        p.drain();
        if (!p.state.hero) throw new RobotSetback("mort devant le garde");
        if (!p.say("prendre la clef").includes(text("V", 15)) || !has(331)) throw new RobotSetback("pas de clef ouvragée");
        p.say("ouvrir la grille avec la clef");
        if (object(309).ego !== 2) throw new RobotSetback("grille fermée");
        // la vanne est dans l'alcôve du garde-manger : elle vide le puits (salle 212, eau `Num 215`)
        if (!p.say("ouvrir la vanne").includes(text("V", 301))) throw new RobotSetback("vanne");
      },
      () => has(331) && object(309).ego === 2 && object(215).fig === 1,
    );
    // les autres soldats de la salle de garde : endormis, tués dans leur sommeil ; éveillés, vaincus en duel ; le dernier rapporte +30
    guardRoom(p);
    expect(awarded(309)).toBe(true);
    expect(p.state.score).toBe(365);
  }, 120_000);

  it("chapitre 3 (f) : le puits vidé, le coffre de fer du fond, la baguette de Minas Thyl et « tehrehanan » (score 395)", () => {
    p.crossAll(202);
    p.attempt(
      "vers le trône",
      30,
      () => {
        p.crossGapUp();
        p.leaveDomeUp();
      },
      () => p.roomId === 108,
    );
    p.attempt("vers le puits", 30, () => p.goTo(102), () => p.roomId === 102);
    p.attempt(
      "fond du puits",
      30,
      () => {
        for (const [x, yy] of [[90, 100], [90, 90], [88, 80], [80, 85], [100, 85], [90, 70]]) {
          if (p.hero.ground === 40) break;
          p.walkTo(x, yy, 800);
          p.run(20);
        }
        p.vertical("=");
        p.run(20);
        p.vertical("="); // la corde : on descend sans s'arrêter, le puits est vide (la salle 313 est le fond)
        if (!p.until(() => p.roomId === 313 && p.hero.ego === 0, 1500)) throw new RobotSetback(`salle ${p.roomId}`);
        p.run(20);
        if (!p.say("ouvrir le coffre avec le trousseau").includes(text("V", 15))) throw new RobotSetback("coffre fermé");
        p.say("prendre la baguette dans le coffre");
        if (!has(320)) throw new RobotSetback("pas de baguette");
        // la remontée : le pied de la corde (case 7), puis `-` jusqu'à la margelle
        for (const [x, yy] of [[64, 52], [66, 54], [62, 50]]) {
          if (p.hero.ground === 7) break;
          p.walkTo(x, yy, 1500);
        }
        p.vertical("-");
        if (!p.until(() => p.roomId === 102 && p.hero.ego === 0, 1500)) throw new RobotSetback("remontée");
        p.run(60);
      },
      () => has(320) && p.roomId === 102,
    );
    expect(has(320)).toBe(true);
    // la baguette et la bouteille d'hydromel : « tehrehanan » en fait la potion qui protège des laves (+30)
    expect(p.say("tehrehanan").join(" ")).toContain(text("V", 380));
    expect(awarded(312)).toBe(true);
    expect(p.state.score).toBe(395);
  }, 120_000);

  it("chapitre 3 (g) : la rivière souterraine et le repaire de Ségomir (salles 208 et 210) (score 425)", () => {
    p.attempt("vers le dôme", 30, () => p.goTo(108), () => p.roomId === 108);
    p.attempt(
      "descente au dôme",
      30,
      () => {
        p.enterDome();
        if (p.roomId !== 202) throw new RobotSetback(`salle ${p.roomId}`);
        p.crossGapDown();
        p.walkTo(230, 62, 4000);
        p.drain();
      },
      () => p.roomId === 202 && !!p.state.hero,
    );
    p.crossAll(207);
    // à la nage jusqu'à la salle 208 (+10), la paroi de la salle 211, le parchemin de la salle 210 (+20)
    riverAndLair(p);
    expect(awarded(205)).toBe(true);
    expect(awarded(201)).toBe(true);
    expect(has(209)).toBe(true);
    expect(p.state.score).toBe(425);
  }, 120_000);

  it("chapitre 3 (h) : l'antre de Minas Thyl, le grimoire, « ezhrimanoth », le talisman contre la baguette (score 485)", () => {
    p.crossAll(302);
    // le grimoire lu avec la baguette (+10), la fiole changée en élixir d'invisibilité (+30), en l'absence de Minas Thyl
    witchLair(p);
    expect(awarded(305)).toBe(true);
    expect(awarded(311)).toBe(true);
    // elle exige la baguette, qu'on lui donne contre le talisman (+20)
    talisman(p);
    expect(has(320)).toBe(false);
    expect(has(321)).toBe(true);
    expect(awarded(301)).toBe(true);
    expect(p.state.score).toBe(485);
  }, 120_000);

  it("chapitre 3 (i) : le piège du cratère : l'émeraude sur l'îlot, Minas Thyl engloutie (score 545)", () => {
    craterTrap(p);
    expect(awarded(304)).toBe(true);
    expect(awarded(300)).toBe(true);
    expect(p.state.objects.some((o) => o.num === 303)).toBe(false);
    expect(p.state.score).toBe(545);
  }, 120_000);

  it("chapitre 3 (j) : la fosse des Sarhûls, l'enclos, la herse de pierre, le chapiteau d'Erin Hûviel, la boule de cristal et la couronne (score 645)", () => {
    p.crossAll(305);
    // la porte de fer, l'élixir d'invisibilité ; derrière la grille ouvragée fermée, on attend que les Sarhûls soient tous dans l'enclos
    // et on l'ouvre (+40) ; la fosse, la herse de pierre (clef d'or), la salle 314 ; sur le chapiteau avec le talisman (+20), la boule
    // de cristal (+10) ; « sillerynn » (+30) change le seau en couronne, qu'on chausse
    toSarhulPit(p);
    penSarhuls(p);
    expect(awarded(308)).toBe(true);
    chapiterAndCrown(p);
    expect(awarded(303)).toBe(true);
    expect(awarded(310)).toBe(true);
    expect(awarded(313)).toBe(true);
    expect(p.state.score).toBe(645);
  }, 120_000);

  it("chapitre 3 (k) : le couronnement et le verdict du roi (score 695)", () => {
    // la couronne chaussée : l'ensorcellement mène au trône (108), l'acteur gravit les marches
    expect(p.state.hero?.num).toBe(333);
    const read: string[] = [];
    for (let k = 0; k < 120 && !p.state.gameOver; k++) {
      p.run(50);
      read.push(...p.drain(2));
    }
    read.push(...p.drain(2));
    expect(p.state.gameOver).toBe(true);
    expect(p.state.hero).toBeNull();
    expect(p.roomId).toBe(108);
    expect(awarded(307)).toBe(true);
    // 695 sur 725 : le maximum des appels de l'original ; manquent seulement les deux entrées sans appel (103 : 0 point ; 306 : 30 points)
    expect(p.state.score).toBe(695);
    expect(p.state.scoreTable.filter((e) => e.points >= 0).map((e) => e.id)).toEqual([103, 306]);
    // le verdict (`S50`) conclut sur `S53` (secret du niveau découvert, trésor incomplet) ; puis `S55`
    const verdict = read.findIndex((t) => t.startsWith(text("S", 50).slice(0, 40)));
    expect(verdict).toBeGreaterThanOrEqual(0);
    expect(read[verdict]).toContain(text("S", 53).slice(0, 40));
    expect(read.findIndex((t) => t.startsWith(text("S", 55).slice(0, 40)))).toBeGreaterThan(verdict);
  }, 120_000);
});
