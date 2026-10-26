import type { Lcg } from "../../../engine/rng";
import type { AniTable } from "../data/tables";
import type { DeferredEvent } from "../data/world";
import type { SpriteLibrary } from "./animation";
import type { EventOpCode, EventTarget } from "./events";
import { FOLLOW_WALKING } from "./paths";
import type { SearchArgs } from "./placement";
import type { ExitResult } from "./room";
import type { GameObject, GameRoom, ScoreAward, WorldState } from "./state";
import { UPDATE_OK } from "./update";

/**
 * Gestionnaires du moteur d'*Armaeth* : registre `(famille, clé) -> fonction` (`1ec8:000a`, `docs/armaeth/parser.md` § 6.4) et
 * contexte que reçoivent les fonctions (`HandlerContext` pour une phrase, `BehaviorContext` pour une procédure d'objet ou un
 * événement différé). Les gestionnaires de verbes, par type d'objet et les IA des personnages s'enregistrent ici : ce module ne
 * porte que le verbe par défaut (`333c:0008`) et le noyau minimal du héros et de l'interface.
 */

/** Numéros de famille de `1ec8:000a` (`parser.md` § 6.4). */
export const FAMILY = {
  /** Clé : numéro du verbe. */
  verb: 0,
  /** Clé : `Num` de l'objet direct (porte de chapitre). */
  direct: 1,
  /** Clé : `Num` d'un objet de type 2 (porte de chapitre) : procédure `Fct` des personnages. */
  character: 2,
  /** Clé : `Num` d'un décor : procédure `Fct`. */
  decor: 3,
  /** Clé : numéro de la commande système (classe 24). */
  system: 4,
  /** Clé : `Num` de l'objet indirect (porte de chapitre). */
  indirect: 5,
  /** Clé : numéro du nom propre (classe 13), mots magiques. */
  name: 6,
  /** Clé : `Num` d'un objet d'interface : procédure `Fct` (1 curseur, 2 bouton désactivé, 5 joyau). */
  interface: 7,
  /** Clé : procédure d'un événement différé. */
  event: 8,
  /** Clé : `Num` du héros contrôlé : réaction « trop loin ». */
  reaction: 9,
} as const;
export type Family = (typeof FAMILY)[keyof typeof FAMILY];

/** Familles dont la clé passe la porte de chapitre `DGROUP:4b1e[clé / 100]` (`parser.md` § 6.4). */
const GATED: ReadonlySet<number> = new Set([FAMILY.direct, FAMILY.character, FAMILY.indirect, FAMILY.reaction]);

// --- contexte ----------------------------------------------------------------------------------------------------------

/** Un objet désigné par la phrase ou le clic, avec ce que le moteur en sait (drapeaux A et B de `206a:0002`). */
export interface HandlerTarget {
  /** Code du nom (`15000 + Num` pour un objet, `4000 + Num` pour un décor) ; 0 = aucun nom. */
  code: number;
  object: GameObject | null;
  /** Drapeau A : l'objet est dans l'inventaire du héros (7 pour le héros lui-même). */
  held: boolean;
  /** Drapeau B : à portée du héros. */
  inReach: boolean;
}

export const NO_TARGET: HandlerTarget = { code: 0, object: null, held: false, inReach: false };

/** Messages : file à priorité (`1e58:000a`) et affichage immédiat (`200c:0004`). */
export interface HandlerMessages {
  /** `enq(priorité, classe, numéro)` : n'est affiché qu'en fin de commande, et seulement si aucun gestionnaire n'a réussi. */
  enqueue(priority: number, cls: string | number, number: number): void;
  /** Affiche tout de suite, dans une fenêtre qui attend un clic ou Entrée. */
  say(cls: string | number, number: number): void;
  /**
   * `21ad:000a(vide, en-tête, séparateur, liste)` : fenêtre « en-tête (`V<header>`) puis le nom `O<Num>` de chaque objet non caché
   * (`Inv = 0`) qui n'est pas le héros » ; liste vide : message `V<empty>`. `lines` (séparateur 7) : un nom par ligne, sinon à la suite
   * séparés par des virgules (hypothèse sur la mise en forme, non relevée).
   */
  listObjects(objects: readonly GameObject[], empty: number, header: number, lines: boolean): void;
}

export interface HandlerSound {
  /** `gm_sound_play(id, classe, numéro, boucle)`. */
  play(id: number, cls: string | number, number: number, loop?: boolean): boolean;
  /** `gm_sound_select_track(classe, numéro, priorité, boucle)`. */
  effect(cls: string | number, number: number, priority: number, loop?: boolean): number;
  stop(): void;
  /** `2f9b:0375` : arrête l'effet en cours (et libère sa priorité), PAS la musique ; avec `(cls, num)` seulement s'il s'agit de cet effet. */
  stopEffect(cls?: string | number, num?: number): void;
  /** `gm_sound_select_track` : même appel que `effect`. */
  selectTrack(cls: string | number, number: number, priority: number, loop?: boolean): number;
}

export interface HandlerEvents {
  /**
   * `23a2:0002(objet, événement, opération, valeur)`. Fait grandir la file de 5 entrées quand elle est pleine, comme le moteur
   * (la capacité de `CFG` est 0). `procedure` : clé de la famille 8, utilisée à la création.
   */
  operate(target: EventTarget, event: number, op: EventOpCode, value?: number, procedure?: number): number | undefined;
}

export interface HandlerScore {
  /** `2255:00e8(chapitre, indice)` : points, jingle éventuel joué. */
  award(chapter: number, index: number): ScoreAward | null;
  /** `14cf:000c(en-tête)` : l'écran du score et du verdict (`S50` au couronnement, `characters.md` § 10.3), en fenêtre plein écran. */
  verdict(header: number): void;
}

export interface HandlerRooms {
  /** `4b80 := salle` : la boucle principale recharge à l'image suivante. */
  want(room: GameRoom): void;
  /** `186d:000c` : franchit la sortie `Inf` de l'objet (`Err 0x0B`). */
  exit(obj: GameObject): ExitResult;
  /** Limites de marche `4aca` (X max) et `4ad6` (P max) de la salle chargée, `null` sans salle. */
  limits(): { xMax: number; pMax: number } | null;
  /** `4ae0` : nombre de plans actifs de la salle chargée. */
  planes(): number;
  /** `147f:000a` : recalcule les plans actifs de la salle chargée après un changement d'état d'un mécanisme. */
  refreshPlanes(): void;
}

export interface HandlerMotion {
  /** `gm_reset_object_motion` : annule le trajet et les vitesses horizontales. */
  reset(obj: GameObject): void;
  /** `placer(o, mode)` (`1aba:000e`) : `Err` de l'objet (0, 0x11 ou un échec). */
  place(obj: GameObject, mode: number): number;
  /** `gm_object_behavior_main` (`1b11:000c`) avec des bornes explicites : `Err` de l'objet (0, 0x11 ou un échec de la recherche). */
  search(obj: GameObject, args: SearchArgs): number;
  /** Suivi du trajet (`30d9:0006`) : `FOLLOW_*` de `paths.ts`. */
  followPath(obj: GameObject): number;
  /** Trajet vers un point de la salle chargée (`gm_compute_path`) : faux si aucun chemin. */
  pathTo(obj: GameObject, x: number, y: number, p: number, plane: number): boolean;
  /**
   * Fin d'un trajet (arrivée ou abandon, `2363:01ea`) : rejeu de la commande en attente, recalcul unique d'un trajet bloqué puis
   * `G44` ; le mouvement s'arrête avec `Err = 0x11`. Rend vrai quand la marche reprend (recalcul réussi : rien n'est arrêté).
   */
  pathEnd(obj: GameObject, result: number): boolean;
}

/** Réaction « trop loin » (`2363:000c`, `2363:0154`, `2363:01ea` ; parser.md § 6.7). */
export interface HandlerReaction {
  /**
   * `2363:000c(cible)` : appelle le gestionnaire de la famille 9 de clé `Num` du héros ; s'il répond vrai, mémorise la phrase en cours
   * (verbe, préposition, objets direct, indirect et visé) et arme la réaction. Rend ce que répond le gestionnaire.
   */
  arm(target: GameObject | null): boolean;
  /** `2363:01ea` : rejoue la commande mémorisée (appelé à l'arrivée du trajet). Rend vrai si une commande était en attente. */
  replay(): boolean;
  /** Une réaction est armée (`4cc8`). */
  readonly armed: boolean;
}

/** Décors nommés de la salle chargée et table de messages (`DGROUP:4b14`, `1e08:0014`, `gm_get_message`). */
export interface HandlerScene {
  /** `1e08:0014(code)` : indice de l'enregistrement de décor (point sensible à message) de ce code dans la salle chargée, sinon -1. */
  decorIndex(code: number): number;
  /** Le message `(classe, numéro)` existe dans la table (sinon le jeu affiche `S045`). */
  hasMessage(cls: string | number, number: number): boolean;
}

/** Ce que reçoivent les procédures `Fct` et les événements différés. */
export interface BehaviorContext {
  readonly state: WorldState;
  /** Héros contrôlé (`4bfe`). */
  readonly hero: GameObject | null;
  /** Salle chargée (`4b84`). */
  readonly room: GameRoom | null;
  readonly messages: HandlerMessages;
  /** `1a37:0002` : relance l'animation de l'objet après un changement d'apparence (`setFig`). */
  refreshObject(obj: GameObject): void;
  /** Mort d'un objet (`die(obj, cause, classe, numéro)`) : fourni par le module des personnages, absent tant qu'il n'est pas branché. */
  die?(obj: GameObject, cause: number, cls?: string | number, number?: number): void;
  /** Animation à deux (`playAnimation(obj, id, partenaire, classe, numéro)`) : idem. */
  playAnimation?(obj: GameObject, id: number, partner?: GameObject | null, cls?: string | number, number?: number, ego?: number): void;
  /** Ressources de sprites (`A1F*.VGA`, `A1FDEF.SYS`). */
  readonly sprites: SpriteLibrary;
  /** `A1FANI.SYS`. */
  readonly ani: AniTable;
  readonly sound: HandlerSound;
  readonly events: HandlerEvents;
  readonly score: HandlerScore;
  readonly rooms: HandlerRooms;
  readonly motion: HandlerMotion;
  readonly scene: HandlerScene;
  /** `rand()` du jeu (15 bits, `Lcg` de Microsoft C). */
  readonly rng: Lcg;
}

/** Variables d'une phrase (`DGROUP:4cba..4dcc`) et services : l'argument de tous les gestionnaires de verbes et d'objets. */
export interface HandlerContext extends BehaviorContext {
  /** `4cba` : numéro du verbe (`code % 1000`). */
  readonly verb: number;
  /** `4cbc` : préposition (1 dans, 2 hors, 3 sur, 4 sous, 5 devant, 6 derrière, 7 avec, 8 à), 0 = aucune. */
  preposition: number;
  /** `4cc4` : drapeau « bavard » (faux pour un clic ou une phrase vide). */
  readonly talk: boolean;
  /** Objet direct / indirect de l'itération courante. */
  readonly direct: HandlerTarget;
  readonly indirect: HandlerTarget;
  /** `22fc:065b` : le gestionnaire de verbe n'est pas appelé pour cette itération. */
  disableVerb(): void;
  /** Réaction « trop loin » (`2363:000c`). */
  readonly reaction: HandlerReaction;
  /** Raccourci de `reaction.arm(cible)`. */
  react(target: GameObject | null): boolean;
}

// --- gestionnaires -----------------------------------------------------------------------------------------------------

/** Gestionnaire de phrase (familles 1, 4, 5, 6) : 0 = non traité, autre = succès (1 ou 7). */
export type ObjectHandler = (ctx: HandlerContext) => number;

/** Gestionnaire de verbe (famille 0). `policy` est la valeur rendue à l'appel `AX = 7` : 0 premier succès arrête tout, 2 passe à l'indirect suivant, impair parcourt tout. */
export interface VerbHandler {
  policy: number;
  run(ctx: HandlerContext): number;
}

/** Procédure `Fct` (familles 2, 3, 7) : rend `UPDATE_OK` (7), ou 0 pour recommencer le parcours de la liste. */
export type BehaviorHandler = (obj: GameObject, ctx: BehaviorContext) => number;

/** Gestionnaire d'événement différé (famille 8) ; `target` est l'objet de l'entrée s'il existe encore. */
export type EventHandler = (ctx: BehaviorContext, entry: Readonly<DeferredEvent>, target: GameObject | undefined) => void;

/** Réaction « trop loin » (famille 9, `2363:000c`) : vrai si le héros contrôlé peut marcher vers l'objet visé. */
export type ReactionHandler = (hero: GameObject, ctx: HandlerContext) => boolean;

export interface HandlerTypes {
  0: VerbHandler;
  1: ObjectHandler;
  2: BehaviorHandler;
  3: BehaviorHandler;
  4: ObjectHandler;
  5: ObjectHandler;
  6: ObjectHandler;
  7: BehaviorHandler;
  8: EventHandler;
  9: ReactionHandler;
}

/** Clés des 23 verbes du gestionnaire par défaut `333c:0008` (`parser.md` § 6.4). */
export const DEFAULT_VERB_KEYS: readonly number[] = [1, 2, 3, 4, 8, 11, 12, 18, 19, 21, 22, 23, 24, 25, 26, 30, 31, 32, 34, 37, 38, 39, 40];

/**
 * Verbe par défaut `333c:0008` (`parser.md` § 8.1) : met en file `V029` si un nom est présent (direct ou indirect), sinon `V023`,
 * à la priorité 0, et ne réussit jamais.
 */
export const defaultVerb: VerbHandler = {
  policy: 0,
  run(ctx) {
    ctx.messages.enqueue(0, "V", ctx.direct.code !== 0 || ctx.indirect.code !== 0 ? 29 : 23);
    return 0;
  },
};

/** Registre `(famille, clé) -> gestionnaire`. Vide à la construction, sauf le verbe par défaut. */
export class HandlerRegistry {
  private readonly tables = new Map<number, Map<number, unknown>>();
  /** `DGROUP:4b1e` : portes de chapitre (jeton `cle`), fermées au départ ; 10 mots. */
  readonly gates: number[] = new Array<number>(10).fill(0);

  constructor() {
    this.register(FAMILY.verb, DEFAULT_VERB_KEYS, defaultVerb);
  }

  register<F extends Family>(family: F, key: number | readonly number[], handler: HandlerTypes[F]): this {
    let table = this.tables.get(family);
    if (!table) this.tables.set(family, (table = new Map()));
    for (const k of typeof key === "number" ? [key] : key) table.set(k, handler);
    return this;
  }

  /** Gestionnaire enregistré, sans tenir compte des portes de chapitre. */
  get<F extends Family>(family: F, key: number): HandlerTypes[F] | undefined {
    return this.tables.get(family)?.get(key) as HandlerTypes[F] | undefined;
  }

  /** Porte de chapitre de la clé (`4b1e[clé / 100]`) ; les familles sans porte sont toujours ouvertes. */
  isOpen(family: Family, key: number): boolean {
    return !GATED.has(family) || (this.gates[Math.floor(key / 100)] ?? 0) !== 0;
  }

  /** `1ec8:000a` : le gestionnaire si la porte est ouverte, sinon `undefined` (l'appelant applique le défaut de la famille). */
  resolve<F extends Family>(family: F, key: number): HandlerTypes[F] | undefined {
    return this.isOpen(family, key) ? this.get(family, key) : undefined;
  }
}

// --- noyau minimal : héros et interface ----------------------------------------------------------------------------------

/** `Err` que la procédure du héros traite ici (`characters.md` § 3.1) ; les autres sont acquittés sans effet. */
const ERR_EXIT = 0x0b;
const ERR_TRANSIT = 0x12;

/**
 * Noyau minimal de `246c:000a` pour le héros (`Num 1`), assez pour le faire marcher : sortie de salle (`Err 0x0B`), suivi du
 * trajet du clic (`30d9:0006`) ou, à défaut, acquittement de l'`Err` du dernier pas pour que le mouvement continue
 * (`246c:08f4`). Les réactions au sol, les morts, les chutes, l'escalade et les états `Ego` 1 à 8 sont à brancher (tâche I2).
 */
export const heroBehavior: BehaviorHandler = (hero, ctx) => {
  if (hero.err === ERR_EXIT) {
    const exit = ctx.rooms.exit(hero);
    if (exit === "transit") return UPDATE_OK;
  }
  if (hero.path.defined) {
    const result = ctx.motion.followPath(hero);
    if (result !== FOLLOW_WALKING) ctx.motion.pathEnd(hero, result);
    return UPDATE_OK;
  }
  if (hero.err !== ERR_TRANSIT) hero.err = 0;
  return UPDATE_OK;
};

/** `1537:000e` : le bouton désactivé devient statique. */
export const disabledButton: BehaviorHandler = (obj) => {
  obj.gst = 0;
  obj.mob = 0;
  return UPDATE_OK;
};

/** Procédure sans effet : le curseur (`1564:0004`) est conduit par `InterfaceController`, le joyau (`1611:000c`) n'est jamais créé. */
export const idleBehavior: BehaviorHandler = () => UPDATE_OK;

/** Enregistre le noyau minimal : héros (table 2, clé 1) et objets d'interface (table 7, clés 1, 2, 5). */
export function registerCoreBehaviors(registry: HandlerRegistry): void {
  registry.register(FAMILY.character, 1, heroBehavior);
  registry.register(FAMILY.interface, 1, idleBehavior);
  registry.register(FAMILY.interface, 2, disabledButton);
  registry.register(FAMILY.interface, 5, idleBehavior);
}
