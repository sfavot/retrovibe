# Lure of the Temptress : rendu (vague R)

Référence : moteur `lure` de ScummVM (`room.cpp`, `surface.cpp`, `screen.cpp`, `palette.cpp`, `menu.cpp`, `hotspots.cpp`, GPL v3+), lu puis réécrit dans `src/games/lure/render/`. Les formats sont dans `formats.md` (§ 4-5), l'architecture du moteur dans `engine.md`. Le moteur reste sans tête : le rendu **lit** `LureEngine` (`room`, `world.activeHotspots`, `menuView`, `dialogText`, `confirmText`, `showingCredits`, `mouse`) et ne le modifie pas, sauf `room.talkDialogHeight` (hauteur de la bulle, voir plus bas).

## Modules

| Fichier | Rôle (source ScummVM) |
| --- | --- |
| `surface.ts` | `Surface` : tampon d'indices, copies de rectangles avec couleur transparente, remplissage (`surface.cpp`) |
| `text.ts` | `writeChar`, `writeString`, `textWidth`, `wordWrap` (police proportionnelle : avance = largeur du dessin + 2 ; fixe : 8) |
| `dialog.ts` | `createDialog`, `newDialog`, boîte d'information (`Dialog::show`), confirmation (`getYN`), fenêtre d'un menu surgissant (`PopupMenu::Show`) |
| `palette.ts` | palette de travail (`screenPalette`, déplacée de la visionneuse), fondus par pas de 4 (`Screen::paletteFadeIn/Out`) |
| `layers.ts` | calques et cellules de recouvrement (`RoomLayer`, `blockMerge`, `layersPostProcess`, `addLayers`, `addCell`) |
| `sprites.ts` | planches d'images (`Hotspot::setAnimation`), découpe et rognage (`Hotspot::copyTo`), tri du calque 1 (`Room::update`) |
| `room-view.ts` | `Room::update` : fond, calques 3, 1 (trié), 2, bulle, ligne d'état |
| `talk-bubble.ts` | `TalkDialog` : texte de la bulle (articles), cadre `0x3F04`, révélation mot à mot |
| `menus.ts` | barre de menus (ressource 5) et menu déroulé, mise en valeur de l'en-tête et de l'entrée |
| `cursors.ts` | curseurs 16 x 16 (point chaud (7, 7), flèche et barre en (0, 0), couleur 0 transparente) |
| `renderer.ts` | `LureRenderer` : assemble tout, palette et fondus ; `output` (320 x 200 indices) et `palette` (768 octets) |

`ui/asset-viewer.ts` importe maintenant `rgb768` et `screenPalette` de `render/palette.ts` (il les dupliquait). Page de dev : `/src/games/lure/ui/render-dev.html` (serveur de dev, ex. `fotaq-dev`), paramètres `room`, `seed`, `fast`, `cursor=0` ; `window.lure` expose `engine`, `host`, `renderer`, `step(n)`.

## Composition d'une pièce (`Room::update`)

1. Fond : écran du calque 0 (320 x 192 collé sous la barre de menus, `loadGameScreen`).
2. Hotspots du **calque 3** dans l'ordre de la liste des hotspots actifs, puis du **calque 1** triés par ordonnée du pied (`y + heightCopy`, inséré avant le premier dont le pied est strictement plus bas ; à égalité le premier arrivé d'abord ; `skipFlag` écarte), puis du **calque 2**. Seuls comptent ceux de la pièce affichée avec une animation (`numFrames != 0`) et un calque non nul. Après chaque sprite des calques 3 et 1, `addLayers` recopie par-dessus les cellules 32 x 32 des calques d'avant-plan 1 à 3 que le sprite touche (pixels non nuls) : c'est ce qui passe Diermot derrière l'arche du village.
3. Bulle de parole (`talkDialog`) en (x, 33), puis ligne d'état : si la commande est vide et qu'un hotspot est sous le pointeur, son nom (opaque, à 0, 0, couleur `0xE2`) ; sinon la commande en blanc (`0xE3`), coupée à 320 pixels.
4. Par-dessus (ordre de ScummVM : ce qui est posé directement sur l'écran) : barre de menus ou menu surgissant, boîte d'information (69, 61), confirmation (190 de large, centrée), puis le curseur.

**Cellules** : une grille de 18 x 14 (4 de marge), des cellules de 32 x 32, valeurs `0xFF` (vide), `0xFE` (voisine, ajoutée par `layersPostProcess`, jamais copiée) ou le numéro. `blockMerge` recopie un calque plus tardif sur un plus précoce quand ils occupent la même cellule. Une cellule hors de la grille est ignorée (ScummVM lirait la mémoire voisine).

**Sprites** : la planche d'un hotspot est `largeur x nombre d'images` sur `hauteur`, remplie de `colorOffset` ; chaque quartet y est écrit **plus `colorOffset`** (décalage de couleur : un même dessin, plusieurs palettes), et à l'affichage `colorOffset` est la couleur transparente. La planche est construite avec la taille, le décalage et l'animation du hotspot **à `setAnimation`** : le moteur garde ce relevé dans `Hotspot.animBuild` (seule modification de `engine/`, voir plus bas) ; si un script change ensuite `width` ou `colorOffset`, `Hotspot::copyTo` découpe la même planche avec les nouvelles valeurs, ici aussi. **Serf du chevalet** (`0x411`) : planche 416 x 27, images lues à la suite avec des tailles qui changent aux images 3 (48 x 25), 4 (hauteur 26), 5 (largeur 32), 6 (hauteur 27) et 7 (largeur 16), début de chaque image conservé (`frameStarts` : 0, 80, 160, 240, 288, 336, 368, 400) et découpe d'après ces débuts (testé).

## Palette et fondus

- Palette d'une pièce : `composeRoomPalette` (palette du jeu `0x3F01`, recouverte par celle du fond `(id & 0xFFE0) - 1`, puis la sous-palette `0x3F02` : 60 couleurs en 129, 8 en 220), 256 entrées de 8 bits ; identique à celle de ScummVM (comparée, 768 octets).
- Changement de pièce (`room.changes`) : l'image précédente (gardée) s'éteint (255 entrées, pas de 4 par composante, un pas toutes les 20 ms), les 220 premières entrées sont vidées, la nouvelle s'allume (pas de 4, une composante déjà au-dessus de la cible ne bouge pas). Pendant ce temps le curseur est le disque. ScummVM est bloqué dans le fondu ; ici `renderer.fading` dit à l'hôte de **ne pas appeler `engine.tick()`** (la page de dev le fait). Sans fondu au premier affichage ni au retour du générique.
- Le générique (`showingCredits`) montre l'écran `0x7800` avec la palette `0x77FF` (entrées 220 et suivantes noires), sans le fondu de ScummVM.

## Menus (D4, mode cliquable)

- Barre : l'image de la ressource 5 sur les 8 premières lignes ; l'en-tête touché a ses couleurs `0` et `0xF7` échangées ; le menu déroulé est une boîte en police fixe en (`xStart`, 8) ; l'entrée visée a `0xE2` et `0xE3` échangés. Le moteur (`MenuView`) dit quel menu et quelle entrée.
- Menu surgissant : **toutes les entrées** à gauche de l'écran, centrées en hauteur, celle sous le pointeur en blanc. ScummVM en mode souris montre un nombre impair de lignes autour de la sélection (`popupDialog(..., window)` sait le dessiner, le banc s'en sert pour comparer).
- Curseur : flèche pendant un menu, caché pendant une boîte d'information, une confirmation et le générique.

## Écarts avec ScummVM

- Seule la version VGA ; `_showInfo` (débogage) et la surface de la bouteille (calque `0xFE`) ne sont pas portés.
- Un code sans glyphe est dessiné comme une espace au lieu d'une erreur (aucun texte du jeu n'en a : testé).
- Fondus sur plusieurs images, moteur suspendu par l'hôte (voir plus haut) ; générique sans fondu.
- Sous une boîte d'information ou une confirmation, le rendu garde l'image de l'image de logique précédente, comme l'écran de ScummVM (`Dialog::show` met la pièce à jour en mémoire mais ne copie que la boîte). Reste une différence d'une image : la ligne d'état posée par un verbe (« Regarde ») apparaît sous la boîte d'information dans le portage, pas dans ScummVM, parce que l'ordre des ticks (`engine.md` § 9 : entrées, puis image) n'est pas celui de `Game::execute` (image, puis entrées).
- La boîte d'information est toujours en (69, 61) comme `Dialog::show` ; le « Statut » de ScummVM la centre en hauteur (le moteur n'a qu'un `dialogText`).
- La bulle (`TalkBubble`) est tenue par le rendu (texte, lignes, révélation d'un mot par image, un sur deux sans « texte rapide ») et le rendu écrit `room.talkDialogHeight` à chaque image pour la détection du pointeur sur la bulle ; non comparée au banc (aucun dialogue dans les scénarios).
- Le curseur est dans l'image (`cursor: false` pour le laisser à l'hôte).

## Comparaison au banc ScummVM

Le banc sans tête (`scummvm-build/bench/run.sh lure-fr SCÉNARIO DOSSIER DÉLAI`, graine 1) fait des captures de l'écran du jeu (indices `.idx` et palette `.pal`) ; `port/lure.test.ts` (vitest, `run-port.sh lure SCÉNARIO RÉF SORTIE`) rejoue le même scénario dans le portage (80 ms par tick, l'introduction sautée = le jeu démarre au `key ESC`), et apparie chaque capture de ScummVM à l'image du portage la plus proche (fenêtre de ±6 s : les ticks de ScummVM durent ≥ 90 ms contre 80, les phases d'animation dérivent). Scénarios : `l-cell` (cellule, survol, rafale de 10 images), `l-ui` (ligne d'état au survol, menu surgissant, boîte « Regarde », barre de menus), `l-room<N>` (commande de débogage `enter N`, trois captures).

| Capture | Différence (pixels) | Explication des restes |
| --- | --- | --- |
| cellule : arrivée, survol, barre survolée (`cell0`, `cell1`, `hover`, `menu-zone`, `idle0000`, `idle0001`, `idle0006` à `0009`) | **0** (indices et palette identiques) | |
| cellule `idle0002` à `0005` | 0,4 à 1,1 % | le Skorl passe la tête à la porte dans ScummVM ; son gestionnaire (`jailorAnimHandler`) n'est pas encore porté (vague L2) |
| `torch`, `door`, `popup`, barre | 0,03 à 0,07 % | flamme de la torche et point clignotant : phase d'animation |
| menu surgissant (cadre, texte, position, couleur de l'entrée) | **0** sur la zone du menu (trois lignes de ScummVM) | |
| boîte d'information (cadre, coupe des lignes, police) | **0** sur la boîte ; 0,13 % : la ligne d'état « Regarde » (écart ci-dessus) | |
| barre de menus ouverte | **0** sur les 8 lignes | le menu déroulé n'a pas pu être capturé : le banc n'a pas de commande « bouton maintenu » (ScummVM en mode souris referme au relâchement et n'affiche le menu qu'au premier mouvement) ; il utilise le même `newDialog` que le menu surgissant |
| pièces 10 (arche d'avant-plan, villageois), 11, 15, 20, 24, 30 | **0** | |
| pièces 6 et 12 | 0,06 à 0,07 % | un sprite en cours d'animation (phase) |
| pièce 3 | 1,1 % | le Skorl est dans la pièce dans le portage, pas dans ScummVM (comportement du moteur, pas du rendu) |

Planches côte à côte (ScummVM, portage, différences en magenta) : `scummvm-build/bench/sheets/lure-*.png` (copiées dans `scummvm-build/sheets/`) : `lure-cell-skorl`, `lure-ui-popup`, `lure-ui-info`, `lure-ui-bar`, `lure-room3`, `lure-room6`, `lure-room10`.
Les échantillons de ScummVM gardés pour les tests sont dans `test/lure/render/fixtures/scummvm-lure.json` (fabriqués par `make-scummvm-fixture.mjs` à partir des captures).

## Tests (`test/lure/render/`)

Texte (avance, coupe, opaque ou transparent, **chaque caractère des 1 804 textes, des noms et des textes d'interface a un glyphe**), palette et fondus, sprites (décalage de couleur, transparence, rognage, Serf du chevalet, tri), composition de la cellule comparée aux échantillons de ScummVM (pixels hors zones animées, palette, menu surgissant, boîte d'information, barre), menus et curseur, **les 45 pièces se composent** (avec fondu entre elles), cellules des calques.

## Séquences plein écran (groupe Q)

Référence : `intro.cpp`, `animseq.cpp`, `game.cpp` (`displayChuteAnimation`, `displayBarrelAnimation`, cas `GS_CAUGHT` de `Game::execute`), `scripts.cpp` (`endgameSequence`), `events.cpp`, `screen.cpp` (`paletteFadeIn`, `paletteFadeOut`), `sound.cpp` (`fadeOut`). Écrites en **générateurs** (`src/engine/sequence.ts`), une image de logique (80 ms) par tour, demandées par `ctx.block` : le monde est figé tant qu'elles tournent, la sauvegarde est refusée (`isMenuAvailable`).

| Fichier | Rôle |
| --- | --- |
| `engine/sequences/screen.ts` | `SequenceScreen` : l'écran système de ScummVM vu des séquences (320 x 200 indices, palette RVB 8 bits partant de celle du jeu), lu par le rendu ; `holdRoom` (la pièce s'éteint avant), `fadeIntoRoom`, `showCursor` |
| `engine/sequences/kit.ts` | `SequenceKit` : horloge à échéances (`sleep`, `interruptableDelay`, `waitForKey`), fondus de palette (`fadeIn`, `fadeOut` : pas de 4 par composante toutes les 20 ms, `paletteFadeOut()` sur 220 entrées), fondu de 3 s de la musique (`SoundManager::fadeOut`) |
| `engine/sequences/animation.ts` | `ScreenAnimation` : le constructeur de `AnimationSequence` (palette vidée, écran de départ, fondu), `show` (images toutes les `frameDelay` / 50 s, une attente de plus à la fin de chaque passage, sons par paquets d'images), `step` ; décodage dans `data/anim.ts` |
| `engine/sequences/intro.ts`, `ids.ts` | l'introduction : 4 écrans fixes (société, jeu, texte, titre) ; 5 animations (`anim_screens`, avec musiques 0 à 3 et fondu de 3 s) ; 7 images de bataille (`step`, 2 s, fondu, 0,5 s) ; écran final 33,3 s ; sections sonores « introduction » puis « jeu » |
| `engine/sequences/fullscreen.ts` | chute (trois animations, musique `0x40`), tonneau (musique `0x3B`), capture par le Skorl (sons de `catchSound`) |
| `engine/sequences/ending.ts` | méthode 14 : animation de la fin avec ses 11 paquets de sons, musique `0x28`, section « fin », défilé (30,5 s), écran final qui attend une touche, puis `host.exit()` |
| `render/sequence.ts` | `SequenceView` : image et palette de la séquence ; pour une séquence de partie, fondu au noir de la dernière image de la pièce (220 entrées, par pas de 20 ms) pendant lequel `renderer.fading` suspend le moteur |
| `render/renderer.ts` | `render` montre `engine.sequenceScreen` quand il existe ; la dernière image de la séquence devient l'image que le changement de pièce suivant éteint (`lastImage`), sauf après l'introduction (la cellule apparaît sans fondu) |

Saut (comme ScummVM) : **Échap** abandonne toute la suite (l'introduction, le reste de la chute) ; **un clic gauche ou une autre touche** passe l'attente ou l'animation en cours. Les écrans fixes se fondent au noir même quand Échap les interrompt (1,1 s) ; **les touches pendant un fondu sont perdues** (ScummVM vide les événements à chaque pas de fondu). Dans le moteur : `LureEngineOptions.intro` (l'hôte du navigateur le demande, les tests non) ; la chute et le tonneau se jouent **avant** l'entrée dans la pièce suivante (la pièce d'avant reste courante pendant l'animation, comme `playerChangeRoom` de ScummVM : la zone, les sons ambiants et les personnages retirés suivent l'animation).

Écarts :
- **Fondus** : ScummVM est bloqué dans les fondus (20 ms par pas, `updateScreen` en plus) ; ici, dans une séquence, la séquence écrit la palette elle-même par pas de 20 ms sur l'horloge du moteur (4 pas par image de logique : un changement visible par image de 80 ms, même durée totale). Le fondu de la **pièce** qui précède une séquence de partie est animé par le rendu (pas de 20 ms réels, moteur suspendu par l'hôte) ; il porte sur 220 entrées comme `paletteFadeOut()`.
- **Horloge** : chaque attente part de l'échéance de la précédente (images d'animation à 140 ms : 160, 160, 160, 80, 160 ms…, sans dérive) ; une attente interrompue repart de l'instant présent. Le temps de ScummVM est plus long : environ 7 ms de plus par pas de fondu et 1 ms par image d'animation (mesuré), soit 5 à 6 s sur les 244,5 s de l'introduction.
- AdLib seulement : pas de `initCustomTimbres`, pas de section MT-32 pour la fin ; l'EGA n'est pas porté ; la protection de copie et `boot_param` ne le sont pas.
- Le curseur n'est dessiné que pendant l'introduction (flèche) et le fondu de la pièce (disque) ; le reste des séquences le cache comme `cursorOff`.
- La fin ne rend jamais la main après `host.exit()` : le moteur reste figé sur l'écran noir.
- Les palettes dont les entrées 220 à 255 ne sont pas touchées gardent la palette du jeu ; ScummVM, au démarrage seulement, les remplit de valeurs d'initialisation (`Screen::Screen` passe une palette de 4 octets par couleur à une fonction qui en lit 3) jusqu'au premier `setPalette` complet de l'introduction (image de bataille) : sans effet sur l'image (aucun écran de l'introduction n'utilise ces indices), mais visible dans les 768 octets du banc.
- Services : `LureSound` gagne `loadSection`, `startFadeOut`, `fading` et `finishFadeOut` (facultatifs, `SoundManager` les a déjà) ; `LureContext.sequences` (écran, événements, horloge, sortie) ; `LureEngine` : `sequenceScreen`, `intro`.

Comparaison de l'introduction au banc (`bench/scenarios/l-intro-full.txt` : une capture toutes les 500 ms pendant 285 s, jusqu'à la cellule ; `port/lure.test.ts` cas `intro`, `port/lure-intro.ts` : le portage rejoue l'introduction depuis le début et apparie chaque capture à l'image du portage dont les indices sont identiques, puis la palette la plus proche) :

| Mesure | Résultat |
| --- | --- |
| captures de l'introduction (jusqu'à 249,5 s) | **498 / 498** aux indices identiques à une image du portage ; couleurs à moins de 12 : 498 / 498 |
| palette, entrées 0 à 219 | **identique** sur 464 captures ; écart de 1 à 2 pas de fondu (4 à 8) sur 34 autres : un pas de fondu d'avance ou de retard (ScummVM les fait par 20 ms, le portage les montre à l'image de 80 ms) |
| images distinctes de ScummVM (129) | les 129 sont montrées par le portage, **dans le même ordre** |
| durée | portage 244,5 s ; ScummVM environ 250 s (la cellule apparaît à 250,0 s) : ScummVM prend plus de temps, voir « Horloge » ; décalage de 0,55 s au premier écran (démarrage de ScummVM) à 5,4 s à la fin des images de bataille |
| cellule après l'introduction (72 captures) | 26 identiques, les autres de 0,02 à 1,2 % : le Skorl à la porte (`jailorAnimHandler`, L2) et les flammes, comme dans `l-cell` |

Séquences en jeu (scénarios `l-chute.txt` et `l-barrel.txt` : débogueur `console enter 11`, `console setfield 76 1` (chute) ou `2` (tonneau), clic sur la sortie du bas ; une capture toutes les 250 ms pendant 40 s ; le banc de `lure.test.ts` a une commande `setfield` en plus) : chute **156 / 160** et tonneau **156 / 160** captures à moins de 12 en couleurs, **141** et **135** identiques au pixel ; les 4 premières de chacune (l'extinction de la pièce) ne diffèrent que par la pose de Diermot qui marche vers la sortie (1 % des pixels), les autres écarts sont de 1 à 3 pas de fondu (palette) ; durée de la séquence (de l'animation à la pièce suivante) : chute 11,3 s dans le portage contre 13,5 s dans ScummVM, tonneau 25,8 s contre 29,5 s : ScummVM est plus long de 14 à 19 % (attentes de 10 ms en 10 ms, fondus avec mise à jour de l'écran, machine du banc chargée) ; les images sont les mêmes dans le même ordre. Planches : `lure-seq-chute.png`, `lure-seq-barrel.png`. Échantillons des tests : `test/lure/render/fixtures/scummvm-lure-sequences.json` (35 images distinctes de la chute, 103 du tonneau, retrouvées dans l'ordre : `sequence-scummvm.test.ts`). La **capture par le Skorl** et la **fin** n'ont pas de scénario du banc (la première exige de perdre le combat de la cellule ou du château, la seconde de gagner le dernier combat : aucune commande de débogage ne les déclenche) ; leurs animations sont celles de `AnimationSequence`, vérifiées ici sur la chute et le tonneau, et leur déroulé est testé (`sequences-play.test.ts`, `sequences-end.test.ts`).

Planches (ScummVM, portage, différences en magenta) : `scummvm-build/bench/sheets/lure-intro-start.png` (les quatre écrans fixes), `lure-intro-anim.png` (animations), `lure-intro-battle.png` (images de bataille et écran final), `lure-intro-fades.png` (en plein fondu), `lure-intro-cell.png` (la cellule qui suit). Échantillons gardés pour les tests : `test/lure/render/fixtures/scummvm-lure-intro.json` (empreintes MD5 des indices et de la palette de chaque image distincte ; `make-intro-fixture.mjs`).

Tests : `test/lure/engine/sequences-play.test.ts` (l'introduction jusqu'à la cellule : durée, musiques, section sonore ; Échap à cinq instants ; clic ; chute, tonneau, capture jusqu'au bout ; la pièce ne change qu'à la fin de la chute ; sauvegarde refusée), `sequences-end.test.ts` (méthode 14, fin du jeu par l'hôte), `test/lure/render/sequence.test.ts` (`SequenceView`, fondu de la pièce avant une séquence, premier affichage sans fondu, dernier écran éteint par le changement de pièce), `sequence-scummvm.test.ts` (comparaison aux empreintes de ScummVM).

## Points ouverts

- **T (dialogues)** : réutiliser `TalkBubble` / `bubbleText` (déjà branchés sur `room.talkDialog`) ; le choix du joueur en haut de l'écran (jusqu'à 3 lignes), les réponses, « Demande », « Donne » ne sont pas dessinés ; le Statut centré en hauteur non plus.
- **F (combats)** : les curseurs 23 à 25 passent par `room.cursor` ; aucun dessin propre.
- **Q (séquences plein écran)** : faites (voir la section plus haut) ; l'hôte doit passer `intro: true` au moteur, brancher la section sonore sur `SoundManager` et suspendre `engine.tick()` pendant `renderer.fading`.
- **J (hôte)** : suspendre `engine.tick()` tant que `renderer.fading` ; passer `elapsedMs` à `render` ; la page de dev montre le câblage (pointeur, molette, touches).
- Menu déroulé de la barre non capturé au banc (voir le tableau) : à confirmer si le banc gagne une commande de bouton maintenu.
