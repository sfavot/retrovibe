import type { ChapterScript, GameScript } from "../script";

/**
 * Assemblage des chapitres en un seul `GameScript` pour le moteur (`DrasculaEngineOptions.script`). Chaque chapitre vit dans son
 * dossier (`chapter-N/`) et n'est connu que de `index.ts` ; rien d'autre n'est partagé entre les chapitres (`docs/drascula/rooms.md`).
 *
 * - Tables par pièce ou par nom (`rooms`, `animations`) : fusionnées. Une même clé dans deux chapitres est une erreur (levée ici,
 *   au chargement), de même qu'un nom d'animation déjà fourni par `base`. Les `painters` restent séparés par chapitre (la pièce 16
 *   de ScummVM est la chambre de B.J. au chapitre 1 et l'hôtel au chapitre 2) : le rendu choisit selon le chapitre en cours.
 * - Points globaux (`checkAction`, `updateDoor`, `roomLoaded`, `roomEntered`, `canExit`, `leaving`, `frame`, `tick`) : ScummVM les
 *   écrit « si chapitre == N » ; ici chacun est appelé pour le **chapitre en cours seulement** (`g.chapter`), avec la valeur par
 *   défaut de ScummVM quand le chapitre n'en définit pas (pas de réponse, sortie permise).
 */
export function assembleScript(chapters: Readonly<Record<number, ChapterScript>>, base: Pick<GameScript, "animations"> = {}): GameScript {
  const rooms: NonNullable<GameScript["rooms"]> = {};
  const painters: NonNullable<GameScript["painters"]> = {};
  const animations: Record<string, NonNullable<GameScript["animations"]>[string]> = { ...base.animations };
  const owners = { rooms: new Map<number, number>(), animations: new Map<string, number>() };

  for (const [key, script] of Object.entries(chapters)) {
    const chapter = Number(key);
    merge("pièce (gestionnaire)", rooms, script.rooms, owners.rooms, chapter);
    if (script.painters) painters[chapter] = { ...script.painters };
    merge("animation", animations, script.animations, owners.animations, chapter, base.animations);
  }

  const of = (g: { chapter: number }): ChapterScript | undefined => chapters[g.chapter];
  return {
    rooms,
    painters,
    animations,
    checkAction: function* (g, objectId) {
      const hook = of(g)?.checkAction;
      return hook ? yield* hook(g, objectId) : false;
    },
    updateDoor: (g, index) => of(g)?.updateDoor?.(g, index),
    roomLoaded: (g) => of(g)?.roomLoaded?.(g),
    roomEntered: function* (g) {
      const hook = of(g)?.roomEntered;
      if (hook) yield* hook(g);
    },
    canExit: function* (g, index) {
      const hook = of(g)?.canExit;
      return hook ? yield* hook(g, index) : true;
    },
    leaving: function* (g, index) {
      const hook = of(g)?.leaving;
      return hook ? yield* hook(g, index) : true;
    },
    restored: (g) => of(g)?.restored?.(g),
    frame: (g) => of(g)?.frame?.(g) ?? null,
    tick: (g) => of(g)?.tick?.(g),
  };
}

function merge<K extends string | number, V>(
  what: string,
  target: Partial<Record<K, V>>,
  source: Partial<Record<K, V>> | undefined,
  owners: Map<K, number>,
  chapter: number,
  reserved?: Partial<Record<K, V>>,
): void {
  for (const key of Object.keys(source ?? {}) as unknown as K[]) {
    const previous = owners.get(key);
    if (previous !== undefined) throw new Error(`chapitres ${previous} et ${chapter} : ${what} ${String(key)} définie deux fois`);
    if (reserved && key in reserved) throw new Error(`chapitre ${chapter} : ${what} ${String(key)} déjà fournie par les cinématiques communes`);
    owners.set(key, chapter);
    target[key] = source![key];
  }
}
