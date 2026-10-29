import { describe, expect, it } from "vitest";
import { MsvcRandom } from "../../src/engine/mohawk/rng";
import { createSession, makeZoombini, newGame, typeIndex, type Zoombini } from "../../src/games/zoombinis/game/state";
import {
  addZoombini,
  atCamp,
  campArrive,
  campExitAllowed,
  campLeave,
  collectGroup,
  depositToReserve,
  findShelfEntry,
  groupComplete,
  isAvailable,
  isGameOver,
  pickRandomType,
  pickerEnter,
  pickerLeave,
  putOnShelf,
  remainingToCreate,
  removeZoombini,
  reserveEnd,
  shelfScrollAfterDeposit,
  slotRect,
  takeFromShelf,
  townArrive,
  townBuildingCount,
  townDecorCount,
  townResidentPosition,
  townResidents,
  townScrollBy,
  townScrollDirection,
  trainingGroup,
  type Rect,
} from "../../src/games/zoombinis/game/team";

function party(n: number, from = 0): Zoombini[] {
  return Array.from({ length: n }, (_, i) => {
    const k = from + i;
    return makeZoombini([(k % 5) + 1, (Math.trunc(k / 5) % 5) + 1, (Math.trunc(k / 25) % 5) + 1, 1], k + 1);
  });
}

describe("choix des Zoombinis (1128:13a4, 143a, 16ac, 1b20)", () => {
  it("un type n'est disponible que complet et à moins de deux exemplaires", () => {
    const game = newGame();
    expect(isAvailable(game, [1, 2, 3, 0])).toBe(false);
    expect(isAvailable(game, [1, 2, 3, 6])).toBe(false);
    expect(isAvailable(game, [1, 2, 3, 4])).toBe(true);
    const rng = new MsvcRandom(1);
    expect(addZoombini(game, [1, 2, 3, 4], rng)).not.toBeNull();
    expect(isAvailable(game, [1, 2, 3, 4])).toBe(true);
    expect(addZoombini(game, [1, 2, 3, 4], rng)).not.toBeNull();
    expect(isAvailable(game, [1, 2, 3, 4])).toBe(false);
    expect(addZoombini(game, [1, 2, 3, 4], rng)).toBeNull();
    expect(game.counters.created).toBe(2);
    expect(game.typeCounts[typeIndex([1, 2, 3, 4])]).toBe(2);
  });

  it("l'ajout tire l'octet aléatoire 0..64 de 1168:0755 et refuse un 17e membre", () => {
    const game = newGame();
    const rng = new MsvcRandom(7);
    const ref = new MsvcRandom(7);
    const added = addZoombini(game, [5, 5, 5, 5], rng, 42)!;
    expect(added.variant).toBe(ref.range(0, 0x40));
    expect(added.zoombini).toMatchObject({ id: 42, present: true, attrs: [5, 5, 5, 5] });
    for (let i = 1; i < 16; i += 1) expect(addZoombini(game, party(16)[i]!.attrs, rng)).not.toBeNull();
    expect(game.group.members).toHaveLength(16);
    expect(addZoombini(game, [3, 3, 3, 3], rng)).toBeNull();
  });

  it("le retrait libère l'exemplaire et le compteur", () => {
    const game = newGame();
    const rng = new MsvcRandom(2);
    addZoombini(game, [1, 1, 1, 1], rng);
    addZoombini(game, [2, 2, 2, 2], rng);
    const z = removeZoombini(game, 0)!;
    expect(z.attrs).toEqual([1, 1, 1, 1]);
    expect(game.counters.created).toBe(1);
    expect(game.typeCounts[typeIndex([1, 1, 1, 1])]).toBe(0);
    expect(removeZoombini(game, 5)).toBeNull();
  });

  it("le groupe est complet à 16, ou non vide quand les 625 sont créés", () => {
    const game = newGame();
    expect(groupComplete(game)).toBe(false);
    game.group.members = party(15);
    game.counters.created = 15;
    expect(groupComplete(game)).toBe(false);
    game.group.members = party(16);
    expect(groupComplete(game)).toBe(true);
    game.group.members = party(3);
    game.counters.created = 625;
    expect(groupComplete(game)).toBe(true);
    game.group.members = [];
    expect(groupComplete(game)).toBe(false);
  });

  it("au hasard : garde la sélection partielle quand le type est disponible, reproductible à graine fixe", () => {
    const game = newGame();
    const a = pickRandomType(game, new MsvcRandom(11), [3, 0, 0, 0]);
    const b = pickRandomType(game, new MsvcRandom(11), [3, 0, 0, 0]);
    expect(a).toEqual(b);
    expect(a.available).toBe(true);
    expect(a.attrs[0]).toBe(3);
    expect(a.attrs.every((v) => v >= 1 && v <= 5)).toBe(true);
    const c = pickRandomType(game, new MsvcRandom(11), [3, 0, 0, 0], true);
    expect(c.rerolled).toBe(true);
  });

  it("au hasard : après 63 essais, le balayage retient la dernière combinaison disponible", () => {
    const game = newGame();
    game.typeCounts.fill(2);
    game.typeCounts[typeIndex([2, 4, 1, 5])] = 1;
    game.typeCounts[typeIndex([4, 3, 3, 2])] = 0;
    const pick = pickRandomType(game, new MsvcRandom(5), [0, 0, 0, 0]);
    expect(pick).toMatchObject({ attrs: [4, 3, 3, 2], available: true, rerolled: true });
    game.typeCounts.fill(2);
    const none = pickRandomType(game, new MsvcRandom(5), [0, 0, 0, 0]);
    expect(none.available).toBe(false);
  });

  it("reste à créer : 625 − camps − ville − groupe", () => {
    const game = newGame();
    game.counters = { created: 40, camp1: 5, camp2: 3, town: 2 };
    game.group.members = party(10);
    expect(remainingToCreate(game)).toBe(625 - 10 - 10);
  });

  it("entrée / sortie de l'écran 3 (1128:006d, 049a)", () => {
    const game = newGame();
    const session = createSession();
    game.pickerGroup.members = party(4);
    expect(pickerEnter(game)).toHaveLength(4);
    expect(game.pickerGroup.members).toHaveLength(0);
    // départ vers une épreuve : la réserve reste vide, le groupe passe dans le tampon
    pickerLeave(game, session, party(16), false);
    expect(game.group.members).toHaveLength(16);
    expect(game.pickerGroup.members).toHaveLength(0);
    // bouton « carte » : le groupe incomplet est gardé dans la réserve
    pickerLeave(game, session, party(6), true);
    expect(game.pickerGroup.members).toHaveLength(6);
    expect(game.group.members).toHaveLength(0);
    // carte déjà quittée : le groupe est perdu
    const g2 = newGame();
    const s2 = createSession();
    s2.leftToMap = true;
    pickerLeave(g2, s2, party(6), true);
    expect(g2.pickerGroup.members).toHaveLength(0);
  });

  it("collectGroup range les survivants avant les perdus", () => {
    const game = newGame();
    const p = party(4);
    p[0]!.present = false;
    p[2]!.present = false;
    collectGroup(game, p);
    expect(game.group.members.map((m) => m.present)).toEqual([true, true, false, false]);
  });
});

describe("présentoir des camps (10b0:1ac9, 17b1, 1217)", () => {
  it("verse à la suite des occupés, puis dans les trous quand la fin est atteinte", () => {
    const game = newGame();
    const reserve = game.camp1;
    expect(depositToReserve(reserve, party(3))).toBe(true);
    expect(reserve.count).toBe(3);
    expect(reserveEnd(reserve)).toBe(3);
    expect(shelfScrollAfterDeposit(0)).toBe(0);
    expect(shelfScrollAfterDeposit(9)).toBe(2);
    // réserve presque pleine : un trou au début
    const full = newGame().camp1;
    depositToReserve(full, party(620));
    expect(full.count).toBe(620);
    full.entries[2] = null;
    full.count = 619;
    expect(depositToReserve(full, party(5, 700))).toBe(false);
    expect(full.entries[2]).not.toBeNull();
  });

  it("prendre et reposer", () => {
    const game = newGame();
    depositToReserve(game.camp1, party(3));
    const z = takeFromShelf(game, 1, 1)!;
    expect(z.attrs).toEqual(party(3)[1]!.attrs);
    expect(game.camp1.count).toBe(2);
    expect(takeFromShelf(game, 1, 1)).toBeNull();
    expect(putOnShelf(game, 1, z, 0)).toBe(false);
    expect(putOnShelf(game, 1, z, 1, [10, 20, 40, 60])).toBe(true);
    expect(slotRect(game.camp1.entries[1]!)).toEqual([10, 20, 40, 60]);
  });

  it("emplacement le plus proche : plus grand recouvrement, minimum 625 points²", () => {
    const game = newGame();
    const cells: Rect[] = Array.from({ length: 25 }, (_, k) => {
      const col = k % 5;
      const row = Math.trunc(k / 5);
      return [col * 60, row * 60, col * 60 + 60, row * 60 + 60] as const;
    });
    depositToReserve(game.camp1, party(2));
    // lâcher à cheval sur les cellules 2 (libre) et 3 (libre), davantage sur 3
    expect(findShelfEntry(game.camp1, 0, cells, { mode: "free", drop: [160, 0, 230, 60] })).toBe(3);
    // sur une cellule occupée uniquement : rien
    expect(findShelfEntry(game.camp1, 0, cells, { mode: "free", drop: [0, 0, 60, 60] })).toBe(-1);
    // recouvrement trop faible
    expect(findShelfEntry(game.camp1, 0, cells, { mode: "free", drop: [115, 0, 125, 10] })).toBe(-1);
    // prendre : le rectangle de l'entrée contient le point
    putOnShelf(game, 1, party(1, 50)[0]!, 7, [10, 10, 50, 50]);
    expect(findShelfEntry(game.camp1, 0, cells, { mode: "occupied", x: 20, y: 20 })).toBe(7);
    expect(findShelfEntry(game.camp1, 0, cells, { mode: "occupied", x: 300, y: 20 })).toBe(-1);
  });
});

describe("camps : arrivée, sortie, droit de partir", () => {
  it("l'arrivée compte les survivants, rend les perdus au présentoir et vide la réserve de groupe", () => {
    const game = newGame();
    game.group.members = party(14);
    game.camp1Group = { members: party(2, 100).map((z) => ({ ...z })), flagA: false, flagB: false };
    const arrival = campArrive(game, 1);
    expect(arrival.party).toHaveLength(14);
    expect(arrival.deposited).toBe(2);
    expect(game.counters.camp1).toBe(14);
    expect(game.camp1.count).toBe(2);
    expect(game.camp1Group.members).toHaveLength(0);
    expect(game.camp1Group).toMatchObject({ flagA: true, flagB: true });
    expect(game.group.flagA).toBe(true);
  });

  it("sortie vers l'étape suivante : copie de réserve purgeable, compteur diminué", () => {
    const game = newGame();
    const session = createSession();
    game.counters.camp1 = 16;
    campLeave(game, session, 1, party(16), false);
    expect(game.camp1Group.members).toHaveLength(16);
    expect(game.camp1Group.flagA).toBe(true);
    expect(game.counters.camp1).toBe(0);
    expect(game.group.members).toHaveLength(16);
  });

  it("retour à la carte depuis un camp : le groupe est gardé puis restitué sans versement ni perte de compteur", () => {
    const game = newGame();
    const session = createSession();
    game.counters.camp1 = 10;
    campLeave(game, session, 1, party(10), true);
    expect(game.counters.camp1).toBe(10);
    expect(game.group.members).toHaveLength(0);
    const back = campArrive(game, 1);
    expect(back.party).toHaveLength(10);
    expect(back.deposited).toBe(0);
    expect(game.counters.camp1).toBe(10);
  });

  it("groupe abandonné à la carte : sortie du camp sans recopie", () => {
    const game = newGame();
    const session = createSession();
    session.leftToMap = true;
    campLeave(game, session, 1, party(10), true);
    expect(game.camp1Group.members).toHaveLength(0);
  });

  it("sortie autorisée à 16 membres, ou en fin de jeu avec tous les restants", () => {
    const game = newGame();
    expect(campExitAllowed(game, 1, 15)).toBe(false);
    expect(campExitAllowed(game, 1, 16)).toBe(true);
    expect(campExitAllowed(game, 2, 20)).toBe(true);
    // fin de jeu : tous créés, 4 au camp 1 et 1 au choix
    game.counters = { created: 625, camp1: 4, camp2: 0, town: 620 };
    game.pickerGroup.members = party(1);
    expect(campExitAllowed(game, 1, 4)).toBe(false);
    expect(campExitAllowed(game, 1, 5)).toBe(true);
    expect(campExitAllowed(game, 1, 0)).toBe(false);
    // camp 2 : compte aussi le camp 1
    game.counters = { created: 625, camp1: 2, camp2: 3, town: 620 };
    game.pickerGroup.members = [];
    expect(campExitAllowed(game, 2, 4)).toBe(false);
    expect(campExitAllowed(game, 2, 5)).toBe(true);
    expect(atCamp(game, 2)).toBe(3);
  });
});

describe("Zoombiniville (1188:0128, 1bf5)", () => {
  it("nombre de bâtiments : min(16, (n − 20) / 37)", () => {
    expect([0, 20, 56, 57, 94, 100, 300, 612, 625].map(townBuildingCount)).toEqual([0, 0, 0, 1, 2, 2, 7, 16, 16]);
  });

  it("objets décoratifs : seuils cumulés, 20 en fin de jeu", () => {
    expect([0, 100, 101, 200, 201, 301, 401, 501].map((n) => townDecorCount(n, false))).toEqual([0, 0, 1, 1, 3, 6, 10, 15]);
    expect(townDecorCount(625, true)).toBe(0x14);
  });

  it("l'arrivée verse les survivants dans la population et vide le groupe", () => {
    const game = newGame();
    game.group.members = party(16);
    game.group.members[15]!.present = false;
    const arrival = townArrive(game);
    expect(arrival).toEqual({ arrived: 15, gameOver: false });
    expect(game.counters.town).toBe(15);
    expect(game.population.count).toBe(15);
    expect(game.group.members).toHaveLength(0);
    expect(townResidents(game)).toHaveLength(15);
  });

  it("au plus 20 habitants visibles, les plus récents d'abord", () => {
    const game = newGame();
    game.group.members = party(16);
    townArrive(game);
    game.group.members = party(16, 16);
    townArrive(game);
    const residents = townResidents(game);
    expect(residents).toHaveLength(20);
    expect(residents[0]!.attrs).toEqual(party(1, 31)[0]!.attrs);
  });

  it("fin du jeu au 625e et arrêt des versements", () => {
    const game = newGame();
    game.counters.town = 619;
    game.population.count = 619;
    game.group.members = party(5);
    expect(townArrive(game).gameOver).toBe(false);
    expect(isGameOver(game)).toBe(false);
    game.group.members = party(1);
    expect(townArrive(game).gameOver).toBe(true);
    expect(isGameOver(game)).toBe(true);
    expect(game.counters.town).toBe(625);
  });

  it("défilement : zones de clic et 6 positions bouclées", () => {
    expect(townScrollDirection(10, 100)).toBe(-1);
    expect(townScrollDirection(600, 100)).toBe(1);
    expect(townScrollDirection(300, 100)).toBe(0);
    expect(townScrollDirection(10, 10)).toBe(0);
    expect(townScrollDirection(2, 100)).toBe(0);
    const game = newGame();
    expect(townScrollBy(game, -1)).toBe(5);
    expect(townScrollBy(game, 1)).toBe(0);
    for (let i = 0; i < 6; i += 1) townScrollBy(game, 1);
    expect(game.townScroll).toBe(0);
  });

  it("position d'un habitant : x de −320 à 1599, y de 410 à 475", () => {
    const rng = new MsvcRandom(3);
    for (let i = 0; i < 200; i += 1) {
      const p = townResidentPosition(rng);
      expect(p.x).toBeGreaterThanOrEqual(-320);
      expect(p.x).toBeLessThanOrEqual(0x63f);
      expect(p.y).toBeGreaterThanOrEqual(0x19a);
      expect(p.y).toBeLessThanOrEqual(0x1db);
    }
  });
});

describe("entraînement", () => {
  it("groupe de 16 aux attributs tirés par 10a8:04e8(5, 1), reproductible", () => {
    const a = trainingGroup(new MsvcRandom(9));
    const b = trainingGroup(new MsvcRandom(9));
    expect(a.members).toHaveLength(16);
    expect(a).toEqual(b);
    expect(a.members.every((m) => m.present && m.attrs.every((v) => v >= 1 && v <= 5))).toBe(true);
  });
});
