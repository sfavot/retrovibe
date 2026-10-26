/**
 * Contrat entre le monde (qui décide quand un son part) et le son (qui le joue).
 *
 * Unités : les positions sont en **unités monde**, c'est-à-dire les coordonnées 8.8 du moteur d'origine
 * divisées par 256 (l'exécutable lit `objet+0x1c/0x20/0x24 >> 8` et la caméra tronquée à l'entier).
 */

/** Demande de son émise par le monde (`gm_sound_play(objet, numéro)` dans l'exécutable). */
export interface SoundRequest {
  /** Numéro de son (`id / 100` de SOUNDS.BD : 1000, 2000, 4002…), voir `catalog.ts`. */
  sound: number;
  /** Position de la source, en unités monde. */
  x: number;
  y: number;
  z: number;
  /**
   * Objet émetteur. L'exécutable garde un pointeur sur l'objet et relit sa position à chaque image : si
   * un résolveur d'émetteurs est installé (`SoundSystem.setEmitterResolver`), la source suit l'objet.
   */
  objectId?: number;
  /** `false` : son d'interface (menus, pause), joué sans panoramique ni atténuation. Vrai par défaut. */
  spatial?: boolean;
}

/** Position (et fréquence de boucle) d'un émetteur vivant. */
export interface EmitterState {
  x: number;
  y: number;
  z: number;
  /** Boucles de moteur : fréquence de lecture en Hz (`objet+0x190`, 11000 pour les véhicules au sol). */
  frequency?: number;
}

/**
 * Auditeur = caméra de la vue (l'exécutable utilise la position entière de la caméra lissée et ses vecteurs
 * avant `F = trunc(256·f)` et droite `R = trunc(256·r)`).
 */
export interface Listener {
  x: number;
  y: number;
  z: number;
  /** Cap en radians, 0 = regarde vers +z, croissant vers +x (`avant = (sin yaw, 0, cos yaw)`, `droite = (cos yaw, 0, -sin yaw)`). */
  yaw: number;
  /** Base exacte de la caméra (vecteurs unitaires) ; prioritaire sur `yaw` quand le rendu la fournit (tangage compris). */
  forward?: readonly [number, number, number];
  right?: readonly [number, number, number];
}
