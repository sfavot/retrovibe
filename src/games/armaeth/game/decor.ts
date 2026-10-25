import { sequenceFinished } from "../engine/animation";
import { type BehaviorHandler, type HandlerRegistry, FAMILY } from "../engine/handlers";
import { UPDATE_OK } from "../engine/update";
import { type GameObject, rawU8, setRawU8 } from "../engine/state";
import { die, near, roomOf, setState } from "./helpers";

/**
 * Procédures `Fct` des décors animés (famille 3, `docs/armaeth/objects.md` § 6.1), relues dans `archives/armaeth/re/decomp/` et
 * `disasm.txt` : 8 procédures pour 9 clés (101 et 102 partagent `341b:0008`). L'octet `+0x2c` (« Set ») marque l'initialisation.
 * Le rafraîchissement du dessin (`1833:01fc`) passe par `ctx.refreshObject` et l'arrêt d'un effet sonore par `ctx.sound.stopEffect`.
 */

const SET = 0x2c;
/** Garde-fou des relances aléatoires (les boucles de l'original s'arrêtent presque sûrement). */
const MAX_REROLLS = 16;

const initialised = (obj: GameObject): boolean => rawU8(obj, SET) !== 0;
const markInitialised = (obj: GameObject, value = 7): void => setRawU8(obj, SET, value);

/** Piste d'effet `B` : numéro, priorité. */
const playEffect = (ctx: Parameters<BehaviorHandler>[1], number: number, priority: number): void => void ctx.sound.effect("B", number, priority);

// --- 3 : jour et nuit ----------------------------------------------------------------------------------------------------

/** `343c:000e` : image 0 le jour, 1 la nuit (pièce sombre) ; piste `B2` le jour, arrêtée la nuit. */
const dayNight: BehaviorHandler = (obj, ctx) => {
  if (!initialised(obj)) {
    obj.fig = 7;
    markInitialised(obj);
  }
  const night = ctx.state.darkRoom ? 1 : 0;
  if (obj.fig !== night) setState(ctx, obj, { ego: 0, fig: night });
  if (night) ctx.sound.stopEffect("B", 2);
  else playEffect(ctx, 2, 0);
  return UPDATE_OK;
};

// --- 5 : oiseau au hasard ------------------------------------------------------------------------------------------------

/** `3426:000a` : quatre images possibles, cinq variantes de jour ; un quart des exemplaires disparaît à la création. */
const randomBird: BehaviorHandler = (obj, ctx) => {
  const dark = ctx.state.darkRoom;
  const rng = ctx.rng;
  let first = !initialised(obj);
  if (first) {
    markInitialised(obj);
    if (rng.mod(4) === 0) {
      ctx.state.deleteObject(obj);
      return UPDATE_OK;
    }
    obj.ego = rng.mod(4);
    obj.speedX = rng.mod(2) === 0 ? -1 : 1;
  }
  for (let i = 0; i < MAX_REROLLS; i++) {
    if (!first) {
      // suite normale : décompte de la minuterie
      if (!dark) {
        obj.tim = (obj.tim - 1) & 0xffff;
        if (obj.tim !== 0) break;
      } else if (obj.fig % 5 === 0) break;
    }
    first = false;
    if (rawU8(obj, 0x41) !== 0) ctx.sound.stopEffect("B", rawU8(obj, 0x42));
    let fig = obj.ego * 5;
    if (!dark) {
      fig += rng.mod(5);
      if (rng.mod(10) === 0) {
        setRawU8(obj, 0x41, 0x42);
        setRawU8(obj, 0x42, obj.ego + 3);
        playEffect(ctx, obj.ego + 3, 0);
      } else {
        setRawU8(obj, 0x42, 0);
        setRawU8(obj, 0x41, 0);
      }
    }
    obj.fig = fig;
    ctx.refreshObject(obj);
    obj.tim = (rng.mod(5) + 1) * obj.anim.total;
    if (dark) break;
  }
  return UPDATE_OK;
};

// --- 101, 102 : clignotement ---------------------------------------------------------------------------------------------

const BLINK_CHANCE = 4;
const BLINK_TICKS = 100;

/** `341b:0008` : une chance sur 4 d'être dans l'image 1 pendant 100 tics ; sinon l'image 0 se joue jusqu'au bout puis on retire. */
const blink: BehaviorHandler = (obj, ctx) => {
  let first = !initialised(obj);
  if (first) {
    markInitialised(obj);
    obj.speedY = 1;
  }
  for (let i = 0; i < MAX_REROLLS; i++) {
    if (!first) {
      if (obj.fig !== 0) {
        obj.tim = (obj.tim - 1) & 0xffff;
        if (obj.tim !== 0) break;
      } else if (!sequenceFinished(obj, roomOf(obj) === ctx.state.loadedRoom)) break;
    }
    first = false;
    obj.fig = ctx.rng.mod(BLINK_CHANCE) === 0 ? 1 : 0;
    ctx.refreshObject(obj);
    obj.tim = BLINK_TICKS;
  }
  return UPDATE_OK;
};

// --- 104 : image au hasard -----------------------------------------------------------------------------------------------

/** `340f:000a` : image 0 à 5 au hasard, minuterie de 30 à 59 tics (la longueur de l'animation pour l'image 0). */
const randomImage: BehaviorHandler = (obj, ctx) => {
  let first = !initialised(obj);
  if (first) {
    markInitialised(obj);
    obj.speedY = 1;
  }
  for (let i = 0; i < MAX_REROLLS; i++) {
    if (!first) {
      obj.tim = (obj.tim - 1) & 0xffff;
      if (obj.tim !== 0) break;
    }
    first = false;
    obj.fig = ctx.rng.mod(6);
    ctx.refreshObject(obj);
    obj.tim = obj.fig === 0 ? obj.anim.total : ctx.rng.mod(30) + 30;
  }
  return UPDATE_OK;
};

// --- 105 : bruitage à l'image 5 ------------------------------------------------------------------------------------------

/** `340b:0006` : piste `B104` (priorité 2) à l'image 5 de l'animation, arrêtée après l'image 20. */
const soundAtFrame: BehaviorHandler = (obj, ctx) => {
  const index = obj.anim.index;
  if (index === 5) ctx.sound.effect("B", 104, 2);
  else if (index > 0x14) ctx.sound.stopEffect("B", 104);
  return UPDATE_OK;
};

// --- 301, 302 : état au hasard -------------------------------------------------------------------------------------------

/** `3416:000c` / `3421:000e` : à l'échéance (`Tim` 0) `Ego 0` et `Fig` au hasard (modulo 4 pour 301, 5 pour 302), nouvelle minuterie < 60. */
const randomState =
  (figures: number): BehaviorHandler =>
  (obj, ctx) => {
    const old = obj.tim;
    obj.tim = (obj.tim - 1) & 0xffff;
    if (old === 0) {
      setState(ctx, obj, { ego: 0, fig: ctx.rng.mod(figures) });
      obj.tim = ctx.rng.mod(60);
      obj.speedY = 1;
    }
    return UPDATE_OK;
  };

// --- 304 : geyser --------------------------------------------------------------------------------------------------------

/** Portée de la brûlure : 24 px en X, 10 en profondeur. */
const GEYSER_REACH_X = 0x18;
const GEYSER_REACH_P = 0x0a;

/**
 * `33ef:0004` : `Ego 0` repos (minuterie < 200), `Ego 1` jaillit (lumière 4 à 12), `Ego 2` retombe ; le héros à moins de 24 px et
 * 10 de profondeur au sommet du jet est tué (`die(héros, 32, V376)`).
 * hypothèse (objects.md §6.1) : `gm_chance_one_in(2)` pour le sens de la vitesse `X`.
 */
const geyser: BehaviorHandler = (obj, ctx) => {
  const rng = ctx.rng;
  let first = !initialised(obj);
  if (first) {
    obj.mob = 1;
    markInitialised(obj);
  }
  const reroll = (): void => {
    const state = rng.mod(2);
    obj.ego = state;
    obj.fig = state;
    ctx.refreshObject(obj);
    if (state === 0) obj.tim = rng.mod(200);
    obj.speedX = rng.mod(2) === 0 ? 1 : -1;
  };
  if (first) reroll();
  for (let i = 0; i < MAX_REROLLS; i++) {
    first = false;
    if (obj.ego === 0) {
      obj.light = 0;
      const old = obj.tim;
      obj.tim = (obj.tim - 1) & 0xffff;
      if (old !== 0) return UPDATE_OK;
      reroll();
      continue;
    }
    const index = obj.anim.index;
    if (obj.ego === 1) obj.light = index < 8 ? 4 : index + 2;
    else if (obj.ego === 2) obj.light = index < 2 ? 0x10 : (0x0b - index) * 2;
    else return UPDATE_OK;
    if (!sequenceFinished(obj, roomOf(obj) === ctx.state.loadedRoom)) return UPDATE_OK;
    if (obj.ego === 1) {
      const hero = ctx.hero;
      if (hero && hero.num === 1 && hero.ego === 0 && near(hero, obj, GEYSER_REACH_X, -1, GEYSER_REACH_P)) die(ctx, hero, 32, { cls: "V", number: 376 });
      setState(ctx, obj, { ego: 2, fig: 2 });
      return UPDATE_OK;
    }
    reroll();
  }
  return UPDATE_OK;
};

// --- enregistrement ------------------------------------------------------------------------------------------------------

/** Clés de la famille 3 (9) : `Num` de décor. */
export const DECOR_KEYS = [3, 5, 101, 102, 104, 105, 301, 302, 304] as const;

/** Enregistre les 8 procédures de décor (9 clés). */
export function registerDecor(registry: HandlerRegistry): void {
  const f3 = (keys: number | number[], handler: BehaviorHandler) => registry.register(FAMILY.decor, keys, handler);
  f3(3, dayNight);
  f3(5, randomBird);
  f3([101, 102], blink);
  f3(104, randomImage);
  f3(105, soundAtFrame);
  f3(301, randomState(4));
  f3(302, randomState(5));
  f3(304, geyser);
}
