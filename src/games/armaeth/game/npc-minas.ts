import { EventOp } from "../engine/events";
import type { BehaviorContext, BehaviorHandler, EventHandler, HandlerRegistry } from "../engine/handlers";
import { FAMILY } from "../engine/handlers";
import { sequenceFinished } from "../engine/animation";
import type { GameObject } from "../engine/state";
import { turnIntoToad } from "./npc-creatures";
import { flag, NUM, OFF, playAnim, ROOM, setFlag, word } from "./helpers";
import { type NpcKit, RESTART, UPDATE_OK } from "./npc-kit";
import { doorState, moveDoor } from "./objects";

/**
 * Minas Thyl la sorcière (`Num 303`, `2dd9:*`, `characters.md` § 7.5), relue ligne à ligne dans `disasm.txt` (`2dd9:0006` à
 * `2dd9:1570`). Le « module `2dd9:009d` de 47 Ko » n'existe pas : `2dd9:009d` est la table de sauts de l'`Err` de `2dd9:0006` (20
 * mots), que Ghidra a prise pour du code. La capture du héros et le chaudron sont répartis entre le contact (`2dd9:0858`, branche
 * du héros dans la salle 301 : `0954`..`0a1a`), l'arrivée au chaudron (`2dd9:0c80`) et la fin de l'animation 34 (`2dd9:02da`) ; la
 * reprise de la baguette est `2dd9:0afc`.
 *
 * Champs libres de l'enregistrement : `+0x20` (a eu la baguette), `+0x2c` (compteur d'attente), `+0x3a` (`Bag`, la victime liée),
 * `+0x42` (avertissements restants), `+0x43` (le pacte a déjà été proposé) ; `+0x78` (`Cib`) est le `Num` de l'objet suivi (ici
 * lu par `Ser`, `OFF.followed`).
 */

const ANM = { held: 1, soup: 34, lava: 36, appear: 44, vanish: 45 } as const;
/** Objets que Minas Thyl prend au héros (`DGROUP:5284`) : émeraude, baguette, sphère de cristal, fiole. */
const SNATCHED = [313, 320, 315, 304];
/** Événement 5 : sur la lave (`Sol 0x34`), animation 36 (`objects.md` § 8). */
export const MINAS_EVENT_LAVA = 5;
/** `Sol` de la lave (`2dd9:002e`, `2dd9:1456`), du cratère où gît l'objet convoité (`2dd9:0c0d`) et du sol de l'antre où elle dépose son butin. */
const GROUND = { lava: 0x34, crater: 0x3d, chapiter: 0x3c, loot: 0x53 } as const;
/** Octets libres. */
const FIELD = { hadWand: 0x20, bag: 0x3a, warnings: 0x42, pact: 0x43 } as const;

const target = (o: GameObject) => ({ typ: o.typ, num: o.num, serial: o.serial });
const wandOf = (minas: GameObject): GameObject | undefined => minas.contents.find((o) => o.num === NUM.wand);

/** `Num` de l'objet suivi (`Cib` +0x78 du trajet en cours, 0 sans suivi). */
function followedNum(ctx: BehaviorContext, minas: GameObject): number {
  return ctx.state.findBySerial(word(minas, OFF.followed))?.num ?? 0;
}

/**
 * `2dd9:1478(obj, Fig, classe, numéro ; AL = Gst 7, DL = Mob, BL = Ego)` : nouvel état (`1a37:003a`), `Ver` = (`Mob` != 0), mouvement
 * annulé (`30d9:0114`), message éventuel (`209c:000c`).
 */
function setMinas(kit: NpcKit, ctx: BehaviorContext, obj: GameObject, ego: number, fig: number, mob: number, message = 0): void {
  kit.setState(ctx, obj, { gst: 7, mob, ego, fig });
  obj.speedY = mob !== 0 ? 1 : 0;
  ctx.motion.reset(obj);
  if (message > 0) kit.sayHere(ctx, obj, "G", message);
}

/** `2dd9:14cc(victime, Minas ; classe G, message)` : `1478` (`Ego 1`, `Mob 1`, `Fig 1`) puis le sort de crapaud `2d52:06b0`. */
function cast(kit: NpcKit, ctx: BehaviorContext, minas: GameObject, victim: GameObject, message: number): void {
  setMinas(kit, ctx, minas, 1, 1, 1, message);
  turnIntoToad(kit, ctx, victim, minas);
}

/** Message affiché directement (mode 0 de `16f5:0132`) : le héros l'entend même hors de la salle. */
function sayDirect(ctx: BehaviorContext, number: number): void {
  ctx.messages.say("G", number);
}

/** `16f5:0132` avec `Ego 6` (disparition 45 : sans partenaire, message en mode 1 = `209c:000c`). */
function vanishWith(kit: NpcKit, ctx: BehaviorContext, obj: GameObject, message = 0): void {
  kit.startAnimation(ctx, obj, { id: ANM.vanish, ego: 6 });
  if (message > 0) kit.sayHere(ctx, obj, "G", message);
}

/**
 * `2dd9:1510(Minas)` : Minas Thyl sombre dans la lave (animation 36, `Ego 6`, sans partenaire). Message en mode 0 (direct) : `G309`
 * si le héros est dans sa salle (`21fb:011e`), `G370` sinon.
 */
function sinkIntoLava(kit: NpcKit, ctx: BehaviorContext, minas: GameObject): void {
  kit.startAnimation(ctx, minas, { id: ANM.lava, ego: 6 });
  const hero = ctx.hero;
  sayDirect(ctx, hero !== null && hero.room !== null && hero.room === minas.room ? 309 : 370);
}

/**
 * Capture du héros dans l'antre, salle 301 (`2dd9:0954`..`0a1a`). Minas Thyl passe `Ego 4` (`G323`), vide les poches du héros
 * dans les siennes (`19dc:04f1`, `G366`), part en suivant le chaudron `306` (`22ef:0000`, drapeau 7) ; le héros entre dans
 * l'animation 1 (`2594:0004`, 10 pas de 250 tics, partenaire Minas) et est placé sur le chaudron. La suite est `stirCauldron`.
 */
function captureHero(kit: NpcKit, ctx: BehaviorContext, minas: GameObject, hero: GameObject): void {
  setMinas(kit, ctx, minas, 4, 4, 2, 323);
  if (hero.contents.length > 0) {
    for (const item of [...hero.contents]) ctx.state.moveToContainer(item, minas);
    kit.sayHere(ctx, hero, "G", 366);
  }
  const cauldron = minas.room?.listA.find((o) => o.num === NUM.cauldron);
  // `21fb:005a` : `gm_abort(0x80)` sans chaudron (il y en a toujours un dans l'antre) ; `22ef:0000` nul : `gm_abort(0x6c)`
  if (!cauldron) return;
  kit.approach(ctx, minas, cauldron, true);
  playAnim(ctx, { animation: ANM.held, obj: hero, partner: minas });
  hero.err = 0;
  kit.copyPosition(cauldron, hero);
}

/**
 * Minas Thyl `Ego 4` touche le chaudron (`2dd9:0c80`) : elle y jette sa victime (la `Bag` : `1a7b:03d7`). Animation 34 sur elle,
 * partenaire la victime, `G364` (mode 1) ; elle prend la position du chaudron (`P + 2`) ; le chaudron bout (`Ego 1`, écrit
 * directement). La fin de l'animation est `eatVictim`.
 */
function stirCauldron(kit: NpcKit, ctx: BehaviorContext, minas: GameObject, cauldron: GameObject): void {
  if (minas.ego !== 4) return;
  const victim = ctx.state.findBySerial(word(minas, FIELD.bag));
  kit.startAnimation(ctx, minas, { id: ANM.soup, ego: 6, partner: victim ?? null });
  kit.sayHere(ctx, minas, "G", 364);
  kit.copyPosition(cauldron, minas);
  minas.p += 2;
  cauldron.ego = 1;
}

/**
 * Fin de l'animation 34 (`2dd9:02da`) : la victime liée (`21fb:00c6` sur `Bag`) est cuite : `G307` (dite par Minas), dépouille de
 * variante 2 (`2405:0000`, sans message ; le chaudron reviendra à `Ego 0` à la fin de la dépouille, `2405:0106`) à la position de
 * Minas, qui recule de 4 en profondeur ; Minas reprend `Ego 0`, `Mob 2` (`1478`, sans message).
 */
function eatVictim(kit: NpcKit, ctx: BehaviorContext, minas: GameObject): void {
  const victim = ctx.state.findBySerial(word(minas, FIELD.bag));
  // `gm_abort(0x7f)` si la victime n'est plus là
  if (victim && victim.room === minas.room) {
    kit.sayHere(ctx, minas, "G", 307);
    const remains = kit.replaceWithRemains(ctx, victim, 2);
    if (remains) kit.copyPosition(minas, remains);
    minas.p -= 4;
  }
  setMinas(kit, ctx, minas, 0, 0, 2);
}

/**
 * Reprise de la baguette que porte le héros (`2dd9:0afc`, sans l'épée d'orichalque dans les poches). Elle la reprend (`19dc:0000`).
 * Si elle l'avait déjà eue (`+0x20` non nul) : sort de crapaud avec `G365`. Sinon (première fois) : `+0x20 = 7`, trois avertissements
 * à venir (`+0x42 = 3`), `G328`, les objets convoités du héros (`DGROUP:5284`, avec `G331` si elle en prend), puis elle disparaît
 * (animation 45, `G329`).
 */
function takeBackWand(kit: NpcKit, ctx: BehaviorContext, minas: GameObject, hero: GameObject, wand: GameObject): void {
  ctx.state.moveToContainer(wand, minas);
  if (flag(minas, FIELD.hadWand) !== 0) {
    cast(kit, ctx, minas, hero, 365);
    return;
  }
  setFlag(minas, FIELD.hadWand, 7);
  setFlag(minas, FIELD.warnings, 3);
  kit.sayHere(ctx, minas, "G", 328);
  if (kit.confiscate(ctx, minas, hero, SNATCHED) > 0) kit.sayHere(ctx, minas, "G", 331);
  vanishWith(kit, ctx, minas, 329);
}

/**
 * Contact (`2dd9:0858`). Rend toujours vrai (7). Minas `Ego 0` ou 7, ou `Ego 4` contre le chaudron ; l'aiguillage porte sur le `Num` du
 * touché (`0d88`, `0d68`, `073c`...). Les cas qui terminent par `0ded` ne remettent pas `Err` à 0 ; les autres (`0de5`) le font.
 */
function minasContact(kit: NpcKit, ctx: BehaviorContext, obj: GameObject): boolean {
  const other = kit.touched(ctx, obj);
  if (!other) {
    obj.err = 0;
    return true;
  }
  if (obj.ego !== 0 && obj.ego !== 7 && !(obj.ego === 4 && other.num === NUM.cauldron)) return true;
  const wand = wandOf(obj);
  const done = (): boolean => {
    obj.err = 0;
    return true;
  };
  const faceOff = (): boolean => {
    kit.faceOff(ctx, other, obj);
    return done();
  };
  /**
   * `2dd9:0d0c` : tout autre objet. `Mob 2` : face-à-face. `Mob 0` : une porte à serrure fermée ou verrouillée (`20b5:0516` < 2) s'ouvre
   * une fois sur deux (`gm_chance_one_in(2)`, tiré avant de tester l'état) si elle a la clé ou si la porte est déverrouillée
   * (`20b5:055e(Num, 2, Minas)`, `moveDoor`) ; les autres `Mob 0` (ni porte, ni ouverte, ni tirage gagné) ne remettent pas `Err` à 0.
   */
  const other0 = (): boolean => {
    if (other.mob === 2) return faceOff();
    if (other.mob !== 0) return true;
    const state = doorState(ctx, other.num);
    if (state < 0 || !kit.chance(ctx, 2) || state === 2) return true;
    return moveDoor(ctx, other.num, 2, obj) ? done() : true;
  };
  /** `2dd9:0b9a` / `0b94` : nains, soldat, Prytwen (`G330`), ours (`G350`) : on leur fait les poches, sort s'ils sont libres. */
  const creature = (message: number): boolean => {
    if (other.hidden !== 0) return true;
    kit.confiscate(ctx, obj, other, SNATCHED);
    if (other.ego === 0 && wand) {
      cast(kit, ctx, obj, other, 324);
      return done();
    }
    kit.sayHere(ctx, obj, "G", message);
    return faceOff();
  };
  /** `2dd9:0c0a` : objet convoité. Dans l'antre elle ne ramasse que la baguette et le talisman. */
  const valuable = (): boolean => {
    if (other.ground === GROUND.crater) {
      sinkIntoLava(kit, ctx, obj);
      return done();
    }
    if (obj.room?.id === ROOM.minasLair && other.num !== NUM.wand && other.num !== NUM.talisman) return done();
    if (!kit.fits(obj, other)) return done();
    ctx.state.moveToContainer(other, obj);
    if (other.num === NUM.wand) setFlag(obj, FIELD.hadWand, 7);
    return done();
  };

  switch (other.num) {
    case NUM.hero:
      return heroContact(kit, ctx, obj, other, wand, faceOff, done);
    case NUM.bear:
      return creature(350);
    case NUM.prytwen:
    case NUM.dwarfMiner:
    case NUM.dwarfMiner2:
    case NUM.dwarfWarrior:
    case NUM.dwarfWarrior2:
    case NUM.soldier:
      return creature(330);
    case NUM.sarhul:
      // avec la baguette : elle disparaît (animation 45, `Ego 6`, `2dd9:0cf6` -> `0b63`) ; sans : `2dd9:0d0c`
      if (wand) {
        vanishWith(kit, ctx, obj);
        return done();
      }
      return other0();
    case NUM.cauldron:
      stirCauldron(kit, ctx, obj, other);
      return done();
    case NUM.crystal:
      // la sphère sur le chapiteau (`Sol 0x3c`) ne l'intéresse que si elle a le talisman
      if (other.ground === GROUND.chapiter && !obj.contents.some((o) => o.num === NUM.talisman)) return true;
      return valuable();
    case 9:
    case NUM.vial:
    case NUM.emerald:
    case NUM.sword:
    case NUM.wand:
    case NUM.talisman:
    case 322:
    case NUM.crown:
      return valuable();
    default:
      return other0();
  }
}

/** Contact avec le héros (`2dd9:08f2`..`0b8c`). */
function heroContact(
  kit: NpcKit,
  ctx: BehaviorContext,
  obj: GameObject,
  hero: GameObject,
  wand: GameObject | undefined,
  faceOff: () => boolean,
  done: () => boolean,
): boolean {
  if (obj.ego !== 0) return true;
  if (hero.hidden !== 0) {
    // invisible : elle sent « quelque chose » (`G337`) et se tourne vers lui
    kit.sayHere(ctx, obj, "G", 337);
    return faceOff();
  }
  if (hero.ego !== 0 && hero.ego !== 1 && hero.ego !== 2 && hero.ego !== 5) return true;
  if (obj.room?.id === ROOM.minasLair) {
    captureHero(kit, ctx, obj, hero);
    return done();
  }
  if (wand) {
    if (followedNum(ctx, obj) === NUM.hero) {
      // elle le suivait (`Cib == 1`) : elle attend ce qu'il a à offrir
      setMinas(kit, ctx, obj, 5, 5, 1, 368);
    } else if (flag(obj, FIELD.warnings) === 0) {
      cast(kit, ctx, obj, hero, 324);
    } else {
      // avertissements `G317` à `G319` (le compteur +0x42 compte 3, 2, 1), elle passe `Ego 2`
      const warnings = flag(obj, FIELD.warnings);
      setMinas(kit, ctx, obj, 2, 2, 1, 316 + warnings);
      setFlag(obj, FIELD.warnings, warnings - 1);
    }
    return done();
  }
  const heroWand = ctx.hero?.contents.find((o) => o.num === NUM.wand);
  if (!heroWand) {
    // sans baguette sur lui : le pacte, une seule fois par attente (`G325`, ou `G369` si elle a déjà eu puis reperdu sa baguette), puis `G326`
    const seen = flag(obj, FIELD.pact);
    setFlag(obj, FIELD.pact, seen + 1);
    setMinas(kit, ctx, obj, 5, 5, 1, seen !== 0 ? 326 : flag(obj, FIELD.hadWand) !== 0 ? 369 : 325);
    return done();
  }
  if (ctx.hero?.contents.some((o) => o.num === NUM.sword)) {
    // la baguette et l'épée : exigence (`G327`, ou `G343` si elle n'a plus le talisman)
    setMinas(kit, ctx, obj, 5, 5, 1, obj.contents.some((o) => o.num === NUM.talisman) ? 327 : 343);
    return done();
  }
  takeBackWand(kit, ctx, obj, hero, heroWand);
  return done();
}

/** `2dd9:0006` (`Num 303`). */
export function minas(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    // `Err 0x11` (2dd9:002e) : posée sur la lave, elle sombrera dans 10 tics (événement 5)
    if (obj.err === 0x11 && obj.ground === GROUND.lava) {
      armMinasLava(ctx, obj, 10);
      obj.err = 0;
    }
    // `Err 11` (2dd9:005e) : en quittant la salle `Ego 7` redevient `Ego 0`
    if (obj.err === 0x0b && obj.ego === 7) obj.ego = 0;
    const contact = () => minasContact(kit, ctx, obj);
    const head = kit.dispatchErr(ctx, obj, contact);
    if (head !== null) return head;
    const follow = kit.followOrDecide(ctx, obj, contact);
    if (follow !== null) return follow;

    const active = kit.inLoadedRoom(ctx, obj);
    switch (obj.ego) {
      case 1:
        // `2dd9:0156` : fin du sort / de l'avertissement, puis la décision dans le même tic
        if (!sequenceFinished(obj, active)) return endTic(obj);
        setMinas(kit, ctx, obj, 0, 0, 2);
        break;
      case 5:
        // `2dd9:0182` : fin de l'attente, `Ego 7` (comme 0 mais ne chasse pas le héros), puis elle quitte la salle
        if (!sequenceFinished(obj, active)) return endTic(obj);
        setMinas(kit, ctx, obj, 7, 0, 2);
        if (kit.leaveRoom(ctx, obj)) return endTic(obj);
        // `2dd9:01c3` teste le pointeur `[BP-0xe]:[BP-0xc]`, jamais écrit dans cette branche (il ne l'est que par la décision, `041b`) : c'est
        // un reste de pile. Le cadre de `2dd9:0006` est exactement celui de `animStep` (`1833:0006`) que `majObjet` (`1890:0006`, `Mob 1`)
        // vient d'appeler avec le même nombre d'octets d'arguments : `[BP-0xc]` y est le décalage de l'enregistrement d'image
        // (`1833:004c`, `Fig * 12 + défs + 0x10`), écrit avant toute sortie anticipée, donc non nul. Elle disparaît (animation 45) ;
        // le chemin « errer » (`2dd9:0834`) n'est jamais pris (`characters.md` § 7.5).
        vanishAndReset(kit, ctx, obj);
        return endTic(obj);
      case 2:
        // arrivée par téléportation : elle apparaît (`2dd9:0390`)
        kit.startAnimation(ctx, obj, { id: ANM.appear, ego: 6 });
        return endTic(obj);
      case 3:
        obj.ego = 0;
        break;
      case 4:
        // elle emmène sa victime au chaudron (trajet suivi en tête de procédure)
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
          setMinas(kit, ctx, obj, 0, 0, 2, 310);
          return endTic(obj);
        }
        if (id === ANM.soup) {
          eatVictim(kit, ctx, obj);
          return endTic(obj);
        }
        if (id === ANM.lava) {
          ctx.score.award(3, 0);
          kit.sayHere(ctx, obj, "G", 308);
          kit.destroy(ctx, obj, true);
          return RESTART;
        }
        // `gm_abort(0x61)` : id inconnu
        setMinas(kit, ctx, obj, 0, 0, 2);
        return endTic(obj);
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

/** `2dd9:01ce` : le compteur d'attente repart à 0 et elle disparaît (animation 45, sans message). */
function vanishAndReset(kit: NpcKit, ctx: BehaviorContext, obj: GameObject): void {
  setFlag(obj, OFF.init, 0);
  vanishWith(kit, ctx, obj);
}

/**
 * Fin de l'animation 45 (`2dd9:026e`) : salle d'arrivée au hasard (une chance sur 4 : l'antre 301 ; sinon `rand() % nombre de salles`,
 * en refusant 0, 10, 20, 21, 212 et 313), `Ego 2`, `Inf = 6`, changement de salle (`186d:000c`).
 */
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
    setMinas(kit, ctx, obj, 2, 0, 2);
    kit.teleport(ctx, obj, room);
    return;
  }
}

/** Décision (`2dd9:03e0`..`0842`) : `Ego 0` ou 7. */
function decide(kit: NpcKit, ctx: BehaviorContext, obj: GameObject): number {
  obj.path.defined = false;
  if (flag(obj, OFF.control) !== 0) return endTic(obj);
  kit.stop(obj);
  let wand = wandOf(obj);
  if (wand) {
    setFlag(obj, FIELD.hadWand, 7);
    setFlag(obj, FIELD.pact, 0);
  }
  const room = obj.room;
  if (!room) return endTic(obj);
  if (room.id === ROOM.minasLair && room !== ctx.room) {
    // hors de la salle chargée elle dépose dans l'antre tout ce qu'elle porte sauf la baguette et le talisman (`Sol 0x53`)
    for (const item of [...obj.contents]) {
      if (item.num === NUM.wand || item.num === NUM.talisman) continue;
      ctx.state.moveToRoom(item, room);
      item.ground = GROUND.loot;
    }
  }
  const followed = followedNum(ctx, obj);
  let remark = 0;
  for (const o of [...room.listA]) {
    if (o === obj || !kit.sees(ctx, obj, o)) continue;
    switch (o.num) {
      case NUM.sarhul:
        remark = 316;
        break;
      case NUM.hero:
        if (followed === NUM.hero || obj.ego !== 0 || o.ego === 4 || o.ego === 6 || o.ego === 8) break;
        if (!wand) {
          // sans baguette : `G321` (la première fois) ou `G322`, puis elle va vers le héros (deux essais, avec puis sans suivi)
          const message = flag(obj, FIELD.hadWand) !== 0 ? 322 : flag(obj, FIELD.pact) === 0 ? 321 : 322;
          kit.sayHere(ctx, obj, "G", message);
          if (!kit.approach(ctx, obj, o, true)) kit.approach(ctx, obj, o, false);
          return endTic(obj);
        }
        if (room.id === ROOM.minasLair) {
          kit.sayHere(ctx, obj, "G", 322);
          if (!kit.approach(ctx, obj, o, true)) kit.approach(ctx, obj, o, false);
          return endTic(obj);
        }
        if (flag(obj, FIELD.warnings) === 0) {
          cast(kit, ctx, obj, o, 320);
          return endTic(obj);
        }
        {
          // avertissement `G317`..`G319` en disparaissant (animation 45, message mode 1)
          const warnings = flag(obj, FIELD.warnings);
          vanishWith(kit, ctx, obj, 316 + warnings);
          setFlag(obj, FIELD.warnings, warnings - 1);
          return endTic(obj);
        }
      case NUM.bear:
        if (wand) {
          cast(kit, ctx, obj, o, 313);
          return endTic(obj);
        }
        break;
      case NUM.prytwen:
        if (wand && (o.ego === 0 || o.ego > 3)) {
          cast(kit, ctx, obj, o, 314);
          return endTic(obj);
        }
        remark = 315;
        break;
      case NUM.dwarfMiner:
      case NUM.dwarfMiner2:
      case NUM.dwarfWarrior:
      case NUM.dwarfWarrior2:
      case NUM.soldier:
        if (wand && (o.ego === 0 || o.ego > 3)) {
          cast(kit, ctx, obj, o, 311);
          return endTic(obj);
        }
        remark = 312;
        break;
      case NUM.crystal:
        if (o.ground === GROUND.chapiter && !obj.contents.some((c) => c.num === NUM.talisman)) break;
        if (covet(kit, ctx, obj, o, room.id === ROOM.minasLair, followed)) return endTic(obj);
        break;
      case 9:
      case NUM.vial:
      case NUM.emerald:
      case NUM.sword:
      case 322:
      case NUM.crown:
        if (covet(kit, ctx, obj, o, room.id === ROOM.minasLair, followed)) return endTic(obj);
        break;
      case NUM.wand:
      case NUM.talisman:
        // la baguette et le talisman sont convoités même dans l'antre
        if (covet(kit, ctx, obj, o, false, followed)) return endTic(obj);
        break;
      default:
        break;
    }
  }

  if (remark !== 0) {
    // remarque d'ambiance une fois sur 10 (`2dd9:0777`), puis elle quitte la salle (`2dd9:01ab`)
    if (kit.chance(ctx, 10)) kit.sayHere(ctx, obj, "G", remark);
    return leave(kit, ctx, obj);
  }
  if (wand && room !== ctx.room && kit.chance(ctx, 100)) {
    // elle laisse traîner sa baguette (une chance sur 100 hors de la salle chargée), puis elle quitte la salle
    setFlag(obj, FIELD.pact, 0);
    ctx.state.moveToRoom(wand, room);
    kit.copyPosition(obj, wand);
    wand = undefined;
    return leave(kit, ctx, obj);
  }
  if (wand) {
    // compteur d'attente (+0x2c, incrémenté même quand il déclenche) : à la 21e décision elle disparaît
    const idle = flag(obj, OFF.init);
    setFlag(obj, OFF.init, idle + 1);
    if (idle >= 0x14) {
      vanishAndReset(kit, ctx, obj);
      return endTic(obj);
    }
  }
  // une fois sur 4 (`2dd9:0828`) elle quitte la salle (toujours si elle n'est pas à `Ego 0`), sinon elle erre (`2151:02a0`)
  if (obj.ego !== 0 || kit.chance(ctx, 4)) return leave(kit, ctx, obj);
  kit.wander(ctx, obj);
  return endTic(obj);
}

/** `2dd9:01ab` : quitter la salle ; sans sortie, avec la baguette elle disparaît (`01ce`), sans elle elle erre (`0834`). */
function leave(kit: NpcKit, ctx: BehaviorContext, obj: GameObject): number {
  if (kit.leaveRoom(ctx, obj)) return endTic(obj);
  if (wandOf(obj)) {
    vanishAndReset(kit, ctx, obj);
    return endTic(obj);
  }
  kit.wander(ctx, obj);
  return endTic(obj);
}

/**
 * `2dd9:06ba` / `06c7` : objet convoité (liste de `Num` de la table `2dd9:073c`) : rien dans l'antre (`lair`), rien si c'est l'objet suivi,
 * sinon ramassage (`219b:00d0`) ; l'émeraude fait dire `G367`. Rend vrai si elle part le chercher.
 */
function covet(kit: NpcKit, ctx: BehaviorContext, obj: GameObject, item: GameObject, lair: boolean, followed: number): boolean {
  if (lair || item.num === followed) return false;
  if (!kit.fetch(ctx, obj, item)) return false;
  if (item.num === NUM.emerald) kit.sayHere(ctx, obj, "G", 367);
  return true;
}

/** `2dd9:1440` (événement 5) : sur la lave (`Sol 0x34`), elle sombre (`2dd9:1510`). */
export function minasEvent(kit: NpcKit): EventHandler {
  return (ctx, entry, obj) => {
    if (!obj || entry.event !== MINAS_EVENT_LAVA) return;
    if (obj.ground === GROUND.lava) sinkIntoLava(kit, ctx, obj);
  };
}

/** Programme la chute dans la lave (événement 5, `2dd9:1440`) : 10 tics après que Minas Thyl a été posée sur la lave (`Err 0x11`, `2dd9:002e`). */
export function armMinasLava(ctx: BehaviorContext, obj: GameObject, ticks: number): void {
  ctx.events.operate(target(obj), MINAS_EVENT_LAVA, EventOp.Set, ticks, NUM.minas);
}

export function registerMinas(registry: HandlerRegistry, kit: NpcKit): void {
  registry.register(FAMILY.character, NUM.minas, minas(kit));
  registry.register(FAMILY.event, NUM.minas, minasEvent(kit));
}
