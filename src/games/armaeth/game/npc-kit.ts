import type { AniTable } from "../data/tables";
import { type AnimationEvent, type SpriteSource, startScriptedAnimation, tickScriptedAnimation } from "../engine/animation";
import type { BehaviorContext } from "../engine/handlers";
import { FOLLOW_ARRIVED, FOLLOW_ARRIVED_FREE, FOLLOW_WALKING } from "../engine/paths";
import { type GameObject, type GameRoom, RAW_OFFSET } from "../engine/state";
import { UPDATE_OK } from "../engine/update";
import { createCorpse } from "./hero";
import { NUM, OFF, type SpawnFields, type StateChange, approach, canCarry, copyPosition, destroy, flag, inLoadedRoom, roomOf, sayHere, sayNear, setFlag, setState, setWord, wander, word } from "./helpers";

/**
 * Boîte à outils des personnages d'*Armaeth* (`docs/armaeth/characters.md` § 1 : primitives communes) : changement d'état
 * `1a37:*`, messages `209c:*`, perception `219b:0000`, mise en cible `22ef:0000`, errance `2151:0006`, sortie `228e:0000`,
 * suivi de trajet `30d9:0006` (en salle et hors salle), contact `2120:0008`, création et destruction d'objets.
 *
 * Les animations scénarisées (`ANM`, `16f5:0132` / `16f5:02a2`) passent par `NpcAnimations` : `contextAnimations` (défaut) utilise
 * `ctx.sprites` et `ctx.ani` ; `instantAnimations` fait finir toute animation au tic suivant (tests).
 */

// --- animations scénarisées --------------------------------------------------------------------------------------------------

export interface NpcAnimationStart {
  /** Identifiant `ANI` (1 à 47). */
  id: number;
  /** `Gst`, `Mob`, `Ego` (défauts : 7, 1, `Ego` courant). */
  gst?: number;
  mob?: number;
  ego?: number;
  hor?: number;
  ver?: number;
  prf?: number;
  /** Partenaire (combat) : chacun reçoit la `Ser` de l'autre dans `Bag`. */
  partner?: GameObject | null;
}

/** Service d'animations scénarisées (`16f5:0132`, `16f5:02a2`, `1a37:*` pour `Fig`). */
export interface NpcAnimations {
  start(ctx: BehaviorContext, obj: GameObject, params: NpcAnimationStart): void;
  /** Un tic (`16f5:02a2`) : id de l'animation qui vient de finir, 0 tant qu'elle dure. */
  poll(ctx: BehaviorContext, obj: GameObject): number;
  /** Recharge l'image après un changement de `Fig` (`1a37:*` re-place l'objet). */
  refresh(ctx: BehaviorContext, obj: GameObject): void;
}

/** Ressources des animations scénarisées : sprites et table `A1FANI.SYS`. */
export interface AnimationResources {
  sprites: SpriteSource;
  ani: AniTable;
}

/** Service réel : ressources sprite et table `ANI` fournies par `resources`, sons (`gm_sound_play(…, 7, 0, 7)` en boucle, arrêtés à la fin). */
export function createAnimations(resources: (ctx: BehaviorContext) => AnimationResources): NpcAnimations {
  return {
    start(ctx, obj, p) {
      const { sprites, ani } = resources(ctx);
      ctx.motion.reset(obj);
      const events = startScriptedAnimation(obj, sprites, ani, {
        id: p.id,
        gst: p.gst ?? 7,
        mob: p.mob ?? 1,
        ego: p.ego ?? obj.ego,
        hor: p.hor ?? 0,
        ver: p.ver ?? 0,
        prf: p.prf ?? 0,
        partner: p.partner ?? null,
        audible: obj.room !== null && obj.room === ctx.room,
      });
      playEvents(ctx, events);
    },
    poll(ctx, obj) {
      const { sprites, ani } = resources(ctx);
      const tick = tickScriptedAnimation(obj, sprites, ani, obj.room !== null && obj.room === ctx.room);
      playEvents(ctx, tick.events);
      return tick.finished;
    },
    refresh(ctx, obj) {
      ctx.refreshObject(obj);
    },
  };
}

/** Service par défaut : `ctx.sprites` et `ctx.ani`. */
export const contextAnimations: NpcAnimations = createAnimations((ctx) => ({ sprites: ctx.sprites, ani: ctx.ani }));

function playEvents(ctx: BehaviorContext, events: AnimationEvent[]): void {
  for (const event of events) {
    if (event.type === "sound") ctx.sound.play(event.id, event.soundClass, event.number, event.loop);
  }
}

/**
 * Service de repli : l'état de l'animation est posé (`Anm`, `Gst`, `Mob`, `Ego`, vitesses, partenaire) mais elle finit au tic
 * suivant, sans durée ni image. Suffit à enchaîner les tables de résolution quand le moteur n'expose pas les ressources.
 */
const justStarted = new WeakSet<GameObject>();

export const instantAnimations: NpcAnimations = {
  start(ctx, obj, p) {
    justStarted.add(obj);
    ctx.motion.reset(obj);
    setWord(obj, RAW_OFFSET.bag, p.partner?.serial ?? 0);
    if (p.partner) setWord(p.partner, RAW_OFFSET.bag, obj.serial);
    obj.animId = p.id;
    obj.speedX = p.hor ?? 0;
    obj.speedY = p.ver ?? 0;
    obj.speedP = p.prf ?? 0;
    obj.gst = p.gst ?? 7;
    obj.mob = p.mob ?? 1;
    obj.ego = p.ego ?? obj.ego;
    obj.fig = 0;
  },
  poll(_ctx, obj) {
    const id = obj.animId;
    if (id === 0) return 0;
    if (justStarted.delete(obj)) return 0;
    obj.animId = 0;
    obj.err = 0;
    return id;
  },
  refresh(_ctx, obj) {
    obj.anim.dir = 0xff;
  },
};

// --- changement d'état -------------------------------------------------------------------------------------------------------

/** Valeur de retour d'une procédure `Fct` qui a détruit l'objet ou doit recommencer le parcours de la liste. */
export const RESTART = 0;
export { UPDATE_OK };

/** Un trajet est en cours (`Def`). */
export const hasPath = (obj: GameObject): boolean => obj.path.defined;

/** Sens -1, 0, +1. */
export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

export class NpcKit {
  constructor(readonly animations: NpcAnimations = contextAnimations) {}

  // --- hasard ---------------------------------------------------------------------------------------------------------------

  /** `gm_chance_one_in(n)` (`1e08:0000`) : `rand() % n == 0`. */
  chance(ctx: BehaviorContext, n: number): boolean {
    return ctx.rng.mod(n) === 0;
  }

  // --- localisation ---------------------------------------------------------------------------------------------------------

  /** L'objet est posé dans la salle chargée. */
  inLoadedRoom(ctx: BehaviorContext, obj: GameObject): boolean {
    return inLoadedRoom(ctx, obj);
  }

  /** Salle de l'objet (celle de son conteneur si besoin). */
  roomOf(obj: GameObject): GameRoom | null {
    return roomOf(obj);
  }

  isPlayer(ctx: BehaviorContext, obj: GameObject): boolean {
    return ctx.hero === obj;
  }

  // --- messages ---------------------------------------------------------------------------------------------------------------

  /** `209c:0092` (`helpers.sayNear`). */
  sayNear(ctx: BehaviorContext, obj: GameObject, cls: string, number: number): void {
    sayNear(ctx, obj, cls, number);
  }

  /** `209c:000c` (`helpers.sayHere`). */
  sayHere(ctx: BehaviorContext, obj: GameObject, cls: string, number: number): void {
    sayHere(ctx, obj, cls, number);
  }

  // --- état -------------------------------------------------------------------------------------------------------------------

  /**
   * `1a37:007f` / `003a` / `0002` (`helpers.setState`), puis le service d'animation recharge l'image si `Fig` ou `Ego` change.
   */
  setState(ctx: BehaviorContext, obj: GameObject, change: StateChange, mode = 0xff): void {
    const figChanged = change.fig !== undefined && change.fig !== obj.fig;
    setState(ctx, obj, change, mode);
    if (figChanged || change.ego !== undefined) this.animations.refresh(ctx, obj);
  }

  /** `Ego` et `Fig` seuls (`1a37:0002`). */
  setEgo(ctx: BehaviorContext, obj: GameObject, ego: number, fig = ego): void {
    this.setState(ctx, obj, { ego, fig });
  }

  /** Démarre une animation scénarisée (`16f5:0132`). */
  startAnimation(ctx: BehaviorContext, obj: GameObject, params: NpcAnimationStart): void {
    this.animations.start(ctx, obj, params);
  }

  /** Un tic d'animation (`16f5:02a2`). */
  pollAnimation(ctx: BehaviorContext, obj: GameObject): number {
    return this.animations.poll(ctx, obj);
  }

  /** `Hor = Ver = Prf = 0` (`2273:0190`). */
  stop(obj: GameObject): void {
    obj.speedX = 0;
    obj.speedY = 0;
    obj.speedP = 0;
  }

  // --- perception et mise en cible -------------------------------------------------------------------------------------------

  /** `219b:0000(cible, observateur)` : `Inv` nul et lumière suffisante (`characters.md` § 1.5). */
  sees(ctx: BehaviorContext, observer: GameObject, target: GameObject): boolean {
    if (target.hidden !== 0) return false;
    if (observer.room !== null && observer.room === ctx.room) return !ctx.state.darkRoom;
    return target.light + observer.light > 31;
  }

  /** `22ef:0000` (`helpers.approach`). */
  approach(ctx: BehaviorContext, chaser: GameObject, target: GameObject, follow = false): boolean {
    return approach(ctx, chaser, target, follow);
  }

  /** `219b:0092` : visible puis approche. */
  chase(ctx: BehaviorContext, chaser: GameObject, target: GameObject): boolean {
    return this.sees(ctx, chaser, target) && this.approach(ctx, chaser, target);
  }

  /** `219b:00d0` : ramassage : visible, ramassable, le poids passe, puis approche. */
  fetch(ctx: BehaviorContext, taker: GameObject, item: GameObject): boolean {
    return this.sees(ctx, taker, item) && item.pickable !== 0 && this.fits(taker, item) && this.approach(ctx, taker, item);
  }

  /** `20ac:0060` (`helpers.canCarry`). */
  fits(taker: GameObject, item: GameObject): boolean {
    return canCarry(taker, item);
  }

  /** Cible suivie par le trajet (`Ser` en +0x7A), si elle existe encore dans la salle de l'objet (`21fb:00c6`). */
  followedTarget(ctx: BehaviorContext, obj: GameObject): GameObject | undefined {
    const serial = word(obj, OFF.followed);
    if (serial === 0) return undefined;
    const target = ctx.state.findBySerial(serial);
    return target && target.room !== null && target.room === obj.room ? target : undefined;
  }

  /** Objet touché (`2120:0008`) : celui de `Ser = Col`, dans la même salle et pas dans un conteneur. */
  touched(ctx: BehaviorContext, obj: GameObject): GameObject | undefined {
    if (obj.col === 0) return undefined;
    const other = ctx.state.findBySerial(obj.col);
    return other && other.holder === null && other.room !== null && other.room === obj.room ? other : undefined;
  }

  // --- déplacement ------------------------------------------------------------------------------------------------------------

  /** Distance (`2241:003a(0, a, b)` avec bornes -1) : toujours vrai sauf si `|ΔY| > dy` ou profondeur hors de `dp`. */
  near(a: GameObject, b: GameObject, dx: number, dy: number, dp: number): boolean {
    if (dx >= 0 && Math.abs(a.x - b.x) >= dx) return false;
    if (dy >= 0 && Math.abs(a.y - b.y) > dy) return false;
    if (dp >= 0 && Math.abs(a.p - b.p) >= dp) return false;
    return true;
  }

  /** À portée de contact (hypothèse : |ΔX| < 30, |ΔY| <= 40, |ΔP| < 8). */
  touchesOrNear(a: GameObject, b: GameObject): boolean {
    return this.near(a, b, 30, 40, 8);
  }

  /**
   * `30d9:0006` : suit le trajet. Rend 0 en marche, 2 arrivé sur l'objet suivi (contact), 3 objet suivi absent, 4 pas de chemin,
   * 5 arrivé, 6 sans trajet. En salle chargée le moteur suit les nœuds (`ctx.motion.followPath`) et la cible mobile est
   * recalculée ; hors salle (`30d9:08c8`) l'objet avance en ligne droite.
   */
  stepPath(ctx: BehaviorContext, obj: GameObject): number {
    if (!obj.path.defined) return 6;
    const followed = word(obj, OFF.followed) !== 0;
    const target = followed ? this.followedTarget(ctx, obj) : undefined;
    if (followed && !target) return 3;
    let result: number;
    if (this.inLoadedRoom(ctx, obj)) {
      const goal = obj.path.target;
      if (target && goal && (Math.abs(goal.x - target.x) > 8 || Math.abs(goal.p - target.p) > 8)) {
        if (!ctx.motion.pathTo(obj, target.x, target.y, target.p, target.plane)) return 4;
      }
      const r = ctx.motion.followPath(obj);
      result = r === FOLLOW_WALKING ? 0 : r === FOLLOW_ARRIVED || r === FOLLOW_ARRIVED_FREE ? (target ? 2 : 5) : 4;
    } else {
      result = this.offscreenStep(obj, target);
    }
    obj.err = 0;
    if (result === 0 && obj.speedX === 0 && obj.speedP === 0 && obj.speedY === 0) result = 5;
    if (result !== 0) this.stop(obj);
    return result;
  }

  /** `30d9:08c8` : marche en ligne droite hors de la salle chargée ; 0 en marche, 1 arrivé, 2 arrivé sur l'objet suivi. */
  private offscreenStep(obj: GameObject, target: GameObject | undefined): number {
    const flier = obj.dep !== 0;
    obj.p += sign(obj.speedP);
    obj.x += obj.stepX * sign(obj.speedX);
    if (flier) obj.y += obj.stepY * sign(obj.speedY);
    const goal = target ?? obj.path.target;
    if (!goal) return 1;
    const gx = goal.x;
    const gp = goal.p;
    const gy = goal.y;
    if (Math.abs(gp - obj.p) < 2 && Math.abs(obj.x - gx) < 6 && (!flier || Math.abs(obj.y - gy) < 4)) {
      obj.speedX = obj.speedP = obj.speedY = 0;
      return target ? 2 : 1;
    }
    obj.speedX = sign(gx - obj.x);
    obj.speedP = sign(gp - obj.p);
    if (flier) obj.speedY = sign(gy - obj.y);
    return 0;
  }

  /** `2151:0006` / `2151:02a0` (`helpers.wander`). */
  wander(ctx: BehaviorContext, obj: GameObject, override?: { x?: number; y?: number; p?: number }): boolean {
    return wander(ctx, obj, override);
  }

  /**
   * `228e:0000(obj ; want, respectBarriers)` : choisit au hasard une sortie existante (de la salle voulue si `want` n'est pas -1,
   * non barrée si `respectBarriers`). Hors salle chargée : franchit tout de suite ; en salle chargée : marche vers l'arête.
   * Rend vrai si une sortie a été choisie.
   * hypothèse (characters.md § 1.5) : un code de barrage non nul compte comme barré (le test `1414:0006` n'est pas exposé).
   */
  leaveRoom(ctx: BehaviorContext, obj: GameObject, want = -1, respectBarriers = false): boolean {
    const room = obj.room;
    if (!room || obj.holder) return false;
    const loaded = this.inLoadedRoom(ctx, obj);
    const slots: number[] = [];
    for (let slot = 5; slot >= 0; slot--) {
      const dest = ctx.state.neighbour(room, slot);
      if (!dest) continue;
      if (want !== -1 && dest.id !== want) continue;
      if (respectBarriers && ctx.state.barrier(room, slot) !== 0) continue;
      slots.push(slot);
    }
    obj.path.defined = false;
    while (slots.length > 0) {
      const pick = ctx.rng.mod(slots.length);
      const slot = slots[pick]!;
      if (!loaded) {
        obj.info = slot;
        ctx.rooms.exit(obj);
        return true;
      }
      // côtés : 0 fond, 1 droite, 2 avant, 3 gauche ; les sorties haut / bas ne servent pas en salle chargée
      let x = 160;
      let p = 80;
      let usable = true;
      if (slot === 0) p = -1000;
      else if (slot === 1) x = 1000;
      else if (slot === 2) p = 1000;
      else if (slot === 3) x = -1000;
      else usable = false;
      if (usable) {
        setWord(obj, OFF.followed, 0);
        if (ctx.motion.pathTo(obj, x, 90, p, 0)) return true;
      }
      slots[pick] = slots[slots.length - 1]!;
      slots.pop();
    }
    obj.path.defined = false;
    return false;
  }

  /** `2273:000c(a, b)` : `b` se tourne vers `a` et s'en approche (hypothèse : cible = position de `a`). */
  faceOff(ctx: BehaviorContext, a: GameObject, b: GameObject): void {
    if (ctx.hero === a || ctx.hero === b) ctx.motion.reset(ctx.hero);
    this.stop(a);
    this.stop(b);
    if (b.mob === 2) this.approach(ctx, b, a);
    b.err = 0;
  }

  // --- gabarit d'`Err` --------------------------------------------------------------------------------------------------------

  /**
   * Aiguillage de tête des procédures libres (tableau de 20 mots, `characters.md` § 3.1) : 8 et 9 -> `contact` (faux = la
   * procédure rend 0) ; 11 -> sortie ; 12, 14, 15, 19 -> `Def = 0`. Rend `UPDATE_OK` ou `RESTART` si la procédure doit s'arrêter
   * là, `null` sinon.
   */
  dispatchErr(ctx: BehaviorContext, obj: GameObject, contact: () => boolean): number | null {
    for (let guard = 0; guard < 4; guard++) {
      const err = obj.err;
      if (err === 8 || err === 9) {
        if (!contact()) return RESTART;
        return null;
      }
      if (err === 0x0b) {
        const exit = ctx.rooms.exit(obj);
        if (exit === "transit") return UPDATE_OK;
        if (exit === "blocked" || exit === "none") continue;
        obj.path.defined = false;
        obj.err = 0;
        return UPDATE_OK;
      }
      if (err === 12 || err === 14 || err === 15 || err === 19) obj.path.defined = false;
      return null;
    }
    return null;
  }

  /**
   * Suite commune de la tête : si un trajet est en cours, le suivre ; rend `UPDATE_OK` quand le tic est fini (en marche), `RESTART`
   * si le contact l'exige, `null` pour passer aux états et à la décision. `contact` : réaction de contact (faux = rend 0).
   */
  followOrDecide(ctx: BehaviorContext, obj: GameObject, contact: () => boolean): number | null {
    if (!obj.path.defined) return null;
    const r = this.stepPath(ctx, obj);
    if (r === 0) {
      obj.err = 0;
      return UPDATE_OK;
    }
    if (r === 2) {
      obj.col = word(obj, OFF.followed);
      if (!contact()) return RESTART;
    }
    return null;
  }

  /** Libère les vitesses d'un objet non piloté (`Hor`, `Ver`, `Prf` remis à zéro) et annule le trajet. */
  idle(ctx: BehaviorContext, obj: GameObject): void {
    obj.path.defined = false;
    if (flag(obj, OFF.control) === 0) {
      obj.speedX = 0;
      obj.speedP = 0;
      obj.speedY = 0;
    }
    void ctx;
  }

  // --- objets -----------------------------------------------------------------------------------------------------------------

  /** `19a6:01a5` (`helpers.destroy`). */
  destroy(ctx: BehaviorContext, obj: GameObject, keepContents = false): void {
    destroy(ctx, obj, keepContents);
  }

  /** Copie la position de `from` dans `to` (`helpers.copyPosition`). */
  copyPosition(from: GameObject, to: GameObject): void {
    copyPosition(from, to);
  }

  /** Les deux objets au même endroit, `to` devant (`P + 1`), comme avant un duel. */
  stack(from: GameObject, to: GameObject): void {
    this.copyPosition(from, to);
    to.p += 1;
  }

  /**
   * `1a6b:0006` : crée un objet de type 2 dans la salle de `at`, à sa position ; `fields` complète les champs (pas de modèle). Rend
   * `null` si `at` n'est dans aucune salle.
   */
  spawn(ctx: BehaviorContext, at: GameObject, num: number, fields: SpawnFields = {}): GameObject | null {
    const room = roomOf(at);
    if (!room) return null;
    const created = ctx.state.createObject({ typ: 2, num, ...fields });
    ctx.state.moveToRoom(created, room);
    copyPosition(at, created);
    created.presence = inLoadedRoom(ctx, created) ? 2 : 1;
    this.animations.refresh(ctx, created);
    return created;
  }

  /** `21f0:0008` : déplace les objets de `nums` que porte `holder` vers `taker`, dans la limite de son poids. Rend leur nombre. */
  confiscate(ctx: BehaviorContext, taker: GameObject, holder: GameObject, nums: readonly number[]): number {
    return this.moveWhile(ctx, taker, holder, (item) => nums.includes(item.num));
  }

  /** `28b1:1140` : `taker` prend tout ce que `holder` porte de `Val >= 10` ou la clef de bronze, dans la limite de son poids. */
  steal(ctx: BehaviorContext, taker: GameObject, holder: GameObject): number {
    return this.moveWhile(ctx, taker, holder, (item) => item.value >= 10 || item.num === NUM.bronzeKey);
  }

  private moveWhile(ctx: BehaviorContext, taker: GameObject, holder: GameObject, wanted: (item: GameObject) => boolean): number {
    let count = 0;
    for (let again = true; again; ) {
      again = false;
      for (const item of holder.contents) {
        if (wanted(item) && this.fits(taker, item)) {
          ctx.state.moveToContainer(item, taker);
          count++;
          again = true;
          break;
        }
      }
    }
    return count;
  }

  /**
   * Changement de salle direct (`Inf = 6`, salle de destination en +0x66, `186d:000c`) : le héros demande le rechargement,
   * les autres objets sont rangés dans la salle puis placés au hasard (mode 9) si elle est chargée.
   */
  teleport(ctx: BehaviorContext, obj: GameObject, room: GameRoom): void {
    ctx.motion.reset(obj);
    if (obj === ctx.hero) {
      obj.info = 6;
      ctx.rooms.want(room);
      return;
    }
    ctx.state.moveToRoom(obj, room);
    obj.presence = room === ctx.room ? 2 : 1;
    if (room === ctx.room) ctx.motion.place(obj, 9);
    obj.err = 0;
  }

  /** Mémorise le `Num` et l'`Ego` d'origine d'une créature ensorcelée (`2d52:06b0` : +0x28 et +0x24). */
  pointMemo(obj: GameObject, num: number, ego: number): void {
    setWord(obj, OFF.memo, num);
    setFlag(obj, OFF.savedEgo, ego);
  }

  // --- héros ------------------------------------------------------------------------------------------------------------------

  /** Le héros devient spectateur d'une animation à deux : `Gst 7`, `Mob 1`, `Ego 6`, le joueur perd la main (`4b50 = 0`). */
  holdHero(ctx: BehaviorContext, hero: GameObject): void {
    ctx.motion.reset(hero);
    this.stop(hero);
    this.setState(ctx, hero, { gst: 7, mob: 1, ego: 6, fig: 0 });
    hero.speedY = 1;
    if (hero === ctx.hero) ctx.state.moveEnabled = false;
  }

  /** `246c:0240` avec `AL = 7` : le héros reprend la marche (`Ego 0`, `Err = 0x11`), le joueur reprend la main. */
  releaseHero(ctx: BehaviorContext, hero: GameObject): void {
    this.stop(hero);
    hero.animId = 0;
    setWord(hero, RAW_OFFSET.bag, 0);
    this.setState(ctx, hero, { gst: 7, mob: 2, ego: 0, fig: 0 });
    hero.err = 0x11;
    if (hero === ctx.hero) ctx.state.moveEnabled = true;
  }

  // --- dépouille et mort ---------------------------------------------------------------------------------------------------

  /**
   * `2405:0000` : jingle `E4`, message, puis `victim` est remplacé par une dépouille (`Num 2`, voir `hero.createCorpse`, dont la
   * procédure `Fct` `corpseBehavior` est l'unique version de `2405:0106`) qui reprend son contenu et sa position.
   */
  replaceWithRemains(ctx: BehaviorContext, victim: GameObject, variant: number, message?: { cls: string; number: number }): GameObject | null {
    const remains = createCorpse(victim, ctx, variant as 0 | 1 | 2);
    if (remains) {
      if (message) this.sayNear(ctx, remains, message.cls, message.number);
      this.animations.refresh(ctx, remains);
    }
    return remains;
  }
}

/** Boîte à outils à animations du contexte, pour les gestionnaires de verbes (`objects.ts`, `magic.ts`) qui n'ont pas de `NpcKit`. */
export const defaultKit = new NpcKit();
