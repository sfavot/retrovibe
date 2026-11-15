import { HotspotType, Layer, PuzzleType, TileFlag } from "../../engine/desktop-adventures/data/types";
import { type Game, MAX_HEALTH } from "../../engine/desktop-adventures/game";
import type { Point } from "../../engine/desktop-adventures/geometry";
import type { DesktopVariant } from "../../engine/desktop-adventures/variant";
import { CharacterIds, DAGOBAH_CELLS, TileIds } from "./ids";
import { moveYodaMonster, yodaMonsterTile } from "./monster-moves";
import { YODA_OPCODES } from "./opcodes";
import { forceFactor } from "./score";
import { YodaSounds } from "./sounds";

/** Soins des objets comestibles (`getHealthBonus` de WebFun). */
const HEALTH_BONUS: Record<number, number> = {
  507: 25, // Rations
  1196: 50, // Champignon des glaces
  1198: 50, // Racine
  1197: 50, // Champignon
  480: 50, // Fluide bacta
  482: 50, // Racine de chark
  505: 100, // Trousse de secours rebelle
  506: 100, // Trousse de secours impériale
};

/** Munitions des armes pleines (`getMaxAmmo` de WebFun) ; les sabres et le reste sont illimités. */
const MAX_AMMO: Record<number, number> = {
  [TileIds.BlasterRifle]: 10,
  [TileIds.TheForce]: 15,
  [TileIds.Blaster]: 30,
};

const EQUIP_SOUND: Record<number, number> = {
  [TileIds.BlasterRifle]: YodaSounds.Armed,
  [TileIds.Blaster]: YodaSounds.Armed,
  [TileIds.LightsaberGreen]: YodaSounds.SaberOut,
  [TileIds.LightsaberBlue]: YodaSounds.SaberOut,
  [TileIds.TheForce]: YodaSounds.ArmForce,
};

/** Animation du détonateur thermique, une image par tick, puis l'explosion. */
const DETONATOR_FRAMES = [TileIds.ThermalDetonator, 1073, 1074, 1075];

/** Textes d'aide de R2-D2 dans la table de chaînes de YODESK.EXE (`findDescription` de WebFun). */
const Hint = {
  Storage: 57376,
  XWing: 57377,
  Enemy: 57378,
  Door: 57379,
  Draggable: 57380,
  Npc: 57381,
  Yoda: 57382,
  AboutWalking: 57383,
  AboutFinding: 57384,
  AboutUsing: 57385,
  AboutWeapons: 57386,
  AboutHealth: 57387,
  Vader: 57388,
  Ewok: 57391,
  Jawa: 57392,
  Droid: 57393,
  Hero: 57395,
  TeleporterActive: 57396,
  TeleporterInactive: 57397,
  MedicalDroid: 57398,
  Weapon: 57400,
} as const;
const STORAGE_TILES = new Set([258, 16, 1165, 633, 635, 636, 1765]);
const DOOR_TILES = new Set([
  70, 71, 72, 73, 74, 75, 76, 145, 149, 152, 153, 220, 221, 223, 231, 232, 233, 350, 582, 584, 586, 588, 702, 709, 755, 756, 759,
  760, 804, 806, 983, 984, 1047, 1048, 1081, 1112, 1120, 1259, 1461, 1462, 1472, 1473, 1539, 1544, 1858,
]);
const XWING_TILES = new Set([948, 949, 950]);
const GENERAL_HINTS = [Hint.AboutWalking, Hint.AboutUsing, Hint.AboutFinding, Hint.AboutWeapons, Hint.AboutHealth];

/** Conseil de R2-D2 posé en `at` (`findDescription` de WebFun) : id de chaîne. */
export function r2d2Hint(game: Game, at: Point): number {
  const { zone, assets, hero } = game;
  if (at.x === hero.x && at.y === hero.y) return Hint.Hero;
  const monster = zone.monsterAt(at.x, at.y);
  switch (monster?.character.id) {
    case CharacterIds.Vader:
      return Hint.Vader;
    case CharacterIds.Blank:
    case CharacterIds.Jawa:
    case CharacterIds.MadJawa:
      return Hint.Jawa;
    case CharacterIds.Ewok:
      return Hint.Ewok;
    case CharacterIds.R2Unit:
      return Hint.Droid;
  }
  const object = zone.getTile(at.x, at.y, Layer.Object);
  const tile = object >= 0 ? object : zone.getTile(at.x, at.y, Layer.Floor);
  if (tile === TileIds.Yoda) return Hint.Yoda;
  if (tile === TileIds.MedicalDroid) return Hint.MedicalDroid;
  if (tile === TileIds.TeleporterInactive) return Hint.TeleporterInactive;
  if (tile === TileIds.TeleporterActive) return Hint.TeleporterActive;
  if (XWING_TILES.has(tile)) return Hint.XWing;
  if (STORAGE_TILES.has(tile)) return Hint.Storage;
  if (DOOR_TILES.has(tile)) return Hint.Door;
  if (assets.hasFlag(tile, TileFlag.Draggable)) return Hint.Draggable;
  if (assets.hasFlag(tile, TileFlag.Weapon)) return Hint.Weapon;
  if (assets.hasFlag(tile, TileFlag.Character | TileFlag.Enemy)) return Hint.Enemy;
  if (assets.hasFlag(tile, TileFlag.Character | TileFlag.Npc)) return Hint.Npc;
  return GENERAL_HINTS[game.rng.mod(GENERAL_HINTS.length)];
}

/** Détonateur thermique posé en `at` : animation, puis 10 − 2|dx| − 2|dy| de dégâts aux monstres du carré 3×3. */
async function detonate(game: Game, at: Point): Promise<void> {
  game.removeItem(TileIds.ThermalDetonator);
  for (const tile of DETONATOR_FRAMES) {
    game.overlays.length = 0;
    game.overlays.push({ x: at.x, y: at.y, tile });
    await game.waitTicks(1);
  }
  game.overlays.length = 0;
  game.playSound(YodaSounds.BangLarge);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const m = game.zone.monsterAt(at.x + dx, at.y + dy);
      if (m) game.hurtMonster(m, 10 - 2 * Math.abs(dx) - 2 * Math.abs(dy));
    }
  }
}

/** Offre (puzzle « Offer ») : l'objet posé sur la serrure qui l'attend libère l'objet à trouver du secteur. */
function placeOnOffer(game: Game, tile: number, at: Point): boolean {
  const sector = game.sector;
  if (!sector || sector.solved || game.assets.puzzle(sector.puzzle)?.type !== PuzzleType.Offer) return false;
  const lock = game.zone.hotspots.find((h) => h.enabled && h.type === HotspotType.Lock && h.x === at.x && h.y === at.y && h.argument === tile);
  if (!lock) return false;
  sector.solved = true;
  game.removeItem(tile);
  const drop = game.zone.hotspots.find((h) => h.type === HotspotType.DropQuestItem && h.argument === sector.findItem);
  if (drop) drop.enabled = true;
  return true;
}

/** Règles propres à « Star Wars: Yoda Stories ». `strings` : table de chaînes de YODESK.EXE (conseils de R2-D2). */
export function createYodaVariant(strings: ReadonlyMap<number, string>): DesktopVariant {
  return {
    id: "yoda",
    opcodes: YODA_OPCODES,
    sounds: {
      push: YodaSounds.Push,
      hurt: YodaSounds.Hurt,
      door: -1,
      noGo: YodaSounds.NoGo,
      teleport: -1,
      defeat: YodaSounds.TryAgain,
      victory: YodaSounds.YouWin,
      monsterDeath: -1,
    },
    // Sans arme équipée, Luke ne peut pas attaquer.
    defaultWeapon: -1,
    bonusTile: -1,
    moveMonster: moveYodaMonster,
    monsterTile: yodaMonsterTile,
    briefingOnStart: false,
    slideOnBlock: true,
    hotspotsBeforeBumpScripts: true,
    byVehicleOnRoomChange: true,

    /** `consume` de WebFun : seuls les comestibles se consomment ; un soin est refusé à santé pleine. */
    async consume(game, tile) {
      if (!game.assets.isEdible(tile)) return false;
      const bonus = HEALTH_BONUS[tile] ?? 0;
      if (bonus > 0 && game.hero.health >= MAX_HEALTH) return false;
      game.removeItem(tile);
      game.setHealth(game.hero.health + bonus);
      if (bonus < 0) game.playSound(YodaSounds.Hurt);
      return true;
    },

    /**
     * Yoda, sur Dagobah : la première fois, il donne la mission (texte de briefing de l'objectif) et remet le premier
     * objet de la chaîne ; ensuite, il rappelle la mission (`spawn-location.ts` de WebFun).
     */
    async talkToNpc(game, tile, at) {
      if (tile !== TileIds.Yoda) return false;
      const sector = game.sector;
      const dagobah = game.story.dagobah;
      if (!sector || !dagobah || !Object.values(DAGOBAH_CELLS).some((cell) => dagobah[cell] === sector)) return false;
      const goal = game.assets.puzzle(game.story.goalPuzzle);
      if (!sector.solved) {
        if (goal?.texts[3]) await game.speak(goal.texts[3], at);
        if (game.story.startItem >= 0) await game.dropItem(game.story.startItem, at);
        sector.solved = true;
      } else if (goal?.texts[2]) {
        await game.speak(goal.texts[2], at);
      }
      return true;
    },

    maxAmmo: (weapon) => MAX_AMMO[weapon.frames[0][7]] ?? -1,
    equipSound: (weapon) => EQUIP_SOUND[weapon.frames[0][7]] ?? -1,
    // Le détonateur se pose, il ne s'équipe pas.
    canEquip: (tile) => tile !== TileIds.ThermalDetonator,

    async onPlaceTile(game, tile, at) {
      if (tile === TileIds.ThermalDetonator) {
        await detonate(game, at);
        return true;
      }
      if (tile === TileIds.R2D2) {
        game.overlays.push({ x: at.x, y: at.y, tile });
        game.playSound(game.rng.mod(2) ? YodaSounds.R2D2a : YodaSounds.R2D2b);
        const text = strings.get(r2d2Hint(game, at));
        if (text) await game.speak(text, at);
        game.overlays.length = 0;
        return true;
      }
      return placeOnOffer(game, tile, at);
    },

    /** La Force ne blesse pas : elle immobilise le monstre pendant `damage` ticks (`hitMonster` de WebFun). */
    hitMonster(_game, monster, weapon) {
      if (weapon.id !== CharacterIds.TheForce) return false;
      monster.cooldown = weapon.damage;
      return true;
    },

    score(game) {
      const all = game.story.sectors.filter((s) => s !== null);
      const puzzles = all.filter((s) => s.puzzle >= 0);
      return forceFactor({
        seconds: game.playedSeconds,
        worldSize: game.story.size,
        visitedSectors: all.filter((s) => s.visited).length,
        totalSectors: all.length,
        difficulty: game.settings.difficulty,
        solvedPuzzles: puzzles.filter((s) => s.solved).length,
        totalPuzzles: puzzles.length,
        bonus: game.rng.mod(9),
      });
    },
  };
}
