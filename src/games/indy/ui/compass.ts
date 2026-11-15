import type { Icon } from "../data/resources";
import { Direction } from "../engine/geometry";

/** Côté (en pixels d'origine) du dessin de la boussole : quatre flèches de 14 à 15 px posées en croix. */
export const COMPASS_SIZE = 44;

/** Identifiants ICON de DESKADV.EXE : flèche éteinte puis allumée (verte), par direction. */
const ARROW_ICONS: Record<Direction, { off: number; on: number }> = {
  [Direction.Down]: { off: 3, on: 4 },
  [Direction.Left]: { off: 5, on: 6 },
  [Direction.Right]: { off: 7, on: 8 },
  [Direction.Up]: { off: 9, on: 10 },
};

/** Coin haut gauche de chaque flèche (le dessin occupe le coin haut gauche de son icône 32×32). */
const ARROW_AT: Record<Direction, { x: number; y: number }> = {
  [Direction.Up]: { x: 14, y: 2 },
  [Direction.Left]: { x: 2, y: 14 },
  [Direction.Right]: { x: 29, y: 14 },
  [Direction.Down]: { x: 14, y: 28 },
};

const ORDER = [Direction.Up, Direction.Left, Direction.Right, Direction.Down];

export type Exits = Record<Direction, boolean>;

/** Icône utilisée pour une direction, selon qu'elle est praticable ou non. */
export function arrowIconId(direction: Direction, open: boolean): number {
  return open ? ARROW_ICONS[direction].on : ARROW_ICONS[direction].off;
}

/** Nom accessible de la boussole : la liste des directions ouvertes. */
export function describeExits(exits: Exits, names: Record<Direction, string>, none: string): string {
  const open = ORDER.filter((d) => exits[d]).map((d) => names[d]);
  return open.length ? open.join(", ") : none;
}

/** Dessine la boussole (flèches de l'exécutable, allumées dans les directions praticables) sur un canvas COMPASS_SIZE². */
export function drawCompass(canvas: HTMLCanvasElement, icons: Map<number, Icon>, exits: Exits): void {
  canvas.width = COMPASS_SIZE;
  canvas.height = COMPASS_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, COMPASS_SIZE, COMPASS_SIZE);
  for (const direction of ORDER) {
    const icon = icons.get(arrowIconId(direction, exits[direction]));
    if (!icon) continue;
    const layer = document.createElement("canvas");
    layer.width = icon.width;
    layer.height = icon.height;
    layer.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(icon.rgba), icon.width, icon.height), 0, 0);
    ctx.drawImage(layer, ARROW_AT[direction].x, ARROW_AT[direction].y);
  }
}
