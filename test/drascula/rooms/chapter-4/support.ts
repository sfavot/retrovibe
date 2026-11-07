import { Walkthrough } from "../../walkthrough";

/** Le chapitre 4 commence dans la pièce 21 ; `startIn` va directement dans une autre pièce, l'état voulu d'emblée (`rooms.md` § 5). */
export interface StartOptions {
  /** Objet de la pièce d'où le héros arrive (`objExit`) : sa porte donne le point d'arrivée. */
  exit: number;
  /** Drapeaux levés (ou posés) avant d'entrer. */
  flags?: Record<number, number>;
  /** Objets ajoutés à l'inventaire avant d'entrer. */
  items?: readonly number[];
}

export function startIn(room: number, options: StartOptions): Walkthrough {
  const w = new Walkthrough({ chapter: 4 });
  const { engine } = w;
  for (const [flag, value] of Object.entries(options.flags ?? {})) engine.flags[Number(flag)] = value;
  for (const item of options.items ?? []) engine.addObject(item);
  engine.state.objExit = options.exit;
  engine.state.hero.x = -1;
  engine.run(engine.enterRoom(room));
  w.settle();
  return w;
}

/** Les voix jouées par `action`, sans les effets sonores (`s3.als`). */
export function speech(w: Walkthrough, action: () => void): string[] {
  const mark = w.mark();
  action();
  return w.voices(mark).filter((name) => !/^s\d+\.als$/.test(name));
}

/** Une image de la pièce composée par le rendu, la souris loin des objets (pas de nom ni de curseur sur le décor). */
export function render(w: Walkthrough) {
  w.player.move(319, 199);
  w.wait(40);
  w.engine.render();
  return w.engine.gfx;
}

/** Recompose l'image sans faire avancer le temps (les animations de la pièce gardent l'image posée par le test). */
export function repaint(w: Walkthrough) {
  w.engine.render();
  return w.engine.gfx;
}

/**
 * Compare le rectangle `width x height` de `source` en (sx, sy) à l'image composée en (dx, dy), sur une grille de points (tous les
 * `step` pixels). `opaque` faux : `copyRect`, les pixels transparents (255) de la feuille ne comptent pas. Rend le nombre de points comparés.
 */
export function comparedPixels(
  gfx: ReturnType<typeof render>,
  source: { at(x: number, y: number): number },
  [sx, sy, dx, dy, width, height]: readonly [number, number, number, number, number, number],
  opaque = true,
  step = 5,
  skip: (x: number, y: number) => boolean = () => false,
): { compared: number; mismatches: string[] } {
  let compared = 0;
  const mismatches: string[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (skip(dx + x, dy + y)) continue;
      const wanted = source.at(sx + x, sy + y);
      if (!opaque && wanted === 255) continue;
      compared++;
      const got = gfx.screen.at(dx + x, dy + y);
      if (got !== wanted) mismatches.push(`(${dx + x}, ${dy + y}) ${got} au lieu de ${wanted}`);
    }
  }
  return { compared, mismatches };
}

/**
 * Un point du corps du héros qui n'est dans aucun objet visible de la pièce (sinon le nom survolé est celui de l'objet, pas le sien :
 * `checkObjects`), le plus près de son centre.
 */
export function heroPoint(w: Walkthrough): { x: number; y: number } {
  const { x, y, width, height } = w.hero;
  const objects = w.engine.room.objects.filter((o) => o.visible && !o.isDoor);
  const cx = x + Math.trunc(width / 2);
  const cy = y + Math.trunc(height / 2);
  let best: { x: number; y: number } | null = null;
  let distance = Infinity;
  for (let py = y + 3; py < y + height - 3; py++) {
    for (let px = x + 3; px < x + width - 3; px++) {
      if (objects.some((o) => px >= o.rect.x1 && px < o.rect.x2 && py >= o.rect.y1 && py < o.rect.y2)) continue;
      const d = Math.abs(px - cx) + Math.abs(py - cy);
      if (d < distance) {
        distance = d;
        best = { x: px, y: py };
      }
    }
  }
  if (!best) throw new Error("le héros est entièrement recouvert par des objets de la pièce");
  return best;
}

/** L'objet `item` (déjà dans l'inventaire) appliqué au héros lui-même (`checkAction(50)`). */
export function useOnHero(w: Walkthrough, item: number, limit = 60_000): void {
  w.takeItem(item);
  if (w.state.pickedObject !== item) throw new Error(`l'objet ${item} n'est pas en main`);
  const at = heroPoint(w);
  w.clickAt(at.x, at.y, limit);
}
