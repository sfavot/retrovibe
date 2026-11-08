/** Numéros de `defs.h` (ScummVM) et du jeu utilisés par le groupe 6 : pièces, objets, états, bobs. */

export const Room = {
  /** Le piton : écran de choix de la destination (`ROOM_JUNGLE_PINNACLE`). */
  Pinnacle: 7,
  /** Le logo, début de l'introduction (`FOTAQ_LOGO`). */
  Logo: 95,
  /** Le hall de l'hôtel, première pièce jouable (`ROOM_HOTEL_LOBBY`). */
  HotelLobby: 73,
} as const;

/** Objet d'entrée du hall de l'hôtel après l'introduction. */
export const HOTEL_ENTRY_OBJECT = 584;

/** `VAR_INTRO_PLAYED` : l'introduction a été jouée (`GameVar.IntroPlayed`). */
export const INTRO_PLAYED = 117;

/** Cinématiques de l'introduction, dans l'ordre (`changeToSpecialRoom`). `CDINT` est l'introduction du CD (`CINTR` : option `alt_intro`). */
export const INTRO_CUTAWAYS = ["COPY.CUT", "CLOGO.CUT", "CDINT.CUT", "CRED.CUT"] as const;
export const HOTEL_CUTAWAY = "C70D.CUT";

/** Bobs du piton : Joe en haut de la montagne et la montagne (`handlePinnacleRoom`). */
export const PINNACLE_JOE_BOB = 6;
export const PINNACLE_MOUNTAIN_BOB = 7;
/** Ordonnée de la ligne de commande du piton (`makeCmdTextInstance(5)`). */
export const PINNACLE_TEXT_Y = 5;

/** Morceau joué en quittant le piton, selon l'objet de destination (`cmds` de `handlePinnacleRoom`). */
export const PINNACLE_SONGS: Readonly<Record<number, number>> = { 0x2a: 3, 0x29: 16, 0x2f: 6, 0x2c: 7, 0x2b: 3, 0x30: 3 };

/** Bob du titre (mouvement 34) ; bobs des panoramiques de `CDINT` (mouvements 36, 38, 39). */
export const TITLE_BOB = 5;
