# Ween: The Prophecy : plan d'implémentation

Jeu : *Ween: The Prophecy* (Coktel Vision et MDO, 1992 ; Sierra On-Line en Amérique du Nord), **version DOS sur disquettes, VGA, française, AdLib**. Source : installeur Abandonware France `archives/ween/setup-00126-Ween_The_Prophecy-dosbox.exe` (Inno Setup 5.3.10, non versionné).
Aventure « pointer-et-cliquer » en 320 × 200, 256 couleurs : Ween, petit-fils du sorcier Ohkram, doit retrouver trois grains de sable et les déposer dans le Revuss avant la Grande Éclipse pour vaincre Kraal. Énigmes à l'écran, inventaire, bloc-notes, petites vidéos IMD, musique AdLib et bruitages échantillonnés. Pas de voix.

Ce document est le brief commun aux sous-agents, sur le modèle de `docs/bass/plan.md`. Les références font foi dans cet ordre : `formats.md` (formats, vérifié / lu / supposé), `engine.md` (moteur de ScummVM, découpage), puis ce plan. S'ajouteront : `files.md` (généré par l'extraction), `graphics.md`, `audio.md`.
**La référence de comportement est le moteur `gob` de ScummVM** (`engines/gob/`, GPL v3 ou ultérieure, commit `7d2709da` du 10/10/2026), lu pour comprendre et réécrit. **Lost in Time**, déjà porté dans le dépôt depuis le même moteur, en fournit la plus grande partie.

## Avancement

- **Étude faite** (vague 0, 14/11/2026) : installeur extrait dans le scratchpad avec `innoextract`, rien exécuté. Version identifiée : entrée `FR_FRA` de `engines/gob/detection/tables_ween.h` (`intro.stk`, md5 des 5 000 premiers octets `4b10525a…`, 7 029 591 octets). Les 264 fichiers d'`INTRO.STK` sont lus et décompressés ; les 67 TOT, 30 IMD, 6 musiques ADL et les SND sont décodés par les lecteurs de Lost in Time (un décodeur d'essai, hors dépôt). Banc ScummVM recompilé avec `gob` (et `cruise`, pour la session Croisière) : Ween y démarre (cible `ween-fr`).
- **Verdict : petit portage.** Ween utilise les classes v2 du moteur ; Lost in Time, les classes v3, qui ne diffèrent du v2 que par trois opcodes et la sauvegarde. Ween n'utilise ni les gobelins, ni la carte, ni le CD. Le travail propre à Ween est estimé à **1 000 à 1 500 lignes**, plus la mise en commun du moteur de Lost in Time.
- Aucun code écrit ; seuls `docs/ween/plan.md`, `formats.md` et `engine.md` ont été créés.
- **Décisions déjà prises par l'utilisatrice** : « mutualiser avec ce qu'on a déjà, sans pour autant trop dévoyer les jeux » ; copy en français dans `copy.ts`, sans validation préalable (règle du projet). **D1 à D12 validées par l'utilisatrice le 14/11/2026**, telles que recommandées (dont D12 : publication comme Lost in Time).

## Décisions

| N° | Question | Recommandation | Faits et conséquences |
| --- | --- | --- | --- |
| D1 | **Mutualisation avec Lost in Time** | **Extraire le moteur Coktel de Lost in Time vers `src/engine/coktel/`** (précédent : `src/engine/mohawk/`, partagé par Zoombinis), en deux temps : (1) déplacement sans changement de comportement ; (2) tables d'opcodes par version (v1, v2, v3 = v2 + 3 surcharges) et crochets par jeu (`CoktelGame` : version, sauvegarde, rustines, fichiers de démarrage). Lost in Time et Ween deviennent deux définitions de jeu sur ce moteur. | ~12 000 des 15 700 lignes de Lost in Time sont génériques (`engine.md` § 12). Alternatives écartées : Ween qui importe `src/games/lost-in-time/` (dépendance entre jeux, crochets cachés) ; copie (deux moteurs à maintenir). Risque : régression de Lost in Time, protégée par ses 20 fichiers de tests (hachages des surfaces, AdLib, désassembleur) ; chaque temps se termine par les mêmes tests, inchangés. **Touche Lost in Time** : à faire avant toute ligne propre à Ween. |
| D2 | **Protection de copie** | **Sautée**, écart documenté : l'appel de la routine de la grille de couleurs (`callSub 348` d'`INTRO.TOT`) est ignoré, comme ScummVM le fait pour Gob1 et Gob2 ; le banc reçoit le même saut (correctif de `inter_v1.cpp`). | La grille de couleurs fournie dans la boîte n'est pas dans l'installeur : sans saut, le jeu est injouable (échec : « WEEN error ! » puis fin). ScummVM ne la saute pas pour Ween. À vérifier en vague C : la routine ne fixe aucune variable lue plus tard (sinon, la fixer comme une réponse juste). Le saut est reconnu par motif (TOT + appel), pas par position. |
| D3 | **Données versionnées** | **`original/ween/INTRO.STK` tel quel** (6,7 Mo), `COVER.webp`, `files.json`. Rien d'autre. | Tout le jeu est dans `INTRO.STK`. Écartés : `LOADER.EXE` (lanceur compressé LZEXE), `*.GDR` (pilotes), `ALL.ASK` (menus du lanceur), `CAT.INF` / `SAVE.INF` / `BLOC.INF` (sauvegardes laissées par l'installation, avec des restes de développement), DOSBox, DLL, `Lisez-Moi.txt` et icône d'Abandonware France. `original/` passe de 737 à ~744 Mo. |
| D4 | **Sauvegardes** | **Menu d'origine du jeu** (15 emplacements nommés, `SaveLoad_v2`), sur le stockage du navigateur (préfixe `ween:`), comme Lost in Time le fait pour le v3 ; **bloc-notes du joueur** (`bloc.inf`) conservé de la même façon. Pas d'import de sauvegardes de DOS ou de ScummVM. | Le jeu dessine lui-même son écran de sauvegarde ; le nom se tape au clavier (clavier virtuel au toucher, déjà dans Lost in Time). `SaveLoad_v2` (325 lignes de C++) remplace `SaveLoad_v3` ; la couche commune (fichiers virtuels, stockage) est partagée. |
| D5 | **Interface** | **Celle de Lost in Time, rendue commune** (`src/ui/coktel/` : app sur `game-shell`, toucher, appui long = clic droit, Menu, Passer, Clavier, Valider), paramétrée par jeu (résolution 320 × 200 pour Ween, boutons, `copy.ts`). Pas de `point-click-app`. | Ween se joue à la souris (deux boutons) et au clavier (bloc-notes, noms de sauvegarde). Lost in Time a déjà résolu le toucher et la saisie pour ce moteur ; `point-click-app` suppose un moteur à ticks de 20 ms que ce moteur n'a pas. |
| D6 | **Son** | **Lecteur ADL et échantillons SND de Lost in Time**, via le module commun ; **haut-parleur PC** écrit (bips du menu et d'une énigme, ~80 lignes, onde carrée, d'après `sound/pcspeaker.cpp`). | 6 musiques AdLib (`ADL.EXT`), 192 échantillons 8 bits (~160 s), compositions (`o1_playComposition`). Le haut-parleur n'est qu'une souche dans Lost in Time. |
| D7 | **Hasard** | **Injecté**, `scummvmRandom` (`src/engine/rng.ts`) pour les deux jeux (graine tirée au lancement dans le navigateur, fixe en test). | Seule source : `rand()` des expressions (~160 appels dans 39 TOT). Lost in Time utilise `Math.random` : sans effet visible de le changer, et la comparaison au banc devient possible. |
| D8 | **Pipeline AdLib de Lost in Time** | **Fait** : la musique AdLib du moteur Coktel (Lost in Time, Ween) passe par la sortie OPL commune `src/audio/web-opl.ts`, séquenceur sur le fil principal cadencé par l'horloge du jeu à 1 000 ticks par seconde (`adlib/output.ts`) ; l'ancien worklet propre est supprimé. Mêmes écritures aux mêmes ticks que le rendu de référence (testé), aucune note tenue après arrêt, fin ou chargement (testé). Voir `audio.md` § 1 et § 6. | Hachages AdLib inchangés ; reste l'écoute des deux jeux. |
| D9 | **Rustines de ScummVM** | **Toutes reprises, en écarts documentés** : attente active de l'introduction (`VAR(59)`, `inter_v1.cpp:1359`, reconnue par motif car la position diffère dans ce TOT) ; opcodes gob 3 et 13 inconnus sautés (`inter.cpp:107`) ; TOT absent (`END`, `DEMO`) = fin propre, retour à l'écran titre ; pas de rustine « bruit de pas » (propre à Gob2 et au v3). | Le portage de Lost in Time s'arrête sur les opcodes gob 3 et 13 (`INTRO`, `INTRO5`, `MENU`). |
| D10 | **Introduction** | **Introduction d'origine, passable** par Échap, clic ou le bouton Passer, comme dans le jeu. | L'introduction est faite de TOT (`INTRO0` à `INTRO5`) avec des vidéos IMD. |
| D11 | **Langue** | **Français seul**, figé (`_language = 0` de l'entrée de détection, variable 16). | Le STK ne contient que des textes français (`.DAT`), sauf la protection (5 langues). |
| D12 | **Statut juridique** | Voir § « Point légal » : **même traitement que Lost in Time** (données du jeu publiées dans `original/`, ayants droit cités, retrait sur demande), **sous réserve de votre accord**. | C'est un abandonware, pas un freeware : aucune licence ne permet la redistribution. |

## Point légal

- *Ween* n'est **pas un freeware** : aucune licence de redistribution n'accompagne les fichiers (contrairement à Drascula, FOTAQ, Lure et BASS). L'installeur vient d'Abandonware France, qui distribue des jeux qu'il considère comme abandonnés ; cela ne vaut pas autorisation. Le jeu n'est pas vendu aujourd'hui (une simple demande de réédition sur la « Dreamlist » de GOG) ; les droits ont suivi Coktel Vision (Sierra, puis Vivendi, puis leurs acquéreurs) et je n'ai pas trouvé leur détenteur actuel.
- **Situation identique à celle de Lost in Time** (même éditeur, même époque), d'Armaeth, de SWIV 3D et de Zoombinis, déjà publiés dans `original/` avec la phrase de la section Licence du README (« ils restent la propriété de leurs ayants droit »).
- Le **code** est sous GPL v3+ (moteur réécrit d'après ScummVM) ; les **données** ne le sont pas.
- Recommandation : publier comme Lost in Time ; mentionner dans l'aide et le README Coktel Vision comme auteur, l'origine des fichiers (installation DOS française) et que le moteur est réécrit d'après ScummVM ; **ne reprendre ni le nom ni les fichiers d'Abandonware France** ; retirer le jeu sur demande d'un ayant droit. **À valider par vous** : la décision de publier vous revient.

## Convention vis-à-vis de ScummVM (alignée sur Lost in Time, Drascula, FOTAQ, Lure, BASS)

- Chaque module dont le comportement vient de ScummVM cite son fichier de référence en tête (`inter_v1.cpp`, `inter_v2.cpp`, `game.cpp`, `draw_v2.cpp`, `hotspots.cpp`, `mult_v2.cpp`, `save/saveload_v2.cpp`, `sound/pcspeaker.cpp`…) et note ses écarts volontaires. Les modules déplacés depuis Lost in Time gardent leurs références ; celles qui manquent sont ajoutées au déplacement.
- Aucune copie de fichier de ScummVM dans le dépôt.
- Les chemins Amiga, Atari, Infogrames, Protracker, synthèse vocale du bloc-notes (`_weenVoiceNotepad`) sont ignorés.
- `README.md` : ligne du tableau des jeux, section « Ween », phrase de la section Licence (vague J).

## Ce qui est versionné dans `original/ween/`

| Fichiers | Source | Poids | Versionné |
| --- | --- | --- | --- |
| `INTRO.STK` | installeur, tel quel (D3) | 7 029 591 octets | oui |
| `COVER.webp` | jaquette de la boîte d'origine (Wikipédia anglophone) | ~37 Ko | oui |
| `files.json` | `scripts/manifest.py` | < 1 Ko | oui |

**Script d'extraction** `scripts/ween-extract.sh [installeur]` (modèle : `scripts/bass-extract.sh`, `scripts/lib/extract-common.sh`) : `ec_verifier_outils innoextract`, extraction dans un dossier temporaire vide **sans jamais exécuter l'installeur**, contrôle de la taille et du md5 d'`INTRO.STK`, copie, `ec_conserver COVER.webp`, inventaire `docs/ween/files.md`, `ec_publier`. Idempotent.

## Architecture

Voir `engine.md` § 12. En bref :
- `src/engine/coktel/` : lecteurs (`data/` : STK, LZSS, TOT, EXT, IMD, polices, SND), machine virtuelle (`script`, `variables`, `resources`, `opcodes` par version, `interpreter`), `hotspots`, `graphics/`, `mult/`, `video/`, `audio/` (son, ADL, haut-parleur), sauvegarde commune (fichiers virtuels) et `SaveLoad_v2` / `_v3`, hôte sans tête.
- `src/ui/coktel/` : l'app et l'hôte navigateur de Lost in Time, paramétrés.
- `src/games/lost-in-time/` : définition du jeu, parties (`parts.ts`), CD, `copy.ts`, `index.ts`.
- `src/games/ween/` : définition du jeu (version 2, fichiers, rustines D2 et D9), `copy.ts`, `index.ts`.

Le moteur garde son modèle actuel (machine virtuelle sans tête, `WaitingForInput`, cadence de Lost in Time) : il n'est pas récrit en générateurs (`src/engine/sequence.ts`), ce qui serait un changement d'architecture sans besoin.

## Mutualisation (consigne : mutualiser sans trop dévoyer les jeux)

**Réutilisé tel quel :** `src/engine/rng.ts` (D7), `storage.ts`, `src/ui/game-shell.ts`, `pointer.ts`, `sound-prefs.ts`, `indexed-canvas.ts`, `title-screen.ts`, `local-storage.ts`, `src/audio/opl2.ts`, `web-sample-output.ts`, `scripts/lib/extract-common.sh`, `scripts/manifest.py`.

**Promu depuis Lost in Time (D1, D5) :** le moteur vers `src/engine/coktel/`, l'interface vers `src/ui/coktel/`. C'est la seule évolution de structure.

**Non utilisé :** `point-click-app` et dérivés (D5), `sequence.ts`, `save-slots.ts` (le jeu a son propre menu de sauvegarde, D4), `web-opl.ts` (D8), `voice-bank`, `track-player` (pas de CD).

**Spécifique à Ween :** sauvegarde v2, haut-parleur PC (commun, mais d'abord utilisé par Ween), rustines D2 et D9, `copy.ts`, définition du jeu.

## Évolutions de modules communs proposées

| N° | Fichier | Évolution | Pourquoi | Risque | Statut |
| --- | --- | --- | --- | --- | --- |
| M1 | `src/games/lost-in-time/{data,engine}` → `src/engine/coktel/` | Déplacement sans changement ; les imports de Lost in Time et de ses tests changent. | D1 | Faible : mécanique, mêmes tests verts. | vague U1 |
| M2 | `src/engine/coktel/opcodes.ts`, `interpreter.ts` | Tables par version (v1, v2, v3) ; crochets `CoktelGame` (sauvegarde, rustines, fichiers, vidéos qui gardent le curseur, Échap) ; hasard injecté (D7) ; haut-parleur. Ce qui est propre à Lost in Time (parties, CD, `SaveLoad_v3`, `o3_*`) passe derrière ces crochets. | D1, D7, D9 | Moyen : seul vrai découpage ; protégé par `disasm.test.ts` (fixture degob), les hachages de surfaces et les tests de scènes. | vague U2 |
| M3 | `src/games/lost-in-time/ui/` → `src/ui/coktel/` | App et hôte navigateur paramétrés (résolution, boutons, copy). | D5 | Faible à moyen : vérification de Lost in Time dans le navigateur (ordinateur, téléphone). | vague J |
| M4 | `src/games/registry.ts`, `README.md` | Une ligne chacun, section et licence. | Enregistrer le jeu. | Nul | vague J |

**Banc ScummVM** : dans le dépôt, `scripts/ween/bench/` (patch de ScummVM `7d2709da` : saut de la protection (D2), trace des TOT chargés, des opcodes et d'un hachage des variables, graine fixe, temps virtuel ; configuration dédiée `ween.ini.in`, lanceur `ween-replay.sh`, scénarios ; `README.md` pour le reconstruire). Jamais le `scummvm.ini` partagé.

## Vagues

Chaque vague se termine par `npm run typecheck`, `npm test`, `npm run build` et, dès qu'il y a un rendu, une vérification dans le navigateur. **U1 et U2 doivent laisser Lost in Time intact** (mêmes tests, vérification dans le navigateur).

| Vague | Tâche | Contenu | Tests | Critère de fin | Dépend de |
| --- | --- | --- | --- | --- | --- |
| P | banc | correctif du banc : saut de la protection pour Ween, traces (TOT chargé, opcodes, hachage des variables par image), temps virtuel, graine fixe ; scénarios introduction, menu, premier écran de jeu | captures et trace lisibles | banc qui passe la protection et produit captures et traces | — |
| X | extraction | `scripts/ween-extract.sh`, `original/ween/`, `docs/ween/files.md` | idempotence, md5 | `original/ween/` complet | — |
| U1 | mise en commun 1 | M1 : déplacement vers `src/engine/coktel/` | tests de Lost in Time inchangés et verts | Lost in Time identique (tests, navigateur) | — |
| U2 | mise en commun 2 | M2 : versions, crochets, hasard injecté, haut-parleur | idem + tests des tables par version | Lost in Time identique ; table v2 sans les `o3_*` | U1 |
| D | lecteurs | écarts de formats : TOT 1.2, `.LET` avec `font.ts`, `.CAT`, anomalie du bloc d'`INTRO1.TOT` (`formats.md` § 15) | tous les fichiers d'`INTRO.STK` lus ; désassemblage complet des 67 TOT sans opcode inconnu | `formats.md` à jour, aucun reste | X, U1 |
| C | démarrage | `src/games/ween/` : définition v2, rustines D2 et D9, TOT absent ; boucle sans rendu jusqu'au menu | trace des TOT et des variables comparée au banc (introduction, menu) | le menu et le premier écran tournent en test | D, U2, P |
| R | rendu | surfaces 640 × 200 et 320 × 465 (défilement vertical), sprites, polices, vidéos IMD, palettes ; `graphics.md` | **comparaison au banc** (introduction, menu, écrans à défilement) | images identiques au banc | C |
| A | son | ADL, SND, compositions, haut-parleur ; `audio.md` | registres OPL identiques à ScummVM sur N ticks ; bips | musique, bruitages et bips jouent | C |
| S | sauvegardes | `SaveLoad_v2` (cat.inf, save.inf, bloc.inf) sur le stockage du navigateur | aller-retour à plusieurs étapes ; bloc-notes conservé | sauvegarder et reprendre partout, notes gardées | C |
| J | intégration | M3, `src/games/ween/index.ts`, `copy.ts`, touches, toucher, clavier virtuel, M4, aide (crédits, ScummVM, mention de version modifiée, point légal) | hôte | jeu jouable dans le navigateur, ordinateur et téléphone ; Lost in Time vérifié aussi | R, A, S |
| K | validation | partie complète en test (solution jouée par clics simulés, avec reprises de sauvegarde), comparaisons au banc par écran, revue fonctionnelle et visuelle, README | | fin du jeu atteinte ; revue | J |

Parallélisme : P, X et U1 indépendants (U1 touche Lost in Time seul). D dès X et U1. Après C : R, A et S en parallèle (dossiers distincts). Chemin critique : U1, U2, C, R, J, K.

## Estimation

| Vague | Taille | Lignes estimées | Incertitude |
| --- | --- | --- | --- |
| P | petite | correctif du banc (hors dépôt) | faible (même méthode que BASS) |
| X | petite | 100 | faible |
| U1 | moyenne, mécanique | ~0 nette (déplacement, imports) | faible |
| U2 | moyenne | 400 à 600 modifiées | moyenne |
| D | petite | 100 à 200 | faible (formats vérifiés) |
| C | petite à moyenne | 300 | moyenne (chemins v2 peu exercés par Lost in Time) |
| R | petite à moyenne | 200 (défilement vertical) | moyenne |
| A | petite | 150 (haut-parleur) | faible |
| S | moyenne | 400 | faible à moyenne |
| J | moyenne | 400 (dont M3) | faible |
| K | moyenne | solution en test (~500) | moyenne (trouver et rejouer la solution) |

Total : **1 000 à 1 500 lignes propres à Ween**, ~1 000 lignes de tests, plus la mise en commun (U1, U2). C'est **le plus petit portage du dépôt** depuis ScummVM, parce que Lost in Time a déjà fait le gros du moteur.

## Requis, naturellement lié, optionnel

**Requis** : P, X, U1, U2, D, C, R, A, S, J ; D1 à D12 tranchées ; mention de version modifiée dans l'aide (moteur réécrit, protection retirée).

**Naturellement lié** : K ; `docs/ween/*.md` ; inventaire des cas où ScummVM corrige un bogue du jeu ; visionneuse de ressources (si `src/ui/asset-viewer` s'y prête à peu de frais).

**Optionnel, à part** : unification du pipeline AdLib de Lost in Time sur `web-opl` (D8, dette) ; autres langues (versions non présentes) ; lecture des sauvegardes de DOS ou de ScummVM ; version CD ou Amiga.

## Cas limites

- **Données** : TOT sans fichier de textes (`EDIT`, `REGLAGE`, `ADL`…) ; ressources dans `COMMUN.IM1` / `COMMUN.EX1` (offsets négatifs) ; TOT absent (`END`, `DEMO`) ; bloc décalé d'`INTRO1.TOT`.
- **Moteur** : opcodes gob 3 et 13 ; `totSub` avec sauvegarde et restitution des variables ; surfaces plus grandes que l'écran (640 × 200, 320 × 465) ; attente active de l'introduction ; protection sautée sans variable oubliée.
- **Interface** : saisie au clavier (bloc-notes, noms de sauvegarde) au toucher ; clic droit au toucher ; Échap pendant une vidéo ; onglet masqué pendant une attente active.
- **Son** : musique coupée puis remise ; bip du haut-parleur pendant une musique AdLib ; « Sans son » coupe tout.
- **Sauvegardes** : 15 emplacements pleins ; nom vide ; sauvegarde pendant une vidéo ou dans un écran à défilement ; stockage du navigateur indisponible (navigation privée) ; reprise depuis une autre version du portage (format versionné).

## Risques

- **Régression de Lost in Time** (U1, U2) : le plus important. Parade : deux temps, mêmes tests à chaque étape, vérification dans le navigateur, et les tests de Lost in Time doivent tourner (ils sont ignorés si `original/lost-in-time` manque).
- **Chemins v2 peu exercés** par Lost in Time (défilement vertical, `createSprite`, `loadFontToSprite`, `totSub` avec variables) : comparaison au banc écran par écran.
- **Opcodes gob 3 et 13** : rôle inconnu ; ScummVM les ignore et prend le jeu en charge ainsi : on fait pareil, et la partie complète au banc (K) le confirmera.
- **Protection** (D2) : effet de bord possible si la routine fixe une variable ; vérifié en C par la trace des variables.
- **Solution complète** (K) : il faut une solution fiable, rejouée par clics ; le banc sert de référence.
- **Juridique** (D12) : décision à prendre par vous.
