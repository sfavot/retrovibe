/**
 * Noms des fonctions du noyau SCI2, par indice (opérande de `callk`) : `docs/gk1/formats.md` § 15.
 *
 * Référence : table des noms de `SIERRA.EXE` et `sci2_default_knames` (`engines/sci/engine/kernel.cpp`) de ScummVM, GPL v3 ou
 * ultérieure. Les deux concordent, à un détail près : **l'exe n'a pas de chaîne pour `Abs` (indice 94)**, qui existe pourtant
 * (22 appels à un argument dans les scripts) ; tous les indices suivants sont donc ceux de l'exe plus un. Les entrées que
 * l'exe nomme « Dummy » portent ici le nom de ScummVM quand il en a un (fonctions de débogage, sans effet dans le jeu vendu).
 */
export const KERNEL_NAMES: readonly string[] = [
  /* 0 */ "Load", "Unload", "ScriptID", "DisposeScript", "Lock", "ResCheck", "Purge", "Clone", "DisposeClone", "RespondsTo",
  /* 10 */ "SetNowSeen", "NumLoops", "NumCels", "CelWide", "CelHigh", "GetHighPlanePri", "GetHighItemPri", "ShakeScreen", "OnMe", "ShowMovie",
  /* 20 */ "SetVideoMode", "AddScreenItem", "DeleteScreenItem", "UpdateScreenItem", "FrameOut", "AddPlane", "DeletePlane", "UpdatePlane", "RepaintPlane", "SetShowStyle",
  /* 30 */ "ShowStylePercent", "SetScroll", "AddMagnify", "DeleteMagnify", "IsHiRes", "Graph", "InvertRect", "TextSize", "Message", "TextColors",
  /* 40 */ "TextFonts", "Dummy", "SetQuitStr", "EditText", "InputText", "CreateTextBitmap", "DisposeTextBitmap", "GetEvent", "GlobalToLocal", "LocalToGlobal",
  /* 50 */ "MapKeyToDir", "HaveMouse", "SetCursor", "VibrateMouse", "SaveGame", "RestoreGame", "RestartGame", "GameIsRestarting", "MakeSaveCatName", "MakeSaveFileName",
  /* 60 */ "GetSaveFiles", "GetSaveDir", "CheckSaveGame", "CheckFreeSpace", "DoSound", "DoAudio", "DoSync", "NewList", "DisposeList", "NewNode",
  /* 70 */ "FirstNode", "LastNode", "EmptyList", "NextNode", "PrevNode", "NodeValue", "AddAfter", "AddToFront", "AddToEnd", "Dummy",
  /* 80 */ "Dummy", "FindKey", "Dummy", "Dummy", "Dummy", "DeleteKey", "Dummy", "Dummy", "ListAt", "ListIndexOf",
  /* 90 */ "ListEachElementDo", "ListFirstTrue", "ListAllTrue", "Random", "Abs", "Sqrt", "GetAngle", "GetDistance", "ATan", "SinMult",
  /* 100 */ "CosMult", "SinDiv", "CosDiv", "GetTime", "Platform", "BaseSetter", "DirLoop", "CantBeHere", "InitBresen", "DoBresen",
  /* 110 */ "SetJump", "AvoidPath", "InPolygon", "MergePoly", "SetDebug", "InspectObject", "MemoryInfo", "Profiler", "Record", "PlayBack",
  /* 120 */ "MonoOut", "SetFatalStr", "GetCWD", "ValidPath", "FileIO", "Dummy", "DeviceInfo", "Palette", "PalVary", "PalCycle",
  /* 130 */ "Array", "String", "RemapColors", "IntegrityChecking", "CheckIntegrity", "ObjectIntersect", "MarkMemory", "TextWidth", "PointSize",
];

/** Nom des entrées sans fonction. */
export const KERNEL_DUMMY = "Dummy";
