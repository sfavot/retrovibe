/**
 * Groupes d'objectifs 9 → 0 (`gm_objective_register` `0043cda4`, `gm_objective_unregister` `0043ce6c`) et fin de niveau.
 * Une cible détruite est retirée de la liste ; quand son groupe est vide, le message « Objectif N » est affiché (id = groupe),
 * le groupe 9 vide révèle les bonus 7002, et le groupe 0 vide lance la séquence de victoire (aucune obligation d'ordre).
 * Voir `docs/swiv3d/objects.md` §11 et `rules.md` §6.2-6.3.
 */
import { objectiveGroup } from "../data/level";
import type { GameObject } from "./objects";
import { MESSAGE_TINT } from "./status";
import type { World } from "./world";

/** Inscrit un objet dans le groupe de son `subtype` (5000 à 5009) ; sans effet pour les autres valeurs. */
export function registerObjective(world: World, o: GameObject): void {
  const g = objectiveGroup({ subtype: o.subtype });
  if (g === null) return;
  const game = world.game;
  game.objectivesRegistered++;
  game.objectives.push({ obj: o, group: g });
  // liste triée par groupe décroissant, à égalité dans l'ordre d'inscription (insertion après les groupes ≥)
  game.objectives.sort((a, b) => b.group - a.group);
  // le bit 0x2000 de la classe (`+0x05 & 0x20`) est lu par le radar
  o.classe |= 0x2000;
}

/** Groupe de tête de liste (le plus grand), -1 s'il n'en reste aucun. */
export function headGroup(world: World): number {
  return world.game.objectives[0]?.group ?? -1;
}

/**
 * `gm_objective_unregister` : à appeler à la mort de chaque corps (et à la collecte d'un bonus, sans effet s'il n'est pas inscrit).
 * `extraction` : la mort vient d'une zone d'extraction (type 7020 absent des niveaux livrés).
 */
export function unregisterObjective(world: World, o: GameObject): void {
  const game = world.game;
  let group = -1;
  for (let i = game.objectives.length - 1; i >= 0; i--) {
    if (game.objectives[i]!.obj === o) {
      group = game.objectives[i]!.group;
      game.objectives.splice(i, 1);
      game.objectivesDestroyed++;
    }
  }
  if (group === -1) return;
  const remaining = game.objectives.filter((e) => e.group === group).length;
  if (remaining !== 0) {
    world.emit({
      kind: "objective",
      group,
      groupDone: false,
      left: game.objectives.length,
    });
    return;
  }
  world.emit({
    kind: "objective",
    group,
    groupDone: true,
    left: game.objectives.length,
  });
  if (group === 0) {
    if (game.endCounter === -1) {
      game.message(20, 0, MESSAGE_TINT.objective, 10);
      world.emit({ kind: "message", textTable: 20, textId: 0 });
      game.endCounter = 0;
      game.endState = "victory";
    }
  } else {
    game.message(20, group, MESSAGE_TINT.objective);
    world.emit({ kind: "message", textTable: 20, textId: group });
    if (group === 9) game.group9Done = true;
  }
  if (!game.finalGroupOnly && game.objectives.length > 0 && game.objectives[0]!.group === 0)
    game.finalGroupOnly = true;
}
