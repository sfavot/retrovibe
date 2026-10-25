import { EventOp } from "../engine/events";
import type { BehaviorContext, BehaviorHandler, EventHandler, HandlerRegistry } from "../engine/handlers";
import { FAMILY } from "../engine/handlers";
import type { GameObject } from "../engine/state";
import { flag, NUM, OFF, ROOM, setFlag, word } from "./helpers";
import { type NpcKit, RESTART, UPDATE_OK } from "./npc-kit";

/**
 * Prytwen le malfaisant (`Num 101`, `28b1:*`, `characters.md` § 7.2) : décision (voleur), ultimatum, duel et sa table de résolution,
 * événements différés 6 (réveil), 7 (retour au trésor) et 14 (fin de l'ultimatum).
 */

const ANM_DUEL = 13;
const ANM_HERO_KO = 12;
const ANM_DUEL_END = [13, 14] as const;
const ANM_DUEL_OTHER = 15;
const ANM_GONE = 16;
const ANM_DEVOURED = 41;

/** Événements (`objects.md` § 8) : 6 réveil après KO, 7 retour en salle 110, 14 fin de l'ultimatum ; procédure 101. */
export const PRYTWEN_EVENT = { wake: 6, home: 7, ultimatum: 14 } as const;
const KO_TICKS = 3000;
const HOME_TICKS = 10000;
const ULTIMATUM_TICKS = 20;

const target = (o: GameObject) => ({ typ: o.typ, num: o.num, serial: o.serial });

/** Issue d'un duel de Prytwen : `d` de § 7.2 (0 héros tué, 1 Prytwen KO, >= 2 héros KO). */
export function prytwenDuelRoll(ctx: BehaviorContext, prytwen: GameObject): number {
  const count = flag(prytwen, OFF.counter);
  setFlag(prytwen, OFF.counter, count + 1 > 6 ? 0 : count + 1);
  if (prytwen.room?.id === ROOM.lair) return 0;
  // hypothèse (characters.md § 7.2) : `gm_chance_one_in(n)` du second cas, `n` caché dans un registre : pris à 2
  if (count < 2) return ctx.rng.mod(4) + 1;
  return (kitChance2(ctx) ? 1 : 0) + 1;
}
const kitChance2 = (ctx: BehaviorContext): boolean => ctx.rng.mod(2) === 0;

/** Début du duel : Prytwen `Ego 1`, héros `Ego 6`, positions superposées (`P + 1`). */
function startDuel(kit: NpcKit, ctx: BehaviorContext, prytwen: GameObject, hero: GameObject): void {
  kit.sayHere(ctx, prytwen, "G", 0);
  kit.startAnimation(ctx, prytwen, { id: ANM_DUEL, ego: 1, partner: hero });
  hero.dep = 0;
  kit.holdHero(ctx, hero);
  kit.stack(prytwen, hero);
  hero.err = 0;
}

/** `28b1:0734` : contact (`Ego` 0, 4 ou 5). Faux = la procédure rend 0. */
function prytwenContact(kit: NpcKit, ctx: BehaviorContext, obj: GameObject): boolean {
  const other = kit.touched(ctx, obj);
  if (!other) {
    obj.err = 0;
    return true;
  }
  if (obj.ego !== 0 && obj.ego !== 4 && obj.ego !== 5) return true;
  switch (other.num) {
    case NUM.hero:
      if (other.hidden === 0) {
        if (other.ego !== 0) return true;
        if (obj.room?.id === ROOM.lair) startDuel(kit, ctx, obj, other);
        else if (obj.ego === 0) {
          // ultimatum : le joueur perd la main, ils se font face, Prytwen attend l'or 20 tics (`Ego 5`)
          ctx.state.moveEnabled = false;
          kit.stop(other);
          ctx.motion.reset(other);
          obj.ego = 5;
          kit.faceOff(ctx, other, obj);
          kit.sayHere(ctx, obj, "G", 0);
          obj.speedX = 0;
          obj.speedP = 0;
          ctx.motion.reset(obj);
          ctx.events.operate(target(obj), PRYTWEN_EVENT.ultimatum, EventOp.Set, ULTIMATUM_TICKS, NUM.prytwen);
        } else return true;
      } else {
        kit.sayNear(ctx, obj, "G", 0);
        kit.faceOff(ctx, other, obj);
      }
      break;
    case NUM.oakChest:
      // le coffre de chêne : ouvert s'il est fermé non verrouillé, puis pillé
      if (other.ego === 1) other.ego = 2;
      else if (other.ego !== 2) return true;
      if (kit.steal(ctx, obj, other) === 0) return true;
      kit.sayHere(ctx, obj, "G", 0);
      kit.leaveRoom(ctx, obj, -1, true);
      break;
    case NUM.treasureChest: {
      // il y range son butin (sauf la clef de bronze) ; verrouillé, il lui faut la clef
      const key = other.contents.find((o) => o.num === NUM.bronzeKey) ?? obj.contents.find((o) => o.num === NUM.bronzeKey);
      const loot = obj.contents.filter((o) => o.num !== NUM.bronzeKey);
      if (other.ego === 0 && !key) return true;
      if (loot.length === 0) return true;
      for (const item of loot) ctx.state.moveToContainer(item, other);
      kit.sayHere(ctx, obj, "G", 0);
      break;
    }
    default:
      if (other.pickable === 0 || other.hidden !== 0) return true;
      if ((other.value >= 10 || other.num === NUM.bronzeKey) && kit.fits(obj, other)) ctx.state.moveToContainer(other, obj);
      else return true;
  }
  obj.err = 0;
  return true;
}

/** Fin d'un duel (animations 13 et 14) : table de résolution du § 7.2. */
function resolveDuel(kit: NpcKit, ctx: BehaviorContext, obj: GameObject): void {
  const hero = ctx.state.findBySerial(word(obj, 0x3a)) ?? ctx.hero;
  const d = prytwenDuelRoll(ctx, obj);
  if (!hero) {
    kit.setState(ctx, obj, { gst: 7, mob: 2, ego: 0, fig: 0 });
    return;
  }
  if (d === 0) {
    // le héros est tué ; Prytwen vole la dépouille puis part
    kit.setState(ctx, obj, { gst: 7, mob: 2, ego: 0, fig: 0 });
    const remains = kit.replaceWithRemains(ctx, hero, 0, { cls: "G", number: 101 });
    if (remains) kit.steal(ctx, obj, remains);
    kit.leaveRoom(ctx, obj, -1, true);
  } else if (d === 1) {
    kit.setState(ctx, obj, { gst: 0, mob: 1, ego: 2, fig: 1 });
    ctx.events.operate(target(obj), PRYTWEN_EVENT.wake, EventOp.Set, KO_TICKS, NUM.prytwen);
    kit.releaseHero(ctx, hero);
    kit.sayNear(ctx, hero, "G", 118);
    ctx.score.award(1, 1);
  } else {
    // héros KO (animation 12, `G102`), Prytwen s'en va après l'avoir détroussé
    kit.setState(ctx, obj, { gst: 7, mob: 2, ego: 4, fig: 0 });
    kit.sayNear(ctx, hero, "G", 102);
    kit.startAnimation(ctx, hero, { id: ANM_HERO_KO, ego: 6 });
    kit.steal(ctx, obj, hero);
    kit.sayNear(ctx, obj, "G", 124);
  }
}

/** `28b1:0000` (`Num 101`). */
export function prytwen(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    const contact = () => prytwenContact(kit, ctx, obj);
    if (obj.err === 0x0b && obj.ego === 4) obj.ego = 0;
    const head = kit.dispatchErr(ctx, obj, contact);
    if (head !== null) return head;
    const follow = kit.followOrDecide(ctx, obj, contact);
    if (follow !== null) return follow;

    switch (obj.ego) {
      case 1: {
        const id = kit.pollAnimation(ctx, obj);
        if (id === 0) return endTic(obj);
        obj.speedY = 0;
        if (id === ANM_DEVOURED || id === ANM_GONE) {
          kit.destroy(ctx, obj);
          return RESTART;
        }
        if ((ANM_DUEL_END as readonly number[]).includes(id)) {
          resolveDuel(kit, ctx, obj);
          return endTic(obj);
        }
        if (id === ANM_DUEL_OTHER) {
          // autre issue : héros KO, Prytwen part avec le butin
          const hero = ctx.state.findBySerial(word(obj, 0x3a)) ?? ctx.hero;
          kit.setState(ctx, obj, { gst: 7, mob: 2, ego: 4, fig: 0 });
          if (hero) {
            kit.startAnimation(ctx, hero, { id: ANM_HERO_KO, ego: 6 });
            kit.steal(ctx, obj, hero);
          }
          kit.leaveRoom(ctx, obj, -1, true);
          return endTic(obj);
        }
        break;
      }
      case 2:
      case 5:
        return endTic(obj);
      case 3: {
        // mort : hors de la salle chargée il disparaît (lacune : objet de remplacement en salle 110, `1a6b:0006` non relevé)
        // lacune (characters.md § 7.2) : l'objet de remplacement créé dans la salle 110 n'est pas identifié
        if (!kit.inLoadedRoom(ctx, obj) && obj.room?.id !== ROOM.treasury) {
          kit.destroy(ctx, obj, true);
          return RESTART;
        }
        return endTic(obj);
      }
      case 4:
        if (kit.leaveRoom(ctx, obj, -1, true)) {
          armPrytwenHome(ctx, obj);
          return endTic(obj);
        }
        obj.path.defined = false;
        kit.wander(ctx, obj);
        return endTic(obj);
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

function decide(kit: NpcKit, ctx: BehaviorContext, obj: GameObject): number {
  obj.path.defined = false;
  if (flag(obj, OFF.control) !== 0) return endTic(obj);
  kit.stop(obj);
  const room = obj.room;
  const inLair = room?.id === ROOM.lair;
  const treasures = obj.contents.filter((o) => o.value >= 10).length;
  const hasKey = obj.contents.some((o) => o.num === NUM.bronzeKey);
  // butin et clef en poche hors de sa tanière : il rentre (`228e`)
  if (treasures > 0 && hasKey && !inLair && kit.leaveRoom(ctx, obj, -1, true)) return endTic(obj);
  const followedNum = ctx.state.findBySerial(word(obj, OFF.followed))?.num ?? 0;
  const tossUp = kit.chance(ctx, 2);
  for (const o of room?.listA ?? []) {
    if (o === obj || o.hidden !== 0) continue;
    switch (o.num) {
      case NUM.hero:
        if (o.num === followedNum || o.ego === 6) break;
        if (inLair) {
          // dans sa tanière il l'aborde toujours (`G126`) ; ailleurs sans butin ou une fois sur n (`G125`)
          if (kit.approach(ctx, obj, o, true)) return approached(kit, ctx, obj, 126);
        } else if ((treasures === 0 || kit.chance(ctx, treasures)) && kit.approach(ctx, obj, o, true)) return approached(kit, ctx, obj, 125);
        break;
      case NUM.dwarfMiner:
      case NUM.dwarfMiner2:
      case NUM.dwarfWarrior:
      case NUM.dwarfWarrior2:
      case NUM.soldier:
        if (o.ego !== 0 && o.ego !== 2 && o.ego !== 4) break;
        if (inLair) {
          if (kit.approach(ctx, obj, o, true)) return approached(kit, ctx, obj, 0);
        } else if (o.ego === 0 && kit.leaveRoom(ctx, obj, -1, true)) {
          kit.sayHere(ctx, obj, "G", 0);
          return endTic(obj);
        }
        break;
      case NUM.sarhul:
      case NUM.minas:
        if (kit.leaveRoom(ctx, obj, -1, true)) {
          kit.sayHere(ctx, obj, "G", 0);
          return endTic(obj);
        }
        break;
      case NUM.oakChest:
        if (tossUp && o.num !== followedNum && kit.approach(ctx, obj, o)) return endTic(obj);
        break;
      case NUM.treasureChest:
        if (treasures > 0 && kit.approach(ctx, obj, o)) return endTic(obj);
        break;
      case NUM.grille:
        // lacune (characters.md § 7.2) : la comptabilité de la grille 103 (`2846:04d6`, `Sol 0x45`, événement) n'est pas relevée
        break;
      default:
        if ((o.value >= 10 || o.num === NUM.bronzeKey) && kit.fetch(ctx, obj, o)) return endTic(obj);
    }
  }
  // une fois sur 4 (`28b1:0703`) il quitte la salle, sinon il erre
  if (!(kit.chance(ctx, 4) && kit.leaveRoom(ctx, obj, -1, true))) kit.wander(ctx, obj);
  return endTic(obj);
}

function approached(kit: NpcKit, ctx: BehaviorContext, obj: GameObject, message: number): number {
  kit.sayHere(ctx, obj, "G", message);
  obj.ego = 0;
  return endTic(obj);
}

// --- événements différés (famille 8, clé 101) ---------------------------------------------------------------------------------

/** `28b1:11e0` : 6 réveil, 7 retour à la salle 110, 14 fin de l'ultimatum. */
export function prytwenEvent(kit: NpcKit): EventHandler {
  return (ctx, entry, obj) => {
    if (!obj) return;
    const hero = ctx.hero;
    if (entry.event === PRYTWEN_EVENT.ultimatum) {
      if (obj.ego !== 5) return;
      ctx.state.moveEnabled = true;
      if (hero && hero.hidden === 0 && hero.ego === 0 && hero.room === obj.room && kit.touchesOrNear(obj, hero)) {
        kit.stack(hero, obj);
        obj.p = hero.p + 1;
        startDuel(kit, ctx, obj, hero);
      } else kit.setState(ctx, obj, { ego: 0, fig: 0 });
      return;
    }
    if (entry.event === PRYTWEN_EVENT.wake) {
      const carried = hero !== null && obj.holder === hero;
      if (!carried) {
        kit.setState(ctx, obj, { gst: 7, mob: 2, ego: 4, fig: 0 });
        kit.sayHere(ctx, obj, "G", 103);
        ctx.motion.reset(obj);
        return;
      }
      // porté par le héros : déposé dans la salle, puis un tirage `rand() % 4`
      if (hero.room === null && hero.holder === null) return;
      const room = hero.room;
      if (room) {
        ctx.state.moveToRoom(obj, room);
        kit.copyPosition(hero, obj);
      }
      kit.sayHere(ctx, obj, "G", 104);
      // `28b1:11e0` (décompilat) : `rand() % 4 == 1` le laisse repartir et libère le héros (`246c:0240`), les autres tirages (0, 2, 3)
      // l'agrippent dans une animation à deux : une chance sur quatre seulement de s'en tirer
      if (ctx.rng.mod(4) === 1) {
        kit.setState(ctx, obj, { gst: 7, mob: 2, ego: 0, fig: 0 });
        kit.releaseHero(ctx, hero);
      } else {
        // hypothèse (characters.md § 7.2) : il agrippe le héros (animation à deux)
        kit.startAnimation(ctx, obj, { id: ANM_DUEL, ego: 1, partner: hero });
        kit.holdHero(ctx, hero);
      }
      ctx.motion.reset(obj);
      return;
    }
    if (entry.event === PRYTWEN_EVENT.home) {
      // retour dans la salle 110 en (X 0x2C, P 0x2F), si le héros n'y est pas
      const home = ctx.state.roomById(ROOM.treasury);
      if (!home || ctx.room === home) return;
      ctx.state.moveToRoom(obj, home);
      obj.presence = 1;
      obj.x = 0x2c;
      obj.p = 0x2f;
      kit.setState(ctx, obj, { gst: 7, mob: 2, ego: 0, fig: 0 });
    }
  };
}

/** Programme le retour au trésor (10 000 tics) quand Prytwen s'enfuit (`28b1:0578`). */
export function armPrytwenHome(ctx: BehaviorContext, obj: GameObject): void {
  ctx.events.operate(target(obj), PRYTWEN_EVENT.home, EventOp.Set, HOME_TICKS, NUM.prytwen);
}

export function registerPrytwen(registry: HandlerRegistry, kit: NpcKit): void {
  registry.register(FAMILY.character, NUM.prytwen, prytwen(kit));
  registry.register(FAMILY.event, NUM.prytwen, prytwenEvent(kit));
}
