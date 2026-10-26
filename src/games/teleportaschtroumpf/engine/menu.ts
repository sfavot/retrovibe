import type { Hy8 } from "../data/hy8";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../data/mcg";
import type { Voc } from "../data/voc";
import type { SceneContext } from "./scene";
import { boundsOf, placeSprite } from "./sprites";

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

/** Zone d'une entrée à l'écran, en pixels 320×200, bornes incluses. */
export interface MenuArea {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Marge par défaut autour d'une entrée (pixels 320×200) : un texte seul est une cible trop fine pour le doigt. */
export const AREA_MARGIN = 6;

/** Rectangle des pixels d'un indice de palette dans un écran 320×200, élargi de `margin` ; `null` si l'indice est absent. */
export function paletteBounds(pixels: Uint8Array, index: number, margin = 0): MenuArea | null {
  let x0 = SCREEN_WIDTH;
  let y0 = SCREEN_HEIGHT;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      if (pixels[y * SCREEN_WIDTH + x] !== index) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return null;
  return expand({ x0, y0, x1, y1 }, margin);
}

/** Zones d'entrées dont le texte est peint dans les indices `firstEntry + i` (menus à `paletteHighlight`), lues à l'écran. */
export function paletteAreas(firstEntry: number, count: number, margin = AREA_MARGIN): (ctx: SceneContext) => (MenuArea | null)[] {
  return (ctx) => Array.from({ length: count }, (_, i) => paletteBounds(ctx.surface.work, firstEntry + i, margin));
}

/** Zone d'un sprite HY8 posé en (x, y) (ancre de `drawSprite`), élargie de `margin`. */
export function spriteArea(hy8: Hy8, sprite: number, x: number, y: number, margin = 0): MenuArea {
  const b = boundsOf(placeSprite(hy8, sprite, false));
  return expand({ x0: x + b.minX, y0: y + b.minY, x1: x + b.maxX - 1, y1: y + b.maxY - 1 }, margin);
}

/** (x, y) est dans `area` (bornes incluses). */
export function insideArea(area: MenuArea, x: number, y: number): boolean {
  return x >= area.x0 && x <= area.x1 && y >= area.y0 && y <= area.y1;
}

function expand(area: MenuArea, margin: number): MenuArea {
  return {
    x0: Math.max(0, area.x0 - margin),
    y0: Math.max(0, area.y0 - margin),
    x1: Math.min(SCREEN_WIDTH - 1, area.x1 + margin),
    y1: Math.min(SCREEN_HEIGHT - 1, area.y1 + margin),
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
  /**
   * Le bip ne se lance que si aucun bruitage ne sonne (`if (348d:0b42(1, 0) == 0)`, S46, S48, S49) ; sinon il remplace le
   * bruitage en cours (S07, S08, S04).
   */
  changeSoundIfIdle?: boolean;
  /**
   * Ajout du port pour le doigt et la souris (l'original n'a que le clavier) : zones des entrées, calculées à `enter` (l'écran
   * est alors dessiné). Cliquer une entrée la sélectionne et la valide ; au doigt, elle se valide au relâchement et l'appui
   * long joue sa voix d'aide. Un appui hors des zones ne fait rien ; la souris qui survole une entrée la sélectionne. Sans
   * zones, le clic valide l'élément courant où que soit le pointeur.
   */
  areas?: (ctx: SceneContext) => readonly (MenuArea | null)[];
}

/** Ce que `update` renvoie : un élément validé (clic gauche, Espace) ou l'aide demandée (clic droit, Entrée). */
export interface MenuEvent {
  kind: "validate" | "help";
  index: number;
}

/**
 * Composant de sélection réutilisable (engine.md §1.2, §4) : liste d'éléments, un index courant. Clavier d'origine seul :
 * la souris ne désigne rien (ses boutons ne sont que les actions « valider » et « aide », sans tenir compte de la position),
 * sauf dans les menus à zones (`areas`), ajout du port pour le doigt.
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
  private areas: readonly (MenuArea | null)[] = [];
  /** Dernière position de survol traitée : la souris immobile ne reprend pas la sélection changée au clavier. */
  private hoverX = -1;
  private hoverY = -1;

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
    this.areas = this.options.areas?.(ctx) ?? [];
    this.hoverX = this.hoverY = -1;
  }

  /** Entrée dont la zone contient (x, y), ou `null` (aucune zone, ou menu sans zones). */
  itemAt(x: number, y: number): number | null {
    const index = this.areas.findIndex((a) => a !== null && insideArea(a, x, y));
    return index < 0 ? null : index;
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
    if (input.pointerHovering && (input.mouseX !== this.hoverX || input.mouseY !== this.hoverY)) {
      this.hoverX = input.mouseX;
      this.hoverY = input.mouseY;
      const hovered = this.itemAt(input.mouseX, input.mouseY);
      if (hovered !== null) this.move(ctx, hovered);
    }
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
    const gesture = this.areas.length > 0 ? input.touchGesture : null;
    if (gesture && gesture.kind !== "swipe") {
      // Au doigt : l'entrée touchée se valide au relâchement, l'appui long dit son nom (le clic droit du doigt).
      const touched = this.itemAt(gesture.x, gesture.y);
      if (touched !== null) {
        this.select(ctx, touched);
        return gesture.kind === "tap" ? { kind: "validate", index: touched } : this.help(ctx);
      }
    }
    if (input.justPressed("validate")) {
      const at = input.validateAt;
      if (at === null || this.areas.length === 0) return { kind: "validate", index: this.current };
      // Le doigt qui se pose ne valide rien : son geste décide au relâchement.
      if (input.validateByTouch) return null;
      const clicked = this.itemAt(at.x, at.y);
      if (clicked === null) return null;
      this.select(ctx, clicked);
      return { kind: "validate", index: clicked };
    }
    if (input.justPressed("cancel")) return this.help(ctx);
    return null;
  }

  /** Voix d'aide de l'élément courant (si elle existe). */
  private help(ctx: SceneContext): MenuEvent {
    const voice = this.voices[this.current];
    if (voice) ctx.voice.play(voice);
    return { kind: "help", index: this.current };
  }

  /** Changement par une touche de direction : sélection et bip (utile aussi à une scène qui déplace la sélection elle-même). */
  move(ctx: SceneContext, index: number): void {
    if (index === this.current) return;
    this.select(ctx, index);
    // Bruitage mélangé `348d:0b42(2, bip)` : la musique n'est pas coupée.
    if (this.beep && !(this.options.changeSoundIfIdle && ctx.voice.effectPlaying)) ctx.voice.playEffect(this.beep);
  }

  render(ctx: SceneContext): void {
    this.options.highlight?.render?.(ctx, this.current);
  }

  /** À la sortie de la scène : rend la surbrillance par palette (utile à une scène qui reste empilée). */
  exit(ctx: SceneContext): void {
    this.options.highlight?.deselect?.(ctx, this.current);
  }
}
