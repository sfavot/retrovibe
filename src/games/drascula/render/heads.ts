import { factorAt } from "../engine/perspective";
import { drawVonBraun, placeDrascula, placeIgor } from "./actors";
import type { Roll, Scene, TalkView } from "./renderer";

/**
 * Têtes qui parlent : l'image d'une réplique pour chaque personnage. Réécriture du corps des boucles de `talk`, `talk_sync`,
 * `talk_igor`, `talk_drascula`, `talk_drascula_big`, `talk_bartender`, `talk_bj`, `talk_bj_bed`, `talk_pianist`, `talk_drunk`,
 * `talk_vonBraun`, `talk_blind`, `talk_hacker`, `talk_werewolf`, `talk_mus`, `talk_pen`, `talk_htel`, `grr` et `talk_generic`
 * (engines/drascula/talk.cpp, ScummVM). Chaque vue refait l'image **dans l'ordre de l'original** avec les étapes de `Scene`
 * (`background` = `copyBackground()`, `pre` = `updateRefresh_pre`, `hero` = `moveCharacters`, `post` = `updateRefresh`), entre lesquelles
 * elle recopie le rectangle de la bouche : une vue qui n'appelle pas `hero` laisse le héros hors de l'image, comme l'original.
 *
 * Le visage (`roll.face`) est tiré par le moteur à chaque tour de la réplique (`_rnd->getRandomNumber`), comme l'original ; `roll.step`
 * est le numéro du tour (0 au premier). Les voix, les textes, les couleurs et la place du sous-titre sont dans `engine/talkers.ts`.
 *
 * Écarts : (1) le héros efface sa tête dans `renderer.backdrop` (le décor avant les personnages), et non dans `drawSurface3` dont
 * `talk` écrase un coin (41, 0) ; (2) au chapitre 2, ScummVM ne remet le décor sous la tête que si l'image des icônes est `99.alg`
 * ou `994.alg` : c'est toujours le cas ici ; (3) un personnage dont l'original ne redessine rien à ce tour (Von Braun tourné vers la
 * gauche) laisse la composition ordinaire de la pièce.
 */

type HeadView = (scene: Scene, roll: Roll) => void;

/** Vue sur mesure à partir d'une fonction de dessin. */
function view(draw: HeadView): TalkView {
  return { draw };
}

const f32 = Math.fround;
/** `(int)((n / 100.0f) * factor)` en `float` 32 bits. */
const percent = (n: number, factor: number): number => Math.trunc(f32(f32(f32(n) / 100) * factor));

// --- Le héros --------------------------------------------------------------------------------------------------------------

const TALK_WIDTH = 23;
const TALK_HEIGHT = 25;
/** Ordonnée des visages du héros dans les feuilles `extra` et `front` (`y_mask_talk`). */
const HERO_MASK_Y = 170;
/** Colonnes des visages du héros tourné vers la droite (`x_talk_dch`) et vers la gauche (`x_talk_izq`). */
const X_TALK_RIGHT = [1, 25, 49, 73, 97, 121];
const X_TALK_LEFT = [145, 169, 193, 217, 241, 265];

export interface HeroHeadOptions {
  /** `talk_sync` : sans la sécurité de la tour du château, sans borne à 201 ; au chapitre 2, rien si la hauteur est 56. */
  sync?: boolean;
}

/**
 * La réplique du héros (`talk`, `talk_sync`) : le héros est dessiné, sa tête est remplacée par le décor, puis par le visage tiré au
 * sort dans la feuille `extra` (profil) ou `front` (de face ou de dos) selon son orientation, réduit comme le héros hors chapitre 2.
 * Les décalages de la tête (8 ou 12 pixels, `talkOffset`) suivent l'orientation et le facteur de réduction.
 */
export function heroHead(options: HeroHeadOptions = {}): TalkView {
  return view((scene, { face }) => {
    const { gfx, state } = scene;
    const { hero, chapter, room } = state;
    const screen = gfx.screen;
    const factors = room?.factors ?? null;
    const feet = hero.y + hero.height;
    // `talk` borne l'ordonnée à 201 pour la taille, `talk_sync` non ; `talkOffset` lit le tableau sans borne dans les deux.
    const factor = factors ? (options.sync ? (factors[feet] ?? 100) : factorAt(factors, feet)) : 100;
    const raw = factors ? (factors[feet] ?? 100) : 100;
    const reduced = chapter !== 2;
    // Décalage de la tête de face : 1 pixel, 0 quand le héros est à sa taille réelle (facteur 100). `talk_sync` ne le teste qu'au chapitre 1.
    let talkOffset = reduced ? 1 : 0;
    if (reduced && raw === 100 && (!options.sync || chapter === 1)) talkOffset = 0;
    const towers = !options.sync && chapter === 5 && room?.number === 45;

    scene.background();
    scene.pre();
    // Le haut du héros est gardé tel que le décor l'a laissé, avant que le héros ne soit dessiné par-dessus, puis remis par-dessus lui.
    const headW = reduced ? Math.trunc(f32(f32(hero.width / 100) * factor)) : hero.width;
    const headH = reduced ? Math.trunc(f32(f32((TALK_HEIGHT - 1) / 100) * factor)) : TALK_HEIGHT - 1;
    gfx.backdrop.copyBackground(screen, hero.x, hero.y, 41, 0, headW, headH);
    scene.hero();
    if (!(!reduced && options.sync && hero.height === 56)) screen.copyBackground(gfx.backdrop, 41, 0, hero.x, hero.y, headW, headH);

    const track = hero.track;
    const sheet = track < 2 ? gfx.extra : gfx.front;
    const column = track === 0 || track === 2 ? X_TALK_LEFT[face] : X_TALK_RIGHT[face];
    const base = track === 0 || track === 3 ? 8 : 12;
    if (!reduced) {
      screen.copyRect(sheet, column, HERO_MASK_Y, hero.x + base, track === 0 ? hero.y - 1 : hero.y, TALK_WIDTH, TALK_HEIGHT);
    } else if (!towers) {
      const x = (track >= 2 ? talkOffset : 0) + hero.x + percent(base, factor);
      screen.reduce(sheet, column, HERO_MASK_Y, x, hero.y, TALK_WIDTH, TALK_HEIGHT, factor);
    }
    scene.post();
  });
}

// --- Igor ------------------------------------------------------------------------------------------------------------------

/** `IgorTalkerTypes`. */
export const IgorType = { Right: 0, Front: 1, Door: 2, Seated: 3, Wig: 4 } as const;
const IGOR_RIGHT_X = [56, 82, 108, 134, 160, 186, 212, 238];
const IGOR_FRONT_X = [56, 86, 116, 146, 176, 206, 236, 266];
const IGOR_SEATED_X = [80, 102, 124, 146];
const IGOR_WIG_X = [119, 158, 197, 236];

/** Nombre de visages d'Igor selon son type (`getRandomNumber(7)` ou `(3)`). */
export function igorFaces(type: number): number {
  return type === IgorType.Seated || type === IgorType.Wig ? 4 : 8;
}

/** `talk_igor` : Igor de profil (le visage remplace sa tête), de face, à la porte (pièce seule), assis ou avec la perruque. */
export function igorHead(type: number): TalkView {
  return view((scene, { face }) => {
    const { gfx, state } = scene;
    const { igor, chapter } = state;
    const screen = gfx.screen;
    if (type === IgorType.Right) {
      scene.background();
      scene.pre();
      placeIgor(gfx, state);
      placeDrascula(gfx, state);
      screen.copyBackground(gfx.bg, igor.x + 17, igor.y, igor.x + 17, igor.y, 37, 24);
      screen.copyRect(gfx.front, IGOR_RIGHT_X[face], 148, igor.x + 17, igor.y, 25, 24);
      scene.post();
    } else if (type === IgorType.Front) {
      scene.background();
      scene.pre();
      if (chapter === 1 || chapter === 4) placeIgor(gfx, state);
      if (chapter === 1) placeDrascula(gfx, state);
      if (chapter === 1 || chapter === 6) screen.copyBackground(gfx.bg, igor.x, igor.y, igor.x, igor.y, 29, 25);
      screen.copyRect(gfx.front, IGOR_FRONT_X[face], 173, igor.x, igor.y, 29, 25);
      scene.post();
    } else if (type === IgorType.Door) {
      scene.background();
      scene.pre();
      scene.hero();
      scene.post();
    } else {
      scene.background();
      scene.pre();
      if (type === IgorType.Seated) screen.copyBackground(gfx.draw3, IGOR_SEATED_X[face], 109, 207, 92, 21, 23);
      else screen.copyBackground(gfx.draw3, IGOR_WIG_X[face], 78, 199, 94, 38, 27);
      scene.hero();
      scene.post();
    }
  });
}

// --- Drascula --------------------------------------------------------------------------------------------------------------

const DRASCULA_X = [1, 40, 79, 118, 157, 196, 235, 274];

/** `talk_drascula` : `right` = 0 pour `talk_dr_izq` (visage à gauche), 1 pour `talk_dr_dch`. */
export function drasculaHead(side: 0 | 1): TalkView {
  return view((scene, { face }) => {
    const { gfx, state } = scene;
    const { drascula, chapter } = state;
    const offset = side === 0 ? 0 : 7;
    const offset2 = side === 0 ? 90 : 58;
    scene.background();
    scene.pre();
    placeIgor(gfx, state);
    placeDrascula(gfx, state);
    if (chapter === 6) scene.hero();
    gfx.screen.copyBackground(gfx.bg, drascula.x, drascula.y, drascula.x, drascula.y, 38 + offset, 31);
    gfx.screen.copyRect(chapter === 6 ? gfx.draw2 : gfx.back, DRASCULA_X[face], offset2, drascula.x + offset, drascula.y, 38, 31);
    scene.post();
  });
}

const INTERFACE_X = [1, 65, 129, 193, 1, 65, 129];
const INTERFACE_Y = [51, 51, 51, 51, 83, 83, 83];
/** Colonne des quatre visages du grand Drascula. */
const DRASCULA_BIG_X = [47, 93, 139, 185];

/**
 * `talk_drascula_big` : Drascula en gros plan (introduction). Le décor, puis l'écran à sept images qui défile à gauche (`interf_x`,
 * `interf_y`, une image par tour) et le visage tiré au sort.
 */
export const drasculaBigHead: TalkView = view((scene, { face, step }) => {
  const { gfx } = scene;
  const l = step % 7;
  scene.background();
  gfx.screen.copyBackground(gfx.draw2, INTERFACE_X[l] + 24, INTERFACE_Y[l], 0, 45, 39, 31);
  gfx.screen.copyBackground(gfx.draw2, DRASCULA_BIG_X[face], 1, 171, 68, 45, 48);
});

/** Colonnes des 4 visages du grand Drascula (pour le nombre de visages). */
export const DRASCULA_BIG_FACES = DRASCULA_BIG_X.length;

// --- Autres personnages ----------------------------------------------------------------------------------------------------

const BARTENDER_X = [1, 23, 45, 67, 89, 111, 133, 155, 177];

/** `talk_bartender` : type 0, le barman de la taverne (feuille `extra`, 9 visages) ; type 1, derrière le comptoir (`draw3`, 6 visages). */
export function bartenderHead(type: 0 | 1): TalkView {
  return view((scene, { face }) => {
    const { gfx } = scene;
    scene.background();
    scene.pre();
    if (type === 0) gfx.screen.copyBackground(gfx.extra, BARTENDER_X[face], 2, 121, 44, 21, 24);
    else gfx.screen.copyBackground(gfx.draw3, BARTENDER_X[face], 130, 151, 43, 21, 24);
    scene.hero();
    scene.post();
  });
}

const BJ_X = [64, 92, 120, 148, 176];

/** `talk_bj` : B.J. (5 visages) ; au chapitre 5, la pièce seule (sa tête n'est pas dessinée). */
export const bjHead: TalkView = view((scene, { face }) => {
  const { gfx, state } = scene;
  scene.background();
  scene.pre();
  if (state.chapter !== 5) {
    gfx.screen.copyBackground(gfx.bg, 172, 89, 172, 89, 27, 40);
    gfx.screen.copyRect(gfx.draw3, BJ_X[face], 99, 172, 89, 27, 40);
  }
  scene.hero();
  scene.post();
});

const BJ_BED_X = [51, 101, 151, 201, 251];

/** `talk_bj_bed` : B.J. dans le lit. */
export const bjBedHead: TalkView = view((scene, { face }) => {
  const { gfx } = scene;
  scene.background();
  scene.pre();
  gfx.screen.copyBackground(gfx.bg, 65, 103, 65, 103, 49, 38);
  gfx.screen.copyRect(gfx.draw3, BJ_BED_X[face], 105, 65, 103, 49, 38);
  scene.hero();
  scene.post();
});

/**
 * `talk_generic` : un rectangle de visage recopié (opaque) depuis une feuille, entre la pièce avant et après le héros.
 * `x` : colonnes des visages ; `rect` : rangée source, destination (x, y), taille (largeur, hauteur) ; `sheet` : la feuille.
 */
export interface GenericHead {
  columns: readonly number[];
  sourceY: number;
  destX: number;
  destY: number;
  width: number;
  height: number;
  sheet: "extra" | "front" | "draw3" | "back";
}

export function genericHead(head: GenericHead): TalkView {
  return view((scene, { face }) => {
    const { gfx } = scene;
    scene.background();
    scene.pre();
    gfx.screen.copyBackground(gfx[head.sheet], head.columns[face], head.sourceY, head.destX, head.destY, head.width, head.height);
    scene.hero();
    scene.post();
  });
}

/** Le pianiste (`talk_pianist`), l'ivrogne (`talk_drunk`), le loup-garou (`talk_werewolf`) et le musicien (`talk_mus`). */
export const PIANIST_HEAD: GenericHead = { columns: [97, 145, 193, 241], sourceY: 139, destX: 228, destY: 112, width: 47, height: 60, sheet: "extra" };
export const DRUNK_HEAD: GenericHead = { columns: [1, 21, 41, 61, 81, 101, 121, 141], sourceY: 29, destX: 177, destY: 50, width: 19, height: 19, sheet: "front" };
export const WEREWOLF_HEAD: GenericHead = { columns: [52, 79, 106, 133, 160, 187, 214, 241, 268], sourceY: 136, destX: 198, destY: 81, width: 26, height: 24, sheet: "draw3" };
export const MUSICIAN_HEAD: GenericHead = { columns: [16, 35, 54, 73, 92, 111, 130, 149], sourceY: 156, destX: 190, destY: 64, width: 18, height: 24, sheet: "draw3" };

const VON_BRAUN_X = [1, 27, 53, 79, 105, 131];

/**
 * `talk_vonBraun` : Von Braun (6 visages) quand il regarde à droite ; à la porte (`door`), la pièce seule. Tourné vers la gauche, l'original
 * ne redessine rien : la composition ordinaire de la pièce reste (écart 3).
 */
export function vonBraunHead(door: boolean): TalkView {
  return view((scene, { face }) => {
    const { gfx, state } = scene;
    const vb = state.vonBraun;
    if (door || vb.track !== 1) {
      scene.background();
      scene.pre();
      scene.hero();
      scene.post();
      return;
    }
    scene.background();
    scene.hero();
    drawVonBraun(gfx, state);
    gfx.screen.copyBackground(gfx.bg, vb.x + 5, 64, vb.x + 5, 64, 25, 27);
    gfx.screen.copyRect(gfx.front, VON_BRAUN_X[face], 34, vb.x + 5, 64, 25, 27);
    scene.post();
  });
}

/** L'homme aveugle (`talk_blind`) : image de synchronisation lue dans `textd1`, un chiffre par tour ; `sync` est cette chaîne. */
export function blindHead(sync: string): TalkView {
  return view((scene, { step }) => {
    const { gfx } = scene;
    scene.background();
    const c = (sync[step] ?? "").toUpperCase();
    const bX = c === "0" || c === "2" || c === "4" || c === "6" ? 1 : 132;
    let height = 149;
    let sheet = gfx.draw3;
    if (c === "0" || c === "1") sheet = gfx.draw3;
    else if (c === "2" || c === "3") sheet = gfx.extra;
    else if (c === "4" || c === "5") sheet = gfx.back;
    else {
      height = 146;
      sheet = gfx.front;
    }
    gfx.screen.copyRect(sheet, bX, 2, 73, 1, 126, height);
  });
}

/** `talk_hacker` : le décor seul (le texte est écrit par-dessus). */
export const backgroundOnly: TalkView = view((scene) => scene.background());

const PENDULUM_X = [112, 138, 164, 190, 216, 242, 268, 294];
const PENDULUM_X2 = [122, 148, 174, 200, 226];

/**
 * `talk_pen` : le héros ligoté sous le pendule (chapitre 6). Type 0 : 8 visages à (145, 105), type 1 : 5 visages à (173, 116). La pièce
 * est dessinée sans le héros, puis le visage.
 */
export function pendulumHead(type: 0 | 1): TalkView {
  return view((scene, { face }) => {
    const { gfx } = scene;
    scene.background();
    scene.pre();
    scene.post();
    if (type === 0) gfx.screen.copyRect(gfx.draw3, PENDULUM_X[face], 145, 145, 105, 25, 29);
    else gfx.screen.copyBackground(gfx.draw3, PENDULUM_X2[face], 171, 173, 116, 25, 28);
  });
}

const PHONE_X = [1, 94, 187];

/** `talk_htel` : l'écran du téléphone ; `extra` choisit la feuille (0 : `draw3` si le visage est 0, sinon `back` ; 1 : `front`). */
export const phoneHead: TalkView = view((scene, { face, extra }) => {
  const { gfx } = scene;
  scene.background();
  const sheet = face === 0 && extra === 0 ? gfx.draw3 : extra === 1 ? gfx.front : gfx.back;
  gfx.screen.copyBackground(sheet, PHONE_X[face], 1, 45, 24, 92, 108);
});

/** `grr` : le grognement du chapitre 3, la bouche à (150, 65). */
export const growlHead: TalkView = view((scene) => {
  scene.background();
  scene.pre();
  scene.hero();
  scene.post();
  scene.gfx.screen.copyBackground(scene.gfx.draw3, 253, 110, 150, 65, 20, 30);
});

/** Le décor puis la pièce sans personnage (`talk_solo` au chapitre 6 : `copyBackground()` seul). */
export const roomWithoutHero: TalkView = view((scene) => scene.background());

