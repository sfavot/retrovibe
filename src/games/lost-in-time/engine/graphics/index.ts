import type { HotspotSystem, Subsystems, VmContext } from "../host";
import { GraphicsCore } from "./core";
import { CursorImpl } from "./cursor";
import { DrawImpl } from "./draw";
import { PaletteImpl } from "./palette";

export { GraphicsCore } from "./core";
export type { CursorImage } from "./core";
export { Surface } from "./surface";
export { DrawImpl, CursorImpl, PaletteImpl };

/** Les trois sous-systèmes graphiques (affichage, palette, curseur) et leur état commun. */
export class GraphicsSystems {
  readonly core = new GraphicsCore();
  readonly draw: DrawImpl;
  readonly palette: PaletteImpl;
  readonly cursor: CursorImpl;

  constructor() {
    this.draw = new DrawImpl(this.core);
    this.palette = new PaletteImpl(this.core);
    this.cursor = new CursorImpl(this.core);
    this.draw.cursor = this.cursor;
    this.draw.palette = this.palette;
    this.cursor.draw = this.draw;
  }

  attach(vm: VmContext): void {
    this.core.vm = vm;
  }

  /** Fournit le sous-système des zones (texte cliquable, curseur sous la souris). */
  useHotspots(get: () => HotspotSystem | undefined): void {
    this.draw.getHotspots = get;
  }
}

/** Remplace draw / cursor / palette de `sys` par les vrais sous-systèmes graphiques. */
export function installGraphics(sys: Subsystems): GraphicsSystems {
  const gfx = new GraphicsSystems();
  sys.draw = gfx.draw;
  sys.cursor = gfx.cursor;
  sys.palette = gfx.palette;
  gfx.useHotspots(() => sys.hotspots);
  const previous = sys.attach?.bind(sys);
  sys.attach = (vm) => {
    previous?.(vm);
    gfx.attach(vm);
  };
  return gfx;
}
