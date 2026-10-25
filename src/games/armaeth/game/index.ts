import type { ArmaethEngineOptions, EngineServices } from "../engine/engine";
import type { BehaviorContext, HandlerRegistry } from "../engine/handlers";
import type { GameObject } from "../engine/state";
import { registerDecor } from "./decor";
import { registerEvents } from "./events";
import { HERO_NUM, acceptsGroundFor, continueGame, registerHero, startHeroAnimation } from "./hero";
import { sayHere } from "./helpers";
import { registerMagic } from "./magic";
import { type NpcAnimations, type NpcKit, registerNpcs } from "./npc";
import { registerObjectHandlers } from "./objects";
import { registerReactions } from "./reactions";
import { registerVerbs } from "./verbs";

/**
 * Assemblage des modules de jeu d'*Armaeth* sur le moteur sans tête : `registerGame` enregistre tous les gestionnaires dans le bon
 * ordre, `gameOptions` rend les options de `ArmaethEngine` qui branchent le reste (résurrection, sols acceptés, mort et animations
 * à deux, fin de trajet). `ArmaethEngine` l'utilise par défaut (`bare: true` donne le moteur nu des tests unitaires).
 */

export interface GameDeps {
  /** Service d'animations des personnages (défaut : celui du contexte, qui lit `ctx.sprites` et `ctx.ani`). */
  animations?: NpcAnimations;
}

/**
 * Ordre d'enregistrement (la dernière écriture d'une clé gagne, `HandlerRegistry.register`) :
 * 1. verbes (famille 0) et réactions « trop loin » (9) ;
 * 2. gestionnaires d'objets (1), d'indirects (5), mots magiques (6) ;
 * 3. décors (3) et événements d'objets et de système (8) ;
 * 4. personnages (2, 8) : ils ne se recouvrent avec aucun des précédents (les procédures d'événements de la clé 1, 4, 101, 201,
 *    303, 327 n'existent que de leur côté, voir `events.ts`) ;
 * 5. héros (2 clé 1, 8 clé 1) en dernier : il remplace le noyau minimal du moteur (la dépouille, 2 clé 2, vient de `registerNpcs`).
 */
export function registerGame(registry: HandlerRegistry, deps: GameDeps = {}): NpcKit {
  registerVerbs(registry);
  registerReactions(registry);
  registerObjectHandlers(registry);
  registerMagic(registry);
  registerDecor(registry);
  registerEvents(registry);
  const kit = registerNpcs(registry, deps.animations);
  // la fin de trajet du héros passe par `ctx.motion.pathEnd` : l'option `onPathEnd` du moteur rejoue la commande en attente
  registerHero(registry, { onPathEnd: (hero, result, ctx) => ctx.motion.pathEnd(hero, result) });
  return kit;
}

/** Message `(classe, numéro)` des services du moteur, absent si la classe ou le numéro manque. */
function messageOf(cls?: string | number, number?: number): [string, number] | undefined {
  return cls !== undefined && number !== undefined ? [String(cls), number] : undefined;
}

/** Options de `ArmaethEngine` qui branchent les modules de jeu. Chaque appel rend des options neuves (la boîte à outils est propre). */
export function gameOptions(deps: GameDeps = {}): ArmaethEngineOptions {
  let kit: NpcKit | null = null;

  const services: EngineServices = {
    // `2594:0004(victime, animation, message)` : séquence de mort du héros (animation `ANM` puis conséquence de sa fin)
    die: (ctx, obj, cause, cls, number) => void startHeroAnimation(obj, ctx, cause, { message: messageOf(cls, number) }),
    // `16f5:0132` : animation à deux ; le héros suit `2594:0004`, les autres personnages leur propre service d'animations
    playAnimation: (ctx, obj, id, partner, cls, number, ego) => {
      if (obj.num === HERO_NUM && obj === ctx.hero) {
        startHeroAnimation(obj, ctx, id, { message: messageOf(cls, number), partner });
        return;
      }
      kit?.startAnimation(ctx, obj, { id, partner, ego: ego ?? obj.ego });
      if (cls !== undefined && number !== undefined) sayHere(ctx, obj, String(cls), number);
    },
  };

  return {
    register: (registry) => {
      kit = registerGame(registry, deps);
    },
    onContinue: (ctx) => void continueGame(ctx),
    acceptsGround: (type, effect, body: GameObject, ctx: BehaviorContext) => acceptsGroundFor(body, type, effect, ctx.state, ctx),
    services,
  };
}
