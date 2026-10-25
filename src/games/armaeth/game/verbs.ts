import { FAMILY, type HandlerContext, type HandlerRegistry, type HandlerTarget, NO_TARGET, type VerbHandler } from "../engine/handlers";
import type { GameObject } from "../engine/state";
import {
  PREP,
  VERB,
  WORD_CLASS,
  canCarry,
  enq,
  decorText,
  dropHeld,
  listObjects,
  putOnSupport,
  globalNum,
  hasName,
  LADDER_GROUND,
  moveObject,
  placed,
  queue,
  say,
  sayDone,
  wordClass,
  OK,
} from "./helpers";

/**
 * Gestionnaires de verbes d'*Armaeth* (famille 0 de `1ec8:000a`, `docs/armaeth/objects.md` § 3 et `parser.md` § 8) : les 11
 * fonctions de verbe, enregistrées pour leurs 13 clés (le défaut `333c:0008` des 23 autres est dans `engine/handlers.ts`).
 * Les gestionnaires de verbe ne désactivent jamais le verbe : ils mettent en file leurs refus (`enq`) et affichent leurs
 * réussites tout de suite.
 */

const isObjectName = (target: HandlerTarget) => wordClass(target.code) === WORD_CLASS.object;
const isDecorName = (target: HandlerTarget) => wordClass(target.code) === WORD_CLASS.decor || wordClass(target.code) === WORD_CLASS.decorAlt;

/** Code des noms de lieu de classe 6 (`parser.md` § 8.2). */
const NAME_OBJECTS = 6001;
const NAME_ROOM = 6002;
const NAME_OTHER = 6004;

/** Objet `inner` est contenu (à un niveau quelconque) dans `outer`. */
function isWithin(inner: GameObject, outer: GameObject): boolean {
  for (let up = inner.holder; up; up = up.holder) if (up === outer) return true;
  return false;
}

// --- regarder (5), fouiller (7), o (42) --------------------------------------------------------------------------------------

/** Liste des objets de la salle chargée (`21ad:000a(V031, V032, 0)` sur `salle +0x22`). */
function listRoom(ctx: HandlerContext): void {
  listObjects(ctx, 31, 32, 0, ctx.room?.listA ?? []);
}

/**
 * `regarder` (`33b2:0007`, politique 3) sur des cibles données : `fouiller` l'appelle avec le nom en indirect et `dans`.
 */
function look(ctx: HandlerContext, direct: HandlerTarget, indirect: HandlerTarget, preposition: number): number {
  if (ctx.state.darkRoom) {
    say(ctx, 41);
    return OK;
  }
  const D = direct.object;
  const I = indirect.object;
  if (I) {
    if (I.hidden !== 0) return queue(ctx, 3, 26);
    if (preposition !== PREP.in) return queue(ctx, 3, 35);
    if (I.canContain === 0) return queue(ctx, 3, 29);
    if (!indirect.inReach) {
      ctx.react(I);
      return queue(ctx, 3, 8);
    }
    if (I === ctx.hero) return 0;
    if (D) {
      if (D.holder !== I) return queue(ctx, 4, 22);
      return describe(ctx, D);
    }
    if (hasName(direct)) return isObjectName(direct) ? queue(ctx, 1, 22) : queue(ctx, 0, 29);
    if (I.contents.length > 0) {
      ctx.state.selected = I; // `1664:0004(I)` : panneau de contenu
      return OK;
    }
    return queue(ctx, 4, 33);
  }
  if (hasName(indirect)) {
    if (wordClass(indirect.code) === WORD_CLASS.room) {
      if (indirect.code === NAME_ROOM) {
        listRoom(ctx);
        return OK;
      }
      return queue(ctx, 0, 29);
    }
    return isObjectName(indirect) ? queue(ctx, 1, 26) : queue(ctx, 0, 29);
  }
  if (D) return describe(ctx, D);
  if (hasName(direct)) {
    if (isDecorName(direct)) {
      const text = decorText(ctx, direct.code);
      if (text) ctx.messages.enqueue(wordClass(direct.code) === WORD_CLASS.decor ? 9 : 8, text.cls, text.number);
      else if (text === undefined && ctx.talk) enq(ctx, 0, 26);
      return 0;
    }
    if (wordClass(direct.code) === WORD_CLASS.room) {
      if (direct.code === NAME_OBJECTS) {
        listRoom(ctx);
        return OK;
      }
      if (direct.code === NAME_ROOM) return describeRoom(ctx);
      return direct.code === NAME_OTHER ? queue(ctx, 1, 38) : queue(ctx, 0, 29);
    }
    return isObjectName(direct) ? queue(ctx, 1, 26) : queue(ctx, 0, 29);
  }
  // hypothèse (parser.md §8.2) : « un autre gestionnaire a déjà réussi » (`4cc2`) n'est pas exposé : sans nom, c'est `regarder salle`
  return describeRoom(ctx);
}

/** Description d'un objet dans son état : `enq(p10, 30 + Ego, Num)`, affichée en fin de commande. */
function describe(ctx: HandlerContext, obj: GameObject): number {
  if (obj.hidden !== 0) return queue(ctx, 3, 26);
  ctx.messages.enqueue(10, obj.ego, obj.num);
  return 0;
}

function describeRoom(ctx: HandlerContext): number {
  if (ctx.room) ctx.messages.say("L", ctx.room.id);
  return OK;
}

export const regarder: VerbHandler = {
  policy: 3,
  run: (ctx) => look(ctx, ctx.direct, ctx.indirect, ctx.preposition),
};

/** `fouiller` (`32f6:000c`) = `regarder dans X` : refuse deux noms ou aucun. */
export const fouiller: VerbHandler = {
  policy: 3,
  run(ctx) {
    const hasDirect = hasName(ctx.direct);
    const hasIndirect = hasName(ctx.indirect);
    if (hasDirect === hasIndirect) return 0;
    return look(ctx, NO_TARGET, hasDirect ? ctx.direct : ctx.indirect, PREP.in);
  },
};

/** `o` (`332e:0000`) : la liste des objets de la salle, comme `regarder objet`. */
export const objets: VerbHandler = {
  policy: 0,
  run(ctx) {
    if (ctx.state.darkRoom) say(ctx, 41);
    else listRoom(ctx);
    return OK;
  },
};

// --- prendre (6) -----------------------------------------------------------------------------------------------------------

/** Transfert dans l'inventaire du héros avec le contrôle de ramassage et de poids, `V015` si phrase tapée. */
function pickUp(ctx: HandlerContext, obj: GameObject, refusalPriority: number): number {
  const hero = ctx.hero!;
  if (obj.pickable === 0) return queue(ctx, refusalPriority, 20);
  if (!canCarry(hero, obj)) return queue(ctx, 4, 21);
  moveObject(ctx, hero, obj);
  sayDone(ctx);
  return OK;
}

export const prendre: VerbHandler = {
  policy: 0,
  run(ctx) {
    const hero = ctx.hero;
    if (!hero) return 0;
    const D = ctx.direct.object;
    const I = ctx.indirect.object;
    if (!I && !hasName(ctx.indirect)) {
      if (D) {
        if (ctx.direct.held) return queue(ctx, 3, 39);
        if (D === hero) return queue(ctx, 3, 29);
        if (ctx.direct.inReach) return pickUp(ctx, D, 3);
        if (ctx.state.darkRoom) return queue(ctx, 3, 41);
        if (D.pickable === 0) return queue(ctx, 3, 20);
        if (!canCarry(hero, D)) return queue(ctx, 4, 21);
        return tooFarTake(ctx, D);
      }
      if (!hasName(ctx.direct)) return 0;
      if (isDecorName(ctx.direct)) return decorText(ctx, ctx.direct.code) === undefined ? queue(ctx, 0, 26) : queue(ctx, 2, 20);
      return isObjectName(ctx.direct) ? queue(ctx, 1, 26) : queue(ctx, 0, 29);
    }
    if (I) {
      if (I.hidden !== 0) return queue(ctx, 3, 26);
      if (I.canContain === 0) return queue(ctx, 3, 29);
      if (ctx.preposition !== PREP.in && ctx.preposition !== PREP.to) return queue(ctx, 3, 23);
      if (!ctx.indirect.inReach) return tooFarTake(ctx, I);
      if (D) {
        if (D.holder !== I) return queue(ctx, 3, 22);
        return pickUp(ctx, D, 4);
      }
      if (!hasName(ctx.direct)) return 0;
      return isObjectName(ctx.direct) ? queue(ctx, 1, 22) : queue(ctx, 0, 29);
    }
    // indirect nommé mais non résolu
    if (isObjectName(ctx.indirect)) return queue(ctx, 1, 26);
    // hypothèse (objects.md §3.3) : pour les autres classes, l'original met en file `(n° du nom, V<classe>)` par défaut de code
    // (SI/DI non initialisés) ; ce défaut n'est pas reproduit.
    if (isDecorName(ctx.indirect)) return decorText(ctx, ctx.indirect.code) === undefined ? queue(ctx, 0, 29) : queue(ctx, 2, 29);
    return 0;
  },
};

function tooFarTake(ctx: HandlerContext, target: GameObject): number {
  ctx.react(target);
  return queue(ctx, 3, 8);
}

// --- mettre (15) / jeter (16) ----------------------------------------------------------------------------------------------

export const mettre: VerbHandler = {
  policy: 0,
  run(ctx) {
    const hero = ctx.hero;
    if (!hero) return 0;
    const D = ctx.direct.object;
    const I = ctx.indirect.object;
    if (!I) {
      if (hasName(ctx.indirect)) return isObjectName(ctx.indirect) ? queue(ctx, 1, 24) : queue(ctx, 0, 29);
      if (D) {
        if (!ctx.direct.held) return queue(ctx, 3, 24);
        if (hero.dep !== 0 && hero.location === 1) dropHeld(ctx, hero, D);
        else if (!putOnSupport(ctx, D)) {
          const dest = hero.holder ?? hero.room;
          if (!dest || !placed(moveObject(ctx, dest, D))) {
            ctx.state.moveToContainer(D, hero); // refus de placement : l'objet reste dans l'inventaire
            say(ctx, 94);
            return 0;
          }
        }
        sayDone(ctx);
        return OK;
      }
      if (hasName(ctx.direct)) return isObjectName(ctx.direct) ? queue(ctx, 1, 24) : queue(ctx, 0, 29);
      return 0;
    }
    if (I.hidden !== 0) return queue(ctx, 3, 26);
    if (I.canContain === 0) return queue(ctx, 3, 29);
    if (ctx.preposition !== PREP.in && ctx.preposition !== PREP.to) return queue(ctx, 3, 23);
    if (D) {
      if (!ctx.direct.held) return queue(ctx, 3, 24);
      if (D === I || isWithin(I, D)) return queue(ctx, 3, 29); // le test « I = D » de l'original compare à une variable non initialisée
      if (!ctx.indirect.inReach) {
        ctx.react(I);
        return queue(ctx, 3, 8);
      }
      moveObject(ctx, I, D); // aucun contrôle de capacité ni de poids ici : seules les familles 5 peuvent refuser
      sayDone(ctx);
      return OK;
    }
    if (hasName(ctx.direct)) return isObjectName(ctx.direct) ? queue(ctx, 1, 24) : queue(ctx, 0, 29);
    return 0;
  },
};

// --- inventaire (17) -------------------------------------------------------------------------------------------------------

export const inventaire: VerbHandler = {
  policy: 0,
  run(ctx) {
    const hero = ctx.hero;
    if (!hero) return 0;
    listObjects(
      ctx,
      36,
      37,
      7,
      hero.contents.filter((o) => o.hidden === 0),
    );
    return OK;
  },
};

// --- briser (10), lire (20) -------------------------------------------------------------------------------------------------

export const briser: VerbHandler = {
  policy: 0,
  run(ctx) {
    return queue(ctx, 0, 52);
  },
};

export const lire: VerbHandler = {
  policy: 0,
  run(ctx) {
    return queue(ctx, 0, 98);
  },
};

// --- escalader (9), monter (13), descendre (14) ------------------------------------------------------------------------------

const VER_OFFSET = 0x61;

/** `3332:0004` : échelles / escaliers (`Sol`), sinon déplacement lié aux zones (`Dep` 2 ou 4). */
export const grimper: VerbHandler = {
  policy: 0,
  run(ctx) {
    const hero = ctx.hero;
    if (!hero) return 0;
    if (LADDER_GROUND.some(([from, to]) => hero.ground >= from && hero.ground <= to)) {
      ctx.state.writeField(hero, VER_OFFSET, 1, 1);
      return OK;
    }
    // hypothèse (objects.md §3.9) : sens vertical (+1 descend) à confirmer à l'écran
    if (hero.dep === 2 || hero.dep === 4) {
      ctx.state.writeField(hero, VER_OFFSET, 1, ctx.verb === VERB.down ? 1 : -1);
      return OK;
    }
    return queue(ctx, 4, 44);
  },
};

// --- zwygks (41) -------------------------------------------------------------------------------------------------------------

/** Mot de triche : l'objet désigné entre dans l'inventaire du héros, même invisible (`19dc:04f1`). */
export const zwygks: VerbHandler = {
  policy: 3,
  run(ctx) {
    const hero = ctx.hero;
    if (!hero) return 0;
    const take = (obj: GameObject) => {
      if (obj !== hero && !isWithin(hero, obj)) moveObject(ctx, hero, obj);
    };
    const I = ctx.indirect.object;
    if (I && I !== hero) take(I);
    else if (isObjectName(ctx.indirect)) {
      const found = globalNum(ctx, ctx.indirect.code % 1000);
      if (found) take(found);
    } else if (isObjectName(ctx.direct)) {
      // hypothèse (objects.md §3.10) : un direct déjà résolu est pris avec les autres objets du même `Num`
      for (const obj of ctx.state.findAllByNum(ctx.direct.code % 1000, 2)) take(obj);
    }
    return OK;
  },
};

// --- enregistrement ----------------------------------------------------------------------------------------------------------------

/** Les 11 fonctions de verbe sur leurs 13 clés. */
export function registerVerbs(registry: HandlerRegistry): void {
  registry.register(FAMILY.verb, VERB.look, regarder);
  registry.register(FAMILY.verb, VERB.take, prendre);
  registry.register(FAMILY.verb, VERB.search, fouiller);
  registry.register(FAMILY.verb, [VERB.climb, VERB.up, VERB.down], grimper);
  registry.register(FAMILY.verb, VERB.smash, briser);
  registry.register(FAMILY.verb, [VERB.put, VERB.drop], mettre);
  registry.register(FAMILY.verb, VERB.inventory, inventaire);
  registry.register(FAMILY.verb, VERB.read, lire);
  registry.register(FAMILY.verb, VERB.zwygks, zwygks);
  registry.register(FAMILY.verb, VERB.objects, objets);
}
