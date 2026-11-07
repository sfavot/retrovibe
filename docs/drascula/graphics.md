# Drascula : rendu

Référence du rendu de *Drascula* (`src/games/drascula/render/`) : surfaces, composition, palettes, police, texte, héros réduit, interface. Les formats sont dans `formats.md`,
le moteur dans `engine.md`, le plan dans `plan.md`. La **référence de comportement est le moteur `drascula` de ScummVM** (`graphics.cpp`, `palette.cpp`, `actors.cpp`, `interface.cpp`,
`rooms.cpp`, `objects.cpp`, GPL v3+) : chaque module cite ses fonctions d'origine et ses écarts en tête ; rien n'est transposé ligne à ligne.

**Confiance** : **lu** = lu en entier dans ScummVM ; **vérifié** = couvert par un test (`test/drascula/render/`), sur les fichiers du jeu quand c'est dit ; **vu** = contrôlé dans le navigateur (page `render-dev.html`) ; **supposé** = déduit.

## 1. Modules

| Module | Rôle | ScummVM |
| --- | --- | --- |
| `plane.ts` | `Plane` : plan 320 x 200 indexé ; `copyBackground`, `copyRect` (255 transparent), `reduce` (héros réduit) | `copyBackground`, `copyRect`, `reduce_hare_chico` |
| `palette.ts` | `GamePalette` : palette du jeu en 6 bits, lumière de pièce, fondus, couleur du texte ; aides de palette des fichiers (`scummvmRgb8`, `halfPalette`) | `setRGB`, `setPalette`, `black`, `color_abc`, `fadeToBlack`, `fadeFromBlack`, `assignPalette`, `setDefaultPalette`, `setPaletteBase` |
| `font.ts` | `GameFont` : table de caractères, `print` (police du jeu), `printChoice` et `measureChoice` (choix de dialogue) ; `layoutCenteredText`, `centerText` | `print_abc`, `print_abc_opc`, `textFitsCentered`, `centerText` |
| `renderer.ts` | `DrasculaRenderer` : surfaces, chargement des images d'un chapitre et d'une pièce, composition (`compose`), prise de main des séquences (§ 11 : `owner`, `canvas`, `Scene`, `TalkView`, `ChoiceMenu`), héros, inventaire, barre des verbes, curseur | `loadPic`, `moveCursor`, `updateRoom`, `updateRefresh_pre`, `updateRefresh`, `moveCharacters` (dessin), `showMenu`, `clearMenu`, `enterRoom` (images), début de `run()`, `clearRoom` |
| `heads.ts` | les têtes qui parlent (vagues T) : une vue par personnage (`heroHead`, `igorHead`, `drasculaHead`…) | corps des boucles de `talk_*` (`talk.md`) |
| `actors.ts` | Igor, Drascula, Von Braun dessinés | `placeIgor`, `placeDrascula`, `moveVonBraun` |

Le code partagé avec la visionneuse (`ui/viewer-data.ts`, `ui/panels.ts`) vient d'ici : palettes (`scummvmRgb8`, `scummvmRgb6`, `halfPalette`), constantes et table de la police, dessin des textes (`GameFont`).
Aucun module commun du dépôt n'est modifié : l'image est présentée par `host.present` (voir § 8) et peinte par `IndexedPresenter` (`src/ui/indexed-canvas.ts`) côté navigateur.

## 2. Surfaces

ScummVM a une dizaine de tampons de 320 x 200 octets (`allocMemory`) ; le rendu garde leurs rôles et des noms lisibles, parce que les pièces (vague P) en rechargent certaines (`loadPic("tlef2.alg", frontSurface)`) :

| Surface | ScummVM | Contenu |
| --- | --- | --- |
| `screen` | `screenSurface` | l'image envoyée à l'écran |
| `bg` | `bgSurface` | décor de la pièce (`n.ALG`, `HALF_PAL`) ; au chapitre 3, `aux13.alg` au départ |
| `draw3` | `drawSurface3` | feuille annexe de la pièce (`AUXn.ALG`, champ de la fiche) : source de `roomPreUpdates` / `roomUpdates` ; son coin haut gauche (40 x 25) reçoit l'icône de `back` (0, 171) |
| `draw2` | `drawSurface2` | feuille du chapitre (`pts.alg` au chapitre 2 ; les cinématiques et les pièces en chargent d'autres) |
| `front`, `back`, `extra` | `frontSurface`, `backSurface`, `extraSurface` | le héros de face (`96.ALG`), de dos (`99.ALG`), de côté (`97.ALG`) ; au chapitre 2, les images de la fiche de la pièce |
| `table` | `tableSurface` | la police (`95.ALG`) |
| `cursor` | `cursorSurface` | les icônes des verbes (`99.ALG`, ordonnée 171) |

`renderer.loadPic(nom, surface, nombreDeCouleurs)` fait comme `loadPic` : l'image va dans la surface et ses `nombreDeCouleurs` premières couleurs dans la palette du jeu (`COMPLETE_PAL` 256, `HALF_PAL` 128 ; **sans nombre, 1 seule couleur** :
la couleur 0 est réécrite à chaque chargement). Les images sont décodées une fois (`image(nom)`, cache par nom insensible à la casse) ; `host.readFile` doit pouvoir les lire de façon synchrone (l'hôte du navigateur les précharge, vague J :
`96`, `97`, `99`, `95`, `icons*.alg`, `pts.alg`, `aux13.alg`, `n.alg` et `AUXn.alg` des pièces, et les images de héros du chapitre 2).

`startChapter(chapitre)` (début de `run()`) : `96.ALG` en `COMPLETE_PAL` (sauf au chapitre 3 : `aux13.alg` donne la palette, puis `96.ALG` sans palette), `99.ALG` dans `cursor`, `95.ALG` dans `table`, `pts.alg` au chapitre 2 ;
hors chapitre 2, `99.ALG` dans `back` et `97.ALG` dans `extra` ; puis la lumière de base est mémorisée (`defaultPalette`).
`enterRoom(pièce, chapitre)` : au chapitre 2, les quatre images du héros de la fiche (face, côté, dos ; ou `96`, `97`, `99` par défaut) ; puis `draw3` = feuille annexe, `bg` = décor en `HALF_PAL`, icône (0, 171) de `back` recopiée en haut de `draw3`, niveaux de lumière.

## 3. Palettes

**Lu** (`palette.cpp`). Le jeu garde **une** palette de 256 couleurs en **6 bits** (valeur du fichier divisée par 4) ; l'écran reçoit cette palette multipliée par 4 : les deux bits de poids faible sont perdus
(`GamePalette.shown`, RVB 8 bits, ce que `present` envoie). `HALF_PAL` : un décor ne remplace que les 128 premières couleurs ; les 128 dernières (héros, interface) restent celles de `96.ALG`. **Vérifié** sur les fichiers
(`palette.test.ts`, `renderer.test.ts`).

- **Lumière de pièce** : les couleurs **235 à 252** (18 couleurs) portent l'éclairage. `setPaletteBase(n)` les assombrit : pour `fade` de `n` à 0, chaque composante devient `adjustToVGA(valeur - 8 + fade)` (zéro si le résultat est négatif, sinon `& 63`).
  `enterRoom` en fait deux versions à partir de la lumière de base : **`bright`** (niveau de la fiche ; la base elle-même si le niveau est 0) et **`dark`** (niveau + 2), puis la pièce démarre en `bright`. Les pièces échangent les deux selon la position du héros (`update_1_pre` : `dark` si
  `98 < x < 153` dans la pièce 1) : `renderer.palette.useLight(palette.dark)` / `useLight(palette.bright)`, pour la vague P. Vérifié : `palette.test.ts` (valeurs calculées à la main), au moins une pièce a un niveau non nul.
- **Couleur du texte** : la couleur **254** (les glyphes de `95.ALG` sont en 254, le fond en 255 transparent). `setTextColor(kColor*)` copie une entrée de `colorTable` (6 bits) dans la couleur 254. Le rose (11) a des valeurs hors des 6 bits (98, 91, 100) : multipliées par 4 puis tronquées à un octet,
  elles donnent (136, 108, 144), comme à l'écran. Couleurs : brun, bleu foncé, vert clair, vert foncé, jaune, orange, rouge, bordeaux, violet, blanc, rose (`TextColor`).
- **Écran noir** (`black`) : tout noir sauf la couleur 254 (jaune) ; la palette du jeu n'est pas touchée, elle revient au prochain `setPalette`. Fin de chapitre : `renderer.endChapter()`.
- **Fondus** (`fadeToBlack(vitesse)`, `fadeFromBlack(vitesse)`) : 64 pas ; à chaque pas chaque composante perd `63 - niveau` (jamais sous zéro), après un `pause(vitesse)`. Ce sont des séquences du moteur (`engine.fadeToBlack`, `engine.fadeFromBlack`, au moins un tick par pas) ; `palette.fade(niveau)` n'envoie à l'écran que la palette
  atténuée, la palette du jeu reste (vérifié : `engine-render.test.ts`). **Supposé** : la durée d'un fondu (dépend de la cadence).

## 4. Composition d'une image

`renderer.compose(entrée)` refait l'image **entière** depuis l'état (`GameState`), la souris et la réplique : décor (`bg` entier), puis dans l'ordre de `updateRoom` :
1. **`roomPreUpdates`** de `drascula.dat` : pour chaque ligne de la pièce dont `flag < 0` ou `flags[flag] == valeur`, le rectangle (source x y, destination x y, largeur, hauteur) de `draw3` est recopié ; type 0 : copie opaque (`copyBackground`), sinon sans les pixels 255 (`copyRect`) ;
2. point d'accroche `painters[pièce].pre` (`update_N_pre` de la vague P) : **après** la table, comme `updateRefresh_pre` (vague T : l'ordre était inversé en R, corrigé) ;
3. **le héros** (§ 5) ;
4. **`roomUpdates`** (même forme, après le héros) ;
5. point d'accroche `painters[pièce].post` (`update_N`, vague P) ;
6. la réplique (§ 6) ; ou, en boucle principale, le nom survolé et l'inventaire ou la barre des verbes (§ 7) ;
7. le curseur (§ 7), s'il est visible.

`main` distingue la boucle principale (`moveCursor` de ScummVM : nom, inventaire, barre) d'une séquence (les boucles d'attente appellent `updateRoom`, pas `moveCursor` : seuls la pièce, le héros et la réplique sont dessinés). Vérifié : `renderer.test.ts` (rectangles de la pièce 3 et de la pièce 18, ordre pré / héros / post),
`engine-render.test.ts` (pas de barre des verbes pendant une réplique).

## 5. Le héros

**Lu** (`moveCharacters`, `reduce_hare_chico`, `actors.cpp`, `drascula.cpp`). Le héros est un rectangle de **43 x 70** pris dans une feuille selon `track` : 0 gauche = `extra` (97) rangée **0** ; 1 droite = `extra` rangée **72** ; 2 de dos = `back` (99) rangée 72 ; 3 de face = `front` (96) rangée 72
(`DIF_MASK_HARE` = 72). Debout : colonne 0 ; en marche : colonne `frameX[image]` (20 valeurs de `drascula.dat`, image 0 à 5, pas de 43 : 43, 87, 130, 173, 216, 259). Rien n'est dessiné si le héros est invisible, sauf aux chapitres 2 et 3.

- **Hors chapitre 2** : le rectangle est **réduit** par le facteur de la perspective à l'ordonnée des pieds (`factor_red[y + hauteur]`, `engine/perspective.ts`) : taille `43 x f / 100` par `70 x f / 100` (divisions entières), prélèvement d'un pixel de la source tous les `43 / largeur` et `70 / hauteur` (plus proche voisin, pas
  en `float` 32 bits), 255 transparent. **Vérifié** : `plane.test.ts` (facteurs 100 et 50, pixels connus) et `renderer.test.ts` (héros près et loin de la caméra, orientations, image de marche).
- **Chapitre 2** : copie à la taille de la pièce (`curWidth` x `curHeight`), sans réduction ; images de la fiche.
- **Chapitre 3, drapeau 0 levé** : à la place du héros, le rectangle (113, 54, 77 x 89) de `draw3` en `(x - 20, y - 1)`.
- Hors de l'écran, tout est rogné sans erreur (ScummVM `assert` ou lit hors du tampon).

Écart : la taille dessinée est calculée à partir de la position **courante** (`compose` lit `hero.y + hero.height`), alors que ScummVM dessine puis avance d'un pas ; la différence est d'un pas de marche, invisible. La tête qui parle : § 11 et `talk.md`.

## 6. Police, texte et sous-titres

**Lu** (`print_abc`, `print_abc_opc`, `centerText`, `textFitsCentered`) ; **vérifié** (`font.test.ts` sur les vraies feuilles, `renderer.test.ts`). Détail de la table et des glyphes : `formats.md`, « Police ».

- `GameFont.print(dest, feuille, texte, x, y)` : pour chaque octet CP850 du texte (une chaîne JavaScript = un caractère par octet), passage en majuscule (`a`-`z` seulement), recherche dans la table du `.dat` (lettres, signes, accentués ; la première entrée gagne),
  copie du glyphe de 8 x 6 (colonne `mappedChar`, rangée 158 / 169 / 180 selon le type), avance de 8 pixels ; retour à la ligne (colonne 0, 8 pixels plus bas) quand x dépasse 317. Un octet sans entrée recopie le glyphe précédent (ScummVM ne remet pas ses variables à zéro) : seuls « AÏOLI » et « AÏE » du texte français sont touchés (`formats.md`).
- `GameFont.printChoice` : la police des choix de dialogue (glyphes de 6 x 5 de `CAR.ALG`, trois états : non choisi, survolé, cliqué ; apostrophe remplacée par l'octet 164 ; un mot qui ne tient pas avant x = 317 passe à la ligne ; rend le nombre de lignes). Appelée par le menu des choix (§ 11, `converse`) ; `measureChoice` donne le nombre de lignes d'un choix sans le dessiner (placement des zones cliquables).
- **Texte centré** (`layoutCenteredText`, `centerText`) : point `(x, y)` = centre horizontal et haut de la tête du personnage ou position de la souris ; le centre est ramené à 60..255 ; un texte qui tient (`textFitsCentered` : au-delà de 160 le complément à 315, en deçà les deux bords) est sur une ligne, `x = centre - 8 x (longueur / 2) - 1`,
  `y = y - 24` borné à l'écran ; un mot seul qui ne tient pas glisse sur le côté ; sinon le texte est coupé aux espaces (`y = y - (lignes + 2) x 6`, interligne 8) ; **défaut de l'original reproduit** : sur plusieurs lignes, la dernière reçoit un espace final qui décale d'un demi-glyphe, et s'il ne tient plus, une ligne d'un seul espace s'ajoute.
- **Sous-titres** : la réplique en cours (`engine.subtitle` : texte, point, couleur) est dessinée par `compose` avec la couleur de `talk` : jaune pour le héros, sauf au chapitre 4 hors de la pièce 24 quand le drapeau 29 est levé (la couleur courante reste). Les autres personnages (couleurs, points) : `talk.md`, § 3. Vu dans le navigateur : « C'EST LA DEUXIèME PORTE… » en jaune, sur quatre lignes, avec le `È`.
- Écart : l'espagnol (rangées 149 / 160, `974.ALG`) et le russe ne sont pas gérés (français seulement).

## 7. Interface

**Lu** (`showMenu`, `clearMenu`, `selectVerb`, `chooseObject`, `interface.cpp`, `objects.cpp`) ; **vérifié** et **vu**.

- **Nom survolé** (`moveCursor`) : avec un verbe en main (le moteur pose `hasName` / `textName`), le nom s'écrit centré sur la souris, en **rouge** pour le héros (`textmisc[3]`, « hacker ») et en **vert clair** sinon ; la couleur est posée à chaque image de la boucle principale hors de l'inventaire.
- **Barre des verbes** (souris à y < 24, hors inventaire) : sept icônes de 40 x 25 de `cursor` (`99.ALG`) aux abscisses `verbBarX`, en y = 2 ; celle sous la souris est prise à la rangée 0, les autres à la rangée 25. Les mots des icônes sont ceux de `99.ALG` (anglais : « WALK, LOOK, TAKE… », le pack français n'a pas d'autre image).
- **Inventaire** (clic droit) : pour chaque case 1 à 42, si elle est occupée, le fond de la case (`x_pol`, `y_pol`, pris dans `96.ALG`, ou `95.ALG` au chapitre 6) à `itemLocations`, puis l'icône de l'objet (`x1d_menu`, `y1d_menu` dans la feuille d'icônes du chapitre : `icons.alg`, `icons2.alg` au chapitre 4, `icons3.alg`
  au 5, `iconsp.alg` au 6) ; les cases 1 à 6 contiennent les verbes. Le nom du verbe sous la souris (`textverbs`) s'écrit 7 pixels au-dessus de sa case.
- **Curseur** : 40 x 25, point chaud (20, 17), 255 transparent : l'icône du verbe tenu (colonne `40 x verbe`), l'icône de l'objet tenu, ou l'icône « aucun verbe » (colonne 0) ; dans l'inventaire les icônes de verbes sont à la rangée 0 de la feuille d'icônes, ailleurs à l'ordonnée 171 de `99.ALG`.
  Il se cache pendant la marche scénarisée (`walkToPoint` : `hideCursor` / `showCursor`, `engine.cursorVisible`).

## 8. Branchement dans le moteur

- `DrasculaHost.present(pixels, palette)` : 64 000 indices et 768 octets RVB 8 bits, appelée par **`DrasculaEngine.render()`**, que l'hôte appelle **une fois par image d'écran**, après les ticks de l'image (le moteur avance à 100 Hz, l'écran à 60 Hz : composer à chaque tick serait du travail perdu, et ralentit les tests du moteur). Les tableaux sont ceux du rendu : l'hôte les copie ou les peint tout de suite
  (`IndexedPresenter.present(pixels, palette)` dans la `requestAnimationFrame` qui appelle `render()`). `TestHost.present` garde les références et un compteur.
- `DrasculaEngine.gfx` : le rendu ; `startChapter` au début de chaque chapitre, `enterRoom` à chaque pièce, `endChapter` à la fin d'un chapitre. `engine.fadeToBlack`, `fadeFromBlack`, `black` : séquences et appel pour les cinématiques (vague C).
- La page de développement `ui/render-dev.html` (`?chapter=4&room=24`) monte le moteur avec un hôte minimal (souris, clavier, pas de son) et peint les images ; état exposé dans `window.drascula`. L'hôte du jeu (vague J) la remplacera.

## 9. Écarts à ScummVM

- L'image est recomposée en entier à chaque `render()` depuis l'état, et non au fil des boucles d'attente (même résultat à l'écran) ; le curseur est dessiné dans l'image (curseur logiciel) et déduit de l'état ; l'inventaire et le curseur d'objet lisent la feuille d'icônes du chapitre
  sans la recharger dans `back` / `cursor` : la couleur 0 de la palette n'est pas réécrite à chaque ouverture ; `cursor` reste `99.ALG` (ScummVM recharge l'image de dos du chapitre 2 à la fermeture de l'inventaire : mêmes icônes).
- Copies rognées sans erreur ; texte en chaîne JavaScript encodée en CP850 ; pas d'espagnol ni de russe.
- Fondus en séquences du moteur (au moins un tick par pas).

## 10. Points ouverts

- **Têtes qui parlent**, **choix de dialogue**, **cinématiques** : faits (§ 11, `talk.md`, `cinematics/`). Restent à comparer à des captures de ScummVM les positions de bouche des personnages autres que le héros, Drascula en gros plan et Igor de profil (`talk.md`, § 6).
- **`update_N` et `update_N_pre`** propres aux pièces (palette `bright` / `dark` selon la position du héros, animations des pièces 1, 2, 3, 5, 6, 7, 12…) : accroches `renderer.painters[chapitre][pièce]` : remplies par la vague P (`rooms.md`), les six chapitres sont faits.
- Cadence réelle (nombre d'images par seconde) à mesurer ; le rendu suit les ticks du moteur (`engine.md`, § 2).
- Précharge (**faite en vague J**, `ui/preload.ts`) : au départ `drascula.dat`, les `.ALD`, les `.CAL` et **toutes** les `.ALG` (5,7 Mo : les feuilles hors numérotation servent à plusieurs chapitres et cinématiques) ; les `.BIN` (23 Mo) par chapitre (`CHAPTER_VIDEOS`) avec le chapitre suivant, le reste en fond ; une image manquante lève une erreur (`Fichier du jeu introuvable`, affichée par la page).
- Comparaison par échantillons avec des captures de ScummVM (critère du plan) : non faite (aucune capture sous la main) ; les tests comparent à des images calculées, et le rendu a été vu dans le navigateur pour les chapitres 1, 2 et 4.

## 11. Prise de main des séquences sur l'image (vagues T et C)

**Problème.** ScummVM laisse chaque séquence dessiner dans `screenSurface` et appeler `updateScreen` ; les têtes qui parlent, le menu des choix et les cinématiques (images pleine page, vidéos) y écrivent directement. Ici l'image est recomposée par `render()` depuis l'état, et rien ne doit contourner `DrasculaRenderer.compose`.

**Conception** (`render/renderer.ts` ; le moteur n'a pas d'autre accès à l'image) : trois points d'accroche dans `compose(input)`, tous alimentés par l'état du moteur à chaque `render()`.

1. **`gfx.owner`** : qui fournit le fond. `"room"` (défaut) : la pièce, recomposée depuis l'état (§ 4). `"canvas"` : l'image libre `gfx.canvas`, que la séquence remplit (`loadPic` d'un écran, images des `.BIN`, `clearRoom`) : c'est l'écran « matériel » de ScummVM, que `playFLI` et `animate` écrivent sans passer par `screenSurface`. En image libre il n'y a ni curseur, ni barre des verbes, ni nom survolé. `enterRoom` et `updateRoom` (pièce chargée) rendent la main à la pièce, comme `updateRoom(); updateScreen();` de l'original ; `renderer.clearRoom()` (= `clearRoom`) la prend. `gfx.roomSprites = false` coupe les mises à jour de la pièce (le numéro de pièce inexistant de `animation_9_6`).
2. **`engine.head`** (`{ view: TalkView, roll }`) : pendant une réplique, la vue du personnage **remplace la composition ordinaire** et la refait dans l'ordre de la fonction `talk_*` d'origine. Elle reçoit une `Scene` qui offre les étapes de `updateRoom` : `background()` (`copyBackground()`), `pre()` (`updateRefresh_pre`), `hero()` (`moveCharacters`), `post()` (`updateRefresh`) ; entre elles elle recopie le rectangle de la bouche (`gfx.screen.copyBackground(gfx.extra, …)`). Un personnage qui n'appelle pas `hero()` laisse le héros hors de l'image, comme l'original. Le tirage du tour (`roll`) est fait par le moteur à chaque tour de réplique. Sans vue, la composition est celle de `updateRoom`. Les vues sont aussi appliquées en image libre (`talk_drascula_big`, `talk_solo`).

   **Feuille de la tête.** Le rectangle d'une tête vient de la feuille que la pièce ou la cinématique a chargée (ScummVM : `loadPic` de `animation_3_1` / `animation_11_2` pour le barman, `animation_12_2` pour le pianiste, `an24.alg` pour Von Braun…) ; `enterRoom` ne met que `97.ALG` dans `extra`. Appeler un `talk_*` seul (console, `render-dev.html?sequence=3`) sans passer par l'animation qui charge la feuille montre donc les glyphes du héros, comme ScummVM. `test/drascula/render/heads.test.ts` joue le jeu et compare les pixels de chaque tête à son `.ALG`.
   La tête du héros efface la sienne avec le décor d'avant les personnages (`gfx.backdrop`), puis dessine la bouche à la taille réduite du héros (`talk` : `copyBackground(…, drawSurface3)` d'origine).
3. **`engine.choices`** (`ChoiceMenu` : quatre répliques, leur état, le choix survolé) : le menu de `converse`, dessiné par-dessus l'image avec les glyphes de `CAR.ALG` (`printChoice`), le choix survolé redessiné en état « survolé ».

Le sous-titre (`engine.subtitle`), le nom survolé, l'inventaire, la barre des verbes et le curseur sont dessinés ensuite, comme avant. **Transitoire** : le sous-titre et la tête disparaissent avec la réplique ; ce que ScummVM écrit pour de bon dans `screenSurface` (le texte de `talk_solo`, qui reste jusqu'à la prochaine image chargée) est ici seulement affiché pendant la réplique (écart documenté dans `cinematics/sequences.ts`).

**Palettes.** `palette.showExternal(palette6)` = `setPalette(buffer)` de ScummVM : les blocs palette des `.BIN` (6 bits) et la palette de la première image d'une animation vont à l'écran **sans toucher à la palette du jeu** ; `color_abc`, un chargement d'image ou un fondu (`fadeToBlack` / `fadeFromBlack`, qui partent de la palette du jeu) la rétablissent. `black()` + `fadeFromBlack` : écran noir puis fondu vers la palette du jeu. Vérifié : `cinematics/player.test.ts` (palette de `LOGODDM.BIN` et de `LEV.BIN`).

**Vidéos** (`cinematics/player.ts`, `playSsn`, `animate`). Les images XOR des `.BIN` sont recopiées dans `gfx.canvas` (`data/bin-ssn.ts` et `bin-animate.ts` décodent, `SsnDecoder` / `AnimateDecoder` accumulent le XOR contre l'image précédente). Cadence en millisecondes réelles, sans le doublement de `delay` : SSN, `1000 / vitesse` ms avant chaque image et chaque bloc vide, sur une horloge fixe ; animation, `1000 / ips` ms après chaque image (la première tout de suite, la dernière jamais jouée). **Vérifié** (`LOGODDM.BIN` : 47 images, 51 tours à 9 par seconde ; `QPC.BIN` : 9 images, 33 tours à 1 par seconde ; `LEV.BIN` : 6 images à 15 par seconde) : chaque image arrive à son tour, au tick près, dans l'ordre, avec la bonne somme de contrôle. **Vu** : `LOGODDM`, `QPC` (texte français), l'écran de Drascula.

**Vague P : accroches remplies.** `GameScript.painters` (`update_N_pre`, `update_N`, par chapitre puis par pièce) alimente `renderer.painters` à la création du moteur ; un painter ne fait que dessiner depuis `GameState.anim`, les drapeaux et le héros (rappelé à chaque `render()`), l'avance des animations est `GameScript.tick` (`rooms.md` § 4). `renderer.shake` décale l'image finie d'un nombre de lignes (`hiccup`). Vu : l'auberge du chapitre 1 (bougies, pianiste), la chambre de B.J.

**Pour la vague P.** Une pièce qui joue une vidéo ou une animation rend la main avec `g.updateRoom()` (ou `enterRoom`) ; une tête propre à une pièce (`talk_*` appelés par un gestionnaire) passe par `engine.talkers` ; un dessin par image dans une séquence (`animation_5_6`, le pendule) pose `engine.head` avec une vue sur mesure (`cinematics/sequences.ts`, `crank`).
