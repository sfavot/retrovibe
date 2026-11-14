# Beneath a Steel Sky : rendu (vague R, parties 1 et 2)

Référence : moteur `sky` de ScummVM (`screen.cpp`, `screen.h`, `mouse.cpp`, `logic.cpp` pour les mcodes de curseur, `intro.cpp`, `skydefs.h`, GPL v3+), lu puis réécrit. La partie 1 couvre le **décodage des images** et les **primitives de dessin** ; la partie 2 (composition d'une pièce par le moteur, `render/screen.ts`) est décrite à la fin. Les formats d'origine sont dans `formats.md` (§ 8, § 10), le découpage du moteur dans `engine.md` (§ 5-6).

## Modules

| Fichier | Rôle (source ScummVM) |
| --- | --- |
| `data/sprite.ts` | `SpriteFile` : en-tête `DataFileHeader`, images de `s_sp_size` octets ; `frameIndexOf` (`frame & 0x3F`), `spriteFileOf` (`frame >> 6`) |
| `data/sequence.ts` | `decodeSequenceFrame`, `Sequence`, `SequenceDecoder` (`startSequence`, `processSequence`) |
| `render/frame-buffer.ts` | `FrameBuffer` : 320 x 200 indices + palette 256 RVB 8 bits ; `toRgba` / `indicesToRgba` ; constantes de l'écran et de la grille |
| `render/draw.ts` | décor par blocs (`recreateBackground`), image plein écran (`showFullImage`), `drawSprite`, `markBlocks` (`vectorToGame`), `verticalMask`, `sortSprites`, `scrollFrame`, `paintBox` |
| `render/palette-fade.ts` | pas des fondus (`fadeDownStep`, `fadeUpStep`) et palette de pause (`halvedPalette`) |
| `render/cursor.ts` | `CursorSet` (60300 à 60302, `spriteMouse`, `fnOpenCloseHand`), `findMouseCursor`, `drawCursor`, `cursorRgba` |

Tout est pur : fonctions sur des tampons, aucun temps, aucune lecture de fichier. Le moteur fournit les tampons et l'ordre ; l'hôte convertit en RGBA et gère l'horloge.

## Formats confirmés (fichiers réels)

- **Palette** : 768 octets VGA 6 bits ; `(v << 2) + (v >> 4)`. **Seules les 240 premières couleurs** sont écrites par un fichier de palette ou par un fondu ; les 16 dernières (`_top16Colors`, texte et interface : 255 = blanc, 241 = gris) sont fixées à la création et ne bougent jamais. Les `.pal` du banc sont l'état de la palette de la machine (RVB 8 bits).
- **Image plein écran de l'introduction** : 64 000 octets, **en lignes**, sans en-tête (fichiers `CD_n_LOG`). `showScreen(fichier, plein écran)` : sans le drapeau `FULLSCREEN`, les lignes 192 à 199 sont forcées à 0.
- **Décor de jeu** : 61 440 octets (320 x 192) **par blocs de 16 x 8**, rangés de gauche à droite puis de haut en bas, chaque bloc en 8 lignes de 16 octets (`recreate`). Vérifié : le fichier 64 remis en lignes retrouve 95,8 % des pixels de la capture de la première pièce (le reste : Foster, Joey, objets, curseur), alors que lu en lignes il n'en retrouve que 5 %. Les couches de masque (couches 1 à 3) ont le même rangement.
- **Sprites** : 948 fichiers d'identifiant < 50 000 sont des fichiers de sprites cohérents (taille du fichier = 22 + `s_n_sprites` x `s_sp_size`, `s_sp_size` = largeur x hauteur). Pixels en octets directs, **0 transparent**, indices de la palette de jeu. **La variante « 32 couleurs » (bit 2 de `flag`) n'est posée sur aucun de ces fichiers et n'est pas lue par `drawSprite`** : elle n'existe pas pour le CD. Décalage `(s_offset_x, s_offset_y)` signé. 64 images au plus par fichier (`frame & 0x3F` ; `frame >> 6` = identifiant du fichier). Environ 170 autres fichiers (< 50 000) ont un en-tête à dimensions nulles (tables, textes, données) : ce ne sont pas des sprites.
- **Curseurs** : 60300 = 9 images de 22 x 22 (numéros `MOUSE_*`, 0 = objet tenu), 60301 = 50 images (2 par objet), 60302 = 44 (section de Linc, remplace 60301 par `fnEnterSection` / `fnLeaveSection`). Couleur 0 transparente. Points chauds passés par chaque mcode : normal (0, 0), disque (11, 11), croix (4, 4), droite / bas / haut (9, 4), gauche (0, 5), objet (5, 5) ; `MOUSE_BLANK` masque le curseur.
- **Séquences (« flirt »)** : 1 octet = nombre d'images, puis les images à la suite, compressées par différence sur l'écran courant 320 x 192 : **saut** (`k`, répété tant que `k == 0xFF`) puis **copie** (`m` pixels, `m == 0xFF` enchaîne une autre copie sans saut), jusqu'à la position 61 440. Les 24 fichiers de séquences de `_cdIntroSeq` (59503, 59506, 59509, 59512, 59516, 59519, 59524, 59533, 59557, 59569, 59575, 59589, 59595, 59605, 59609, 59611, 59623, 59643, 60087, 60099, 60091, 60094, 60097, 60098) se décodent **en consommant exactement le fichier** (1 236 images, aucun dépassement). Une séquence ne touche jamais les 8 dernières lignes. Cadence : une image toutes les 60 ms. Variante d'un compact (`startSequenceItem`) : même format, `n - 1` images. Le décodeur rend aussi la grille de 20 x 12 blocs de 16 x 16 modifiés (`_seqGrid`).

## Règles de dessin

- **Sprite** (`drawSprite`) : position écran = (`xcood + s_offset_x - 128`, `ycood + s_offset_y - 136`). Rognage exact en haut, à gauche et en bas ; **à droite, un pixel de plus que nécessaire** (`rightClip = -(320 - (w + x)) + 1`), conservé. Un sprite hors de l'écran, de plus de 192 lignes, ou qui dépasserait encore après rognage, n'est pas dessiné. Le dessin ne couvre que les 192 lignes de jeu. Rend le rectangle de blocs 16 x 8 touchés.
- **Blocs touchés** : `markBlocks(grille, rectangle, 1)` (ou `0x81` si `status & 8`, ce qui force aussi la recomposition du décor au tour suivant). La grille de jeu (20 x 24 octets) : bit `0x80` = bloc à recopier depuis le décor (`recreate` le retire et pose le bit 1), bit 1 = bloc à envoyer à l'écran (`flip`).
- **Masque vertical** (`verticalMask`) : pour les couches 1 à 3 de décor présentes (pixels + grille de 480 mots), colonne de blocs par colonne, depuis la rangée du bas du sprite en remontant : tant que la case de grille est non nulle, bloc `valeur - 1` recopié (0 transparent) ; bit `0x8000` = case sautée sans dessin ; arrêt à la première case nulle. Appelé après chaque sprite de la couche `BACK` et après chaque sprite trié dont `status & 0x200` est nul. Dans ScummVM la recherche de couche relit toujours la grille de la couche courante : seule compte la case de cette couche (reproduit).
- **Ordre** (`doSprites`, `sortSprites`) : couche `BACK` (bit 0 de `status`) dans l'ordre des listes de dessin, puis les sprites triables (bit 2) triés par `ycood + s_offset_y + s_height` (16 bits non signés) avec le tri à bulles d'origine (échange si strictement supérieur : non stable, ordre des égaux fixé par l'algorithme), 30 sprites au plus par liste, puis la couche `FORE` (bit 1). Seuls les compacts de l'écran courant (`screen == SCREEN`) sont dessinés ; un fichier de sprites absent met `status` à 0.
- **Fondus** : 32 pas de 20 ms. Fondu au noir : chaque pas retire 8 à chaque composante des 240 couleurs, plancher 0, cumulatif (255 -> 0 au pas 32). Fondu en entrée : au pas `n` (1 à 32), composante = `(cible * n) >> 5`, calculée depuis la cible (le pas 32 est exactement la cible). Pause : palette divisée par deux (`>> 1`), sans toucher la palette de travail.
- **Défilement** (`fnFadeUp` 123 / 321) : 19 pas de 16 pixels toutes les 20 ms, puis l'image finale ; `scrollFrame(pas)` rend l'image du pas 1 à 19 (20 = la nouvelle image).

## Vérification (`test/bass/render/`, `test/bass/data/sprite-sequence.test.ts`)

- **Comparaison au banc, exacte** : captures `b-intro/i-0011`, `i-0012`, `i-0013` (320 x 200 RVB). Reconstruites à partir des seuls fichiers d'origine : image 59502 (`CD_1_LOG`) en lignes, 8 dernières lignes à 0, palette 59501 (`CD_PAL`) convertie, puis 0, 2 et 3 images de la séquence 59503 (`CD_1`) : **64 000 pixels sur 64 000 identiques, RGBA compris**, 3 captures sur 3. Fixtures (PNG, 66 Ko) dans `fixtures/`, décodées avec `node:zlib` (`png.ts`). Les tests qui lisent `original/bass/` sont ignorés si les fichiers manquent.
- **Décor** : fichier 64 contre `room-a` (première pièce, hors sprites) : > 95 % identique, uniquement en rangeant par blocs.
- **Fondus** : les captures du banc ne contiennent que des palettes à 0 ou 32 pas ; les pas intermédiaires sont couverts par des tests de calcul (lecture de `screen.cpp`), pas par une capture.
- **Séquences** : les 24 fichiers de l'introduction, image par image, sans dépassement et sans octet restant ; données synthétiques pour les sauts `0xFF`, la troncature et le dépassement.

## Écarts avec ScummVM

- Tout dépassement (lecture hors des données, écriture hors de l'écran, image de sprite absente) lève une erreur ou est ignoré au lieu de déborder en mémoire.
- Pas de rendu iBass (écran 32 bits, icônes) : seule la version du CD (palette 8 bits) est portée.
- Le curseur est dessiné dans l'écran (`drawCursor`) ou laissé à l'hôte (`cursorRgba`), au lieu de `CursorMan`.

## Partie 2 : composition par le moteur (`render/screen.ts`, `render/sprite-engine.ts`)

| Fichier | Rôle (source ScummVM) |
| --- | --- |
| `render/sprite-engine.ts` | `SpriteEngine` : grille de jeu `_gameGrid` (480 octets, initialisée à `0x80` comme `Screen::Screen`), `recreate`, `spriteEngine` (`doSprites` arrière, `sortSprites`, `doSprites` avant), `flip` ; parcours des listes de dessin (variables `DRAW_LIST_NO`…, chaînage `0xFFFF`), compacts de l'écran courant, fichiers par `frame >> 6` |
| `render/screen.ts` | `BassScreenRenderer implements BassScreen` : écran de travail (`_currentScreen`) et écran affiché `frame` (indices + palette de la machine), palette de travail `_palette`, fondus, défilement, séquences « swing », `halvePalette`, `clearScreen` |

**Branchement.** `new BassScreenRenderer()` est passé dans `BassEngineOptions.screen`, puis `renderer.attach(engine)` (le moteur construit ses compacts, variables et fichiers après l'écran ; `BassEngine` satisfait `ScreenSource`). L'hôte lit `renderer.frame` (`frame.toRgba()`, 320 x 200) et redessine quand `renderer.presented` change. Le curseur n'est pas dans `frame` (voir écarts) : l'hôte le superpose avec `cursorRgba` / `drawCursor` (partie 1).

**Composition d'un tour.** `BassEngine.cycle` appelle `screen.compose()` (= `recreate`, `spriteEngine`, `flip`) après `processSequence` et `spriteEngineStatus`, comme `SkyEngine::go` ; `lookAtWait` (`fnLookAt`) la rappelle avant son attente, et `restartGame` appelle `reset()` avant `setPalette`. Le résultat est celui de ScummVM : voir la comparaison. Les sprites d'un tour, dont les **sprites de texte** (`CPT_TEXT_n`, `frame >> 6` = emplacement de `_itemList` où le moteur de texte dépose son sprite), sont dessinés par la même boucle, sans traitement particulier. ScummVM n'écrit jamais `s_n_sprites` dans l'en-tête d'un sprite de texte (`displayText` : largeur, hauteur, `s_sp_size`, décalages) et `drawSprite` ne le lit pas ; `SpriteFile` (qui borne l'image au nombre d'images) et `spriteOf` écartaient donc ces sprites. `renderText` écrit `numSprites = 1` : libellé du pointeur, sous-titres et lignes de choix sont dessinés et identiques au banc image pour image (`cursor-overlay.test.ts` sur le banc `b-inv` en entier, `text.test.ts` : sous-titre du tour 100 de la barre, `mouse.test.ts` : choix aux tours 60 et 66). Les textes de ces captures n'ont pas d'accent (aucun capturable : `SKY_EXEC` de `fn_speak_me` fait planter `Logic::engine` du banc).

**Effets.** Les mcodes d'écran (`mcodes/screen.ts`, inchangé : il était déjà complet) déposent des effets (`effects.ts`) qui appellent le service : `fadeDown(scroll)` (prépare un défilement : l'écran de travail devient l'ancien décor `_scrollScreen`, un nouvel écran de travail reçoit le nouveau), `drawNewScreen()` (`forceRefresh`, `recreate`, `spriteEngine`, `flip`), `fadeUp(palette, scroll)` (lit la palette du compact `palette`, ou vérifie le défilement), puis `effectStep(nom, pas, total)` à chaque tick de 20 ms : `fadeDown` (-8 par composante), `fadeUp` (`(cible * (pas + 1)) >> 5`, 32 pas), `scrollLeft` (123) et `scrollRight` (321) (`scrollFrame(pas + 1)`, 19 pas). L'image finale d'un défilement (`showScreen(_currentScreen)` juste après le dernier pas) est présentée par le premier appel suivant (`processSequence`, `compose`, `setPalette`…), c'est-à-dire dans le même tick que la fin de l'effet. `SF_NO_SCROLL` remplace le défilement par un fondu (`scrollKind`).

**Séquences « swing »** (`fnNewSwingSeq` : fichiers 85, 106, 75, 15) : `startSequence` / `processSequence(now)` suivent `startSequenceItem` / `processSequence` (`n - 1` images, une toutes les 60 ms sur l'horloge du moteur) ; chaque image est écrite dans l'écran de travail par `decodeSequenceFrame` puis les blocs de 16 x 16 modifiés sont recopiés dans `frame` ; `fnWaitSwingEnd` (`waitSequenceEnd`) appelle `processSequence` à chaque tick.

**Palette.** `setPalette(compact)` : octets du compact (mots petit-boutistes), conversion `(v << 2) + (v >> 4)` des 256 couleurs dans `_palette`, 240 premières couleurs seulement envoyées à la machine (les 16 dernières, fixées à la création, ne bougent pas). `halvePalette()` / `resumePalette()` : pause (non branchée au moteur, vague J).

### Comparaison au banc (`test/bass/render/composition.test.ts`)

Banc : captures de la **surface de l'écran** de ScummVM (indices + palette, sans curseur) prises **à un numéro de tour donné** (patch `SKY_SHOT_CYCLES`, `SKY_EXEC`, `SKY_STEP_SHOTS`, documentés dans `bench/README.md` du banc ; scénarios `b-idle`, `b-idle-long`, `b-fx`). Portage : `RenderedGame` (moteur sur les vrais fichiers, `startAfterIntro`, graine 1, aucune entrée ; `compose` est appelée par le moteur ; l'empreinte du dernier pas d'un effet est prise à l'entrée de `compose`, comme la capture du banc, prise à la fin de l'effet).
- **Première pièce, sans entrée : 263 captures sur 263 identiques** (indices et 240 couleurs de la palette), tours 1 à 40 un par un puis un sur cinq jusqu'au tour 1 155 (143 images distinctes : Foster, Joey, les décors animés bougent). Trois sont aussi comparées pixel par pixel (fixtures binaires, 120 Ko) ; les autres par empreinte SHA-1 (`fixtures/idle-cycles.json`).
- **Fondus** : `fnDrawScreen(palette, 0)` : **64 images sur 64 identiques** (32 pas au noir, 32 pas en entrée, une par tick) ; `fnFadeDown` : 32 sur 32 ; `fnFadeUp` : 32 sur 32 ; `fnBlankScreen` identique (`fixtures/effects.json`, 141 empreintes).
- **Défilement** (123 et 321) : image finale identique. Les 19 images intermédiaires ne sont **pas comparables** : dans ce ScummVM, `Screen::showScreen(uint8 *pScreen, bool)` appelle `renderFinalFrame()`, qui recopie `_currentScreen` (le nouveau décor) et non `pScreen` : le défilement n'y est pas visible (régression du moteur, trop tardive pour le CD d'origine). Le portage garde le défilement voulu (`scrollFrame`, 19 pas de 16 pixels) ; le test vérifie 19 images distinctes puis l'image finale. **Décision à confirmer** : défilement visible (choix actuel, comportement d'origine du jeu) ou nouvel écran d'un coup comme ce ScummVM.
- **Non comparé au banc** : marche (le cheminement, vague E, manque), textes (autre agent), séquences « swing » (données synthétiques : cadence 60 ms, `n - 1` images, mêmes états que `NullScreen`), `halvePalette`.
- **Curseur** : absent des captures du banc (ScummVM le dessine par `CursorMan`) et de `frame` : rien à exclure de la comparaison.

### Écarts (partie 2)

- Composition, `fnLookAt` et `restartGame` : `compose()` et `reset()` sont dans `BassScreen` et appelées par le moteur (`cycle`, `lookAtWait`, `restartGame`) ; le texte de `fnLookAt` n'est effacé (`status = 0`) qu'à la fin de l'effet, pour être dessiné pendant l'attente.
- L'écran de travail d'un défilement est mis à 0 (mémoire non initialisée dans ScummVM). `renderFinalFrame` n'envoie que 192 lignes dans ScummVM ; le portage présente 200 lignes (`clearScreen` efface donc aussi les 8 dernières, ce que ScummVM ne fait pas : sans effet sur le jeu, qui n'y écrit pas hors introduction).
- Pas de grille de débogage (`showGrid`), pas de rendu iBass. Une séquence d'une seule image s'arrête après elle (ScummVM ne s'arrêterait jamais : `framesLeft` à 0 avant la première image).
- `setFocus` (rectangle d'accessibilité) non implémenté (méthode facultative).
- Un fichier de sprites illisible ou une image hors du fichier est ignoré sans journal (ScummVM lirait au-delà du tampon) ; plus de 30 sprites triés dans une liste : les suivants ne sont pas dessinés.
