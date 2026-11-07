import { type AlgImage, parseAlg } from "../data/alg";
import type { AldHero } from "../data/ald";
import type { DatRoomUpdate, DrasculaDat } from "../data/dat";
import { inventorySlotAt } from "../engine/actions";
import { CHARACTER_HEIGHT, CHARACTER_WIDTH, type GameState, INVENTORY_SIZE, OBJ_HEIGHT, OBJ_WIDTH, Track } from "../engine/state";
import { factorAt } from "../engine/perspective";
import { DIALOG_FONT_SHEET, FONT_SHEET, GameFont, centerText, type DialogState } from "./font";
import { COMPLETE_PAL, GamePalette, HALF_PAL, TextColor } from "./palette";
import { HEIGHT, Plane, WIDTH } from "./plane";

/**
 * Rendu de *Drascula* : surfaces, composition de l'image, interface. Réécriture de `moveCursor`, `updateRoom`,
 * `updateRefresh_pre`, `updateRefresh`, `moveCharacters` (partie dessin), `reduce_hare_chico`, `showMenu`, `clearMenu`,
 * `checkMenuFlags`, `enterRoom` (partie images et palettes), `loadPic` et le début de `run()` (engines/drascula/drascula.cpp,
 * graphics.cpp, rooms.cpp, actors.cpp, interface.cpp, objects.cpp, ScummVM).
 *
 * Le rendu ne connaît ni la boucle ni les séquences : il compose une image (`compose`) à partir de l'état du jeu
 * (`GameState`), de la souris et de la réplique en cours. Les « surfaces » de ScummVM gardent leurs rôles et leurs noms
 * (`bg`, `draw2`, `draw3`, `front`, `back`, `extra`, `table`, `cursor`) : les pièces (vague P) en rechargent certaines
 * (`tlef2.alg` dans `front`…) avec `loadPic`, comme `loadPic(..., surface)` de l'original.
 *
 * Rôles des surfaces : `bg` le décor de la pièce (`n.ALG`, `HALF_PAL`) ; `draw3` la feuille annexe de la pièce (`AUXn.ALG`) dont
 * viennent les rectangles de `roomPreUpdates` / `roomUpdates` ; `draw2` la feuille du chapitre (`pts.alg`, `auxdr.alg`) ; `front`,
 * `back`, `extra` le héros de face (`96.ALG`), de dos (`99.ALG`) et de côté (`97.ALG`) ; `table` la police (`95.ALG`) ; `cursor` les
 * icônes des verbes (`99.ALG`).
 *
 * Écarts : (1) l'image est recomposée en entier à chaque fois, depuis l'état ; ScummVM dessine par couches pendant les boucles
 * bloquantes, ce qui revient au même à l'écran ; (2) le curseur est dessiné dans l'image (curseur logiciel, 40 x 25, point chaud
 * 20, 17) et non par le système ; il se déduit de l'état (verbe, objet) à chaque image, au lieu d'être copié à chaque choix ;
 * (3) l'inventaire et le curseur d'objet lisent la feuille d'icônes du chapitre (`icons.alg`…), sans la recharger dans `back` /
 * `cursor` à chaque ouverture : la couleur 0 de la palette n'est donc pas réécrite ; (4) les têtes qui parlent (vague T) sont des vues (`heads.ts`) ; (5) les
 * mises à jour propres à une pièce (`update_N`, `update_N_pre`) sont des points d'accroche (`painters`), vides ici (vague P).
 *
 * **Prise de main des séquences sur l'image** (vagues T et C, `graphics.md` § 11). ScummVM laisse chaque séquence dessiner dans
 * `screenSurface` et appeler `updateScreen` ; ici l'image est recomposée à chaque `render()`, et une séquence agit sur elle par trois
 * points, dont le moteur ne sort jamais :
 *  1. **`owner`** : qui fournit le fond. `"room"` (par défaut) : la pièce, recomposée depuis l'état. `"canvas"` : l'image libre
 *     `canvas`, que la séquence remplit (`loadPic` d'un écran, images des `.BIN`, `clearRoom`) ; c'est l'écran « matériel » de ScummVM
 *     que `playFLI` et `animate` écrivent directement. `enterRoom` rend la main à la pièce.
 *  2. **`talk`** (`TalkView`) : pendant une réplique, une « vue » remplace la composition ordinaire de la pièce et la refait dans
 *     l'ordre de la fonction `talk_*` de ScummVM, grâce à une `Scene` qui offre les étapes de `updateRoom` (`background`, `pre`,
 *     `hero`, `post`) : la tête qui parle se glisse où l'original la dessine. Sans vue, la composition est celle de `updateRoom`.
 *  3. **`choices`** : le menu des choix de dialogue (`converse`), dessiné par-dessus l'image.
 * Le sous-titre, le nom survolé, l'inventaire, la barre des verbes et le curseur restent dessinés par `compose` après la vue.
 */

export const CURSOR_HOTSPOT = { x: 20, y: 17 } as const;
/** Ordonnée des icônes de verbes dans `99.ALG` (`selectVerb`, `c = 171` hors de l'inventaire). */
const VERB_ICONS_Y = 171;
/** Hauteur de la barre des verbes (survol : `_mouseY < 24`) et ordonnée où ses icônes sont dessinées. */
const VERB_BAR_ICON_Y = 2;
/** Sources des surfaces du héros hors chapitre 2 : de face `96.ALG`, de dos `99.ALG`, de côté `97.ALG`. */
const HERO_FRONT = 96;
const HERO_BACK = 99;
const HERO_SIDE = 97;
/** `DIF_MASK_HARE` : ordonnée des images du héros qui regarde à droite, de face et de dos (celles de gauche sont en 0). */
const HERO_ROW_Y = 72;

/** Feuille d'icônes (inventaire, objets en main) du chapitre : `objects.cpp`, `drascula.cpp`. */
export function iconsSheet(chapter: number): string {
  if (chapter === 4) return "icons2.alg";
  if (chapter === 5) return "icons3.alg";
  if (chapter === 6) return "iconsp.alg";
  return "icons.alg";
}

/** Point d'accroche d'une pièce (`update_N_pre` avant le héros, `update_N` après) : vague P. */
export interface RoomPainter {
  pre?: (renderer: DrasculaRenderer, state: GameState) => void;
  post?: (renderer: DrasculaRenderer, state: GameState) => void;
}

/** Qui fournit le fond de l'image : la pièce, recomposée depuis l'état, ou l'image libre d'une séquence. */
export type ScreenOwner = "room" | "canvas";

/**
 * Les étapes de `updateRoom` offertes à une vue de réplique, dans l'ordre de ScummVM. Chacune dessine dans `gfx.screen` ; sans pièce
 * chargée (cinématiques d'avant le premier `enterRoom`), `pre`, `hero` et `post` ne font rien.
 */
export interface Scene {
  readonly gfx: DrasculaRenderer;
  readonly state: GameState;
  /** `copyBackground()` : le décor `bg` entier. */
  background(): void;
  /** `updateRefresh_pre` : `roomPreUpdates`, puis l'accroche de la pièce. */
  pre(): void;
  /** `moveCharacters` (partie dessin) : le héros. */
  hero(): void;
  /** `updateRefresh` : `roomUpdates`, puis accroche de la pièce. */
  post(): void;
}

/** Tirage d'un tour de réplique (le visage est tiré au sort à chaque tour, `_rnd->getRandomNumber`). */
export interface Roll {
  /** Visage tiré au sort (0 à n - 1). */
  face: number;
  /** Second tirage (`talk_htel` choisit aussi la feuille) ; 0 sinon. */
  extra: number;
  /** Numéro du tour, à partir de 0 (`talk_drascula_big` et `talk_blind` s'en servent). */
  step: number;
}

/** Vue d'une réplique (`talk_*` de ScummVM) : compose l'image du tour `roll`. Voir `render/heads.ts`. */
export interface TalkView {
  draw(scene: Scene, roll: Roll): void;
}

/** Choix de dialogue à l'écran (`converse`) : les quatre répliques, leur état, celle qui est survolée (-1 : aucune). */
export interface ChoiceMenu {
  phrases: readonly string[];
  states: readonly DialogState[];
  hovered: number;
}

/** Ce que la composition lit de l'état du moteur. */
export interface FrameInput {
  state: GameState;
  mouseX: number;
  mouseY: number;
  /** Réplique affichée : texte et point de référence (`centerText`), couleur facultative (`color_abc`). */
  subtitle: { text: string; x: number; y: number; color?: number } | null;
  /**
   * Boucle principale (`moveCursor`) : nom de l'objet survolé, inventaire, barre des verbes. Faux pendant une séquence : seuls la
   * pièce, le héros et la réplique sont dessinés (les boucles d'attente de ScummVM appellent `updateRoom`, pas `moveCursor`).
   */
  main: boolean;
  cursorVisible: boolean;
  /** Réplique en cours avec une tête qui parle (`talk_*`) : la vue et le visage tiré. */
  talk?: { view: TalkView; roll: Roll } | null;
  /** Choix de dialogue affichés. */
  choices?: ChoiceMenu | null;
}

export class DrasculaRenderer {
  /** `screenSurface` : l'image envoyée à l'écran. */
  readonly screen = new Plane();
  readonly bg = new Plane();
  readonly draw2 = new Plane();
  readonly draw3 = new Plane();
  readonly front = new Plane();
  readonly back = new Plane();
  readonly extra = new Plane();
  readonly table = new Plane();
  readonly cursor = new Plane();
  /** Image libre d'une séquence (`owner === "canvas"`) : l'écran « matériel » de ScummVM, écrit par `playFLI`, `animate`, `clearRoom`. */
  readonly canvas = new Plane();
  /** Le décor avant les personnages, gardé le temps d'une réplique du héros pour effacer sa tête (le tampon `drawSurface3` de `talk`). */
  readonly backdrop = new Plane();
  /** Qui fournit le fond de l'image (voir l'en-tête). */
  owner: ScreenOwner = "room";
  /**
   * Les mises à jour propres à la pièce (`roomPreUpdates`, `roomUpdates`, accroches) sont dessinées. `animation_9_6` donne à la pièce un
   * numéro inexistant pour les faire disparaître (`_roomNumber = -2`) : ici c'est cet indicateur, rétabli par `enterRoom`.
   */
  roomSprites = true;
  readonly palette = new GamePalette();
  readonly font: GameFont;
  /** Mises à jour propres aux pièces (vague P), par chapitre puis par numéro de pièce. */
  readonly painters: Partial<Record<number, Partial<Record<number, RoomPainter>>>> = {};
  /**
   * Tremblement vertical de l'écran (`hiccup` : `updateScreen(0, 1, 0, y, 320, 198)`, ou `(0, 0, 0, y, 320, 200)` au chapitre 3) :
   * l'image finie est décalée de `y` lignes. `null` : image à sa place.
   */
  shake: { y: number; fromRow: number; rows: number } | null = null;

  private readonly images = new Map<string, AlgImage>();

  constructor(
    private readonly readFile: (name: string) => Uint8Array,
    readonly dat: DrasculaDat,
    /** Nom que porte le héros sous le curseur (`textmisc[3]`) : il s'affiche en rouge. */
    private readonly heroName: string,
    /** Nom des verbes de l'inventaire (`textverbs`) : `iconName[1..6]`. */
    private readonly verbNames: readonly string[],
  ) {
    this.font = new GameFont(dat.charMaps);
  }

  // --- Images -------------------------------------------------------------------------------------------------------------

  /** Image décodée d'un fichier `.ALG` (mise en cache ; ne pas modifier ses pixels). */
  image(name: string | number): AlgImage {
    const file = typeof name === "number" ? `${name}.alg` : name;
    const key = file.toUpperCase();
    let image = this.images.get(key);
    if (!image) this.images.set(key, (image = parseAlg(this.readFile(file))));
    return image;
  }

  /** Une image en lecture seule vue comme un plan. */
  sheet(name: string | number): Plane {
    return new Plane(this.image(name).pixels);
  }

  /**
   * `loadPic(name, surface, colorCount)` : charge l'image dans la surface et applique à la palette du jeu ses `colorCount`
   * premières couleurs : `COMPLETE_PAL` 256, `HALF_PAL` 128 ; sans nombre de couleurs (défaut de ScummVM : 1), seule la couleur 0.
   */
  loadPic(name: string | number, target: Plane, colorCount = 1): void {
    const image = this.image(name);
    target.load(image.pixels);
    this.palette.setRgb(image.palette, colorCount);
  }

  // --- Chapitres et pièces --------------------------------------------------------------------------------------------------

  /**
   * Images de départ d'un chapitre (début de `run()`) : héros de face `96.ALG` avec la palette complète (au chapitre 3, le décor
   * `aux13.alg` la donne), icônes `99.ALG`, police `95.ALG`, feuilles propres au chapitre. Hors chapitre 2, les trois surfaces du
   * héros sont chargées ici ; au chapitre 2 chaque pièce a les siennes (`enterRoom`). La cinématique `animation_castle` du
   * chapitre 4 (vague C) passe avant le chargement de `96.ALG` dans ScummVM : ici l'ordre est sans effet sur l'image finale.
   */
  startChapter(chapter: number): void {
    if (chapter !== 3) this.loadPic(HERO_FRONT, this.front, COMPLETE_PAL);
    this.loadPic(HERO_BACK, this.cursor);
    if (chapter === 2) {
      this.loadPic("pts.alg", this.draw2);
    } else if (chapter === 3) {
      this.loadPic("aux13.alg", this.bg, COMPLETE_PAL);
      this.loadPic(HERO_FRONT, this.front);
    } else if (chapter === 4) {
      this.loadPic(HERO_FRONT, this.front);
      this.screen.clear();
    }
    this.loadPic(FONT_SHEET, this.table);
    if (chapter !== 2) {
      this.loadPic(HERO_BACK, this.back);
      this.loadPic(HERO_SIDE, this.extra);
    }
    this.palette.saveDefault();
  }

  /**
   * Images et lumière d'une pièce (partie de `enterRoom` qui touche aux images) : au chapitre 2, les quatre images du héros de la
   * pièce (ou `97`, `96`, `99` par défaut) ; puis la feuille annexe (`draw3`), le décor en `HALF_PAL`, l'icône des 40 x 25 pixels
   * du bas de `back` recopiée en haut de `draw3`, et les trois palettes de lumière.
   */
  enterRoom(room: { number: number; disk: string; paletteLevel: number; hero: AldHero | null }, chapter: number): void {
    if (chapter === 2) {
      if (room.hero) {
        const [front, extra, , back] = room.hero.surfaces;
        this.loadPic(front, this.front);
        this.loadPic(extra, this.extra);
        this.loadPic(back, this.back);
      } else {
        this.loadPic(HERO_SIDE, this.extra);
        this.loadPic(HERO_FRONT, this.front);
        this.loadPic(HERO_BACK, this.back);
      }
    }
    this.owner = "room";
    this.roomSprites = true;
    this.loadPic(room.disk, this.draw3);
    this.loadPic(room.number, this.bg, HALF_PAL);
    this.draw3.copyBackground(this.back, 0, VERB_ICONS_Y, 0, 0, OBJ_WIDTH, OBJ_HEIGHT);
    this.palette.setRoomLevel(room.paletteLevel);
    if (chapter === 2) this.palette.setTextColor(TextColor.LightGreen);
  }

  /** Fin d'un chapitre (`endChapter`) : écran noir, palette noire (sauf la couleur du texte). */
  endChapter(): void {
    this.screen.clear();
    this.clearRoom();
    this.palette.black();
  }

  // --- Composition --------------------------------------------------------------------------------------------------------

  /** Une image complète dans `screen` ; la palette affichée est `palette.shown`. */
  compose(input: FrameInput): void {
    const { state } = input;
    const screen = this.screen;
    const room = this.owner === "room";
    if (room) {
      const scene = this.scene(state);
      if (input.talk) input.talk.view.draw(scene, input.talk.roll);
      else {
        scene.background();
        scene.pre();
        scene.hero();
        scene.post();
      }
    } else {
      screen.copyBackground(this.canvas, 0, 0, 0, 0, 320, 200);
      if (input.talk) input.talk.view.draw(this.scene(state), input.talk.roll);
    }
    if (input.choices) this.drawChoices(input.choices);
    if (input.subtitle) {
      const { text, x, y, color } = input.subtitle;
      if (color !== undefined) this.palette.setTextColor(color);
      centerText(this.font, screen, this.table, text, x, y);
    } else if (input.main && room) {
      this.drawName(input);
      if (state.menuScreen) this.drawInventory(input);
      else if (state.menuBar) this.drawVerbBar(input.mouseX);
    }
    if (input.cursorVisible && room) this.drawCursor(input);
    if (this.shake) {
      // `updateScreen` copie `rows` lignes de l'image à partir de `fromRow` vers la ligne `y` ; le reste de l'écran garde son contenu.
      const { y, fromRow, rows } = this.shake;
      const dest = Math.max(y, 0);
      const source = fromRow + Math.max(-y, 0);
      const count = Math.min(rows - Math.max(-y, 0), HEIGHT - dest);
      if (count > 0) screen.pixels.copyWithin(dest * WIDTH, source * WIDTH, (source + count) * WIDTH);
    }
  }

  /** Les étapes de `updateRoom` pour la pièce de `state` (voir `Scene`). */
  scene(state: GameState): Scene {
    const room = state.room;
    return {
      gfx: this,
      state,
      background: () => this.screen.copyBackground(this.bg, 0, 0, 0, 0, 320, 200),
      pre: () => {
        if (!room || !this.roomSprites) return;
        // `updateRefresh_pre` : les mises à jour de la table d'abord, puis celle de la pièce (`update_N_pre`).
        this.applyUpdates(this.dat.roomPreUpdates, room.number, state.flags);
        this.painters[state.chapter]?.[room.number]?.pre?.(this, state);
      },
      hero: () => this.drawHero(state),
      post: () => {
        if (!room || !this.roomSprites) return;
        this.applyUpdates(this.dat.roomUpdates, room.number, state.flags);
        this.painters[state.chapter]?.[room.number]?.post?.(this, state);
      },
    };
  }

  /** `clearRoom` : l'écran « matériel » est vidé (`fillScreen(0)`) et la séquence en a la main. */
  clearRoom(): void {
    this.canvas.clear();
    this.owner = "canvas";
  }

  /**
   * Choix de dialogue (`converse`) : les quatre répliques l'une sous l'autre à partir de y = 2, chacune dans son état, puis celle qui
   * est survolée par-dessus en état « survolé ». Les glyphes sont ceux de `CAR.ALG` (feuille à part, `backSurface` n'est pas touchée).
   */
  private drawChoices(menu: ChoiceMenu): void {
    const sheet = this.sheet(DIALOG_FONT_SHEET);
    let y = 2;
    const tops: number[] = [];
    menu.phrases.forEach((phrase, i) => {
      tops.push(y);
      y += 8 * this.font.printChoice(this.screen, sheet, phrase, y, menu.states[i] ?? "unselected");
    });
    if (menu.hovered >= 0 && menu.hovered < menu.phrases.length) this.font.printChoice(this.screen, sheet, menu.phrases[menu.hovered], tops[menu.hovered], "selected");
  }

  /** `roomPreUpdates` (avant le héros) et `roomUpdates` (après) : rectangles de `draw3` recopiés selon un drapeau. */
  private applyUpdates(updates: readonly DatRoomUpdate[], room: number, flags: readonly number[]): void {
    for (const update of updates) {
      if (update.room !== room || !(update.flag < 0 || flags[update.flag] === update.flagValue)) continue;
      if (update.type === 0) this.screen.copyBackground(this.draw3, update.sourceX, update.sourceY, update.destX, update.destY, update.width, update.height);
      else this.screen.copyRect(this.draw3, update.sourceX, update.sourceY, update.destX, update.destY, update.width, update.height);
    }
  }

  /**
   * Le héros (`moveCharacters`, partie dessin). Hors chapitre 2, l'image de 43 x 70 est réduite par le facteur de la perspective à
   * l'ordonnée des pieds ; au chapitre 2 elle est copiée à la taille de la pièce. Debout : première image de la rangée ; en marche :
   * colonne `frameX[image]`. Invisible (hors chapitres 2 et 3) : rien. Chapitre 3 avec le drapeau 0 : l'image fixe de `draw3`.
   */
  private drawHero(state: GameState): void {
    const { hero, chapter, room } = state;
    if (!room) return;
    if (chapter === 3 && state.flags[0] !== 0) {
      // `updateRoom` : l'image fixe de `draw3`. L'original n'envoie à l'écran que ce que `updateScreen` rafraîchit : `anim.poseFrom` est
      // la première colonne rafraîchie (la croix du vampire, `animation_2_3`) ; à sa gauche l'écran garde ce que les animations y ont mis.
      const x = hero.x - 20;
      const cut = Math.max(0, (state.anim.poseFrom ?? 0) - x);
      if (cut < 77) this.screen.copyRect(this.draw3, 113 + cut, 54, x + cut, hero.y - 1, 77 - cut, 89);
      return;
    }
    if (chapter !== 2 && chapter !== 3 && !hero.visible) return;
    const sourceX = hero.moving ? (this.dat.frameX[hero.frame] ?? 0) : 0;
    const sourceY = hero.track === Track.Left ? 0 : HERO_ROW_Y;
    const sheet = hero.track === Track.Up ? this.back : hero.track === Track.Down ? this.front : this.extra;
    if (chapter === 2) {
      this.screen.copyRect(sheet, sourceX, sourceY, hero.x, hero.y, hero.width, hero.height);
    } else {
      const factor = room.factors ? factorAt(room.factors, hero.y + hero.height) : 100;
      this.screen.reduce(sheet, sourceX, sourceY, hero.x, hero.y, CHARACTER_WIDTH, CHARACTER_HEIGHT, factor);
    }
  }

  /**
   * Nom de l'objet sous le curseur (`moveCursor`) : rouge pour le héros, vert clair sinon, centré sur la souris. La couleur est
   * posée à chaque image de la boucle principale, hors de l'inventaire (ScummVM ne la change que si elle diffère).
   */
  private drawName(input: FrameInput): void {
    const { state } = input;
    if (state.hasName && state.textName === this.heroName) {
      if (!state.menuScreen) this.palette.setTextColor(TextColor.Red);
    } else if (!state.menuScreen && this.palette.textColor !== TextColor.LightGreen) {
      this.palette.setTextColor(TextColor.LightGreen);
    }
    if (state.hasName && !state.menuScreen) centerText(this.font, this.screen, this.table, state.textName, input.mouseX, input.mouseY);
  }

  /**
   * Écran d'inventaire (`showMenu`) : pour chaque case, le fond de la case (`x_pol`, `y_pol`, dans `96.ALG`, sauf au chapitre 6 :
   * `95.ALG`) quand elle est occupée, puis l'icône de l'objet (les cases 1 à 6 portent les verbes). Le nom du verbe survolé
   * s'écrit au-dessus de sa case.
   */
  private drawInventory(input: FrameInput): void {
    const { state } = input;
    const icons = this.sheet(iconsSheet(state.chapter));
    const background = state.chapter === 6 ? this.table : this.front;
    const { itemLocations, inventoryCells, menuPoints } = this.dat;
    for (let slot = 1; slot < INVENTORY_SIZE; slot++) {
      const object = state.inventory[slot];
      const at = itemLocations[slot];
      const cell = inventoryCells[slot];
      if (!at) continue;
      if (object !== 0 && cell) this.screen.copyBackground(background, cell.x, cell.y, at.x, at.y, OBJ_WIDTH, OBJ_HEIGHT);
      const icon = menuPoints[object];
      if (icon) this.screen.copyRect(icons, icon.x, icon.y, at.x, at.y, OBJ_WIDTH, OBJ_HEIGHT);
    }
    const hovered = inventorySlotAt(itemLocations, input.mouseX, input.mouseY);
    if (hovered >= 1 && hovered < 7) {
      const at = itemLocations[hovered];
      this.font.print(this.screen, this.table, this.verbNames[hovered - 1] ?? "", at.x - 2, at.y - 7);
    }
  }

  /** Barre des verbes (`clearMenu`) : sept icônes de `cursor`, celle sous la souris à la rangée 0, les autres à la rangée 25. */
  private drawVerbBar(mouseX: number): void {
    const bar = this.dat.verbBarX;
    for (let n = 0; n < 7; n++) {
      const hovered = mouseX > bar[n] && mouseX < bar[n + 1];
      this.screen.copyRect(this.cursor, OBJ_WIDTH * n, hovered ? 0 : OBJ_HEIGHT, bar[n], VERB_BAR_ICON_Y, OBJ_WIDTH, OBJ_HEIGHT);
    }
  }

  /**
   * Curseur de la souris : l'icône du verbe (colonne `40 x verbe`) ou de l'objet en main, sinon l'icône « aucun verbe ». Dans
   * l'inventaire les icônes de verbes sont à la rangée 0 de la feuille d'icônes, ailleurs à l'ordonnée 171 de `99.ALG`.
   */
  private drawCursor(input: FrameInput): void {
    const { state } = input;
    const x = input.mouseX - CURSOR_HOTSPOT.x;
    const y = input.mouseY - CURSOR_HOTSPOT.y;
    if (state.takeObject && state.pickedObject >= 7) {
      const icon = this.dat.menuPoints[state.pickedObject];
      if (icon) this.screen.copyRect(this.sheet(iconsSheet(state.chapter)), icon.x, icon.y, x, y, OBJ_WIDTH, OBJ_HEIGHT);
      return;
    }
    const verb = state.takeObject ? state.pickedObject : 0;
    const sheet = state.menuScreen ? this.sheet(iconsSheet(state.chapter)) : this.cursor;
    this.screen.copyRect(sheet, OBJ_WIDTH * verb, state.menuScreen ? 0 : VERB_ICONS_Y, x, y, OBJ_WIDTH, OBJ_HEIGHT);
  }
}
