# Lure of the Temptress : le moteur de ScummVM et le découpage du portage

Étude de la vague 0. Référence : `engines/lure/` de ScummVM (GPL v3 ou ultérieure), lu pour comprendre puis réécrit (voir `plan.md`, « Convention vis-à-vis de ScummVM »). Statut : **lu** sauf mention contraire ; rien n'est encore vérifié à l'exécution.

## 1. Taille et répartition du code de ScummVM

16 934 lignes de `.cpp` hors détection, méta-moteur et débogueur (FOTAQ : `queen` 17 988, portées en 16 600 lignes de TypeScript ; Drascula : 9 837 pour 13 200).

| Fichier | Lignes | Rôle | Va dans |
| --- | --- | --- | --- |
| `disk.cpp`, `memory.cpp` | 330 | conteneurs `heywow`, langue de `lure.dat`, écrans de remplacement | `data/` |
| `decode.cpp` | 521 | décompression des écrans et des animations (partie EGA ignorée) | `data/` |
| `palette.cpp`, `screen.cpp` | 417 | palettes 6 bits, fondus | `render/` |
| `strings.cpp` | 258 | décodage des textes (code préfixe), remappage selon la pièce | `data/` |
| `res_struct.cpp`, `res.cpp` | 2 320 | structures de `lure.dat`, état mutable (hotspots, pièces, portes, emplois du temps, champs) | `data/` + `engine/state` |
| `room.cpp` | 809 | pièce courante, calques, cellules, sorties, curseur selon la zone, ligne d'état | `engine/room` + `render/` |
| `hotspots.cpp` | 4 854 | **le cœur** : classe `Hotspot` (actions des verbes, marche, parole), pile d'actions des personnages, `PathFinder`, **35 gestionnaires de tick** (`HotspotTickHandlers`), changement de pièce des PNJ | `engine/` + `engine/handlers/` |
| `scripts.cpp` | 1 361 | interpréteur de séquences (`Script::execute`, ~300 lignes, bytecode à pile) + **68 méthodes natives** ; scripts d'animation des hotspots (`HotspotScript`, opcodes `S2_*`) | `engine/script` + `engine/methods/` |
| `game.cpp` | 1 128 | boucle (image toutes les 80 ms, tick de boutique toutes les 1 000 ms), clics, construction de commande, commande « Dis à » (8 ordres au plus), menu, redémarrage, fin | `engine/game` |
| `menu.cpp` | 660 | barre de menus en haut (8 lignes), menus surgissants (verbes, inventaire, objets) | `engine/menu` + `render/` |
| `surface.cpp` | 1 510 | surfaces, boîtes de texte, bulles de dialogue, dialogue de sauvegarde d'origine, protection de copie | `render/` (sauvegarde et protection non portées) |
| `fights.cpp` | 617 | combats (cochon, Skorls), mouvements, adversaire | `engine/fights` |
| `animseq.cpp`, `intro.cpp` | 554 | séquences plein écran (introduction, fin, tonneau, chute, capture) | `engine/sequences` |
| `sound.cpp` | 1 063 | sections, descriptions, sources, décompression, pilote AdLib propre | `audio/` |
| `events.cpp`, `lure.cpp` | 536 | entrées, démarrage, sauvegarde ScummVM | `ui/`, `engine/save` |
| `adlib_ms.cpp` (commun ScummVM) | ~2 500 | pilote AdLib multi-sources générique dont dérive celui de Lure | `audio/` (sous-ensemble) |

## 2. Modèle du jeu

- **Données plutôt que code** : pièces, hotspots, actions, scripts, dialogues, emplois du temps, cheminement, combats sont dans `lure.dat`. Le code propre au jeu se limite aux 68 méthodes natives, aux 35 gestionnaires de tick, aux combats et aux séquences plein écran.
- **Hotspot** : tout ce qui est à l'écran ou agit (joueur Diermot `0x3E8`, Ratpouch `0x3E9`, Skorls, forgeron, Goewin, Mallin, moines…, objets `0x2710+`, zones non visuelles `0x7530+`). Un hotspot actif a un **gestionnaire de tick** (numéro dans ses données), une animation, une position, une pièce. **Tous les hotspots actifs vivent en même temps, y compris hors de la pièce affichée** : les PNJ suivent leurs emplois du temps, marchent, changent de pièce, attendent devant une porte fermée.
- **Champs** (`ValueTableData`) : variables globales du jeu (drapeaux, `AREA_FLAG`, compteurs) lues et écrites par les scripts.
- **Actions** : chaque hotspot a une liste « verbe → séquence » ; un clic droit propose les verbes possibles (menu surgissant), un clic gauche fait l'action par défaut ou la marche. Une vingtaine de verbes (Prends, Pousse, Tire, Actionne, Ouvre, Ferme, Verrouille, Déverrouille, Utilise, Donne, Parle à, Dis à, Regarde, Observe, Regarde par, Demande, Bois, Statut, Va à, Reviens, Corromps, Examine…).
- **Pile d'actions** (`CurrentActionStack`) : un personnage empile des actions (aller à, dispatcher une action, exécuter une séquence) traitées tick après tick ; c'est elle que remplit la commande « Dis à Ratpouch de … ».

## 3. Les quatre systèmes de script

1. **Séquences** (`Script::execute`, segment `0x3F0C`) : machine à pile (constantes, champs, comparaisons, sauts, appels de méthodes natives, appel d'une autre séquence) ; le script de démarrage est `0x23FC`. Les **68 méthodes natives** (`scriptMethods[]`) mêlent génériques (activer/désactiver un hotspot, sons, portes, messages, dialogues, inventaire, groats) et cas particuliers (`ratpouchPushBricks`, `cutSack`, `startOilBurner`, `transformPlayer`, `barmanServe`, `checkWakeBrenda`, `makeGoewinFollow`, `endgameSequence`, `setupPigFight`, `setupSkorlFight`…).
2. **Séquences différées** (`SequenceDelayList`) : une séquence lancée après N ticks, sauvegardée avec la partie.
3. **Scripts d'animation des hotspots** (`HotspotScript`, segment `0x3F0D`) : images, position, taille, sons, sauts, actions (`S2_OPCODE_FRAME_CTR` … `S2_OPCODE_ACTIONS`).
4. **Emplois du temps des PNJ** (`CharacterScheduleSet`, `0x3F06`) et **actions aléatoires** par pièce (`RandomActionSet`) : ce que fait un personnage quand il n'a rien à faire.

## 4. Mouvement

Porté en G2 (`pathfinder.ts`, `movement.ts`, `paused-list.ts`, `exits.ts`, `handlers/player.ts`, `handlers/character.ts`) ; statut
**vérifié** pour la recherche de chemin (identique à ScummVM sur 373 trajets, voir § 10), **lu et testé** pour le reste.

- **`PathFinder`** : la grille de la pièce (`0x3F13`, 40 x 24 blocs, 1 bit par bloc, copiée par pièce car `setOccupied` la modifie) est
  décompressée en 42 x 26 cases de 16 bits avec une bordure libre, chaque bloc occupé élargi vers la gauche de la largeur du personnage ;
  une vague numérote les cases passe après passe depuis le départ ; le chemin est relu à rebours depuis l'arrivée (ordre standard des
  directions, puis alterné, puis le standard si l'alterné n'est pas plus court) en tronçons « direction, pas bruts » (8 par case ;
  `numSteps` : 2 images par case en largeur, 4 en hauteur). Arrivée occupée (`PF_DEST_OCCUPIED`) ou inaccessible (`PF_PART_PATH`) : la
  case atteinte la plus proche sur les quatre lignes droites (`scanLine`), sinon `PF_NO_WALK`. Départ ou arrivée hors de l'écran : pas
  ajoutés en tête ou en fin (`_xPos`, `_xDestPos`) ; une arrivée à moins de 10 pixels d'un bord est repoussée de 50 pixels.
- **Découpage dans le temps** : `process()` sait s'arrêter quand son budget (`PATHFIND_COUNTDOWN` ; 3 par case remplie, 1 par case déjà
  remplie, 700 pour la décompression) est épuisé et reprendre au tick suivant ; **ScummVM le désactive (`PATHFIND_COUNTDOWN 0`)**,
  l'exécutable d'origine utilisait 4 000 (valeur en commentaire dans `luredefs.h`). Le portage garde le mécanisme, budget 0 par défaut
  (même cadence que ScummVM), 4 000 en option (`new LureMovement(ctx, ORIGINAL_PATHFIND_COUNTDOWN)`). Avec 4 000, 70 des 373 trajets de
  test demandent plusieurs appels. La reprise de ScummVM a deux défauts (code mort chez lui) : le résultat provisoire est perdu (la
  recherche finie est rendue « inachevée » puis recommencée sur une grille déjà remplie ; l'extrait compilé avec 4 000 donne 8 chemins
  sur 373 différents d'une recherche d'un trait) et `_cellPopulated` est remis à faux au milieu d'une passe : **corrigés** ici, la reprise
  rend exactement le chemin d'une recherche d'un trait.
- **Marche** (`walkingStep`) : un pas par image, image suivante et déplacement pris dans la liste de marche de l'animation pour la
  direction (`MovementDataList::getFrame` : l'entrée qui suit l'image courante, la première sinon) ; le personnage libère sa case avant le
  pas et la reprend après (`setOccupied`), une sortie franchie est prise (`checkRoomChange`).
- **Joueur** (`playerAnimHandler`) et **PNJ** (`standardCharacterAnimHandler`) ne réagissent pas pareil à un chemin introuvable : le
  joueur s'écarte au hasard puis reprend sa destination (`tempDest`), puis attend (`CHARMODE_PLAYER_WAIT`) ; un PNJ empile l'emploi du
  temps « retour » (`RETURN_SUPPORT_ID` `0x400`) au-dessus d'une action factice (`blockedFlag`), puis renonce (`BS_FINAL`). Dans les
  données, `0x400` est une **marche au hasard dans la pièce** (`NPC_SET_RAND_DEST`, puis `0x401` `NPC_RESET_PAUSED_LIST`) ; c'est aussi
  l'emploi du temps d'index 0, que prend un PNJ dont le point d'arrivée dans la pièce voisine est occupé (`characterChangeRoom`). Une porte
  visée qui se referme arrête la marche.
- **Personnages qui se heurtent** (`PausedCharacterList`) : celui qui marche note « j'attends untel » pour 15 images, part au hasard pour
  s'écarter, l'autre s'arrête (`pauseCtr`) et peut exécuter son script de heurt (`scriptHotspotId`, `tickScriptOffset`) ; la boucle
  décompte la liste à chaque image (avant `checkCursor`) ; heurter le joueur qui ne couvre pas sa case fait attendre sans rien noter. Un
  personnage posé sur un autre en changeant de pièce (`skipFlag`) attend, ou fait s'écarter le joueur oisif (curseur `CS_BUMPED`).
- **Portes et sorties** (`npcRoomChange`) : un PNJ dont l'action est dans une autre pièce marche vers la sortie de `0x3F14` qui y mène
  (prochaine pièce du trajet), ouvre d'abord la porte fermée (`OPEN` empilé), abandonne une destination qui renvoie aussitôt (cycle
  de routage), renonce après 5 essais (retour vers le joueur pour un personnage à qui on a donné un ordre, ou gestionnaire de blocage de
  l'emploi du temps) ; à l'arrivée, une place occupée le fait attendre (emploi du temps d'index 0). Les PNJ hors de l'écran marchent
  comme les autres : tous les hotspots actifs tournent.
- **Suiveurs** (`followerAnimHandler`, Ratpouch, Goewin) : sans action, rejoindre la pièce du joueur (ou sa pièce de repli,
  `roomTranslations` ; champ 37 non nul : seuls ceux du gestionnaire 8) ; oisifs, une action aléatoire de la pièce (`0x3F06`,
  `RandomActionSet` : « une seule fois » seulement devant le joueur) après une attente tirée au hasard (0 à 32 images, compteur propre à
  chaque hotspot).
- Hasard : `ctx.rng` (`ScummvmRandom`, D8) pour `setRandomDest` et les actions aléatoires.
- **Détour et réponse d'un dialogue (constat de la vague K)** : un personnage bloqué empile l'emploi du temps « retour » au-dessus d'une
  action factice et met `blockedFlag` à vrai ; `Script::setSupportData` (réponse d'un dialogue) remplace l'entrée en tête sans remettre
  ce drapeau à faux. Si l'on parle à un personnage pendant son détour, le blocage suivant écrase la réponse (Minnow au château). Code
  identique à ScummVM : comportement d'origine ; le joueur de test attend la fin du détour (`runner.ts`, `waitDetour`).
- **Suiveurs** : le compteur d'attente avant une action aléatoire est bien propre à chaque hotspot (ScummVM : un `HotspotTickHandlers`
  membre de chaque `Hotspot`). Le dépassement de la pile (plus de 20 actions, `validateStack`) de Ratpouch oisif en 19 au retour de la vue
  à distance de la boutique d'Ewan est **le comportement d'origine** (ScummVM s'arrête sur la même erreur au banc, scénario
  `l-trace-remote`) ; le portage l'évite par un écart (décompte des attentes pendant l'avance rapide, § 10 et `group-3.md`).

## 5. Interface d'origine

- Écran 320 × 200 ; **barre de menus de 8 lignes en haut** qui apparaît quand le pointeur y entre : Crédits, Recommencer, Sauvegarder, Restituer, Quitter, Texte rapide / lent, Avec / Sans son (textes de `0x3F17`).
- **Ligne d'état** en haut : la commande en construction (« Ouvre la porte »).
- **Menus surgissants** au clic droit : verbes possibles, inventaire, objets de la pièce (`PopupMenu`). En souris, la sélection suit les déplacements verticaux du pointeur, qui est **ramené au centre** (impossible dans un navigateur) ; ScummVM a un mode tactile (`kFeatureTouchscreen`) où le menu entier s'affiche et se clique : c'est ce mode qu'on porte.
- **Dialogues** : bulles au-dessus de celui qui parle (`TalkDialog`, cadre `0x3F04`), vitesse du texte, choix du joueur proposés en haut de l'écran (jusqu'à 3 lignes), réponses, « Demande », « Donne », « Corromps ».
- **Combats** : la hauteur du pointeur choisit le coup (curseurs 23 à 25), clavier en option (touches de ScummVM `kActionFight*`).
- Dialogue de sauvegarde d'origine (10 emplacements), protection de copie (`CopyProtectionDialog`, symboles `0x4139`) : **non portés** (dialogues communs du site ; protection désactivée par défaut dans ScummVM).

## 6. Boucle et cadence

- `Game::execute` : une image de logique toutes les **80 ms** (`GAME_FRAME_DELAY`, 12,5 images/s) : `nextFrame` (tick de chaque hotspot actif, pièce, ligne d'état), `delayList().tick()`, musique ; toutes les **1 000 ms** `tickCheck` (horloge de la boutique du village).
- Attentes bloquantes de ScummVM (menus, dialogues, animations plein écran, combats, `Hotspot` qui attend un dialogue) : réécrites en **séquences** (`src/engine/sequence.ts`, comme Drascula et FOTAQ).
- Redémarrage (`GS_RESTART`) : remise à zéro complète de `Resources`, des combats et de la pièce, puis script `0x23FC`.

## 7. Découpage du portage en dossiers et en groupes parallèles

```
src/games/lure/
  data/        container.ts (heywow, DISKn et bloc de lure.dat : LureResources), picture.ts, anim.ts, palette.ts, font.ts, strings.ts, charset.ts,
               lure-dat.ts (26 ressources : rooms, hotspots, anims, scripts, actions, talk, schedules, paths, exits, fight, sounds, ui-strings),
               dialog-frame.ts, ids.ts, cursor.ts (lecture suivie, couverture), catalog.ts (type des 337 ressources), lure-data.ts (loadLureData),
               sound-section.ts (section, décompression 'C'/'c', SMF : tâche son)
  engine/      (G1, fait) host.ts, cadence.ts (80 ms, 1 000 ms), ids.ts (champs, états, curseurs, hotspots nommés), context.ts (LureContext :
               ce que ScummVM atteint par ses singletons), state.ts (table des valeurs, hotspots, pièces et grilles, portes, piles d'actions,
               emplois du temps par identifiant, séquences différées), world.ts (Resources : hotspots actifs, activation, recherches),
               hotspot.ts (Hotspot : position, animation, pile, orientation, case occupée, paroles, messages, actionPrecheck),
               verbs.ts (doAction, les do* et npc*), support.ts (Support : chevauchements, changement de pièce), room.ts (Room sans dessin),
               script.ts (machine à pile + désassembleur), hotspot-script.ts (S2 + désassembleur), delay-list.ts, menu.ts (barre et
               surgissants cliquables, sans dessin), services.ts (Journal, LureSound, Movement, Bar, Fights et leurs versions minimales),
               game.ts (LureEngine : boucle, clics, ligne d'état, « Dis à », barre de menus, changement de pièce, redémarrage)
               (G2, fait) pathfinder.ts (PathFinder), movement.ts (LureMovement : marche du joueur et des PNJ), paused-list.ts
               (PausedCharacterList), exits.ts (sorties, npcRoomChange, roomTranslations) ; les emplois du temps restent dans state.ts
               (ScheduleBook) et verbs.ts (npc*), les actions aléatoires dans handlers/character.ts : pas de schedules.ts
               (vagues suivantes) talk.ts, tell.ts, save.ts
    methods/   catalog.ts (67 numéros, groupe de chacun), index.ts (table numéro → fonction, refus des doublons, souches qui journalisent),
               group-1/ (L1, fait en G1), group-2/ … (vague L)
    handlers/  catalog.ts (39 numéros → 32 fonctions, groupe de chacune), index.ts (table, souches), player.ts (joueur, G1 et G2),
               character.ts (standardCharacterAnimHandler, followerAnimHandler, G2),
               group-1/ (L1, fait en G1), group-2/ … (vague L)
    fights/    combats (cochon, Skorls de la cellule et du château)
    sequences/ introduction, fin, tonneau, chute, capture, générique
  render/      écrans, calques et cellules, sprites, palette et fondus, police, ligne d'état, barre de menus, menus surgissants, bulles, boîtes, curseurs
  audio/       adlib-multisource.ts (sous-ensemble générique d'adlib_ms.cpp), lure-adlib.ts (instrument BNK, fréquence, volume), player.ts (sources SMF, boucle),
               sound.ts (SoundManager : sections, descriptions, sources, SF_RESTORE), web-music.ts (WebOpl à 250 Hz)
  ui/          app.ts (mountPointClickApp), browser-host.ts, preload.ts, input.ts, keys.ts, touch.ts, title.ts, help.ts, saves.ts, dev.html
  index.ts, copy.ts
test/lure/     data/, engine/, methods/group-N/, handlers/group-N/, fights/, render/, audio/, save/, ui/, walkthrough.ts, solutions.ts, full-game.test.ts
```

Le moteur est pur (aucun DOM) : tout passe par `LureHost` (étend `BaseHost`) ; `TestHost` et la téléportation de test (`TeleportMovement`,
facultative depuis G2 : `makeEngine` utilise la vraie marche) sont dans `test/lure/engine/test-host.ts`.

## 8. Groupes pour les agents parallèles (vague L)

Convention de Drascula (`docs/drascula/rooms.md`) : un dossier par groupe, `index.ts` (table du groupe : `MethodGroupTable` numéro →
fonction, `HandlerGroupTable` nom de ScummVM → fonction) + `ids.ts` (numéros nommés : hotspots, champs, séquences, pièces) + un fichier par
méthode ou gestionnaire, tests dans `test/lure/<méthodes|handlers>/group-N/`, notes dans `docs/lure/group-N.md`. `methods/index.ts`,
`handlers/index.ts`, les catalogues et les assembleurs ne se modifient pas (le coordinateur ajoute la table du groupe à `METHOD_GROUPS` /
`HANDLER_GROUPS`) ; un besoin dans un fichier partagé (`engine/*.ts`, `render/`) s'arrête et se signale. Seul le coordinateur met à jour
`plan.md`.

**Liste définitive (G1).** Toutes les méthodes viennent de `scripts.cpp` (`Script::*`), tous les gestionnaires de `hotspots.cpp`
(`HotspotTickHandlers::*`). Le décompte du plan (« 68 méthodes, 35 gestionnaires ») était approché : **67 numéros de méthode (0 à 66) pour
66 fonctions** (20 et 65 sont `checkCellDoor`) et **39 numéros de gestionnaire (1 à 39) pour 32 fonctions** (7 et 8, 9 et 10, 28 à 33
partagent une fonction) ; `npcRoomChange` n'est pas un gestionnaire (il est appelé par `standardCharacterAnimHandler`, G2). La colonne
« où » vient du désassemblage de toutes les séquences atteignables (`test/lure/engine/sequences.ts`) et de `0x3F07` : pièce `pN`, hotspot
et verbe, dialogue du personnage, emploi du temps `edt`.

| Groupe | Méthodes (numéro `nom`) | Gestionnaires (numéros `nom`) | Où |
| --- | --- | --- | --- |
| **L1** génériques, **fait en G1** (45 numéros, 8 gestionnaires) | 0 `activateHotspot`, 1 `setHotspotScript`, 2 `addSound2`, 3 `setHotspotFlagMask`, 4 `clearSequenceDelayList`, 5 `deactivateHotspotSet`, 6 `deactivateHotspot`, 7 `resetPathfinder`, 8 `addDelayedSequence`, 9 `killSound`, 10 `characterInRoom`, 11 `setDesc`, 12 `setHotspotName`, 13 `addSound`, 16 `displayDialog`, 18 `remoteRoomViewSetup`, 19 `startSpeakingToNoone`, 21 `stopSound`, 22 `getDoorBlocked`, 25 `characterChangeRoom`, 27 `setBlockingHotspotScript`, 28 `decrInventoryItems`, 29 `setTalking`, 30 `setActionCtr`, 31 `startSpeaking`, 32 `disableHotspot`, 34 `increaseNumGroats`, 35 `enableHotspot`, 36 `displayMessage2`, 40 `checkRoomNumber`, 42 `doorClose`, 44 `doorOpen`, 45 `npcWait`, 47 `displayMessage`, 48 `setNewSupportData`, 49 `setSupportData`, 50 `givePlayerItem`, 51 `decreaseNumGroats`, 53 `moveCharacterToPlayer`, 57 `getNumGroats`, 61 `killPlayer`, 62 `animationLoad`, 63 `addActions`, 64 `randomToGeneral`, 66 `checkSound` | 1 `defaultHandler`, 4 `voiceBubbleAnimHandler`, 5 `puzzledAnimHandler`, 6 `roomExitAnimHandler`, 11 `standardAnimHandler2`, 12 `standardAnimHandler`, 16 `fireAnimHandler`, 17 `sparkleAnimHandler` | partout. Ajoutées à L1 par rapport à l'étude, parce que plusieurs zones s'en servent : 18 (la fissure de la cellule, pièces 3 et 19), 27 (pièces 4, 28, 48), 61 (dialogue de Goewin) ; 45, 46 et 48 ne sont appelées par aucune séquence atteignable |
| **G1** joueur (fait, marche en G2) | | 3 `playerAnimHandler` : bulle, comptes à rebours, actions `NO_ACTION`, `DISPATCH_ACTION`, `EXEC_HOTSPOT_SCRIPT` ; la marche est confiée à `Movement` | `handlers/player.ts` |
| **G2** mouvement (fait, pas la vague L) | | 2 `standardCharacterAnimHandler` (et `npcRoomChange`), 7-8 `followerAnimHandler` (`handlers/character.ts`) | Forgeron 3EB/p23, Gwen 3EC et Mallin 3ED/p10, moines 3EE/3F0/p36, Wayne 3F1/p19, 3F2/p44 ; Ratpouch 3E9/p5 (suiveur). Le plan met le suiveur en G2, l'étude en L2 : **G2** retenu (il ne fait que choisir des actions aléatoires puis appeler `standardCharacterAnimHandler`) |
| **L2** la cellule et Ratpouch (5 numéros, 5 gestionnaires) | 20 et 65 `checkCellDoor`, 23 `isSkorlInCell`, 24 `ratpouchPushBricks`, 26 `pauseRatpouch` | 9-10 `jailorAnimHandler`, 13 `sonicRatAnimHandler`, 14 `droppingTorchAnimHandler`, 15 `playerSewerExitAnimHandler`, 20 `prisonerAnimHandler` | porte de la cellule 2712/p2 (Ouvre, Regarde), briques 2714/p2, sortie de p2, p2 ; Skorl 3EA (p3) et Skorl du château 3F3 (le même gestionnaire), rat 41D/p4, torche qui tombe 40E (p1), égout 416/p7, prisonnier 412/p2 |
| **L3** le village (5 numéros, 5 gestionnaires) | 33 `cutSack`, 39 `townHallClose`, 46 `checkWakeBrenda`, 54 `setVillageSkorlTickProc`, 56 `barmanServe` ; et le service `Bar` (`getBarPlace`, `BarmanLists`) | 18 `teaAnimHandler`, 23 `grubAnimHandler`, 24 `barmanAnimHandler`, 25 `skorlAnimHandler`, 27 `goewinShopAnimHandler` ; et l'horloge de la boutique (`tickCheck`, déjà dans `game.ts`) | sac 40D/p3, sortie de p14, emploi du temps 12, barmen 420/p29, 429/p32, 436/p35 ; thé 423/p30, Grub 422/p12, Skorls 426/428 (p31) et 427 (p14) |
| **L4** Goewin, les moines, les grottes, le château (9 numéros, 8 gestionnaires) | 37 `startOilBurner`, 38 `transformPlayer`, 41 `makeGoewinFollow`, 43 `fixGoewin`, 52 `makeGoewinWork`, 55 `freeGoewin`, 58 `checkHasBook`, 59 `enableGargoylesTalk`, 60 `normalGoewin` | 19 `goewinCaptiveAnimHandler`, 21 `catrionaAnimHandler`, 22 `morkusAnimHandler`, 26 `gargoyleAnimHandler`, 28-33 `skullAnimHandler`, 34 `dragonFireAnimHandler`, 35 `castleSkorlAnimHandler`, 36 `rackSerfAnimHandler` | brûleur 424/p30, transformation (séquence 0xCB7, hotspot 271D), p38, p15, emploi du temps 8, dialogues de Goewin 3EF, Catriona 428, gargouilles 42B ; crânes 42E-433 (p38-40 : **déplacés de L2 en L4**, ce sont les grottes), dragon 435/p41, Skorls du château 437/p45 et 438, serf du chevalet 411/p4 |
| **F** combats (2 numéros, 2 gestionnaires) | 15 `setupPigFight`, 17 `setupSkorlFight` ; le service `Fights` (`fightLoop`, `isFighting`, `reset`) | 38 `fighterAnimHandler`, 39 `playerFightAnimHandler` | p6 (cochon 43F), p49 (Skorl 444) ; `killPlayer` (61) est passé en L1 |
| **Q** séquences (1 numéro) | 14 `endgameSequence` ; la chute, le tonneau et la capture (`Game::displayChuteAnimation`, `displayBarrelAnimation`, `GS_CAUGHT`) sont des souches de `game.ts` (`fullScreenStub`) dont les effets sur l'état sont déjà portés | | sortie de p49 |
| **T** dialogues (pas la vague L) | | 37 `talkAnimHandler` (et `talkEndConversation`) ; le texte progressif des bulles (`TalkDialog`) | dialogues de tous les personnages |

Les gestionnaires « joueur » (marche de `playerAnimHandler`), `standardCharacterAnimHandler`, `followerAnimHandler`, `npcRoomChange`
(G2) et `talkAnimHandler` (T) ne sont pas dans la vague L : ils font partie du cœur.

## 9. Points d'architecture tranchés en G1

- **Pointeurs internes de ScummVM** : remplacés par des numéros. Un hotspot, une pièce, une porte sont des enregistrements de `state.ts`
  retrouvés par leur numéro (`World.hotspot`, `getRoom`, `getExitJoin`) ; une donnée d'action de pile (`CharacterScheduleEntry *`) est
  `{ kind: "schedule", id }` (identifiant `ensemble << 10 | rang` de `CharacterScheduleSet::getId`) ou `{ kind: "dynamic", action, params }`
  (clic du joueur, ordre « Dis à », modifiable comme `setDetails2`) ; `next()` et `parent()` se calculent sur l'identifiant
  (`ScheduleBook`). Les listes chaînées sont des tableaux qui gardent l'ordre de ScummVM. L'état est donc sérialisable tel quel (vague S).
  Seuls les objets d'exécution `Hotspot` (liste des hotspots actifs) tiennent une référence vers leur enregistrement, comme `_data`.
- **Singletons** : un contexte `LureContext` (`context.ts`), implémenté par `LureEngine`, remplace `Resources::getReference()`,
  `Room::getReference()`, `Game::getReference()`, `Sound` et `LureEngine::rnd()`. Chaque module le reçoit.
- **Ordre des ticks** : celui de ScummVM, reproduit. Une image (`nextFrame`) : combat, curseur (`checkCursor`), puis chaque hotspot actif
  dans l'ordre de la liste **relevé au début de l'image** (`Game::tick` : liste des numéros, puis `getActiveHotspot` de chacun, un hotspot
  retiré entre-temps est sauté, `CHARACTER_HOTSPOT_ID` renseigné avant chaque tick) ; puis la liste des séquences différées (au plus une
  séquence échue par image) et la musique. Un tick du moteur = un tour de boucle de ScummVM entre deux images : entrées (actions du
  clavier, clics), changements de pièce demandés (`NEW_ROOM_NUMBER`, `playerNewPos`), image, séquences différées, horloge de la boutique
  (1 000 ms comptées en ticks de 80 ms). La liste des personnages en attente (`pausedList().countdown()`) est décomptée à sa place, avant
  `checkCursor` (G2).
- **Hasard** : un seul `ScummvmRandom` (`ctx.rng`, graine injectable, 1 par défaut), comme `LureEngine::_rnd` que partagent `Resources`,
  les scripts (`RANDOM`, `randomToGeneral`), `setRandomDest` et les combats ; même suite que le banc pour une même graine (D8).
- **Méthode native qui attend** : l'exécution des séquences reste **synchrone** (ScummVM l'appelle de partout, imbriquée, et attend la
  valeur rendue). Ce qui bloquait ScummVM au milieu d'une méthode, d'un verbe ou d'un gestionnaire (`Dialog::show`, boîte de statut,
  séquences plein écran) est une **séquence** (`src/engine/sequence.ts`) demandée par `ctx.block` et **jouée après** l'exécution en cours,
  dans l'ordre des demandes ; tant qu'elle tourne, le monde est figé (aucune image), comme dans ScummVM. Écart : ce qui suit un
  `Dialog::show` dans la même exécution est appliqué avant que le joueur ferme la boîte (invisible : le monde est figé ; seul le décor
  derrière la boîte peut montrer un hotspot activé juste après). Les menus surgissants, la barre de menus, la confirmation (o/n) et le
  générique sont aussi des séquences, lancées par la boucle (clic) au lieu de boucles bloquantes.
- **Mouvement (accroche)** : le service `Movement` (`services.ts`) reçoit les actions `START_WALKING`, `PROCESSING_PATH` et `WALKING` de
  la pile ; depuis G2 il a deux entrées (`walkPlayer(h, impinging)`, `walkCharacter(h, impinging, bumpedPlayer)`, les cas de marche des
  deux gestionnaires), `clearPath(h)` et le budget de la recherche (`pathfindCountdown`). Implémentation : `LureMovement` ; la
  téléportation de test (`TeleportMovement`) reste disponible.

### Écarts de G1 avec ScummVM (en plus de ceux du § 9)

- Pas de dessin : `Room::update`, calques, fondus, `TalkDialog` (texte progressif, vague T : `building` reste faux, la hauteur de la bulle
  est donnée par T) ; le moteur retient ce que le rendu doit montrer (`room.layers`, `room.cursor`, `room.statusLine`, `room.hotspotName`,
  `room.talkDialog`, `menuView`, `dialogText`, `confirmText`, `showingCredits`).
- Barre de menus en mode cliquable : l'appui qui déroule un menu ne le referme jamais (ScummVM teste le bouton encore enfoncé après chaque
  lot d'événements, ce qui referme parfois aussitôt un menu ouvert d'un toucher) ; le mode « souris » (pointeur ramené au centre) n'est pas
  porté (D4).
- Redémarrage : coupe aussi les sons (`killSounds`) ; la fin de partie (`GS_RESTORE`) passe par `LureHost.restartOrRestore` (défaut :
  recommencer) et les sauvegardes par `openSaveDialog` (D5) ; les touches de débogage (pavé numérique) ne sont pas portées.
- Une pile de valeurs vide dépilée rend 0 et une division par zéro lève (indéfini dans ScummVM ; aucune séquence atteignable ne le fait).

### Données relevées en G1

- 284 séquences atteignables (entrées des données et du code, sous-séquences, séquences différées) se décodent ; elles couvrent 91 % de
  `0x3F0C`, et le balayage linéaire du segment ne rencontre aucun opcode invalide. Trois cas écartés, expliqués dans
  `test/lure/engine/sequences.ts` : « Prends » de la liste `0x6CAE` (hotspot non visuel `0x753D` sans ce verbe : la séquence `0xB00`
  tombe au milieu d'une instruction), les champs `scriptLoadFlag` des hotspots non visuels (c'est une direction, `nonVisualDirection`),
  et les réponses de dialogue au-delà du rang atteignable (la liste des réponses de ScummVM n'a pas de fin fiable : réponse 1 du
  dialogue `0xE66C`).
- `0x3F07` : le hotspot `0x2738` a le gestionnaire 0 (inconnu : erreur s'il était activé, comme dans ScummVM) ; `0x46B` (gestionnaire
  1) a un script `0x6400` hors du segment, jamais exécuté.

## 10. Points tranchés en G2 (mouvement et autonomie)

- **Recherche d'un trait par défaut** : `PATHFIND_COUNTDOWN` vaut 0 dans ScummVM (§ 4) ; le budget est un paramètre de `LureMovement`
  (0 par défaut, 4 000 pour la cadence de l'original). Le banc ScummVM et le portage tirent donc le hasard aux mêmes images.
- **État de la marche sérialisable tel quel** : `PathFinderState` (`pathfinder.ts`) est un objet simple (grille en tableau de nombres,
  pointeurs `_pSrc` / `_pDest` en indices), porté par chaque hotspot actif (`Hotspot.pathFinder`, perdu à la désactivation comme dans
  ScummVM) avec le compteur des suiveurs (`Hotspot.followerCountdown`) ; la liste des personnages en attente est dans `LureState`
  (`pausedList`, numéros seulement). Une recherche interrompue reprend exactement (y compris `inProgress`, que le chargement d'une
  sauvegarde de ScummVM remet à faux). La vague S sérialise ces trois morceaux avec le reste.
- **Service `Movement` = point d'accroche** : interface élargie (deux entrées, `walkPlayer` et `walkCharacter`, et `pathfindCountdown`) ;
  `StubMovement` est retiré ; `LureEngine` utilise `LureMovement` par défaut, comme `makeEngine` des tests.
- **Ordre des ticks** : inchangé ; `countdownPaused` à sa place dans `nextFrame` (après le combat, avant `checkCursor`).
- **Pas de `schedules.ts`** : les emplois du temps étaient déjà portés en G1 (`ScheduleBook` dans `state.ts`, actions `npc*` dans
  `verbs.ts`) ; les actions aléatoires (`RandomActionSet`) n'ont qu'un client, `followerAnimHandler`.
- **`roomTranslations`** passe de `methods/group-1/` à `exits.ts` (deux clients : `moveCharacterToPlayer` et les suiveurs).

### Écarts de G2 avec ScummVM

- Reprise d'une recherche découpée corrigée (§ 4 ; sans effet avec le budget 0 de ScummVM).
- Lecture hors de la grille décompressée (balayage `scanLine` qui déborde au bord, arrivée hors de l'écran près d'un coin) : 0, là où
  ScummVM lit la mémoire voisine.
- Sortie-hotspot visée par un PNJ sans porte (`getExitJoin` nul, plantage de ScummVM) : traitée comme ouverte et journalisée ; image de
  marche introuvable : journalisée (avertissement de ScummVM).
- **Avance rapide d'une pièce** (`Room::setRoomNumber`, tous les rattrapages : retour d'une vue à distance, entrée dans une pièce) :
  chaque tick de rattrapage décompte aussi la liste des attentes (`countdownPaused`, dans l'ordre de `Game::nextFrame` : décompte, puis
  ticks), là où ScummVM n'appelle que `Game::tick`. Sans cela, un personnage heurté reste figé jusqu'à la fin du rattrapage (jusqu'à 300
  ticks) et un suiveur oisif empile les actions aléatoires de la pièce jusqu'à l'arrêt de ScummVM (« NPC character got an excessive
  number of pending actions », prouvé au banc, `group-3.md`) ; la partie complète s'y arrêtait (graine 1, retour de la vue de la boutique
  d'Ewan). Décision de l'utilisatrice : éviter ce plantage. Tests : `room-catchup.test.ts` (le suiveur heurté reprend, n'empile pas ;
  échoue sans l'écart), `test/lure/remote-view.test.ts` (vue de plusieurs minutes jouée par de vrais clics, Ratpouch heurté pendant le
  rattrapage, graine 256). Effet de bord : les villageois rattrapés à l'entrée d'une pièce ne restent plus figés eux non plus ; leurs
  positions après un rattrapage diffèrent donc de ScummVM quand un heurt s'y produit.

### Constats de G2

- **Bogue de G1 corrigé** : les grilles de cheminement de l'état étaient copiées par `slice()`, qui sur un `Buffer` de Node (fichiers lus
  par les tests) partage la mémoire : une partie modifiait les données décodées de la suivante. Copie par `new Uint8Array(...)`.
- **Comparaison à ScummVM** : `PathFinder::process`, `initVars`, `processCell`, `scanLine` et `RoomPathsData::decompress`, extraits tels
  quels dans un programme C++ compilé dans le scratchpad (`pfref.cpp`, hors dépôt), donnent les mêmes résultats et les mêmes tronçons
  que `pathfinder.ts` sur **373 trajets** (de chaque point d'arrivée de chaque pièce vers chacune de ses sorties et le centre de sa zone
  de marche ; les quatre issues `OK`, `DEST_OCCUPIED`, `PART_PATH`, `NO_WALK` représentées) : `test/lure/engine/fixtures/pathfinder-scummvm.json`.
  La marche elle-même (pas, heurts, portes) n'est pas encore comparée au banc (le binaire du banc n'est pas construit).
- **Trajets entre sorties** (joueur, portes ouvertes) : sur 274 trajets, 240 prennent la sortie ; 34 s'arrêtent avant sur un chemin
  partiel (arrivée hors de la zone atteignable depuis ce point d'arrivée, surtout pièces 14, 20, 45 et 46). La recherche étant identique
  à ScummVM, c'est probablement le comportement d'origine ; à confirmer au banc.
- **Village** (forgeron, Gwen, Mallin, deux moines, Wayne, activés à la main, joueur dans la pièce 10) : dix minutes de jeu sans erreur,
  chacun change de pièce et parcourt son emploi du temps ; Mallin et les moines bouclent. **Gwen** veut aller de la pièce 12 à la 32
  (porte `0x271F`) : la sortie (37, 84) est hors de la zone atteignable de la grille de la pièce 12, elle échoue, prend l'emploi du temps
  « retour », recommence, indéfiniment. **Élucidé au banc (vague K)** : non reproduit dans la partie réelle ; le constat venait des PNJ
  activés à la main, sans le script d'entrée de la pièce 7 ni son avance rapide (voir le point suivant et `group-3.md`, blocage c).
- **Avance rapide à l'entrée d'une pièce (bogue corrigé en K)** : `Room::setRoomNumber` calcule `(getMillis() - exitTime) / 1000` sur
  32 bits non signés ; les pièces 6, 7, 41 à 46 et 49 ont une heure de sortie initiale `0xFFFFF`, donc 300 secondes d'avance à la
  première entrée (avant 1 048 575 ms de jeu). `room.ts` le faisait en nombres signés (aucune avance) : les villageois partaient de
  leurs pièces de départ au lieu d'être déjà en route (Ratpouch bloqué entre les pièces 14 et 19 par un moine mal placé). Corrigé et
  vérifié au banc (traces `LURE_TRACE`, `group-3.md`) ; test `test/lure/engine/room-catchup.test.ts`. Le calcul est `catchUpTicks`
  (`room.ts`). `exitTime` est posé par `Game::changeRoom` sur la pièce où le joueur **entre** ; une vue à distance passe par
  `setRoomNumber` seul : son retour rattrape tout le temps écoulé depuis l'entrée du joueur dans sa pièce (jusqu'à 300 ticks). Pendant
  ce rattrapage, seul `Game::tick` tourne (pas `pausedList().countdown()`, appelé par `Game::nextFrame`) : un personnage heurté garde
  `pauseCtr` = 15 jusqu'au bout. Un suiveur oisif ainsi figé empile une action aléatoire de la pièce à chaque fin d'attente
  (`followerAnimHandler`) sans la commencer, jusqu'à l'erreur « NPC character got an excessive number of pending actions » : vérifié au
  banc (scénario `l-trace-remote`, graine 2), même erreur dans ScummVM. **Écart** (liste ci-dessous) : le portage décompte les attentes
  à chaque tick de rattrapage.
- **Pièce 28, sortie vers la 18** : le point de `exitCoordinate` est au-dessus de la zone de sortie ; un joueur arrivé au-dessus
  (après un heurt `CS_BUMPED`) clique sans effet. Identique dans ScummVM (banc) : comportement d'origine.
- **`0x3F2`** (pièce 44, château) parle à `0x437` (`npcTalkNpcToNpc`) : si `0x437` n'est pas actif, ScummVM plante comme le portage
  (`requireActiveHotspot`) ; ne se produit pas si les PNJ du château sont activés dans l'ordre du jeu (à vérifier en L4).
- Quand le joueur entre dans la pièce 6 (le cochon), Ratpouch activé à la main dans la pièce 5 disparaît des hotspots actifs (cause non
  examinée : script d'entrée de la pièce ou de la séquence) ; le test du suiveur utilise donc le village (pièces 10 et 11).

## 11. Sauvegarde (vague S, première partie)

`engine/save.ts` (pur) : `captureSave(engine)` rend un objet JSON versionné (`null` si `canSave` est faux), `restoreSave(engine, save)` reprend la partie (faux, moteur intact, si une référence est inconnue des données), `parseSave(value)` valide (autre version ou champ abîmé : `null`). `ui/saves.ts` : `SaveSlots` (préfixe `lure:`, 10 emplacements), `saveToSlot` (`saved` / `busy` / `failed`), `loadFromSlot` (`loaded` / `empty` / `failed`), `describeSave` (nom de la pièce du jeu, ou « Pièce N », et date), les textes sont dans `copy.ts`.

- **Refus** (`canSave`) : `isMenuAvailable` de ScummVM (séquence ou menu en cours, vue à distance `OLD_ROOM_NUMBER`, dialogue `CS_TALKING` / `talkState`) plus combat en cours (`fights.isFighting`) et bits `RESTART` / `CAUGHT` / `RESTORE` de l'état du jeu. ScummVM ne gate que par `isMenuAvailable` ; le refus pendant un combat est une décision du portage (§ 8 : barre de menus inaccessible).
- **Sauvegardé** : table des valeurs (90 champs, groats, `playerNewPos`, compteurs de texte, masque de « Dis à »), enregistrements de hotspots **modifiés** (écart aux données, avec la pile d'actions), pièces modifiées (drapeaux, heure de sortie, grille), portes et actions aléatoires modifiées, **hotspots actifs dans l'ordre des ticks** (champs d'exécution, `pathFinder` en cours compris, `followerCountdown`, `animBuild` du rendu, bulles dynamiques désignant leur personnage), `pausedList`, séquences différées, personnage qui parle, pièce affichée (sortie visée, `cursorState`, bulle), horloge (`ticks`, `shopMs`), état du jeu, « Texte rapide » et « Son » (comme `Game::saveToStream`), état du hasard (`ScummvmRandom.state`), numéros des sons actifs (`activeSoundNumbers` ; `restoreSounds` relance ceux de description `SF_RESTORE`).
- **Écart avec ScummVM** : celui-ci relit par `Room::setRoomNumber` (entrée de pièce rejouée, rattrapage de ticks, recherches reprises sans leur état de recherche) ; le portage repose chaque champ tel quel et ne rejoue rien (`room.changes` est incrémenté : le rendu recompose). Ni `Game::setState(0)` : l'état du jeu est repris (tic-tac de la boutique).
- **Non sauvegardé** : pointeur et entrées en attente (l'hôte rend la souris au moteur), séquences et fenêtres (abandonnées au chargement : `LureEngine.beginResume`), commande « Dis à » en construction, ligne d'état et hotspot sous le pointeur (recalculés à l'image suivante), journal, dialogue (`talkState`, refus de toute façon).
- **Points d'accroche** pour F et L3 : `Fights.saveState` / `restoreState` et `Bar.saveState` / `restoreState` (facultatifs, JSON) ; `save.fights` et `save.bar` les portent. `LureSound.activeSoundNumbers` / `restoreSounds` facultatifs (`SoundManager` les a).
- **Garde-fou** : un test compare les propriétés d'un `Hotspot` d'exécution aux listes de `save.ts` (`HOTSPOT_NUMBERS`, `HOTSPOT_FLAGS`, `HOTSPOT_DERIVED`) : toute propriété ajoutée à `Hotspot` doit être rangée dans l'une d'elles (cela a déjà attrapé `animBuild`).
- **Taille** : seuls les écarts aux données sont écrits ; les grilles de cheminement de chaque marcheur (~1 100 nombres) pèsent le plus.


## 12. Combats (groupe F, fait)

`engine/fights/` : `manager.ts` (`FightsManager`, les trois `FighterRecord`, `fightHandler`, IA de l'adversaire, `saveState` / `restoreState`), `ids.ts`, `index.ts` (méthodes 15 `setupPigFight` et 17 `setupSkorlFight`, gestionnaires 38 `fighterAnimHandler` et 39 `playerFightAnimHandler`, ajoutés à `METHOD_GROUPS` et `HANDLER_GROUPS`). Source : `fights.cpp` / `fights.h`, touches de `lure.h` et `metaengine.cpp`. Tests : `test/lure/engine/fights.test.ts` (cochon gagné, perdu, Skorl gagné, déterminisme, sauvegarde refusée en combat, aller-retour `saveState`, souris et touches) et `fights-scummvm.test.ts`.

- **Boucle** : `fightLoop()` de ScummVM bloque jusqu'à la fin ; ici c'est **une image** (événements, tick des hotspots, tick des séquences différées), appelée par `nextFrame` tant que `isFighting` (qui reste vrai tout le combat, alors que `isFighting()` de ScummVM, `fwhits == 0`, ne l'est qu'au départ). Pendant le combat `game.ts` ne traite que Échap (confirmation habituelle, au lieu de `quitGame`) ; les autres événements vont à `FightsManager` (`takeEvents`). Dernière image : la suite de `nextFrame` s'exécute dans le même tick, comme à la sortie de la boucle.
- **Entrées** : `LureAction` gagne 8 actions `fight*` et `LureInput` un `actionEnd` (fin d'appui, `EVENT_CUSTOM_ENGINE_ACTION_END`) ; `MenuEvent` un `actionEnd`. Souris : position par rapport au combattant (curseurs 23 à 25 et flèches), bouton gauche = coup +10, droit = +5 ; touche tenue jusqu'à `actionEnd`.
- **Écarts** : les six touches du pavé ont chacune leur action (ScummVM les associe toutes à « haut gauche » par une faute de copie de `metaengine.cpp`) ; les événements d'une image sont tous lus avant le tick ; `colorOffset` ne change que l'enregistrement de données ; combat abandonné si la pièce change (tests seulement) ; `StubFights` supprimé.
- **Comparaison au banc** : ScummVM compilé avec un journal (`bench/scummvm-fights-trace.diff`, variable `LURE_FIGHT_TRACE`) ; trois combats du cochon (immobile et perdu : 313 images ; souris et clavier, perdu : 520 ; gagné : 251) sont rejoués image par image avec les mêmes événements et les mêmes tirages du hasard de l'adversaire : positions, images, coups reçus, séquences et curseur identiques (`fixtures/fights-scummvm.json`, extrait par `bench/port/fights-extract.py`). Le hasard avant le combat dépend du temps réel du banc, d'où les tirages imposés. Le banc d'images (`l-fight-idle`, `port/run-port.sh lure`) montre les mêmes poses, avec un décalage de trajectoire pour la même raison. Le bench gagne `LEFT`, `RIGHT`, `KP1`..`KP9` (touches de combat).
- **À noter** : le texte d'entrée de la pièce 6 apparaît à la treizième image du combat. Au début le curseur n'est pas un curseur de combat : le joueur marche vers la gauche (coup 5) jusqu'au premier mouvement de souris, comme dans ScummVM.
