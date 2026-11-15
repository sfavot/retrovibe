# Ween : rendu, comparaison au banc ScummVM (vague R)

Le rendu de Ween est celui du moteur Coktel commun (`src/engine/coktel/graphics`, `video`, `mult`, `render`). Cette vague le compare au banc ScummVM, image par image, sur l'écran de 320 × 200 (indices de couleur et palette), et corrige le moteur commun là où il diverge. Test : `test/ween/render/frames.test.ts`.

## Ce qui est comparé

- **Banc** : captures `GOB_SHOT_FRAMES` / `GOB_SHOT_DIR` (`fr-NNNNN.idx`, indices bruts de l'écran 320 × 200 sans curseur, et `.pal`, palette 0-255 ramenée à 6 bits par `>> 2`), aux mêmes « images » que les traces de `test/ween/engine/boot.test.ts` (`Host.markImage()`), en temps virtuel, graine 1. Lancer le banc **avec une configuration privée** (le banc réécrit sa config en sortant) et un seul ScummVM à la fois.
- **Portage** : `test/ween/render/capture.ts` rejoue Ween avec le harnais de `bench.ts` et relève `composeIndexed` (`render/canvas.ts` : surface avant, défilement, zone fixe du bas, sans curseur) et `GraphicsCore.shown` aux images voulues.
- **Références** : empreintes compactes (`LxH:sha1 des indices:sha1 de la palette`) dans `test/ween/fixtures/frames.json` (≈ 15 Ko), produites par `npx vite-node test/ween/render/make-frames.mts <scénario> <dossier des captures>`.

**Écran de ScummVM = dernier `Video::retrace`.** Le banc relève l'écran de l'`OSystem`, que ScummVM ne met à jour qu'aux retraces (`waitRetrace`, fin de `waitEndFrame`, image voulue d'un film, `Draw::animateCursor`) ; le portage présente la surface avant en continu. Sans modèle, toute animation (volet de `INTRO0`) a une image de retard. Le harnais relève donc l'écran aux mêmes points (`GraphicsCore.retrace()`, crochet `onRetrace`, appelé après l'image voulue d'un film ; attentes `waitRetrace` et `animateCursor` repérées dans `capture.ts`) ; la palette est celle du moment (ScummVM la pose aussitôt). Avec ce modèle, les images qui suivent un déplacement de la souris (survol d'une icône, fenêtre de menu) sont aussi identiques.

## Identité atteinte (aux images échantillonnées)

| Scénario | Images comparées | Résultat |
|---|---|---|
| Introduction regardée jusqu'à `EMAJ1000` (7 800 images : surfaces **640 × 200** avec défilement, 5 IMD, fondus, palettes animées, `MENU`, `EMAJ1000`) : une image sur 50, images de changement de TOT et la suivante, 3 premières images | 180 | identiques |
| Échap → `MENU` → `EMAJ1000` → menu des options (survol de l'icône, fenêtre « SAUVER / CHARGER / QUITTER ») → « Quitter » (723 images) : une image sur 10, images d'entrées de la souris | 98 | identiques |
| `EMAJ1000` : boule de cristal, suspension (survol, clic, textes, animations), images 400 à 1 500 (une sur 10, plus autour des clics) | 120 | identiques |

**Non atteints** : `EMAJ1008` (surface 320 × 465, défilement vertical par script) et `EMAJ1010` (panorama 640 × 200 en jeu). Les deux salles ne se joignent que par des sorties de la partie ; la salle de départ n'a répondu à aucun clic d'une grille de 30 × 20 pixels (ni bords) en dehors de deux objets, et le chemin du banc (`GOB_INPUT`) demande de jouer la partie. Le défilement des surfaces larges est en revanche couvert par l'introduction (`INTRO.TOT` : 640 × 200 pendant tout le démarrage, `o2_setScrollOffset`) ; la hauteur 465 n'est vérifiée que par les tests de Lost in Time (fenêtre de 640 × 400, défilement).

## Divergences trouvées

1. **Palette des films (corrigée, moteur commun)** : `VideoPlayer.copyPalette` ne recopiait que les index que le film dessine (écart de Lost in Time, constat 13 du rapport QA : des films dont la plage inutilisée est un aplat blanc écrasent la palette des sprites de Melkior). Les IMD d'`INTRO1.TOT` ne dessinent qu'un détail et portent la palette de tout l'écran : décor et texte restaient noirs (600 des 768 octets de palette différents du banc, images 793 à 1 130). Option `VideoPlayerOptions.restrictPalette` (vraie par défaut, Lost in Time) ; **faux pour Ween**, qui recopie toute la plage comme ScummVM. Il reste à câbler : voir « Points ouverts ».
2. **Retrace** : ajout de `GraphicsCore.retrace()` / `onRetrace` et de `composeIndexed` (voir ci-dessus). Sans effet sur le rendu du jeu.
3. **Accents des polices-sprites (écart assumé, déjà celui de Lost in Time)** : ScummVM lit les caractères d'une police faite d'une planche de sprites comme un `char` signé ; les accents (CP850, > 0x7f) donnent une case négative qui n'est pas dessinée. Dans Ween, les textes de l'écran de la prophétie d'`INTRO2` (« éclipse », « déposera », « anéantira ») perdent leur « é » dans ScummVM ; le portage les dessine, comme le jeu d'origine. `DrawImpl.signedSpriteChars` (faux par défaut) reproduit ScummVM : le harnais l'active pour comparer (sans lui, les images 1 250 à 1 400 diffèrent de 246 pixels, les trois « é »).

Le reste, à ce niveau d'échantillonnage, était déjà identique : rendu des surfaces, `Surface` (blits, texte, lignes), palettes, fondus (`PalAnim`), animations (`Scenery`, `Mult`), IMD, curseur et survol, zones et fenêtres.

## Lost in Time

`npx vitest run test/lost-in-time test/coktel` : 312 tests verts, avant et après (aucun hachage de LiT modifié). Navigateur (`lit-dev`) : introduction (écran-titre animé, cinématique de vagues, puis première scène à Échap), texte, survol de la scène et de l'affiche (curseur propre à l'objet, fenêtre zoomée, texte) corrects, sans erreur de script. Défilement non atteint dans ce parcours.

## Points ouverts

- **Câblage de `restrictPalette`** (hors de la zone de cette vague) : dans `src/engine/coktel/system.ts`, `installVideo(sys, gfx, { videosWithCursor: definition.videosWithCursor, restrictPalette: definition.version >= 3 })` (Lost in Time = v3 garde son écart, Ween en v2 copie toute la plage). Sans cette ligne, l'introduction de Ween perd la palette de `INTRO1` dans le navigateur. Le harnais de test force déjà `false`.
- Itinéraire jusqu'à `EMAJ1008` / `EMAJ1010` pour ajouter 320 × 465 et le panorama en jeu (parcours de jeu connu, ou jeu de sauvegarde du banc).
- Le banc a donné une fois une référence différente (introduction, images 3 550 à 5 000) pendant qu'un autre ScummVM tournait ; deux rejeux ultérieurs sont identiques entre eux et au portage. Refaire les références seul sur la machine.
- Modèle de retrace du harnais : les `advanceClock(…, 10)` et `waitRetrace` sont repérés par la pile d'appels ; un crochet `Host.retrace?()` appelé par `waitRetrace`/`advanceClock`/`FrameTimer.waitEndFrame` (`host.ts`) le rendrait explicite.
