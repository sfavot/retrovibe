import type { Compositor, Point } from "../render/compositor";
import { type ClockAdvance, advanceClock, stepCadence } from "./clock";
import type { EventFire } from "./events";
import { RAW_OFFSET, type BehaviorProc, type GameObject, type WorldState, rawU8, setRawU8 } from "./state";
import { type SpriteKey, type SpriteSource, animStep, spriteKeyOf } from "./animation";

/**
 * Mise à jour des objets et liste de dessin (`docs/armaeth/engine.md` § 4 et § 6.2, `majObjet` = `1890:0006`).
 * Module pur : le déplacement, les procédures de comportement et les gestionnaires d'événements sont injectés.
 */

/** `Err` d'un objet en transit d'une salle à l'autre (`Err = 0x12`, `engine.md` § 5.4). */
export const ERR_TRANSIT = 0x12;

/** Valeur rendue par une mise à jour qui n'a rien à signaler (vrai du moteur). */
export const UPDATE_OK = 7;

/** Index de la table de procédures de `1ec8:000a` selon `Typ` : 7 interface, 3 décors, 2 objets (`engine.md` § 9.1). */
export const BEHAVIOR_TABLE = { interface: 7, decor: 3, object: 2 } as const;

/** Arrêt fatal du moteur (`gm_abort`, `engine.md` § 6.2 : 0x7a, 0x28 ou 0x27 quand une procédure manque). */
export class EngineAbort extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "EngineAbort";
  }
}

/** Déplacement (`179d:0004`) et annulation des trajets (`gm_reset_object_motion`) : fournis par le module de mouvement. */
export interface MoverHooks {
  /** Déplace l'objet d'un tic (`Mob == 2`). */
  move(obj: GameObject): void;
  /** Annule le déplacement et le trajet de l'objet (sortie de transit). */
  reset(obj: GameObject): void;
}

/** Résolution des procédures `Fct` par `Num` (`1ec8:000a`, tables 7, 3 et 2) : fournie par les modules de comportement. */
export interface BehaviorResolver {
  /** `undefined` ou `null` si l'objet n'a pas de procédure dans cette table (arrêt du moteur). */
  resolve(obj: GameObject, table: number): BehaviorProc | null | undefined;
}

export interface UpdateHooks {
  sprites: SpriteSource;
  mover: MoverHooks;
  behaviors: BehaviorResolver;
  /** Gestionnaire d'un événement différé échu (famille 8 de `1ec8:000a`). Défaut : rien. */
  fire?: EventFire;
  /** Appelé à chaque tic de monde après l'horloge (lumière : recalcul de la palette si `paletteDirty`). */
  onClock?: (advance: ClockAdvance) => void;
}

/**
 * `majObjet` (`1890:0006`). Rend 0 si la boucle doit recommencer la liste en tête, `UPDATE_OK` sinon (valeur de la procédure
 * `Fct` quand l'objet en a une).
 *
 * - `Err == 0x12` (transit) : le héros est laissé tel quel (retour 7), les autres voient leur mouvement annulé et `Err` remis à 0 ;
 * - `Mob == 1` : un pas d'animation si l'objet est animable ; `Mob == 2` : le déplacement si l'objet peut bouger. Les objets
 *   d'interface font les deux toujours, les décors seulement dans la salle chargée, les objets dans la salle chargée ou
 *   d'icône d'inventaire (`Xyp` 8 ou 0x0B) pour l'animation, et se déplacent quand ils sont rangés dans une salle (`Cod == 1`).
 */
export function updateObject(state: WorldState, obj: GameObject, hooks: UpdateHooks): number {
  if (rawU8(obj, RAW_OFFSET.err) === ERR_TRANSIT) {
    if (obj === state.hero) return UPDATE_OK;
    hooks.mover.reset(obj);
    setRawU8(obj, RAW_OFFSET.err, 0);
  }
  const inRoom = state.loadedRoom !== null && obj.location === 1 && obj.holder === null && obj.room === state.loadedRoom;
  const special = obj.presence === 8 || obj.presence === 0x0b;
  let animate: boolean;
  let move: boolean;
  let table: number;
  let code: number;
  switch (obj.typ) {
    case 0:
      animate = move = true;
      table = BEHAVIOR_TABLE.interface;
      code = 0x7a;
      break;
    case 1:
      animate = move = inRoom;
      table = BEHAVIOR_TABLE.decor;
      code = 0x28;
      break;
    default:
      animate = inRoom || special;
      move = obj.location === 1;
      table = BEHAVIOR_TABLE.object;
      code = 0x27;
  }
  if (obj.mob === 1) {
    if (animate) animStep(obj, hooks.sprites, 0);
  } else if (obj.mob === 2) {
    if (move) hooks.mover.move(obj);
  }
  if (obj.gst !== 7) return UPDATE_OK;
  if (!obj.behavior) {
    obj.behavior = hooks.behaviors.resolve(obj, table) ?? null;
    if (!obj.behavior) throw new EngineAbort(code, `Aucune procédure pour l'objet ${obj.num} (série ${obj.serial}, table ${table})`);
  }
  return obj.behavior(obj);
}

/** Garde-fou contre une procédure qui rendrait 0 sans fin (le moteur d'origine se bloquerait). */
const MAX_RESTARTS = 10000;

/**
 * Parcours d'une liste (`engine.md` § 4) : le suivant est lu **avant** la mise à jour ; si l'objet rend 0, a disparu de la liste
 * ou a changé de suivant, le parcours recommence en tête (un objet peut donc être mis à jour deux fois dans un tic : défaut de
 * l'original reproduit, `engine.md` § 12.4). `list` est relue à chaque reprise (les listes sont modifiées sur place).
 */
export function updateList(state: WorldState, list: () => readonly GameObject[], hooks: UpdateHooks): void {
  let restarts = 0;
  for (;;) {
    const objects = list();
    let current: GameObject | undefined = objects[0];
    let restart = false;
    while (current) {
      const at = objects.indexOf(current);
      const next: GameObject | undefined = objects[at + 1];
      const result = updateObject(state, current, hooks);
      const now = objects.indexOf(current);
      if (result === 0 || now < 0 || objects[now + 1] !== next) {
        restart = true;
        break;
      }
      current = next;
    }
    if (!restart) return;
    if (++restarts > MAX_RESTARTS) throw new Error("Mise à jour : une procédure rend 0 sans fin");
  }
}

/** Efface la procédure mémorisée des objets de type 2 du chapitre (jeton `cle`, `engine.md` § 9.3) : elle sera résolue de nouveau. */
export function clearBehaviors(state: WorldState, chapter: number): void {
  for (const obj of state.objects) if (Math.floor(obj.num / 100) === chapter) obj.behavior = null;
}

export interface FrameOptions {
  /** Une touche reconnue a été lue : force un tic de monde (`engine.md` § 12.1). */
  keyPressed?: boolean;
}

export interface FrameResult {
  /**
   * `reload` : la salle voulue n'est pas la salle chargée, la boucle doit recharger (`room.ts`) avant de poursuivre ;
   * seuls les objets d'interface ont été mis à jour.
   */
  status: "ran" | "reload";
  /** Tic de monde dans cette image. */
  tick: boolean;
  /** C'était la première image de la salle (objets de type 2 et horloge non mis à jour). */
  firstFrame: boolean;
  /** Avance de l'horloge, si elle a avancé. */
  clock?: ClockAdvance;
}

/**
 * Une image de la boucle principale (`18a9:0100..0300`) sans dessin ni attente : objets d'interface à chaque image ; puis,
 * si la salle voulue est la salle chargée, tic de monde selon la cadence : décors (liste B) au tic et à la première image,
 * puis (hors première image) objets de type 2, file d'événements différés et horloge.
 * hypothèse (engine.md §4) : le test « héros sans salle » et la lecture du clavier (`e5e`) sont à la charge de l'appelant ;
 * `keyPressed` n'est lu que si l'appelant l'a déjà filtré.
 */
export function runFrame(state: WorldState, hooks: UpdateHooks, options: FrameOptions = {}): FrameResult {
  updateList(state, () => state.interfaceObjects, hooks);
  const room = state.loadedRoom;
  if (state.wantedRoom !== room || !room) return { status: "reload", tick: false, firstFrame: false };
  const tick = stepCadence(state.cadence, options.keyPressed ?? false);
  const first = state.firstFrame;
  if (tick || first) updateList(state, () => room.listB, hooks);
  let clock: ClockAdvance | undefined;
  if (first) state.firstFrame = false;
  else if (tick) {
    updateList(state, () => state.objects, hooks);
    state.events.tick(hooks.fire ?? (() => {}));
    clock = advanceClock(state.clock);
    hooks.onClock?.(clock);
  }
  return { status: "ran", tick, firstFrame: first, clock };
}

// --- liste de dessin ---------------------------------------------------------------------------------------------------

/** Ordre de dessin d'une image : une commande par objet visible, à passer au compositeur dans cet ordre. */
export interface DrawCommand {
  /** Ressource sprite et numéro d'image. */
  resource: SpriteKey;
  frame: number;
  /** `X` (centre) et `Y` (pied) de l'objet ; `priority` = `P` (octet bas). */
  x: number;
  y: number;
  priority: number;
  /** Miroir horizontal (`+0x44`). */
  flip: boolean;
  /** `Inv` (+0x2F) : non nul = silhouette « fantôme » (option `ghost` du compositeur). */
  ghost: number;
  /** Liste de salle (`flags & 7`) : le dessin s'ajoute au décalage (`x`, `y`) de la fenêtre de la scène. */
  relative: boolean;
  /** Objet mobile (`Mob != 0`) : annulé à chaque image ; sinon il reste dans le fond. */
  dynamic: boolean;
  serial: number;
}

export type DrawPass = "dynamic" | "static" | "all";

/**
 * Liste de dessin (`engine.md` § 6.4). Dynamique (chaque image) : contenu de l'objet sélectionné, objets d'interface, contenu
 * du héros, décors, objets de la salle. Statique (`redessinStatique`, dans le fond) : contenu de la sélection, décors, objets
 * de la salle, contenu du héros, objets d'interface. `all` = le statique puis le dynamique. Seuls les objets de `Xyp != 0` et dont
 * l'image est choisie sont dessinés, ceux de `Mob == 0` dans la passe statique et les autres dans la dynamique.
 */
export function drawList(state: WorldState, pass: DrawPass = "all"): DrawCommand[] {
  const out: DrawCommand[] = [];
  const room = state.loadedRoom;
  const selected = state.selected?.contents ?? [];
  const inventory = state.hero?.contents ?? [];
  const decors = room?.listB ?? [];
  const objects = room?.listA ?? [];
  const interfaces = state.interfaceObjects;
  const add = (list: readonly GameObject[], dynamic: boolean, relative: boolean) => {
    for (const obj of list) {
      if (obj.presence === 0 || obj.anim.frame < 0 || (obj.mob !== 0) !== dynamic) continue;
      const resource = spriteKeyOf(obj);
      if (!resource) continue;
      out.push({
        resource,
        frame: obj.anim.frame,
        x: obj.x,
        y: obj.y,
        priority: obj.p & 0xff,
        flip: obj.anim.mirror !== 0,
        ghost: obj.hidden,
        relative,
        dynamic,
        serial: obj.serial,
      });
    }
  };
  if (pass !== "dynamic") {
    add(selected, false, false);
    add(decors, false, true);
    add(objects, false, true);
    add(inventory, false, false);
    add(interfaces, false, false);
  }
  if (pass !== "static") {
    add(selected, true, false);
    add(interfaces, true, false);
    add(inventory, true, false);
    add(decors, true, true);
    add(objects, true, true);
  }
  return out;
}

/**
 * Exécute les commandes sur le compositeur, dans l'ordre. `origin` = coin de la fenêtre de la scène (`x`, `y` de son en-tête),
 * ajouté aux commandes `relative`. Les images absentes de la ressource (cas `INT 3 Fig 2`) sont ignorées. Rend le nombre de
 * sprites dessinés.
 */
export function applyDrawCommands(compositor: Compositor, commands: readonly DrawCommand[], sprites: SpriteSource, origin: Point): number {
  let drawn = 0;
  for (const c of commands) {
    const frame = sprites.get(c.resource)?.frames[c.frame];
    if (!frame) continue;
    compositor.blitSprite(frame, c.x, c.y, c.priority, { flip: c.flip, ghost: c.ghost, dynamic: c.dynamic, origin: c.relative ? origin : undefined });
    drawn++;
  }
  return drawn;
}
