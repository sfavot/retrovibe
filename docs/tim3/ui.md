# The Incredible Machine 3 : interface et éditeur (vague U)

Ce qui se joue sans navigateur est dans `src/games/tim3/engine/` ; le DOM et le canvas dans `src/games/tim3/ui/`. Les textes
du site sont dans `src/games/tim3/copy.ts` ; ceux du jeu viennent de ses fichiers (`LEVELS.INF`, `INFO.RES`, `DESCRIPT.RES`,
`MUSIC.RES`, `BINSOLVE.RES`).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `engine/editor.ts` | `Editor` : bac, pièce tenue, pose sur la grille (42f24a), chevauchement refusé (437208), zones et poignées (43806a, 43840d, 42e1e4), retournement et quart de tour (slot 3), taille (+ et −, poignées des bords), cordes et poulies (42ee68), courroies (42ed3f), fiches (438ea8), télécommande et explosifs (42f57b), pièces verrouillées, « dégager l'aire », palette du Labo (`labTypes`, `takeNew`). |
| `engine/program.ts` | `PartProgram` : fenêtre « programmer » (42ea57 → 4249f8, `PROG<type>.ITF`) des types 4, 27, 54, 58, 63, 71, 80, 81, 87, 96, 108, 137 ; choix lus dans `PROGPART.RES` (`parseProgramRows`), compteur du pistolet laser, réglettes de la balle programmable et du seau troué, boîtes et ballon refusés s'ils chevauchent. `Editor.program(pièce, lignes)`. |
| `engine/goals.ts` | `GoalTest` (436dc6 : zones, états, conditions « nombre », délai) et `SolvedCountdown` (30 images après le premier succès, 4359a4). |
| `engine/session.ts` | `Tim3Session` : édition / marche, Démarrer (copie de l'état d'édition), Arrêter (retour exact), puzzle réussi, sons des pièces (`drainEffects`), Labo (`LabSettings`, `labLevel`), `Progress` (clés `tim3:solved`, `tim3:last`, noms de puzzles du jeu seulement), `puzzleList` (156 puzzles, HH reportés) ; options `unlock` et `originalCount` pour reprendre une aire gardée. |
| `engine/save.ts` | Sauvegardes (D11) : `snapshotWorld` / `snapshotLab` (inverse de `World.addFromLev`, un monde en édition → enregistrements de LEV), `parse*` (valeur inconnue → `null`), machines du Labo (`labSaveSlots`, `saveMachine`, `loadMachine`), `EditStore` (état d'édition). |
| `engine/solution.ts` | « Montrer la solution » (ampoule) : `designerSolution` verrouille à leur place les pièces du bac sans le bit 0x100 (leurres et liens vers un leurre exclus), `solutionSession` les déverrouille (`unlock`). |
| `ui/toolbar.ts` | Barre du haut sans DOM : `toolbarStates` (boutons montrés, enfoncés, grisés selon le mode, 418b78), `toolbarDecision` (clic et confirmation, 418ded), `interfaceText` (texte de `INTRFACE.RES` par identifiant). |
| `ui/play.ts` | `PlayScreen` : pointeur et clavier → éditeur et session ; image 640×480 (aire, bac, poignées, pièce tenue, lien élastique, indice). |
| `ui/menus.ts` | Fenêtres du jeu. Sur `.ITF` (`ui/itf-dialog.ts`) : messages et confirmations (`genericDialog`, `confirmDialog`, `messageDialog` sur GENERIC), puzzle réussi (`solvedDialog` sur PUZZSOLV). Encore en DOM : choix du puzzle, options (voix, musique), machines du Labo (bouton disque : 10 emplacements, nom, Sauvegarder au Labo / Charger / Effacer, « Remplacer » pour écraser), réglages du Labo, description d'une pièce, « programmer » (aperçu `PROGPART.ANM`, flèches ▲ ▼, réglettes, libellés et refus lus dans `INTRFACE.RES`). |
| `ui/itf-dialog.ts` | Fenêtre `.ITF` (D7) : canvas transparent de 640×480 posé sur celui du jeu (dessin `render/itf-draw.ts`), calque de `<button>` transparents aux rectangles des contrôles (positions en % : suit l'échelle), `role="dialog"` titré, textes en `tim3-sr`. `ItfDialogModel` (sans DOM, testé) : appui / glisser / relâché sur les rectangles, bouton enfoncé, grisés, Échap. |
| `ui/app.ts` | Montage (`mountGameShell`), chargement des volumes, son, pas de 32 ms (`TickScheduler`), professeur (but et indices, voix). |
| `ui/dev.html`, `ui/dev.ts` | Page de développement (`tim3-dev` dans `.claude/launch.json`, port 5283, `/src/games/tim3/ui/dev.html?puzzle=TLEV1`). |

## Barre d'outils (418b78, 418ded)

- Jeu : Puzzle enfoncé ; deux joueurs, manuel, visite guidée, inscription grisés (palette atténuée, `RenderAssets.fadeTable` :
  l'ANM n'a que « relâché » et « enfoncé », le jeu cache ses boutons sans jamais les griser) ; cadenas et levier d'essai cachés ;
  ampoule à x = 540 si le puzzle est résolu (`Progress`), sinon vide.
- Labo : clé enfoncée ; cadenas, levier d'essai et indices (éditeur d'indices 41f3dc) grisés ; pas d'ampoule.
- Clics : Puzzle sans effet en Jeu, depuis le Labo 31397 puis le dernier puzzle ; clé 31398 puis le Labo ; balayette sans
  question en Jeu (43252d), 31134 au Labo si l'aire n'est pas vide ; ampoule 31125 puis la solution du concepteur ; bouton grisé :
  « non disponible » du jeu. Écart : le jeu montre 31134 au lieu de 31397 en quittant un Labo modifié (`[0x477950]`), le port
  garde la machine du Labo (D11), donc pas d'avertissement de perte.
- Infobulles : `DESCRIPT.RES`, suivi de « (non disponible) » pour un bouton grisé ; survol (600 ms) ou appui long au doigt.
- Indices : le jeu montre ou cache **tous** les indices d'un coup (4204cf, 420536 : une fenêtre par indice, « Ce puzzle n'a pas
  d'indices. » en boîte) ; le port les montre encore un par un dans la barre du but (affichage simultané et voix non établis).
- Pas de calque accessible sur le canvas : `aria-pressed` / `aria-disabled` ne s'appliquent pas ; les actions principales sont
  aussi dans la barre DOM du pied de page.

## Entrées

- Souris et doigt passent par `bindCanvasPointer` (coordonnées logiques, capture, appui long). Pas de `PointerQueue` :
  l'éditeur traite chaque appui à sa position exacte (`PlayScreen.pointerDown(x, y)`), il ne relit pas un curseur une fois
  par image comme les moteurs de Lure ou Drascula, donc le retard du toucher n'apporte rien ici.
- Glisser-déposer unifié (D8) : prendre, glisser, lâcher ; un appui sans glisser garde la pièce en main (deux clics de
  l'original). Au doigt : pièce tenue 40 px au-dessus du doigt, premier appui sur une pièce posée = sélection (poignées),
  appui long dans le bac = description.
- Clavier (42f63c) : X, Y, + ou =, −, Suppr, Échap.
- Les fenêtres DOM sont des boutons et des champs natifs : souris, toucher et clavier (Tab gardé dans la fenêtre, Échap).
- Fenêtres `.ITF` : souris et doigt passent par les rectangles (le bouton se dessine enfoncé tant que le pointeur reste dessus,
  il agit au relâchement) ; les boutons transparents ne prennent pas le pointeur et servent au clavier (Tab gardé, Entrée,
  Espace, contour de focus en CSS) et aux lecteurs d'écran. Entrée par défaut et Échap suivent 450d44 (drapeaux 0x10 et 0x20).

## Fenêtres GENERIC et PUZZSOLV (D7, phase 1)

- **GENERIC** (422267) : texte dans `GENERIC_TEXT`, un ou deux boutons dont les libellés sont des identifiants de `INTRFACE.RES`
  (Oui 31114 / Non 31115, OK 31107). Bouton seul : le second est caché, le premier centré sous le cadre (42253a). Le titre
  (2393 « Message » par défaut) allait dans la barre de titre Windows : le port ne le dessine pas, il titre le `role="dialog"`.
  Passent par GENERIC : confirmations de la barre d'outils (31397, 31398, 31125, 31134), remplacement de l'aire du Labo par une
  machine, et les messages « pas d'indices », « Labo seulement », « non disponible », « machine illisible ».
- **PUZZSOLV** (4260f0) : « Même Puzzle » (ne fait rien), « Rejouer la Solution » (relance la machine du joueur : à la victoire,
  la session est déjà revenue à l'état d'avant « Démarrer »), « Puzzle Suivant » (grisé s'il n'y en a pas, focus à l'ouverture).
  Son 0xE21 18 pas après l'ouverture (4261df, 426234). Écart : Échap ferme comme « Même Puzzle » (le jeu le donne à « Rejouer »).
  Fin de catégorie : le texte de `BINSOLVE.RES` passe par GENERIC avant PUZZSOLV, en attendant `BINSOLVE.ITF`.
- Fenêtre centrée sur l'écran 640×480 (le jeu ouvre chaque `.ITF` dans une fenêtre Windows) ; la partie reste en pause dessous.

## Sauvegardes (vague S, D11)

- **Progression** : `tim3:solved`, `tim3:last` (`Progress`).
- **Machines du Labo** : `tim3:slot01` … `slot10` (`SaveSlots`), `{ savedAt, save: { version: 1, name, machine } }` ; `machine` reprend
  les champs d'un LEV (`gravity`, `pressure`, `music`, `background`, `fixedParts`, `movingParts` de `data/lev.ts`) plus `placed`
  (index des pièces que le joueur peut déplacer : tout ce qui est posé est écrit « verrouillé » pour que `World.loadLevel` ne le
  range pas au bac, `SessionOptions.unlock` le déverrouille). Version inconnue, JSON cassé ou champ invalide : emplacement
  vide, jamais d'exception. Nom : 1 à 32 caractères ; emplacement plein : confirmation (`saveMachine(..., replace)`).
- **Puzzle en cours** : `tim3:edit:<puzzle>` (`fixedParts`, `movingParts` y compris le bac, `placed`) et `tim3:edit:lab`. Gardé
  par `persistEdit` (`ui/app.ts`) au relâchement du pointeur, aux touches, à la fermeture d'une fenêtre, avant de changer de
  puzzle, avant « Démarrer », à `pagehide` et quand l'onglet se masque ; jamais en marche, donc c'est l'état d'avant « Démarrer ».
  Un puzzle sans pièce posée n'a pas d'entrée. Les index du LEV d'origine sont gardés (les conditions de victoire s'y rapportent).
- Écarts : l'ordre d'insertion dans les listes (égalités de masse et de position) peut différer de celui d'une pose à la main ; une
  pièce tenue ou en cours de pose (corde tendue à moitié) n'est pas gardée comme telle (elle retourne au bac).

## Son

`Tim3Audio` (`audio/audio.ts`) : `enterPuzzle(music)` à l'entrée d'un puzzle ou du Labo, voix du but et des indices
(`goalVoice`, `hintVoice`), sons de l'éditeur (prise / pose 0xE1B, retrait 0xE1A). En marche, `drainEffects` rend dans l'ordre
les sons des handlers (`World.sound` / `stopSound`, crochets `onSound` / `onStopSound` posés par la session) puis les
commandes `sound` / `soundEx` des images d'ANM qui viennent de changer ; `stop` → `stopEffect`. `stopEffects()` à l'arrêt de
la machine et au puzzle réussi (ambiances en boucle). La file `World.sounds` est vidée après chaque pas.

## Vérification sans navigateur

`npx vitest run test/tim3/editor test/tim3/ui` (moins d'une seconde ; `test/tim3/ui` : barre d'outils) : éditeur, session, Labo, conditions de victoire, progression, `save.test.ts` (sauvegardes : aller-retour, reprise après
rechargement, données corrompues, emplacement plein, nom vide, quinze solutions reprises et résolues au même pas), et
`solution.test.ts` (ampoule : solution du concepteur posée, `TIM3_SOLUTION_ALL=1` pour les 156 : toutes résolues, HLEV9 17 pas avant le banc), `program.test.ts` et `replay.test.ts`, qui rejoue quinze solutions du concepteur **par l'API de l'éditeur** (`replay.ts` : prendre au bac, retourner,
étirer, tourner, poser, tendre courroies et cordes, brancher, programmer) puis vérifie la victoire au pas du banc + 30.
`TIM3_REPLAY_ALL=1 TIM3_REPLAY_REPORT=<fichier>` les rejoue toutes (1,5 s) : **156 / 156 résolues**, 151 au pas du banc ;
HLEV6, 7, 9, 10 et 17 finissent de 1 à 15 pas à côté, parce que les pièces posées à la main entrent dans les listes une à
une (4393e0) et non dans l'ordre du LEV que lit le banc. `program.test.ts` couvre les types sans solution (87, 71, 58, 80).

## Écarts et manques

- Fenêtre « programmer » : aperçu fixe (première image de l'état de `PROGPART.ANM`, l'exe l'anime) ; fermer sans
  « Terminé » remet une boîte ou un ballon dans leur état d'avant (l'exe les laisse, chevauchement compris). Types 127 et
  136 : du code dans 424ce1 mais pas d'écran `PROG<type>.ITF`, non portés.
- Tuyau 97 : étiré par ses poignées, le slot 4 lit la poignée tenue (`World.resizeHandle` = 0x8003 … 0x8006, 42fb4a) et met
  l'autre côté à 38 px.
- Explosifs 0x37 rangés au bac avec leur télécommande au chargement (42f978) : le bac les montre ; à vérifier dans le jeu
  s'ils y sont visibles (le Labo ne les propose pas : absents de la table du bac).
- Professeur : texte du but et des indices, voix ; la fenêtre animée (`PROFSPCH.ANM`, synchro labiale) n'est pas dessinée.
- **Noyau (à reprendre hors de cette vague)** : `World.stowUnlocked` donne une boîte nulle aux pièces 11, 13, 21, 25 (+0x34 du
  type à 0) et appelle des slots non portés (pentes 43c62b / 43c5f6, murs 43ea14, 43e734) ; l'éditeur corrige les pièces du
  bac et traduit ces slots en repli. Les opérations de bac de `World` (42f978, 4395ba, 43909c, 4390ff, 438fe3) sont privées :
  l'éditeur les atteint par un transtypage (`core()`), une API publique serait plus propre.
