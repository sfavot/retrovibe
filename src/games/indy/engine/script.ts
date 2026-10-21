import type { Action, ScriptItem } from "../data/types";
import type { Point } from "./geometry";
import type { Sector } from "./world";
import { type ZoneState, isAlive } from "./zone-state";

/**
 * Machine de script d'Indy.
 *
 * Les opcodes d'Indy diffèrent de ceux de Yoda Stories : la table ci-dessous a été reconstituée
 * en analysant l'usage de chaque opcode dans les 2 825 actions de DESKTOP.DAW (arguments, textes,
 * noms d'actions). Les opcodes sans usage identifiable sont des no-op explicites.
 */

export enum Mode {
  Walk = 0,
  JustEntered = 1 << 0,
  ByVehicle = 1 << 1,
  Bump = 1 << 2,
  PlaceItem = 1 << 3,
}

export const Cond = {
  StandingOn: 0x01,
  Bump: 0x02,
  PlacedItemIs: 0x03,
  ZoneNotInitialized: 0x04,
  ZoneEntered: 0x05,
  CounterIs: 0x06,
  GameWon: 0x09,
  HasItem: 0x0a,
  RandomIsGreaterThan: 0x0c,
  RandomIs: 0x0d,
  RandomIsLessThan: 0x0e,
  ZoneIsSolved: 0x0f,
  EnterByVehicle: 0x10,
  MonsterIsDead: 0x11,
  HasNoActiveMonsters: 0x12,
  TileAtIs: 0x13,
  RequiredItemIs: 0x14,
  EndingIs: 0x15,
  HealthIsLessThan: 0x16,
} as const;

export const Instr = {
  PlaceTile: 0x00,
  MoveTile: 0x01,
  RemoveTile: 0x02,
  EnableHotspot: 0x03,
  DisableHotspot: 0x04,
  SpeakHero: 0x05,
  Wait: 0x06,
  SetCounter: 0x09,
  AddToCounter: 0x0a,
  PlaySound: 0x0b,
  Redraw: 0x0c,
  RollDice: 0x0d,
  HideHero: 0x0e,
  ShowHero: 0x0f,
  DrawTile: 0x10,
  RedrawTile: 0x11,
  MoveHeroTo: 0x12,
  RedrawTiles: 0x13,
  RedrawAll: 0x14,
  DisableAction: 0x15,
  EnableMonster: 0x16,
  DisableMonster: 0x17,
  EnableAllMonsters: 0x18,
  DisableAllMonsters: 0x19,
  /** (x1, y1, x2, y2, ?) : effet visuel accompagnant un déplacement scripté du héros ; sans effet sur l'état. */
  HeroTransition: 0x1a,
  WinGame: 0x1b,
  SpeakNpc: 0x1c,
  AddItem: 0x1d,
  DropItem: 0x1e,
  RemoveItem: 0x20,
  MarkAsSolved: 0x21,
  ChangeZone: 0x22,
} as const;

/** Ce dont la machine de script a besoin du jeu. */
export interface ScriptHost {
  readonly zone: ZoneState;
  readonly sector: Sector | null;
  readonly hero: { x: number; y: number; visible: boolean; health: number };
  readonly goalItem: number;
  readonly gameWon: boolean;
  readonly bumped: Point | null;
  readonly placed: { tile: number; x: number; y: number } | null;
  hasItem(tile: number): boolean;
  addItem(tile: number): void;
  removeItem(tile: number): void;
  random(n: number): number;
  speak(text: string, at: Point | null): Promise<void>;
  wait(ticks: number): Promise<void>;
  playSound(id: number): void;
  dropItem(tile: number, at: Point): Promise<void>;
  drawOverlay(x: number, y: number, tile: number): void;
  clearOverlays(): void;
  moveHeroTo(x: number, y: number): void;
  markSolved(): void;
  win(): Promise<void>;
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

function checkCondition(c: ScriptItem, host: ScriptHost, mode: Mode): boolean {
  const a = c.args;
  const zone = host.zone;
  const sector = host.sector;
  switch (c.opcode) {
    case Cond.StandingOn:
      return host.hero.x === a[0] && host.hero.y === a[1] && zone.getTile(a[0], a[1], 0) === a[2];
    case Cond.Bump: {
      const b = host.bumped;
      if (!(mode & Mode.Bump) || !b || b.x !== a[0] || b.y !== a[1]) return false;
      return [0, 1, 2].some((l) => zone.getTile(a[0], a[1], l) === a[2]);
    }
    case Cond.PlacedItemIs: {
      const p = host.placed;
      if (!(mode & Mode.PlaceItem) || !p) return false;
      const item = a[4] < 0 ? (sector?.requiredItem ?? -1) : a[4];
      return p.x === a[0] && p.y === a[1] && zone.getTile(a[0], a[1], a[2]) === a[3] && p.tile === item;
    }
    case Cond.ZoneNotInitialized:
      return !zone.initialized;
    case Cond.ZoneEntered:
      return (mode & Mode.JustEntered) !== 0;
    case Cond.CounterIs:
      return zone.counter === a[0];
    case Cond.GameWon:
      return host.gameWon;
    case Cond.HasItem:
      return host.hasItem(a[0] < 0 ? (sector?.findItem ?? -1) : a[0]);
    case Cond.RandomIsGreaterThan:
      return zone.random > a[0];
    case Cond.RandomIs:
      return zone.random === a[0];
    case Cond.RandomIsLessThan:
      return zone.random < a[0];
    case Cond.ZoneIsSolved:
      return !!sector?.solved;
    case Cond.EnterByVehicle:
      return (mode & Mode.ByVehicle) !== 0;
    case Cond.MonsterIsDead: {
      const m = zone.monsters.find((monster) => monster.index === a[0]);
      return !!m && !isAlive(m);
    }
    case Cond.HasNoActiveMonsters:
      return !zone.monsters.some((m) => m.enabled && isAlive(m));
    case Cond.TileAtIs:
      return zone.getTile(a[1], a[2], a[3]) === a[0];
    case Cond.RequiredItemIs:
      return !!sector && sector.requiredItem === a[0];
    case Cond.EndingIs:
      return host.goalItem === a[0];
    case Cond.HealthIsLessThan:
      return host.hero.health < a[0];
    default:
      return false;
  }
}

/** Remplace « ¢ » par le nom de l'objet demandé dans la zone. */
export function expandText(text: string, requiredItemName: string): string {
  return text.replace(/¢/g, requiredItemName);
}

async function execute(
  i: ScriptItem,
  host: ScriptHost,
  zone: ZoneState,
  actionIndex: number,
  itemName: (id: number) => string,
): Promise<typeof ABORT | void> {
  const a = i.args;
  const sector = host.sector;
  switch (i.opcode) {
    case Instr.PlaceTile:
      zone.setTile(a[0], a[1], a[2], a[3]);
      return;
    case Instr.MoveTile: {
      const tile = zone.getTile(a[0], a[1], a[2]);
      zone.setTile(a[0], a[1], a[2], -1);
      zone.setTile(a[3], a[4], a[2], tile);
      return;
    }
    case Instr.RemoveTile:
      zone.setTile(a[0], a[1], a[2], -1);
      return;
    case Instr.EnableHotspot:
    case Instr.DisableHotspot: {
      const h = zone.hotspots[a[0]];
      if (h) h.enabled = i.opcode === Instr.EnableHotspot;
      return;
    }
    case Instr.SpeakHero:
      await host.speak(expandText(i.text, itemName(sector?.requiredItem ?? -1)), null);
      return;
    case Instr.SpeakNpc:
      await host.speak(expandText(i.text, itemName(sector?.requiredItem ?? -1)), { x: a[0], y: a[1] });
      return;
    case Instr.Wait:
      host.clearOverlays();
      await host.wait(Math.max(1, a[0]));
      return;
    case Instr.SetCounter:
      zone.counter = a[0];
      return;
    case Instr.AddToCounter:
      zone.counter += a[0];
      return;
    case Instr.PlaySound:
      host.playSound(a[0]);
      return;
    case Instr.RollDice:
      zone.random = 1 + host.random(Math.max(1, a[0]));
      return;
    case Instr.HideHero:
    case Instr.ShowHero:
      host.hero.visible = i.opcode === Instr.ShowHero;
      return;
    case Instr.DrawTile:
      host.drawOverlay(a[0], a[1], a[2]);
      return;
    case Instr.MoveHeroTo:
      host.moveHeroTo(a[0], a[1]);
      return;
    case Instr.DisableAction:
      zone.actionEnabled[actionIndex] = false;
      return;
    case Instr.EnableMonster:
    case Instr.DisableMonster: {
      const m = zone.monsters.find((monster) => monster.index === a[0]);
      if (m) m.enabled = i.opcode === Instr.EnableMonster;
      return;
    }
    case Instr.EnableAllMonsters:
    case Instr.DisableAllMonsters:
      for (const m of zone.monsters) m.enabled = i.opcode === Instr.EnableAllMonsters;
      return;
    case Instr.WinGame:
      await host.win();
      return;
    case Instr.AddItem:
      if (a[0] >= 0) host.addItem(a[0]);
      return;
    case Instr.DropItem: {
      const item = a[0] < 0 ? (sector?.findItem ?? -1) : a[0];
      if (item >= 0) await host.dropItem(item, { x: a[1], y: a[2] });
      return;
    }
    case Instr.RemoveItem: {
      const item = a[0] < 0 ? (sector?.requiredItem ?? -1) : a[0];
      if (item >= 0) host.removeItem(item);
      return;
    }
    case Instr.MarkAsSolved:
      host.markSolved();
      return;
    case Instr.ChangeZone:
      host.changeZone(a[0], a[1], a[2]);
      return ABORT;
    // Rafraîchissements d'écran : le rendu est continu, rien à faire.
    case Instr.Redraw:
    case Instr.RedrawTile:
    case Instr.RedrawTiles:
    case Instr.RedrawAll:
    case Instr.HeroTransition:
    default:
      return;
  }
}

/**
 * Évalue les actions de la zone courante dans l'ordre ; chaque action dont toutes les conditions
 * sont vraies exécute ses instructions (qui peuvent attendre une bulle de dialogue ou des ticks).
 */
export async function runScripts(
  host: ScriptHost,
  mode: Mode,
  actions: readonly Action[],
  itemName: (id: number) => string,
): Promise<ScriptOutcome> {
  const zone = host.zone;
  let ran = false;
  for (let index = 0; index < actions.length; index++) {
    if (!zone.actionEnabled[index]) continue;
    const action = actions[index];
    if (!action.conditions.every((c) => checkCondition(c, host, mode))) continue;
    ran = true;
    for (const instruction of action.instructions) {
      if ((await execute(instruction, host, zone, index, itemName)) === ABORT) return ScriptOutcome.ZoneChanged;
    }
  }
  zone.initialized = true;
  return ran ? ScriptOutcome.Ran : ScriptOutcome.Idle;
}
