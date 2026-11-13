# Groupe L2 : la cellule et Ratpouch

Référence : moteur `lure` de ScummVM (`scripts.cpp` : `Script::checkCellDoor`, `isSkorlInCell`, `ratpouchPushBricks`, `pauseRatpouch` ; `hotspots.cpp` : `HotspotTickHandlers::jailorAnimHandler`, `sonicRatAnimHandler`, `droppingTorchAnimHandler`, `playerSewerExitAnimHandler`, `prisonerAnimHandler` ; GPL v3+), lu puis réécrit. Architecture : `engine.md` (§ 8 à 12), dialogues : `talk.md`.

## Portés

| Numéro | Fonction | Fichier | Rôle |
| --- | --- | --- | --- |
| méthodes 20 et 65 | `checkCellDoor` | `engine/methods/group-2/index.ts` | porte de la cellule (`0x2712`) ouverte et `TORCH_HIDE` non nul : musique `0x15` |
| méthode 23 | `isSkorlInCell` | idem | `GENERAL` = 0 si le Skorl (3EA) est dans la pièce 1, 1 sinon |
| méthode 24 | `ratpouchPushBricks` | idem | sortie des briques (`0x2714`) ouverte, Ratpouch : `actions` = 0, pile vidée, `DISPATCH_ACTION` vers la pièce 7 |
| méthode 26 | `pauseRatpouch` | idem | Ratpouch en pause (`CHARMODE_PAUSED`, `delayCtr` = `0x7FFF`) |
| gestionnaires 9-10 | `jailorAnimHandler` | `engine/handlers/group-2/index.ts` | Skorl de la cellule (3EA) et du château (3F3) : au contact du joueur (champ 11 non nul, ou Skorl du château), `GS_RESTORE_RESTART \| GS_CAUGHT`, puis `standardCharacterAnimHandler` |
| 13 | `sonicRatAnimHandler` | idem | rat de la pièce 4 (41D) : attend le contact du joueur (`actionCtr` 1), puis joue son animation |
| 14 | `droppingTorchAnimHandler` | idem | torche qui tombe (40E) : à la fin du script, le feu (418) prend avec son animation, bruit 8 |
| 15 | `playerSewerExitAnimHandler` | idem | chute dans l'égout (416, pièce 7) : Diermot au centre, face au bas, libre ; Ratpouch libre avec les actions du suiveur |
| 20 | `prisonerAnimHandler` | idem | prisonnier (412, pièce 2) : `handleTalkDialog` en tête, un geste tiré au hasard tant qu'il vit |

Numéros nommés dans `methods/group-2/ids.ts` et `handlers/group-2/ids.ts`. Tables enregistrées en remplaçant les souches : `GROUP_2_METHODS` dans `METHOD_GROUPS`, `GROUP_2_HANDLERS` dans `HANDLER_GROUPS`.

## Écarts et remarques

- **Capture** : `setState(GS_RESTORE_RESTART | GS_CAUGHT)` est l'affectation de `ctx.gameState` ; la boucle (`game.ts`) joue la séquence de capture, le jeu redémarre ensuite. Rien à ajouter au socle.
- **`droppingTorchAnimHandler`** : `activateHotspot(0x41C)` est sans effet (le hotspot a le chargement 2, « pas encore »), comme dans ScummVM ; seul le feu 418 apparaît (chargement 4 le temps de l'activation, puis 2).
- **`playerSewerExitAnimHandler`** : ScummVM désactive le hotspot (`deactivateHotspot`) puis continue de s'en servir (second `executeScript`, `setTickProc`) : usage d'un objet retiré de la liste, qui marche en pratique. Le portage fait de même sur l'objet retiré (écrit dans son enregistrement : gestionnaire 2).
- **`prisonerAnimHandler`** : le test de ScummVM est `executeScript() == 0` : c'est un script **pas fini** qui est remplacé par le script de repos `0x3E0` ; gardé tel quel (testé).
- **Ratpouch absent** (méthodes 24 et 26, gestionnaire 15) : ScummVM déréférence un pointeur nul (`assert` pour 26) ; ici `requireActiveHotspot` lève.
- **Aucun nouvel état** : rien à sauvegarder, `save.ts` n'est pas touché, le test garde-fou des propriétés de `Hotspot` reste vert (rien n'a été ajouté à `Hotspot`).
- **Pas de combat dans la zone** : `setupSkorlFight` (méthode 17) n'est appelée que par la séquence de la pièce 49 (le château). La cellule n'a pas de combat ; le Skorl de la cellule capture au contact.

## Ce que la zone fait (constats, vérifiés sur les données)

- Le Skorl (3EA) fait une ronde pièces 1 → 2 → 3 → 4 → 3 → 2 → 1 (≈ 525 images). Il n'est dangereux que lorsque le champ 11 est non nul, ce que posent les emplois du temps 17 (« tu es dans la cellule ») et 4 (« Skorl qui a éteint le feu : cri `0x170`, champ 11 = 1 ») : jamais remis à zéro avant un redémarrage.
- La porte de la cellule est verrouillée de l'intérieur (champ 9 = 1) ; le Skorl l'ouvre (champ 9 = 0) en entrant. Le joueur qui se tient dans l'embrasure empêche le Skorl d'entrer : il erre dans la pièce 2 sans danger (champ 11 = 0) et la porte reste ouverte.
- Le Skorl dans la cellule attend la fin du son 21 (`checkSound` dans son emploi du temps), que lance la pièce 4 : tant que le joueur est dans la salle de torture, le Skorl reste dans la cellule (≈ 260 images de plus).
- Ratpouch est le serf du chevalet : le couteau (2713, salle de garde) coupe la corde (7535, pièce 4, `Utilise`) tant que le champ 14 est nul ; `rackSerfAnimHandler` (L4) le remplace par Ratpouch (conversation `0x9C`). **Faire tourner le chevalet** (« Actionne ») avant tue le serf (champ 14 = 2) et ferme cette voie.
- Le tonneau de la salle de garde n'a pas « Regarde » dans son menu : c'est le clic gauche (`LOOK_AT`) qui fait apparaître le robinet (7531, superposé au tonneau).
- Ratpouch ne suit le joueur dans une pièce que si l'entrée n'est pas occupée (le joueur planté à l'arrivée, `skipFlag`) : comportement de G2, laissé tel quel.
- Entrée par le trou : la séquence de sortie de la pièce 2 envoie Diermot en pièce 7 (`characterChangeRoom`), champ 76 = 1, chute (`playerSewerExitAnimHandler`) puis pièces 8, 9, 10 (le village).

## Passage de la zone

`test/lure/solution/zone-cell.ts` (données, `Step[]`), joué par `Play` de `test/lure/solution/runner.ts` (le joueur unique des solutions : `look`, `until`, points de clic qui désignent vraiment le hotspot, bulles de parole fermées d'un clic comme un joueur pressé) ; tout passe par `Driver` (clic droit, menus surgissants, clic gauche sur la sortie), jamais par l'état du moteur. `test/lure/engine/group-2/passage.test.ts` :

1. la solution jouée jusqu'au village (pièce 10), sans capture ni redémarrage, par les pièces 1, 2, 3, 4, 3, 2, 7, 8, 9, 10, avec l'état attendu en fin de zone (prisonnier mort, torche cachée, briques ouvertes, serf libéré, Ratpouch actif, couteau et bouteille à Diermot) ;
2. la même, avec une **sauvegarde puis une reprise dans un moteur neuf après chacune des 28 étapes** (`captureSave` → JSON → `parseSave` → `restoreSave`), même issue ;
3. le round-trip de la sauvegarde en cours de zone (Ratpouch libéré).

La solution s'adapte à ce qu'un joueur voit (`until` : porte ouverte, Ratpouch dans la pièce, briques poussées) plutôt qu'à un nombre d'images, sauf deux endroits où elle dépend d'une ronde du Skorl : le croisement en salle de garde (le pied à 140 contre 160 pour lui) et la marche vers le trou avant son retour (≈ 60 images de marge dans la solution jouée). La partie dure ≈ 1 550 images (2 minutes de jeu).

La vague K peut réutiliser `ZONE_CELL_STEPS` (début de partie) et `ZONE_CELL_END_ROOM` ; la zone suivante commence dans la pièce 10 avec Ratpouch dans la pièce 9 (il rejoint le joueur).

## Comparaison au banc ScummVM

Scénarios `l-cell` (cellule, 25 s de jeu sans action, graine 1) et `l-room3` (`console enter 3`), `port/run-port.sh lure`.

| Scénario | Avant (L2 non porté) | Après |
| --- | --- | --- |
| `l-room3` (3 captures) | 1,1 % : le Skorl est dans la pièce dans le portage, pas dans ScummVM | **3 captures identiques** (0 %) |
| `l-cell` (14 captures, fenêtre d'appariement 12 s) | 0,4 à 1,1 % sur `idle0002` à `0005` : le Skorl à la porte | **12 identiques**, 2 à 0,05 % (`idle0003`, `idle0005`) |

Ce qui reste (`idle0003`, `idle0005`) : uniquement la flamme de la torche du mur (phase de l'animation, quelques pixels, écart de couleur jusqu'à 179) ; le Skorl à la porte (pose, position) est **identique au pixel**. Avec la fenêtre par défaut (6 s) l'appariement trouve de 0,07 à 0,92 % : le Skorl apparaît à la porte 3,7 à 6,8 s plus tôt dans le portage que dans ScummVM (phase de la ronde : l'heure de la première ronde dépend du temps réel que ScummVM met à démarrer, la graine ne fixe que les tirages), il faut donc élargir la fenêtre (`WINDOW=12000`). Même cause que l'écart de trajectoire du cochon du banc des combats (`engine.md` § 12).

## Changements du socle

Aucun fichier du socle de production n'est modifié (`game.ts`, `verbs.ts`, `hotspot.ts`, `save.ts`… intacts) ; seulement deux lignes d'enregistrement (`methods/index.ts`, `handlers/index.ts`). Tests du socle mis à jour (le groupe L2 n'est plus en souche) :

- `test/lure/engine/engine.test.ts` : le catalogue des méthodes n'a plus de souches (tous les groupes portés), `jailorAnimHandler` n'est plus une souche, « Prends la torche » va jusqu'au feu au lieu d'attendre la souche ;
- `test/lure/engine/movement.test.ts` (« trajets entre toutes les sorties ») : le Skorl de la cellule est mis hors jeu comme les autres PNJ du test (toutes portes ouvertes, il prenait la sortie des briques).

## Poursuite du Skorl après le feu (vague K, comportement d'origine, prouvé au banc)

Ce qui arrête presque toutes les graines de la partie complète dans la cellule (3 graines sur 400 vont au bout : 1, 213, 301 ; 395
s'arrêtent dans la cellule, voir `group-3.md`).

- **Mécanisme (données)** : après avoir éteint le feu, le Skorl tourne dans la cellule (emploi du temps `0x1000` : cri, champ 11 = 1,
  marches au hasard, deux répliques, retour à la porte `0x2711`). L'entrée `0x1012` exécute la séquence `0x1D31` : si le joueur n'est pas
  dans la pièce 1 (`checkRoomNumber`) et que la porte de la cellule est ouverte (champ 9 = 0), `setSupportData(Skorl, 3)` lui donne
  l'emploi du temps `0x1400` ; sinon la boucle reprend (`0x1014` → `0x1004`), soit ≈ 250 à 300 images après le feu. `0x1400` : pièce 2
  (`SET_ROOM_AND_OFFSET`), puis sans fin `0x1401` (séquence `0x1E42` : `moveCharacterToPlayer`, l'action passe dans la pièce du joueur),
  `0x1402` (`npcWalkingCheck` du joueur : s'il est dans la pièce, marche jusqu'à **l'endroit où il est au départ du trajet** ; sinon
  `npcRoomChange` vers sa pièce), `0x1403` → `0x1401`. Le contact (`jailorAnimHandler`, champ 11 non nul) est la capture.
- **Deux conduites du moteur qui comptent pour l'esquive** (code identique à ScummVM) : un PNJ dont la recherche de chemin n'aboutit pas
  prend l'emploi du temps « retour » `0x400`, qui est en fait **une destination au hasard dans sa pièce** (`NPC_SET_RAND_DEST`, puis `0x401`
  `NPC_RESET_PAUSED_LIST`) ; un PNJ dont le point d'arrivée dans la pièce voisine est occupé n'entre pas (`characterChangeRoom`, emploi du
  temps d'index 0 = `0x400` : il part au hasard, puis réessaie). Le joueur dont le chemin n'aboutit pas, avec un `blockedState` non nul
  hérité d'un heurt, fait un pas au hasard ou s'arrête (`playerAnimHandler`, mêmes conditions que ScummVM).
- **Banc** (scénario `bench/scenarios/l-trace-skorl.txt`, hors dépôt, `SEED=2 trace.sh … 3e8,3ea`) : `enter 2`, joueur posé en (213, 96),
  `setfield 11 1`, `script 48 3 3eah` (`setNewSupportData` : l'emploi du temps d'index 3, `0x1400`, comme `0x1D31`), dans les deux
  moteurs. ScummVM et le portage : le Skorl repart vers le joueur (destination (213, 140) dans les deux), le touche et la capture
  redémarre la partie (pièce 1), puis il reprend sa ronde ; seule la phase diffère (durée du fondu de `enter`). Une partie jouée au banc
  (torche, embrasure, pièces 2, 3, 4) montre aussi le Skorl quitter la cellule, traverser 2 et 3 et prendre le joueur resté dans la 4.
  Piège du banc : `enter 2` ou `enter 3` moins de ~6 s après Échap fait lever ScummVM (« Invalid sound index », sons pas encore chargés) ;
  attendre 6 s.
- **Esquive essayée dans le joueur, non retenue** : un « guetteur » qui prévoit la route du Skorl (ses tronçons `pathFinder.list`, puis
  des trajets vers le joueur calculés par la recherche de chemin du moteur, l'entrée par le point d'arrivée d'une pièce voisine) et choisit
  où aller (y aller tout de suite, attendre qu'il passe, contourner par l'autre ligne du sol, attendre le moment d'agir). La prévision est
  juste dans une pièce (expérience à état posé : à quelques pixels près sur 40 images), mais la solution jouée n'aboutit que pour 0 ou 1
  graine sur 40, pas mieux que les points fixes : les actions qu'on ne peut pas interrompre (« Donne » au prisonnier : ~50 images de marche
  et ~35 de dialogue ; « Dis à Ratpouch » : ~50), Ratpouch et le Skorl qui bouchent la pièce 2 (le joueur bloqué fait un pas au hasard), les
  marches au hasard du Skorl bloqué, et une pièce 2 de 40 pixels de haut où il rattrape le joueur en moins de 70 images où qu'il soit.
  Pistes : une esquive qui enchaîne plusieurs pièces (l'attirer dans la salle de torture, une impasse, et revenir), ou un ordre des
  actions qui laisse au joueur le temps de tenir une entrée (point d'arrivée occupé : il ne peut pas entrer).

## Points ouverts

- Trois tests du socle échouent à cause de **Goewin (3EF)**, pas du groupe L2 : « les 45 pièces se chargent » (`engine.test.ts`), « les 45 pièces » (`rooms.test.ts`), « trajets entre toutes les sorties » (`movement.test.ts`) : `hotspot 3ef : image 22 hors de l'animation (5)` (marche d'un personnage à 5 images ; gestionnaire de Goewin, L4).
- `test/lure/solution/runner.ts` est le joueur unique des quatre zones (fusion de `runner.ts`, `cell-play.ts` et `runner-castle.ts`, voir `group-3.md`).
- Une seule solution est jouée et vérifiée ; les écarts de ronde du Skorl avec ScummVM (temps réel du banc) empêchent de comparer plus que les poses.
