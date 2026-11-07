import { parseAld } from "../../../src/games/drascula/data/ald";
import { hasOriginalFiles, readOriginal } from "../helpers";

/** Pièce de départ de chaque chapitre (`runCurrentChapter`, ScummVM). */
export const CHAPTER_START_ROOMS: Record<number, number> = { 1: 62, 2: 14, 3: 20, 4: 21, 5: 45, 6: 58 };

/** Pièces où l'on n'entre que par une cinématique (`enterRoom` d'`animation.cpp`) : 56 et 57 au chapitre 5, 102 au chapitre 6. */
export const SCRIPTED_ROOMS: Record<number, number> = { 56: 5, 57: 5, 102: 6 };

/**
 * Chapitre de chaque pièce : pièces atteintes par les portes depuis la pièce de départ de chaque chapitre (fiches lues dans la
 * disposition du chapitre), plus les pièces des cinématiques. Vide sans les fichiers du jeu.
 */
function roomChapters(): [room: number, chapter: number][] {
  if (!hasOriginalFiles) return [];
  const out = new Map<number, number>();
  for (const [chapter, start] of Object.entries(CHAPTER_START_ROOMS).map(([c, r]) => [Number(c), r])) {
    const queue = [start];
    while (queue.length) {
      const room = queue.pop()!;
      if (out.has(room)) continue;
      let ald;
      try {
        ald = parseAld(readOriginal(`${room}.ALD`), chapter);
      } catch {
        continue; // pièce absente, ou d'une autre disposition
      }
      out.set(room, chapter);
      for (const object of ald.objects) if (object.door) queue.push(object.door.room);
    }
  }
  for (const [room, chapter] of Object.entries(SCRIPTED_ROOMS)) out.set(Number(room), chapter);
  return [...out].sort((a, b) => a[0] - b[0]);
}

export const ROOM_CHAPTERS = roomChapters();
