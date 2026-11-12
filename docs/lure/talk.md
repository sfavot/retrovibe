# Dialogues de Lure of the Temptress (vague T)

Référence : moteur `lure` de ScummVM (`hotspots.cpp` : `talkAnimHandler`, `talkEndConversation`, `doTalkTo`, `doAsk`, `doGive`, `doBribe`, `doTell`, `startTalk`, `converse`, `handleTalkDialog` ; `surface.cpp` : `TalkDialog` ; `res_struct.cpp` : `TalkData`, `TalkDataList` ; GPL v3+), lu puis réécrit. Formats : `formats.md` (`0x3F11`, `0x3F12`) ; architecture : `engine.md` (§ 8 à 11) ; rendu : `graphics.md`.

## Modules

| Fichier | Rôle |
| --- | --- |
| `engine/talk.ts` | `talkAnimHandler` (gestionnaire 37, celui du joueur pendant une conversation), `talkEndConversation`, l'état du choix (`talkSelectView`), le clic (`registerTalkClick`), les drapeaux « option choisie » (`talkAskedKeys`, `restoreTalkAsked`) |
| `engine/tell.ts` | « Dis à » : `parseTellOrders` (les ordres d'une commande), `giveTellOrders` (la file d'actions donnée au PNJ, extraite de `doTell`) |
| `engine/verbs.ts` | `doTalkTo`, `doAsk`, `doGive`, `doBribe`, `doTell`, `getTalkId`, `startTalk` : déjà complets depuis G1 (relus ligne à ligne contre ScummVM, sans écart) ; `doTell` appelle `giveTellOrders`, `startTalk` utilise `TickProc.TALK` |
| `engine/handlers/index.ts` | ajoute `TALK_HANDLERS` aux groupes (`talkAnimHandler` n'est plus une souche) |
| `engine/game.ts` | une ligne : `handleClick` appelle `registerTalkClick` quand une conversation traite le clic |
| `render/talk-bubble.ts` | `TalkBubble` tient désormais `TalkDialogState.building` à jour (voir plus bas) |
| `render/talk-select.ts` | `drawTalkSelect` / `drawTalkSelectView` : le choix du joueur |

Le choix des PNJ qui interpellent le joueur (« Hé, monsieur ! », `NPC_TALK_TO_PLAYER`, `talkOverride`, `talkGate`) était déjà porté (`npcHeySir`, `getTalkId`, `standardCharacterAnimHandler`).

## Machine à états de `talkAnimHandler`

Un dialogue est un enregistrement de `0x3F12` : des **entrées** (pré-séquence, texte, post-séquence) et des **réponses**. États (`TalkState`) :

1. `NONE` : fixe l'interlocuteur (`talkDestCharacterId`) et attend qu'aucune bulle ne soit affichée, puis fait comme `START`.
2. `START` : parcourt les entrées à partir de `talkStartEntry`, saute celles dont les deux bits de poids fort du texte valent 3 (épuisées), exécute la pré-séquence de chacune (`& 0x3FFF`, valeur non nulle : montrée), s'arrête après une entrée dont le bit 15 de la pré-séquence est posé. Plusieurs options dont une qui parle : `SELECT` ; sinon `RESPOND` avec la première.
3. `SELECT` : la ligne est `y / 8` sous le pointeur (0 hors des lignes montrées) ; clic gauche sur une ligne : `RESPOND` ; autre bouton : `talkEndConversation`, puis le personnage fait « ? » (message 13).
4. `RESPOND` : attend la fin d'une bulle en cours, pose le drapeau de l'option (`descId |= 0x4000`), fait dire la question à Diermot (`converse`) sauf texte vide (`0x424`) : `RESPOND_2` (attend la fermeture de la bulle) ou `RESPOND_3`.
5. `RESPOND_3` : choisit la réponse (post-séquence de l'entrée, avec le bit 15 : séquence qui rend le rang ; puis la boucle des pré-séquences de la réponse jusqu'à `0x1092`), la fait dire au personnage.
6. `RESPONSE_WAIT` : attend la fin de la bulle ; la post-séquence de la réponse décide : `0xFFFF` fin, rang simple ou séquence qui rend un rang : de nouvelles options (`talkStartEntry`), `0xFFFF` rendu par la séquence : fin.

`talkEndConversation` : le joueur reprend `playerAnimHandler`, perd son interlocuteur, le personnage est libéré (`talkerId = 0`, `useHotspotId = 0`, `delayCtr = 24`), plus de dialogue, `talkState = NONE`.

## Écarts avec ScummVM (voulus)

- **Le choix n'est pas dessiné par le gestionnaire** : le moteur garde les lignes et la ligne survolée (`talkSelectView`), le rendu pose les lignes (`render/talk-select.ts` : fond noir de toute la largeur, une ligne de 8 pixels à partir de y = 8, texte `0xE2`, ligne survolée `0xE3`). **Au plus 4 lignes** (`MAX_TALK_SELECTIONS = 4` ; le plan et `engine.md` disaient 3). Aucun dialogue du jeu n'en montre plus de 4 à la fois (vérifié : ScummVM ne borne pas la liste, un cinquième serait un dépassement).
- **Le clic est un événement**, pas l'état du bouton à l'image : ScummVM lit `mouse.lButton()` (le banc tient le bouton 100 ms, plus d'une image de 80 ms) ; le portage perdrait un clic plus court qu'une image (hôte qui envoie appui et relâchement ensemble). `LureEngine.handleClick` enregistre le clic, le gestionnaire le consomme dans la même image (et l'oublie à chaque image).
- **Les options déjà choisies** (`descId |= 0x4000` dans ScummVM, qui **modifie les données partagées**) sont des drapeaux de `LureState.talk.asked` (`recordId * 1024 + rang`), pas dans `data.talk` : les données restent intactes, un nouvel état (`World.reset`, redémarrage) repart de zéro. Seules les entrées dont les bits 15 et 14 valent 1 et 0 (« à usage unique ») disparaissent une fois choisies ; les autres reviennent.
- **Les erreurs de ScummVM** (`assert`, `error`) sont des exceptions : dialogue sans interlocuteur, réponse hors liste, aucune option à choisir (ScummVM déréférence un pointeur nul), et une boucle de pré-séquences de réponse qui ne s'arrête pas au bout de 64 tours (ScummVM boucle sans fin).
- **Bulle : `building`**. ScummVM ne compte pas à rebours la bulle (`handleTalkDialog`) tant que son texte s'écrit (`TalkDialog::isBuilding`), et n'accepte pas de la fermer d'un clic. `TalkBubble` tient `room.talkDialog.building` à jour (vrai à la création, faux quand tout le texte est écrit) ; sans rendu (tests), la bulle ne dure que le décompte (40 images) : un dialogue se joue donc plus vite en test qu'à l'écran.

## État et sauvegarde

L'état du dialogue est `LureState.talk` (`state.ts`, `TalkSessionState` : interlocuteur, options montrées, réponse, ligne survolée, clic, options choisies) : plus aucun état caché dans `talk.ts`. Seules les **options choisies** (`asked`, `recordId * 1024 + rang`) sont sauvegardées : `SaveData.talkAsked` (`save.ts` ; une sauvegarde sans le champ est lue sans option choisie), `talkAskedKeys` / `restoreTalkAsked` pour les lire et les écrire. Pendant un dialogue la sauvegarde est refusée (`canSave` : `talkState != NONE` ou curseur `TALKING`, comme `isMenuAvailable`), vérifié par test : ni le choix ni la réponse en cours ne sont à sauver.

## Rendu

`LureRenderer.drawOverlays` appelle `drawTalkSelect` (après l'image de la pièce, avant la barre de menus). « Statut » : `showDialogText(texte, true)` pose `LureEngine.dialogCentered`, `infoDialog(data, texte, true)` centre la boîte en hauteur (`(200 - hauteur) / 2`).

## Tests

- `test/lure/engine/talk-walk.test.ts` : **les 226 dialogues** de `0x3F12` se parcourent sur les vrais fichiers (une partie neuve par dialogue, le personnage qui le cite dans `0x3F11`, le joueur choisit à chaque écran l'option la moins choisie, jusqu'à douze passages). Résultat : 222 sans erreur, tous finissent, 520 des 648 entrées sont choisies dès le début du jeu (les autres ont une condition fausse à ce stade), 58 dialogues ont un écran de choix, jamais plus de 4 lignes, une option à usage unique ne revient pas. Quatre dialogues sont attendus en erreur : `ddcc`, `e5c2`, `eaaa` (aucune option montrée au début du jeu : ScummVM planterait) et `d99e` (une séquence exige Goewin active, vague L4).
- `test/lure/engine/talk.test.ts` : le choix (lignes, survol, clic, clic hors des lignes), le clic droit, le clic rapide, les options à usage unique, les drapeaux, « Parle à » complet (`doTalkTo`), la sauvegarde refusée pendant un dialogue puis permise, « Dis à Ratpouch » à deux ordres (composition par les menus, puis exécution dans l'ordre : `Va à` puis `Reviens`), `giveTellOrders`, `parseTellOrders`.
- `test/lure/render/talk.test.ts` : `building`, un mot par image (texte rapide) ou un sur deux, hauteur de la bulle, dessin du choix (fond, couleurs, 4 lignes au plus).

Le personnage de test prend `STANDARD_CHARACTER` comme gestionnaire : les gestionnaires propres aux personnages (vague L) sont des souches qui ne comptent pas la bulle à rebours (`handleTalkDialog`), un dialogue avec Grub, un Skorl, etc. ne se finirait pas avant leur vague.

## Comparaison au banc ScummVM

Scénario `scummvm-build/bench/scenarios/l-talk.txt` (graine 1) : pièce 23 (`enter 23`), clic droit sur Luthern (l'étranger), « Parle à » (menu surgissant : touche bas puis clic), les bulles de Diermot et de Luthern, l'écran de choix (survol de la 2e ligne, clic sur la 1re), la question de Diermot et la réponse, jusqu'au départ de Luthern. 74 captures :

| Captures | Différence |
| --- | --- |
| 19 | **0** |
| 49 | 0,02 à 0,18 % : uniquement la ligne d'état (« Parle à Etranger » dans le portage, « Parle  Etranger » dans ScummVM) |
| `s0000` (0,71 %), `s0054` à `s0058` (0,5 à 0,8 %) | première image de la bulle, puis Luthern qui s'en va |

Ce qui est identique pixel à pixel (à la ligne d'état près) : les bulles (cadre, nom, texte révélé mot à mot, coupe des lignes, position), les lignes de choix (fond, texte, ligne survolée en blanc), les enchaînements (question, réponse, nouvelle bulle), aux décalages de temps près (de l'ordre de ±50 ms, une image).

Écarts expliqués :

- **Ligne d'état « Parle à »** : D9 (`plan.md`) ; la donnée de ScummVM coupe « Parle \x81 » en « Parle » (coquille de `create_lure`), le portage affiche « Parle à » comme le jeu d'origine. Le menu surgissant montre la même différence.
- **Départ de Luthern** (`s0054` à `s0058`) : dans le portage il traverse la pièce plus vite et sort avant que ScummVM l'ait fait (marche des PNJ, vague G2, pas la conversation) ; non expliqué plus avant.
- **`s0000`** : image de transition (la bulle de Diermot apparaît une image plus tôt ou plus tard).

Changements du banc (hors dépôt, sans rien casser : `l-ui` donne toujours 0,13 % sur la boîte, les autres scénarios Lure sont inchangés) :

- `scenarios/l-talk.txt` ; `lag N` (ignoré par ScummVM, le portage suspend N ms ses ticks après `enter` : ScummVM met ~680 ms à entrer dans une pièce, les personnages qui bougent sont alors aux mêmes endroits au moment du clic) ; `realmouse` ; touche `DOWN` / `UP` dans le menu surgissant du portage (`indexNext` / `indexPrevious`) ; 
- `src/backends/events/sdl/bench.cpp` (et `scummvm-bench.patch`) : opérations `key UP` / `key DOWN`, `wheel up|down`, `realmouse`. Le menu surgissant de Lure en mode souris recentre le pointeur (`warpMouse`) ; avec la fenêtre factice du banc, SDL renvoie un mouvement fictif à une mauvaise ordonnée à chaque tour, qui annule tout changement d'entrée : les scénarios existants choisissaient donc toujours la première entrée. `realmouse` ignore ces mouvements fictifs (la souris est alors celle du banc seul) ; sans lui, le comportement d'avant est gardé.
- `scummvm-games/cfg/scummvm.ini` avait disparu : recréé ; `run.sh` passe désormais un chemin canonique (ScummVM réécrivait les `path=` en relatif avec un chemin contenant `..`). Voir `bench/README.md`.

## Points ouverts pour la vague L

- Les gestionnaires propres aux personnages (Grub, Skorls, barmen, Goewin, gargouilles, serf, crânes…) doivent appeler `h.handleTalkDialog()` en tête, comme ScummVM, sinon leur bulle ne se compte pas à rebours et la conversation reste en `RESPONSE_WAIT` ; Goewin (animation `3EF`) doit aussi être active et dans une animation valide pour ses dialogues (le test la remplace par Ratpouch, sauf `d99e` qui exige Goewin).
- La séquence `TELL` de Ratpouch (`0x1CB0`) rend 0 si Ratpouch obéit : elle appelle `setTalking` (L1, porté) ; les autres personnages n'ont pas d'action « Dis à ».
