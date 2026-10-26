/**
 * Moteur de menu de `gm_menu_run` (`00415a20`, docs/swiv3d/screens.md §4.1), sans entrées-sorties : l'état et la navigation sont purs,
 * le tracé écrit dans l'image indexée 320×400 avec les aplats de la table de mélange.
 *
 * Partagé par les écrans (`screens/`) et le HUD (`render/hud/pause.ts`). Le titre 3D du menu n'en fait pas partie : il se dessine à part
 * (`render/text3d/titles.ts`), au-dessus du menu placé à l'ordonnée `Y` de l'exécutable.
 *
 * Lignes de 19 px centrées en x = 160, cadre de la largeur du texte le plus large + 10, navigation Haut / Bas avec bouclage,
 * Entrée ignorée pendant les 3 premières images, curseurs 0..255 réglés par Gauche / Droite.
 */
import { TextRenderer, UI_HEIGHT, UI_WIDTH } from "./text";

/** Hauteur d'une ligne de texte (`0x13`). */
export const LINE_HEIGHT = 19;
/** Centre horizontal des menus (`DAT_00480bf8`). */
export const MENU_CENTER_X = 160;
/** Images pendant lesquelles Entrée est ignorée (« 3 premières images »). */
export const ENTER_GUARD_FRAMES = 3;
/** Pas d'un appui sur Gauche / Droite pour un curseur (l'original : `± 2 × facteur de cadence` par image). */
export const SLIDER_STEP = 8;
/** Largeur de la piste d'un curseur (`x−40..x+40`). */
export const SLIDER_TRACK = 80;
/** Place réservée au curseur à droite du libellé. */
const SLIDER_SPACE = SLIDER_TRACK + 20;

/** Lignes de la table de mélange utilisées par le moteur (§4.1). */
export const ROW = { veil: 0xa1, banner: 0x76, rule: 0xff, selected: 3, selectedLight: 10, track: 0xff, knob: 0x0a } as const;

export type MenuLine =
  /** Choix : renvoie `id`. */
  | { type: "choice"; id: number; text: string }
  /** Bandeau de titre (une ligne par segment `|`). */
  | { type: "title"; text: string }
  /** Ligne de texte non sélectionnable. */
  | { type: "text"; text: string }
  /** Espaceur de `height` px rempli avec la ligne `row` de la table de mélange (trait de 1 px : ligne `0xff`). */
  | { type: "spacer"; height: number; row: number }
  /** Curseur 0..255 (type 4). */
  | { type: "slider"; id: number; text: string; value: number };

export interface MenuOptions {
  /** Ordonnée de la première ligne (le `Y` passé à `gm_menu_run`), ou `center` pour centrer le menu verticalement. */
  y: number | "center";
  /** Pas d'annulation (drapeau `0x20` : menu principal, sélection du pilote). */
  noCancel?: boolean;
  /** Id sélectionné au départ (drapeau `0x01`) ; sinon la première ligne sélectionnable. */
  initial?: number;
}

export type MenuEvent =
  | { kind: "moved" }
  | { kind: "chosen"; id: number }
  | { kind: "cancelled" }
  | { kind: "adjusted"; id: number; value: number };

export type MenuKey = "up" | "down" | "left" | "right" | "enter" | "escape";

interface Placed {
  line: MenuLine;
  top: number;
  height: number;
}

/** Une ligne de texte par segment `|` d'une chaîne du jeu. */
export const splitLines = (text: string): string[] => text.split("|");

const isSelectable = (line: MenuLine): line is Extract<MenuLine, { type: "choice" | "slider" }> => line.type === "choice" || line.type === "slider";

/**
 * Menu type : espaceur de 3 px, trait, bandeau(x), trait, espaceur, lignes, espaceur, trait, espaceur (§4.1).
 * `banner` : lignes du bandeau de texte (sous le titre 3D) ; sans bandeau, un seul trait sépare le haut du cadre des lignes.
 * `body` : choix et textes.
 */
export function standardLines(banner: string[], body: MenuLine[]): MenuLine[] {
  const space: MenuLine = { type: "spacer", height: 3, row: ROW.veil };
  const rule: MenuLine = { type: "spacer", height: 1, row: ROW.rule };
  const bands = banner.flatMap((text) => splitLines(text).map((t): MenuLine => ({ type: "title", text: t })));
  return [space, rule, ...(bands.length > 0 ? [...bands, rule] : []), space, ...body, space, rule, space];
}

export class Menu {
  private placed: Placed[] = [];
  private left = 0;
  private right = 0;
  private selectedId = -1;
  private frames = 0;
  private lines: MenuLine[] = [];

  constructor(
    lines: MenuLine[],
    private readonly options: MenuOptions,
    private readonly text: TextRenderer,
  ) {
    this.setLines(lines, options.initial);
  }

  /** Remplace les lignes (texte changé, curseur déplacé) en gardant la sélection si elle existe encore. */
  setLines(lines: MenuLine[], initial = this.selectedId): void {
    this.lines = lines;
    const ids = this.ids();
    this.selectedId = ids.includes(initial) ? initial : (ids[0] ?? -1);
    this.layout();
  }

  get selected(): number {
    return this.selectedId;
  }

  /**
   * Ids sélectionnables, dans l'ordre d'affichage. Un choix de plusieurs lignes (`gm_menu_add` donne le même id à chaque segment `|`,
   * comme « Type du contrôleur principal|[Clavier] ») ne compte qu'une fois : la sélection est un id (`gm_menu_select`), toutes ses
   * lignes s'éclairent ensemble.
   */
  ids(): number[] {
    return [...new Set(this.lines.filter(isSelectable).map((l) => l.id))];
  }

  /** Textes affichés (titres, textes et libellés), dans l'ordre : tests et lecteurs d'écran. */
  texts(): string[] {
    return this.lines.flatMap((l) => (l.type === "title" || l.type === "text" || l.type === "choice" || l.type === "slider" ? [l.text] : []));
  }

  /** Une image de plus (l'original compte les images : Entrée est ignorée au début). */
  tick(): void {
    this.frames++;
  }

  get ready(): boolean {
    return this.frames > ENTER_GUARD_FRAMES;
  }

  /** Touche du menu : renvoie l'événement à traiter (son compris), ou `null` si rien ne se passe. */
  press(key: MenuKey): MenuEvent | null {
    const ids = this.ids();
    const at = ids.indexOf(this.selectedId);
    switch (key) {
      case "up":
      case "down": {
        if (ids.length === 0) return null;
        const next = (at + (key === "down" ? 1 : -1) + ids.length) % ids.length;
        this.selectedId = ids[next]!;
        return { kind: "moved" };
      }
      case "enter":
        if (!this.ready || at < 0) return null;
        return { kind: "chosen", id: this.selectedId };
      case "escape":
        return this.options.noCancel ? null : { kind: "cancelled" };
      case "left":
      case "right": {
        const line = this.lines.find((l) => l.type === "slider" && l.id === this.selectedId);
        if (!line || line.type !== "slider") return null;
        const value = Math.max(0, Math.min(255, line.value + (key === "right" ? SLIDER_STEP : -SLIDER_STEP)));
        return value === line.value ? null : { kind: "adjusted", id: line.id, value };
      }
    }
  }

  /** Toucher / cliquer à `(x, y)` (repère 320×400) : un choix se valide, un curseur se règle, hors du cadre annule. */
  tap(x: number, y: number): MenuEvent | null {
    const hit = this.placed.find((p) => isSelectable(p.line) && y >= p.top && y < p.top + p.height && x >= this.left && x < this.right);
    if (hit && isSelectable(hit.line)) {
      this.selectedId = hit.line.id;
      if (hit.line.type === "slider") {
        const trackLeft = this.right - 10 - SLIDER_TRACK;
        const value = Math.round(Math.max(0, Math.min(1, (x - trackLeft) / SLIDER_TRACK)) * 255);
        return { kind: "adjusted", id: hit.line.id, value };
      }
      return this.ready ? { kind: "chosen", id: hit.line.id } : { kind: "moved" };
    }
    const top = this.placed[0]?.top ?? 0;
    const bottom = this.placed.length > 0 ? this.placed[this.placed.length - 1]!.top + this.placed[this.placed.length - 1]!.height : 0;
    if (x < this.left || x >= this.right || y < top || y >= bottom) return this.options.noCancel ? null : { kind: "cancelled" };
    return null;
  }

  /** Tracé des aplats puis des textes (comme `gm_menu_run`) dans `fb`, par-dessus l'image déjà présente. */
  draw(fb: Uint8Array): void {
    const t = this.text;
    for (const { line, top, height } of this.placed) {
      const bottom = top + height;
      switch (line.type) {
        case "choice":
        case "slider":
          if (line.id === this.selectedId) {
            t.fill(fb, this.left, top, this.right, bottom, ROW.selected);
            t.fill(fb, this.left, top, this.right, bottom, ROW.selectedLight);
            t.fill(fb, this.left, top, this.right, bottom, ROW.selectedLight);
          } else t.fill(fb, this.left, top, this.right, bottom, ROW.veil);
          break;
        case "title":
          t.fill(fb, this.left, top, this.right, bottom, ROW.banner);
          break;
        case "text":
          t.fill(fb, this.left, top, this.right, bottom, ROW.veil);
          break;
        case "spacer":
          t.fill(fb, this.left, top, this.right, bottom, line.row);
          break;
      }
    }
    for (const { line, top } of this.placed) {
      if (line.type === "slider") {
        t.draw(fb, line.text, this.left + 5, top, "l");
        this.drawSlider(fb, top, line.value);
      } else if (line.type !== "spacer") t.draw(fb, line.text, MENU_CENTER_X, top, "c");
    }
  }

  private drawSlider(fb: Uint8Array, top: number, value: number): void {
    const t = this.text;
    const x0 = this.right - 10 - SLIDER_TRACK;
    t.fill(fb, x0, top + 9, x0 + SLIDER_TRACK, top + 13, ROW.track);
    const knob = x0 + Math.round((value * SLIDER_TRACK) / 255) - 3;
    t.fill(fb, knob, top + 5, knob + 6, top + 18, ROW.knob);
    t.fill(fb, knob + 1, top + 6, knob + 5, top + 17, ROW.rule);
  }

  private layout(): void {
    let widest = 0;
    for (const line of this.lines) {
      if (line.type === "spacer") continue;
      const w = this.text.width(line.text) + (line.type === "slider" ? SLIDER_SPACE : 0);
      widest = Math.max(widest, w);
    }
    const half = Math.ceil(widest / 2) + 5;
    this.left = MENU_CENTER_X - half;
    this.right = MENU_CENTER_X + half;
    if (this.right > UI_WIDTH) this.right = UI_WIDTH;
    if (this.left < 0) this.left = 0;
    const height = this.lines.reduce((sum, l) => sum + (l.type === "spacer" ? l.height : LINE_HEIGHT), 0);
    let top = this.options.y === "center" ? Math.max(0, Math.round((UI_HEIGHT - height) / 2)) : this.options.y;
    this.placed = this.lines.map((line) => {
      const height = line.type === "spacer" ? line.height : LINE_HEIGHT;
      const placed = { line, top, height };
      top += height;
      return placed;
    });
  }
}
