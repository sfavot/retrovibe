/**
 * Lecteur de « features » de Zoombinis : les objets animés qui jouent les scripts `SCRB` / `SCRS` (`docs/zoombinis/engine.md` §3).
 * Port de `11a0:033a` (interpréteur, un appel par feature et par tick), `11a8:0ad6` (création), `11a8:1be6` (changement de script),
 * `11a8:216f` (accès aléatoire), `11a8:14ab` / `11a8:15a6` (plages de scripts), `11a8:166e` (id de script → groupe) et `11a0:0000`
 * (groupes de formes). Un `SCRB` est une suite d'images, chacune étant la liste des parties à poser (`w` = indice 1-based dans la
 * planche `tBMP` du groupe, `(x, y)` en pixels d'écran) ; il n'y a pas d'opcode, le délai entre deux images est un paramètre de
 * l'objet (en ticks de 17 ms).
 *
 * Usage : `installFeatures(engine)` (après `installServices`) enregistre le service `FEATURES` et un crochet de tick. Une scène, dans
 * `enter`, donne l'archive (`setArchive`), le fond (`setBackground`), ses groupes (`defineGroup`), ses plages (`setScripts` /
 * `addScripts`) puis crée ses features (`create`) ; dans `leave`, elle appelle `clear()`. À chaque tick où une feature a joué une image,
 * l'écran entier est recomposé (fond, puis features par profondeur croissante) et la présentation est demandée : pas de rectangles
 * sales, donc tout ce qui doit rester visible doit être dans le fond ou dans une feature (rappel `onAfterDraw`).
 *
 * Écarts assumés avec l'original, voir aussi la fin de ce commentaire :
 * - ordre : l'original insère la feature après celle dont l'id est `param_1` (0 = devant tout) ; ici un entier `depth` (croissant =
 *   plus devant, à égalité l'ordre de création) ; l'ordre de dessin dynamique de l'original (`11a8:231b`, devant / derrière selon
 *   l'ordonnée) est porté par `Features.reorder` / `setDepthSort` (voir plus bas), que la scène active ; sans lui, `depth` fixe l'ordre ;
 * - rappel de fin d'animation (`0xffff`) : l'original exige que l'appelant ait posé `+0x2f` ; ici `notifyEnd` vaut vrai par défaut ;
 * - les groupes de synchronisation (`+0xde`, tables `DS:06da` / `DS:06fc` / `DS:070d`), la région (`0x8000000`) et le mode
 *   d'écrêtage (`+0xe2`) ne sont pas portés : les drapeaux correspondants sont stockés sans effet.
 *
 * Images de 24 cases (FERRY et LILLY, `data/script.ts`) : la boucle de `11a0:033a` lit au plus 24 cases et ne lit pas le
 * terminateur d'une image qui en a 24. Le terminateur est donc lu comme première case de l'image suivante, qui devient une image
 * de zéro case : le code rend alors la main sans toucher au tampon des parties (la feature garde donc l'image précédente à
 * l'écran), après avoir appelé le rappel d'événement et mis le son en file. Le terminateur d'une image de 24 cases agit donc une
 * image plus tard, et le script compte une image de plus qu'annoncé par la dernière : lecture identique à `parseScrb`. Autre
 * conséquence du code : une image de 23 cases ne remet pas son tampon à zéro après sa dernière case (la 24e case garde le contenu
 * d'une image précédente), et le tampon d'une image de 24 cases n'est pas terminé non plus ; ici le tampon est conservé tel quel
 * et lu jusqu'à la première case nulle ou la 24e. L'accès aléatoire (`seek`, lecture aléatoire) travaille sur les images de
 * `Script`, alors que `11a8:216f` compte les terminateurs : les deux ne divergent qu'après une image de 24 cases.
 */
import type { Shape } from "../../../data/mohawk/shap";
import { drawShape } from "../../../engine/mohawk/graphics/blit";
import type { Surface } from "../../../engine/mohawk/graphics/surface";
import type { Archive } from "../../../engine/mohawk/resources";
import type { MsvcRandom } from "../../../engine/mohawk/rng";
import { TAG_REGS, TAG_SCRB } from "../data/archives";
import type { Anchors } from "../data/regs";
import { SCRIPT_MAX_CELLS, type Script } from "../data/script";
import { regs, scrb } from "./resources";
import { defineService } from "./scene";
import type { ZoombinisEngine } from "./engine";
import { GRAPHICS } from "./services";
import { ZOOMBINIS_SOUND } from "./sound";

/** Nombre de groupes de formes (`11a0:0000`, « Feature Group out of range »). */
export const FEATURE_GROUPS = 8;
/** Nombre de plages de scripts (`DS:a624`) et d'emplacements (`DS:a750`). */
export const SCRIPT_RANGES = 8;
export const SCRIPT_SLOTS = 300;
/** Argument du rappel d'événement à la fin de l'animation. */
export const FEATURE_END = 0xffff;

/**
 * Drapeaux d'une feature (`+0x20`, `engine.md` §3.5). Interprétés : `firstImage`, `noDraw`, `active`, `resetOnce`, `stopEachImage`,
 * `queueScript`, `noReplay`, `stopAtEnd`, `relative`, `playOnly` (dessiné seulement pendant qu'il joue), `random`, et `still` (extension du port : image fixe dessinée, pour les décors que
 * l'original crée sans le bit `0x1000000`). Stockés sans effet (« non interprétés ») : `snoid`
 * et `other` (taille de l'objet et tables `SCRS` de l'original, mais lus par `Features.reorder` pour reconnaître un personnage
 * mobile), `region` (région attachée, `11d8:0958`). Lus seulement par `Features.reorder` (`11a8:231b`) : `overlay`, `active`,
 * `flag4000000`, `limitLeft`, `limitRight`, `limitTop`.
 */
export const FeatureFlag = {
  snoid: 0x1,
  other: 0x2,
  /** Joue sa première image dès la création (sans attendre le prochain tick). */
  firstImage: 0x2000,
  /** Joue mais ne dessine pas. */
  noDraw: 0x4000,
  /** Objet « actif » mémorisé (`DS:a646`, `Features.activeId`). */
  active: 0x8000,
  /** Reste devant tout le reste, par-dessus les Zoombinis (`11a8:231b`) : boutons, premier plan d'un écran. */
  overlay: 0x1000,
  /** À la prochaine fin d'image : retour à l'image 0, arrêt, et le bit est effacé. */
  resetOnce: 0x10000,
  /** S'arrête après chaque image jouée. */
  stopEachImage: 0x20000,
  /** À la fin du script, prend le script mis en file par `setScript` (celui qu'il remplaçait). */
  queueScript: 0x40000,
  /** Ne rejoue pas : s'arrête après la première image d'un script. */
  noReplay: 0x80000,
  /** Arrêt à la fin (sans ce bit, reboucle à l'image 0). */
  stopAtEnd: 0x100000,
  /** Position relative : les parties sont décalées de `position` moins la première case de l'image 0. */
  relative: 0x800000,
  /**
   * Image fixe du port (**extension**, bit absent de l'original) : ne joue que la première image, sans son, puis s'arrête, et reste dessinée. Pour les
   * décors que l'original crée sans `0x1000000` (et que le port veut figer sur leur première image).
   */
  still: 0x400000,
  /**
   * Bit `0x1000000` de l'original : **dessiné seulement pendant qu'il joue**. `11a0:033a` arrête l'objet dès sa première image (sans son), et le rappel de
   * dessin `11a0:0126` ne le dessine que si l'objet est actif (`+0xe0 ≠ 0`) : invisible au repos, il n'apparaît que le temps d'une animation lancée par
   * l'écran (surbrillance d'une zone de dépôt, mouette, éclaboussure…), puis disparaît à sa fin.
   */
  playOnly: 0x1000000,
  /** Lecture aléatoire : l'image suivante est tirée par `10a8:04e8(dernière, 0)`. */
  random: 0x2000000,
  /** « Déjà trié » : `11a8:231b` le pose sur un objet fixe à sa première mise en ordre, et ne le déplace plus ensuite. */
  flag4000000: 0x4000000,
  region: 0x8000000,
  /** Contraintes de `11a8:2737` : cet objet ne cache un passant (ne le met derrière lui) que si le passant n'est pas à gauche de son bord gauche. */
  limitLeft: 0x40000000,
  /** … que si le passant ne dépasse pas son bord droit. */
  limitRight: 0x10000000,
  /** … que si le passant ne commence pas au-dessus de son bord haut. */
  limitTop: 0x20000000,
} as const;

/** Planche multi-image d'un groupe (ou d'un autre jeu de formes que les parties d'un rappel d'image peuvent désigner). */
export interface Sheet {
  /** Sous-images, indice 0 = `w` 1. */
  readonly images: readonly Shape[];
  /** Points d'ancrage `REGS id` / `REGS id + 1` (§3.4) ; absents pour une planche sans `REGS`. */
  readonly anchors?: Anchors;
}

/** Une partie d'image : `(w, x, y)` du script, `x` et `y` décalés par la position de référence, puis recalés par `REGS`. */
export interface FeaturePart {
  w: number;
  x: number;
  y: number;
  /** Planche de cette partie si ce n'est pas celle du groupe de la feature (rappel d'image) ; ses ancres remplacent celles du groupe. */
  sheet?: Sheet;
}

export interface FeatureRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Rappel d'événement (`+0x10`) : `image` = image qui vient d'être lue, `n` = octet bas du terminateur − 1, ou `FEATURE_END`. */
export type FeatureEventHook = (
  image: number,
  n: number,
  feature: Feature,
) => void;
/** Rappel par image (`+0x14`) : reçoit les parties de l'image courante, avant la soustraction de `REGS` ; renvoie les parties à utiliser, ou rien pour garder les siennes. */
export type FeatureImageHook = (
  feature: Feature,
  parts: FeaturePart[],
) => FeaturePart[] | void;
/** Rappel avant (`+0x0c`) ou après (`+0x08`) le dessin de la feature, avec la surface où elle se dessine. */
export type FeatureDrawHook = (feature: Feature, screen: Surface) => void;
/** Fournisseur de scripts remplaçant les plages (pour les `SCRS`) : `group` désigne la planche des parties (0 par défaut). */
export type FeatureScriptSource = (
  id: number,
) => { script: Script; group?: number } | undefined;

export interface FeatureOptions {
  /** Profondeur : croissante = plus devant ; à égalité, l'ordre de création. Défaut 0. */
  depth?: number;
  /** Position de référence (drapeau `relative`). */
  position?: { x: number; y: number };
  /** Délai entre deux images, en ticks (`+0x28`). */
  delay: number;
  /** Id du script (`SCRB` de l'archive courante, dans une plage enregistrée). */
  script: number;
  /** Combinaison de `FeatureFlag`. */
  flags?: number;
  onBeforeDraw?: FeatureDrawHook;
  onAfterDraw?: FeatureDrawHook;
  onEvent?: FeatureEventHook;
  onImage?: FeatureImageHook;
  /** Appelle `onEvent` avec `FEATURE_END` à la fin de l'animation (`+0x2f`). Défaut vrai. */
  notifyEnd?: boolean;
  /** Script fourni par l'appelant au lieu des plages (`SCRS`). */
  source?: FeatureScriptSource;
}

/** Un objet animé (offsets de l'original entre parenthèses). */
export class Feature {
  /** Numéro d'ordre (`+0x1a`) : plus grand numéro existant + 1 à la création. */
  readonly id: number;
  depth: number;
  /** Id du script courant (`+0x1c`). */
  scriptId: number;
  /** Id mis en file (`+0x1e`) ; négatif : à rejouer en mode aléatoire. */
  queued = 0;
  /** `FeatureFlag` (`+0x20`). */
  flags: number;
  /** Instant de la prochaine image, en ticks (`+0x24`). */
  next = 0;
  /** Délai entre images (`+0x28`). */
  delay: number;
  /** En lecture (`+0xe0`) ; faux : la feature ne joue plus mais reste dessinée. */
  active = true;
  /** À redessiner (`+0x2c`). */
  redraw = true;
  /** Script en cours de remplacement (`+0x2d`) : vrai à la création, l'image 0 est lue au premier passage. */
  replacing = true;
  /** Première image (`+0x2e`) : la prochaine avance ne change pas d'image. */
  first = false;
  notifyEnd: boolean;
  /** Dernier indice d'image (`+0xc6`, `n − 1`) et image courante (`+0xc8`). */
  last = -1;
  image = 0;
  /** Script chargé, groupe de formes (rang de sa plage) et position de référence (`+0xd6`) / de départ (`+0xda`). */
  script: Script | null = null;
  group = 0;
  readonly position: { x: number; y: number };
  readonly reference = { x: 0, y: 0 };
  /** Parties de l'image courante (tampon `+0x30` après le rappel d'image et la soustraction de `REGS`). */
  parts: FeaturePart[] = [];
  /** Rectangle de l'image courante (`+0xce…+0xd4`) ; `null` tant qu'aucune image n'a été lue. */
  rect: FeatureRect | null = null;
  /** Tampon brut des 24 cases (`+0x30`), tel que `11a0:033a` l'écrit. */
  readonly buffer: { w: number; x: number; y: number }[] = Array.from(
    { length: SCRIPT_MAX_CELLS },
    () => ({ w: 0, x: 0, y: 0 }),
  );
  /**
   * Porté devant tout, y compris les `overlay`, tant qu'il est vrai (`Features.reorder`) : extension du port pour un Zoombini transporté par
   * le pointeur (`1168:1742`, dont l'ordre de dessin n'est pas établi).
   */
  raised = false;
  onBeforeDraw: FeatureDrawHook | undefined;
  onAfterDraw: FeatureDrawHook | undefined;
  onEvent: FeatureEventHook | undefined;
  onImage: FeatureImageHook | undefined;
  readonly source: FeatureScriptSource | undefined;
  destroyed = false;

  constructor(id: number, options: FeatureOptions) {
    this.id = id;
    this.depth = options.depth ?? 0;
    this.scriptId = options.script;
    this.flags = options.flags ?? 0;
    this.delay = options.delay;
    this.notifyEnd = options.notifyEnd ?? true;
    this.position = {
      x: options.position?.x ?? 0,
      y: options.position?.y ?? 0,
    };
    this.onBeforeDraw = options.onBeforeDraw;
    this.onAfterDraw = options.onAfterDraw;
    this.onEvent = options.onEvent;
    this.onImage = options.onImage;
    this.source = options.source;
  }

  hasFlag(flag: number): boolean {
    return (this.flags & flag) !== 0;
  }
}

export interface FeaturesDeps {
  /** Surface de jeu : recomposée entièrement à chaque changement. */
  screen: Surface;
  clock: { readonly ticks: number };
  /** Hasard du jeu (`10a8:04e8(max, min)` = `range(min, max)`). */
  rng: Pick<MsvcRandom, "range">;
  /** File de sons (`11a0:0ee7`) ; absente ou `undefined` : les sons des terminateurs sont ignorés. */
  sound?: () => { queue(id: number): void } | undefined;
  requestPresent(): void;
}

/** Planche `tBMP id` et, si `withAnchors`, ses `REGS id` (X) / `REGS id + 1` (Y) (`11a0:0000`). */
export function createSheet(
  archive: Archive,
  tbmpId: number,
  withAnchors = false,
): Sheet {
  const images = archive.tbmpImages(tbmpId);
  if (!withAnchors) return { images };
  for (const id of [tbmpId, tbmpId + 1])
    if (!archive.has(TAG_REGS, id))
      throw new Error(
        `${archive.name} : REGS ${id} absent (ancres de la planche ${tbmpId})`,
      );
  const x = regs(archive, tbmpId);
  const y = regs(archive, tbmpId + 1);
  if (x.length !== y.length)
    throw new Error(
      `${archive.name} : REGS ${tbmpId} (${x.length}) et ${tbmpId + 1} (${y.length}) de tailles différentes`,
    );
  return { images, anchors: { x, y } };
}

/** `11a8:216f` : indice d'image (borné à `[−n, n − 1]`, négatif = depuis la fin) pour un script de `n` images. */
export function resolveImageIndex(imageCount: number, n: number): number {
  if (imageCount <= 0) return 0;
  if (n >= imageCount) n = imageCount - 1;
  if (n < -imageCount) n = -imageCount;
  return n < 0 ? n + imageCount : n;
}

export class Features {
  private list: Feature[] = [];
  private archive: Archive | null = null;
  private background: Surface | null = null;
  private readonly groups: (Sheet | undefined)[] = Array.from(
    { length: FEATURE_GROUPS },
    () => undefined,
  );
  private ranges: { first: number; count: number }[] = [];
  private dirty = false;
  /** Id de la dernière feature créée avec `FeatureFlag.active` (`DS:a646`). */
  activeId = 0;
  /** Mise en ordre dynamique à chaque tick (`DS:3fdc`) ; désactivée à la création et par `clear()`. */
  private depthSort = false;

  constructor(private readonly deps: FeaturesDeps) {}

  /** Archive de l'écran : source des `SCRB` et des planches (`DS:4270`). */
  setArchive(archive: Archive | null): void {
    this.archive = archive;
  }

  /** Fond de l'écran, recopié avant les features. `null` : les features se dessinent sur ce que contient déjà la surface. */
  setBackground(background: Surface | null): void {
    this.background = background;
    this.dirty = true;
  }

  /** Features, de l'arrière vers l'avant. */
  get features(): readonly Feature[] {
    return this.list;
  }

  /** `11a0:0000(flag, k, id)` : groupe `k` (0 à 7) = planche `tBMP id` (avec `REGS id` / `id + 1` si `withAnchors`). */
  defineGroup(k: number, tbmpId: number, withAnchors = false): Sheet {
    const sheet = createSheet(this.requireArchive(), tbmpId, withAnchors);
    this.setGroup(k, sheet);
    return sheet;
  }

  /** Comme `defineGroup`, avec une planche déjà construite (`createSheet`, planche d'une autre archive). */
  setGroup(k: number, sheet: Sheet): void {
    if (!Number.isInteger(k) || k < 0 || k >= FEATURE_GROUPS)
      throw new RangeError("Feature Group out of range");
    if (this.groups[k]) throw new Error("Feature Group already used");
    this.groups[k] = sheet;
  }

  group(k: number): Sheet | undefined {
    return this.groups[k];
  }

  /** `11a8:14ab(nombre, premier)` : repart de zéro avec une plage de `count` `SCRB` à partir de `firstId` (groupe 0 pour ses ids). */
  setScripts(firstId: number, count: number): void {
    if (count > SCRIPT_SLOTS) throw new Error("Too many main-feature SCRBs");
    this.ranges = [{ first: firstId, count }];
  }

  /**
   * `11a8:15a6(max, nombre, premier)` : plage suivante (groupe suivant). Sans effet, comme l'original, s'il y a déjà 8 plages, si
   * aucune plage n'existe ou si les emplacements sont pleins. `max` (nombre à précharger) n'a pas d'objet : les scripts sont lus à la demande.
   */
  addScripts(firstId: number, count: number): void {
    const used = this.ranges.reduce((sum, range) => sum + range.count, 0);
    if (
      this.ranges.length >= SCRIPT_RANGES ||
      used === 0 ||
      used >= SCRIPT_SLOTS
    )
      return;
    if (used + count > SCRIPT_SLOTS)
      throw new Error("Too many next-group-feature SCRBs");
    this.ranges.push({ first: firstId, count });
  }

  /** `11a8:166e` : groupe (rang de la plage) d'un id de script, ou `undefined` s'il n'est dans aucune plage. */
  groupOf(id: number): number | undefined {
    const k = this.ranges.findIndex(
      (range) => id >= range.first && id <= range.first + range.count - 1,
    );
    return k < 0 ? undefined : k;
  }

  /** `11a8:0ad6` : crée une feature ; avec `FeatureFlag.firstImage`, sa première image est jouée tout de suite. */
  create(options: FeatureOptions): Feature {
    const id = this.list.reduce((max, f) => Math.max(max, f.id), 0) + 1;
    const feature = new Feature(id, options);
    let index = this.list.length;
    while (index > 0 && this.list[index - 1]!.depth > feature.depth) index--;
    this.list.splice(index, 0, feature);
    if (feature.hasFlag(FeatureFlag.active)) this.activeId = id;
    this.dirty = true;
    if (feature.hasFlag(FeatureFlag.firstImage))
      this.step(feature, this.deps.clock.ticks);
    return feature;
  }

  /** Réinsère la feature à la profondeur `depth` (à égalité, derrière celles qui y sont déjà, comme à la création) sans toucher à son animation (`11a8:2a0a`). */
  restack(feature: Feature, depth: number): void {
    const index = this.list.indexOf(feature);
    if (index < 0) return;
    this.list.splice(index, 1);
    feature.depth = depth;
    let at = this.list.length;
    while (at > 0 && this.list[at - 1]!.depth > depth) at--;
    this.list.splice(at, 0, feature);
    this.dirty = true;
  }

  /**
   * `11a8:29c4` : active (ou non) la mise en ordre dynamique `reorder`, faite à chaque tick après la lecture des features. L'original
   * l'active partout ; le port la laisse aux écrans qui en ont besoin (les autres gardent l'ordre de `depth`). Remise à faux par `clear()`.
   */
  setDepthSort(on: boolean): void {
    this.depthSort = on;
    this.dirty = true;
  }

  /**
   * `11a8:231b` (appelé par `11a8:04b9`, chaque tour du moteur) avec `11a8:25ad` et `11a8:2737` : ordre de dessin, de l'arrière vers l'avant.
   * Les features se répartissent par drapeaux :
   * - `active` (`0x8000`) : restent en tête, dans leur ordre ;
   * - `flag4000000` (déjà triées) : ensuite, dans leur ordre ;
   * - mobiles (`snoid` ou `other`, c'est-à-dire les Zoombinis) : triées à chaque tick ;
   * - les autres (décor) : triées une seule fois (le bit `flag4000000` est posé, sauf pour les `overlay`, retriées à chaque tick, qui vont à la fin) ;
   * puis décor et mobiles sont insérés, tour à tour, dans la liste. Le tri est celui de `25ad` : rectangle de l'image courante, bord bas
   * croissant puis bord gauche croissant (un objet dont le bord bas est plus bas est dessiné devant) ; `2737` insère chaque objet devant la première feature
   * qu'il précède, sauf si celle-ci porte `limitLeft` / `limitRight` / `limitTop` et que l'objet est hors de sa colonne ; une feature `overlay`
   * arrête toujours la recherche (tout passe derrière elle). Sans rectangle (aucune image lue), les bords valent 0 (mémoire à zéro de l'original).
   *
   * Écarts : l'original reconnaît un mobile à `drapeaux == 1 ou 2` ; le port teste les bits `snoid` / `other` (un `Snoid` range dans le même mot
   * ses drapeaux de lecture, `stopEachImage`, et `firstImage`). `raised` (extension) place en dernier les objets portés par le pointeur. L'original
   * a deux nœuds fixes (tête `0x1008000`, queue `0x1000`) qu'il ne reste qu'à ignorer ici.
   */
  reorder(): void {
    const before = this.list;
    const head: Feature[] = [];
    const sorted: Feature[] = [];
    const moving: Feature[] = [];
    const decor: Feature[] = [];
    const carried: Feature[] = [];
    for (const feature of before) {
      const flags = feature.flags;
      if (feature.raised) carried.push(feature);
      else if (flags & FeatureFlag.active) head.push(feature);
      else if (flags & FeatureFlag.flag4000000) sorted.push(feature);
      else if (flags & (FeatureFlag.snoid | FeatureFlag.other)) moving.push(feature);
      else {
        if (!(flags & FeatureFlag.overlay)) feature.flags |= FeatureFlag.flag4000000;
        decor.push(feature);
      }
    }
    const list = [...head, ...sorted];
    mergeByDepth(list, sortByBottom(decor));
    mergeByDepth(list, sortByBottom(moving));
    list.push(...carried);
    if (list.some((feature, i) => feature !== before[i])) this.dirty = true;
    this.list = list;
  }

  destroy(feature: Feature): void {
    const index = this.list.indexOf(feature);
    if (index >= 0) this.list.splice(index, 1);
    feature.destroyed = true;
    this.dirty = true;
  }

  /** Détruit toutes les features et les groupes, oublie les plages, l'archive et le fond (à appeler dans `leave`). */
  clear(): void {
    for (const feature of this.list) feature.destroyed = true;
    this.list = [];
    this.groups.fill(undefined);
    this.ranges = [];
    this.archive = null;
    this.background = null;
    this.activeId = 0;
    this.depthSort = false;
    this.dirty = false;
  }

  /** Demande une recomposition au prochain `tick` (par exemple après avoir modifié `parts` ou un fond). */
  invalidate(): void {
    this.dirty = true;
  }

  /**
   * `11a8:1be6` : change le script de la feature (`id` 0 = le courant) : image 0 lue à la prochaine échéance, `play` = en lecture.
   * Avec `queueScript`, le script remplacé est mis en file pour être repris à la fin du nouveau (un script déjà en file : appel ignoré).
   */
  setScript(feature: Feature, id = 0, play = true): void {
    if (id === 0) id = feature.scriptId;
    if (
      feature.hasFlag(FeatureFlag.queueScript) &&
      (feature.first || !feature.replacing)
    ) {
      if (feature.queued !== 0) return;
      if (!feature.hasFlag(FeatureFlag.random)) {
        feature.queued = feature.scriptId;
      } else {
        feature.flags &= ~FeatureFlag.random;
        feature.queued = -feature.scriptId;
      }
    }
    if (feature.scriptId !== id || feature.replacing) {
      feature.scriptId = id;
      const resolved = this.resolve(feature, id);
      feature.script = resolved?.script ?? null;
      feature.group = resolved?.group ?? 0;
    }
    const script = feature.script;
    if (!script) {
      // « Set Ftr id … with bogus script » : la feature s'arrête et n'a plus de parties.
      feature.active = false;
      feature.buffer[0]!.w = 0;
      feature.parts = [];
      feature.group = 0;
      feature.image = 0;
      this.dirty = true;
      return;
    }
    feature.last = script.images.length - 1;
    feature.image = 0;
    feature.next = 0;
    feature.active = play;
    feature.redraw = true;
    feature.replacing = false;
    feature.first = true;
    if (feature.hasFlag(FeatureFlag.relative)) {
      const first = script.images[0]?.cells[0];
      feature.reference.x = first?.x ?? 0;
      feature.reference.y = first?.y ?? 0;
    }
    this.dirty = true;
  }

  /**
   * Accès aléatoire (`11a8:216f`) : la prochaine échéance (aussitôt) lit l'image `n`, bornée comme l'original (négatif = depuis la fin).
   * L'original ne fait que calculer la position de lecture ; l'appelant règle `+0xc8` et `+0xca` lui-même. Comme `11a0:033a` avance
   * avant de lire, l'image courante devient `n − 1` (donc −1 pour l'image 0) jusqu'à cette lecture. Sans effet en lecture aléatoire,
   * où l'image est tirée à chaque échéance.
   */
  seek(feature: Feature, n: number): void {
    feature.image = resolveImageIndex(feature.last + 1, n) - 1;
    feature.first = false;
    feature.next = 0;
  }

  /** Un tick : fait jouer les features échues (`tick ≥ next`), puis recompose l'écran si l'une a changé. */
  tick(): void {
    const now = this.deps.clock.ticks;
    for (const feature of [...this.list])
      if (!feature.destroyed) this.step(feature, now);
    if (this.depthSort) this.reorder();
    if (this.dirty) this.compose();
  }

  /** Recompose l'écran entier : fond, puis features par profondeur, puis demande de présentation. */
  compose(): void {
    const { screen } = this.deps;
    if (this.background) screen.copyFrom(this.background);
    for (const feature of [...this.list]) {
      if (feature.hasFlag(FeatureFlag.noDraw)) continue;
      // `11a0:0126` : un objet `0x1000000` n'est dessiné que pendant qu'il joue.
      if (feature.hasFlag(FeatureFlag.playOnly) && !feature.active) continue;
      feature.onBeforeDraw?.(feature, screen);
      for (const part of feature.parts) {
        const sheet = part.sheet ?? this.groups[feature.group];
        const shape = sheet?.images[part.w - 1];
        if (shape) drawShape(screen, shape, part.x, part.y, 8);
      }
      feature.onAfterDraw?.(feature, screen);
    }
    this.dirty = false;
    this.deps.requestPresent();
  }

  private requireArchive(): Archive {
    if (!this.archive)
      throw new Error("Features : aucune archive (setArchive)");
    return this.archive;
  }

  private resolve(
    feature: Feature,
    id: number,
  ): { script: Script; group: number } | undefined {
    if (feature.source) {
      const found = feature.source(id);
      return found
        ? { script: found.script, group: found.group ?? 0 }
        : undefined;
    }
    const group = this.groupOf(id);
    if (group === undefined || !this.archive?.has(TAG_SCRB, id))
      return undefined;
    return { script: scrb(this.archive, id), group };
  }

  private finish(feature: Feature): void {
    // Le rappel est retiré avant d'être appelé : il peut ainsi en installer un nouveau (script suivant) sans qu'il soit effacé.
    const hook = feature.onEvent;
    feature.onEvent = undefined;
    if (feature.notifyEnd) hook?.(feature.image, FEATURE_END, feature);
  }

  /** `11a0:033a` pour une feature (l'effacement du rectangle précédent n'a pas d'objet : l'écran est recomposé). */
  private step(feature: Feature, now: number): void {
    if (!feature.active || now < feature.next) return;
    let silent = feature.replacing;
    let ended = false;
    if (!feature.replacing) {
      feature.redraw = true;
      if (feature.image < feature.last) {
        if (!feature.hasFlag(FeatureFlag.random)) {
          if (!feature.first) feature.image++;
          else feature.first = false;
        } else {
          feature.image = this.deps.rng.range(0, feature.last);
        }
      } else {
        let atEnd = true;
        if (feature.hasFlag(FeatureFlag.queueScript)) {
          ended = true;
          if (feature.queued !== 0) {
            const queued = feature.queued;
            feature.queued = 0;
            if (queued < 0) {
              this.setScript(feature, -queued);
              feature.flags |= FeatureFlag.random;
            } else {
              this.setScript(feature, queued);
            }
            feature.queued = 0;
            if (feature.hasFlag(FeatureFlag.firstImage)) feature.active = false;
          }
          if (feature.last < 2) feature.active = false;
          feature.image = 0;
          atEnd = false;
        }
        if (!feature.hasFlag(FeatureFlag.stopAtEnd)) {
          feature.image = 0;
        } else {
          ended = true;
          feature.active = false;
          if (atEnd) {
            // Un objet `playOnly` disparaît à sa fin (`11a0:0126`) : l'écran est à recomposer.
            if (feature.hasFlag(FeatureFlag.playOnly)) this.dirty = true;
            this.finish(feature);
            return;
          }
        }
      }
      if (feature.hasFlag(FeatureFlag.stopEachImage)) feature.active = false;
      if (feature.hasFlag(FeatureFlag.resetOnce)) {
        feature.flags &= ~FeatureFlag.resetOnce;
        feature.image = 0;
        feature.active = false;
      }
    } else {
      this.setScript(feature, feature.scriptId);
      feature.first = false;
      if (
        feature.last < 1 ||
        feature.hasFlag(FeatureFlag.noReplay) ||
        feature.hasFlag(FeatureFlag.stopEachImage)
      )
        feature.active = false;
      if (!feature.hasFlag(FeatureFlag.playOnly | FeatureFlag.still)) {
        feature.redraw = true;
        silent = false;
      } else {
        feature.active = false;
      }
    }
    feature.next = now + feature.delay;
    this.dirty = true;
    this.readImage(feature, silent, ended);
  }

  /** Lecture des cases de l'image courante (jusqu'à 24) et suites : rappel d'image, `REGS`, rectangle. */
  private readImage(feature: Feature, silent: boolean, ended: boolean): void {
    const image = feature.script?.images[feature.image];
    if (!image) return;
    const relative = feature.hasFlag(FeatureFlag.relative);
    const offsetX = relative ? feature.position.x - feature.reference.x : 0;
    const offsetY = relative ? feature.position.y - feature.reference.y : 0;
    const first = image.cells[0];
    const firstWord = first ? first.w : image.terminated ? -1 : 0;
    const buffer = feature.buffer;
    let slot = 0;
    for (let n = 0; n < SCRIPT_MAX_CELLS; n++) {
      const cell = image.cells[n];
      if (cell) {
        const target = buffer[slot++]!;
        if (cell.w === 0) {
          target.w = 0;
          target.x = 0;
          target.y = 0;
        } else {
          target.w = cell.w;
          target.x = cell.x + offsetX;
          target.y = cell.y + offsetY;
        }
        continue;
      }
      if (!image.terminated) break;
      // Terminateur : son, puis rappel d'événement.
      if (image.soundId !== undefined && !silent && image.soundId !== 0)
        this.deps.sound?.()?.queue(image.soundId);
      if (image.event !== 0)
        feature.onEvent?.(feature.image, image.event - 1, feature);
      const remaining = SCRIPT_MAX_CELLS - 1 - n;
      if (remaining !== 0) {
        if (remaining === SCRIPT_MAX_CELLS - 1) {
          // Image sans case (terminateur d'une image de 24 cases relu seul) : le tampon et le rectangle ne changent pas.
          if (ended) this.finish(feature);
          return;
        }
        buffer[slot]!.w = 0;
      }
      break;
    }
    if (ended) this.finish(feature);
    if (firstWord <= 0) return;

    let parts: FeaturePart[] = [];
    for (const entry of buffer) {
      if (entry.w === 0) break;
      parts.push({ w: entry.w, x: entry.x, y: entry.y });
    }
    parts = feature.onImage?.(feature, parts) ?? parts;
    const group = this.groups[feature.group];
    for (const part of parts) {
      const anchors = part.sheet ? part.sheet.anchors : group?.anchors;
      if (anchors) {
        part.x -= anchors.x[part.w] ?? 0;
        part.y -= anchors.y[part.w] ?? 0;
      }
    }
    feature.parts = parts;
    feature.rect = this.boundsOf(feature, parts);
  }

  /** Union des rectangles des parties (`11d8:01a2`) ; les parties sans forme sont ignorées. */
  private boundsOf(
    feature: Feature,
    parts: readonly FeaturePart[],
  ): FeatureRect | null {
    let rect: FeatureRect | null = null;
    for (const part of parts) {
      const shape = (part.sheet ?? this.groups[feature.group])?.images[
        part.w - 1
      ];
      if (!shape) continue;
      const right = part.x + shape.width;
      const bottom = part.y + shape.height;
      rect = rect
        ? {
            left: Math.min(rect.left, part.x),
            top: Math.min(rect.top, part.y),
            right: Math.max(rect.right, right),
            bottom: Math.max(rect.bottom, bottom),
          }
        : { left: part.x, top: part.y, right, bottom };
    }
    return rect ?? feature.rect;
  }
}

const NO_RECT: FeatureRect = { left: 0, top: 0, right: 0, bottom: 0 };
const rectOf = (feature: Feature): FeatureRect => feature.rect ?? NO_RECT;

/** `11a8:25ad` : tri par insertion, bord bas puis bord gauche croissants ; un `overlay` va à la fin. */
function sortByBottom(features: readonly Feature[]): Feature[] {
  const out: Feature[] = [];
  for (const feature of features) {
    const rect = rectOf(feature);
    let at = out.length;
    if (!(feature.flags & FeatureFlag.overlay)) {
      const found = out.findIndex((other) => {
        const o = rectOf(other);
        return rect.bottom < o.bottom || (rect.bottom === o.bottom && rect.left < o.left);
      });
      if (found >= 0) at = found;
    }
    out.splice(at, 0, feature);
  }
  return out;
}

/**
 * `11a8:2737` : insère `incoming` (déjà trié) dans `list`. Un `overlay` est ajouté à la fin ; sinon l'objet se place devant la première
 * feature qu'il précède par (bord bas, bord gauche) et que les contraintes de celle-ci n'excluent pas, ou devant la première `overlay`
 * rencontrée ; la recherche du suivant reprend à cette feature. La recherche part de la fin du bloc de têtes (`active`).
 */
function mergeByDepth(list: Feature[], incoming: readonly Feature[]): void {
  let start = 0;
  while (start < list.length && list[start]!.flags & FeatureFlag.active) start++;
  for (const feature of incoming) {
    if (feature.flags & FeatureFlag.overlay) {
      list.push(feature);
      continue;
    }
    const rect = rectOf(feature);
    let at = start;
    let passed = false;
    while (at < list.length) {
      const other = list[at]!;
      if (other.flags & FeatureFlag.overlay) break;
      const o = rectOf(other);
      const earlier = rect.bottom < o.bottom || (rect.bottom === o.bottom && rect.left < o.left);
      if (
        earlier &&
        (rect.bottom < o.top ||
          ((!(other.flags & FeatureFlag.limitLeft) || o.left <= rect.left) &&
            (!(other.flags & FeatureFlag.limitRight) || rect.right <= o.right) &&
            (!(other.flags & FeatureFlag.limitTop) || o.top <= rect.top)))
      ) {
        passed = true;
        break;
      }
      at++;
    }
    list.splice(at, 0, feature);
    // La recherche du suivant reprend à la feature devant laquelle l'objet vient de passer (`local_8`), pas après une `overlay`.
    if (passed) start = at + 1;
  }
}

export const FEATURES = defineService<Features>("zoombinis.features");

type FeaturesHost = Pick<ZoombinisEngine, "ctx" | "services" | "addTickHook">;

/**
 * À appeler une fois après `installServices(engine)` : enregistre `FEATURES` (surface de `GRAPHICS`, horloge et hasard du contexte,
 * son de `ZOOMBINIS_SOUND` s'il est enregistré) et ajoute un crochet de tick, qui joue les features avant le `tick` de la scène.
 */
export function installFeatures(engine: FeaturesHost): Features {
  const { ctx, services } = engine;
  const features = new Features({
    screen: services.get(GRAPHICS).screen,
    clock: ctx.clock,
    rng: ctx.rng,
    sound: () => services.tryGet(ZOOMBINIS_SOUND),
    requestPresent: () => ctx.requestPresent(),
  });
  services.provide(FEATURES, features);
  engine.addTickHook(() => features.tick());
  return features;
}
