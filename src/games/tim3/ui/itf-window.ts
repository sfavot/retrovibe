/**
 * Fenêtres `.ITF` du jeu (plan D7), hôte unique : la fenêtre est dessinée par `render/itf-draw.ts` dans un canvas transparent de
 * 640×480 posé sur l'écran du jeu, avec par-dessus un calque DOM de vrais éléments transparents aux rectangles des contrôles
 * (`role="dialog"` titré, focus gardé, Échap, texte de la fenêtre et région `role="status"` pour les lecteurs d'écran).
 *
 * `ItfWindow` (sans DOM) porte toute la logique ; `openItfWindow` la pose dans la page. Les fenêtres surgissantes (messages,
 * guitare, globe…) et les écrans pleins animés du parcours d'entrée (menu principal, crédits, choix du puzzle) ne diffèrent que
 * par leurs options :
 *
 * - Souris et doigt : les rectangles sont testés comme `PlayScreen.toolbarAt` ; un bouton est dessiné enfoncé tant que le pointeur
 *   reste dessus, et il agit au relâchement sur lui. Un bouton à texte fait le son 0xE1B à l'appui (421f5a).
 * - **Flèches** (genre 5 à images, 44ee9d) : l'appui fait avancer l'image à chaque passe de la boucle des contrôles (50 ms, 412bec) ;
 *   au bout de l'état, la flèche agit : bouton tenu, elle repart à l'image 1 (répétition), relâché, elle revient à l'image 0. Un clic
 *   court agit donc une fois, à la fin de l'animation.
 * - **Réglettes** (`sliders`, 425a46 horizontale, 41cf20 verticale) : un bouton (knob) glissé dans une glissière (décor), clic dans la
 *   glissière = bouton centré sous le pointeur ; au clavier, un `role="slider"` (flèches, Origine, Fin, Page).
 * - **Liste** (`list`, DR_LIST de `DOSBOX`, 41bf29) : `ScrollList` dessinée sur son contrôle, un clic choisit une rangée ; au
 *   clavier, un `role="listbox"` (flèches, Origine, Fin, pages ; Entrée : bouton par défaut).
 * - **Zones** (`zones`) : rectangles cliquables propres à l'appelant, dessinés par lui (`ItfState.draw`).
 * - **Champs** (`input`, un ou plusieurs) : `<input>` transparent posé sur un contrôle dont le texte est dessiné par la fenêtre ; ou
 *   (`edit`) un vrai champ visible, sur plusieurs lignes au besoin, comme les contrôles EDIT Win32 que le jeu pose dans ses fenêtres
 *   (texte d'un indice 41f787, valeurs de `SOLVE.ITF` 426f92 : blanc sur bleu).
 * - **Boutons à image enfoncés** (genre 1, 44ede8) : tant que le pointeur reste sur le bouton saisi, son image avance d'une par passe
 *   jusqu'à la dernière de l'état, où elle reste ; hors du bouton ou relâché, image 0. Un bouton de 3 images (« ? », MB_MUSIC,
 *   MM_HELP…) montre donc 1 puis 2.
 * - **Survol animé** (`hoverAnimate`, menu principal, bacs) : le bouton survolé (ou qui a le focus) montre les images de son état,
 *   une par passe, avec leurs sons. Ce n'est pas 44f0a8 : ce rappel est celui des décors (genre 0, table 0x47016c) ; 4506f4 ne
 *   l'appelle que pour un décor sous le pointeur au moment d'un appui (`[0x490084]` & 6) ou marqué « animé à chaque passe » (drapeau
 *   1 de +0x34, 45064c), et il avance alors l'image du décor d'un cran, en boucle (`animate`) ; les boutons ont 44edbc.
 * - **Grisés activables** (`greyedActive`, écrans du parcours d'entrée) : un bouton grisé s'enfonce et agit (l'appelant répond
 *   « non disponible », comme la barre d'outils) ; le calque le marque `aria-disabled` et ajoute « (non disponible) » à son nom.
 *   Sans cette option, un bouton grisé ne s'enfonce pas et son élément est `disabled`.
 * - Clavier : Tab et Maj+Tab parcourent les éléments dans l'ordre de lecture (gardés dans la fenêtre), Entrée / Espace activent,
 *   Échap choisit le bouton d'annulation (450d44 : drapeau 0x20) ou ferme la fenêtre ; le focus visible est un contour CSS.
 * - `choose` rend `true` pour garder la fenêtre ouverte (flèches, interrupteurs) ; sinon elle se ferme juste après l'appel.
 * - Le calque suit la place et l'échelle du canvas du jeu (positions en pourcentage de 640×480, cadre recalé au redimensionnement).
 */
import { h } from "../../../ui/dom";
import type { Itf } from "../data/itf";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../render/screen";
import type { RenderAssets } from "../render/assets";
import type { Rect } from "../render/editor-overlay";
import { frameSounds, type FrameSound } from "../render/front";
import { Surface } from "../render/surface";
import type { ScrollList } from "../render/itf-list";
import { drawItf, imageOfState, itfButtonLabel, itfHitAt, itfOrigin, layoutItf, stateLength, type ItfItem, type ItfLayout, type ItfState } from "../render/itf-draw";
import { copy } from "../copy";

/** Une passe de la boucle des contrôles (412bec : au plus une toutes les 50 ms). */
export const ITF_TICK_MS = 50;
/** Cadence de l'horloge de l'hôte : celle des images du navigateur (animations à cadence propre, `frame`). */
const FRAME_MS = 16;
/** Son du clic d'un bouton à texte (421f5a : 0xE1B, 0xBB9 pour le contrôle de valeur 1150). */
const TEXT_BUTTON_SOUND = 0xe1b;
/** Genre des flèches à répétition (44ee9d). */
const ARROW_KIND = 5;

/** Réglette : une glissière (décor) et son bouton (image), valeur entière de 0 à `max`. */
export interface ItfSlider {
  slider: number;
  knob: number;
  max: number;
  /** Verticale (GRAVITY.ITF, 41cf20 : 0 en haut, glisser continu) ; sinon horizontale (PROG, 425a46 : glisser cranté). */
  vertical?: boolean;
  /** Nom pour les lecteurs d'écran. */
  label: string;
  value(): number;
  set(value: number): void;
  /** Faux : la réglette ne bouge pas, un appui appelle `refused` (GRAVITY en mode Jeu). */
  enabled?: boolean;
  refused?(): void;
  /** Pas des touches Page haut / bas (10 % par défaut). */
  page?: number;
}

/** Rectangle cliquable propre à l'appelant (espace de l'ITF), sans dessin (l'appelant le dessine). */
export interface ItfZone {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  /** Rendu `aria-pressed`. */
  selected?: boolean;
  disabled?: boolean;
}

/** Champ de saisie posé sur un contrôle (DR_TITLE de DOSBOX) : texte dessiné par la fenêtre, `<input>` transparent par-dessus. */
export interface ItfInput {
  id: number;
  label: string;
  value: string;
  maxLength: number;
  input(value: string): void;
  /**
   * Contrôle EDIT du jeu : le champ est visible (texte et fond aux couleurs données), le texte n'est pas dessiné par la fenêtre ;
   * `multiline` : zone de texte (Entrée choisit quand même le bouton par défaut, comme un EDIT sans ES_WANTRETURN).
   */
  edit?: { color: string; background: string; multiline?: boolean };
  /** Chiffres seulement (EDIT de `SOLVE.ITF`). */
  numeric?: boolean;
}

/** Liste à défilement posée sur un contrôle (DR_LIST) : son état (`ScrollList`) et ce que font ses rangées. */
export interface ItfList {
  /** Contrôle de la liste : les rangées sont dessinées après son décor. */
  id: number;
  view: ScrollList;
  /** Nom d'une rangée pour les lecteurs d'écran. */
  label(index: number): string;
  /** Rangée choisie au clavier (flèches, pages, Origine, Fin). */
  select(index: number): void;
  /** Clic sur une rangée (`now` : horloge de l'hôte, double clic) : bouton à choisir ensuite (« Lancer »), sinon rien. */
  click(index: number, now: number): number | undefined;
}

export interface ItfWindowOptions {
  /** Titre pour les lecteurs d'écran. */
  title: string;
  /** Textes, contrôles cachés, grisés, déplacés, images, dessins propres (le décalage de centrage est ajouté ici). Modifiable, puis `refresh`. */
  state?: Omit<ItfState, "dx" | "dy" | "pressed">;
  /** Bouton qui reçoit le focus à l'ouverture (Entrée : drapeau 0x10 de 450d44). */
  defaultId?: number;
  /** Bouton choisi par Échap ; sans valeur, Échap ferme la fenêtre sans choix. */
  cancelId?: number;
  /** Noms des contrôles pour les lecteurs d'écran (sinon leur texte, l'infobulle `DESCRIPT.RES`, ou le texte posé dessous). */
  labels?: Readonly<Record<number, string>>;
  /** Interrupteurs et choix : état `aria-pressed`. */
  checked?(id: number): boolean | undefined;
  sliders?: readonly ItfSlider[];
  zones?(): readonly ItfZone[];
  input?: ItfInput | readonly ItfInput[];
  list?: ItfList;
  /** Contrôles image dont l'image avance à chaque passe (animation en boucle). */
  animate?: readonly number[];
  /** Boutons image animés quand ils sont survolés ou ont le focus ; sons de leurs images. */
  hoverAnimate?: { ids: readonly number[]; sound?(sound: FrameSound): void };
  /** Boutons grisés qui s'enfoncent et agissent quand même (« non disponible »). */
  greyedActive?: boolean;
  /** Textes lus par les lecteurs d'écran à la place de ceux de la fenêtre (texte dessiné par l'appelant). */
  texts?(): string[];
  /** État lu par les lecteurs d'écran (région `role="status"`), remis à jour après chaque action. */
  status?(win: ItfWindow): string;
  /** À chaque passe (50 ms) ; vrai pour redessiner. */
  tick?(): boolean;
  /** À chaque image de l'hôte (horloge en millisecondes), pour une animation à cadence propre ; vrai pour redessiner. */
  frame?(now: number, win: ItfWindow): boolean;
  /** Dessin propre, par-dessus la fenêtre. */
  decorate?(surface: Surface, win: ItfWindow): void;
  /**
   * Mode aide (41e6b7, après le « ? » de la fenêtre du professeur) : tant que `active()` est vrai, un appui désigne les contrôles sous le
   * pointeur (`pick`, du premier plan vers le fond, tous genres) au lieu de les actionner ; au clavier, activer un élément du calque le
   * désigne, Échap appelle `cancel`. Curseur « aide ».
   */
  helpMode?: { active(): boolean; pick(ids: number[]): void; cancel(): void };
  /** Un contrôle a été choisi. Rendre `true` garde la fenêtre ouverte ; sinon elle se ferme. */
  choose(id: number): boolean | void;
  /** Fermeture, quelle qu'en soit la cause (après `choose`). */
  onClose?(): void;
}

/** Élément du calque : ce que voient le clavier et les lecteurs d'écran. */
export type ItfLayerControl = { key: string; rect: Rect; name: string } & (
  | { kind: "button"; id: number; disabled: boolean; unavailable: boolean; pressed?: boolean }
  | { kind: "slider"; slider: ItfSlider }
  | { kind: "input"; input: ItfInput }
  | { kind: "list"; list: ItfList }
);

/** Écran qui rend un résultat (parcours d'entrée) : `action` rend ce qui le ferme, `undefined` le garde ouvert. */
export interface ItfScreen<R> {
  itf: Itf;
  options: Omit<ItfWindowOptions, "choose" | "onClose">;
  action(id: number): R | undefined;
}

/** Options d'un écran à résultat : `then` reçoit le résultat à la fermeture, `null` s'il est fermé sans choix. */
export function screenOptions<R>(screen: ItfScreen<R>, then: (result: R | null) => void): ItfWindowOptions {
  let result: R | null = null;
  return {
    ...screen.options,
    choose: (id) => {
      const r = screen.action(id);
      if (r === undefined) return true;
      result = r;
      return false;
    },
    onClose: () => then(result),
  };
}

/** Les champs d'une fenêtre (un seul, plusieurs ou aucun). */
export function inputsOf(options: Pick<ItfWindowOptions, "input">): readonly ItfInput[] {
  const i = options.input;
  return i === undefined ? [] : Array.isArray(i) ? i : [i as ItfInput];
}

const sameRow = (a: Rect, b: Rect): boolean => a.y < b.y + b.height / 2 && b.y < a.y + a.height / 2;
/** Ordre de lecture : par rangée (rectangles qui se chevauchent en hauteur), puis de gauche à droite. */
const readingOrder = (a: Rect, b: Rect): number => (sameRow(a, b) ? a.x - b.x : a.y - b.y);
const inside = (r: Rect | null, x: number, y: number): boolean => r !== null && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

/** Logique de la fenêtre sans DOM : rectangles, pointeur, survol, focus, flèches, réglettes, liste, Échap, calque. */
export class ItfWindow {
  readonly origin: { dx: number; dy: number };
  pressed: number | null = null;
  /** Le pointeur est sur le bouton saisi (sinon le bouton se dessine relâché). */
  private over = false;
  /** Bouton sous la souris, bouton qui a le focus du clavier. */
  hovered: number | null = null;
  focused: number | null = null;
  /** Dernier des deux à avoir changé : il décide du bouton « actif » (texte du menu, survol animé). */
  private lastInput: "pointer" | "focus" = "focus";
  /** Image du bouton à image saisi (genre 1, 44ede8) : 0 hors du bouton. */
  private pressFrame = 0;
  /** Sons des images atteintes par un bouton enfoncé (commandes `sound` de l'ANM, jouées quand l'image est dessinée) : `takeSounds`. */
  private readonly sounds: FrameSound[] = [];
  /** Flèche saisie (44ee9d) : image courante, bouton encore tenu. */
  private arrow: { id: number; count: number; down: boolean } | null = null;
  /** Réglette saisie : décalage du pointeur dans le bouton, position du bouton (glisser continu). */
  private drag: { slider: ItfSlider; offset: number; pos: number | null } | null = null;
  /** Images courantes des contrôles animés ou des flèches (+0x4c). */
  private readonly frames = new Map<number, number>();
  /** Survol animé : bouton et image courante. */
  private hover: { id: number; frame: number } | null = null;
  /** Prochaine passe de la boucle des contrôles (horloge de l'hôte). */
  private nextPass = 0;
  /** Contrôles choisis hors d'un relâché (double clic d'une liste, fin des crédits) : l'hôte les prend (`drain`). */
  private readonly pending: number[] = [];
  layout: ItfLayout;

  constructor(
    readonly assets: RenderAssets,
    readonly itf: Itf,
    readonly options: Omit<ItfWindowOptions, "choose" | "onClose"> & Partial<Pick<ItfWindowOptions, "choose" | "onClose">>,
    /** Infobulles `DESCRIPT.RES` (noms des contrôles pour les lecteurs d'écran). */
    readonly descriptions?: ReadonlyMap<number, string>,
  ) {
    this.origin = itfOrigin(itf, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.layout = layoutItf(assets, itf, this.state());
  }

  private control(id: number) {
    return this.itf.controls.find((c) => c.id === id);
  }

  /** Rectangle d'un contrôle sur l'écran (décalage compris), même caché. */
  rect(id: number): Rect | null {
    const c = this.control(id);
    return c ? { x: c.x + this.origin.dx, y: c.y + this.origin.dy, width: c.width, height: c.height } : null;
  }

  /** Place du bouton d'une réglette dans l'espace de l'ITF (425a46 / 41cf20 événement 2), ou celle du glisser en cours. */
  knobPosition(s: ItfSlider): { x?: number; y?: number } {
    const slider = this.control(s.slider);
    const knob = this.control(s.knob);
    if (!slider || !knob) return {};
    if (this.drag?.slider === s && this.drag.pos !== null) return s.vertical ? { y: this.drag.pos } : { x: this.drag.pos };
    const v = Math.max(0, Math.min(s.max, s.value()));
    if (s.vertical) return { y: slider.y + Math.trunc((v * (slider.height - knob.height)) / s.max) };
    return { x: slider.x + Math.trunc((v * (slider.width - knob.width - 10)) / s.max) };
  }

  /** État de dessin : celui de l'appelant, centrage, bouton enfoncé, images, boutons des réglettes, liste. */
  state(): ItfState {
    const base = this.options.state ?? {};
    const frames: Record<number, number> = { ...base.frames };
    for (const [id, f] of this.frames) frames[id] = f;
    // Pendant l'appui, le bouton survolé montre son image enfoncée.
    if (this.hover && this.hover.frame > 0 && this.pressed !== this.hover.id) frames[this.hover.id] = this.hover.frame;
    if (this.pressed !== null && this.over && this.pressFrame > 0 && base.frames?.[this.pressed] === undefined) frames[this.pressed] = this.pressFrame;
    const moved: Record<number, { x?: number; y?: number; width?: number; height?: number }> = { ...base.moved };
    for (const s of this.options.sliders ?? []) moved[s.knob] = { ...moved[s.knob], ...this.knobPosition(s) };
    const list = this.options.list;
    const draw = list ? { ...base.draw, [list.id]: (surface: Surface) => list.view.draw(surface, this.assets, this.origin.dx, this.origin.dy) } : base.draw;
    return { ...base, ...this.origin, frames, moved, ...(draw ? { draw } : {}), pressed: this.over ? this.pressed : null };
  }

  /** Rectangles et textes recalculés sans dessiner (après un changement d'état). */
  relayout(): void {
    this.layout = layoutItf(this.assets, this.itf, this.state());
  }

  /** Boutons visibles dans l'ordre de lecture, grisés compris. */
  buttons(): ItfItem[] {
    return this.layout.items.filter((i) => i.clickable).sort(readingOrder);
  }

  /** Texte du bouton ou texte posé dessous. */
  label(item: ItfItem): string {
    return itfButtonLabel(this.layout, item);
  }

  /** Nom d'un bouton pour les lecteurs d'écran : libellé de l'appelant, texte, infobulle, texte posé dessous ; « (non disponible) » s'il est grisé et activable. */
  name(item: ItfItem): string {
    const base = this.options.labels?.[item.id] ?? (item.text || this.descriptions?.get(item.id)?.replace(/^[@!&%$*]+/, "") || this.label(item));
    return this.options.greyedActive && this.greyed(item.id) && base ? copy.toolbarUnavailable(base) : base;
  }

  /** Textes de la fenêtre (titre, message, libellés), pour les lecteurs d'écran. */
  texts(): string[] {
    return this.options.texts?.() ?? this.layout.items.filter((i) => !i.clickable && i.text).map((i) => i.text);
  }

  /** État annoncé (région `role="status"`). */
  status(): string {
    return this.options.status?.(this) ?? "";
  }

  /** Zones de l'appelant, en coordonnées de l'écran. */
  zones(): ItfZone[] {
    return (this.options.zones?.() ?? []).map((z) => ({ ...z, x: z.x + this.origin.dx, y: z.y + this.origin.dy }));
  }

  /** Rectangle de la liste sur l'écran. */
  listRect(): Rect | null {
    const v = this.options.list?.view;
    return v ? { ...v.rect, x: v.rect.x + this.origin.dx, y: v.rect.y + this.origin.dy } : null;
  }

  /** Contrôles visibles sous le point (écran), du premier plan vers le fond, tous genres (41e958 : rectangle du contrôle). */
  controlsAt(x: number, y: number): number[] {
    const ids: number[] = [];
    for (let i = this.layout.items.length - 1; i >= 0; i--) {
      const it = this.layout.items[i]!;
      if (inside(it, x, y)) ids.push(it.id);
    }
    return ids;
  }

  /** Contrôle visible (écran), `null` s'il est caché. */
  item(id: number): ItfItem | null {
    return this.layout.items.find((i) => i.id === id) ?? null;
  }

  /** Bouton grisé (dessiné atténué). */
  greyed(id: number): boolean {
    return this.options.state?.disabled?.includes(id) ?? false;
  }

  /** Bouton « actif » (texte du menu, survol animé) : celui de la dernière action, survol de la souris ou focus du clavier. */
  active(): number | null {
    return this.lastInput === "pointer" ? this.hovered : this.focused;
  }

  /** Éléments du calque, dans l'ordre de lecture. */
  controls(): ItfLayerControl[] {
    const out: ItfLayerControl[] = [];
    const sliderIds = new Set((this.options.sliders ?? []).flatMap((s) => [s.slider, s.knob]));
    for (const item of this.buttons()) {
      if (sliderIds.has(item.id)) continue;
      const pressed = this.options.checked?.(item.id);
      const unavailable = this.options.greyedActive === true && this.greyed(item.id);
      out.push({ kind: "button", key: `b${item.id}`, id: item.id, rect: item, name: this.name(item), disabled: !this.canActivate(item.id), unavailable, ...(pressed === undefined ? {} : { pressed }) });
    }
    for (const z of this.zones()) {
      out.push({ kind: "button", key: `z${z.id}`, id: z.id, rect: z, name: z.label, disabled: z.disabled === true, unavailable: false, ...(z.selected === undefined ? {} : { pressed: z.selected }) });
    }
    for (const s of this.options.sliders ?? []) {
      const r = this.item(s.slider);
      if (r) out.push({ kind: "slider", key: `s${s.slider}`, slider: s, rect: r, name: s.label });
    }
    for (const input of inputsOf(this.options)) {
      // Un EDIT du jeu remplace son contrôle, que la fenêtre cache (41f53f : 45064c(HT_TEXT, 8)).
      const field = this.item(input.id) ?? (input.edit ? this.rect(input.id) : null);
      if (field) out.push({ kind: "input", key: `i${input.id}`, input, rect: field, name: input.label });
    }
    const list = this.options.list;
    const listRect = this.listRect();
    if (list && listRect) out.push({ kind: "list", key: `l${list.id}`, list, rect: listRect, name: this.options.title });
    return out.sort((a, b) => readingOrder(a.rect, b.rect));
  }

  private hit(x: number, y: number): { id: number; enabled: boolean; kind: number; frameCount?: number } | null {
    for (const z of this.zones()) if (inside(z, x, y)) return { id: z.id, enabled: !z.disabled, kind: 1 };
    const it = itfHitAt(this.layout, x, y);
    if (!it) return null;
    const enabled = it.enabled || this.options.greyedActive === true;
    return it.frameCount === undefined ? { id: it.id, enabled, kind: it.kind } : { id: it.id, enabled, kind: it.kind, frameCount: it.frameCount };
  }

  private sliderAt(x: number, y: number): { slider: ItfSlider; onKnob: boolean } | null {
    for (const s of this.options.sliders ?? []) {
      if (inside(this.item(s.knob), x, y)) return { slider: s, onKnob: true };
      if (inside(this.item(s.slider), x, y)) return { slider: s, onKnob: false };
    }
    return null;
  }

  /** Survol : vrai si le bouton survolé change. */
  private hoverAt(x: number, y: number): boolean {
    const id = this.hit(x, y)?.id ?? null;
    const changed = id !== this.hovered || this.lastInput !== "pointer";
    this.hovered = id;
    this.lastInput = "pointer";
    return changed;
  }

  /**
   * Appui (coordonnées de l'écran 640×480, `now` : horloge de l'hôte) : renvoie vrai s'il faut redessiner. Un appui sur une flèche
   * ou une réglette la saisit ; sur une rangée de la liste, il la choisit.
   */
  pointerDown(x: number, y: number, now = 0): boolean {
    this.hoverAt(x, y);
    const s = this.sliderAt(x, y);
    if (s) {
      if (s.slider.enabled === false) {
        s.slider.refused?.();
        return false;
      }
      const knob = this.item(s.slider.knob)!;
      const offset = s.onKnob ? (s.slider.vertical ? y - knob.y : x - knob.x) : Math.trunc((s.slider.vertical ? knob.height : knob.width) / 2);
      this.drag = { slider: s.slider, offset, pos: null };
      this.dragTo(x, y);
      return true;
    }
    const list = this.options.list;
    if (list && inside(this.listRect(), x, y)) {
      const row = list.view.rowAt(x - this.origin.dx, y - this.origin.dy);
      if (row === null) return false;
      const id = list.click(row, now);
      if (id !== undefined) this.pending.push(id);
      return true;
    }
    const hit = this.hit(x, y);
    this.pressed = hit?.enabled ? hit.id : null;
    this.over = this.pressed !== null;
    // 44ede8 : la première passe a lieu à l'appui (image 1).
    this.pressFrame = 0;
    if (this.over && this.pressAnimated(hit)) this.setPressFrame(1);
    if (hit?.enabled && hit.kind === ARROW_KIND && (hit.frameCount ?? 0) > 1) {
      // 44ee9d : la première passe a lieu à l'appui.
      this.arrow = { id: hit.id, count: hit.frameCount!, down: true };
      this.frames.set(hit.id, 1);
      this.pressed = null;
      this.over = false;
      return true;
    }
    return this.over;
  }

  /** Glisser d'une réglette (425a46 horizontale crantée, 41cf20 verticale continue). */
  private dragTo(x: number, y: number): void {
    const d = this.drag;
    if (!d) return;
    const s = d.slider;
    const slider = this.control(s.slider);
    const knob = this.control(s.knob);
    if (!slider || !knob) return;
    const p = (s.vertical ? y - this.origin.dy : x - this.origin.dx) - d.offset;
    if (s.vertical) {
      const course = slider.height - knob.height;
      const pos = Math.max(slider.y, Math.min(slider.y + course, p));
      d.pos = pos;
      s.set(Math.trunc(((pos - slider.y) * s.max) / course));
    } else {
      const course = slider.width - knob.width - 10;
      const left = Math.max(slider.x, Math.min(slider.x + course, p));
      const v = Math.max(0, Math.min(s.max, Math.trunc(((left - slider.x + Math.trunc(knob.width / 2)) * s.max) / course)));
      d.pos = null;
      s.set(v);
    }
  }

  /** Déplacement du pointeur : vrai s'il faut redessiner (survol, bouton saisi, réglette). */
  pointerMove(x: number, y: number): boolean {
    const hovered = this.hoverAt(x, y);
    if (this.drag) {
      this.dragTo(x, y);
      return true;
    }
    if (this.pressed === null) return hovered;
    const over = this.hit(x, y)?.id === this.pressed;
    const changed = over !== this.over;
    this.over = over;
    return changed || hovered;
  }

  /** Relâché : identifiant du bouton choisi (relâché sur le bouton saisi), sinon `null` (une flèche agit à la passe suivante). */
  pointerUp(x: number, y: number): number | null {
    if (this.drag) {
      this.drag = null;
      return null;
    }
    if (this.arrow) this.arrow.down = false;
    const id = this.pressed;
    this.pressed = null;
    this.over = false;
    this.pressFrame = 0;
    if (id === null) return null;
    return this.hit(x, y)?.id === id ? id : null;
  }

  pointerCancel(): void {
    this.pressed = null;
    this.over = false;
    this.pressFrame = 0;
    this.drag = null;
    if (this.arrow) {
      this.frames.delete(this.arrow.id);
      this.arrow = null;
    }
  }

  /** Le pointeur quitte la fenêtre (ou le doigt se lève) : plus de survol ; le focus du clavier redevient le bouton actif. */
  pointerLeave(): boolean {
    const changed = this.hovered !== null || this.lastInput !== "focus";
    this.hovered = null;
    this.lastInput = "focus";
    return changed;
  }

  /** Focus du clavier sur un bouton (`null` : ailleurs) ; vrai si le bouton actif change. */
  focus(id: number | null): boolean {
    const before = this.active();
    this.focused = id;
    if (id !== null) this.lastInput = "focus";
    return this.active() !== before;
  }

  /** Choix à faire hors d'un relâché (double clic, fin d'une animation) : pris par l'hôte à la passe suivante. */
  queue(id: number): void {
    if (!this.pending.includes(id)) this.pending.push(id);
  }

  /** Choix en attente, retirés. */
  drain(): number[] {
    return this.pending.splice(0);
  }

  /** Une passe de la boucle des contrôles : animations, flèche saisie, survol animé. Rend les flèches qui agissent et s'il faut redessiner. */
  pass(): { redraw: boolean; fire: number[] } {
    const fire: number[] = [];
    let redraw = false;
    for (const id of this.options.animate ?? []) {
      const count = this.item(id)?.frameCount ?? 0;
      if (count > 1) {
        this.frames.set(id, ((this.frames.get(id) ?? 0) + 1) % count);
        redraw = true;
      }
    }
    const a = this.arrow;
    if (a) {
      let f = (this.frames.get(a.id) ?? 0) + 1;
      if (f >= a.count) {
        fire.push(a.id);
        if (a.down) f = 1;
        else {
          f = 0;
          this.arrow = null;
        }
      }
      if (f === 0) this.frames.delete(a.id);
      else this.frames.set(a.id, f);
      redraw = true;
    }
    if (this.pressPass()) redraw = true;
    if (this.hoverPass()) redraw = true;
    if (this.options.tick?.()) redraw = true;
    return { redraw, fire };
  }

  /** Bouton à image du genre 1 qui a plusieurs images (44ede8 les fait défiler à l'appui). */
  private pressAnimated(item: { kind: number; frameCount?: number } | null | undefined): boolean {
    return item?.kind === 1 && (item.frameCount ?? 0) > 1;
  }

  /** 44ede8 : bouton saisi sous le pointeur, image suivante jusqu'à la dernière ; ailleurs, image 0. Vrai pour redessiner. */
  private pressPass(): boolean {
    if (this.pressed === null) return false;
    const item = this.item(this.pressed);
    if (!this.pressAnimated(item)) return false;
    const next = this.over ? Math.min(this.pressFrame + 1, item!.frameCount! - 1) : 0;
    if (next === this.pressFrame) return false;
    this.setPressFrame(next);
    return true;
  }

  /** Nouvelle image du bouton enfoncé ; ses sons sont mis de côté pour l'hôte. */
  private setPressFrame(frame: number): void {
    this.pressFrame = frame;
    const anm = frame > 0 && this.itf.anm ? this.assets.anm(this.itf.anm) : null;
    const value = this.pressed !== null ? this.control(this.pressed)?.value : undefined;
    const first = anm && value !== undefined ? imageOfState(anm, value) : -1;
    if (anm && first >= 0) this.sounds.push(...frameSounds(anm, first + frame));
  }

  /** Sons à jouer (images de bouton atteintes), retirés. */
  takeSounds(): FrameSound[] {
    return this.sounds.splice(0);
  }

  /** Survol animé : image suivante de l'état du bouton actif, retour à la première à la fin ; vrai pour redessiner. */
  private hoverPass(): boolean {
    const o = this.options.hoverAnimate;
    if (!o) return false;
    const active = this.active();
    const id = active !== null && o.ids.includes(active) && !this.greyed(active) ? active : null;
    if (id !== (this.hover?.id ?? null)) {
      const had = (this.hover?.frame ?? 0) !== 0;
      this.hover = id === null ? null : { id, frame: 0 };
      return had;
    }
    if (!this.hover) return false;
    const anm = this.itf.anm ? this.assets.anm(this.itf.anm) : null;
    const value = this.control(this.hover.id)?.value;
    const first = anm && value !== undefined ? imageOfState(anm, value) : -1;
    const count = anm && first >= 0 ? stateLength(anm, first) : 0;
    if (!anm || count < 2) return false;
    this.hover.frame = (this.hover.frame + 1) % count;
    for (const sound of frameSounds(anm, first + this.hover.frame)) o.sound?.(sound);
    return true;
  }

  /** Une image de l'hôte (`now` en millisecondes) : animation propre, et une passe des contrôles toutes les 50 ms. */
  tick(now: number): { redraw: boolean; fire: number[] } {
    let redraw = this.options.frame?.(now, this) ?? false;
    const fire: number[] = [];
    if (now >= this.nextPass) {
      this.nextPass = Math.max(now, this.nextPass + ITF_TICK_MS);
      const p = this.pass();
      if (p.redraw) redraw = true;
      fire.push(...p.fire);
    }
    fire.push(...this.drain());
    return { redraw, fire };
  }

  /** Clavier sur une réglette : nouvelle valeur (bornée), ou `null` si la touche ne la concerne pas. */
  sliderKey(s: ItfSlider, key: string): number | null {
    const v = s.value();
    const page = s.page ?? Math.max(1, Math.round(s.max / 10));
    const next: Record<string, number> = {
      ArrowRight: v + 1,
      ArrowUp: s.vertical ? v - 1 : v + 1,
      ArrowLeft: v - 1,
      ArrowDown: s.vertical ? v + 1 : v - 1,
      PageUp: v + page,
      PageDown: v - page,
      Home: 0,
      End: s.max,
    };
    if (!(key in next)) return null;
    return Math.max(0, Math.min(s.max, next[key]!));
  }

  /** Clavier sur la liste : rangée à choisir, ou `null` si la touche ne la concerne pas. */
  listKey(key: string): number | null {
    const view = this.options.list?.view;
    const n = view?.rows.length ?? 0;
    if (!view || n === 0) return null;
    const sel = view.selected;
    const next: Record<string, number> = { ArrowDown: sel + 1, ArrowUp: sel - 1, PageDown: sel + view.page(), PageUp: sel - view.page(), Home: 0, End: n - 1 };
    if (!(key in next)) return null;
    return Math.max(0, Math.min(n - 1, next[key]!));
  }

  /** Échap : bouton d'annulation s'il est actif, `null` pour fermer sans choix. */
  escape(): number | null {
    const id = this.options.cancelId;
    return id !== undefined && this.canActivate(id) ? id : null;
  }

  /** Activation au clavier ou par un lecteur d'écran : seulement un bouton (ou un grisé activable) ou une zone actifs. */
  canActivate(id: number): boolean {
    const greyedActive = this.options.greyedActive === true;
    return this.layout.items.some((i) => i.id === id && (i.enabled || (greyedActive && i.clickable))) || this.zones().some((z) => z.id === id && !z.disabled);
  }

  /** Dessin sur une surface transparente de 640×480 ; met à jour les rectangles. */
  render(surface: Surface): void {
    surface.clear(0);
    this.layout = drawItf(surface, this.assets, this.itf, this.state());
    this.options.decorate?.(surface, this);
  }
}

/** Où poser la fenêtre : la page du jeu (élément plein écran), le canvas dont elle suit la place, les ressources. */
export interface ItfHost {
  main: HTMLElement;
  canvas: HTMLCanvasElement;
  assets: RenderAssets;
  /** Infobulles `DESCRIPT.RES` (nom des contrôles pour les lecteurs d'écran). */
  descriptions?: ReadonlyMap<number, string>;
  /** Son du clic d'un bouton à texte (421f5a). */
  playEffect?(id: number): void;
}

/** Fenêtre ouverte : on peut la redessiner après avoir changé son état. */
export interface ItfWindowHandle {
  element: HTMLElement;
  close(): void;
  model: ItfWindow;
  /** Redessine et remet le calque à jour (contrôles cachés, grisés, libellés, valeurs). */
  refresh(): void;
}

let itfCount = 0;
const pct = (v: number, total: number): string => `${(v / total) * 100}%`;

export function openItfWindow(host: ItfHost, itf: Itf, options: ItfWindowOptions): ItfWindowHandle {
  const model = new ItfWindow(host.assets, itf, options, host.descriptions);
  const helpMode = options.helpMode;
  const picking = (): boolean => helpMode?.active() === true;
  const titleId = `tim3-itf-${++itfCount}`;
  const previous = document.activeElement as HTMLElement | null;
  const now = (): number => performance.now();

  const canvas = h("canvas", { class: "tim3-itf-canvas", width: SCREEN_WIDTH, height: SCREEN_HEIGHT, "aria-hidden": "true" });
  const ctx = canvas.getContext("2d");
  const surface = new Surface(SCREEN_WIDTH, SCREEN_HEIGHT);
  const image = ctx?.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  const draw = (): void => {
    model.render(surface);
    if (!ctx || !image) return;
    surface.toRgba(host.assets.gameLut(), new Uint32Array(image.data.buffer));
    ctx.putImageData(image, 0, 0);
  };
  draw();

  const description = h("p", { class: "tim3-sr" });
  const status = h("p", { class: "tim3-sr", role: "status" });
  const layer = h("div", { class: "tim3-itf-layer" });
  const dialog = h(
    "div",
    { class: "tim3-itf", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" },
    h("h2", { id: titleId, class: "tim3-sr" }, options.title),
    description,
    status,
    canvas,
    layer,
  );
  const overlay = h("div", { class: "tim3-itf-overlay" }, dialog);

  const place = (el: HTMLElement, r: Rect): void => {
    Object.assign(el.style, { left: pct(r.x, SCREEN_WIDTH), top: pct(r.y, SCREEN_HEIGHT), width: pct(r.width, SCREEN_WIDTH), height: pct(r.height, SCREEN_HEIGHT) });
  };
  const updateStatus = (): void => {
    const said = model.status();
    if (status.textContent !== said) status.textContent = said;
  };
  /** Focus d'un bouton du calque : le bouton actif change (texte du menu, survol animé). */
  const focusButton = (id: number | null): void => {
    if (model.focus(id)) draw();
    updateStatus();
  };

  /** Éléments du calque, recréés à chaque mise à jour (le focus est rendu à l'élément de même clé). */
  const elements = new Map<string, HTMLElement>();
  const sync = (): void => {
    const focused = [...elements].find(([, e]) => e === document.activeElement)?.[0];
    const next = new Map<string, HTMLElement>();
    const reuse = <T extends HTMLElement>(key: string, make: () => T): T => {
      const e = (elements.get(key) as T | undefined) ?? make();
      next.set(key, e);
      return e;
    };
    for (const c of model.controls()) {
      if (c.kind === "button") {
        const id = c.id;
        const b = reuse(c.key, () => {
          const e = h("button", { type: "button", class: "tim3-itf-button" });
          // Sans prise au pointeur (CSS) : souris et doigt passent par les rectangles (`ItfWindow`) ; le clic ne vient ici que du
          // clavier ou d'un lecteur d'écran.
          e.addEventListener("click", () => {
            if (helpMode && picking()) {
              helpMode.pick([id]);
              refresh();
            } else pick(id);
          });
          e.addEventListener("focus", () => focusButton(id));
          e.addEventListener("blur", () => {
            if (model.focused === id) focusButton(null);
          });
          return e;
        });
        b.textContent = c.name;
        b.disabled = c.disabled;
        if (c.unavailable) b.setAttribute("aria-disabled", "true");
        else b.removeAttribute("aria-disabled");
        if (c.pressed === undefined) b.removeAttribute("aria-pressed");
        else b.setAttribute("aria-pressed", String(c.pressed));
      } else if (c.kind === "slider") {
        const s = c.slider;
        const e = reuse(c.key, () => {
          const el = h("div", { class: "tim3-itf-button tim3-itf-slider", role: "slider", tabindex: "0", "aria-valuemin": "0", "aria-orientation": s.vertical ? "vertical" : "horizontal" });
          el.addEventListener("keydown", (event) => {
            if (s.enabled === false) return;
            const v = model.sliderKey(s, event.key);
            if (v === null) return;
            event.preventDefault();
            s.set(v);
            refresh();
          });
          return el;
        });
        e.setAttribute("aria-label", c.name);
        e.setAttribute("aria-valuemax", String(s.max));
        e.setAttribute("aria-valuenow", String(s.value()));
        if (s.enabled === false) e.setAttribute("aria-disabled", "true");
        else e.removeAttribute("aria-disabled");
      } else if (c.kind === "input") {
        const inp = c.input;
        const e = reuse(c.key, () => {
          const attrs = { class: inp.edit ? "tim3-itf-input tim3-itf-edit" : "tim3-itf-input", maxlength: inp.maxLength, autocomplete: "off", spellcheck: "false" };
          const el = inp.edit?.multiline ? h("textarea", attrs) : h("input", { type: "text", ...attrs, ...(inp.numeric ? { inputmode: "numeric" } : {}) });
          if (inp.edit) Object.assign(el.style, { color: inp.edit.color, backgroundColor: inp.edit.background });
          el.addEventListener("input", () => {
            if (inp.numeric) el.value = el.value.replace(/\D+/g, "");
            inp.input(el.value);
            draw();
          });
          el.addEventListener("keydown", (event) => {
            if ((event as KeyboardEvent).key === "Enter" && options.defaultId !== undefined) {
              event.preventDefault();
              pick(options.defaultId);
            }
          });
          return el;
        }) as HTMLInputElement | HTMLTextAreaElement;
        e.setAttribute("aria-label", c.name);
        if (e.value !== inp.value) e.value = inp.value;
      } else {
        const list = c.list;
        const e = reuse(c.key, () => {
          const el = h("div", { class: "tim3-itf-button tim3-itf-list", role: "listbox", tabindex: "0" });
          el.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (options.defaultId !== undefined) pick(options.defaultId);
              return;
            }
            const row = model.listKey(event.key);
            if (row === null) return;
            event.preventDefault();
            list.select(row);
            refresh();
          });
          return el;
        });
        e.setAttribute("aria-label", c.name);
        const rows = list.view.rows.map((_, i) => list.label(i));
        if (e.children.length !== rows.length) {
          e.replaceChildren(...rows.map((_, i) => h("div", { role: "option", id: `${titleId}-row-${i}`, class: "tim3-sr" })));
        }
        rows.forEach((text, i) => {
          const o = e.children[i]!;
          o.textContent = text;
          o.setAttribute("aria-selected", String(i === list.view.selected));
        });
        if (rows[list.view.selected] !== undefined) e.setAttribute("aria-activedescendant", `${titleId}-row-${list.view.selected}`);
        else e.removeAttribute("aria-activedescendant");
      }
      place(next.get(c.key)!, c.rect);
    }
    layer.replaceChildren(...next.values());
    elements.clear();
    for (const [k, e] of next) elements.set(k, e);
    if (focused && document.activeElement === document.body) elements.get(focused)?.focus({ preventScroll: true });
    description.textContent = model
      .texts()
      .filter((t) => t !== options.title)
      .join(" ");
    updateStatus();
  };
  sync();

  /** Le calque couvre exactement le canvas du jeu. */
  const fit = (): void => {
    const r = host.canvas.getBoundingClientRect();
    const o = overlay.getBoundingClientRect();
    Object.assign(dialog.style, { left: `${r.left - o.left}px`, top: `${r.top - o.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  const resize = new ResizeObserver(fit);
  resize.observe(host.canvas);
  resize.observe(host.main);
  window.addEventListener("resize", fit);
  window.addEventListener("scroll", fit, true);

  let closed = false;
  const refresh = (): void => {
    if (closed) return;
    dialog.classList.toggle("tim3-itf-picking", picking());
    draw();
    sync();
  };

  const timer = window.setInterval(() => {
    const t = model.tick(now());
    for (const s of model.takeSounds()) host.playEffect?.(s.id);
    if (t.redraw) draw();
    for (const id of t.fire) pick(id);
    if (!closed) updateStatus();
  }, FRAME_MS);

  const close = (): void => {
    if (closed) return;
    closed = true;
    window.clearInterval(timer);
    resize.disconnect();
    window.removeEventListener("resize", fit);
    window.removeEventListener("scroll", fit, true);
    overlay.remove();
    options.onClose?.();
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
  const pick = (id: number): void => {
    if (closed || !model.canActivate(id)) return;
    // Une flèche qui agit (`tick`) peut fermer la fenêtre (Terminé…) : la décision revient à `choose`.
    const keep = options.choose(id) === true;
    if (keep) refresh();
    else close();
  };
  /** Choix en attente après un événement du pointeur (double clic d'une liste). */
  const flush = (): void => {
    for (const id of model.drain()) pick(id);
  };

  // Pointeur : coordonnées de l'écran 640×480.
  const logical = (event: PointerEvent): { x: number; y: number } => {
    const r = dialog.getBoundingClientRect();
    return { x: ((event.clientX - r.left) / r.width) * SCREEN_WIDTH, y: ((event.clientY - r.top) / r.height) * SCREEN_HEIGHT };
  };
  dialog.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const p = logical(event);
    event.preventDefault();
    if (helpMode && picking()) {
      helpMode.pick(model.controlsAt(p.x, p.y));
      refresh();
      return;
    }
    dialog.setPointerCapture(event.pointerId);
    model.pointerDown(p.x, p.y, now());
    const pressed = model.pressed !== null ? model.item(model.pressed) : null;
    if (pressed && pressed.kind !== 0 && pressed.frameCount === undefined) host.playEffect?.(TEXT_BUTTON_SOUND);
    for (const s of model.takeSounds()) host.playEffect?.(s.id);
    refresh();
    flush();
  });
  dialog.addEventListener("pointermove", (event) => {
    const p = logical(event);
    if (model.pointerMove(p.x, p.y)) draw();
    updateStatus();
  });
  dialog.addEventListener("pointerup", (event) => {
    const p = logical(event);
    const id = model.pointerUp(p.x, p.y);
    // Au doigt, pas de survol : il s'arrête avec le doigt.
    if (event.pointerType !== "mouse") model.pointerLeave();
    refresh();
    if (id !== null) pick(id);
  });
  dialog.addEventListener("pointercancel", () => {
    model.pointerCancel();
    draw();
  });
  dialog.addEventListener("pointerleave", () => {
    if (model.pointerLeave()) draw();
    updateStatus();
  });
  // Les clics hors de la fenêtre ne passent pas au jeu (fenêtre modale).
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) event.preventDefault();
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (helpMode && picking()) {
        helpMode.cancel();
        refresh();
        return;
      }
      const id = model.escape();
      if (id !== null) pick(id);
      else close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...elements.values()].filter((b) => !(b instanceof HTMLButtonElement && b.disabled));
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const within = items.includes(document.activeElement as HTMLElement);
    if (event.shiftKey && (document.activeElement === first || !within)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !within)) {
      event.preventDefault();
      first.focus();
    }
  });

  // Le calque couvre l'écran du jeu seulement : les boutons du site autour (« ≡ », son, plein écran) restent utilisables.
  (host.canvas.parentElement ?? host.main).append(overlay);
  fit();
  queueMicrotask(() => {
    if (closed) return;
    const usable = (e: HTMLElement | undefined): e is HTMLElement => e !== undefined && !(e instanceof HTMLButtonElement && e.disabled);
    const list = options.list ? elements.get(`l${options.list.id}`) : undefined;
    const firstInput = inputsOf(options)[0];
    const preferred = [firstInput ? elements.get(`i${firstInput.id}`) : undefined, options.defaultId !== undefined ? elements.get(`b${options.defaultId}`) : undefined, list];
    const target = preferred.find(usable) ?? [...elements.values()].find(usable);
    (target ?? dialog).focus({ preventScroll: true });
  });
  return { element: dialog, close, model, refresh };
}
