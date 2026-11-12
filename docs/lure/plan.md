# Lure of the Temptress : plan d'implémentation

Jeu : *Lure of the Temptress* (Revolution Software, 1992, premier jeu du « Virtual Theatre »), **version française** (`archives/lure-fr-1.1.zip`, disquettes VGA, exécutable assemblé le 22/07/1992, freeware de Revolution, archive préparée par ScummVM en 2007).
Aventure « pointer-et-cliquer » en 320 x 200, 256 couleurs : Diermot, prisonnier de la sorcière Selena, s'évade et libère le village de Turnvale. Pas de panneau : une ligne d'état et une barre de menus en haut de l'écran, des menus surgissants de verbes au clic droit,
des personnages autonomes qui vivent leur vie de pièce en pièce, des ordres donnés aux autres (« Dis à Ratpouch de… »), des combats. Pas de voix ; musique et bruitages en MIDI (AdLib ou Roland).

Ce document est le brief commun aux sous-agents, sur le modèle de `docs/fotaq/plan.md`. Les références font foi dans cet ordre : `formats.md` (formats, vérifié / lu / supposé), `engine.md` (moteur de ScummVM, découpage), puis ce plan. S'ajouteront : `files.md` (généré par l'extraction), `graphics.md`, `audio.md`, `talk.md`, `group-N.md` (notes de chaque groupe de la vague L).
**La référence de comportement est le moteur `lure` de ScummVM** (`engines/lure/`, GPL v3 ou ultérieure : en-tête de `decode.cpp` lu) et son outil `devtools/create_lure/`, lus pour comprendre et réécrits.

## Avancement

- **Étude faite** (vague 0) : archive extraite dans le scratchpad, rien exécuté ; conteneurs `heywow` des quatre disques parcourus (337 ressources) ; `lure.dat` de ScummVM parcouru (six langues, bloc français de 26 ressources, 45 pièces) ; identification de la version française confirmée (hachage de détection de ScummVM, somme de contrôle de `create_lure`) ; moteur et outil lus dans leurs grandes lignes. Verdict : **faisable, de taille comparable à FOTAQ, plus léger en données, plus lourd en logique autonome** (voir « Estimation »).
- Aucun code écrit ; seuls `docs/lure/plan.md`, `formats.md` et `engine.md` ont été créés.
- **G1 faite** (`src/games/lure/engine/`, tests `test/lure/engine/`) : état, `World`, `Hotspot` et verbes, machine à pile et désassembleur, scripts S2, séquences différées, pièce sans dessin, menus cliquables sans dessin, boucle (clics, ligne d'état, « Dis à », barre de menus, redémarrage) ; méthodes et gestionnaires L1 portés, les autres en souches qui journalisent ; `engine.md` § 8 (liste définitive par groupe : 67 numéros de méthode, 39 numéros pour 32 gestionnaires) et § 9 tranchés. La cellule se joue en test jusqu'à « Prends la torche » (la torche tombe : la suite est le groupe L2 et la marche G2) ; Ratpouch n'est pas atteignable sans eux.
- **G2 faite** (`pathfinder.ts`, `movement.ts`, `paused-list.ts`, `exits.ts`, `handlers/player.ts` complété, `handlers/character.ts` ; tests `test/lure/engine/pathfinder.test.ts`, `movement.test.ts`) : recherche de chemin identique à celle de ScummVM sur 373 trajets (extrait compilé), découpable dans le temps et sérialisable (budget 0 par défaut comme ScummVM, dont `PATHFIND_COUNTDOWN` vaut 0 : la recherche découpée de l'original est en option, reprise corrigée) ; marche du joueur et des PNJ, personnages qui se heurtent, portes et changements de pièce des PNJ, suiveurs et actions aléatoires. Diermot marche dans la cellule par de vrais clics ; Ratpouch suit le joueur ; les PNJ du village vivent dix minutes de jeu en test ; 240 trajets sur 274 entre sorties aboutissent (34 chemins partiels à confirmer au banc). Détail, écarts et constats (Gwen bloquée entre les pièces 12 et 32, bogue de copie des grilles de G1 corrigé) : `engine.md` § 4 et § 10.
- **S, première partie faite** (`engine/save.ts`, `ui/saves.ts`, tests `test/lure/engine/save.test.ts`) : `captureSave` / `restoreSave` / `parseSave` (JSON versionné, `SAVE_VERSION` 1), `SaveSlots` (`lure:`, 10 emplacements), refus quand le menu d'origine est indisponible (`canSave` : `isMenuAvailable`, combat, fin de partie), description = nom de la pièce + date. Reprise **exacte** (pas de `setRoomNumber` rejoué comme dans ScummVM) : un moteur repris suit la même suite d'états complets et de hasard qu'un témoin, testé en pleine marche de Diermot, en pleine recherche découpée, pendant un trajet de PNJ hors écran, deux PNJ qui se croisent et Ratpouch suiveur. Reste (après L) : états de `Fights` et du bar (points d'accroche `saveState` / `restoreState` déjà en place), dialogue en cours, aller-retour par zone de la solution jouée. Détail : `engine.md` § 11.
- **Décisions déjà prises par l'utilisatrice** : Lure avant Beneath a Steel Sky ; musique AdLib sur le synthé OPL du site ; mutualiser au maximum sans dénaturer le jeu. **Décisions à valider** : D1 à D9 ci-dessous.

## Décisions

| N° | Question | Recommandation | Faits et conséquences |
| --- | --- | --- | --- |
| D1 | **Source des tables du jeu** (`lure.dat`) | **Bloc français du `lure.dat` de ScummVM**, extrait dans `original/lure/LURE-FR.DAT` ; contrôle en vague X : régénération par `create_lure` compilé dans le scratchpad à partir de `LURE.EXE`, **identique hors octets non initialisés** (175 octets de mémoire que `create_lure` ne renseigne pas, voir `formats.md` § 3 : le bloc livré y a `0xCD`, un bloc régénéré autre chose ; le lecteur ne les lit jamais). Pas de portage de `create_lure` en TypeScript. | `create_lure` (3 200 lignes) lit l'exécutable à des positions codées en dur par langue, corrige des données (5 `WORKAROUND`) et ajoute des tables écrites à la main (verbes, menu, décodeur de textes). Le bloc a le format d'un `DISKn.VGA` : un seul lecteur de conteneur. Même régime que `drascula.dat` (fichier de ScummVM versionné, provenance notée). `lure.dat` complet copié dans `archives/lure.dat` (non versionné, source de l'extraction). |
| D2 | **Protection de copie** | **Non portée**, comme ScummVM par défaut (option `copy_protection` à faux). `PROTECT.PDF` non versionné. | La protection (`CopyProtectionDialog`, symboles de la ressource `0x4139`) n'apporte rien au jeu. |
| D3 | **Manuel** | **Versionné** (`original/lure/MANUEL.pdf`, 1,7 Mo) et **lien dans l'aide**. | Manuel français de 42 pages (commandes, histoire). Poids négligeable devant la marge ; écarter si l'utilisatrice préfère n'avoir que les données. |
| D4 | **Interface d'origine** | **Garder la barre de menus et les menus surgissants dessinés par le jeu**, en **mode « cliquable »** (celui de ScummVM sur écran tactile) pour souris et toucher ; « Sauvegarder », « Restituer », « Quitter », « Avec / Sans son » ouvrent les **dialogues communs** du site (`point-click-dialogs.ts`) et la préférence Son ; « Texte rapide / lent », « Crédits », « Recommencer » restent ceux du jeu. Le dialogue de sauvegarde d'origine n'est pas porté. | En souris, ScummVM ramène le pointeur au centre pendant un menu surgissant : impossible dans un navigateur. Le mode cliquable existe déjà dans ScummVM (`kFeatureTouchscreen`), ce n'est pas un écart inventé. Même choix que FOTAQ (D7 : sélecteur DOM, pas d'écran journal). |
| D5 | **Sauvegardes** | **Comme FOTAQ** : `SaveSlots<T>` (préfixe `lure:`, 10 emplacements, JSON versionné), refus quand le menu d'origine n'est pas disponible (`isMenuAvailable` : combats, séquences), description = nom de la pièce + date. | ScummVM sérialise `Resources`, `Game`, `Sound` (sons avec `SF_RESTORE`), `Fights`, `Room`, et l'état du `PathFinder` de chaque personnage. Pas de lecture des sauvegardes de ScummVM (optionnel). |
| D6 | Rendu | `mountPointClickApp` avec `width: 320`, `height: 200`, `tickMs: 80`. | Image de logique à 80 ms (`GAME_FRAME_DELAY`), horloge de la boutique à 1 000 ms. |
| D7 | **Musique (décidé : AdLib)** | Pilote **multi-sources** réécrit (sous-ensemble de `adlib_ms.cpp` + spécificités de `MidiDriver_ADLIB_Lure`) sur `WebOpl({ tickRate: 250 })` ; écrit sans référence à Lure dans `audio/adlib-multisource.ts`, promotion vers `src/audio/` au deuxième usage. | Tout le son est MIDI (aucun échantillon) : musique et bruitages partagent les 9 voix OPL2, jusqu'à 10 sources. Les instruments sont dans des `FF 7F` (déjà lus par `src/audio/smf.ts`). Le pilote de FOTAQ (`midiadlib.cpp` de Queen) ne se réutilise pas (autre format d'instrument, pas de multi-sources). |
| D8 | **Hasard** | Porter l'algorithme de `Common::RandomSource` dans `src/engine/rng.ts` (`scummvmRandom`, M1 ci-dessous). | Les PNJ, les actions aléatoires et les combats tirent au hasard ; même graine que le banc (`--random-seed`) = comparaisons image par image possibles. BASS utilise le même générateur. |
| D9 | **Coquilles des tables de ScummVM** | **Corriger dans le lecteur, en écart documenté**, seulement quand la table est écrite à la main dans `create_lure` et que l'erreur est certaine. Cas connu : `"Parle \0x81"` (le `\0` coupe la chaîne : « Parle » au lieu de « Parle à »). | Ces textes ne viennent pas du jeu d'origine mais de l'outil. Liste tenue dans `formats.md`. |

## Convention vis-à-vis de ScummVM (alignée sur Drascula et FOTAQ)

- Chaque module dont le comportement vient de ScummVM cite son fichier de référence en tête (`hotspots.cpp`, `scripts.cpp`, `game.cpp`, `room.cpp`, `res.cpp`, `res_struct.cpp`, `menu.cpp`, `surface.cpp`, `fights.cpp`, `decode.cpp`, `strings.cpp`, `sound.cpp`, `audio/adlib_ms.cpp`, `create_lure_dat.cpp`) et note ses écarts volontaires. On lit, puis on réécrit en TypeScript (noms du dépôt, séquences, numéros magiques nommés dans des `ids.ts`).
- Aucune copie de fichier de ScummVM dans le dépôt, sauf le bloc français de `lure.dat` (données, provenance et version 1.32 notées dans `files.md` et l'aide).
- `README.md` : ligne du tableau des jeux, section « Lure of the Temptress », phrase de la section Licence (vague J).

## Ce qui est versionné dans `original/lure/`

Source dans `archives/` (non versionnée) : `lure-fr-1.1.zip`, `lure.dat` (copie de `dists/engine-data/lure.dat` de ScummVM).

| Fichiers | Source | Poids | Versionné |
| --- | --- | --- | --- |
| `DISK1.VGA` à `DISK4.VGA` | archive | 2 572 192 octets | oui, tels quels (pas de découpage : le lecteur suit l'index du conteneur) |
| `LURE-FR.DAT` | bloc français de `lure.dat` (`0x9C200`, langue 6) | 129 344 octets | oui (D1) |
| `LICENSE-LURE.txt` | `LICENSE.txt` | 1,3 Ko | oui, **obligatoire** |
| `MANUEL.pdf` | `Manual.pdf` | 1,7 Mo | si D3 |
| `COVER.png` | `scripts/lure-cover.mts` (vague J), une pièce du village composée par le moteur | ~30 Ko | oui |
| `files.json` | `scripts/manifest.py` | < 1 Ko | oui |
| `LURE.EXE`, `PROTECT.PDF`, `README` (ScummVM) | archive | | non |

**Total : ~2,7 Mo (4,4 Mo avec le manuel)**, contre 62 Mo pour FOTAQ ; aucune conversion audio. Marge de GitHub Pages (1 Go publié, ~690 Mo aujourd'hui) : inchangée en pratique, ce qui laisse la place aux voix de BASS.

**Script d'extraction** `scripts/lure-extract.sh [zip] [lure.dat]` (modèle : `scripts/fotaq-extract.sh`, `scripts/lib/extract-common.sh`) : `ec_verifier_outils bsdtar python3`, `bsdtar` dans un dossier temporaire, contrôle des hachages (`disk1.vga` : 1 024 premiers octets = `1c94475c…` ; `LURE.EXE` : somme `0xD38C`), copie des quatre disques, `scripts/lure/split_dat.py` (lancé en `python3 -I`, chemins en arguments : lit la table des langues, extrait le bloc 6, contrôle `heywow` et la version 1.32), licence, manuel, `ec_conserver COVER.png`, inventaire `docs/lure/files.md`, `ec_publier`. Contrôle annexe (non versionné) : `create_lure` compilé dans le scratchpad régénère le bloc depuis `LURE.EXE`, comparé au bloc livré (identique hors des 175 octets non initialisés de `formats.md` § 3).

## Architecture

Voir `engine.md` § 7 (dossiers) et § 8 (groupes). En bref : `data/` (lecteurs purs), `engine/` (moteur sans tête : état, pièce, hotspots, pile d'actions, cheminement, scripts, menus, dialogues, boucle, sauvegarde), `engine/methods/group-N/` et `engine/handlers/group-N/` (logique propre au jeu, en groupes parallèles), `engine/fights/`, `engine/sequences/`, `render/`, `audio/`, `ui/`. Tout ce qui touche au navigateur passe par `LureHost`.

### Séquences

ScummVM bloque dans des boucles locales : menus surgissants, barre de menus, boîtes de texte, bulles, choix de dialogue, animations plein écran, combats, `Script` qui attend. Réécrits en **générateurs** (`src/engine/sequence.ts`), exécutés tick par tick, avec saut (clic ou Échap sur l'introduction, sur une boîte de texte), attente protégée et abandon (redémarrage). Cas propres à Lure : **le monde continue de tourner pendant que le joueur lit ou choisit** dans certains cas et pas dans d'autres (à relever un par un dans `game.cpp` et `menu.cpp`) ; le `PathFinder` est lui-même découpé dans le temps (ce n'est pas une séquence mais un état repris à chaque tick).

### Cadence

**Lu** : une image de logique toutes les 80 ms (`GAME_FRAME_DELAY`), `tickCheck` toutes les 1 000 ms, musique à 250 Hz sur l'horloge audio. Le temps du jeu ne dépend pas du son (règle de `WebOpl`). Écart connu : ScummVM compare `getMillis() > timerVal + 80` (une image toutes les 81 ms au mieux) ; on garde 80 ms exactes sauf si le banc montre un décalage visible.

## Moteur : ce qui est données, ce qui est code

| Partie | Dans les données | À écrire |
| --- | --- | --- |
| Pièces, calques, sorties, portes | `0x3F05`, `0x3F09`, `0x3F0A`, `0x3F14`, `0x3F15`, écrans des disques | lecteurs, `room.ts`, `exits.ts` |
| Hotspots, actions | `0x3F07`, `0x3F08`, `0x3F10` | `hotspot.ts` (verbes), état |
| Scripts | `0x3F0C` (séquences), `0x3F0D` (animations), `0x3F0E` | machine à pile (~300 lignes de C++), opcodes `S2`, **68 méthodes natives** |
| Personnages autonomes | `0x3F06` (emplois du temps), actions aléatoires | pile d'actions, `npcRoomChange`, attentes aux portes, **35 gestionnaires de tick** |
| Cheminement | `0x3F13` (grilles) | `PathFinder` découpé dans le temps |
| Dialogues | `0x3F11`, `0x3F12`, textes | `talkAnimHandler`, choix, réponses, « Demande », « Donne », « Dis à » |
| Combats | `0x3F16` | `fights.cpp` (617 lignes) |
| Séquences plein écran | animations des disques | introduction, fin, tonneau, chute, capture |
| Textes | `0x10`-`0x12`, `9`, décodeur `0x3F19`, interface `0x3F17` | décodeur, remappage selon la pièce |
| Son | sections `0x0D`, `0x31`, `0xFF11`, descriptions `0x3F18` | décompression, lecteur multi-sources, pilote AdLib |

Comme FOTAQ, l'essentiel est l'interprétation correcte des données ; mais là où FOTAQ avait 37 mouvements spéciaux, Lure a **68 méthodes natives et 35 gestionnaires de tick**, et surtout des **personnages qui agissent sans le joueur** : les erreurs se voient tard (un PNJ bloqué rend la partie impossible des heures après).

## Mutualisation (consigne : mutualiser au maximum sans dénaturer le jeu)

**Réutilisé tel quel :** `src/engine/sequence.ts`, `save-slots.ts`, `host.ts` (`BaseHost`), `clock.ts`, `storage.ts` ; `src/ui/point-click-app.ts` (page, chargement, pause, barre tactile Menu / Passer / Pause, toucher = clic gauche, appui long = clic droit, clavier par `key`), `point-click-dialogs.ts`, `point-click-pages.ts` (écran titre, aide), `point-click-touch.ts`, `point-click.css`, `game-shell.ts`, `indexed-canvas.ts` (`paletteToLut`, `vga6ToRgb8` : palettes 6 bits), `file-store.ts`, `tick-scheduler.ts`, `pointer-queue.ts` (le tap doit laisser au jeu le temps de mettre à jour la ligne d'état), `files.ts`, `src/data/game-files.ts`, `src/data/reader.ts` ; `src/audio/opl2.ts`, `opl-stream.ts`, `opl-worklet.ts`, `web-opl.ts` (`tickRate: 250`, `setVolume`), `smf.ts` (`FF 7F`) ; `src/ui/sound-prefs.ts` ; `scripts/lib/extract-common.sh`, `extract_common.py` (`rendre_inventaire`), `png.mts`, `scripts/manifest.py` ; `test/support/original.ts`, `fake-host.ts`, `fake-audio-context.ts` ; le banc ScummVM du scratchpad.
**Non utilisé :** `web-sample-output.ts`, `track-player.ts` (aucun échantillon, aucune piste).

**Étendu (voir tableau suivant) :** `src/engine/rng.ts` (M1), éventuellement `point-click-app.ts` (M2), `src/games/registry.ts` et `README.md` (M3).

**Spécifique à Lure :** lecteurs (conteneur, écrans, animations, textes, `lure.dat`), état, hotspots, pile d'actions, `PathFinder`, scripts, méthodes et gestionnaires, menus et ligne d'état d'origine, bulles, combats, séquences, rendu par calques, pilote AdLib multi-sources (générique dans sa forme, promu au deuxième usage), hôte, sauvegardes.

### Ce que Beneath a Steel Sky pourra reprendre

BASS (`engines/sky/`, 18 400 lignes) est le Virtual Theatre suivant de Revolution, mais **ScummVM n'a aucun code commun aux deux moteurs** : formats (`sky.dsk` / `sky.dnr` compressés RNC, `sky.cpt` de ScummVM), scripts (« compacts »), cheminement (`autoroute.cpp`), textes (`hufftext.cpp`, autre arbre) et musique AdLib (format propre, `music/adlibchannel.cpp`, pas du MIDI) diffèrent. Repris tels quels : tout le socle commun ci-dessus, `scummvmRandom` (M1), la sortie OPL (`WebOpl`, autre `tickRate`), les voix MP3 de FOTAQ (version CD parlante). Repris comme **méthode** : fichier de données de ScummVM extrait par bloc et contrôlé par régénération (`sky.cpt` ↔ `create_sky`), organisation en groupes parallèles, joueur scripté, banc de comparaison avec débogueur de ScummVM, tests de PNJ autonomes. Le pilote AdLib multi-sources de Lure ne servira pas à BASS ; sa promotion attendra un autre jeu MIDI.

## Évolutions de modules communs proposées

| N° | Fichier | Évolution | Pourquoi | Risque | Statut |
| --- | --- | --- | --- | --- | --- |
| M1 | `src/engine/rng.ts` | `scummvmRandom(seed)` : algorithme de `Common::RandomSource` (`getRandomNumber`, `getRandomNumberRng`), test sur des valeurs relevées dans ScummVM avec la même graine. | Comparer au banc image par image ; BASS en aura besoin. | Nul (ajout) | vague P |
| M2 | `src/ui/point-click-app.ts` | Si besoin (à constater en J, pas avant) : clic droit sans appui long pour la barre tactile (bouton « Actions » qui transforme le prochain toucher en clic droit), et masquage du bouton « Passer » quand le jeu n'a rien à passer. | Le clic droit ouvre tous les verbes : l'appui long seul peut suffire. | Faible : FOTAQ et Drascula à revérifier dans le navigateur | décidé en J |
| M3 | `src/games/registry.ts`, `README.md` | Une ligne chacun, section et licence. | Enregistrer le jeu | Nul | vague J |
| M4 | `src/audio/adlib-multisource.ts` (plus tard) | Promotion du pilote multi-sources de `src/games/lure/audio/`. | Plusieurs moteurs de ScummVM en dérivent. | Faible | **seulement au deuxième usage** (règle des deux usages) |

Hors dépôt : **banc ScummVM** (`scratchpad/scummvm-build/`) : recompiler avec le moteur `lure` (`./configure --disable-all-engines --enable-engine=drascula,queen,lure`), entrée `[lure-fr]` dans `scummvm-games/cfg/scummvm.ini` (dossier de jeu dans le scratchpad, `lure.dat` dans `extrapath`), scénarios `l-intro.txt`, `l-cell.txt`, `l-village.txt`, `port/lure.test.ts` + `run-port.sh lure`. Le débogueur de Lure a déjà `room`, `setfield`, `give`, `hotspot`, `script` : pas de commande d'injection d'état à écrire (contrairement à `bstate` de Drascula).

## Vagues

Chaque vague se termine par `npm run typecheck`, `npm test`, `npm run build` et, dès qu'il y a un rendu, une vérification dans le navigateur.

| Vague | Tâche | Contenu | Tests | Critère de fin | Dépend de |
| --- | --- | --- | --- | --- | --- |
| P | commun et banc | M1 ; banc ScummVM avec `lure` (compilation, configuration, un scénario d'introduction et un de la cellule, captures) ; `create_lure` compilé (pour X) | `npm test` complet ; `scummvmRandom` = valeurs relevées | banc qui produit des captures de Lure ; M1 en place | — |
| X | extraction | `scripts/lure-extract.sh`, `scripts/lure/split_dat.py`, `original/lure/`, `docs/lure/files.md`, `archives/lure.dat` | idempotence (hachages identiques en deux exécutions) ; bloc régénéré identique au bloc livré hors octets non initialisés (175 octets, `formats.md` § 3) | `original/lure/` complet (~2,7 Mo), licence en place | — |
| D | lecteurs | `data/` : conteneur, écrans, animations, palettes, police, textes et jeu de caractères, 26 ressources de `lure.dat`, sections de sons (décompression, SMF) | `formats.md` § 7, points 1 à 4 : toutes les ressources lues jusqu'au dernier octet, tous les textes décodés, tous les sons en SMF valides | aucun reste, `formats.md` mis à jour | X |
| V | visionneuse | `ui/asset-viewer.ts` + `.html` (`mountAssetViewer`) : écrans et calques, animations, palettes, textes, hotspots d'une pièce, grille de cheminement, scripts désassemblés, dialogues en arbre | chargement du manifeste | on parcourt toutes les ressources | D |
| G1 | état, scripts, actions | `engine/` : `host`, `cadence`, `state` (champs, hotspots, pièces, portes), `room`, `script` (machine à pile, 68 méthodes en table, **implémentées en G1 seulement les génériques du groupe L1**, les autres en souches qui journalisent), `hotspot-script`, `delay-list`, `hotspot` (verbes), `menu` (sans dessin), `game` (boucle, clics, ligne d'état, redémarrage) ; `engine.md` § 9 tranché ; **liste par groupe** des méthodes et gestionnaires (§ 8) | les 45 pièces se chargent ; le script de démarrage `0x23FC` s'exécute ; chaque séquence de `0x3F0C` se décode ; regarder, prendre, ouvrir dans la cellule, en test sans rendu | la cellule du début se joue en test jusqu'à l'appel de Ratpouch | D, P |
| G2 | mouvement et autonomie | `pathfinder`, `movement`, `actions` (pile), `exits` (portes, jonctions, PNJ hors écran, attentes), `schedules`, actions aléatoires, `playerAnimHandler`, `followerAnimHandler`, `npcRoomChange` | trajets entre toutes les sorties de chaque pièce ; recherche reprise sur plusieurs ticks = même chemin qu'en une fois ; un PNJ fait le tour de son emploi du temps sur N minutes de jeu sans se bloquer ; deux PNJ qui se croisent | Diermot et Ratpouch marchent, les PNJ du village vivent leur journée, en test | G1 |
| R | rendu | `render/` : écrans, calques et cellules, sprites triés, palette (228 entrées, sous-palettes, fondus), police, ligne d'état, barre de menus, menus surgissants cliquables, bulles et boîtes, curseurs ; `graphics.md` ; page de dev | composition sur échantillons de pixels ; chaque caractère des textes a un glyphe ; **comparaison au banc** (captures de l'introduction et de la cellule) | les 45 pièces se composent, vues dans le navigateur | D, G2 (sprites) |
| A | son | `audio/` : décompression, lecteur SMF multi-sources (boucle, arrêt, volume par source), pilote multi-sources + `MidiDriver_ADLIB_Lure`, `SoundManager` (sections, descriptions, `SF_RESTORE`), sortie `WebOpl` à 250 Hz, `scripts/lure/render-music.mts` (WAV hors ligne) ; `audio.md` | registres OPL exacts pour une note, un instrument BNK, le pitch bend ; deux sources sur 9 voix (allocation, vol de voix) ; tous les sons jouent sans écriture hors registres ; son coupé ne décale pas le temps | une pièce joue sa musique et ses bruitages ; **écoute par une personne** à côté de ScummVM | D, G1 |
| T | dialogues | `talk.ts` (`talkAnimHandler`, choix, réponses, `talkEndConversation`), bulles, vitesse du texte, `tell.ts` (« Dis à », 8 ordres), « Demande », « Donne », « Corromps » ; `talk.md` | chaque dialogue se parcourt (toutes les options choisies) ; un ordre « Dis à Ratpouch » à plusieurs actions s'exécute | un dialogue complet et un ordre à Ratpouch jouables en test | G2, R |
| L | logique propre au jeu, **en parallèle** | groupes L1 à L4, F (combats) et Q (séquences plein écran) d'`engine.md` § 8, chacun dans son dossier ; un modèle d'abord (L2, la cellule), puis les autres en parallèle | un test par méthode et par gestionnaire ; un test « passage » par zone (cellule, village, grottes et monastère, château) ; les combats gagnés et perdus | chaque zone se termine en test, la solution est jouée | G2, T (F et Q : R) |
| S | sauvegardes | `engine/save.ts` (état versionné, `PathFinder` en cours compris), `ui/saves.ts` (`SaveSlots`), refus | aller-retour à chaque repos de la solution ; reprise **en pleine marche** et pendant un trajet de PNJ hors écran ; valeur illisible = vide ; sons `SF_RESTORE` relancés | sauvegarder et reprendre dans chaque zone | G2 (puis après L) |
| J | intégration | `ui/` (app, hôte, préchargement : tout au départ, ~2,7 Mo), `keys.ts` (touches de ScummVM `metaengine.cpp` : F5, Échap, touches de combat), toucher (menus cliquables, appui long), `index.ts`, `copy.ts`, `title.ts`, `help.ts` (licence, ScummVM, manuel, code GPL, mention de version modifiée), `scripts/lure-cover.mts`, `COVER.png`, M2 si besoin, M3 | `browser-host`, `preload`, fichiers manquants | le jeu s'ouvre depuis l'accueil, se joue souris, clavier et toucher, sans erreur dans la console | tout |
| K | validation | partie complète en test (`full-game.test.ts`, solution jouée d'un trait, puis avec reprises), comparaisons au banc (scénarios par zone), revue fonctionnelle et visuelle, README | | fin du jeu atteinte ; revue | J |

Parallélisme : P et X indépendants. Après D : V et G1 en parallèle. Après G1 : A (sans rendu) en parallèle de G2 ; R après G2. T après R. **L se découpe en six groupes** (convention d'`engine.md` § 8 : ne rien modifier hors de son dossier, signaler tout besoin partagé) ; F et Q peuvent commencer dès R ; S peut commencer après G2 et se compléter après L.

## Estimation

Base : FOTAQ (16 600 lignes de moteur et d'interface, 12 200 de tests, pour 18 000 lignes de C++ de ScummVM) ; Lure : 16 900 lignes de C++ hors EGA, débogueur et détection, plus ~800 utiles d'`adlib_ms.cpp`.

| Vague | Taille relative | Lignes estimées | Incertitude |
| --- | --- | --- | --- |
| P | petite | 150 + banc (hors dépôt) | faible |
| X | petite | scripts 200 | faible |
| D | moyenne | 1 500 (26 structures de `lure.dat`, deux décompressions, textes) | faible |
| V | petite | 600 | faible |
| G1 | grande | 2 200 (état, machine à pile, verbes, boucle, menus) | moyenne |
| G2 | **grande** | 2 000 (`PathFinder`, pile d'actions, portes, PNJ hors écran) | **haute** : 4 900 lignes de `hotspots.cpp` très imbriquées |
| R | moyenne | 1 600 | moyenne (calques et cellules) |
| A | moyenne | 1 300 (dont pilote multi-sources ~800) | moyenne |
| T | moyenne à grande | 1 200 | moyenne (« Dis à ») |
| L | grande, en parallèle | 2 000 à 3 000 (six groupes) | **haute** (barman, Goewin, combats) |
| S, J, K | petites à moyennes | 1 400 | faible à moyenne (sauvegarde du `PathFinder`) |

Total : **13 000 à 16 000 lignes** (autant de tests), soit **0,8 à 1 fois FOTAQ** ; moins de données et pas de voix, mais une logique autonome plus difficile à valider. Chemin critique : D, G1, G2, T, L, K. Risques de calendrier : G2 et L.

## Requis, naturellement lié, optionnel

**Requis** : P (M1 et le banc), X, D, G1, G2, R, A, T, L, S, J ; D1, D2, D4, D5, D9 tranchées ; `LICENSE-LURE.txt` dans `original/lure/` ; mention de version modifiée dans l'aide ; provenance du bloc de `lure.dat`.

**Naturellement lié** : V (tranche les points supposés) ; K ; `docs/lure/*.md` ; table des caractères du jeu vers Unicode (tests lisibles, texte d'état accessible) ; manuel dans l'aide (D3) ; M2 si le toucher le demande.

**Optionnel, à part** : protection de copie (D2) ; dialogue de sauvegarde d'origine ; lecture des sauvegardes de ScummVM ; musique Roland (MT-32, sections `0x0B`, `0x0C`, `0x30`, `0xFF10`) ; autres langues (`lure.dat` les a, pas les disques) ; version EGA ; narrateur vocal (`tts_narrator` de ScummVM) ; promotion du pilote multi-sources (M4).

## Cas limites

- **Identifiants de ressources** : disque déduit des deux bits hauts ; écrans de remplacement `0x008`, `0x120`, `0x311`, `0x410` selon `AREA_FLAG` ; ressources de plus de 64 Ko (`sizeExtension`).
- **Textes** : remappage selon la pièce (`0x2A`) ; caractères du jeu au-delà de `0x7F` ; noms insérés ; coquilles des tables de `create_lure` (D9) ; découpage des bulles selon la largeur ; vitesse rapide / lente.
- **Personnages hors écran** : ils marchent, ouvrent des portes, changent de pièce, attendent un passage bloqué (`PausedCharacterList`) ; ordre des ticks ; rencontre de deux personnages dans un couloir ; personnage qui arrive dans la pièce du joueur pendant un dialogue.
- **`PathFinder`** découpé dans le temps : clic pendant une recherche, changement de pièce pendant une recherche, sauvegarde pendant une recherche, destination inaccessible. (G2 : ScummVM ne découpe pas, `PATHFIND_COUNTDOWN 0` ; le portage découpe en option, reprise exacte testée, sauvegarde en pleine recherche testée sur l'état de la marche.)
- **Ordres « Dis à »** : 8 ordres au plus, ordre impossible, PNJ qui change de pièce en exécutant.
- **Menus** : barre de menus inaccessible pendant un combat ou une séquence ; menus surgissants près des bords ; clic droit pour annuler ; molette (ScummVM la gère) ; toucher sans survol (la ligne d'état doit être à jour avant le tap : `PointerQueue`).
- **Combats** : hauteur du coup par la position du pointeur ou au clavier, mort du joueur (fin de partie, recharger), deux types d'adversaire.
- **Boutique** : horloge à 1 000 ms indépendante des images, à sauvegarder.
- **Son** : 10 sources sur 9 voix ; sons compressés ; « Sans son » coupe tout ; sons relancés au chargement (`SF_RESTORE`) ; section changée entre introduction, jeu et fin.
- **Redémarrage** (menu « Recommencer ») : remise à zéro complète, aucun état résiduel (sons, séquences différées, combats).
- **Fin du jeu** : séquence `0xFF00`/`0xFF01`, musique `0xFF11`, générique, retour à l'écran titre.

## Risques

- **Autonomie des PNJ et `PathFinder` (G2, L)** : le plus gros risque ; une divergence d'ordre de tick ou de hasard bloque la partie bien plus tard. Atténuation : `scummvmRandom` + comparaison au banc avec la même graine ; tests de « journée » des PNJ sur de longues durées ; solution jouée en entier et avec reprises.
- **Dépendance à `lure.dat`** : format de ScummVM (1.32) qui peut changer ; on versionne le bloc, on note la version, la régénération par `create_lure` est reproductible.
- **Pilote multi-sources** : allocation des voix entre musique et bruitages, fidélité du timbre (même émulateur, autre mixage) ; écoute par une personne.
- **Toucher** : clic droit omniprésent (verbes) ; l'appui long ralentit ; à éprouver sur téléphone en J (M2 si besoin).
- **Autres jeux** : M1 est un ajout ; M2 touche Drascula et FOTAQ (vérification dans le navigateur) ; `registry.ts` et `README.md` : ajout seul ; l'accueil reste léger (import dynamique).
- **Licence** : mention de version modifiée visible (article 4 de la licence de Revolution), licence conservée ; code de ScummVM lu, pas recopié.

## Validation

- Chaque vague : `npm run typecheck`, `npm test`, `npm run build` ; tests des lecteurs sur les fichiers réels, ignorés si `original/lure/` est absent (`originalFiles`).
- **Banc ScummVM sans fenêtre** (`scratchpad/scummvm-build/bench/`) : moteur `lure` ajouté à la compilation (P), même graine (`--random-seed`, M1), captures comparées par `port/run-port.sh lure` (introduction, cellule, village, un combat) ; état injecté par le débogueur de Lure (`room`, `setfield`, `give`).
- Rendu dans le navigateur à chaque vague visuelle (R, T, L, J) : échelle, menus, bulles, responsive, tactile, états (chargement, erreur de fichiers, son coupé, onglet masqué), accessibilité (focus du canvas, texte d'état).
- Parcours : passage par zone (L), partie complète d'un trait et avec reprises (K).
- Écoute par une personne : musique et bruitages AdLib comparés à ScummVM.
- Contrôle de licence avant J : `LICENSE-LURE.txt`, README, mention de version modifiée.

## Dette technique à surveiller

- Numéros magiques de ScummVM (hotspots, champs, séquences) : constantes nommées par groupe (`ids.ts`).
- Pointeurs et listes chaînées de ScummVM : remplacés par des identifiants (sauvegarde simple) ; ne pas réintroduire de références d'objets dans l'état.
- Pilote AdLib multi-sources écrit dans le jeu (M4) : à promouvoir au deuxième usage, pas avant.
- Tables écrites à la main par ScummVM dans `lure.dat` (verbes, décodeur) : corrections tenues dans le lecteur (D9), listées dans `formats.md`.
