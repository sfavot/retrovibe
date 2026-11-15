import type { Action, ScriptItem } from "./data/types";
import type { Point } from "./geometry";
import type { Sector } from "./world";
import { type ZoneState, isAlive } from "./zone-state";

/**
 * Machine de script du moteur « Desktop Adventures ».
 *
 * Indy et Yoda Stories partagent le format des actions (conditions puis instructions, 5 arguments et un texte) mais
 * pas la numérotation des opcodes : chaque jeu fournit une `OpcodeTable` qui traduit ses numéros en opérations
 * communes ci-dessous. Un opcode absent de la table est une condition fausse ou une instruction sans effet.
 */

export enum Mode {
  Walk = 0,
  JustEntered = 1 << 0,
  ByVehicle = 1 << 1,
  Bump = 1 << 2,
  PlaceItem = 1 << 3,
}

/** Conditions. Les arguments sont notés a0…a4. */
export type Condition =
  | "ZoneNotInitialized"
  | "ZoneEntered"
  /** Le héros vient de cogner (a0, a1) qui porte la tuile a2 sur l'une des couches. */
  | "Bump"
  /** Objet a4 (-1 : objet demandé par le secteur) posé en (a0, a1), sur la tuile a3 de la couche a2. */
  | "PlacedItemIs"
  /** Comme `PlacedItemIs`, mais avec un autre objet que a4. */
  | "PlacedItemIsNot"
  /** Aucun objet n'est en train d'être posé. */
  | "NoItemPlaced"
  /** Le héros est en (a0, a1), sur la tuile de sol a2. */
  | "StandingOn"
  | "HeroIsAt"
  | "CounterIs"
  | "CounterIsNot"
  | "SectorCounterIs"
  | "SectorCounterIsNot"
  | "SectorCounterIsLessThan"
  | "SectorCounterIsGreaterThan"
  | "RandomIs"
  | "RandomIsNot"
  | "RandomIsGreaterThan"
  | "RandomIsLessThan"
  | "EnterByVehicle"
  /** Tuile a0 en (a1, a2) sur la couche a3. */
  | "TileAtIs"
  | "MonsterIsDead"
  /** Indy : aucun monstre actif et vivant. */
  | "HasNoActiveMonsters"
  /** Yoda : aucun monstre actif, mort ou vif (sens de l'original). */
  | "HasNoEnabledMonsters"
  /** a0, ou l'objet à trouver du secteur si a0 = -1. */
  | "HasItem"
  | "HasGoalItem"
  /** Un des objets demandés par le secteur est dans l'inventaire. */
  | "HasAnyRequiredItem"
  | "RequiredItemIs"
  | "FindItemIs"
  | "EndingIs"
  | "ZoneIsSolved"
  | "HealthIsLessThan"
  | "HealthIsGreaterThan"
  /** Indy : la mission a déjà été accomplie dans cette partie. */
  | "GameWon"
  /** Nombre de parties gagnées (historique du joueur). */
  | "GamesWonIs"
  | "GamesWonIsGreaterThan"
  /** Un emplacement d'objet de quête actif en (a0, a1). */
  | "DropsQuestItemAt";

/** Instructions. */
export type Instruction =
  /** Tuile a3 en (a0, a1) sur la couche a2. */
  | "PlaceTile"
  | "RemoveTile"
  /** Déplace la tuile de (a0, a1) vers (a3, a4) sur la couche a2. */
  | "MoveTile"
  /** Dessine la tuile a2 en (a0, a1) par-dessus la vue, jusqu'à la prochaine attente. */
  | "DrawTile"
  | "SpeakHero"
  | "SpeakNpc"
  /** Indy : attend a0 ticks. */
  | "Wait"
  /** Yoda : attend un tick (sans argument). */
  | "WaitTick"
  | "PlaySound"
  | "StopSound"
  | "RollDice"
  | "SetRandom"
  | "SetCounter"
  | "AddToCounter"
  | "SetSectorCounter"
  | "AddToSectorCounter"
  | "HideHero"
  | "ShowHero"
  | "MoveHeroTo"
  /** Déplacement relatif (a0, a1), sauf coordonnée absolue a2 / a3 différente de -1. */
  | "MoveHeroBy"
  | "DisableAction"
  | "EnableHotspot"
  | "DisableHotspot"
  | "EnableMonster"
  | "DisableMonster"
  | "EnableAllMonsters"
  | "DisableAllMonsters"
  | "DropItem"
  | "AddItem"
  | "RemoveItem"
  | "MarkAsSolved"
  | "WinGame"
  | "LoseGame"
  /** Indy : tue le héros, comme une santé tombée à 0. */
  | "KillHero"
  | "ChangeZone"
  | "AddHealth"
  /** Rafraîchissements d'écran de l'original et effets sans état : le rendu est continu, rien à faire. */
  | "Noop";

/** Traduction des opcodes d'un jeu en opérations. */
export interface OpcodeTable {
  readonly conditions: Readonly<Record<number, Condition>>;
  readonly instructions: Readonly<Record<number, Instruction>>;
}

/** Opcode d'un jeu pour une opération (le premier si plusieurs opcodes y mènent), -1 si le jeu ne la connaît pas. */
export function opcodeOf(table: Readonly<Record<number, string>>, operation: string): number {
  for (const [opcode, op] of Object.entries(table)) if (op === operation) return Number(opcode);
  return -1;
}

/** Ce dont la machine de script a besoin du jeu. */
export interface ScriptHost {
  readonly opcodes: OpcodeTable;
  readonly zone: ZoneState;
  readonly sector: Sector | null;
  readonly hero: { x: number; y: number; visible: boolean; health: number };
  readonly goalItem: number;
  readonly gameWon: boolean;
  readonly gamesWon: number;
  readonly bumped: Point | null;
  readonly placed: { tile: number; x: number; y: number } | null;
  itemName(tile: number): string;
  hasItem(tile: number): boolean;
  addItem(tile: number): void;
  removeItem(tile: number): void;
  random(n: number): number;
  speak(text: string, at: Point | null): Promise<void>;
  wait(ticks: number): Promise<void>;
  playSound(id: number): void;
  stopSound(): void;
  dropItem(tile: number, at: Point): Promise<void>;
  drawOverlay(x: number, y: number, tile: number): void;
  clearOverlays(): void;
  moveHeroTo(x: number, y: number): void;
  addHealth(amount: number): void;
  markSolved(): void;
  win(): Promise<void>;
  lose(): void;
  /** Tue le héros (défaite immédiate). */
  killHero(): void;
  /** Demande un changement de zone ; le script en cours s'arrête. */
  changeZone(zoneId: number, x: number, y: number): void;
}

export enum ScriptOutcome {
  /** Aucune action n'a vu toutes ses conditions remplies. */
  Idle,
  Ran,
  /** Un changement de zone a interrompu les scripts. */
  ZoneChanged,
}

const ABORT = Symbol("abort");

const requiredItemOf = (sector: Sector | null) => sector?.requiredItem ?? -1;
const findItemOf = (sector: Sector | null) => sector?.findItem ?? -1;

function placedItemMatches(c: ScriptItem, host: ScriptHost, mode: Mode, same: boolean): boolean {
  const [x, y, layer, tile, wanted] = c.args;
  const p = host.placed;
  if (!(mode & Mode.PlaceItem) || !p) return false;
  const item = wanted < 0 ? requiredItemOf(host.sector) : wanted;
  return p.x === x && p.y === y && host.zone.getTile(x, y, layer) === tile && (p.tile === item) === same;
}

function checkCondition(c: ScriptItem, host: ScriptHost, mode: Mode): boolean {
  const a = c.args;
  const zone = host.zone;
  const sector = host.sector;
  switch (host.opcodes.conditions[c.opcode]) {
    case "ZoneNotInitialized":
      return !zone.initialized;
    case "ZoneEntered":
      return (mode & Mode.JustEntered) !== 0;
    case "Bump": {
      const b = host.bumped;
      if (!(mode & Mode.Bump) || !b || b.x !== a[0] || b.y !== a[1]) return false;
      return [0, 1, 2].some((l) => zone.getTile(a[0], a[1], l) === a[2]);
    }
    case "PlacedItemIs":
      return placedItemMatches(c, host, mode, true);
    case "PlacedItemIsNot":
      return placedItemMatches(c, host, mode, false);
    case "NoItemPlaced":
      return !host.placed;
    case "StandingOn":
      return host.hero.x === a[0] && host.hero.y === a[1] && zone.getTile(a[0], a[1], 0) === a[2];
    case "HeroIsAt":
      return host.hero.x === a[0] && host.hero.y === a[1];
    case "CounterIs":
      return zone.counter === a[0];
    case "CounterIsNot":
      return zone.counter !== a[0];
    case "SectorCounterIs":
      return zone.sectorCounter === a[0];
    case "SectorCounterIsNot":
      return zone.sectorCounter !== a[0];
    case "SectorCounterIsLessThan":
      return zone.sectorCounter < a[0];
    case "SectorCounterIsGreaterThan":
      return zone.sectorCounter > a[0];
    case "RandomIs":
      return zone.random === a[0];
    case "RandomIsNot":
      return zone.random !== a[0];
    case "RandomIsGreaterThan":
      return zone.random > a[0];
    case "RandomIsLessThan":
      return zone.random < a[0];
    case "EnterByVehicle":
      return (mode & Mode.ByVehicle) !== 0;
    case "TileAtIs":
      return zone.getTile(a[1], a[2], a[3]) === a[0];
    case "MonsterIsDead": {
      const m = zone.monsters.find((monster) => monster.index === a[0]);
      return !!m && !isAlive(m);
    }
    case "HasNoActiveMonsters":
      return !zone.monsters.some((m) => m.enabled && isAlive(m));
    case "HasNoEnabledMonsters":
      return !zone.monsters.some((m) => m.enabled);
    case "HasItem":
      return host.hasItem(a[0] < 0 ? findItemOf(sector) : a[0]);
    case "HasGoalItem":
      return host.hasItem(host.goalItem);
    case "HasAnyRequiredItem":
      return !!sector && (host.hasItem(sector.requiredItem) || host.hasItem(sector.additionalRequiredItem));
    case "RequiredItemIs":
      return !!sector && (sector.requiredItem === a[0] || (sector.additionalRequiredItem >= 0 && sector.additionalRequiredItem === a[0]));
    case "FindItemIs":
      return !!sector && a[0] >= 0 && sector.findItem === a[0];
    case "EndingIs":
      return host.goalItem === a[0];
    case "ZoneIsSolved":
      return !!sector?.solved;
    case "HealthIsLessThan":
      return host.hero.health < a[0];
    case "HealthIsGreaterThan":
      return host.hero.health > a[0];
    case "GameWon":
      return host.gameWon;
    case "GamesWonIs":
      return host.gamesWon === a[0];
    case "GamesWonIsGreaterThan":
      return host.gamesWon > a[0];
    case "DropsQuestItemAt":
      return zone.hotspots.some((h) => h.type === DROP_QUEST_ITEM && h.enabled && h.x === a[0] && h.y === a[1]);
    default:
      return false;
  }
}

/** HotspotType.DropQuestItem (évite d'importer l'énumération pour une seule valeur). */
const DROP_QUEST_ITEM = 0;

/**
 * Remplace les marqueurs de nom d'objet d'un texte : « ¢ » par l'objet demandé dans la zone,
 * « ¥ » (Yoda) par l'objet qu'elle permet de trouver.
 */
export function expandText(text: string, requiredItemName: string, findItemName = ""): string {
  return text.replace(/¢/g, requiredItemName).replace(/¥/g, findItemName);
}

async function execute(i: ScriptItem, host: ScriptHost, zone: ZoneState, actionIndex: number): Promise<typeof ABORT | void> {
  const a = i.args;
  const sector = host.sector;
  const text = () => expandText(i.text, host.itemName(requiredItemOf(sector)), host.itemName(findItemOf(sector)));
  switch (host.opcodes.instructions[i.opcode]) {
    case "PlaceTile":
      zone.setTile(a[0], a[1], a[2], a[3]);
      return;
    case "MoveTile": {
      const tile = zone.getTile(a[0], a[1], a[2]);
      zone.setTile(a[0], a[1], a[2], -1);
      zone.setTile(a[3], a[4], a[2], tile);
      return;
    }
    case "RemoveTile":
      zone.setTile(a[0], a[1], a[2], -1);
      return;
    case "EnableHotspot":
    case "DisableHotspot": {
      const h = zone.hotspots[a[0]];
      if (h) h.enabled = host.opcodes.instructions[i.opcode] === "EnableHotspot";
      return;
    }
    case "SpeakHero":
      await host.speak(text(), null);
      return;
    case "SpeakNpc":
      await host.speak(text(), { x: a[0], y: a[1] });
      return;
    case "Wait":
      host.clearOverlays();
      await host.wait(Math.max(1, a[0]));
      return;
    case "WaitTick":
      host.clearOverlays();
      await host.wait(1);
      return;
    case "SetCounter":
      zone.counter = a[0];
      return;
    case "AddToCounter":
      zone.counter += a[0];
      return;
    case "SetSectorCounter":
      zone.sectorCounter = a[0];
      return;
    case "AddToSectorCounter":
      zone.sectorCounter += a[0];
      return;
    case "PlaySound":
      host.playSound(a[0]);
      return;
    case "StopSound":
      host.stopSound();
      return;
    case "RollDice":
      zone.random = 1 + host.random(Math.max(1, a[0]));
      return;
    case "SetRandom":
      zone.random = a[0];
      return;
    case "HideHero":
      host.hero.visible = false;
      return;
    case "ShowHero":
      host.hero.visible = true;
      return;
    case "DrawTile":
      host.drawOverlay(a[0], a[1], a[2]);
      return;
    case "MoveHeroTo":
      host.moveHeroTo(a[0], a[1]);
      return;
    case "MoveHeroBy":
      host.moveHeroTo(a[2] !== -1 ? a[2] : host.hero.x + a[0], a[3] !== -1 ? a[3] : host.hero.y + a[1]);
      return;
    case "DisableAction":
      zone.actionEnabled[actionIndex] = false;
      return;
    case "EnableMonster":
    case "DisableMonster": {
      const m = zone.monsters.find((monster) => monster.index === a[0]);
      if (m) m.enabled = host.opcodes.instructions[i.opcode] === "EnableMonster";
      return;
    }
    case "EnableAllMonsters":
    case "DisableAllMonsters": {
      const enabled = host.opcodes.instructions[i.opcode] === "EnableAllMonsters";
      for (const m of zone.monsters) m.enabled = enabled;
      return;
    }
    case "WinGame":
      await host.win();
      return;
    case "LoseGame":
      host.lose();
      return;
    case "KillHero":
      host.killHero();
      return;
    case "AddHealth":
      host.addHealth(a[0]);
      return;
    case "AddItem":
      if (a[0] >= 0) host.addItem(a[0]);
      return;
    case "DropItem": {
      const item = a[0] < 0 ? findItemOf(sector) : a[0];
      if (item >= 0) await host.dropItem(item, { x: a[1], y: a[2] });
      return;
    }
    case "RemoveItem": {
      const item = a[0] < 0 ? requiredItemOf(sector) : a[0];
      if (item >= 0) host.removeItem(item);
      return;
    }
    case "MarkAsSolved":
      host.markSolved();
      return;
    case "ChangeZone":
      host.changeZone(a[0], a[1], a[2]);
      return ABORT;
    case "Noop":
    default:
      return;
  }
}

/**
 * Évalue les actions de la zone courante dans l'ordre ; chaque action dont toutes les conditions
 * sont vraies exécute ses instructions (qui peuvent attendre une bulle de dialogue ou des ticks).
 */
export async function runScripts(host: ScriptHost, mode: Mode, actions: readonly Action[]): Promise<ScriptOutcome> {
  const zone = host.zone;
  let ran = false;
  for (let index = 0; index < actions.length; index++) {
    if (!zone.actionEnabled[index]) continue;
    const action = actions[index];
    if (!action.conditions.every((c) => checkCondition(c, host, mode))) continue;
    ran = true;
    for (const instruction of action.instructions) {
      if ((await execute(instruction, host, zone, index)) === ABORT) return ScriptOutcome.ZoneChanged;
    }
  }
  zone.initialized = true;
  return ran ? ScriptOutcome.Ran : ScriptOutcome.Idle;
}
