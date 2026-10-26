/**
 * Numéros de son passés à `gm_sound_play` / `gm_sound_loop_start` / `gm_sound_loop_stop` dans l'exécutable
 * (relevé exhaustif des appelants dans `archives/swiv3d/re/decomp`, 26 numéros = les 26 ressources de SOUNDS.BD).
 * Les noms sont déduits des appelants (nombre d'appels entre parenthèses) ; `certain` = déclencheur lu dans
 * le code, `probable` = sens déduit du contexte.
 */
export interface SoundInfo {
  name: string;
  /** Boucle moteur démarrée par `gm_sound_loop_start` (sinon son ponctuel). */
  loop?: boolean;
  /** Ce qui le déclenche. */
  trigger: string;
  confidence: "certain" | "probable";
}

export const SOUND_CATALOG: Readonly<Record<number, SoundInfo>> = {
  1000: { name: "grande explosion", trigger: "gm_object_explode (00443ac0) : objet détruit avec décalque d'explosion 900-902", confidence: "certain" },
  1001: { name: "petite explosion", trigger: "00443d3c, tourelle/bonus/avion/hélico/bateau/véhicule/épave détruits, choc d'avion au sol (objects.md)", confidence: "certain" },
  1003: { name: "explosion / chute", trigger: "00443e00, kamikaze, avion de nœud, chasseur détruits, chute (objects.md)", confidence: "probable" },
  2000: { name: "tir du joueur", trigger: "armes spéciales des vaisseaux 0-5 (109 appels) : lancement du missile / tir (rules.md : « son 2000 »)", confidence: "certain" },
  2001: { name: "tir ennemi", trigger: "gm_enemy_fire, code d'arme de base", confidence: "certain" },
  2002: { name: "tir ennemi (balles)", trigger: "gm_enemy_fire, armes à balles (14 appels)", confidence: "certain" },
  2003: { name: "tir ennemi (variante)", trigger: "gm_enemy_fire (3 appels)", confidence: "probable" },
  2004: { name: "faisceau 700", trigger: "gm_enemy_fire, arme 700 (objects.md)", confidence: "certain" },
  2005: { name: "faisceau 701", trigger: "gm_enemy_fire, arme 701 (objects.md)", confidence: "certain" },
  3000: { name: "arme armée / sortie de soute", trigger: "armes spéciales : création du missile attaché (76 appels)", confidence: "probable" },
  3001: { name: "arme rétractée", trigger: "armes spéciales : arme changée ou plus de munitions (76 appels, rules.md)", confidence: "certain" },
  3002: { name: "nacelle larguée", trigger: "armes spéciales : pod lâché (28 appels)", confidence: "probable" },
  4000: { name: "bonus aspiré (vol)", trigger: "004463c0, bonus ramassé par un véhicule aérien", confidence: "certain" },
  4001: { name: "jauge d'énergie", trigger: "gm_game_tick, image 16 franchie à la hausse / 26 à la baisse (rules.md)", confidence: "certain" },
  4002: { name: "bonus aspiré (sol)", trigger: "004463c0, bonus ramassé par un véhicule au sol", confidence: "certain" },
  4010: { name: "atterrissage dur", trigger: "gm_vehicle_physics_1/2/4/5 : vitesse verticale < -0x44c au contact du sol", confidence: "certain" },
  4011: { name: "atterrissage très dur", trigger: "idem avec vitesse verticale < -0x76c", confidence: "certain" },
  4020: { name: "vaisseau : train / transition", trigger: "arme spéciale du vaisseau 4-5 (image 0x1a)", confidence: "probable" },
  5000: { name: "moteur d'hélicoptère", loop: true, trigger: "gm_player_set_form(0), boucle ; arrêt au changement de forme ou à la mort", confidence: "certain" },
  5001: { name: "moteur de véhicule", loop: true, trigger: "gm_player_set_form(1, 2, 4), fréquence 11000 Hz", confidence: "certain" },
  5002: { name: "moteur de véhicule 3", loop: true, trigger: "gm_player_set_form(3), pilote qui meurt", confidence: "probable" },
  6000: { name: "ouverture pause / réglages", trigger: "gm_frame : écran de pause, réglages, triche (3 appels)", confidence: "certain" },
  6001: { name: "fermeture pause / réglages", trigger: "gm_frame : au retour de ces écrans", confidence: "certain" },
  6002: { name: "menu : choix", trigger: "gm_menu_run, touche de sélection (0x50)", confidence: "probable" },
  6003: { name: "menu : validation", trigger: "gm_menu_run, Entrée / Échap, capture de touche", confidence: "probable" },
  6004: { name: "menu : déplacement", trigger: "gm_menu_run, flèches (4 appels)", confidence: "probable" },
};

/** Numéros de son pour lesquels l'exécutable utilise `gm_sound_loop_start`. */
export const LOOP_SOUNDS: readonly number[] = Object.entries(SOUND_CATALOG)
  .filter(([, info]) => info.loop)
  .map(([n]) => Number(n));
