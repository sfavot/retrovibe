# Lure of the Temptress : groupe L3, le village et le barman

Référence : moteur `lure` de ScummVM (`scripts.cpp` : `cutSack`, `townHallClose`, `checkWakeBrenda`, `setVillageSkorlTickProc`, `barmanServe` ; `hotspots.cpp` : `teaAnimHandler`, `grubAnimHandler`, `barmanAnimHandler`, `skorlAnimHandler`, `goewinShopAnimHandler`, `Hotspot::getBarPlace`, `findClearBarPlace` ; `res_struct.cpp` : `BarmanLists`, `BarEntry` ; GPL v3+), lu puis réécrit. Architecture : `engine.md` (§ 8 à 11).

## Ce qui est porté

| Quoi | Où |
| --- | --- |
| Service `Bar` : `getBarPlace`, listes de clients (`BarmanLists`), `saveState` / `restoreState` / `reset` | `engine/bar.ts` (`BarManager`) |
| Méthodes 33 `cutSack`, 39 `townHallClose`, 46 `checkWakeBrenda`, 54 `setVillageSkorlTickProc`, 56 `barmanServe` | `engine/methods/group-3/index.ts` (+ `ids.ts`), ajoutée à `METHOD_GROUPS` |
| Gestionnaires 18 `teaAnimHandler`, 23 `grubAnimHandler`, 24 `barmanAnimHandler`, 25 `skorlAnimHandler`, 27 `goewinShopAnimHandler` | `engine/handlers/group-3/` (un fichier chacun, + `ids.ts`), ajoutée à `HANDLER_GROUPS` |

L'horloge de la boutique (`tickCheck`) était déjà dans `game.ts`. Règle de la vague T : Grub, les barmen, les Skorls et Goewin (boutique) appellent `handleTalkDialog()` en tête, comme ScummVM (vérifié par test : la bulle s'affiche puis se compte à rebours jusqu'à sa fermeture). `goewinShopAnimHandler` appelle `normalGoewin` (méthode 60, L4) par la table des méthodes.

## Le bar

Trois bars (Sid pièce 29, Nellie 32, Ewan 35 ; ligne de la grille 13, 14, 16), chacun avec 4 places de clients (`hotspotId`, `serveFlags`), un client « en cours de service » et des listes d'images (polissage, service, deux animations d'Ewan).

- **Client** (`getBarPlace`, appelé par `actionPrecheck` quand l'action vise Sid, Nellie ou Ewan) : loin du comptoir il marche vers 4 blocs libres de la ligne du bar ; arrivé il prend une place (drapeaux `0x82` : en attente), `actionCtr = 1`, tourné vers le haut ; il attend tant que le bit `0x80` est posé (« en attente d'être servi »).
- **Barman** (`barmanAnimHandler`, `frameCtr` : bit 7 il marche vers `supportValue`, bit 6 l'action est commencée, bas : 1 flâner, 2 polir, 3 attendre, 4 attendre la fin d'un dialogue, 5 servir) : sert d'abord le client en attente de plus bas rang (il marche jusqu'à son x), puis un PNJ est servi aussitôt (drapeaux 0) et garde la main jusqu'à ce qu'il s'éloigne ; le joueur garde la main tant qu'on parle au barman (`talkerId`) ; `barmanServe` (méthode 56, dialogues de commande de boisson) ajoute 5 aux drapeaux du joueur : le barman sert une bière puis polit. Sans client la liste est vidée et une action au hasard est tirée (`ctx.rng`).
- Ewan polit parfois avec l'animation alternative (32 de large, décalé de 8 pixels) tant qu'ni le joueur, ni Gwen, ni Wayne ne sont dans la pièce 35.

### Écarts avec ScummVM

- Le client en cours de service est un **rang** (0 à 3), pas un pointeur ; `BarmanLists::saveToStream` de ScummVM calcule ce rang par `(p - base) / sizeof(BarEntry)` (toujours 0 ou 1) : ici l'état est écrit tel quel.
- `ewanXOffset` (membre de `HotspotTickHandlers`, que ScummVM ne sauvegarde pas) fait partie de l'état sauvegardé (`save.bar` : listes + `ewanXOffset`). Une sauvegarde sans `bar` donne des listes vides. Redémarrage : `Bar.reset()` (nouvelle méthode facultative du service), comme `Resources::reset`.
- Liste d'images absente (`null`, un barman sans les extras d'Ewan) : erreur, là où ScummVM lirait un pointeur nul (n'arrive pas).
- Un service `Bar` qui n'est pas un `BarManager` (doublure de test) : `barmanServe` et le gestionnaire journalisent l'appel et ne font rien.

## Modifications du socle (au strict minimum)

- `engine/game.ts` : le service par défaut est `BarManager` (au lieu de `StubBar`) ; `restart()` appelle `bar.reset?.()`.
- `engine/services.ts` : `Bar.reset?(): void` (facultatif). `StubBar` est conservé.
- `engine/methods/index.ts` et `engine/handlers/index.ts` : mes deux lignes (import et entrée de `METHOD_GROUPS` / `HANDLER_GROUPS`).
- `engine/save.ts` : **inchangé** (`save.bar` existait ; le test garde-fou des propriétés de `Hotspot` reste vert : aucune propriété ajoutée).
- `test/lure/solution/runner.ts` : voir ci-dessous (joueur unifié).

## Tests (`test/lure/engine/group-3/`)

47 tests : `methods.test.ts` (les cinq méthodes, cas négatifs compris), `handlers.test.ts` (les cinq gestionnaires : tous les cas du barman, Ewan et son animation alternative, la règle `handleTalkDialog`), `bar.test.ts` (`getBarPlace`, **le barman servant trois clients l'un après l'autre** : Gwen, Mallin puis le joueur, aller-retour de `saveState` / `restoreState` et par la sauvegarde complète), `passage.test.ts` (voir plus bas).

## Comparaison au banc ScummVM : le barman Sid

Scénario `bench/scenarios/l-barman.txt` (graine 1, **hors dépôt**, avec une opération `pkey` du portage seul dans `bench/port/lure.test.ts` : touche du menu surgissant, ScummVM choisit l'entrée au pointeur). Pièce 29 (`enter 29`), clic droit sur Sid, « Parle », le joueur marche jusqu'au comptoir, puis 25 secondes de barman (clients absents : flâner, polir). 44 captures, `port/run-port.sh lure` :

- entrée dans la pièce : **0 %** de différence ;
- marche du joueur (9 captures) : 0,7 à 1,4 % (ligne d'état « Parle à Etranger » dans le portage, « Parle  Etranger » dans ScummVM, D9 ; plus le décalage d'une image entre les deux horloges) ;
- 25 captures du barman seul : 0 à 0,7 %, la plupart à 0 ou 0,2 % (la ligne d'état) ; une seule (`x15`, 0,67 %) montre Sid à deux endroits différents : le tirage d'une destination de flânerie tombe une image plus tôt d'un côté que de l'autre (le banc réel a ses propres retards : même cause que celle déjà notée pour la marche des PNJ en T), et le décor revient identique à la capture suivante.

Les poses du barman (marche, polissage, immobilité) et les enchaînements sont ceux de ScummVM. **Non comparé** : le service d'un client (la commande d'une boisson passe par des dialogues qui demandent des groats : le banc n'a pas de commande pour en donner, `give` ne donne que des objets) ; il est couvert par les tests (trois clients, `barmanServe`).

## Passage de la zone village

`test/lure/solution/zone-village.ts` (données `Step[]`) jouées par `test/lure/solution/runner.ts` (`Play`, le joueur unique des quatre zones, son API en tête du fichier ; vrais clics, menus, dialogues ; les personnages qui se déplacent sont rejoints là où ils sont, une porte fermée sur la route est ouverte). `startVillage(engine)` : **état de début de village** = première entrée dans la pièce 7 (égouts) par `playerNewPos`. Le script d'entrée de la pièce (`0x83`, champ 62) est ce que la sortie de la cellule produit : il active le village (sous-séquence `0x122` : PNJ et objets), fixe `TALK_INDEX` à 1, etc. ; Ratpouch (qui suit depuis la cellule) est placé dans la pièce. Aucun objet n'est exigé de la cellule.

Le fil de la zone est `TALK_INDEX` (champ 19) : le dialogue d'un personnage est le rang `TALK_INDEX + 1` de sa liste de `0x3F11` (rang 0 : étranger dont on ne connaît pas encore le nom). Le graphe dialogue par dialogue (rang, personnage, valeur donnée, objet donné) se relève sur les données ; ce qu'il donne pour le village :

| Index | Personnage (dialogue) | Effet |
| --- | --- | --- |
| 1 | Mallin 3ED (pièce 10) | la barre d'or (Barre de métal) à porter chez Ewan |
| 1 | Ewan 436 (pièce 35) : « Donne » la barre | 8 groats et la gemme (faux bijou) |
| 1 -> 2 | Luthern 3EB, le forgeron (pièce 28, il va aussi chez Sid) | Goewin a disparu |
| 2 | Nellie 429 (pièce 32) : « Donne » la gemme | le flacon (`Flacon`) |
| 2 -> 3 | Morkus 421 (pièce 32) : « Corromps » (1 groat) puis « Parle à » | Goewin est à la mairie, arrêtée par les Skorls |
| 3 -> 4 | Luthern | voir Grub |
| 4 -> 5 | Grub 422 (pièce 12) : option « Chèvre Noire » | le crochet (Crochet), à donner à Ratpouch |
| 5 | Ratpouch (crochet), « Dis à Ratpouch : Déverrouille Porte » (pièce 19, porte 2717, séquence `0x936`) | champ 24 = 1 |

**La solution jouée va jusqu'à `TALK_INDEX` 15** (le sort de Goewin, sur la place avec Ratpouch : le départ de `setupCavesStart`), par de vrais clics ; `VILLAGE_ARRIVAL` (égouts -> place) et `VILLAGE_FROM_SQUARE` (place -> départ des grottes) permettent d'enchaîner la cellule. Le déroulé, relevé sur les données (séquences qui écrivent `TALK_INDEX`, dialogues) puis joué :

| Index | Où | Ce qui se passe |
| --- | --- | --- |
| 5 | forge, bar de Sid | « Donne » le Flacon à Luthern : il boit la bière de Nellie (Vieille Chauffe-Quiquette) et rend le flacon vide (séquence `0x17D9`, champ 25 de 2 à 0) ; la Poudrière (forge) ; Eileain (`0x442`, bar de Sid) donne le carnet de Taidgh, « Examine » le carnet (champ 75) |
| 5 -> 6 | pièce 19 puis laboratoire (30) | Ratpouch déverrouille la porte 2717 ; « Regarde » l'Appareil (avec le champ 75, le brûleur et le robinet deviennent désignables : c'est pourquoi le brûleur en (-8, 133) ne se visait pas, sa surcharge `0x3F08` est en (148..156, 134..142)) ; Poudrière sur le brûleur, le Flacon au robinet, « Bois » : Séléna |
| 6 -> 7 | mairie (31) | Skorl 426 : « Relâchez la fille ! », « Silence ! » (freeGoewin) ; « Parle à » Goewin (champ 74) ; deux changements de pièce hors 31 et 14 (champ 29) : séquence `0xCB7` |
| 7 -> 8 -> 10 | Goewin ; Mallin | « Un jour je vous dirai tout » ; Mallin donne le livre rouge |
| 10 -> 12 -> 13 | Toby (3F0), dans sa cellule (36) | le livre (la statuette) ; « Pouvez-vous m'aider… », « Y a-t-il quelqu'un d'autre… » |
| 13 -> 14 -> 15 | Goewin ; Cobane (pièce 18) | l'infusion Chiendent, Cobane, Elécampane (champ 56 = 0) : Goewin n'a plus de Cobane (elle devient visible en 18) ; la lui donner, attendre 40 s (champ 45 = 2), « Voilà le sort » |

Contraintes d'origine rencontrées (toutes dans le code comparé à ScummVM) : le Skorl du village passe par la 19 et, si la porte est déverrouillée, par le laboratoire ; il arrête le joueur qu'il y trouve sans le déguisement (emploi du temps 12, séquence `0x1E8A`) : on entre après son passage ; un personnage bloqué au point d'arrivée d'une pièce attend (on s'écarte des arrivées) ; un personnage qui touche le joueur s'arrête (`CHARMODE_PLAYER_WAIT`, vérifié au banc avec Minnow, voir plus bas) ; un moine qui marche n'écoute pas (« Hey, attendez ! »).

### Blocages élucidés au banc (tâche de la vague K)

Outils, **hors dépôt** (scratchpad, `scummvm-build/bench/`) : `scummvm-lure-trace.diff` (ScummVM écrit à chaque image, avec `LURE_TRACE=1`, la pièce, `TALK_INDEX`, le curseur et, pour les hotspots de `LURE_TRACE_IDS`, pièce, position, action, destination, états de blocage, compteurs, `yCorrection`, `charRectY`, `coveredFlag`, et le texte de la bulle), `port/lure-trace.test.ts` (la même trace dans le portage, scénario rejoué avec `lag`), `trace.sh SCÉNARIO IDS DOSSIER` (les deux), scénarios `l-trace-*.txt`. Les commandes `enter` du débogueur bloquent ScummVM ~3,6 s (fondu) : `lag 3600` et des attentes d'au moins 4 s entre deux `enter`.

- **a) Ratpouch ne passe pas de la pièce 14 à la 19 : bogue du portage, corrigé.** Même scénario (`l-trace-a4` : Ratpouch posé en (297, 104) dans la 14, joueur dans la 19) : trajet identique image par image jusqu'à (113, 144), puis ScummVM entre dans la 19 et le portage est bloqué (l'arrivée est occupée par le moine 0x3EE, planté en (129, 88) dans la 19). Le moine n'est pas au même endroit : dans ScummVM il est déjà dans la pièce 14 à la première image dans la pièce 7, dans le portage encore dans sa pièce de départ (36). Cause : l'avance rapide de `Room::setRoomNumber` (`(getMillis() - exitTime) / 1000` secondes de ticks, au plus 300) est calculée par ScummVM sur 32 bits **non signés** ; les pièces 6, 7, 41 à 46 et 49 ont une heure de sortie initiale `0xFFFFF` : avant 1 048 575 ms la différence boucle, d'où 300 secondes d'avance à la première entrée ; le portage, en nombres signés, n'en faisait aucune. Correction : `room.ts` (`>>> 0`), test `test/lure/engine/room-catchup.test.ts` (échoue sans la correction). Après correction, Ratpouch passe dans la 19 en 68 images dans les deux, et la trace de Gwen sur cinq minutes de village est identique à celle de ScummVM sur ~2 000 images. Trois tests de `fights.test.ts` dépendaient de l'ancien état (graine 5 au lieu de 1 pour le cochon gagné, position du joueur 240 au lieu de 282 au début du combat du Skorl) : mis à jour, `fights-scummvm.test.ts` (comparaison au banc) inchangé et vert.
- **b) Gwen et Ratpouch, la porte de la taverne : comportement d'origine.** `l-trace-b` (joueur et Ratpouch près de l'entrée de la pièce 32 quand Gwen y arrive) : dans ScummVM aussi Gwen reste ~1 000 images près de l'entrée (en (101, 110) ; (85, 102) dans le portage), le passage vers le comptoir étant occupé ; les bulles se terminent (pas de rallonge sans fin). Les conversations du bar diffèrent ensuite parce que le hasard a été tiré un nombre de fois différent avant la commande `enter` (images d'introduction : 52 contre 75), pas par la logique. Contournement : la solution ne se tient pas devant les entrées (`walk` hors du point d'arrivée) et `Play.exit` réessaie.
- **c) Gwen boucle de la pièce 12 vers la 32 : non reproduit dans la partie réelle.** Village de cinq minutes (`l-trace-gwen`) : dans ScummVM comme dans le portage corrigé, Gwen va de la 12 à la 32 (437 images à la taverne), revient, etc., avec les mêmes durées par pièce. Le constat de G2 (`engine.md` § 10) venait de PNJ activés à la main dans la pièce 10, sans le script d'entrée de la pièce 7 ni son avance rapide.
- **d) Pièce 49 : comportement d'origine.** `l-trace-d1` / `d2` (champ 70 = 1, `enter 49`, joueur en (100, 141)) : un clic dans la zone de sortie mène le joueur vers `(-3, 176)` hors de l'écran ; il reste « en marche » (action 5) en (-8, 136) pendant que la séquence de sortie `0x1AD` (fin du jeu) se joue ; un clic en (2, 199), hors de la sortie, l'arrête en (4, 144) sans sortir. Identique dans les deux. La solution clique dans la zone (10, 190).
- **e) « Hey, , attendez! » : pas un bogue du jeu ; un bogue de rendu trouvé au passage.** Le nom vide venait du journal du joueur de test (`engine.text` : texte brut, sans substitution). Au banc (`l-trace-hey`, Luthern étranger), la bulle de ScummVM commence par « Hey, Etranger, », celle du portage (`bubbleText`) est « Hey, Etranger, attendez! ». Le joueur unifié journalise désormais le texte de la bulle (`bubbleText`). Ce faisant, `bubbleText` levait pour un interlocuteur sans hotspot (le serf du chevalet parle à `NOONE`, 0x3E7) : **le rendu de cette bulle aurait planté dans le navigateur**. Corrigé (`render/talk-bubble.ts` : `getHotspot` nul de ScummVM, pas de nom), tests dans `test/lure/render/talk.test.ts`.
- Pièce 28 (sortie vers la 18) : le point visé par un clic sur une sortie (`exitCoordinate`) est au-dessus de la zone de sortie ; un joueur qui arrive par le haut (après un heurt `CS_BUMPED`, pendant lequel il ne change pas de pièce) s'arrête sans la franchir, et reste planté. Identique dans ScummVM (`l-trace-r28b`). `Play.exit` fait un pas de côté et recommence.

- **Deux bogues du portage trouvés en jouant 5 -> 15** : (1) `Room.isDialogShowing` ne vérifiait pas, comme `room.h` de ScummVM, que celui qui parle est encore actif et dans la pièce : le Skorl de la place, retiré (non persistant) avec sa bulle ouverte quand le joueur entre à la mairie, bloquait pour toujours la conversation suivante (corrigé, `isDialogActive` séparé pour le barman ; test dans `talk.test.ts`) ; (2) la sauvegarde était acceptée quand une conversation commence et attend la fin d'une bulle (gestionnaire de dialogue, `talkState` encore `NONE`) ; le dialogue actif n'étant pas sauvegardé, la reprise levait. ScummVM laisse sauver et déréférencerait un pointeur nul : le portage refuse (`canSave`, écart documenté ; test dans `save.test.ts`).
- **Château enchaîné derrière les grottes (Minnow « bloqué » en 44)** : Minnow, qui touchait le joueur après la conversation, attendait (`CHARMODE_PLAYER_WAIT` ; l'action en tête restait `PROCESSING_PATH`). Banc (`l-trace-minnow` : joueur planté en (237, 96) dans la 44) : ScummVM et le portage arrêtent Minnow au même endroit, (209, 96), ~900 images : comportement d'origine. La solution s'écarte après lui avoir parlé, et pareil au levier de la pièce 48.
- **Personnage bloqué à l'arrivée (pièce 18)** : `l-trace-pile` (joueur sur l'arrivée de la 17) : Mallin reste devant la sortie dans la 17 dans les deux moteurs ; le dépassement de 20 actions (erreur de ScummVM comme du portage) vu une fois dans le portage n'a pas été reproduit au banc.

### Joueur des solutions (`runner.ts`)

Un seul joueur (`Play`) pour les quatre zones, fusion de `runner.ts` (L3), `cell-play.ts` (L2), `runner-castle.ts` (L4) et `play-caves.ts` (grottes) : un seul `TellOrder` (`verb`, `object`, `seen`), un seul `until` (condition, `what`), des points de clic qui désignent vraiment le hotspot (le pointeur est posé sans jouer d'image sur chaque candidat : `checkRoomHotspots` du moteur, puis une seule image de survol), le combat réactif des grottes (`Play.fight`, qui gagne aussi le Skorl). API en tête du fichier.

### Autres points

1. Après une reprise de sauvegarde, un personnage peut ne pas avoir encore ses verbes pendant quelques images (`actions` de ses données à 0 quand son emploi du temps ne l'a pas encore « posé ») : `Play.verb` attend et réessaie.
2. `StubBar` n'est plus utilisé par le moteur (gardé dans `services.ts`).
3. **Partie complète** : `full-game.test.ts` est vert (d'une traite et avec reprises, graine par défaut) depuis l'écart de l'avance rapide (voir « Causes établies »). Autres graines (les deux variantes) : 213 et 301 vont au bout ; 256 s'arrête au château, 28 au village (voir « Points ouverts ») ; presque toutes les autres dans la cellule (le Skorl).

### Causes établies (vague K, suite)

- **Minnow abandonne son emploi du temps (château)** : comportement d'origine, **dans le code** (non rejoué au banc). Gêné par le joueur, Minnow prend l'emploi du temps « retour » (`0x400`) au-dessus d'une action factice et `blockedFlag` passe à vrai. Si on lui parle pendant ce détour, la réponse (« Dis au Skorl… fuite », `Script::setSupportData`) **remplace** l'entrée du détour sans remettre `blockedFlag` à faux (identique dans `scripts.cpp`). Au blocage suivant (le joueur qui s'écarte le bouscule), `standardCharacterAnimHandler` ne rajoute pas d'action factice (`blockedFlag` déjà vrai) et l'emploi du temps « retour » écrase la réponse (`0x2C1C` : prévenir le Skorl, puis venir au joueur) : Minnow retourne à sa ronde (`0x500A`…) et ne vient jamais en 46. Trace du portage : la pile passe de `{0x2C1C, 0x500A}` à `{0x400, 0x500A}`. Le même code dans le passage du château seul réussissait par chance (une action rajoutée au-dessus avait remis le drapeau à faux).
- **Toby ne prend pas le livre (village d'une traite)** : comportement d'origine. Toby médite dans sa cellule (36) puis fait une tournée ; son script de « Hé, attendez ! » (`0x15A8`) ne l'arrête pas hors de la pièce 36 (champ 4 = 1 en 36, sinon méthode 45). Le joueur arrivait en 36 après son départ, puis le poursuivait de pièce en pièce sans le rattraper. Corrigé dans le joueur (voir plus bas).
- **Goewin arrêtée et porte C (grottes, autres graines)** : comportement d'origine (`checkForIntersectingCharacter`) : le joueur restait sur le point d'arrivée de Goewin en 39 (arrivée hors de la grille de marche, poche à droite) ; `walk` vers un point fixe ne l'en sortait pas toujours.
- **Dépassement de 20 actions de Ratpouch (grottes, « Ewan et le tonneau »)** : **comportement d'origine, prouvé au banc**. Mécanisme : le joueur entre en 19 (`Game::changeRoom` pose `exitTime` de la 19), regarde la boutique (vue à distance : `Room::setRoomNumber(35)`, sans `changeRoom`) pendant ~240 s, puis un clic le ramène (`setRoomNumber(19)`) : avance rapide de `catchUpTicks` = 242 ticks de `Game::tick`, **sans** `pausedList().countdown()` (appelé par `Game::nextFrame` seulement). Au 3e tick, le villageois `0x3EE` qui marche heurte Ratpouch oisif (`PausedCharacterList::check` : entrée `0x3EE → 0x3E9`, `pauseCtr` = 15) ; figé pour tout le reste du rattrapage, Ratpouch reste en `CHARMODE_IDLE` et `followerAnimHandler` empile une action aléatoire de la pièce (`0x8000`, `0x8400`, `0x8800`) à chaque fin d'attente (`countdownCtr` = 0 à 32), sans jamais la commencer (`standardCharacterAnimHandler` sort sur `pauseCtr > 1`) : plus de 20 entrées, `validateStack`. Banc (scénario `l-trace-remote`, graine 2 ; trace étendue : `n` = taille de la pile, lignes `TP` des ticks d'avance rapide, commande `hotspot ratpouch clear`) : joueur entré en 19 par la sortie de la 14, 5 min 30 plus tard Ratpouch oisif est posé sur son chemin, le joueur part, `enter 35 1` puis `enter 19 1` ; dans ScummVM, au 33e des 300 ticks de rattrapage le joueur qui marche touche Ratpouch (`a=-1 cm=2 n=0` → `pc=15 n=1`), `pc` reste à 15, `n` monte de 1 à 20 et ScummVM s'arrête sur « NPC character got an excessive number of pending actions! ». Le portage fait de même (même scénario : `pc=15` sur 285 ticks, `n` jusqu'à 16-20 selon la graine, l'erreur pour la graine 28) ; les deux traces ne sont pas égales image par image (ScummVM en temps réel prend ~400 images de retard en 5 min 30, les tirages divergent). **Écart du portage** (décision de l'utilisatrice, `engine.md` § 10, liste des écarts de G2) : chaque tick de rattrapage décompte aussi la liste des attentes (`countdownPaused`, comme `Game::nextFrame`) ; le personnage heurté reprend au bout de 15 ticks et Ratpouch n'empile plus. Tests : `room-catchup.test.ts` (échoue sans l'écart : figé 200 ticks), `test/lure/remote-view.test.ts` (vue de plusieurs minutes par de vrais clics, graine 256 : Ratpouch heurté pendant les 220 ticks de rattrapage, pile d'au plus 1 action). La solution regarde par la fenêtre aussi longtemps qu'il faut, sans mécanisme particulier. Autre chemin vers l'erreur : aucun trouvé (revue des ajouts aux piles : suiveurs, `npcRoomChange` borné par `exitCtr`, détours bornés par `blockedFlag`) ; seul un gel mutuel en images normales (deux personnages bloqués l'un par l'autre, chacun relançant l'attente de l'autre par `scanPaused`) avec Ratpouch oisif l'atteindrait en théorie, jamais observé.

### Mécanismes du joueur (`runner.ts`, génériques)

- `giveWay` (étape `{ giveWay: true }`, et automatique dans `until`) : le joueur gagne le point du sol le plus proche loin des personnages de la pièce, de leur chemin vers leur destination et vers l'objet de leur ordre (« Tire le levier »), des points d'arrivée (données des sorties des pièces voisines) et des zones de sortie ; le point est validé par la recherche de chemin du moteur (grille vivante, sans la place du joueur) et le chemin ne doit traverser aucune sortie. Dans `until`, il se déclenche si un personnage est gêné par le joueur (arrêté contre lui, détourné près de lui, arrivé sur lui) ou si le joueur est sur le point d'arrivée d'un personnage qui vient vers sa pièce ; `stay: true` l'interdit (la cellule : le joueur bloque exprès l'embrasure ; la cellule extérieure où rôde le Skorl hostile).
- `waitDetour` : avant « Parle à », « Donne », « Dis à », on attend qu'un personnage en détour (`blockedFlag`) ait repris sa route (au plus 300 images) : c'est ce qui évite le cas de Minnow.
- `openMenu` suit un personnage qu'on ne peut pas désigner (il sort ou entre) : on le rejoint de nouveau (Toby, Goewin).
- Un joueur pris (`GameState.CAUGHT`) fait échouer l'étape aussitôt.
- Données : les « s'écarter » à des points choisis à la main (Minnow en 44, Goewin en 39) sont remplacés par `giveWay` ; levier et treuil du château rejoués s'ils n'ont pas été enchaînés à temps ; laboratoire : si le Skorl a reverrouillé la porte en passant, Ratpouch la rouvre avant d'entrer.

### Points ouverts

- **Mesure (vague K, suite, 13/11/2026, après la correction des points d'arrivée ci-dessous)** : partie complète d'une traite, graines
  1 à 400 : **3 vont au bout (28, 213, 256)** ; 395 s'arrêtent dans la cellule (pris par le Skorl), 1 dans la grotte d'entrée, 1 au
  levier et treuil du château. La graine 1 (par défaut) perd désormais la course de la Weregate (voir graine 28). `full-game.test.ts` joue
  (a) pour les graines 28, 213 et 256, (b) pour la graine 213. Avant la correction : 3/400 aussi (1, 213, 301).
- **La cellule** : la poursuite du Skorl est le comportement d'origine (prouvé au banc, mécanisme et essai d'esquive : `group-2.md`,
  « Poursuite du Skorl après le feu »). Non résolu.
- **La suite de la partie, sans la cellule** (début de village posé par `startVillage`, puis village, grottes, château ; graines 1 à 100) :
  35 vont au bout. Échecs : « se cacher en bas de la pièce 46 » (pris, 12), « grotte d'entrée » (8 + 3), « Luthern à la forge » (10),
  porte C des crânes (4), sortie vers 38 au retour des grottes (4), levier et treuil (4), laboratoire (3), divers (≤ 2 chacun). Une graine
  qui franchit la cellule a donc environ une chance sur trois d'aller au bout.
- **Graine 28, « Luthern à la forge » : cause établie, deux défauts du joueur de test (pas du moteur).** Arrivé de la 18 en (133, 96), sur
  le point d'arrivée de Luthern (sortie 18 → 28 : arrivée (129, 144), pieds), avec un `blockedState` de 2 hérité de heurts en route. (1)
  L'étape `walk [220, 150]` de `luthernAtForge` vise un point dans un mur de la grille de la pièce 28 (chemin partiel) : le joueur bloqué
  ne fait alors que s'arrêter (`playerAnimHandler` : `blockedState` final, `CHARMODE_PLAYER_WAIT` ; mêmes conditions dans ScummVM, lignes
  155-165 de `hotspots.cpp`). (2) `giveWay` ne l'en sort pas : `onArrivalPoint` compare le haut du joueur (`player.y`) aux pieds de
  l'arrivée (`exit.y`), et la liste des arrivées de `giveWay` place les pieds 48 pixels trop bas (`e.y + 48` au lieu de `e.y` ;
  `characterChangeRoom` pose le joueur en `(x, y - 48)`) : le joueur n'est jamais vu sur un point d'arrivée. Luthern, qui veut entrer depuis
  la 18, part au hasard et réessaie pendant 4 000 images. **Correction appliquée (13/11/2026)** : corriger (2) (deux lignes de `runner.ts`)
  fait aller la graine 28 au bout et fait passer la suite de la partie de 35 à 48 sur 100 (« Luthern à la forge » : 10 → 0), mais change le
  déroulé de la graine par défaut, qui perd alors la course de la Weregate (le joueur clique la sortie pendant que Goewin est dans
  l'embrasure, chemin partiel, pas au hasard, la porte se referme : « Tout est perdu »), d'où le choix des graines de `full-game.test.ts`.
  L'attente « Goewin a passé la Weregate » sauve cette course mais déplace l'échec de la graine 1 au levier du château : non retenue.
- **Graine 256, « salle à grille : levier et treuil » : cause établie (solution, comportement d'origine).** Le levier ne reste tiré que
  5 s (champ 65, ~63 images). Après « Dis à Minnow : Tire le levier », la solution écarte le joueur en (200, 175) ; Minnow, au levier en
  (137, 120), barre le chemin direct vers le treuil (161, 88). Graine 256 : au levier tiré, le joueur est en (229, 136) ; il part vers le
  treuil, bute sur Minnow, fait des pas de côté (chemin bloqué, `blockedState`) et tourne autour de lui ; 64 images plus tard le levier est
  relâché et il n'est toujours pas au treuil (trois essais identiques). Même chose pour la graine 301 quand le déroulé change (65 images,
  levier relâché 3 images trop tôt). Avec la correction de la graine 28, le déroulé change et la 256 va au bout ; le défaut reste pour ~8
  graines sur 100 (suite de la partie sans la cellule). Essais : revenir au treuil (« Regarde ») après l'ordre, ou attendre que Minnow, qui suit, soit arrivé près du
  treuil avant de lui parler : pas mieux (8/100) ou pire (27/100). Non résolu.
