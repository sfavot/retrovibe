/** Préférences d'affichage du joueur (`USERPREF.ITF`), lues par le rendu et l'éditeur (`World.animFlags`). */
/**
 * Préférences d'affichage (`[0x481034]`, +0x154 du fichier ; `World.animFlags`), basculées par `USERPREF.ITF` (42ae4a) :
 * - `ambient` (UP_AMBIENT_SEL, 42aea8) : animations décoratives des pièces (flamme, moteurs, chat… : 0x481034 & 1 dans leurs routines) ;
 * - `scenery` (UP_SCENERY_SEL, 42aeb3) : décors (+0x14 & 0x1000) dessinés (42da44) ; l'éteindre éteint aussi `background` ; l'onglet
 *   des décors du bac la rallume (4187b5) ;
 * - `background` (UP_BG_SEL, 42aee3) : fonds (aplats 43e74b, bloc de couleur 448345), et au bac des décors ceux de +0x14 & 0x80
 *   (41776c), qu'on ne prend alors plus dans l'aire (437a40) ;
 * - `noInfo` (UP_INFO_SEL, 42af2e, **inversé** : levé = case éteinte) : pas de poignée d'information autour des pièces (4380a7).
 */
export const DISPLAY = { ambient: 0x1, scenery: 0x2, background: 0x4, noInfo: 0x10 } as const;
/** Partie neuve (42d009 … 42d031) : 7 sur une machine rapide (mesure `[0x477954]` > 40), 6 sur une moyenne, 0 sur une lente. */
export const DEFAULT_DISPLAY = DISPLAY.ambient | DISPLAY.scenery | DISPLAY.background;
