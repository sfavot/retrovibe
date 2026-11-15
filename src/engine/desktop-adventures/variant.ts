import type { Character, DawVariant } from "./data/types";
import type { Game } from "./game";
import type { Point } from "./geometry";
import type { MonsterHost } from "./monsters";
import type { OpcodeTable } from "./script";
import type { Sector } from "./world";
import type { Monster } from "./zone-state";

/** Sons que le moteur joue de lui-même (ids de la table de sons du jeu, -1 : aucun). */
export interface VariantSounds {
  push: number;
  hurt: number;
  door: number;
  noGo: number;
  /** Téléporteur. */
  teleport: number;
  defeat: number;
  victory: number;
  /** Mort d'un monstre. */
  monsterDeath: number;
}

/**
 * Ce qui distingue un jeu du moteur « Desktop Adventures » (Indy, Yoda Stories) : le moteur commun appelle ces
 * valeurs et crochets là où les deux jeux divergent, et ne connaît aucun identifiant propre à l'un d'eux.
 */
export interface DesktopVariant {
  readonly id: DawVariant;
  readonly opcodes: OpcodeTable;
  readonly sounds: VariantSounds;
  /** Arme utilisée sans arme équipée (personnage-arme), -1 : aucune. */
  readonly defaultWeapon: number;
  /** Objet posé sur les emplacements « bonus » (hotspot 11), -1 : aucun. */
  readonly bonusTile: number;
  /** Un tick d'IA d'un monstre actif et vivant, selon son type de déplacement. */
  moveMonster(m: Monster, host: MonsterHost): void;
  /** Tuile affichée pour un monstre (Yoda : monstres animés) ; par défaut, l'image tournée dans la direction du regard. */
  monsterTile?(m: Monster): number;
  /** Mange / boit / utilise un objet sur le héros. Renvoie faux si l'objet ne se consomme pas (son « impossible »). */
  consume(game: Game, tile: number): Promise<boolean>;
  /** Parole propre au jeu quand le héros cogne un PNJ ; renvoie vrai si elle remplace le texte de puzzle du secteur. */
  talkToNpc?(game: Game, tile: number, at: Point): Promise<boolean>;
  /** Score de fin de partie gagnée. */
  score(game: Game): number;
  /** Son joué : le jeu peut en tenir compte (Indy enregistre la difficulté à chaque son « manger »). */
  onSound?(game: Game, id: number): void;
  /**
   * Indy : le briefing s'affiche et l'objet de départ est remis dès le démarrage (Marcus).
   * Yoda : il donne les deux quand on lui parle (`talkToNpc`).
   */
  readonly briefingOnStart: boolean;
  /**
   * Yoda : une cible bloquée fait glisser le héros (axe horizontal, puis vertical, puis contournement en diagonale),
   * comme `Hero.move` de WebFun. Indy : seule la case visée compte.
   */
  readonly slideOnBlock?: boolean;
  /** Yoda : cogner un objet déclenche d'abord les points chauds (PNJ, objets), puis les scripts. Indy : l'inverse. */
  readonly hotspotsBeforeBumpScripts?: boolean;
  /**
   * Yoda : tout changement de pièce (porte, `ChangeZone` d'un script, véhicule) évalue aussi les conditions
   * `EnterByVehicle` dans la zone d'arrivée (`RoomTransitionScene` de WebFun, mode `ByPlane`) : les atterrissages
   * animés des zones en dépendent. Indy : seuls les véhicules le font.
   */
  readonly byVehicleOnRoomChange?: boolean;
  /** Munitions d'une arme pleine (-1 : illimitées). Sans ce crochet, toutes les armes sont illimitées. */
  maxAmmo?(weapon: Character): number;
  /** Son joué en équipant l'arme (-1 : aucun). */
  equipSound?(weapon: Character): number;
  /** L'objet (tuile d'arme) peut-il être équipé ? Par défaut, toute tuile d'arme. */
  canEquip?(tile: number): boolean;
  /**
   * Un verrou (hotspot Lock) du secteur prend-il l'objet demandé (objet retiré, verrou ouvert) ? Par défaut, toujours.
   * Yoda : seulement hors des secteurs à puzzle ou une fois le puzzle résolu ; sinon, ce sont les scripts de la zone qui
   * décident (`executePlacedTileHotspots` de WebFun).
   */
  lockAccepts?(sector: Sector): boolean;
  /** Objet posé sur une case, avant les règles communes (verrous, PNJ) ; renvoie vrai s'il a été traité (sans les scripts). */
  onPlaceTile?(game: Game, tile: number, at: Point): Promise<boolean>;
  /**
   * Objet posé sur une case que les règles communes (verrou, PNJ) n'ont pas prise : règle de puzzle propre au jeu. Renvoie
   * vrai s'il a été pris ; les scripts « objet posé » de la zone s'exécutent ensuite dans tous les cas.
   */
  placeOnPuzzle?(game: Game, tile: number, at: Point): boolean;
  /** Coup porté à un monstre ; renvoie vrai si le jeu l'a traité lui-même (Yoda : la Force immobilise). */
  hitMonster?(game: Game, monster: Monster, weapon: Character): boolean;
}
