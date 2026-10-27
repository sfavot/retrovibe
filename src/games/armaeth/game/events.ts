import { EventOp } from "../engine/events";
import { type EventHandler, type HandlerRegistry, FAMILY } from "../engine/handlers";
import { type GameObject, setRawU16 } from "../engine/state";
import { award, die, sayHere, setState } from "./helpers";

/**
 * Événements différés (famille 8, `docs/armaeth/objects.md` § 8, `characters.md` § 9.2 et § 11) : 8 procédures, clés 103, 104,
 * 1001, 1002, 1003, 2000 et 2001 (la grille, la dalle, la lave, l'invisibilité, le geyser, les introductions de niveau et le fond
 * des joyaux). Le gestionnaire reçoit l'entrée échue (`entry.event` est l'événement) et l'objet porteur s'il existe encore.
 *
 * Les procédures des personnages (famille 8, clés 1 héros, 4 ours, 101 Prytwen, 201 nains, 303 Minas Thyl, 327 crapaud) ont deux
 * auteurs ; il n'en reste qu'une, comparée au décompilat (`archives/armaeth/re/decomp/`) :
 * - 1 : `hero.ts` (`createHeroEvents`, `2683:017a`), qui teste comme l'original `+0x5b == 1` et la salle `0x130` ;
 * - 4 : `npc-events.ts` (`26da:0800`) : la carcasse est créée en `P - 1` et le contenu de l'ours reste dans la salle ;
 * - 101 : `npc-prytwen.ts` (`28b1:11e0`) : l'événement 14 est un duel animé (positions recopiées, `P + 1`, animation à deux) et non
 *   un vol, `28b1:1140` n'étant pas appelée par cette fonction ;
 * - 201, 303, 327 : `npc-events.ts` et `npc-minas.ts`, équivalents à `2a44:12fc`, `2dd9:1440` et `2d52:07fe`.
 */

/** Salle de la lave et des fumerolles (`0x130`). */
const LAVA_ROOM = 304;
/** `Sol` de la lave (`0x34`). */
const LAVA_GROUND = 0x34;

// --- 2000 : introductions de niveau --------------------------------------------------------------------------------------

/** Messages `S` de chaque niveau (`DGROUP:0704..`, `characters.md` § 11) : niveau 0 `S13` `S14`, niveau 1 `S101`..`S105`, etc. */
export const LEVEL_INTRO_MESSAGES: readonly (readonly number[])[] = [
  [13, 14],
  [101, 102, 103, 104, 105],
  [201, 202, 203, 204],
  [301, 302, 303, 304],
];

/** `21cc:008e` : l'événement `100 + niveau` affiche les messages du niveau, l'un après l'autre. */
const levelIntro: EventHandler = (ctx, entry) => {
  for (const number of LEVEL_INTRO_MESSAGES[entry.event - 100] ?? []) ctx.messages.say("S", number);
};

// --- 103 : grille du cachot ----------------------------------------------------------------------------------------------

/** `2846:0398` (ouverture) : la grille coulisse (`Ego 1`), son `B101`..`B102`, `Bag := 9`. */
function openGrate(ctx: Parameters<EventHandler>[0], grate: GameObject): void {
  setState(ctx, grate, { gst: 7, mob: 1, ego: 1 });
  setRawU16(grate, 0x36, 9);
  ctx.sound.effect("B", 102, 0);
}

/** `2846:042c` : 15 ouvre la grille ; 16 (grille refermée) et 17 (grille ouverte, armés par `2846:000a`) rendent la main au joueur. */
const grateEvent: EventHandler = (ctx, entry, grate) => {
  if (!grate) return;
  switch (entry.event) {
    case 15:
      openGrate(ctx, grate);
      break;
    case 16:
      // `2846:046e` : le message, puis la suite commune avec 17 (`2846:047f`)
      sayHere(ctx, grate, "G", 112);
      ctx.state.moveEnabled = true;
      ctx.enterScene();
      break;
    case 17: {
      // `2846:047f..04be` : le joueur reprend la main, `147f:0352`, puis, si le héros est devant la grille (P plus grand), points `(1, 5)`
      ctx.state.moveEnabled = true;
      ctx.enterScene();
      const hero = ctx.hero;
      if (hero && hero.p > grate.p) award(ctx, 1, 5);
      break;
    }
  }
};

// --- 104 : dalle du passage secret ---------------------------------------------------------------------------------------

/** `27ed:01e0` (événement 18) : la dalle se met en mouvement (`Ego 1` si elle était fermée, sinon `Ego 2`), `Tim := 22`. */
const slabEvent: EventHandler = (ctx, entry, slab) => {
  if (entry.event !== 18 || !slab) return;
  setState(ctx, slab, { gst: 7, mob: 1, ego: slab.ego === 0 ? 1 : 2 });
  slab.tim = 22;
};

// --- 1001 à 1003 : lave, invisibilité, geyser -------------------------------------------------------------------------------

/** `2c9c:00ee` : fin de la protection contre la lave ; le héros encore sur la lave y sombre. */
const lavaProtectionEnd: EventHandler = (ctx) => {
  const hero = ctx.hero;
  if (!hero) return;
  sayHere(ctx, hero, "V", 360);
  if (hero.ground === LAVA_GROUND) die(ctx, hero, 33, { cls: "V", number: 361 });
};

/** `2b9d:0102` : fin de l'invisibilité (`219b:006c(héros, 0)`). */
const invisibilityEnd: EventHandler = (ctx) => {
  const hero = ctx.hero;
  if (!hero) return;
  hero.hidden = 0;
  sayHere(ctx, hero, "V", 362);
};

/** Cadence du geyser (événement 13, 5 tics). */
const GEYSER_TICKS = 5;

/** `33ef:0192` : en salle 304, redessin et réarmement (cadence du geyser). */
const geyserTick: EventHandler = (ctx, entry) => {
  if (ctx.room?.id !== LAVA_ROOM) return;
  ctx.events.operate({ typ: entry.typ, num: entry.num, serial: entry.serial }, entry.event, EventOp.Set, GEYSER_TICKS, entry.procedure);
};

/**
 * `1611:0256` : fond rebondissant des joyaux (`sl1`..`sl3`, événements 200 et 201). Aucun script `CM1`..`CM4` n'appelle ces jetons :
 * l'événement n'est jamais armé en jeu normal (`interface.md` § 5), il n'y a rien à porter.
 */
const bouncingBackground: EventHandler = () => undefined;

// --- enregistrement ------------------------------------------------------------------------------------------------------

/** Clés de la famille 8 (7). */
export const EVENT_KEYS = [103, 104, 1001, 1002, 1003, 2000, 2001] as const;

/** Enregistre les 7 procédures d'événements différés propres aux objets et au système. */
export function registerEvents(registry: HandlerRegistry): void {
  const f8 = (key: number, handler: EventHandler) => registry.register(FAMILY.event, key, handler);
  f8(103, grateEvent);
  f8(104, slabEvent);
  f8(1001, lavaProtectionEnd);
  f8(1002, invisibilityEnd);
  f8(1003, geyserTick);
  f8(2000, levelIntro);
  f8(2001, bouncingBackground);
}

