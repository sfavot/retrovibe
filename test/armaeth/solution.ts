import { cellIndex, GRID_COLUMNS, GRID_ROWS, isWalkable, type WalkGrid } from "../../src/games/armaeth/engine/ground";
import type { GameObject } from "../../src/games/armaeth/engine/state";
import { LAVA_PATH, type Robot, RobotSetback } from "./robot";

/**
 * Passages de la solution d'*Armaeth* ajoutés pour le score maximal (`docs/armaeth/walkthrough.md`, § Score) : chacun part d'un état
 * décrit dans son commentaire et n'utilise que des actions de joueur (commandes tapées, clics des bottes, flèches, touches).
 * Ils sont appelés par `walkthrough.test.ts`, chacun dans un `Robot.attempt` quand il comporte du hasard.
 */

/** Prytwen (`Num 101`). */
const PRYTWEN = 101;

/** Marche de proche en proche sur des cases `[X, P]` (clic à la hauteur du sol de chaque case). */
export function walkPath(p: Robot, path: readonly (readonly [number, number])[], maxTicks = 3000): void {
  for (const [x, depth] of path) {
    p.walkTo(x, p.floor(x, depth), maxTicks);
    p.drain(2);
  }
}

/** Cases de pose de la salle 104 (`[X, P]`), une par objet. */
const CASTLE_SPOTS: readonly (readonly [number, number])[] = Array.from({ length: 20 }, (_, k) => [40 + (k % 6) * 18, k < 6 ? 96 : 80] as const);

/**
 * `count` cases `[X, P]` où poser des objets dans la salle chargée sans boucher un passage (les objets posés bloquent le héros à leur
 * profondeur) : les plus dégagées du plan 0 (au moins 90 % de cases praticables à ±24 pixels en X et en P), les plus proches du
 * héros d'abord, à 20 pixels au moins les unes des autres.
 */
function dropSpots(p: Robot, count: number): [number, number][] {
  const { types } = (p.engine as unknown as { terrain: { grid: WalkGrid } }).terrain.grid;
  const open = (row: number, col: number): boolean => row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLUMNS && isWalkable(types[cellIndex(0, row, col)] ?? 0);
  const cells: { x: number; depth: number; clear: number; away: number }[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLUMNS; col++) {
      if (!open(row, col)) continue;
      let clear = 0;
      for (let dr = -3; dr <= 3; dr++) for (let dc = -6; dc <= 6; dc++) if (open(row + dr, col + dc)) clear++;
      const x = col * 4 + 2;
      const depth = row * 8 + 4;
      cells.push({ x, depth, clear: clear / 91, away: Math.hypot(x - p.hero.x, depth - p.hero.p) });
    }
  }
  const spots: [number, number][] = [];
  for (const threshold of [0.9, 0.7, 0.5]) {
    for (const c of cells.filter((cell) => cell.clear >= threshold).sort((a, b) => a.away - b.away)) {
      if (spots.length >= count) return spots;
      if (spots.every(([x, depth]) => Math.abs(x - c.x) >= 20 || Math.abs(depth - c.depth) >= 20)) spots.push([c.x, c.depth]);
    }
  }
  return spots;
}

/**
 * La geôle (salle 110), avec le trousseau : la grille (`Num 103`) ouverte de l'extérieur (le trousseau est accroché au clou, `V113`),
 * le trousseau repris, l'inscription nettoyée puis lue (`2895:01a5` +5, `2895:0113` +5) ; la case piège (`Sol 38`) referme la grille
 * derrière le héros (`13a8:00b2` -> `2846:0398`, `V118`) ; ouverte de l'intérieur, la grille rend la main au héros passé devant elle
 * (événement 17, `2846:04be`, +10).
 */
export function jail(p: Robot): void {
  p.goTo(110);
  const bars = (): GameObject => p.object(103);
  const carrying = p.has(PRYTWEN);
  p.say("ouvrir la grille avec le trousseau");
  p.need(p.until(() => bars().ego === 3, 400), "la grille ne s'ouvre pas");
  p.wait(30);
  p.need(p.say("prendre le trousseau").length > 0 && p.has(108), "trousseau");
  // dans la geôle, à côté de l'inscription (66, 45, 32), sans passer sur les cases piège (X 44 à 55, P 48 à 71)
  walkPath(p, [[72, 40]]);
  if (p.hero.p <= bars().p) {
    // le héros chargé de Prytwen ne suit pas les clics (`26ab:01fc`) : on avance aux flèches
    walkPath(p, [[64, 16]]);
    p.arrow("down");
    p.until(() => p.hero.p >= 40, 400);
    p.arrow("down");
    p.run(5);
  }
  p.need(p.hero.p > bars().p, "pas dans la geôle");
  // Prytwen assommé, porté jusqu'ici, est laissé dans la geôle (`V105`)
  if (carrying) {
    p.need(p.say("jeter Prytwen").length > 0 && !p.has(PRYTWEN), "Prytwen");
    // la pépite (`Num 105`, 450) : à son réveil Prytwen irait la prendre avant de regarder la grille (ordre de la liste de la salle)
    p.say("prendre la pepite");
    p.need(p.has(105), "pépite");
  }
  p.say("nettoyer l'inscription");
  p.say("lire l'inscription");
  // la case piège : la grille se referme derrière le héros
  walkPath(p, [[48, 56]], 1500);
  p.need(p.until(() => bars().ego === 0, 400), "le piège n'a pas refermé la grille");
  p.wait(60);
  walkPath(p, [[64, 44]], 1500);
  p.say("ouvrir la grille avec le trousseau");
  if (!p.until(() => bars().ego === 3 && p.state.moveEnabled, 400)) throw new RobotSetback("la grille ne se rouvre pas");
  p.wait(30);
  if (!carrying) return;
  // on sort et on referme la grille sur Prytwen : enfermé, il y mourra de faim (`28b1:050a..0583`, +30 à son réveil)
  walkPath(p, [[52, 16]]);
  p.need(p.hero.p < bars().p, "pas sorti de la geôle");
  p.arrow("down");
  p.until(() => p.hero.p >= bars().p - 6, 200);
  p.arrow("down");
  p.run(5);
  // à portée de la grille (`near(grille, héros, 20, -1, 8)`) sans repasser devant : sinon la réaction ramène le héros dans la geôle
  p.say("fermer la grille");
  p.need(p.until(() => bars().ego === 0 && p.state.moveEnabled, 400), "grille ouverte");
  p.wait(30);
}

/** Noms tapés pour poser ou reprendre les objets portés (`Num` -> groupe nominal). */
const ITEM_NAMES: Readonly<Record<number, string>> = {
  6: "la clef",
  10: "le fouet",
  11: "le levier",
  12: "la torche",
  25: "le seau",
  108: "le trousseau",
  109: "la clef",
  205: "le bouclier",
  206: "la hache",
  105: "la pepite",
  209: "les diamants",
  212: "le parchemin",
  304: "la fiole",
  313: "l'emeraude",
  314: "l'epee",
  320: "la baguette",
  321: "le talisman",
  331: "la clef",
  332: "la bouteille",
};

/**
 * Pose tout ce que porte le héros, un objet par case de `spots` (`[X, P]`) : posés au même endroit, les objets entourent le héros à
 * la même profondeur que lui et le bloquent (`1a50:0006`). Rend les `Num` posés.
 */
export function dropAll(p: Robot, spots: readonly (readonly [number, number])[]): number[] {
  const dropped: number[] = [];
  for (let k = 0; k < 20 && p.hero.contents.length > 0; k++) {
    const item = p.hero.contents[0]!;
    const name = ITEM_NAMES[item.num];
    if (!name) throw new Error(`objet ${item.num} sans nom`);
    walkPath(p, [spots[k % spots.length]!], 1500);
    const before = [...p.hero.contents];
    p.say(`jeter ${name}`);
    // le nom peut désigner un autre objet porté (« la clef » : le trousseau, la clef d'or...) : on note ce qui est réellement parti
    for (const o of before) if (!p.hero.contents.includes(o)) dropped.push(o.num);
  }
  p.need(p.hero.contents.length === 0, "objets non posés");
  return dropped;
}

/** Reprend les objets de ces `Num` posés dans la salle (la réaction « trop loin » mène le héros à chacun). */
export function takeAll(p: Robot, nums: readonly number[]): void {
  for (const num of nums) {
    const name = ITEM_NAMES[num]!;
    for (let k = 0; k < 3 && p.state.loadedRoom!.listA.some((o) => o.num === num); k++) {
      p.say(`prendre ${name}`);
    }
  }
}

/**
 * La bouteille d'hydromel (`Num 332`) est dans l'armoire de l'antre de Prytwen (salle 105) ; dans son antre Prytwen aborde toujours le
 * héros et le duel y est mortel (`28b1:0114`, `d = 0`). Le héros pose tout dans la salle 104 (Prytwen vole les objets de valeur de la
 * dépouille), ouvre la porte 111, entre et demande à ouvrir l'armoire de loin : Prytwen vient « l'expliquer » (il suit le héros) et le
 * tue ; « continuer » (F4, `2594:043a`) le fait renaître au centre de la salle 105, et Prytwen, qui le suit déjà, ne l'aborde plus :
 * l'armoire, la bouteille, puis le retour dans la salle 104 où il reprend tout.
 */
export function bottle(p: Robot): number[] {
  p.goTo(104);
  const dropped = dropAll(p, [[60, 96], [78, 96], [96, 96], [114, 96], [132, 96], [60, 80], [78, 80], [114, 80], [132, 80], [60, 64], [78, 64], [132, 64]]);
  // la porte 111 (au fond, X 80 à 95)
  walkPath(p, [[88, 40]]);
  p.say("ouvrir la porte");
  p.attempt(
    "bouteille",
    20,
    () => {
      walkPath(p, [[88, 40], [88, 24]]);
      p.arrow("up");
      p.until(() => p.roomId !== 104, 400);
      p.need(p.roomId === 105, `salle ${p.roomId}`);
      const thief = (): GameObject => p.object(PRYTWEN);
      const armoire = (): void => {
        // l'armoire (26, 115, 151) : à portée depuis P 144 (écart de profondeur < 9)
        walkPath(p, [[60, 120], [44, 136]]);
        p.arrow("down");
        p.until(() => p.hero.p >= 144, 300);
        p.arrow("down");
        p.run(5);
        p.need(p.say("ouvrir l'armoire").length > 0, "armoire");
        p.say("prendre la bouteille dans l'armoire");
        p.need(p.has(332), "pas de bouteille");
      };
      if (thief().room?.id !== 105) {
        // Prytwen court le château : l'antre est libre
        armoire();
      } else {
        // fouiller ses affaires de loin : Prytwen vient « l'expliquer » au héros (il le suit) ; duel perdu d'avance dans l'antre
        p.say("ouvrir l'armoire");
        if (!p.until(() => !p.state.hero, 3000)) throw new RobotSetback("Prytwen n'a pas attaqué");
        for (let k = 0; k < 40 && thief().room?.id === 105; k++) p.wait(100);
        p.host.key({ type: "function", n: 4 });
        p.run(5);
        p.drain();
        p.need(!!p.state.hero && p.roomId === 105, "pas de résurrection");
        armoire();
        // Prytwen, qui ne s'occupe plus du héros, finit par quitter son antre (une décision sur quatre, `28b1:0703`) : on attend qu'il
        // sorte, hors de l'antre on pourra le combattre
        for (let k = 0; k < 80 && thief().room?.id === 105; k++) p.wait(100);
        p.need(thief().room?.id !== 105, "Prytwen reste dans son antre");
      }
      // retour par le seuil (au fond, X 104 à 119)
      walkPath(p, [[114, 40], [112, 30]]);
      p.arrow("up");
      p.until(() => p.roomId !== 105, 400);
      p.need(p.roomId === 104, `salle ${p.roomId}`);
      p.stop();
    },
    () => p.has(332) && p.roomId === 104,
  );
  return dropped;
}

/**
 * Passe de la salle courante à sa voisine `next` (`Robot.goTo`) : la voûte du fond de la salle 106 (sortie haute vers 103) est à gauche,
 * les clics de bord n'y mènent pas (ils mènent à la sortie de droite) ; le héros libre se place dessous (P 15) puis flèche haut, comme à
 * l'étape (c). Chargé de Prytwen il ne suit pas les clics (`26ab:01fc`) : `Robot.goTo` seul.
 */
function hopTo(p: Robot, next: number, avoid: ReadonlySet<number> = new Set(), quick = false): void {
  if (p.roomId !== 106 || next !== 103 || p.hero.ego !== 0) {
    p.goTo(next, avoid, quick);
    return;
  }
  p.stop(); // le héros garde son élan en entrant
  p.run(15);
  for (let k = 0; k < 3 && p.state.hero && (p.roomId as number) === 106; k++) {
    p.walkTo(36, 44, 1500);
    // le clic peut laisser le héros à côté du couloir de la voûte (X 37 à 44) : on s'y place aux flèches
    if (p.state.hero && p.hero.x < 38) {
      p.arrow("right");
      p.until(() => !p.state.hero || p.hero.x >= 39, 200);
      p.arrow("right");
      p.run(5);
    }
    p.arrow("up");
    p.until(() => p.roomId !== 106 || !p.state.hero, 600);
  }
  if (!p.state.hero) throw new RobotSetback("héros mort sous la voûte de la salle 106");
  p.need((p.roomId as number) === 103, `voûte de la salle 106 : salle ${p.roomId}`);
  p.stop();
  p.run(30); // fin de l'animation de refus du curseur : un clic envoyé dedans serait perdu
  p.drain();
}

/**
 * Les salles du château assez larges pour y combattre Prytwen puis y poser des objets sans boucher un passage : la 104 (cases de pose
 * connues), le hall 103, la salle 111 (carrefour du château) et la 101 (arrivée de la forêt). Les autres sont des boyaux (106 et 108 :
 * un objet posé y barre le passage) ou l'antre (105, duel mortel).
 */
const FIGHT_ROOMS: ReadonlySet<number> = new Set([104, 103, 111, 101]);
/** Les salles du château où le héros va chercher Prytwen (ni son antre 105, ni la geôle 110, ni la mine). */
const CHASE_ROOMS: ReadonlySet<number> = new Set([101, 102, 103, 104, 106, 107, 108, 109, 111]);

/** Marche jusqu'à la salle `target` de salle en salle (`hopTo`), le héros étant libre. */
function goVia(p: Robot, target: number): void {
  for (let guard = 0; p.roomId !== target && guard < 60; guard++) {
    const route = p.route(target);
    if (!route) throw new Error(`aucune route de la salle ${p.roomId} à ${target}`);
    hopTo(p, route[0]!);
  }
}

/** La salle de `FIGHT_ROOMS` la plus proche du héros (en nombre de salles à traverser). */
function nearestFightRoom(p: Robot): number {
  let best = 104;
  let bestLength = Number.POSITIVE_INFINITY;
  for (const room of FIGHT_ROOMS) {
    const length = room === p.roomId ? 0 : (p.route(room)?.length ?? Number.POSITIVE_INFINITY);
    if (length < bestLength) [best, bestLength] = [room, length];
  }
  return best;
}

/** Salles interdites au héros qui cherche Prytwen : son antre (duel mortel) et la mine. */
const PRYTWEN_AVOID: ReadonlySet<number> = new Set([105, ...Array.from({ length: 200 }, (_, k) => 200 + k)]);

/** Route du héros jusqu'à la salle de Prytwen, ou `null` si elle est hors d'atteinte (forêt, mine, antre). */
function prytwenWay(p: Robot): number[] | null {
  const room = p.object(PRYTWEN).room?.id;
  return room !== undefined && CHASE_ROOMS.has(room) ? p.route(room, PRYTWEN_AVOID) : null;
}

/**
 * Prytwen, sorti de son antre, n'est plus dans la salle chargée : il n'y fait que changer de salle (il reste environ 900 images dans
 * chacune puis prend une sortie tirée au hasard, `228e:0000`, aussi hors de la salle chargée) et ne poursuit le héros que dans la salle
 * de celui-ci (`22ef:0000`). Le château lui est ouvert, jusqu'à la dalle de la salle 5 (`barrier` 104) et celle du trône : une fois
 * parti dans la forêt ou la mine il ne revient guère (la marche au hasard couvre toute la carte). Le héros va donc le trouver là où il
 * est, d'une salle à l'autre sans rien faire entre-temps (il rejoint la salle de Prytwen avant qu'il en reparte) ; hors d'atteinte (forêt,
 * mine, antre : route fermée au héros ou évitée) il l'attend au carrefour 111, où il finit par passer s'il revient au château.
 *
 * Le dernier pas, vers la salle voisine de Prytwen, est sauvegardé : Prytwen, qui poursuit le héros, peut le croiser à la sortie et le duel
 * s'achever hors de la salle chargée (Prytwen KO, mais sans les points de l'attaque, et le héros qui n'a plus de sauvegarde d'avant le
 * duel) ; le joueur recharge alors et recommence ce pas.
 */
function meetPrytwen(p: Robot, here: () => boolean, retake: () => void): void {
  const prytwen = (): GameObject | undefined => p.state.objects.find((o) => o.num === PRYTWEN);
  const dueled = (): boolean => (prytwen()?.ego ?? 0) !== 0;
  // Prytwen parti au loin (forêt, mine) sans revenir, dévoré par l'ours ou héros mort : le joueur recharge sa dernière sauvegarde (le
  // hasard continue, Prytwen ne repart pas forcément de même). C'est celle du dernier pas vers sa salle (`hopped`) ou, avant, celle de
  // la reprise des torches et du trousseau, qu'il faut alors refaire (`retake`).
  let hopped = false;
  let rewinds = 0;
  let settled = false;
  const rewind = (why: string): number => {
    if (++rewinds > 30) throw new RobotSetback(why);
    p.restore();
    if (!hopped) retake();
    settled = false;
    return 0;
  };
  for (let round = 0; round < 600 && !here(); round++) {
    if (!p.state.hero || !prytwen()) {
      round = rewind(!p.state.hero ? "héros mort en cherchant Prytwen" : "Prytwen dévoré");
      continue;
    }
    const way = prytwenWay(p);
    const from = p.roomId;
    if (way?.length === 1) {
      p.save();
      hopped = true;
      hopTo(p, way[0]!, PRYTWEN_AVOID, true);
      if (!p.state.hero || (here() && dueled())) {
        p.restore();
        continue;
      }
    } else if (way && way.length > 0) hopTo(p, way[0]!, PRYTWEN_AVOID, true);
    else if (!FIGHT_ROOMS.has(from)) hopTo(p, p.route(111, PRYTWEN_AVOID)![0]!, PRYTWEN_AVOID, true);
    // arrivé dans sa salle, pas une image à perdre : il vient au contact et pose son ultimatum
    if (here()) break;
    // le héros garde son élan en entrant ; arrêté, un clic sous ses pieds pourrait le mener à une autre profondeur de même hauteur
    if (p.roomId !== from) p.stop();
    // le héros qui attend se met au large : le duel à deux corps (`Ego 1` / `Ego 6`, positions superposées) ne s'achève pas dans un
    // passage étroit (le seuil de l'antre, où `bottle` laisse le héros, la voûte d'une salle...)
    if (!settled && FIGHT_ROOMS.has(p.roomId)) {
      const [x, depth] = dropSpots(p, 1)[0] ?? [p.hero.x, p.hero.p];
      placeAt(p, x, depth);
      settled = true;
    }
    p.until(here, 100);
    if (round === 599 && !here()) round = rewind("Prytwen ne vient pas") - 1;
  }
  if (!here()) throw new RobotSetback("Prytwen ne vient pas");
  // les sorties ratées en route (Prytwen parti entre-temps) ne disent rien du château : le joueur les oublie
  p.forgetFailures();
}

/**
 * Prytwen, sorti de son antre à la suite du héros (`bottle`), parcourt le château, ramasse les objets de valeur et poursuit le héros, qui
 * l'attend dans la salle 104 ; hors de l'antre le duel se joue au hasard (`28b1:0114`) : sauvegarde dès son entrée, « attaquer Prytwen »
 * à portée avant son contact (+10, `28b1:0e7d`), et s'il n'est pas mis KO (+40, `28b1:02b8`) le héros assommé est dépouillé :
 * restauration et nouvel essai.
 */
export function knockOutPrytwen(p: Robot, retake: () => void = () => undefined): void {
  if (!p.state.objects.some((o) => o.num === PRYTWEN)) throw new Error("Prytwen a disparu (dévoré ?)");
  const thief = (): GameObject => p.object(PRYTWEN);
  const here = (): boolean => !!p.state.hero && p.state.objects.some((o) => o.num === PRYTWEN && o.room === p.state.loadedRoom);
  const attacked = (): boolean => p.state.scoreTable.some((e) => e.id === 100 && e.points < 0);
  // image par image : Prytwen poursuit le héros (`22ef:0000`, `AX = 7`) et l'atteint vite ; attendu par tranches, il aurait déjà posé son
  // ultimatum quand l'essai sauvegarde. Hors de la salle chargée Prytwen reste figé après une restauration (observé, non expliqué) : l'essai ne peut sauvegarder qu'une
  // fois Prytwen et le héros dans la même salle (la restauration le rend alors tel quel, en marche)
  meetPrytwen(p, here, retake);
  p.need(here(), "Prytwen ne vient pas");
  p.attempt(
    "duel contre Prytwen",
    40,
    () => {
      // on attaque dès qu'il est à portée et libre (`Ego 0`) : à son contact hors de son antre il pose son ultimatum (`Ego 5` : le héros perd
      // la main, « Pas maintenant ! »), puis le duel vient de ce contact, sans les points de l'attaque. La ligne de saisie arrête le monde :
      // la commande part dans le tic même
      const inReach = (): boolean => here() && thief().ego === 0 && (p.engine as unknown as { inReach(o: unknown): boolean }).inReach(thief());
      if (!inReach() && !p.until(() => inReach() || !p.state.hero || thief().ego !== 0, 20000)) throw new RobotSetback("Prytwen hors de portée");
      if (!inReach()) throw new RobotSetback("Prytwen hors de portée");
      p.host.type("attaquer Prytwen\r");
      if (!p.until(() => !p.state.hero || thief().ego === 1 || attacked(), 300)) throw new RobotSetback("pas de duel");
      p.until(() => !p.state.hero || thief().ego !== 1, 3000);
      p.wait(100);
      if (thief().ego !== 2) throw new RobotSetback("Prytwen n'est pas KO");
      // Prytwen poursuit le héros (`22ef:0000`, `AX = 7`) : s'il le touche le premier, le duel vient de son contact, sans les points de
      // l'attaque (1, 0)
      if (!attacked()) throw new RobotSetback("duel sans l'attaque");
    },
    () => thief().ego === 2 && attacked(),
  );
}

/** Reprend à Prytwen assommé ce qu'il a volé (`28b1:0fba`, `prendre X à Prytwen`). */
export function robPrytwen(p: Robot): number[] {
  const thief = (): GameObject => p.object(PRYTWEN);
  const taken: number[] = [];
  for (const loot of [...thief().contents]) {
    const name = ITEM_NAMES[loot.num];
    if (!name) continue;
    p.say(`prendre ${name} à Prytwen`);
    if (p.has(loot.num)) taken.push(loot.num);
  }
  return taken;
}

/**
 * Le château avec le trousseau (salle 104) : la bouteille de l'antre (`bottle`), Prytwen mis KO hors de son antre (`knockOutPrytwen`),
 * dépouillé de son butin, porté jusqu'à la geôle et enfermé (`jail`) ; le héros attend son réveil dans la salle 109 (il se relève,
 * `28b1:12e0`, décide, se voit derrière la grille fermée : +30, `28b1:0583`), puis revient reprendre ses affaires dans la salle 104.
 */
export function castle(p: Robot): void {
  // les affaires du héros restent dans la salle 104 : Prytwen est attendu les mains vides (il aborde alors toujours le héros), et le
  // temps passé à les ramasser le laisserait partir et poser son ultimatum avant l'attaque
  const dropped = bottle(p);
  // seuls sont repris les torches (les salles du château sont sombres : « Je ne vois rien, il fait trop noir », plus de clic de marche) et
  // le trousseau, seul objet de valeur : Prytwen aborde alors toujours le héros (une chance sur n, n = 1), et ce qu'il faut pour la geôle
  // est là au réveil de Prytwen (environ 20 000 images après le KO) ; le reste est repris au retour
  // Prytwen, qui parcourt le château et poursuit le héros, peut arriver pendant la reprise et poser son ultimatum avant l'attaque (le duel
  // vient alors de son contact, sans les points de l'attaque) : la reprise est un essai, recommencé depuis la sauvegarde
  const carried = dropped.filter((num) => num === 12 || num === 108);
  p.attempt(
    "reprise du trousseau et des torches",
    20,
    () => takeAll(p, carried),
    () => p.roomId === 104 && carried.every((num) => p.has(num)) && p.object(PRYTWEN).ego === 0,
  );
  knockOutPrytwen(p, () => takeAll(p, carried));
  robPrytwen(p);
  // le héros ne porte Prytwen (450) qu'en n'ayant presque rien d'autre (`20ac:0060`, charge 500) : il pose le butin repris à Prytwen,
  // sauf les objets légers
  const left: number[] = [];
  // Prytwen est mis KO dans la salle où le héros l'a rejoint (`meetPrytwen`), pas forcément la 104 ni une salle large : le butin est posé
  // dans la salle large la plus proche (`dropSpots` : cases dégagées), le héros revient chercher Prytwen, puis reprend le butin au retour
  const fightRoom = p.roomId;
  const leftRoom = nearestFightRoom(p);
  const load = (): number => p.hero.contents.reduce((sum, o) => sum + o.weight, 0);
  const overweight = (): boolean => load() + p.object(PRYTWEN).weight > p.hero.capacity;
  if (overweight()) {
    goVia(p, leftRoom);
    const spots = leftRoom === 104 ? CASTLE_SPOTS : dropSpots(p, 12);
    for (let k = 0; k < 20 && overweight(); k++) {
      // les plus lourds d'abord, jusqu'à ce que Prytwen passe (`20ac:0060` : poids du contenu + Prytwen <= charge)
      const extra = [...p.hero.contents].filter((o) => ITEM_NAMES[o.num]).sort((a, b) => b.weight - a.weight)[0];
      if (!extra) break;
      placeAt(p, ...spots[k % spots.length]!);
      const before = [...p.hero.contents];
      p.say(`jeter ${ITEM_NAMES[extra.num]}`);
      for (const o of before) if (!p.hero.contents.includes(o)) left.push(o.num);
      if (p.hero.contents.includes(extra)) throw new RobotSetback(`${extra.num} non posé`);
    }
  }
  goVia(p, fightRoom);
  p.need(p.say("prendre Prytwen").length > 0 && p.has(PRYTWEN), "Prytwen trop lourd");
  jail(p);
  // le héros sort de la salle avec la pépite : à son réveil, hors de la salle chargée, Prytwen décide et se voit derrière la grille
  // fermée (s'il voyait le héros, il irait à lui et le toucherait au travers de la grille)
  p.goTo(109);
  p.need(p.until(() => p.state.scoreTable.some((e) => e.id === 102 && e.points < 0), 40000), "Prytwen n'est pas pris");
  p.wait(100);
  p.forgetFailures();
  // la pépite (450) reste dans la salle 104, avec le fouet et le levier, devenus inutiles : on reprend le reste
  p.goTo(104);
  walkPath(p, [[96, 72]]);
  p.say("jeter la pepite");
  takeAll(p, [...dropped, ...left].filter((num) => num !== 10 && num !== 11));
  if (left.length > 0 && leftRoom !== 104) {
    goVia(p, leftRoom);
    takeAll(p, left.filter((num) => num !== 10 && num !== 11));
    goVia(p, 104);
  }
  // ce que Prytwen a rangé dans son gros coffre de bronze (`Num 110`, antre 105 ; il y dépose son butin au contact, `28b1:04db`) :
  // la clef de bronze (`Num 109`, reprise sur Prytwen assommé) l'ouvre
  const stashed = [205, 206, 25, 6, 108].filter((num) => p.object(num).holder?.num === 110);
  if (stashed.length > 0) {
    p.goTo(105);
    for (let k = 0; k < 3 && p.object(110).ego !== 2; k++) p.say("ouvrir le coffre avec la clef");
    p.need(p.object(110).ego === 2, "coffre de bronze fermé");
    for (const num of stashed) p.say(`prendre ${ITEM_NAMES[num]} dans le coffre`);
    p.goTo(104);
  }
  p.need(!p.has(105) && [6, 108, 205, 206, 25].every((num) => p.has(num)), `affaires non reprises : ${[6, 108, 205, 206, 25].filter((num) => !p.has(num)).map((num) => `${num}@${p.object(num)?.room?.id ?? p.object(num)?.holder?.num}`).join(" ")}`);
}

/**
 * Entrée de score (2, 4) : un nain guerrier (`Num 203`, `204`) tué en duel (+10, `2a44:06c6`). Sur la route de la mine (étape (c)) la
 * rencontre dépend du hasard ; sinon, armé de l'épée et du bouclier (chaque duel est gagné, `2a44:02de`), le héros va dans la salle d'un
 * guerrier et l'attend : le nain qui le voit vient à lui (`2a44:135a`) et le duel naît de son contact.
 */
export function warriorDuel(p: Robot): void {
  const awarded = (): boolean => p.state.scoreTable.some((e) => e.id === 204 && e.points < 0);
  if (awarded()) return;
  p.need(p.has(314) && p.has(205), "ni épée ni bouclier");
  const warrior = (): GameObject | undefined =>
    p.state.objects.find((o) => (o.num === 203 || o.num === 204) && o.room && o.holder === null && o.gst === 7 && o.room.id >= 200 && o.room.id < 400);
  p.attempt(
    "nain guerrier",
    20,
    () => {
      for (let k = 0; k < 6 && !awarded(); k++) {
        const target = warrior();
        if (!target) throw new Error("plus de nain guerrier");
        if (target.room!.id !== p.roomId) p.crossAll(target.room!.id);
        p.until(() => awarded() || !p.state.hero || warrior()?.room !== p.state.loadedRoom, 3000);
        p.drain();
      }
    },
    awarded,
  );
}

/**
 * Marche jusqu'à la case `[X, P]` : le clic des bottes choisit la profondeur d'après la hauteur du sol, et sur un sol plat il ne bouge pas
 * le héros en profondeur ; on finit donc aux flèches (haut / bas) jusqu'à la profondeur voulue.
 */
function placeAt(p: Robot, x: number, depth: number): void {
  walkPath(p, [[x, depth]], 1500);
  if (!p.state.hero || Math.abs(p.hero.p - depth) <= 6) return;
  const key = depth > p.hero.p ? "down" : "up";
  p.arrow(key);
  p.until(() => !p.state.hero || (key === "down" ? p.hero.p >= depth : p.hero.p <= depth), 600);
  p.arrow(key);
  p.run(5);
}

/** Geysers (`Num 304`) de la salle chargée (la salle 304 : décors fixes, jets au hasard). */
function geysers(p: Robot): GameObject[] {
  const room = p.state.loadedRoom!;
  return [...room.listA, ...room.listB].filter((o) => o.num === 304);
}

/**
 * Images au plus tôt avant le prochain jet mortel d'un geyser (`decor.ts` `geyser`, `33ef:0004`) : au repos (`Ego 0`) il attend sa
 * minuterie (une unité de `Tim` dure plus de 6 images) puis jaillit (`Ego 1`, 90 images au moins) et tue celui qui est à portée à la
 * fin du jet ; il retombe ensuite (`Ego 2`) avant de tirer au sort son prochain état. Le jaillissement en cours (`Ego 1`) peut finir
 * d'un instant à l'autre : aucune marge.
 */
function geyserQuiet(g: GameObject): number {
  if (g.ego === 0) return g.tim * 6 + 90;
  if (g.ego === 2) return 90;
  return 0;
}

/** La case `[X, P]` est à portée de brûlure du geyser (24 pixels en X, 10 en profondeur, plus une marge pour la dérive du héros). */
function inGeyserReach(g: GameObject, x: number, depth: number, margin = 4): boolean {
  return Math.abs(g.x - x) <= 24 + margin && Math.abs(g.p - depth) <= 10 + margin;
}

/**
 * Un pas du chemin de la salle 304 jusqu'à la case `[X, P]` : le joueur voit les jets et ne s'avance dans la zone d'un geyser que si
 * celui-ci est au repos pour de bon (`geyserQuiet` plus long que la marche). Le héros qui attend est mis à l'abri : il ne reste que
 * hors de portée de tous les geysers, sinon il avance (ou recule) sans attendre ; `careful` : il n'avance pas non plus vers un geyser en plein
 * jet qui ne le menace pas encore (il le tuerait en retombant).
 */
function geyserStep(p: Robot, x: number, depth: number, from: readonly [number, number] | null, careful: boolean): void {
  const targetY = p.floor(x, depth);
  // durée maximale d'un pas (images) : le geyser doit rester au repos tout ce temps-là
  const walk = 140;
  for (let k = 0; k < 400 && p.state.hero; k++) {
    const hx = p.hero.x;
    const hp = p.hero.p;
    const onPath = [0, 0.25, 0.5, 0.75, 1].map((t) => [hx + (x - hx) * t, hp + (depth - hp) * t] as const);
    const risky = geysers(p).filter((g) => onPath.some(([px, pd]) => inGeyserReach(g, px, pd)));
    const exposed = geysers(p).some((g) => inGeyserReach(g, hx, hp));
    if (risky.every((g) => geyserQuiet(g) >= walk)) break;
    // à découvert : mieux vaut avancer tant que le jet du geyser le plus proche n'est pas imminent que rester sur place, mais pas vers un
    // geyser en plein jet qui ne menace pas encore le héros (il le tuerait en retombant)
    if (exposed) {
      const jetting = careful && risky.some((g) => g.ego === 1 && !inGeyserReach(g, hx, hp));
      const imminent = geysers(p).some((g) => inGeyserReach(g, hx, hp) && geyserQuiet(g) < 40);
      if (!imminent && !jetting) break;
      if (imminent && from) {
        p.walkTo(from[0], p.floor(from[0], from[1]), 600);
        p.drain(2);
        continue;
      }
    }
    p.run(5);
    p.drain(2);
  }
  p.walkTo(x, targetY, 1500);
  p.drain(2);
}

/** Longe la salle 304 de case en case en évitant les jets des geysers (`geyserStep`). */
function lavaWalkSafely(p: Robot, path: readonly (readonly [number, number])[], careful: boolean): void {
  let previous: readonly [number, number] | null = null;
  for (const [x, depth] of path) {
    for (let k = 0; k < 3 && p.state.hero && Math.abs(p.hero.p - depth) > 6; k++) geyserStep(p, x, depth, previous, careful);
    previous = [x, depth];
  }
}

/**
 * La planche de la salle 304 (`Num 308`, au fond de la salle de lave) : le trajet de la rampe du dôme à la salle 302 se fait salle par
 * salle (`Robot.crossTo` : une sauvegarde avant chaque salle de nains), les torches sont posées en 302, puis la salle de lave est
 * longée case par case en évitant les jets des geysers ; Minas Thyl propose son pacte puis attend (`Ego 5`, elle n'empêche pas de
 * prendre la planche). Chaque essai de la lave repart de la salle 302 (sauvegardée une fois les torches posées) ; au retour on reprend
 * les torches.
 */
export function plank(p: Robot): void {
  p.attempt(
    "approche de la rampe du dôme",
    20,
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
    },
    () => p.roomId === 202,
  );
  for (const room of p.route(302)!) p.crossTo(room);
  // les vapeurs de la salle 304 éteignent les torches (`147f:0352`, `G373`) : on les laisse ici, allumées
  p.dropTorches();
  // les premiers essais se fient aux seuls jets au repos ; après vingt morts le joueur attend aussi qu'aucun geyser en plein jet ne soit devant lui
  let tries = 0;
  p.attempt(
    "planche",
    40,
    () => {
      p.walkTo(95, 60, 1500);
      p.arrow("up");
      p.until(() => p.roomId !== 302, 600);
      p.stop();
      p.run(30);
      p.need(p.roomId === 304, `salle ${p.roomId}`);
      lavaWalkSafely(p, LAVA_PATH, ++tries > 20);
      // Minas Thyl vient à la rencontre du héros (sans baguette elle ne propose que son pacte : `G325`, puis attend : `Ego 5`)
      for (let k = 0; k < 8 && p.state.hero && !p.has(308); k++) p.say("prendre la planche");
      p.need(p.has(308), "pas de planche");
      // retour par le même chemin (les geysers de la salle tuent parfois : l'essai recommence depuis la sauvegarde)
      lavaWalkSafely(p, [...LAVA_PATH].reverse().slice(1), tries > 20);
      p.goTo(302, new Set(), true);
      // Minas Thyl, sortie du tunnel sur les pas du héros, peut barrer le chemin des torches : sans elles les salles du château et de la
      // mine sont dans le noir, l'essai recommence
      p.takeTorches();
    },
    // Minas Thyl, restée où le héros l'a laissée, ne doit pas être dans son antre (301) : elle y capturerait le héros
    () => p.has(308) && p.roomId === 302 && p.has(12),
  );
}

/** Soldiers (`Num 301`) encore dans la salle de garde. */
function soldiersLeft(p: Robot): number {
  return p.state.objects.filter((o) => o.num === 301 && o.room?.id === 305).length;
}

/**
 * La salle de garde (305), avec l'épée et le bouclier (chaque duel est gagné, `2a44:0359`) : les soldats endormis sont tués dans leur
 * sommeil (« tuer le nain », animation 38), les autres viennent se battre ; le dernier détruit dans la salle donne +30 (`2a44:02cf`). Deux
 * soldats qui se heurtent pendant un duel l'arrêtent (`2273:000c` remet `Ver` à zéro et l'animation ne passe plus à l'image suivante) :
 * le héros reste pris ; restauration et nouvel essai.
 */
export function guardRoom(p: Robot): void {
  p.need(p.roomId === 305, `salle ${p.roomId}`);
  for (let round = 0; round < 8 && soldiersLeft(p) > 0; round++) {
    const before = soldiersLeft(p);
    p.attempt(
      "soldats",
      20,
      () => {
        const sleeper = p.state.objects.find((o) => o.num === 301 && o.room?.id === 305 && o.ego >= 7);
        if (sleeper) p.say("tuer le nain");
        for (let k = 0; k < 40 && soldiersLeft(p) === before; k++) {
          p.wait(100);
          if (p.state.hero && p.hero.ego === 6 && k > 20) break;
        }
        p.wait(200);
        if (soldiersLeft(p) >= before || !p.state.hero || p.hero.ego !== 0) throw new RobotSetback("aucun soldat tué");
      },
      () => soldiersLeft(p) < before,
    );
  }
  p.need(soldiersLeft(p) === 0, "soldats restants");
}

/**
 * La rivière souterraine (salle 207) : à la nage sous le pont de pierre jusqu'au bord droit, la salle 208 (+10, `147f:0130`) ; puis la
 * salle 211, où l'on grimpe la paroi de gauche jusqu'à la niche (salle 210, le repaire de Ségomir) : le parchemin, lu (+20, `2a39:0027`),
 * et les diamants ; retour par la paroi et la rivière. Part de la salle 207, y revient.
 */
export function riverAndLair(p: Robot): void {
  p.need(p.roomId === 207, `salle ${p.roomId}`);
  p.goTo(208);
  p.goTo(211);
  // le pied de la paroi (cases 7 de la rangée P 48, X 60 à 91), `-` jusqu'au haut de la paroi, puis à gauche jusqu'à la niche
  for (let k = 0; k < 4 && p.hero.ground !== 7; k++) {
    p.walkTo(76, 120, 3000);
    p.drain();
  }
  // des nains morts à sa profondeur le bloquent : on s'écarte vers le bas puis on repart
  for (let k = 0; k < 3 && p.hero.ground !== 7; k++) {
    p.stepAway();
    p.walkTo(76, 120, 3000);
    p.drain();
  }
  p.need(p.hero.ground === 7, "pas au pied de la paroi");
  p.run(20);
  p.vertical("-");
  let climbed = p.until(() => p.hero.y <= 54, 800);
  // un nain tué par l'épée au pied de la paroi interrompt la montée : on reprend l'escalade
  for (let k = 0; k < 3 && !climbed && p.state.hero && p.hero.ground === 7 && p.hero.ego === 0; k++) {
    p.vertical("-");
    climbed = p.until(() => p.hero.y <= 54, 800);
  }
  p.need(climbed, "escalade");
  p.vertical("-");
  p.arrow("left");
  p.until(() => p.hero.ground === 82 && p.hero.ego === 0, 1200);
  p.arrow("left");
  p.until(() => p.roomId !== 211, 600);
  p.stop();
  p.need(p.roomId === 210, `salle ${p.roomId}`);
  p.say("prendre le parchemin");
  p.say("lire le parchemin");
  p.say("prendre les diamants");
  // retour : la niche de la salle 211, la paroi (à droite jusqu'au-dessus du pied, puis `=`), la salle 208 et la rivière
  p.goTo(211);
  p.arrow("right");
  p.until(() => p.hero.ground === 7, 200);
  p.arrow("right");
  p.run(10);
  p.vertical("-");
  p.until(() => p.hero.dep === 4, 100);
  p.vertical("-");
  p.arrow("right");
  p.need(p.until(() => p.hero.x >= 76 || p.hero.dep !== 4, 600), "paroi");
  p.arrow("right");
  p.vertical("=");
  p.need(p.until(() => p.hero.ego === 0 && p.hero.dep === 0, 800), "descente");
  p.goTo(207);
}

/** Salle et position de Minas Thyl : change dès qu'elle marche, même hors de la salle chargée. */
function minasSpot(p: Robot): string {
  const minas = p.state.findByNum(303);
  return `${minas?.room?.id}:${minas?.x}:${minas?.p}`;
}

/**
 * Réveille Minas Thyl arrêtée hors de la salle chargée (après une restauration, ou une fois son trajet hors salle tari, elle n'a plus de pas et
 * ne bouge plus tant qu'elle n'est pas chargée) : le héros entre dans sa salle `room` (voisine), le temps qu'elle se mette en marche (vers lui, ou
 * au hasard), puis revient d'où il est venu ; elle poursuit sa marche hors de la salle chargée. Rend faux si elle ne s'est pas ébranlée.
 */
function wakeMinas(p: Robot, room: number): boolean {
  const from = p.roomId;
  const before = minasSpot(p);
  // les vapeurs de la salle 304 éteignent les torches (`G373`) et les salles du château sont dans le noir sans elles : on les pose avant
  if (room === 304) p.dropTorches();
  p.goTo(room, new Set(), true);
  p.stop();
  const moved = p.until(() => !p.state.hero || minasSpot(p) !== before, 150);
  p.goTo(from, new Set(), true);
  p.stop();
  if (room === 304) p.takeTorches();
  return moved;
}

/**
 * L'antre de Minas Thyl (salle 301), avec la baguette et en son absence (dans l'antre elle capture le héros au contact, `2dd9:0858`) : le
 * grimoire, ouvert puis lu avec la baguette (+10, `2b87:00f0`), la fiole de sang de dragon, changée en élixir d'invisibilité par
 * « ezhrimanoth » (+30, `346c:005a`). L'âtre (`Sol 68`, au milieu de la salle) brûle : on le contourne. Part de la salle 302 et y revient.
 */
export function witchLair(p: Robot): void {
  const minas = (): GameObject | undefined => p.state.findByNum(303);
  p.attempt(
    "antre de Minas Thyl",
    20,
    () => {
      // elle erre de salle en salle (301 à 304) ; hors de la salle chargée elle ne marche pas tant qu'elle n'a pas été chargée (après une
      // restauration elle reste arrêtée, au bord du couloir 303 ou dans son antre) : on l'attend dans le couloir, où elle agit, jusqu'à ce
      // qu'elle soit partie ailleurs que dans son antre ou le couloir
      p.goTo(303, new Set(), true);
      p.stop();
      let still = 0;
      for (let k = 0, last = minasSpot(p); k < 100 && (minas()?.room?.id === 301 || minas()?.room?.id === 303); k++) {
        p.wait(100);
        still = minasSpot(p) === last ? still + 1 : 0;
        last = minasSpot(p);
        // arrêtée dans son antre (le couloir la charge, elle y agit)
        if (still >= 5 && minas()?.room?.id === 301) {
          wakeMinas(p, 301);
          // à l'écart de la sortie de l'antre, que Minas Thyl doit pouvoir franchir
          walkPath(p, [[110, 72]], 1500);
          still = 0;
        }
      }
      p.need(minas()?.room?.id !== 301 && minas()?.room?.id !== 303, "Minas Thyl dans son antre ou le couloir");
      p.goTo(301, new Set(), true);
      p.stop();
      p.need(minas()?.room?.id !== 301, "Minas Thyl dans son antre");
      walkPath(p, [[100, 80], [100, 40], [70, 24], [62, 14]], 2000);
      p.say("ouvrir le grimoire");
      p.say("lire le grimoire");
      walkPath(p, [[60, 24], [52, 44]], 2000);
      p.say("prendre la fiole");
      p.need(p.has(304), "pas de fiole");
      p.say("ezhrimanoth");
      walkPath(p, [[100, 40], [100, 80]], 2000);
      p.goTo(303, new Set(), true);
      p.goTo(302, new Set(), true);
      // le héros garde son élan en entrant : sans arrêt il traverse la salle et sort (et l'étape suivante sauvegarde en pleine course)
      p.stop();
    },
    () => p.roomId === 302 && p.has(304) && p.object(304).ego === 1,
  );
}

/**
 * Le talisman contre la baguette : Minas Thyl, qui voit la baguette, vient au héros et l'exige ; on la lui donne dès qu'elle est à portée
 * de main, avant le contact (dans son antre le contact est la capture) : +20 (`2dd9:1358`). Si elle est dans la salle de lave on l'y
 * rejoint (torches posées avant : les vapeurs les éteignent), si elle s'est éloignée on l'attend dans la salle 302.
 */
export function talisman(p: Robot): void {
  const minas = (): GameObject | undefined => p.state.findByNum(303);
  const loaded = (): boolean => !!p.state.hero && !!minas() && minas()!.room === p.state.loadedRoom;
  const reach = (): boolean => loaded() && (p.engine as unknown as { inReach(o: unknown): boolean }).inReach(minas());
  p.attempt(
    "talisman",
    20,
    () => {
      let still = 0;
      for (let k = 0, last = minasSpot(p); k < 40 && !p.has(321); k++) {
        const where = minas()?.room?.id ?? 0;
        still = minasSpot(p) === last ? still + 1 : 0;
        last = minasSpot(p);
        if (!loaded()) {
          // hors de la salle chargée elle ne marche que sur un reste d'élan : arrêtée, elle ne bouge plus tant qu'elle n'est pas chargée. On la
          // cherche dans le couloir 303 (où elle agit) ; arrêtée dans son antre ou dans la salle de lave, on la réveille ; sinon on l'attend
          if (where === 303) p.goTo(303, new Set(), true);
          else if (still >= 3 && (where === 301 || where === 304)) wakeMinas(p, where);
          else if (p.roomId !== 302) p.goTo(302, new Set(), true);
          p.stop();
          p.wait(400);
          continue;
        }
        // elle approche (`G316`, `G317`), puis exige la baguette (`G327`) : on la lui donne dès qu'elle est à portée de main
        for (let i = 0; i < 20 && !p.has(321) && loaded(); i++) {
          if (!p.until(() => reach() || !p.state.hero || !loaded(), 600)) {
            // elle s'est arrêtée à quelques pas (elle attend ce qu'il a à offrir) : la commande la fait venir (`V317`)
            if (!loaded()) break;
            p.say("donner la baguette à Minas");
            continue;
          }
          if (reach()) p.say("donner la baguette à Minas");
        }
      }
      p.need(p.has(321), "Minas Thyl ne vient pas");
      if (p.roomId !== 302) p.goTo(302, new Set(), true);
    },
    () => p.has(321) && p.roomId === 302,
  );
}

/**
 * Le piège du cratère (salle 303) : protégé des laves par la potion (« boire la bouteille », 400 tics, `2c9c:000a`), le héros pose
 * l'émeraude sur l'îlot du cratère (`Sol 61` : le placement passe par `13a8:000a` avec ses effets, +20) et revient ; Minas Thyl, qui
 * convoite l'émeraude, marche sur la lave pour la prendre et s'y engloutit (+40, `2dd9:0358`). Part de la salle 302 et y revient.
 */
export function craterTrap(p: Robot, round = 0): void {
  const minas = (): GameObject | undefined => p.state.findByNum(303);
  p.attempt(
    "cratère",
    20,
    () => {
      p.goTo(303, new Set(), true);
      p.stop();
      // au bord nord de la lave (cases de sol X 48 à 71, P 40 à 55), au-dessus du cratère (X 60 à 71, P 72)
      walkPath(p, [[100, 40], [66, 46]]);
      p.say("boire la bouteille");
      // aux flèches : un clic sur la lave place la destination sur une case de lave, avec le message de la protection à chaque fois
      p.arrow("down");
      p.until(() => p.hero.ground === 61 || p.hero.p >= 78, 400);
      p.arrow("down");
      p.run(3);
      p.need(p.hero.ground === 61, "pas sur le cratère");
      p.say("jeter l'emeraude");
      p.need(!p.has(313) && p.object(313).ground === 61, "émeraude pas sur le cratère");
      p.arrow("up");
      p.until(() => p.hero.p <= 48, 400);
      p.arrow("up");
      p.run(3);
      p.need(p.hero.ground !== 52, "sur la lave");
      p.goTo(302, new Set(), true);
    },
    () => p.roomId === 302 && !p.has(313) && p.state.hero?.num === 1,
  );
  // Minas Thyl vient chercher l'émeraude, et s'engloutit
  // le héros garde son élan en entrant dans la salle 302 : sans arrêt il la traverse et sort
  p.stop();
  // en errant, Minas Thyl passe par la salle 302 où le héros attend : elle l'avertit puis le change en crapaud (`2dd9:14cc`, `Num 327`), ou
  // il meurt. Le joueur recharge alors sa sauvegarde. Après une restauration elle ne marche plus hors de la salle chargée : arrêtée
  // dans sa salle d'origine, hors de portée du héros (salle 8, sans route), elle n'en bougerait jamais. On sauvegarde donc quand elle est
  // dans son antre ou la salle de lave (301, 304), où on sait la réveiller (`wakeMinas`) ; avant cela, un héros perdu reprend l'essai
  // du cratère depuis le début. Les torches brûlent pendant l'attente (36 000 images neuves, 90 000 en tout) et il en faut encore pour le château :
  // au-delà de 500 attentes de 100 images on recharge la sauvegarde, comme si Minas Thyl ne venait pas.
  const lost = (): boolean => p.state.hero?.num !== 1;
  let saved = false;
  for (let restores = 0; minas() && restores < 40; ) {
    let still = 0;
    let last = minasSpot(p);
    for (let k = 0; k < 500 && minas() && !lost(); k++) {
      p.wait(100);
      if (!lost()) relightTorch(p);
      still = minasSpot(p) === last ? still + 1 : 0;
      last = minasSpot(p);
      const where = minas()?.room?.id ?? 0;
      // hors de la salle chargée Minas Thyl ne marche que sur un reste d'élan : arrêtée dans son antre ou la salle de lave, on la réveille ; sinon elle erre au hasard de salle en salle et finit par revenir (longue attente)
      if (still >= 30 && (where === 301 || where === 304)) {
        wakeMinas(p, where);
        still = 0;
      } else if (still >= 30 && where !== 303 && p.roomId !== 302) {
        p.goTo(302, new Set(), true);
        p.stop();
        still = 0;
      } else if (!saved && !lost() && (where === 301 || where === 304) && p.roomId === 302) {
        p.save();
        saved = true;
      }
    }
    // Minas Thyl engloutie mais le héros changé en crapaud par son sort (`Num 327`) : la partie est perdue, la sauvegarde est rechargée
    if (!minas() && !lost()) break;
    restores++;
    p.restore();
    if (!saved) {
      // pas de sauvegarde sûre : on rejoue le cratère depuis sa sauvegarde
      p.need(round < 15, "cratère : Minas Thyl introuvable");
      craterTrap(p, round + 1);
      return;
    }
  }
  p.need(!minas() && !lost(), "Minas Thyl ne vient pas chercher l'émeraude");
  p.wait(200);
}

/** Aucun Sarhûl à moins de `margin` (X et P) du point `(x, depth)`. */
function sarhulsAway(p: Robot, x: number, depth: number, margin = 28): boolean {
  return p.state.objects.filter((o) => o.num === 302 && o.room === p.state.loadedRoom).every((o) => Math.abs(o.x - x) > margin || Math.abs(o.p - depth) > margin);
}

/**
 * La salle de garde (305) puis la fosse des Sarhûls (309) : la porte de fer (`Num 329`, clef ouvragée) au fond de la salle de garde, le
 * seuil (X 72 à 83, à droite du battant ouvert), le compartiment d'entrée de la fosse ; contre la serrure (`Num 334`, (91, 73, 88)),
 * l'élixir d'invisibilité (les Sarhûls ne voient plus le héros ; leur contact reste mortel, `2cdf:02da`). La grille ouvragée
 * (`Num 316`) fermée, les Sarhûls ne peuvent pas venir dans le compartiment. Part de la salle 305.
 */
export function toSarhulPit(p: Robot): void {
  p.need(p.roomId === 305, `salle ${p.roomId}`);
  p.need(p.hero.num === 1, `héros ${p.hero.num}`);
  walkPath(p, [[72, 30], [72, 20]]);
  p.say("ouvrir la porte avec la clef");
  p.need(p.object(329).ego === 2, "porte de fer fermée");
  walkPath(p, [[78, 16]]);
  p.arrow("up");
  p.until(() => p.roomId !== 305, 400);
  p.need(p.roomId === 309, `salle ${p.roomId}`);
  p.stop();
  walkPath(p, [[80, 104], [88, 97]]);
  p.arrow("up");
  p.until(() => p.hero.p <= 96, 300);
  p.arrow("up");
  p.run(3);
  p.say("boire la fiole");
  p.need(p.hero.hidden !== 0, "pas invisible");
}

/** Les Sarhûls de la salle chargée. */
function sarhuls(p: Robot): GameObject[] {
  return p.state.objects.filter((o) => o.num === 302 && o.room === p.state.loadedRoom);
}

/**
 * L'enclos des Sarhûls (salle 309, `(3, 8)` : +40). La fosse est coupée en trois par la grille ouvragée (`Num 316`), qui coulisse
 * entre deux portes : fermée (X 104) elle bouche le compartiment d'entrée (cases 58 / 112), ouverte (X 136) l'**enclos** du bas à
 * droite (cases 57 / 113, `2c1e:0008` : 1 en X par tic). Les points tombent quand elle finit de s'ouvrir avec tous les Sarhûls de la
 * salle sur les cases 57 / 113 (`2c1e:00f6`). Aide `[478]` : « il peut se produire que les Sarhuls aillent tous en même temps de leur
 * plein gré dans l'enclos. Avec de la patience... » : le héros attend dans le compartiment d'entrée (la grille fermée l'en sépare,
 * `2cdf:02da` ne touche que du même côté) qu'ils y soient tous, puis ouvre la grille, ce qui les enferme. L'autre voie de l'aide
 * (`[479]`, `[480]` : le jambon `Num 311` posé dans l'enclos, le premier qui le mange est rejoint par les autres) marche aussi dans le
 * port, mais oblige à traverser la fosse. Part du compartiment d'entrée (`toSarhulPit`), la grille fermée ; finit au même endroit,
 * la grille ouverte, les Sarhûls enfermés.
 */
export function penSarhuls(p: Robot): void {
  p.need(p.roomId === 309 && p.object(316).ego === 0, "fosse, grille fermée");
  const penned = (): boolean => sarhuls(p).every((o) => o.ground === 57 || o.ground === 113);
  p.attempt(
    "enclos des Sarhûls",
    10,
    () => {
      p.need(p.until(penned, 30000), "Sarhûls hors de l'enclos");
      p.say("ouvrir la grille avec la clef");
      p.need(p.until(() => p.object(316).ego === 3, 400), "grille fermée");
    },
    () => p.state.scoreTable.some((e) => e.id === 308 && e.points < 0),
  );
}

/**
 * De la fosse (salle 309) au chapiteau d'Erin Hûviel (salle 314), et la couronne. La herse de pierre (`Num 317`, deux battants) s'ouvre
 * avec la clef d'or depuis sa serrure (`Num 324`, (92, 37, 24)) ; le couloir du fond (X 104 à 139) mène au bord haut. Les Sarhûls
 * franchissent eux aussi la herse ouverte et le contact de l'un d'eux est mortel : on ne s'attarde pas. Dans la salle 314, sur le
 * chapiteau (cases 60, X 48 à 79, abordé par son flanc droit, ouvert de P 40 à 47) avec le talisman : +20 (`246c:074e`, sans lui c'est la mort, animation 39) ; la
 * boule de cristal y est posée sur son coussin : prise puis regardée (+10, `2bea:025d`) ; puis « sillerynn » (+30) et la couronne,
 * qu'on chausse aussitôt : le couronnement détruit les créatures (`2c83:0004`). Un essai qui échoue (un Sarhûl) recommence depuis la
 * sauvegarde faite dans la fosse.
 */
export function chapiterAndCrown(p: Robot): void {
  p.need(p.roomId === 309 && p.has(321) && p.has(25), "talisman et seau");
  p.attempt(
    "chapiteau",
    40,
    () => {
      // derrière la grille fermée on attend qu'aucun Sarhûl ne soit sur le chemin (le côté gauche de la fosse, de la grille à la herse),
      // puis on ouvre la grille et on monte à la herse
      const clear = (): boolean => [88, 64, 40].every((depth) => sarhulsAway(p, 102, depth, 20));
      p.need(p.until(clear, 6000), "Sarhûls sur le chemin de la herse");
      p.say("ouvrir la grille avec la clef");
      p.need(p.until(() => p.object(316).ego === 3, 400), "grille ouvragée fermée");
      walkPath(p, [[100, 88], [96, 56], [96, 28]], 1500);
      // un message de la torche qui se consume (fenêtre) interrompt parfois le trajet : on le reprend
      for (let k = 0; k < 3 && p.hero.p > 32; k++) walkPath(p, [[96, 28]], 1500);
      p.need(p.hero.ground === 56 && p.hero.p <= 32, `pas devant la herse (sol ${p.hero.ground})`);
      p.say("ouvrir la herse avec la clef");
      p.need(p.until(() => p.object(317).ego === 3, 600), "herse fermée");
      walkPath(p, [[120, 20]], 1500);
      p.arrow("up");
      p.until(() => p.roomId !== 309 || !p.state.hero, 400);
      p.need(p.roomId === 314 && p.hero.ego === 0, `salle ${p.roomId}`);
      p.stop();
      // au pied du chapiteau, aux flèches : vers le fond jusqu'à P 44 (le flanc droit du chapiteau y est ouvert), puis vers la gauche
      // jusqu'à ses cases ; le Sarhûl assis devant (P 76) barre le chemin par l'avant
      p.arrow("up");
      p.until(() => p.hero.p <= 44, 300);
      p.arrow("up");
      p.arrow("left");
      p.until(() => p.hero.ground === 60, 400);
      p.arrow("left");
      p.run(5);
      p.need(p.hero.ground === 60, `pas sur le chapiteau (sol ${p.hero.ground})`);
      // la première commande tombe pendant le message du chapiteau (`Z301`) : on la répète
      for (let k = 0; k < 3 && !p.has(315); k++) p.say("prendre la boule");
      p.need(p.has(315), "pas de boule");
      p.say("regarder dans la boule");
      p.need(p.say("sillerynn").length > 0 && p.has(328), "pas de couronne");
      p.say("chausser la couronne");
      p.need(p.state.hero?.num === 333, "pas couronné");
    },
    () => p.state.hero?.num === 333,
  );
}

/**
 * Rallume une torche neuve à la torche qui brûle encore : les torches se consument pendant les longues attentes (36 000 images neuves, `2420:000e`),
 * et la lueur faible d'une torche presque consumée ne suffit plus à voir (« Je ne vois rien, il fait trop noir », plus de clic de marche).
 */
export function relightTorch(p: Robot): void {
  const torches = (): GameObject[] => p.hero.contents.filter((o) => o.num === 12);
  if (torches().some((o) => o.ego >= 2 && o.ego < 4) || !torches().some((o) => o.ego >= 4)) return;
  p.say("allumer la torche avec la torche");
}

/** Les crapauds de la salle chargée. */
function toads(p: Robot): GameObject[] {
  return p.state.objects.filter((o) => o.num === 327 && o.room === p.state.loadedRoom && o.holder === null);
}

/**
 * Écarte les crapauds de la salle chargée (`Num 327`, `2d52:0496` : « tuer » les détruit) : l'un d'eux, dans le couloir étroit de la salle 302,
 * bouche la sortie vers 205 (le héros bute dessus, `Err 0x11`, et le trajet de sortie échoue).
 */
export function clearToads(p: Robot): void {
  for (let k = 0; k < 6 && toads(p).length > 0; k++) {
    const toad = toads(p)[0]!;
    p.say("tuer le crapaud");
    if (toads(p).length === 0) break;
    p.walkTo(Math.max(4, toad.x - 10), p.floor(Math.max(4, toad.x - 10), toad.p), 1500);
  }
}
