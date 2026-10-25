import { EventOp } from "../engine/events";
import { type BehaviorContext, type BehaviorHandler, FAMILY, type HandlerRegistry } from "../engine/handlers";
import type { GameObject } from "../engine/state";
import { flag, NUM, OFF, ROOM, setFlag, word } from "./helpers";
import { type NpcKit, RESTART, UPDATE_OK } from "./npc-kit";

/**
 * Créatures : ours des cavernes (`26da:*`, § 8.1), pie (`2774:*`, § 8.2), Sarhûls (`2cdf:*`, § 8.3) et crapaud (`2d52:*`, § 8.7),
 * de `docs/armaeth/characters.md`. Les valeurs de `gm_chance_one_in(n)` viennent du désassemblage (`CALLF 1e08:0000` précédé de
 * `MOV AX, n`) ; les identifiants d'animation propres à chaque victime sont notés `hypothèse` quand le code les cache dans un registre.
 */

const target = (o: GameObject) => ({ typ: o.typ, num: o.num, serial: o.serial });

/** Animation de « victime dévorée » (`characters.md` § 1.3 : ids 41) et du repas de l'ours côté héros (id 4). */
const ANM_DEVOURED = 41;
const ANM_BEAR_MEAL = 9;
const ANM_BEAR_CHEW = 10;
const ANM_BEAR_EATEN = 41;
const ANM_HERO_BEAR = 4;
const ANM_SARHUL_EAT = 40;
const ANM_SARHUL_DONE = 31;
const ANM_TOAD_IN = 46;
const ANM_TOAD_OUT = 47;

// --- ours ----------------------------------------------------------------------------------------------------------------------

const BEAR_HUNGER = 24000;
const BEAR_FULL = 2000;
/** Événements différés de l'ours (`objects.md` § 8) : 9 faim (proc 4), 12 « rassasié » (sans procédure). */
const BEAR_EVENT = { hunger: 9, full: 12 } as const;
/** Cibles de l'ours (`26da:000e`) : héros, dépouille, pie, Prytwen, Sarhûl, Minas Thyl, crapaud. Pas les nains. */
const BEAR_PREY: readonly number[] = [NUM.hero, NUM.remains, NUM.magpie, NUM.prytwen, NUM.sarhul, NUM.minas, NUM.toad];

/** `26da:0480` : l'ours touche quelqu'un (`Ego < 2`). Faux = la procédure rend 0 (la liste est à reprendre). */
function bearContact(kit: NpcKit, ctx: BehaviorContext, bear: GameObject): boolean {
  const other = kit.touched(ctx, bear);
  if (!other) {
    bear.err = 0;
    return true;
  }
  if (bear.ego > 1) return true;
  const devour = (message: number, victimEgo: number, bearAnim: number, victimAnim: number) => {
    kit.sayNear(ctx, bear, "G", message);
    kit.startAnimation(ctx, bear, { id: bearAnim, ego: 4, partner: other });
    other.dep = 0;
    kit.startAnimation(ctx, other, { id: victimAnim, ego: victimEgo, partner: bear });
    kit.stack(bear, other);
    other.err = 0;
  };
  switch (other.num) {
    case NUM.prytwen:
      if (other.ego !== 0) return true;
      devour(117, 1, ANM_BEAR_MEAL, ANM_DEVOURED);
      break;
    case NUM.hero:
      if (other.ego > 5) return true;
      // le repas est fatal : l'animation 4 du héros finit par `G25` et la mort, contenu laissé (§ 6.2)
      devour(21, 6, ANM_BEAR_MEAL, ANM_HERO_BEAR);
      break;
    case NUM.remains:
      kit.destroy(ctx, other);
      kit.sayNear(ctx, bear, "G", 27);
      kit.startAnimation(ctx, bear, { id: ANM_BEAR_CHEW, ego: 2 });
      break;
    case NUM.magpie:
      devour(26, 6, ANM_BEAR_MEAL, ANM_DEVOURED);
      break;
    case NUM.bees:
      if (ctx.state.darkRoom) return true;
      kit.copyPosition(other, bear);
      bear.p += 1;
      kit.sayNear(ctx, bear, "G", 28);
      kit.startAnimation(ctx, bear, { id: ANM_BEAR_MEAL, ego: 3 });
      break;
    case NUM.toad:
      kit.sayHere(ctx, bear, "G", 352);
      kit.destroy(ctx, other, true);
      break;
    case NUM.dwarfMiner:
    case NUM.dwarfMiner2:
    case NUM.dwarfWarrior:
    case NUM.dwarfWarrior2:
    case NUM.soldier:
    case NUM.minas:
      // « les nains sont les amis des animaux » (`G206`) : pas d'attaque, il se met face à eux
      kit.sayHere(ctx, bear, "G", 206);
      kit.faceOff(ctx, other, bear);
      break;
    case NUM.sarhul:
      kit.faceOff(ctx, other, bear);
      break;
    default:
      return true;
  }
  bear.err = 0;
  return true;
}

/** `26da:000e` (`Num 4`). */
export function bear(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    if (flag(obj, OFF.init) === 0) {
      setFlag(obj, OFF.init, 7);
      ctx.events.operate(target(obj), BEAR_EVENT.hunger, EventOp.Set, BEAR_HUNGER, NUM.bear);
    }
    const contact = () => bearContact(kit, ctx, obj);
    const head = kit.dispatchErr(ctx, obj, () => (obj.ego < 2 ? contact() : true));
    if (head !== null) return head;
    const follow = kit.followOrDecide(ctx, obj, contact);
    if (follow !== null) return follow;

    if (obj.ego >= 2) {
      const id = kit.pollAnimation(ctx, obj);
      if (id === 0) {
        obj.err = 0;
        return UPDATE_OK;
      }
      if (id === ANM_BEAR_EATEN) {
        kit.destroy(ctx, obj);
        return RESTART;
      }
      if (id === ANM_BEAR_MEAL) {
        kit.startAnimation(ctx, obj, { id: ANM_BEAR_CHEW, ego: 2 });
        obj.err = 0;
        return UPDATE_OK;
      }
      // fin du repas ou du jeu avec les abeilles : retour à `Ego 0`, la faim et la satiété sont réarmées
      kit.setState(ctx, obj, { gst: 7, mob: 2, ego: 0, fig: 0 });
      ctx.events.operate(target(obj), BEAR_EVENT.hunger, EventOp.Set, BEAR_HUNGER, NUM.bear);
      ctx.events.operate(target(obj), BEAR_EVENT.full, EventOp.Set, BEAR_FULL, 0);
      obj.speedY = 0;
    }
    return bearDecide(kit, ctx, obj);
  };
}

function bearDecide(kit: NpcKit, ctx: BehaviorContext, obj: GameObject): number {
  obj.path.defined = false;
  if (flag(obj, OFF.control) !== 0) {
    obj.err = 0;
    return UPDATE_OK;
  }
  kit.stop(obj);
  const room = obj.room;
  const bees = room?.listA.find((o) => o.num === NUM.bees);
  const full = ctx.state.events.find(target(obj), BEAR_EVENT.full) === undefined;
  // abeilles (`21fb:005a`) : salle chargée et éclairée, pas rassasié, affamé ou appétit (`2241:003a`, bornes cachées)
  // hypothèse (characters.md § 8.1) : l'appétit est la proximité (|ΔX| < 120) des abeilles
  if (bees && kit.inLoadedRoom(ctx, obj) && !ctx.state.darkRoom && full && (obj.ego !== 0 || kit.near(bees, obj, 120, -1, -1))) {
    if (kit.approach(ctx, obj, bees, true)) {
      kit.setEgo(ctx, obj, 0, 0);
      obj.err = 0;
      return UPDATE_OK;
    }
  }
  const followedNum = ctx.state.findBySerial(word(obj, OFF.followed))?.num ?? 0;
  for (const o of room?.listA ?? []) {
    if (o === obj || o.num === followedNum || !BEAR_PREY.includes(o.num)) continue;
    if (!kit.sees(ctx, obj, o)) continue;
    // il n'attaque que dans sa grotte ou affamé, sinon une fois sur 3 (`26da:0364`)
    if ((room?.id === ROOM.cave || obj.ego !== 0 || kit.chance(ctx, 3)) && kit.approach(ctx, obj, o, true)) {
      kit.setEgo(ctx, obj, 0, 0);
      obj.err = 0;
      return UPDATE_OK;
    }
  }
  if (obj.fig !== 0) kit.setEgo(ctx, obj, obj.ego, 0);
  // une fois sur 4 (`26da:03da`) il change de salle, sinon il erre
  if (!(kit.chance(ctx, 4) && kit.leaveRoom(ctx, obj))) kit.wander(ctx, obj);
  obj.err = 0;
  return UPDATE_OK;
}

// --- pie -----------------------------------------------------------------------------------------------------------------------

/** `2774:061c` : changement d'état de la pie (`Ego` = `Fig`), mouvement annulé. */
function setMagpie(kit: NpcKit, ctx: BehaviorContext, obj: GameObject, ego: number): void {
  kit.setState(ctx, obj, { ego, fig: ego });
  ctx.motion.reset(obj);
}

/** `2774:049e` : la pie touche quelque chose. */
function magpieContact(kit: NpcKit, ctx: BehaviorContext, pie: GameObject): boolean {
  const other = kit.touched(ctx, pie);
  if (!other) {
    pie.err = 0;
    return true;
  }
  if (other.num === NUM.goldKey) {
    if (!kit.fits(pie, other) || other.hidden !== 0) return true;
    ctx.state.moveToContainer(other, pie);
    setMagpie(kit, ctx, pie, 4);
    kit.sayHere(ctx, pie, "G", 29);
  } else if (other.num === NUM.nest) {
    // elle dépose son butin dans le nid, puis se repose (jour) ou dort (nuit)
    for (const loot of [...pie.contents]) ctx.state.moveToContainer(loot, other);
    setMagpie(kit, ctx, pie, ctx.state.darkRoom ? 5 : 2);
    pie.tim = 200;
    pie.speedX = 1;
  } else {
    if (other.mob === 0) return true;
    if (pie.ego === 5) return true;
    setMagpie(kit, ctx, pie, pie.ego === 3 || pie.ego === 4 ? 3 : 0);
    kit.faceOff(ctx, other, pie);
  }
  pie.err = 0;
  return true;
}

/** `2774:0004` (`Num 3`) : la pie. */
export function magpie(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    const contact = () => magpieContact(kit, ctx, obj);
    const head = kit.dispatchErr(ctx, obj, () => (obj.ego < 6 ? contact() : true));
    if (head !== null) return head;
    if (obj.ego === 6) {
      // tuée par l'ours ou un Sarhûl : l'animation finit, la pie disparaît
      if (kit.pollAnimation(ctx, obj) === 0) {
        obj.err = 0;
        return UPDATE_OK;
      }
      kit.destroy(ctx, obj, true);
      return RESTART;
    }
    if (obj.ego === 2 || obj.ego === 5) {
      if (obj.ego === 5) {
        if (ctx.state.darkRoom) {
          obj.err = 0;
          return UPDATE_OK;
        }
        obj.tim = 0;
      }
      obj.tim = Math.max(0, obj.tim - 1);
      if (obj.tim !== 0) {
        // 1 chance sur 30 (`2774:0141`) d'inverser sa direction pendant le repos
        if (kit.chance(ctx, 30)) obj.speedX = -obj.speedX;
        obj.err = 0;
        return UPDATE_OK;
      }
      setMagpie(kit, ctx, obj, 0);
    } else {
      const follow = kit.followOrDecide(ctx, obj, contact);
      if (follow !== null) return follow;
    }
    return magpieDecide(kit, ctx, obj);
  };
}

function magpieDecide(kit: NpcKit, ctx: BehaviorContext, obj: GameObject): number {
  obj.path.defined = false;
  if (flag(obj, OFF.control) !== 0) {
    obj.err = 0;
    return UPDATE_OK;
  }
  kit.stop(obj);
  const room = obj.room;
  const followedNum = ctx.state.findBySerial(word(obj, OFF.followed))?.num ?? 0;
  for (const o of room?.listA ?? []) {
    if (o === obj || o.num === followedNum) continue;
    if (o.num === NUM.nest) {
      // le nid : si elle fuit, s'il fait sombre, ou 1 fois sur 4 (`rand() % 4`) au repos
      if (obj.ego === 3 || ctx.state.darkRoom || (obj.ego === 0 && ctx.rng.mod(4) === 0)) {
        if (kit.approach(ctx, obj, o)) return endTic(obj);
      }
    } else if (o.num === NUM.goldKey) {
      if (kit.fetch(ctx, obj, o)) return endTic(obj);
    } else if (o.mob === 2 && o.hidden === 0 && kit.near(o, obj, 80, -1, -1)) {
      // toute autre créature mobile visible la fait fuir (`2774:061c`)
      setMagpie(kit, ctx, obj, obj.ego === 3 || obj.ego === 4 ? 3 : 0);
      kit.faceOff(ctx, o, obj);
      if (o === ctx.hero) kit.stop(o);
      return endTic(obj);
    }
  }
  const dark = ctx.state.darkRoom;
  if ((obj.ego === 1 || obj.ego === 4) && (kit.chance(ctx, 3) || dark)) setMagpie(kit, ctx, obj, obj.ego - 1);
  else if (obj.ego === 1 && kit.chance(ctx, 3)) {
    // repos de 200 tics (`Tim`)
    setMagpie(kit, ctx, obj, 2);
    obj.speedX = 1;
    obj.tim = 200;
    return endTic(obj);
  }
  if (obj.ego === 3 && dark && kit.leaveRoom(ctx, obj)) return endTic(obj);
  kit.wander(ctx, obj);
  return endTic(obj);
}

const endTic = (obj: GameObject): number => {
  obj.err = 0;
  return UPDATE_OK;
};

// --- Sarhûls -------------------------------------------------------------------------------------------------------------------

/** Côté de la grille 316 d'un type de case de la salle 309 : `0x3a` / `0x70` (fermée) ou `0x39` / `0x71` (ouverte). */
function sarhulSide(open: boolean, ground: number): boolean {
  return open ? ground === 0x39 || ground === 0x71 : ground === 0x3a || ground === 0x70;
}

/** `2cdf:02da` : le Sarhûl touche quelqu'un (`Ego 0`). */
function sarhulContact(kit: NpcKit, ctx: BehaviorContext, obj: GameObject): boolean {
  const other = kit.touched(ctx, obj);
  if (!other) {
    obj.err = 0;
    return true;
  }
  if (obj.ego !== 0) return true;
  if (obj.room?.id === ROOM.sarhulHall && other.ground !== obj.ground) {
    // la grille 316 sépare la salle : le contact n'a lieu que du même côté
    const grille = obj.room.listA.find((o) => o.num === NUM.ornateGrille);
    const open = grille?.ego === 3;
    if (sarhulSide(open, other.ground) !== sarhulSide(open, obj.ground)) return true;
  }
  const eat = (message: number, victimEgo: number) => {
    kit.sayNear(ctx, obj, "G", message);
    kit.startAnimation(ctx, obj, { id: ANM_SARHUL_EAT, ego: 1, partner: other });
    other.dep = 0;
    kit.startAnimation(ctx, other, { id: ANM_DEVOURED, ego: victimEgo, partner: obj });
    kit.copyPosition(obj, other);
    other.err = 0;
  };
  switch (other.num) {
    case NUM.hero:
      if (other.ego === 6) return true;
      // `G302` si le héros est visible, `G363` s'il est invisible (il a touché la bête) ; mort par l'animation 41 (`G338`)
      eat(other.hidden === 0 ? 302 : 363, 6);
      break;
    case NUM.magpie:
      kit.sayHere(ctx, other, "G", 305);
      kit.destroy(ctx, other, true);
      break;
    case NUM.ham:
      // le jambon : détruit, le Sarhûl est occupé
      kit.sayNear(ctx, obj, "G", 304);
      kit.destroy(ctx, other);
      kit.startAnimation(ctx, obj, { id: ANM_SARHUL_EAT, ego: 2 });
      break;
    case NUM.toad:
      kit.sayHere(ctx, other, "G", 305);
      kit.destroy(ctx, other, true);
      break;
    case NUM.bear:
      eat(303, 5);
      break;
    case NUM.prytwen:
    case NUM.dwarfMiner:
    case NUM.dwarfMiner2:
    case NUM.dwarfWarrior:
    case NUM.dwarfWarrior2:
    case NUM.soldier:
      eat(303, 1);
      break;
    case NUM.minas:
      kit.sayHere(ctx, other, "G", 306);
      kit.faceOff(ctx, other, obj);
      break;
    case NUM.sarhul:
      if (other.ego > 1) {
        obj.ego = 3;
        break;
      }
      kit.faceOff(ctx, other, obj);
      break;
    default:
      return true;
  }
  obj.err = 0;
  return true;
}

const SARHUL_PREY: readonly number[] = [NUM.hero, NUM.prytwen, NUM.magpie, NUM.bear, 201, 202, 203, 204, NUM.soldier, NUM.ham, NUM.toad];

/** `2cdf:0004` (`Num 302`). */
export function sarhul(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    const contact = () => sarhulContact(kit, ctx, obj);
    const head = kit.dispatchErr(ctx, obj, contact);
    if (head !== null) return head;
    const follow = kit.followOrDecide(ctx, obj, contact);
    if (follow !== null) return follow;

    if (obj.ego === 1 || obj.ego === 2) {
      const id = kit.pollAnimation(ctx, obj);
      if (id === 0) {
        obj.err = 0;
        return UPDATE_OK;
      }
      if (id === ANM_SARHUL_DONE) {
        // la victime liée (`Bag`) est détruite
        const victim = ctx.state.findBySerial(word(obj, 0x3a));
        if (victim) kit.destroy(ctx, victim, true);
      }
      obj.speedY = 0;
      kit.setState(ctx, obj, { gst: 7, mob: 2, ego: 0, fig: 0 });
    } else if (obj.ego === 3) {
      // occupé tant qu'un autre Sarhûl dévore ou attend de la proie dans la salle (hypothèse : `21e7:003c`, bornes cachées)
      const busy = obj.room?.listA.some((o) => o !== obj && o.num === NUM.sarhul && o.ego === 1);
      if (busy) {
        obj.err = 0;
        return UPDATE_OK;
      }
      obj.ego = 0;
    }
    obj.path.defined = false;
    if (flag(obj, OFF.control) !== 0) return endTic(obj);
    kit.stop(obj);
    const followedNum = ctx.state.findBySerial(word(obj, OFF.followed))?.num ?? 0;
    for (const o of obj.room?.listA ?? []) {
      if (o === obj) continue;
      if (o.num === NUM.sarhul) {
        // un autre Sarhûl « attend son tour » (`Ego 2`) : on l'approche
        if (o.ego === 2 && kit.chase(ctx, obj, o)) return endTic(obj);
        continue;
      }
      if (!SARHUL_PREY.includes(o.num) || o.num === followedNum) continue;
      if (o.num === NUM.hero && o.ego === 6) continue;
      if (kit.chase(ctx, obj, o)) return endTic(obj);
    }
    // une fois sur 4 (`2cdf:02a1`) il part, sinon il erre
    if (!(kit.chance(ctx, 4) && kit.leaveRoom(ctx, obj))) kit.wander(ctx, obj);
    return endTic(obj);
  };
}

// --- crapaud -------------------------------------------------------------------------------------------------------------------

/** Événement du crapaud (`objects.md` § 8) : 8, 100 tics, procédure 327 (`Ego 1 -> 0`). */
const TOAD_PENSIVE = 8;

/** `2d52:03d6` : le crapaud touche quelqu'un (`Ego 0`). */
function toadContact(kit: NpcKit, ctx: BehaviorContext, toad: GameObject): boolean {
  const other = kit.touched(ctx, toad);
  if (!other) {
    toad.err = 0;
    return true;
  }
  if (toad.ego !== 0) return true;
  if (other === ctx.hero) {
    // le héros le touche : il reste pensif 100 tics
    kit.sayHere(ctx, toad, "V", 346);
    kit.setEgo(ctx, toad, 1, 1);
    ctx.motion.reset(toad);
    kit.stop(toad);
    ctx.events.operate(target(toad), TOAD_PENSIVE, EventOp.Set, 100, NUM.toad);
  } else {
    if (other.mob === 0) return true;
    kit.faceOff(ctx, other, toad);
  }
  toad.err = 0;
  return true;
}

/** `2d52:06b0` : `victim` est remplacé par un crapaud qui garde son `Num` et son `Ego` ; si c'était le héros, il devient le crapaud. */
export function turnIntoToad(kit: NpcKit, ctx: BehaviorContext, victim: GameObject, caster: GameObject): GameObject | null {
  kit.sayHere(ctx, caster, "V", 0);
  const wasHero = ctx.hero === victim;
  const toad = kit.spawn(ctx, victim, NUM.toad, {
    gst: 7,
    mob: 2,
    ego: 0,
    weight: victim.weight,
    capacity: victim.capacity,
    value: victim.value,
    pickable: victim.pickable,
    canContain: victim.canContain,
  });
  if (!toad) return null;
  kit.pointMemo(toad, victim.num, victim.ego);
  toad.err = 0;
  for (const child of [...victim.contents]) ctx.state.moveToContainer(child, toad);
  ctx.state.deleteObject(victim);
  if (wasHero) {
    ctx.state.setHero(toad);
    setFlag(toad, OFF.control, 0);
  }
  kit.startAnimation(ctx, toad, { id: ANM_TOAD_IN, ego: 2 });
  return toad;
}

/** `2d52:000e` (`Num 327`). */
export function toad(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    const contact = () => toadContact(kit, ctx, obj);
    const head = kit.dispatchErr(ctx, obj, contact);
    if (head !== null) return head;
    const follow = kit.followOrDecide(ctx, obj, contact);
    if (follow !== null) return follow;

    if (obj.ego === 1) return endTic(obj);
    if (obj.ego === 2) {
      const id = kit.pollAnimation(ctx, obj);
      if (id === 0) return endTic(obj);
      if (id === ANM_TOAD_OUT) return toadRevert(kit, ctx, obj);
      // fin de la métamorphose en crapaud (`2d52:0188`)
      kit.setState(ctx, obj, { gst: 7, mob: 2, ego: 0, fig: 0 });
      obj.ground = 0;
    }
    obj.path.defined = false;
    if (flag(obj, OFF.control) !== 0) return endTic(obj);
    kit.stop(obj);
    obj.speedY = 1;
    const hero = ctx.hero;
    const followedSerial = word(obj, OFF.followed);
    // il va vers le héros s'il le voit et ne le suit pas déjà
    if (hero && hero.room === obj.room && hero !== obj && hero.hidden === 0 && hero.serial !== followedSerial && kit.approach(ctx, obj, hero, true)) {
      return endTic(obj);
    }
    // une fois sur 4 (`2d52:039d`) il quitte la salle, sinon il erre
    if (!(kit.chance(ctx, 4) && kit.leaveRoom(ctx, obj))) kit.wander(ctx, obj);
    return endTic(obj);
  };
}

/** Fin de l'animation 47 : la créature d'origine reparaît à la place du crapaud (§ 8.7). */
function toadRevert(kit: NpcKit, ctx: BehaviorContext, obj: GameObject): number {
  const memo = word(obj, OFF.memo);
  const origin = [NUM.bear, NUM.prytwen, 201, 202, 203, 204, NUM.soldier].includes(memo) ? memo : 0;
  if (origin === 0) {
    // hypothèse (characters.md § 8.7) : le cas `+0x28 == 1` (héros ensorcelé) lance `2594:0004`, non élucidé : le crapaud reste
    kit.setState(ctx, obj, { gst: 7, mob: 2, ego: 0, fig: 0 });
    return endTic(obj);
  }
  const wasHero = ctx.hero === obj;
  const restored = kit.spawn(ctx, obj, origin, {
    gst: 7,
    mob: 2,
    ego: flag(obj, OFF.savedEgo),
    weight: obj.weight,
    capacity: obj.capacity,
    value: obj.value,
    pickable: obj.pickable,
    canContain: obj.canContain,
  });
  if (!restored) return endTic(obj);
  restored.err = 0;
  for (const child of [...obj.contents]) ctx.state.moveToContainer(child, restored);
  kit.sayHere(ctx, restored, "G", origin === NUM.bear ? 332 : origin === NUM.prytwen ? 333 : 334);
  ctx.state.deleteObject(obj);
  if (wasHero) ctx.state.setHero(restored);
  else if (!kit.leaveRoom(ctx, restored) && ctx.hero) kit.faceOff(ctx, ctx.hero, restored);
  return RESTART;
}

export function registerCreatures(registry: HandlerRegistry, kit: NpcKit): void {
  registry.register(FAMILY.character, NUM.bear, bear(kit));
  registry.register(FAMILY.character, NUM.magpie, magpie(kit));
  registry.register(FAMILY.character, NUM.sarhul, sarhul(kit));
  registry.register(FAMILY.character, NUM.toad, toad(kit));
}
