import { describe, expect, it } from "vitest";
import { OPPOSITE_EXIT } from "../../src/games/armaeth/data/world";
import type { ArmaethEngine } from "../../src/games/armaeth/engine/engine";
import type { Terrain } from "../../src/games/armaeth/engine/ground";
import { buildGraph, type GraphOptions } from "../../src/games/armaeth/engine/paths";
import type { GameObject } from "../../src/games/armaeth/engine/state";
import { hasOriginalFiles } from "./helpers";
import { Player } from "./player";

/**
 * Accessibilité à pied dans les 60 salles, sur le moteur complet : chaque objet posé au sol et chaque sortie à marcher
 * (fond, droite, avant, gauche) doivent être atteints par le héros depuis au moins un point d'entrée de la salle (position
 * libre du chargement, arrivée par chacune de ses sorties, avec ou sans un pixel de décalage en X : la parité de X décide du
 * passage de certains couloirs de 3 pixels, voir `room8.test.ts`). Les cas qui ne peuvent pas marcher sont **énumérés
 * avec leur justification** : le test échoue si une nouvelle exception apparaît ou si une exception disparaît.
 *
 * Aucun garde-fou n'arrête un trajet qui n'avance plus (il n'y en a pas dans l'original : `30d9:0006` rend 5 puis `2363:01ea`
 * recalcule une fois et affiche `G44`) ; un trajet est « bloqué » quand le héros ne bouge plus pendant 600 images.
 */

interface Internals {
  terrain: Terrain;
  arrive(obj: GameObject, slot: number): boolean;
  exitBySector(sector: number): boolean;
  inReach(obj: GameObject): boolean;
  barrier(code: number, mode: number, obj: GameObject): number;
  refreshObject(obj: GameObject): void;
  pathOptions(obj: GameObject): GraphOptions;
}

const internals = (engine: ArmaethEngine) => engine as unknown as Internals;

/** Salles sans terrain de marche : interface (0), titre et fin (20 à 22). */
const NO_TERRAIN = new Set([0, 20, 21, 22]);
/** Images au plus par essai, et images sans déplacement qui font déclarer le trajet bloqué. */
const MAX_FRAMES = 7000;
const STALL_FRAMES = 600;

type Outcome = { kind: "reached" } | { kind: "hazard"; what: string } | { kind: "failed"; why: string } | { kind: "invalid" };

/**
 * États que le héros prend en marchant sur un piège ou au contact d'un monstre de la salle : le jeu reprend la main (animation
 * `Ego 6`, glissade `Ego 3`, chute `Ego 4`). Animations : 2 noyade, 3 feu et âtre, 4 ours, 5 frelons, 32 geyser, 33 lave, 35 gaz,
 * 39 chapiteau, 41 Sarhûl (`characters.md` § 4.3 et § 6.2). Un essai interrompu par l'un d'eux est accepté et compté à part.
 */
const HAZARD_ANIMATIONS = new Set([2, 3, 4, 5, 32, 33, 35, 39, 41]);

/**
 * Objets posés sur une case où le héros ne peut pas se tenir (aucun nœud du graphe ne la couvre : plan sans sol, case de type
 * refusé par `13a8:000a` ou zone d'escalade) : atteints de côté ou par un mécanisme, jamais en marchant dessus.
 * `salle:Num` et la raison.
 */
const UNWALKABLE_OBJECTS: Record<string, string> = {
  "3:7": "sol 83 sur le plan 1 (étagère) : pas de sol de marche à cet endroit",
  "201:208": "sol 83 sur le plan 1 (étagère)",
  "203:216": "sol 83 sur le plan 1 (étagère)",
  "301:304": "sol 83 sur le plan 1 (étagère)",
  "301:322": "sol 83 sur le plan 1 (étagère)",
  "110:103": "sol 110 : case de la grille, refusée par `13a8:000a` tant que la grille (`Num 103`) n'est pas ouverte (prédicat `F`)",
  "305:310": "sol 64 : case de la herse, refusée tant que le mécanisme n'est pas ouvert (`movement.md` § 5, codes 302 et 303)",
  "305:311": "sol 64 : case de la herse (idem)",
  "305:329": "sol 92 : case du mécanisme de la herse (idem)",
  "309:316": "sol 112 : case de la grille du cachot (prédicat `D`, codes 307 et 308)",
  "309:317": "sol 114 : case de la herse (prédicat `C`, codes 307 à 309)",
};

/**
 * Objets dont le chemin à pied traverse un piège documenté (`characters.md` § 4.3) : le héros y est repris par le jeu avant
 * d'arriver (le trajet, qui ne connaît pas les pièges, est correct).
 */
const HAZARD_OBJECTS: Record<string, string> = {
  "7:11": "sol 28 (pente) : glissade `Ego 3`",
  "301:216": "sol 68 (âtre) : animation 3, `G46` ; l'objet est dans l'âtre",
  "301:306": "sol 68 (âtre), idem",
  "314:315": "sol 60 (chapiteau d'Erin Hûviel) : animation 39, `G355` sans le talisman",
  "314:325": "sol 60 (chapiteau), idem",
};

/**
 * Sorties fermées au héros dans l'état initial (`1414:0006` rend 7, `movement.md` § 5) : codes 1 à 6 (forêt : la pie et l'ours
 * seuls), 101 à 104 (dalles de la salle 5 et de la salle 108), 301 à 309 (herses et portails du chapitre 3).
 */
const CLOSED_EXITS = [
  "1:2", "2:0", "4:0", "5:3", "8:3", "9:1", "9:2", "10:0", "10:1", "10:2", "10:3", "11:1", "104:0", "105:2", "109:2", "110:0", "202:0",
  "305:0", "305:2", "309:2", "314:2",
];

/**
 * Sorties dont le barrage dépend d'un mécanisme que le test n'actionne pas (`movement.md` § 5) : fermées pour le héros quelle que
 * soit sa position d'arrivée (`1414:0006` code 308 : herse `Num 317` ouverte et côté de la grille `316`).
 */
const GATED_EXITS: Record<string, string> = {
  "309:0": "code 308 : la herse (`Num 317`, `Ego 3`) doit être ouverte, et le héros du bon côté de la grille 316 (sol 57/113 ou 58/112)",
};

/** Sorties dont le côté n'a aucun sol de marche (falaise, eau, vide) : franchies autrement (chute, escalade, vol). */
const WALLED_EXITS: Record<string, string> = {
  "209:1": "salle sur une corniche : le sol de marche s'arrête à la colonne 33, loin du bord droit (x 202)",
  "210:3": "le sol de marche commence à la colonne 31 : rien jusqu'au bord gauche",
};

describe.skipIf(!hasOriginalFiles)("accessibilité à pied des objets et des sorties (60 salles)", () => {
  const report = {
    objects: 0,
    exits: 0,
    hazards: [] as string[],
    unwalkable: [] as string[],
    walled: [] as string[],
    gated: [] as string[],
    closed: [] as string[],
    failed: [] as string[],
    fallbacks: 0,
  };

  /** Arrivé par une chute ou une animation (salles d'eau) : on rend la marche au héros, comme après la fin de l'animation. */
  function normalizeHero(p: Player, hero: GameObject): void {
    if (hero.ego === 0) return;
    Object.assign(hero, { ego: 0, dep: 0, mob: 2, fig: 0, gst: 7, speedY: 0 });
    p.state.moveEnabled = true;
    internals(p.engine).refreshObject(hero);
    p.run(2);
  }

  function trial(p: Player, placeHero: (hero: GameObject) => boolean, plan: (hero: GameObject) => boolean, success: (hero: GameObject) => boolean): Outcome {
    p.engine.snapshot("load");
    p.run(6);
    p.drain(3);
    const loaded = p.state.loadedRoom;
    const hero = p.state.hero;
    if (!hero || !loaded) return { kind: "failed", why: "héros absent" };
    normalizeHero(p, hero);
    if (!placeHero(hero)) return { kind: "invalid" }; // point d'entrée sans position valide dans cette salle
    hero.err = 0;
    hero.speedX = 0;
    hero.speedP = 0;
    p.run(3);
    if (!plan(hero)) return { kind: "failed", why: "aucun trajet" };
    let last = `${hero.x},${hero.y},${hero.p}`;
    let still = 0;
    for (let frame = 0; frame < MAX_FRAMES && p.state.hero === hero && hero.path.defined; frame++) {
      p.run(1);
      if (p.engine.windows.active) p.drain(5);
      if (p.state.loadedRoom !== loaded) break;
      if (hero.ego !== 0 && hero.ego !== 1) {
        return HAZARD_ANIMATIONS.has(hero.animId) || hero.ego === 3 ? { kind: "hazard", what: `Ego ${hero.ego}, animation ${hero.animId}, sol ${hero.ground}` } : { kind: "failed", why: `Ego ${hero.ego} (sol ${hero.ground})` };
      }
      const now = `${hero.x},${hero.y},${hero.p}`;
      still = now === last ? still + 1 : 0;
      last = now;
      if (still >= STALL_FRAMES) return { kind: "failed", why: `bloqué en ${now}` };
    }
    p.drain(5);
    return success(hero) || p.state.loadedRoom !== loaded ? { kind: "reached" } : { kind: "failed", why: `trajet fini en ${hero.x},${hero.y},${hero.p}` };
  }

  it("chaque objet au sol et chaque sortie est atteint depuis un point d'entrée ; les exceptions sont celles listées", () => {
    const probe = new Player();
    probe.skipIntro();
    const roomIds = probe.state.rooms.map((r) => r.id).filter((id) => !NO_TERRAIN.has(id));
    expect(roomIds).toHaveLength(56);

    for (const roomId of roomIds) {
      const p = new Player();
      p.skipIntro();
      p.engine.sendToRoom(roomId, true);
      for (let i = 0; i < 60 && p.state.loadedRoom?.id !== roomId; i++) {
        p.run(2);
        p.drain(3);
      }
      p.run(20);
      p.drain(5);
      report.fallbacks += p.engine.heroPlacementFallbacks;
      const room = p.state.loadedRoom!;
      expect(room.id).toBe(roomId);
      const hero0 = p.state.hero!;
      const engine = internals(p.engine);
      // les autres mobiles (nains, ours, pie...) quittent la salle : ils coupent la marche du héros (face-à-face, contact) et ce
      // test ne porte que sur la géométrie des trajets
      // (les nains, qui peuvent être en plein duel à l'arrivée du héros, partent aussi : un duel prend le héros, `Ego 6`)
      for (const obj of [...room.listA]) if ((obj.mob === 2 || (obj.num >= 201 && obj.num <= 204) || obj.num === 301) && obj !== hero0) p.state.moveToRoom(obj, p.state.rooms[0]!);
      normalizeHero(p, hero0);
      p.engine.snapshot("save");
      const start = { x: hero0.x, y: hero0.y, p: hero0.p, plane: hero0.plane };

      // points d'entrée : position libre, puis arrivée par chaque sortie ; chacun avec un pixel de décalage en X
      const sides = room.exits.map((exit, side) => (exit ? side : -1)).filter((side) => side >= 0);
      const entries: { name: string; place(hero: GameObject): boolean }[] = [];
      for (const dx of [0, 1]) {
        entries.push({
          name: `libre+${dx}`,
          place: (hero) => {
            Object.assign(hero, start);
            if (dx) hero.x += dx;
            return dx === 0 || [0, 0x11].includes(p.engine.place(hero, 1));
          },
        });
      }
      for (const side of sides) {
        for (const dx of [0, 1]) {
          entries.push({
            name: `sortie ${side}+${dx}`,
            place: (hero) => {
              if (!engine.arrive(hero, OPPOSITE_EXIT[side]!)) return false;
              if (dx) hero.x += dx;
              return dx === 0 || [0, 0x11].includes(p.engine.place(hero, 1));
            },
          });
        }
      }

      const limits = { ...engine.terrain.limits }; // avant les essais : une sortie franchie recharge une autre salle
      const graph = buildGraph(engine.terrain, { ...hero0, stepX: 2, stepY: 4, stepP: 1 }, engine.pathOptions(hero0)) ?? [];
      const covered = (plane: number, row: number, col: number) => graph.some((n) => n.plane === plane && n.row === row && n.c0 <= col && col <= n.c1);

      const reach = (plan: (hero: GameObject) => boolean, success: (hero: GameObject) => boolean): Outcome => {
        let hazard: Outcome | null = null;
        let last: Outcome = { kind: "failed", why: "aucun essai" };
        for (const entry of entries) {
          const outcome = trial(p, entry.place, plan, success);
          if (outcome.kind === "reached") return outcome;
          if (outcome.kind === "hazard") hazard ??= outcome;
          else if (outcome.kind === "failed") last = outcome;
        }
        return hazard ?? last;
      };

      // --- objets posés au sol (type 2, immobiles, hors héros) ---
      for (const obj of room.listA) {
        if (obj.typ !== 2 || obj.mob === 2 || obj.num === 1 || obj.ground === 0) continue;
        report.objects++;
        const key = `${roomId}:${obj.num}`;
        const serial = obj.serial;
        if (!covered(obj.plane, obj.p >> 3, obj.x >> 2)) {
          report.unwalkable.push(key);
          continue;
        }
        const outcome = reach(
          (hero) => p.engine.pathTo(hero, obj.x, obj.y, obj.p, obj.plane),
          (hero) => {
            const target = p.state.findBySerial(serial);
            return !!target && (engine.inReach(target) || ((hero.x >> 2) === (target.x >> 2) && (hero.p >> 3) === (target.p >> 3)));
          },
        );
        if (outcome.kind === "hazard") report.hazards.push(`${key} (${outcome.what})`);
        else if (outcome.kind === "failed") report.failed.push(`objet ${key} @${obj.x},${obj.y},${obj.p} plan ${obj.plane} sol ${obj.ground} : ${outcome.why}`);
      }

      // --- sorties à marcher ---
      for (const side of sides) {
        if (side > 3) continue; // haut et bas : échelles, chutes et vol, jamais une marche
        report.exits++;
        const key = `${roomId}:${side}`;
        const code = room.barriers[side] ?? 0;
        if (code !== 0 && engine.barrier(code, 0, hero0) !== 0) {
          report.closed.push(`${key} (barrage ${code})`);
          continue;
        }
        if (GATED_EXITS[key]) {
          report.gated.push(key);
          continue;
        }
        const nearEdge = graph.some((n) => (side === 3 && n.c0 <= 2) || (side === 1 && n.c1 >= (limits.xMax >> 2) - 2) || (side === 0 && n.row <= (limits.pMin >> 3) + 1) || (side === 2 && n.row >= (limits.pMax >> 3) - 1));
        if (!nearEdge) {
          report.walled.push(key);
          continue;
        }
        const outcome = reach(
          () => engine.exitBySector(side),
          () => false,
        );
        if (outcome.kind === "hazard") report.hazards.push(`sortie ${key} (${outcome.what})`);
        else if (outcome.kind === "failed") report.failed.push(`sortie ${key} : ${outcome.why}`);
      }
    }

    expect(report.failed, report.failed.join("\n")).toEqual([]);
    expect([...new Set(report.unwalkable)].sort()).toEqual(Object.keys(UNWALKABLE_OBJECTS).sort());
    expect(report.walled.sort()).toEqual(Object.keys(WALLED_EXITS).sort());
    expect(report.gated.sort()).toEqual(Object.keys(GATED_EXITS).sort());
    expect(report.fallbacks).toBe(0); // le placement libre du héros n'a jamais eu besoin du tirage de repli
    expect(report.hazards.map((h) => h.split(" ")[0]!.replace("sortie ", "")).sort()).toEqual(Object.keys(HAZARD_OBJECTS).sort());
    expect(report.closed.map((c) => c.split(" ")[0]!).sort()).toEqual([...CLOSED_EXITS].sort());
    expect(report.objects).toBeGreaterThan(35);
    expect(report.exits).toBeGreaterThan(120);
    expect(report.exits).toBeGreaterThan(100);
  }, 600000);
});
