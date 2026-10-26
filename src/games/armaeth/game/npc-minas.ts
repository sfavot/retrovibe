import { EventOp } from "../engine/events";
import type { BehaviorContext, BehaviorHandler, EventHandler, HandlerRegistry } from "../engine/handlers";
import { FAMILY } from "../engine/handlers";
import { sequenceFinished } from "../engine/animation";
import type { GameObject } from "../engine/state";
import { turnIntoToad } from "./npc-creatures";
import { flag, NUM, OFF, ROOM, setFlag, word } from "./helpers";
import { type NpcKit, RESTART, UPDATE_OK } from "./npc-kit";

/**
 * Minas Thyl la sorcière (`Num 303`, `2dd9:*`, `characters.md` § 7.5). Le module `2dd9:009d` (47 Ko, fragment non décomposé) n'est
 * pas reconstitué : la capture du héros dans son antre et la séquence du chaudron sont des lacunes marquées. Le reste (états, téléportation
 * avec la baguette, sorts de crapaud, dépouilles, lave) suit le désassemblage de `2dd9:0006`.
 */

const ANM = { vanish: 45, appear: 44, strangle: 34, lava: 36 } as const;
/** Objets que Minas Thyl prend au héros (`DGROUP:5284`) : émeraude, baguette, sphère de cristal, fiole. */
const SNATCHED = [313, 320, 315, 304];
/** Événement 5 : sur la lave (`Sol 0x34`), animation 36 (`objects.md` § 8). */
export const MINAS_EVENT_LAVA = 5;

const target = (o: GameObject) => ({ typ: o.typ, num: o.num, serial: o.serial });
const wandOf = (minas: GameObject): GameObject | undefined => minas.contents.find((o) => o.num === 320);

/** `2dd9:1478` : nouvel état (`Ego`), mouvement annulé, message éventuel. */
function setMinas(kit: NpcKit, ctx: BehaviorContext, obj: GameObject, ego: number, fig = 0): void {
  kit.setState(ctx, obj, { ego, fig });
  obj.speedY = ego === 0 ? 0 : 1;
  ctx.motion.reset(obj);
}

/** `2dd9:14cc` : sort de crapaud sur `victim`. */
function cast(kit: NpcKit, ctx: BehaviorContext, minas: GameObject, victim: GameObject): void {
  setMinas(kit, ctx, minas, 1, 1);
  turnIntoToad(kit, ctx, victim, minas);
}

/** `2dd9:0858` : contact. Faux = la procédure rend 0. */
function minasContact(kit: NpcKit, ctx: BehaviorContext, obj: GameObject): boolean {
  const other = kit.touched(ctx, obj);
  if (!other) {
    obj.err = 0;
    return true;
  }
  if (obj.ego !== 0 && obj.ego !== 7 && !(obj.ego === 4 && other.num === NUM.cauldron)) return true;
  if (other.num === NUM.hero && other.hidden === 0 && (other.ego === 0 || other.ego === 2 || other.ego === 5)) {
    if (obj.room?.id === ROOM.minasLair) {
      // dans son antre : elle capture le héros (`G323`), puis l'emmène au chaudron
      kit.sayHere(ctx, obj, "G", 323);
      obj.ego = 4;
      kit.holdHero(ctx, other);
      // lacune (characters.md § 7.5, § 12.1) : le déroulé de la capture (`2dd9:009d`) : trajet jusqu'au chaudron `306`, fin « soupe humaine »
      // (`G364`), dépouille variante 2 ; non reconstitué, le héros reste suspendu en `Ego 6`
    } else if (wandOf(obj)) {
      // elle a sa baguette (`2dd9:0a1e`, désassemblage) : si elle suit le héros, `G368` et l'attente (`Ego 5`) ; sinon trois avertissements
      // `G317` à `G319` (compteur `+0x42`, `Ego 2`), puis le sort de crapaud (`G320`, `2dd9:14cc`)
      if (word(obj, OFF.followed) === 1) {
        setMinas(kit, ctx, obj, 5, 5);
        kit.sayHere(ctx, obj, "G", 368);
      } else if (flag(obj, 0x42) !== 0) {
        const warnings = flag(obj, 0x42);
        setMinas(kit, ctx, obj, 2, 2);
        kit.sayHere(ctx, obj, "G", 316 + warnings);
        setFlag(obj, 0x42, warnings - 1);
      } else cast(kit, ctx, obj, other);
    } else if (!other.contents.some((o) => o.num === 320)) {
      // sans baguette sur lui (`2dd9:0a84`) : le pacte, une seule fois par attente : `G325` la première fois (`G369` si elle a déjà eu puis
      // reperdu sa baguette, `+0x20`), `G326` ensuite ; elle passe `Ego 5` (attend la baguette) et le contact ne se répète plus
      const seen = flag(obj, 0x43);
      setFlag(obj, 0x43, seen + 1);
      setMinas(kit, ctx, obj, 5, 5);
      kit.sayHere(ctx, obj, "G", seen === 0 ? (flag(obj, 0x20) >= 1 ? 369 : 325) : 326);
    } else if (other.contents.some((o) => o.num === 314)) {
      // la baguette et l'épée : exigence (`G327`, ou `G343` si elle n'a plus le talisman), elle passe `Ego 5` (`2dd9:0ab8`)
      setMinas(kit, ctx, obj, 5, 5);
      kit.sayHere(ctx, obj, "G", obj.contents.some((o) => o.num === 321) ? 327 : 343);
    } else {
      // la baguette sans l'épée : elle la reprend (`2dd9:0afc`, `19dc:0000`) ; la suite (disparition, `G328`, `G329`) : lacune
      // (`characters.md` § 7.5, § 12.1)
      kit.confiscate(ctx, obj, other, SNATCHED);
      kit.sayHere(ctx, obj, "G", flag(obj, 0x20) !== 0 ? 365 : 328);
      setFlag(obj, 0x20, 7);
      setFlag(obj, 0x42, 3);
    }
  } else if (other.mob === 2) kit.faceOff(ctx, other, obj);
  else return true;
  obj.err = 0;
  return true;
}

/** `2dd9:0006` (`Num 303`). */
export function minas(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    const contact = () => minasContact(kit, ctx, obj);
    const head = kit.dispatchErr(ctx, obj, contact);
    if (head !== null) return head;
    const follow = kit.followOrDecide(ctx, obj, contact);
    if (follow !== null) return follow;

    const active = kit.inLoadedRoom(ctx, obj);
    switch (obj.ego) {
      case 1:
        if (!sequenceFinished(obj, active)) return endTic(obj);
        setMinas(kit, ctx, obj, 0);
        return endTic(obj);
      case 5:
        if (!sequenceFinished(obj, active)) return endTic(obj);
        setMinas(kit, ctx, obj, 0);
        if (kit.leaveRoom(ctx, obj)) return endTic(obj);
        break;
      case 2:
        // arrivée par téléportation : elle apparaît
        kit.startAnimation(ctx, obj, { id: ANM.appear, ego: 6 });
        return endTic(obj);
      case 3:
        obj.ego = 0;
        break;
      case 4:
        return endTic(obj);
      case 6: {
        const id = kit.pollAnimation(ctx, obj);
        if (id === 0) return endTic(obj);
        obj.speedY = 0;
        if (id === ANM.vanish) {
          vanish(kit, ctx, obj);
          return UPDATE_OK;
        }
        if (id === ANM.appear) {
          setMinas(kit, ctx, obj, 0);
          kit.sayHere(ctx, obj, "G", 310);
          return endTic(obj);
        }
        if (id === ANM.strangle) {
          // la victime liée (`Bag`) est remplacée par une dépouille (position copiée, P - 4)
          const victim = ctx.state.findBySerial(word(obj, 0x3a));
          if (victim) {
            kit.sayHere(ctx, victim, "G", 0);
            const remains = kit.replaceWithRemains(ctx, victim, 1, { cls: "G", number: 42 });
            if (remains) {
              kit.copyPosition(obj, remains);
              remains.p -= 4;
            }
          }
          setMinas(kit, ctx, obj, 0);
          return endTic(obj);
        }
        if (id === ANM.lava) {
          ctx.score.award(3, 0);
          kit.sayHere(ctx, obj, "G", 308);
          kit.destroy(ctx, obj, true);
          return RESTART;
        }
        setMinas(kit, ctx, obj, 0);
        break;
      }
      default:
        break;
    }
    return decide(kit, ctx, obj);
  };
}

const endTic = (obj: GameObject): number => {
  obj.err = 0;
  return UPDATE_OK;
};

/** Fin de l'animation 45 : choix d'une salle d'arrivée au hasard, puis départ (`Ego 2`). */
function vanish(kit: NpcKit, ctx: BehaviorContext, obj: GameObject): void {
  const rooms = ctx.state.rooms;
  for (let guard = 0; guard < 2000; guard++) {
    let id: number;
    if (kit.chance(ctx, 4)) id = ROOM.minasLair;
    else {
      id = rooms[ctx.rng.mod(rooms.length)]!.id;
      if (id < 22) {
        if (id > 19 || id === 0 || id === 10) continue;
      } else if (id === 212 || id === 313) continue;
    }
    const room = ctx.state.roomById(id);
    if (!room) continue;
    setMinas(kit, ctx, obj, 2);
    kit.teleport(ctx, obj, room);
    return;
  }
}

function decide(kit: NpcKit, ctx: BehaviorContext, obj: GameObject): number {
  obj.path.defined = false;
  if (flag(obj, OFF.control) !== 0) return endTic(obj);
  kit.stop(obj);
  const room = obj.room;
  const wand = wandOf(obj);
  const followedNum = ctx.state.findBySerial(word(obj, OFF.followed))?.num ?? 0;
  let remark = 0;
  for (const o of room?.listA ?? []) {
    if (o === obj || !kit.sees(ctx, obj, o)) continue;
    switch (o.num) {
      case NUM.sarhul:
        remark = 316;
        break;
      case NUM.hero:
        if (followedNum === NUM.hero || obj.ego !== 0 || o.ego === 4 || o.ego === 6 || o.ego === 8) break;
        if (!wand) {
          // sans baguette elle va chercher le héros (deux essais de trajet)
          if (kit.approach(ctx, obj, o, true) || kit.approach(ctx, obj, o, true)) return endTic(obj);
        } else if (obj.raw[0x42] === 0) {
          cast(kit, ctx, obj, o);
          return endTic(obj);
        } else {
          // hypothèse (characters.md § 7.5) : avertissements `G` (0x13C + n) avant le sort, un par compteur
          kit.sayNear(ctx, obj, "G", 0x13c + obj.raw[0x42]!);
          obj.raw[0x42] = obj.raw[0x42]! - 1;
          return endTic(obj);
        }
        break;
      case NUM.bear:
        if (wand) {
          cast(kit, ctx, obj, o);
          return endTic(obj);
        }
        break;
      case NUM.prytwen:
      case NUM.dwarfMiner:
      case NUM.dwarfMiner2:
      case NUM.dwarfWarrior:
      case NUM.dwarfWarrior2:
      case NUM.soldier:
        if (wand && (o.ego === 0 || o.ego > 2)) {
          cast(kit, ctx, obj, o);
          return endTic(obj);
        }
        remark = o.num === NUM.prytwen ? 315 : 312;
        break;
      default:
        // émeraude, fiole, sphère, baguette... : objets de valeur ou convoités (hypothèse : `Val >= 10` ou liste `SNATCHED`)
        if ((o.value >= 10 || SNATCHED.includes(o.num)) && o.num !== followedNum && kit.fetch(ctx, obj, o)) return endTic(obj);
    }
  }
  if (remark === 0) {
    if (wand && !kit.inLoadedRoom(ctx, obj) && kit.chance(ctx, 100)) {
      // elle laisse traîner sa baguette (1 chance sur 100 hors de la salle chargée)
      if (room) {
        ctx.state.moveToRoom(wand, room);
        kit.copyPosition(obj, wand);
      }
    }
    if (wand) {
      const idle = flag(obj, OFF.init) + 1;
      setFlag(obj, OFF.init, idle);
      if (idle > 0x13) {
        setFlag(obj, OFF.init, 0);
        kit.startAnimation(ctx, obj, { id: ANM.vanish, ego: 6 });
        return endTic(obj);
      }
    }
    // une fois sur 4 (`2dd9:0828`) elle quitte la salle (toujours si elle n'est pas à `Ego 0`), sinon elle erre
    if (obj.ego !== 0 || kit.chance(ctx, 4)) {
      if (kit.leaveRoom(ctx, obj)) return endTic(obj);
      if (wand) {
        setFlag(obj, OFF.init, 0);
        kit.startAnimation(ctx, obj, { id: ANM.vanish, ego: 6 });
        return endTic(obj);
      }
    }
  } else {
    // remarque d'ambiance une fois sur 10 (`2dd9:0777`)
    if (kit.chance(ctx, 10)) kit.sayHere(ctx, obj, "G", remark);
    if (kit.leaveRoom(ctx, obj)) return endTic(obj);
    if (wand) {
      setFlag(obj, OFF.init, 0);
      kit.startAnimation(ctx, obj, { id: ANM.vanish, ego: 6 });
      return endTic(obj);
    }
  }
  kit.wander(ctx, obj);
  return endTic(obj);
}

/** `2dd9:1440` (événement 5) : sur la lave (`Sol 0x34`), l'animation 36 (elle sombre). */
export function minasEvent(kit: NpcKit): EventHandler {
  return (ctx, entry, obj) => {
    if (!obj || entry.event !== MINAS_EVENT_LAVA) return;
    if (obj.ground === 0x34) kit.startAnimation(ctx, obj, { id: ANM.lava, ego: 6 });
  };
}

/** Programme la chute dans la lave (événement 5, `2dd9:1440`). */
export function armMinasLava(ctx: BehaviorContext, obj: GameObject, ticks: number): void {
  ctx.events.operate(target(obj), MINAS_EVENT_LAVA, EventOp.Set, ticks, NUM.minas);
}

export function registerMinas(registry: HandlerRegistry, kit: NpcKit): void {
  registry.register(FAMILY.character, NUM.minas, minas(kit));
  registry.register(FAMILY.event, NUM.minas, minasEvent(kit));
}
