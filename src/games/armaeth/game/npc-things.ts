import { sequenceFinished } from "../engine/animation";
import { type BehaviorContext, type BehaviorHandler, FAMILY, type HandlerRegistry } from "../engine/handlers";
import { type GameObject, RAW_OFFSET, type WorldState } from "../engine/state";
import { flag, NUM, OFF, ROOM, setFlag, setWord, word } from "./helpers";
import { type NpcKit, RESTART, UPDATE_OK } from "./npc-kit";

/**
 * Objets animés sans intelligence (`docs/armaeth/characters.md` § 8.4 à § 8.6, § 10, `objects.md` § 4) : dépouille, torche,
 * stèle, feu, ronces, éclaboussure, dalle, grille du cachot, herses, grille ouvragée, acteur du couronnement.
 */

/** Octet de l'en-tête du monde (adresse `DGROUP`) : `4b46` est l'octet 0 de l'en-tête (`headerWords`). */
const HEADER_BASE = 0x4b46;

function setHeaderByte(state: WorldState, address: number, value: number): void {
  const offset = address - HEADER_BASE;
  const word = offset >> 1;
  const shift = (offset & 1) * 8;
  state.headerWords[word] = (state.headerWords[word]! & ~(0xff << shift) & 0xffff) | ((value & 0xff) << shift);
}

/** Drapeaux « passage du niveau découvert » de l'en-tête (`4b68` stèle, `4b69` dalle, `4b6a` herse, `4b6b` couronnement). */
const SECRET_FLAG = { stele: 0x4b68, slab: 0x4b69, portcullis: 0x4b6a, crowned: 0x4b6b } as const;
/** `4b67` : partie terminée. */
const GAME_OVER = 0x4b67;

/** `1793:0006(0)` : annule les trajets de la salle (la salle change d'aspect, les chemins calculés ne valent plus). */
function cancelRoomPaths(kit: NpcKit, ctx: BehaviorContext): void {
  const room = ctx.room;
  if (!room) return;
  for (const o of room.listA) {
    if (o.path.defined) ctx.motion.reset(o);
    void kit;
  }
}

// --- torche, feu, ronces, éclaboussure ---------------------------------------------------------------------------------

/** `Tim` de la torche par niveau (`DGROUP:525C`). */
const TORCH_TIME = [12000, 18000, 24000, 36000] as const;

/** Lumière d'un foyer : `(((Tim / 10) / (T / 1000)) << 4) / 100` (entiers 16 bits comme le C d'origine). */
function burnLight(tim: number, total: number): number {
  const ratio = Math.floor(Math.floor(tim / 10) / Math.floor(total / 1000));
  return Math.floor(((ratio << 4) & 0xffff) / 100);
}

/** `2420:000e` (`Num 12`) : la torche allumée (`Ego` 0..3) se consume ; éteinte (4..8) elle n'est plus mise à jour. */
export function torch(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    if (obj.ego >= 4) {
      obj.gst = 0;
      return UPDATE_OK;
    }
    obj.speedY = 1;
    const rep = word(obj, OFF.rep) + 1;
    setWord(obj, OFF.rep, rep);
    if (rep < 100) return UPDATE_OK;
    setWord(obj, OFF.rep, 0);
    let tim = obj.tim < 100 ? 0 : obj.tim - 100;
    let level = obj.ego;
    if (tim === 0) {
      // message `V1`..`V4` si la torche est dans l'inventaire du héros
      if (ctx.hero && obj.holder === ctx.hero) ctx.messages.say("V", level + 1);
      if (level === 0) {
        kit.destroy(ctx, obj);
        return RESTART;
      }
      level -= 1;
      kit.setEgo(ctx, obj, level);
      tim = TORCH_TIME[level]!;
    }
    obj.tim = tim;
    const light = burnLight(tim, TORCH_TIME[level]!) + level * 16;
    if (light !== obj.light) obj.light = light;
    return UPDATE_OK;
  };
}

/** Durées du feu par niveau (`DGROUP:5264`, tics). */
export const FIRE_TIME = [0, 24000, 18000, 12000, 12000, 6000, 6000] as const;

/** `264c:0002` (`Num 18`) : le feu brûle 100 tics par palier de `Tim`, puis perd un niveau ; au niveau 0 il est mort. */
export function fire(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    if (flag(obj, OFF.init) === 0) {
      setFlag(obj, OFF.init, 7);
      obj.tim = FIRE_TIME[obj.ego] ?? 0;
      setWord(obj, OFF.rep, 0);
    }
    obj.speedY = 1;
    if (obj.ego === 0) {
      obj.gst = 0;
      return UPDATE_OK;
    }
    const rep = word(obj, OFF.rep) + 1;
    setWord(obj, OFF.rep, rep);
    if (rep < 100) return UPDATE_OK;
    setWord(obj, OFF.rep, 0);
    let tim = obj.tim <= 100 ? 0 : obj.tim - 100;
    let level = obj.ego;
    if (tim === 0) {
      level -= 1;
      if (level !== 0) tim = FIRE_TIME[level]!;
      kit.setEgo(ctx, obj, level);
    }
    obj.tim = tim;
    const light = level < 3 ? 0 : burnLight(tim, FIRE_TIME[level]!) + (level - 3) * 16;
    if (light !== obj.light) obj.light = light;
    return UPDATE_OK;
  };
}

/** `257b:000a` (`Num 20`) : fin de l'arrachage (animation 7) : ronces détruites, stèle à `Ego 5`, points `(0, 5)`. */
export function brambles(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    if (kit.pollAnimation(ctx, obj) === 0) return UPDATE_OK;
    kit.destroy(ctx, obj);
    const stele = ctx.state.findByNum(NUM.stele);
    if (stele) stele.ego = 5;
    ctx.score.award(0, 5);
    return RESTART;
  };
}

/** `2588:0006` (`Num 23`) : l'éclaboussure vit 7 tics (`V25` dans la salle du héros), puis disparaît. */
export function splash(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    if (flag(obj, OFF.init) === 0) {
      obj.tim = 7;
      obj.speedY = 1;
      setFlag(obj, OFF.init, 7);
    }
    const before = obj.tim;
    obj.tim = Math.max(0, before - 1);
    if (before === 0) {
      kit.sayHere(ctx, obj, "V", 25);
      kit.destroy(ctx, obj);
      return RESTART;
    }
    return UPDATE_OK;
  };
}

// --- mécanismes de salle ------------------------------------------------------------------------------------------------------

/**
 * Fin commune d'un mouvement de passage (§ 10.2) : l'objet prend son état d'arrivée et s'arrête (`Gst 0`, `Mob 0`), les trajets
 * de la salle sont annulés, le joueur reprend la main si la procédure l'avait suspendu, le drapeau de passage est posé.
 */
function finishPassage(kit: NpcKit, ctx: BehaviorContext, obj: GameObject, ego: number, flag: number, award: readonly [number, number]): void {
  ctx.score.award(award[0], award[1]);
  kit.setState(ctx, obj, { gst: 0, mob: 0, ego, fig: 0 });
  ctx.rooms.refreshPlanes(); // `147f:000a` : plans actifs de la salle (stèle, dalle)
  // lacune (characters.md § 10.2) : `147f:0352` (lumière, introduction de niveau), messages `S` de découverte et script `CM3`
  // (hors de portée de `BehaviorContext`, inactifs avec le niveau de `CFG`).
  cancelRoomPaths(kit, ctx);
  setHeaderByte(ctx.state, flag, 7);
}

/** `2500:0008` (`Num 16`) : la stèle coulisse en X de 0x36 (fermée) à 0x62 (ouverte), un pas par tic. */
export function stele(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    const roomId = ctx.room?.id;
    if (roomId === ROOM_STELE_OUTSIDE) ctx.state.moveEnabled = false;
    let ego = obj.ego;
    if (ego === 2) {
      obj.x += 1;
      if (obj.x < 0x62) return UPDATE_OK;
      ego = 4;
    } else if (ego === 3) {
      obj.x -= 1;
      if (obj.x > 0x36) return UPDATE_OK;
      ego = 0;
    }
    ctx.state.moveEnabled = true;
    finishPassage(kit, ctx, obj, ego, SECRET_FLAG.stele, [0, 3]);
    return UPDATE_OK;
  };
}
/** Salle 5 (l'extérieur, côté de la stèle) : le joueur perd la main pendant le coulissement (`2500:0008`). */
const ROOM_STELE_OUTSIDE = 5;

/** Générateur de la dalle et de la herse de granite : même ossature, axe Y, `Tim` tics (posé par le verbe ou l'événement). */
function verticalSlider(kit: NpcKit, flag: number, award: readonly [number, number], placeMode = 0xff): BehaviorHandler {
  return (obj, ctx) => {
    let ego = obj.ego;
    if (ego === 0 || ego === 3) {
      obj.gst = 0;
      obj.mob = 0;
      setHeaderByte(ctx.state, flag, 7);
      return UPDATE_OK;
    }
    if (ego === 1) {
      obj.y -= 1;
      ego = 3;
    } else {
      obj.y += 1;
      ego = 0;
    }
    obj.tim = Math.max(0, obj.tim - 1);
    if (obj.tim !== 0) return UPDATE_OK;
    ctx.score.award(award[0], award[1]);
    // dalle : `1a37:003a` (mode déduit de la présence) ; herse : `1a37:007f(2, 1, 0, 0)` (mode 2, aucune recherche de position : la
    // herse relevée reste en haut au lieu d'être reposée sur le sol)
    kit.setState(ctx, obj, placeMode === 2 ? { ego, fig: 0, dep: 1, txt: 0 } : { ego, fig: 0 }, placeMode);
    ctx.rooms.refreshPlanes(); // `147f:000a`
    cancelRoomPaths(kit, ctx);
    // lacune (characters.md § 10.2) : `147f:0352`, messages `S` et script `CM3` (voir `finishPassage`).
    setHeaderByte(ctx.state, flag, 7);
    return UPDATE_OK;
  };
}

/** `27ed:000a` (`Num 104`) : la dalle sous le trône s'enfonce / se relève de 1 en Y par tic pendant `Tim` tics. */
export const slab = (kit: NpcKit): BehaviorHandler => verticalSlider(kit, SECRET_FLAG.slab, [1, 6]);

/** `29fd:0000` (`Num 207`) : la herse de granite des salles 202 et 305 (même mouvement, `Tim = 0x22`). */
export const portcullis = (kit: NpcKit): BehaviorHandler => verticalSlider(kit, SECRET_FLAG.portcullis, [2, 2], 2);

/** Pas (unités d'X) et durée de la grille du cachot : 9 images, 2 pixels par image (`2846:000a`). */
const GRILLE_STEPS = 9;

/** `2846:000a` (`Num 103`) : la grille du cachot coulisse de 2 px par tic pendant `Nbr` (9) tics, `Fig` suit la progression. */
export function grille(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    // `Ego` 1 (s'ouvre) -> 3, 2 (se ferme) -> 0 ; 0 et 3 : immobile, arrivée directe
    const ego = obj.ego;
    const target = ego === 1 ? 3 : ego === 2 ? 0 : ego;
    if (ego === 1 || ego === 2) {
      const nbr = ((word(obj, RAW_OFFSET.nbr) << 16) >> 16) - 1;
      setWord(obj, RAW_OFFSET.nbr, nbr);
      if (nbr >= 0) {
        obj.x += target === 0 ? 2 : -2;
        kit.setState(ctx, obj, { dep: 0, txt: 0, fig: target === 0 ? nbr : GRILLE_STEPS - 1 - nbr }, 2);
        return UPDATE_OK;
      }
    }
    kit.setState(ctx, obj, { gst: 0, mob: 0, dep: 1, txt: 0, ego: target, fig: target !== 0 ? 8 : 0 }, 2);
    cancelRoomPaths(kit, ctx);
    return RESTART;
  };
}

/** `2c1e:0008` (`Num 316`) : la grille ouvragée de la salle 309 coulisse de 1 en X entre 0x68 et 0x88. */
export function ornateGrille(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    let ego = obj.ego;
    if (ego === 1) {
      obj.x += 1;
      if (obj.x < 0x88) return UPDATE_OK;
      ego = 3;
    } else if (ego === 2) {
      obj.x -= 1;
      if (obj.x > 0x68) return UPDATE_OK;
      ego = 0;
    }
    kit.setState(ctx, obj, { gst: 0, mob: 0, ego, fig: 0 }, 2);
    cancelRoomPaths(kit, ctx);
    if (ego === 3 && obj.room !== null && obj.room === ctx.room) {
      // points `(3, 8)` seulement si aucun Sarhûl n'est resté du mauvais côté (types de case 57 et 113)
      for (const o of obj.room.listA) {
        if (o.num === NUM.sarhul && o.ground !== 57 && o.ground !== 113) return RESTART;
      }
      ctx.score.award(3, 8);
    }
    return RESTART;
  };
}

/** `2c4d:000c` (`Num 317`) : la herse de pierre double coulisse d'un pixel par tic pendant 16 tics (compteur `Mc1`). */
export function doubleGrille(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    const step = obj.fig === 0 ? -1 : 1;
    let ego = obj.ego;
    if (ego === 1 || ego === 2) {
      obj.x += ego === 1 ? step : -step;
      const count = flag(obj, OFF.counter) + 1;
      setFlag(obj, OFF.counter, count);
      if (count < 0x10) return UPDATE_OK;
      ego = ego === 1 ? 3 : 0;
    }
    setFlag(obj, OFF.counter, 0);
    cancelRoomPaths(kit, ctx);
    // hypothèse (characters.md § 10.2) : l'état d'arrivée est posé ici (`Ego` 1 -> 3, 2 -> 0) et l'objet s'arrête
    kit.setState(ctx, obj, { gst: 0, mob: 0, ego, fig: obj.fig }, 2);
    return UPDATE_OK;
  };
}

// --- couronnement ---------------------------------------------------------------------------------------------------------------

/**
 * `2caf:000e` (`Num 333`) : l'acteur du couronnement remplace le héros (§ 10.1). `Ego 0` attend la fin de l'animation puis rejoint
 * la salle du trône ; 1 s'y place ; 2 à 6 : séquence d'animations et marche vers le trône ; 7 : fin de partie.
 * hypothèse (characters.md § 10.1) : les arguments cachés (`Fig`, `Txt`, identifiants d'animation) de chaque étape ne sont pas
 * relevés ; seuls l'enchaînement, les messages `G371` / `G372`, les points `(3, 7)` et la fin de partie le sont.
 */
export function king(kit: NpcKit): BehaviorHandler {
  return (obj, ctx) => {
    const active = kit.inLoadedRoom(ctx, obj);
    const finished = () => sequenceFinished(obj, active);
    run: for (let guard = 0; guard < 8; guard++) {
      switch (obj.ego) {
        case 0: {
          if (kit.pollAnimation(ctx, obj) === 0) break run;
          obj.ego = 1;
          const throne = ctx.state.roomById(ROOM.throne);
          if (throne && obj.room !== throne) {
            // `Inf = 6`, salle de destination : la boucle principale recharge et replace le héros
            obj.info = 6;
            ctx.rooms.want(throne);
            return UPDATE_OK;
          }
          continue;
        }
        case 1:
          // placement fixe devant le trône (X 0xA0, Y 0x8C, P 0x6C, plan 1, Sol 2) puis animation
          obj.presence = 2;
          obj.x = 0xa0;
          obj.y = 0x8c;
          obj.p = 0x6c;
          obj.plane = 1;
          obj.ground = 2;
          kit.startAnimation(ctx, obj, { id: 2, gst: 7, mob: 1, ego: 2 });
          break run;
        case 2:
          if (kit.pollAnimation(ctx, obj) === 0) break run;
          kit.setState(ctx, obj, { gst: 7, mob: 1, ego: 3, fig: 0 }, 2);
          obj.speedY = 1;
          continue;
        case 3:
          if (!finished()) break run;
          kit.sayHere(ctx, obj, "G", 371);
          kit.setState(ctx, obj, { gst: 7, mob: 1, ego: 4, txt: 2, fig: 1 }, 2);
          obj.speedX = 0;
          obj.speedY = 0;
          obj.speedP = -1;
          break run;
        case 4:
          if (obj.p >= 0x11) {
            obj.speedP = -1;
            break run;
          }
          kit.setState(ctx, obj, { ego: 5, txt: 2, fig: 1 }, 2);
          obj.speedY = 1;
          continue;
        case 5:
          if (!finished()) break run;
          kit.setState(ctx, obj, { ego: 6, txt: 2, fig: 2 }, 2);
          obj.speedY = 1;
          continue;
        case 6:
          if (!finished()) break run;
          kit.sayHere(ctx, obj, "G", 372);
          ctx.score.award(3, 7);
          setHeaderByte(ctx.state, GAME_OVER, 7);
          setHeaderByte(ctx.state, SECRET_FLAG.crowned, 7);
          // lacune (characters.md § 10.3) : verdict `14cf:000c` et message `S55` (écran de fin, hors de portée de `BehaviorContext`)
          kit.setState(ctx, obj, { ego: 7, txt: 2, fig: 3 }, 2);
          ctx.state.setHero(null);
          obj.gst = 0;
          return RESTART;
        default:
          break run;
      }
    }
    obj.err = 0;
    return UPDATE_OK;
  };
}

export function registerThings(registry: HandlerRegistry, kit: NpcKit): void {
  registry.register(FAMILY.character, NUM.torch, torch(kit));
  registry.register(FAMILY.character, NUM.stele, stele(kit));
  registry.register(FAMILY.character, NUM.fire, fire(kit));
  registry.register(FAMILY.character, NUM.brambles, brambles(kit));
  registry.register(FAMILY.character, NUM.splash, splash(kit));
  registry.register(FAMILY.character, NUM.slab, slab(kit));
  registry.register(FAMILY.character, NUM.grille, grille(kit));
  registry.register(FAMILY.character, NUM.portcullis, portcullis(kit));
  registry.register(FAMILY.character, NUM.ornateGrille, ornateGrille(kit));
  registry.register(FAMILY.character, NUM.doubleGrille, doubleGrille(kit));
  registry.register(FAMILY.character, NUM.king, king(kit));
}

