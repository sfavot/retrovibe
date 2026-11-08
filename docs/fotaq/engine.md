# Flight of the Amazon Queen : moteur (état et commandes)

Référence du moteur sans tête de *Flight of the Amazon Queen* (`src/games/fotaq/engine/`) : boucle, cadence, séquences, état, pièces, zones, commandes, inventaire, et les interfaces que les vagues suivantes implémentent.
Les formats sont dans `formats.md`, le plan d'ensemble dans `plan.md`. La **référence de comportement est le moteur `queen` de ScummVM** (`engines/queen/`, GPL v3+) : chaque module cite en tête les fonctions reprises et ses écarts.
Rien n'est transposé ligne à ligne ; les numéros magiques ont un nom (`Verb`, `Item`, `GameVar`, `Reply`). Le modèle est celui de Drascula (`docs/drascula/engine.md`).

**Confiance** : **lu** = lu en entier dans le code de ScummVM ; **vérifié** = couvert par un test sur les fichiers du jeu (`test/fotaq/engine/`) ; **supposé** = déduit, à confirmer sous ScummVM.

## 1. Modules

| Module | Rôle | ScummVM |
| --- | --- | --- |
| `host.ts` | `FotaqHost` (étend `BaseHost`) : fichiers, entrées (souris, actions du clavier), morceaux (`playSong`), journal | `Input`, `Sound::playSong`, `Logic::useJournal` |
| `cadence.ts` | un tick = une image de logique = 100 ms ; durée d'un texte sans voix | `QueenEngine::update`, `DELAY_NORMAL`, `Talk::countSpaces` |
| `src/engine/sequence.ts` (commun) | séquences (générateurs), saut, abandon : § 3 | remplace les boucles bloquantes |
| `input.ts` | souris, verbe tapé, demandes de passage (`cutawayQuit`, `talkQuit`) | `input.cpp` |
| `state.ts` | `GameData` (statique) et `GameState` (sérialisable) ; mot d'état d'un objet ; verbes, directions, objets et états nommés | `logic.h`, `state.cpp`, `defs.h` |
| `grid.ts` | zones cliquables de la pièce et du panneau, échelle d'une zone | `grid.cpp`, `Area::calcScale` |
| `room.ts` | objets d'une pièce, meubles, personnes, points de sortie, copie d'objets, images à la sortie | `Logic::eraseRoom`, `objectCopy`, `findPersonNumber`… |
| `inventory.ts` | objets possédés et quatre cases visibles | `Logic::inventory*` |
| `command.ts` | phrase de commande, survol, clics ; interpréteur des listes de commandes | `command.cpp` |
| `services.ts` | interfaces `Stage` (G2 / R), `Talk` (T), `Cutaways` (C) et leurs versions minimales | `Walk`, `Graphics`, `Display`, `Talk`, `Cutaway` |
| `stage.ts` | `GameStage` (G2) : la scène réelle, sans dessin ; assemble les modules ci-dessous : § 11 | `Graphics::update`, `Logic::setupRoom` |
| `bobs.ts` | bobs (déplacement, animations), tri en profondeur, table d'images, `findBob` / `findFrame` | `BobSlot`, `Graphics::sortBobs`, `BankManager`, `Logic::findBob` |
| `room-graphics.ts` | bobs d'une pièce : meubles, objets, personnes, images collées, `refreshObject` | `Graphics::setupNewRoom`… |
| `actors.ts` | acteurs de `QUEEN.JAS`, animation des personnes, table des pas | `Logic::findActor`, `Graphics::setupPerson`, `Walk::_moveData` |
| `joe.ts` | banques des tenues, pose, orientation (`joeFace`), saisie (`joeGrab`) | `Logic::joeFace`, `joeGrab`, `loadJoeBanks` |
| `walk.ts` | chemin entre zones, marche de Joe et des personnages | `walk.cpp` |
| `camera.ts` | défilement, parallaxe | `Display::horizontalScrollUpdate`, `Graphics::handleParallax` |
| `script.ts` | points d'extension de la logique codée en dur (vague L) | `LogicGame::setupSpecialMoveTable`, `changeToSpecialRoom`, `handleSpecialArea` |
| `loop.ts` | `FotaqEngine` : boucle, pièces, Joe à l'entrée, répliques de Joe, tenues, journal, `saveGame` / `loadGame` | `QueenEngine::run`, `update`, `Logic::displayRoom`, `setupJoeInRoom`, `makeJoeSpeak`, `setupRestoredGame`… |
| `save.ts` | sauvegarde : `snapshotState`, `restoreState`, `parseSave`, `matchesGame` (JSON versionné, § 12) | `Logic::saveState`, `Grid::saveState`, `BamScene::saveState` |

Tests : `test/fotaq/engine/` (`test-host.ts` : `TestHost` à horloge manuelle et `Player` qui clique ; `state.test.ts`, `grid.test.ts`, `command.test.ts`, `loop.test.ts` avec la scène minimale ; `bobs.test.ts`, `stage.test.ts`, `walk.test.ts`, `journey.test.ts` avec la vraie scène).

## 2. Boucle et cadence

**Lu** (`queen.cpp`) : `QueenEngine::run` boucle sur : changement de pièce demandé (`newRoom > 0`) ; sinon commande à exécuter (`joeWalk == JWM_EXECUTE` : `executeCurrentAction`) ; sinon `update(true)`.
`update` fait avancer les bobs, attend que 100 ms (`DELAY_NORMAL`) se soient écoulées depuis l'image précédente, lit les événements, met l'écran à jour, traduit la touche reçue (`checkKeys`) et, si `checkPlayerInput` et hors cinématique, lit le joueur (`Command::updatePlayer`).
Toutes les attentes du jeu sont des suites de `update()` : marche, répliques, cinématiques, `joeFace`, `joeGrab`.

Choix du portage : **un tick = une image de logique = 100 ms** (`TICK_MS`), seule constante de temps ; l'hôte appelle `tick()` avec `FixedStepClock` (`maxCatchUpTicks` = 3). `engine.tick()` : entrées, `checkKeys`, puis la séquence en cours ou un tour de boucle (`loopStep`).
Dans une séquence, une image est `yield* g.update(checkPlayerInput)` : les bobs avancent (`stage.frame`), un tick passe, puis le joueur est lu si demandé. **Comme dans ScummVM, le joueur peut cliquer pendant la marche de Joe** (`Walk::animateJoe` appelle `update(true)`) : le clic qui choisit une commande met `joeWalk` à `Execute`, la marche s'arrête (-1), l'action en cours se termine et la nouvelle commande part au même tick (vérifié : `loop.test.ts`).
La fin d'une séquence enchaîne au même tick le changement de pièce ou la commande en attente, comme la boucle de ScummVM qui n'attend pas entre deux branches.

**Écarts** : une image dure exactement 100 ms (ScummVM attend au moins 1 ms si l'image a pris plus de temps) ; pas de mode rapide (`kActionFastMode`), d'économiseur d'écran, de débogueur ni de sauvegarde rapide (l'hôte s'en charge, vague S).

## 3. Séquences

Module commun `src/engine/sequence.ts` (M1), utilisé tel quel. Ce qui bloquait dans ScummVM est une séquence : `executeCurrentAction` et tout ce qu'elle appelle, le changement de pièce (`changeRoom`, `displayRoom`), `setupJoeInRoom`, les tenues, `handleSpecialArea`, les services (`moveJoe`, `joeFace`, `speak`, `dialogue`, cinématiques).
Le survol et les clics (`updatePlayer`) sont synchrones. Une seule séquence racine : pendant qu'elle s'exécute, la boucle principale attend ; elle ne reprend la main au joueur que par `update(true)`.

- **Saut** : le runner lit `input.skipRequested()` (`cutawayQuit` ou `talkQuit`) dans les parties `skippable`. Comme ScummVM, les drapeaux restent levés jusqu'à ce que la cinématique ou le dialogue les remette à faux (vagues C et T) ; `checkKeys` ne lève `cutawayQuit` que si `canQuit` (une cinématique « non sautable » le met à faux).
- **Abandon** : `interrupted()` vaut `engine.ended` (fin du jeu, `endGame()`). Le chargement d'une partie l'abandonne aussi (`loadGame`, § 12).
- **Sauvegarde** (§ 12) : `canSave` est faux pendant une séquence ou une cinématique. Écart : ScummVM permet la sauvegarde rapide pendant la marche et les répliques de Joe (`canLoadOrSave` ne teste que la cinématique) ; un générateur en cours ne se sérialise pas.

## 4. Entrées

**Lu** (`input.cpp`) : un appui de bouton s'ajoute au masque `_mouseButton` jusqu'à sa lecture par `updatePlayer` ; un clic droit pendant un dialogue (Joe en mode `Speak`) passe la réplique (`talkQuit`) ; la dernière action reçue pendant une image (`_inKey`) est traduite une fois par image.
Le moteur reçoit de l'hôte `{ type: "pointer", x, y, buttons }` (état de la souris, écran 320 x 200) et `{ type: "action", action }`.

| Action | Effet (`checkKeys`) |
| --- | --- |
| `open`, `close`, `move`, `give`, `look`, `pickUp`, `talk`, `use` | verbe tapé (`keyVerb`) : comme un clic sur le verbe du panneau |
| `inventory1` à `inventory4` | case d'inventaire : verbe par défaut de l'objet (commande vide) ou objet de la commande en cours |
| `scrollUp`, `scrollDown` | flèches de l'inventaire |
| `skipText` | passe la réplique en cours |
| `skipCutaway` (Échap) | passe la cinématique ou le dialogue, si `canQuit` |
| `journal` | journal (`useJournal` : `host.openJournal`, D7) ; pendant une cinématique sautable, la passe aussi |

Le clavier est traduit en actions par l'hôte (`ui/keys.ts`, vague J) d'après `initKeymaps` de `engines/queen/metaengine.cpp` (**lu**) : verbes `CommandKeys[FR]` = `ofdnepau` (Ouvrir, Fermer, Déplacer, doNner, Examiner, Prendre, Adresser, Utiliser), cases `1` à `4`, `,` et `.` pour défiler, Échap = `skipCutaway`, F1 et F5 = `journal`. **Écarts** : Espace est la pause (dans ScummVM `skipText` : ici Entrée), F10 et F7 ouvrent les sélecteurs d'emplacements (F11 et F12 de ScummVM : F11 est le plein écran du navigateur), F9 règle le volume, pas de mode rapide (Ctrl+F : le moteur ne l'active que par la logique du jeu).
Comme dans ScummVM, l'appui droit qui coupe une réplique reste ensuite pour la commande (vérifié par test, sur une case d'inventaire il prépare le verbe par défaut).

## 5. Pièces, objets et zones

**Numéros** (lu, vérifié) : les objets de la pièce `r` sont `roomFirstObject[r] + 1` à `roomFirstObject[r + 1]` ; leur nombre est aussi celui de `Grid::_objMax` (vérifié sur les 126 pièces). Un « numéro dans la pièce » (`noun`) s'ajoute à `roomFirstObject[r]` (`currentRoomData`).
Zones de la pièce (`Grid::setupNewRoom`) : 1 à `objMax` pour les objets dont le nom n'est pas nul (supprimés : pas de zone), puis `objMax + n` pour la zone de marche `n` ; une zone de marche peut porter un objet (`findObjectNumber`). Les boîtes contiennent leurs bords.
Panneau (`setupPanel`) : huit verbes de 20 pixels (ouvrir, fermer, déplacer, donner, examiner, prendre, parler à, utiliser), deux flèches, quatre cases d'inventaire, en coordonnées sous la pièce (`y - 150`). Vérifié : `grid.test.ts`. Pas de limite de 32 zones : le jeu en a au plus 28 (10 zones de marche).
Correctif de ScummVM reproduit : boîte de l'escalier de la pièce 41 (objet 303) bornée par le meuble 295 (bug 2913).

**Changement de pièce** (lu, `QueenEngine::run`, `Logic::changeRoom`, `displayRoom`) : la pièce quittée devient `oldRoom` ; `script.changeToSpecialRoom` peut la prendre en charge ; sinon `displayRoom(pièce, FadeJoe, 100, 1, false)` : images des objets de la pièce quittée remises en ordre (supprimé : 0 ; éteint : -1 fixe, -2 animé), zones, décor et bobs (`Stage.setupRoom`, avec les meubles de la pièce), Joe placé (`setupJoeInRoom`), une image, fondu, puis Joe marche jusqu'à son point d'arrivée s'il en a un. `newRoom` revient à 0 si la pièce affichée est celle demandée.
`setupJoeInRoom` : position demandée (`joe.startX/Y`), sinon point de sortie de l'objet d'entrée (Joe marchera ensuite jusqu'à l'objet), sinon l'objet d'entrée ; échelle de la zone de marche (`areaScale` : entiers tronqués, 0 devient 100) ; Joe tourne le dos à l'objet d'entrée, sauf orientation imposée par une cinématique (`cutFacing`) ; pièce 108 : Joe tourné à droite.
**« Aller vers » une sortie** (`makeJoeWalkTo`) : une sortie ouverte (`entryObject > 0`) demande la pièce de l'objet d'arrivée et vise le point de sortie de l'objet ; une sortie fermée (`entryObject < 0`) arrête la commande. Les coordonnées des points de sortie sont des mots 16 bits relus signés (65506 = -30), comme les `int16` de ScummVM.
Vérifié (`loop.test.ts`) : chaque pièce se charge ; la porte de l'avion (pièce 1) s'ouvre puis mène à la pièce 2, Joe part du point de sortie de l'objet 8 et marche jusqu'à lui.

## 6. Commandes

### Construction (synchrone, `updatePlayer`)

Lu (`Command::grab*`, `lookFor*`) et réécrit à l'identique : un verbe du panneau commence une commande ; un objet la complète (« utiliser » d'un objet dont le bit 10 est à 0 et « donner » attendent un second objet : « utiliser couteau avec », « donner X à ») ; sans verbe, un clic gauche sur un objet est « aller vers », un clic droit prend le verbe par défaut de l'objet (bits 4 à 7 de son état) ; un clic gauche sur une case d'inventaire est « examiner », un clic droit son verbe par défaut ; un clic dans le décor fait marcher Joe.
Survol : le nom de l'objet précédé du verbe en cours ou du verbe par défaut (« parler à portier »). La phrase (`command.text`) et la ligne affichée (`command.line` : texte et encre `normal` / `select`) sont des états pour le rendu (vague R). Seule la variante française de `CmdText` existe.
Particularités gardées : un verbe tapé sur une case d'inventaire prend le verbe par défaut sans l'écrire dans la phrase (« utiliser » devient «  batte avec ») ; sélectionner un verbe pendant la marche remet Joe en mode `Normal` sans l'arrêter.

### Exécution (séquence, `executeCurrentAction`)

1. Clic droit sur un objet : le verbe par défaut est pris. Ligne en encre `select`.
2. `handleWrongAction` : une marche simple, un sujet caché, une marche jusqu'à l'objet interrompue ou une sortie fermée arrêtent tout ; « utiliser » une sortie devient « aller vers ».
3. Listes de commandes qui correspondent **exactement** au verbe et aux deux sujets (objet du jeu > 0, objet d'inventaire < 0), dans l'ordre ; la liste **649 est ignorée** (bug 2636). Aucune : Joe dit pourquoi (`sayInvalidAction` : réponses 1 à 29 de `QUEEN2.JAS`, dont certaines au hasard ; « examiner » donne la description).
4. Pour chaque liste : `setConditions` si son drapeau est levé. Les états testés (numéro > 0) doivent avoir leur valeur ; alors les états à poser (numéro <= 0, `|numéro|`) le sont et la liste s'exécute avec la réplique du dernier. Une condition manquée ne pose rien : pour la **dernière** liste seulement, Joe dit la réplique de la condition (ou la cinématique, le dialogue qu'elle nomme est joué : -2), sinon on passe à la liste suivante (-1).
5. `executeCommand` : zones, geste de saisie (sauf « parler à » et « aller vers »), cinématique ou dialogue nommé par la réplique (`*.CUT`, `*.DOG` en fin de description), objets, inventaire, image du sujet (`imageOrder` : > 0 nouvelle image, < 0 éteinte), morceau joué avant l'action (pas pour ouvrir / fermer), section spéciale (1 journal, 2 robe, 3 vêtements, 4 sous-vêtements), ouvrir / fermer / déplacer (`changeObjectState` : bit 8 = fermé ; une porte entraîne la porte de l'autre côté), réplique.
6. Fin : « examiner » sans réplique donne la description (descriptions successives : 0 la première puis au hasard, 1 au hasard, 2 en boucle, 3 jusqu'à la dernière) ; sinon morceau joué après l'action (`song < 0`) ; Joe se retourne (`joeFace`).

Effets (lu, vérifié) : **zones** allumées / éteintes (signe de `mapNeighbors`) ; **objets** montrés (`name > 0`), cachés (`< 0`), supprimés (`0`, et leur zone de la pièce courante devient une boîte 0,0-1,1, image éteinte sauf personne ou sujet) ou remplacés par un modèle (`objectCopy` : copie, échange si le modèle a plus d'images, point de sortie repris) ; **objets d'inventaire** ajoutés (en première case) ou retirés, éventuellement remplacés par une source.
Une sous-liste n'est appliquée que si le drapeau de la liste le demande : **constaté** sur `QUEEN.JAS`, des enregistrements existent sans leur drapeau (objets et inventaire de la liste 203, inventaire de la 277 : jamais appliqués, comme dans ScummVM), et des drapeaux sans enregistrement (20 listes pour les zones, 26 objets, 18 inventaire, 1 états). 508 enregistrements d'états nomment une cinématique ou un dialogue (66 sur une condition testée). Sections spéciales : listes 102, 106, 666 (journal), 275, 276 (robe), 279 (vêtements).
Le hasard (`getRandomNumber(n)`, 0 à n) est le `Lcg` du moteur (`rng.inclusive`), à graine injectable : non sauvegardé (ScummVM ne le sauve pas non plus). La boucle sans fin de `nextObjectDescription` pour une description aléatoire à un seul texte est bornée (cas absent du jeu).

**Vérifié** (`command.test.ts`) : les **866 listes** s'exécutent chacune dans son contexte (pièce de son premier objet, conditions remplies) sans erreur et produisent les effets qu'elles décrivent (états, zones, objets, inventaire, image, morceau, ouverture et fermeture) ; aucune liste n'a de conditions contradictoires ; pour les 455 listes à condition testée, une condition manquée laisse l'état intact et rend -1 ou -2 avec la réplique attendue ; l'état reste sérialisable en JSON ; aller-retour (effets rejoués sur l'état restauré : même état).
Parcours (`loop.test.ts`) : pièce 1, examiner le sac fermé (« C'est fermé »), l'ouvrir (morceau 138, image 4), l'examiner (couteau et briquet) ; pièce 2, « utiliser couteau avec tige de nénuphar » (condition manquée puis remplie) ; pièce 73, prendre la clef (cinématique `c73d.CUT` tant que la condition manque, puis la clef passe dans l'inventaire et sa zone disparaît), parler au portier (dialogue `laris.DOG`).

## 7. Inventaire

Lu (`logic.cpp`) : un objet est possédé quand son nom est positif ; les quatre cases montrent des objets possédés qui se suivent par numéro, en boucle. Ajouter met l'objet en première case et les suivants derrière ; retirer montre les objets qui le suivent ; les flèches défilent d'un objet (de quatre au clic droit) s'il y a plus de quatre objets. Départ : la batte et le journal.
Particularité gardée : `nextInventoryItem` et `numItemsInventory` s'arrêtent avant le dernier objet (100, « B.D », même nom que l'objet 10). `removeHotelItems` (objets de l'hôtel retirés la première fois dans la pièce 1, appelé par les cinématiques) est porté pour la vague C.

## 8. Interfaces des vagues suivantes (`services.ts`)

Le moteur G1 n'appelle la marche, les bobs, le décor, les répliques et les cinématiques que par trois interfaces, passées au constructeur (`FotaqEngineOptions`). Chacune a une version minimale qui suffit aux tests.

| Interface | Vague | Méthodes | Version minimale |
| --- | --- | --- | --- |
| `Stage` | G2 (marche, bobs, Joe, caméra : **faite**, `GameStage`) et R (décor, palette : **faite**, `graphics.md`) | `setupRoom`, `eraseRoom`, `fadeOut`, `fadeIn`, `placeJoe`, `frame`, `moveJoe`, `stopJoe`, `joeFace`, `joeGrab`, `refreshObject`, `clearObjectBob`, `setOutfit`, `render` | `StubStage` : Joe arrive après une image (interrompu si le joueur a choisi une autre commande pendant cette image), rien n'est dessiné ; garde les déplacements, rafraîchissements et la tenue |
| `Talk` | T (**faite**, `FotaqTalk`, `talk.md`) | `speak(g, texte, personne, préfixe de voix)`, `dialogue(g, fichier, personne)` (rend la cinématique à enchaîner) | `StubTalk` : la réplique est notée et dure `textFrames` images (clic droit ou `skipText` l'arrêtent) ; les dialogues sont notés |
| `Cutaways` | C (**faite**, `FotaqCutaways`, `cutaway.md`) | `play(g, fichier)` (rend la suivante) | `StubCutaways` : notées, sans effet |

Contrats pour G2 : `moveJoe(g, facing, x, y, inCutaway)` met `g.setJoeWalk(JoeWalk.Move)`, appelle `g.update(true)` à chaque image, s'arrête si `g.joeWalk === JoeWalk.Execute` ou `g.input.cutawayQuit` (rend -1), appelle `g.handleSpecialArea(...)` sur une zone éteinte (rend -2), dit la réponse 4 si le chemin est bloqué (-1), tourne Joe vers `facing` à l'arrivée et appelle `joeFace` ; l'état de Joe est `g.state.joe` (position des pieds, échelle, orientations) ; la caméra règle `g.horizontalScroll`.
`placeJoe` pose le bob 0 depuis `g.state.joe` (pièce 108 : banque `JOE_E.ACT`, défilement de 320) ; `joeFace` et `joeGrab` font les images de ScummVM (`update()`). `findBob` / `findFrame` (numérotation des bobs) sont dans `bobs.ts` (§ 11). Le moteur utilise `GameStage` par défaut ; `StubStage` reste pour les tests qui n'ont pas besoin de la marche.
Contrats pour T (réalisés dans `talk.ts` et `dialogs.ts`) : `speak` met `g.setJoeWalk(JoeWalk.Speak)` (ce qui signale le dialogue aux entrées), remet `talkQuit` à faux au début, lit `skipText` ; la mémoire des dialogues est `state.talkSelected` (86 entrées).
Contrats pour C (réalisés dans `cutaway.ts`) : `play` règle `input.cutawayRunning` et `canQuit`, remet `cutawayQuit` à faux à la fin, peut changer de pièce (`g.displayRoom`, `newRoom`), appelle `g.executeSpecialMove(n)` et `g.inventory.removeHotelItems()`.
L'hôte (`FotaqHost`) a l'image depuis la vague R (`present(pixels, palette)`, appelée par `FotaqEngine.render()` ; `fileExists`) et, depuis la vague T, les voix (`playSpeech`, `speechActive`, `stopSpeech`, `stopSfx`, `preloadSpeech`, `lastSong`, tous facultatifs : `talk.md` § 4). Le moteur les utilise par `FotaqEngine.playSpeech`, `stopSpeech`, `speechFound`, `speechPending`.
**Les vraies implémentations** (T et C) demandent la scène réelle (`GameStage`) ; `FotaqEngine` crée par défaut `GameStage`, `FotaqTalk` et `FotaqCutaways`. Autres ajouts du moteur : `showCurrentRoom` (`Logic::changeRoom`, utilisé par la fin d'une cinématique), `scene` (compteur de `Logic::_scene`), `startCredits` / `stopCredits` (`credits.ts`), `warnings`, `preloadSpeech` au changement de pièce ; `RoomDisplay` est dans `state.ts` (réexporté par `loop.ts`).

## 9. Logique codée en dur (vague L) : points d'extension et inventaire

`GameScript` (`script.ts`) : `specialMoves` (par numéro), `changeToSpecialRoom` (au changement de pièce), `handleSpecialArea` (zone éteinte : rend la cinématique à enchaîner). Le moteur fait le reste (tourner Joe, annuler la pièce demandée, enchaîner les cinématiques). Les tenues (sections spéciales 2 à 4, mouvements 2 à 4) sont dans le moteur (`joeUseDress`, `joeUseClothes`, `joeUseUnderwear`) : la scène fournit palette et banques (`Stage.setOutfit`).

**Mouvements spéciaux** (lu : `LogicGame::setupSpecialMoveTable`, version DOS ; cinématiques qui les lancent : relevé sur les 302 `.CUT`). **Correction de la vague C** : la colonne « Cinématiques » ci-dessous compte tous les enregistrements dont `specialMove` est non nul ; quand l'enregistrement a un déplacement (`moveTo`), ce champ est la vitesse du bob, pas un mouvement. Le relevé exact (appelés à l'arrivée à un enregistrement sans déplacement, ou à la fin d'une cinématique sautée) est dans `cutaway.md` § 5 et vérifié par `cutaway-details.test.ts`. La table de la version DOS en définit **37** (2 à 34, 36 à 39), et non 46 comme l'estimait le plan ; le numéro 1 (cité par `C25B.CUT`) n'a pas de fonction (sans effet, comme dans ScummVM), le 35 n'est cité nulle part.

| N° | Fonction de ScummVM | Cinématiques |
| --- | --- | --- |
| 2, 3, 4 | tenues : robe, vêtements, sous-vêtements (moteur) | 3 : C74A ; 4 : C25A, C2A, C2C, C73A |
| 5, 6 | palette de la robe, palette normale | 5 : C74A, CDRES, CRED, CUDRS ; 6 : CDCLO, CRED, PC73E |
| 7, 8, 31 | course de voiture : départ, arrêt, attente de la position (pièce 74) | 7 : C73E, C73F, CRED ; 8, 31 : C74A |
| 9 | combat final (pièce 69) | C69E, C69F, C69G, C69Z, C73A, C73B, C74F, CRED |
| 10, 11, 12, 13 | Frank : attente de position, Frank grandit, le robot grandit, le robot rétrécit | 10 : C30C, C69E-G, C72A, C97B, COMIC ; 11 : C13E, C13G, C16A, C69Z, C70B, C70F, C70G, COMIC ; 12 : C41B, C44B, C50F, C51A, C69Z, C75B, CDINT, CINTR, COMIC, CRED ; 13 : C42B, C67A, C67B, C69G, CDINT, CINTR, COMIC |
| 14 | fin du jeu (`endGame` du moteur) | BLUEP, C16B, C24A, C25D, C35B, C49C, C56B, C63A, C69G, C75B, PC73E |
| 15, 16 | caméra sur le dinosaure, sur Joe | 15 : C103F, C103I-K, C15A, C25E, C67A, C97B, CINTR, COMIC ; 16 : C67A, CINTR |
| 17, 18 | introduction alternative : panoramiques | 17 : C102A, C16B, C35A, C36A, C39A, C3A, C40A, C41A, C62A, C75B, C76B, C8A, CINTR, COMIC ; 18 : CINTR |
| 19 | Azura amoureuse (état 167) | C41A |
| 20, 24, 26 | panoramiques depuis Joe, vers Joe, de 320 à 144 | 20 : C100C, C100D, C69G ; 24 : C100C, C100D ; 26 : C69G |
| 21, 22, 23 | lumières éteintes, allumées, zone du mannequin (pièce 103) | 21, 22 : C103F, C103I-K, C25E ; 23 : C103F |
| 25 | gardes (état 85) | C63C |
| 27 | baiser (avec défilement en DOS) | C69G |
| 28, 29, 30 | éclair sur l'avion, dirigeable, échelle de la fin | 28 : C75B ; 29, 30 : C69G |
| 32 | tremblement de l'écran | C75B |
| 33 | puzzle (`puzzleAttemptCount`) | C102C, C102D |
| 34 | titre (échelle en DOS) | CRED |
| 36 à 39 | introduction : panoramique vers Hugh, flash blanc, vers Joe et Rita, vers la bombe | CDINT |

**Cas de pièce** (lu) : `changeToSpecialRoom` (pièce 7, sommet du piton : sélection de la destination à la souris, `handlePinnacleRoom` ; pièce 95, logo : `COPY`, `CLOGO`, `CDINT`, `CRED`, puis le hall de l'hôtel par l'objet 584 et `C70D`) ; `handleSpecialArea` (pièces 4, 6, 14, 16, 17, 22, 26, 30, 32, 50, 53, 55, 71, 73, 100, 101, 103 : réplique ou cinématique selon la zone et des états) ; ailleurs, propres au rendu ou au son : parallaxe (`Graphics::handleParallax` : pièces 17, 43, 51, 67, 69, 74, 90, 100, 116, 123), défilement de palette (pièces 4, 74, 123), couleurs de texte (pièces 9, 100), têtes parlantes (pièces 37, 106, 107), son de la pièce 111, cas des cinématiques (pièces 41, 43, 47, 63, `c41f`, `c62c`). Déjà dans le moteur : liste 649, escalier de la pièce 41, Joe dans la pièce 108, objets de l'hôtel.
**Mise en place faite** : convention, assembleur, aides, joueur scripté, solution découpée et groupe 6 (introduction, piton) dans `docs/fotaq/specials.md` (code : `src/games/fotaq/engine/specials/`). Le découpage ci-dessous y est corrigé (pièces 62 et 63 au temple, pièces 97 à 99 au groupe 3). `GameScript` gagne `roomUpdates` ; le mode rapide (`Input.fastMode`, `FAST_RATIO`) et la secousse de l'écran (`Display.shakeY`) sont portés.
**Découpage proposé pour la vague L** (un dossier `specials/group-N/` par zone du jeu, comme `docs/drascula/rooms.md`) : jungle et piton (pièces 1 à 15, 7), Amazones et village (16 à 21), Floda (22 à 42, 103, mouvements 21 à 23, 25), temple et labyrinthe (43 à 61, 100 à 102, mouvement 33), vallée, hôtel et course de voiture (62 à 76, mouvements 7, 8, 31, 32), fin (69, 75, mouvements 9 à 13, 27 à 30, 14), introduction et générique (95, 116 à 126, mouvements 15 à 18, 34, 36 à 39).

## 10. État sauvegardable

`GameState` contient ce que `Logic::saveState` et `Grid::saveState` écrivent : objets, objets d'inventaire, cases visibles, zones de marche, points de sortie, descriptions successives, 211 états du jeu, 86 mémoires de dialogue, Joe (position, orientations, échelle), pièce, tentatives du puzzle.
Ne sont pas dans l'état (comme ScummVM) : le mode de Joe, la commande en construction, le défilement, le hasard. La sauvegarde (§ 12) y ajoute ce que le moteur garde ailleurs : dernier morceau, course ou combat (`BamScene`), pièce dans le noir.

## 11. Scène : bobs, marche, Joe, caméra (vague G2)

`GameStage` (`stage.ts`) implémente `Stage` **sans dessiner** : la vague R compose l'image à partir de son état. Réécriture de `Walk` (`walk.cpp`, **lu en entier**), de `BobSlot` et des parties logiques de `Graphics` (`graphics.cpp`), de `BankManager` (`bankman.cpp`), de `findBob`, `findFrame`, `joeFace`, `joeGrab`, `loadJoeBanks`, `findActor`, `initPerson` (`logic.cpp`) et de `Display::horizontalScrollUpdate`.

### Ce que R lit

| État | Contenu |
| --- | --- |
| `stage.bobs.sorted` | bobs actifs **dans l'ordre de dessin** (ordonnée des pieds croissante, puis numéro d'emplacement ; recalculé à chaque `frame`) |
| `BobSlot` | `x`, `y` (pieds, avant défilement), `frameNum`, `xflip`, `scale` (%), `box` (`null` : l'écran de jeu, 150 lignes, ou 200 en plein écran) |
| `stage.bobs.frames.frame(n)` | `{ bank, image }` : fichier de banque et numéro d'image (à partir de 1) de l'image `n` de la table ; `undefined` : image vide (rien à dessiner) |
| `g.horizontalScroll` | défilement du décor (0 à 320), réglé par la caméra |
| `stage.rooms.pasteDowns` | images à coller dans le décor de la pièce (`x`, `y`, `frame`), dans l'ordre |
| `stage.backdropWidth`, `stage.screenMode`, `stage.outfit` | largeur du décor (lue dans l'en-tête du PCX), panneau / cinématique, tenue de Joe (palette) |

Dessin d'un bob (`Graphics::drawBobs`, à reprendre en R) : point d'ancrage `(xh, yh)` de l'image ; si `xflip`, `xh = largeur - xh` ; si `scale` != 100, `xh = xh * scale / 100`, `yh = yh * scale / 100` (entiers) ; position écran `(x - xh - défilement, y - yh)` ; image réduite par `shrinkFrame` (taille `(largeur * % + 50) / 100`, échantillonnage `i * 100 / %`) ; couleur 0 transparente.

### Bobs et images (lu, vérifié)

- 64 emplacements ; **0 Joe, 1 à 3 les personnes, 5 et suivants les bobs animés (meubles puis objets), 20 et suivants les bobs fixes (meubles puis objets)**. Table de **256 images** : 11 à 30 marches de Joe, 31 son image affichée, 35 à 37 ses poses de profil, de face, de dos, 31 + rang les personnes debout, puis à partir de 39 les meubles, les objets de la pièce, les animations des personnes.
- **Vérifié** (`stage.test.ts`) : dans les 126 pièces, toutes les images des bobs, des chaînes d'animation et de la table existent dans leur banque (jamais plus de 121 images utilisées) ; chaque objet fixe visible a son bob à sa position avec son image (`findBob`, `findFrame`).
- Animations : en boucle ou en aller-retour (`animNormal`, durée en images de logique) ou **par chaîne** (`animString`, durée en quarts : une entrée dure `durée / 4` images ; image > 500 = effet sonore, `GameStage` options `onSfx`). Chaînes d'objets : `graphicAnimations` de `QUEEN.JAS` (images triées, un numéro négatif retourne le bob) ; chaînes de personnes : `QUEEN2.JAS` (couples de 4 + 4 caractères lus à positions fixes ; l'animation 9, au format des cinématiques, n'est utilisée par aucun acteur).
- Une **vitesse d'animation nulle fige** l'animation (comme ScummVM, `--speed` ne repasse jamais par 0).
- **Quirk de ScummVM reproduit** : `findBob` et `findFrame` comptent un objet à image collée (> 5000) comme s'il avait un bob et une image alors que `setupRoomObjects` ne lui en donne pas. Seule la pièce 102 (puzzle, objets 698 et 699 après les images collées 695 et 696) est touchée : un `refreshObject` de ces objets viserait le mauvais bob. À corriger si la vague L en a besoin.

### Marche (`walk.ts`, lu, vérifié)

1. Joe et le point visé sont rangés dans une zone de marche (`findAreaForPos` ; hors de toute zone ou sur une zone d'objet : la zone la plus proche, distance diagonale comprise, et le point est ramené dans la zone).
2. Même zone : un segment droit. Sinon `calcPath` : parcours en profondeur des zones voisines (bit `n - k` de `|mapNeighbors|` pour la zone `k`), en revenant en arrière dans les impasses ; le point de passage entre deux zones est la position courante si elle est dans le recouvrement des deux boîtes, sinon son milieu (`calcC`).
3. Chaque segment choisit son animation : marche de profil (images 11 à 18, retournée à gauche), de face (19 à 24) ou de dos (25 à 30) si le déplacement est assez plus vertical qu'horizontal compte tenu de l'échelle de la zone.
4. Vitesse : `échelle * 6 / 100` pas par image (la moitié sur l'axe y), recalculée à chaque image avec l'échelle de la zone sous Joe (`areaScale`) ; le joueur est lu à chaque image (`update(true)`) : une nouvelle commande ou `cutawayQuit` arrête Joe (-1).
5. Une zone **éteinte** (`mapNeighbors` < 0, mais traversable par le calcul du chemin) arrête la marche et appelle `g.handleSpecialArea` (-2) ; un chemin introuvable fait dire à Joe la réponse 4 (-1). À l'arrivée Joe prend l'orientation demandée et se tourne sans passer par un profil (`prevFacing` = `facing`).
6. Dans une cinématique, un point hors de toute zone n'est que noté (aucune marche, comme ScummVM).

**Vérifié** (`walk.test.ts`) : dans les 126 pièces, de chaque point d'entrée ou de sortie (point de sortie de ses objets de passage, sinon leur position) à chaque autre, **790 trajets** : arrivée au point visé ou, s'il est hors zone, dans la zone la plus proche ; 64 s'arrêtent sur une zone éteinte, une seule fois et sur une zone effectivement éteinte. **Huit pièces ont des zones de marche en plusieurs îlots dans les données** (39, 49, 52, 54, 97, 99, 100, 101) : d'un îlot à l'autre aucun chemin n'existe (confirmé par un calcul de composantes indépendant), Joe dit la réponse 4 ; dans les pièces 100 et 101 (labyrinthe) et 97 et 99 c'est la logique codée en dur (vague L) ou les cinématiques qui déplacent Joe d'un îlot à l'autre (**supposé**, non lu).
Personnages (`movePerson`, pour les cinématiques de la vague C) : même chemin, pas de la table `MOVE_DATA` (20 personnages ; un nom absent n'a aucun pas), série d'images retournée selon le sens, arrêt sur l'image debout (de face ou de dos) et personne retournée (image -3 gauche, -4 droite).

### Joe (`joe.ts`)

`joeFace` : une image par pose ; en se retournant (face / dos, gauche / droite) il passe d'abord par la pose de profil (**2 images** au lieu d'une) ; `prevFacing` suit. `joeGrab` : une image (milieu, haut), trois vers le bas. Pièce 108 : image fixe de `JOE_E.ACT`, caméra libre, défilement 320. Tenues : `setOutfit` recharge les banques de marche et de pose (`JOE_*`, `JOED_*`, `JOEU_*`) ; la palette est à R. **`g.state.joe.x` et `y` suivent le bob 0** (recopiés à chaque image et à la fin de la marche) : le bob est la référence pendant un mouvement, l'état entre deux.

### Caméra (`camera.ts`)

Le bob 0 est suivi par défaut dans les pièces de jeu ; décor de 640 pixels : défilement `x - 160` entre 160 et 480, 0 en deçà, 320 au-delà ; décor de 320 : aucun. Pièces de 640 pixels : 7, 17, 20, 43, 51, 67, 90, 100, 108, 109, 111, 115, 116, 120, 122 (**vérifié**). Parallaxe (`handleParallax`) : pièces 17, 43, 51, 67, 90, 100 (bobs qui glissent à demi-vitesse), 116 (introduction : panoramique de 80 pixels, Joe et Rita s'approchent) et 123 (explosion) ; pièces 74 (course de voiture) et 69 (combat final, `BamScene`) : la vague L enregistre sa fonction dans `stage.roomUpdates`.

### Écarts et points ouverts pour les vagues suivantes

- **Pas de limite** de 16 segments de marche ni de 16 zones sur un chemin ; une pièce sans zone de marche utilise une zone vide (Joe y va en 0, 0, comme ScummVM qui lit une zone mise à zéro) ; `clearObjectBob` n'éteint pas Joe si l'objet n'a pas de bob (ScummVM le ferait).
- **R (faite, `graphics.md`)** : fondus, palettes (tenue, lumière dynamique), mode d'écran, texte au-dessus des bobs (`GameStage.setBobText`), curseur. `eraseRoom` efface la table d'images **avant** le fondu de sortie (comme ScummVM) : le rendu garde la dernière image affichée pendant le fondu (`display.frozen`).
- **C** (faite) : `Bobs.setCutawayAnim` (`setBobCutawayAnim`, chaîne propre à la cinématique), `FrameTable.overpack` (surimpression de la bouche et du torse, `FrameRef.overs`), `GameStage.playRoomSfx`. `BobSlot.curPos` range les coordonnées du fichier en 16 bits signés (un objet peut entrer par le haut de l'écran : y = 65444 est -92).
- **A** (fait) : `GameStage` option `onSfx(effet)` pour les images d'animation > 500 ; l'effet de la pièce est `roomSfx[pièce]`. Le moteur crée son `GameStage` avec `onSfx: (sfx) => host.playSfx?.(sfx)` ; `FotaqHost.playSfx` (facultatif) et `playSong` vont à `FotaqAudio` (`docs/fotaq/audio.md`).
- **L** : `stage.roomUpdates` (voiture, combat) ; `BamScene` n'est pas porté.
- `joeFace` dure maintenant 1 ou 2 images (0 avec la scène minimale) et la marche plusieurs : les durées des commandes et des changements de pièce sont celles de ScummVM.

## 12. Sauvegardes (vague S)

**Format** (`engine/save.ts`, **vérifié**) : un objet JSON versionné (`SAVE_VERSION = 1`), sans lien avec le format de ScummVM (décision D7). Il contient : `room`, `entryObject` ; les tables du jeu en **lignes de nombres** (`objects`, `items`, `walkOffs`, `objectDescriptions`, `areas` par pièce, `talkSelected` : l'ordre des champs est `*_FIELDS`, le type vérifie qu'aucun champ de la table d'origine n'est oublié) ; `gameStates` (211), `inventory` (4 cases), `joe`, `puzzleAttemptCount` ; et ce que le moteur garde hors de l'état : `lastSong` (`Sound::_lastOverride`, lu par `host.lastSong?.()`), `bam` (`flag`, `index`, `screenShaked`, `fightTable` de `BamScene`), `lightsOff` (mouvements 21 et 22 : `Palette.dark`). La **tenue** de Joe est l'état du jeu 19 (`JoeDressingMode`) : elle n'est pas sauvegardée à part. Taille : 47 Ko par emplacement (de quoi en garder dix dans `localStorage`). Ne sont **pas** sauvegardés : `oldRoom`, `newRoom` (aucune pièce demandée au repos), le mode de Joe, la commande en construction, les entrées, le défilement (la caméra le recalcule), le hasard (ScummVM ne le sauve pas non plus), les images des bobs.
`parseSave(valeur)` valide (version, types entiers, largeur de chaque ligne, tailles fixes : 211 états, 86 dialogues, 4 cases) et rend `null` pour tout ce qui n'est pas une sauvegarde de cette version, un emplacement dans ce cas compte comme vide ; `matchesGame(save, data)` vérifie en plus que les tailles de tables et les numéros (pièce, objets d'inventaire) correspondent aux données du jeu chargées (`loadGame` rend faux sinon).

**Moteur** : `engine.saveGame(): SaveData | null` (`null` si `!canSave`) ; `engine.loadGame(save): boolean` ; option `new FotaqEngine(host, { restore })` pour reprendre depuis l'écran titre (lève si la sauvegarde ne correspond pas aux données).
- `canSave` est faux pendant toute séquence (**commande en cours de marche, réplique, dialogue et son menu de choix, cinématique, changement de pièce**), pendant une scène (`scene > 0`), quand une commande choisie n'est pas encore exécutée (`joeWalk === Execute`), après la fin du jeu. ScummVM (`canLoadOrSave`) refuse seulement pendant une cinématique (sa sauvegarde rapide passe pendant la marche) : écart, un générateur en cours ne se sérialise pas.
- `loadGame` s'appelle **entre deux ticks** (l'hôte, pas une séquence) : la séquence en cours est abandonnée (`abort`, ses `finally` s'exécutent), les entrées, le mode de Joe, la scène, le générique, la voix et l'effet en cours, les textes, le panneau gris, la secousse, la commande sont remis à zéro ; l'état est remplacé (`restoreState` : `oldRoom` = la pièce, de sorte que `eraseRoom` remet en ordre les images des objets comme à une sortie de pièce, `cutFacing` = l'orientation sauvegardée) ; puis une séquence (`Logic::setupRestoredGame`) pose la tenue (`setOutfit` : banques et palette de Joe), **réaffiche la pièce** (`displayRoom` en mode `FadeJoeXY` : fondu, bobs refaits d'après les objets, Joe à sa place), relance la course ou le combat (`BamScene.restore` : `prepareAnimation` si `flag` n'est pas `Stop`, **logic.cpp l.1403**), éteint la lumière si la pièce était dans le noir, relance le dernier morceau (`playSong(lastSong)` ; 0 arrête la musique en cours). Rend faux, sans rien changer, si la sauvegarde ne correspond pas aux données ou si le jeu est fini.
- Une commande en construction (verbe choisi qui attend son objet, premier objet d'un « utiliser … avec ») n'est **pas reprise** (`Command.pending` : ScummVM remet la commande à zéro au chargement) ; la sauvegarde reste permise.

**Interface** (`ui/saves.ts`, M2 : `SaveSlots<T>` de `src/engine/save-slots.ts`) : `createSaveSlots(store)` sur un `HostStorage` **déjà préfixé** (`prefixedStorage(store, SAVE_PREFIX)`, `SAVE_PREFIX = "fotaq:"`), `SLOT_COUNT = 10` emplacements de `fotaq:slot01` à `fotaq:slot10`, valeur `{ savedAt, save }` ; `summarizeSlots(slots)` (description : le lieu et la date), `saveToSlot(engine, slots, slot, now): "saved" | "busy" | "failed"`, `loadFromSlot(engine, slots, slot): "loaded" | "empty" | "failed"`, `resultMessage(result, "save" | "load")` (textes de `copy.ts`). **Lieu** : les noms de pièces de `QUEEN2.JAS` sont des noms de fichiers de décors (`C1`, `N9`, `T18`), pas des noms de lieux ; la description donne donc la **zone du jeu** (le groupe de pièces de `specials/ownership.ts`, `copy.zoneNames`), « Pièce N » pour une pièce sans groupe.

**Écarts avec ScummVM** : contenu plus complet (musique, course et combat avec leur ligne de table, pièce dans le noir) ; la course reprend **sur la ligne sauvegardée** (ScummVM repart de la première ligne : le mouvement 31 attend une ligne précise) ; la sauvegarde ne se fait qu'entre deux séquences. **Ce que la reprise ne remet pas** (comme ScummVM, qui refait la pièce d'après les objets) : la phase des animations (elles repartent de leur première image), les images d'une pièce modifiées par une cinématique ou une réplique en cours de visite (bouche et torse d'une personne qui vient de parler, image d'un objet changée par une cinématique, sprite laissé par une cinématique : `FrameTable.overpack`, `unpack`), les images d'un objet éteint en cours de visite (elles repassent à « bob éteint », comme à une sortie de pièce). Visible : au plus 3,5 % de l'écran sur 228 reprises de la partie complète, 8 reprises sur 228 (course de la pièce 74, personnes des pièces 103 et 69, un sprite de cinématique de la pièce 48).

**Vérifié** (`test/fotaq/save/`, 73 tests) : la **partie complète** (`PLAY_ORDER`, 10 passages) se joue d'un trait avec une bascule vers un **moteur neuf** (hôte, scène, répliques, cinématiques neufs, option `restore` depuis l'emplacement relu en JSON) aux trois premiers repos de chaque passage puis un repos sur deux : **228 reprises**, l'état repris est identique à la sauvegarde à chaque fois (objets, objets d'inventaire, zones, points de sortie, descriptions, états, dialogues, inventaire, Joe, pièce), la partie finit comme sans sauvegarde (mêmes pièces d'arrivée, `endGame`) ; la même partie avec une bascule à **chaque repos de la course (pièce 74) et du combat (pièce 69)** : mêmes `flag`, `index`, table du combat une image plus tard, bobs 5 à 7 à la place de la ligne de la table ; chargement dans un moteur **déjà avancé** (sauvegarde de la cachette des Amazones rechargée après le labyrinthe, partie rejouée jusqu'à la fin) ; chargement pendant une cinématique (introduction : voix coupée, entrées remises à zéro) et pendant un dialogue (menu abandonné) ; refus pendant une cinématique, un dialogue, une réplique, une marche (aucune écriture dans l'emplacement) ; tenue, lumière éteinte, dernier morceau ; valeurs illisibles, autre version, tailles ou numéros hors des données = emplacement vide ou chargement refusé ; description et messages.

## 13. Hôte du navigateur (vague J)

`ui/app.ts` monte le jeu dans `mountGameShell` (comme Drascula) ; `ui/browser-host.ts` (`BrowserHost implements FotaqHost`) relie le moteur aux fichiers préchargés, au canvas, à `FotaqAudio` et aux entrées. Vérifié dans le navigateur : accueil, introduction et son saut, marche et clics à la souris, réplique parlée et sous-titrée, dialogue à choix, sauvegarde puis « Continuer » et chargement, pause (Espace), menu (F1 et bouton), aide, états de chargement et d'erreur (manifeste absent), mobile (barre « Menu / Passer / Pause »).

- **Boucle** : à chaque image d'écran, `TickScheduler` (commun, `src/ui/tick-scheduler.ts`) rend les ticks de 100 ms échus, `engine.tick()` pour chacun, puis `engine.render()` (qui appelle `host.present`) et `host.update()` (`FotaqAudio.update` : la musique avance avec l'horloge). Fenêtre, pause, onglet masqué : `host.setPaused(true)` (`suspend` du son, boutons relâchés), plus aucun tick. Le chargement d'une partie se fait fenêtre ouverte, donc **entre deux ticks**.
- **Préchargement** (`ui/preload.ts`, magasin commun `src/ui/file-store.ts`) : au départ `QUEEN.JAS`, `QUEEN2.JAS`, toutes les banques (`.BBK`, `.ACT`, `.SAM`), les `.DOG`, `.CUT`, `.CRD`, `AQBANK.MUS` et `PANEL.PCX` (13,7 Mo : on ne sait pas à l'avance quelles banques une pièce, une personne ou une cinématique lira) ; **par pièce** le décor `.PCX` et, s'il y en a, `.MSK` et `.LUM`. Le moteur interroge `FotaqHost.roomFilesReady(fichiers)` au début de `displayRoom` : tant que l'hôte répond non (il lance alors le chargement), il attend un tick à la fois **sans rien effacer** (la pièce quittée reste à l'écran, pastille « Chargement du décor… »). Pour que l'attente ne se voie presque jamais, `app.ts` charge en fond, à chaque changement de pièce, les décors des pièces où mènent ses sorties (`neighbourRooms` : `objects[entryObject].room`). Les voix : à la demande (`createSoundFiles`, `voices/<NOM>.mp3`), celles de la scène préchargées par `preloadSpeech`.
- **Entrées** (`ui/input.ts`, `PointerQueue` commune) : tap tactile retardé d'un tick (le moteur retrouve l'objet sous le curseur à chaque image) ; au doigt, un toucher pendant une **réplique parlée** (`engine.speechPending`) est `skipText` (le doigt n'a pas d'Entrée) ; appui long = clic droit. Barre tactile : Menu, Passer (`skipCutaway`), Pause.
- **Menu** : `host.openJournal()` (touche F1 ou F5, verbe du journal) ouvre le menu du jeu (sauvegarder, charger, volume, pause, aide, écran titre) ; pas d'entrée « sous-titres » (ils sont toujours affichés).
- **Son** : `host.lastSong()` donne `FotaqAudio.lastSong` à la sauvegarde ; au chargement le moteur rappelle `host.playSong(save.lastSong)` (0 arrête la musique) ; `playSpeech` rend `speechOn && speechFound`. La préférence « Son » (`createSoundPrefs`) coupe tout sans toucher au temps du jeu.
- **Page de dev** `ui/dev.html` (`/src/games/fotaq/ui/dev.html`) : `window.__fotaq = { engine, host, rooms, slots, step(n) }` ; `step(n)` avance de n ticks à la main (un onglet ralenti ne reçoit pas toutes les images ; le chargement d'un décor est asynchrone : laisser passer un `setTimeout` entre deux séries de `step`).
- **Pièces et libellés** : `copy.zoneNames` pour les pièces des six zones (sauf l'hôtel, la course et l'avion d'Anderson, pièces 70 à 75 : « Le début de l'aventure », table `START_ROOMS` de `ui/saves.ts`, `OWNERSHIP` inchangé), `copy.roomNames` pour celles qui n'en ont pas (écrans d'objets et de cinématiques 77 à 96, jamais « Pièce N »).
