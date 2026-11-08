/**
 * Zoombinis animés à l'écran (« snoids », `docs/zoombinis/engine.md` §3.6 et §4.2) : aide commune des écrans du choix, des
 * transitions, des camps et de la ville. Un `Snoid` est une feature (`engine/features.ts`) qui joue un `SCRS`, dont chaque image est
 * recomposée pour le Zoombini par `data/zoombini.ts` (`composeSnoidCells`) via le crochet `onImage`, et qui peut marcher le long d'un
 * chemin `NODE` / `PATH`.
 *
 * ## Usage
 *
 * - `snoidAssets(ctx)` (mémoïsé) : planches 3000 / 3100 / 3200 de `ZOOMBINI.MHK` avec leurs `REGS`, et `SCRS` communs 100 à 150.
 *   `ZOOMBINI.MHK` est déjà ouverte (`persistent`) par `installServices` : rien à charger dans `Scene.load`.
 * - `createSnoid(ctx, zoombini, { position, ... })` dans `enter`, après `openScreen` (les features doivent avoir leur fond). Le Zoombini
 *   attend en pose `100 + idleVariant` ; `play(id, flags?)` joue un autre script (commun, ou de l'écran via `options.scripts`) ;
 *   `walkTo` / `followPath` le font marcher ; `destroy()` le retire (`closeScreen` détruit de toute façon toutes les features).
 *
 * ## Cadence de la marche
 *
 * Aucun tick à brancher (et rien dans `services.ts`) : la marche est cadencée par la feature elle-même. Un pas est fait chaque fois que
 * la feature lit une image de son script de marche, c'est-à-dire toutes les `delay` ticks (6 par défaut, `WALK_TICKS_PER_STEP`,
 * §4.2) : le crochet `onImage` appelle `tickWalk`, puis compose l'image à la nouvelle position. Le premier pas a donc lieu au tick qui suit
 * `walkTo` (le moteur le fait dans le tick même du départ). Quand le secteur change, le script de marche `100 + 5 × pieds + secteur` est
 * rechargé (sans décaler la cadence) ; à l'arrivée le Zoombini repasse en pose d'attente et `onArrive` est appelé. Les marches
 * se font donc au rythme des ticks de 17 ms du moteur, quel que soit le nombre d'images affichées.
 *
 * ## Animations d'attente (tâche H0)
 *
 * Option `waitAnimations` (ou propriété du même nom), **désactivée par défaut** : les écrans qui n'en veulent pas (choix, transitions,
 * camps, ville) ne changent pas. Elle porte l'état 0 de `1168:0ba8` (le Zoombini attend en pose `100 + idleVariant`) et l'état 6 :
 * l'écran appelle `tickWait()` à chaque tick de la scène (le kit des épreuves le fait pour tout son groupe). À chaque échéance de la feature
 * (un tick de `delay` = 6 ticks), le compteur `+0xf8` (tiré à la création entre 0 et 64 pour que les Zoombinis ne clignent pas ensemble)
 * avance ; quand il dépasse `DS:235c` (64, valeur initiale du segment de données) il est remis à 0 et, une fois sur dix environ
 * (`10a8:04e8(100, 0) < 10`), un numéro `n` de 0 à 7 est tiré : le Zoombini joue le `SCRS` `130 + n` (`138 + n` si `idleVariant` vaut 2) une seule
 * fois puis revient à l'attente (état 6, `1168:4231`). Si les voix et effets sont actifs, l'entrée de l'état 6 met aussi en file une voix de
 * Zoombini de code 4 (tirage de 1 à 100 ≤ 50) ou 5 (`1168:575b`). Rien ne tourne pendant un autre script, une marche ou un transport.
 *
 * **Mode petit** : l'état 0 ne lance aucune animation tant que `DS:239a` est non nul (`1168:0ba8` à `1168:1176`). `1168:5a13(0)` met `DS:239a` à 1
 * (et `5a13(1)` le remet à 0) : Zoombiniville (`1188:018b` / `1188:0c43`), l'hôtel (`10e8:0144` / `10e8:07a5`) et XFER (`11b0:0c91` / `11b0:1352`) l'appellent
 * à l'entrée et à la sortie. Un Zoombini `small` n'a donc pas d'animation d'attente : `tickWait` fait avancer le compteur mais ne tire rien.
 *
 * Limites : la profondeur est fixée à la création (`Features` n'ordonne qu'à l'insertion) ; une image dont la première case est vide
 * n'appelle pas `onImage` (comme dans `Features`, l'image précédente reste à l'écran).
 */
import type { Archive } from "../../../engine/mohawk/resources";
import { COMMON_ARCHIVE, TAG_SCRS } from "../data/archives";
import type { NodePoint } from "../data/node-path";
import type { Script } from "../data/script";
import {
  composeSnoidCells,
  scriptAnchorOffset,
  SNOID_REGS_IDS,
  SNOID_SCRIPT_COUNT,
  SNOID_SCRIPT_FIRST,
  snoidVoiceId,
  snoidVoiceIdForEvent,
  snoidWalkScriptId,
  startWalk,
  tickWalk,
  WALK_TICKS_PER_STEP,
  type Point,
  type SnoidKind,
  type SnoidSheet,
  type WalkMap,
  type WalkState,
  type ZoombiniTraits,
} from "../data/zoombini";
import {
  FEATURE_END,
  FEATURES,
  Feature,
  FeatureFlag,
  type FeaturePart,
  type Sheet,
} from "../engine/features";
import { regs, scrs } from "../engine/resources";
import type { SceneContext } from "../engine/scene";
import { ZOOMBINIS_SOUND } from "../engine/sound";
import type { Zoombini } from "../game/state";

// ---------------------------------------------------------------------------------------------------------------------------
// Ressources communes

/** Planches des Zoombinis (avec leurs ancres `REGS`) et accès aux `SCRS` communs 100 à 150 de `ZOOMBINI.MHK`. */
export interface SnoidAssets {
  readonly archive: Archive;
  readonly sheets: Readonly<Record<SnoidSheet, Sheet>>;
  /** `SCRS` commun `id` (100 à 150) ; lève s'il n'existe pas. */
  script(id: number): Script;
}

const assetsByArchive = new WeakMap<Archive, SnoidAssets>();

function buildSheet(archive: Archive, sheet: SnoidSheet): Sheet {
  const [idX, idY] = SNOID_REGS_IDS[sheet];
  const x = regs(archive, idX);
  const y = regs(archive, idY);
  if (x.length !== y.length)
    throw new Error(
      `${archive.name} : REGS ${idX} (${x.length}) et ${idY} (${y.length}) de tailles différentes`,
    );
  return { images: archive.tbmpImages(sheet), anchors: { x, y } };
}

/** Planches et `SCRS` communs des Zoombinis, décodés une seule fois par archive. `ZOOMBINI.MHK` doit être ouverte (`installServices`). */
export function snoidAssets(ctx: Pick<SceneContext, "resources">): SnoidAssets {
  const archive = ctx.resources.require(COMMON_ARCHIVE);
  let assets = assetsByArchive.get(archive);
  if (!assets) {
    assets = {
      archive,
      sheets: {
        3000: buildSheet(archive, 3000),
        3100: buildSheet(archive, 3100),
        3200: buildSheet(archive, 3200),
      },
      script: (id) => scrs(archive, id),
    };
    assetsByArchive.set(archive, assets);
  }
  return assets;
}

/** Source des `SCRS` propres à un écran (rejet, scripts « normaux »). */
export type SnoidScriptSource = (id: number) => Script | undefined;

/** Les `SCRS` d'une archive d'écran, à passer en `SnoidOptions.scripts`. */
export function screenScripts(archive: Archive): SnoidScriptSource {
  return (id) => (archive.has(TAG_SCRS, id) ? scrs(archive, id) : undefined);
}

/** Vrai pour les 51 `SCRS` communs de `ZOOMBINI.MHK` (famille `base`). */
export function isCommonSnoidScript(id: number): boolean {
  return id >= SNOID_SCRIPT_FIRST && id < SNOID_SCRIPT_FIRST + SNOID_SCRIPT_COUNT;
}

/** Fiche de la partie (`Zoombini`) ou attributs déjà décodés (`traitsFromRecord`, `traitsFromIndex`). */
export type SnoidSource = ZoombiniTraits | Pick<Zoombini, "attrs" | "state">;

function traitsOf(source: SnoidSource): ZoombiniTraits {
  if (!("attrs" in source)) return source;
  const [hair, eyes, nose, feet] = source.attrs;
  return { hair, eyes, nose, feet, state: [...source.state] };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Snoid

export interface SnoidOptions {
  /** Position du Zoombini (`+0xa6`, `+0xa8`) : le point d'ancrage des pieds. */
  position: Point;
  /** 0 = tourné vers la droite (défaut), 1 = vers la gauche. */
  facing?: 0 | 1;
  /** Mode petit (planche 3200 : HOTEL, TOWN, XFER). Défaut faux. */
  small?: boolean;
  /** Profondeur de la feature (croissante = plus devant ; fixée à la création). Défaut 1 (devant le décor de profondeur 0). */
  depth?: number;
  /** Délai entre deux images, donc entre deux pas : 6 ticks (`WALK_TICKS_PER_STEP`). */
  delay?: number;
  /** Variante d'attente `+0xf1` : le script d'attente est `100 + idleVariant`. Défaut 0. */
  idleVariant?: number;
  /** `SCRS` propres à l'écran pour `play` (ids hors 100 à 150). */
  scripts?: SnoidScriptSource;
  /** Appelé à l'arrivée d'une marche, une fois le Zoombini repassé en attente. */
  onArrive?: (snoid: Snoid) => void;
  /** Appelé à la fin d'un script joué avec `FeatureFlag.stopAtEnd` (et seulement lui). Peut relancer un script. */
  onEnd?: (snoid: Snoid) => void;
  /** Évènements de terminateur qui ne sont pas des voix (octet bas du terminateur − 1, comme `FeatureEventHook`). */
  onEvent?: (n: number, snoid: Snoid) => void;
  /** Animations d'attente (états 0 et 6, voir l'en-tête) : défaut faux. L'écran doit alors appeler `tickWait()` à chaque tick. */
  waitAnimations?: boolean;
}

/** `DS:235c` : période du compteur d'attente (valeur initiale du segment de données, `0x40`). */
export const WAIT_PERIOD = 0x40;
/** Tirage d'une animation d'attente : `10a8:04e8(100, 0) < 10`. */
export const WAIT_CHANCE = 10;
/** Nombre d'animations d'attente (`+0xf5` de 0 à 7) et premiers `SCRS` (variante d'attente 0 ou 1 : 130, variante 2 : 138). */
export const WAIT_ANIMATIONS = 8;
export const WAIT_SCRIPT_FIRST = 130;
export const WAIT_SCRIPT_FIRST_VARIANT_2 = 138;

/** `SCRS` de l'animation d'attente `n` pour une variante d'attente. */
export function waitScriptId(idleVariant: number, n: number): number {
  return (idleVariant === 2 ? WAIT_SCRIPT_FIRST_VARIANT_2 : WAIT_SCRIPT_FIRST) + n;
}

/** Placement d'un script d'écran (familles `normal` et `reject`, `scriptAnchorOffset`). */
export interface SnoidPlacement {
  /** Famille du script : `base` pour les scripts communs (défaut), `normal` sinon. `reject` joue sur la planche 3100. */
  kind?: SnoidKind;
  /** Point d'arrivée : le script finit sur ce point. Sans lui, le script démarre à la position courante. Ignoré pour `base`. */
  at?: Point;
}

/**
 * Bits d'ordre de dessin (`+0x20`, `11a8:231b`) qu'un écran pose sur un Zoombini (`0x4008000` : en tête de liste, plus trié ; par exemple les grottes de
 * passe-clos, `1190:1839`) : la lecture d'un script ne les efface pas.
 */
const DRAW_ORDER_FLAGS = FeatureFlag.active | FeatureFlag.flag4000000;

/** Une carte vide : la marche va droit vers la destination. */
const NO_MAP: WalkMap = { nodes: [], paths: [] };

export class Snoid {
  readonly traits: ZoombiniTraits;
  readonly feature: Feature;
  readonly depth: number;
  idleVariant: number;
  onArrive: ((snoid: Snoid) => void) | undefined;
  onEnd: ((snoid: Snoid) => void) | undefined;
  onEvent: ((n: number, snoid: Snoid) => void) | undefined;
  destroyed = false;
  /** Animations d'attente actives (voir l'en-tête) ; l'écran appelle `tickWait()`. */
  waitAnimations: boolean;

  private pos: Point;
  private dir: 0 | 1;
  private isSmall: boolean;
  private kind: SnoidKind = "base";
  /** Pose imposée (`1168:4dc9`, évènements 250 à 252), ou null : celle du script. */
  private poseOverride: number | null = null;
  private id: number;
  private flags: number = FeatureFlag.stopEachImage;
  /** Décalage des scripts `normal` / `reject` (`scriptAnchorOffset`). */
  private origin: Point = { x: 0, y: 0 };
  private arrival: Point | undefined;
  private walk: WalkState | undefined;
  /** Carte de la marche en cours. */
  private map: WalkMap = NO_MAP;
  /** Vrai en pose d'attente (état 0), faux pendant tout autre script, une marche ou un transport. */
  private atRest = true;
  /** Animation d'attente en cours (état 6). */
  private waiting = false;
  /** Compteur d'attente `+0xf8`. */
  private waitCounter: number;
  /** Prochaine échéance de l'état 0 (`+0x24`), en ticks du moteur. */
  private waitDue = 0;
  private readonly assets: SnoidAssets;
  private readonly scripts: SnoidScriptSource | undefined;
  private readonly ctx: SceneContext;

  constructor(ctx: SceneContext, source: SnoidSource, options: SnoidOptions) {
    this.ctx = ctx;
    this.assets = snoidAssets(ctx);
    this.traits = traitsOf(source);
    this.scripts = options.scripts;
    this.pos = { ...options.position };
    this.dir = options.facing ?? 0;
    this.isSmall = options.small ?? false;
    this.depth = options.depth ?? 1;
    this.idleVariant = options.idleVariant ?? 0;
    this.onArrive = options.onArrive;
    this.onEnd = options.onEnd;
    this.onEvent = options.onEvent;
    this.waitAnimations = options.waitAnimations ?? false;
    // Tiré seulement si l'option est active : sans elle, aucun tirage de plus (le hasard des écrans existants ne bouge pas).
    this.waitCounter = this.waitAnimations ? ctx.rng.range(0, WAIT_PERIOD) : 0;
    this.id = SNOID_SCRIPT_FIRST + this.idleVariant;
    // Première image jouée tout de suite (`firstImage`) : les rappels ci-dessous ne s'appuient que sur leurs arguments.
    this.feature = ctx.services.get(FEATURES).create({
      depth: this.depth,
      delay: options.delay ?? WALK_TICKS_PER_STEP,
      script: this.id,
      flags: FeatureFlag.snoid | FeatureFlag.firstImage | this.flags,
      source: (id) => this.resolve(id),
      onImage: (feature, parts) => this.compose(feature, parts),
      onEvent: (_image, n) => this.event(n),
    });
  }

  /** Position (pieds) du Zoombini. */
  get position(): Readonly<Point> {
    return this.pos;
  }

  /** 0 = tourné vers la droite, 1 = vers la gauche. */
  get facing(): 0 | 1 {
    return this.dir;
  }

  get small(): boolean {
    return this.isSmall;
  }

  /** Id du script courant. */
  get scriptId(): number {
    return this.id;
  }

  /** Vrai pendant une marche. */
  get walking(): boolean {
    return this.walk !== undefined;
  }

  /** Délai entre deux images (donc deux pas) en ticks. */
  get delay(): number {
    return this.feature.delay;
  }

  set delay(ticks: number) {
    this.feature.delay = ticks;
  }

  /**
   * Joue un script depuis sa première image. `flags` : `FeatureFlag` de la feature pour ce script, 0 = en boucle ; `stopAtEnd`
   * s'arrête sur la dernière image (puis `onEnd`), `stopEachImage` ne montre que la première. Annule une marche en cours. Un script
   * qui n'existe pas lève une erreur (id d'écran sans `options.scripts`).
   */
  play(scriptId: number, flags = 0, placement: SnoidPlacement = {}): void {
    this.atRest = false;
    this.waiting = false;
    this.walk = undefined;
    this.poseOverride = null;
    const kind = placement.kind ?? (isCommonSnoidScript(scriptId) ? "base" : "normal");
    this.arrival = kind === "base" ? undefined : placement.at;
    this.kind = kind;
    this.load(scriptId, flags);
    if (kind !== "base") {
      const script = this.resolve(scriptId)!.script;
      this.origin = scriptAnchorOffset(script.images, placement.at ?? this.pos, placement.at !== undefined);
    }
  }

  /** Revient à la pose d'attente `100 + idleVariant`, immobile. */
  idle(): void {
    this.play(SNOID_SCRIPT_FIRST + this.idleVariant, FeatureFlag.stopEachImage);
    this.atRest = true;
  }

  /** Vrai en pose d'attente (ni marche, ni script joué, ni animation d'attente). */
  get resting(): boolean {
    return this.atRest && !this.waiting;
  }

  /** Vrai pendant une animation d'attente (état 6). */
  get playingWait(): boolean {
    return this.waiting;
  }

  /**
   * Joue l'animation d'attente `n` (0 à 7, `1168:4231` état 6) : `SCRS` `130 + n` (`138 + n` en variante 2) une fois, puis retour à l'attente.
   * Met en file une voix de code 4 ou 5 si les voix et effets sont actifs (tirage de 1 à 100, 4 jusqu'à 50). Sans effet hors de la pose d'attente.
   */
  playWait(n: number): void {
    if (!this.resting || this.destroyed) return;
    const { rng, prefs } = this.ctx;
    this.play(waitScriptId(this.idleVariant, n), FeatureFlag.stopAtEnd);
    this.waiting = true;
    if (prefs.effects) {
      const code = rng.range(1, 100) <= 50 ? 4 : 5;
      this.ctx.services.tryGet(ZOOMBINIS_SOUND)?.queue(snoidVoiceId(code, this.traits, (min, max) => rng.range(min, max)));
    }
  }

  /**
   * Un tick de l'état 0 de `1168:0ba8` (à appeler à chaque tick de la scène quand `waitAnimations` est actif) : à chaque échéance (`delay`),
   * le compteur avance ; passé `period` (`DS:235c`), il repart à 0 et une animation d'attente part une fois sur dix environ. Renvoie vrai
   * quand une animation vient de partir.
   */
  tickWait(period = WAIT_PERIOD): boolean {
    if (!this.waitAnimations || this.destroyed || !this.resting) return false;
    const now = this.ctx.clock.ticks;
    if (now < this.waitDue) return false;
    this.waitDue = now + this.delay;
    const before = this.waitCounter;
    this.waitCounter += 1;
    if (period === 0 || before <= period) return false;
    this.waitCounter = 0;
    // `DS:239a` (mode petit, `1168:5a13(0)`, posé par la ville, l'hôtel et XFER) : le compteur repart à 0 mais rien n'est tiré ni joué.
    if (this.isSmall) return false;
    if (this.ctx.rng.range(0, 100) >= WAIT_CHANCE) return false;
    this.playWait(this.ctx.rng.range(0, WAIT_ANIMATIONS - 1));
    return true;
  }

  /** Tourne le Zoombini (0 = droite, 1 = gauche) et redessine le script courant. */
  face(facing: 0 | 1): void {
    this.dir = facing;
    this.reload();
  }

  /** Change le sens (0 = droite, 1 = gauche) sans relire le script : l'image suivante (ou celle en cours de lecture) l'utilise (`+0xf2` inversé par un évènement). */
  setFacing(facing: 0 | 1): void {
    this.dir = facing;
  }

  /** Impose la pose des emplacements (`1168:4dc9`) à la place de celle du script ; null rend celle du script. Remis à null par `play` et `walkTo`. */
  setPose(pose: number | null): void {
    this.poseOverride = pose;
  }

  /** Bascule le mode petit (planche 3200) et redessine. */
  setSmall(small: boolean): void {
    this.isSmall = small;
    this.reload();
  }

  /**
   * Déplace le Zoombini sans relancer son script (`+0xa6`, `+0xa8` seuls, comme la boucle de transport de `1168:1742`) : l'image est recomposée
   * à la nouvelle position à la prochaine échéance de la feature (`delay`, 3 ticks pendant un transport). Les animations (marche, transport)
   * continuent donc de jouer, contrairement à `moveTo`, qui relit le script depuis sa première image.
   */
  setPosition(position: Point): void {
    this.pos = { ...position };
  }

  /** Pose le Zoombini ailleurs (annule une marche) et redessine le script courant. */
  moveTo(position: Point): void {
    this.walk = undefined;
    this.pos = { ...position };
    this.reload();
  }

  /**
   * Marche vers `destination` (`1168:2f9f` / `1168:2b30`). Avec une carte (`NODE` + `PATH`) le Zoombini choisit le chemin qui mène au
   * nœud le plus proche de la destination (`planPath`) ; sans elle, il va en ligne droite. Un pas toutes les `delay` ticks, voir
   * l'en-tête du fichier. `onArrive` est appelé à la fin.
   */
  walkTo(destination: Point, map: WalkMap = NO_MAP): void {
    this.atRest = false;
    this.waiting = false;
    this.kind = "base";
    this.poseOverride = null;
    this.arrival = undefined;
    this.map = map;
    this.walk = startWalk(map, this.pos, destination, this.dir);
    this.load(snoidWalkScriptId(this.traits.feet, this.walk.sector), 0);
  }

  /** Suit un chemin de `PATH` (indices de nœuds 1-based dans `nodes`, `parsePath`) jusqu'à son dernier nœud. */
  followPath(nodes: readonly NodePoint[], path: readonly number[]): void {
    const last = nodes[(path[path.length - 1] ?? 0) - 1];
    if (!last) throw new Error("followPath : chemin vide ou nœud inconnu");
    this.walkTo({ x: last.x, y: last.y }, { nodes, paths: [path] });
  }

  /** Retire le Zoombini de l'écran. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.walk = undefined;
    this.ctx.services.get(FEATURES).destroy(this.feature);
  }

  // --- interne ---

  private resolve(id: number): { script: Script; group: number } | undefined {
    const script = isCommonSnoidScript(id) ? this.assets.script(id) : this.scripts?.(id);
    return script && { script, group: 0 };
  }

  /** Charge un script dans la feature (`Features.setScript`), en gardant son rappel d'évènement (retiré à la fin d'un script). */
  private load(scriptId: number, flags: number): void {
    if (!this.resolve(scriptId)) throw new Error(`Snoid : SCRS ${scriptId} introuvable`);
    const features = this.ctx.services.get(FEATURES);
    this.id = scriptId;
    this.flags = flags;
    // Les bits d'ordre de dessin posés par l'écran restent (dans l'original, jouer un script ne réécrit pas `+0x20`).
    this.feature.flags = FeatureFlag.snoid | flags | (this.feature.flags & DRAW_ORDER_FLAGS);
    this.feature.onEvent = (_image, n) => this.event(n);
    features.setScript(this.feature, scriptId);
  }

  private reload(): void {
    this.load(this.id, this.flags);
  }

  /** Rappel d'évènement : fin de script, voix dépendantes du Zoombini (`0xc9…0xda`, `snoidVoiceIdForEvent`) ou autre évènement. */
  private event(n: number): void {
    if (this.destroyed) return;
    if (n === FEATURE_END) {
      if (this.waiting) {
        // Fin de l'animation d'attente (état 6) : retour à l'état 0, sans rappel de l'écran.
        this.idle();
        return;
      }
      if (this.arrival) this.pos = { ...this.arrival };
      this.onEnd?.(this);
      return;
    }
    const { rng } = this.ctx;
    const voice = snoidVoiceIdForEvent(n + 1, this.traits, (min, max) => rng.range(min, max));
    if (voice === undefined) this.onEvent?.(n, this);
    else this.ctx.services.tryGet(ZOOMBINIS_SOUND)?.queue(voice);
  }

  /**
   * `onImage` : avance la marche d'un pas puis compose l'image courante du script pour ce Zoombini. Les parties portent leur planche
   * (avec ses `REGS`, que `Features` retranche) ; les cases vides comptent pour l'emplacement (`image.cells` complètes).
   */
  private compose(feature: Feature, parts: FeaturePart[]): FeaturePart[] {
    const walk = this.walk;
    let arrived = false;
    let reload = false;
    if (walk) {
      const next = tickWalk(this.map, walk);
      this.walk = next;
      this.pos = { ...next.position };
      this.dir = next.facing;
      arrived = next.arrived;
      reload = next.scriptChanged;
    }
    const script = feature.script;
    const image = script?.images[feature.image];
    const composed = script && image
      ? composeSnoidCells(this.traits, image.cells, {
          kind: this.kind,
          pose: this.poseOverride ?? script.pose,
          facing: this.dir,
          small: this.isSmall,
          origin: this.kind === "base" ? this.pos : this.origin,
        }).map((part): FeaturePart => ({ w: part.index, x: part.x, y: part.y, sheet: this.assets.sheets[part.sheet] }))
      : parts;
    if (arrived) {
      this.walk = undefined;
      this.idle();
      this.onArrive?.(this);
    } else if (reload && this.walk) {
      // Nouveau secteur : autre script de marche, sans décaler l'échéance de l'image suivante.
      const next = feature.next;
      this.load(snoidWalkScriptId(this.traits.feet, this.walk.sector), 0);
      feature.next = next;
    }
    return composed;
  }

}

/** Crée un Zoombini animé sur l'écran courant (les features doivent être prêtes : `openScreen`). */
export function createSnoid(ctx: SceneContext, source: SnoidSource, options: SnoidOptions): Snoid {
  return new Snoid(ctx, source, options);
}
