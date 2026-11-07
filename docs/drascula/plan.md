# Drascula : plan d'implémentation

Jeu : *Drascula: The Vampire Strikes Back* (Alcachofa Soft, 1996), version française. Jeu d'aventure « pointer-et-cliquer » en 320x200 (256 couleurs) :
on choisit un verbe dans une barre d'icônes (regarder, prendre, ouvrir, fermer, parler, déplacer), puis un objet ; six chapitres, un inventaire, des
dialogues à choix, des cinématiques, des voix et une musique. Version portée : textes français de `drascula.dat` (ScummVM) sur les voix anglaises du pack de base.

Ce document sert de brief commun aux sous-agents. Les références font foi sur ce plan : `formats.md` (formats, vérifié / supposé). Les documents
suivants seront ajoutés au fil des vagues, sur le modèle d'Armaeth : `engine.md` (boucle, état, chapitres), `rooms.md` (pièces et gestionnaires),
`talk.md` (dialogues et voix), `screens.md` (écrans, interface), `graphics.md` (palettes, police, perspective), `files.md` (inventaire généré par le script d'extraction).

## Avancement

- Étude de faisabilité faite (verdict : faisable, volumineux) ; formats lus et vérifiés sur les fichiers (`formats.md`) ; `drascula.dat` analysé en entier (version 7).
- **Vague X (extraction) faite** : `scripts/drascula-extract.sh`, `scripts/drascula-music.sh` (+ `scripts/drascula/extract_utils.py`, `scripts/drascula/drascula-dat-LICENSE.txt`), `original/drascula/` rempli (1 146 fichiers + `files.json`, environ 90 Mo dont 29 Mo de musique MP3), `docs/drascula/files.md` généré.
  La jaquette `drascula-cover.mts` et `COVER.png` : faites en vague J.
- **Vague D (lecteurs de données) faite** : `src/data/cp850.ts` (E1, nouveau fichier, `cp437.ts` inchangé ; test `test/shared/cp850.test.ts`) ; `src/games/drascula/data/` : `rle.ts`, `alg.ts`, `text-resource.ts` (lecteur commun des `.ALD` et `.CAL`),
  `ald.ts`, `cal.ts`, `bin-ssn.ts`, `bin-animate.ts`, `als.ts`, `dat.ts`, `files.ts` ; tests dans `test/drascula/data/` (un par lecteur, sur les vrais fichiers). Critère de fin atteint : 225 `.ALG`, 57 `.ALD`, 13 `.CAL`, 33 `.BIN` (jusqu'au dernier octet),
  783 `.ALS` et `drascula.dat` (259 625 octets, six langues) lus sans erreur ni reste ; `formats.md` mis à jour (points tranchés ci-dessous). Écarts au plan (documentés dans `formats.md`) :
  - les `.ALD` ont **deux dispositions selon le chapitre** (chapitre 2 : taille du héros en en-tête, pas de limites de perspective ; autres : limites en fin de fiche) : `parseAld(bytes, chapter)` ; le plan et `formats.md` plaçaient les limites au chapitre 2 et la fin de fiche à tort ;
  - les `.CAL` contiennent 4 répliques, 4 noms de voix et 3 numéros de réponse (et non une réplique par ligne) ; les `.ALD` et `.CAL` sont séparés par `\n` (pas `\r\n`) ;
  - les 17 pièces 1 à 19 (sauf 13) sont en disposition « chapitre 2 » ; le chapitre de chaque pièce reste à fixer par le moteur (vague G) ;
  - `3.ALS` : la condition de contournement de ScummVM ne se déclenche jamais sur ce fichier (comparaison de la taille moins 64 à 145 166, alors que le fichier fait 145 166 octets) ; le lecteur applique le contournement : **à confirmer à l'écoute** (vague A) ;
  - `drascula.dat` : les langues non demandées sont parcourues pour vérifier la structure sans être gardées (français par défaut ; le russe n'est pas en CP850) ;
  - `.ALS` : le silence de 32 octets de chaque bout n'est exact que dans 707 (début) et 714 (fin) fichiers sur 783, le jeu les coupe quand même ;
  - le refactor commun de `cp437.ts` / `cp850.ts` n'est pas fait (optionnel) : les deux tables sont dupliquées.
  Points restant ouverts : voir la fin de `formats.md` (sens de certains champs `.ALD`, voix `B*`, police, cadence).
- **Vague G (moteur : cœur) faite** : `src/games/drascula/engine/` : `cadence.ts`, `sequence.ts`, `host.ts`, `resources.ts`, `state.ts`, `room.ts`, `perspective.ts`, `walk.ts`, `actions.ts`, `talk.ts` (socle de la réplique),
  `script.ts` (points d'extension de la vague P), `rooms/index.ts` (registre vide), `loop.ts` (`DrasculaEngine`) ; tests dans `test/drascula/engine/` (`sequence`, `actions`, `walk`, `engine`, hôte de test `test-host.ts`) ; `docs/drascula/engine.md`.
  Critère de fin atteint en test sans rendu : chaque chapitre démarre dans sa pièce, les 57 pièces se chargent dans leur chapitre, on marche, on franchit une porte, on regarde, on prend un objet (gestionnaire de test),
  on utilise l'inventaire et la barre des verbes ; les 307 lignes de `roomActions` répondent. Écarts au plan :
  - un tick vaut 10 ms (`TICK_MS`, l'unité de `getTime()` de ScummVM), une image de la boucle principale 5 ticks ; module `cadence.ts` ajouté (le plan mettait l'horloge dans `loop.ts`) ;
  - `talk.ts` existe dès G (réplique simple : sous-titre, voix, coupure par une touche), la vague T l'étendra ; `resources.ts`, `room.ts` et `script.ts` ajoutés ;
  - `graphics.md` n'est pas écrit en G (rien de graphique n'y est fait) : la perspective est décrite dans `engine.md`, le reste ira en R ;
  - sens des champs `.ALD` et chapitre de chaque pièce tranchés dans `engine.md` (§ 5), sans toucher à `formats.md` : à reporter dans `formats.md` (« Supposé » des `.ALD`) ;
  - aucun module commun modifié.
- **Vague A (son) faite** : E3 `src/audio/web-sample-output.ts` (+ `test/shared/web-sample-output.test.ts`, faux contexte `test/support/fake-audio-context.ts`) ; `src/games/drascula/audio/` (`voice.ts`, `music.ts`, `audio.ts`) ; tests `test/drascula/audio/audio.test.ts` (fin de voix, relance de piste, piste par pièce, coupure sans décalage, pause de l'onglet) ; `docs/drascula/audio.md`.
  Aucun module commun existant modifié, aucun autre jeu migré. E2 (fondu) non fait en A : fait en vague C (`TrackPlayer.volume`). Reste à brancher `DrasculaAudio` dans l'hôte du navigateur (voir `audio.md`) ; l'écoute (`3.ALS`, pistes) reste à faire.
- **Vague R (rendu) faite** : `src/games/drascula/render/` : `plane.ts` (surfaces 320 x 200, `copyBackground`, `copyRect`, héros réduit), `palette.ts` (palette 6 bits, `HALF_PAL`, lumière de pièce `bright` / `dark`, fondus, couleur du texte), `font.ts` (police du jeu, choix de dialogue, texte centré),
  `renderer.ts` (surfaces et images d'un chapitre / d'une pièce, composition : décor, `roomPreUpdates`, héros, `roomUpdates`, réplique, nom survolé, inventaire, barre des verbes, curseur) ; `DrasculaHost.present(pixels, palette)` appelée par `DrasculaEngine.render()` (que l'hôte appelle à chaque image d'écran ; `loop.ts`, `DrasculaEngine.gfx`),
  `fadeToBlack` / `fadeFromBlack` / `black` ; page `ui/render-dev.html` (outil) ; tests dans `test/drascula/render/` (`plane`, `palette`, `font`, `renderer`, `engine-render`) ; `docs/drascula/graphics.md`. Critère de fin atteint : les 57 pièces se composent dans leur chapitre, le texte français
  accentué est rendu (vu dans le navigateur aux chapitres 1, 2 et 4). Écarts et constats :
  - code de la visionneuse mutualisé : les palettes (`scummvmRgb8`, `halfPalette`…) et la police (table, glyphes, dessin du texte) sont passées de `ui/viewer-data.ts` à `render/palette.ts` et `render/font.ts`, que la visionneuse réutilise ;
  - tranché : un seul octet des textes français n'a pas de glyphe, le `Ï` de « AÏOLI » et « AÏE » (`text` 166 et 218), rendu avec le glyphe précédent comme ScummVM ; sens des champs `.ALD` et chapitre de chaque pièce reportés dans `formats.md` ;
  - l'image est recomposée à chaque `render()` depuis l'état et le curseur est dessiné dans l'image (curseur logiciel) ;
  - `Subtitle` (`engine/talk.ts`) gagne une couleur facultative ; pas de module commun modifié ;
  - non fait, renvoyé : têtes qui parlent (T), cinématiques et images externes (C), `update_N` propres aux pièces (accroches `renderer.painters`, P), précharge des images par l'hôte du navigateur (J), comparaison à des captures de ScummVM (aucune sous la main).
- **Vague T (dialogues) faite** : `engine/talk.ts` (réplique : voix, sous-titre, tour de visage ; `TalkLine`), `engine/talkers.ts` (une vingtaine de personnages et `placeVonBraun`), `engine/dialogs.ts` (`talkSequences`, `converse`, `response`), `render/heads.ts` (les têtes), `render/actors.ts` (Igor, Drascula, Von Braun), `docs/drascula/talk.md` ;
  tests `test/drascula/engine/talk.test.ts`, `dialogs.test.ts`, `render/takeover.test.ts`. Critère de fin atteint en test : les cinq scénarios du chapitre 1 (2, 3, 10, 11, 12) joués de bout en bout (voix, textes, couleurs, durée = durée des voix), un dialogue à choix complet (survol, clic, réponse, sortie), les 13 `.CAL` et les 225 lignes de `talkSequences` ; vu dans le navigateur : la réplique du héros avec sa bouche, le menu des choix, Drascula en gros plan et Igor. Décisions et écarts :
  - **prise de main sur l'image** (`graphics.md` § 11) : `gfx.owner` (pièce ou image libre `canvas`), `engine.head` (vue de réplique + `Scene` : `background`, `pre`, `hero`, `post`), `engine.choices` ; aucun contournement de `compose` ;
  - les attentes d'une réplique sont protégées du saut (`unskippable`) : Échap ne coupe que la réplique, comme l'original ; `talk_drascula_big` en fait un saut de la cinématique ;
  - `roomPreUpdates` s'applique **avant** l'accroche `update_N_pre` (l'ordre de la vague R était inversé) ;
  - ajouts à l'état : `igor`, `drascula`, `vonBraun`, `colorSolo`, `savedTime` ; `GameFont.measureChoice` ; `engine.takeClick()` ;
  - non fait, renvoyé : animations de pièce propres aux réponses du chapitre 2 (`16_2`…) et gestionnaires qui appellent `converse` (P) ; pause de la voix à la barre d'espace, sous-titres désactivables (J) ; positions de bouche des personnages autres que le héros, Drascula en gros plan et Igor : à voir.
- **Vague C (cinématiques) faite** : `cinematics/player.ts` (`playSsn`, `animate`), `cinematics/sequences.ts` (logos, histoire, introduction, château, début du chapitre 6, fin du jeu, générique ; `CINEMATICS`), `cinematics/index.ts` ; `musicFadeout` dans le moteur (`engine.md` § 9) ;
  **E2 faite, a minima** : `TrackPlayer.volume` (`src/audio/track-player.ts`, accesseur ajouté, rétrocompatible, une ligne de test ajoutée à `test/shared/track-player.test.ts`) ; **jeux qui utilisent `TrackPlayer`** : Lost in Time (`html-cd.ts`), SWIV 3D (`music.ts`, `ui/app.ts`, `panels/media.ts`) et Drascula : les deux premiers n'appellent pas `volume`, leurs tests passent ; `host.setMusicVolume?` facultatif ; `DrasculaMusic.volume`, `DrasculaAudio.setMusicVolume` ;
  tests `test/drascula/cinematics/player.test.ts` (`LOGODDM.BIN` et `QPC.BIN` image par image, `LEV.BIN` en animation, cadence, palette, sauts) et `sequences.test.ts` (logos, histoire, introduction complète et sautée à six moments, château, générique, fin, début du chapitre 6, fondu de la musique). Critère de fin atteint : l'introduction joue de bout en bout (~6 min de temps du jeu) et Échap la passe à tout moment. Vu : logos, `QPC.BIN` (texte français), scène de Drascula. Écarts :
  - **chaque fin de chapitre attend le fondu de la musique** (1,05 s, `endChapter` : comme ScummVM) : trois tests du moteur ont gagné une attente ;
  - les cinématiques sont fournies par `CINEMATICS` (le jeu les branche par `GameScript.animations`, vague J) : sans elles les tests commencent dans l'auberge ;
  - un saut ne concerne que ce qui joue (ScummVM garde `term_int` levé) ; le texte de `talk_solo` ne reste pas à l'écran après la réplique ; le défilement de l'introduction est à 2 ticks par colonne (à mesurer) ;
  - le chapitre 1 charge `2aux62.alg` dans `draw2` après l'introduction (`runCurrentChapter`), le chapitre 4 remet les feuilles après le château ;
  - non fait, renvoyé : cinématiques propres aux pièces (P), préchargement des `.BIN` par l'hôte du navigateur (J), écoute de la musique des cinématiques (thèmes 29, 26, 4, 11, 23, 2, 17, 3).
- **Vague P (pièces) : terminée (les six chapitres)**, chapitre 1 d'abord comme modèle : `engine/rooms/` réorganisé en un dossier par chapitre (`chapter-1/` rempli : `ids.ts`, `room-62.ts`, `bj-scene.ts`, `index.ts` ; `chapter-2/` à `chapter-6/` : `ChapterScript` vides déjà importés), `rooms/assemble.ts` (fusion des tables, points globaux appelés pour le chapitre en cours, doublons refusés),
  `rooms/index.ts` (assemblage seul : `drasculaScript`, avec `CINEMATICS`) ; moteur : `GameScript.painters` et `GameScript.tick`, type `ChapterScript`, `GameState.anim`, `DrasculaRenderer.dat` public et `shake` (hoquet), `DrasculaEngine.updateDoor` public ; `engine/room-kit.ts` (`roomObject`, `setVisible`, `setDoor`, `toggleDoor`, `hiccup`) ;
  `ui/render-dev.ts` monte `drasculaScript` (`?videos=1` précharge les `.BIN`). Chapitre 1 : `room_62`, `update_62_pre`, `update_62`, `animation_3_1`, `animation_4_1`, `animation_2_1` (cinématique de B.J., fin du chapitre), porte 105 refusée tant que le drapeau 0 est bas ; pièce 63 sans gestionnaire (rien à écrire, testée) ;
  tests `test/drascula/rooms/` (`walkthrough.ts` : joueur scripté commun ; `assemble`, `room-kit`, `chapter-1/room-62`, `room-63`, `walkthrough` : 45 tests) ; `docs/drascula/rooms.md` (convention, § « Ajouter un chapitre » ; chapitre 1 en § 7). Chapitres 2 à 6 portés ensuite par un agent chacun, dans leur dossier seulement (`rooms.md` § 1 ; `rooms-chapter-N.md`). Écarts : voir `rooms.md` § 7
  (cadence d'avance des animations de l'auberge : 70 ms, `anim` / `tick` séparés du dessin ; distributeur de la pièce 63 numéroté 103 sur la fiche et 108 dans `roomActions` ; `.BIN` de `animation_2_1` à précharger en vague J).
- **Consolidation de la vague P (faite)** : besoins partagés remontés par les chapitres.
  - Texte de l'ivrogne « ¡L Y A LONGTEMPS » : **pas un bug**, le glyphe « I » de `95.ALG` est un point + un trait (comme « ¡ »), identique dans ScummVM ; documenté et testé (`test/drascula/render/font-original.test.ts`).
  - `Dialogs.respond` : `converse.cpp` récupéré dans la référence locale ; l'ordre scénario puis animation est celui de ScummVM (sauf 31) ; la branche « drapeau 33 bas » d'`animation_29_2` y est inatteignable aussi : gardé, documenté.
  - `MAP_ROOMS` : pièce 2 ajoutée, `tickCrossroads` ne refait plus `showMap`.
  - `GameScript.painters` rangé par (chapitre, pièce) ; garde `chapter === 2` retirée ; B.J. debout dans la chambre du chapitre 1 (`update_16_pre`) maintenant dessinée (`bedroomPainter`, test `chapter-1/room-16.test.ts`).
  - Héros invisible de la pièce 45 : la marche est arrêtée quand le héros est ramené à (0, 0) (`hero.moving` ne reste plus vrai ; rien de visible ne change).
  - Tests : `Walkthrough({ settle: false })` (chapitre 6 simplifié) ; `test/drascula/solutions.ts` (`solveChapterN`, partagées avec les passages de chapitre) et `test/drascula/full-game.test.ts` (chapitre 1 au générique, un seul moteur).
  - Duplications : `engine/inn-kit.ts` (auberge des chapitres 1 et 2), `freezeRoom` / `pose` dans `engine/room-kit.ts` (chapitres 2 et 5). Restent propres aux chapitres : `updateAnim`, `drawRect`, `bareHiccup`, `setLight` du chapitre 2 (un seul utilisateur).
- Aucune source de rétro-ingénierie propre au dépôt (pas de Ghidra) : la **référence de comportement est le moteur `drascula` de ScummVM**
  (`engines/drascula/`, GPL v3+), lu pour comprendre ; voir « Convention vis-à-vis de ScummVM ».

- **Vague S (sauvegardes) faite** : `engine/save.ts` (`SaveData` versionnée, `snapshotState`, `restoreState`, `parseSave`), `DrasculaEngine.saveGame()` / `loadGame(data)` / option `restore`, point d'extension `GameScript.restored` (chapitre 6 : pendule), `ui/saves.ts` (`SaveSlots`, `saveToSlot`, `loadFromSlot`, `SAVE_PREFIX = "drascula:"`, 10 emplacements), `copy.ts` (textes des sauvegardes) ; tests `test/drascula/save/` (`save`, `slots`, `engine`, `chapters` : aller-retour à chaque repos de la solution de chacun des six chapitres, dans un moteur neuf puis en cours de partie d'un autre chapitre) ; `engine.md` § 10. Écarts :
  - **contenu** : plus que ScummVM (qui garde chapitre, pièce, héros, inventaire, drapeaux et objet en main) : animations (`anim`), `savedTime`, Igor, Drascula, Von Braun, objets de la pièce (visibilité, portes, zones), excuses, musique ; le temps du moteur (`ticks`) est repris pour que les dates de l'état restent valables ;
  - **restauration** : comme `loadGame` de ScummVM, un chapitre neuf (`startChapter`) puis `enterRoom` (musique, `roomLoaded`, séquences d'entrée de la pièce rejouées), l'état sauvegardé étant remis juste après `roomLoaded` ; l'inventaire ouvert se referme (comme ScummVM) ; la feuille du chapitre de `draw2` est rechargée (chapitres 1 et 6) ;
  - **permis** : seulement hors séquence (`canSave`) : ni pendant les cinématiques et les répliques, ni pendant le menu des choix d'un dialogue (`converse` n'active pas `_canSaveLoad` dans ScummVM) ;
  - **écart d'image toléré** (chapitre 6, après le pendule) : le héros « de face » est dessiné de profil dans la partie qui a joué `animation_6_6` (`97.ALG` laissé dans `front`, comme ScummVM) et de face après un chargement ;
  - raccourcis de ScummVM : F7 charge, F10 sauvegarde (F9 est le volume) : à brancher en J avec le sélecteur ; la graine du hasard n'est pas sauvegardée ; pas de noms de pièces dans les données du jeu : la description d'un emplacement dit « Chapitre N, pièce P » et la date ;
  - aucun module commun modifié.
- **Vague J (intégration) faite** : `src/games/drascula/ui/` : `app.ts` (page du jeu sur `mountGameShell`, chargement avec progression, boucle `TickScheduler` + `engine.render()`, pauses, fenêtres), `browser-host.ts` (`BrowserHost` : fichiers préchargés, `DrasculaAudio`, entrées, sauvegardes préfixées `drascula:` ; sans DOM, testé), `preload.ts` (`FileStore`, `ChapterLoader`, `CHAPTER_VIDEOS`), `input.ts` (`InputQueue`), `keys.ts`, `title.ts` (Nouvelle partie / Continuer / Charger), `slot-dialog.ts` (dix emplacements, confirmation avant d'écraser), `menu-dialog.ts`, `volume-dialog.ts`, `help.ts` (aide, crédits, licences, mention de version modifiée), `style.css`, `dev.html` / `dev.ts` (`window.__drascula`), `index.ts` (`GameDefinition`, entrée de `registry.ts`), `copy.ts` complété (textes finals et noms des lieux), `scripts/drascula-cover.mts` + `original/drascula/COVER.png` (l'auberge ; `files.json` régénéré : 1 147 fichiers), section / tableau / licence du `README.md`. Cinématiques branchées : `drasculaScript` (avec `CINEMATICS`) est le script du jeu réel ; l'introduction se joue au premier lancement et se saute à Échap.
  Tests : `test/drascula/ui/` (`input`, `preload`, `browser-host`, plus `panels` pour la jaquette), `rooms/chapter-6/room-61.test.ts` (touche 0), `save/slots.test.ts` (noms de lieux). Décisions et écarts :
  - **préchargement** : données, fiches, dialogues et **toutes** les images (5,7 Mo) au départ (les ~90 feuilles hors numérotation servent à des cinématiques ou à des pièces de plusieurs chapitres : un découpage par chapitre risquerait une image manquante en pleine partie pour un gain minime) ; **vidéos par chapitre** (`CHAPTER_VIDEOS`, vérifié contre le code par un test) : le chapitre de départ et le suivant avant de commencer (l'introduction pèse 15 Mo), les suivants en fond, et le moteur n'avance pas tant que son chapitre et le suivant ne sont pas prêts (pastille « chargement du chapitre suivant ») ; un chargement de sauvegarde attend les vidéos de son chapitre ; voix `.ALS` et musique à la demande, jamais préchargées. `CDR.BIN` n'est lu par aucune cinématique (non préchargé) ;
  - **toucher** : un appui qui suit un saut de position est retardé de deux images (`InputQueue`, `TAP_DELAY_TICKS`), ce qui traite le cas « tap juste après la barre des verbes » de `rooms.md` § 7 pour le doigt comme pour une souris téléportée ; toucher l'écran pendant une réplique la coupe (touche Entrée) ; bouton « Passer » (Échap) et « Pause » dans la barre tactile ;
  - **touches de l'hôte** : F10 sauvegarder, F7 charger (fenêtre des dix emplacements, jamais pendant une séquence : message `saveBusy`), F9 volume de la musique (curseur, mémorisé ; se combine au fondu du moteur), T sous-titres (`engine.subtitlesEnabled`, mémorisé, ajouté au moteur), Espace pause pendant une voix (tick et son suspendus), 0 dans la pièce 61 (`frame` du chapitre 6 : `alcbar.alg` en décor) ; bouton « Menu » qui réunit tout cela pour le tactile ;
  - **non faits** : Échap hors cinématique (quitter, `kActionQuit`) : le lien « Tous les jeux » en tient lieu ; `v` (voix seulement) : le bouton « Son » coupe tout ; les sauvegardes d'origine (`GSAVE*`) ;
  - modules communs : aucun modifié ; `registry.ts` et `README.md` : lignes de Drascula seulement.

## Décisions

- **Version et langue** : français seulement. Textes (`text`, `textd`, … `textmisc`, lignes d'index 3) de `drascula.dat`, noms d'objets des `.ALD` français, répliques des `.CAL`
  français, `QPC.BIN` français ; **voix anglaises** (`Packet.001`) avec les textes français en sous-titres. Pas de sélecteur de langue. Les packs allemand, espagnol et italien ne sont pas versionnés (ils restent dans `archives/`).
- **Données lues à l'exécution, comme les autres jeux** : le code ne contient aucune donnée du jeu. Il lit `original/drascula/` (fichiers extraits, servis tels quels), y compris `drascula.dat`, analysé dans le navigateur
  (`data/dat.ts`). Aucune conversion à l'avance des textes ou des tables en TypeScript : la source de vérité reste le fichier de ScummVM, qu'on peut remplacer sans toucher au code.
- **Tables et logique du jeu** : `roomActions`, `talkSequences`, `roomUpdates` viennent de `drascula.dat` (données). Les gestionnaires de pièces (`room_N`) et les cinématiques n'ont **pas** de script dans les données (voir `formats.md`) : ils sont réécrits en TypeScript.
- **Moteur propre au jeu**, sur le modèle d'Armaeth et de Lost in Time : `Host` seule frontière avec le navigateur (`BaseHost` étendu), moteur sans tête testable avec un faux hôte,
  aucune attente bloquante dans le tour de jeu (voir « Séquences » plus bas).
- **Aucun écart voulu avec l'original** par défaut : les erreurs de texte et les comportements singuliers (majuscules accentuées, `texthis` en casse mixte, voix de `3.ALS`…) sont reproduits ; toute correction est décidée au cas par cas et documentée.
- **Sauvegardes** : pas de lecture des `GSAVE*` d'origine ni du format ScummVM. Emplacements dans le stockage commun (`HostStorage`, préfixe `drascula:`), un état sérialisé en JSON par emplacement avec version et description (voir vague S).
- **Son** : voix PCM (`.ALS`) et musique OGG/MP3 ; pas d'AdLib ni de Sound Blaster à émuler (contrairement à Armaeth et Lost in Time). Aucun module OPL2.
- **Alea** : générateur à graine injectable du dépôt (`src/engine/rng.ts`, `Lcg`) ; le préréglage exact de l'original n'est pas connu (pas de table de ScummVM à reprendre) : on prend `msvcRand` par défaut, sans valeur historique.
- **Rendu** (décision validée) : même choix qu'Armaeth. `mountGameShell` avec `logicalWidth: 320`, `logicalHeight: 200`, **sans option `buffer`** (pixels carrés, canvas 320x200) et `fit` par défaut (`"integer"` : échelle entière quand c'est possible). Pas d'affichage 4:3.
- **Musique** (décision validée) : conversion OGG -> MP3 joint stereo 44,1 kHz, **80 kb/s CBR**, en-tête Xing, métadonnées retirées, `-fflags +bitexact` (modèle `scripts/lost-in-time-music.sh`) : `scripts/drascula-music.sh` produit `original/drascula/track1.mp3` à `track31.mp3` (29 Mo au lieu de 36,9 Mo en OGG).
- **Voix `.ALS`** (décision validée) : gardées brutes (PCM 8 bits non signé, 11 025 Hz), sans recompression ni décodage préalable.
- **Module son commun E3** (décision validée) : oui, `src/audio/web-sample-output.ts` ; à faire en **vague A** (pas avant), sans migrer les autres jeux dans ce chantier.
- **Textes anglais dessinés** dans `INTRO.BIN` (générique « Music: … ») et `CRD.BIN` (décision validée) : gardés tels quels, comme chez ScummVM ; aucune retouche.

## Convention vis-à-vis de ScummVM (alignée sur Lost in Time)

- Lost in Time n'a pas de document de plan propre ; sa convention est : **commentaires en tête de module et dans le code** qui citent le fichier de ScummVM dont le comportement est repris
  (« port de gob/save/saveload_v3.cpp », « comme ScummVM… »), **README** qui dit « d'après le moteur `gob` de ScummVM » et section **Licence** qui nomme ScummVM, code du dépôt sous GPL v3 ou ultérieure, données des jeux exclues
  de la licence. Le module OPL2 (`src/audio/opl2.ts`) porte en tête la mention d'origine, la licence et les écarts volontaires.
- Pour Drascula, on s'y aligne :
  - chaque module de moteur dont le comportement vient de ScummVM cite le fichier de référence en tête (`rooms.cpp`, `talk.cpp`, `graphics.cpp`, `sound.cpp`, `animation.cpp`, `actors.cpp`, `objects.cpp`, `interface.cpp`, `drascula.cpp`) et note ses écarts volontaires ;
  - on lit pour comprendre, puis on réécrit en TypeScript (structures et noms du dépôt, pas de transposition ligne à ligne) ; les gestionnaires de pièces suivent la logique de ScummVM mais sont découpés par pièce et par chapitre ;
  - `README.md` : section « Drascula » (jeu, état, fichiers de données) alignée sur « Lost in Time », ligne ajoutée au tableau des jeux et à la section Licence (« les moteurs de Lost in Time et de Drascula sont portés de ScummVM »). Ces modifications sont faites en vague J, pas dans ce plan ;
  - `drascula.dat` est un fichier de ScummVM (GPL v3+) : il reste dans `original/drascula/` avec une note de provenance à côté (voir ci-dessous) ; il est séparé de la licence « propriété des ayants droit » des données du jeu.

## Ce qui est versionné dans `original/drascula/`

Comme les autres jeux : fichiers extraits à plat par un script, servis tels quels, listés par `files.json`. Sources dans `archives/` (non versionnées) :
`drascula-1.0.zip`, `drascula-int-1.1.zip`, `drascula-audio-2.0.zip`, `drascula.dat`.

| Fichiers | Source | Nombre | Poids | Versionné |
| --- | --- | --- | --- | --- |
| `*.ALG` (images) | `Packet.001` | 225 | 5,7 Mo | oui |
| `*.ALS` (voix et sons) | `Packet.001` | 783 | 32,2 Mo | oui (bruts) |
| `*.BIN` (vidéos) | `Packet.001`, avec `QPC.BIN` de `PACKET.002` | 33 | 23,0 Mo | oui |
| `*.ALD`, `OP_*.CAL` | `PACKET.002` (français), en remplacement de ceux de `Packet.001` | 57 + 13 | 23 Ko | oui |
| `drascula.dat` | `archives/drascula.dat` | 1 | 253,5 Ko | oui, avec sa note de provenance |
| musique `track1.mp3` à `track31.mp3` | `drascula-audio-2.0.zip` (`audio/track1..31.ogg`), convertie en MP3 80 kb/s | 31 | 29 Mo (mesuré) | oui |
| `README-ALCACHOFA.txt`, `README-ALCACHOFA-INT.txt` | `readme.txt` du zip de base (licence d'Alcachofa Soft) et du pack international | 2 | 6 Ko | oui, **obligatoire** (la licence interdit de le retirer) |
| `COVER.png` | généré par `scripts/drascula-cover.mts` (vague J), comme Armaeth | 1 | 30 Ko | oui |
| `files.json` | `scripts/manifest.py` | 1 | quelques Ko | oui |

Poids total versionné mesuré : **89,7 Mo** (1 147 fichiers avec `files.json` ; musique 29 Mo, voix 32 Mo, reste 28,7 Mo) ; comparable à `mathemagique` (89 Mo) et `swiv3d` (87 Mo), loin de `teleportaschtroumpf` (195 Mo).

Non versionné (reste dans `archives/drascula/`, pour référence) : les EXE et fichiers DOS de `Packet.001` (`DOS4GW`, `SETUP`, `LOGODDM`, `HACKER*`, `IGOR`, `PENDULO`, `YODA`, `GHOST.DRV`, `*.DEV`, `DRASCULA.COM`, `GSAVE*`, `drascula.doc`) et les packs allemand, espagnol et italien extraits.

Licence des données (texte de `readme.txt`, à conserver avec les fichiers) : redistribution libre et gratuite ; le readme et les mentions de copyright doivent rester intacts ; on ne peut pas faire payer le jeu lui-même ; toute version modifiée doit porter une mention bien visible
(le portage en est une : la page d'aide du jeu l'indiquera). Le copyright des données reste à Alcachofa Soft ; le moteur ScummVM est à l'équipe de ScummVM.
`drascula.dat` est garanti sous la licence de ScummVM : `original/drascula/drascula-dat-LICENSE.txt` (mention de provenance : URL du dépôt ScummVM, version 7, GPL v3+) créée à côté (source : `scripts/drascula/drascula-dat-LICENSE.txt`). **Vérifié** (vague X) : le `.dat` est identique à `dists/engine-data/drascula.dat` de ScummVM (master), le dépôt est sous GPL v3 ou ultérieure (`COPYING`, en-têtes de `engines/drascula/` et `devtools/create_drascula/`).

**Scripts d'extraction** (sur le modèle de `scripts/armaeth-extract.sh` et `scripts/lib/`) :
- `scripts/drascula-extract.sh [zip de base [zip international [drascula.dat]]]` (la musique a son script) : défauts dans `archives/`. Extraction des zip (`bsdtar`), des ARJ (`7zz`, déjà requis par les autres scripts), copie des seuls fichiers utiles dans un dossier temporaire, remplacement des `.ALD`, `.CAL` et `QPC.BIN`
  par les français, ajout de `drascula.dat` et des textes de licence, `files.json` (`scripts/manifest.py`), inventaire `docs/drascula/files.md`, puis substitution d'un bloc dans `original/drascula/` (`ec_publier`). Conserve `COVER.png` et les `track*.mp3` (`ec_conserver`) ; aide Python `scripts/drascula/extract_utils.py` (copie filtrée, inventaire). Extractions complètes (pour référence, dont les packs des autres langues) dans `archives/drascula/` (non versionné). Outils : `bsdtar`, `7zz`, `python3`.
- `scripts/drascula-music.sh` : OGG -> MP3 (ffmpeg), MP3 80 kb/s ; sortie dans `original/drascula/` ; même méthode que `scripts/lost-in-time-music.sh` (pas de padding, métadonnées retirées). 
- `scripts/drascula-cover.mts` : jaquette depuis une image du jeu (décor `.ALG` + palette), avec `scripts/lib/png.mts`.
- Aide Python : `scripts/drascula/extract_utils.py` seulement si le shell ne suffit pas (importe `scripts/lib/extract_common.py`, comme les autres jeux ; lancé en `python3 -I`).

## Architecture

```
src/games/drascula/
  index.ts            GameDefinition (écran de titre, import dynamique de l'app)
  copy.ts             textes de la page (titre, description, boutons, erreurs) ; les textes du jeu viennent de drascula.dat
  data/               lecteurs purs (sans DOM) des fichiers : rle.ts, alg.ts, text-resource.ts, ald.ts, cal.ts, bin-ssn.ts, bin-animate.ts, als.ts, dat.ts, files.ts
  engine/             moteur sans tête
    host.ts             DrasculaHost (étend BaseHost) : chargement, image, palette, sons, musique, entrées
    state.ts            état du monde : chapitre, drapeaux, inventaire, pièce, héros, objets visibles
    loop.ts             boucle principale, horloge, entrées, verbes
    sequence.ts         exécuteur de séquences (voir « Séquences »)
    rooms/              un module par pièce ou groupe de pièces d'un chapitre (room-NN.ts) + registre
    cinematics/         séquences scriptées (intro, chapitres, fins)
    talk.ts, dialogs.ts répliques, voix, choix de dialogue, `talkSequences`
    walk.ts, perspective.ts  déplacements et facteur d'échelle du héros
    actions.ts          verbes, `roomActions`, objets, combinaisons
    save.ts             sérialisation de l'état
  render/             composition (décor, sprites, héros réduit, texte), palette (niveaux, fondus), police
  audio/              voix (sortie PCM), musique (plan sonore), choix des pistes
  ui/                 app.ts (page du jeu), browser-host.ts, title.ts, saves.ts, panels.ts, help.ts, asset-viewer.ts + .html, dev.html, style.css
test/drascula/        tests des lecteurs, du moteur, des pièces, du parcours
scripts/drascula-extract.sh, drascula-music.sh, drascula-cover.mts
original/drascula/    données (voir ci-dessus)
docs/drascula/        formats.md, plan.md, files.md (généré), puis engine.md, rooms.md, talk.md, screens.md, graphics.md
```

Le moteur est un module pur : tout ce qui touche au navigateur (canvas, Web Audio, `localStorage`, `fetch`) passe par `DrasculaHost` et vit dans `ui/`. `TestHost` (faux hôte) dans `test/support/` ou `test/drascula/helpers.ts`.

### Séquences (le point d'architecture central)

Le moteur de ScummVM fonctionne en **attentes bloquantes** : chaque cinématique et chaque dialogue est un code linéaire qui appelle `talk()`, `pause()`, `delay()`… jusqu'à la fin du son ou du temps, en boucle sur le thread principal. Ce n'est pas possible dans le navigateur, et la règle du dépôt est de ne jamais bloquer dans le tour de jeu.
Choix : des **générateurs** (`function*`) qui `yield` une condition d'attente (« attendre n ticks », « attendre la fin de la voix », « attendre un clic », « attendre la fin du déplacement »), exécutés par `sequence.ts` à chaque tour de jeu.
Avantage : on garde le code linéaire des gestionnaires de pièces et des cinématiques (relecture simple contre ScummVM), et les tests avancent le temps d'un faux hôte. Les gestionnaires `room_N` d'un verbe qui parlent et déplacent sont aussi des séquences.
Cas limites : saut de séquence (Échap), changement de chapitre pendant une séquence (`_loadedDifferentChapter` de ScummVM : abandon propre), sauvegarde pendant une séquence (interdite, comme dans l'original ; voir vague S).

### Cadence

La cadence d'origine est lue dans ScummVM (`delay`, `pause` = 15 ms x 2 par unité, `playFLI(nom, vitesse)` en images par seconde, boucle principale) : c'est un point **à confirmer** et à documenter dans `engine.md` ; le moteur fonctionne en ticks fixes (`FixedStepClock`) dont la durée est une constante unique, et chaque séquence compte en unités de `pause`.

## Réutilisé tel quel, étendu, spécifique

**Réutilisé tel quel (aucune modification) :**
- `src/ui/game-shell.ts` : page du jeu (320x200, échelle, plein écran, pause onglet caché, bouton Son, erreurs).
- `src/ui/indexed-canvas.ts` : `IndexedPresenter`, `paletteToLut` et `vga6ToRgb8` (palettes 6 bits des `.BIN` ; les `.ALG` sont en 8 bits et vont directement dans `paletteToLut`).
- `src/ui/pointer.ts` (`bindCanvasPointer`, `bindKeyboard`, appui long tactile : clic gauche, clic droit ou appui long, déplacement), `src/ui/touch-controls.ts` (si utile).
- `src/ui/files.ts` (`fetchBytes`, `MissingFilesError`), `src/data/game-files.ts` et `scripts/manifest.py` (`files.json`, noms insensibles à la casse : indispensable ici, le jeu appelle `"214.als"`, `"BJ1.als"`…), `src/data/reader.ts` (`BinaryReader`).
- `src/engine/host.ts` (`BaseHost`), `src/engine/storage.ts` (`HostStorage`, `MemoryStorage`, `prefixedStorage`), `src/ui/local-storage.ts`, `src/engine/clock.ts` (`FixedStepClock`), `src/engine/rng.ts` (`Lcg`).
- `src/audio/pcm.ts` (`u8ToFloat32`, `createMonoBuffer` : les `.ALS` sont du PCM 8 bits non signé), `src/audio/track-player.ts` (une piste entière par pièce, lecture en flux, `onEnded` pour relancer).
- `src/ui/sound-prefs.ts` (préférence « Son » : `retrovibe:drascula:sound`), `src/ui/title-screen.ts`, `src/ui/copy.ts`, `src/ui/dom.ts`.
- `src/ui/asset-viewer/` (mécanique de la visionneuse ; panneaux propres au jeu).
- `scripts/lib/extract-common.sh` (`ec_*`), `scripts/lib/png.mts`, `scripts/manifest.py`, `test/support/original.ts` (`originalFiles("drascula", "drascula.dat")`), `test/support/fake-host.ts` (`ManualClock`, `FakeStorage`).

**Étendu (modification d'un module commun, à signaler : voir « Évolutions de modules communs ») :**
- `src/data/` : ajout de `cp850.ts` (décodage CP850 : `drascula.dat`, `.ALD`, `.CAL`), sur le modèle de `cp437.ts`.
- `src/audio/` : socle Web Audio commun (E3) ; éventuellement un réglage de volume pour `TrackPlayer` (E2).
- `src/games/registry.ts`, `README.md` : une ligne par jeu (voir vague J).

**Spécifique à Drascula :** les lecteurs `.ALG` / `.ALD` / `.CAL` / `.BIN` / `.ALS` / `.dat` (aucun lecteur PCX ni delta XOR n'existe ailleurs dans le dépôt), toute la logique (état, verbes, pièces, cinématiques, dialogues, marche), la composition et les palettes de pièce, la police à table de caractères, l'interface (barre de verbes, inventaire, menu des dialogues), les écrans, les sauvegardes (format propre), la page d'aide.

## Évolutions de modules communs proposées

| N° | Fichier | Évolution | Pourquoi | Risque de régression | Statut |
| --- | --- | --- | --- | --- | --- |
| E1 | `src/data/cp850.ts` (nouveau) | Décodage et encodage CP850, même API que `cp437.ts` (`decodeCp850`, table inverse). Option : factoriser la construction de table avec `cp437.ts` dans un helper commun. | Les textes, `.ALD` et `.CAL` sont en CP850 (`TextDecoder` ne gère pas ce code) | Nul pour la version minimale (nouveau fichier). Le helper commun toucherait `cp437.ts`, utilisé par Armaeth, Téléportaschtroumpf et Indy : à ne faire qu'avec ses tests | fait (minimal, vague D) ; refactor optionnel |
| E2 | `src/audio/track-player.ts` | Seulement si nécessaire : volume ou fondu (ScummVM n'a que `MusicFadeout`, fin de chapitre et cinématiques). | Fidélité au comportement | Faible : Lost in Time et SWIV 3D l'utilisent (`start`, `end`, `loop`, `onEnded`) ; l'ajout d'un accesseur ne change pas l'existant ; test de `track-player` étendu | **fait (vague C)** : accesseur `volume` seul |
| E3 | `src/audio/web-sample-output.ts` (nouveau, extrait de `lost-in-time/engine/audio/web-audio.ts`) | Contexte Audio créé après un geste (`unlock`), gain général, coupure du son sans arrêter les sources, suspension de l'onglet masqué, lecture d'un échantillon avec rappel de fin. | Sept implémentations de `createBufferSource` coexistent (Lost in Time, Téléportaschtroumpf, SWIV 3D, Mathémagique/Zoombinis `mohawk/web-sink.ts`…) : en créer une huitième serait dupliquer ; l'attente de fin de voix est centrale ici | Drascula seul l'utilise au départ : aucun risque pour les autres jeux. **La migration des autres jeux n'est pas dans ce chantier** ; la faire plus tard demande leurs tests audio. Risque assumé : ne pas migrer laisse ce module à côté des autres jusque-là | à valider (décision 4) ; repli : implémentation locale `src/games/drascula/audio/` |
| E4 | `src/ui/indexed-canvas.ts` | Aucune évolution prévue. Les niveaux de palette et fondus sont propres au jeu (`render/palette.ts`). Si un autre jeu avait besoin des mêmes fondus, promouvoir ensuite. | Éviter de généraliser avant d'avoir un deuxième usage | Nul | aucune |
| E5 | `src/ui/game-shell.ts` | Aucune évolution prévue. Pixels carrés comme Armaeth (décision validée), sans option `buffer`. | | Nul | aucune |
| E6 | `src/games/registry.ts`, `README.md` | Une ligne chacun (+ section et licence pour le README). | Enregistrer le jeu | Nul (ajout) | vague J |

## Vagues

Chaque vague se termine par `npm run typecheck`, `npm test`, `npm run build` (il n'y a pas de script `lint` dans `package.json` : on s'en tient à ces trois commandes) et, dès qu'il y a un rendu, une vérification dans le navigateur (responsive, états chargement / erreur, clavier, tactile).
Les modules de données et le moteur sans tête sont purs, testés sans DOM.

| Vague | Tâche | Contenu (fichiers) | Tests | Critère de fin | Dépend de |
| --- | --- | --- | --- | --- | --- |
| X | extraction | `scripts/drascula-extract.sh`, `drascula-music.sh`, `drascula-cover.mts` (cover reportée en J), `original/drascula/` (+ `files.json`), `docs/drascula/files.md` | pas de test automatisé pour les scripts (comme les autres jeux) : vérifier à la main que le script est idempotent, que `files.json` liste 1 146 fichiers (1 115 hors musique), que les `.ALD`, les `.CAL` et `QPC.BIN` sont les français | `original/drascula/` complet, ~90 Mo (mesuré), licences en place, `drascula.dat` de version 7 | — |
| D | lecteurs | `src/data/cp850.ts` (E1) ; `data/rle.ts`, `alg.ts`, `ald.ts`, `cal.ts`, `bin-ssn.ts`, `bin-animate.ts`, `als.ts`, `dat.ts`, `files.ts` ; `test/drascula/data/*.test.ts` | un test par lecteur, sur les vrais fichiers (`originalFiles`, ignorés si absents) : 225 `.ALG` décodés sans erreur ; 57 `.ALD` analysés (nombre d'objets, rectangles) ; 33 `.BIN` parcourus jusqu'au dernier octet ; `drascula.dat` consommé sans reste, 15 sections x 6 langues, français correct ; round-trip des cas limites (RLE, XOR) | tous les fichiers du jeu lus sans erreur ; chaque affirmation « vérifié » de `formats.md` a un test | X |
| V | visionneuse | `ui/asset-viewer.ts` et `.html` + panneaux (image avec palette, `.BIN` image par image, `.ALD` en tableau, textes, lecture d'un `.ALS`) via `mountAssetViewer` | test du chargement du manifeste (pattern Armaeth) | on parcourt toutes les ressources dans le navigateur ; les « supposés » de `formats.md` (police, `HALF_PAL`, cadence) sont tranchés ou documentés | D |
| G | moteur : cœur | `engine/host.ts`, `state.ts`, `loop.ts`, `sequence.ts`, `perspective.ts`, `walk.ts`, `actions.ts` (verbes, `roomActions`), chargement de pièce depuis un `.ALD`, objets et zones, déplacements, inventaire ; `engine.md`, `graphics.md` | séquences (attentes, saut, abandon) ; chargement de chaque pièce ; marche et perspective ; verbes par défaut (`roomActions` : 307 lignes) | une pièce se charge, on s'y déplace, on regarde et on prend un objet sans erreur, en test (sans rendu) | D |
| R | rendu | `render/` : composition (décor, sprites, héros réduit selon la perspective, objets animés, `roomPreUpdates` / `roomUpdates`), `palette.ts` (niveaux de la pièce, fondus, `HALF_PAL`), `font.ts` (table de caractères du `.dat`, glyphes), texte | tests de composition sur images de référence calculées (pixels connus) ; palettes | pièces et texte affichés, identiques à une référence connue (captures de ScummVM non versionnées, comparaison par échantillons) | D |
| A | son | `audio/` : voix (`.ALS` -> E3), musique (pistes par `.ALD`), effets `S*.ALS`, attente de fin de voix, fondu éventuel (E2) | tests avec faux hôte et horloge manuelle (fin de voix, relance de piste) ; choix de piste par pièce | une pièce parle et joue sa musique ; la préférence « Son » coupe sans décaler le temps | D, G |
| T | dialogues | `talk.ts`, `dialogs.ts` : répliques sous-titrées + voix, choix (`.CAL`), `talkSequences`, personnages parlants (animations de bouche), `talk.md` | un test par dialogue du chapitre 1 ; durée d'une réplique = durée de sa voix | dialogue du chapitre 1 jouable de bout en bout en test | G, R, A |
| C | cinématiques | `cinematics/` : lecteur SSN et « animate » dans le moteur (images XOR, cadence, passage Échap), séquences d'intro, de chapitre et fins ; liaison palette | test d'une cinématique courte (`QPC.BIN`, `LOGODDM.BIN`) image par image ; sauts | intro et logos jouent, Échap passe | R, A |
| P | pièces | `rooms/room-NN.ts` : une pièce après l'autre, **par chapitre** (chapitres 1 à 6, 37 gestionnaires), avec leurs cinématiques ; `rooms.md` | un test par pièce : verbes, objets, conditions de passage ; test d'accessibilité de toutes les pièces | chaque chapitre se termine en test ; à chaque chapitre, la solution est jouée par un test (« passage du chapitre N ») | T, C |
| S | sauvegardes | `engine/save.ts` (sérialisation versionnée), `ui/saves.ts` (emplacements, JSON dans `HostStorage`), sélecteur d'emplacements, chargement après changement de chapitre | aller-retour de chaque pièce, versions, valeur illisible = emplacement vide (comme Armaeth) ; interdiction de sauvegarder pendant une séquence | sauvegarder et reprendre à chaque chapitre | G (puis après P) |
| J | intégration (**faite**) | `ui/app.ts`, `browser-host.ts`, `title.ts`, `help.ts`, tactile, `index.ts`, `copy.ts`, `style.css`, `dev.html`, `COVER.png` ; `registry.ts` (E6) ; `README.md` (section, tableau, licence) ; page d'aide qui cite Alcachofa Soft, ScummVM, la licence des données et la mention de version modifiée | tests `browser-host` (pattern Armaeth) ; chargement, erreur de fichiers manquants (`MissingFilesError`) | le jeu s'ouvre depuis l'accueil, se joue au clavier, souris et tactile, sans erreur dans la console | tout |
| K | validation | partie complète du chapitre 1 au 6, **robot de partie** si faisable (voir « Parcours complet »), revue, README « jouable, en cours de validation » | `test/drascula/full-game.test.ts` | fin du jeu atteinte en test ; revue fonctionnelle et visuelle | J |

Les vagues D, V, G, R, A sont séquentielles au début ; à partir de G terminée, R et A peuvent avancer en parallèle (ils ne touchent pas les mêmes fichiers). P peut être confiée chapitre par chapitre à des sous-agents distincts, un chapitre par agent, une fois T et C faites.

## Requis, naturellement lié, optionnel

**Requis** : X, D, G, R, A, T, C, P, S, J (le jeu n'existe pas sans) ; E1 ; décisions 1 et 2 (prises) ; fichiers de licence et readme d'Alcachofa dans `original/drascula/` ; mention de provenance de `drascula.dat`.

**Naturellement lié** : V (visionneuse : sert à trancher les points supposés, en pratique à faire tôt) ; K (validation complète) ; `docs/drascula/*.md` (moteur, pièces, dialogues) ; E3 (socle audio : sinon implémentation locale, mêmes critères) ; page d'aide ; tactile.

**Optionnel, à part** : recompression des voix (décision 3 : non retenue pour l'instant) ; E2 (fondu de musique) ; refactor commun de `cp437.ts` / `cp850.ts` ; migration des autres jeux vers le socle audio E3 ; autres langues (allemand, espagnol avec voix espagnoles, italien avec voix italiennes : les packs sont dans `archives/`) ; retouche des textes anglais dessinés dans les images ; lecture des `GSAVE*` d'origine ; correction des fautes de texte.

## Cas limites

- **Casse et noms de fichiers** : le code appelle `"214.als"`, `"BJ1.als"`, `"96.alg"` en minuscules ou casse mixte ; `files.json` et `GameFiles.resolve` règlent la casse. Un fichier manquant du jeu = `MissingFilesError` à l'écran, pas un plantage.
- **Voix** : fichiers de 3 à 169 Ko lus à la demande ; une voix qui échoue à charger ne bloque pas le dialogue (le texte reste affiché un temps proportionnel à sa longueur). `3.ALS` : silences à couper comme le fait ScummVM (voir `formats.md`).
- **Onglet masqué, son coupé, appui sur Échap** pendant une voix ou une séquence : la durée de la séquence suit la voix ; le son coupé ne décale pas les temps.
- **Palette** : `HALF_PAL` conserve les 128 couleurs réservées (héros, interface) ; les niveaux assombris par pièce et les fondus ne doivent pas créer de décalage entre le décor et les sprites. Palettes 6 bits (`.BIN`) et 8 bits (`.ALG`) à ne pas confondre.
- **Chapitre 2** : jeu en vue différente (nombre de lignes d'une fiche de pièce différent, tailles de héros variables) ; test dédié.
- **Changement de chapitre** (`_loadedDifferentChapter`) : état de chaque chapitre repris proprement ; sauvegarde/chargement entre chapitres.
- **Caractères** : CP850 des textes (accents français, majuscules accentuées codées pour la police : « DEUXIèME » est la donnée d'origine) ; table `charMapAccented` du `.dat` pour la police.
- **Inventaire** : jusqu'à 44 objets (`itemLocations`), combinaisons d'objets, objet pris et reposé.
- **Entrées** : clic gauche (action), clic droit (selon ScummVM : annuler le verbe, à confirmer en vague G), tactile sans survol (appui long = regarder, à définir), clavier (Échap, touches de fonction).

## Parcours complet

Aucun parcours complet n'existe encore ; deux niveaux :
1. **Un test par chapitre** qui rejoue la solution connue (suite de verbes, objets et déplacements) et vérifie les drapeaux de fin de chapitre : indispensable, écrit avec la vague P.
2. **Un robot de partie** (comme Armaeth) : si le nombre de combinaisons le permet, un robot qui joue des verbes sur les objets visibles jusqu'à la fin ; **à décider après P** (l'espace de recherche de ce jeu est plus petit que celui d'Armaeth : 50 drapeaux, 6 chapitres, mais les dialogues et les séquences en rendent le branchement plus profond).
Un vrai parcours dans le navigateur (clavier et souris) reste la validation finale (vague K).

## Risques de régression

- **Autres jeux** : le plan ne modifie aucun module commun existant, sauf si E2, E3 (migration) ou le refactor de `cp437.ts` sont décidés ; ces trois-là ne se font qu'avec les tests des jeux concernés (`test/armaeth`, `test/lost-in-time`, `test/teleportaschtroumpf`, `test/shared`).
- **`registry.ts` et `README.md`** : ajout seul ; vérifier que la page d'accueil se construit (`npm run build`) et que l'import dynamique garde le chargement du jeu à la demande (la page d'accueil reste légère : ~100 Mo de données ne sont jamais chargées avant « Jouer »).
- **`public`/`original/`** : le build copie `original/` tel quel : ~90 Mo de plus pour le déploiement (GitHub Pages) ; vérifier la limite de taille du site.
- **Poids du dépôt** : 90 Mo de fichiers binaires versionnés de plus (musique déjà convertie en MP3).

## Validation

- Chaque vague : `npm run typecheck`, `npm test` (vitest), `npm run build` ; tests des lecteurs sur les fichiers réels, ignorés quand `original/drascula/` est absent (comme les autres jeux).
- Rendu : vérification dans le navigateur à chaque vague visuelle (R, C, P, J) : échelle, plein écran, responsive, tactile, états (chargement, erreur de fichiers, son coupé, pause onglet masqué), accessibilité (focus du canvas, texte de l'état, contraste de la copy).
- Parcours : tests par chapitre (P) puis partie complète (K).
- Comparaison de comportement avec ScummVM : lancer le jeu sous ScummVM pour trancher les points « à confirmer » (cadence, ordre des animations, durée des fondus) ; les écarts retenus sont documentés dans `engine.md`.
- Contrôle de licence avant J : `readme.txt` d'Alcachofa Soft et mentions présents dans `original/drascula/`, README du dépôt à jour, mention de version modifiée dans la page d'aide.

## Dette technique à surveiller

- Les gestionnaires de pièces de ScummVM sont de longs `if/else` à numéros magiques (verbes, objets, drapeaux) : en TypeScript, des constantes nommées par pièce (verbes, objets) pour que le code se relise ; ne pas recopier les numéros bruts sans nom.
- Cadence à mesurer, voir « Cadence ».
- Le socle audio (E3) laisse sept implémentations proches : à rapprocher plus tard, hors de ce chantier.
