import { type BehaviorContext, type HandlerContext, type HandlerRegistry, type ObjectHandler, FAMILY } from "../engine/handlers";
import type { GameObject, GameRoom } from "../engine/state";
import { setRawU16 } from "../engine/state";
import {
  NUM,
  OK,
  PREP,
  VERB,
  approach,
  award,
  die,
  inPrep,
  inside,
  playAnim,
  refuse,
  replaceObject,
  roomOf,
  scratch,
  setPreposition,
  setScratch,
  setState,
  tooFar,
  tooFarWardrobe,
  wakeAndChase,
} from "./helpers";
import { turnIntoToad } from "./npc-creatures";
import { defaultKit } from "./npc-kit";

/**
 * Gestionnaires d'objet **indirect** (famille 5, `docs/armaeth/objects.md` § 4) et mots magiques (famille 6, § 5).
 *
 * Une phrase appelle d'abord le gestionnaire de l'indirect, puis celui du direct, puis le verbe. Un refus désactive le verbe
 * générique (`ctx.disableVerb()`), met son message en file et rend 0 ; un succès rend `OK` (7).
 */

// --- aides ---------------------------------------------------------------------------------------------------------------

const OPEN_STATE = 2;

/** `Ego` de Minas Thyl qui l'autorisent à agir (`objects.md` § 4.20). */
const MINAS_ACTIVE: readonly number[] = [0, 5, 7];

/** Durée (tics) d'un feu par `Ego` (`DGROUP:5264`, `characters.md` § 8). */
const FIRE_DURATION: readonly number[] = [0, 24000, 18000, 12000, 12000, 6000, 6000];

/** Objet indirect de la phrase, ou `null` (clic sans objet résolu). */
const indirectOf = (ctx: HandlerContext): GameObject | null => ctx.indirect.object;

// --- 4.1 pie, 4.2 ours ---------------------------------------------------------------------------------------------------

/** Pie (`2774:0606`) comme indirect : `V029` p4, verbe désactivé. */
const magpieIndirect: ObjectHandler = (ctx) => refuse(ctx, 4, 29);

/** Ours (`26da:07ea`) comme indirect : même refus que la pie, procédure distincte dans l'original. */
const bearIndirect: ObjectHandler = (ctx) => refuse(ctx, 4, 29);

// --- 4.3 coffret et coffres ----------------------------------------------------------------------------------------------

/** Coffret (`2566:000e`) : seules les valeurs de 50 et plus y entrent (`score(0, 0)`). */
const casketIndirect: ObjectHandler = (ctx) => {
  if (!inPrep(ctx, PREP.in, PREP.to)) return 0; // hypothèse (objects.md §4.3) : la phrase sans `dans` n'est pas pour lui
  const casket = indirectOf(ctx);
  if (!casket) return 0;
  if (!ctx.indirect.inReach) return tooFar(ctx, ctx.indirect.object, 3);
  if (casket.ego !== OPEN_STATE) return refuse(ctx, 4, 65);
  if (ctx.verb !== VERB.put && ctx.verb !== VERB.drop) return 0; // regarder, prendre, fouiller : le verbe s'en charge
  const item = ctx.direct.object;
  if (!item) return 0;
  if (item === casket) return refuse(ctx, 4, 53);
  if (!ctx.direct.held) return refuse(ctx, 3, 24);
  if (item.value < 50) return refuse(ctx, 4, 40);
  ctx.state.moveToContainer(item, casket); // `19dc:0000(coffret, objet, 2)`
  award(ctx, 0, 0);
  return OK;
};

/** Gros coffres de chêne, de bronze et de fer (`22c1:029e`) : on ne regarde, ne prend ni ne met dans un coffre fermé. */
const chestIndirect: ObjectHandler = (ctx) => {
  if (inPrep(ctx, PREP.in, PREP.to) && indirectOf(ctx)?.ego !== OPEN_STATE) refuse(ctx, 4, 51);
  return 0;
};

// --- 4.7 feu -------------------------------------------------------------------------------------------------------------

/** `264c:02b0(feu, torche)` : la torche est détruite, le feu gagne un état (borné à 6) et sa durée. Rend le nouvel état. */
function feedFire(ctx: HandlerContext, fire: GameObject, torch: GameObject): number {
  ctx.state.deleteObject(torch);
  const ego = Math.min(fire.ego + 1, 6);
  setState(ctx, fire, { ego, fig: ego });
  fire.tim = FIRE_DURATION[ego];
  return ego;
}

/** Feu comme indirect (`264c:01ac`) : `mettre` / `jeter` une torche dedans la nourrit (`score(0, 4)`). */
const fireIndirect: ObjectHandler = (ctx) => {
  const fire = indirectOf(ctx);
  if (!fire || !inPrep(ctx, PREP.in, PREP.to)) return 0;
  if (!ctx.indirect.inReach) return tooFar(ctx, ctx.indirect.object, 4);
  if (ctx.verb !== VERB.put && ctx.verb !== VERB.drop) return 0;
  const torch = ctx.direct.object;
  if (!torch) return refuse(ctx, 1, 24);
  if (torch.num !== NUM.torch) return refuse(ctx, 3, 20);
  if (!ctx.direct.held) return refuse(ctx, 3, 13);
  if (fire.ego === 0) {
    ctx.messages.say("V", 9); // le feu est mort : la torche n'est pas consommée
    return OK;
  }
  const ego = feedFire(ctx, fire, torch);
  ctx.messages.say("V", ego === 2 ? 27 : ego < 6 ? 28 : 15);
  award(ctx, 0, 4);
  return OK;
};

// --- 4.9 Prytwen ---------------------------------------------------------------------------------------------------------

/** Prytwen comme indirect (`28b1:0fba`) : ses poches (assommé ou mort), la conversation, rien d'autre. */
const prytwenIndirect: ObjectHandler = (ctx) => {
  const prytwen = indirectOf(ctx);
  if (!prytwen || !inPrep(ctx, PREP.in, PREP.to)) return 0;
  const pockets = prytwen.ego === 2 || prytwen.ego === 3;
  switch (ctx.verb) {
    case VERB.look:
      if (!ctx.indirect.inReach) return tooFar(ctx, ctx.indirect.object, 3, 74);
      if (ctx.indirect.held) return refuse(ctx, 4, 102);
      return pockets ? 0 : refuse(ctx, 3, 75);
    case VERB.take:
      if (ctx.indirect.held) return refuse(ctx, 4, 102);
      if (!ctx.indirect.inReach) return tooFar(ctx, ctx.indirect.object, 3, 74);
      if (!pockets) return refuse(ctx, 4, 76);
      setPreposition(ctx, PREP.in); // prise standard dans ses poches
      return 0;
    case VERB.put:
    case VERB.drop:
      return refuse(ctx, 0, 29);
    case VERB.talk:
      if (prytwen.ego === 1) return refuse(ctx, 4, 135);
      if (pockets) return refuse(ctx, 4, 136);
      if (ctx.hero) approach(ctx, prytwen, ctx.hero);
      ctx.messages.say("V", 110);
      return OK;
    default:
      return refuse(ctx, 4, 23);
  }
};

// --- 4.14 armoire --------------------------------------------------------------------------------------------------------

/** Armoire comme indirect (`2815:0112`) : fermée, on ne regarde, prend, fouille ni met rien dedans. */
const wardrobeIndirect: ObjectHandler = (ctx) => {
  const wardrobe = indirectOf(ctx);
  if (!wardrobe || !inPrep(ctx, PREP.in)) return 0;
  if (!ctx.indirect.inReach) return tooFarWardrobe(ctx, ctx.indirect.object, 4);
  const touchesContent = ([VERB.look, VERB.take, VERB.search, VERB.put, VERB.drop] as number[]).includes(ctx.verb);
  if (touchesContent && wardrobe.ego !== OPEN_STATE) return refuse(ctx, 4, 84);
  return 0;
};

// --- 4.17 nains ----------------------------------------------------------------------------------------------------------

/** Nains (`2a44:11e2`, clés 201-204 et 301) comme indirect : leurs poches et la conversation. */
const dwarfIndirect: ObjectHandler = (ctx) => {
  const dwarf = indirectOf(ctx);
  if (!dwarf || !inPrep(ctx, PREP.in, PREP.to)) return 0;
  const down = dwarf.ego === 2 || dwarf.ego === 3;
  if (ctx.verb === VERB.take) {
    if (!ctx.indirect.inReach) return tooFar(ctx, ctx.indirect.object, 3, 74);
    if (dwarf.ego === 1) return refuse(ctx, 4, 201);
    if (!down) return refuse(ctx, 4, 204);
    setPreposition(ctx, PREP.in);
    return 0;
  }
  if (ctx.verb === VERB.talk) {
    if (dwarf.ego === 1) return refuse(ctx, 4, 201);
    if (down) return refuse(ctx, 4, 226);
    if (dwarf.ego >= 7) setState(ctx, dwarf, { gst: 7, mob: 2, ego: 0 }); // endormi : éveil
    if (ctx.hero) wakeAndChase(ctx, ctx.hero, dwarf);
    ctx.messages.say("V", 210);
    return OK;
  }
  return refuse(ctx, 4, 23);
};

// --- 4.18 niche ----------------------------------------------------------------------------------------------------------

/** Niche (`2a3e:000c`) : fermée tant que la poterne tient ; y prendre un objet rapporte `score(2, 3)`. */
const nicheIndirect: ObjectHandler = (ctx) => {
  const niche = indirectOf(ctx);
  if (!niche) return 0;
  if (!inPrep(ctx, PREP.in)) return refuse(ctx, 4, 23);
  if (niche.ego === 0) return refuse(ctx, 4, 224);
  if (ctx.verb === VERB.take) award(ctx, 2, 3);
  return 0;
};

// --- 4.19 Sarhûl ---------------------------------------------------------------------------------------------------------

/** Sarhûl comme indirect (`2cdf:06d2`) : il ne répond que par des grognements. */
const sarhulIndirect: ObjectHandler = (ctx) => (ctx.verb === VERB.talk ? refuse(ctx, 3, 308) : refuse(ctx, 4, 23));

// --- 4.20 Minas Thyl -----------------------------------------------------------------------------------------------------

/**
 * `2dd9:14cc` + `2d52:06b0` : Minas Thyl change `victim` en crapaud (`Num 327`, qui garde `Num` et état d'origine en `+0x28` et
 * `+0x24`) et le héros contrôlé devient ce crapaud.
 */
export function minasChangesIntoToad(ctx: HandlerContext, minas: GameObject, victim: GameObject, message = 314): GameObject {
  setState(ctx, minas, { ego: 1 });
  ctx.messages.say("V", message);
  return becomeToad(ctx, victim);
}

/**
 * `2d52:06b0` : `victim` est remplacé par un crapaud qui garde son `Num` et son `Ego` d'origine (implémentation unique :
 * `npc-creatures.ts`, que Minas Thyl utilise aussi) ; le héros métamorphosé devient le crapaud.
 */
export function becomeToad(ctx: BehaviorContext, victim: GameObject): GameObject {
  const toad = turnIntoToad(defaultKit, ctx, victim, victim);
  if (!toad) throw new Error("Métamorphose sans salle");
  return toad;
}

/** Minas Thyl vient à vous : `walkTo` et `V317` en file. */
function minasComes(ctx: HandlerContext, minas: GameObject): number {
  if (ctx.hero) approach(ctx, minas, ctx.hero);
  return refuse(ctx, 4, 317);
}

/** Un message de refus selon l'état de Minas Thyl (`V090` hors jeu, `V093` en transit, `V092` sinon). */
const minasUnavailable = (ctx: HandlerContext, minas: GameObject, base = 3): number => refuse(ctx, base, minas.ego === 4 ? 90 : 92);

/** Donner `gift` à Minas Thyl (`2dd9:0fd0`, verbe 32). */
function giveToMinas(ctx: HandlerContext, minas: GameObject): number {
  const hero = ctx.hero;
  const gift = ctx.direct.object;
  if (!hero || !gift) return 0;
  if (hero.hidden !== 0) return refuse(ctx, 4, 364);
  if (!MINAS_ACTIVE.includes(minas.ego)) return minasUnavailable(ctx, minas);
  if (!ctx.direct.held) return refuse(ctx, 3, 24); // hypothèse (objects.md §4.20) : le cadeau doit être tenu
  if (!ctx.indirect.inReach) return minasComes(ctx, minas);

  const hasWand = inside(minas, NUM.wand) !== undefined;
  const farewell = () => {
    playAnim(ctx, { animation: 45, obj: minas }); // elle disparaît
    minas.ego = 6;
  };

  setState(ctx, minas, { ego: 5 });
  switch (gift.num) {
    case NUM.vial:
      ctx.messages.say("V", 372);
      if (hasWand) minasChangesIntoToad(ctx, minas, hero, 374);
      else die(ctx, hero, 35, { cls: "V", number: 375 });
      farewell();
      return OK;
    case NUM.wand: {
      const first = scratch(minas) === 0;
      setScratch(minas, 7);
      ctx.state.moveToContainer(gift, minas);
      if (!first) ctx.messages.say("V", 322);
      else {
        ctx.messages.say("V", 321);
        const talisman = inside(minas, NUM.talisman);
        if (talisman) {
          ctx.state.moveToContainer(talisman, hero);
          award(ctx, 3, 1);
          ctx.messages.say("V", 323);
        } else ctx.messages.say("V", 324);
      }
      farewell();
      return OK;
    }
    default: {
      const known: Record<number, number> = { 313: 318, 315: 320, 321: 373, 6: 325, 22: 325, 108: 325, 109: 325 };
      let message = known[gift.num];
      if (message === undefined) {
        if (gift.value < 10) return refuse(ctx, 4, 327); // refusé : rien n'est pris
        message = 326;
      }
      ctx.messages.say("V", message);
      ctx.state.moveToContainer(gift, minas); // `19dc:0000(Minas, objet, 2)`
      ctx.messages.say("V", scratch(minas) === 0 ? 319 : hasWand ? 329 : 328);
      farewell();
      return OK;
    }
  }
}

/** Minas Thyl comme indirect (`2dd9:0fd0`) : prendre à Minas, lui parler, lui donner. */
const minasIndirect: ObjectHandler = (ctx) => {
  const minas = indirectOf(ctx);
  const hero = ctx.hero;
  if (!minas || !hero) return 0;
  switch (ctx.verb) {
    case VERB.take: {
      if (!ctx.indirect.inReach) return tooFar(ctx, ctx.indirect.object, 3);
      if (!MINAS_ACTIVE.includes(minas.ego)) return refuse(ctx, 4, 93);
      if (inside(minas, NUM.wand)) {
        minasChangesIntoToad(ctx, minas, hero);
        return OK;
      }
      ctx.messages.say("V", 309);
      return OK;
    }
    case VERB.talk: {
      if (!MINAS_ACTIVE.includes(minas.ego)) return minasUnavailable(ctx, minas);
      setState(ctx, minas, { ego: 0 });
      approach(ctx, minas, hero);
      ctx.messages.say("V", hero.hidden !== 0 ? 363 : 316);
      return OK;
    }
    case VERB.give:
      return giveToMinas(ctx, minas);
    default:
      return 0;
  }
};

// --- 4.26 boule de cristal, 4.29 crapaud ---------------------------------------------------------------------------------

/** Boule de cristal comme indirect (`2bea:0230`) : `regarder dans la boule` tenue montre le seau (`score(3, 10)`). */
const crystalIndirect: ObjectHandler = (ctx) => {
  if (ctx.verb !== VERB.look || !inPrep(ctx, PREP.in)) return 0;
  if (!ctx.indirect.held) return refuse(ctx, 3, 24);
  award(ctx, 3, 10);
  ctx.messages.say("V", 349);
  return OK;
};

/** Crapaud comme indirect (`2d52:0620`) : `parler` le réveille, le héros s'approche. */
const toadIndirect: ObjectHandler = (ctx) => {
  const toad = indirectOf(ctx);
  if (!toad) return 0;
  if (ctx.verb !== VERB.talk || !inPrep(ctx, PREP.to)) return refuse(ctx, 4, 23);
  if (toad.ego === 1) toad.ego = 0;
  if (ctx.hero) approach(ctx, ctx.hero, toad);
  ctx.messages.say("V", 346);
  return OK;
};

// --- famille 6 : mots magiques -------------------------------------------------------------------------------------------

/** Salles de la herse de granite : 202 (`0xCA`) et 305 (`0x131`). */
const PORTCULLIS_ROOMS: readonly number[] = [202, 305];
/** Durée du coulissement de la herse (`29fd:017a`, `Tim = 0x22`, `characters.md` § 10.2). */
const PORTCULLIS_TICKS = 0x22;

/** `29fd:017a(herse, mode)` : lance le coulissement (1 monte, 2 redescend) ; la procédure `Fct` de la herse le termine. */
function movePortcullis(ctx: HandlerContext, portcullis: GameObject, open: boolean): void {
  setState(ctx, portcullis, { gst: 7, mob: 1, ego: open ? 1 : 2 });
  portcullis.tim = PORTCULLIS_TICKS; // hypothèse (characters.md §10.2) : comme la dalle `27ed:01e0`
}

/** `3443:0028(mode)` : `armaeth` (0) ferme la herse, `tinhuel` (7) l'ouvre. */
function portcullisWord(ctx: HandlerContext, open: boolean): number {
  const room = ctx.room;
  if (!room || !PORTCULLIS_ROOMS.includes(room.id)) {
    ctx.messages.say("V", 217);
    return OK;
  }
  const portcullis = ctx.state.findByNum(NUM.portcullis);
  if (!portcullis) return 0;
  const mismatch = (n: number, p: number) => {
    ctx.messages.enqueue(p, "V", n);
    return 0;
  };
  switch (portcullis.ego) {
    case 0: // fermée
      if (!open) return mismatch(211, 3);
      setScratch(portcullis, scratch(portcullis) + 1);
      ctx.messages.say("V", ctx.rng.mod(scratch(portcullis)) === 0 ? 214 : 215);
      movePortcullis(ctx, portcullis, true);
      return OK;
    case 3: // ouverte
      if (open) return mismatch(216, 3);
      ctx.messages.say("V", 212);
      movePortcullis(ctx, portcullis, false);
      return OK;
    case 4: // bloquée par les nains
      return mismatch(213, 4);
    default: // en mouvement
      return mismatch(29, 3);
  }
}

/** `erin <lieu>` (`3474:000c`) : téléporte vers la salle du lieu nommé, le talisman en poche. */
const erin: ObjectHandler = (ctx) => {
  const hero = ctx.hero;
  if (!hero) return 0;
  // un seul nom, de classe 19 (lieu) : le moteur appelle le gestionnaire une fois par nom de la phrase
  if (ctx.direct.code < 19000 || ctx.direct.code >= 20000 || ctx.indirect.code !== 0) return refuse(ctx, 0, 23);
  if (!inside(hero, NUM.talisman)) return refuse(ctx, 4, 386);
  const room = ctx.state.roomById(ctx.direct.code % 1000);
  if (!room) return refuse(ctx, 4, 387);
  if (hero.num !== NUM.hero) {
    teleport(ctx, hero, room); // autre personnage : `Inf := 6`, `Sal := lieu`, `19dc:0000(salle, héros, 1, 7)` directement
    return OK;
  }
  if (hero.ego !== 0 || hero.fig !== 0) {
    ctx.messages.say("V", 89);
    return OK;
  }
  const sameRoom = ctx.room === room;
  setRawU16(hero, 0x38, room.id); // destination mémorisée pour la procédure du héros (`HERO+0x38`)
  ctx.state.moveEnabled = true;
  if (ctx.die) die(ctx, hero, 18); // la séquence de mort (animation 18) déplace le héros en fin d'animation
  else teleport(ctx, hero, room); // hypothèse (objects.md §5) : sans séquence de mort fournie par le moteur, déplacement immédiat
  ctx.messages.say("V", sameRoom ? 86 : 87);
  return OK;
};

/** Téléportation directe : `Inf := 6` (placement libre), le héros rejoint la salle, qui sera chargée à l'image suivante. */
function teleport(ctx: HandlerContext, hero: GameObject, room: GameRoom): void {
  hero.info = 6;
  ctx.state.moveToRoom(hero, room);
  ctx.rooms.want(room);
}

/** `tehrehanan` (`3454:000c`) : baguette et bouteille d'hydromel donnent la potion nauséeuse. */
const tehrehanan: ObjectHandler = (ctx) => {
  const hero = ctx.hero;
  if (!hero) return 0;
  if (!inside(hero, NUM.wand)) return refuse(ctx, 3, 353);
  const bottle = inside(hero, NUM.bottle);
  if (!bottle) return refuse(ctx, 3, 379);
  if (bottle.ego === 0) {
    setState(ctx, bottle, { ego: 1 });
    ctx.messages.say("V", 380);
    award(ctx, 3, 12);
    return OK;
  }
  ctx.messages.enqueue(3, "V", bottle.ego === 3 ? 382 : 381);
  return 0;
};

/** `ezhrimanoth` (`346c:0008`) : baguette et fiole de sang de dragon donnent l'élixir d'invisibilité. */
const ezhrimanoth: ObjectHandler = (ctx) => {
  const hero = ctx.hero;
  if (!hero) return 0;
  if (!inside(hero, NUM.wand)) return refuse(ctx, 3, 353);
  const fiole = inside(hero, NUM.vial);
  if (!fiole) return refuse(ctx, 3, 351);
  if (fiole.ego !== 0) {
    ctx.messages.enqueue(3, "V", 352);
    return 0;
  }
  setState(ctx, fiole, { ego: 1 });
  ctx.messages.say("V", 350);
  award(ctx, 3, 11);
  return OK;
};

/** `sillerynn` (`345e:0004`) : le talisman change le seau en couronne inestimable, rangée dans l'inventaire. */
const sillerynn: ObjectHandler = (ctx) => {
  const hero = ctx.hero;
  if (!hero) return 0;
  if (!inside(hero, NUM.talisman)) return refuse(ctx, 3, 384);
  // hypothèse (objects.md §5) : le seau est cherché dans l'inventaire puis dans la salle du héros
  const bucket = inside(hero, NUM.bucket) ?? roomOf(hero)?.listA.find((o) => o.num === NUM.bucket);
  if (!bucket) {
    ctx.messages.enqueue(3, "V", ctx.state.findByNum(NUM.crown) ? 356 : 357);
    return 0;
  }
  const crown = replaceObject(ctx, bucket, NUM.crown, { ego: 0, fig: 0 });
  crown.value = 5000; // hypothèse (characters.md §9.4) : l'argument `0x1388` du constructeur est la valeur
  ctx.state.moveToContainer(crown, hero);
  award(ctx, 3, 13);
  ctx.messages.say("V", 355);
  return OK;
};

// --- enregistrement ------------------------------------------------------------------------------------------------------

/** Clés des 13 gestionnaires d'indirect (19 clés ; la clé 0 est le défaut `10c8:0134` du registre). */
export const INDIRECT_KEYS = {
  pie: [3],
  bear: [4],
  casket: [9],
  fire: [18],
  chest: [21, 110, 319],
  prytwen: [101],
  wardrobe: [113],
  dwarf: [201, 202, 203, 204, 301],
  niche: [211],
  sarhul: [302],
  minas: [303],
  crystal: [315],
  toad: [327],
} as const;

/** Mots magiques (classe 13) : clé = numéro du nom. */
export const MAGIC_WORDS = { armaeth: 1, tinhuel: 2, erin: 3, tehrehanan: 4, ezhrimanoth: 5, sillerynn: 6 } as const;

/** Enregistre les 13 gestionnaires de la famille 5 (19 clés) et les 6 mots magiques de la famille 6. */
export function registerMagic(registry: HandlerRegistry): void {
  const f5 = (keys: readonly number[], handler: ObjectHandler) => registry.register(FAMILY.indirect, keys, handler);
  f5(INDIRECT_KEYS.pie, magpieIndirect);
  f5(INDIRECT_KEYS.bear, bearIndirect);
  f5(INDIRECT_KEYS.casket, casketIndirect);
  f5(INDIRECT_KEYS.fire, fireIndirect);
  f5(INDIRECT_KEYS.chest, chestIndirect);
  f5(INDIRECT_KEYS.prytwen, prytwenIndirect);
  f5(INDIRECT_KEYS.wardrobe, wardrobeIndirect);
  f5(INDIRECT_KEYS.dwarf, dwarfIndirect);
  f5(INDIRECT_KEYS.niche, nicheIndirect);
  f5(INDIRECT_KEYS.sarhul, sarhulIndirect);
  f5(INDIRECT_KEYS.minas, minasIndirect);
  f5(INDIRECT_KEYS.crystal, crystalIndirect);
  f5(INDIRECT_KEYS.toad, toadIndirect);

  registry.register(FAMILY.name, MAGIC_WORDS.armaeth, (ctx) => portcullisWord(ctx, false));
  registry.register(FAMILY.name, MAGIC_WORDS.tinhuel, (ctx) => portcullisWord(ctx, true));
  registry.register(FAMILY.name, MAGIC_WORDS.erin, erin);
  registry.register(FAMILY.name, MAGIC_WORDS.tehrehanan, tehrehanan);
  registry.register(FAMILY.name, MAGIC_WORDS.ezhrimanoth, ezhrimanoth);
  registry.register(FAMILY.name, MAGIC_WORDS.sillerynn, sillerynn);
}
