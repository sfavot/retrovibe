# SWIV 3D — plan de la phase 2 (jeu jouable)

Brief commun des sous-agents. Références : `re-index.md` (fonctions nommées), `global-bd.md`, `slv.md`, `models.md`, `smacker.md`, `files.md`.

## Avancement

- Phase 1 faite (commits `96ac665`, `f10ef04`) : extraction, corpus Ghidra de `SWIV_WIN.EXE`, lecteurs de toutes les données, décodeur Smacker partagé, visionneuse.
- Phase 2 : vagues ci-dessous.

## Décisions

- **Contenu** : la version « Temperate Zone » livrée : `TERRAN00` à `TERRAN03` enchaînés par le script des missions (bloc 600), plus la démo d'attente (`DEMO.SLV`). Les 13 autres missions du script n'ont pas de fichiers : hors périmètre.
- **Langues** : français par défaut, anglais disponible. Pas les 6 autres.
- **Rendu** : portage du rendu logiciel de `SWIV_WIN.EXE` dans une image indexée 8 bits, présentée par `IndexedPresenter` (`src/ui/indexed-canvas.ts`). Fidèle à l'original (palettes, tables de fondu 108/109, brouillard), et le moteur reste pur, donc testable sans navigateur. Pas de WebGL.
- **Cadence** : celle du jeu d'origine, à mesurer en R1 ; boucle à pas fixe (`FixedStepClock`), rendu à chaque image du navigateur.
- **Musique** : pistes du CD en MP3 via `TrackPlayer` ; sons de `SOUNDS.BD` via Web Audio (`src/audio/pcm.ts`), panoramique et volume 3D comme `gm_sounds_update_3d`.
- **Hors périmètre** : multijoueur (DirectPlay), écran partagé, variantes 3Dfx/D3D, éditeur de niveau (« Level Test Mode »).
- **Code commun** : coquille `src/ui/game-shell.ts`, `FixedStepClock`, `prefixedStorage`, `bindKeyboard`, `SoundPrefs`, `TrackPlayer`, `fetchGameFiles`. À mutualiser en plus (vague S) : l'état des touches maintenues et la manette (`src/ui/held-input.ts`, d'après `games/indy/ui/move-keys.ts`), les commandes tactiles d'un jeu d'action (`src/ui/touch-controls.ts`).

## Décisions à prendre

- Résolution d'origine (320×200 ou 320×240 en mode X, option « Screen Size ») : établie en R4, on garde celle du jeu.
- Sauvegarde : le jeu garde des pilotes (« Select Pilot ») et une progression ; format exact en R5, stockage `localStorage` préfixé `swiv3d:`.

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
- Blocs non élucidés : `GLOBAL.BD` 450-452, 500, 502 ; SLV 104, 106, 500 ; drapeaux 0x02 et 0x10 du bloc 2.
