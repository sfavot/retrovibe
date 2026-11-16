# Beneath a Steel Sky : plan d'implémentation

Jeu : *Beneath a Steel Sky* (Revolution Software, 1994, deuxième jeu du « Virtual Theatre »), **version CD 1.2** (`archives/bass/bass-cd-1.2.zip`, v0.0372, freeware de Revolution, archive préparée par ScummVM en 2003).
Aventure « pointer-et-cliquer » en 320 × 200, 256 couleurs : Robert Foster, enlevé dans l'Outback, s'échappe dans Union City avec Joey, robot qu'il a lui-même construit. Deux boutons de souris (gauche : marcher, regarder, parler ; droit : utiliser), inventaire en haut de l'écran, choix de dialogue, panneau de contrôle (F5). **Voix anglaises** (1 h 56), **textes en huit langues dont le français**, musique AdLib, effets échantillonnés.

Ce document est le brief commun aux sous-agents, sur le modèle de `docs/lure/plan.md`. Les références font foi dans cet ordre : `formats.md` (formats, vérifié / lu / supposé), `engine.md` (moteur de ScummVM, découpage), puis ce plan. S'ajouteront : `files.md` (généré par l'extraction), `graphics.md`, `audio.md`, `group-N.md`.
**La référence de comportement est le moteur `sky` de ScummVM** (`engines/sky/`, GPL v3 ou ultérieure) et son outil `devtools/skycpt/`, lus pour comprendre et réécrits.

## Avancement

- **Étude faite** (vague 0) : archive extraite dans le scratchpad, rien exécuté ; les 5 097 fichiers de `sky.dsk` chargés et décompressés (4 764 en RNC, CRC valides) ; textes français présents et décodés ; voix mesurées (3 491 fichiers, 1 h 56) ; `sky.cpt` analysé et régénéré à 85 % par `skycpt` ; moteur et audio lus. Verdict : **faisable, un peu plus petit que Lure en logique** (aucune énigme en C++ : tout est dans les scripts du jeu), **plus lourd en données et en son** (RNC, sprites, voix).
- Aucun code écrit ; seuls `docs/bass/plan.md`, `formats.md` et `engine.md` ont été créés.
- **Décisions déjà prises par l'utilisatrice** : voix anglaises de la version CD avec sous-titres français ; voix recompressées en MP3 à 24 kb/s comme FOTAQ ; musique AdLib sur le synthé OPL du site ; « mutualiser avec ce qu'on a déjà, sans pour autant trop dévoyer les jeux ». **D1 à D10 validées par l'utilisatrice le 13/11/2026**, telles que recommandées ci-dessous.

## Décisions

| N° | Question | Recommandation | Faits et conséquences |
| --- | --- | --- | --- |
| D1 | **Données versionnées** | **`sky.dsk` et `sky.dnr` reconstruits sans les voix, au même format** (13,3 Mo : mêmes fichiers, mêmes octets, index recalculé), plus `voices/<id>.mp3`. Le lecteur est celui de l'original ; les voix passent par la banque de voix. | Les voix font 59 Mo des 72 Mo de `sky.dsk` ; garder le fichier entier en plus des MP3 doublerait le poids (93 Mo). Précédent : FOTAQ découpe `queen.1c`. Contrôle : chaque fichier extrait du `sky.dsk` reconstruit est identique, octet pour octet, à celui de l'archive. Les voix de l'introduction (59 494 à 59 672) restent dans `sky.dsk`, au format d'origine. |
| D2 | **`sky.cpt`** | **Celui de l'archive, tel quel**, avec le correctif « Officer Blunt » appliqué au chargement comme ScummVM. Contrôle en vague X : régénération par `skycpt` compilé dans le scratchpad, **identique sur les 357 685 premiers octets** ; les 61 742 octets de remise à zéro ne sont pas régénérables (voir `formats.md` § 4). Pas de portage de `skycpt`. | Le fichier fait partie de l'archive freeware : il est couvert par sa licence, sans fichier de ScummVM à versionner (contrairement à `lure.dat`). Il diffère de 2 octets de celui de ScummVM (le bogue 2687). |
| D3 | **Encodage des voix** | **Comme FOTAQ** : MP3 CBR 24 kb/s, mono, **22 050 Hz** (`libmp3lame`, `-fflags +bitexact`), un fichier par voix (`voices/50007.mp3`…), **chargé à la demande** au début de la réplique. | Source : PCM 8 bits à 11 025 Hz. Le MP3 à 11 025 Hz (MPEG 2.5) est mal pris en charge par les navigateurs ; 22 050 Hz est déjà éprouvé avec FOTAQ. Poids estimé **~22 Mo** pour 3 491 fichiers (mesuré en X). Le sous-titre s'affiche tout de suite ; la réplique attend la fin de la voix (`L_TALK`), le délai de chargement l'allonge un peu. |
| D4 | **Langue et sous-titres** | **Textes français fixés** (langue 2) ; **mode « texte + voix » par défaut** ; les trois modes du panneau d'origine (texte seul, voix seule, texte + voix) gardés et mémorisés. Pas de choix de langue des textes. | Combinaison native du moteur : les voix ne dépendent pas de la langue. ~1 700 répliques n'ont pas de voix dans l'original : le texte s'affiche alors même en mode « voix seule » (comportement d'origine). |
| D5 | **Panneau de contrôle** | **Garder le panneau dessiné par le jeu** (F5 et son bouton) pour le volume de la musique, la vitesse, les effets, texte / voix, « Recommencer » ; **« Sauvegarder » et « Restituer » ouvrent les dialogues communs du site** ; « Quitter » ramène à l'écran titre. La préférence Son du site coupe tout, comme pour les autres jeux. | Même choix que Lure (D4) et FOTAQ : la liste d'origine, où l'on tape un nom, est peu pratique au toucher. La **vitesse** reste réglable : l'hôte bat à 20 ms (le pas des fondus et des attentes de ScummVM) et le moteur lance un tour de jeu tous les `gameSpeed` ms, sans changer `point-click-app.ts`. |
| D6 | **Sauvegardes** | **Comme Lure** : `SaveSlots` (préfixe `bass:`, 10 emplacements, JSON versionné) ; contenu équivalent à ScummVM (838 variables, 854 compacts, fichiers chargés, état du son) ; refus pendant un choix (`SF_CHOOSING`) ; description = nom de la section + date. | Pas de lecture des sauvegardes de ScummVM (optionnel). Le même contenu que ScummVM garde la comparaison au banc simple. |
| D7 | **Rustines de ScummVM** | **Toutes reprises, en écarts documentés** : six bogues du jeu corrigés par ScummVM (2687, 1804, 1823, 5567, 4230, porte du Reich), le curseur après un clic d'inventaire (8627) et la correction du libellé français. | Sans elles, certaines situations bloquent la partie (Blunt, Joey dans l'ascenseur). Liste dans `engine.md` § 10. |
| D8 | **Introduction** | **Introduction du CD** (narrée), **passable** par Échap, clic ou le bouton « Passer » ; l'introduction des disquettes n'est pas portée. | C'est l'introduction de cette version ; elle est déjà une liste de commandes dans ScummVM. |
| D9 | **Tables écrites dans le code de ScummVM** | **Générées par un script** (`scripts/bass/gen-tables.py`, lancé à la main sur la source de ScummVM) vers `src/games/bass/data/tables/*.ts`, avec la provenance en tête : arbre Huffman 0.0372, `musicList` (effets), table de conversion des voix, noms de compacts et de variables (pour les tests). | Ces tables (~3 000 lignes) ne sont pas dans les données du jeu. Le dépôt est sous GPL v3 : les reprendre est permis ; les générer évite les erreurs de recopie. |
| D10 | **Mutualisation des voix** | **Promouvoir** `VoiceBank` et `SampleChannel` de FOTAQ vers `src/audio/` (second usage), et partager l'encodage MP3 (`ec_encoder_voix` dans `scripts/lib/extract-common.sh`) entre `fotaq-voices.sh` et `bass-extract.sh`. | Touche FOTAQ : risque faible, contrôlé par ses tests, par des MP3 régénérés identiques (encodage `bitexact`) et par une vérification dans le navigateur. Alternative : copier dans BASS, ce que la consigne de mutualisation déconseille. |

## Convention vis-à-vis de ScummVM (alignée sur Drascula, FOTAQ et Lure)

- Chaque module dont le comportement vient de ScummVM cite son fichier de référence en tête (`logic.cpp`, `compact.cpp`, `autoroute.cpp`, `grid.cpp`, `screen.cpp`, `mouse.cpp`, `control.cpp`, `intro.cpp`, `text.cpp`, `disk.cpp`, `sound.cpp`, `music/adlibchannel.cpp`, `music/adlibmusic.cpp`, `music/musicbase.cpp`, `common/compression/rnc_deco.cpp`) et note ses écarts volontaires. On lit, puis on réécrit en TypeScript (noms du dépôt, séquences, numéros magiques nommés dans des `ids.ts`).
- Aucune copie de fichier de ScummVM dans le dépôt ; les tables générées (D9) citent leur source et sa version.
- Le code du remake iOS (`isIbass()`, `inventory.cpp`, `ibasstext.cpp`) et les versions autres que la 0.0372 sont ignorés.
- `README.md` : ligne du tableau des jeux, section « Beneath a Steel Sky », phrase de la section Licence (vague J).

## Ce qui est versionné dans `original/bass/`

Source dans `archives/` (non versionnée) : `bass-cd-1.2.zip`.

| Fichiers | Source | Poids | Versionné |
| --- | --- | --- | --- |
| `sky.dsk`, `sky.dnr` | reconstruits sans les voix (D1) | ~13,3 Mo | oui |
| `sky.cpt` | archive, tel quel (D2) | 410 Ko | oui |
| `voices/<id>.mp3` | 3 491 voix, MP3 (D3) | ~22 Mo | oui |
| `README-BASS.txt` | `readme.txt` de l'archive, intact | 6 Ko | oui, **obligatoire** (licence) |
| `COVER.webp` | jaquette de la boîte d'origine (Wikipédia anglophone) | ~7 Ko | oui |
| `files.json` | `scripts/manifest.py` | ~100 Ko (3 500 entrées) | oui |

**Total : ~36 Mo**, contre 77 Mo pour FOTAQ. Le dossier `original/` publié passe de ~696 Mo à ~732 Mo : la marge sous la limite de 1 Go de GitHub Pages reste d'environ 270 Mo.

**Script d'extraction** `scripts/bass-extract.sh [zip]` (modèle : `scripts/fotaq-extract.sh`, `scripts/lib/extract-common.sh`) : `ec_verifier_outils bsdtar python3 ffmpeg`, `bsdtar` dans un dossier temporaire, contrôle des tailles (`sky.dsk` 72 395 713 octets, 5 097 entrées) et des hachages, `scripts/bass/split_dsk.py` (lancé en `python3 -I`, chemins en arguments : RNC, reconstruction de `sky.dsk` / `sky.dnr` sans les voix, voix en PCM brut), `ec_encoder_voix` (D10), copie de `sky.cpt` et du readme, `ec_conserver COVER.webp`, inventaire `docs/bass/files.md`, `ec_publier`. Idempotent (hachages identiques en deux exécutions).

## Architecture

Voir `engine.md` § 11 (dossiers et groupes). En bref : `data/` (lecteurs purs et tables générées), `engine/` (moteur sans tête : compacts, variables, logiques, interpréteur, mcodes par thème, cheminement, souris, texte, écran, séquences, panneau, sauvegarde), `render/`, `audio/`, `ui/`. Tout ce qui touche au navigateur passe par `BassHost`.

### Séquences

ScummVM bloque dans des boucles locales : introduction, fondus et défilements appelés **au milieu d'un tour de logique**, `fnLookAt`, séquences plein écran, panneau de contrôle, pause. Réécrits en **générateurs** (`src/engine/sequence.ts`), exécutés tick par tick, avec saut et abandon. Cas propre à BASS : le tour de `Logic::engine` devient **reprenable** (il garde sa position dans la liste de logique quand un mcode lance un fondu), tranché en vague C (`engine.md` § 6).

### Cadence

**Lu** : un tour de jeu toutes les 80 ms (`gameSpeed`, réglable dans le panneau), séquences plein écran toutes les 60 ms, fondus et défilements par pas de 20 ms, musique à 50 Hz sur l'horloge audio. L'application bat à **20 ms** (`tickMs: 20`) ; le moteur cumule le temps et lance un tour quand `gameSpeed` est atteint. Le temps du jeu ne dépend pas du son (règle de `WebOpl`).

## Moteur : ce qui est données, ce qui est code

| Partie | Dans les données | À écrire |
| --- | --- | --- |
| Objets, personnages, zones | `sky.cpt` (3 258 compacts) | accès aux champs, alias, remise à zéro |
| Énigmes, PNJ, dialogues | modules de scripts de `sky.dsk` | interpréteur (21 codes), **115 mcodes génériques**, 16 logiques |
| Cheminement | 70 grilles | `autoroute`, empreintes, collisions |
| Écrans | décors, sprites, palettes, séquences | rendu, tri, fondus, défilement, décompression des séquences |
| Textes | 8 sections par langue, police | Huffman, mise en page, bulles, choix |
| Son | pilotes AdLib et d'effets des 7 sections, voix | pilote AdLib, effets, file différée, voix |
| Interface | panneau 60500-60510, curseurs | panneau, souris, touches |

Comme Drascula et FOTAQ, l'essentiel est l'interprétation exacte des données ; contrairement à Lure, **aucune logique d'énigme n'est en C++** : une erreur se voit dans l'interpréteur ou un mcode, et la comparaison des traces au banc la trouve tôt.

## Mutualisation (consigne : mutualiser sans trop dévoyer les jeux)

**Réutilisé tel quel :** `src/engine/sequence.ts`, `save-slots.ts`, `host.ts` (`BaseHost`), `clock.ts`, `storage.ts`, `rng.ts` (`scummvmRandom`, le seul tirage de BASS est `fnRandom`) ; `src/ui/point-click-app.ts` (page, chargement, pause, barre tactile Menu / Passer / Pause, toucher = clic gauche, appui long = clic droit, clavier par `key`), `point-click-dialogs.ts`, `point-click-pages.ts` (écran titre, aide), `point-click-touch.ts`, `point-click.css` ; `src/audio/web-opl.ts`, `opl-stream.ts`, `opl2.ts` (`tickRate` 50 Hz par défaut : exactement celui de BASS) ; `scripts/lib/extract-common.sh`, `scripts/manifest.py`.

**Promu ou étendu (tableau suivant) :** banque de voix de FOTAQ (M1), encodage des voix (M2), `web-sample-output.ts` (M3), `registry.ts` et `README.md` (M4).

**Non utilisé :** `smf.ts`, `track-player.ts`, les pilotes AdLib de Lure (multi-sources, MIDI) et de FOTAQ (`adlib-driver.ts`, MIDI de Queen) : la musique de BASS est un format propre, pas du MIDI.

**Spécifique à BASS :** lecteurs (RNC, index, `sky.cpt`, Huffman, sprites, séquences), compacts, interpréteur, mcodes, `autoroute`, rendu, panneau d'origine, pilote AdLib propre (~400 lignes), table des effets, hôte.

## Évolutions de modules communs proposées

| N° | Fichier | Évolution | Pourquoi | Risque | Statut |
| --- | --- | --- | --- | --- | --- |
| M1 | `src/audio/voice-bank.ts`, `sample-channel.ts` | Promotion de `VoiceBank` et `SampleChannel` (`src/games/fotaq/audio/voices.ts`, `channel.ts`), clés de fichier libres (nom ou numéro). FOTAQ importe la version commune. | Second usage (D10). | Faible : tests de FOTAQ, vérification dans le navigateur | vague A |
| M2 | `scripts/lib/extract-common.sh` | `ec_encoder_voix <entrée> <sortie> [taux]` : la boucle `ffmpeg` de `fotaq-voices.sh`, qui l'appelle ensuite. | Même encodage pour les deux jeux (D10). | Faible : MP3 de FOTAQ régénérés identiques | vague X |
| M3 | `src/audio/web-sample-output.ts` | `PlayOptions.volume` (gain par voix) et `PlayOptions.loopStart` (boucle sur la fin d'un échantillon). Ajouts optionnels, sans effet sur l'existant. | Volume des effets par pièce ; effets qui bouclent sur leur fin. | Nul (ajout) | vague A |
| M4 | `src/games/registry.ts`, `README.md` | Une ligne chacun, section et licence. | Enregistrer le jeu. | Nul | vague J |

Hors dépôt : **banc ScummVM** (`scratchpad/scummvm-build/`) : recompiler avec le moteur `sky` (`./configure --disable-all-engines --enable-engine=drascula,queen,lure,sky`), entrée `[sky]` dans `scummvm-games/cfg/scummvm.ini` (dossier de jeu dans le scratchpad, `language=fr`, `subtitles=true`), graine fixe (`--random-seed`), scénarios `b-intro.txt`, `b-start.txt` (première pièce), captures PNG comparées par `port/run-port.sh bass` ; traces des appels de logique, de script et de mcode par les hooks du débogueur. `skycpt` compilé pour le contrôle de D2.

## Vagues

Chaque vague se termine par `npm run typecheck`, `npm test`, `npm run build` et, dès qu'il y a un rendu, une vérification dans le navigateur.

| Vague | Tâche | Contenu | Tests | Critère de fin | Dépend de |
| --- | --- | --- | --- | --- | --- |
| P | banc | banc ScummVM avec `sky` (compilation, configuration, traces, scénarios d'introduction et de la première pièce) ; `skycpt` compilé | captures produites, trace d'un tour lisible | banc qui produit captures et traces de BASS | — |
| X | extraction | `scripts/bass-extract.sh`, `scripts/bass/split_dsk.py`, M2, `original/bass/`, `docs/bass/files.md` | idempotence ; fichiers du `sky.dsk` reconstruit identiques à ceux de l'archive ; 3 491 MP3 ; régénération de `sky.cpt` (D2) ; écoute de quelques voix | `original/bass/` complet (~36 Mo), licence en place | — |
| D | lecteurs | `data/` : RNC, index, `sky.cpt`, en-têtes, palettes, polices, textes, grilles, pilotes de musique et d'effets ; `scripts/bass/gen-tables.py` (D9) | `formats.md` § 9 : tout lu jusqu'au dernier octet, toutes les lignes françaises décodées, table des accents complète | aucun reste, `formats.md` mis à jour | X |
| V | visionneuse | `ui/asset-viewer.ts` : décors, sprites, palettes, textes, grilles, compacts, scripts désassemblés | chargement du manifeste | on parcourt toutes les ressources | D |
| C | cœur | `engine/` : hôte, boucle sans rendu, compacts, variables, 16 logiques, interpréteur, **table des 115 mcodes** (souches qui journalisent, sauf ceux nécessaires au premier écran), tour reprenable, désassembleur | traces de C comparées au banc sur les premiers tours | l'introduction finie, la première pièce tourne en test (logique seule) | D, P |
| E | marche | `route/` : grilles, `autoroute`, `arAnim`, rotations, collisions, rustine 1804 | des milliers de trajets identiques à ScummVM | Foster et Joey marchent en test | C |
| R | rendu | `render/` : décors, sprites triés, texte, curseurs, palettes, fondus, défilement, séquences ; `graphics.md` ; page de dev | **comparaison au banc** (introduction, première pièce) | images identiques au banc | D, C |
| M | mcodes, **en parallèle** | groupes M1 à M4 d'`engine.md` § 11, chacun dans son dossier ; un test par mcode | traces comparées au banc par section | chaque section se joue en test | C, E |
| A | son | `audio/` : pilote AdLib (`adlib-music.ts`, `adlib-channel.ts`) sur `WebOpl`, effets (M3), voix (M1), `audio.md` ; `scripts/bass/render-music.mts` (WAV hors ligne) | registres OPL identiques à ScummVM pour chaque morceau sur N ticks ; file différée ; voix absente = texte | musique, effets et voix jouent | D |
| I | séquences | introduction du CD, séquences plein écran, fin | ordre, durées, fichiers chargés comparés au banc | introduction et fin jouées | R, A |
| S | panneau, sauvegardes | panneau d'origine (D5), `engine/save.ts`, `ui/saves.ts` (D6), « Recommencer » | aller-retour à chaque étape de la solution ; reprise en pleine marche, pendant un dialogue, pendant un fondu | sauvegarder et reprendre partout | C, R |
| J | intégration | `ui/` (app, hôte, préchargement de `sky.dsk` puis voix à la demande), touches (F5, Échap, `.`, `p`), toucher, `index.ts`, `copy.ts`, `title.ts`, `help.ts` (licence, ScummVM, mention de version modifiée), `COVER.webp` (jaquette de la boîte d'origine), M4 | hôte, préchargement | jeu jouable dans le navigateur, ordinateur et téléphone | toutes |
| K | validation | partie complète en test (solution jouée par clics simulés, puis avec reprises), comparaisons au banc par section, revue fonctionnelle et visuelle, README | | fin du jeu atteinte ; revue | J |

Parallélisme : P et X indépendants. Après D : V, C, A en parallèle (A ne dépend que des lecteurs). Après C : E et R en parallèle ; M dès que E est là pour M2. I après R et A ; S après R. **M se découpe en quatre groupes** (convention d'`engine.md` § 11 : ne rien modifier hors de son dossier, signaler tout besoin partagé).

## Estimation

Base : Lure (16 900 lignes de C++ utiles, estimé 13 000 à 16 000 lignes de TypeScript) ; BASS : ~11 900 lignes de C++ utiles hors musique, ~700 de musique AdLib, ~3 000 de tables générées.

| Vague | Taille relative | Lignes estimées | Incertitude |
| --- | --- | --- | --- |
| P | petite | banc (hors dépôt) | faible (même méthode que Lure) |
| X | petite | scripts 300 | faible |
| D | moyenne | 1 600 + tables générées | faible (formats vérifiés) |
| V | petite | 600 | faible |
| C | grande | 1 800 (compacts, logiques, interpréteur, tour reprenable) | moyenne (fondus au milieu du tour) |
| E | moyenne | 900 | faible à moyenne |
| R | moyenne à grande | 1 600 (dont séquences compressées) | moyenne |
| M | grande, en parallèle | 2 600 (115 mcodes) | moyenne |
| A | moyenne | 900 (AdLib 400, effets, voix) | moyenne (fidélité du tempo et du timbre) |
| I | moyenne | 700 | faible |
| S | moyenne | 1 300 (panneau d'origine et sauvegarde) | faible à moyenne |
| J, K | moyennes | 1 200 | moyenne (solution complète) |

Total : **12 000 à 15 000 lignes** (autant de tests), soit **un peu moins que Lure** : logique plus simple (un seul interpréteur, aucune énigme en C++), données et son plus lourds. Chemin critique : X, D, C, E, M, K.

## Requis, naturellement lié, optionnel

**Requis** : P, X, D, C, E, R, M, A, I, S, J ; D1 à D10 tranchées ; `README-BASS.txt` dans `original/bass/` ; mention de version modifiée dans l'aide (voix converties, données reconstruites, moteur réécrit).

**Naturellement lié** : V ; K ; `docs/bass/*.md` ; table des accents vers Unicode (tests lisibles, texte accessible) ; M1 à M3.

**Optionnel, à part** : autres langues des textes (déjà dans les données, ~0,8 Mo) ; sous-titres anglais ; lecture des sauvegardes de ScummVM ; musique General MIDI / MT-32 ; musique numérique du « Music Enhancement Project » ; version disquette ; préchargement des voix d'une scène ; chargement de `sky.dsk` par morceaux (requêtes partielles) au lieu d'un tout au départ.

## Cas limites

- **Données** : 26 fichiers marqués compressés sans signature RNC, 4 compressés mais marqués non compressés (à laisser tels quels) ; identifiants absents de l'index ; taille décompressée sur 24 bits.
- **Textes** : caractères accentués détournés ; lignes sans voix (sous-titre forcé) ; texte trop long pour 10 lignes ; bulles près des bords ; libellé français corrigé par ScummVM.
- **Voix** : MP3 introuvable ou en retard (réseau) : le sous-titre s'affiche, la réplique se termine au bout d'un délai borné (comme `LOAD_TIMEOUT_MS` de FOTAQ) ; clic qui coupe la voix ; voix en cours pendant une sauvegarde, une pause, un onglet masqué.
- **Logique** : fondu lancé au milieu d'un tour (reprise exacte) ; débordements 16 bits ; `less_than` / `more_than` inversés ; alias de compacts ; changement de section (musique, effets, grilles rechargés).
- **Marche** : destination inaccessible ; départ ou arrivée hors écran ; deux personnages qui se croisent ; Joey qui bloque une porte (rustine 1804).
- **Interface** : inventaire en haut de l'écran au toucher (pas de survol : il faut un appui dans la bande du haut) ; clic droit au toucher (appui long) ; panneau ouvert pendant un dialogue ; sauvegarde refusée pendant un choix ; vitesse au minimum et au maximum.
- **Son** : effets limités à certaines pièces ; départ différé ; boucle sur la fin ; effets relancés au chargement ; musique coupée puis remise ; « Sans son » coupe tout.
- **Recommencer** : remise à zéro complète par les données de `sky.cpt`, aucun état résiduel (son, séquences, texte).
- **Fin du jeu** : séquence et générique, retour à l'écran titre.

## Risques

- **Tour de logique reprenable (C)** : un fondu au milieu d'un tour est le seul point où la structure de ScummVM ne se transpose pas directement ; une erreur décale l'ordre des compacts. Atténuation : traces comparées au banc à chaque tour.
- **Fidélité de l'interpréteur et des 115 mcodes (M)** : une erreur bloque une énigme plus loin. Atténuation : `scummvmRandom` et même graine que le banc, traces par section, solution complète jouée en test puis avec reprises.
- **Séquences compressées et sprites (R)** : formats seulement lus pour l'instant. Atténuation : vague D et comparaison d'images au banc.
- **Voix (X, A)** : poids réel des 3 491 MP3 (estimé ~22 Mo), latence au début de chaque réplique sur réseau lent. Atténuation : délai borné, préchargement optionnel.
- **Poids du site** : +36 Mo, ~732 Mo publiés sur 1 Go.
- **Autres jeux** : M1 et M2 touchent FOTAQ (tests, MP3 identiques, navigateur) ; M3 est un ajout ; `registry.ts` et `README.md` : ajout seul.
- **Licence** : readme de Revolution conservé intact, mention visible de version modifiée (article 4), code de ScummVM lu et réécrit, tables générées avec leur provenance.

## Validation

- Chaque vague : `npm run typecheck`, `npm test`, `npm run build` ; tests des lecteurs sur les fichiers réels, ignorés si `original/bass/` est absent.
- **Banc ScummVM sans fenêtre** : moteur `sky` ajouté (P), même graine, captures et traces comparées par `port/run-port.sh bass` (introduction, première pièce, une scène par section).
- Rendu dans le navigateur à chaque vague visuelle (R, I, S, J) : échelle, inventaire, bulles, panneau, responsive, tactile, états (chargement, erreur de fichiers, son coupé, onglet masqué), accessibilité (focus du canvas, texte des répliques).
- Parcours : chaque section en test (M), partie complète d'un trait et avec reprises (K).
- Écoute par une personne : voix, musique AdLib et effets comparés à ScummVM.
- Contrôle de licence avant J : `README-BASS.txt`, README du dépôt, mention de version modifiée.

## Dette technique à surveiller

- Numéros magiques de ScummVM (compacts, variables, mcodes) : constantes nommées (`ids.ts`, noms générés).
- Champs de compacts lus par rang : garder les `Uint16Array` bruts et les accesseurs générés ; ne pas réintroduire d'objets dans l'état (sauvegarde simple).
- Tables générées depuis ScummVM (D9) : à régénérer, jamais à modifier à la main.
- Banque de voix promue (M1) : FOTAQ et BASS doivent rester sans référence l'un à l'autre.
