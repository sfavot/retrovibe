import type { CoktelAppOptions } from "../../../ui/coktel/app";
import { localStorageStore } from "../../../ui/local-storage";
import { muteAll, soundPrefKey, SoundPrefs } from "../../../ui/sound-prefs";
import { copy } from "../copy";
import { createWeenSystem, WeenGame } from "../engine/ween";
import { weenStorage } from "../engine/saves";

/**
 * Ween dans l'interface commune du moteur Coktel (`src/ui/coktel/`) : sauvegardes et bloc-notes dans le stockage du navigateur
 * (préfixe `ween:`), préférence « Son » commune (`retrovibe:ween:sound`), pas de bouton Inventaire (le clic droit reste à
 * l'appui long). « Quitter » du jeu (TOT `END` absent) ramène à l'écran titre (`back`).
 */
export function appOptions(back: () => void): CoktelAppOptions {
  return {
    debugName: "ween",
    copy,
    create({ host, soundBackend, random }) {
      const system = createWeenSystem({ host, soundBackend, store: weenStorage() });
      return { system, game: new WeenGame(host, system.sys, { random }) };
    },
    soundPrefs: (targets) => new SoundPrefs(localStorageStore(), muteAll(targets), "ween"),
    soundStorageKey: soundPrefKey("ween"),
    onEnded: back,
  };
}
