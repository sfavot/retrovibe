/**
 * Fenêtre « Mode à 2 Joueurs » (`HEDTOHED.ITF`, 41d15c, procédure 41d26d, boutons 41d4be, chiffres 41d716), ouverte par « Duel » du
 * menu principal (42319e), par chat et Tim de la barre d'outils (4195bd) et par « Affronter » à la fin d'un match (419aed).
 *
 * - Parties (`HH_GAMES`, flèches `HH_GAMES_UP` / `HH_GAMES_DOWN`) : 1 à 9 de 2 en 2 ; durées des joueurs (`HH_P1_10SEC`,
 *   `HH_P1_SEC`, …, flèches `HH_P1_UP` …) : 10 à 90 s de 5 en 5. Chiffres : image n de l'état 4 de `HEDTOHED.ANM`.
 * - Noms (`HH_PLAY1NAME`, `HH_PLAY2NAME`) : contrôles EDIT de 10 caractères (416bb3) ; le port y pose un champ transparent, le texte
 *   est dessiné par la fenêtre (blanc sur bleu, couleur de l'ITF).
 * - OK (20009) : un nom vide donne GENERIC 31179 « Vous devez choisir un nom. » et la fenêtre reste ouverte ; sinon le match
 *   commence. Annuler (20010, Échap : 0xFE64) : retour au menu principal (mode 7 → 422a24).
 * - Les flèches changent les réglages gardés (`0x472840` …) tout de suite : Annuler ne les défait pas ; les noms ne sont lus qu'à OK.
 */
import type { Itf } from "../data/itf";
import { DUEL_NAME_MAX, stepGames, stepTime, timeDigits, type DuelSettings } from "../engine/duel";
import { copy } from "../copy";
import { openItfWindow, type ItfHost, type ItfInput, type ItfWindowHandle, type ItfWindowOptions } from "./itf-window";
import { readItf } from "../data/itf";

export const HEDTOHED = {
  frame: 20000,
  games: 20001,
  p1Tens: 20002,
  p1Seconds: 20003,
  p2Tens: 20004,
  p2Seconds: 20005,
  p1Name: 20006,
  p2Name: 20007,
  ok: 20009,
  cancel: 20010,
  gamesDown: 20011,
  gamesUp: 20012,
  p2Down: 20013,
  p2Up: 20014,
  p1Down: 20015,
  p1Up: 20016,
} as const;

/** `INTRFACE.RES` : un nom manque (41d5c1). */
export const DUEL_NAME_MISSING = 31179;

export interface DuelSetupOptions {
  /** Réglages gardés : parties et durées changent sur place ; les noms sont la valeur de départ des champs. */
  settings: DuelSettings;
  /** Message du jeu par-dessus la fenêtre (nom vide). */
  message(text: string): void;
  /** Texte de `INTRFACE.RES`. */
  text(id: number): string;
  /** OK avec deux noms : les réglages du match. */
  start(settings: DuelSettings): void;
  /** Annuler ou Échap. */
  cancel(): void;
}

export function duelSetupWindow(itf: Itf, o: DuelSetupOptions): { itf: Itf; options: ItfWindowOptions } {
  const s = o.settings;
  const names: [string, string] = [s.names[0].slice(0, DUEL_NAME_MAX), s.names[1].slice(0, DUEL_NAME_MAX)];
  const texts: Record<number, string> = {};
  const frames: Record<number, number> = {};
  const refresh = (): void => {
    frames[HEDTOHED.games] = s.games % 10;
    [frames[HEDTOHED.p1Tens], frames[HEDTOHED.p1Seconds]] = timeDigits(s.times[0]);
    [frames[HEDTOHED.p2Tens], frames[HEDTOHED.p2Seconds]] = timeDigits(s.times[1]);
    texts[HEDTOHED.p1Name] = names[0];
    texts[HEDTOHED.p2Name] = names[1];
  };
  refresh();
  const field = (player: 0 | 1, id: number): ItfInput => {
    const input: ItfInput = {
      id,
      label: copy.duelName(player + 1),
      value: names[player],
      maxLength: DUEL_NAME_MAX,
      input: (v) => {
        names[player] = v.slice(0, DUEL_NAME_MAX);
        input.value = names[player];
        refresh();
      },
    };
    return input;
  };
  const seconds = (ms: number) => Math.round(ms / 1000);
  return {
    itf,
    options: {
      title: copy.duelSetupTitle,
      state: { texts, frames },
      defaultId: HEDTOHED.ok,
      cancelId: HEDTOHED.cancel,
      labels: {
        [HEDTOHED.gamesUp]: copy.duelGamesMore,
        [HEDTOHED.gamesDown]: copy.duelGamesLess,
        [HEDTOHED.p1Up]: copy.duelTimeMore(1),
        [HEDTOHED.p1Down]: copy.duelTimeLess(1),
        [HEDTOHED.p2Up]: copy.duelTimeMore(2),
        [HEDTOHED.p2Down]: copy.duelTimeLess(2),
      },
      input: [field(0, HEDTOHED.p1Name), field(1, HEDTOHED.p2Name)],
      texts: () => [copy.duelSetupTitle],
      status: () => copy.duelSetupStatus(s.games, seconds(s.times[0]), seconds(s.times[1])),
      choose: (id) => {
        switch (id) {
          case HEDTOHED.gamesUp:
          case HEDTOHED.gamesDown:
            s.games = stepGames(s.games, id === HEDTOHED.gamesUp ? 1 : -1);
            break;
          case HEDTOHED.p1Up:
          case HEDTOHED.p1Down:
            s.times[0] = stepTime(s.times[0], id === HEDTOHED.p1Up ? 1 : -1);
            break;
          case HEDTOHED.p2Up:
          case HEDTOHED.p2Down:
            s.times[1] = stepTime(s.times[1], id === HEDTOHED.p2Up ? 1 : -1);
            break;
          case HEDTOHED.ok:
            if (names[0].trim() === "" || names[1].trim() === "") {
              o.message(o.text(DUEL_NAME_MISSING));
              return true;
            }
            s.names = [names[0], names[1]];
            o.start({ games: s.games, times: [s.times[0], s.times[1]], names: [names[0], names[1]] });
            return false;
          case HEDTOHED.cancel:
            o.cancel();
            return false;
          default:
            return true;
        }
        refresh();
        return true;
      },
    },
  };
}

export function openDuelSetupWindow(host: ItfHost, o: DuelSetupOptions & { onClose?(): void }): ItfWindowHandle {
  const w = duelSetupWindow(readItf(host.assets.index.get("HEDTOHED.ITF")), o);
  return openItfWindow(host, w.itf, { ...w.options, ...(o.onClose ? { onClose: o.onClose } : {}) });
}
