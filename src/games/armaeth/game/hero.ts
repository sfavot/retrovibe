import type { AniTable } from "../data/tables";
import {
  type SpriteSource,
  loadObjectSprite,
  setFig,
  startScriptedAnimation,
  tickScriptedAnimation,
} from "../engine/animation";
import { EventOp, type EventTarget } from "../engine/events";
import { type BehaviorContext, type BehaviorHandler, type EventHandler, FAMILY, type HandlerRegistry } from "../engine/handlers";
import { FOLLOW_WALKING } from "../engine/paths";
import { SEARCH_FREE } from "../engine/placement";
import { type GameObject, type GameRoom, type WorldState, rawU16, rawU8, setRawU16, setRawU8 } from "../engine/state";
import { EngineAbort, UPDATE_OK } from "../engine/update";
import { GRATE, startGrate } from "./objects";

/**
 * Le héros d'*Armaeth* (`Num 1`, `Fct` `246c:000a`) : répartiteur `Err` puis `Ego` 0..8, réactions au type de sol, chutes,
 * animations scénarisées de mort et de sort, dépouille, résurrection (`docs/armaeth/characters.md` § 3 à § 6, `screens.md` E13).
 * Module de jeu : il ne touche au moteur que par `BehaviorContext` (plus les services optionnels de `HeroServices`).
 */

// --- constantes ---------------------------------------------------------------------------------------------------------

export const HERO_NUM = 1;

/** États `Ego` du héros (`characters.md` § 4.2). */
export const EGO = { walk: 0, swim: 1, climb: 2, slide: 3, fall: 4, ko: 5, animation: 6, brambles: 7, carry: 8 } as const;

/** `Err` lus par le héros (`characters.md` § 3.1). */
const ERR = {
  contact: 8,
  exit: 0x0b,
  vanished: 0x0e,
  barrier: 0x0f,
  placed: 0x11,
  arrived: 0x13,
  notLocated: 0x0c,
  impossible: 0x14,
  outside: 0x15,
  conflict: 0x16,
  searchFailed: 0x17,
} as const;

/** Offsets de l'enregistrement sans champ nommé. */
const RAW = { inv: 0x27, fire: 0x28, landing: 0x38, destination: 0x66, yc: 0x72, flag43: 0x43 } as const;

/** Salle de l'asphyxie (événement 2). */
const GAS_ROOM = 304;
/** Chute : durée (tics) à partir de laquelle l'atterrissage est mortel (`characters.md` § 4.2.5). */
const LETHAL_FALL = 15;
const KO_TICKS = 100;
const WATER_FALL_LETHAL = 20;
/** Types de sol d'eau où l'on atterrit sans dommage immédiat. */
const WATER_LANDING = new Set([4, 5, 6, 47]);
/** Animations qui remettent `Inv` à 0 (`characters.md` § 6.2). */
const VISIBLE_ANIMATIONS = new Set([3, 4, 17, 18, 19, 33, 34, 42]);

const sgn = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Services optionnels : à défaut, lus sur le contexte (`ctx.sprites`, `ctx.ani`) s'il les expose un jour. */
export interface HeroServices {
  sprites?: SpriteSource;
  ani?: AniTable;
  /** Limites `4aca` (X max) et `4ad6` (P max) de la salle chargée, pour placer le héros ressuscité. */
  limits?: () => { xMax: number; pMax: number } | null;
  /** Nombre de plans actifs (`4ae0`), pour le sol 51 (barreaux mouillés). */
  planes?: () => number;
  /** Fin d'un trajet du héros joueur (`2363:01ea`, `r` = `FOLLOW_*`) : vrai quand la marche reprend (trajet recalculé). */
  onPathEnd?: (hero: GameObject, result: number, ctx: BehaviorContext) => boolean | void;
}

type HeroContext = BehaviorContext & Partial<Pick<HeroServices, "sprites" | "ani">>;

const NO_SPRITES: SpriteSource = { get: () => undefined };

interface H {
  obj: GameObject;
  ctx: HeroContext;
  svc: HeroServices;
  sprites: SpriteSource;
  ani: AniTable | undefined;
}

function makeH(obj: GameObject, ctx: BehaviorContext, svc: HeroServices): H {
  const c = ctx as HeroContext;
  return { obj, ctx: c, svc, sprites: svc.sprites ?? c.sprites ?? NO_SPRITES, ani: svc.ani ?? c.ani };
}

const targetOf = (o: GameObject): EventTarget => ({ typ: o.typ, num: o.num, serial: o.serial });

/** `209c:0092` : message affiché si le héros est dans une salle. */
function say(h: H, cls: string, n: number): void {
  if (h.obj.room) h.ctx.messages.say(cls, n);
}

function fatal(h: H, code: number): never {
  h.ctx.messages.say("E", 11);
  throw new EngineAbort(code, `Héros non localisable (Err 0x${h.obj.err.toString(16)})`);
}

// --- primitives d'état (1a37, 2273, 2683) ----------------------------------------------------------------------------------

/** `1aba:000e` : replace l'objet ; un échec n'est pas laissé dans `Err` (hypothèse : l'original s'arrêterait sur `E11`). */
function replace(h: H, flag: number): number {
  const o = h.obj;
  const mode = flag === 0xff ? (o.typ === 0 ? 6 : o.presence === 0 ? 0 : o.presence === 8 ? 8 : 5) : flag;
  const r = h.ctx.motion.place(o, mode);
  if (r !== 0 && r !== ERR.placed) o.err = 0;
  return r;
}

/** `1a37:007f` : écrit `Gst`, `Mob`, `Dep`, `Ego`, `Fig` (`Txt` conservé) puis replace. */
function setState(h: H, s: { mob: number; ego: number; dep: number; fig: number; flag?: number }): void {
  const o = h.obj;
  o.gst = 7;
  o.mob = s.mob;
  o.dep = s.dep;
  o.ego = s.ego;
  setFig(o, h.sprites, s.fig);
  replace(h, s.flag ?? 0xff);
}

/** `1a37:0002` : change `Ego` et `Fig` seulement. */
function setEgoFig(h: H, ego: number, fig: number): void {
  h.obj.ego = ego;
  setFig(h.obj, h.sprites, fig);
  replace(h, 0xff);
}

/** `2273:0190` : vitesses à zéro. */
function halt(o: GameObject): void {
  o.speedX = 0;
  o.speedY = 0;
  o.speedP = 0;
}

/** `2683:023e` : prélude d'entrée d'état. `2f9b:0375` (arrêt de l'effet sonore) n'a pas de service : hypothèse, omis. */
function prelude(h: H): void {
  const o = h.obj;
  if (o.animId !== 0) {
    o.animId = 0;
    loadObjectSprite(o, h.sprites);
  }
  o.speedY = 0;
  o.animId = 0;
  h.ctx.state.moveEnabled = true;
}

/** Somme récursive du poids du contenu (`20ac:0008`, sans l'objet lui-même). */
export function loadOf(o: GameObject): number {
  let sum = 0;
  for (const c of o.contents) sum += c.weight + loadOf(c);
  return sum;
}

function carries(o: GameObject, num: number): boolean {
  return o.contents.some((c) => c.num === num || carries(c, num));
}

// --- fin de tic, trajets, sorties ------------------------------------------------------------------------------------------

/** `186d:000c` : "transit" = fin du tic ; "again" = relire `Err` ; "continue" = suite. */
function takeExit(h: H): "transit" | "again" | "continue" {
  const from = h.obj.room;
  const r = h.ctx.rooms.exit(h.obj);
  if (r === "transit") {
    noteClimbedEntry(h.ctx.state, h.obj.ego === EGO.climb && from ? { room: h.ctx.state.wantedRoom, from } : null);
    return "transit";
  }
  if (r === "blocked") return "again";
  h.obj.err = 0; // hypothèse : « none » / « moved » ne bloquent pas le héros
  return "continue";
}

/** Fin de trajet du héros joueur (`2363:01ea`) : arrêt, `Err = 0x11`. Le rejeu d'une commande en attente est délégué. */
function pathEnded(h: H, result: number): number {
  const o = h.obj;
  if (h.svc.onPathEnd?.(o, result, h.ctx) === true) return UPDATE_OK; // trajet recalculé : la marche continue
  h.ctx.motion.reset(o);
  halt(o);
  o.err = ERR.placed;
  return UPDATE_OK;
}

/** `246c:08f4` : suivi du trajet ou `Err = 0`, puis `Ver = 0`. */
function endTick(h: H): number {
  const o = h.obj;
  if (!o.path.defined) o.err = 0;
  else {
    const r = h.ctx.motion.followPath(o);
    if (r !== FOLLOW_WALKING && h.ctx.hero === o) return pathEnded(h, r);
  }
  o.speedY = 0;
  return UPDATE_OK;
}

// --- animations scénarisées (2594:0004) ----------------------------------------------------------------------------------

/** Animations démarrées sans table `ANI` (repli) : terminées au tic suivant. */
const pendingWithoutTable = new WeakMap<GameObject, number>();

export interface AnimationRequest {
  /** Classe et numéro du message affiché au départ (`209c:0092`). */
  message?: [string, number];
  /** Partenaire (`Bag`). */
  partner?: GameObject | null;
}

/**
 * `2594:0004` avec `AX != 0` : démarre l'animation `id` sur le héros (`Gst 7`, `Mob 1`, `Ego 6`, `Ver 1`, `Hor = -1` pour l'id 6),
 * le joueur perd la main. Exportée pour les verbes, la magie et les PNJ.
 */
export function startHeroAnimation(hero: GameObject, ctx: BehaviorContext, id: number, request: AnimationRequest = {}, services: HeroServices = {}): number {
  return startAnimation(makeH(hero, ctx, services), id, request);
}

function startAnimation(h: H, id: number, request: AnimationRequest = {}): number {
  const o = h.obj;
  if (VISIBLE_ANIMATIONS.has(id)) {
    if (id === 19) setRawU8(o, RAW.inv, o.hidden);
    o.hidden = 0;
  }
  h.ctx.motion.reset(o);
  if (h.ani) {
    const events = startScriptedAnimation(o, h.sprites, h.ani, {
      id,
      gst: 7,
      mob: 1,
      ego: EGO.animation,
      hor: id === 6 ? -1 : 0,
      ver: 1,
      prf: 0,
      partner: request.partner ?? null,
      audible: o.room !== null && o.room === h.ctx.room,
    });
    for (const e of events) if (e.type === "sound") h.ctx.sound.play(e.id, e.soundClass, e.number, e.loop);
  } else {
    o.animId = id;
    o.gst = 7;
    o.mob = 1;
    o.ego = EGO.animation;
    o.speedY = 1;
    pendingWithoutTable.set(o, id);
  }
  replace(h, 0xff);
  if (request.message) say(h, request.message[0], request.message[1]);
  h.ctx.state.moveEnabled = false;
  return UPDATE_OK;
}

function tickAnimation(h: H): number {
  const o = h.obj;
  if (!h.ani) {
    const id = pendingWithoutTable.get(o) ?? 0;
    pendingWithoutTable.delete(o);
    if (id !== 0) o.animId = 0;
    return id;
  }
  const r = tickScriptedAnimation(o, h.sprites, h.ani, o.room !== null && o.room === h.ctx.room);
  return r.finished;
}

// --- mort ----------------------------------------------------------------------------------------------------------------------

/** Jingle `E4` (`gm_sound_play(0x0E, 'E', 4, ...)`) à chaque mort. */
function jingle(h: H): void {
  h.ctx.sound.play(0x0e, "E", 4, false);
}

/** Pose un objet porté dans la salle, à la place du héros (`19dc:04f1`, hypothèse sur la position). */
function dropInRoom(h: H, child: GameObject, room: GameRoom, from: GameObject): void {
  h.ctx.state.moveToRoom(child, room);
  child.x = from.x;
  child.y = from.y;
  child.p = from.p;
  child.plane = from.plane;
  child.ground = from.ground;
  child.presence = 2;
  h.ctx.motion.place(child, 5);
  child.err = 0;
}

/** `19a6:01a5` : détruit le héros ; contenu laissé dans la salle ou détruit. Rend 0 (la liste est à reparcourir). */
function destroyHero(h: H, leaveContents: boolean): number {
  const o = h.obj;
  const room = o.room;
  if (leaveContents && room) for (const c of [...o.contents]) dropInRoom(h, c, room, o);
  h.ctx.state.deleteObject(o);
  return 0;
}

/** Jingle, message puis destruction (`characters.md` § 6.2). */
function die(h: H, message: number, leaveContents: boolean): number {
  jingle(h);
  say(h, "G", message);
  return destroyHero(h, leaveContents);
}

/** Durées de la dépouille par variante (`DGROUP:523E`, tics). */
const CORPSE_TICKS: readonly (readonly number[])[] = [
  [1600, 1600, 2000, 2000, 2000],
  [1600, 1600, 2000, 2000, 2000],
  [100, 100, 100, 100, 100],
];

/**
 * `2405:0000` : le héros est remplacé par une dépouille (`Num 2`) qui reçoit son contenu. Variantes : 0 frelons / chute,
 * 1 boulet de lave / étranglement / nains, 2 chaudron de Minas Thyl.
 */
export function createCorpse(hero: GameObject, ctx: BehaviorContext, variant: 0 | 1 | 2, message?: number, services: HeroServices = {}): GameObject | null {
  const h = makeH(hero, ctx, services);
  jingle(h);
  if (message !== undefined) say(h, "G", message);
  return replaceByCorpse(h, variant);
}

function replaceByCorpse(h: H, variant: number): GameObject | null {
  const o = h.obj;
  const state = h.ctx.state;
  const room = o.room;
  if (!room) {
    destroyHero(h, false);
    return null;
  }
  const corpse = state.createObject({ typ: 2, num: 2, gst: 7, mob: 1, ego: variant, fig: 5 * variant, weight: 500, capacity: 800, canContain: 7 });
  state.moveToRoom(corpse, room);
  corpse.presence = o.presence;
  corpse.plane = o.plane;
  corpse.x = o.x;
  corpse.y = o.y;
  corpse.p = o.p;
  corpse.ground = o.ground;
  corpse.speedX = o.speedX;
  corpse.speedY = o.speedY;
  corpse.speedP = o.speedP;
  for (const c of [...o.contents]) state.moveToContainer(c, corpse);
  corpse.tim = CORPSE_TICKS[variant]?.[0] ?? 1600;
  loadObjectSprite(corpse, h.sprites);
  state.deleteObject(o);
  return corpse;
}

/** `2405:0106` : la dépouille se décompose en 5 étapes puis disparaît en déposant son contenu dans la salle. */
export const corpseBehavior: BehaviorHandler = (corpse, ctx) => {
  corpse.tim = (corpse.tim - 1) & 0xffff;
  if (corpse.tim !== 0) return UPDATE_OK;
  const step = corpse.fig + 1;
  const variant = corpse.ego;
  if (step % 5 === 0) {
    const room = corpse.room;
    if (variant === 2) {
      const cauldron = room?.listA.find((o) => o.num === 306) ?? ctx.state.findByNum(306); // hypothèse : « frère » = même salle
      if (cauldron) cauldron.ego = 0;
    }
    const h = makeH(corpse, ctx, {});
    if (room) for (const c of [...corpse.contents]) dropInRoom(h, c, room, corpse);
    ctx.state.deleteObject(corpse);
    return 0;
  }
  corpse.tim = CORPSE_TICKS[variant]?.[step % 5] ?? 1600;
  setFig(corpse, NO_SPRITES, step); // le moteur recharge l'image au prochain pas d'animation
  corpse.fig = step;
  return UPDATE_OK;
};

/** Enregistre la dépouille (table 2, clé 2) : à part, car d'autres modules de personnages peuvent aussi la fournir. */
export function registerCorpse(registry: HandlerRegistry): void {
  registry.register(FAMILY.character, 2, corpseBehavior);
}

// --- conséquences de la fin d'une animation (table 2594:0276) ---------------------------------------------------------------

export type AnimationOutcome =
  | { kind: "die"; message: number; keep: boolean }
  | { kind: "corpse"; variant: 0 | 1; message: number }
  | { kind: "immolation"; message: number }
  | { kind: "walk"; message?: number }
  | { kind: "teleport" }
  | { kind: "waterLanding" };

/**
 * Les animations du héros qui ont une conséquence (`characters.md` § 6.2, table de sauts `2594:0276` indexée par `id - 2`, 42 mots).
 * Tout autre id (1, 7 à 11, 13 à 16, 20 à 31, 34, 36 à 38, 40, 42 et au-delà de 43) pointe sur `2594:025c` : `gm_abort(0x42)`.
 */
export const HERO_ANIMATIONS: Readonly<Record<number, AnimationOutcome>> = {
  2: { kind: "die", message: 23, keep: false },
  3: { kind: "immolation", message: 22 },
  4: { kind: "die", message: 25, keep: true },
  5: { kind: "corpse", variant: 0, message: 24 },
  6: { kind: "walk", message: 20 },
  12: { kind: "walk", message: 108 },
  17: { kind: "walk" },
  18: { kind: "teleport" },
  19: { kind: "waterLanding" },
  32: { kind: "corpse", variant: 1, message: 40 },
  33: { kind: "die", message: 41, keep: false },
  35: { kind: "corpse", variant: 1, message: 42 },
  39: { kind: "die", message: 43, keep: true },
  41: { kind: "die", message: 338, keep: true },
  43: { kind: "corpse", variant: 0, message: 16 },
};

function finishAnimation(h: H, id: number): number {
  const o = h.obj;
  h.ctx.state.moveEnabled = true;
  const outcome = HERO_ANIMATIONS[id];
  // `2594:025c` : `gm_abort(0x42)` (arrêt du jeu, « * Err 066 * » sous DOS) ; `4b50 = 7` (`moveEnabled`) est posé avant l'aiguillage
  if (!outcome) throw new EngineAbort(0x42, `Fin de l'animation ${id} du héros sans conséquence (table 2594:0276)`);
  switch (outcome.kind) {
    case "die":
      return die(h, outcome.message, outcome.keep);
    case "corpse":
      jingle(h);
      say(h, "G", outcome.message);
      replaceByCorpse(h, outcome.variant);
      return 0;
    case "immolation": {
      const fire = rawU16(o, RAW.fire) !== 0 ? h.ctx.state.findBySerial(rawU16(o, RAW.fire)) : undefined;
      if (fire) {
        // hypothèse : `264c:02b0` (niveau 6 forcé) porté ici en champs, durée 6000 tics (characters.md § 8.4)
        fire.ego = 6;
        fire.tim = 6000;
        setFig(fire, h.sprites, 6);
        setRawU16(fire, 0x34, 1000);
      }
      return die(h, outcome.message, false);
    }
    case "waterLanding":
      o.hidden = rawU8(o, RAW.inv);
      if (rawU16(o, RAW.landing) > WATER_FALL_LETHAL) return die(h, 35, false);
      return enterWalk(h, ["G", 34]);
    case "teleport": {
      const dest = rawU16(o, RAW.landing);
      startAnimation(h, 17);
      o.info = 6;
      setRawU16(o, RAW.destination, dest);
      const room = h.ctx.state.roomById(dest);
      if (room && room === h.ctx.room) h.ctx.motion.place(o, 9);
      else if (room) h.ctx.rooms.want(room);
      return UPDATE_OK;
    }
    case "walk":
      if (id === 6) {
        halt(o);
        o.txt = 0;
      }
      return enterWalk(h, outcome.message ? ["G", outcome.message] : undefined);
  }
}

// --- états ------------------------------------------------------------------------------------------------------------------

/** `246c:0240` avec `AL != 0` : entrée dans la marche (`Ego 0`). */
function enterWalk(h: H, message?: [string, number]): number {
  prelude(h);
  setState(h, { mob: 2, ego: EGO.walk, dep: 0, fig: 0 });
  if (message) say(h, message[0], message[1]);
  h.obj.err = ERR.placed;
  return UPDATE_OK;
}

/** `25ea:03ca` avec `AL != 0` : chute libre (`Ego 4`, `Dep 3`). */
function enterFall(h: H, fig: number, message?: number | [string, number]): number {
  const o = h.obj;
  prelude(h);
  o.speedY = 1;
  h.ctx.state.moveEnabled = false;
  setState(h, { mob: 2, ego: EGO.fall, dep: 3, fig, flag: 2 });
  o.x += o.stepX * sgn(o.speedX);
  o.p += o.stepP * sgn(o.speedP);
  o.y += 4;
  o.ground = 0;
  // `25ea:03ca` : recherche de la position valide la plus proche (bornes P 8, Y 10 vers le bas, signe de `Prf`), puis sans bornes ;
  // sans elle le héros, qui chevauche encore une case de sol au bord du vide, ne descendrait jamais (`Err 2` à chaque tic)
  const sideP = sgn(o.speedP);
  const near = { ...SEARCH_FREE, tolP: 8, signP: sideP, tolY: 10, signY: 1 };
  const placed = (r: number) => r === 0 || r === 0x11;
  if (!placed(h.ctx.motion.search(o, near)) && !placed(h.ctx.motion.search(o, { ...SEARCH_FREE, signP: sideP, signY: 1 }))) return enterKO(h);
  o.tim = 0;
  o.err = 0;
  if (message !== undefined) typeof message === "number" ? say(h, "G", message) : say(h, message[0], message[1]);
  return UPDATE_OK;
}

/** `26ab:0134` avec `AL != 0` : KO de 100 tics. */
function enterKO(h: H): number {
  const o = h.obj;
  prelude(h);
  o.speedY = 1;
  h.ctx.state.moveEnabled = false;
  setState(h, { mob: 1, ego: EGO.ko, dep: 0, fig: 10 });
  o.tim = KO_TICKS;
  o.stepP = 0;
  return UPDATE_OK;
}

/** `26ab:000a` avec `AL != 0` : glissade (`Fig` 8 pente, 9 glissade). */
function enterSlide(h: H, fig: number, message: number): number {
  const o = h.obj;
  prelude(h);
  h.ctx.state.moveEnabled = false;
  setState(h, { mob: 2, ego: EGO.slide, dep: 0, fig });
  setRawU16(o, RAW.yc, o.y);
  say(h, "G", message);
  o.err = 0;
  return UPDATE_OK;
}

/** Entrée de l'escalade selon `Sol` (`characters.md` § 4.2.2) : direction verticale, `Fig`, `Dep`. */
function climbEntry(sol: number): { v: number; fig: number; dep: number } | null {
  const group = [7, 23, 40].findIndex((base) => sol >= base && sol <= base + 3);
  if (group < 0) return null;
  const k = sol - [7, 23, 40][group]!;
  return { v: [-1, 1, 0][group]!, fig: 4 + k, dep: k < 2 ? 4 : 2 };
}

function enterClimb(h: H): number {
  const o = h.obj;
  const entry = climbEntry(o.ground);
  if (!entry) return enterWalk(h);
  prelude(h);
  halt(o);
  setState(h, { mob: 2, ego: EGO.climb, dep: entry.dep, fig: entry.fig, flag: 2 });
  o.speedY = entry.v; // hypothèse : la direction verticale de la table est la valeur de `Ver`
  // `25ea:0008` : puis placement sur les zones (le héros est en `Dep 2` ou `4`) : bornes P 8 et Y `Hau / 2` dans le sens de la table
  // (sauf cases 40 à 43, sens 0), sinon placement libre. C'est lui qui pose le héros sur la corde ou l'échelle (zone) depuis la
  // margelle d'un puits ; sans lui `Dep 4` ne trouve aucune zone sous les pieds et le héros « perd prise » aussitôt.
  const placed = (r: number) => r === 0 || r === ERR.placed;
  let r = -1;
  if (entry.v !== 0) r = h.ctx.motion.search(o, { ...SEARCH_FREE, tolP: 8, tolY: o.height >> 1, signY: entry.v });
  if (entry.v === 0 || !placed(r)) h.ctx.motion.search(o, SEARCH_FREE);
  return UPDATE_OK;
}

// --- tics des états ---------------------------------------------------------------------------------------------------------

/** Suite commune `0370` : sans `Ver` non nul, pas de réaction au sol. */
function gated(h: H): number {
  return h.obj.speedY === 0 ? endTick(h) : react(h);
}

function walkTick(h: H): number {
  const o = h.obj;
  for (let guard = 0; guard < 4; guard++) {
    switch (o.err) {
      case 3:
      case 5:
        if (!o.path.defined) return enterFall(h, 8, o.ego === 0 ? 6 : 12);
        return gated(h);
      case 7:
      case 0x0c:
      case 0x0d:
      case 0x0e:
      case 0x10:
        if (!o.path.defined) {
          halt(o);
          o.err = 0;
          return UPDATE_OK;
        }
        return gated(h);
      case ERR.exit: {
        const r = takeExit(h);
        if (r === "transit") return UPDATE_OK;
        if (r === "again") continue;
        return gated(h);
      }
      case ERR.barrier:
        o.speedX = -o.speedX;
        o.speedP = -o.speedP;
        o.err = 0;
        o.speedY = 0;
        return UPDATE_OK;
      case ERR.placed:
        return react(h);
      default:
        return gated(h);
    }
  }
  return gated(h);
}

/** Ordinaire : retour à la marche si `Fig != 0`, puis fin de tic. */
function ordinary(h: H): number {
  if (h.obj.fig !== 0 || h.obj.ego !== EGO.walk) setEgoFig(h, EGO.walk, 0);
  return endTick(h);
}

/** Feu vivant ou mort à portée du héros (`22b7:0000`, hypothèse : même `P` à 9 près et recouvrement horizontal). */
function nearbyFire(o: GameObject): GameObject | undefined {
  return o.room?.listA.find((f) => f.num === 18 && Math.abs(f.p - o.p) < 9 && Math.abs(f.x - o.x) <= ((f.width + o.width) >> 1) + 4);
}

/** Table `Sol` -> réaction (`246c:0240`, `characters.md` § 4.3). */
function react(h: H): number {
  const o = h.obj;
  const ctx = h.ctx;
  if (o.room !== ctx.room) return endTick(h);
  const sol = o.ground;
  const free = !o.path.defined;
  switch (sol) {
    case 0:
      return free ? enterFall(h, 8, o.ego === 0 ? 6 : 12) : endTick(h);
    case 3:
      if (o.fig !== 1 || o.ego !== EGO.walk) setEgoFig(h, EGO.walk, 1);
      return endTick(h);
    case 4:
      if (o.fig !== 2 || o.ego !== EGO.walk) setEgoFig(h, EGO.walk, 2);
      ctx.events.operate(targetOf(o), 9, EventOp.Remove);
      ctx.events.operate(targetOf(o), 10, EventOp.Remove);
      return endTick(h);
    case 5: {
      if (o.fig !== 3 || o.ego !== EGO.swim) setEgoFig(h, EGO.swim, 3);
      const chg = o.capacity;
      const load = loadOf(o);
      if (chg >= 10 && load < chg) {
        const m = Math.trunc(((chg - load) * 10) / Math.trunc(chg / 10));
        if (m > 10) {
          ctx.events.operate(targetOf(o), 10, EventOp.Set, 9 * m, 1);
          o.tim = m;
          return endTick(h);
        }
      }
      return startAnimation(h, 2, { message: ["G", 7] });
    }
    case 6:
      return startAnimation(h, 2, { message: ["G", 10] });
    case 47:
      return startAnimation(h, 2, { message: ["G", 31] });
    case 7:
    case 8:
    case 9:
    case 10:
    case 23:
    case 24:
    case 25:
    case 26:
    case 40:
    case 41:
    case 42:
    case 43:
      if (o.speedY === 0 || !free) return endTick(h);
      return enterClimb(h);
    case 27:
    case 28:
    case 29:
    case 30: {
      const hit = sol === 27 ? o.speedX === 1 : sol === 28 ? o.speedX === -1 : sol === 29 ? o.speedP === 1 : o.speedP === -1;
      return hit ? enterSlide(h, 8, 1) : ordinary(h);
    }
    case 31:
    case 32:
    case 33:
    case 34: {
      const axisX = sol <= 32;
      const against = sol === 31 || sol === 33 ? -1 : 1;
      const current = axisX ? o.speedX : o.speedP;
      if (current !== against) return ordinary(h);
      if (axisX) o.speedX = -against;
      else o.speedP = -against;
      return enterSlide(h, 9, 2);
    }
    case 35: {
      if (!free) return endTick(h);
      const fire = nearbyFire(o);
      if (!fire) return endTick(h);
      ctx.messages.say("G", 3);
      ctx.messages.say("G", fire.ego === 0 ? 4 : 5);
      o.presence = fire.presence;
      o.plane = fire.plane;
      o.x = fire.x;
      o.y = fire.y;
      o.p = fire.p + 1;
      o.ground = fire.ground;
      setRawU16(o, RAW.fire, fire.serial);
      return startAnimation(h, 3);
    }
    case 37:
      return o.hidden !== 0 ? endTick(h) : startAnimation(h, 5, { message: ["G", 14] });
    case 45:
      if (ctx.rng.mod(20) !== 0) return endTick(h);
      o.speedP = 1;
      o.speedX = 0;
      o.p += 10;
      return enterFall(h, 9, 30);
    case 52: {
      const protection = ctx.events.operate(targetOf(o), 0, EventOp.Subtract, 0) ?? 0;
      return protection === 0 ? startAnimation(h, 33, { message: ["Z", 2] }) : ordinary(h);
    }
    case 53: {
      const bridge = ctx.state.findByNum(318);
      if (!bridge || loadOf(o) + o.weight <= bridge.capacity) return ordinary(h);
      bridge.ego = 1;
      setFig(bridge, h.sprites, 1);
      bridge.dep = 1;
      ctx.rooms.refreshPlanes(); // `4ae0` : la passerelle qui cède ne laisse qu'un plan (`147f:000a`, salle 312)
      // hypothèse : `1793:0006(0)` (trajets de la salle) relève du moteur
      return enterFall(h, 8, 353);
    }
    case 60:
      if (carries(o, 321)) {
        ctx.score.award(3, 3);
        return ordinary(h);
      }
      return startAnimation(h, 39, { message: ["G", 355] });
    case 63: {
      const plank = o.room?.listA.find((p) => p.num === 308);
      if (!plank || plank.ego === 0) return enterFall(h, 8, o.ego === 0 ? 6 : 12);
      const bridge = ctx.state.findByNum(318);
      if (!bridge || bridge.ego === 0) return ordinary(h);
      ctx.state.deleteObject(plank);
      return enterFall(h, 8, 354);
    }
    case 68:
      setRawU16(o, RAW.fire, 0);
      return startAnimation(h, 3, { message: ["G", 46] });
    default:
      return ordinary(h);
  }
}

/** `25ea:0008` : escalade, escalier. */
function climbTick(h: H): number {
  const o = h.obj;
  for (let guard = 0; guard < 4; guard++) {
    if (o.err === ERR.exit) {
      const r = takeExit(h);
      if (r === "transit") return UPDATE_OK;
      if (r === "again") continue;
    }
    break;
  }
  const sol = o.ground;
  switch (o.err) {
    case 3:
    case 5: {
      const d = (((sol - 11) % 4) + 4) % 4;
      if (d === 0) o.speedP = 1;
      else if (d === 1) o.speedP = -1;
      else if (d === 2) o.speedX = 1;
      else o.speedX = -1;
      return enterFall(h, 9, 11);
    }
    case ERR.barrier:
      o.speedX = -o.speedX;
      o.speedP = -o.speedP;
      break;
    case ERR.placed: {
      const v = o.speedY;
      const set = (fig: number, dep: number, x?: number): void => {
        if (x !== undefined) o.x = x;
        if (o.fig !== fig || o.dep !== dep) {
          halt(o);
          setState(h, { mob: 2, ego: EGO.climb, dep, fig, flag: 2 });
          o.speedY = v; // hypothèse : `Ver` conservé pour la fin d'échelle
        }
      };
      if ([11, 15, 19].includes(sol)) set(4, 4);
      else if ([12, 16, 20].includes(sol)) set(5, 4);
      else if ([13, 17, 21].includes(sol)) set(6, 2);
      else if ([14, 18, 22].includes(sol)) set(7, 2);
      else if (sol === 48) {
        o.speedP = 1;
        return enterFall(h, 9, 32);
      } else if (sol === 49) set(4, 4, 0x4f);
      else if (sol === 50) set(4, 4, 0x25);
      else if (sol === 59) set(4, 4, 0x40);
      else if (sol === 51) {
        if ((h.svc.planes?.() ?? h.ctx.rooms.planes()) <= 1) set(4, 4);
        else {
          o.speedP = 1;
          return enterFall(h, 9, 33);
        }
      } else return enterWalk(h); // hypothèse : l'original s'arrête (abort 0x56), on reprend la marche
      break;
    }
    default:
      break;
  }
  if (((sol >= 11 && sol <= 14) && o.speedY === 1) || ((sol >= 19 && sol <= 22) && o.speedY === -1)) return enterWalk(h);
  o.err = 0;
  return UPDATE_OK;
}

/** `26ab:000a` : glissade. */
function slideTick(h: H): number {
  const o = h.obj;
  for (let guard = 0; guard < 4; guard++) {
    switch (o.err) {
      case 3:
      case 5:
        return enterFall(h, o.fig);
      case ERR.exit: {
        const r = takeExit(h);
        if (r === "transit") return UPDATE_OK;
        if (r === "again") continue;
        return UPDATE_OK;
      }
      case 0:
      case 9:
      case 0x0a:
      case ERR.placed:
        if (o.y < rawU16(o, RAW.yc)) return enterKO(h);
        setRawU16(o, RAW.yc, o.y);
        o.err = 0;
        return UPDATE_OK;
      default:
        return enterKO(h);
    }
  }
  return UPDATE_OK;
}

/** `25ea:03ca` : chute libre et atterrissage. */
function fallTick(h: H): number {
  const o = h.obj;
  for (let guard = 0; guard < 4; guard++) {
    if (o.err === 7) return land(h);
    if (o.err === ERR.exit) {
      const r = takeExit(h);
      if (r === "transit") return UPDATE_OK;
      if (r === "again") continue;
    }
    break;
  }
  // hypothèse : 1..6 et 12..16 seraient fatals dans l'original (la chute ne doit rien heurter) ; on acquitte
  o.err = 0;
  return UPDATE_OK;
}

function land(h: H): number {
  const o = h.obj;
  const type = o.info;
  const d = o.tim;
  o.dep = 0;
  o.ground = type;
  h.ctx.motion.place(o, 4);
  o.err = 0;
  if (WATER_LANDING.has(type)) {
    setRawU16(o, RAW.landing, d);
    return startAnimation(h, 19);
  }
  if (d < LETHAL_FALL) return enterKO(h);
  return startAnimation(h, 43);
}

/** `26ab:0134` : KO. */
function koTick(h: H): number {
  const o = h.obj;
  o.tim = (o.tim - 1) & 0xffff;
  if (o.tim === 0) {
    halt(o);
    return enterWalk(h);
  }
  o.err = 0;
  return UPDATE_OK;
}

/** `2594:033a` : arrachage des ronces. */
function brambleTick(h: H): number {
  const o = h.obj;
  if (o.ground !== 39) return enterWalk(h);
  if (o.err !== 0) return enterWalk(h, ["G", 19]);
  o.txt = 2;
  const dx = 0x4c - o.x;
  const dp = 0x54 - o.p;
  if (dx * dx < 2 && dp === 0) {
    const brambles = h.ctx.state.findByNum(20);
    if (brambles && h.ani) {
      // hypothèse (characters.md § 4.2.7) : `Gst 7`, `Mob 1`, `Ego` conservé pour la ronce, animation 7 liée au héros
      startScriptedAnimation(brambles, h.sprites, h.ani, { id: 7, gst: 7, mob: 1, ego: brambles.ego, hor: 0, ver: 0, prf: 0, partner: o, audible: true });
    }
    return startAnimation(h, 6, { partner: brambles ?? null });
  }
  o.speedX = sgn(dx);
  o.speedP = sgn(dp);
  return UPDATE_OK;
}

/** `26ab:01fc` : le héros porte Prytwen assommé. */
function carryTick(h: H): number {
  const o = h.obj;
  if (o.fig !== 11) setEgoFig(h, EGO.carry, 11);
  for (let guard = 0; guard < 4; guard++) {
    if (o.err === ERR.exit) {
      const r = takeExit(h);
      if (r === "transit") return UPDATE_OK;
      if (r === "again") continue;
    }
    break;
  }
  if (o.err === ERR.barrier) {
    o.speedX = -o.speedX;
    o.speedP = -o.speedP;
    o.path.defined = false;
  }
  return endTick(h);
}

// --- répartiteur (246c:000a) ---------------------------------------------------------------------------------------------

/** Mort par disparition (`Err 0x0E`, `G18`). */
function vanish(h: H): number {
  return die(h, 18, false);
}

/** `25ea:03ca(héros, Fig, message)` : chute libre du héros (`Ego 4`, `Dep 3`) ; `message` : classe et numéro affichés à l'entrée. */
export function startHeroFall(hero: GameObject, ctx: BehaviorContext, fig: number, message?: [string, number], services: HeroServices = {}): number {
  return enterFall(makeH(hero, ctx, services), fig, message);
}

/** `26ab:01fc` / `246c:0240(héros, 7)` : le héros se met à porter un personnage assommé (`Ego 8`) ou reprend la marche (`Ego 0`). */
export function setHeroCarrying(hero: GameObject, ctx: BehaviorContext, carrying: boolean, services: HeroServices = {}): number {
  const h = makeH(hero, ctx, services);
  if (!carrying) return enterWalk(h);
  prelude(h);
  setEgoFig(h, EGO.carry, 11);
  return UPDATE_OK;
}

/** La procédure `Fct` du héros. */
export function createHeroBehavior(services: HeroServices = {}): BehaviorHandler {
  return (obj, ctx) => {
    const h = makeH(obj, ctx, services);
    switch (obj.err) {
      case ERR.notLocated:
        fatal(h, 0x3a);
        break;
      case ERR.vanished:
        return vanish(h);
      case ERR.arrived:
        halt(obj);
        h.ctx.motion.place(obj, 5);
        if (obj.room) ctx.rooms.want(obj.room);
        return UPDATE_OK;
      case ERR.impossible:
      case ERR.outside:
        fatal(h, 0x3f);
        break;
      case ERR.conflict:
        if (obj.ego !== EGO.fall) fatal(h, 0x3f);
        break;
      case ERR.searchFailed: {
        const r = ctx.motion.place(obj, 5);
        if (r !== 0 && r !== ERR.placed && obj.ego !== EGO.fall) fatal(h, 0x3f);
        break;
      }
      default:
        break;
    }
    switch (obj.ego) {
      case EGO.walk:
      case EGO.swim:
        return walkTick(h);
      case EGO.climb:
        return climbTick(h);
      case EGO.slide:
        return slideTick(h);
      case EGO.fall:
        return fallTick(h);
      case EGO.ko:
        return koTick(h);
      case EGO.animation: {
        const id = tickAnimation(h);
        if (id !== 0) return finishAnimation(h, id);
        if (obj.animId === 0) {
          // spectateur d'une animation à deux (duel d'un nain, Prytwen, Minas Thyl) : le héros reste pris (`Ego 6`) tant que le
          // partenaire (`Bag`, +0x3A) joue encore son animation ; c'est lui qui rend la marche (`246c:0240`, `AL = 7`) ou tue le héros
          // en fin de duel. Sans partenaire en animation, le héros reprend la marche.
          return h.ctx.state.findBySerial(rawU16(obj, 0x3a))?.animId ? UPDATE_OK : enterWalk(h);
        }
        return UPDATE_OK;
      }
      case EGO.brambles:
        return brambleTick(h);
      case EGO.carry:
        return carryTick(h);
      default:
        throw new EngineAbort(0x21, `Ego du héros invalide : ${obj.ego}`);
    }
  };
}

/** Événements différés du héros (famille 8, clé 1, `2683:017a`) : asphyxie (2), fatigue (10), noyade (11). */
export function createHeroEvents(services: HeroServices = {}): EventHandler {
  return (ctx, entry, target) => {
    if (!target) return;
    const h = makeH(target, ctx, services);
    switch (entry.event) {
      case 2:
        if (target.location === 1 && target.room?.id === GAS_ROOM && target.num === HERO_NUM && target.ego !== EGO.animation) startAnimation(h, 35, { message: ["G", 301] });
        break;
      case 10:
        if (target.fig === 3) {
          say(h, "G", 9);
          ctx.events.operate(targetOf(target), 11, EventOp.Set, target.tim, 1);
        }
        break;
      case 11:
        if (target.fig === 3) startAnimation(h, 2, { message: ["G", 8] });
        break;
      default:
        break;
    }
  };
}

/** Enregistre le héros (table 2 clé 1, événements clé 1) ; remplace le noyau minimal de `registerCoreBehaviors`. */
export function registerHero(registry: HandlerRegistry, services: HeroServices = {}): void {
  registry.register(FAMILY.character, HERO_NUM, createHeroBehavior(services));
  registry.register(FAMILY.event, 1, createHeroEvents(services));
}

// --- résurrection (F4, « continuer », icône 204 : 23ee:000a -> 2594:043a) -------------------------------------------------

export type ContinueResult = "gameOver" | "present" | "created";

/**
 * Dernière salle où le héros est entré en grimpant (`Ego 2`), et celle qu'il quittait. Écart au jeu original : le centre de la cime
 * de l'arbre (salle 10, où l'on ne fait que grimper) tombe sur un bout de branche d'où le héros recréé à pied tombe au premier pas ;
 * on le recrée donc dans la salle d'où il était monté. Non sauvegardé : après une restauration, la règle de l'original s'applique.
 */
const climbedEntries = new WeakMap<WorldState, { room: GameRoom; from: GameRoom }>();

function noteClimbedEntry(state: WorldState, entry: { room: GameRoom | null; from: GameRoom } | null): void {
  if (entry?.room) climbedEntries.set(state, { room: entry.room, from: entry.from });
  else climbedEntries.delete(state);
}

/**
 * Commande `continuer` : partie terminée -> `S49` ; héros présent -> `S46` (déjà dans la salle) ou `S47` (le jeu rejoint sa salle) ;
 * sinon le héros est recréé au centre de la fenêtre avec `S24` (`screens.md` E13), dans la salle chargée, ou dans celle d'où il était
 * monté s'il y était entré en grimpant (`climbedEntries`).
 */
export function continueGame(ctx: BehaviorContext, services: HeroServices = {}): ContinueResult {
  const state: WorldState = ctx.state;
  if (state.gameOver) {
    ctx.messages.say("S", 49);
    return "gameOver";
  }
  const existing = state.findByNum(HERO_NUM);
  if (existing) {
    state.setHero(existing);
    if (existing.room) ctx.rooms.want(existing.room);
    ctx.messages.say("S", existing.room === ctx.room ? 46 : 47); // hypothèse : S46/S47 choisis par la salle
    existing.err = 0;
    return "present";
  }
  if (!ctx.room) return "present";
  const climbed = climbedEntries.get(state);
  const room = climbed?.room === ctx.room ? climbed.from : ctx.room;
  climbedEntries.delete(state);
  // hypothèse : les limites de la salle chargée valent pour la salle d'en dessous (319 x 159 dans les deux salles de l'arbre)
  const limits = services.limits?.() ?? ctx.rooms.limits() ?? { xMax: 319, pMax: 159 }; // hypothèse : limites de la salle 1 si le moteur ne les fournit pas
  const hero = state.createObject({ typ: 2, num: HERO_NUM, gst: 7, mob: 2, dep: 0, txt: 0, weight: 800, capacity: 500, canContain: 7, ego: 0, fig: 0 });
  state.moveToRoom(hero, room);
  hero.x = Math.trunc(limits.xMax / 2);
  hero.p = Math.trunc(limits.pMax / 2);
  hero.presence = 1;
  loadObjectSprite(hero, services.sprites ?? (ctx as HeroContext).sprites ?? NO_SPRITES);
  state.setHero(hero);
  if (room !== ctx.room) ctx.rooms.want(room);
  state.moveEnabled = true; // hypothèse : `4b50` repasse à 7 (le héros peut être recréé après une mort animée)
  ctx.messages.say("S", 24);
  hero.err = 0;
  return "created";
}

// --- sols acceptés (13a8:000a) --------------------------------------------------------------------------------------------

/** Ce que la table connaît de l'objet qui se déplace. */
export interface GroundSubject {
  /** `Anm` (+0x30). */
  anm?: number;
  mob?: number;
  txt?: number;
  /** `Sol` actuel de l'objet. */
  ground?: number;
}

/** Ce que la table lit du monde. Les champs absents valent « inconnu » (porte supposée franchissable, objet absent). */
export interface GroundWorld {
  /** `Ego` du premier objet de ce `Num` (`undefined` = absent). */
  ego?: (num: number) => number | undefined;
  carries?: (num: number) => boolean;
  /** Protection contre la lave (compteur de l'événement 0). */
  protected?: () => boolean;
  /** Objet de ce `Num` dans la salle de l'objet. */
  inSameRoom?: (num: number) => boolean;
  /** Clef en main (porte `Ego 0`). */
  hasKey?: () => boolean;
  /** Messages (`Z1`, `Z301`) et points (`3, 4`) demandés avec `effect != 0`. */
  say?: (cls: string, n: number) => void;
  /** Case piège 38 franchie avec `effect != 0` : la grille de la geôle (`Num 103`) se referme (`2846:0398(grille, objet, 0, 7)`). */
  trap?: () => void;
  award?: (chapter: number, index: number) => void;
}

/**
 * `13a8:000a` : le type de sol `sol` est-il accepté par l'objet (`num`, `ego`) ? `effect != 0` demande les effets de bord
 * (messages, points). Types non listés : acceptés. `characters.md` § 5.
 * À brancher : `PlaceEnv.acceptsGround` / `MoverEnv.acceptsGround` / `FollowContext` (via `acceptsGroundFor`) au lieu de `type >= 2`.
 */
export function acceptsGround(num: number, ego: number, sol: number, subject: GroundSubject = {}, world: GroundWorld = {}, effect = 0): boolean {
  const anm = subject.anm ?? 0;
  const mob = subject.mob ?? 2;
  const txt = subject.txt ?? 0;
  const egoOf = (n: number) => world.ego?.(n);
  const door = (n: number): boolean => {
    // `20b5:0634` : porte franchissable
    const e = egoOf(n);
    if (txt === 2 || e === undefined || e >= 2) return true; // hypothèse : porte absente = franchissable
    return mob === 2 && (e !== 0 || (world.hasKey?.() ?? false));
  };
  const gate = (n: number, open: number): boolean => txt === 2 || egoOf(n) === undefined || egoOf(n) === open;
  switch (sol) {
    case 0:
    case 1:
      return false;
    case 3:
    case 4:
    case 5:
    case 6:
    case 47:
      return num === 23 || (num === 1 && (ego === 0 || ego === 1 || (ego === 6 && (anm === 2 || anm === 19))));
    case 35:
      return num === 18 || (num === 1 && ego !== 8);
    case 37:
      return num === 4 || (num === 1 && (ego === 0 || (ego === 6 && (anm === 4 || anm === 5))));
    case 38:
      // `13a8:00b2..00ec` : refusée aux nains ; sinon acceptée, et le passage réel referme la grille de la geôle
      if ((num >= 201 && num <= 204) || num === 301) return false;
      if (effect !== 0) world.trap?.();
      return true;
    case 39:
      return num === 1;
    case 52:
      if (num === 1) {
        if (ego === 6) return anm === 33;
        if (effect !== 0 && world.protected?.()) world.say?.("Z", 1);
        return true;
      }
      if (num === 303) return world.inSameRoom?.(313) ?? false;
      return world.protected?.() ?? false;
    case 60:
      if (num === 1) {
        if (ego === 0) {
          if (effect !== 0 && world.carries?.(321)) world.say?.("Z", 301);
          return true;
        }
        return ego === 6 && anm === 39;
      }
      return world.carries?.(321) ?? false;
    case 61:
      if (num === 1) return true;
      if (num === 303) return (subject.ground ?? 0) !== 0;
      if (num === 313) {
        if (effect !== 0) world.award?.(3, 4);
        return true;
      }
      return false;
    case 63:
      return num === 1 || (egoOf(308) ?? 0) !== 0;
    case 64:
      return mob === 0 || subject.ground === 64 || door(309);
    case 68:
      return num === 1 || num === 216 || num === 303 || num === 306;
    case 80:
      return (egoOf(16) === 4 || txt === 2) && (mob === 2 || num === 1);
    case 81:
      return (egoOf(104) === 3 || txt === 2) && (mob === 2 || num === 1);
    case 82:
      return num === 1 || mob === 0;
    case 83:
      return mob === 0;
    case 90:
      return door(111);
    case 91:
      return door(309);
    case 92:
      return door(329);
    case 110:
      return gate(103, 3);
    case 111:
      return gate(207, 3);
    case 112:
      return gate(316, 3);
    case 113:
      return gate(316, 0);
    case 114:
      return gate(317, 3);
    default:
      return true;
  }
}

/** Adaptateur prêt à brancher sur `acceptsGround(type, effect, body)` des environnements de placement et de déplacement. */
export function acceptsGroundFor(obj: GameObject, sol: number, effect: number, state: WorldState, ctx?: BehaviorContext): boolean {
  const world: GroundWorld = {
    ego: (n) => state.findByNum(n)?.ego,
    carries: (n) => carries(obj, n),
    protected: () => state.events.find(targetOf(obj), 0) !== undefined,
    inSameRoom: (n) => obj.room?.listA.some((o) => o.num === n) ?? false,
    hasKey: () => obj.contents.length > 0,
    say: (cls, n) => ctx?.messages.say(cls, n),
    award: (c, i) => void ctx?.score.award(c, i),
    trap: () => {
      // `2846:0398` : seule une grille ouverte (`Ego 3`) se referme ; `V118` si c'est le héros qui l'a déclenchée
      const bars = ctx ? state.findByNum(103) : undefined;
      if (ctx && bars?.ego === GRATE.open) startGrate(ctx, bars, false, obj === ctx.hero);
    },
  };
  return acceptsGround(obj.num, obj.ego, sol, { anm: obj.animId, mob: obj.mob, txt: obj.txt, ground: obj.ground }, world, effect);
}

