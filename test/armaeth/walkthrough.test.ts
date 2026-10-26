import { describe, expect, it } from "vitest";
import { MessageTable, messageId } from "../../src/games/armaeth/data/text";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { Robot, RobotSetback } from "./robot";

/**
 * Solution complète d'*Armaeth* jouée par un robot sur le moteur sans tête, du titre jusqu'au couronnement (`docs/armaeth/walkthrough.md`).
 * Le robot n'utilise que des actions de joueur : commandes tapées, clics des bottes, flèches, touches F2 / F3 (sauvegarde et
 * restauration, pour recommencer un passage à hasard : l'ours, les frelons) ; il lit l'état du monde comme le joueur lit l'écran, jamais
 * de téléportation ni de modification d'état. La graine du hasard est fixe : la partie est la même à chaque exécution.
 *
 * Les chapitres s'enchaînent dans un même moteur (les `it` d'un fichier tournent dans l'ordre) : chacun vérifie l'étape atteinte
 * (salle, score, objets portés) avant de passer au suivant.
 */

const SEED = Number(process.env.SEED ?? 10);
const table = hasOriginalFiles ? new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS")) : null;
const text = (cls: string | number, n: number): string => table!.messages(messageId(cls, n));

describe.skipIf(!hasOriginalFiles)("solution complète : du titre au couronnement", () => {
  const p = new Robot({ seed: SEED });
  const has = (num: number): boolean => !!p.state.hero && p.hero.contents.some((o) => o.num === num);
  const object = (num: number) => p.state.objects.find((o) => o.num === num)!;
  /** Attend `ticks` images en lisant les messages qui tombent. */
  const wait = (ticks: number): string[] => {
    const read: string[] = [];
    for (let i = 0; i < ticks; i += 5) {
      p.run(5);
      read.push(...p.drain(2));
    }
    return read;
  };

  it("chapitre 0 : la forêt, la clef d'or, le levier de l'ours et la stèle (score 95)", () => {
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
    //     salle 14 en grimpant à l'échelle, en suivant la corniche puis en se laissant tomber dans la poche, qu'on quitte par la glissade ---
    p.goTo(14);
    for (let k = 0; k < 4 && p.hero.ground !== 7; k++) p.walkTo(122, 125, 4000); // pied de l'échelle (cases 7 de la rangée P 72, de Y 86 à Y 126 : la pente suit l'échelle)
    expect(p.hero.ground).toBe(7);
    p.vertical("-"); // monter ...
    expect(p.until(() => p.hero.y <= 82, 800)).toBe(true);
    p.vertical("-"); // ... s'arrêter à la hauteur de la corniche (zone de Y 79 à 82) ...
    p.arrow("left"); // ... la suivre vers la gauche ...
    expect(p.until(() => p.hero.x <= 40, 1200)).toBe(true);
    p.arrow("left"); // ... s'arrêter au-dessus de la poche et lâcher prise (« Oups, vous perdez prise ! »)
    p.vertical("=");
    expect(p.until(() => p.hero.ego === 5 || p.hero.ego === 0, 400)).toBe(true);
    expect(p.until(() => p.hero.ego === 0, 1500)).toBe(true); // KO de 100 tics
    p.run(10);
    for (let k = 0; k < 6 && p.roomId === 14 && p.hero.ground !== 29 && p.hero.ego === 0; k++) p.walkTo(41, 150, 3000); // la pente (case 29)
    expect(p.until(() => p.roomId === 8, 800)).toBe(true); // la glissade mène au bord bas de la salle 14 : prairie de la salle 8
    expect(p.until(() => p.hero.ego === 0, 1500)).toBe(true);
    p.run(10);
    for (const [x, yy] of [[217, 140], [220, 145], [214, 135]]) {
      if (p.hero.ground === 65) break;
      p.walkTo(x, yy, 6000); // sur le tas de bois (case 65)
    }
    expect(p.hero.ground).toBe(65);
    for (let k = 0; k < 3; k++) expect(p.say("prendre du bois")).toEqual([text("V", 15)]);
    expect(p.hero.contents.filter((o) => o.num === 12)).toHaveLength(3);

    // le feu de la combe (salle 18) : braises (Ego 2) ; on y met une torche pour le raviver (+20), puis on allume une autre au feu (+5)
    p.goTo(18);
    const fire = object(18);
    for (const [x, yy] of [[138, 133], [140, 134], [150, 134], [145, 138]]) {
      if ((p.engine as unknown as { inReach(o: unknown): boolean }).inReach(fire)) break;
      p.walkTo(x, yy, 3000); // à côté du feu, pas dedans (le héros qui marche sur la case de feu est brûlé)
    }
    expect(p.say("mettre la torche dans le feu")).toEqual([text("V", 28)]);
    expect(p.state.score).toBe(20);
    expect(p.say("allumer la torche avec le feu")).toEqual([text("V", 15)]);
    expect(p.state.score).toBe(25);
    expect(p.hero.contents.filter((o) => o.num === 12 && o.ego < 4)).toHaveLength(1); // une torche allumée, une éteinte
    expect(fire.ego).toBe(3);

    // la salle 16 est évitée : la ruche et les frelons (mort par piqûres, `G14`)
    p.goTo(5, new Set([16]));

    // --- les ronces de la salle 5 : le héros se place sur le tapis, « arracher les ronces » ---------------------------------------
    for (let k = 0; k < 4 && p.hero.ground !== 39; k++) p.walkTo(54, 130, 6000);
    expect(p.hero.ground).toBe(39);
    p.say("arracher les ronces");
    wait(400);
    expect(p.state.score).toBe(45);
    expect(object(16).ego).toBe(5); // stèle découverte

    // --- la clef d'or dans la serrure : le mécanisme se met en marche mais reste bloqué ---------------------------------------
    for (const [x, y] of [[34, 118], [36, 120], [38, 118]]) {
      if (p.hero.ground === 36) break;
      p.walkTo(x, y, 6000);
    }
    expect(p.hero.ground).toBe(36);
    expect(p.say("ouvrir la stèle avec la clef")).toEqual([text("V", 60)]);
    wait(100);
    expect(p.state.score).toBe(65);
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
        p.goTo(7);
        const bear = object(4);
        let last = -1000;
        p.watcher = () => {
          const near = p.state.hero && bear.room === p.state.loadedRoom && bear.ego < 2 && Math.abs(bear.x - p.hero.x) < 38 && Math.abs(bear.p - p.hero.p) < 14;
          if (near && p.engine.frames - last > 40 && p.hero.ego === 0 && !p.engine.windows.active) {
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
    expect(p.state.score).toBe(95);
    expect(p.engine.missing.size).toBe(0);
  }, 120_000);

  /** De la salle du trône à la corniche d'arrivée du dôme : les cases 81 sous la dalle ouverte descendent vers le fond (bord bas -> salle 202). */
  const enterDome = (): void => {
    for (const [x, yy] of [[160, 100], [160, 125], [160, 135]]) {
      if (p.hero.ground === 81) break;
      p.walkTo(x, yy, 4000);
      p.drain();
    }
    expect(p.hero.ground).toBe(81);
    p.arrow("up");
    p.until(() => p.roomId !== 108, 1500);
    p.stop();
    p.run(30);
  };

  /** Quitte la corniche d'arrivée par le haut : en marchant vers la gauche le sol monte au-dessus du bord haut (Y 14), salle 108. */
  const leaveDomeUp = (): void => {
    p.arrow("left");
    p.until(() => p.roomId !== 202, 2500);
    p.stop();
    p.run(30);
  };

  it("chapitre 1 : le château, la torchère du trône et la dalle (score 135)", () => {
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
        expect(p.state.score).toBe(135);
      },
      () => p.roomId === 108 && object(104).ego === 3,
    );
    expect(p.roomId).toBe(108);
    expect(p.state.score).toBe(135);
  }, 120_000);

  /** Franchit l'éboulement de la salle 202 de la corniche d'arrivée (à gauche) vers la rampe (à droite), puis laisse le héros se remettre. */
  const crossGapDown = (): void => {
    const alive = () => {
      if (!p.state.hero) throw new RobotSetback("mort sur l'éboulement");
      return p.hero;
    };
    for (let k = 0; k < 4 && alive().ground !== 7; k++) p.walkTo(152, 33, 4000);
    expect(alive().ground).toBe(7); // l'échelle, cases 7 de X 144 à 159
    p.vertical("-");
    expect(p.until(() => alive().y <= 28, 600)).toBe(true);
    p.vertical("-"); // arrêt à la hauteur de la barre (zone de Y 18 à 41)
    p.arrow("right");
    expect(p.until(() => alive().x >= 192, 1200)).toBe(true);
    p.arrow("right");
    p.vertical("="); // l'échelle de droite : arrêt en bas (case 11, Y 42)
    expect(p.until(() => alive().ego === 0, 600)).toBe(true);
    // le pied de l'échelle de droite (cases 7, Y 44) donne sur la rampe (cases de sol du plan 1, Y 47 et plus) : on y marche, sans chute
    p.run(10);
  };

  it("chapitre 2 : le dôme, la corniche effondrée et la herse de granite (score 175)", () => {
    expect(p.roomId).toBe(108);
    p.attempt(
      "herse du dôme",
      30,
      () => {
        const dwarvesHere = () => p.state.objects.some((o) => ((o.num >= 201 && o.num <= 204) || o.num === 301) && o.room === p.state.loadedRoom);
        for (let k = 0; k < 12; k++) {
          enterDome();
          if (!dwarvesHere()) break;
          leaveDomeUp();
          p.goTo(101);
          wait(4000);
          if (!p.state.hero) throw new RobotSetback("mort en attendant");
          p.goTo(108);
        }
        expect(p.roomId).toBe(202);
        crossGapDown();
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
      () => p.state.score >= 175,
    );
    expect(p.state.score).toBe(175);
  }, 120_000);

  /** Quitte la rampe du dôme par l'échelle de droite, la barre et l'échelle de gauche, dont le pied donne sur la corniche d'arrivée. */
  const crossGapUp = (): void => {
    for (const [x, yy] of [[230, 62], [200, 45], [194, 42]]) {
      if (p.hero.ground === 7) break;
      p.walkTo(x, yy, 4000);
      p.drain();
    }
    expect(p.hero.ground).toBe(7); // pied de l'échelle de droite
    p.vertical("-");
    expect(p.until(() => p.hero.y <= 28, 600)).toBe(true);
    p.vertical("-"); // arrêt à la hauteur de la barre
    p.arrow("left");
    expect(p.until(() => p.hero.x <= 152, 1500)).toBe(true);
    p.arrow("left");
    p.run(10);
    p.vertical("="); // l'échelle de gauche : arrêt en bas (case 11), le pied donne sur la corniche d'arrivée
    expect(p.until(() => p.hero.ego === 0, 900)).toBe(true);
    p.run(10);
  };

  it("chapitre 3 (a) : la hache de la rampe, la poterne du puits et le bouclier de la niche (score 190)", () => {
    expect(object(207).ego).toBe(3); // herse ouverte
    expect(has(206)).toBe(true); // prise sur la rampe au chapitre 2
    crossGapUp();
    leaveDomeUp();
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
    expect(p.state.score).toBe(185);
    expect(p.say("prendre le bouclier dans la niche")).toEqual([text("V", 15)]);
    expect(p.state.score).toBe(190);
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

  it("chapitre 3 (b) : le trousseau de la geôle (salle 104)", () => {
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
  }, 120_000);
  /** Descend de la salle du trône à la rampe du dôme (sans nain en vue) puis franchit l'éboulement. */
  const downToRamp = (): void => {
    const dwarvesHere = () => p.state.objects.some((o) => ((o.num >= 201 && o.num <= 204) || o.num === 301) && o.room === p.state.loadedRoom);
    for (let k = 0; k < 12; k++) {
      enterDome();
      if (!dwarvesHere()) break;
      leaveDomeUp();
      p.goTo(101);
      wait(2000);
      if (!p.state.hero) throw new RobotSetback("mort en attendant");
      p.goTo(108);
    }
    expect(p.roomId).toBe(202);
    crossGapDown();
  };

  /** Chemin sûr de la salle 304 (cases claires, `[X, P]`) : du bas (arrivée) au fond (la planche). */
  const LAVA_PATH: readonly (readonly [number, number])[] = [[93, 136], [104, 124], [104, 112], [100, 100], [100, 88], [96, 76], [92, 64], [90, 52], [88, 40], [88, 28], [88, 16]];

  /**
   * La lave (cases 52) tue le héros, et le trajet d'une commande la traverse si c'est le plus court (`13a8:000a` l'accepte pour `Num 1`) :
   * on longe la salle par le milieu, de proche en proche, à la hauteur du sol de chaque case.
   */
  const lavaWalk = (path: readonly (readonly [number, number])[]): void => {
    for (const [x, depth] of path) {
      for (let k = 0; k < 4 && p.state.hero && Math.abs(p.hero.p - depth) > 6; k++) {
        p.walkTo(x, p.floor(x, depth), 1500);
        p.drain(2);
      }
    }
  };

  /** Le tunnel du fond de la salle 302 mène à la lave (304) : on se place dessous (P 23), flèche haut, puis on longe la salle. */
  const enterLava = (): void => {
    p.walkTo(95, 60, 1500);
    p.arrow("up");
    p.until(() => p.roomId !== 302, 600);
    p.stop();
    p.run(30);
    if (p.roomId !== 304) throw new RobotSetback(`salle ${p.roomId}`);
    lavaWalk(LAVA_PATH);
  };

  it("chapitre 3 (c) : la planche de la salle de Minas Thyl (304)", () => {
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
        downToRamp();
        p.walkTo(230, 62, 4000);
        p.drain();
        for (const room of p.route(302)!) p.hop(room);
        enterLava();
        // Minas Thyl vient à la rencontre du héros (sans baguette elle ne propose que son pacte : `G325`, puis attend : `Ego 5`)
        for (let k = 0; k < 8 && p.state.hero && !has(308); k++) p.say("prendre la planche");
        if (!has(308)) throw new RobotSetback("pas de planche");
        // retour par le même chemin (les geysers de la salle tuent parfois : l'essai recommence depuis la sauvegarde)
        lavaWalk([...LAVA_PATH].reverse().slice(1));
        p.goTo(302, new Set(), true);
      },
      // Minas Thyl, restée où le héros l'a laissée, ne doit pas être dans son antre (301) : elle y capturerait le héros
      () => has(308) && p.roomId === 302,
    );
    expect(has(308)).toBe(true);
    expect(p.roomId).toBe(302);
  }, 120_000);

  /**
   * Passe dans la salle voisine `room` : sauvegarde (F2) à l'entrée de la salle précédente, et, si le héros y meurt (un nain, un
   * duel perdu), restauration (F3) puis nouvel essai de cette seule salle. Sauvegarder à chaque salle et ne refaire que la dernière
   * est ce qui rend fiable la traversée des cinq salles de nains (`Robot.attempt`).
   */
  const crossTo = (room: number): void => {
    p.attempt(`traversée de la salle ${room}`, 40, () => p.hop(room, 4), () => p.roomId === room);
  };

  /**
   * La herse de granite (`Num 207`, entre 202 et 305) : un nain qui la voit ouverte crie « Armaëth ! » et la referme (`2a44:0a60`) ; on la
   * rouvre par « tinhuel », dit de l'une des deux salles (`3443:0028`), et on attend la fin du coulissement (`Tim = 0x22`).
   */
  const portcullisOpen = (): void => {
    for (let k = 0; k < 6 && object(207).ego !== 3; k++) {
      p.say("tinhuel");
      wait(700);
    }
  };

  /** Marche jusqu'à la salle `target`, salle par salle (`crossTo`) ; la herse est rouverte en route si les nains l'ont refermée. */
  const crossAll = (target: number): void => {
    p.forgetFailures();
    for (let k = 0; k < 30 && p.roomId !== target; k++) {
      if (object(207).ego !== 3 && (p.roomId === 202 || p.roomId === 305)) p.attempt("herse", 20, portcullisOpen, () => object(207).ego === 3);
      const route = p.route(target) ?? p.route(202);
      if (!route) throw new Error(`aucune route de la salle ${p.roomId} à ${target}`);
      crossTo(route[0]!);
    }
    expect(p.roomId).toBe(target);
  };

  it("chapitre 3 (d) : la salle de garde et la mine, la planche posée en travers du gouffre et l'épée d'orichalque (score 220)", () => {
    expect(p.roomId).toBe(302);
    expect(has(308)).toBe(true);
    expect(p.state.score).toBe(200);
    // la salle de garde 305 : les nains de la route de retour (205, 206, 207, 203, 202) puis les gardes, qui dorment 1 fois sur 4
    crossAll(312);
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
        // l'épée est dans la crevasse de la plateforme de droite
        p.say("regarder dans le trou");
        p.say("prendre l'épée dans le trou");
        if (!has(314)) throw new RobotSetback("pas d'épée");
        for (const [x, yy] of [[240, 98], [160, 100], [118, 106], [40, 100]]) p.walkTo(x, yy, 3000);
        for (const item of ["le bouclier", "le seau", "la hache"]) p.say(`prendre ${item}`);
      },
      () => has(314) && has(205) && has(25) && has(206),
    );
    expect(object(308).ego).toBe(1);
    expect(p.state.score).toBe(220);
  }, 120_000);

  it("chapitre 3 (e) : le garde du cellier, la clef ouvragée, la grille de fer et la vanne du puits", () => {
    // l'épée et le bouclier donnent toujours la victoire en duel (`2a44:02de`) : on traverse sans attendre les nains
    crossAll(305);
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
    expect(p.state.score).toBe(220);
  }, 120_000);

  it("chapitre 3 (f) : le puits vidé, le coffre de fer du fond et la baguette de Minas Thyl", () => {
    crossAll(202);
    p.attempt(
      "vers le trône",
      30,
      () => {
        crossGapUp();
        leaveDomeUp();
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
  }, 120_000);

  it("chapitre 3 (g) : le talisman contre la baguette, « sillerynn », la couronne et le verdict du roi (score 320)", () => {
    p.attempt("vers le dôme", 30, () => p.goTo(108), () => p.roomId === 108);
    p.attempt(
      "descente au dôme",
      30,
      () => {
        enterDome();
        if (p.roomId !== 202) throw new RobotSetback(`salle ${p.roomId}`);
        crossGapDown();
        p.walkTo(230, 62, 4000);
        p.drain();
      },
      () => p.roomId === 202 && !!p.state.hero,
    );
    p.attempt("vers la salle 302", 30, () => p.goTo(302), () => p.roomId === 302);
    // Minas Thyl, immobile là où le héros l'a laissée (souvent dans son antre, 301), va à la rencontre du héros qu'elle voit (elle n'a plus sa
    // baguette) : elle exige la baguette, qu'on lui donne tout de suite (dans l'antre elle capture le héros au contact, `2dd9:0858` : la
    // commande part avant). Si elle est dans la salle de lave (304) on l'y rejoint, sinon on va dans sa salle.
    const minas = object(303);
    p.attempt(
      "talisman",
      20,
      () => {
        for (let k = 0; k < 12 && p.state.hero && !has(321); k++) {
          const where = minas.room!.id;
          if (p.roomId !== where) {
            if (where === 304) {
              p.goTo(302);
              enterLava();
            } else {
              p.goTo(where, new Set(), true); // sans s'attarder à l'arrivée : dans l'antre elle est tout près de l'entrée
              p.stop(); // le héros garde son élan en entrant : il irait à son contact (la capture)
            }
          }
          // elle approche (`G316`, `G317`), puis exige la baguette (`G327`) : on la lui donne dès qu'elle est à portée de main, avant le
          // contact (dans l'antre le contact est la capture)
          const reach = (): boolean => !!p.state.hero && (p.engine as unknown as { inReach(o: unknown): boolean }).inReach(minas);
          for (let i = 0; i < 30 && p.state.hero && !has(321) && minas.room === p.state.loadedRoom; i++) {
            if (!p.until(() => reach() || !p.state.hero || minas.room !== p.state.loadedRoom, 1200)) break;
            if (p.state.hero && reach()) p.say("donner la baguette à Minas");
          }
        }
        if (!has(321)) throw new RobotSetback("Minas Thyl ne vient pas");
      },
      () => has(321),
    );
    expect(has(320)).toBe(false);
    expect(p.state.score).toBe(240);

    // le talisman change le seau en couronne (+30), qu'on chausse : l'ensorcellement mène au trône (108), l'acteur gravit les marches
    expect(p.say("sillerynn").join(" ")).toContain(text("V", 355));
    expect(has(328)).toBe(true);
    expect(p.state.score).toBe(270);
    p.say("chausser la couronne");
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
    expect(p.state.score).toBe(320);
    // le verdict (`S50`) conclut sur `S53` (secret du niveau découvert, trésor incomplet) ; puis `S55`
    const verdict = read.findIndex((t) => t.startsWith(text("S", 50).slice(0, 40)));
    expect(verdict).toBeGreaterThanOrEqual(0);
    expect(read[verdict]).toContain(text("S", 53).slice(0, 40));
    expect(read.findIndex((t) => t.startsWith(text("S", 55).slice(0, 40)))).toBeGreaterThan(verdict);
  }, 120_000);
});
