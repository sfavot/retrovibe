/**
 * Fonctions natives du groupe F4 : son, souris et utilisateur, protection, divers.
 *
 * Référence : `engines/cruise/function.cpp` de ScummVM (GPL v3+, release 2026.4.0) : `Op_PlayFX`, `Op_LoopFX`, `Op_StopFX`,
 * `Op_FreqFX`, `Op_LoadSong`, `Op_FadeSong`, `Op_PlaySong`, `Op_FreeSong`, `Op_SetVolume`, `Op_SongExist`, `Op_TrackPos`,
 * `Op_StopSong`, `Op_RestoreSong`, `Op_SongSize`, `Op_SetPattern`, `Op_SongLoop`, `Op_SongPlayed`, `Op_FindMsg`,
 * `Op_GetlowMemory`, `Op_Protect`, `Op_GetRingWord`, `Op_ProtectionFlag`, `Op_UserOn`, `Op_UserMenu`, `Op_UserDelay`,
 * `Op_UserClick`, `Op_AutoControl`, `Op_GetMouseX/Y/Button`, `Op_Inventory`. Lu puis réécrit (vague C ; le son passe par
 * `CroisiereSound`).
 *
 * Contournement de la protection (plan.md D3), repris du banc (`bench.cpp::protectionCheck`) : quand `ProtectionFlag(-1)` est
 * appelé par la procédure 2 de `XX2` (vérification de la copie), on écrit 1 dans les mots 4 et 6 du BSS de `SUPER` (les deux
 * questions réussies) et `protectionCode` reçoit le mot 8 (la somme que le script vient de calculer, −29430) : le jeu prend son
 * chemin « déjà validé ».
 */
import { NUM_FILE_ENTRIES, ScriptType } from "../ids";
import { readCString, readI16, strlcpy, strToUpper, writeI16 } from "../memory";
import type { EngineState } from "../state";
import { type NativeGroup } from "./types";

/** Overlay et procédure de la vérification de la copie, overlay qui garde le résultat. */
export const PROTECTION = { overlay: "XX2", proc: 2, store: "SUPER" } as const;

/** `Bench::protectionCheck`. Renvoie vrai si le contournement a été appliqué. */
export function protectionCheck(e: EngineState): boolean {
  const cur = e.currentScript;
  if (!e.skipProtection || !cur) return false;
  if (cur.scriptNumber !== PROTECTION.proc || cur.type !== ScriptType.PROC || e.overlays.entries[cur.overlayNumber]?.name !== PROTECTION.overlay) return false;
  const sup = e.overlays.findLoaded(PROTECTION.store);
  const bss = sup ? e.overlays.entries[sup]!.data?.bss : null;
  if (!bss) return false;
  writeI16(bss, 4, 1);
  writeI16(bss, 6, 1);
  e.protectionCode = readI16(bss, 8);
  e.trace?.protection?.(e.protectionCode);
  return true;
}

function playFx(e: EngineState): number {
  const volume = e.vm.popVar();
  e.vm.popVar(); // vitesse (ignorée, `#if 0`)
  e.vm.popVar(); // canal (ignoré)
  const sample = e.vm.popVar();
  const file = sample >= 0 && sample < NUM_FILE_ENTRIES ? e.filesDb.get(sample) : null;
  if (file) e.sound.playSound(file.data, file.width, volume);
  return 0;
}

export const F4_SYSTEM: NativeGroup = {
  0x0e: { name: "PlayFX", args: 4, impl: playFx },
  0x28: {
    name: "UserOn",
    args: 1,
    impl(e) {
      const old = e.userEnabled;
      const value = e.vm.popVar();
      if (value !== -1) e.userEnabled = value;
      return old;
    },
  },
  0x35: {
    name: "UserDelay",
    args: 1,
    impl(e) {
      const delay = e.vm.popVar();
      if (delay >= 0) e.userDelay = delay;
      return e.userDelay;
    },
  },
  0x3d: {
    name: "LoadSong",
    args: 1,
    impl(e) {
      const p = e.vm.popPtr();
      // l'attente du fondu en cours (`load`) fait avancer l'horloge du moteur
      e.sound.loadMusic(strToUpper(strlcpy(p ? readCString(p) : "", 33)), (ms) => e.delay(ms));
      return 0;
    },
  },
  0x3e: {
    name: "FadeSong",
    args: 0,
    impl(e) {
      e.sound.fadeSong();
      return 0;
    },
  },
  0x3f: {
    name: "PlaySong",
    args: 0,
    impl(e) {
      if (e.sound.songLoaded() && !e.sound.songPlayed()) e.sound.playMusic();
      return 0;
    },
  },
  0x40: {
    name: "FreeSong",
    args: 0,
    impl(e) {
      e.sound.stopMusic();
      e.sound.removeMusic();
      return 0;
    },
  },
  0x42: {
    name: "SetVolume",
    args: 1,
    impl(e) {
      const old = e.sound.getVolume();
      let value = e.vm.popVar();
      if (value > 63) value = 63;
      if (value >= 0) e.sound.setVolume(63 - value);
      return old >> 2;
    },
  },
  0x43: {
    name: "SongExist",
    args: 1,
    impl(e) {
      const p = e.vm.popPtr();
      if (!p) return 0;
      return e.sound.musicName() === strToUpper(strlcpy(readCString(p), 33)) ? 1 : 0;
    },
  },
  0x44: { name: "TrackPos", args: 0, impl: () => 0 },
  0x45: {
    name: "StopSong",
    args: 0,
    impl(e) {
      if (e.sound.isPlaying()) e.sound.stopMusic();
      return 0;
    },
  },
  0x46: { name: "RestoreSong", args: 0, impl: () => 0 },
  0x47: {
    name: "SongSize",
    args: 1,
    impl(e) {
      if (!e.sound.songLoaded()) return 0;
      const old = e.sound.numOrders();
      const size = e.vm.popVar();
      if (size >= 1 && size < 128) e.sound.setNumOrders(size);
      return old;
    },
  },
  0x48: {
    name: "SetPattern",
    args: 2,
    impl(e) {
      const value = e.vm.popVar();
      const offset = e.vm.popVar();
      if (e.sound.songLoaded()) e.sound.setPattern(offset, value);
      return 0;
    },
  },
  0x49: {
    name: "SongLoop",
    args: 1,
    impl(e) {
      const old = e.sound.musicLooping();
      e.sound.musicLoop(e.vm.popVar() !== 0);
      return old ? 1 : 0;
    },
  },
  0x4a: {
    name: "SongPlayed",
    args: 0,
    impl(e) {
      return e.sound.songPlayed() ? 1 : 0;
    },
  },
  0x4c: {
    name: "UserClick",
    args: 3,
    impl(e) {
      e.sysKey = e.vm.popVar();
      e.sysY = e.vm.popVar();
      e.sysX = e.vm.popVar();
      return 0;
    },
  },
  0x50: {
    name: "AutoControl",
    args: 1,
    impl(e) {
      const old = e.automaticMode;
      const value = e.vm.popVar();
      if (value >= 0) {
        e.automaticMode = value;
        e.activeMouse = value;
      }
      return old;
    },
  },
  0x57: { name: "GetMouseX", args: 0, impl: (e) => e.currentMouseX },
  0x58: { name: "GetMouseY", args: 0, impl: (e) => e.currentMouseY },
  0x59: { name: "GetMouseButton", args: 0, impl: (e) => e.currentMouseButton },
  0x5d: { name: "LoopFX", args: 4, impl: playFx },
  0x5e: {
    name: "StopFX",
    args: 1,
    impl(e) {
      const channel = e.vm.popVar();
      if (channel === -1) for (let c = 0; c < 4; c++) e.sound.stopChannel(c);
      else e.sound.stopChannel(channel);
      return 0;
    },
  },
  0x5f: {
    name: "FreqFX",
    args: 4,
    impl(e) {
      const volume = e.vm.popVar();
      const freq2 = e.vm.popVar();
      const channel = e.vm.popVar();
      const sample = e.vm.popVar();
      if (sample >= 0 && sample < NUM_FILE_ENTRIES && e.filesDb.get(sample)) {
        const hz = (freq2 * 1000) >>> 0;
        const period = hz ? Math.trunc(100000000 / ((hz * 28) >>> 0)) : 0;
        e.sound.startNote(channel, volume, period);
      }
      return 0;
    },
  },
  0x61: {
    name: "FindMsg",
    args: 2,
    impl(e) {
      const si = e.vm.popVar();
      e.vm.popVar();
      return si;
    },
  },
  0x74: { name: "GetlowMemory", args: 0, impl: () => 0 },
  0x76: {
    name: "Protect",
    args: 2,
    impl(e) {
      e.vm.popPtr();
      e.vm.popVar();
      return 0;
    },
  },
  0x78: {
    name: "Inventory",
    args: 1,
    impl(e) {
      const old = e.var41;
      e.var41 = e.vm.popVar();
      return old;
    },
  },
  0x79: {
    name: "UserMenu",
    args: 1,
    impl(e) {
      const old = e.playerMenuEnabled;
      e.playerMenuEnabled = e.vm.popVar();
      return old;
    },
  },
  0x7a: { name: "GetRingWord", args: 0, impl: () => 0 },
  0x7c: {
    name: "ProtectionFlag",
    args: 1,
    impl(e) {
      const value = e.vm.popVar();
      if (value === -1) protectionCheck(e);
      const old = e.protectionCode;
      if (value !== -1) e.protectionCode = value;
      return old;
    },
  },
};
