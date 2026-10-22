import type { Hy8 } from "../data/hy8";
import type { Voc } from "../data/voc";
import type { SceneContext } from "./scene";

export interface MenuItem {
  /** Voix d'aide jouée par le clic droit / Entrée (nom d'origine, ex. `s07v004t.voc`) ; absente : rien ne se passe. */
  voice?: string;
}

/**
 * Mise en évidence de l'élément courant. `select` / `deselect` agissent sur l'état (palette…), `render` dessine par-dessus
 * l'image (sprite).
 */
export interface MenuHighlight {
  select?(ctx: SceneContext, index: number): void;
  deselect?(ctx: SceneContext, index: number): void;
  render?(ctx: SceneContext, index: number): void;
}

/**
 * Surbrillance par remplacement d'une entrée de palette (S07, engine.md §1.2) : la couleur du texte du bouton
 * `firstEntry + i` devient `color` (RVB 8 bits) ; l'ancienne est restaurée quand le bouton est quitté.
 */
export function paletteHighlight(firstEntry: number, color: readonly [number, number, number]): MenuHighlight {
  const saved = new Map<number, [number, number, number]>();
  return {
    select(ctx, index) {
      const entry = firstEntry + index;
      if (!saved.has(entry)) {
        const c = ctx.palette.colors;
        saved.set(entry, [c[entry * 3], c[entry * 3 + 1], c[entry * 3 + 2]]);
      }
      ctx.palette.setColor(entry, color[0], color[1], color[2]);
    },
    deselect(ctx, index) {
      const entry = firstEntry + index;
      const original = saved.get(entry);
      if (!original) return;
      ctx.palette.setColor(entry, original[0], original[1], original[2]);
      saved.delete(entry);
    },
  };
}

/** Surbrillance par dessin d'un sprite HY8 à une position fixe par élément (S08, S09, S48… : curseur de sélection). */
export function spriteHighlight(
  sprites: () => Hy8,
  place: (index: number) => { sprite: number; x: number; y: number },
): MenuHighlight {
  return {
    render(ctx, index) {
      const { sprite, x, y } = place(index);
      ctx.surface.drawSprite(sprites(), sprite, x, y);
    },
  };
}

export interface MenuOptions {
  items: readonly MenuItem[];
  /**
   * Axe des touches : `vertical` = haut/bas (S07), `horizontal` = gauche/droite (S09, S49, S48), `none` = la scène déplace
   * elle-même la sélection avec `select` (S46 : navigation à deux dimensions).
   */
  axis: "vertical" | "horizontal" | "none";
  /** Rebouclage aux extrémités (défaut vrai : S07, S08) ; faux = l'index est borné (S09, S04, S49, S48, S46 : l'original ne reboucle pas). */
  wrap?: boolean;
  highlight?: MenuHighlight;
  /** Élément sélectionné à l'entrée (défaut 0). */
  initial?: number;
  /** Bip de navigation (nom du `.voc`) joué à chaque changement d'élément par les touches de direction (`21ee:0e8f`). */
  changeSound?: string;
}

/** Ce que `update` renvoie : un élément validé (clic gauche, Espace) ou l'aide demandée (clic droit, Entrée). */
export interface MenuEvent {
  kind: "validate" | "help";
  index: number;
}

/**
 * Composant de sélection réutilisable (engine.md §1.2, §4) : liste d'éléments, un index courant. Clavier d'origine seul :
 * la souris ne désigne rien (ses boutons ne sont que les actions « valider » et « aide », sans tenir compte de la position).
 *
 * - touches : haut/bas ou gauche/droite selon l'axe, avec ou sans rebouclage (`wrap`) ; un bip (`changeSound`) accompagne
 *   chaque changement ;
 * - Espace / clic gauche : `validate` sur l'élément courant ;
 * - Entrée / clic droit : joue la voix d'aide de l'élément (si elle existe) et renvoie `help` ; jamais à la simple sélection.
 *
 * Intégration dans une scène : `load` (voix), `enter` / `resume` (`enter(ctx)`), `update` (renvoie l'événement) et
 * `render` (dessin de la surbrillance par sprite). Ce n'est pas une scène : la scène garde la main sur le flux.
 */
export class Menu {
  private current: number;
  private voices: (Voc | null)[] = [];
  private beep: Voc | null = null;

  constructor(private readonly options: MenuOptions) {
    this.current = options.initial ?? 0;
  }

  get index(): number {
    return this.current;
  }

  get length(): number {
    return this.options.items.length;
  }

  /** Charge les voix d'aide et le bip. */
  async load(ctx: SceneContext): Promise<void> {
    const { changeSound } = this.options;
    const [beep, ...voices] = await Promise.all([
      changeSound ? ctx.resources.voc(changeSound) : null,
      ...this.options.items.map((item) => (item.voice ? ctx.resources.voc(item.voice) : null)),
    ]);
    this.beep = beep;
    this.voices = voices;
  }

  /** À l'entrée de la scène (et à sa reprise) : applique la surbrillance. */
  enter(ctx: SceneContext): void {
    this.options.highlight?.select?.(ctx, this.current);
  }

  /** Change l'élément courant (surbrillance comprise), sans bip. */
  select(ctx: SceneContext, index: number): void {
    if (index === this.current) return;
    this.options.highlight?.deselect?.(ctx, this.current);
    this.current = index;
    this.options.highlight?.select?.(ctx, index);
  }

  /** Un pas : navigation, validation, aide. Renvoie l'événement de ce pas, s'il y en a un. */
  update(ctx: SceneContext): MenuEvent | null {
    const { input } = ctx;
    const { axis, wrap = true } = this.options;
    if (axis !== "none") {
      const [previous, next] = axis === "vertical" ? (["up", "down"] as const) : (["left", "right"] as const);
      const count = this.options.items.length;
      // `justPressed` : un appui plus court que le pas de la scène n'est pas perdu. Les deux ensemble s'annulent.
      const delta = (input.justPressed(next) ? 1 : 0) - (input.justPressed(previous) ? 1 : 0);
      if (delta !== 0) {
        const raw = this.current + delta;
        const target = wrap ? (raw + count) % count : Math.min(count - 1, Math.max(0, raw));
        this.move(ctx, target);
      }
    }
    if (input.justPressed("validate")) return { kind: "validate", index: this.current };
    if (input.justPressed("cancel")) {
      const voice = this.voices[this.current];
      if (voice) ctx.voice.play(voice);
      return { kind: "help", index: this.current };
    }
    return null;
  }

  /** Changement par une touche de direction : sélection et bip (utile aussi à une scène qui déplace la sélection elle-même). */
  move(ctx: SceneContext, index: number): void {
    if (index === this.current) return;
    this.select(ctx, index);
    if (this.beep) ctx.voice.play(this.beep);
  }

  render(ctx: SceneContext): void {
    this.options.highlight?.render?.(ctx, this.current);
  }

  /** À la sortie de la scène : rend la surbrillance par palette (utile à une scène qui reste empilée). */
  exit(ctx: SceneContext): void {
    this.options.highlight?.deselect?.(ctx, this.current);
  }
}
