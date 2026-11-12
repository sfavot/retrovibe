# Flight of the Amazon Queen : rendu (vague R)

Rendu de `src/games/fotaq/render/` : décor défilant, bobs, panneau, palettes, texte 8x8, curseur. Le moteur sans tête (`engine/`, `engine.md` § 11) tient l'état ; le rendu le **lit** et compose une image de 320 x 200 indices de palette + une palette de 256 couleurs (décision D8 : pixels carrés, `logicalWidth: 320`, `logicalHeight: 200`). Les formats sont dans `formats.md`, le plan dans `plan.md`.
La **référence de comportement est le moteur `queen` de ScummVM** (`display.cpp`, `graphics.cpp`, GPL v3+), lu et réécrit ; chaque module cite en tête ce qu'il reprend et ses écarts.
**Confiance** : **lu** = lu dans ScummVM ; **vérifié** = couvert par un test (`test/fotaq/render/`, avec les fichiers du jeu quand ils sont là) ; **vérifié à l'écran** = vu dans le navigateur (`ui/render-dev.html`).

## 1. Modules

| Module | Rôle | ScummVM |
| --- | --- | --- |
| `font-data.ts` | les 256 glyphes 8 x 8 (2 048 octets), provenance en en-tête (D10) | `Display::_fontRegular` |
| `font.ts` | largeur des glyphes, largeur d'un texte, tracé d'un caractère et d'un texte avec contour ; remplacements ASCII | `initFont`, `textWidth`, `drawChar`, `drawText` |
| `palette.ts` | palettes pièce / panneau / écran, tenues de Joe, lumière dynamique, fondus, couleurs qui tournent, panneau gris, éclair, pièces éteintes | `palFadeIn/Out`, `palSet*`, `palScroll`, `palCustom*`, `dynalumUpdate` |
| `sprites.ts` | copie masquée / retournée / opaque, réduction, dessin d'un bob dans une boîte, cache des banques | `Display::blit`, `Graphics::shrinkFrame`, `drawBob` |
| `display.ts` | décor 640 x 200, panneau 320 x 50, mode plein écran / panneau, liste de textes, texte au-dessus d'un bob | `Display`, `Graphics::setBobText` |
| `renderer.ts` | composition d'une image à partir de l'état du moteur : images collées, bobs triés, inventaire, ligne de commande, textes, curseur | `Graphics::drawBobs`, `drawInventoryItem`, `Display::update` |

Branchement (`engine/`) : `Stage.render(g)` (nouveau, appelé par `FotaqEngine.render()`, que l'hôte appelle une fois par image d'écran après les ticks) ; `FotaqHost.present(pixels, palette)` et `FotaqHost.fileExists(name)` ; `GameStage` possède un `Renderer` (`stage.display`, `stage.renderer`) et branche `setupRoom` (décor, panneau, lumière, mode d'écran), `eraseRoom` (fige l'image), `fadeOut` / `fadeIn` (séquences), `frame` (couleurs qui tournent, lumière d'après Joe), `setOutfit` (palette de Joe), `render`, `setBobText`.

## 2. Ce que le rendu lit, et dans quel ordre il dessine

À chaque `render` (**lu**, `prepareUpdate`, `drawBobs`, `drawTexts`) :

1. **Images collées** (`rooms.pasteDowns`) : celles qui ne sont pas encore dans le tampon du décor y sont écrites (l'indice 0 est transparent), dans l'ordre ; la liste est repartie de zéro à chaque décor chargé. (**Vérifié**, y compris un collage ajouté après l'entrée.)
2. **Inventaire** : les quatre cases de `state.inventory`, image `state.items[n].frame` de `OBJECTS.BBK` copiée sans masque en `(182 + 35 * case, 14)` dans le panneau ; une case vide est remplie de la couleur 226 sur 32 x 32.
3. **Décor** : 150 lignes du décor à partir de `g.horizontalScroll`, plus le panneau (320 x 50, en bas) ; en **plein écran**, 200 lignes et pas de panneau. Les 10 premières lignes du panneau (noires) portent la ligne de commande ; `PANEL.PCX` (320 x 40) commence à la ligne 10 du panneau. (**Vérifié**, **vérifié à l'écran**.)
4. **Bobs** de `stage.bobs.sorted` (ordonnée des pieds croissante, puis numéro d'emplacement), s'ils sont actifs et ont une image dans `stage.bobs.frames` :
   - ancre `(xh, yh)` de l'image ; si `xflip`, `xh = largeur - xh` ; si `scale` != 100, `xh = xh * scale / 100`, `yh = yh * scale / 100` (entiers) ; position écran `(x - xh - défilement, y - yh)` ; calcul en 16 bits **non signés** comme ScummVM (`uint16 xh, yh`), position relue en 16 bits signés par `drawBob` : un ancrage de 32 768 ou plus vaut un ancrage négatif à l'échelle 100 (images 10 à 20 de `x4b.SAM`, la baignoire de Sparky dans `CDINT`, pièce 118 ; `x7b.SAM`). Lu comme un entier positif, il envoyait l'image hors de l'écran (corrigé) ; à une autre échelle, ScummVM réduit l'ancrage non signé, ce qui est repris tel quel ;
   - **surimpression** (`FrameRef.overs`, `BankManager::overpack`) : les images listées sont copiées une à une sur le **début des pixels** de l'image de base (octet après octet, sans changer sa taille ni son ancrage ; une source plus grande que la base la remplace) ; c'est la bouche et le torse d'un personnage qui parle (`talk.md`) ; composée une fois par chaîne d'images (`Renderer.resolve`), sur une **copie** des pixels de la base (sous Node, une banque garde une vue d'un `Buffer`, dont `slice` partage la mémoire : la surimpression écrivait dans l'image de la banque, et une personne qui avait parlé gardait sa dernière bouche dans les tests et le banc de comparaison ; corrigé) ;
   - échelle < 100 : image réduite (`shrinkFrame` : taille `(largeur * % + 50) / 100`, pixel pris à `i * 100 / %`) ;
   - découpe dans la boîte du bob, sinon celle de l'écran de jeu (0,0 à 319,149) ou, en plein écran, de l'écran entier (0,0 à 319,199) ; l'indice 0 est transparent ; retourné, l'image s'étend vers la gauche depuis son point d'ancrage.
   (**Vérifié** sur des images synthétiques, et sur Joe : pieds au point visé, hauteur à 50 % et 25 %, miroir exact autour du point d'ancrage.)
5. **Ligne de commande** : `g.command.line` (texte et encre), centrée en `y = 151`, sans contour, couleur 225 (normale) ou 255 (sous le curseur). Dessinée **avant** la liste de textes ; si la liste a une entrée à la ligne 151, c'est elle qui gagne.
6. **Textes** (`display.setText`, une entrée par ordonnée, de la ligne 199 à la ligne 1) : couleur de l'entrée, contour de huit passes de couleur 16 si demandé.
7. **Curseur** : image 1 de `CONTROL.BBK` en `(souris - 1, souris - 1)` (hotspot (1, 1) de ScummVM), couleur 0 transparente ; option `cursor: false` pour le laisser au système (`display.cursorVisible = false` le cache : cinématiques).

Les flèches des choix de dialogue (bobs 62 et 63, images 3 et 4 de `CONTROL.BBK`) sont dessinées comme des bobs : leur point d'ancrage est décalé de 200 pour rester au-dessus de tout (`yhotspot += 200` de `unpackControlBank`), et le moteur met les images 1, 3 et 4 dans la table d'images à la première pièce (`Renderer.setupPanel`).

### Image figée pendant le fondu de sortie

`Logic::eraseRoom` vide la table d'images **avant** le fondu de sortie (`engine.md` § 11) : le rendu **fige** l'image (`display.frozen`, mis par `GameStage.eraseRoom`, levé par le décor suivant). Le fondu et le curseur continuent. **Vérifié** (image identique pendant les 4 images du fondu).

## 3. Palettes

**Lu**. Trois palettes de 256 couleurs en RVB 8 bits : `room`, `screen`, `panel` (couleurs 144 à 255 de `PANEL.PCX`).

- Décor : ses couleurs 0 à 143 (`backdropColors`), toutes les 256 pour les pièces 114 à 125. Les couleurs 144 à 255 de la pièce viennent du panneau (`setPanelColors`) ; les 16 premières (144 à 159) sont les couleurs de Joe, remplacées par la tenue (`setJoeNormal` pour les vêtements et les sous-vêtements, `setJoeDress` pour la robe ; tables `_palJoeClothes` et `_palJoeDress`, 16 x 3 octets, transcrites de `display.cpp`).
- Pièces 28 à 31 : couleurs 72 à 83 retouchées (`palCustomColors`). Le cas de la pièce 28 lit la composante verte pour calculer la bleue, comme ScummVM (reproduit, signalé).
- **Lumière dynamique** (`.MSK` / `.LUM`, `data/dynalum.ts`) : à chaque image, d'après la position du bob 0 (`dynalumUpdate`), `screen[144..159] = room + triplet * 4`, borné à 0..255 ; recalculé seulement quand la ligne de la table change ; les deux fichiers doivent exister (`host.fileExists`) et la pièce ne doit pas être une pièce d'introduction. Le masque de `T6` (lignes hors table) laisse la palette. **Vérifié** (formule sur quatre pièces, deux positions chacune) et **vérifié à l'écran** (pièce 20 : la couleur 145 de Joe passe de 96 à 84 puis 60 selon sa position).
- **Fondus** (`palFadeIn`, `palFadeOut`) : sur les `colorsForRoom` premières couleurs (**224**, **256** pour les pièces 114 à 125 : les couleurs 224 à 255, texte du panneau, restent visibles). Fondu d'entrée : l'écran reprend la palette de la pièce, la lumière est appliquée pour la position de Joe, la palette montrée est `screen * niveau / 16` sans toucher `screen`. Fondu de sortie : `screen[j] = départ[j] * niveau / 16` jusqu'à zéro. **Pièces d'introduction** (90 à 94, 115 à 125) : ni fondu ni lumière, l'écran devient noir (sortie) ou prend la palette de la pièce (entrée) tout de suite.
  **Écart** : ScummVM fait 17 pas de 20 ms (340 ms) ; ici une séquence de `FADE_TICKS = 4` images de 100 ms (pas de 4 / 16, 400 ms) qui règle le niveau à chaque image ; la palette montrée (`Palette.shown`) est calculée à la demande. **Vérifié** (durée, monotonie, couleurs 224+ constantes, pièces d'introduction immédiates), **vérifié à l'écran** (changement de pièce 3 vers 7 : image figée qui s'éteint, nouveau décor noir, fondu d'entrée).
- **Couleurs qui tournent** (`palCustomScroll`, versions DOS) : tableau de rotations par pièce (2, 3, 4, 5, 7, 8, 12, 25, 39, 40, 42, 49, 55, 57, 59, 62, 64, 74, 76, 97, 100, 102, 125) ; une image du moteur = un pas (`palette.cycle`, appelé par `GameStage.frame`) ; la moitié des pièces ne tourne qu'une image sur deux (`compteur & 1`), la pièce 40 trois sur quatre pour ses couleurs 104 à 107 ; pulsations des pièces 123 et 124 (hasard à graine fixe, `Lcg`). Rien ne tourne quand `scrollable` est faux (pendant un fondu de sortie, pièce sans lumière).
- Effets que les vagues L et C déclenchent : `palette.greyPanel()` / `clearGrey()` (panneau gris pendant une scène : couleurs 224 à 255 = vert x 2 / 3), `flash(on)` (éclair blanc et noir), `lightsOff(room)` / `lightsOn(room)` (pièce sans lumière : couleurs 16 à 223, 32 à 223 dans le hall 103).

## 4. Mode d'écran

`display.screenMode(comPanel, inCutaway)` (**lu**) : `comPanel` 1 = panneau ; 2 dans une cinématique = plein écran si le décor fait 200 lignes, sinon panneau ; 0 ne change rien. `GameStage.setupRoom` l'applique après le chargement du décor. `display.fullscreen` est réglable (les dialogues passent en plein écran : `Logic::startDialogue`). Le **plein écran initial** est vrai (`_fullscreen(true)`), puis la première pièce applique `comPanel = 1`.
**Tranché (point resté « lu »)** : la hauteur du PCX ne décide pas du mode : c'est `comPanel` (1 pour une pièce de jeu), même si le décor fait 200 lignes (pièces de jeu à 39 décors de 200 lignes : les 50 lignes du bas sont cachées par le panneau, visibles en plein écran). Un décor de 150 lignes en plein écran est noir dessous (ScummVM y laisse les restes de l'ancien décor ; écart). **Vérifié** (150 / 200 lignes, avec et sans panneau), **vérifié à l'écran** (pièces 3, 20 et 43).

## 5. Texte

- **Police** (D10) : 256 glyphes 8 x 8, largeur = colonne la plus à droite + 2, espace 4, accent circonflexe (0x5E) moins un (**lu** : `initFont`). Les textes du jeu sont déjà décodés en Unicode (`data/text.ts`) : le rendu les ramène à l'index Latin-1, où le français est complet (`é` 0xE9, `è`, `ê`, `ë`, `à`, `â`, `ç`, `î`, `ï`, `ô`, `ù`, `û`, `ü`, `Ç`, `É`, `À`, `È`, `Ê`, `Î`, `Ô`, `Ù`, `Û`…). La police a aussi les positions du CP437 / CP850 pour les minuscules (mêmes dessins), sauf `ä` et `ÿ` (vides) et `ç` (dessiné comme `Ç`), et aucun `À`, `È`… aux positions du CP850 : un texte CP850 lu octet par octet (comme ScummVM) serait faux, d'où le passage par Unicode.
  **Vérifié** : chaque caractère de **tous** les textes du jeu (objets, verbes, réponses, 73 dialogues, 302 cinématiques, plus de 3 000 chaînes) a un glyphe ou un remplacement. Remplacements ASCII (ScummVM ne les rencontre pas) : `œ` en `oe`, `Œ` en `OE`, apostrophes et guillemets typographiques, tirets, `…` en `...` ; tout autre caractère donne `?`. **Vérifié à l'écran** (« Où est-ce, l'été ? », « Réducteur de cheveux, œuvre déçue… », alphabet accentué, « Ça alors ! Été, à l'hôtel »).
- **Liste de textes** (`display.setText(x, y, texte, contour = true)`, `setTextCentered`, `clearTexts(y1, y2)`, `textColor(y, couleur)`, `textCurrentColor`) : une entrée par ordonnée (0 à 199), `x` et `y` valent au moins 1, hors de l'écran ignoré. Les vagues T, C et L les utilisent comme ScummVM (choix de dialogue en `y >= 150` en plein écran, texte à y = 5 de la pièce du pinacle).
- **Texte au-dessus d'un personnage** (`stage.setBobText(g, bob, texte, couleur, flags, x, y)`, **lu**) : un point est ajouté si le texte finit par un caractère ASCII >= `A` (ScummVM : `char` signé, donc pas de point après une lettre accentuée ; reproduit) ; lignes coupées à la première espace après 20 caractères ; largeur de la plus large ; `flags` 0 = au-dessus du bob (16 pixels au-dessus de sa tête, une ligne = 9 pixels), 1 = en `(x, y)`, 2 = centré sur l'écran à `y` ; défilement retiré ; en haut de l'écran le texte se colle à `y = 0` et se décale d'un côté ; ramené à 4 pixels des bords ; chaque ligne centrée sur la plus large. **Vérifié** (13 cas), **vérifié à l'écran**. Les coordonnées sont celles de l'écran **au moment de l'appel** : le texte ne suit pas le bob (comme ScummVM).
- Couleurs d'encre (`Ink`, version DOS) : commande 225, commande sous le curseur 255, fond du panneau 226, journal 248, pinacle 243, texte normal 7, Joe (choix) 14, contour 16.

## 6. Écarts avec ScummVM

- Pas de blocs sales : l'image est recomposée à chaque `render`, sans coût notable (320 x 200 indices).
- Le décor est vidé à chaque pièce ; les restes de l'ancien décor ne sont pas reproduits.
- `shrinkFrame` : une image réduite vide n'est pas dessinée (ScummVM dessine le tampon précédent) ; une échelle nulle ne dessine rien (division par zéro).
- Les cases de l'inventaire sont redessinées à chaque image d'après l'état.
- La ligne de commande est lue dans `command.line` (pas de liste de textes dans le moteur sans tête).
- Le curseur est dans l'image (option) ; `shake` (secousse du combat final), `drawBox` (zones), l'économiseur d'écran, les polices non françaises et l'écran Amiga ne sont pas portés. La secousse (`shake`) est à ajouter avec la vague L (`BamScene`).
- La palette de l'éclair (`palCustomFlash`) laisse indéfinies les couleurs 239 à 255 dans ScummVM : blanches ici.

## 7. Mutualisation avec Drascula (M8, fondus de palette) : décision

**Rien n'est promu.** Les deux implémentations (`src/games/drascula/render/palette.ts`, `src/games/fotaq/render/palette.ts`) n'ont en commun que l'idée d'« un fondu vers le noir » :

| | Drascula | FOTAQ |
| --- | --- | --- |
| formule | palette 6 bits, chaque composante perd `63 - niveau` (soustraction saturée à 0), puis `x 4` | palette 8 bits, chaque composante `x niveau / 16` (produit, division entière) |
| pas | 64 (niveau 0 à 63) | 4 par séquence, sur 17 niveaux de ScummVM (0 à 16) |
| couleurs touchées | les 256 | les 224 premières (256 pour 114 à 125), pas les couleurs du panneau |
| état | `game` 6 bits est la référence, `shown` en dérive | `screen` est modifiée par le fondu de sortie, non par le fondu d'entrée |

Les formules ne sont pas la même fonction (soustraction contre produit : aucune valeur de palette ne donne le même résultat aux niveaux intermédiaires) et chacune est liée à son modèle de palette. Les unifier demanderait un paramètre de formule et de plage de couleurs, soit plus de code que les deux fonctions de 3 lignes ; et changer la formule de Drascula changerait son rendu. Règle des deux usages : le second usage n'a pas la même fonction, donc pas de promotion. Aucun fichier commun, aucun test de Drascula touché. `src/ui/indexed-canvas.ts` est réutilisé tel quel (`PALETTE_BYTES`, `IndexedPresenter` par la page de dev).

## 8. Page de dev

`/src/games/fotaq/ui/render-dev.html` (serveur de dev, `fotaq-dev`, port 5242) : précharge les données (pas les voix ni la musique : ~19 Mo, une dizaine de secondes), monte `FotaqEngine` avec `GameStage` et un hôte minimal, peint avec `IndexedPresenter`. Paramètres : `room` (95 par défaut), `x`, `y` (Joe), `scale` (échelle de Joe), `outfit` (`normal`, `underwear`, `dress`), `fullscreen=1`, `say` (texte au-dessus de Joe), `font=1` (alphabet et accents), `fast=N`, `cursor=0`. État exposé dans `window.fotaq` (`engine`, `host`, `stage`). Libellés d'outil, pas du texte du produit (hôte de jeu : vague J).

## 9. Points ouverts

- Hauteur des décors par pièce et mode d'écran : tranchés ci-dessus (c'est `comPanel`) ; la logique des cinématiques (vague C) règle `comPanel` 0 / 2 et le plein écran des dialogues.
- `shake` et les animations de la voiture (pièce 74) et du combat (pièce 69) : vague L (`stage.roomUpdates`).
- Palette du journal (couleur d'encre 248) et écran « journal » : D7, non porté.
- **Ligne de commande en plein écran (tranché, comme ScummVM)** : sans panneau, la ligne « aller vers … » reste dessinée en `y = 151` par-dessus le décor. ScummVM fait de même : `CmdText::display` (`command.cpp`) pose le texte avec `setTextCentered(COMMAND_Y_POS, …)` sans regarder le mode d'écran, et `Display::drawTexts` (`display.cpp`) peint toute la liste sur les 200 lignes. Ce n'est donc pas un défaut du port ; la ligne n'apparaît de toute façon que quand une commande est en cours (elle est effacée par `Command::clear`).
- **Changement de tenue (corrigé dans le jeu)** : l'image de Joe à l'arrêt (`JOE_FRAME`, 31) est une référence posée une fois (`Joe.pose`) vers la banque debout ; `loadBanks` ne rechargeait que les banques, donc Joe gardait l'ancienne tenue jusqu'à sa prochaine pose (la page de dev n'y est pour rien : elle repeint à chaque image). `Joe.loadBanks` renvoie maintenant l'image 31 vers la banque de la nouvelle tenue (test `stage.test.ts`, « changer de tenue se voit à l'image suivante »). Les images de marche (11 à 30) et debout (35 à 37) étaient déjà relues à chaque image.
- L'ordre des textes d'un même `y` (un seul par ordonnée) et la ligne de commande : si un dialogue pose un texte à `y = 151`, il masque la ligne de commande (comme ScummVM).
- Couleurs de texte des personnages (`ActorData::color`) : lues par la vague T, passées à `setBobText` comme indice de palette (**fait**). Le menu des dialogues pose ses lignes en `y >= 156` (plein écran) et colore la ligne survolée (`textColor`) ; les flèches sont les bobs 62 et 63.
