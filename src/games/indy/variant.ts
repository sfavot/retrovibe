import { IndyIds, IndySounds } from "./ids";
import { type Game, MAX_HEALTH } from "../../engine/desktop-adventures/game";
import { indyQuotient } from "./score";
import type { DesktopVariant } from "../../engine/desktop-adventures/variant";
import { moveIndyMonster } from "./monster-moves";
import { INDY_OPCODES } from "./opcodes";

/** Bureau de Marcus (zone 108) : lui parler rappelle la mission. */
const MARCUS_DESK = 794;
/** Objet de la mission où Marcus est enlevé (MarcusGO). */
const MARCUS_KIDNAPPED = 1048;

/**
 * Soins des objets comestibles (DESKADV.EXE 4:3f99). L'original compte la santé en dégâts cumulés
 * (compteurs de 1 à 100 et de 1 à 3, mort à (100, 3)), soit 3 × 100 = 300 points : exactement MAX_HEALTH,
 * donc les valeurs sont reprises telles quelles (un soin n'est pas mis à l'échelle de la difficulté).
 * Les autres comestibles ne soignent pas mais sont consommés.
 */
const HEALTH_BONUS: Record<number, number> = {
  [IndyIds.bananasTile]: 25, // Bananas
  1085: 75, // First Aid Kit
  696: 50, // Yerba Buena
};

/** Dégâts d'une boisson (Tequila), mis à l'échelle de la difficulté comme n'importe quel dégât. */
const DRINK_DAMAGE = 35;

/** Texte d'origine (anglais, comme les dialogues du jeu). */
const TOO_MUCH_FRUIT = "Ugh. Too much fruit!";

/** Règles propres à « Indiana Jones and his Desktop Adventures ». */
export const indyVariant: DesktopVariant = {
  id: "indy",
  opcodes: INDY_OPCODES,
  sounds: {
    push: IndySounds.Push,
    hurt: IndySounds.Hurt,
    door: IndySounds.Door,
    noGo: IndySounds.NoGo,
    teleport: IndySounds.Flourish,
    defeat: IndySounds.Defeat,
    victory: IndySounds.Victory,
    monsterDeath: IndySounds.MonsterDeath,
  },
  defaultWeapon: IndyIds.fistWeapon,
  bonusTile: IndyIds.bonusTile,
  moveMonster: moveIndyMonster,
  briefingOnStart: true,

  /**
   * Mange / boit un objet (4:3f99 de l'original). Renvoie faux s'il ne se consomme pas, ou si le héros est en pleine
   * forme (l'original refuse alors de manger, avec le son NoGo, mais pas de boire).
   */
  async consume(game: Game, tile: number): Promise<boolean> {
    const { assets, hero, zone } = game;
    if (assets.isEdible(tile)) {
      if (hero.health >= MAX_HEALTH) return false;
      const { x, y } = IndyIds.easterEggSpot;
      if (tile === IndyIds.bananasTile && zone.id === IndyIds.easterEggZone && hero.x === x && hero.y === y) {
        game.playSound(IndySounds.TooMuchFruit);
        await game.speak(TOO_MUCH_FRUIT, null);
      }
      game.removeItem(tile);
      game.setHealth(hero.health + (HEALTH_BONUS[tile] ?? 0));
      game.playSound(IndySounds.Eat);
      return true;
    }
    if (assets.isDrink(tile)) {
      game.removeItem(tile);
      game.playSound(IndySounds.Hurt);
      game.setHealth(hero.health - game.scaleDamage(DRINK_DAMAGE));
      return true;
    }
    return false;
  },

  async talkToNpc(game, tile, at) {
    if (tile !== MARCUS_DESK) return false;
    // Dans la mission « Marcus enlevé », son bureau est vide : personne ne répond.
    if (game.goalItem === MARCUS_KIDNAPPED) return true;
    const goal = game.assets.puzzle(game.story.goalPuzzle);
    const text = game.gameWon ? goal?.texts[1] : goal?.texts[2];
    if (text) await game.speak(text, { x: at.x, y: at.y - 1 });
    return true;
  },

  /** « Indy Quotient » : formule de l'original (voir `indyQuotient`), sur le temps de jeu écoulé. */
  score(game) {
    const { sum, count } = game.difficultySamples;
    return indyQuotient(game.playedSeconds, game.story.pace, sum, count);
  },

  /** L'original enregistre la difficulté à chaque son 0 (manger, DESKADV.EXE 3:e4af), entendu ou non. */
  onSound(game, id) {
    if (id === IndySounds.Eat) game.recordDifficulty();
  },
};
