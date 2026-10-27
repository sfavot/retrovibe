import { EventOp } from "../engine/events";
import type { BehaviorContext, BehaviorHandler, EventHandler, HandlerRegistry } from "../engine/handlers";
import { FAMILY } from "../engine/handlers";
import type { GameObject } from "../engine/state";
import { destroy, flag, NUM, OFF, ROOM, setFlag, spawnLike, word } from "./helpers";
import { type NpcKit, RESTART, UPDATE_OK } from "./npc-kit";
import { GRATE, doorState, moveDoor, startGrate } from "./objects";

/**
 * Prytwen le malfaisant (`Num 101`, `28b1:*`, `characters.md` § 7.2) : décision (voleur), ultimatum, duel et sa table de résolution,
 * événements différés 6 (réveil), 7 (mort de faim dans la salle au trésor fermée) et 14 (fin de l'ultimatum).
 */

const ANM_DUEL = 13;
const ANM_HERO_KO = 12;
const ANM_DUEL_END = [13, 14] as const;
const ANM_DUEL_OTHER = 15;
const ANM_GONE = 16;
const ANM_DEVOURED = 41;

/** Événements (`objects.md` § 8) : 6 réveil après KO, 7 mort de faim derrière la grille fermée de la salle 110, 14 fin de l'ultimatum ; procédure 101. */
export const PRYTWEN_EVENT = { wake: 6, starve: 7, ultimatum: 14 } as const;
const KO_TICKS = 3000;
/** Délai de l'événement 7 : Prytwen enfermé dans la salle 110 meurt de faim 10 000 tics plus tard (`28b1:0578`), 1 000 si le héros y est (`28b1:1384`). */
const STARVE_TICKS = 10000;
const STARVE_RETRY_TICKS = 1000;
const ULTIMATUM_TICKS = 20;
/** `Sol` de la salle au trésor, derrière la grille (`28b1:0557`). */
const GROUND_BEHIND_GRILLE = 0x45;

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
      if (other.mob === 0 && doorState(ctx, other.num) >= 0) {
        // porte à serrure (`28b1:0a94`) : fermée ou verrouillée, elle s'ouvre (`20b5:055e`) ; un tirage une fois sur deux seulement si Prytwen est `Ego 0`
        if ((obj.ego === 0 && !kit.chance(ctx, 2)) || doorState(ctx, other.num) === 2) return true;
        if (!moveDoor(ctx, other.num, 2, obj)) return true;
        break;
      }
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
        // mort (`28b1:0314`) : dans la salle chargée il reste inerte ; ailleurs, dans la salle 110 (ou le coffre `110`), un squelette
        // (`Num 112`) le remplace (`1a6b:0006`) ; partout ailleurs il est détruit (`19a6:01a5`)
        if (kit.inLoadedRoom(ctx, obj)) return endTic(obj);
        const place = obj.holder ?? obj.room;
        if ((obj.holder ? obj.holder.num : obj.room?.id) === ROOM.treasury && place) entomb(ctx, obj);
        else kit.destroy(ctx, obj, true);
        return RESTART;
      }
      case 4:
        if (kit.leaveRoom(ctx, obj, -1, true)) return endTic(obj);
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
      case NUM.grille: {
        // la grille de la salle 110 (`28b1:050a..0588`) : hors de la salle chargée, Prytwen se case derrière la grille fermée (`Sol 0x45`)
        // ou, grille ouverte, la referme une fois sur 20 ; enfermé, il meurt de faim (événement 7) et le héros gagne `(1, 2)`
        const open = o.ego === GRATE.open; // `2846:04d6`
        if (!kit.inLoadedRoom(ctx, obj)) {
          if (!open) obj.ground = GROUND_BEHIND_GRILLE;
          else if (kit.chance(ctx, 20)) startGrate(ctx, o, false);
        }
        if (obj.ground === GROUND_BEHIND_GRILLE && !open) {
          armStarvation(ctx, obj);
          ctx.score.award(1, 2);
        }
        break;
      }
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
        // `28b1:12e0..1305` : à terre (ou dans un autre contenant que le héros), il se relève et reprend ses décisions :
        // `1a37:003a(Gst 7, Mob 2, Ego 0, Fig 0)`, `G122`
        kit.setState(ctx, obj, { gst: 7, mob: 2, ego: 0, fig: 0 });
        kit.sayHere(ctx, obj, "G", 122);
        ctx.motion.reset(obj);
        return;
      }
      // porté par le héros : déposé dans la salle (`19dc:0000`), `G103`, puis un tirage `rand() % 4` (`28b1:1224..12dd`)
      if (hero.room === null && hero.holder === null) return;
      const room = hero.room;
      if (room) {
        ctx.state.moveToRoom(obj, room);
        kit.copyPosition(hero, obj);
      }
      kit.sayHere(ctx, obj, "G", 103);
      const roll = ctx.rng.mod(4);
      if (roll === 1) {
        // il s'en va (`Ego 4`) et le héros reprend la marche (`246c:0240(héros, 7, G106)`)
        kit.setState(ctx, obj, { gst: 7, mob: 2, ego: 4, fig: 0 });
        kit.releaseHero(ctx, hero);
        kit.sayNear(ctx, hero, "G", 106);
      } else {
        // 0 : il agrippe le héros, duel (animation 13, 14 dans l'antre, `G104`) ; 2 et 3 : animation 15 (`G105`) (`2594:0004` puis
        // `16f5:0132`, `28b1:1428`)
        const id = roll === 0 ? (obj.room?.id === ROOM.lair ? ANM_DUEL_END[1] : ANM_DUEL) : ANM_DUEL_OTHER;
        kit.sayNear(ctx, hero, "G", roll === 0 ? 104 : 105);
        kit.startAnimation(ctx, obj, { id, ego: 1, partner: hero });
        kit.holdHero(ctx, hero);
      }
      ctx.motion.reset(obj);
      return;
    }
    if (entry.event === PRYTWEN_EVENT.starve) {
      // `28b1:1308` : seulement dans la salle 110, grille fermée ; le héros dans la salle : nouvel essai dans 1 000 tics, sinon Prytwen,
      // mis en (X 0x2C, P 0x2F), est remplacé par un squelette (contenu laissé sur place)
      const place = obj.holder ?? obj.room;
      if ((obj.holder ? obj.holder.num : obj.room?.id) !== ROOM.treasury || !place) return;
      if (ctx.state.findByNum(NUM.grille)?.ego === GRATE.open) return;
      if (ctx.room && obj.room === ctx.room) {
        ctx.events.operate(target(obj), PRYTWEN_EVENT.starve, EventOp.Set, STARVE_RETRY_TICKS, NUM.prytwen);
        return;
      }
      obj.x = 0x2c;
      obj.p = 0x2f;
      entomb(ctx, obj);
    }
  };
}

/**
 * `1a6b:0006(Prytwen, Num 112)` avec le « lieu » en destination (`param_4 = 7`) : un squelette (`Typ 2`, poids 50, tous les autres champs à
 * zéro) prend sa place et sa position (`+0x52..+0x5F`), son contenu est déposé dans le lieu (`19dc:04f1`), puis il est détruit.
 */
function entomb(ctx: BehaviorContext, prytwen: GameObject): void {
  const skeleton = spawnLike(ctx, prytwen, NUM.skeleton, { gst: 0, mob: 0, dep: 0, txt: 0, ego: 0, fig: 0, weight: 50, capacity: 0, value: 0, light: 0, pickable: 0, canContain: 0 });
  destroy(ctx, prytwen, true);
  ctx.refreshObject(skeleton);
}

/**
 * `23a2:0002(obj, 7, 0, 10000)` (`28b1:0578`) : opération 0 = lire ou créer ; l'événement 7 est créé avec le compteur passé s'il n'existe
 * pas, un compteur déjà lancé n'est pas touché.
 */
export function armStarvation(ctx: BehaviorContext, obj: GameObject): void {
  ctx.events.operate(target(obj), PRYTWEN_EVENT.starve, EventOp.Get, STARVE_TICKS, NUM.prytwen);
}

export function registerPrytwen(registry: HandlerRegistry, kit: NpcKit): void {
  registry.register(FAMILY.character, NUM.prytwen, prytwen(kit));
  registry.register(FAMILY.event, NUM.prytwen, prytwenEvent(kit));
}
