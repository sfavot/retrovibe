/**
 * Cadence du moteur de *Flight of the Amazon Queen* (`docs/fotaq/engine.md`, § 2), d'après engines/queen/queen.cpp et input.h
 * (ScummVM).
 *
 * ScummVM avance par **images de logique** : `QueenEngine::update` attend que `Input::DELAY_NORMAL` = 100 ms se soient écoulées
 * depuis l'image précédente, puis fait avancer les bobs, l'affichage, les touches et la commande du joueur. Toutes les attentes
 * du jeu (marche, répliques, cinématiques, `joeFace`, `joeGrab`) sont des suites de `update()`. Le portage prend donc **un tick =
 * une image = 100 ms** : une attente de `n` images est `wait(n)` (`src/engine/sequence.ts`), et l'hôte appelle `tick()` avec
 * `FixedStepClock` (`tickMs: TICK_MS`).
 *
 * Écarts : ScummVM ajoute à l'attente le temps de dessin si l'image a pris plus de 100 ms (`frameDelay` vaut alors 1 ms) ; ici une
 * image dure exactement 100 ms. Le mode rapide (`Input::_fastMode`, attente de `DELAY_SHORT` = 10 ms) est porté par `FAST_RATIO` : quand il est actif, `FotaqEngine.update` ne passe un tick que toutes les `FAST_RATIO` images ; seule la logique de la vague L l'active (la touche `kActionFastMode` n'existe pas).
 */

/** Durée d'un tick du moteur = une image de logique (`Input::DELAY_NORMAL`). Seule constante de temps du moteur. */
export const TICK_MS = 100;

/** Ticks rattrapés au plus en une image d'écran (300 ms) : au-delà (onglet gelé), le temps perdu est abandonné. */
export const MAX_CATCH_UP_TICKS = 3;

/** Vitesse du texte par défaut (`Logic::DEFAULT_TALK_SPEED`, réglage « talkspeed » de ScummVM). */
export const DEFAULT_TALK_SPEED = 7 * 3;

/**
 * Images pendant lesquelles un texte sans voix reste affiché (`Talk::countSpaces`) : deux images par caractère (au moins dix
 * caractères), divisées par le tiers de la vitesse du texte.
 */
export function textFrames(text: string, talkSpeed = DEFAULT_TALK_SPEED): number {
  const length = Math.max(text.length, 10);
  return Math.trunc((length * 2) / Math.trunc(talkSpeed / 3));
}

/** Images de logique en mode rapide par tick (`DELAY_NORMAL` / `DELAY_SHORT`). */
export const FAST_RATIO = 10;
