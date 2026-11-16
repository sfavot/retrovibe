/**
 * Jour 8 de Gabriel Knight, du réveil dans la chambre de Wolfgang à l'arrivée au mont serpenté, au Bénin (jour 9).
 *
 * Chaque étape a été recoupée avec les scripts désassemblés. Le jour 8 finit au départ du château (`leaveGermany`,
 * script 500, qui passe au jour 9), puis le vol (pièce 750) mène à la pièce 700.
 * - La clé du rêve est sur la table au pied du lit (`theKey`, script 530) : elle ouvre la porte sculptée de la bibliothèque
 *   (`keyHole::doVerb`, verbe 108 ; `openTheDoor`).
 * - Dans la bibliothèque (script 520), cinq livres se renvoient l'un à l'autre : le Bénin (géographie), « Les Primitifs »
 *   (sociologie), « Les Origines Anciennes de l'Afrique » (histoire), « Les Adorateurs du Soleil » (religions), « Les
 *   Anciennes Fouilles d'Afrique » (archéologie), que Gabriel garde (`bookSnkMnd`) : le mont au double anneau de serpents
 *   est la « roue dans la roue » du rêve. Un titre ne se remarque (« regarder ») qu'une fois cité par le livre précédent.
 * - Le livre montré à Gerde (`showTheSnakeBook`, script 510) ouvre trois répliques ; « On peut utiliser ma carte de
 *   crédit. » (`giveTheCard`) demande la carte de Mosely et fait partir Gabriel.
 */
import { answer, through } from "./day3";
import { Room7 } from "./day7";
import { Verb } from "./harness";
import type { Stage } from "./walkthrough";

export const Room8 = {
  SnakeMound: 700,
} as const;

/** Les cinq livres de la bibliothèque, dans l'ordre où chacun cite le suivant, et un mot du titre que Gabriel y remarque. */
const BOOK_TRAIL = [
  ["puzzleBook1", "La République Populaire du Bénin"],
  ["puzzleBook2", "Les Primitifs"],
  ["puzzleBook3", "Les Origines Anciennes de l'Afrique"],
  ["puzzleBook4", "Les Adorateurs du soleil"],
  ["puzzleBook5", "Les Anciennes Fouilles d'Afrique"],
] as const;

export const DAY8: readonly Stage[] = [
  {
    name: "j8-matin",
    title: "la clé du rêve, la bibliothèque de Wolfgang : cinq livres, jusqu'au mont serpenté du Bénin",
    score: 235,
    run(play) {
      if (play.day() !== 8 || play.room() !== Room7.Bedroom) play.fail("l'étape part de la chambre de Wolfgang, au réveil du jour 8");
      // La clé du rêve, sur la table au pied du lit (1 point) ; elle ouvre la porte sculptée (3 points).
      const key = play.use(Verb.Look, "theKey");
      if (!key.some((text) => text.includes("la même clé que dans mon rêve"))) play.fail("la clé du rêve n'est pas sur la table");
      play.use(Verb.Pickup, "theKey");
      play.useItem("wolfKey", "keyHole", { settle: false });
      const opened = play.playUntil(() => play.room() === Room7.Library && play.inControl() && play.texts().length === 0, 6000, "la bibliothèque");
      if (!opened.includes('"Ca marche!"')) play.fail("la clé n'ouvre pas la bibliothèque");
      // De livre en livre (1 point chacun) : le dernier, sur le mont serpenté, Gabriel le garde.
      for (const [shelf, title] of BOOK_TRAIL) {
        const noticed = play.use(Verb.Look, shelf);
        if (!noticed.some((text) => text.includes(title))) play.fail(`Gabriel ne remarque pas « ${title} »`);
        play.use(Verb.Pickup, shelf);
      }
      if (!play.carried().includes("bookSnkMnd")) play.fail("Gabriel n'a pas gardé le livre sur le mont serpenté");
    },
  },
  {
    name: "j8-gerde",
    title: "le livre montré à Gerde, le billet payé avec la carte de Mosely ; le vol, l'arrivée au mont serpenté (jour 9)",
    score: 237,
    run(play) {
      through(play, Verb.Walk, "archWay", Room7.Bedroom);
      through(play, Verb.Operate, "hallDoor", Room7.GreatHall);
      // Gerde comprend que Wolfgang est en Afrique et demande si Gabriel peut payer l'avion.
      play.useItem("bookSnkMnd", "gerde", { settle: false });
      const africa = play.playUntil(() => play.menu().length > 0, 20_000, "la question de Gerde");
      if (!africa.some((text) => text.includes("Tu as l'argent pour l'avion"))) play.fail("Gerde n'a pas compris où est Wolfgang");
      // La carte de Mosely, encore (2 points) : le carton du château passe au jour 9, puis le vol et la piste du mont.
      const trip = answer(play, "On peut utiliser ma carte de crédit.", 80_000);
      trip.push(...play.playUntil(() => play.day() === 9 && play.room() === Room8.SnakeMound && play.inControl() && play.texts().length === 0, 80_000, "l'arrivée au mont serpenté"));
      for (const line of ["Je vais passer le coup de fil", "Douze et trois tours de clé", "Attendez là"]) {
        if (!trip.some((text) => text.includes(line))) play.fail(`le voyage n'a pas dit « ${line} »`);
      }
    },
  },
];
