import type { GameConfig } from "../../../engine/infogrames/engine";

/** Bips préchargés (`305a:0008`) : `s52d001b.voc`, `s01a002b.voc`, `s01a001b.voc`, dans cet ordre. */
export const BEEP_FILES = ["s52d001b.voc", "s01a002b.voc", "s01a001b.voc"] as const;

/** Ce que le Téléportaschtroumpf fournit au moteur commun (`new Engine(host, GAME_CONFIG)`). */
export const GAME_CONFIG: GameConfig = { beepFiles: BEEP_FILES };
