/** Numéros nommés du groupe L3 (`luredefs.h`, `res_struct.h` de ScummVM). */

/** `BarmanAction` : action en cours du barman (`frameCtr & 0x3F`). */
export const BarmanAction = { WALK_AROUND: 1, POLISH_BAR: 2, WAIT: 3, WAIT_DIALOG: 4, SERVE_BEER: 5 } as const;

/** Bits de `frameCtr` du barman : 0x80 il marche vers `supportValue`, 0x40 l'action est commencée. */
export const BARMAN_MOVING = 0x80;
export const BARMAN_STARTED = 0x40;

/** Bits de `serveFlags` d'un client : 0x80 attend d'être servi, 1 / 2 / 4 ce que le barman doit faire. */
export const SERVE_WAITING = 0x80;

/** Séquence du thé terminé (`teaAnimHandler`) : script d'animation de fin et champ « thé prêt ». */
export const TEA_DONE_SCRIPT = 0xb82;
export const TEA_DONE_FIELD = 27;

/** Délai avant que Goewin (boutique) reprenne sa routine quand elle est occupée (`goewinShopAnimHandler`). */
export const GOEWIN_SHOP_WAIT = 1500;
/** Pièce de la boutique de Goewin où elle attend sans fin le joueur. */
export const GOEWIN_SHOP_ROOM = 34;
/** Les `TALK_INDEX` pendant lesquels Goewin ne change pas de routine (12 à 14). */
export const GOEWIN_BUSY_TALK_INDEXES = [12, 13, 14] as const;
/** Numéro de la méthode `normalGoewin` (groupe L4). */
export const NORMAL_GOEWIN_METHOD = 60;

/** Frontières en x de la tête de Grub (`grubAnimHandler`) et ordonnée sous laquelle Ratpouch le remplace. */
export const GRUB_LEFT_X = 72;
export const GRUB_RIGHT_X = 172;
export const GRUB_RATPOUCH_Y = 79;
