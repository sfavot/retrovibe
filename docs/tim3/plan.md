# The Incredible Machine 3 : plan d'implémentation

Jeu : *The Incredible Machine 3* (Dynamix / Sierra, 1995), **version 3.0 pour Windows 3.x** (Win32s + WinG). Source : `archives/tim3/jeu-00235-incredible_machine_3-pcwin.7z` (Abandonware France), qui contient `IncMac3.iso`.

C'est un jeu de puzzles mécaniques en 640×480 et 256 couleurs. On construit une machine en déposant des pièces (balles, cordes, poulies, courroies, moteurs, animaux…) dans l'aire de jeu, puis on la met en marche ; la simulation physique décide si le but est atteint. Le jeu contient :
- **156 puzzles** répartis en cinq niveaux : 40 de travaux pratiques, 26 faciles, 30 moyens, 31 difficiles, 29 très difficiles ;
- **50 puzzles « HH »** (mode à deux joueurs, porté : D12, `ui.md` § Deux joueurs) ;
- le **Labo**, un atelier libre (« Professor Tim's Workshop »).

Textes en cinq langues dont le **français**. **Voix anglaises** du professeur (43 minutes : buts, indices, aide). Musique **HMI General MIDI** (24 morceaux). 121 effets WAV.

Ce document est le brief commun aux sous-agents, sur le modèle de `docs/bass/plan.md`. Les références font foi dans cet ordre :
1. `formats.md` : formats, avec pour chaque fait le niveau vérifié, lu ou supposé ;
2. `engine.md` : moteur de `TIMWIN.EXE`, physique, vérification, découpage ;
3. ce plan.

S'ajouteront ensuite `files.md` (généré par l'extraction), `graphics.md`, `audio.md` et `ui.md`.

**Il n'existe pas de moteur de référence libre pour TIM3.** La référence de comportement est le binaire, lu en statique, avec **OpenTIM** (GPL-3.0, TIM1 et TEMIM, même lignée de moteur) pour le noyau commun, et, si D2 est acceptée, des traces du binaire exécuté dans un émulateur de processeur.

## Avancement

- **Étude faite** (vague 0) :
  - archive et ISO extraites dans le scratchpad, sans rien exécuter ;
  - conteneur Dynamix lu entièrement : 1 530 ressources, tailles exactes ;
  - images, palettes, textes français, voix et effets décodés ;
  - en-tête des LEV lu ; enregistrements de pièces documentés par timgres, à revérifier ;
  - `TIMWIN.EXE` cartographié : table des types de pièces, pas de simulation, virgule fixe 1/512, aucun flottant, aucun hasard.
- **Verdict : faisable.** Le jeu est plus gros que BASS par son cœur, car on réécrit ~26 000 instructions de simulation, et plus simple en données (presque pas de compression, pas de scripts).
- Seuls `docs/tim3/plan.md`, `formats.md` et `engine.md` ont été créés ; aucun code.
- **15/11/2026** : vagues X, P (banc Unicorn, format v2), D, V, A (commun + jeu), Φ1, Φ2 et R faites ; **les 206 niveaux complets donnent des traces identiques au banc sur 600 pas** (`traces.test.ts`, 633/633). En cours : U. Rien commité.
- **Vague F** : l'aide du professeur est portée (`HELP.ITF`, mode aide de l'écran et du menu principal, professeur animé et
  synchronisé sur sa voix, aussi dans `BINSOLVE`) : `ui.md` § Aide du professeur.
- **Outils du Labo** (éléments différés, faits le 15/11/2026) : cadenas (`HTLOCK`, cadenas de chaque pièce), levier d'essai (mode 8),
  éditeur d'indices, but écrit dans la barre, conditions de réussite (`SOLVE.ITF`), onglets du bac (décors 110 à 280 compris), puzzles
  maison jouables depuis le bac « Puzzles Personnels » avec leur progression ; sauvegardes en version 2 avec migration de la version 1 :
  `ui.md` § Outils du Labo. Écarts : poignées des décors, mesure du délai en marche, voix de l'éditeur d'indices.
- **Inscription et visite guidée** (15/11/2026, les deux derniers modes grisés) : registre des joueurs (`SIGNIN.ITF`, invité « Hôte » au
  lancement, 100 joueurs inscrits au plus, progression et aires gardées de chacun, migration de la progression d'avant vers l'invité) ;
  visite guidée du Labo (mode 6, chaussure et « Exercice » : le professeur fait construire un puzzle maison pas à pas dans `HELP.ITF`,
  textes et voix de `PROFESOR.RES` / `PROFESOR.VOC`, portrait `TB_WALKTHROUGH` dans la barre) : `ui.md` § Inscription, § Visite guidée.
  Plus aucun bouton grisé. `TOUR.ITF` (démonstrations rejouées `TOUR<n>.REC`, absentes du CD) n'est pas porté.
- **Décisions déjà prises par l'utilisatrice** :
  - on porte **TIM3**, pas TIM1 ; l'installeur de TIM1 DOS fourni ne sert que de référence éventuelle (`engine.md` § 6) ;
  - consigne générale : « mutualiser avec ce qu'on a déjà, sans pour autant trop dévoyer les jeux » ;
  - **D1 tranchée le 14/11/2026** : les données sont versionnées comme pour Zoombinis et les autres jeux.
- **D2 à D13 et M1 à M3 validées par l'utilisatrice le 14/11/2026**, telles que recommandées ci-dessous (dont l'exécution de `TIMWIN.EXE` sous Unicorn, hors dépôt, et la promotion du synthé General MIDI).

## Point légal (à lire)

**TIM3 est un abandonware, pas un freeware.**
- Les droits de la série sont passés de Sierra / Vivendi à PushButton Labs (Jeff Tunnell, 2009), puis probablement à Disney, via Playdom.
- La collection a été vendue sur GOG et Steam (« The Incredible Machine Mega Pack »), apparemment jusqu'en 2026 environ ; son retrait n'est attesté que par un message de forum.
- Aucun ayant droit n'a donné de licence de redistribution, contrairement à Drascula, FOTAQ, Lure et BASS, dont le readme ou la licence accompagne les données.

Le dépôt publie déjà d'autres abandonwares sur la même base (Zoombinis, SWIV 3D, Mathémagique, Téléportaschtroumpf, Indy, Lost in Time, Armaeth). **L'utilisatrice a choisi de traiter TIM3 de la même façon (D1).** Le risque est un peu plus élevé que pour certains de ces jeux, car le titre a été vendu récemment et son ayant droit est identifiable. Il est signalé ici et ne bloque pas le portage.

**Code d'OpenTIM** : GPL-3.0, compatible avec la licence du dépôt (GPL v3 ou ultérieure). On le traduit avec attribution, comme le code de ScummVM ailleurs.

## Décisions

| N° | Question | Recommandation | Faits et conséquences |
| --- | --- | --- | --- |
| D1 | **Données versionnées et droits** | **Tranchée : comme Zoombinis et les autres.** `original/tim3/` versionné et publié, sans licence de redistribution (il n'y en a pas). Le README le traite comme les autres abandonwares. | Voir « Point légal ». `Lisez-Moi.txt` d'Abandonware France n'est pas une licence : on ne le versionne pas. On garde la mention de copyright du jeu (« © 1992-1995 Sierra On-Line / Dynamix ») dans l'aide du jeu. |
| D2 | **Référence de comportement : exécuter le code du jeu dans un émulateur** | **Oui : banc Unicorn hors dépôt** (`engine.md` § 7). Venv Python dans le scratchpad (`unicorn`, `capstone`). `TIMWIN.EXE` chargé en mémoire, ses fonctions de simulation appelées directement, sans Windows ni fenêtre, et chaque pièce relevée à chaque pas. **Les traces de référence ne sont pas versionnées** (`test/tim3/traces/`, ignoré par git) ; les tests sont ignorés si elles manquent. | **Seul moyen d'une physique fidèle au bit près.** Il faut l'accord explicite de l'utilisatrice : c'est l'exécution du code du jeu, même isolée, et l'installation de deux paquets Python, hors dépôt. Sans accord : lecture statique, tests de propriétés et solutions jouées de bout en bout, avec un risque de divergences fines (arrondis, ordre des passes) qui ne se verraient qu'en jeu. Wine + winedbg reste un contrôle ponctuel possible (interface, cadence), pas un banc. |
| D3 | **OpenTIM** | **Lu et traduit avec attribution** pour le noyau commun : atmosphère, tables, `advance_parts`, cordes, courroies. Chaque module qui s'en inspire cite son fichier source. Rien n'est copié tel quel : on réécrit en TypeScript, avec les offsets et les cas propres à TIM3. | GPL-3.0. OpenTIM cible TEMIM : pièce de 0xA2 octets contre 0x10C ici, et il lui manque environ 80 types de pièces. Le binaire de TIM3 fait foi en cas d'écart. |
| D4 | **Langue, voix, sous-titres** | **Textes français fixés** (`FRENCH.DAT` par-dessus `RESOURCE.00x`). **Voix anglaises gardées, activées par défaut, désactivables** dans les options (préférence mémorisée). Le but et les indices restent toujours affichés en français. | Il n'existe pas d'autre voix : elles sont anglaises dans toutes les versions. C'est le choix fait pour BASS (voix anglaises, textes français). La synchronisation des lèvres du professeur se lit dans les VOC (vague A). |
| D5 | **Encodage des voix** | **Comme FOTAQ et BASS** : MP3 CBR 24 kb/s, mono, 22 050 Hz, par `ec_encoder_voix`. Un fichier par réplique (`voices/goals/017.mp3`, `voices/hint3/017.mp3`, `voices/help/042.mp3`…), **chargé à la demande** par `VoiceBank`. La synchronisation des lèvres est extraite à part (`voices/lipsync.json` ou binaire). | Source : WAV 8 bits à 11 025 Hz dans des archives maison (`*.VOC`, ~29 Mo de PCM). Estimation : **~8 Mo** de MP3. |
| D6 | **Musique** | **HMI lu à l'exécution** par un lecteur commun `src/audio/hmi.ts`. Il produit le même `Song` que `smf.ts`, joué par `TrackPlayer` sur le **synthé General MIDI du site** (spessasynth, soundfont réduite déjà servie). Pas de conversion à l'extraction. | Les fichiers restent tels quels (contrôle par hachage). Le tempo HMI n'est pas encore établi (`formats.md` § 12) ; on pourra le comparer à l'enregistrement de la piste sous Wine si besoin. Les `.BNK` (AdLib) et les pistes CD n'existent pas dans cette ISO ou ne sont pas utilisées. |
| D7 | **Interface** (révisée le 15/11/2026) | **Tout est dessiné comme dans le jeu** : aire de jeu, bac, barre d'outils (boutons selon le mode, bouton du mode enfoncé ; plus de mode non porté depuis l'inscription et la visite guidée) et **fenêtres** (`.ITF` : cadre `CORNERS.BMP`, boutons `BUTTONS.ANM`, police `SYS12.PFT`, textes `INTRFACE.RES`), dans le canvas. Un **calque DOM de vrais boutons transparents** posés sur les rectangles des `.ITF` (`role="dialog"`, focus gardé, texte pour lecteur d'écran) donne le clavier, le toucher et l'accessibilité. Seul ce qui est propre au site reste en DOM : réglage des voix, crédits. | Première version : fenêtres DOM du site. L'utilisatrice l'a jugée non fidèle (écran de victoire, barre d'outils) : les fenêtres d'origine sont toutes des `.ITF` que le portage sait lire. Ordre : `GENERIC` (confirmations), `PUZZSOLV` (victoire, avec « Rejouer la Solution »), puis `INFO`, `PROG*`, `GRAVITY`, `MUSICBOX`, `BINSOLVE`, enfin `DOSBIN`/`DOSBOX` (choix du puzzle) et l'aide du professeur. |
| D8 | **Pointeur et toucher** | **Glisser-déposer unifié** (souris et toucher, Pointer Events) : prendre une pièce du bac, la poser, la déplacer, la renvoyer au bac. Les boutons d'origine (retourner X/Y, taille +/−) plus les **raccourcis d'origine** (X, Y, +, −, Échap). Lien de corde et de courroie par deux appuis. Au toucher, la pièce saisie est dessinée **décalée au-dessus du doigt**. | Pas de survol au toucher : les infobulles de pièce passent par un appui long dans le bac. |
| D9 | **Application : `mountGameShell`, pas `point-click-app`** | **`mountGameShell` + `TickScheduler` + `bindCanvasPointer` / `PointerQueue` + `SoundPrefs` + `SaveSlots`**, comme Armaeth et SWIV 3D. | `point-click-app` est fait pour l'aventure (« Passer », clic et appui long = deux boutons, sous-titres, sauvegardes de partie). L'adapter à un jeu de construction le dévoierait. |
| D10 | **Cadence** | **Un pas de simulation toutes les 32 ms** (`tickMs: 32`, ≈ 31 Hz), comme le minimum d'attente de la boucle d'origine. Rendu à chaque image du navigateur. | Le jeu tournait plus lentement si le dessin prenait plus de 32 ms ; on retient la cadence nominale. À confirmer sous Wine (contrôle ponctuel) si D2 est acceptée. La physique ne dépend pas de la cadence (pas fixe). |
| D11 | **Sauvegardes et progression** | **Progression** (puzzles résolus, dernier puzzle) en stockage local, préfixe `tim3:`, **par joueur** (`p<n>:`, `ui.md` § Inscription, révisé le 15/11/2026). **Machines du Labo** dans `SaveSlots` : 10 emplacements, JSON versionné qui reprend les champs d'un LEV, nom saisi. **Puzzle en cours** : l'état d'édition est gardé à la sortie, jamais en pleine simulation. | Le jeu d'origine sauvegarde ses machines en fichiers LEV : on garde le même contenu, sans écrire de fichier. Pas de lecture des sauvegardes d'origine (optionnel). |
| D12 | **Puzzles HH, mode à deux joueurs** (révisé le 15/11/2026) | **Porté** (`engine/duel.ts`, `ui/duel-window.ts`, `render/duel-board.ts`, `ui.md` § Deux joueurs), lu dans TIMWIN.EXE (mode 2) : deux joueurs sur le même écran, réglages `HEDTOHED.ITF` (parties, durée du tour de chacun, noms), à tour de rôle sur le même puzzle, **une pièce du bac et une pièce de l'aire par tour**, chronomètre, « Terminer le Tour », tableau `H2H.ITF`, match au meilleur des N parties. Le bac Deux joueurs de `DOSBIN` est actif (puzzle HH joué seul en Jeu, partie suivante en mode 2). | Première livraison : reporté. La lecture de l'exe a corrigé la règle supposée en vague D (« une action par tour ») : deux limites indépendantes (31152, 31153). Ni réseau ni ordinateur adversaire, comme l'original. |
| D13 | **Tables tirées de l'exe** | **Générées par un script** (`scripts/tim3/gen-tables.py`, lancé à la main sur `TIMWIN.EXE`) vers `src/games/tim3/data/tables/*.ts`, avec la provenance (adresse) en tête : cosinus Q14, arctangente, constantes des types sans `.PAR` (149 à 280). Contrôle : octet pour octet identiques à l'exe. | Ces tables ne sont pas dans les ressources. Les générer évite les erreurs de recopie, comme pour BASS (D9). L'exe lui-même est versionné (D1) mais n'est pas lu à l'exécution. |

## Mutualisation (consigne : mutualiser sans trop dévoyer les jeux)

**Réutilisé tel quel :**
- `src/ui/game-shell.ts` (page, chargement, erreurs, son, plein écran, pause), `tick-scheduler.ts`, `pointer.ts`, `pointer-queue.ts`, `sound-prefs.ts`, `file-store.ts`, `files.ts`, `dom.ts`, `title-screen.ts`, `fullscreen.ts` ;
- `src/engine/clock.ts`, `host.ts` (`BaseHost`), `storage.ts`, `save-slots.ts`, `sequence.ts` (séquences du professeur, fin de puzzle, écrans de transition) ;
- `src/data/game-files.ts` (`fetchGameFiles`, `original/tim3/files.json`), `reader.ts` ;
- `src/audio/smf.ts` (type `Song`), `track-player.ts`, `voice-bank.ts`, `sample-channel.ts`, `web-sample-output.ts`, `pcm.ts` ;
- `scripts/lib/extract-common.sh` (`ec_verifier_outils`, `ec_publier`, `ec_encoder_voix`), `scripts/manifest.py` ;
- `test/support/` (hôte factice, faux contexte audio, `original.ts`).

**Promu ou ajouté en commun (tableau suivant) :** lecteur HMI (M1), sortie General MIDI (M2), `registry.ts` et `README.md` (M3).

**Non utilisé :**
- `point-click-app` (D9) ;
- l'OPL et les pilotes AdLib (la musique est en General MIDI) ;
- le lecteur NE d'Indy (TIM3 est un PE32, et l'exe n'est pas lu à l'exécution) ;
- `parseVoc` de Téléportaschtroumpf : les `.VOC` de TIM3 ne sont pas du Creative Voice ;
- `rng.ts`, car la simulation n'a pas de hasard (à confirmer en Φ1) ;
- la virgule fixe de SWIV 3D (autre échelle, autres opérations) : on reprend seulement l'approche.

**Spécifique à TIM3 :**
- lecteurs Dynamix (volume, LZW, RLE, BMP, ANM, ITF, polices, LEV, PAR, archives VOC) ;
- moteur physique et pièces, éditeur de machines ;
- rendu, interface dessinée, hôte.

Le LZW et le RLE Dynamix restent dans le jeu : un seul fichier les utilise, et aucun autre jeu du dépôt n'est un jeu Dynamix.

## Évolutions de modules communs proposées

| N° | Fichier | Évolution | Pourquoi | Risque | Statut |
| --- | --- | --- | --- | --- | --- |
| M1 | `src/audio/hmi.ts` (nouveau) | Lecteur HMI (Human Machine Interfaces, « HMIMDRV ») qui produit un `Song` (`smf.ts`). | Format MIDI standard de l'époque, utile à d'autres jeux Sierra ou HMI ; il est à sa place à côté de `smf.ts`. | Nul (ajout) | vague A |
| M2 | `src/ui/mohawk/web-sink.ts` → `src/audio/web-gm-synth.ts` | Sortir de `web-sink.ts` la partie synthé General MIDI (spessasynth, envoi daté, coupure, reprise iOS), paramétrée par l'URL de la soundfont. `web-sink.ts` (Mathémagique, Zoombinis) l'utilise ensuite. | Troisième usage du synthé General MIDI ; aujourd'hui, l'URL de la soundfont pointe vers `original/mathemagique/` et le code est lié aux types Mohawk. | **Moyen** : touche le son de Mathémagique et Zoombinis (iOS, reprise après interruption). Atténuation : déplacement sans changement de comportement, tests de `test/shared`, vérification dans le navigateur des deux jeux. Alternative sans risque : TIM3 importe `web-sink.ts` tel quel, mais avec une dépendance à `mohawk/`, que la consigne déconseille. | vague A, validée |
| M3 | `src/games/registry.ts`, `README.md` | Une ligne au tableau, une section TIM3 ; dans la section Licence, rien de plus que pour les autres abandonwares (D1). | Enregistrer le jeu. | Nul | vague J |

La soundfont réduite est déjà servie depuis `original/mathemagique/`. **TIM3 la réutilise par son URL, sans la copier** : si M2 est fait, elle est passée en paramètre. Son déplacement vers un dossier commun est optionnel.

## Ce qui est versionné dans `original/tim3/`

Source dans `archives/tim3/` (non versionnée) : `jeu-00235-incredible_machine_3-pcwin.7z`. Le script accepte un autre chemin en argument.

| Fichiers | Source | Poids | Versionné |
| --- | --- | --- | --- |
| `RESOURCE.MAP`, `RESOURCE.001`, `RESOURCE.002` | ISO, tels quels | 9,3 Mo | oui |
| `FRENCH.DAT` | ISO, tel quel | 0,45 Mo | oui |
| `TIMWIN.EXE` | ISO, tel quel (source des tables, D13 ; pas lu à l'exécution) | 0,45 Mo | oui, pour régénérer les tables et faire tourner le banc |
| `voices/<archive>/<n>.mp3` (654), `voices/lipsync.json` | `GOALS.VOC`, `HINT1-7.VOC`, `HELP.VOC`, `PROFESOR.VOC` (D5) | 7,6 Mo (mesuré) + 0,08 Mo | oui |
| `COVER.png` | `scripts/tim3-cover.mts` (vague J), un puzzle dessiné par le moteur | ~40 Ko | oui |
| `files.json` | `scripts/manifest.py` | petit | oui |

**Total : 17,4 Mo mesuré (hors `COVER.png`).** Autres langues (`GERMAN.DAT`…), aide `.MVB`, DLL, Win32s, WinG et démo Dr. Brain : non versionnés.

**Script d'extraction** `scripts/tim3-extract.sh [7z]`, sur le modèle de `scripts/bass-extract.sh` et `zoombinis-extract.sh` :
- `ec_verifier_outils 7zz python3 ffmpeg` ;
- `7zz` dans un dossier temporaire vide (archive, puis ISO) ;
- contrôle des tailles et des hachages ;
- `scripts/tim3/split_voc.py` (lancé en `python3 -I`, chemins en arguments : archives VOC vers WAV et synchronisation des lèvres) ;
- `ec_encoder_voix`, copie des fichiers tels quels, `ec_conserver COVER.png` ;
- inventaire `docs/tim3/files.md`, puis `ec_publier`.

Le script est idempotent (mêmes hachages en deux exécutions).

## Architecture

Voir `engine.md` § 9. En bref :
- `data/` : lecteurs purs et tables générées ;
- `engine/` : simulation sans tête, éditeur, session de puzzle, sauvegarde ;
- `render/` ;
- `audio/` ;
- `ui/`.

Tout ce qui touche au navigateur passe par `Tim3Host` (`BaseHost` + son, voix, stockage).

**Boucle** : l'état « édition » ne fait pas avancer la physique. L'état « en marche » lance un pas toutes les 32 ms (D10) et teste les conditions de victoire après chaque pas. « Arrêter » remet la machine dans son état d'avant la mise en marche, comme l'original, à partir d'une copie de l'état d'édition prise au démarrage. Les séquences (professeur, puzzle réussi, transitions) sont des générateurs (`sequence.ts`).

**Rendu** : canvas logique en 640×480, `fit: "fractional"`. Palette 8 bits rendue en RGBA. Les cordes et les courroies sont tracées à chaque image comme dans l'original (lignes, pas des sprites).

## Vagues

Chaque vague se termine par `npm run typecheck`, `npm test`, `npm run build` et, dès qu'il y a un rendu, une vérification dans le navigateur. Le dépôt n'a pas de script `lint`.

| Vague | Tâche | Contenu | Tests | Critère de fin | Dépend de |
| --- | --- | --- | --- | --- | --- |
| X | extraction | `scripts/tim3-extract.sh`, `scripts/tim3/split_voc.py`, `original/tim3/`, `docs/tim3/files.md` | idempotence ; hachages ; nombre de voix ; écoute de quelques voix | `original/tim3/` complet (~18 Mo) | — |
| P | banc (si D2) | hors dépôt : venv Unicorn, chargeur PE, stubs d'imports, appel de 433b13, 431d3f et 433334 ; format de trace commun ; scénarios minimaux ; traces des 206 niveaux en marche libre (N pas) et avec leur solution | une trace stable en deux exécutions | traces produites, déterministes | X |
| D | lecteurs | `data/` : volume, LZW et RLE, BMP v1000 et DGDS, palettes, ANM, ITF, FNT, PFT, LEVELS.INF, **LEV complet** (206 fichiers relus et réécrits à l'identique), PAR, textes, solutions ; `gen-tables.py` (D13) | tout lu jusqu'au dernier octet ; `formats.md` § 12 refermé | aucun reste, `formats.md` mis à jour | X |
| V | visionneuse | `ui/asset-viewer.ts` : images, animations, palettes, pièces et polygones, niveaux dessinés statiquement, textes | chargement du manifeste | on parcourt toutes les ressources | D |
| Φ1 | noyau physique | `engine/` : `fixed.ts`, tables, descripteurs, pièces, listes, chargement d'un niveau, **pas de simulation 433334 complet** avec gravité, déplacement, collisions et rebond (42bb02, 43a31d) ; handlers par défaut ; murs, pentes, balles ; `trace.ts` | valeurs de l'exe (269, 9 695) ; **traces comparées au banc** sur les scénarios « balles et murs » | les puzzles faits seulement de balles, de murs et de pentes donnent des traces identiques | D (P pour la comparaison) |
| Φ2 | pièces, **en parallèle** | groupes de `engine.md` § 5 : électricité et lasers ; rotation (moteurs, engrenages, courroies, convoyeurs) ; couplages (cordes, poulies, seaux, bascules, ballons) ; animaux et personnages ; création et destruction (explosions, fusées, canon) ; divers. Un dossier par groupe. | une trace par pièce (scénario minimal) + les niveaux qui l'utilisent | tous les types 0 à 148 ; traces identiques sur les 206 niveaux | Φ1 |
| R | rendu | `render/` : aire de jeu, fonds, pièces animées, retournées et à leur taille, cordes et courroies, bac, interface dessinée, curseurs, polices ; `graphics.md` | images comparées à des captures sous Wine (contrôle ponctuel) ou à des sommes de contrôle de référence | puzzles dessinés comme l'original | D, Φ1 |
| U | interface et éditeur | `engine/editor.ts` (placement, chevauchement, retournement, taille, liens, pièces fixes), conditions de victoire, session (puzzle, Labo, essais), professeur (but, indices), menus DOM (choix du puzzle, options, Labo), `ui.md` | éditeur sans navigateur ; parcours de menus | un puzzle se résout à la souris et au toucher | R, Φ1 |
| A | son | M1, M2, musique des niveaux, effets WAV déclenchés par les pièces, voix (D4, D5) et synchronisation des lèvres ; `audio.md` | évènements HMI ; effets déclenchés au bon pas (traces) ; voix absente = texte seul | musique, effets et voix jouent | D |
| S | sauvegardes | progression, machines du Labo, état d'édition (D11) | aller-retour ; reprise après rechargement | sauvegarder et reprendre partout | U |
| J | intégration | `ui/` (app, hôte, préchargement des ressources puis voix à la demande), `index.ts`, `copy.ts`, `title.ts`, `help.ts` (copyright, OpenTIM), `scripts/tim3-cover.mts`, M3 | hôte, préchargement | jeu jouable dans le navigateur, sur ordinateur et téléphone | toutes |
| K | validation | **les 156 puzzles résolus en test** avec des **solutions écrites pour le port** (`test/tim3/solutions/*.json` : pièces du bac placées, positions, liens), vérifiées d'abord sur le banc (le binaire doit les déclarer résolues), Labo, revue fonctionnelle et visuelle, README | | tous les puzzles résolus ; revue | J |
| F | interface fidèle (ajoutée le 15/11/2026, D7 révisée) | barre d'outils selon le mode ; moteur de fenêtres `.ITF` dessinées avec calque DOM accessible ; `GENERIC`, `PUZZSOLV`, `INFO`, `PROG*`, `GRAVITY`, `MUSICBOX`, `BINSOLVE` ; **parcours d'entrée** : logo Sierra (`SIERRA.BMP`, fondu `SIERRA00…17.PAL`), titre animé (`TITLE.ANM`, `TITLE2.ANM`, musique), menu principal (`MAINMENU.ITF`, tous les modes portés), crédits (`CREDITS.ITF`, `CREDITS.RES`), choix du puzzle par bacs (`DOSBIN.ITF`) puis liste (`DOSBOX.ITF`), fiche du puzzle (`PUZZDISP.ITF`) ; aide du professeur en dernier | rendu des `.ITF` (PNG), rectangles cliquables, parcours | parcours d'origine du lancement au puzzle, au toucher et au clavier | U, J |

Groupes de Φ2 (un dossier `engine/parts/<famille>/` chacun ; les fonctions partagées entre types vont au groupe indiqué ; **seul `mechanics` modifie le noyau** (`step.ts`, `bounce.ts`, `collide.ts`, `move.ts`, `lists.ts`, `world.ts`, `part.ts`) ; les autres signalent leurs besoins de noyau au lieu de le modifier) :

| Groupe | Types |
| --- | --- |
| `mechanics` (noyau) | cordes, câbles, poulies, courroies, bout de corde : 7, 8, 10, 49, 76 ; seaux 17, 108 ; bascules 3, 139 ; taquet 23 ; engrenages 14, 86 ; convoyeur 5 ; moteurs 6, 50, 51 ; cafetière 62 ; pompe 16 ; ventilateur 24 ; générateur 26 ; moulinet 40 ; Trans-Roto-Matic 89, 90 ; mixeur 107 ; liste auxiliaire 0x4815f8, ordre du bac, passe lasers de 433334 (43d013) |
| `electric` | 20, 21, 22, 25, 27, 29, 30, 38, 91–96, 120, 136, 137, 148 |
| `creatures` | 12, 13, 31, 32, 33, 34, 42, 52, 54, 58, 61, 65, 66, 81 |
| `pyro` | 18, 19, 36, 41, 45, 55, 70, 73, 74, 75, 78, 79, 80, 109, 138 |
| `misc` | 4, 11, 15, 35, 37, 39, 43, 47, 53, 57, 59, 63, 64, 67, 69, 71, 72, 77, 87, 88, 97, 98, 116–119, 127 |

Parallélisme :
- X d'abord ; ensuite P et D en parallèle.
- Après D : V, Φ1 et A en parallèle.
- Après Φ1 : Φ2 (cinq ou six groupes en parallèle) et R, puis U.
- S après U ; J, puis K.

## Estimation

Base : `engine.md` § 1 et 5, soit ~26 000 instructions x86 de simulation. OpenTIM fait le même travail pour TEMIM.

| Vague | Taille relative | Lignes estimées | Incertitude |
| --- | --- | --- | --- |
| X | petite | scripts 300 | faible |
| P | moyenne | banc hors dépôt (~800 lignes Python) | moyenne (état d'interface lu par les handlers, stubs) |
| D | moyenne | 1 800 + tables générées | faible à moyenne (ANM, ITF, LEV) |
| V | petite | 600 | faible |
| Φ1 | grande | 2 000 | **élevée** (collisions, arrondis) |
| Φ2 | très grande, en parallèle | 6 000 à 8 000 (~100 types à code propre) | **élevée** (cordes, animaux, création de pièces) |
| R | moyenne | 1 500 | moyenne |
| U | grande | 2 500 (éditeur, victoire, professeur, menus) | moyenne |
| A | moyenne | 1 000 (+ M1 ~300, M2 déplacement) | moyenne (tempo HMI) |
| S | petite | 500 | faible |
| J, K | grandes | 1 200 + 156 solutions écrites | **élevée** (aucune solution dans les données : à construire puzzle par puzzle) |

Total : **18 000 à 21 000 lignes** (autant de tests), soit **plus que Lure et BASS**. Chemin critique : X, D, Φ1, Φ2, U, K. Le poids est dans la physique : sans banc (refus de D2), Φ1 et Φ2 sont plus longues à déboguer, faute de pouvoir localiser une divergence au pas près.

## Requis, naturellement lié, optionnel

**Requis** :
- les vagues X, D, Φ1, Φ2, R, U, A, S, J ;
- D2 à D13 tranchées ;
- la mention de copyright et l'attribution d'OpenTIM dans l'aide.

**Naturellement lié** :
- P (si D2) ;
- V ;
- K ;
- `docs/tim3/*.md` ;
- M1 et M3 ;
- les tables générées (D13).

**Optionnel, à part** :
- M2 : sinon, import tel quel de `web-sink.ts` ;
- autres langues des textes (déjà dans l'ISO, ~1,7 Mo) ;
- lecture et écriture des fichiers LEV d'origine (importer une machine) ;
- partage d'une machine du Labo par lien ;
- aide `.MVB` (anglaise seulement) ;
- vitesse de simulation réglable.

## Cas limites

- **Données** :
  - LEV en version 0x111 à 0x114 (2 octets de plus à partir de 0x113, indices de 42 ou 58 octets) ;
  - enregistrements de taille variable selon le type ;
  - pièces du bac contre pièces placées (bit 0x40) ;
  - seul `PART136.BMP` est en LZW, et le passage de 9 à 10 bits n'est pas exercé par les données : à tester sur des données synthétiques ;
  - archives VOC à entrées vides (indices absents).
- **Arithmétique** :
  - division qui tronque vers 0 contre décalage qui arrondit vers −∞ ;
  - produits tronqués à 16 bits ;
  - débordements 32 bits ;
  - pièce sortie de [−1000, 2000] retirée ;
  - vitesses à la vitesse terminale ;
  - gravité inversée, pression nulle, gravité et pression extrêmes du Labo.
- **Ordre** :
  - ordre des listes au chargement ;
  - pièces créées ou détruites en cours de pas ;
  - récursion des pièces attachées ;
  - seaux remplis par d'autres pièces ;
  - engrenages en boucle.
- **Éditeur** :
  - chevauchement refusé ;
  - pièce posée hors de l'aire ;
  - pièces fixes non déplaçables ;
  - corde vers une pièce supprimée ;
  - courroie entre deux pièces qui ne tournent pas ;
  - pièce retournée ou redimensionnée qui chevauche après coup ;
  - bac vide ;
  - glisser hors du canvas ou interrompu (appel, onglet masqué).
- **Simulation** :
  - « Arrêter » restaure exactement l'état d'édition ;
  - victoire atteinte puis perdue (conditions « pendant N pas » le cas échéant) ;
  - machine qui ne s'arrête jamais ;
  - onglet masqué pendant la marche (pause, pas de rattrapage massif : `maxCatchUpTicks`).
- **Son** :
  - effets nombreux au même pas (limite de voix) ;
  - musique changée par niveau ;
  - voix coupée quand on passe au puzzle suivant ;
  - « Sans son » coupe tout.
- **Interface** :
  - toucher sans survol (infobulles) ;
  - doigt qui masque la pièce ;
  - petits écrans en 640×480 réduit (cibles des boutons d'origine petites : zones de saisie agrandies) ;
  - clavier AZERTY (fichier `KEYBOARD.MAP` du français).

## Risques

- **Fidélité de la physique (Φ1, Φ2)** : c'est le risque principal. Une erreur d'arrondi ou d'ordre change l'issue d'un puzzle loin dans la partie. Atténuation : banc Unicorn (D2) avec comparaison au pas près, scénarios minimaux par pièce, 156 solutions écrites, validées sur le banc, jouées en test.
- **Banc (P)** : les handlers lisent peut-être de l'état d'interface ou de dessin hors simulation, ce qui demande plus de stubs que prévu. Atténuation : commencer par un niveau « balles et murs », élargir pièce par pièce.
- **Couplage avec l'animation** : les handlers lisent les images ANM, donc un format d'animation mal lu fausse la physique. Atténuation : ANM en vague D, avant Φ2.
- **Solutions** : le jeu n'a pas de commande « solution » (vague D), **mais chaque LEV garde la solution du concepteur dans les pièces du bac sans le bit `0x100` de `flags3`** (vague K : les 156 puzzles solo résolus au banc en les posant là, `solutions.md`). Atténuation : solutions écrites pour le port à partir des indices, validées sur le banc Unicorn (le binaire les déclare résolues) avant de servir de tests au moteur TypeScript ; outil de banc qui place des pièces et rapporte les conditions remplies.
- **Interface d'origine en DOM (D7)** : écart visuel avec l'original pour les dialogues Windows. Assumé : ces dialogues n'étaient pas dessinés par le jeu.
- **M2** : touche le son de deux jeux publiés (iOS en particulier). Atténuation : déplacement sans changement de comportement, tests, vérification dans le navigateur ; ou alternative sans M2.
- **Légal** : voir « Point légal » (D1 tranchée).
- **Poids du site** : +18 Mo, faible.

## Validation

- Chaque vague : `npm run typecheck`, `npm test`, `npm run build`. Les tests des lecteurs tournent sur les fichiers réels et sont ignorés si `original/tim3/` est absent ; les tests de traces sont ignorés si les traces locales manquent.
- **Banc Unicorn** (si D2) : traces au pas près, scénarios minimaux et 206 niveaux.
- Rendu dans le navigateur à chaque vague visuelle (R, U, J) :
  - échelle, bac, glisser-déposer, cordes et courroies ;
  - responsive, toucher ;
  - états : chargement, erreur de fichiers, son coupé, onglet masqué, puzzle réussi ;
  - accessibilité : menus DOM au clavier, focus, textes des buts et indices lisibles.
- Parcours : chaque puzzle résolu en test (K), Labo (construire, lancer, sauvegarder, reprendre).
- Écoute par une personne : musique General MIDI, effets, voix et synchronisation des lèvres.
- Contrôle ponctuel sous Wine (si l'utilisatrice l'accepte avec D2) : cadence réelle, aspect de l'interface, tempo de la musique.

## Dette technique à surveiller

- Adresses de l'exe citées en commentaire de chaque fonction traduite (`// 433334 advance_parts`), avec la correspondance OpenTIM quand elle existe : c'est la seule carte du code.
- Numéros de types de pièces nommés (`PartType.Bowling = 0`…) dans un `ids.ts` généré depuis `INFO.RES` anglais.
- État de simulation dans des structures plates et typées (`Int32Array` ou objets à champs entiers), sans flottants : la sauvegarde et la comparaison de traces restent simples.
- Tables générées depuis l'exe (D13) : à régénérer, jamais à modifier à la main.
