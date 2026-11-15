# Les Voyageurs du temps : plan d'implémentation

Jeu : *Les Voyageurs du temps* (*Future Wars: Adventures in Time*, Delphine Software, 1989). C'est le premier jeu du système « Cinématique ». Version utilisée : **CD Sony (version US) avec le patch de traduction française**, cible `fw-cd-fr` de ScummVM. Elle vient de l'installeur Abandonware France `setup-00099-Les_Voyageurs_du_temps_CD-ScummVM.exe`, placé à la racine du dépôt et ignoré par git (`*.exe`).

Le jeu est une aventure « pointer-et-cliquer » en 320 × 200, 16 couleurs. Un laveur de vitres découvre une machine à voyager dans le temps et part du Moyen Âge jusqu'au futur.
- Clic gauche : marcher.
- Clic droit : menu des six verbes (EXAMINER, PRENDRE, INVENTAIRE, UTILISER, ACTIONNER, PARLER).
- Deux boutons ensemble : menu système.
- Textes en français. La musique est sur les pistes du CD, les bruitages en AdLib, il n'y a **pas de voix**.

Ce document sert de brief commun aux sous-agents, sur le modèle de `docs/bass/plan.md`. Les références font foi dans cet ordre :
1. `formats.md` : formats, avec les mentions vérifié, ScummVM ou incertain ;
2. `engine.md` : moteur de ScummVM et découpage ;
3. ce plan.

S'y ajouteront `files.md` (généré par l'extraction), puis `graphics.md` et `audio.md` si besoin.

**La référence de comportement est le moteur `cine` de ScummVM** (`engines/cine/`, GPL v3 ou ultérieure), en partie Future Wars seulement. On le lit pour le comprendre, puis on réécrit.

## Avancement

- **Étude faite** (vague 0, 14/11/2026). Aucun exécutable de l'installeur n'a été lancé.
  - **Données** :
    - Installeur extrait par `innoextract` dans le scratchpad.
    - Les 741 fichiers des 6 archives (`PART01` à `PART04B`, `BASESON.SND`) décompressés, CRC valides.
    - Fonds, sprites, police et textes décodés et contrôlés en PNG.
    - 1 029 messages en français.
    - 29 pistes FLAC mesurées.
  - **Moteur** : `engines/cine/` lu en entier, côté FW.
  - **Banc** : banc ScummVM `cine` séparé, compilé, avec une configuration dédiée.
    - Le smoke test montre l'intro, le titre, puis la première scène avec une bulle en français. Aucun écran de protection.
- **Verdict : faisable, nettement plus petit que BASS et Lure.**
  - Environ 5,5 à 6 k lignes de C++ propres à FW dans ScummVM. Port estimé à 3 à 4 k lignes pour le moteur, 6 à 8 k en tout.
  - Pas de calcul de chemin : la marche est écrite dans les scripts du jeu.
  - Pas de voix.
  - La difficulté est la **fidélité fine** : machine à scripts, ordre des calques, cadence de 110 ms par tick.
- **15/11/2026 : vagues P, X, D, C, R, A, S, I, J, K faites** (non commitées).
  - **Partie complète** sans écran : 328 étapes, du démarrage au générique (`test/voyageurs/full-game.test.ts`, solution dans `walkthrough.md`), d'une traite et avec reprise de sauvegarde après chaque étape.
  - **Comparaison au banc** : les 16 059 ticks sont identiques au banc ScummVM (globales, scripts, calques), comme les 300 images de fin d'étape et les 660 images de l'intro.
  - **Navigateur** : vérifié sur ordinateur et sur mobile.
  - **Musique** : la boucle des pistes est confiée à l'élément média (`loop` dans `src/audio/track-player.ts`), sans blanc à la reprise.
  - **Écarts d'interface** :
    - menu système au bouton du milieu, à F10 ou au bouton tactile « Système », car le navigateur ne signale pas l'appui sur deux boutons ;
    - sauvegarde refusée entre deux parties, tant que le décor n'est pas dans le bundle courant.
  - **Morts testées** : 16 scénarios, toutes les morts repérées dans les scripts (`deaths.test.ts`), identiques au banc ScummVM jusqu'à la mort ; le compte à rebours est figé par la pause.
- **Consignes de l'utilisatrice** :
  - « mutualiser avec ce qu'on a déjà, sans pour autant trop dévoyer les jeux » ;
  - le code commun aux jeux Delphine se décide avec la session *Croisière pour un cadavre* (moteur `cruise`, portage en parallèle) ;
  - copy finale en français dans `src/games/voyageurs/copy.ts`.
- **D1 à D14 validées par l'utilisatrice le 14/11/2026, telles que recommandées** (D14 comprise : même régime de diffusion que les autres jeux non libres du dépôt).

## Décisions

| N° | Question | Recommandation | Faits et conséquences |
| --- | --- | --- | --- |
| D1 | **Version et langue** | **CD Sony + patch de traduction française, seule version portée**. Pas de choix de langue, pas de version disquette. | Version reconnue par ScummVM : `detection_tables.h`, md5 de `AUTO00.PRC` et des 5 000 premiers octets de `PART01`, tous deux vérifiés. `PART01` est celui de la version disquette française, `AUTO00.PRC` (chiffré, rotation d'un bit) signe la version CD. Le français est une **traduction de fans** appliquée à la version CD américaine (voir § Légal). |
| D2 | **Données versionnées** | **Fichiers d'origine tels quels** : `PART01` à `PART04B`, `AUTO00.PRC`, `TEXTE.DAT` (police). Lus par un lecteur d'archives qui décompresse à la volée. **Non versionnés** : `.PAL`, `BASESON.SND`, exécutables, `MANUAL.*`, `SONY.LBM`, `VOL.*`. | ~0,84 Mo. Les `.PAL` sont chargés par ScummVM mais jamais relus ; on ne les charge pas, et l'écart est documenté. `BASESON.SND` (musique AdLib/MT-32) ne sert pas en version CD. Pas de pré-décompression : 0,84 Mo contre 4,3 Mo, et le dépaqueteur est de toute façon nécessaire (D13). |
| D3 | **Musique CD** | **Pistes 19 à 29 seulement**, en MP3 joint stéréo 44,1 kHz, **96 kb/s** CBR (comme Lost in Time), avec en-tête Xing et sans métadonnées. Fichiers `music/track19.mp3` à `track29.mp3` (numérotés comme ScummVM). Lecture en boucle par `src/audio/track-player.ts`. | 25 min 14 s, soit **~18 Mo** (à 80 kb/s comme Drascula : ~15 Mo). Les pistes 1 à 18 (environ 13 min et 12 jingles d'environ 11 s) ne sont référencées ni par ScummVM ni par les scripts : non versionnées (voir Risques). |
| D4 | **Bruitages** | **Émulation OPL2** : `src/audio/opl2.ts` existant, plus un petit pilote qui réécrit `AdLibSoundDriverINS` (instrument lu à l'octet 257 du `.SPL`, note fixe). | 42 `.SPL`. Un rendu préalable en échantillons serait plus simple, mais il ajouterait des fichiers et s'écarterait du moteur, alors que l'OPL est déjà là (Lost in Time, Armaeth, BASS). Pilote propre au jeu : celui de Croisière (ADL, modules) est différent (D13). |
| D5 | **Machine à scripts** | **Interpréteur à état explicite** : position, labels, 50 locales, registre de comparaison. `step()` s'arrête sur `break` ou `end`. Les **générateurs** (`src/engine/sequence.ts`) servent au niveau du moteur : un tick par `yield`, avec les fondus, l'attente d'un clic et les menus en sous-séquences. | Un générateur par script ne se sauvegarde pas. ScummVM sauve justement cet état (`FWScript::save`). 78 opcodes FW : tableau dans `engine.md` § 2.2. Les opcodes bloquants (fondu au milieu d'un opcode) rendent un « effet » que la boucle consomme avant de reprendre le même script. |
| D6 | **Durée des messages** | **Comme ScummVM : le message reste jusqu'au clic** (ou une touche, ou un toucher). | `_messageLen` est calculé mais inutilisé dans ScummVM ; la durée de l'original n'est pas connue sans exécuter `FWARS.EXE`, ce qu'on s'interdit. La copy d'aide le dit. |
| D7 | **Protection anti-copie** | **Comme ScummVM** : toute comparaison de la globale 255 répond « égal ». Pas d'écran de protection. | Sans ce contournement, les moines tuent le héros plus tard (bogue ScummVM #3866). Le smoke test démarre sans écran de protection ; `PROTEC.PI1` / `FW.PI1` restent dans les données mais ne doivent pas apparaître. Un test le vérifie. |
| D8 | **Rustines de ScummVM** | **Toutes celles qui touchent FW sur PC sont reprises, comme écarts documentés** (`engine.md` § 9) : zone hors écran = 0, sprite sans masque, boîte de message remontée, `INTRO.OBJ`, couleurs transparentes par ANI, anti-flash du fondu, double fondu. **`fadeOutMusic`** : rétablir la piste du décor (`bgCDTracks[décor]`) au lieu du n° de décor −1 (bogue probable de ScummVM), écart documenté, vérifié à l'écoute au banc. | Ces rustines évitent des plantages et des blocages. Celles des versions Amiga/Atari et d'Operation Stealth sont ignorées. |
| D9 | **Menus et commandes** | **Menus du jeu dessinés par le moteur** : verbes au clic droit, ligne de commande, inventaire. **Menu système d'origine** (Pause, Nouvelle partie, Quitter, Charger, Sauver), dont **Charger et Sauver ouvrent les dialogues communs du site**. Le bouton « Menu » de la barre tactile ouvre le menu système. Appui long = clic droit (`src/ui/pointer.ts`). Clavier : F1 à F6 (verbes), F9, F10, Entrée et 5 du pavé = clic, Échap = clic droit, flèches haut / bas = ligne du menu (`MENUUP` / `MENUDOWN`). Pavé numérique 1-4 / 6-9 (`moveUsingKeyboard`) : vérifié dans `executePlayerInput`, il arrête le héros en marche (cible remise sur lui), ne le fait jamais marcher. | Même choix que BASS (D5) et Lure (D4). Le menu « Lecteur de sauvegarde A: » est sans effet : il est retiré, écart documenté. |
| D10 | **Sauvegardes** | **`SaveSlots`** : préfixe `voyageurs:`, 10 emplacements, JSON versionné. Contenu équivalent à `makeSaveFW` : objets, 255 globales, zones, scripts, calques, incrustations, sprites chargés **par nom**. Refusée quand les entrées sont bloquées ou dans un menu. Description = décor + date. | Pas de lecture des sauvegardes de ScummVM ou de l'original (optionnel). Le même contenu que ScummVM permet la comparaison au banc. |
| D11 | **Écran Sony au démarrage** | **Non porté** : `SONY.LBM` est le logo de l'éditeur CD, en 640 × 480. ScummVM l'affiche 2 s et propose de le passer. L'écran titre du site présente déjà le jeu. | Afficher le logo imposerait un second mode d'affichage (640 × 480) pour 2 s. Optionnel. |
| D12 | **Identifiant et emplacements** | `voyageurs` : `src/games/voyageurs/`, `original/voyageurs/`, `test/voyageurs/`, `docs/voyageurs/`, `scripts/voyageurs-extract.sh`. Titre « Les Voyageurs du temps ». | Comme les autres jeux. |
| D13 | **Code commun Delphine** | **`src/engine/delphine/unpack.ts`**, écrit par la session Croisière (vague U, avec `test/delphine/unpack.test.ts`) ; Voyageurs l'importe et y ajoute ses cas de test (741 fichiers, flux plus courts d'un octet) **après** « U terminé » dans les notes partagées. **Pilote AdLib non partagé** : Croisière utilise ADL et des modules, Voyageurs `AdLibSoundDriverINS` (instrument par effet). **Pas d'abstraction commune** pour la police, les menus et les archives. | Accord du 14/11 avec la session Croisière, dont le plan est validé. Aucune des deux sessions n'édite ce dossier pendant que l'autre y travaille. |
| D14 | **Diffusion (abandonware)** | **Même régime que les autres jeux non libres du dépôt** (Lost in Time, Téléportaschtroumpf, Armaeth, SWIV 3D, Zoombinis) : données dans `original/voyageurs/`, « propriété de leurs ayants droit » dans la section Licence du README, retrait sur demande. Plus : mention du patch de traduction de fans, et de la conversion de la musique en MP3, dans l'aide et le README. | Voir § Légal. C'est la décision qui ne relève pas de la technique : à confirmer explicitement. |

## Légal

- **Abandonware, pas freeware.** Les jeux libres du dépôt portent une licence de redistribution de l'ayant droit : Drascula, FOTAQ, Lure, BASS (Revolution, Alcachofa…). *Future Wars* n'en a aucune.
  - Le mot « abandonware » ne donne aucun droit. Il désigne seulement un jeu qui n'est plus vendu et qu'Abandonware France rediffuse avec tolérance.
  - Delphine Software International a été liquidée en 2004. L'ayant droit actuel n'est pas établi par l'étude.
- **Trois ayants droit possibles dans ces données** :
  1. Delphine, pour le jeu ;
  2. Sony Imagesoft / Interplay, pour l'édition CD et la musique CD ;
  3. les auteurs, inconnus, du patch de traduction française.
- **Conséquence** : publier `original/voyageurs/` sur GitHub Pages, c'est **redistribuer** sans autorisation, comme pour les autres jeux non libres déjà publiés. Le risque est une demande de retrait (DMCA), qu'il faudrait honorer sans délai.
- Le code reste sous GPL v3+ : réécriture du moteur `cine`, avec citation de la source en tête de chaque module, et **aucune copie** de fichier de ScummVM.
- **Alternative**, plus prudente mais plus lourde (optionnelle) : ne pas versionner les données. L'utilisateur fournirait l'installeur ou le dossier du jeu, extrait dans le navigateur. Cela changerait le modèle `files.json` commun à tous les jeux, donc ce n'est pas recommandé pour ce seul jeu.

## Convention vis-à-vis de ScummVM (alignée sur BASS et Lure)

- Chaque module dont le comportement vient de ScummVM cite en tête son fichier de référence :
  - `script_fw.cpp`, `main_loop.cpp`, `various.cpp`, `gfx.cpp` (`FWRenderer`), `object.cpp`, `anim.cpp`, `bg.cpp`, `bg_list.cpp` ;
  - `part.cpp`, `unpack.cpp`, `pal.cpp`, `texte.cpp`, `msg.cpp`, `prc.cpp`, `rel.cpp`, `sound.cpp`, `saveload.cpp`.
- Le module note aussi ses écarts volontaires.
- Le code d'Operation Stealth est ignoré : `script_os.cpp`, `OSRenderer`, `seqList`, `vol.cnf`, les cas `GType_OS`. Sont aussi ignorés les pilotes MT-32, Paula (Amiga), ADL et TTS.
- `README.md` : ligne du tableau des jeux, section « Les Voyageurs du temps », phrase de la section Licence (vague J).

## Ce qui est versionné dans `original/voyageurs/`

L'installeur source est déplacé dans `archives/voyageurs/` (non versionné).

| Fichier | Taille | Origine |
| --- | --- | --- |
| `PART01`, `PART02`, `PART03`, `PART04`, `PART04B` | 0,82 Mo | tels quels |
| `AUTO00.PRC` | 253 o | tel quel (chiffré, décodé au chargement) |
| `TEXTE.DAT` | 4,9 Ko | tel quel (police) |
| `music/track19.mp3` … `track29.mp3` | ~18 Mo | FLAC converti (D3) |
| `COVER.png` | ~50 Ko | composée par le moteur (vague J) |
| `files.json` | — | `scripts/manifest.py` |

**Total ≈ 19 Mo** ; `original/` passe d'environ 737 à environ 756 Mo, sous la limite de 1 Go.

`scripts/voyageurs-extract.sh [installeur]` réutilise `scripts/lib/extract-common.sh`. Il est idempotent, travaille dans un dossier temporaire neuf et contrôle les md5 (`formats.md` § 7). Il extrait avec `innoextract -I app/data`, **sans rien exécuter**, convertit avec `ffmpeg -protocol_whitelist file`, puis publie d'un bloc et régénère `docs/voyageurs/files.md`.

## Architecture

```
src/engine/delphine/unpack.ts      commun Delphine (D13)
src/games/voyageurs/
  index.ts  create.ts  copy.ts
  data/     bundle.ts (PARTxx), pi1.ts, neo.ts, anim.ts (ANI/ANM/MSK + table de transparence),
            prc.ts, rel.ts, obj.ts, msg.ts (CP437 + 0x97 → ê), font.ts, spl.ts, boot.ts (AUTO00 ROL1)
  engine/   game.ts (boucle, tick 109,85 ms), state.ts, script/ (vm.ts, opcodes.ts), objects.ts,
            overlays.ts, anims.ts (emplacements « premier libre »), part.ts (chargements différés),
            input.ts (verbes, ligne de commande, menus), save.ts, host.ts
  render/   renderer.ts (fond, incrustations, calques 0–5, masques), text.ts (boîtes, ligne de commande),
            menus.ts, palette.ts (9 bits, fondus 8 pas), cursor.ts
  audio/    cd-music.ts (pistes + règles de fond), sfx-adlib.ts (instrument OPL), audio.ts
  ui/       app.ts, browser-host.ts, preload.ts, saves.ts, help.ts, title.ts
```

**Cadence.** ScummVM compte 1 tick = `getTimerDelay()` = 109,85 ms (vitesse normale) ; on le reproduit avec `FixedStepClock`. Un tick se déroule ainsi :
1. entrées ;
2. scripts objets, puis scripts globaux ;
3. dessin ;
4. attente d'un clic si un message est affiché ;
5. chargements différés.

Les fondus (8 × 42 ms) et les menus sont des sous-séquences bloquantes.

**Hasard.** `scummvmRandom` de `src/engine/rng.ts`, graine fixe en test. Deux usages : `loadVar` de type 5, et le choix du message d'échec.

## Mutualisation (consigne : mutualiser sans trop dévoyer les jeux)

**Réutilisé tel quel :**
- moteur commun : `src/engine/sequence.ts`, `clock.ts`, `save-slots.ts`, `storage.ts`, `host.ts` (`BaseHost`), `rng.ts` (`scummvmRandom`) ;
- interface : `src/ui/point-click-app.ts` (page, chargement, pause, barre tactile, dialogues), `pointer.ts`, `pointer-queue.ts`, `indexed-canvas.ts` (palette ramenée sur 8 bits, 16 entrées utilisées) ;
- son et données : `src/audio/opl2.ts` / `web-opl.ts`, `track-player.ts` (déjà utilisé par Drascula), `src/data/reader.ts`, `cp437.ts`, `game-files.ts` ;
- scripts : `scripts/lib/extract-common.sh`, `manifest.py`, `png.mts` (jaquette).

**Commun Delphine (D13) :** `src/engine/delphine/unpack.ts`, écrit par la session Croisière ; Voyageurs l'importe et ajoute ses cas de test. Rien d'autre n'est partagé : pilotes AdLib, archives, police et menus diffèrent.

**Non utilisé :** `smf.ts`, `voice-bank.ts` (pas de voix), `sample-channel.ts`, les pilotes AdLib de Lure, FOTAQ et BASS (formats différents), `rnc.ts`.

**Spécifique au jeu :** lecteurs, machine à scripts, calques, rendu, menus, règles de musique CD, pilote d'effets (sauf mise en commun).

**Évolutions de modules communs :** aucune prévue. Si `track-player.ts` ne sait pas boucler sans blanc ou changer de piste au milieu d'un fondu, on l'améliore lui plutôt que d'ajouter un lecteur concurrent (signalé avant, vague A).

**Ce que Croisière pourra reprendre :** la méthode du banc `cine`.

## Vagues

| Vague | Tâche | Contenu | Tests | Critère de fin | Dépend de |
| --- | --- | --- | --- | --- | --- |
| P | Banc | Banc `cine` déjà compilé (`scummvm-build/out-cine`, cible `fw-cd-fr`, config dédiée). Ajouts : patch de traces `CINE_TRACE` (une ligne par tick : globales hachées, scripts actifs, calques), temps virtuel, entrées par tick, captures par tick. | scénarios intro et première scène | traces reproductibles à graine égale | — |
| X | Extraction | `scripts/voyageurs-extract.sh`, `original/voyageurs/`, `files.md` | md5, tailles, durées des MP3 | script idempotent, ~19 Mo | — |
| D | Données | import de `delphine/unpack.ts` (Croisière) + cas de test, puis bundle, PI1, NEO, ANI/MSK, PRC/REL/OBJ/MSG, police, SPL, AUTO00 | les 741 fichiers décompressés (CRC), images contre PNG de référence, textes | tout se lit, accents corrects | X |
| C | Cœur | VM (78 opcodes), objets, scripts globaux et objets, chargements différés, emplacements de sprites, boucle et cadence, hasard | par opcode ; ordre d'exécution ; démarrage jusqu'à la première scène, comparé aux traces | intro et première scène identiques au banc (traces) | D, P |
| R | Rendu | fond, incrustations, calques 0–5, occulteurs, boîtes de message, ligne de commande, menus, palette, fondus, curseurs | images contre captures du banc | premières scènes identiques au pixel | C |
| I | Interaction | verbes, inventaire, UTILISER à deux objets, messages d'échec, survol, clavier, toucher, menu système | scénarios de clics | une action de chaque verbe identique au banc | C, R |
| A | Son | musique CD (règles de fond, boucle, arrêt, fondu), effets OPL | séquence de pistes contre le banc ; rendu OPL d'un `.SPL` | musique et effets audibles dans le navigateur, pistes justes | C |
| S | Sauvegardes | état complet, `SaveSlots`, refus aux bons moments | aller-retour JSON à chaque étape | reprise identique (trace) | C |
| J | Intégration | `copy.ts`, aide, écran titre, jaquette, registre, README, licence | build, navigateur | jeu lançable depuis l'accueil | R, I, A, S |
| K | Validation | solution complète (`test/voyageurs/solution/`), partie entière sans écran avec et sans reprises, comparaison au banc, revue, mort du héros, fin | full-game | partie entière jusqu'au générique | tout |

Chaque vague se termine par `npm run typecheck`, `npm test` et `npm run build`, puis une vérification dans le navigateur dès R.

**Parallélisme.** P et X d'abord, en parallèle. D ensuite. Après C, R / A / S peuvent avancer en parallèle (fichiers disjoints) ; I suit R.

## Estimation

| Vague | Taille relative | Lignes estimées | Incertitude |
| --- | --- | --- | --- |
| P | petite | patch C++ ~200 (hors dépôt) | faible (méthode BASS) |
| X | petite | ~150 (shell + Python) | faible |
| D | moyenne | ~900 | faible (tout est décodé) |
| C | grande | ~2 000 | moyenne (VM fine) |
| R | moyenne | ~900 | moyenne (masques, occulteurs) |
| I | moyenne | ~700 | moyenne |
| A | petite | ~400 | moyenne (pilote OPL, règles CD) |
| S | petite | ~300 | faible |
| J | petite | ~500 | faible |
| K | moyenne | solution + pilote ~1 000 (tests) | moyenne (solution complète à écrire) |

**Total : 6 000 à 8 000 lignes de code, autant de tests**, soit environ la moitié de BASS (14 000) et un tiers de Lure (18 000). Chemin critique : D → C → R → I → K.

## Requis, naturellement lié, optionnel

**Requis :**
- vagues P, X, D, C, R, I, A, S, J ;
- décisions D1 à D14 tranchées ;
- mentions dans l'aide et le README : version modifiée (musique convertie, moteur réécrit), traduction de fans, abandonware.

**Naturellement lié :** K, `docs/voyageurs/*.md`, table CP437 → Unicode avec `0x97` = ê.

**Optionnel, à part :**
- écran Sony (D11) ;
- pistes CD 1 à 18 (si on découvre leur usage) ;
- musique AdLib de `BASESON.SND` à la place du CD ;
- lecture des sauvegardes de ScummVM ;
- version disquette et autres langues ;
- interface de sauvegarde d'origine (5 × 20 emplacements) ;
- visionneuse d'assets.

## Cas limites

- **Machine à scripts** :
  - l'octet N exécute l'entrée N−1 de la table ;
  - les labels ne sont pré-calculés que jusqu'au premier `END` ;
  - débordement des entiers sur 16 bits ;
  - un script ajouté pendant un tick s'exécute dans le même tick ;
  - la locale 0 compte les exécutions de l'entrée REL ;
  - plusieurs instances d'un même script.
- **Chargements** : un PRC vide les scripts globaux, un REL vide les scripts objets, un OBJ vide les calques. Les chargements sont différés en fin de tick.
- **Sprites** : allocation « premier emplacement libre », dans l'ordre exact. Rechargement par nom à la reprise d'une sauvegarde.
- **Rendu** :
  - une incrustation lit la position et la frame **actuelles** de l'objet ;
  - un occulteur de type 5 masque les sprites placés avant lui ;
  - la ligne du haut d'un sprite n'est pas cliquable ;
  - une boîte de message qui déborde est remontée.
- **Musique** : le décor L1 relance toujours sa piste. Il n'y a pas de borne sur le n° de décor (au-delà de 48, rien). Un effet sonore ne coupe pas la musique CD.
- **Interface** :
  - sauvegarde interdite pendant un menu, ou quand les entrées ou le menu système sont bloqués ;
  - clic droit dans un menu = annuler ;
  - UTILISER sans objet en inventaire.
- **Divers** : mort du héros, puis menu de reprise ou de nouvelle partie. Pause. Fenêtre masquée, avec l'horloge reprise par `FixedStepClock`.

## Risques

- **Fidélité de la VM et de la cadence.** Le moindre écart change la marche, qui est entièrement scriptée, et les cinématiques. Parade : traces tick par tick contre le banc dès la vague C, comme pour BASS.
- **Temps réel du banc.** ScummVM prend du retard sur un temps fixe. Parade : patch de temps virtuel, comme pour BASS.
- **Solution complète** : à écrire (pas de solution en données disponible). Parade : la rejouer au banc pour en produire les entrées.
- **Pistes CD 1 à 18** : usage inconnu (ScummVM : « tracks < 19 are not used »). Si l'original les utilisait (jingles de 11 s ?), il manquerait des sons. Contrôle seulement sans exécuter l'original : écouter les pistes et les comparer aux scènes. Faible.
- **`.SPL`** : environ 50 octets de fin non décodés. Le rendu OPL est à valider à l'oreille contre le banc avec un pilote audio actif.
- **Patch de fans** : erreurs éventuelles de texte, gardées telles quelles.
- **Légal** : voir § Légal.
- **Travail concurrent** : TIM3, Ween et Croisière travaillent dans le même checkout. On ne touche que `voyageurs` et `src/engine/delphine/` (après accord). `README.md` et `registry.ts` sont modifiés en vague J seulement, par petites éditions ciblées.

## Validation

- Tests unitaires par vague. `test/voyageurs/` est ignoré si `original/voyageurs/` est absent.
- Comparaison au banc : traces et images aux points de contrôle, versionnées en fixtures (comme `test/bass/solution/fixtures/`).
- Partie complète sans écran, d'une traite puis avec sauvegarde et reprise à chaque étape.
- Navigateur : intro, marche, chaque verbe, inventaire, menu système, sauvegarde et reprise, musique, effets, toucher (appui long), redimensionnement.
- Contrôle de licence avant J : README, aide.

## Dette technique

- Les fondus de palette existent déjà dans BASS (`src/games/bass/render/palette-fade.ts`, 256 couleurs, 6 bits). On ne les promeut pas : les formats et les pas diffèrent (9 bits, 8 pas). À reconsidérer si Croisière en a aussi besoin.
- Pas de lecteur IFF/ILBM commun : sans objet si D11 est retenue.
