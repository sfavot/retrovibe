import type { BehaviorContext, BehaviorHandler, HandlerRegistry } from "../engine/handlers";
import { FAMILY } from "../engine/handlers";
import type { GameObject } from "../engine/state";
import { flag, NUM, OFF, ROOM, setWord, word } from "./helpers";
import { type NpcKit, RESTART, UPDATE_OK } from "./npc-kit";

/**
 * Nains et soldats (`Num 201..204`, `301`, `2a44:*`, `characters.md` § 7.3) : décision, contact avec le héros, résolution du duel
 * (animation 29) selon l'inventaire du héros.
 */

/** Identifiants d'animation (§ 1.3). */
const ANM_DUEL = 29;
const ANM_VANISH = 28;

/** Issue d'un duel : V victoire du héros, K nain assommé, P héros tué, F le nain s'enfuit. */
export type DuelOutcome = "V" | "K" | "P" | "F";

/** Ce que le héros porte et qui compte dans le duel. */
export interface DuelGear {
  shield: boolean;
  sword: boolean;
  axe: boolean;
}

/** Type du nain : 0 mineur (201, 202), 1 guerrier (203, 204), 2 soldat (301). */
export function dwarfType(num: number): 0 | 1 | 2 {
  return num <= NUM.dwarfMiner2 ? 0 : num <= NUM.dwarfWarrior2 ? 1 : 2;
}

/** Table de résolution du duel (`2a44:02de`, `characters.md` § 7.3) : `r = rand() % 4`. */
export function resolveDuel(type: 0 | 1 | 2, gear: DuelGear, r: number): DuelOutcome {
  const { shield: s, sword: x, axe: a } = gear;
  if (s && x) return "V";
  if (type === 0) {
    if (s) {
      if (a) return "V";
      return r === 0 ? "P" : r === 1 ? "K" : "F";
    }
    if (x) return "V";
    if (a) return r <= 1 ? "P" : "V";
    return r === 0 ? "K" : "P";
  }
  if (type === 1) {
    if (s) {
      if (a) return r === 0 ? "P" : r === 1 ? "K" : "V";
      return r === 0 ? "K" : "P";
    }
    if (x) return r === 0 ? "K" : "V";
    if (a) return r === 0 ? "V" : "P";
    return "P";
  }
  if (!s && x) return r <= 1 ? "K" : "V";
  if (s && !x && a) return r === 0 ? "K" : "P";
  return "P";
}

/** Objets confisqués au héros mort (`DGROUP:5272`) : clef d'or, clef de bronze, trousseau, baguette, couronne, épée, clef ouvragée, talisman. */
const CONFISCATED = [6, 109, 108, 320, 328, 314, 331, 321];

const isDwarf = (num: number): boolean => num >= NUM.dwarfMiner && num <= NUM.dwarfWarrior2;

const gearOf = (hero: GameObject): DuelGear => ({
  shield: hero.contents.some((o) => o.num === NUM.shield),
  sword: hero.contents.some((o) => o.num === NUM.sword),
  axe: hero.contents.some((o) => o.num === NUM.axe),
});

/** Animations individuelles : assommé `20 + x`, abattu `24 + x` ; soldat 37 et 38. */
const knockedAnim = (obj: GameObject): number => (obj.num === NUM.soldier ? 37 : 20 + (obj.num - NUM.dwarfMiner));
const slainAnim = (obj: GameObject): number => (obj.num === NUM.soldier ? 38 : 24 + (obj.num - NUM.dwarfMiner));

/** Compteur de désintégrations vues (`DGROUP:4b72`) : le message `G204` ne vient qu'à la première. */
const vanishSeen = new WeakMap<object, number>();

/** `2a44:135a` : le nain se dirige vers `target` (le héros, en général) et devient agressif. */
export function aggro(kit: NpcKit, ctx: BehaviorContext, dwarf: GameObject, target: GameObject): boolean {
  if (dwarf.hidden !== 0) return false;
  if (target.ego > 6) kit.setEgo(ctx, target, 0, 0);
  if (!kit.approach(ctx, dwarf, target, true)) return false;
  if (word(dwarf, OFF.memo) !== 1 && target.ego !== 6) kit.sayNear(ctx, dwarf, "G", 0);
  dwarf.ego = 0;
  dwarf.err = 0;
  setWord(dwarf, OFF.memo, 1);
  return true;
}

/** `2a44:0ae6` : contact (`Ego` 0 ou >= 4). Faux = la procédure rend 0. */
function dwarfContact(kit: NpcKit, ctx: BehaviorContext, dwarf: GameObject): boolean {
  if (dwarf.ego !== 0 && dwarf.ego < 4) return true;
  const other = kit.touched(ctx, dwarf);
  if (!other) {
    dwarf.err = 0;
    return true;
  }
  const duel = (victim: GameObject, victimEgo: number) => {
    kit.sayHere(ctx, dwarf, "G", 0);
    kit.startAnimation(ctx, dwarf, { id: ANM_DUEL, ego: 1, partner: victim });
    victim.dep = 0;
    if (victim === ctx.hero || victim.num === NUM.hero) kit.holdHero(ctx, victim);
    else victim.ego = victimEgo;
    kit.stack(dwarf, victim);
    victim.err = 0;
  };
  if (other.num === NUM.hero) {
    if (other.hidden !== 0) {
      if (dwarf.ego < 7) {
        kit.sayNear(ctx, dwarf, "G", 0);
        kit.faceOff(ctx, other, dwarf);
      }
      return true;
    }
    if (dwarf.ego === 4) return true;
    if (other.ego === 8) {
      // le héros portait Prytwen assommé : il le lâche
      const prytwen = other.contents.find((o) => o.num === NUM.prytwen);
      if (prytwen && dwarf.room) {
        ctx.state.moveToRoom(prytwen, dwarf.room);
        kit.copyPosition(other, prytwen);
      }
    } else if (other.ego !== 0 && other.ego !== 2 && other.ego !== 5) return true;
    duel(other, 6);
  } else if (other.num === NUM.prytwen) {
    if (dwarf.ego === 4) return true;
    if (other.ego === 0 || other.ego === 4) duel(other, 1);
    else return true;
  } else if (isDwarf(other.num) || other.num === NUM.soldier) {
    if (dwarf.ego === 4 || dwarf.ego > 6) return true;
    kit.faceOff(ctx, other, dwarf);
  } else {
    // objet convoité : il le ramasse (`Val >= 10`, sauf pour le premier mineur), hypothèse : liste `DGROUP:0676` non relevée
    if (other.value >= 10 && dwarf.num !== NUM.dwarfMiner && kit.fits(dwarf, other)) ctx.state.moveToContainer(other, dwarf);
    else return true;
  }
  dwarf.err = 0;
  return true;
}

/** Fin de l'animation 29 : résolution contre le héros (`2a44:02de`) ou contre Prytwen. */
function resolveDuelEnd(kit: NpcKit, ctx: BehaviorContext, dwarf: GameObject): void {
  const partner = ctx.state.findBySerial(word(dwarf, 0x3a));
  if (!partner) {
    kit.setState(ctx, dwarf, { gst: 7, mob: 2, ego: 0, fig: 0 });
    return;
  }
  if (partner.num === NUM.prytwen) {
    // hypothèse (characters.md § 7.3) : duel nain / Prytwen (`2a44:02de`, branche non détaillée) : tirage `rand() % 3`, 0 si salle 105
    const roll = partner.room?.id === ROOM.lair ? 0 : ctx.rng.mod(3);
    kit.setEgo(ctx, dwarf, 0, 0);
    kit.setState(ctx, dwarf, { gst: 7, mob: 2 });
    if (roll === 0) {
      kit.setState(ctx, partner, { gst: 0, mob: 1, ego: 2, fig: 1 });
      ctx.events.operate({ typ: partner.typ, num: partner.num, serial: partner.serial }, 6, 3, 3000, NUM.prytwen);
    } else {
      partner.ego = roll === 1 ? 4 : 0;
      kit.setState(ctx, partner, { gst: 7, mob: 2 });
    }
    return;
  }
  const hero = partner;
  const type = dwarfType(dwarf.num);
  const outcome = resolveDuel(type, gearOf(hero), ctx.rng.mod(4));
  const soldier = type === 2;
  const x = dwarf.num - NUM.dwarfMiner;
  switch (outcome) {
    case "V":
      kit.startAnimation(ctx, dwarf, { id: slainAnim(dwarf), ego: 3 });
      kit.sayNear(ctx, hero, "G", hero.contents.some((o) => o.num === NUM.sword) ? 360 : 203);
      if (type === 1) ctx.score.award(2, 4);
      kit.releaseHero(ctx, hero);
      break;
    case "K":
      kit.startAnimation(ctx, dwarf, { id: knockedAnim(dwarf), ego: 2 });
      kit.sayNear(ctx, hero, "G", soldier ? (gearOf(hero).shield ? 358 : 359) : gearOf(hero).shield ? 216 : 202);
      kit.releaseHero(ctx, hero);
      break;
    case "F":
      kit.setState(ctx, dwarf, { gst: 7, mob: 2, ego: 4, fig: 0 });
      kit.sayNear(ctx, dwarf, "G", 217);
      kit.leaveRoom(ctx, dwarf);
      kit.releaseHero(ctx, hero);
      break;
    default: {
      // le héros meurt : le nain prend les objets clés, puis la dépouille (variante `rand() % 2`)
      kit.setState(ctx, dwarf, { gst: 7, mob: 2, ego: 0, fig: 0 });
      kit.sayNear(ctx, dwarf, "G", soldier ? 356 : 220);
      kit.sayNear(ctx, dwarf, "G", soldier ? 357 : 201);
      if (kit.confiscate(ctx, dwarf, hero, CONFISCATED) > 0) kit.sayNear(ctx, dwarf, "G", 212);
      kit.replaceWithRemains(ctx, hero, ctx.rng.mod(2));
    }
  }
  void x;
}

/** `2a44:000c` (`Num 201..204`, `301`). */
export function dwarf(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    const type = dwarfType(obj.num);
    const contact = () => dwarfContact(kit, ctx, obj);
    const head = kit.dispatchErr(ctx, obj, () => (obj.ego === 0 || obj.ego > 4 ? contact() : true));
    if (head !== null) return head;
    const follow = kit.followOrDecide(ctx, obj, contact);
    if (follow !== null) return follow;

    switch (obj.ego) {
      case 1:
      case 2:
      case 3: {
        const id = kit.pollAnimation(ctx, obj);
        if (id === 0) {
          obj.err = 0;
          return UPDATE_OK;
        }
        obj.speedY = 0;
        if (id === ANM_DUEL) {
          resolveDuelEnd(kit, ctx, obj);
          obj.err = 0;
          return UPDATE_OK;
        }
        if (id === ANM_VANISH) {
          kit.destroy(ctx, obj, true);
          return RESTART;
        }
        if (id >= 24 && id <= 27 || id === 38) {
          // abattu : première désintégration annoncée, puis animation 28
          const seen = vanishSeen.get(ctx.state) ?? 0;
          vanishSeen.set(ctx.state, seen + 1);
          if (seen === 0) kit.sayHere(ctx, obj, "G", 204);
          kit.startAnimation(ctx, obj, { id: ANM_VANISH, ego: 3 });
          obj.err = 0;
          return UPDATE_OK;
        }
        // réveil d'un nain assommé (animations 20..23, 37)
        kit.setState(ctx, obj, { gst: 7, mob: 2, ego: 0, fig: 0 });
        kit.sayHere(ctx, obj, "G", 214);
        break;
      }
      case 4:
        if (kit.leaveRoom(ctx, obj)) return endTic(obj);
        obj.path.defined = false;
        kit.wander(ctx, obj);
        return endTic(obj);
      case 7:
      case 8:
        return endTic(obj);
      default:
        break;
    }
    return decide(kit, ctx, obj, type);
  };
}

const endTic = (obj: GameObject): number => {
  obj.err = 0;
  return UPDATE_OK;
};

/** Postes des gardes (`2a44:0a60`, `2a44:0a84` -> `2151:0006`) : intervalles de X et de P où ils flânent. */
export const POST_CELLAR = { x: [100, 170], p: [50, 52] } as const;
export const POST_NORTH = { x: [57, 95], p: [18, 20] } as const;

/** Case où le héros déclenche le garde : `Ego 6` (passage nord) sur la case 0x36, `Ego 5` (cellier) sur la case 0x37 (`2a44:08fe`, `2a44:091a`). */
const TRIGGER_GROUND = { 5: 0x37, 6: 0x36 } as const;

/** Compteur de rappels « ils dorment » des gardes (`DGROUP:5282`, 5 puis décompte à chaque vue). */
const sleeperHint = new WeakMap<object, number>();

/**
 * Un garde de poste (`Ego 5` ou `6`) qui voit le héros (`2a44:08da..0994`, certain) : il l'attaque si le héros est sur sa case de
 * déclenchement ; sinon il l'ignore tant qu'un autre soldat éveillé est dans la salle (`Ego 0..5` pour le garde du passage nord, `0..1`
 * pour le garde du cellier : `21fb:005a`) ; s'il n'y en a pas mais que des soldats dorment (`Ego 7/8`), il l'ignore aussi (et rappelle
 * « ils dorment » `G341` une fois sur 6 devant le héros ou Prytwen, `DGROUP:5282`) ; sinon il reprend son état normal (`1a37:0002(0, 0)`,
 * mouvements remis à zéro) et attaque.
 */
export function guardAttacks(kit: NpcKit, ctx: BehaviorContext, guard: GameObject, seen: GameObject): boolean {
  if (seen.ground === TRIGGER_GROUND[guard.ego as 5 | 6]) return true;
  const mates = guard.room?.listA ?? [];
  const awakeMax = guard.ego === 6 ? 5 : 1;
  if (mates.some((o) => o.num === NUM.soldier && o.ego <= awakeMax)) return false;
  if (mates.some((o) => o.num === NUM.soldier && (o.ego === 7 || o.ego === 8))) {
    if (seen.num === NUM.hero || seen.num === NUM.prytwen) {
      const left = sleeperHint.get(ctx.state) ?? 0;
      if (left === 0) {
        kit.sayHere(ctx, guard, "G", 341);
        sleeperHint.set(ctx.state, 5);
      } else sleeperHint.set(ctx.state, left - 1);
    }
    return false;
  }
  kit.setEgo(ctx, guard, 0, 0);
  ctx.motion.reset(guard);
  return true;
}

function decide(kit: NpcKit, ctx: BehaviorContext, obj: GameObject, type: 0 | 1 | 2): number {
  obj.path.defined = false;
  if (flag(obj, OFF.control) !== 0) return endTic(obj);
  kit.stop(obj);
  const room = obj.room;
  const soldier = type === 2;
  const followedNum = ctx.state.findBySerial(word(obj, OFF.followed))?.num ?? 0;
  for (const o of room?.listA ?? []) {
    if (o === obj) continue;
    switch (o.num) {
      case NUM.portcullis:
        // la herse ouverte : « Armaëth ! » (`G232`) et il la referme (`29fd:017a`)
        if (o.ego === 3) {
          kit.sayHere(ctx, obj, "G", 232);
          kit.setState(ctx, o, { gst: 7, mob: 1, ego: 2, fig: 0 }, 2);
          o.tim = 0x22;
        }
        continue;
      case NUM.dwarfMiner:
      case NUM.dwarfMiner2:
      case NUM.dwarfWarrior:
      case NUM.dwarfWarrior2:
      case NUM.axe:
        continue;
      default:
        break;
    }
    if (!kit.sees(ctx, obj, o)) continue;
    if (o.num === NUM.hero) {
      if (obj.ego > 6 || o.ego === 4 || o.ego === 6) continue;
      if (obj.ego >= 5 && o.num === followedNum) continue;
      if (soldier && obj.ego >= 5 && !guardAttacks(kit, ctx, obj, o)) continue;
      if (aggro(kit, ctx, obj, o)) return endTic(obj);
    } else if (o.num === NUM.prytwen) {
      if ((o.ego === 0 || o.ego === 1 || o.ego === 2 || o.ego === 4) && o.num !== followedNum && !soldier && kit.approach(ctx, obj, o, true)) {
        setWord(obj, OFF.memo, o.num);
        return endTic(obj);
      }
    } else if (o.num === NUM.sarhul || o.num === NUM.minas) {
      // ils fuient Sarhûls et Minas Thyl (`G340`)
      if (kit.leaveRoom(ctx, obj)) {
        kit.sayHere(ctx, obj, "G", 340);
        return endTic(obj);
      }
    } else if (o.value >= 10 && obj.num !== NUM.dwarfMiner && kit.fetch(ctx, obj, o)) return endTic(obj);
  }
  // une fois sur 4 (`2a44:0a2f`) il quitte la salle, sauf un soldat de la salle 305 ; sinon il erre (ou rejoint son poste)
  if (!(soldier && room?.id === ROOM.soldiers) && kit.chance(ctx, 4) && kit.leaveRoom(ctx, obj)) {
    setWord(obj, OFF.memo, 0);
    return endTic(obj);
  }
  if (obj.ego === 5) kit.wander(ctx, obj, POST_CELLAR);
  else if (obj.ego === 6) kit.wander(ctx, obj, POST_NORTH);
  else kit.wander(ctx, obj);
  setWord(obj, OFF.memo, 0);
  return endTic(obj);
}

export function registerDwarves(registry: HandlerRegistry, kit: NpcKit): void {
  registry.register(FAMILY.character, [NUM.dwarfMiner, NUM.dwarfMiner2, NUM.dwarfWarrior, NUM.dwarfWarrior2, NUM.soldier], dwarf(kit));
}
