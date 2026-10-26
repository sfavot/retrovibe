# SWIV 3D — plan de la phase 2 (jeu jouable)

Brief commun des sous-agents. Références : `re-index.md` (fonctions nommées), `global-bd.md`, `slv.md`, `models.md`, `smacker.md`, `files.md`.

## Avancement

- Phase 1 faite (commits `96ac665`, `f10ef04`) : extraction, corpus Ghidra de `SWIV_WIN.EXE`, lecteurs de toutes les données, décodeur Smacker partagé, visionneuse.
- Phase 2 : vagues ci-dessous. R1-R5, S1-S2 faites (`player.md`, `objects.md`, `rules.md`, `render.md`, `screens.md` ; `src/ui/held-input.ts`, `src/ui/touch-controls.ts`), noms Ghidra fusionnés (338 fonctions nommées) et formats corrigés. Vague G faite : monde (`engine/`), rendu (`render/`), son (`audio/`) et première boucle jouable `ui/dev.html` (vol libre dans un niveau). Vague H faite : gameplay (comportements, armes, bonus, score, objectifs, game over), HUD et radar, écrans (démarrage, menus, pilotes, briefings, script des missions), tout branché dans la partie. Vague J faite : le jeu est sur l'accueil (jaquette, écran titre, manuel). Vague K : robot de campagne (`campaign.test.ts`) : les 4 missions se terminent en invulnérable ; sans aide, le robot (sans esquive) finit TERRAN00 et meurt sous les tirs dans TERRAN01 et TERRAN03 ; TERRAN02 dépend de l'énergie reportée (terminé avec 391 au départ, game over avec 481 depuis le portage des pilotes de fin : parcours chaotique, pas une régression).
- Passe finale faite : messages et titres de menu en texte 3D (messages du monde avec `serial`, teinte et type ; durée 71 ticks), pause (monde figé mais dessiné, n'importe quelle touche la ferme), écran de fin devant le monde qui continue de tourner, viseurs jaune (cible `+0x58`) / rouge (objectif de tête), formes véhicule, armes spéciales, amarrage, cratères, déformations du terrain (onde de la bombe, mur d'eau de la méga-bombe, réserve de 5 qui retarde mortier et bombes, `render.md` §10), décompte de fin de mission. Pièces de dessin communes (`Menu`, `TextRenderer`) dans `ui-draw/`.
- À revoir : l'oscillation d'altitude de l'hélicoptère suit le désassemblage ligne à ligne (non comparée au jeu) ; position et vitesse exactes des titres 3D de chaque menu (tous au centre, comme le type 11) ; fenêtre des cratères en hypothèse ; constantes de frottement des formes 4 et 5 à relire dans `00445a84` / `00445f44` ; pilotes de fin de niveau (`player.md` §3.11) et mort portés depuis le désassemblage, non comparés au jeu (le tangage d'équilibre de l'hélicoptère, le cercle du buggy) ; derrière l'écran de fin, le clavier est vidé à chaque image comme dans l'exe et seule la manette arrive encore au pilote des formes 4 et 5 (la souris n'est pas relue, pointeur déverrouillé) ; écran de fin et monde y gardent chacun leur horloge de 40 Hz (au pire un tick d'écart pour la garde des 110) ; non portés car absents des niveaux livrés : départ 1002 (`00438744`), pilote `00438c68` (plates-formes 7012/7013), boss 8000-8040. Reste : une partie complète jouée à la main.
- Menus d'origine complétés : Gamma (table `gm_gamma_build` appliquée à toutes les palettes présentées), Contrôleur (type clavier / souris / manette, redéfinition des 11 touches enregistrée dans la fiche du pilote et appliquée au jeu, liens d'axes, « Attacher au centre » ; calibrage non porté : la Gamepad API rend des axes calibrés), mode test (`SWIV!AndLetDie`, « Tester la mission »), menu Tricher (F12 en mission de test) et Setup en jeu (F1, monde figé, profil rechargé à la sortie) ; cadre exact du menu principal (« Quitter » entre deux traits). Non portés : commandes de débogage, F3..F8 / F11, taille d'écran et détail (`screens.md` §4.3, §4.4, §4.9, §11).
- Rendu établi par R4 : mode X 320×400 8 bits, pixels non carrés (affichage 4:3), terrain en bandes verticales (pas de triangles), palette SLV 11003 et tables de lumière 128×256 des blocs 12xxx. Tick logique 40 Hz (R1).

## Décisions

- **Contenu** : la version « Temperate Zone » livrée : `TERRAN00` à `TERRAN03` enchaînés par le script des missions (bloc 600), plus la démo d'attente (`DEMO.SLV`). Les 13 autres missions du script n'ont pas de fichiers : hors périmètre.
- **Langues** : français par défaut, anglais disponible. Pas les 6 autres.
- **Rendu** : portage du rendu logiciel de `SWIV_WIN.EXE` dans une image indexée 8 bits, présentée par `IndexedPresenter` (`src/ui/indexed-canvas.ts`). Fidèle à l'original (palettes, tables de fondu 108/109, brouillard), et le moteur reste pur, donc testable sans navigateur. Pas de WebGL.
- **Cadence** : celle du jeu d'origine, à mesurer en R1 ; boucle à pas fixe (`FixedStepClock`), rendu à chaque image du navigateur.
- **Musique** : pistes du CD en MP3 via `TrackPlayer` ; sons de `SOUNDS.BD` via Web Audio (`src/audio/pcm.ts`), panoramique et volume 3D comme `gm_sounds_update_3d`.
- **Hors périmètre** : multijoueur (DirectPlay), écran partagé, variantes 3Dfx/D3D, éditeur de niveau. Le « mode test niveau » de l'original (missions de test et menu Tricher) est porté.
- **Code commun** : coquille `src/ui/game-shell.ts`, `FixedStepClock`, `prefixedStorage`, `bindKeyboard`, `SoundPrefs`, `TrackPlayer`, `fetchGameFiles`. À mutualiser en plus (vague S) : l'état des touches maintenues et la manette (`src/ui/held-input.ts`, d'après `games/indy/ui/move-keys.ts`), les commandes tactiles d'un jeu d'action (`src/ui/touch-controls.ts`).

## Décisions à prendre

- Sauvegarde : fiches pilote décrites en R5 (`screens.md`) ; stockage `localStorage` préfixé `swiv3d:`.

## Vagues

| Vague | Tâche | Contenu | Dépend de |
| --- | --- | --- | --- |
| R | R1 | Boucle, cadence, joueur : modèle de vol, caméra, commandes et touches → `docs/swiv3d/player.md` | — |
| R | R2 | Objets : table des types 1000-14000 (modèle, points de vie, comportement), IA, chemins 107, collisions → `objects.md` | — |
| R | R3 | Armes, bonus, score, vies, règles de fin de niveau, HUD → `rules.md` | — |
| R | R4 | Rendu : résolution, caméra, rastériseur du terrain (atlas 12000, tables 108/109, brouillard, ciel), des modèles (types de face), des sprites → `render.md` | — |
| R | R5 | Écrans et enchaînement : menus, pilotes et sauvegarde, vidéos et `.SCR`, script 600, musique par niveau → `screens.md` | — |
| S | S1 | `src/ui/held-input.ts` : touches maintenues, appuis brefs, manette (Gamepad API), relâchement sur perte de focus ; Indy migré dessus | — |
| S | S2 | `src/ui/touch-controls.ts` + CSS : manche virtuel et boutons de tir pour la mise en page tactile paysage | — |
| G | G1 | Monde pur : objets, joueur, physique et collisions au pas fixe, terrain torique (`heightAt`) | R1, R2 |
| G | G2 | Rendu logiciel : terrain, modèles, sprites, brouillard → image indexée | R4 |
| G | G3 | Son : banque `SOUNDS.BD`, sons 3D, musique par contexte | R5 |
| H | H1 | Ennemis, armes, bonus, score et vies | G1, R3 |
| H | H2 | HUD : jauge, armes, viseur, radar, score, textes | G2, R3 |
| H | H3 | Écrans : titre, menus, vidéos avec textes `.SCR`, script des missions, pilotes | G3, R5 |
| J | J | Intégration : `index.ts`, registre, jaquette, `dev.html`, commandes tactiles, manuel | H |
| K | K | Validation : parcours des 4 niveaux, tests, build, rendu navigateur | J |

R1 à R5, S1 et S2 tournent en parallèle (aucun fichier en commun). Chaque vague finit par `npm run typecheck`, `npm test`, `npm run build`, et une vérification dans le navigateur dès qu'il y a du rendu.

## Dette technique notée

- Polonais et tchèque (page de glyphes 1) non décodés : hors périmètre.
- Restes sans conséquence pour un port : SLV 104 (jamais chargé), SLV 200/501 (absents des fichiers livrés), bit `0x10` des drapeaux de `GLOBAL.BD` (jamais testé), bloc 502 de `GLOBAL.BD` (chargé, jamais dessiné) et table de 8 192 octets des écrans 1001-1005 hors radar.
- Non étudiés : les `GLOBAL.BD` de l'installation (blocs 1, 100, 600, 1000, 1003 différents) et les variables 1 et 2 du script de missions (énergie initiale, niveau d'arme : hypothèses).
