# The Incredible Machine 3 : interface et éditeur (vague U)

Ce qui se joue sans navigateur est dans `src/games/tim3/engine/` ; le DOM et le canvas dans `src/games/tim3/ui/`. Les textes
du site sont dans `src/games/tim3/copy.ts` ; ceux du jeu viennent de ses fichiers (`LEVELS.INF`, `INFO.RES`, `DESCRIPT.RES`,
`MUSIC.RES`, `BINSOLVE.RES`).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `engine/editor.ts` | `Editor` : bac, pièce tenue, pose sur la grille (42f24a), chevauchement refusé (437208), zones et poignées (43806a, 43840d, 42e1e4), retournement et quart de tour (slot 3), taille (+ et −, poignées des bords), cordes et poulies (42ee68), courroies (42ed3f), fiches (438ea8), télécommande et explosifs (42f57b), pièces verrouillées, « dégager l'aire », palette du Labo (`labTypes`, `stockLab`, `takeNew`), cadenas (`toggleLock`, `lockAll`), poignée « solution », décors au Labo. |
| `engine/bin-tabs.ts` | Onglets du bac au Labo (417264, 4187b5) : filtres des 14 familles, pièces des fêtes (43b06c). |
| `engine/lab-puzzle.ts` | `LabPuzzle` : le puzzle maison du Labo (but, 8 indices, conditions de réussite tenues par leurs pièces, délai), plages d'états de `SOLVE.RES` (429cb8, 429ef4). |
| `engine/program.ts` | `PartProgram` : fenêtre « programmer » (42ea57 → 4249f8, `PROG<type>.ITF`) des types 4, 27, 54, 58, 63, 71, 80, 81, 87, 96, 108, 137 ; choix lus dans `PROGPART.RES` (`parseProgramRows`), compteur du pistolet laser, réglettes de la balle programmable et du seau troué, boîtes et ballon refusés s'ils chevauchent. `Editor.program(pièce, lignes)`. |
| `engine/goals.ts` | `GoalTest` (436dc6 : zones, états, conditions « nombre », délai) et `SolvedCountdown` (30 images après le premier succès, 4359a4). |
| `engine/session.ts` | `Tim3Session` : édition / marche, Démarrer (copie de l'état d'édition), Arrêter (retour exact), puzzle réussi, sons des pièces (`drainEffects`), Labo (`LabSettings`, `labLevel`), `Progress` (clés `tim3:solved` : puzzles solo et HH, `tim3:last` : solo), `puzzleList` (156 puzzles solo), `duelPuzzleList` (50 HH, catégorie 5), `SessionOptions.guard` (règle du tour à deux joueurs, suivie à l'arrêt de la machine) ; options `unlock` et `originalCount` pour reprendre une aire gardée. |
| `engine/duel.ts` | Mode à deux joueurs (mode 2) : réglages (`stepGames`, `stepTime`), `DuelTurn` (règle du tour, `EditGuard` de l'éditeur : 417190, 41715f, 42ebba, 4301cb, 43013e), `Duel` (tour, chronomètre, manches, fins de manche 419803 / 41d827), `nextDuelPuzzle` (42cbad(5)). |
| `ui/duel-window.ts`, `render/duel-board.ts` | Fenêtre des réglages (`HEDTOHED.ITF`, 41d15c) ; tableau des joueurs (`H2H.ITF`, 414670, 414a93, 41495b). |
| `engine/players.ts` | Registre des joueurs (`SIGNIN.ITF`, fichiers `TIM.SAV`, `tim01.sav` … `tim100.sav`) : `PlayerRegistry` (invité, inscription, stockage de chaque joueur `p<n>:`), `migratePlayers` (progression d'avant vers l'invité), `signInDecision` (426877). |
| `engine/walkthrough.ts` | Visite guidée du Labo (mode 6) : `Walkthrough` (masques `done`, `visited`, `have` : 41eaaa, 41dce4), `walkFacts` (41edd7), lignes et voix de `PROFESOR.RES` / `PROFESOR.VOC`. |
| `ui/signin-window.ts` | Écran d'inscription (`SIGNIN.ITF`, 426b53). |
| `engine/save.ts` | Sauvegardes (D11) : `snapshotWorld` / `snapshotLab` (inverse de `World.addFromLev`, un monde en édition → enregistrements de LEV), `parse*` (valeur inconnue → `null`), machines du Labo (`labSaveSlots`, `saveMachine`, `loadMachine`, version 2 et `migrateLabMachine`), niveau à jouer d'une machine (`puzzleLevel`), `EditStore` (état d'édition). |
| `engine/solution.ts` | « Montrer la solution » (ampoule) : `designerSolution` verrouille à leur place les pièces du bac sans le bit 0x100 (leurres et liens vers un leurre exclus), `solutionSession` les déverrouille (`unlock`). |
| `ui/toolbar.ts` | Barre du haut sans DOM : `toolbarStates` (boutons montrés, enfoncés, grisés selon le mode, 418b78), `toolbarDecision` (clic et confirmation, 418ded), `interfaceText` (texte de `INTRFACE.RES` par identifiant). |
| `ui/play.ts` | `PlayScreen` : pointeur et clavier → éditeur et session ; image 640×480 (aire, bac, poignées, pièce tenue, lien élastique, indice). |
| `ui/menus.ts` | Fenêtres GENERIC (`genericWindow`, `genericDialog`, `confirmDialog`, `messageDialog`) et PUZZSOLV (`solvedWindow`, `solvedDialog`). |
| `ui/itf-window.ts` | **Hôte unique des fenêtres `.ITF`** (D7), fenêtres surgissantes comme écrans pleins du parcours d'entrée : canvas transparent de 640×480 posé sur celui du jeu (dessin `render/itf-draw.ts`), calque d'éléments transparents aux rectangles, dans l'ordre de lecture (positions en % : suit l'échelle) : `<button>` (boutons, flèches, interrupteurs avec `aria-pressed`, zones de l'appelant ; grisés `disabled`, ou `aria-disabled` et « (non disponible) » avec `greyedActive`), `role="slider"` (réglettes), `role="listbox"` (liste `ScrollList`), `<input>` (saisie DR_TITLE) ; `role="dialog"` titré, textes et état (`role="status"`) en `tim3-sr`. `ItfWindow` (sans DOM, testé) : appui / glisser / relâché, survol et focus (bouton actif : la dernière des deux actions), flèches animées et répétées (44ee9d), réglettes (425a46, 41cf20), liste, passes de 50 ms (`pass`, `tick`), survol animé (`hoverAnimate`), dessin propre (`decorate`), animation à cadence propre (`frame`), Échap, éléments du calque et leurs noms (`controls`). `choose` rend `true` pour garder la fenêtre ouverte ; `ItfScreen` + `screenOptions` : écran qui rend un résultat. |
| `ui/info-window.ts` | Description d'une pièce (`INFO.ITF`, 420c14). |
| `ui/program-window.ts` | « Programmer » (`PROG<type>.ITF`, 425147), sur `engine/program.ts`. |
| `ui/globe-window.ts` | Globe (`GRAVITY.ITF`, 41cbdc). |
| `ui/musicbox-window.ts` | Guitare (`MUSICBOX.ITF`, 4234ec), plus la bande « Voix du professeur » du site. |
| `ui/binsolve-window.ts` | Fin de catégorie (`BINSOLVE.ITF`, 419c9c), par-dessus PUZZSOLV. |
| `ui/hint-window.ts` | Un indice (`HINT.ITF`, 41f3dc) ; au Labo, l'éditeur d'indices (`hintEditorWindow`). |
| `ui/lock-window.ts` | Cadenas du Labo (`HTLOCK.ITF`, 420810). |
| `ui/solve-window.ts` | Conditions de réussite d'une pièce (`SOLVE.ITF`, 426d1c). |
| `ui/goal-editor.ts` | But du puzzle maison écrit dans la barre du but au Labo (414fc1). |
| `ui/professor.ts` | `Professor` (sans DOM) : le professeur animé de `HELP.ITF` et `BINSOLVE.ITF` (423e50, 4241ae, 424089, 42452c), attente `PROFAMBT.ANM`, parole `PROFSPCH.ANM` synchronisée sur `mouth()`. |
| `ui/help-window.ts` | Aide du professeur (`HELP.ITF`, 41d9a3, 41db2d, 41e567). Textes et voix : `data/help.ts` (`HelpTable`, 41e7e7). Fenêtre de la visite guidée (`walkthroughWindow`, 41eaaa) : même texte défilant et même professeur. |
| `ui/machines-window.ts` | Machines du Labo : `LOADSAVE.ITF` (42289c) puis la liste `DOSBOX.ITF` des dix emplacements. |
| `ui/intro.ts` | `IntroPlayer` : logo Sierra et titre animé, sans DOM (surface et palette propres, sons des images, passage). |
| `ui/main-menu.ts`, `ui/credits.ts`, `ui/chooser.ts` | Écrans de `itf-window.ts` : `MainMenuScreen` (`MAINMENU`, `quitMainMenu`), `CreditsScreen` (`CREDITS`), `PuzzleListScreen` (`DOSBOX`), `BinScreen` (`DOSBIN`), `PuzzleCardScreen` (`PUZZDISP`), `currentPuzzle` (42cbad). |
| `render/front.ts`, `render/itf-list.ts` | Dessin de l'intro (palettes, sons des images) et des crédits ; liste à défilement de `DOSBOX` (41bf29) et son état `ScrollList` (choix du puzzle et machines du Labo). |
| `ui/app.ts` | Montage (`mountGameShell`), chargement des volumes, son, pas de 32 ms (`TickScheduler`), professeur (but et indices, voix). |
| `ui/dev.html`, `ui/dev.ts` | Page de développement (`tim3-dev` dans `.claude/launch.json`, port 5283, `/src/games/tim3/ui/dev.html?puzzle=TLEV1`). |

## Barre d'outils (418b78, 418ded)

- Deux joueurs (mode 2, 418cc4) : la barre du Jeu, chat et Tim enfoncés, « Terminer le Tour » (`TB_END_TURN`, 56 × 28 en x = 522), pas
  d'ampoule. Chat et Tim depuis le Jeu, le Labo ou l'essai : 31399 puis la fenêtre des réglages (4195bd) ; Puzzle (31397) et clé (31398)
  quittent le match.
- Jeu : Puzzle enfoncé ; cadenas et levier d'essai cachés ; ampoule à x = 540 si le puzzle est résolu (`Progress`), sinon vide. Aucun
  bouton grisé : tous les modes sont portés (le jeu cache ses boutons sans jamais les griser ; `RenderAssets.fadeTable` reste pour un
  bouton non porté).
- Visite guidée (mode 6, 418c34) : la barre du Labo sans disquette, main, cadenas ni levier d'essai ; à x = 540, le portrait du
  professeur (`TB_WALKTHROUGH`, état 17) rouvre la fenêtre de la visite (41922f → 41d8e8(0)) ; chaussure enfoncée (4189bc(35013)).
- Feuille et stylo (419683) : 31401 « Êtes-vous sûr de vouloir entrer votre nom? », puis l'inscription et le menu principal.
  Chaussure (419712) : rien dans la visite ; ailleurs 31400 « Êtes-vous sûr de vouloir participer à la visite guidée du Professeur
  Tim? », puis la visite. Dans la visite, Puzzle, clé, chat et Tim, feuille et stylo demandent 31134 si l'aire n'est pas vide (sa
  machine est perdue, `[0x477950]` en mode 6 : 41948e, 419538, 4195e5, 41969e).
- Labo : clé enfoncée ; cadenas (`HTLOCK`), levier d'essai et main (éditeur d'indices 41f3dc) actifs ; pas d'ampoule (§ Outils du Labo).
- Essai (mode 8, 418ca4) : les boutons du Labo, levier d'essai enfoncé (418d91) ; chaque bouton qui touche à la machine termine d'abord
  l'essai (418e7f, 418ed1, 41928e, 41930e, 419360, 41923c), la main et le levier ne font que cela ; aide et drapeau gardent l'essai.
- Disquette : en Jeu, le choix du puzzle (`DOSBOX`, 418f2c) ; au Labo, les machines du Labo.
- Clics : Puzzle sans effet en Jeu, depuis le Labo 31397 puis le dernier puzzle ; clé 31398 puis le Labo ; balayette sans
  question en Jeu (43252d), 31134 au Labo si l'aire n'est pas vide ; ampoule 31125 puis la solution du concepteur. Écart : le jeu montre 31134 au lieu de 31397 en quittant un Labo modifié (`[0x477950]`), le port
  garde la machine du Labo (D11), donc pas d'avertissement de perte.
- Infobulles : `DESCRIPT.RES`, suivi de « (non disponible) » pour un bouton grisé ; survol (600 ms) ou appui long au doigt.
- Indices (main) : voir § Fenêtres de la vague F.
- Aide (« ? », 41907f) : fenêtre du professeur, puis mode aide (§ Aide du professeur).
- Pas de calque accessible sur le canvas : `aria-pressed` / `aria-disabled` ne s'appliquent pas ; les actions principales sont
  aussi dans la barre DOM du pied de page.

## Entrées

- Souris et doigt passent par `bindCanvasPointer` (coordonnées logiques, capture, appui long). Pas de `PointerQueue` :
  l'éditeur traite chaque appui à sa position exacte (`PlayScreen.pointerDown(x, y)`), il ne relit pas un curseur une fois
  par image comme les moteurs de Lure ou Drascula, donc le retard du toucher n'apporte rien ici.
- Glisser-déposer unifié (D8) : prendre, glisser, lâcher ; un appui sans glisser garde la pièce en main (deux clics de
  l'original). Au doigt : pièce tenue 40 px au-dessus du doigt (sauf corde et courroie) ; l'original pose la pièce quand la
  fenêtre sous le pointeur est l'aire (42ebba → 43b047 → 42f24a), sinon l'appui la rend au bac (42f978) : au doigt, c'est le
  point soulevé qui doit être sur l'aire, pas le doigt (`PlayScreen.heldTarget`), pour poser au ras du sol le doigt sur la
  barre du but (tremplin de TLEV17, qui revenait au bac) ; un doigt à moins de 40 px du haut de l'aire vise la barre
  d'outils et rend la pièce au bac, comme la souris. Premier appui sur une pièce posée = sélection (poignées),
  appui long dans le bac = description. Bac : flèches gauche et droite d'une colonne à la fois (pas de molette dans
  l'original ni dans le port, pas de glisser pour faire défiler : un appui sur une case prend la pièce).
- Clavier (42f63c) : X, Y, + ou =, −, Suppr, Échap.
- Les fenêtres DOM sont des boutons et des champs natifs : souris, toucher et clavier (Tab gardé dans la fenêtre, Échap).
- Fenêtres `.ITF` : souris et doigt passent par les rectangles (le bouton se dessine enfoncé tant que le pointeur reste dessus,
  il agit au relâchement) ; les boutons transparents ne prennent pas le pointeur et servent au clavier (Tab gardé, Entrée,
  Espace, contour de focus en CSS) et aux lecteurs d'écran. Entrée par défaut et Échap suivent 450d44 (drapeaux 0x10 et 0x20).

## Parcours d'entrée (vague F, lu dans TIMWIN.EXE)

Lancement (43b112) : 42a284 (palettes et fenêtre du titre), 42a3c2 (logo) ; s'il n'a pas été passé, 42a590 (titre) ; s'il n'a pas
été passé non plus, 419e88 (crédits) ; puis musique 1000 (43b194) et menu principal. **Pas d'option** : le jeu joue l'intro à chaque
lancement ; le port aussi, à chaque clic sur « Jouer » (la page de dev avec `?puzzle=` ouvre le puzzle directement).

- **Cadence** : 43b6aa(n) avance une échéance de n × 16 ms (410fa4) ; les animations de l'intro font 43b6aa(3), une image toutes les
  48 ms. Les images d'ANM se dessinent les unes sur les autres sans effacer ; leurs commandes `sound` / `soundEx` sont jouées au dessin
  (44b548).
- **Logo** (42a3c2) : `SIERRA.BMP` à la palette `SIERRA.PAL`, deux attentes de 16 ms, l'air `SX_3400.WAV` (0xD48, 13,3 s). La boucle
  n'avance l'animation que si 4116f5(0xD48) rend 0, c'est-à-dire **une fois l'air fini** (4116f5 → 449bd4 : « en cours » =
  `sosDIGISampleDone` faux ; 43588a s'en sert de même pour la voix 6000). Puis les images 1 à 75 de `SIERRA.ANM` (Jeff Tunnell
  Productions, avec leurs sons 3454, 3617, 3616), l'air est coupé (41151e). `SIERRA00…17.PAL` : jamais chargées (42a3c8 écrit « 13 »
  dans le nom `SIERRA##.PAL` sans s'en servir) ; pas de fondu par palettes.
- **Titre** (42a590) : palette `TTLDARK.PAL`, `TITLE.BMP`, image 0 de `TITLE2.ANM` en y = 377, 48 ms, musique 1000 (`[0x481390]`),
  48 ms, puis les 360 images de `TITLE.ANM` ; à l'image qui ouvre l'état 5, palette `TTLLITE.PAL` (l'ampoule s'allume) ; la dernière
  image reste 60 tours (2,9 s). `TTLMED.PAL` et `TITLE.PAL` ne sont pas posées.
- **Passer** : bouton de la souris (`[0x490084] | [0x490088]`, bit 2) ou touche (`[0x490074]`) pendant le logo ou le titre ; le jeu attend
  ensuite le relâché. Passer le logo saute titre et crédits ; passer le titre saute les crédits. Port : clic, toucher ou touche.
- **Crédits** (419e88, `CREDITS.ITF`) : lignes de `CREDITS.RES` (chaîne 0x32C9 + n) qui montent dans `CR_WINDOW` (41a121) : départ à
  40 pixels, pas (41a0a5) = (ms écoulées × 38) / 1000 entre 1 et 8, police `goalfont.PFT` ([0x481050]), lignes centrées, « _ » titre
  souligné (interligne 6), « - » début de titre (souligné, interligne 4), autre ligne interligne 4, hauteur 12 ; fondu sur 20 pixels en
  haut et 12 en bas (couleurs 0x472660 : titres 14, 10, 2, 9 ; soulignés 11, 3, 3, 9 ; texte 15, 11, 3, 9). Mains `CREDITS.ANM` (une
  image par tour, 41a36b). Plus aucune ligne visible : fermeture comme « Terminé » (41a054). Le menu principal n'a pas de bouton
  Crédits (seul le contrôle 10000 de `CNTRLPNL.ITF`, panneau absent de la version Windows, les rejoue : 422fc9).
- **Menu principal** (422b70, `MAINMENU.ITF`) : boucle de 50 ms (422c1b) ; bande `MM_TEXT` = texte `DESCRIPT.RES` du contrôle survolé
  + 100 (4233a3, 423473 : `SYS12.PFT`, couleur 15, drapeaux 0x302). Le choix ferme le menu puis 422e31(choix + 10000) : Jeu → puzzle en
  cours (42cbad(−1)) puis `PUZZDISP` ; Labo ; Duel, Inscription, Exercice (mode 6) ; Manuel on-line (4169c8(0)) ; Aide (4169c8(10)) ;
  Options (42aa60) ; Quitter → 31113 Oui / Non (422f00). Inscription : 422f3d vérifie qu'on peut écrire `SIGNIN.RES` (sinon 31207),
puis 423313 → 426b53 et le menu principal ; Exercice : 42332c (mode 6, Labo vide), puis 422b65 ouvre la fenêtre de la visite. Entrée : Jeu ; Échap : Quitter (450d44). Dans le jeu, le menu principal
  revient par « Zones > Menu principal » du menu Windows (ressource TIM2MENUF), pas par la barre d'outils.
- **Puzzle en cours** (42cbad(−1)) : à partir du dernier joué, premier non résolu de sa catégorie (jusqu'à la fin puis depuis le
  début), sinon premier non résolu du jeu, sinon le dernier joué.
- **Choix du puzzle** : disquette en Jeu (418f2c) ou « Fichier > Ouvrir » → 41acf0(1) : **`DOSBOX` d'abord**, liste de la catégorie
  en cours (41b75b ; rangée « * » si résolu, 41bb87 ; « %2d. » + titre du LEV), dessinée par 41bf29 (`render/itf-list.ts` : ampoule
  allumée, état 36 de `BUTTONS.ANM`, ou éteinte, état 35). Clic : rangée choisie (son 0xE1B) ; double clic ou « Lancer » : charge ;
  « Autres Puzzles » (`DR_BIN`) ouvre `DOSBIN` (41ae39, 41b649 : bac de la catégorie en cours au focus, table 0x4726d4) puis revient à
  `DOSBOX` sur la catégorie choisie ; « Avancé » : sélecteur de fichiers Windows (42a088). Après chargement : `PUZZDISP` (425d20 :
  catégorie 31048 + n, « %Fs %d » de 2064, titre, icône seule de la catégorie, musique du puzzle relancée du début, voix du but
  18 passes après, **pendant la fiche**, si `[0x480370]` vaut « E » ; OK la coupe et relance la musique : `audio.md` § Enchaînement).

Écarts du port :
- Duel : la fenêtre des deux joueurs (§ Deux joueurs). Inscription, Exercice : § Inscription, § Visite guidée ; Manuel
  ouvre l'aide du site ; Aide (4169c8(10) : rubrique du manuel Windows `TIMHELP.EXE`) ouvre l'aide du professeur par-dessus le menu
  (§ Aide du professeur) ; Quitter pose toujours la question 31113, puis revient à l'accueil du site (sur la page de dev : le jeu
  repart). Options : la guitare (`MUSICBOX`). Bande `MM_TEXT` : seuls les six modes ont un texte « contrôle + 100 » ; pour Aide,
  Options, Quitter et hors des boutons, elle est vide (4233a3 ne trouve rien, 423473 ne dessine rien). Le focus du clavier tient lieu
  de survol : la bande suit la dernière des deux actions.
- `DOSBIN` : Deux joueurs actif (en Jeu, un puzzle HH se joue seul, comme dans l'exe : sans BINSOLVE, 4261a7 ; « Puzzle Suivant » : le HH
  suivant non résolu) ; « Avancé » grisé. Maison (`DB_USER`, « Puzzles Personnels ») : les machines du Labo qui ont
  un but (§ Outils du Labo), au lieu des fichiers LEV du répertoire des puzzles personnels ; sans aucune, un message du site (le jeu
  dit « Le répertoire ne contient aucun puzzle », 31184). Le titre et son champ de `DOSBOX` ne servent qu'à « Enregistrer sous » (Labo) :
  cachés, comme le fait l'exe en chargement.
- Rangée choisie à l'ouverture de `DOSBOX` : le puzzle en cours ; après un changement de catégorie, le premier non résolu (41c861 non
  lu). Double clic : deux appuis sur la même rangée en moins de 500 ms (au doigt aussi). Flèches : comme toutes les flèches `.ITF`
  (44ee9d), une rangée à la fin de leur animation, répétée bouton tenu.
- `PUZZDISP` s'ouvre aussi à « Puzzle Suivant » de PUZZSOLV et à la pièce de puzzle depuis le Labo (419bc3, 419c46 l'appellent après
  un chargement ; supposé). La voix du but part à l'ouverture du puzzle, pas 18 tours après.
- Animation des images au survol (menu principal, bacs) : une image par passe de 50 ms, du bouton actif (4506f4 n'a pas été suivi
  jusqu'au bout) ; tour des crédits supposé de 48 ms (cadence de la fenêtre modale non lue), soit 1 pixel par tour.
- Pas de bouton « Puzzles » sous l'écran : le choix passe par la disquette, comme dans le jeu. « Menu principal » sous l'écran tient
  lieu du menu Windows « Zones ».
- Hôte : le même que celui des fenêtres (`openItfWindow`) ; les boutons à texte y font aussi le son 0xE1B à l'appui (421f5a).

## Fenêtres GENERIC et PUZZSOLV (D7, phase 1)

- **GENERIC** (422267) : texte dans `GENERIC_TEXT`, un ou deux boutons dont les libellés sont des identifiants de `INTRFACE.RES`
  (Oui 31114 / Non 31115, OK 31107). Bouton seul : le second est caché, le premier centré sous le cadre (42253a). Le titre
  (2393 « Message » par défaut) allait dans la barre de titre Windows : le port ne le dessine pas, il titre le `role="dialog"`.
  Passent par GENERIC : confirmations de la barre d'outils (31397, 31398, 31125, 31134), remplacement de l'aire du Labo par une
  machine, et les messages « pas d'indices », « Labo seulement », « non disponible », « machine illisible ».
- **PUZZSOLV** (4260f0) : « Même Puzzle » (ne fait rien), « Rejouer la Solution » (relance la machine du joueur : à la victoire,
  la session est déjà revenue à l'état d'avant « Démarrer »), « Puzzle Suivant » (grisé s'il n'y en a pas, focus à l'ouverture).
  Son 0xE21 18 pas après l'ouverture (4261df, 426234). Écart : Échap ferme comme « Même Puzzle » (le jeu le donne à « Rejouer »).
  Fin de catégorie : `BINSOLVE.ITF` par-dessus (§ suivant).
- Fenêtre centrée sur l'écran 640×480 (le jeu ouvre chaque `.ITF` dans une fenêtre Windows) ; la partie reste en pause dessous.

## Fenêtres de la vague F (lu dans TIMWIN.EXE)

Rendus de contrôle (PNG) faits hors dépôt ; adresses et formules dans les en-têtes des fichiers `ui/*-window.ts`.

- **INFO** (420c14, procédure 420cc9, clics 420f77) : `INFO<type>.ANM` en boucle dans IN_PART, une image par passe (50 ms),
  centrée sur l'image 0 ; zone vide si le fichier manque (41, 49, 72, 110 à 115, 121 à 124, 127 à 135…). Titre (162) et
  description (161, `INFO.RES`). Texte court : ▲ ▼ cachés ; sinon le texte perd 27 pixels, ▼ avance d'une page (420ff7), ▲ revient
  du dernier pas (420faf). OK et Échap ferment ; 0xE1B à l'ouverture (41ea91). Remplace aussi la fiche d'une pièce sans écran
  « programmer ».
- **PROG<type>** (425147, 424ab0, 424ce1) : aperçu animé de `PROGPART.ANM` dans PP_WINDOW (4255b4 / 4256d9 : origine = centre −
  (148, 93), une image par passe, redessin au-delà de 2 images) ; compteur du pistolet laser (27) en `RMN8_40.PFT` sur fond 0x14 ;
  croix rouge tant qu'une boîte ou un ballon chevauche (425975), « Terminé » refusé par GENERIC 31342 / 31343 (bouton 31344), la
  fenêtre reste ouverte ; réglettes de la balle (0 à 10) et du seau (0 à 5) ; PP_HELP (`TIMHELP.EXE`) grisé ; Échap annule.
- **GRAVITY** (41cbdc, 41cc84, 41ce47, 41cf20, 41d0c4) : gravité 0 à 512, pression 0 à 128 (réglettes verticales, 0 en haut) ;
  couleur du décor 1 à 15 en boucle (◀ ▶), montrée en plein dans GP_WINDOW. **Jeu** : consultation, un appui sur une réglette
  donne GENERIC 31137 ; la couleur reste réglable (le jeu l'écrit dans le niveau en mémoire : `Tim3Session.setBackground`, jusqu'au
  prochain chargement). Écart : le jeu laisse les boutons aux positions de l'ITF en Jeu, le port les place sur les valeurs.
- **MUSICBOX** (4234ec, 423587, 423999), dans tous les modes et au menu principal : musique de `MUSIC.RES` (▲ précédente, ▼ suivante,
  en boucle, morceaux du CD 1007, 1005, 1014, 1015 sautés), départ 5 passes après le choix ; effets de `SOUND.RES` (joués au choix,
  rejoués par MB_SOUND) ; interrupteurs musique et effets (image 0 = marche) ; volume 0 à 15 par paliers {0, 3, 5, 8, 10, 13, 15}
  sur la musique et les effets, pas les voix (`Tim3Audio.volume`, `effectsEnabled`) ; musique et volume sont ceux du joueur courant
  (`tim3:p<n>:music`, `volume`, § Inscription), l'interrupteur des effets est commun (`tim3:effects`).
  Au Labo, le morceau choisi devient celui du Labo. **Ajout du site** : une bande sous le volume, « Voix du professeur », avec le
  même interrupteur (état 14 de `BUTTONS.ANM`) et un cadre de style 3 comme les trois autres ; la fenêtre grandit de 62 pixels.
  Écart : le jeu montre l'interrupteur des effets toujours sur « marche » à l'ouverture (4115e6(0, −1)), le port l'état réel.
- **BINSOLVE** (419c9c, appelé en 4261c3 pendant l'initialisation de PUZZSOLV) : seulement à la première résolution du puzzle qui
  termine une catégorie (coupe d'argent et bac de la catégorie, texte k de `BINSOLVE.RES`) ou tout le jeu (coupe d'or, tous les bacs,
  texte 5). BS_TEXT est dessiné bien que caché (4218d4 l'excepte). Professeur animé sans voix (419e2a → 423e50(32106, 0),
  `ui/professor.ts`), à la place établie par 424089 (§ Aide du professeur).
- **Indices** (41eeb0, 41ef54, 4204cf, 420536, 42013d) : la main de la barre montre ou cache **toutes** les mains des indices à la
  fois (`PlayScreen.toggleHints`) : image 41 (vers le bas, `flip` ≤ 1) ou 42 (vers le haut) de `HANDLES.BMP`, en miroir et 4 pixels
  plus à gauche si `flip` est impair, au coin d'un contrôle de 44 × 43 en (x, y) de l'emplacement LEV. Un clic sur une main ouvre
  `HINT.ITF` (41f3dc) avec son texte (le jeu y pose un contrôle EDIT Win32, le port la zone de texte de l'ITF) et la voix de
  **l'emplacement LEV** (`hintVoice(slot + 1, puzzle)`), jouée à l'ouverture (le jeu attend 14 messages, 424684), rejouée par un
  clic sur le professeur (41f926), arrêtée à la fermeture. Sans indice : GENERIC 31112. La barre du but garde le but.
- **LOADSAVE** (42289c, 422902), au Labo : Charger (14007), Sauvegarder (14005, défaut si l'aire n'est pas vide), Annuler.
  Sauvegarder sans pièce : 31209 ; Charger avec une aire non vide : 31134 d'abord. Puis **DOSBOX** (41aeaa, 41b078, 41bf29,
  41bd7f) : « Puzzles Personnels » (31054), les dix emplacements en rangées (« %2d. » et le nom, rangée choisie en 14,
  `render/itf-list.ts`), un clic choisit, un second valide ; ▲ ▼ font défiler d'une rangée (supposé) ; en sauvegarde, DR_LOAD
  devient « Sauvegarder » (31041) et DR_TITLE une saisie de 29 caractères. Emplacement plein : confirmation ; nom vide, stockage
  plein : message. Il n'y a plus d'« Effacer » (le jeu n'en a pas).
- Flèches (genre 5, 44ee9d) : l'image avance à chaque passe (50 ms, 412bec) ; au bout de l'état, la flèche agit, puis repart à
  l'image 1 si le bouton est tenu (PROGPART : toutes les 100 ms, flèches du globe : toutes les 450 ms). Au clavier, elle agit
  aussitôt. Boutons à texte : son 0xE1B à l'appui (421f5a).

## Aide du professeur (vague F, lu dans TIMWIN.EXE)

**Où le professeur apparaît.** Seules deux fenêtres le dessinent (appels de 423e50) : l'aide (`HELP.ITF`, 41e6a4) et la fin de
catégorie (`BINSOLVE.ITF`, 419e2a, sans voix) ; un troisième appel (42a8d7) sert à `TOUR.ITF` (démonstrations enregistrées, non
portées : § Visite guidée) ; la visite guidée du Labo passe par `HELP.ITF` (même fenêtre, voix de `PROFESOR.VOC`). À
l'ouverture d'un puzzle, `PUZZDISP` joue la voix du but sans professeur (425f6b → 424684) ; un indice a son propre portrait
(`HINTPROF.ANM`, animé tant que la voix dure, 4207a4).

**Animation** (`ui/professor.ts`) :
- 423e50(contrôle, voix) : charge `PROFAMBT.ANM` et `PROFSPCH.ANM`, coupe la voix en cours, prépare la voix ; le contrôle est animé à
  chaque passe de 50 ms (rappel 4241ae) et dessiné par 424089. Voix 4564 (`help/064`, manuel on-line) : rien, le contrôle garde son
  image d'ITF ; voix 4684 → 4000.
- Quatre passes (`[0x47fa00]`) au repos de la parole (corps état 5, bouche état 27), puis la voix part (424684).
- Parole : chaque passe applique les évènements de synchro passés (`mouth()`, table `0x472ba4` des bouches, `0x472b78` des gestes) ;
  sans nouveau geste, le corps avance d'une image et revient au début de l'état 5 à la fin de l'état. Fin de la voix (4116f5) ou de
  la synchro : 42452c enchaîne une fois la suite (63 → 184, 84 → 185, 87 → 186, 106 → 187), sinon ferme la bouche une passe, puis
  l'attente, voix coupée.
- Attente : état 32 de `PROFAMBT.ANM` ; au bout de 60 boucles (puis 40 + hasard % 80), un des 13 états de la table `0x472be4`
  (32, 32, 33, 34, 31, 15, 19, 30, 22, 23, 25, 26, 27), jamais le dernier tiré.
- Clic sur le professeur (hors des quatre passes) : la voix demandée repart. Appui sur un autre contrôle que ▲ ▼ : attente, voix
  coupée (sans effet dans le port : ces boutons ferment la fenêtre).
- Dessin (424089) : rectangle du contrôle rempli de la couleur logique 11 et découpé ; images **retournées de gauche à droite**
  (argument 1 de 44b094) à l'origine (x + `unknown12` − 396, y + `unknown14`) : dans `HELP.ITF` (376, 75), le professeur occupe
  x = 378 à 498 ; dans `BINSOLVE.ITF` (240, 37), x = 242 à 362. Cela remplace la position supposée de BINSOLVE (image centrée).

**Fenêtre** (`ui/help-window.ts`, 41d9a3, contenu 41e567, boutons 41dce4) : texte de `HELP.RES` dans HP_TEXT, ▲ ▼ d'une page à la
fois (41e52b, 41e4f3) ; texte court : flèches cachées, « Terminé » et « ? » 16 pixels plus à gauche (41e616). « ? » (HP_BHELP, défaut)
ferme et passe en mode aide ; « Terminé » (Échap) ferme. Titre, OK, Oui, Non, Annuler ne servent qu'à la visite guidée (41eaaa) :
cachés ici (§ Visite guidée). Fermeture (423f9d) : voix coupée.

**Mode aide** (41e6b7, 41e85c), après le « ? » de la barre (41907f → 41d8e8(23100) : « Salut! Professeur Tim… ») : curseur « ? »
(451718(5, 1), 10 sur un élément aidé) ; un appui (gauche ou droit) fait le son 0xE1B puis : bac (fenêtre à part : 11014), barre du
but (9000), sinon premier contrôle visible sous le pointeur qui a une aide, sinon une pièce posée → sa description (`INFO.ITF`,
41ea8b) **et le mode continue**, sinon « Je suis désolé… » (23200). L'aide trouvée s'ouvre dans la même fenêtre, dont le « ? » relance
le mode (41d991). Textes et voix : `data/help.ts` (41e7e7 : rang de la ligne = voix `help/<rang>`, alias 15019 → 13026, 9001 à 9999
sans aide).

Écarts du port :
- **Identifiants** : le `HELP.RES` français a ceux de l'ancien panneau (`CNTRLPNL`, 10002 à 11010) là où l'anglais a ceux de la barre
  Windows (35001 à 35022) ; le jeu français ne trouve donc pas l'aide des boutons de la barre. Le port cherche le rang par
  l'identifiant anglais (`ResourceIndex.base`), puis par le français, et prend le texte français de ce rang.
- Mode aide : la pièce tenue retourne au bac ; le panneau du bac du port a ses propres boutons (drapeau 11003, flèches 11001,
  11002), le reste du bac est 11014 ; un bouton grisé de la barre est aidé (le jeu le cache). Échap abandonne le mode (le jeu
  attend un clic) ; la consigne (« Aide : cliquez ou touchez… ») s'écrit dans la barre du but et pour les lecteurs d'écran : au
  doigt, il n'y a pas de curseur.
- Menu principal : son « ? » ouvre la même aide **par-dessus le menu**, qui reste ouvert ; le « ? » de la fenêtre passe le menu en mode
  aide (`ItfWindowOptions.helpMode`) : un appui désigne les contrôles sous le pointeur (le premier qui a une aide, `HELP.RES` a ceux
  du menu, 16001 à 16018), au clavier Entrée sur un bouton le désigne, Échap abandonne ; la bande `MM_TEXT` et la région d'état
  donnent la consigne.
- Accessibilité : la fenêtre est un `role="dialog"` de `itf-window.ts` ; le texte entier (même la partie défilée) est lu ; « ? »,
  « Terminé », ▲ ▼ et le professeur (« Réécouter le professeur ») sont des boutons du calque. L'animation tourne sur la passe de 50 ms
  de la fenêtre et ne bloque aucune action. Le mode aide de l'écran de jeu reste au pointeur (la barre d'outils n'a pas de calque).
- Les « ? » des fenêtres (choix du puzzle, bacs) ouvrent toujours l'aide du site (le jeu ouvre le manuel Windows).

## Sauvegardes (vague S, D11)

- **Progression**, par joueur (§ Inscription) : `tim3:p<n>:solved`, `tim3:p<n>:last` (`Progress`) ; puzzles maison résolus :
  `tim3:p<n>:homeSolved` (`HomeProgress`, « emplacement@date de sauvegarde » : une autre machine enregistrée au même emplacement repart
  non résolue).
- **Machines du Labo** : `tim3:slot01` … `slot10` (`SaveSlots`), `{ savedAt, save: { version: 2, name, machine } }` ; `machine` reprend
  les champs d'un LEV (`gravity`, `pressure`, `music`, `background`, `fixedParts`, `movingParts` de `data/lev.ts`) plus `placed`
  (index des pièces que le joueur peut déplacer : tout ce qui est posé est écrit « verrouillé » pour que `World.loadLevel` ne le
  range pas au bac, `SessionOptions.unlock` le déverrouille ; une pièce verrouillée au cadenas n'est pas dans `placed`), et depuis la
  **version 2** le puzzle maison : `goal`, `hints` (8 emplacements du LEV), `solution` (bloc solution du LEV : 8 conditions, index des
  pièces dans fixes puis mobiles, délai). Le nom est le titre du LEV. **Migration** : une machine de la version 1 se lit avec un puzzle
  vide (`migrateLabMachine`) et se réécrit en version 2 à la sauvegarde suivante. Version inconnue, JSON cassé ou champ invalide :
  emplacement vide, jamais d'exception. Nom : 1 à 32 caractères ; emplacement plein : confirmation (`saveMachine(..., replace)`).
- **Puzzle en cours**, par joueur : `tim3:p<n>:edit:<puzzle>` (`fixedParts`, `movingParts` y compris le bac, `placed` ; versions 1 et 2
  identiques) et `tim3:p<n>:edit:lab` (une machine, version 1 migrée comme ci-dessus). La machine de la visite guidée n'est jamais
  gardée. Pendant l'essai du Labo, c'est la machine d'avant l'essai qui est
  gardée ; l'aire d'un puzzle maison n'est pas gardée (sa machine peut être remplacée dans son emplacement). Gardé
  par `persistEdit` (`ui/app.ts`) au relâchement du pointeur, aux touches, à la fermeture d'une fenêtre, avant de changer de
  puzzle, avant « Démarrer », à `pagehide` et quand l'onglet se masque ; jamais en marche, donc c'est l'état d'avant « Démarrer ».
  Un puzzle sans pièce posée n'a pas d'entrée. Les index du LEV d'origine sont gardés (les conditions de victoire s'y rapportent).
- Écarts : l'ordre d'insertion dans les listes (égalités de masse et de position) peut différer de celui d'une pose à la main ; une
  pièce tenue ou en cours de pose (corde tendue à moitié) n'est pas gardée comme telle (elle retourne au bac).

## Outils du Labo (lu dans TIMWIN.EXE)

**Cadenas** (`ui/lock-window.ts`, `Editor.toggleLock`, `lockAll`). Au Labo, une pièce posée (hors décor) a une poignée de cadenas
(43806a : bit 0x10 ouvert, 0x400 fermé ; 42e1e4 : ouvert en haut à droite, image 14 de `HANDLES.ANM` ; fermé, image 13, à droite s'il
reste 18 px dans l'aire, sinon à gauche ; testée en premier par 43840d, zone 0x0B). Un appui (42e9d8, son 0xE1B) change +0x14 & 0x40, et
celui du partenaire d'une télécommande. Une pièce verrouillée n'offre plus que le cadenas et les infos : au Labo comme en Jeu, elle ne se
déplace plus. Le bouton `TB_LOCKED` ouvre `HTLOCK.ITF` (420810) : Verrouiller (4209e5 : toutes les pièces posées, mobiles puis fixes,
sauf décors et déjà verrouillées, puis 31132), Déverrouiller (420afc, puis 31133), Annuler. Quand on joue la machine (essai, Maison), les
pièces non verrouillées partent au bac (43252d hors des modes 1 et 6 → 43267a), les autres restent à leur place.

**Levier d'essai** (`TB_TEST`, 41908a ; mode 8). Le jeu écrit la machine dans un fichier temporaire (432607 ; échec : 31216) puis la
recharge en mode 8 (43252d) ; 31143 n'est montré qu'à la première entrée (`[0x481004]`). Le port garde la machine du Labo (`labTest`), et
joue `puzzleLevel(machine)` : pièces non verrouillées au bac, but, indices et conditions de la machine. Un second appui, ou un bouton qui
touche à la machine, recharge le Labo tel qu'avant l'essai (43252d(fichier, 1)). But atteint, en essai comme au Labo (419803 teste le but
dans les modes 1, 6 et 8) : GENERIC 31178 au lieu de PUZZSOLV.

**Indices** (`ui/hint-window.ts`, `PlayScreen`). La main de la barre ouvre `HINT.ITF` en éditeur (41f3dc, 41f668) : consigne 31259 (plus
31264 s'il y a des indices) en lecture seule ; Nouveau, Montrer (caché sans indice), Cacher (Échap), Aide. Nouveau (41fcdc) : 8 indices
déjà, 31265 ; sinon une main suit le pointeur jusqu'à un appui (42057e, gardée dans l'aire), puis la fenêtre revient avec un EDIT
modifiable (blanc sur bleu, 254 caractères, 41f787) ; texte vide : 31263 ; l'indice prend le premier emplacement libre (41f159). Montrer
/ Cacher : toutes les mains (4204cf, 420536). Les mains montrées ont au Labo trois poignées (41ffd0) : effacer en haut à gauche (31122,
« Effacer » / « Annuler », 41f867), tourner en bas à gauche (420289 : 0 → 1 → 3 → 2 → 0), modifier en bas à droite (l'EDIT) ; un appui sur
la main la déplace (42057e). Les indices sont gardés avec la machine (8 emplacements du LEV).

Voix de l'éditeur : ouvert par la barre (41f668), aucune (`[0x47294c]` = 0, le professeur ne rejoue rien, 41f926) ; ouvert pour une
main (modifier, ou après la pose d'une nouvelle main, 41f5b5), la voix de l'indice du même emplacement **du dernier puzzle joué** (41f62e :
emplacement × 500 + 5500 + `[0x481600]`, sauf après un puzzle maison, `[0x481918]` = 6), sans rapport avec l'indice écrit : jouée à
l'ouverture (le jeu attend 14 messages, 424684), rejouée par un clic sur le professeur, coupée à la fermeture ; la musique baisse comme
pour les autres voix (`labHintVoice`).

**Plans des décors** (`Editor.layer`). Un décor (+0x14 & 0x1000) n'a ni cadenas ni infos, mais deux poignées de plan (43806a : bits
0x1000 / 0x2000, dans tous les modes ; hors du Labo un décor ne se sélectionne pas) à droite de la pièce (42e1e4) : en haut, l'arrière-plan
(état 26 de `HANDLES.ANM`, la montagne passe derrière l'arbre ; zone 0x10 de 43840d, 42ead8) ; en bas, le premier plan (état 27, le cactus
passe devant le rocher ; zone 0x11, 42eb25). Un appui retire le décor de sa liste (4393be) et l'y remet (4393e0 : fixes si +0x0C & 0x4000,
sinon mobiles) : arrière-plan avec l'argument 1, au bout de la liste, après les autres décors ; premier plan avec 0, devant le premier décor
(comme un décor qu'on vient de poser). Le dessin (42d2e6, 42d54a, 42d5a8) parcourt les listes à rebours : la fin de la liste passe derrière,
la tête devant. Pas de son.

**But et titre.** Au Labo, la barre du but est un EDIT (414fc1 : `[0x4811e8]`, 399 caractères, retours à la ligne retirés) : dans le
port, un appui sur la barre y pose une zone de texte (`ui/goal-editor.ts`), fermée par Entrée, Échap ou un clic ailleurs ; vide, la barre
montre la consigne du site. Le titre est le nom donné à la sauvegarde (`DR_TITLE`, « Titre: »).

**Conditions de réussite** (`ui/solve-window.ts`, `engine/lab-puzzle.ts`). Au Labo, une pièce +0x14 & 0x8000 a une poignée « solution »
(drapeau à damier, image 21 de `HANDLES.ANM`, en haut au milieu, zone 0x0E) : son 0xC8C puis `SOLVE.ITF` (426d1c ; une télécommande y
mène ses explosifs). Voyants (état 43 de `SOLVE.ANM`, éteint à la première image, allumé à la dernière) : Pas dans la Solution, Par le
Haut (−500, −2000, 1640, 2000), Par le Bas (−500, 400, 1640, 3000), De l'Écran (−1 partout), et l'état choisi par ▲ ▼ parmi ceux de
`SOLVE.RES` (plage d'images de 429cb8 : première image de l'état a jusqu'à celle de b − 1, b = −1 : la fin ; dans la variante de la
pièce, 429ef4) ; Avancé / Normal (31082 / 31083) montre la rangée du bas : Nombre (EDIT de 2 chiffres ; sans condition, 31090), Retarde
(délai du puzzle, EDIT de 4 chiffres ; sans aucune condition, 31088), Position (31138, un rectangle tracé dans l'aire, puis la fenêtre
revient). 8 conditions au plus (31089). Le ballon : « Intact » donne les images 0 à 0, « Éclaté » 1 à 5, la plage des puzzles du jeu.
Variante de la pièce (429ef4) : le rang de la plage de la première ligne (`@`, sinon le premier état) dont la première image est l'image de
la pièce (+0x18) ; 0 si aucune, ou si la ligne ne commence pas par un nombre non nul (sauf `@`). Quand on retourne la pièce (42e8bb,
42e8fa, 42e939) ou la programme (424a82), sa condition suit (429d84) : la plage dont la première image est l'état 1 de la condition est
cherchée rang par rang dans la première ligne puis dans celle du second état ; trouvée, la condition prend la plage de la nouvelle variante
dans la même ligne (le canon tourné d'un quart garde « N'a pas tiré », dans sa nouvelle direction). Le rectangle (par le haut, par le bas,
hors de l'écran, position) ne change pas.

**Onglets du bac** (`engine/bin-tabs.ts`, `drawBinTabs`). La fenêtre de bac Windows porte au Labo 14 onglets de 30 px dans sa barre de
titre (4184e0, 4186c5 : `WPARTBIN.BMP`) ; leurs filtres (417264) : sans décor, décors (types 110 à 147 et 150 à 280, qui n'étaient pas
proposés jusqu'ici : `labTypes` s'arrêtait aux 149 pièces de `INFO.RES`), rotations, cordes, balles, murs, électricité, feu, lasers,
programmables, tuyaux, pentes, bestioles, divers ; les pièces des fêtes 32, 33, 34, 65 seulement le jour venu (43b06c). La table du bac ne
propose pas 20, 41, 55, 72 (pièces créées en marche) ni 149.

**Puzzles maison** (bac « Puzzles Personnels » de `DOSBIN`). Une machine sauvegardée qui a au moins une condition s'y joue comme un
puzzle du jeu (`homePuzzleRef`, catégorie 6) : `PUZZDISP` avec l'icône `PD_HOME` et sans numéro (425fee), pièces non verrouillées au bac,
but et indices de la machine (sans voix), PUZZSOLV et « Puzzle Suivant » vers le puzzle maison suivant ; l'ampoule pose la machine de
son auteur (les pièces du bac sans le bit 0x100, `solutionSession`).

Écarts du port :
- Onglets : le panneau du bac du port (80 px, `PARTSBIN`) ne loge pas 14 onglets de 30 px. Un bouton à la place de `PB_CONTROL` montre
  l'icône de l'onglet en cours ; un appui ouvre les 14 onglets en deux colonnes dans la liste du bac. L'option « fond » des préférences
  du joueur (`USERPREF.ITF`, non porté) est supposée active : tous les décors sont proposés.
- « Retarde » : le jeu propose de lancer la machine et de cliquer quand la vérification doit commencer (31087, 427b19) ; le port pose 31
  pas (une seconde), à corriger dans le champ.
- Condition qui suit la pièce (429d84) : sans plage reconnue, le jeu reprend la ligne `[0x47ff98]` laissée par le dernier choix de
  `SOLVE.ITF` (jamais remise à zéro) ; le port ne change rien. Le décor en tête de la liste des fixes : 4393be ne remet pas la tête à
  jour, le port si.
- Voix de l'éditeur d'indices : le « dernier puzzle joué » est le dernier puzzle du jeu (`Progress.last`) ; un puzzle maison joué
  ensuite ne coupe pas la voix comme dans le jeu (`[0x481918]` = 6).
- Une condition dont la pièce est retirée au Labo disparaît ; une main sans texte n'est pas créée.

## Deux joueurs (mode 2, lu dans TIMWIN.EXE)

**Entrée** : Duel du menu principal (422e31 → 42319e), chat et Tim de la barre (4195bd, 31399), « Affronter » en fin de match (419aed) ;
les deux derniers passent par le mode 7 (422a24). 42319e : mode 2, puis la fenêtre `HEDTOHED.ITF` (41d15c, procédure 41d26d, boutons
41d4be) : parties `[0x477984]` 1 à 9 de 2 en 2 (3), durée de chaque joueur `[0x47797c]` / `[0x477980]` 10 à 90 s de 5 en 5 (45 s), noms
de 10 caractères (EDIT 416bb3 ; « Joueur 1 », « Joueur 2 » : 2100, 2101). OK : un nom vide → GENERIC 31179, la fenêtre reste ; sinon le
puzzle de 42cbad(5) (premier HH non résolu à partir du puzzle en cours, puis depuis HH1 ; tous résolus : un HH au hasard, 4520a4,
autre que celui en cours), `PUZZDISP`, joueur 1, manches à 0. Annuler (et Échap, 0xFE64) : menu principal. Les flèches écrivent les
réglages gardés (`0x472840`) : Annuler ne les défait pas. Il n'y a pas de choix du puzzle dans la fenêtre ; la disquette (`DOSBOX`)
reste ouverte en mode 2 et le puzzle chargé devient la partie suivante (scores gardés).

**Tours** (4330d0, à chaque passe de la boucle d'édition et de la boucle de marche) : un nouveau puzzle donne la main au joueur courant
(au début du match le joueur 1, ensuite le vainqueur de la manche) ; à l'échéance `[0x4815d8]` (« Terminer le Tour », 418e70, la met à
maintenant), hors marche : pièce tenue posée là où elle est, ou rendue au bac pour une corde, un câble, une courroie, une télécommande, des
explosifs ou une pièce qui chevauche (4301f5) ; son 0xBF8 ; fond de l'aire 12 (joueur 1, rouge) ou 9 (joueur 2, bleu) ; tableau ; GENERIC
31116 « %s, c'est votre tour. » ; le temps du joueur part à la fermeture. Le temps court pendant les autres fenêtres et pendant la marche
de la machine (GetTickCount) ; le tour ne passe qu'une fois la machine arrêtée.

**Ce qu'on peut faire dans un tour** : **une pièce prise dans le bac et posée** (`0x4815c0` → `0x4815b8`, 417190, 41715f ; rendue au bac
sans être posée, elle ne compte pas, 42ebba) : ensuite le bac refuse (418207 : son 0xE24, GENERIC 31153 « Vous avez déjà enlevé un élément
de la Corbeille! ») ; et **une pièce de l'aire changée** (`0x4815bc`, 4301cb : saisie, rangée, retournée, étirée ; programmer ne compte
pas) : ensuite les autres pièces ne se sélectionnent plus (43013e ; un appui : 0xE24, GENERIC 31152 « Vous avez déjà déplacé 1 élément! »).
La pièce du bac posée ce tour reste modifiable, ainsi que le partenaire d'une télécommande ou d'explosifs. Pas de confirmation à la
balayette (43252d(0, 2) : le puzzle est rechargé, compteurs du tour gardés), pas d'ampoule, indices comme en Jeu. Le but et les conditions
de réussite des HH sont ceux des autres puzzles (436dc6 n'a pas de cas du mode 2).

**Fin de manche** (419803 → 41993b) : le joueur du tour où la machine résout le puzzle gagne la manche (`[0x4815c8]` / `[0x4815cc]`). Match
fini si le total atteint le nombre de parties ou si un joueur a la majorité : le vainqueur devient le joueur courant, GENERIC 31120 « %s,
vous avez gagné!!!… » (Rejouer / Affronter). Sinon, joueur 1 puis joueur 2 à une victoire du match (41d827(1), 41d827(0)) : égalité →
« ~S3 » 2155 « C'est du sérieux maintenant!… » ; sinon « ~S3%s, %s %s » (celui qui est mené, celui qui mène, 2154) ; Rejouer / Suivant.
Sinon 31117 « %s, vous avez résolu le puzzle!… » (Rejouer / Suivant). Rejouer relance la machine puis repose la question ; Suivant et
Affronter notent le puzzle résolu (42ccae : même tableau que le Jeu, d'où la progression) ; Suivant : puzzle de 42cbad(5), `PUZZDISP`,
le vainqueur commence. Pas de son de victoire, pas de PUZZSOLV ni de BINSOLVE.

**Fenêtres** : la barre du but est réduite (286 px, table 0x471b80) et une fenêtre « HeadToHead » (`H2H.ITF`, 346 × 64, 414670) montre le
tableau : fond `GOALBAR.ANM` état 3 (joueur 1) ou 4 (joueur 2) (414a93), noms (valeurs 11098 / 11099, couleur 15 pour le joueur du tour,
7 pour l'autre), « Wins: » (31102, une espace en français ; couleur 14 / 15), manches (état 6), temps restant en secondes et dixièmes (état
5, 41495b). Aucune voix propre au mode (la voix du but des HH existe : `goals/156` … `205`).

**Port** (`engine/duel.ts`, `ui/duel-window.ts`, `render/duel-board.ts`, `ui/app.ts`) : jeu local sur le même appareil, comme l'original.
La règle du tour est une garde de l'éditeur (`EditGuard`) : `takeFromBin` refuse, `grab`, `removeToBin`, `flip`, `resize`, `resizeEdge`
refusent une pièce interdite ; `PlayScreen` ne montre pas ses poignées et demande le refus du jeu (`duelRefused`). Arrêter la machine
remplace les pièces par leur copie : la garde suit (`remap`). Écarts : tableau posé à droite de la barre du but dans l'écran 640×480
(`DUEL_BOARD`, x = 294 ; la barre du but garde son bord droit) ; le message du tour est montré à chaque nouvelle partie (l'exe le saute si
le même puzzle revient) ; l'horloge du tour ne court pas onglet masqué et avance d'au plus 250 ms par image ; un puzzle maison choisi à la
disquette pendant un match quitte le match ; « Menu principal » sous l'écran termine le match ; l'aire d'un match n'est pas gardée (D11) ;
bouton « Terminer le tour » aussi sous l'écran (clavier, lecteurs d'écran). **Nom du joueur qui attend** : vérifié dans l'exe
(4214b4 / 4214ef : couleur 7 pour le joueur qui n'a pas la main, 15 pour l'autre ; `[edi] = 1`, style 1 : seuls les styles 2 et 3 sont
enregistrés (4136c7), 452e8c rend donc le dessin plat par défaut). Or la couleur 7 est le gris de la moitié inactive du fond (état 3 /
4 de `GOALBAR.ANM`, 414a93) : l'original écrit ce nom gris sur gris, il est invisible. Écart du port : même couleur 7, mais avec un relief
d'un pixel (ombre en 8 en haut à gauche, reflet en 15 en bas à droite, `drawWaitingName`) ; le nom du tour reste plat. **But long** :
l'original ne réduit pas la police et ne fait pas défiler (style 5, 421ec1 : `GOALFONT.PFT`, alignement 0x400) ; le texte est coupé à
la largeur de la fenêtre de la barre (414e26, message 5 de 414fc1, 286 px en duel) et seules les lignes entières qui tiennent dans sa
hauteur sont dessinées (452ed0 / 45301c) : un but long est coupé, dans la barre réduite comme dans la barre pleine. Le port garde cette
coupure (2 lignes) ; seule la marge droite du texte est élargie en duel (66 px, `GOAL_TEXT_REDUCED_MARGIN`) pour ne pas écrire sur le
reflet jaune du bord recollé. Hauteur exacte de la zone du but en duel (la fenêtre de 414d58 est 10 px plus haute que celle du jeu
seul) : non vérifiée, le port garde 46 px.

## Inscription (`SIGNIN.ITF`, lu dans TIMWIN.EXE)

**Ce que fait le jeu.** Un joueur est un fichier de partie : `TIM.SAV` pour l'invité, dont le nom est la ligne 3 de `SYSTEM.RES`
(« Hôte »), puis `tim01.sav` à `tim100.sav` (42d0b8 : premier numéro libre, 100 joueurs inscrits au plus). Un fichier (42c6d0 lit,
42c8cb écrit, en-tête `SYSTEM.RES` ligne 2 et somme de contrôle) garde le nom (20 octets), un second texte de 20 octets (rôle non lu), le puzzle en cours
(`[0x481600]`), le puzzle en cours de chaque catégorie (7 mots : 0, 40, 66, 96, 127, 156, 206 au départ, 42c664), un octet par puzzle
(bit 0 : résolu), trois octets de son, le mode avancé de `SOLVE.ITF` (+0x150, `[0x472f98]`, 42a082 / 42a075) et les préférences
d'affichage de `USERPREF.ITF` (+0x154, `[0x481034]`). **Son** : +0x50 = volume 0 à 15 (écrit depuis 411674(1001, −1), relu par
411674(1001, v), 411674(3001, v) et `[0x47796c]` : musique et effets), +0x51 = musique (4115e6(1000, ·)), +0x52 = interrupteur général
(4115e6(10000, ·) : `[0x47c094]`, que chaque départ de son vérifie avant celui de sa classe, 4111b7 ; c'est la case « Effets Sonores »
de `USERPREF.ITF`, 42aeee). L'interrupteur des effets de la guitare (4115e6(3001, ·), classe 3) **n'est pas** dans le fichier : il vaut
pour la séance ; le jeu n'a pas d'interrupteur des voix. Partie neuve (42cf85) : volume 15, musique et son en marche. `SIGNIN.RES` n'est que la liste des
noms, refaite à chaque ouverture de l'écran (42668d : nom lu dans chaque `TIM*.SAV`) et effacée en quittant (43b90d). **Au lancement,
l'invité** (43b5cc : 42c6d0(0) → `TIM.SAV`) : le dernier joueur n'est pas retenu. **Pas d'effacement** de joueur.

**Écran** (426b53, procédure 426362, commandes 4267b0) : SI_NAME, EDIT de 19 caractères blanc sur bleu (4264b3, 4264e9), prérempli avec le
nom du joueur courant ; chaque frappe choisit la rangée du nom écrit, casse ignorée, ou aucune (426544) ; SI_LIST, les noms (rangées
de la hauteur du texte + 2, (hauteur − 12) / rangée, texte en x + 30, couleur 12 pour la rangée choisie, 9 sinon : 426bc8), un clic
copie le nom dans le champ (426ac2), un clic sur la rangée choisie vaut « Terminé » (426b3d) ; ▲ ▼ d'une rangée, cachées si tout tient
(426cce) ; « Terminé » (Entrée, Échap : 4263eb) : un nom écrit désigne son joueur, inconnu → 31174 « Ce nom ne correspond pas à ceux de
la liste. Êtes-vous un nouveau joueur? » (Oui : partie neuve, 42c608, et le professeur se présentera de nouveau, 4269fc ; Non : retour
au champ) ; sans nom, la rangée choisie ; sans rien, 31175. Puis le menu principal (mode 7 vers 10) et la musique 1000 relancée. « ? » :
le manuel Windows (4169c8(0xb)). Depuis la barre : 31401 d'abord (§ Barre d'outils) ; depuis le menu : 422f3d vérifie qu'on peut écrire
(31207).

**Port** (`engine/players.ts`, `ui/signin-window.ts`) : registre `tim3:players` (`{ version: 1, players: [{ id, name }] }`, invité
implicite d'identifiant 0, joueurs 1 à 100) ; par joueur, sous `tim3:p<n>:` : `solved`, `last`, `homeSolved`, `edit:<puzzle>`,
`edit:lab`, et le son de son fichier : `music` (`"0"` / `"1"`) et `volume` (0 à 15), absents = partie neuve (`PlayerRegistry.sound`,
`setSound`). Changer de joueur applique aussitôt sa musique (arrêtée si coupée) et son volume ; la guitare les écrit pour le joueur
courant. Changer de joueur garde d'abord l'aire en cours pour l'ancien, puis rien n'est écrit pour le nouveau tant qu'un mode n'est
pas rouvert. Registre illisible : l'invité seul, jamais d'exception. **Migration** (`migratePlayers`, une fois, sans registre) : les
clés d'avant l'inscription (`tim3:solved`, `last`, `homeSolved`, `edit:*`, `music`, `volume`) deviennent celles de l'invité, chargé au
lancement : copie (sans écraser une copie déjà faite), registre, puis effacement ; interrompue, elle reprend à l'ouverture suivante.
**Migration du son** (`migratePlayerSound`, à chaque ouverture tant que `tim3:music` ou `tim3:volume` existent) : ces réglages communs
deviennent ceux de l'invité **et de chaque joueur déjà inscrit** qui n'a pas les siens (ils s'appliquaient à tous : personne ne perd
son réglage), puis les clés communes sont effacées ; écriture refusée : rien n'est effacé, reprise ensuite.

**Son du site et son du joueur** : le bouton « Son » du site (`SoundPrefs`, `retrovibe:tim3:sound`) reste une préférence du site, commune
à tous les joueurs ; il coupe la sortie (gain général) sans rien arrêter ni changer aux réglages du jeu. Dessous, la musique et le volume
sont ceux du joueur courant, l'interrupteur des effets (`tim3:effects`) et les voix du professeur (`retrovibe:tim3:voices`) des
préférences communes. Un son n'est entendu que si le site a le son **et** si son réglage le laisse passer ; le volume ne touche que
musique et effets. L'interrupteur général du jeu (+0x52, `USERPREF.ITF`, non porté) n'a pas d'équivalent par joueur : son rôle
(tout couper) est celui du bouton « Son » du site.

Écarts :
- Restent communs à tous les joueurs : les machines du Labo (`slot01` … `slot10`, comme les fichiers de puzzles du jeu),
  l'interrupteur des effets (le jeu ne le garde pas non plus) et la voix (ajout du site).
- Le second texte de 20 octets, les puzzles en cours de chaque catégorie, l'interrupteur général du son (+0x52), le mode avancé de
  `SOLVE.ITF` (gardé pour la séance seulement) et les préférences d'affichage ne sont pas portés (le port retient un
  seul dernier puzzle, `last`, et `currentPuzzle` en déduit le puzzle en cours).
- Pas de vérification d'écriture (31207) : un stockage plein ou bloqué donne un message du site à l'inscription.
- « ? » ouvre l'aide du site, puis l'écran revient. Cent joueurs inscrits : message du site (le jeu écraserait la partie courante).
- Titre (25004, texte 21145, `SYS12.PFT` en relief, centré, contrôle de 85 × 27) : le jeu le pose par 45301c (mots entiers, lignes de
  20 pixels, hauteur du `head` du PFT à l'échelle 1, tant qu'elles tiennent dans 27 pixels : une seule). L'anglais « SIGN-IN » (63
  pixels) tient ; le français « ENTREZ VOTRE NOM » (170 pixels) non, et le jeu français n'affiche que « ENTREZ ». **Écart voulu**
  (`withReadableHeading`) : le port élargit le contrôle de la gauche de SI_NAME jusqu'à la plume (176 pixels), le titre entier tient sur
  sa ligne ; police, relief et mise en page restent ceux du jeu.

## Visite guidée du Labo (mode 6, lu dans TIMWIN.EXE)

**Entrée** : « Exercice » du menu (42332c) ou la chaussure (419712, 31400). Mode 6 : un Labo vide (433830 vide l'aire, le nom, les
indices et l'état de la visite, 41d8c4), la barre du mode 6 (§ Barre d'outils), puis la fenêtre de la visite (422b65 → 41d8e8(0)).

**Fenêtre** (41d9a3 avec l'identifiant 0, procédure 41db2d, contenu 41e567 → 41eaaa, boutons 41dce4) : `HELP.ITF`, texte de
`PROFESOR.RES` (chargé sous 10001, 41d9ac) dans HP_TEXT, voix `PROFESOR.VOC` de même rang (41eda1 : 4000 + ligne) dite par le
professeur animé (423e50(23106)) ; « Continuer » (HP_YES, 31267, bouton par défaut), « Retourner » (HP_NO, 31268), « Salut! »
(HP_CANCEL, 31269, Échap), « Terminé » (HP_DONE) à la fin seulement ; « ? » et OK cachés.

**État** (`engine/walkthrough.ts`) : masques `done` (`[0x4728a4]`), `visited` (`[0x4728a8]`), `have` (`[0x4728a0]`) ; étape courante =
premier bit absent de `done`. À chaque affichage (41eaaa), `have` est recalculé : 5 pièces posées au moins (41edd7 : fixes et mobiles),
but (`[0x4811e8]`), nom (`[0x4811c0]`), indices (`[0x47eb74]`), solution (`[0x47fe30]`) ; un but ou un nom effacé rouvre son étape. Ligne
= base + 1 si `have` + 2 si `visited` (exceptions : musique, déverrouillage, sauvegarde). « Retourner » n'est montré qu'une fois l'étape
demandée, jamais quand le but ou le nom est vide, ni à la sauvegarde.

| Étape | Lignes | « Continuer » la première fois | ensuite | « Retourner » |
| --- | --- | --- | --- | --- |
| 1 bienvenue | 0, puis 1 (`[0x4728c0]`) | valide | | |
| 2 pièces | 2 à 5 | ferme : construire | 5 pièces : valide ; sinon ferme (ligne 4) | ferme |
| 4 musique | 6, 8 | la guitare, puis la visite | valide | la guitare |
| 8 but | 9 à 12 (11 : but vide) | ferme, barre du but au focus | but écrit : valide | ferme, barre du but |
| 0x10 nom | 13 à 16 ; 33 pendant la saisie | saisie dans HP_TITLE (EDIT noir sur blanc, 29 car.) | nom donné : valide | saisie |
| 0x20 solution | 21 à 24 | ferme : poignée « solution » des pièces | valide | ferme |
| 0x40 indices | 17 à 20 | ferme, éditeur d'indices (41d96f) | valide | éditeur d'indices |
| 0x80 tout verrouiller | 25 | verrouille tout (4209e5(0)), la visite revient | | passe l'étape |
| 0x100 déverrouiller | 27, 28 | ferme : cadenas des pièces | valide | ferme |
| 0x200 sauvegarde | 29 ; 30 raté ; 31 réussi | sauvegarde (41edfc : `PUZB<n>.TIM`), la visite revient | valide | |
| 0x400 fin | 32 | | « Terminé » : menu principal | |

« Salut! » avant la fin : 31136 « Le puzzle n'a pas été sauvegardé et sera effacé. Désirez-vous quitter? », Oui : menu principal (mode 7).
Quand la fenêtre est fermée, le portrait du professeur de la barre (`TB_WALKTHROUGH`) la rouvre sur l'étape en cours. Pendant la saisie du
nom, Entrée dans le champ (41dd5b) vaut « Continuer » ; le professeur ne repart pas (41e344 écrit la ligne 33 sans voix).

Écarts :
- Sauvegarde : le premier emplacement libre des machines du Labo (le puzzle se joue ensuite depuis « Puzzles Personnels ») au lieu d'un
  nouveau fichier `PUZB<n>.TIM` ; sans emplacement libre, la sauvegarde échoue (ligne 30, nouvel essai possible).
- La machine de la visite n'est jamais gardée (ni à la fermeture de la page) : le jeu la perd aussi en quittant la visite (31136). Le
  Labo, lui, retrouve sa propre machine (D11), le jeu ouvrirait un Labo vide.
- La ligne 7 (« déjà des mélodies ») et la ligne 26 (« déjà verrouillé certains objets ») ne sortent jamais : `have` n'a jamais ces bits
  dans le jeu non plus.
- `TOUR.ITF` (fenêtre des six démonstrations « Résoudre un Puzzle », « Créer un Puzzle »… : 42a7bc, appelée par la commande de menu
  651xx de 4211d6, image `SIGN_IN.BMP` en décor 18 dessinée par 42b072, professeur 42a8d7) rejoue des enregistrements `TOUR<n>.REC`
  (451c08) **absents du CD** ; 31141 dit d'ailleurs que cette visite n'est pas terminée. Non portée.

## Son

`Tim3Audio` (`audio/audio.ts`) : `enterPuzzle(music)` à l'entrée d'un puzzle ou du Labo, voix du but et des indices
(`goalVoice`, `hintVoice`), sons de l'éditeur (prise / pose 0xE1B, retrait 0xE1A). En marche, `drainEffects` rend dans l'ordre
les sons des handlers (`World.sound` / `stopSound`, crochets `onSound` / `onStopSound` posés par la session) puis les
commandes `sound` / `soundEx` des images d'ANM qui viennent de changer ; `stop` → `stopEffect`. `stopEffects()` à l'arrêt de
la machine et au puzzle réussi (ambiances en boucle). La file `World.sounds` est vidée après chaque pas.

## Vérification sans navigateur

`npx vitest run test/tim3/editor test/tim3/ui` (moins d'une seconde ; `test/tim3/ui` : barre d'outils) : `duel.test.ts` (règle du tour,
chronomètre, manches, choix du puzzle, un match complet au meilleur des 3 joué tour par tour par l'éditeur sur HH23 et HH27 ; fenêtre
`HEDTOHED`, tableau, refus à l'écran), éditeur, session, Labo, conditions de victoire, progression, `lab-tools.test.ts` (cadenas, onglets, puzzle maison, but au Labo ; fenêtres `HTLOCK`, éditeur d'indices, `SOLVE`, écran du Labo), `homemade.test.ts` (puzzle maison construit par l'éditeur, sauvegardé, relu au Labo, joué et résolu ; migration des sauvegardes de la version 1), `save.test.ts` (sauvegardes : aller-retour, reprise après
rechargement, données corrompues, emplacement plein, nom vide, quinze solutions reprises et résolues au même pas), et
`professor.test.ts` (professeur, fenêtre d'aide, mode aide), `players.test.ts` (registre, migration, « Terminé » de l'inscription),
`walkthrough.test.ts` (visite guidée : textes et boutons, puis la visite entière jouée par l'éditeur jusqu'au puzzle maison sauvegardé
et rejoué), `test/tim3/ui/signin-walkthrough.test.ts` (fenêtres `SIGNIN` et de la visite), `test/tim3/data/help.test.ts` (`HELP.RES`), `solution.test.ts` (ampoule : solution du concepteur posée, `TIM3_SOLUTION_ALL=1` pour les 156 : toutes résolues, HLEV9 17 pas avant le banc), `program.test.ts` et `replay.test.ts`, qui rejoue quinze solutions du concepteur **par l'API de l'éditeur** (`replay.ts` : prendre au bac, retourner,
étirer, tourner, poser, tendre courroies et cordes, brancher, programmer) puis vérifie la victoire au pas du banc + 30.
`TIM3_REPLAY_ALL=1 TIM3_REPLAY_REPORT=<fichier>` les rejoue toutes (1,5 s) : **156 / 156 résolues**, 151 au pas du banc ;
HLEV6, 7, 9, 10 et 17 finissent de 1 à 15 pas à côté, parce que les pièces posées à la main entrent dans les listes une à
une (4393e0) et non dans l'ordre du LEV que lit le banc. `program.test.ts` couvre les types sans solution (87, 71, 58, 80).

## Écarts et manques

- Fenêtre « programmer » : fermer sans « Terminé » remet une boîte ou un ballon dans leur état d'avant (l'exe les laisse,
  chevauchement compris). Types 127 et
  136 : du code dans 424ce1 mais pas d'écran `PROG<type>.ITF`, non portés.
- Tuyau 97 : étiré par ses poignées, le slot 4 lit la poignée tenue (`World.resizeHandle` = 0x8003 … 0x8006, 42fb4a) et met
  l'autre côté à 38 px.
- Explosifs 0x37 rangés au bac avec leur télécommande au chargement (42f978) : le bac les montre ; à vérifier dans le jeu
  s'ils y sont visibles (le Labo ne les propose pas : absents de la table du bac).
- Professeur : le jeu **arrête** la musique pendant sa voix (424684 : 41177b(2, 1), 41177b(1000, 1)) et la relance du début ensuite ; le port aussi (`audio.md` § Enchaînement).
- **Noyau (à reprendre hors de cette vague)** : `World.stowUnlocked` donne une boîte nulle aux pièces 11, 13, 21, 25 (+0x34 du
  type à 0) et appelle des slots non portés (pentes 43c62b / 43c5f6, murs 43ea14, 43e734) ; l'éditeur corrige les pièces du
  bac et traduit ces slots en repli. Les opérations de bac de `World` (42f978, 4395ba, 43909c, 4390ff, 438fe3) sont privées :
  l'éditeur les atteint par un transtypage (`core()`), une API publique serait plus propre.
