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
| `ui/menus.ts` | Fenêtres GENERIC (`genericWindow`, `genericDialog`, `confirmDialog`, `messageDialog`) et PUZZSOLV (`solvedWindow`, `solvedDialog`). |
| `ui/itf-window.ts` | **Hôte unique des fenêtres `.ITF`** (D7), fenêtres surgissantes comme écrans pleins du parcours d'entrée : canvas transparent de 640×480 posé sur celui du jeu (dessin `render/itf-draw.ts`), calque d'éléments transparents aux rectangles, dans l'ordre de lecture (positions en % : suit l'échelle) : `<button>` (boutons, flèches, interrupteurs avec `aria-pressed`, zones de l'appelant ; grisés `disabled`, ou `aria-disabled` et « (non disponible) » avec `greyedActive`), `role="slider"` (réglettes), `role="listbox"` (liste `ScrollList`), `<input>` (saisie DR_TITLE) ; `role="dialog"` titré, textes et état (`role="status"`) en `tim3-sr`. `ItfWindow` (sans DOM, testé) : appui / glisser / relâché, survol et focus (bouton actif : la dernière des deux actions), flèches animées et répétées (44ee9d), réglettes (425a46, 41cf20), liste, passes de 50 ms (`pass`, `tick`), survol animé (`hoverAnimate`), dessin propre (`decorate`), animation à cadence propre (`frame`), Échap, éléments du calque et leurs noms (`controls`). `choose` rend `true` pour garder la fenêtre ouverte ; `ItfScreen` + `screenOptions` : écran qui rend un résultat. |
| `ui/info-window.ts` | Description d'une pièce (`INFO.ITF`, 420c14). |
| `ui/program-window.ts` | « Programmer » (`PROG<type>.ITF`, 425147), sur `engine/program.ts`. |
| `ui/globe-window.ts` | Globe (`GRAVITY.ITF`, 41cbdc). |
| `ui/musicbox-window.ts` | Guitare (`MUSICBOX.ITF`, 4234ec), plus la bande « Voix du professeur » du site. |
| `ui/binsolve-window.ts` | Fin de catégorie (`BINSOLVE.ITF`, 419c9c), par-dessus PUZZSOLV. |
| `ui/hint-window.ts` | Un indice (`HINT.ITF`, 41f3dc). |
| `ui/professor.ts` | `Professor` (sans DOM) : le professeur animé de `HELP.ITF` et `BINSOLVE.ITF` (423e50, 4241ae, 424089, 42452c), attente `PROFAMBT.ANM`, parole `PROFSPCH.ANM` synchronisée sur `mouth()`. |
| `ui/help-window.ts` | Aide du professeur (`HELP.ITF`, 41d9a3, 41db2d, 41e567). Textes et voix : `data/help.ts` (`HelpTable`, 41e7e7). |
| `ui/machines-window.ts` | Machines du Labo : `LOADSAVE.ITF` (42289c) puis la liste `DOSBOX.ITF` des dix emplacements. |
| `ui/intro.ts` | `IntroPlayer` : logo Sierra et titre animé, sans DOM (surface et palette propres, sons des images, passage). |
| `ui/main-menu.ts`, `ui/credits.ts`, `ui/chooser.ts` | Écrans de `itf-window.ts` : `MainMenuScreen` (`MAINMENU`, `quitMainMenu`), `CreditsScreen` (`CREDITS`), `PuzzleListScreen` (`DOSBOX`), `BinScreen` (`DOSBIN`), `PuzzleCardScreen` (`PUZZDISP`), `currentPuzzle` (42cbad). |
| `render/front.ts`, `render/itf-list.ts` | Dessin de l'intro (palettes, sons des images) et des crédits ; liste à défilement de `DOSBOX` (41bf29) et son état `ScrollList` (choix du puzzle et machines du Labo). |
| `ui/app.ts` | Montage (`mountGameShell`), chargement des volumes, son, pas de 32 ms (`TickScheduler`), professeur (but et indices, voix). |
| `ui/dev.html`, `ui/dev.ts` | Page de développement (`tim3-dev` dans `.claude/launch.json`, port 5283, `/src/games/tim3/ui/dev.html?puzzle=TLEV1`). |

## Barre d'outils (418b78, 418ded)

- Jeu : Puzzle enfoncé ; deux joueurs, manuel, visite guidée, inscription grisés (palette atténuée, `RenderAssets.fadeTable` :
  l'ANM n'a que « relâché » et « enfoncé », le jeu cache ses boutons sans jamais les griser) ; cadenas et levier d'essai cachés ;
  ampoule à x = 540 si le puzzle est résolu (`Progress`), sinon vide.
- Labo : clé enfoncée ; cadenas, levier d'essai et indices (éditeur d'indices 41f3dc) grisés ; pas d'ampoule.
- Disquette : en Jeu, le choix du puzzle (`DOSBOX`, 418f2c) ; au Labo, les machines du Labo.
- Clics : Puzzle sans effet en Jeu, depuis le Labo 31397 puis le dernier puzzle ; clé 31398 puis le Labo ; balayette sans
  question en Jeu (43252d), 31134 au Labo si l'aire n'est pas vide ; ampoule 31125 puis la solution du concepteur ; bouton grisé :
  « non disponible » du jeu. Écart : le jeu montre 31134 au lieu de 31397 en quittant un Labo modifié (`[0x477950]`), le port
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
  l'original). Au doigt : pièce tenue 40 px au-dessus du doigt, premier appui sur une pièce posée = sélection (poignées),
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
  Options (42aa60) ; Quitter → 31113 Oui / Non (422f00). Entrée : Jeu ; Échap : Quitter (450d44). Dans le jeu, le menu principal
  revient par « Zones > Menu principal » du menu Windows (ressource TIM2MENUF), pas par la barre d'outils.
- **Puzzle en cours** (42cbad(−1)) : à partir du dernier joué, premier non résolu de sa catégorie (jusqu'à la fin puis depuis le
  début), sinon premier non résolu du jeu, sinon le dernier joué.
- **Choix du puzzle** : disquette en Jeu (418f2c) ou « Fichier > Ouvrir » → 41acf0(1) : **`DOSBOX` d'abord**, liste de la catégorie
  en cours (41b75b ; rangée « * » si résolu, 41bb87 ; « %2d. » + titre du LEV), dessinée par 41bf29 (`render/itf-list.ts` : ampoule
  allumée, état 36 de `BUTTONS.ANM`, ou éteinte, état 35). Clic : rangée choisie (son 0xE1B) ; double clic ou « Lancer » : charge ;
  « Autres Puzzles » (`DR_BIN`) ouvre `DOSBIN` (41ae39, 41b649 : bac de la catégorie en cours au focus, table 0x4726d4) puis revient à
  `DOSBOX` sur la catégorie choisie ; « Avancé » : sélecteur de fichiers Windows (42a088). Après chargement : `PUZZDISP` (425d20 :
  catégorie 31048 + n, « %Fs %d » de 2064, titre, icône seule de la catégorie, musique du puzzle relancée, voix du but 18 tours
  après si `[0x480370]` vaut « E »).

Écarts du port :
- Deux joueurs, Inscription, Exercice : grisés (trame) et cliquables, « non disponible » du jeu, comme la barre d'outils ; Manuel
  ouvre l'aide du site ; Aide (4169c8(10) : rubrique du manuel Windows `TIMHELP.EXE`) ouvre l'aide du professeur par-dessus le menu
  (§ Aide du professeur) ; Quitter pose toujours la question 31113, puis revient à l'accueil du site (sur la page de dev : le jeu
  repart). Options : la guitare (`MUSICBOX`). Bande `MM_TEXT` : seuls les six modes ont un texte « contrôle + 100 » ; pour Aide,
  Options, Quitter et hors des boutons, elle est vide (4233a3 ne trouve rien, 423473 ne dessine rien). Le focus du clavier tient lieu
  de survol : la bande suit la dernière des deux actions.
- `DOSBIN` : Deux joueurs (D12) et Maison (puzzles personnels : fichiers LEV lus sur disque ; les machines du Labo du port n'ont ni but
  ni bac de puzzle, elles se rouvrent par la disquette du Labo) grisés ; « Avancé » grisé. Le titre et son champ de `DOSBOX` ne
  servent qu'à « Enregistrer sous » (Labo) : cachés, comme le fait l'exe en chargement.
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
  sur la musique et les effets, pas les voix (`Tim3Audio.volume`, `effectsEnabled`, préférences `tim3:effects`, `tim3:volume`).
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
catégorie (`BINSOLVE.ITF`, 419e2a, sans voix) ; un troisième appel (42a8d7) sert à la visite guidée (`TOUR.ITF`), non portée. À
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
cachés. Fermeture (423f9d) : voix coupée.

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
`professor.test.ts` (professeur, fenêtre d'aide, mode aide), `test/tim3/data/help.test.ts` (`HELP.RES`), `solution.test.ts` (ampoule : solution du concepteur posée, `TIM3_SOLUTION_ALL=1` pour les 156 : toutes résolues, HLEV9 17 pas avant le banc), `program.test.ts` et `replay.test.ts`, qui rejoue quinze solutions du concepteur **par l'API de l'éditeur** (`replay.ts` : prendre au bac, retourner,
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
- Professeur : le jeu baisse la musique pendant sa voix (424684 : 41177b(2, 1), 41177b(1000, 1)) ; le port la laisse à son niveau.
- **Noyau (à reprendre hors de cette vague)** : `World.stowUnlocked` donne une boîte nulle aux pièces 11, 13, 21, 25 (+0x34 du
  type à 0) et appelle des slots non portés (pentes 43c62b / 43c5f6, murs 43ea14, 43e734) ; l'éditeur corrige les pièces du
  bac et traduit ces slots en repli. Les opérations de bac de `World` (42f978, 4395ba, 43909c, 4390ff, 438fe3) sont privées :
  l'éditeur les atteint par un transtypage (`core()`), une API publique serait plus propre.
