import { Verb } from "../../../../src/games/drascula/engine/state";
import { Walkthrough } from "../../walkthrough";

/**
 * Aides des tests du chapitre 2 : la solution découpée en étapes, jouées avec le joueur scripté (clics et touches, jamais l'état du
 * moteur). `walkthrough.test.ts` les enchaîne ; les tests de pièces s'en servent pour arriver quelque part avec ce qu'il faut.
 *
 * Plan de la solution (les nombres sont les numéros d'objets des fiches) :
 *  1. l'ivrogne (53) apprend où est Von Braun (cabane de la pièce 2) ; le coffre (183) donne le sac, qu'on regarde dans l'inventaire ;
 *  2. cigarettes : les deux pièces (18) puis une poussée (6) sur le distributeur (188) ;
 *  3. mouchoirs (poubelle 147), faucille (l'aveugle 51 contre l'argent 7), chewing-gum (tonneau 189) ;
 *  4. barreau (165), feuilles (la faucille 14 sur la plante 166), fenêtre de la chapelle (le piton 10 sur 136), tiroir (139), crucifix
 *     (140), porte de la chambre (138), bougie (190) ;
 *  5. Von Braun : la porte de la cabane (177), le menu `OP_3` (choix 1), le laboratoire, le livre (182) donné au pianiste (54),
 *     les bouchons d'oreilles sur le héros, le menu `OP_4`, puis `OP_5` (choix 3 : « J'ai tous les ingrédients ») ;
 *  6. le puits (173) de la pièce 19 : le chapitre 3.
 */

/** Franchit la porte `id` et vérifie qu'on arrive dans la pièce `room`. */
export function go(w: Walkthrough, id: number, room: number): void {
  w.goTo(id, 60_000);
  if (w.room !== room) throw new Error(`porte ${id} : pièce ${w.room} au lieu de ${room}`);
}

/** Clique sur l'objet `id` avec le verbe `verb` ; rend le journal des voix de cette action. */
export function act(w: Walkthrough, verb: number, id: number): string[] {
  const mark = w.mark();
  w.act(verb, id, 60_000);
  return w.voices(mark);
}

/** Parle à l'objet `id` et attend le menu des choix. */
export function talkAndWaitForChoices(w: Walkthrough, id: number): void {
  w.selectVerb(Verb.Talk);
  const { x, y } = w.pointOf(id);
  w.player.click(x, y);
  w.waitForChoices(60_000);
}

/** Clique le choix `n` du menu ouvert sans attendre la réponse (pour interrompre une cinématique que la réponse lance). */
export function clickChoice(w: Walkthrough, n: number): void {
  w.waitForChoices();
  const bottoms = w.engine.dialogs.bottoms(w.engine.choices!.phrases);
  const y = n === 0 ? 1 : bottoms[n - 1] + 1;
  w.player.move(100, y);
  w.player.run(2);
  w.player.move(100, y, 1);
  w.player.move(100, y, 0);
}

/** Pièce 14, l'ivrogne : le menu `OP_2`, « Où puis-je trouver Von Braun ? » (drapeau 40), puis la sortie. */
export function drunkTellsAboutVonBraun(w: Walkthrough): void {
  talkAndWaitForChoices(w, 53);
  w.choose(2);
  w.choose(3);
  w.settle();
}

/** Pièces 14, 16, 15 : le sac de B.J. (regardé : billet et deux pièces), puis les cigarettes du distributeur. Finit dans la pièce 14. */
export function handbagAndCigarettes(w: Walkthrough): void {
  go(w, 162, 16);
  w.act(Verb.Open, 183);
  w.selectVerb(Verb.None);
  w.verbOnItem(Verb.Look, 22);
  go(w, 163, 14);
  go(w, 171, 15);
  w.useItem(18, 188);
  w.act(Verb.Move, 188, 60_000);
  w.selectVerb(Verb.None);
  go(w, 172, 14);
}

/** De l'auberge (14) à l'impasse de l'aveugle (9) : les mouchoirs, la faucille. Finit dans la pièce 10 (la carte). */
export function tissuesAndSickle(w: Walkthrough): void {
  go(w, 159, 12);
  go(w, 158, 8);
  w.act(Verb.Look, 147);
  w.selectVerb(Verb.None);
  go(w, 161, 10);
  go(w, 149, 9);
  w.act(Verb.Talk, 51, 60_000);
  w.act(Verb.Talk, 51, 60_000);
  w.useItem(7, 51, 60_000);
  w.selectVerb(Verb.None);
  go(w, 152, 10);
}

/** De la carte (10) au village (4) puis au carrefour (2), au cimetière (3), à la chapelle (5, 6, 7) : tonneau, barreau, plante, fenêtre, tiroir, bougie. Finit dans la pièce 7. */
export function restOfIngredients(w: Walkthrough): void {
  go(w, 146, 4);
  w.act(Verb.Move, 189);
  w.selectVerb(Verb.None);
  go(w, 126, 2);
  go(w, 127, 3);
  w.act(Verb.Pick, 165);
  w.selectVerb(Verb.None);
  w.useItem(14, 166, 60_000);
  w.selectVerb(Verb.None);
  go(w, 134, 5);
  w.useItem(10, 136, 60_000);
  go(w, 136, 6);
  w.act(Verb.Open, 139);
  w.act(Verb.Pick, 140);
  w.selectVerb(Verb.None);
  w.act(Verb.Open, 138);
  go(w, 138, 7);
  w.act(Verb.Pick, 190);
  w.selectVerb(Verb.None);
}

/** De la chapelle (7) à la cabane de Von Braun (17) par la fenêtre de la chapelle, le cimetière et le carrefour. */
export function chapelToHut(w: Walkthrough): void {
  go(w, 142, 6);
  go(w, 137, 5);
  go(w, 135, 3);
  go(w, 128, 2);
  go(w, 175, 17);
}

/** À la porte de la cabane : on sonne, on parle, « N'ayez pas peur » (choix 1) ; Von Braun ouvre, l'épreuve, on ressort. */
export function vonBraunLetsUsIn(w: Walkthrough): void {
  w.act(Verb.Open, 177, 60_000);
  talkAndWaitForChoices(w, 177);
  w.choose(1);
  w.settle(60_000);
}

/** Du laboratoire (18) à l'auberge (14) : le livre est déjà pris ; on le donne au pianiste (il rend les bouchons d'oreilles). */
export function bookToPianist(w: Walkthrough): void {
  go(w, 178, 17);
  go(w, 176, 2);
  go(w, 125, 4);
  go(w, 145, 10);
  go(w, 148, 12);
  go(w, 156, 14);
  w.useItem(12, 54, 60_000);
  w.selectVerb(Verb.None);
}

/** De l'auberge (14) au laboratoire (18) par la rue, la carte, le village, le carrefour et la cabane. */
export function innToLab(w: Walkthrough): void {
  go(w, 159, 12);
  go(w, 151, 10);
  go(w, 146, 4);
  go(w, 126, 2);
  go(w, 175, 17);
  go(w, 177, 18);
}

/** Dans le laboratoire : les bouchons d'oreilles sur le héros (clic sur lui), puis on parle à Von Braun et on choisit `choice`. */
export function talkToVonBraun(w: Walkthrough, choice: number): void {
  talkAndWaitForChoices(w, 55);
  w.choose(choice);
  w.settle(60_000);
}

/** Les bouchons d'oreilles sur le héros (clic sur lui, objet 50). */
export function earplugsOnHero(w: Walkthrough): void {
  w.takeItem(11);
  w.clickAt(w.hero.x + 12, w.hero.y + 35, 60_000);
}

/** Du début du chapitre jusqu'à la cabane, tous les ingrédients réunis : finit dans la pièce 17 (le héros devant la porte). */
export function toHutWithIngredients(w: Walkthrough): void {
  drunkTellsAboutVonBraun(w);
  handbagAndCigarettes(w);
  tissuesAndSickle(w);
  restOfIngredients(w);
  chapelToHut(w);
}

/** De la chapelle (7), la potion obtenue : la porte du puits (164) puis le puits. */
export function wellFromChapel(w: Walkthrough): void {
  go(w, 164, 19);
  w.goTo(173, 60_000);
}

export interface StartOptions {
  /** Drapeaux levés d'avance (`engine.flags[n] = valeur`). */
  flags?: Record<number, number>;
  /** Objets de l'inventaire d'avance. */
  items?: readonly number[];
  /** Objet de la pièce par lequel le héros arrive (`objExit`) ; le premier objet par défaut. */
  arrival?: number;
}

/**
 * Un test de pièce sans l'enchaînement complet (`docs/drascula/rooms.md` § 5) : le chapitre 2 démarre, l'état voulu est posé par les
 * aides du moteur (drapeaux, objets), puis le héros entre dans la pièce `room` par la porte `arrival`.
 */
export function startIn(room: number, options: StartOptions = {}): Walkthrough {
  const w = new Walkthrough({ chapter: 2 });
  for (const [flag, value] of Object.entries(options.flags ?? {})) w.engine.flags[Number(flag)] = value;
  for (const item of options.items ?? []) w.engine.addObject(item);
  w.state.objExit = options.arrival ?? 0;
  w.hero.x = -1;
  w.player.perform(w.engine.enterRoom(room));
  return w;
}

/** Identifiants des objets de la pièce chargée, dans l'ordre de la fiche. */
export function objectIds(w: Walkthrough): number[] {
  return w.engine.room.objects.map((object) => object.id);
}

/** L'objet `id` de la pièce chargée. */
export function objectOf(w: Walkthrough, id: number) {
  const object = w.engine.room.objects.find((candidate) => candidate.id === id);
  if (!object) throw new Error(`objet ${id} absent de la pièce ${w.room}`);
  return object;
}

/** Pixel (x, y) de l'image présentée par l'hôte après une image de plus. */
export function pixelAt(w: Walkthrough, x: number, y: number): number {
  w.engine.render();
  return w.host.screen![y * 320 + x];
}
