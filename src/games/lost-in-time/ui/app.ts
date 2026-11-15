import type { CoktelAppOptions } from "../../../ui/coktel/app";
import { HtmlCdBackend } from "../engine/audio/html-cd";
import { createLostInTimeSystem, LostInTimeGame } from "../engine/lost-in-time";
import { LocalStorageStore } from "../engine/saves";
import { copy } from "../copy";
import { lostInTimeSoundPrefs } from "../sound-prefs";
import { GAME_URL } from "./title";

/**
 * Lost in Time dans l'interface commune du moteur Coktel (`src/ui/coktel/`) : sauvegardes et préférence « Son » sous le préfixe
 * `lost-in-time:`, piste du CD (`MUSIC.mp3`), bouton Inventaire (clic droit). Fin du jeu : voile « partie terminée ».
 */
export function appOptions(): CoktelAppOptions {
  return {
    debugName: "lit",
    copy,
    create({ host, soundBackend, random }) {
      const cdBackend = new HtmlCdBackend(`${GAME_URL}MUSIC.mp3`);
      const system = createLostInTimeSystem({
        host,
        soundBackend,
        cdBackend,
        store: new LocalStorageStore(),
        peekFile: (name) => host.peek(name),
      });
      return { system, game: new LostInTimeGame(host, system.sys, { random }), outputs: [cdBackend] };
    },
    soundPrefs: (targets) => lostInTimeSoundPrefs(new LocalStorageStore(), targets),
  };
}
