import { EventOp } from "../engine/events";
import { FAMILY, type BehaviorContext, type HandlerContext, type HandlerRegistry, type ObjectHandler } from "../engine/handlers";
import type { GameObject } from "../engine/state";
import { setHeroCarrying, startHeroFall } from "./hero";
import {
  DOORS,
  HANDLED,
  NUM,
  OK,
  PREP,
  ROOM,
  VERB,
  approach,
  award,
  canCarry,
  contentWeight,
  destroy,
  die,
  doorPosition,
  dropHeld,
  doorRow,
  eventTarget,
  flag,
  hasName,
  heldNum,
  inside,
  isKey,
  isKillian,
  listObjects,
  lockKey,
  moveObject,
  near,
  objectOf,
  playAnim,
  putOnSupport,
  reachableNum,
  refuse,
  replaceObject,
  requireNum,
  say,
  sayDone,
  setFlag,
  setInvisible,
  setState,
  setWord,
  siblingNum,
  spawn,
  tooFar,
  tooFarWardrobe,
  wander,
} from "./helpers";
import { becomeToad } from "./magic";

/**
 * Gestionnaires de la famille 1 d'*Armaeth* (« ce qu'on fait à cet objet », clé = `Num` du nom direct) : les 36 adresses de la
 * table `DGROUP:07ca` (+ le défaut de porte fermée, géré par le registre), `docs/armaeth/objects.md` § 4. Chaque gestionnaire
 * rend 0 (non traité) ou un succès (1 ou 7) ; un refus met son message en file et désactive le verbe générique (`22fc:065b`).
 */

/** Cases (`Sol`) citées par les gestionnaires. */
const GROUND = {
  stelePlatform: 0x27,
  steleLock: 0x24,
  steleLever: 0x2c,
  steleBusy: 0x50,
  woodPile: 0x41,
  plankEdge: 0x3e,
  plank: 0x3f,
  slabTrigger: 0x2e,
  slabBusy: 0x51,
} as const;

const direct = (ctx: HandlerContext): GameObject => objectOf(ctx.direct);
const hero = (ctx: HandlerContext): GameObject => ctx.hero!;

/** Message immédiat puis succès. */
function done(ctx: HandlerContext, message: number, result: number = HANDLED): number {
  say(ctx, message);
  return result;
}

/** Refus qui rend faux (pour les contrôles `checkX` qui rendent un booléen). */
function deny(ctx: HandlerContext, priority: number, number: number): false {
  refuse(ctx, priority, number);
  return false;
}

/** Table des verbes d'un gestionnaire : le premier à répondre l'emporte, 0 pour un verbe non traité. */
function byVerb(table: Readonly<Record<number, ObjectHandler>>): ObjectHandler {
  return (ctx) => table[ctx.verb]?.(ctx) ?? 0;
}

// --- 3 · la pie, 4 · l'ours --------------------------------------------------------------------------------------------------

/** `2774:05ce` : `manger` → « mieux à faire ». */
export const pie: ObjectHandler = byVerb({
  [VERB.eat]: (ctx) => refuse(ctx, 4, 38),
});

/** `26da:06c6`. */
export const ours: ObjectHandler = byVerb({
  [VERB.eat]: (ctx) => refuse(ctx, 4, 75),
  [VERB.push]: (ctx) => refuse(ctx, 4, 75),
  [VERB.feed]: (ctx) => refuse(ctx, 4, 53),
  [VERB.attack]: (ctx) => refuse(ctx, 4, 54),
  [VERB.whip](ctx) {
    const bear = direct(ctx);
    if (!heldNum(ctx, 10)) return refuse(ctx, 3, 80);
    if (!near(bear, hero(ctx), 40, -1, 8)) return tooFar(ctx, bear, 3);
    if (bear.ego > 1) return refuse(ctx, 3, 81);
    say(ctx, 77);
    if (ctx.rng.mod(5) !== 0) {
      wander(ctx, bear);
      bear.err = 0;
      say(ctx, 78);
    } else say(ctx, 79);
    return HANDLED;
  },
});

// --- 9, 21, 110, 319 · coffret et coffres --------------------------------------------------------------------------------------

/** Contrôle de la clé tenue pour un coffre ; en cas de refus, met le message en file et rend faux. */
function checkChestKey(ctx: HandlerContext, chest: GameObject): boolean {
  const tool = ctx.indirect.object;
  if (ctx.preposition === 0) return deny(ctx, 1, 14);
  if (!tool) return deny(ctx, 1, 46);
  if (!ctx.indirect.held) return deny(ctx, 3, 13);
  if (tool.num !== lockKey(chest.num)) return deny(ctx, 3, isKey(tool.num) ? 47 : 46);
  return true;
}

/** Automate : 0 fermé et verrouillé, 1 fermé, 2 ouvert (`Fig` 0, 0, 1). */
const CHEST = { locked: 0, closed: 1, open: 2 } as const;

/** `22c1:0002`. */
export const chest: ObjectHandler = (ctx) => {
  const verb = ctx.verb;
  if (verb !== VERB.open && verb !== VERB.close && verb !== VERB.search) return 0;
  const box = direct(ctx);
  if (!ctx.direct.inReach) return tooFar(ctx, box, 3);
  if (ctx.preposition !== 0 && ctx.preposition !== PREP.with) return refuse(ctx, 0, 23);

  const lock = (): number => {
    if (!checkChestKey(ctx, box)) return 0;
    setState(ctx, box, { ego: CHEST.locked, fig: 0 });
    return done(ctx, 49, OK);
  };

  if (verb === VERB.search) {
    if (box.ego === CHEST.open) return 0;
    return refuse(ctx, 4, 51);
  }
  if (verb === VERB.open) {
    if (box.ego === CHEST.locked) {
      if (!checkChestKey(ctx, box)) return 0;
    } else if (box.ego === CHEST.open) return refuse(ctx, 4, 45);
    setState(ctx, box, { ego: CHEST.open, fig: 1, gst: 0, mob: 0, dep: 0, txt: 0 });
    sayDone(ctx);
    return OK;
  }
  // fermer
  if (box.ego === CHEST.open) {
    setState(ctx, box, { ego: CHEST.closed, fig: 0 });
    if (ctx.state.selected === box) ctx.state.selected = null;
    if (ctx.preposition === 0) {
      sayDone(ctx);
      return OK;
    }
    return lock(); // « fermer le coffre avec la clef » ferme et verrouille
  }
  if (box.ego === CHEST.closed) {
    if (ctx.preposition === 0) return refuse(ctx, 3, 48);
    return lock();
  }
  return refuse(ctx, 4, 48);
};

// --- 12 · la torche, 17 · le bois ----------------------------------------------------------------------------------------------

const TORCH_FIRES = [12, 18, 114, 116, 216];
/** Chargement d'une torche neuve et éteinte (`Ego 8`) : `Tim := 36000` (`DGROUP:5262`). */
const TORCH_NEW_TIME = 36000;

/** `2420:011e`. */
export const torch: ObjectHandler = (ctx) => {
  const lamp = direct(ctx);
  switch (ctx.verb) {
    case VERB.light: {
      if (lamp.ego < 4) return refuse(ctx, 4, 12);
      const source = ctx.indirect.object;
      if ((ctx.preposition !== PREP.in && ctx.preposition !== PREP.with) || !source || !TORCH_FIRES.includes(source.num)) return refuse(ctx, 1, 14);
      if (source.num === 12) {
        if (source.ego >= 4) return refuse(ctx, 3, 16);
      } else if (source.num === 18) {
        if (!ctx.indirect.inReach) return tooFar(ctx, source, 3);
        if (source.ego < 3) return refuse(ctx, 4, source.ego === 0 ? 9 : 17);
      } else if (!ctx.indirect.inReach) return tooFar(ctx, source, 3);
      let ego = lamp.ego - 4;
      if (lamp.ego === 8) {
        ego = 3;
        lamp.tim = TORCH_NEW_TIME;
      }
      setState(ctx, lamp, { gst: 7, mob: 1, ego, fig: ego });
      lamp.light = 0;
      setWord(lamp, 0x34, 1000); // `Rep`
      award(ctx, 0, 1);
      sayDone(ctx);
      return HANDLED;
    }
    case VERB.extinguish: {
      if (lamp.ego >= 4) return refuse(ctx, 3, 18);
      extinguishTorch(ctx, lamp);
      sayDone(ctx);
      return OK;
    }
    case VERB.take: {
      // hypothèse (objects.md §4.4) : branche « D absent ou déjà tenu » ; la torche non tenue suit la prise standard
      if (ctx.direct.object && !ctx.direct.held) return 0;
      return takeTorchFromPile(ctx);
    }
    default:
      return 0;
  }
};

/**
 * `2420:0398` : éteint une torche allumée. Le test et la nouvelle valeur viennent de `Fig` (+0x2E, pas de `Ego`) : `Fig` 0..3 devient
 * `Fig + 4`, copié dans `Ego`, `Lum := 0`, puis `1a37:003a` (`Gst 0`, `Mob 0`, replacement). Sans effet si `Fig` n'est pas 0..3.
 */
export function extinguishTorch(ctx: BehaviorContext, lamp: GameObject): void {
  const level = lamp.fig;
  if (level > 3) return;
  lamp.light = 0;
  setState(ctx, lamp, { gst: 0, mob: 0, ego: level + 4, fig: level + 4 });
}

/** Réserve de torches : `bois` (`Num 17`) parmi les frères du héros, `Sol 0x41` pour s'y servir. */
function takeTorchFromPile(ctx: HandlerContext): number {
  const wood = siblingNum(ctx, 17);
  if (!wood) return 0;
  const walker = hero(ctx);
  if (walker.ground !== GROUND.woodPile) return tooFar(ctx, wood, 3);
  if (contentWeight(walker) + 5 > walker.capacity) return refuse(ctx, 4, 21);
  spawn(ctx, 12, walker, { ego: 8 });
  sayDone(ctx);
  return HANDLED;
}

/** `245d:000e` : seul `prendre`, sur le bois. */
export const wood: ObjectHandler = (ctx) => {
  if (ctx.verb !== VERB.take) return 0;
  return takeTorchFromPile(ctx);
};

// --- 16 · la stèle et ses serrures (27, 102) -------------------------------------------------------------------------------------

const STELE = { normal: 0, jammed: 1, opening: 2, closing: 3, open: 4, rearmed: 5, brambles: 6 } as const;

/** `2500:016c`. */
export const stele: ObjectHandler = (ctx) => {
  const slab = direct(ctx);
  const walker = hero(ctx);
  switch (ctx.verb) {
    case VERB.open:
    case VERB.close:
    case VERB.push:
      return steleAction(ctx, slab);
    case VERB.smash:
      return refuse(ctx, 4, 66);
    case VERB.read:
      return walker.ground === GROUND.stelePlatform ? refuse(ctx, 4, 68) : tooFar(ctx, slab, 3);
    case VERB.clean: {
      if (!requireOptional(ctx, 20)) return refuse(ctx, 4, 91);
      if (walker.ground !== GROUND.stelePlatform) return refuse(ctx, 4, 8);
      if (isKillian(ctx) && walker.ego !== 6) walker.ego = 7; // déclenche la coupe (IA du héros)
      return HANDLED;
    }
    default:
      return 0;
  }
};

const requireOptional = (ctx: HandlerContext, num: number): GameObject | undefined => ctx.state.findByNum(num, 2);

/** `15027` (`258d:000a`) et `15102` (`27d8:000e`) : ouvrir / fermer ramènent à la stèle ; `briser` → `V066`. */
function steleLock(smashPriority: number): ObjectHandler {
  return (ctx) => {
    if (ctx.verb === VERB.open || ctx.verb === VERB.close) return steleAction(ctx, requireNum(ctx, 16, 0xbb));
    if (ctx.verb === VERB.smash) return refuse(ctx, smashPriority, 66);
    return 0;
  };
}

export const steleKeyhole = steleLock(4);
export const steleHatch = steleLock(3);

/** `2500:026c(stèle)` : ouvrir, fermer et pousser, avec l'outil `I` (clef en or, levier ou autre clef). */
function steleAction(ctx: HandlerContext, slab: GameObject): number {
  const walker = hero(ctx);
  if (slab.ego === STELE.brambles) return refuse(ctx, 3, 56);
  const roomObjects = (slab.room?.listA ?? []).filter((o) => o !== slab);
  if (roomObjects.some((o) => o.ground === GROUND.stelePlatform)) return refuse(ctx, 3, 56);
  const busy = roomObjects.some((o) => o.ground === GROUND.steleBusy);
  if (ctx.preposition !== PREP.with) {
    say(ctx, 14);
    return HANDLED;
  }
  const tool = ctx.indirect.object;
  const held = ctx.indirect.held;
  const kind = tool?.num === 6 ? "G" : tool?.num === 11 ? "L" : tool && isKey(tool.num) ? "K" : null;
  const ego = slab.ego;
  const verb = ctx.verb;

  const unsuitable = (): number => {
    // outil absent ou inadapté
    if (kind === "K") return held ? refuse(ctx, 4, 82) : refuse(ctx, 1, 13);
    if (kind === "L") return held ? refuse(ctx, 4, 59) : refuse(ctx, 1, 13);
    if (kind === "G" && !held) return refuse(ctx, 1, 13);
    return refuse(ctx, 1, 14);
  };
  const lockPosition = (): boolean => walker.ground === GROUND.steleLock;
  const leverPush = (): number => {
    if (!held) return refuse(ctx, 1, 13);
    if (walker.ground !== GROUND.steleLever) return refuse(ctx, 4, 64);
    if (busy) return refuse(ctx, 4, 93);
    // `2500:04f3` : `Gst 7, Mob 1, Ego 2` (sans quoi la procédure `2500:0008` ne tourne pas et la stèle ne coulisse jamais)
    setState(ctx, slab, { gst: 7, mob: 1, ego: STELE.opening, fig: 0 });
    return done(ctx, 63, OK);
  };

  if (verb === VERB.open) {
    if (ego === STELE.normal || ego === STELE.rearmed) {
      if (kind !== "G" || !held) return unsuitable();
      if (!lockPosition()) return refuse(ctx, 4, 57);
      if (busy) return refuse(ctx, 4, 93);
      if (ego === STELE.normal) {
        setState(ctx, slab, { gst: 7, mob: 1, ego: STELE.opening, fig: 0 });
        return done(ctx, 61, OK);
      }
      setState(ctx, slab, { gst: 0, mob: 0, ego: STELE.jammed, fig: 0 }); // `2500:0438`
      slab.x += 2;
      award(ctx, 0, 2);
      return done(ctx, 60, OK);
    }
    if (ego === STELE.jammed) {
      if (kind === "L") return leverPush();
      if (kind === "G" && held) return refuse(ctx, 3, 62);
      return unsuitable();
    }
    return ego === STELE.open ? refuse(ctx, 4, 55) : refuse(ctx, 3, 29);
  }

  if (verb === VERB.close) {
    if (ego === STELE.normal || ego === STELE.rearmed) return refuse(ctx, 3, 58);
    if (ego === STELE.jammed) return refuse(ctx, 4, 62);
    if (ego === STELE.opening || ego === STELE.closing) return refuse(ctx, 3, 29);
    if (kind === "G" && held) {
      if (!lockPosition()) return refuse(ctx, 4, 57);
      if (busy) return refuse(ctx, 4, 93);
      setState(ctx, slab, { gst: 7, mob: 1, ego: STELE.closing, fig: 0 }); // `2500:0590`
      return done(ctx, 61, OK);
    }
    if (kind === "K") return held ? refuse(ctx, 4, 82) : refuse(ctx, 1, 13);
    return refuse(ctx, held ? 3 : 1, 54);
  }

  // pousser
  if (ego === STELE.normal || ego === STELE.rearmed) {
    if (kind === "L") return held ? refuse(ctx, 3, 59) : refuse(ctx, 1, 13);
    return refuse(ctx, 3, 54);
  }
  if (ego === STELE.jammed) return kind === "L" ? leverPush() : refuse(ctx, 3, 54);
  if (ego === STELE.opening || ego === STELE.closing) return refuse(ctx, 3, 29);
  return refuse(ctx, 3, 55);
}

// --- 18 · le feu, 20 · les ronces -----------------------------------------------------------------------------------------------

/** `264c:0126`. */
export const fire: ObjectHandler = (ctx) => {
  const blaze = direct(ctx);
  if (ctx.verb === VERB.light) {
    if (!ctx.direct.inReach) return tooFar(ctx, blaze, 3);
    return refuse(ctx, 3, blaze.ego === 0 ? 11 : 10);
  }
  if (ctx.verb === VERB.extinguish) {
    if (!ctx.direct.inReach) return tooFar(ctx, blaze, 3);
    return refuse(ctx, 3, blaze.ego === 0 ? 9 : 19);
  }
  return 0;
};

/** `257b:0060`. */
export const brambles: ObjectHandler = (ctx) => {
  switch (ctx.verb) {
    case VERB.light:
      return refuse(ctx, 4, 53);
    case VERB.tear:
    case VERB.smash:
    case VERB.clean: {
      const walker = hero(ctx);
      if (walker.ground !== GROUND.stelePlatform) return refuse(ctx, 4, 8);
      if (isKillian(ctx) && walker.ego !== 6) walker.ego = 7; // la coupe est faite par l'IA du héros
      return HANDLED;
    }
    default:
      return 0;
  }
};

// --- 101 · Prytwen le voleur ----------------------------------------------------------------------------------------------------

/** Animation de la défaite contre Prytwen (13, ou 14 dans la salle 105). */
const PRYTWEN_FIGHT_ANIM = 13;
const PRYTWEN_FIGHT_ANIM_CELL = 14;

const PRYTWEN_VERBS: readonly number[] = [VERB.take, VERB.search, VERB.put, VERB.drop, VERB.attack, VERB.kill, VERB.whip];

/** `28b1:0b6e`. */
export const prytwen: ObjectHandler = (ctx) => {
  const thief = direct(ctx);
  const walker = hero(ctx);
  const verb = ctx.verb;
  if (!PRYTWEN_VERBS.includes(verb)) return 0;
  if (!ctx.direct.inReach) return tooFar(ctx, thief, 3, 74);
  const held = ctx.direct.held;

  const fight = (): number => {
    if (!isKillian(ctx)) return refuse(ctx, 4, 53);
    if (walker.ego !== 0) return refuse(ctx, 4, 93);
    if (thief.ego === 1) return refuse(ctx, 3, 135);
    if (thief.ego === 2) return refuse(ctx, 3, 91);
    if (thief.ego === 3) return refuse(ctx, 3, 90);
    playAnim(ctx, { animation: ctx.room?.id === 105 ? PRYTWEN_FIGHT_ANIM_CELL : PRYTWEN_FIGHT_ANIM, obj: thief, partner: walker, ego: 1, message: { cls: "V", number: 107 } });
    die(ctx, walker, 1);
    walker.x = thief.x;
    walker.y = thief.y;
    walker.p = thief.p;
    award(ctx, 1, 0);
    return OK;
  };

  switch (verb) {
    case VERB.take: {
      if (!isKillian(ctx) || walker.ego !== 0) return refuse(ctx, 4, 53);
      if (thief.ego === 1) return refuse(ctx, 3, 92);
      if (thief.ego === 3) return refuse(ctx, 3, 134);
      if (thief.ego !== 2) return refuse(ctx, 3, 76);
      if (!canCarry(walker, thief)) return refuse(ctx, 3, 120);
      ctx.state.writeField(thief, 0x61, 1, 1); // `Ver := 1`
      setState(ctx, thief, { ego: 2, fig: 2 });
      moveObject(ctx, walker, thief);
      setHeroCarrying(walker, ctx, true);
      award(ctx, 1, 4);
      return done(ctx, 101, HANDLED);
    }
    case VERB.search:
      if (held) return refuse(ctx, 4, 102);
      return thief.ego === 2 || thief.ego === 3 ? 0 : refuse(ctx, 3, 75);
    case VERB.put:
    case VERB.drop: {
      if (ctx.preposition !== 0) return refuse(ctx, 3, held ? 104 : 23);
      if (!held) return refuse(ctx, 3, 24);
      setState(ctx, thief, { ego: 2, fig: 1 });
      const dest = walker.holder ?? walker.room;
      if (!dest || moveObject(ctx, dest, thief) !== 0) {
        setState(ctx, thief, { ego: 2, fig: 2 });
        return refuse(ctx, 4, 94);
      }
      setHeroCarrying(walker, ctx, false);
      return done(ctx, 105, HANDLED);
    }
    case VERB.kill:
      if (held) return refuse(ctx, 3, 102);
      if (thief.ego === 1) return refuse(ctx, 3, 135);
      if (thief.ego === 2) return refuse(ctx, 3, 140);
      if (thief.ego === 3) return refuse(ctx, 3, 91);
      return fight();
    case VERB.attack:
      if (held) return refuse(ctx, 4, 106);
      return fight();
    default: {
      // fouetter
      if (held) return refuse(ctx, 4, 102);
      const whip = heldNum(ctx, 10);
      if (!whip) return refuse(ctx, 3, 80);
      if (thief.ego === 2) return refuse(ctx, 4, 108);
      if (thief.ego === 3) return refuse(ctx, 4, 90);
      destroy(ctx, whip);
      if (thief.ego === 0 && thief !== walker) approach(ctx, thief, walker, false);
      return done(ctx, 109, HANDLED);
    }
  }
};

// --- 103 · la grille du cachot ---------------------------------------------------------------------------------------------------

export const GRATE = { closed: 0, opening: 1, closing: 2, open: 3 } as const;
/** Position du trousseau accroché au clou (`1a37:0002`, objects.md § 4.10). */
const KEYRING_POSITION = { x: 58, y: 49, p: 8 } as const;

/** `2846:0398(grille, cause, piège)` : la grille se met en mouvement (`opening` : 1 ouverture / 2 fermeture). */
export function startGrate(ctx: BehaviorContext, grate: GameObject, opening: boolean, trap = false): void {
  setState(ctx, grate, { gst: 7, mob: 1, ego: opening ? GRATE.opening : GRATE.closing });
  ctx.sound.effect("B", 102, 0);
  setWord(grate, 0x36, 9); // `Bag`
  if (trap) say(ctx, 118);
}

/** `2846:00ec`. */
export const grate: ObjectHandler = (ctx) => {
  const bars = direct(ctx);
  const walker = hero(ctx);
  if (ctx.verb !== VERB.open && ctx.verb !== VERB.close) return 0;
  if (ctx.preposition !== 0 && ctx.preposition !== PREP.with) return refuse(ctx, 0, 23);
  if (!near(bars, walker, 20, -1, 8)) return tooFar(ctx, bars, 4);

  if (ctx.verb === VERB.close) {
    if (bars.ego === GRATE.open) {
      startGrate(ctx, bars, false);
      return OK;
    }
    return bars.ego === GRATE.closed ? refuse(ctx, 3, 112) : refuse(ctx, 0, 29);
  }
  if (bars.ego === GRATE.open) return refuse(ctx, 3, 111);
  if (bars.ego !== GRATE.closed) return refuse(ctx, 0, 29);
  if (ctx.preposition === 0) return refuse(ctx, 0, 14);
  const tool = ctx.indirect.object;
  if (!tool) return refuse(ctx, 0, hasName(ctx.indirect) ? 23 : 14);
  if (tool.num !== 108) {
    if (!ctx.indirect.held) return refuse(ctx, 3, 13);
    return isKey(tool.num) ? refuse(ctx, 4, 82) : refuse(ctx, 0, 23);
  }
  if (!ctx.indirect.held) return refuse(ctx, 4, 13);
  if (walker.p < bars.p) {
    // derrière la grille : le trousseau est accroché au clou
    if (bars.room) moveObject(ctx, bars.room, tool);
    setState(ctx, tool, { ego: 0, fig: 1 });
    tool.x = KEYRING_POSITION.x;
    tool.y = KEYRING_POSITION.y;
    tool.p = KEYRING_POSITION.p;
    say(ctx, 113);
  }
  ctx.state.moveEnabled = false; // `4b50 := 0` : le joueur perd la main
  ctx.motion.reset(walker);
  ctx.sound.effect("B", 101, 0);
  ctx.events.operate(eventTarget(bars), 15, EventOp.Add, 2, 103);
  return OK;
};

// --- 105 · la pépite, 108 · le trousseau -----------------------------------------------------------------------------------------

/** `27dd:000c` : seul `prendre`. */
export const nugget: ObjectHandler = (ctx) => {
  if (ctx.verb !== VERB.take) return 0;
  const gold = direct(ctx);
  if (ctx.direct.held) return refuse(ctx, 4, 39);
  if (!ctx.indirect.object && !ctx.direct.inReach) return tooFar(ctx, gold, 4);
  if (ctx.indirect.object && !ctx.indirect.inReach) return tooFar(ctx, ctx.indirect.object, 4);
  if (!canCarry(hero(ctx), gold)) return refuse(ctx, 4, 116);
  moveObject(ctx, hero(ctx), gold);
  return done(ctx, 117, HANDLED);
};

/** `282d:000c` : le trousseau reprend son icône d'inventaire, puis la prise standard suit. */
export const keyring: ObjectHandler = (ctx) => {
  if (ctx.verb !== VERB.take) return 0;
  const ring = direct(ctx);
  if (canCarry(hero(ctx), ring)) setState(ctx, ring, { ego: 0, fig: 0 });
  return 0;
};

// --- 111, 309, 329 · les portes à serrure ----------------------------------------------------------------------------------------

const DOOR = { locked: 0, closed: 1, open: 2 } as const;

/** `20b5:0248(Num, état)` : place le battant dans la salle visible, à la position de la table, et applique l'état. */
export function setDoor(ctx: BehaviorContext, leaf: GameObject, ego: number): void {
  const row = doorRow(leaf.num);
  const visible = ctx.room;
  const side = visible && visible.id === row.roomB && row.roomB !== 0 ? 1 : 0;
  if (visible && leaf.room !== visible) moveObject(ctx, visible, leaf);
  const open = ego === DOOR.open;
  const [x, y, p] = doorPosition(leaf.num, side, open);
  leaf.x = x;
  leaf.y = y;
  leaf.p = p;
  setState(ctx, leaf, { ego, fig: 2 * side + (open ? 1 : 0) });
}

/**
 * `20b5:0516(Num)` : `Ego` de la porte à serrure de ce `Num` (0 verrouillée, 1 fermée, 2 ouverte), -1 si ce n'est pas une porte de la
 * table `DGROUP:0694`. `gm_abort(0x91)` (`217d:0088`) si l'objet manque.
 */
export function doorState(ctx: BehaviorContext, num: number): number {
  if (!DOORS.some((row) => row.door === num)) return -1;
  return requireNum(ctx, num, 0x91).ego;
}

/**
 * `20b5:055e(Num, état voulu, porteur)` : un personnage amène la porte à `wanted` (0 verrouillée, 1 fermée, 2 ouverte). Rend vrai (7)
 * sauf si ce n'est pas une porte ou si le porteur n'a pas la clé de la porte (`21e7:0022` sur ses poches, tout `Ego`) : faux (0), et dans
 * ce cas, quand il voulait verrouiller (`wanted == 0`) une porte qui n'est pas fermée, la porte est seulement refermée (`20b5:0248(Num, 1)`).
 * Transitions (`20b5:05c3..0629`) :
 * - porte verrouillée : `wanted` 0 = rien ; sinon `05d9` ;
 * - porte fermée : `wanted` 0 = `05d9`, 1 = rien, 2 = l'état est posé **sans clé** ; au-delà rien ;
 * - porte ouverte : `wanted` 0 = `05d9`, 1 = l'état est posé sans clé ; au-delà rien ;
 * - autre `Ego` : `05d9`.
 * `05d9` : l'état est posé si la porte n'a pas de clé ou si le porteur l'a.
 */
export function moveDoor(ctx: BehaviorContext, num: number, wanted: number, carrier: GameObject): boolean {
  const row = DOORS.find((r) => r.door === num);
  if (!row) return false;
  const leaf = requireNum(ctx, num, 0x91);
  const set = (): boolean => {
    setDoor(ctx, leaf, wanted);
    return true;
  };
  const needsKey = (): boolean => {
    if (row.key === 0 || carrier.contents.some((o) => o.num === row.key)) return set();
    if (wanted === 0 && leaf.ego !== DOOR.closed) setDoor(ctx, leaf, DOOR.closed);
    return false;
  };
  switch (leaf.ego) {
    case DOOR.locked:
      return wanted === 0 ? true : needsKey();
    case DOOR.closed:
      if (wanted === 0) return needsKey();
      return wanted === 2 ? set() : true;
    case DOOR.open:
      if (wanted === 0) return needsKey();
      return wanted === 1 ? set() : true;
    default:
      return needsKey();
  }
}

/**
 * `20b5:000e` (relu dans le désassemblage). Contrôle de la clé (`20b5:018c`) : `4dca` (le candidat indirect est dans l'inventaire) nul,
 * c'est-à-dire pas d'objet indirect résolu (itération « vide » d'un autre sens du mot `clef`) ou objet hors des poches : `V013`
 * priorité 3 ; sinon une clé autre que celle de la table donne `V082` si `217d:0002` la reconnaît comme clé, `V014` sinon, priorité 3.
 * Relevé sous DOSBox-X (`docs/armaeth/dosbox.md` § 4.2) : « ouvrir la porte avec la clef » avec la clef d'or en poche affiche `V082`
 * puis `V013` (les autres sens de `clef`, sans objet dans la salle, déposent `V013`), jamais `V014`.
 */
export const lockedDoor: ObjectHandler = (ctx) => {
  const leaf = direct(ctx);
  if (ctx.verb !== VERB.open && ctx.verb !== VERB.close) return 0;
  const row = doorRow(leaf.num);
  if (!ctx.direct.inReach) return tooFar(ctx, leaf, 3);
  if (ctx.preposition !== 0 && ctx.preposition !== PREP.with) return refuse(ctx, 0, 23);

  /** Vrai si la clé tenue est la bonne ; sinon le refus est en file. */
  const rightKey = (): boolean => {
    const tool = ctx.indirect.object;
    if (!tool || !ctx.indirect.held) return deny(ctx, 3, 13);
    if (tool.num === row.key) return true;
    return deny(ctx, 3, isKey(tool.num) ? 82 : 14);
  };
  const lockWithKey = (): number => {
    if (!rightKey()) return 0;
    setDoor(ctx, leaf, DOOR.locked);
    return done(ctx, 85, OK);
  };

  if (ctx.verb === VERB.open) {
    if (leaf.ego === DOOR.open) return refuse(ctx, 4, 83);
    if (leaf.ego === DOOR.locked) {
      if (ctx.preposition === 0) return refuse(ctx, 4, 84);
      if (!rightKey()) return 0;
    }
    setDoor(ctx, leaf, DOOR.open);
    sayDone(ctx);
    return OK;
  }
  if (leaf.ego === DOOR.locked) return refuse(ctx, 4, 84);
  if (leaf.ego === DOOR.closed) return ctx.preposition === 0 ? refuse(ctx, 3, 91) : lockWithKey();
  // porte ouverte : le battant est refermé AVANT le contrôle de la clé (`20b5:01b8` : `20b5:0248(Num, 1)`, puis `01ce`) ; une mauvaise
  // clé laisse donc la porte refermée (non verrouillée) et affiche le refus
  setDoor(ctx, leaf, DOOR.closed);
  if (ctx.preposition === PREP.with) return lockWithKey();
  sayDone(ctx);
  return OK;
};

// --- 113 · l'armoire, 114 · la torchère ------------------------------------------------------------------------------------------

/** `2815:0006` : `Ego` 1 fermée, 2 ouverte, écrit directement (pas d'animation). */
export const wardrobe: ObjectHandler = (ctx) => {
  const cupboard = direct(ctx);
  switch (ctx.verb) {
    case VERB.open:
      if (!ctx.direct.inReach) return tooFarWardrobe(ctx, cupboard, 3);
      if (cupboard.ego === 2) return refuse(ctx, 3, 83);
      cupboard.ego = 2;
      return done(ctx, 15, OK);
    case VERB.close:
      if (!ctx.direct.inReach) return tooFarWardrobe(ctx, cupboard, 3);
      if (cupboard.ego !== 2) return refuse(ctx, 3, 84);
      cupboard.ego = 1;
      // hypothèse (objects.md §4.14) : même accusé que l'ouverture
      return done(ctx, 15, OK);
    case VERB.search:
      if (!ctx.direct.inReach) return tooFarWardrobe(ctx, cupboard, 3);
      return cupboard.ego === 2 ? 0 : refuse(ctx, 4, 84);
    default:
      return 0;
  }
};

const SLAB = { closed: 0, opening: 1, closing: 2, open: 3, broken: 4 } as const;

/** `2832:0008` : seule la torchère piégée (`Ego ≠ 0`) répond à `tirer`. */
export const sconce: ObjectHandler = (ctx) => {
  const lamp = direct(ctx);
  if (ctx.verb !== VERB.pull || lamp.ego === 0) return 0;
  if (!ctx.direct.inReach) return tooFar(ctx, lamp, 3);
  const slab = requireNum(ctx, 104, 0x8a);
  const around = slab.room?.listA ?? [];
  if (around.some((o) => o.ground === GROUND.slabTrigger)) return done(ctx, 133);
  const busy = around.some((o) => o.ground === GROUND.slabBusy);
  switch (slab.ego) {
    case SLAB.closed:
    case SLAB.open:
      if (busy) return refuse(ctx, 4, 93);
      say(ctx, slab.ego === SLAB.closed ? 114 : 115);
      ctx.sound.effect("B", 101, 0);
      ctx.events.operate(eventTarget(slab), 18, EventOp.Add, 10, 104);
      return HANDLED;
    case SLAB.broken:
      return done(ctx, 119);
    default:
      return refuse(ctx, 0, 29);
  }
};

// --- 115 · l'inscription ---------------------------------------------------------------------------------------------------------

/** `2895:0004`. */
export const inscription: ObjectHandler = (ctx) => {
  const text = direct(ctx);
  const walker = hero(ctx);
  const verb = ctx.verb;
  if (verb !== VERB.look && verb !== VERB.read && verb !== VERB.clean) return 0;
  const grille = siblingNum(ctx, 103);
  const blocked = grille !== undefined && grille.p > walker.p;
  if (blocked) return refuse(ctx, 4, 132);
  const close = near(walker, text, 16, -1, 10);

  if (verb === VERB.look) {
    if (close) {
      ctx.messages.say(text.ego, 115);
      return HANDLED;
    }
    const count = flag(text, 0x2c);
    setFlag(text, 0x2c, count + 1);
    if (count % 5 === 0) ctx.messages.say(text.ego, 115);
    else say(ctx, 120 + (count % 5));
    return HANDLED;
  }
  if (verb === VERB.read) {
    if (!close) {
      const n = flag(text, 0x20);
      setFlag(text, 0x20, n + 1);
      return done(ctx, 124 + (n % 6));
    }
    if (text.ego === 0) return done(ctx, 131);
    award(ctx, 1, 8);
    return done(ctx, 130);
  }
  if (!close) return tooFar(ctx, text, 3);
  if (text.ego !== 0) return done(ctx, 106);
  setState(ctx, text, { ego: 1, fig: 1 });
  award(ctx, 1, 7);
  return done(ctx, 138);
};

// --- 201-204, 301 · les nains --------------------------------------------------------------------------------------------------------

const DWARF = { awake: 0, busy: 1, stunned: 2, dead: 3, leaving: 4, sleeping: 7, sleepingDeep: 8 } as const;
const DWARF_SOLDIER = 301;
const SWORD = 314;
const AXE = 206;

/** `2a44:135a(héros, nain)` : éveille le nain et le lance à la poursuite du héros ; faux si le héros est invisible. */
export function awakenDwarf(ctx: HandlerContext, dwarf: GameObject): boolean {
  const walker = hero(ctx);
  if (walker.hidden !== 0) return false;
  if (dwarf.ego >= DWARF.sleeping) setState(ctx, dwarf, { gst: 7, mob: 2, ego: DWARF.awake });
  approach(ctx, dwarf, walker, true);
  setFlag(dwarf, 0x28, 1);
  dwarf.ego = DWARF.awake;
  dwarf.err = 0;
  return true;
}

const DWARF_VERBS: readonly number[] = [VERB.take, VERB.search, VERB.attack, VERB.kill, VERB.whip];

/** `2a44:0eb8` (nains `201`-`204` et nain soldat `301`). */
export const dwarf: ObjectHandler = (ctx) => {
  const verb = ctx.verb;
  if (!DWARF_VERBS.includes(verb)) return 0;
  const little = direct(ctx);
  const walker = hero(ctx);
  if (!ctx.direct.inReach) return tooFar(ctx, little, 3, verb === VERB.take || verb === VERB.whip ? 8 : 74);

  const asleep = little.ego === DWARF.sleeping || little.ego === DWARF.sleepingDeep;
  /** Corps à corps perdu d'avance. */
  const melee = (): number => {
    if (!isKillian(ctx)) return done(ctx, 53);
    playAnim(ctx, { animation: 29, obj: little, partner: walker, ego: little.ego, message: { cls: "V", number: 206 } });
    die(ctx, walker, 1);
    walker.x = little.x;
    walker.y = little.y;
    walker.p = little.p;
    return OK;
  };
  const strike = (): number => {
    if (little.ego === DWARF.busy) return refuse(ctx, 4, 201);
    if (little.ego === DWARF.stunned) return refuse(ctx, 4, 108);
    if (little.ego === DWARF.dead) return refuse(ctx, 4, 90);
    return melee();
  };

  switch (verb) {
    case VERB.take:
      if (little.ego === DWARF.busy) return refuse(ctx, 4, 201);
      if (little.ego === DWARF.stunned) return refuse(ctx, 4, 202);
      if (little.ego === DWARF.dead) return refuse(ctx, 4, 203);
      return refuse(ctx, 4, 76);
    case VERB.search:
      if (little.ego === DWARF.stunned || little.ego === DWARF.dead) {
        listObjects(ctx, 42, 205, 7, little.contents.filter((o) => o.hidden === 0));
        return HANDLED;
      }
      return refuse(ctx, 4, 204);
    case VERB.attack:
      return strike();
    case VERB.kill: {
      if (little.ego === DWARF.dead) return refuse(ctx, 3, 91);
      if (!(little.ego === DWARF.stunned || asleep)) return strike();
      const sword = heldNum(ctx, SWORD);
      const axe = heldNum(ctx, AXE);
      let message: number;
      if (little.num === DWARF_SOLDIER) {
        if (!sword) return refuse(ctx, 4, axe ? 367 : 368);
        message = 366;
      } else if (sword) message = 366;
      else if (axe) message = 207;
      else return refuse(ctx, 4, 208);
      playAnim(ctx, { animation: little.num === DWARF_SOLDIER ? 38 : little.num - 177, obj: little, partner: walker, ego: DWARF.dead, message: { cls: "V", number: message } });
      little.ego = DWARF.dead;
      little.err = 0x11;
      return HANDLED;
    }
    default: {
      // fouetter
      if (!heldNum(ctx, 10)) return refuse(ctx, 4, 80);
      if (little.ego === DWARF.busy) return refuse(ctx, 4, 201);
      if (little.ego === DWARF.stunned || little.ego === DWARF.dead) return refuse(ctx, 4, 108);
      awakenDwarf(ctx, little);
      return done(ctx, 209);
    }
  }
};

// --- 210 · la poterne, 212 · le parchemin ---------------------------------------------------------------------------------------------

/** `2a1c:0004`. */
export const postern: ObjectHandler = (ctx) => {
  const door = direct(ctx);
  const walker = hero(ctx);
  const niche = requireNum(ctx, 211, 0x5d);
  switch (ctx.verb) {
    case VERB.light:
      return refuse(ctx, 4, 218);
    case VERB.close:
      return done(ctx, door.ego === 0 ? 29 : 223);
    case VERB.open:
    case VERB.smash:
    case VERB.attack: {
      const reach = walker.y - door.y;
      if (reach < 0 || reach > 16) return tooFar(ctx, door, 3);
      if (door.ego !== 0) return refuse(ctx, 4, 91);
      if (ctx.preposition !== PREP.with) return refuse(ctx, 0, 227);
      const tool = ctx.indirect.object;
      if (!tool) return refuse(ctx, 1, 14);
      if (!ctx.indirect.held) return refuse(ctx, 3, 24);
      switch (tool.num) {
        case AXE:
          setState(ctx, door, { ego: 1, fig: 1 });
          setState(ctx, niche, { ego: 1, fig: 0 });
          award(ctx, 2, 0);
          return done(ctx, 222, OK);
        case 6:
        case 109:
          return refuse(ctx, 3, 220);
        case 108:
          return refuse(ctx, 3, 221);
        case 11:
          dropHeld(ctx, walker, tool);
          return done(ctx, 219, OK);
        default:
          return refuse(ctx, 4, 23);
      }
    }
    default:
      return 0;
  }
};

/** `2a39:0006` : lire le parchemin. */
export const scroll: ObjectHandler = (ctx) => {
  if (ctx.verb !== VERB.read) return 0;
  if (!ctx.direct.held) return refuse(ctx, 3, 24);
  award(ctx, 2, 1);
  return done(ctx, 225, OK);
};

// --- 302 · le Sarhûl, 303 · Minas Thyl -----------------------------------------------------------------------------------------------

/** `2cdf:054a`. */
export const sarhul: ObjectHandler = (ctx) => {
  const beast = direct(ctx);
  const walker = hero(ctx);
  switch (ctx.verb) {
    case VERB.take:
    case VERB.smash:
    case VERB.eat:
    case VERB.attack:
    case VERB.kill:
      return ctx.direct.inReach ? refuse(ctx, 3, 75) : tooFar(ctx, beast, 3, 74);
    case VERB.feed: {
      if (!ctx.direct.inReach) return tooFar(ctx, beast, 3);
      const ham = heldNum(ctx, 311);
      if (!ham) return refuse(ctx, 4, 313);
      destroy(ctx, ham);
      playAnim(ctx, { animation: 40, obj: beast, partner: walker, ego: 2, message: { cls: "V", number: 312 } });
      return HANDLED;
    }
    case VERB.whip:
      if (!heldNum(ctx, 10)) return refuse(ctx, 3, 80);
      if (!ctx.direct.inReach) return tooFar(ctx, beast, 3);
      if (beast.ego === 0) {
        approach(ctx, beast, walker, walker.hidden === 0);
        return done(ctx, 307);
      }
      return refuse(ctx, 3, beast.ego === 1 ? 97 : 92);
    default:
      return 0;
  }
};

const MINAS_ACTIVE = [0, 5, 7];
const WAND = 320;

/** `2dd9:0df8`. */
export const minas: ObjectHandler = (ctx) => {
  const witch = direct(ctx);
  const walker = hero(ctx);
  const ready = MINAS_ACTIVE.includes(witch.ego);
  switch (ctx.verb) {
    case VERB.take:
      return ctx.direct.inReach ? refuse(ctx, 4, 75) : tooFar(ctx, witch, 3, 74);
    case VERB.smash:
      return refuse(ctx, 4, 310);
    case VERB.eat:
      return refuse(ctx, 4, 311);
    case VERB.search:
    case VERB.push:
    case VERB.attack: {
      if (!ctx.direct.inReach) return tooFar(ctx, witch, 3);
      if (!inside(witch, WAND)) return done(ctx, 309);
      if (!ready) return refuse(ctx, 3, witch.ego === 4 ? 93 : 92);
      setState(ctx, witch, { ego: 1 });
      say(ctx, 314);
      becomeToad(ctx, walker);
      return HANDLED;
    }
    case VERB.kill:
      if (!ctx.direct.inReach) return tooFar(ctx, witch, 3, 74);
      if (!isKillian(ctx)) return refuse(ctx, 4, 53);
      if (ready) {
        die(ctx, walker, 35, { cls: "V", number: 315 });
        return HANDLED;
      }
      return refuse(ctx, witch.ego === 4 ? 4 : 3, witch.ego === 4 ? 93 : 92);
    default:
      return 0;
  }
};

// --- 304 · la fiole, 305 · le grimoire ----------------------------------------------------------------------------------------------

const INVISIBILITY_TIME = 2500;

/** `2b9d:0002` : seul `boire`. */
export const vial: ObjectHandler = (ctx) => {
  if (ctx.verb !== VERB.drink) return 0;
  const flask = direct(ctx);
  const walker = hero(ctx);
  if (!ctx.direct.held) return refuse(ctx, 3, 13);
  switch (flask.ego) {
    case 0:
      if (!isKillian(ctx)) return refuse(ctx, 4, 53);
      die(ctx, walker, 35);
      flask.ego = 2;
      return done(ctx, 330, OK);
    case 1:
      setInvisible(walker, true);
      ctx.events.operate(eventTarget(walker), 1, EventOp.Add, INVISIBILITY_TIME, 1002);
      flask.ego = 2;
      return done(ctx, 331, OK);
    default:
      return refuse(ctx, 4, 365);
  }
};

/** `2b87:0008`. */
export const grimoire: ObjectHandler = (ctx) => {
  const book = direct(ctx);
  switch (ctx.verb) {
    case VERB.light:
      return done(ctx, 332);
    case VERB.smash:
      return done(ctx, 334);
    case VERB.take:
      return done(ctx, 333);
    case VERB.use:
      return done(ctx, 340);
    case VERB.open:
    case VERB.close: {
      if (!ctx.direct.inReach) return tooFar(ctx, book, 3);
      const target = ctx.verb === VERB.open ? 1 : 0;
      if (book.ego === target) return refuse(ctx, 4, 91);
      setState(ctx, book, { ego: target, fig: target });
      return HANDLED;
    }
    case VERB.read: {
      if (!ctx.direct.inReach) return tooFar(ctx, book, 3);
      if (book.ego === 0) return refuse(ctx, 4, 335);
      if (!heldNum(ctx, WAND)) return refuse(ctx, 4, 339);
      award(ctx, 3, 5);
      const n = flag(book, 0x20);
      setFlag(book, 0x20, n + 1);
      return done(ctx, 336 + (n % 3));
    }
    default:
      return 0;
  }
};

// --- 308 · la planche, 310 · la vanne, 311 · le jambon -----------------------------------------------------------------------------------

const PLANK_ROOM = 312;
const PLANK_PLACE = { x: 209, y: 100, p: 40 } as const;
/** Verbes de pose : `mettre`, `jeter` et `utiliser` (30 et 31). */
const PLACE_VERBS: readonly number[] = [VERB.put, VERB.drop, 30, VERB.use];

/** `2bb1:000c`. */
export const plank: ObjectHandler = (ctx) => {
  const board = direct(ctx);
  const walker = hero(ctx);
  if (ctx.verb === VERB.take || ctx.verb === VERB.tear) {
    if (ctx.direct.held) return refuse(ctx, 3, 39);
    if (board.ego === 0) return 0;
    const others = (walker.room?.listA ?? []).some((o) => o !== walker && o !== board && o.ground === GROUND.plank);
    if (others) return done(ctx, 93);
    if (walker.ground === GROUND.plank) {
      if (!isKillian(ctx)) return done(ctx, 53);
      board.ego = 0;
      moveObject(ctx, walker, board);
      walker.p += 8;
      startHeroFall(walker, ctx, 8, ["V", 304]);
      return OK;
    }
    if (walker.ground === GROUND.plankEdge) {
      board.ego = 0;
      moveObject(ctx, walker, board);
      sayDone(ctx);
      return OK;
    }
    return tooFar(ctx, board, 3);
  }
  if (PLACE_VERBS.includes(ctx.verb) && ctx.room?.id === PLANK_ROOM) {
    if (!ctx.direct.held) return refuse(ctx, 3, 13);
    if (walker.ground !== GROUND.plankEdge) return done(ctx, 305);
    if (ctx.room) moveObject(ctx, ctx.room, board);
    board.x = PLANK_PLACE.x;
    board.y = PLANK_PLACE.y;
    board.p = PLANK_PLACE.p;
    board.ego = 1;
    award(ctx, 3, 2);
    return done(ctx, 306, OK);
  }
  return 0;
};

/** `2bd6:0002`. */
export const valve: ObjectHandler = (ctx) => {
  const wheel = direct(ctx);
  switch (ctx.verb) {
    case VERB.open:
    case VERB.close: {
      const pipe = requireNum(ctx, 215, 0);
      if (!ctx.direct.inReach) return tooFar(ctx, wheel, 3);
      const target = ctx.verb === VERB.open ? 1 : 0;
      if (wheel.ego === target) return refuse(ctx, 4, 91);
      pipe.fig = target;
      wheel.ego = target;
      ctx.sound.effect("B", 304, 0);
      return done(ctx, target === 1 ? 301 : 302, OK);
    }
    case VERB.tear:
    case VERB.smash:
    case VERB.push:
    case VERB.attack:
    case VERB.pull:
      return refuse(ctx, 1, 303);
    default:
      return 0;
  }
};

/** `2c14:000a` : `manger` le jambon le remplace par un os (`Num 330`). */
export const ham: ObjectHandler = (ctx) => {
  if (ctx.verb !== VERB.eat) return 0;
  if (!ctx.direct.held) return refuse(ctx, 1, 24);
  replaceObject(ctx, direct(ctx), 330);
  return done(ctx, 369, OK);
};

// --- 315 · la boule de cristal ----------------------------------------------------------------------------------------------------------

/** La boule tombe en éclats (`Num 326`) là où elle est posée. */
function shatterBall(ctx: HandlerContext, ball: GameObject): number {
  const walker = hero(ctx);
  const room = walker.room ?? ctx.room;
  if (room) moveObject(ctx, room, ball);
  replaceObject(ctx, ball, 326);
  return done(ctx, 347, OK);
}

/** `2bea:0008`. */
export const crystalBall: ObjectHandler = (ctx) => {
  const ball = direct(ctx);
  const walker = hero(ctx);
  if (ctx.verb === VERB.smash || ctx.verb === VERB.attack) {
    if (!ctx.direct.held) return ctx.direct.inReach ? refuse(ctx, 3, 13) : tooFar(ctx, ball, 3, 74);
    return shatterBall(ctx, ball);
  }
  if (PLACE_VERBS.includes(ctx.verb) && ctx.verb !== VERB.use) {
    // hypothèse (objects.md §4.26) : poser avec un complément (`mettre la boule dans X`) est laissé au verbe
    if (hasName(ctx.indirect)) return 0;
    if (!ctx.direct.held) return refuse(ctx, 3, 24);
    if (putOnSupport(ctx, ball)) return OK;
    const cushion = heldNum(ctx, 325);
    if (!cushion) return shatterBall(ctx, ball);
    const room = walker.room ?? ctx.room;
    if (room) {
      moveObject(ctx, room, cushion);
      moveObject(ctx, room, ball);
    }
    ball.p = cushion.p + 1;
    return done(ctx, 348, OK);
  }
  return 0;
};

// --- 316/334 · la grille ouvragée, 317/324 · la herse ---------------------------------------------------------------------------------

const SLIDER = { closed: 0, opening: 1, closing: 2, open: 3 } as const;

/**
 * Grille ouvragée (clé `Num 331`) ou herse (clé en or `Num 6`) : l'automate est celui de la grille du cachot ; la serrure doit
 * être à portée. `leaves` : les battants manoeuvrés ensemble.
 */
function slidingGate(ctx: HandlerContext, leaves: readonly GameObject[], lockNum: number, keyNum: number, sound: number | null): number {
  const gate = leaves[0];
  const lock = reachableNum(ctx, lockNum);
  if (!lock) return tooFar(ctx, siblingLock(ctx, lockNum) ?? gate, 3, 95);
  const opening = ctx.verb === VERB.open;
  if (opening) {
    if (gate.ego === SLIDER.opening || gate.ego === SLIDER.closing) return refuse(ctx, 1, 29);
    if (gate.ego === SLIDER.open) return refuse(ctx, 3, 91);
  } else {
    if (gate.ego === SLIDER.opening || gate.ego === SLIDER.closing) return refuse(ctx, 1, 29);
    if (gate.ego === SLIDER.closed) return refuse(ctx, 3, 91);
  }
  if (ctx.preposition !== PREP.with) return refuse(ctx, 1, 14);
  if (!hasName(ctx.indirect)) return refuse(ctx, 1, 13);
  const tool = ctx.indirect.object;
  if (!tool || !ctx.indirect.held) return refuse(ctx, 3, 24);
  if (tool.num !== keyNum) return refuse(ctx, 3, isKey(tool.num) ? 82 : 14);
  for (const leaf of leaves) setState(ctx, leaf, { gst: 7, mob: 1, ego: opening ? SLIDER.opening : SLIDER.closing });
  if (sound !== null) ctx.sound.effect("B", sound, 0);
  return OK;
}

function siblingLock(ctx: HandlerContext, num: number): GameObject | undefined {
  return siblingNum(ctx, num);
}

/** `2c1e:0106` (grille ouvragée `316`). */
export const ornateGrate: ObjectHandler = (ctx) => {
  const bars = direct(ctx);
  switch (ctx.verb) {
    case VERB.open:
    case VERB.close:
      return slidingGate(ctx, [bars], 334, 331, 305);
    case VERB.push:
      return ctx.direct.inReach ? refuse(ctx, 3, 96) : tooFar(ctx, bars, 3);
    default:
      return 0;
  }
};

/** `2cdc:0000` (serrure `334`) : ouvrir / fermer ramènent à la grille. */
export const ornateLock: ObjectHandler = (ctx) => {
  if (ctx.verb !== VERB.open && ctx.verb !== VERB.close) return 0;
  const bars = siblingNum(ctx, 316) ?? requireNum(ctx, 316, 0);
  return slidingGate(ctx, [bars], 334, 331, 305);
};

/** Battants de la herse (`Num 317`) de la salle du héros. */
function portcullisLeaves(ctx: HandlerContext, fallback: GameObject): GameObject[] {
  const leaves = (hero(ctx).room?.listA ?? []).filter((o) => o.num === 317);
  return leaves.length > 0 ? leaves : [fallback];
}

/** `2c4d:00a8` (herse `317`). */
export const portcullis: ObjectHandler = (ctx) => {
  const bars = direct(ctx);
  switch (ctx.verb) {
    case VERB.open:
    case VERB.close:
      return slidingGate(ctx, portcullisLeaves(ctx, bars), 324, 6, null);
    case VERB.push:
      return ctx.direct.inReach ? refuse(ctx, 3, 96) : tooFar(ctx, bars, 3);
    default:
      return 0;
  }
};

/** `2c80:0000` (serrure `324`) : ouvrir / fermer ramènent à la herse. */
export const portcullisLock: ObjectHandler = (ctx) => {
  if (ctx.verb !== VERB.open && ctx.verb !== VERB.close) return 0;
  const bars = siblingNum(ctx, 317) ?? requireNum(ctx, 317, 0);
  return slidingGate(ctx, portcullisLeaves(ctx, bars), 324, 6, null);
};

// --- 327 · le crapaud, 328 · la couronne, 332 · la bouteille -----------------------------------------------------------------------

/** `2d52:0496`. */
export const toad: ObjectHandler = (ctx) => {
  const frog = direct(ctx);
  const walker = hero(ctx);
  switch (ctx.verb) {
    case VERB.take:
      return refuse(ctx, 4, 341);
    case VERB.eat:
      return refuse(ctx, 4, 342);
    case VERB.feed:
      return refuse(ctx, 4, 94);
    case VERB.attack:
    case VERB.kill:
      // hypothèse (objects.md §4.29) : hors de portée, le crapaud n'est pas atteint
      if (!ctx.direct.inReach) return tooFar(ctx, frog, 3, 74);
      destroy(ctx, frog);
      return done(ctx, 343, OK);
    case VERB.kiss:
    case VERB.help: {
      if (!ctx.direct.inReach) return tooFar(ctx, frog, 3, 74);
      if (isKillian(ctx) && walker.ego !== 0) return refuse(ctx, 4, 93);
      if (flag(frog, 0x28) === 1) {
        if (!isKillian(ctx)) return refuse(ctx, 4, 53);
        die(ctx, walker, 35, { cls: "V", number: 344 });
        wander(ctx, walker);
        return OK;
      }
      playAnim(ctx, { animation: 47, obj: frog, partner: walker, ego: 2, message: { cls: "V", number: 345 } });
      return OK;
    }
    default:
      return 0;
  }
};

/** Fin du jeu : `4b53 := 0`, `4b50 := 0`, `4b51 := 6`, puis le couronnement (module `events`). */
const CROWN_DELAY = 6;

/** Animation du couronnement (`characters.md` § 6.2 : 42 ; § 10.1 lit 18, contradiction ouverte) et message `V358`. */
const CROWNING_ANIMATION = 42;

/**
 * `27ed:0194` : la dalle du trône (`Num 104`) est replacée fermée (`Y = 0x8B`, `1a37:007f` : Gst 0, Mob 0, Ego 0, Fig 0, Dep 1, Txt 2, mode 2) ;
 * dans la salle du trône chargée les trois plans sont actifs (`4ae0 = 3`) et les trajets sont annulés (`1793:0006(0)`). Sans cela le
 * trou de la dalle ouverte (cases 81 du plan 0) sert de sol à l'acteur du couronnement, qui ne peut plus gravir les marches (plan 1).
 */
function closeSlab(ctx: HandlerContext): void {
  const slab = ctx.state.findByNum(NUM.slab);
  if (!slab) return;
  slab.y = 0x8b;
  setState(ctx, slab, { gst: 0, mob: 0, ego: 0, fig: 0, dep: 1, txt: 2 }, 2);
  if (ctx.room?.id !== ROOM.throne) return;
  ctx.rooms.refreshPlanes();
  for (const o of ctx.room.listA) if (o.path.defined) ctx.motion.reset(o);
}

/**
 * `2c83:0004` : tous les objets mobiles ou animés autres que le héros sont détruits (leur contenu va dans leur conteneur), puis le
 * héros est remplacé par l'acteur du couronnement (`Num 333`, qui devient le héros contrôlé) et l'animation démarre sur lui.
 */
function crownHero(ctx: HandlerContext, walker: GameObject): void {
  closeSlab(ctx);
  for (const obj of [...ctx.state.objects]) {
    if (obj === walker || (obj.mob !== 2 && obj.animId === 0)) continue;
    for (const child of [...obj.contents]) {
      if (obj.holder) ctx.state.moveToContainer(child, obj.holder);
      else if (obj.room) ctx.state.moveToRoom(child, obj.room);
    }
    ctx.state.deleteObject(obj);
  }
  const king = replaceObject(ctx, walker, NUM.king, { gst: 7, mob: 1, ego: 0, fig: 0, capacity: 500, weight: 800 });
  playAnim(ctx, { animation: CROWNING_ANIMATION, obj: king, ego: 0, message: { cls: "V", number: 358 } });
}

/** `2c83:0004`. */
export const crown: ObjectHandler = (ctx) => {
  const walker = hero(ctx);
  switch (ctx.verb) {
    case VERB.look:
    case VERB.take:
    case VERB.put:
    case VERB.drop:
      return 0;
    case VERB.wear:
      if (!ctx.direct.held) return refuse(ctx, 3, 24);
      if (!isKillian(ctx)) return refuse(ctx, 4, 53);
      if (walker.ego !== 0) return refuse(ctx, 4, 92);
      ctx.state.cadence.pause = 0;
      ctx.state.moveEnabled = false;
      ctx.state.cadence.delay = CROWN_DELAY;
      crownHero(ctx, walker);
      return OK;
    default:
      return refuse(ctx, 4, 385);
  }
};

/** Durée de la protection contre la lave par gorgée (tics). */
const LAVA_PROTECTION = 400;

/** `2c9c:000a`. */
export const bottle: ObjectHandler = (ctx) => {
  if (ctx.verb !== VERB.drink) return 0;
  const flask = direct(ctx);
  const walker = hero(ctx);
  if (!ctx.direct.held) return refuse(ctx, 3, 13);
  if (walker.animId === 0x21) return refuse(ctx, 4, 97);
  switch (flask.ego) {
    case 0:
      setState(ctx, flask, { ego: 3 });
      return done(ctx, 377, OK);
    case 1:
    case 2: {
      const left = ctx.events.operate(eventTarget(walker), 0, EventOp.Add, LAVA_PROTECTION, 1001);
      if (left === 0) return done(ctx, 359, OK);
      const message = flask.ego === 1 ? 354 : 383;
      flask.ego++;
      return done(ctx, message, OK);
    }
    default:
      return refuse(ctx, 4, 378);
  }
};

// --- enregistrement ---------------------------------------------------------------------------------------------------------------------

/**
 * Famille 1 de `1ec8:000a` : les 36 adresses (46 clés) de `DGROUP:07ca`, hors défaut de porte fermée (`10c8:0130`, géré par
 * `HandlerRegistry.resolve`). Les clés partagent des gestionnaires (coffres, nains, portes).
 */
export const OBJECT_HANDLERS: readonly (readonly [number | readonly number[], ObjectHandler])[] = [
  [3, pie],
  [4, ours],
  [[9, 21, 110, 319], chest],
  [12, torch],
  [16, stele],
  [17, wood],
  [18, fire],
  [20, brambles],
  [27, steleKeyhole],
  [101, prytwen],
  [102, steleHatch],
  [103, grate],
  [105, nugget],
  [108, keyring],
  [[111, 309, 329], lockedDoor],
  [113, wardrobe],
  [114, sconce],
  [115, inscription],
  [[201, 202, 203, 204, 301], dwarf],
  [210, postern],
  [212, scroll],
  [302, sarhul],
  [303, minas],
  [304, vial],
  [305, grimoire],
  [308, plank],
  [310, valve],
  [311, ham],
  [315, crystalBall],
  [316, ornateGrate],
  [317, portcullis],
  [324, portcullisLock],
  [327, toad],
  [328, crown],
  [332, bottle],
  [334, ornateLock],
];

export function registerObjectHandlers(registry: HandlerRegistry): void {
  for (const [key, handler] of OBJECT_HANDLERS) registry.register(FAMILY.direct, key, handler);
}
