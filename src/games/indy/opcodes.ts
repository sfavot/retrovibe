import type { OpcodeTable } from "../../engine/desktop-adventures/script";

/**
 * Opcodes d'Indy. Ils diffèrent de ceux de Yoda Stories : la table a été reconstituée en analysant l'usage de chaque
 * opcode dans les 2 825 actions de DESKTOP.DAW (arguments, textes, noms d'actions), puis vérifiée dans le
 * désassemblage de DESKADV.EXE. Les opcodes sans usage identifiable sont absents (sans effet).
 */
export const INDY_OPCODES: OpcodeTable = {
  conditions: {
    0x01: "StandingOn",
    0x02: "Bump",
    0x03: "PlacedItemIs",
    0x04: "ZoneNotInitialized",
    0x05: "ZoneEntered",
    0x06: "CounterIs",
    0x09: "GameWon",
    0x0a: "HasItem",
    0x0c: "RandomIsGreaterThan",
    0x0d: "RandomIs",
    0x0e: "RandomIsLessThan",
    0x0f: "ZoneIsSolved",
    0x10: "EnterByVehicle",
    0x11: "MonsterIsDead",
    0x12: "HasNoActiveMonsters",
    0x13: "TileAtIs",
    0x14: "RequiredItemIs",
    0x15: "EndingIs",
    0x16: "HealthIsLessThan",
  },
  instructions: {
    0x00: "PlaceTile",
    0x01: "MoveTile",
    0x02: "RemoveTile",
    0x03: "EnableHotspot",
    0x04: "DisableHotspot",
    0x05: "SpeakHero",
    0x06: "Wait",
    0x09: "SetCounter",
    0x0a: "AddToCounter",
    0x0b: "PlaySound",
    0x0c: "Noop", // rafraîchissement de l'écran
    0x0d: "RollDice",
    0x0e: "HideHero",
    0x0f: "ShowHero",
    0x10: "DrawTile",
    0x11: "Noop", // rafraîchissement d'une tuile
    0x12: "MoveHeroTo",
    0x13: "Noop", // rafraîchissement de tuiles
    0x14: "Noop", // rafraîchissement complet
    0x15: "DisableAction",
    0x16: "EnableMonster",
    0x17: "DisableMonster",
    0x18: "EnableAllMonsters",
    0x19: "DisableAllMonsters",
    0x1a: "Noop", // (x1, y1, x2, y2, ?) : effet visuel accompagnant un déplacement scripté du héros, sans effet sur l'état
    0x1b: "WinGame",
    0x1c: "SpeakNpc",
    0x1d: "AddItem",
    0x1e: "DropItem",
    0x1f: "KillHero", // sans argument (DESKADV.EXE 3:38fa) ; utilisé une fois (zone 118, action 11)
    0x20: "RemoveItem",
    0x21: "MarkAsSolved",
    0x22: "ChangeZone",
    0x23: "Noop", // sans argument : l'original n'y fait rien
  },
};
