/**
 * Jour 9 de Gabriel Knight, de l'arrivée au mont serpenté du Bénin à la carte de La Nouvelle-Orléans, au jour 10.
 *
 * Chaque étape a été recoupée avec les scripts désassemblés (script 710, l'anneau extérieur ; 720, l'anneau central).
 * - L'anneau extérieur compte douze salles ; `exitNorth` mène de la salle n à la salle n + 1, le bord droit à la salle
 *   n - 1 (`rm710::doit` : le rectangle (52, 95)-(90, 109) pour le nord). Gabriel entre par la salle 6. La salle courante est
 *   la variable locale 0 du script ; les locales 21 + 2k et 22 + 2k disent où est la pierre gravée de k serpents et si
 *   elle est au mur (`stuffArray`).
 * - Chaque pierre doit être au mur de la salle de son nombre (`tileCheck`) : les pierres 7 et 12 y sont et ne se
 *   décrochent pas, les dix autres sont au mur d'une autre salle ou par terre. Toutes en place : 3 points.
 * - La tige en forme de serpent (salle 9) dans la pierre de la salle 3 (`rodCode` : « douze et trois tours de clé » du
 *   rêve) ouvre le panneau secret de la salle 7 et réveille les momies (`keyWorks`). Gabriel a la main quelques secondes
 *   par salle : rester sur place le tue (`theDeathScript`, script 711). Il faut aller vers le nord (`rightWay` ; l'autre
 *   sens est `wrongWay`) ; en salle 6 un garde barre la sortie et seule la liane sauve Gabriel (`vineFeat1::doVerb`,
 *   `vineSwing`). En salle 7, Wolfgang retient les momies (`wolfCartoon`) ; la tige dans le trou du passage
 *   (`passageKeyHole`) referme le panneau et mène à l'anneau central (`goToCeremony`).
 * - Anneau central : la table de sacrifice se regarde, son couvercle s'essaie (drapeau 424), les deux barres de fer se
 *   posent dans ses trous (425, 426), puis on pèse dessus : Wolfgang explique qu'il faut un cœur. La dague sur la momie
 *   tombée à l'entrée (`deadGuy`) déclenche la fin du jour (`cutToTheHeart`) : Wolfgang donne le sien, Gabriel prend le
 *   talisman ; Grace est enlevée (pièce 216), le vol du retour passe au jour 10 (pièce 750) et rend la carte.
 */
import { Room } from "./day1";
import { Room5 } from "./day5";
import { Room8 } from "./day8";
import { Verb, type Play } from "./harness";
import type { Stage } from "./walkthrough";

export const Room9 = {
  OuterRing: 710,
  InnerRing: 720,
  GraceTaken: 216,
} as const;

/** Drapeaux du jeu que le jour 9 pose (voir l'en-tête). */
export const Flag9 = {
  TriedLid: 424,
  FirstBar: 425,
  SecondBar: 426,
} as const;

const RING_SCRIPT = 710;
/** Variables locales du script 710 : la salle courante, « les momies sont réveillées ». */
const RING_ROOM = 0;
const RING_AWAKE = 3;
/** Les pierres qui se déplacent (la 7 et la 12 sont scellées dans leur salle). */
const LOOSE_TILES = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11] as const;
/** Un point du rectangle de la sortie nord, du côté opposé au garde de la salle 5. */
const NORTH_EXIT = { x: 88, y: 107 };
const ROD_ROOM = 9;
const KEY_ROOM = 3;
const VINE_ROOM = 6;
const SECRET_ROOM = 7;

const ringRoom = (play: Play): number => play.local(RING_SCRIPT, RING_ROOM);
const tileRoom = (play: Play, tile: number): number => play.local(RING_SCRIPT, 21 + 2 * tile);
const tileOnWall = (play: Play, tile: number): boolean => play.local(RING_SCRIPT, 22 + 2 * tile) !== 0;
const tilesInPlace = (play: Play): boolean => LOOSE_TILES.every((tile) => tileRoom(play, tile) === tile && tileOnWall(play, tile));

/** La pierre de `tile` serpents dans la salle courante (les trois acteurs `…Tile` portent le nombre dans leur cel). */
function tileHere(play: Play, tile: number): string {
  const actor = play.objects().find((object) => object.kind === "cast" && /Tile$/.test(object.name) && play.num(object.reg, "cel") === tile);
  if (!actor) play.fail(`pas de pierre ${tile} dans la salle ${ringRoom(play)}`);
  return actor.name;
}

/** Passe à la salle suivante par la sortie nord. */
function northRoom(play: Play, at?: { x: number; y: number }): void {
  const from = ringRoom(play);
  if (at) {
    play.selectVerb(Verb.Walk);
    play.click(at.x, at.y);
  } else play.use(Verb.Walk, "exitNorth", { settle: false });
  play.waitUntil(() => play.room() !== Room9.OuterRing || ringRoom(play) !== from, 3000, `la sortie de la salle ${from}`);
}

/**
 * Fait le tour de l'anneau jusqu'à ce que chaque pierre soit au mur de sa salle : dans chaque salle, Gabriel prend les
 * pierres qui n'y sont pas à leur place, puis pose celle de la salle s'il l'a ; il prend la tige en passant.
 */
function sortTiles(play: Play): void {
  for (let rooms = 0; !tilesInPlace(play) || !play.carried().includes("rod"); rooms++) {
    if (rooms > 40) play.fail("les pierres ne sont pas toutes en place après trois tours de l'anneau");
    const here = ringRoom(play);
    for (const tile of LOOSE_TILES) {
      if (tileRoom(play, tile) !== here || tile === here) continue;
      play.use(Verb.Pickup, tileHere(play, tile));
      if (play.insetOpen()) play.closeInset();
      play.skipText();
      if (!play.carried().includes(`tile${tile}`)) play.fail(`Gabriel n'a pas pris la pierre ${tile}`);
    }
    if (play.carried().includes(`tile${here}`)) {
      play.useItem(`tile${here}`, "tileSpot");
      play.skipText();
      if (tileRoom(play, here) !== here || !tileOnWall(play, here)) play.fail(`la pierre ${here} n'est pas au mur de sa salle`);
    }
    if (here === ROD_ROOM && play.present("snakeRod") && !play.carried().includes("rod")) play.use(Verb.Pickup, "snakeRod");
    if (tilesInPlace(play) && play.carried().includes("rod")) return;
    northRoom(play);
    play.step(60);
    play.skipText();
  }
}

/** La tige dans la pierre de la salle 3 : le panneau secret s'ouvre, les momies se réveillent, Gabriel reprend la main. */
export function wakeMummies(play: Play): string[] {
  play.useItem("rod", tileHere(play, KEY_ROOM), { settle: false });
  return play.playUntil(() => play.inControl() && play.local(RING_SCRIPT, RING_AWAKE) === 1, 3000, "le réveil des momies");
}

export const DAY9: readonly Stage[] = [
  {
    name: "j9-matin",
    title: "l'anneau extérieur du mont serpenté : chaque pierre gravée au mur de sa salle, la tige en forme de serpent",
    score: 241,
    run(play) {
      if (play.day() !== 9 || play.room() !== Room8.SnakeMound) play.fail("l'étape part du mont serpenté, au jour 9");
      play.use(Verb.Walk, "moundEntry", { settle: false });
      play.playUntil(() => play.room() === Room9.OuterRing && play.inControl() && play.texts().length === 0, 6000, "l'intérieur du mont");
      // Dix pierres à remettre dans la salle de leur nombre (3 points), la tige de la salle 9 (1 point).
      sortTiles(play);
      // Retour à la salle 3, celle de la pierre aux trois serpents.
      for (let rooms = 0; ringRoom(play) !== KEY_ROOM; rooms++) {
        if (rooms > 12) play.fail("Gabriel ne retrouve pas la salle 3");
        northRoom(play);
        play.step(60);
        play.skipText();
      }
    },
  },
  {
    name: "j9-momies",
    title: "la tige dans la pierre aux trois serpents : les momies, la fuite par le nord, la liane, Wolfgang, le panneau secret",
    score: 250,
    run(play) {
      // « Douze et trois tours de clé » : la tige dans la pierre de la salle 3 (5 points).
      const woken = wakeMummies(play);
      if (!woken.some((text) => text.includes("ça a déclenché quelque chose"))) play.fail("la tige n'a rien déclenché");
      // Vers le nord, sans traîner : salles 4 et 5 ; dans la 5, le garde est au pied de la sortie, on passe de l'autre côté.
      northRoom(play);
      play.playUntil(() => ringRoom(play) === 4 && play.inControl() && play.texts().length === 0, 3000, "la salle 4");
      northRoom(play);
      play.playUntil(() => ringRoom(play) === 5 && play.inControl() && play.texts().length === 0, 3000, "la salle 5");
      northRoom(play, NORTH_EXIT);
      // Salle 6 : un garde barre le nord, d'autres arrivent du sud ; la liane (2 points).
      play.playUntil(() => ringRoom(play) === VINE_ROOM && play.inControl() && play.texts().length === 0, 3000, "la salle 6");
      if (!play.present("guard2") || !play.present("guard3")) play.fail("les gardes de la salle 6 ne sont pas là");
      play.use(Verb.Operate, "vine1", { settle: false });
      // Salle 7 : Wolfgang retient les momies et crie de refermer le panneau.
      const wolfgang = play.playUntil(() => ringRoom(play) === SECRET_ROOM && play.inControl() && play.texts().length === 0, 6000, "Wolfgang");
      for (const line of ["J'y crois pas, je l'ai fait!", "Gabriel Knight, je présume?", "Le panneau secret, Fils!"]) {
        if (!wolfgang.some((text) => text.includes(line))) play.fail(`la fuite n'a pas dit « ${line} »`);
      }
      // La tige dans le trou du passage (2 points) : le panneau se referme, l'anneau central s'ouvre.
      play.useItem("rod", "passageKeyHole", { settle: false });
      const inner = play.playUntil(() => play.room() === Room9.InnerRing && play.inControl() && play.texts().length === 0, 8000, "l'anneau central");
      if (!inner.some((text) => text.includes("Une roue à l'intérieur d'une roue"))) play.fail("Wolfgang n'a pas accueilli Gabriel dans l'anneau central");
    },
  },
  {
    name: "j9-coeur",
    title: "l'anneau central : la table de sacrifice, les barres de fer, le cœur ; le talisman, Grace enlevée, retour au jour 10",
    score: 263,
    run(play) {
      // La table est à l'est de l'entrée ; Wolfgang lit l'histoire gravée sur son flanc (1 point).
      play.selectVerb(Verb.Walk);
      play.click(318, 135);
      play.step(60);
      play.waitStill(3000);
      play.skipText();
      const story = play.use(Verb.Look, "altar");
      if (!story.some((text) => text.includes("une sorte d'idole"))) play.fail("Wolfgang n'a pas lu la table");
      // Le trou du couvercle attend un cœur ; le couvercle ne cède pas ; les deux barres dans ses trous (1 point chacune).
      play.use(Verb.Look, "tableTop");
      play.use(Verb.Pickup, "tableTop");
      play.use(Verb.Pickup, "bar");
      play.use(Verb.Pickup, "bar2");
      for (const flag of [Flag9.TriedLid, Flag9.FirstBar, Flag9.SecondBar]) if (!play.flag(flag)) play.fail(`la table n'est pas prête (drapeau ${flag})`);
      // Les barres ne suffisent pas : Wolfgang fait de Gabriel le Schattenjäger et l'envoie chercher le cœur de la momie.
      const heart = play.use(Verb.Operate, "bar");
      if (!heart.some((text) => text.includes("prendre le coeur de cette créature morte"))) play.fail("Wolfgang n'a pas demandé le cœur");
      play.selectVerb(Verb.Walk);
      play.click(2, 135);
      play.step(60);
      play.waitStill(3000);
      play.skipText();
      // La dague sur la momie (10 points) : Wolfgang donne son propre cœur. Grace est enlevée ; le vol passe au jour 10.
      play.useItem("knife", "deadGuy", { settle: false });
      const end = play.playUntil(() => play.day() === 10 && play.room() === Room.GreaterMap && play.texts().length === 0, 120_000, "la carte du jour 10");
      for (const line of ["WOLFGANG!  NON!!!", "Tetelo, tu vas payer", "Il porte sur lui le talisman de Ritter"]) {
        if (!end.some((text) => text.includes(line))) play.fail(`la fin du jour 9 n'a pas dit « ${line} »`);
      }
      play.step(100);
    },
  },
];

/** Après le réveil des momies, rester sur place : elles rattrapent Gabriel (pièce 770). */
export function caughtByMummies(play: Play): void {
  play.playUntil(() => play.room() === Room5.Death && play.menu().length === 3, 6000, "la mort dans le mont serpenté");
}
