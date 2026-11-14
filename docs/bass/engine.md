# Beneath a Steel Sky : le moteur de ScummVM et le découpage du portage

Étude en lecture du moteur `sky` de ScummVM (`engines/sky/`, v2026.4.0, GPL v3 ou ultérieure). Références `fichier.cpp:N` relatives à ce dossier. Statut : **lu**, sauf mention ; les chiffres de données sont vérifiés dans `formats.md`.

## 1. Taille et répartition du code

25 989 lignes (`.cpp` et `.h`), dont **~11 900 de logique utile hors musique** et ~1 650 de musique ; le reste : tables (`skydefs.h` 4 317, `hufftext.cpp` 2 004, noms de `debug.cpp` ~1 000), détection, méta-moteur, et ~2 700 lignes du remake iOS (`isIbass()`), à ignorer.

| Fichier | Lignes | Rôle | Va dans |
| --- | --- | --- | --- |
| `sky.cpp` / `.h` | 669 / 169 | boucle (`go`, :206-300), cadence (:406), touches (`handleKey` :155), drapeaux texte et voix (:389-404), langue (:427-475) | `engine/game.ts` |
| `logic.cpp` / `.h` | 2 667 / 349 | **cœur** : 16 types de logique (:45), boucle `engine` (:130), interpréteur `script` (:1199), **115 mcodes** (table :809, `fn*` de :1396 à :2576), variables initiales (:1146) | `engine/logic.ts`, `engine/script.ts`, `engine/mcodes/` |
| `compact.cpp` / `.h`, `struc.h` | 532 / 98 / 199 | lecture de `sky.cpt`, accès aux champs, remise à zéro | `data/cpt.ts`, `engine/compacts.ts` |
| `autoroute.cpp`, `grid.cpp` | 280, 260 | cheminement sur grille, grilles de collision | `engine/route/` |
| `screen.cpp` / `.h` | 1 116 / 207 | image 320 × 192, sprites triés, fondus, défilement, séquences plein écran | `render/`, `engine/screen.ts` |
| `mouse.cpp` / `.h` | 2 011 / 238 | curseurs, zones cliquables, boutons (~1 150 lignes iOS) | `engine/mouse.ts` |
| `control.cpp` / `.h` | 2 707 / 322 | panneau de contrôle, sauvegarde, recommencer (~850 lignes iOS) | `engine/control/`, `engine/save.ts` |
| `intro.cpp` / `.h` | 951 / 72 | introduction : listes de commandes (`_cdIntroSeq` :259, `nextPart` :694) | `engine/sequences/intro.ts` |
| `text.cpp` / `.h`, `hufftext.cpp` | 572 / 112, 2 004 | textes Huffman, polices, mise en page des bulles | `data/text.ts`, `engine/text.ts` |
| `disk.cpp` / `.h` | 496 / 102 | `sky.dsk`, `sky.dnr`, RNC | `data/disk.ts`, `data/rnc.ts` |
| `sound.cpp` / `.h` | 1 275 / 96 | effets (table de ~950 lignes), voix, file différée | `audio/` |
| `music/*` | ~1 650 | AdLib (porté), General MIDI et MT-32 (non portés) | `audio/` |
| `debug.cpp` | 1 353 | noms, commandes du débogueur | banc seulement |
| `inventory.cpp`, `ibasstext.cpp`, `metaengine.cpp`, `detection.cpp` | 109, 267, 406, 242 | iOS, détection | ignorés (sauf les touches de `metaengine.cpp`) |

## 2. Modèle du jeu : les compacts

- **Tout est un compact** : Foster (`CPT_FOSTER` = 3), Joey (1), les PNJ, les objets, les zones de souris, les 11 textes affichés (`CPT_TEXT_1..11`), les listes de logique, de dessin et de souris, les tables d'animation et de rotation. Identifiant `(liste << 12) | rang` (`compact.cpp`, `fetchCpt`), 3 258 compacts non vides dans 9 listes.
- **Structure** (`struc.h`, `compactOffsets[]` `compact.cpp:37-108`) : 55 champs `u16` (`logic`, `status`, `sync`, `screen`, `place`, `xcood`, `ycood`, `frame`, `cursorText`, `mouseOn/Off/Click`, `mouseRel*`, `mouseSize*`, `actionScript`, `mode`, quatre paires `xxxSub` / `xxxSub_off`, `dir`, `stopScript`, `miniBump`, `waitingFor`, `arTargetX/Y`, `spColor`, `spTextId`, `spTime`, `megaSet`…) puis 4 MegaSet de 14 mots (animations par direction, debout, parole, table de rotation, largeur sur la grille). Les scripts adressent un champ par son rang dans `compactOffsets` (`getCompactElem`).
- Bits de `status` : 0 derrière, 1 devant, 3 vecteur spécial, 4 zone de souris active, 5 collision, 6 traité par la logique, 7 occupe la grille.
- **838 variables de script `u32`** (`NUM_SKY_SCRIPTVARS`), qui servent de **bus** entre scripts et moteur : `SCREEN` (1), `LOGIC_LIST_NO` (2), `MOUSE_LIST_NO` (6), `DRAW_LIST_NO` (8), `CUR_ID` (12), `BUTTON` (15), `OBJECT_HELD` (103), `RND` (115), `CUR_SECTION` (143)… Cinq listes de scripts « en avant » sont recopiées aux rangs 352, 505, 656, 663, 721 (`logic.cpp:1172-1179`).
- **Les énigmes sont des données** : portes, ascenseurs, Joey, Lamb, LINC, Anita… sont des scripts des modules de `sky.dsk` (`F_MODULE_0 + n`, `Disk::loadScriptFile`), pas du C++. Le C++ ne contient que le moteur générique et six rustines (§ 10). **Le portage est un interpréteur fidèle sur des données**, comme Drascula ou FOTAQ, sans logique d'énigme à réécrire : c'est la différence majeure avec Lure (68 méthodes natives, 35 gestionnaires de tick).
- **Sections** : le jeu est découpé en 7 sections (`fnEnterSection` :2387) qui chargent musique, effets et grilles.

## 3. Logiques et scripts

**16 types de logique** (`logic.cpp:45`, `skydefs.h:127`) : `L_SCRIPT`, `L_AR` (calcul de route), `L_AR_ANIM` (suivre la route), `L_AR_TURNING`, `L_ALT`, `L_MOD_ANIMATE`, `L_TURNING`, `L_CURSOR`, `L_TALK`, `L_LISTEN`, `L_STOPPED`, `L_CHOOSE`, `L_FRAMES`, `L_PAUSE`, `L_WAIT_SYNC`, `L_SIMPLE_MOD`. `Logic::engine` (:130) parcourt la liste de logique (ids terminés par 0, `0xFFFF` + id = saut de liste) et appelle la logique de chaque compact dont `status & 64` ; le `sync` reçu est effacé après un tour (:158).

**Interpréteur** (`logic.cpp:1199`, ~190 lignes) : machine à pile de `u32`, **21 codes** : `push_variable`, `less_than`, `push_number`, `not_equal`, `if_and`, `skip_zero`, `pop_var`, `minus`, `plus`, `skip_always`, `if_or`, `call_mcode`, `more_than`, `script_exit` (13 et 19), `switch`, `push_offset` / `pop_offset` (champ du compact courant), `is_equal`, `skip_nz`, `restart_script`. **Piège** : `less_than` et `more_than` sont inversés par rapport à leur nom.
Adresse de script : 4 bits de module + 12 bits de rang. **Un script se suspend quand un mcode rend faux** : l'offset de reprise est rangé dans `xxxSub_off` du compact (`logicScript` :178). Les scripts sont donc **déjà des coroutines par compact** : pas de générateur dans l'interpréteur. Niveaux de script : `mode` = 0 base, 4 action, 8 déplacement, 12 extra ; `fnStartSub` / `fnTheyStartSub` montent d'un niveau, la fin d'un niveau redescend.

**115 mcodes** (`bool fn(a, b, c)`, faux = suspendre), tous génériques ; décompte par thème approximatif :

| Thème | Nombre | Exemples |
| --- | --- | --- |
| chargement, écran | ~14 | `CacheChip`, `CacheFast`, `DrawScreen`, `FadeDown`, `FadeUp`, `SetPalette`, `Foreground`, `Background`, `Sort` |
| déplacement, animation | ~22 | `GetTo`, `Ar`, `ArAnimate`, `TurnTo`, `FaceId`, `SetMegaSet`, `RunFrames`, `SimpleMod`, `CustomJoey` |
| compacts, synchronisation | ~22 | `StartSub`, `TheyStartSub`, `KillId`, `SendSync`, `AwaitSync`, `SendRequest`, `Interact`, `NewList`, `PersonHere` |
| grille | 3 | `PlotGrid`, `RemoveGrid`, `ToggleGrid` |
| souris, interface | ~19 | `NormalMouse`, `CrossMouse`, `OpenHand`, `AddHuman`, `NoHuman`, `StartMenu`, `Highlight`, `PointerText` |
| texte, parole | ~15 | `SpeakMe`, `SpeakWait`, `Chooser`, `TextModule`, `LincTextModule`, `LookAt`, `AskThis`, `PrintCredit` |
| son, musique | 6 | `StartFx`, `StopFx`, `PauseFx`, `UnPauseFx`, `StartMusic`, `StopMusic` |
| partie, divers | ~10 | `EnterSection`, `RestoreGame`, `RestartGame`, `Quit`, `Random`, `NewSwingSeq`, `WaitSwingEnd`, `SkipIntroCode` |

Logiques notables : `arAnim` (:216-345, collisions entre personnages, `waitingFor`), `talk` (:529, décompte de `spTime`, interruption par clic pour les ids de `clickTable`), `choose` (:643).

## 4. Mouvement

- Joueur et PNJ marchent de la même façon : un script appelle `fnGetTo` → `AutoRoute::autoRoute` → `arAnim` joue la route compactée en segments (distance, direction).
- **Grille** (`grid.cpp`) : 40 × 24 blocs de 8 pixels, deux plans (fixe, et empreinte des compacts qui marchent, posée et retirée autour de leur tick, `logic.cpp:150-158`) ; 70 grilles, table écran → grille. Origine décalée (`TOP_LEFT_X = 128`, `TOP_LEFT_Y = 136`).
- **Algorithme** (`autoroute.cpp`, 280 lignes) : grille 42 × 26 de mots avec bordure, obstacles élargis de la largeur du personnage, **propagation par vagues** (1 + minimum des 4 voisins) dans un rectangle qui grandit jusqu'à l'arrivée, remontée à rebours avec un ordre fixe des directions, pas de 8 px, tampon de 64 octets (16 segments). Pas de diagonale, pas de coût. Retour 0 trouvé, 1 inaccessible, 2 déjà sur place. **Sans découpage dans le temps**, contrairement au `PathFinder` de Lure.
- Collisions entre personnages (`arAnim`) aux frontières de 8 px : si l'autre est arrêté, on relance son propre script de déplacement ; s'il marche, on joue son `miniBump`.
- PNJ autonomes (Joey, Lamb, Anita, Burke…) : **par scripts** et `fnGetTo`. Joey lit la position de Foster par `fnCustomJoey`.

## 5. Interface d'origine

- Écran 320 × 200 : 192 lignes de jeu et 8 lignes en bas. L'inventaire est un menu d'icônes en haut de l'écran qui apparaît au survol (`fnStartMenu` :1875, compacts d'objets) ; dessiné par les scripts et le rendu des sprites.
- **Souris à deux boutons** : clic gauche « marcher, regarder, parler », clic droit « utiliser » (`metaengine.cpp:89-95`) ; `BUTTON` reçoit le bouton pour un cycle. `Mouse::pointerEngine` (`mouse.cpp:946`) cherche la première zone active sous le pointeur et lance ses scripts `mouseOn` / `mouseOff` ; `buttonEngine1` (:1441) lance `mouseClick`. **Les verbes sont dans les scripts** (objet tenu `OBJECT_HELD`, curseurs d'objets).
- Choix de dialogue : `fnChooser` (:1739) et `Mouse::textChooser` (:327).
- **Panneau de contrôle** (`control.cpp:1446`, F5) : sauvegarder, restituer (liste de noms tapés au clavier), volume de la musique, **vitesse du jeu** (`doSpeedSlide`, modifie `gameSpeed`), effets oui / non, **texte / voix / texte + voix** (`toggleText` :1757), recommencer (confirmation), quitter. Sauvegarde interdite pendant un choix (`SF_CHOOSING`).
- Clavier (`metaengine.cpp:99-140`) : Échap passe l'introduction, F5 panneau, `.` passe la réplique, `p` pause (palette assombrie), Entrée confirme ; Ctrl-F / Ctrl-G (modes rapides de débogage) non portés.

## 6. Boucle, cadence, boucles bloquantes

- **Cadence** : `gameSpeed = 80` ms (`sky.cpp:406`), **12,5 images/s**, réglable dans le panneau. Ordre d'un tour (`go` :206-300) : file d'effets, souris, touches, pause, `Logic::engine`, séquence, recomposition, sprites, affichage, attente. Autres horloges : séquences plein écran toutes les 60 ms (`screen.cpp:745`), fondus 32 pas de 20 ms, défilement 19 pas de 20 ms, musique à 50 Hz.
- **Boucles bloquantes** à réécrire en séquences (`src/engine/sequence.ts`) :
  1. **Introduction** (`Intro::doIntro` :664) : déjà une liste de commandes (attendre, fondus, séquence, voix, effacer…), toutes interruptibles par Échap : conversion presque mécanique.
  2. **Fondus et défilement appelés depuis un mcode**, donc **au milieu de `Logic::engine`** (`fnDrawScreen`, `fnFadeDown`, `fnFadeUp`, `screen.cpp:529-612`) : la logique des autres compacts ne tourne pas pendant le fondu. Solution prévue : `Logic::engine` devient reprenable (le parcours de la liste garde son curseur ; le mcode installe une séquence de fondu et rend la main ; le tour reprend au compact suivant une fois le fondu fini). **Point d'architecture le plus délicat**, tranché en vague C.
  3. `fnLookAt` (:2463) : texte, puis attente d'au moins 0,8 s et du bouton relâché.
  4. `fnWaitSwingEnd` / `waitForSequence` (`screen.cpp:696`).
  5. Panneau de contrôle, `fnRestoreGame` (:2410, ouvre le panneau depuis la logique), `fnQuit` (1,5 s).
  6. Pause (`sky.cpp:258`).
- Tout le reste (marche, parole, attente d'un `sync`, choix) est déjà une machine à états par compact.

## 7. Texte et parole

- `stdSpeak` (`logic.cpp:2581`, via `fnSpeakMe` :1684) : voix lancée si `SF_ALLOW_SPEECH` et fichier trouvé ; **sous-titre affiché si `SF_ALLOW_TEXT` ou si la voix manque** ; durée : avec voix, `L_TALK` attend la fin de la voix (`speechFinished`, :592) puis 10 cycles ; sans voix, `spTime = lettres + 5` cycles. Un clic sur l'interlocuteur coupe voix et texte (:543-548).
- Les voix ne dépendent pas de la langue : **voix anglaises + textes français** est une combinaison native du moteur (langue 2, mode « texte + voix »).
- Mise en page (`text.cpp`, `displayText` :254-412) : largeur par les largeurs de la police, coupure aux espaces, 10 lignes au plus, largeur fixe 128 px pour les dialogues, couleur du personnage (`spColor`), contour 240 ; le texte devient un sprite (compact `CPT_TEXT_n`).

## 8. Son et musique

- **Musique AdLib** (`music/adlibmusic.cpp`, `adlibchannel.cpp`, `musicbase.cpp`, ~700 lignes utiles) : OPL2 seul, **minuterie à 50 Hz** (`opl->start(onTimer, 50)`), soit le `tickRate` par défaut de `WebOpl`. Tempo en virgule fixe 16.16 : `tempo0 × tempo1 / 2999` ; chaque tick, `aktTime += tempo` et chaque canal avance de `aktTime >> 16`. Canal : suite (délai en varint 7 bits, événement) ; `0x00-0x7F` note + vélocité ; `0x80-0x8F` attribution d'une voix OPL ; `0x90` note coupée, `0x91` fin, `0x92` instrument, `0x93` tempo, `0x95` transposition, `0x96` volume, `0x97` mode instrument par note, `0x98` boucle, `0x99` relâchement, `0x9C` point de boucle. Écritures filtrées par un miroir de registres partagé ; `getNextNote` reproduit un bogue de l'assembleur d'origine (à garder). Le volume de la musique entre dans le calcul des niveaux de sortie, pas dans un gain global. 13 morceaux ne bouclent pas (liste `musicbase.cpp:106-118`), les 18 autres bouclent.
- **Effets** (`sound.cpp`) : échantillons (jamais l'OPL), deux voies (`fnStartFx(son, voie)`) plus les effets lancés par les programmes d'animation ; volume par pièce (`musicList`), départ différé (file de 4, `checkFxQueue`), boucle sur la fin de l'échantillon, effets à relancer au chargement (drapeau `0x20`).
- **Voix** : une voie ; une nouvelle voix coupe la précédente.

## 9. Hasard et sauvegarde

- **Un seul tirage** : `fnRandom` (`logic.cpp:2237`), `RND = getRandomNumber(65536) & a`, générateur `Common::RandomSource("sky")` : `scummvmRandom` du dépôt convient tel quel ; même graine que le banc = comparaison image par image.
- **Sauvegarde ScummVM** (`control.cpp`, révision 6, `prepareSaveData` :2195, `parseSaveData` :2350) : état du son (2 effets, musique), police, curseur, palette ; **838 variables** ; **60 fichiers chargés** ; **contenu brut des 854 compacts de `_saveIds`**. Au chargement : textes effacés, `fnLeaveSection` / `fnEnterSection` rejoués, musique relancée. « Recommencer » = chargement des données de remise à zéro de `sky.cpt`. Hors fichier : introduction passée, options, vitesse.
- Pour le portage : les compacts restent dans des `Uint16Array` ; la sauvegarde recopie les mêmes éléments que ScummVM (dans le JSON versionné du site), ce qui garde la comparaison au banc simple.

## 10. Rustines de ScummVM et pièges

- Bogues du jeu corrigés par ScummVM, **repris en écarts documentés** (décision D7 du plan) : 2687 « Officer Blunt » (`compact.cpp`, `talkTable[158]`) ; 1804 porte de l'écran 12 bloquée par Joey (`autoroute.cpp:252`) ; 1823 Joey à la sortie de l'ascenseur (`logic.cpp:202`) ; 5567 lunettes devant Trevor (`logic.cpp:1214`) ; 4230 Mme Piermont au téléphone (`fnSpeakMe` :1684) ; porte du Reich (`Grid::loadGrids`) ; 8627 curseur après un clic sur un objet d'inventaire (`mouseScript` :1171, écart volontaire de ScummVM).
- Messages corrigés par langue (`Text::patchMessage`), dont un français.
- Fidélité 16 bits : débordements des champs `u16`, variables `u32` ; `LINC_DIGIT_6` = `LINC_DIGIT_5` (erreur de table connue, à garder).

## 11. Découpage en dossiers et en groupes

Arborescence `src/games/bass/` (modèle : `src/games/lure/`) :

| Dossier | Contenu |
| --- | --- |
| `data/` | `rnc.ts`, `disk.ts` (index, chargement), `cpt.ts`, `header.ts` (`DataFileHeader`), `palette.ts`, `font.ts`, `text.ts` (Huffman), `grid-file.ts`, `music-file.ts`, `sfx-file.ts`, `tables/` (générées : arbre Huffman, `musicList`, conversion des voix, noms de compacts et de variables) |
| `engine/` | `host.ts`, `game.ts` (boucle), `compacts.ts`, `vars.ts`, `logic.ts` (16 logiques, tour reprenable), `script.ts` (21 codes), `mcodes/` (par thème), `route/` (`grid.ts`, `autoroute.ts`), `mouse.ts`, `text.ts`, `screen.ts` (état d'écran, fondus), `sequences/` (introduction, séquences plein écran), `control/` (panneau), `save.ts`, `ids.ts` |
| `render/` | composition 320 × 200, sprites, texte, curseurs, palette et fondus |
| `audio/` | `adlib-music.ts`, `adlib-channel.ts`, `sfx.ts`, `speech.ts`, `audio.ts` (assemblage hôte) |
| `ui/` | application, hôte navigateur, préchargement, sauvegardes, touches, copy, titre, aide |

Groupes d'agents (chacun dans son dossier, aucun fichier partagé ; tout besoin commun signalé à l'orchestrateur) :

| Groupe | Contenu | Dépend de |
| --- | --- | --- |
| **D** données | RNC, index, `sky.cpt`, en-têtes, palettes, polices, textes, grilles, fichiers de musique et d'effets, tables générées | X |
| **C** cœur | compacts, variables, 16 logiques, interpréteur, table des 115 mcodes (souches qui journalisent), boucle sans rendu, tour reprenable | D |
| **E** marche | grille, `autoroute`, `arAnim`, rotations, collisions | C |
| **R** rendu | sprites triés, décors, texte, curseurs, fondus, défilement, séquences « flirt » | D (et C pour l'état) |
| **M1-M4** mcodes | M1 écran et chargement ; M2 compacts, synchronisation, grille, divers ; M3 souris, menu, choix, texte et parole ; M4 son et sections. M2 marche dépend de E | C |
| **A** audio | musique AdLib, effets, voix | D |
| **I** séquences | introduction du CD, séquences plein écran, fin | R, A |
| **S** panneau et sauvegarde | panneau d'origine, sauvegarde, recommencer | C, R |

Chemin critique : X → D → C → (E, M) → partie jouable en test. R, A et I avancent en parallèle de C et M ; ils ne bloquent pas la logique tant que l'hôte de test est un faux.

## 12. Ce qui se teste sans navigateur

- Lecture de tous les fichiers ; décodage de toutes les lignes françaises.
- Interpréteur : traces de ScummVM (débogueur : `Cmd_ScriptVar`, `Cmd_Section`, `Cmd_ShowCompact`, hooks `Debug::logic/script/mcode`, `debug.cpp:1063-1085`) comparées tick par tick aux traces du portage : variables, positions de Foster et de Joey, liste de logique.
- `autoroute` : des milliers de trajets comparés octet par octet à ScummVM compilé (même méthode que Lure).
- Introduction : ordre, durées, fichiers chargés.
- Sauvegarde : aller-retour exact ; reprise en pleine marche.
- Partie complète : solution jouée par clics simulés (vague K).

## 13. Points tranchés en C

Code : `src/games/bass/engine/` ; tests : `test/bass/engine/` (traces de référence du banc dans `fixtures/`, 112 Ko).

| Module | Contenu (référence ScummVM) |
| --- | --- |
| `ids.ts` | variables nommées (`logic.h`), `L_*`, `ST_*`, `SF_*`, curseurs, compacts et scripts nommés, listes « en avant », `clickTable`, noms des logiques et des opcodes (`debug.cpp`) |
| `vars.ts` | 838 variables `u32` (`Uint32Array`), `initScriptVariables` (`logic.cpp:1146`) |
| `compacts.ts` | magasin des compacts sur une copie des données brutes de `SkyCpt` : vue par compact jusqu'à la fin des données (débordement comme un `Compact *`), alias, champs par décalage DOS (`getCompactElem`), `getSub` / `setSub`, `MegaSet`, tables de rotation, état de sauvegarde |
| `script.ts` | interpréteur des 21 codes (`Logic::script`) |
| `logic.ts` | 16 logiques, `Logic::engine` reprenable, `logicScript`, collisions, `stdSpeak`, `mouseScript`, part logique de `spriteEngine` |
| `mcodes/` | table des 115 mcodes (`index.ts`) et un fichier par groupe d'§ 11 : `screen.ts` (M1), `compacts.ts` (M2), `mouse.ts` et `text.ts` (M3), `game.ts` (M4) |
| `effects.ts` | effets bloquants (fondus, défilement, `fnLookAt`, fin de séquence) |
| `files.ts` | `_itemList` et listes de `Disk` (`fnCacheFast`, `fnCacheChip`, `refreshFilesList`, `fnMiniLoad`, `fnFlushBuffers`) |
| `mouse.ts` | `mouseEngine`, `pointerEngine`, `buttonEngine1`, `fnAddHuman`, curseur courant |
| `save-data.ts` | lecture des données au format de sauvegarde, révision 6 (remise à zéro de `sky.cpt`) |
| `services.ts` | interfaces des services (écran, son, textes, grille, `Router`, panneau) et leurs souches de test |
| `game.ts` | `BassEngine` : `SkyEngine::init`, départ après l'introduction (`restartGame`), boucle `go` (`compose` clôt chaque tour), cadence |
| `host.ts`, `trace.ts`, `disasm.ts` | `BassHost` et `TestHost` ; trace au format du banc ; désassembleur des scripts |

**Tour reprenable.** Un tour de `go` est un générateur (`BassEngine.cycle`) que `SequenceRunner` (`src/engine/sequence.ts`) exécute, en ticks de 20 ms ; `Logic.engine()` est lui-même un générateur appelé par `yield*`. Un mcode qui bloquait ScummVM (`fnFadeDown`, `fnFadeUp`, `fnDrawScreen`, `fnLookAt`, `fnWaitSwingEnd`) fait sa part logique tout de suite, dépose une séquence dans `EffectQueue` (`Logic.block`) et rend la main au script. Après le compact en cours (logique, grille, `sync = 0`), `engine()` joue les effets en attente (`yield* effects.flush()`, dans l'ordre des demandes), puis reprend au compact suivant de la liste, avec son curseur : rien d'autre ne tourne pendant l'effet, comme dans ScummVM. Le même point de reprise existe après `mouseEngine`. Durées : fondu 32 ticks, `fnDrawScreen` 64, défilement 19 (sans fondu au noir), `fnLookAt` 40 au moins (Échap l'abrège, les entrées reçues sont jetées comme dans `waitMouseNotPressed`), `fnWaitSwingEnd` jusqu'à la fin de la séquence (une image toutes les 60 ms). Les fondus ne lisent pas les entrées : elles attendent le tour suivant. **Cadence** : l'hôte bat à 20 ms ; l'échéance du tour suivant suit `go` (`delayCount += gameSpeed`, remise à l'heure si le tour a pris du retard) : après un fondu, le tour suivant part tout de suite, puis toutes les 80 ms (vérifié en test).

**Écarts** (en plus de ceux notés en tête des modules) :
- le reste du script du compact qui demande l'effet s'exécute **avant** l'effet (dans ScummVM, après le retour du mcode) ; aucun script ne lit ce que l'effet change (palette, image, temps), l'état logique est le même. La part logique du moteur de sprites appelé au milieu de `fnDrawScreen` et de `fnLookAt` (compact dont le sprite n'est pas chargé : `status = 0`) est faite au moment du mcode ; le rendu (R) dessinera l'état de fin de compact ;
- l'introduction n'est pas jouée (vague I) : `startAfterIntro` est le départ de ScummVM après Échap (`Control::restartGame` : données de remise à zéro de `sky.cpt`, révision 6, chargées comme une sauvegarde, `fnEnterSection` rejoué) ;
- souris : position de départ au centre (160, 96) comme `Mouse::Mouse`, pas d'état « bouton enfoncé » hors navigateur ; curseur gardé comme un numéro ;
- panneau, pause, sauvegarde : vagues S et J ; `fnRestoreGame` journalise.

**Mcodes** (`MCODES[n].status`) : **99 complets**, **15 complets sur un service de l'hôte** (écran ou son : `cache_chip`, `draw_screen`, `set_palette`, `enter_section`, `new_swing_seq`, `wait_swing_end`, `blank_screen`, `start_fx`, `stop_fx`, `start_music`, `stop_music`, `fade_down`, `fade_up`, `pause_fx`, `un_pause_fx` : sans `BassScreenRenderer` ni `BassAudio`, ils n'ont pas d'effet visible ou audible), **1 souche** (`restore_game`). Les 12 mcodes de texte, `kill_id`, `plot_grid` et `remove_grid` sont complets : `BassTextManager`, `Grid` et `AutoRoute` sont les services par défaut. Services de test : `NullScreen` (garde seulement l'état d'une séquence), `SilentSound` (aucune voix : `speechFinished` vrai), `NullText` (aucun texte formé : les mcodes de texte journalisent), `NullGrid` et `StubRouter` (`autoRoute` rend 2, « déjà sur place »). Par défaut seuls `NullScreen` et `SilentSound` restent : voir § 16.

**Hasard** : `fnRandom` tire dans `ScummvmRandom` (graine injectable, 1 par défaut). `Common::RandomSource("sky")` prend `random_seed` tel quel (`generateNewSeed`) : avec `--random-seed=1`, le portage suit la même suite que le banc (`scummvmRandom` est vérifié contre ScummVM compilé, `test/shared/rng.test.ts`). Aucune des traces relevées n'appelle `fnRandom` : la concordance n'est pas encore vérifiée sur une trace.

**Comparaison au banc** (`test/bass/engine/trace.test.ts`, traces `trace-sky.sh`, graine 1) :
- **départ sans entrée** (Échap puis rien, `fixtures/idle.trace`) : **314 tours identiques** (écran, logique, état, position, image et écran de Foster et de Joey, 1 227 appels de mcodes avec leurs arguments, y compris les arguments laissés par les instructions précédentes). Vérifié aussi hors test au niveau 3 du banc (18 751 lignes, opcodes et logiques de chaque compact compris) et sur 1 126 tours (90 s). Constat : sans entrée, Foster reste sur la passerelle et rien n'arrive en 90 s (le garde qui tire, noté dans le README du banc, demande une action) ;
- **clic pour marcher** (`b-start.txt`, `fixtures/start.trace`) : identique jusqu'au tour 120, où le clic lance `fnSaveCoods`, `fnAssignBase`, `fnGetTo`, `fnAr` comme dans ScummVM ; **première différence au tour 121**, au calcul de la route (souche du cheminement, vague E). Le test vérifie ce point exact : il faudra le déplacer quand E sera là.

Besoins pour la suite : `data/text.ts` (Huffman) et un `engine/text.ts` (M3, `lowTextManager`, `fnTextModule`, `logicCursor`) branchés sur `BassText` ; grille et `autoroute` (E) sur `WalkGrid` et `Router` ; rendu (R) sur `BassScreen` (`effectStep` donne le pas de chaque effet) ; noms des variables (tables générées de D9) pour afficher les lignes `SC` de la trace comme le banc.

## 14. Points tranchés en E

Code : `src/games/bass/engine/route/` (`grid.ts`, `autoroute.ts`) ; tests : `test/bass/engine/route.test.ts`, `route-cases.ts` (scénario), `fixtures/route-scummvm.json` (36 Ko) ; banc : `bench/sky-route/` (hors dépôt, README).

| Module | Contenu (référence ScummVM) |
| --- | --- |
| `route/grid.ts` | `Grid` (`WalkGrid`) : 70 grilles de 120 octets rechargées par `loadGrids`, table écran → grille, `getGridValues` (décalages `TOP_LEFT_X/Y`, largeur rognée, arithmétique `uint32` de `plotGrid` pour une largeur nulle), pose et retrait par compact (`objectToWalk`, `removeObjectFromWalk`) ou par position (`plotGrid`, `removeGrid`), `giveGrid`, rustine de la porte du Reich dans `loadGrids` (si `REICH_DOOR_FLAG`, retrait du bloc de `CPT_REICH_DOOR_20`) |
| `route/autoroute.ts` | `AutoRoute` (`Router`) : `initWalkGrid` (grille 42 × 26 bordée, blocs pleins élargis de `gridWidth` sur le `uint8` de ScummVM, lecture des mots 32 bits à rebours), `calcWalkGrid` (vagues, rectangle d'intérêt qui grandit), `makeRouteData`, `checkInitMove`, `clipCoordX/Y`, tampon de 64 octets, codes 0, 1, 2, rustine 1804 |

Câblage : `BassEngine` construit `Grid` et `AutoRoute` par défaut (`game.ts`, seule modification hors de `route/`) ; les options `grid` et `router` restent pour les tests (un `grid` injecté sans `router` garde `StubRouter`). `NullGrid` reste dans `services.ts` pour les tests qui n'ont pas de fichiers. Les mcodes `plot_grid`, `remove_grid`, `enter_section` (`loadGrids`) et `toggle_grid` n'attendent plus un service en souche.

**Écarts** (en plus de ceux notés en tête des modules) :
- **Débordement du tampon de route** : ScummVM écrit les segments de la fin vers le début d'un tampon de 64 octets sans contrôle ; au-delà de **15 segments** (16 avec le segment de départ hors écran) il écrit avant le tampon (comportement indéfini). Le portage refuse alors la route (code 1, tampon à zéro, `AutoRoute.overflowed` vrai). Aucune des routes tirées sur les 70 grilles n'approche cette limite (11 segments au plus) ; seul un escalier fabriqué (14 et 15 segments passent, 16 débordent) l'atteint. Les 7 cas de l'escalier sont vérifiés contre le harnais, qui détecte l'écriture hors du tampon ;
- **lectures hors de la grille de travail** : un départ sur la première ou la dernière ligne fait lire à la plage d'intérêt les voisins des blocs de la bordure, hors du tableau (une ligne avant ou après) ; ScummVM lit la mémoire voisine (indéfini). Le portage lit 0, comme le tampon bordé de zéros du harnais. C'est fréquent (environ un cas sur cinq des routes tirées) et sans effet observé : les 11 000 routes concordent. Une écriture hors du tableau ne s'est jamais produite ; elle serait traitée comme le débordement ;
- la grille du bord de l'écran reste franchissable (la bordure de zéros n'est pas bloquée) : une route peut contourner un mur plein par la bordure. C'est le comportement de ScummVM, repris tel quel ;
- un écran sans grille (`_gridConvertTable` à -1 ou hors table) lève une erreur au lieu de l'assertion ou du pointeur nul de ScummVM ; un fichier de grille absent (disque de test) laisse la grille à `null` ;
- les grilles ne sont pas sauvegardées (comme dans ScummVM) : `fnEnterSection` les recharge au chargement d'une partie, puis chaque compact à `GRID_PLOT` repose son empreinte à son premier tour.

**Preuve** (`route.test.ts`, vraie donnée du jeu, comparaison à ScummVM compilé : vrais `autoroute.o` et `grid.o`, non modifiés, reliés à un harnais qui fournit les compacts, le disque et les variables) : scénario déterministe de **13 873 commandes** sur les **70 grilles** : **11 016 routes** (5 070 trouvées, 5 625 inaccessibles, 314 déjà sur place, 7 débordements) de Foster et de Joey, largeurs 0 à 259 (dont les `gridWidth` réels et le `uint8` : 259 vaut 3), `MegaSet` 0 à 3, départs et arrivées sur l'écran, sur les bords (127, 128, 447, 448…) et hors écran jusqu'à 65535 ; 1 030 empreintes de grille après des poses et retraits aléatoires (`plotGrid`, `removeGrid`, `objectToWalk`, `removeObjectFromWalk`, largeurs 0 à 60, hors écran compris) ; la rustine 1804 (40 cas : arrivée dans le bloc (2, 14) de l'écran 12, bloqué ou non par Joey) ; la porte du Reich (5 écrans). **Résultat : octet pour octet identique** (mots du tampon de route, code de retour, empreinte FNV-1a de chaque grille). Régénération : `node bench/sky-route/gen.mts <dossier de travail>` (compiler d'abord avec `bench/sky-route/build.sh`).

**Comparaison au banc** : `b-start.txt` (clic pour marcher, `fixtures/start.trace`) est maintenant **identique sur les 278 tours** (route, marche de Foster, collision, changement d'écran au tour 278) ; la première différence au tour 121 a disparu. Le test `trace.test.ts` vérifie la trace entière. Le chemin est donc celui de ScummVM aussi dans `arAnim` / `mainAnim` (déjà portés en C), seule la grille manquait.

## 15. Texte et parole

Code : `src/games/bass/engine/text.ts` (nouveau) ; mcodes : `engine/mcodes/text.ts` (complets, voir ci-dessous) ; tests : `test/bass/engine/text.test.ts`, traces `fixtures/talk.trace` et `fixtures/talk-text.trace`.

**`BassTextManager`** (implémente `BassText`, réécriture de `Text::lowTextManager`, `fnSetFont`, `fnTextModule`, `fnPointerText`, `logicCursor`, `changeTextSpriteColor`) : texte par `SkyTexts.getText` (français, rustines comprises), police chargée à la demande (`FONT_SPECS`), mise en page et sprite par `renderText` (`data/text-layout.ts`), premier compact de `CPT_TEXT_1` à `CPT_TEXT_11` (23 à 33) dont le statut est 0 : `flag = 274 + rang` (emplacement de `_itemList`, `FIRST_TEXT_BUFFER`), `logic = logicNum`, `status = ST_LOGIC | ST_FOREGROUND | ST_RECREATE`, `screen = SCREEN`. `numLetters` (durée sans voix) = 2 + nombre de tours de la boucle de mise en page de ScummVM, compté en observant les lectures de largeur de `layoutText` : relectures après une coupure comprises (« Je pourrais L'UTILISER... », 25 lettres, rend 40).

**Branchement** : `BassTextManager` est le service de texte par défaut ; le moteur le construit une fois ses compacts, son cache d'objets et ses variables prêts (`BassTextOptions` : `disk`, `compacts`, `items`, `vars`). `BassEngineOptions.text` accepte un service ou une fabrique `(engine) => BassText` ; `NullText` reste pour les tests sans données de texte. La durée d'une réplique sans voix (`numLetters`) vient de `TextLayout.numLetters` (`data/text-layout.ts`).

**Voix et sous-titres** (D4 : textes français, voix anglaises, « texte + voix » par défaut). La règle vit dans `Logic.stdSpeak` (déjà fidèle à ScummVM) ; le service ajoute les modes : `textVoiceOptions(mode)` donne `subtitles` et `speech` pour `BassEngineOptions`, `applyTextVoiceMode(system, mode, audio?)` les change en cours de partie (drapeaux `SF_ALLOW_TEXT` / `SF_ALLOW_SPEECH` **et** `BassAudio.speechOn`, qui est un second interrupteur : les deux doivent suivre), `textVoiceModeOf(flags)` relit le mode.

| Mode | Voix | Sous-titre | `spTime` |
| --- | --- | --- | --- |
| texte + voix | lancée si le fichier existe | affiché | 10 tours après la fin de la voix |
| texte seul | non (`startSpeech` rend faux) | affiché | lettres + 5 |
| voix seule | lancée | non (aucun compact de texte) | 10 après la fin de la voix |
| voix absente (tout mode) | — | **forcé** | lettres + 5 |

Un clic (ou « . ») coupe voix et texte pour les personnages de `clickTable` (`L_TALK`, déjà dans `logic.ts`). Hors de l'écran du joueur, la réplique n'affiche pas de texte (`spTextId = 0`).

**Mcodes de texte** : relus contre `logic.cpp` (`fnSpeakMe`, `fnSpeakMeDir`, `fnSpeakWait`, `fnSpeakWaitDir`, `fnChooser`, `fnHighlight`, `fnTextKill`, `fnTextKill2`, `fnNewList`, `fnAskThis`, `fnTextModule`, `fnPrintCredit`, `fnLookAt`, `fnLincTextModule`, `fnSetFont`, `fnPointerText`) : aucune différence, **aucune modification de logique** ; seul l'en-tête change. Ils sont complets dès que `BassText` est un `BassTextManager` ; `NullText` garde le chemin « journalise et fait le reste ». La part IBASS (`setTextChooserMode`, `textChooser` de `mouse.cpp`) n'est pas portée : elle n'existe que pour le remake iOS.

**Écarts** :
- plus de 11 textes en même temps : ScummVM sortirait de la plage des compacts de texte (écriture dans un compact étranger) ; ici le dernier compact est réutilisé et le fait est journalisé (jamais vu) ;
- une police ou un numéro de texte invalide lève une erreur (ScummVM lirait au-delà de ses tampons) ;
- dans les tests, la durée de la voix 50659 (réplique 4155) est fixée à 1,4 s, réglée sur la trace du banc : les voix du portage sont des MP3, celles du banc des PCM de `sky.dsk`, et le mélangeur de ScummVM suit l'horloge réelle. En jeu, la durée vient du MP3 décodé (`BassSpeech`), donc la fin de réplique peut différer d'un tour.

**Comparaison au banc** (scénario `talk-barre` : Échap, survol puis clic gauche sur la barre, zone 85 de l'écran 0 ; Foster marche jusqu'à la barre puis dit la réplique 4155 ; `Grid` et `AutoRoute` réels, `BassTextManager`, voix factices) : **242 tours identiques jusqu'à la fin de la réplique** (survol, clic, route, marche, `fnNoHuman`, `fnKillId`, `fnSpeakMe`, animation de parole, fin de voix au tour 103, `fnAddHuman` au tour 113 : réplique de 27 tours = voix 17 + 10), puis identiques aux mcodes de survol près. Même chose en **texte seul** (`speech_mute=true` dans un `.ini` du banc : `fnAddHuman` au tour 131 = 86 + 40 lettres + 5) et en **voix seule** (même trace que texte + voix). Écart de banc, pas de portage : `Mouse::fnAddHuman` appelle `warpMouse`, qui déplace le pointeur de la fenêtre factice ; ScummVM ne relance donc pas le survol de la barre après la réplique, le portage (pointeur resté sur la barre) le relance (`fn_cross_mouse`, `fn_pointer_text` au tour suivant). Le test compare ces lignes strictement jusqu'au tour de fin, puis le reste sans les mcodes de survol.

**Pas encore prouvé au banc** : `fnTextModule` / `fnLincTextModule` (LINC), `fnChooser` (testé sur les données, pas contre une trace), `fnLookAt`, `fnPrintCredit`, une réplique d'un autre personnage que Foster, une réplique hors écran.

**Reste à faire hors de ces fichiers** : le panneau de contrôle (vague S) appellera `applyTextVoiceMode` pour les trois modes d'origine.

## 16. Branchement

Code : `src/games/bass/create.ts` (`createBassEngine`), `engine/game.ts` ; test : `test/bass/engine/create.test.ts`.

**Services par défaut de `BassEngine`** : `BassTextManager` (textes français, polices, sprites de texte), `Grid` et `AutoRoute` (marche), `NullScreen` (aucune image : état d'une séquence seulement) et `SilentSound` (aucune voix). Le moteur ne dépend ni de `render/` ni de `audio/` : c'est le moteur de logique pure des tests. `screen` et `text` acceptent un service ou une fabrique `(engine) => service`, appelée une fois les compacts, variables et fichiers du moteur construits (c'est ainsi que `BassScreenRenderer` s'y lie, par `attach`).

**Tour de jeu** (`SkyEngine::go`) : file des effets sonores, entrées, `mouseEngine`, touches, `Logic::engine`, `processSequence`, `compose()` (`recreate`, `spriteEngine`, `flip`). `fnLookAt` recompose avant son attente (`lookAtWait`), `restartGame` appelle `screen.reset()` avant `setPalette`.

**`createBassEngine(data, host, options)`** rend `{ engine, renderer, audio }` : `render: true` branche `BassScreenRenderer` (l'hôte lit `renderer.frame`), `audio: { voices, music, … }` branche `BassAudio` (le temps vient de `host.now()`, les fichiers de `data.disk`, la pièce de la variable `SCREEN`) ; les autres options sont celles de `BassEngineOptions`. Choix : une fonction d'assemblage hors de `engine/` plutôt qu'un défaut `render` dans le moteur, pour que la logique pure garde ses tests sans image ni son et que `engine/` reste sans dépendance vers `render/` et `audio/`.

**Fait par l'hôte du navigateur (vague J)** : `src/games/bass/ui/` (`app.ts`, `browser-host.ts`, `input.ts`, `loop.ts`, `preload.ts`, `keys.ts`, `settings.ts`, `web-music.ts`). `BassLoop` (`loop.ts`) bat à 20 ms : l'introduction (`game.intro`) puis `engine.tick()`, peint `renderer.frame` avec le curseur par-dessus (`drawCursor` sur une copie de l'image indexée), l'hôte appelle `audio.update()` à chaque image, `unlock()` au premier geste, `suspend()` / `resume()` sur l'onglet masqué (`BrowserHost.setPaused`). Le son est celui de `BassAudio` sur `WebOpl` à 50 Hz ; les voix sont lues à la demande (`voices/<id>.mp3` d'après `files.json`). Le préchargement prend `sky.dsk`, `sky.dnr`, `sky.cpt` (13,7 Mo).

## 17. Souris et interface

Code : `src/games/bass/engine/mouse.ts` (`Mouse`), `engine/game.ts` (entrées de l'hôte), `engine/mcodes/mouse.ts`, `render/cursor.ts` (`CursorOverlay`), `render/screen.ts` (`toRgbaWithCursor`) ; tests : `test/bass/engine/mouse.test.ts`, `test/bass/render/cursor-overlay.test.ts`, traces `fixtures/inventory.trace` et `fixtures/chooser.trace`, images `render/fixtures/cycles/inv-*.bin.gz`.

**Constat de lecture.** `mouse.cpp` (partie PC) et les mcodes de souris de `logic.cpp` étaient déjà portés en vague C et relus ici ligne à ligne : **aucune différence de logique**. Tout le comportement de l'interface est dans les scripts du jeu et les compacts, que `Mouse::mouseEngine` ne fait que servir : `pointerEngine` (première zone active de la liste de souris sous le pointeur, `mouseOn` / `mouseOff`), `buttonEngine1` (`mouseClick` de la zone survolée, `BUTTON` = 2 pour le gauche, 1 pour le droit), `fnAddHuman` / `fnNoHuman` (`MOUSE_STATUS` : bit 1 = pointeur, bit 2 = boutons), `fnSetStop` / `fnClearStop` (`MOUSE_STOP`). Ce qui s'ajoute : l'interface d'entrée, l'état « enfoncé » et le curseur dessiné.

**Interface d'entrée de l'hôte** (`BassEngine`, coordonnées dans l'écran de 320 × 200, avant `TOP_LEFT_X/Y`) :

| Appel | Équivalent ScummVM | Effet |
| --- | --- | --- |
| `pointerMove(x, y)` | `EVENT_MOUSEMOVE` | le pointeur de la machine (`engine.pointer`, borné à l'écran) suit tout de suite ; le jeu (`mouse.x/y`) le lit au tour suivant, sauf si `SF_MOUSE_LOCKED` |
| `pointerDown("left" \| "right")` | `EVENT_LBUTTONDOWN` / `RBUTTONDOWN` | bouton 2 (gauche) ou 1 (droit) à la position courante du pointeur ; lu une seule fois par `mouseEngine` |
| `pointerUp(button)` | `EVENT_*BUTTONUP` | relâche (`mouse.held`, lu par `waitMouseNotPressed`) ; le jeu ne lit jamais l'appui lui-même hors de ça |
| `key(key)` | `kSkyActionSkip`, `SkipLine`, `Pause` | `"Escape"` (passe l'introduction, jamais en jeu), `"."` (passe la réplique : `logicClick` pour un tour), `"p"` ; rend faux pour une autre touche (F5 : panneau, vague S) |

Les entrées de `BassHost.pollInput()` suivent le même chemin (un hôte peut utiliser l'un ou l'autre). Un clic de `pollInput` est un appui bref (pas d'état « enfoncé »). **Deux positions** : `Mouse.x/y` est celle que le jeu voit (figée pendant `fnLookAt`, qui verrouille la souris) ; `Mouse.pointerX/pointerY` est celle du pointeur de la machine, que le rendu dessine (`CursorMan`). `fnAddHuman` ramène la seconde sur la première (`warpMouse`) : après une réplique ou un regard, le curseur dessiné reprend la position du jeu jusqu'au prochain déplacement. L'hôte doit appeler `pointerUp` à la fin d'un appui, y compris à la perte du focus (sinon `held` reste vrai).

**Barre d'inventaire** : un compact de 320 × 1 (46, à `y = 136`, soit y = 0 et 1 de l'écran) lance `fnStartMenu` quand on le survole ; le pointeur n'atteint donc la barre qu'en y **0 ou 1** (`fnAddHuman` ramène `y` à 2 au minimum pour qu'un retour de réplique ne l'ouvre pas). La barre montre 11 cases (x = 28 + 24 × i, y de 0 à 24) à partir de `SCROLL_OFFSET`, complétées par des cases vides (compacts 51 et suivants) ; les flèches 47 et 48 (aux bords) font défiler (scripts de clic 15 et 16) ; elle se referme quand le pointeur la quitte (`mouseOff`). Clic gauche sur une icône : regarder (`fnLookAt`) ; clic droit : prendre l'objet en main (`OBJECT_HELD`, curseur d'objet) ; clic droit sur une zone avec un objet : l'utiliser (`fn_get_to`, `fn_interact`). Avec un objet tenu, une zone survolée donne la main ouverte (`fn_open_hand`), sinon fermée.

**Choix de dialogue** : `fnChooser` forme une ligne de texte par couple de `TEXT1…` (compacts de texte, `ST_MOUSE`, de haut en bas dans la hauteur de l'écran à partir de y = 0), met `SF_CHOOSING` (pas de sauvegarde), le joueur en `L_CHOOSE` et rend la souris. Aucun code de souris propre : le survol d'une ligne appelle `fn_highlight` (couleur de la ligne), le clic fait `THE_CHOSEN_ONE = numéro du texte` (`fn_text_kill`), `L_CHOOSE` reprend le script. `Mouse::textChooser` n'existe que pour iBASS, non porté.

**Curseur** : `Mouse` garde un numéro (`cursor`, `MOUSE_*`), son point chaud, l'image d'objet tenu (`objectCursor` = 2 × rang + ouverte, `heldCursorFile` : 60301, ou 60302 dans la section de Linc au moment de la copie). `CursorOverlay(load)` (`render/cursor.ts`) charge 60300 / 60301 / 60302 à la demande, choisit l'image d'après `Mouse` (`CursorSet.fromMouse`) et la dessine au pointeur de la machine avec la palette de l'écran (le curseur s'assombrit avec un fondu ou la pause, comme celui de ScummVM). **Jamais dans `renderer.frame`** : les images du banc n'en portent pas. Hôte :

```ts
const overlay = new CursorOverlay((id) => disk.load(id));            // une fois
const rgba = renderer.toRgbaWithCursor(overlay, engine.mouse, buffer); // à chaque image
// engine.mouse (Mouse) satisfait CursorState ; curseur masqué (MOUSE_BLANK) : rien n'est dessiné. En navigateur, masquer le curseur CSS du canvas.
```

**Toucher et souris dans le navigateur (vague J, `ui/input.ts`, `ui/app.ts`)** :
- **Tout passe par `BassHost.pollInput`** (`InputQueue`), pas par `engine.pointerDown` : le panneau, la pause et l'introduction ne lisent que cette file (une entrée mise dans la file privée du moteur resterait en attente pendant le panneau). Les boutons tenus sont recopiés dans `Mouse.held` par l'hôte (`onButtons`), que `fnLookAt` attend. Clic droit du DOM = bouton 1, gauche = 2, milieu ignoré.
- **Un clic ne part pas dans le même tour que le déplacement qui le précède** : le jeu n'agit sur une icône de l'inventaire ou un bouton que si la zone est déjà survolée (le survol est lu au tour de logique du déplacement). Constat en navigateur : déplacement et clic donnés ensemble (toucher, clic simulé) ne lançaient pas `fnLookAt`. `InputQueue` retient donc un clic qui suit de moins de `SETTLE_TICKS` (6 ticks, 120 ms) l'arrivée du pointeur à un nouvel endroit ; une souris qui survole puis clique ne subit aucun délai. L'hypothèse « un seul tour suffit » de la première spécification est corrigée.
- **Ouvrir la barre au toucher** : un toucher court dans les 12 premières lignes (`INVENTORY_TAP_LINES`) envoie `pointerMove(x, 0)` seulement ; la barre reste ouverte jusqu'au toucher suivant hors de la barre (25 lignes, `INVENTORY_BAR_HEIGHT`), qui la referme et agit dans le même geste. Exceptions (clic ordinaire) : barre déjà ouverte, choix de dialogue (`SF_CHOOSING` : la première ligne est tout en haut), panneau ou pause, pointeur verrouillé, et **zone du jeu sous le doigt** : si le point touché est sur une zone active de la liste de souris (sortie, objet, personnage), le toucher agit dessus, de sorte qu'une sortie en haut de l'écran se prend d'un seul toucher. La recherche est `Mouse.zoneAt(x, y)` (`engine/mouse.ts`), la même boucle que `pointerEngine` (écran, bit 16 de `status`, rectangle `mouseRel*` / `mouseSize*`, première zone de la liste ; lecture seule) ; le compact 46, déclencheur de la barre (`INVENTORY_TRIGGER`, lignes 0 et 1), ne compte pas comme zone. Appui long = clic droit (comportement commun de `point-click-app`). Test sur les vrais fichiers : `test/bass/ui/top-exit.test.ts` (sortie gauche de l'écran 7).
- **Bouton « Inventaire »** (barre tactile, sous l'image, à côté de Menu / Passer) : ouvre la barre comme le toucher du haut (pointeur sur la ligne 0, même état « barre ouverte par un toucher »). Grisé pendant l'introduction, un choix de dialogue, le panneau ou la pause, un pointeur verrouillé (`canOpenInventory`, `ui/input.ts`) ; fourni par `PointClickLoaded.inventory` (`ui/point-click-app.ts`).
- **Objet tenu au doigt** : le curseur de la souris n'est pas dessiné après un geste au doigt, sauf si le curseur est celui de l'objet tenu (`BassLoop.render`).
- `pointerUp` à la perte du focus et à la pause : `InputQueue.releaseAll` ; Échap, `.`, `P`, F5 par `ui/keys.ts` ; « Passer » : `skip` pendant l'introduction, `.` ensuite.

**Écarts** :
- `waitMouseNotPressed` (`fnLookAt`) attend 800 ms **et** le relâchement du bouton : `lookAtWait` (`effects.ts`) attend 40 ticks au moins et tant que `Mouse.held` est vrai ; Échap abrège (corrigé après le § 17) ;
- pendant `fnLookAt`, les entrées sont jetées (`drainInputForSkip`) alors que la souris est déjà déverrouillée par le mcode (le portage défère l'effet) : un mouvement fait pendant l'attente est perdu, comme dans ScummVM, où il est ignoré par le verrou ;
- iBASS (`mouseEngineIBASS`, `textChooser`, icônes de proximité) ignoré.

**Comparaison au banc** (`bench/scenarios/b-inv.txt`, `b-choose.txt`) :
- `inventory.trace` : deux objets dans l'inventaire (`scriptvar o0 65`, `o1 9` : variables 69 et 70), survol de y = 0 (barre : `fn_start_menu 276`, tour 36), survol de la première icône (51), clic droit (objet tenu, sans mcode, 62), survol d'une zone avec l'objet (main ouverte, 74), clic droit (utiliser : `fn_save_coods`, `fn_get_to 70`, `fn_ar`, `fn_interact`, 85) : **143 tours identiques** (CY et MC) jusqu'au tour 131 ; ensuite identiques aux mcodes de survol près : `fnAddHuman` appelle `warpMouse`, qui déplace le pointeur de la fenêtre factice du banc, donc ScummVM ne relance pas le survol de la zone alors que le portage (pointeur resté dessus) le relance. Même écart de banc que pour la réplique (§ 15) ;
- images : barre ouverte (tour 45) **identique au pixel près** (indices et palette), tour 100 identique hors du libellé du pointeur (voir ci-dessous) ;
- `chooser.trace` : **123 tours identiques** pour un choix de deux lignes (survol de la 2e, de la 1re, retour sur la 2e, clic : `fn_highlight`, `fn_text_kill`, `THE_CHOSEN_ONE = 16591`, fin du choix). **Départ synthétique** : aucun dialogue à choix n'est atteignable tôt (Joey n'arrive qu'après plusieurs écrans, les répliques de la première pièce n'ont pas de choix) ; le banc pose les lignes par `scriptvar text1…` et lance `fnChooser` par `SKY_EXEC=45:fn_chooser:0:0:0` (le compact courant est alors celui du tour précédent ; `fnChooser` ne journalise pas son appel). Les lignes, le survol et le clic sont ceux du jeu. Test du portage : même appel au même endroit du tour (rappel de `TraceRecorder.cycle`) ;
- tours de décalage : une entrée poussée après `runCycles(n)` est lue par la souris du tour dont les lignes `MC` portent le numéro `n` (le compteur monte après `mouseEngine`).

**Points ouverts** :
1. **Libellé du pointeur absent des images** (hors de ma portée, `render/sprite-engine.ts`) : l'en-tête du sprite de texte formé par le moteur de texte a `s_n_sprites = 0` (ScummVM ne le lit pas), et `spriteOf` n'accepte qu'un numéro d'image inférieur à ce nombre : le texte du pointeur, des répliques et des choix n'est pas dessiné. Mis en évidence ici : 141 pixels de différence au tour 60 du banc, tous dans la boîte du libellé. Le test d'images ignore ce rectangle (à resserrer quand le rendu sera corrigé) ;
2. (corrigé) `lookAtWait` lit `Mouse.held` ;
3. (fait en vague J) `releaseAll` à la perte du focus ; le curseur CSS du canvas est masqué par `point-click.css` (`.pc-canvas`).

## 18. Introduction et séquences

Code : `src/games/bass/engine/sequences/` (`intro.ts`, `intro-script.ts`, `intro-screen.ts`, `intro-audio.ts`), `create.ts` (option `intro`) ; tests : `test/bass/sequences/` (`intro.test.ts` sur des fichiers synthétiques, `intro-original.test.ts` sur les vrais fichiers et les captures du banc, `intro-audio.test.ts`). Référence : `intro.cpp`, `sky.cpp` (`go`, `handleKey`), `screen.cpp`, `logic.cpp` (`initScreen0`), `control.cpp` (`restartGame`) ; décision D8 (introduction du CD, passable ; celle des disquettes n'est pas portée).

**Où l'introduction se place.** Dans ScummVM, `go` joue l'introduction avant la boucle de jeu (`SkyEngine::initVirgin` au `init`, puis `Intro::doIntro`) ; ici l'hôte la fait tourner **avant** le moteur : `createBassEngine(data, host, { intro: { player } })` rend `game.intro` (`BassIntro`) ; l'hôte appelle `intro.start()`, puis `intro.tick()` toutes les 20 ms (`INTRO_TICK_MS`, comme `engine.tick()`) tant que `intro.running`, affiche `intro.canvas.frame` (`toRgba()` ; redessin quand `canvas.presented` change, comme `renderer.frame`), puis `startGameAfterIntro(engine, intro.outcome)` et la boucle normale. `intro.skip()` est appelé par le bouton « Passer » ; `pollSkip` (rempli par `createBassEngine` : `host.pollInput()`) rend vrai sur Échap ou un clic (les déplacements sont jetés).

| Module | Contenu |
| --- | --- |
| `intro-script.ts` | `_mainIntroSeq` (10 commandes : Virgin, Revolution, Gibbo) et `_cdIntroSeq` (narration : 86 voix, 28 images, 25 fondus en entrée, 24 séquences « flirt », 14 images plein écran), recopiées commande par commande de `intro.cpp` (codes `Op` de ScummVM, identifiants de `sky.dnr`) |
| `intro.ts` | `runIntro` (le générateur : `doIntro`, `nextPart`, `escDelay`), `BassIntro` (exécution tick par tick sur `SequenceRunner`, saut), `startGameAfterIntro` (départ du jeu), constantes |
| `intro-screen.ts` | `IntroScreen` (ce que l'introduction demande à l'écran) et `IntroCanvas` : `FrameBuffer` 320 × 200 + palette de travail, sur `showFullImage`, `fadeDownStep`, `fadeUpStep`, `SequenceDecoder` |
| `intro-audio.ts` | `createIntroAudio` : voix et ambiances PCM sur un `SamplePlayer`, section et musique sur `BassSound` |

**Chronologie (unité : le tick de 20 ms).** ScummVM règle toutes ses attentes sur `_relDelay`, une **échéance absolue** (`escDelay(n)` : `+= n`, puis attente par tranches de 20 ms avec `processSequence` à chaque tranche) ; les fondus ont leur boucle propre (32 pas de 20 ms, sans événements ni `processSequence`) et ajoutent 640 ms à l'échéance. Le portage garde ce modèle : `Timeline.delay(ms)` ajoute à l'échéance et attend le premier tick dont l'horloge (ticks x 20) l'atteint (au plus 19 ms de retard, **jamais cumulé** : l'échéance suivante part de l'échéance, pas de l'horloge ; test avec une voix de 1 030 ms). Valeurs : écran de Virgin 3 s + 3 s (150 + 150 ticks), fondu 32 ticks, Revolution (fondu en entrée 32, 8 s = 400 ticks), Gibbo (2 s), première voix à 19 400 ms (`PLAYVOICE` attend 200 ms), `WAITVOICE` / `DOFLIRT` / `WAITFLIRT` sondent toutes les 50 ms, une image de séquence toutes les 60 ms (`nextFrame += 60`, une image par appel de `processSequence`, donc le rattrapage après un fondu est le même). Fin de l'introduction à **300,62 s** (15 031 ticks) sur les voix d'origine.

**Voix et ambiances.** PCM 8 bits non signé, 11 025 Hz, **dans `sky.dsk`** (fichiers 59 494 à 59 672, qui y sont restés : D1 n'a retiré que les voix de 50 000 à 55 277) ; l'en-tête de 22 octets est remplacé par du silence (127, comme ScummVM) ; les ambiances (`LOADBG` puis `LOOPBG` / `PLAYBG`) sautent 256 octets au début et 768 à la fin. Elles passent par un `SamplePlayer` (la sortie d'échantillons de `BassAudio`, pour un seul contexte audio), pas par la banque de voix des répliques. Comme pour les répliques (`audio/speech.ts`), la durée ne dépend pas du son réel (`WebSampleOutput` : durée sur l'horloge) ; sans `player`, une voix « dure » octets / 11 025 Hz sur l'horloge de l'introduction.

**Saut.** Échap, clic ou « Passer » abandonnent l'introduction entière à n'importe quel point, y compris pendant un fondu (`skippable` de `src/engine/sequence.ts` autour du corps ; ScummVM n'interroge les événements que dans `escDelay`, l'état final est le même). Comme `~Intro`, `finally` arrête la séquence « flirt » et les ambiances, et la voix (ScummVM la coupe par le `_mixer->stopAll()` de `Sound::loadSection`, premier geste de `restartGame`). Issue `"skipped"` : `startGameAfterIntro` appelle `engine.startAfterIntro()` (= `Control::restartGame` : données de remise à zéro, Foster sur la passerelle, `pastIntro` vrai, écran noir et palette de la pièce). Vérifié : mêmes 838 variables, même curseur, même image qu'un moteur parti de `startAfterIntro`, pour un saut à 7 instants (écran de Virgin, fondu, flirt, voix, narration) ; l'image du jeu 2,5 s après est celle des captures `after-esc-a` / `after-esc-b` du banc.

**Fin normale.** Issue `"completed"` : `startGameAfterIntro` fait ce que `go` fait quand l'introduction n'est pas passée : `clearScreen`, puis `Logic::initScreen0` (`fnEnterSection(0)`, `startMusic(2)`, `currentMusic = 2`), **sans** `restartGame` : `pastIntro` reste faux, le script de l'écran 0 joue l'animation d'ouverture (Foster poursuivi), et Échap la passe ensuite par `restartGame` (déjà le cas dans `BassEngine.applyInput`). Vérifié : les captures 73 à 79 de `b-intro-text` (le jeu après l'introduction) sont les images du moteur à 64 ticks puis à 100 ticks d'écart.

**Comparaison au banc** (`test/bass/sequences/intro-original.test.ts`, captures `b-intro` : 60 images toutes les 2,5 s, et `b-intro-text` : 80 images de 170 à 330 s ; fixtures : 5 PNG, 3 autres déjà dans `test/bass/render/fixtures/`, et les empreintes des 140 captures, 60 Ko) :
- **7 captures comparées au pixel près (RGBA)** à des instants déduits de la liste de commandes et de la durée des voix du disque : Virgin (1 s), Revolution (10 s), Gibbo (17 s), noir (20 s), l'orateur à la fin du fondu (24 740 ms) puis après 2 et 3 images de `CD_1` (24 880, 24 940 ms) ;
- **les 59 captures de `b-intro` suivant la première** (la première est l'écran noir d'avant `initVirgin`) et **les 73 premières de `b-intro-text`** (empreinte des 64 000 indices + 240 couleurs) sont toutes produites par la chronologie, **dans l'ordre**, pour la durée entière (300 s) : aucune capture sans image correspondante. Le banc tourne en temps réel (chargement des fichiers, démarrage de ScummVM) : ses instants ne se superposent pas à la chronologie idéale (dérive de quelques secondes), d'où une comparaison par ordre et non par instant, sauf au début où la chronologie est exacte ; les 7 captures restantes sont le jeu (voir ci-dessus).

**Écarts** (en plus de ceux notés en tête des modules) :
- **200 lignes pour les images « plein écran »** (`FULLSCREEN`, 14 images) : le ScummVM du banc n'en envoie que 192 (`renderFinalFrame` ignore `fullscreen`, même régression que pour le défilement, `graphics.md`), laissant noires les 8 dernières lignes de la bande dessinée ; `IntroCanvas` montre les 200 lignes comme l'original. L'option `scummvmBottomLines` reproduit ScummVM : le test la pose pour comparer **les 140 captures** et vérifie que les deux modes ne diffèrent que sur les 8 dernières lignes (capture `i-0036`). **Décision à confirmer** (comme le défilement) ;
- l'écran de Virgin (`initVirgin` : image 60 110, palette 60 111) fait partie de `runIntro` : il est montré dès le premier tick ;
- une voix ou une ambiance absente de `sky.dnr` est ignorée (journalisée) ; une image ou une palette absente lève une erreur ;
- une nouvelle voix remplace la précédente (ScummVM les superposerait) ;
- l'introduction des disquettes (`alt_intro`, `_floppyIntroSeq`, `SCROLLFLIRT`, `COMMANDFLIRT`, `WAITMUSIC`) n'est pas portée (D8) ;
- le chargement des fichiers ne prend pas de temps.

**Fin du jeu et crédits : rien de plus que les scripts.** Aucune séquence de fin ni générique n'est codée en dehors des scripts de compacts : la fin passe par des mcodes déjà portés (`fnNewSwingSeq`, `fnFadeUp` / `fnFadeDown` / `fnDrawScreen`, modules de texte, `fnPrintCredit`). **Correction (vague K)** : elle ne se termine pas par `fnQuitToDos` : le générique (script 74, écran 85) reprend en boucle après sa dernière ligne (« Copyright 1994 Revolution Software Limited »), dans ScummVM comme ici ; seul le script 62 appelle `fn_quit_to_dos`, et le joueur quitte par le panneau ou le menu du site (§ 20). Reste `Control::showGameQuitMsg` (`sky.cpp` après la boucle : message de deux lignes sur l'image courante à moitié assombrie, puis `delay(1500)`) : c'est un écran d'au revoir de ScummVM (textes dans `control.cpp`, `_quitTexts`), qui revient au panneau de contrôle (vagues S et J) ; « Quitter » ramenant à l'écran titre (D5), il n'est pas porté ici.

**Fait par l'hôte (vague J)** : `BassAudio.samplePlayer` est l'accesseur de la sortie d'échantillons, donnée à `createBassEngine(…, { intro: {} })` ; `BassLoop` appelle `intro.start()`, `intro.tick()` toutes les 20 ms puis `startGameAfterIntro` ; `audio.update()` tourne aussi pendant l'introduction (musique 2 de la fin) ; « Passer » (bouton, Échap, clic ou toucher) saute l'introduction ; un chargement de partie pendant l'introduction la termine d'abord (`BassLoop.endIntro`). Copy du bouton : `copy.skip` / `copy.skipLabel`.

## 19. Panneau et sauvegardes

Code : `src/games/bass/engine/control/` (`layout.ts`, `panel.ts`, `display.ts`, `control.ts`), `engine/save.ts`, `engine/save-data.ts`, `ui/saves.ts`, `copy.ts` ; tests : `test/bass/control/` (`save.test.ts`, `panel.test.ts`, `harness.ts`, `fixtures/` : 7 captures du banc, 60 Ko). Référence : `control.cpp` (`doControlPanel`, `initPanel`, `handleClick`, `getYesNo`, `doMusicSlide`, `doSpeedSlide`, `toggleFx`, `toggleText`, `prepareSaveData`, `parseSaveData`, `loadSaveAllowed`, `restartGame`), `sky.cpp` (`handleKey` : F5, pause), `logic.cpp` (`fnRestoreGame`, `fnRestartGame`, `fnQuitToDos`). Les parties du remake iOS, de l'aide et de la liste de sauvegardes tapées au clavier ne sont pas portées (D5).

### Panneau (D5)

`ControlPanel` est une **séquence** (`src/engine/sequence.ts`) reprise à chaque tick de 20 ms (`ANIM_DELAY`) pendant que le jeu est figé. Il lit les sprites 60500 à 60510, la police 60520 et les textes de la section 7 (« Jouer », « Sauver Partie », « Vitesse de jeu », « Voix sans textes »…) : aucun texte nouveau pour le panneau lui-même. Boutons et curseurs aux positions de `createResource` (décalage 60, 10) :

| Élément | Comportement |
| --- | --- |
| Volume de la musique | curseur à y 59 à 91 : volume 127 en haut, 0 en bas, `(y - 59) * 4` ; appliqué en direct (`BassAudio.musicVolume`) |
| Vitesse | curseur à y 103 à 114 : `gameSpeed = (y - 103) * 12 + 2` ms, de 2 à 134, posé au relâchement ; un simple clic ramène 80 à 74 (arrondi de ScummVM) ; le moteur lance un tour tous les `gameSpeed` ms sur le pas de 20 ms de l'hôte |
| Effets | bascule `SF_FX_OFF` et `BassAudio.fxOff` ; texte d'état 86 / 87 |
| Texte / voix | texte seul → voix seule → texte et voix → texte seul (`applyTextVoiceMode` : drapeaux et `speechOn`) ; croix sur la voix et / ou le texte désactivés ; texte d'état 35 / 21 / 52 |
| Sauvegarder, Restituer | refusés pendant un choix (`loadSaveAllowed`), sinon demande à l'hôte (`requestSave`, `requestRestore`) : dialogues communs du site ; le jeu reste figé ; sauvegardée ou restituée, la partie ferme le panneau (`GAME_SAVED`, `GAME_RESTORED`), annulée elle y revient |
| Recommencer | question oui / non d'origine (cadre 60504, zones 77-114 et 156-193 de la ligne 83-110, curseur en croix), oui = `restartGame` puis fermeture |
| Quitter | même question, oui = `BaseHost.exit()` (retour à l'écran titre) |
| Jouer / Échap | ferme le panneau |

**Dessin** : image de 320 x 200 recomposée à chaque reprise (panneau, boutons, curseurs, `bodge`, croix, texte d'état, texte du bouton survolé) puis écrite dans `renderer.frame` (`display.ts` : palette 60510 dans `frame.palette`, 192 lignes dans `frame.pixels`, `presented++`) : pas de couche de superposition ni de modification de `render/screen.ts`. À l'ouverture : `clearScreen`, palette du panneau, curseur normal, police 2 ; à la fermeture : `screen.reset()` (`forceRefresh`), `setPalette(currentPalette)`, curseur et police d'avant. **Comparaison au banc** (`b-panel.txt` : F5, survol de « Jouer », deux clics sur texte / voix, effets coupés, « Restart? », réponse non) : **7 images identiques sur 320 x 200** (surface sans curseur). Un seul écart de ScummVM, non reproduit : au deuxième changement du texte d'état, `flushForRedraw` restaure 184 colonnes depuis un tampon qui n'en a sauvegardé que 146 (mémoire non initialisée) : deux colonnes du cadre (x 210-211, y 163-174) passent à 0 dans le banc ; le test les ignore.

**Écarts** : les deux questions sont dans `copy.ts` (« Recommencer ? », « Quitter la partie ? » : ScummVM les écrit en anglais dans son code, police du jeu sans accents) ; un clic seul compte même si le relâchement arrive dans le même tick (toucher) ; Échap répond « non » à une question ; le panneau ne lit les curseurs qu'avec le relâchement (`BassInput` `release`, ajouté) ; le volume de départ sans service son est 96 (celui du banc, `music_volume` par défaut de ScummVM) ; l'accès au son passe par `BassAudio.musicVolume`, `fxOff`, `speechOn` (détectés par leur forme, `engine.sound` reste un `BassSound`) ; les réglages changés partent vers l'hôte (`BassHost.settingsChanged`, `BassSettings`) pour être mémorisés, et reviennent par `GameControl.applySettings`.

### `GameControl` : ce qui fige le jeu

`GameControl` implémente `BassControl` (mcodes `fnRestoreGame`, `fnRestartGame`, `fnQuitToDos`) et pilote le panneau, la pause (`p` : `halvePalette` + `pauseFx`, une touche ou une action reprend et n'est pas transmise), les dialogues du site et les restitutions.

`tick(inputs)` est appelé **à chaque tick de 20 ms avant tout le reste** : il rend `null` si le jeu est figé (panneau ouvert, pause, dialogue de `fnRestoreGame` ouvert : le moteur n'avance alors ni son horloge ni son tour), sinon les entrées à traiter (F5 et pause retirées). F5 (`action: "panel"`) et pause ne s'ouvrent qu'entre deux tours (`isBlocked`), comme dans ScummVM où `handleKey` est au début d'un tour. `fnRestoreGame` rend la main au tour qui l'a appelé (le reste de ce tour s'exécute) avant que le jeu se fige. Annulé (écran 102, après la mort de Foster), le dialogue ne se rouvre pas de lui-même : le script 61 revient à `fnAwaitSync` et attend un nouveau clic sur l'écran de fin de partie, qui rappelle `fnRestoreGame`.

### Sauvegarde (D6)

Format JSON versionné (`SAVE_VERSION = 1`, `SaveSlots` : `bass:slot01`…`slot10`, `{ savedAt, save }`) :

```
{ version: 1, section, data: <base64>, extra: { rng, mouse: { x, y, cursor, hotspot, objectCursor }, mouseLocked, unsaved } }
```

`data` est **la sauvegarde de ScummVM, révision 6**, mot pour mot (`writeSaveWords`, `prepareSaveData`) : taille, révision, version du jeu (372), les deux effets (`_saveSounds`), la musique, la police, le curseur, la palette, les 838 variables, la liste des 60 fichiers chargés, les mots bruts des compacts de `saveIds` (854 identifiants lus dans `sky.cpt`, `_numSaveIds` de ScummVM, vérifié par `test/bass/data/cpt.test.ts`). `section` (`CUR_SECTION`) sert à la description d'un emplacement : « Section N – date » (le jeu ne nomme pas ses lieux ; noms à fournir si on en veut).

`extra` ajoute ce que ScummVM ne garde pas et qu'une reprise **exacte** demande : état du hasard (`fnRandom`), position et aspect du curseur (point chaud, objet tenu), verrou du pointeur, et `unsaved` : une soixantaine de mots de compacts **hors de `saveIds`** qui diffèrent de `sky.cpt` (animations de décor : sans eux, une reprise dans une partie neuve n'a pas la même phase d'animation et la trace diverge dès le premier tour). Écart noté : à la reprise et à « Recommencer », tous les mots hors de `saveIds` reviennent d'abord à ceux de `sky.cpt` (aucun état résiduel).

**Refus** (`saveRefusal`) : `SF_CHOOSING` (« les textes se perdraient »), LINC (`SCREEN >= 101`), dernières pièces (82 à 89 sauf 85), et tour interrompu par un effet (`busy`) ; ScummVM se tait, le site dit pourquoi (`copy.saveRefused`).

**Reprise** (`restoreSave`, avant toute modification : taille et révision vérifiées, sinon refus) : `SF_GAME_RESTORED`, effets restaurés (`BassAudio.sfx.restoreState`), `fnLeaveSection`, variables, `fnEnterSection` (musique, effets en gardant la file, grilles ; `BassSound.loadSection(section, gameRestored)`), compacts, compacts de texte remis à 0, fichiers rechargés, musique relancée (sauf `SF_MUS_OFF`), puis, au retour dans le jeu, `screen.reset()`, palette, curseur, police. Une restitution demandée pendant un effet bloquant attend la fin du tour (`pendingLoad`). Les textes à l'écran et la voix en cours ne sont pas repris (comme ScummVM) ; la grille de cheminement est rechargée par `fnEnterSection` puis reposée par chaque compact.

### Hôte et interface

`BassHost` : `requestSave()`, `requestRestore()`, `settingsChanged(settings)` (facultatifs), entrée `release`, actions `panel` (F5) et `key` (toute autre touche : reprend la pause). `ui/saves.ts` : `createSaveSlots`, `summarizeSlots`, `saveToSlot(control, …)` (`capture`), `loadFromSlot(control, …)` (`load`), `resultMessage` ; l'hôte ouvre `renderSlotDialog` avec ces fonctions et appelle `control.finishDialog()` à la fermeture. Le menu du site (sans panneau) utilise les mêmes `capture` et `load`.

### Preuve

- aller-retour **exact** (état complet puis trace `CY` / `MC` des 60 à 120 tours suivants, comparée à la partie qui n'a pas été interrompue) : au départ, **en pleine marche** (le tour 150 environ, route et collision), **pendant un dialogue** (à l'exclusion des 11 compacts de texte, effacés comme dans ScummVM) ;
- limite relevée par la partie complète (§ 20) : la grille de cheminement n'étant pas sauvegardée, une restitution recharge celle du disque ; un bloc fixe effacé pendant la partie par le `removeObjectFromWalk` d'un personnage qui s'en va revient (ScummVM : même code, rustine seulement pour la porte de Reich). L'état sauvegardé est identique, la suite peut différer de quelques tours ;
- refus pendant un choix, dans LINC, dans les dernières pièces, pendant un effet ; données illisibles ou d'une autre version = emplacement vide ; données lisibles mais de mauvaise taille refusées sans rien modifier ;
- « Recommencer » : l'état est celui d'une nouvelle partie (variables, compacts, fichiers) et la suite sur 30 tours aussi ;
- panneau : ouverture figeant le jeu (aucun tour), curseur d'avant remis, vitesse (2, 74, 134), volume, cycle texte / voix, effets, questions oui / non, quitter, sauvegarder annulé / réussi, restituer ; pause ; restitution pendant un effet ; `fnRestoreGame` ;
- **images identiques au banc** pour 7 états du panneau.

### Câblage dans le moteur

`BassEngine.control` (`GameControl`) est le service `control` de la logique ; `tick()` lui passe d'abord les entrées de l'hôte (`null` : jeu figé, ni horloge ni tour, le pointeur de la machine suit quand même) ; `parseSaveData` délègue à `applySaveWords` (`save.ts`) ; `key("F5")` ouvre le panneau, toute touche reprend la pause. `BassEngineOptions.questions` remplace les questions du panneau (le banc les pose en anglais). Fait par l'hôte du navigateur (vague J, `ui/app.ts`) : `requestSave` / `requestRestore` posent une demande, ouverte après les ticks de l'image dans les fenêtres communes (`ctx.openSave`, `ctx.openLoad`) avec `ui/saves.ts` ; à leur fermeture (`afterTicks`, qui ne tourne pas tant qu'une fenêtre est ouverte) `control.finishDialog()` rend la main au jeu ou au panneau. `settingsChanged` mémorise les réglages (`ui/settings.ts`, clé `retrovibe:bass:settings`), remis par `control.applySettings` au démarrage et au début du jeu ; le relâchement du bouton est l'entrée `release` (`InputQueue.up`). **Partie perdue (`fnRestoreGame` hors panneau)** : sans sauvegarde le jeu recommence tout de suite ; sinon fenêtre « Recommencer / Restituer une partie » (comme `chooseRestartRestore` de Lure), la restitution annulée la rouvre, la fermer recommence ; le recommencement attend la fin du tour de logique en cours (`engine.blocked`). « Quitter » du panneau (et la sortie de l'écran de mort) mène à l'écran titre du jeu (`ctx.toTitle`, D5). **Panneau** : les 6 boutons gris au centre (Restituer, Sauvegarder, Quitter, Recommencer, Effets, Texte / voix) et les curseurs sont les zones actives ; les disquettes dessinées à droite sont du décor du panneau d'origine, sans action. **Bogue corrigé en navigateur** : un clic de souris (appui et relâchement dans le même tick) doit se faire précéder d'un survol (voir § 17) ; la chaîne réelle est testée dans `test/bass/ui/panel-chain.test.ts` et `inventory-chain.test.ts`.

## 20. Partie complète (vague K)

Code : `test/bass/full-game.test.ts`, `test/bass/solution/driver.ts` (joueur), `test/bass/solution/walkthrough.ts` (solution en données). Le test passe si `original/bass/` est absent ; `BASS_FULL_GAME=0` le passe aussi.

**Ce qui est joué.** Du départ après l'introduction (Échap : `startAfterIntro`, Foster sur la passerelle) jusqu'au générique de fin, sur les vrais fichiers, avec les services par défaut (`BassTextManager`, `Grid`, `AutoRoute`, `NullScreen`, `SilentSound` : durée des répliques = lettres + 5 tours), graine 1, **sans jamais écrire l'état du jeu** : toutes les actions sont des entrées de `BassHost.pollInput` (déplacement, survol, clic gauche ou droit). **468 étapes** en 13 phases, **toutes les sections** (`CUR_SECTION` 0 à 5), 70 écrans relevés en fin d'étape (de 0 à 96, terminaux 101), **≈ 89 400 tours** (≈ 2 h de jeu à 80 ms le tour) ; dernière étape : la dernière ligne du générique (« Copyright 1994 Revolution Software Limited », écran 85). Jalons vérifiés : l'évasion, la mort de Reich, le câble soudé, le statut spécial dans LINC, le corps d'Anita, le message d'Anita (Eduardo), le métro, l'androïde dans le four, le virus, la rencontre avec Overmann, le générique ; aucune ligne de souche ni de texte manquant au journal.

| Variante | Durée (vitest) | Ce qui est vérifié |
| --- | --- | --- |
| (a) d'une traite | ≈ 1,2 s | toutes les étapes, jalons, sections 0 à 5, ≥ 80 000 tours, journal propre |
| (b) reprise après chaque étape | ≈ 5 s | après chaque étape : `GameControl.capture`, aller-retour en vrai JSON (`parseSave`), moteur neuf, `load` ; 387 reprises sur 468 étapes (les autres refusées : choix de dialogue, LINC, terminaux, dernières pièces, effet en cours) ; même fin |

**Le joueur** (`driver.ts`, tableau des étapes en tête du fichier) : les zones sont désignées par leur **nom dans `sky.cpt`** et trouvées comme `Mouse::pointerEngine` les trouve (liste de souris de l'écran, `mouseRel*` / `mouseSize*` / `xcood` / `ycood`, première zone touchée), avec un point qu'aucune zone précédente ne couvre ; **survol puis clic** (règle du § 17) ; barre d'inventaire ouverte en haut de l'écran et utilisée une fois descendue (`MENU` = 2 : avant, le clic sur une icône tombe sur le test `ycood != 136` du script 14 et ne fait rien) ; choix de dialogue par fragment du texte français (compacts de texte 23 à 33, `getToFlag`) ; terminaux de LINC par leurs touches (`button_0` … `button_9`, `cancel_button`) en attendant que chaque menu soit réécrit ; personnages qui se promènent rejoints par les sorties nommées `sc<écran>_exit_<destination>` ; LINC-SPACE (objets `blind`, `kill`, `playbak`, `decrypt`…, icône `read` = « DECONNEXION »). Le joueur « a la main » quand `MOUSE_STATUS` a ses deux bits, sans `MOUSE_STOP` ni `SF_MOUSE_LOCKED`, hors effet bloquant, Foster en logique 0, `L_SCRIPT` ou `L_WAIT_SYNC` (gros plan, terminal), ou pendant un choix.

**La solution** (`walkthrough.ts`) part d'une soluce connue du jeu, corrigée contre les scripts désassemblés (`engine/disasm.ts`) : réparer le transporteur après la suite de questions à Hobbins (`var[118]`), s'écarter avant que Joey soude le câble (un seul essai, script 8246), lire BRIEFING.DOC dans le terminal de la Sécurité (`var[342]`) pour que Mme Piermont donne rendez-vous chez elle après un premier refus (`GOT_SPONSOR` = 2), attendre Lamb bloqué devant l'ascenseur du niveau supérieur (`var[281]` = 69), monter sur le couvercle en iris pendant les 150 tours où « réduire la température » le ferme (script 20579), regarder la salle du réservoir par la grille de l'écran 68 (`var[688]`) pour que Joey propose de l'examiner. Les `note` des étapes le rappellent.

**Écarts trouvés et corrigés** :
- **table des accents** : le code 0x5F (« _ ») des textes français dessine un **« î »** (glyphe de la police 60150 : « Contrema_tre », « bo_te », « s'il vous pla_t ») ; il manquait à `data/charset.ts` (`toUnicode` rendait « _ »). Ajouté, test dans `test/bass/data/font.test.ts`. Sans effet sur l'image (le rendu dessine les glyphes), mais les textes lisibles (tests, accessibilité) étaient faux.
- **fin du jeu** : le § 18 annonçait une fin par `fnQuitToDos` ; corrigé : le générique tourne en boucle (script 74), comme dans ScummVM (`fnQuitToDos` n'est appelé que par le script 62). Le test s'arrête sur la dernière ligne du générique ; `host.exit()` n'est pas appelé.

Aucune divergence de logique du portage n'a bloqué la partie : les échecs rencontrés venaient de la solution (ordre, conditions, minutage) et se sont expliqués par les scripts du jeu. Le banc n'a pas eu à départager de divergence pendant la mise au point ; la partie entière a ensuite été rejouée dans ScummVM (ci-dessous) : identique.

**Comparaison au banc de la partie entière** (`test/bass/solution/scummvm-replay.test.ts`, outil `test/bass/solution/bench-record.test.ts`, format commun `solution/bench.ts`) :
- **entrées par tour** : le moteur signale chaque entrée appliquée au début d'un tour (`EngineTrace.input`, appelé dans `applyInput`, avant `mouseEngine`) ; la partie (a) en applique **2 572** (1 997 déplacements, 575 clics ; aucune touche), écrites `n m x y` / `n c x y bouton` (`fixtures/scummvm-inputs.txt`). Le banc les rejoue au début du même tour (`SKY_INPUT`, patch du banc dans `sky.cpp`), sans passer par les événements de la fenêtre, avec `sky-fr`, graine 1, **voix coupées et sous-titres** (comme `SilentSound`), en **temps virtuel** (`SKY_VIRTUAL_TIME` : `getMillis` n'avance que par `delayMillis` ; tours, fondus et séquences prennent leur durée nominale, la partie passe en ~20 s) ;
- **résultat : les 89 417 tours sont identiques**, du départ au générique (écran 85) : trace de niveau 1 (`CY` : écran, Foster, Joey ; 413 130 appels de mcodes avec leurs arguments, dont 6 244 `fn_random`) **et empreinte des 838 variables à chaque tour** (`VH`, `SKY_VARHASH`) : 591 964 lignes ; trace de niveau 3 hors test (opcodes et logique de chaque compact, noms de variables du banc ramenés à `var_N`) : 5 343 659 lignes identiques ; **images** de fin d'étape (465 tours distincts, `SKY_SHOT_CYCLES`) : indices et 240 couleurs identiques ;
- **seul écart trouvé, dans le banc** : sans `realmouse`, `fnAddHuman` → `warpMouse` renvoyait par la fenêtre factice un mouvement fictif à des coordonnées fausses, que le jeu lisait (premier écart au tour 708 : la barre d'inventaire s'ouvrait dans ScummVM). Le scénario du rejeu (`b-replay.txt`) ignore ces événements ; le portage n'a pas eu à être corrigé ;
- **test durable** : `scummvm-replay.test.ts` rejoue `fixtures/scummvm-inputs.txt` **sans le joueur** (le test ne dépend que du moteur, pas de la solution), écran branché, et compare à `fixtures/scummvm-checkpoints.txt` (relevé du banc, un point par fin d'étape : empreinte des lignes `CY`, `VH`, `MC` depuis le point précédent, empreinte de l'image, ligne `CY`) ; il vérifie aussi que chaque entrée est appliquée au tour relevé. Durée ≈ 10 s ; `BASS_FULL_GAME=0` le passe. Vérifié : retarder un seul clic d'un tour fait échouer le test ;
- **refaire le relevé** (si la solution change) : `BASS_BENCH_OUT=… BASS_BENCH_VARHASH=1 BASS_BENCH_FRAMES=1 npx vitest run test/bass/solution/bench-record.test.ts`, puis dans le banc `SKY_VARHASH=1 SKY_SHOT_CYCLES=<tours> SKY_SHOT_DIR=… bench/sky-replay.sh inputs.txt DOSSIER <dernier tour + 1>` et `bench/sky-checkpoints.py` (README du banc).

**Joey bloqué dans l'écran 7 avec les voix (`voices-timing.test.ts`, `it.fails`) : tranché au banc, pas d'écart du portage.** Partie à voix jusqu'à la phase 3 juste avant « Joey nous a rejoints » (étape 45), sauvegarde du portage écrite telle quelle en `SKY-VM.001` (même contenu, révision 6) et chargée par ScummVM (`--save-slot=1`, scénario `b-replay-save.txt`) ; le portage repart de la même sauvegarde dans un moteur neuf comme ScummVM (hasard neuf, souris au centre, sans voix) et joue les étapes 45 à 47 ; les 29 entrées sont rejouées dans le banc (`SKY_INPUT`). **520 tours identiques** (`CY`, `VH`, `MC`) : dans les deux, Foster va à la fente de l'ascenseur pendant que Joey marche encore vers lui, la route de Joey échoue (`fn_ar 344 264` au tour 309, puis `fn_pause`), il reste en (344, 240) en logique `L_PAUSE` et ne prend pas l'ascenseur. C'est donc un défaut de minutage de la solution (mise au point sans voix). Essai de correction (attendre que Joey ne marche plus avant la fente) : il décale le minutage de la partie sans voix et casse la phase 6 (Mme Piermont, réplique « SPONSOR ») ; retiré, l'`it.fails` reste.

**Constat sur les reprises (comme ScummVM, non corrigé)** : la grille de cheminement n'est pas sauvegardée ; une restitution la recharge du disque (`fnEnterSection` → `loadGrids`). Or `Logic::engine` efface puis repose à chaque tour l'empreinte des compacts `ST_GRID_PLOT` sans compter les recouvrements : quand un personnage quitte une case déjà bloquée sur le disque, `removeObjectFromWalk` efface aussi ce bloc fixe. Exemple trouvé en (b) : le vieil homme de la salle des générateurs (compact 136, `monitor`) efface l'octet 84 de la grille de l'écran 18 en partant ; après une reprise, le bloc revient, la route de Foster change et la partie reprise prend quelques tours d'écart. ScummVM a le même code (`grid.cpp` : `loadGrids` recharge tout, avec une seule rustine, la porte de Reich). L'état sauvegardé, lui, est identique (vérifié étape par étape jusqu'à ce point). Conséquence pour la solution : une étape qui dépend du minutage est rejouée tant que son résultat manque (`retry` : prendre l'ancre quand Joey s'est écarté), comme un joueur qui recommence.

**Outils de mise au point** (hors dépôt, dans le scratchpad de la session) : exécution directe sous Node (chargeur `rolldown/experimental` `transformSync`) des étapes avec la liste des zones à chaque écran, désassemblage d'un compact (`mouseClick`, `actionScript`, `baseSub`), recherche d'un texte français et des scripts qui le poussent, des écritures d'une variable, comparaison étape par étape d'une partie d'une traite et d'une partie reprise (empreinte de `test/bass/control/harness.ts`, traces `MC`).

**Reste** :
- la partie n'est jouée qu'avec la graine 1 et sans voix (`SilentSound`) : avec les voix MP3, la durée des répliques change (§ 15) et le minutage aussi ; non vérifié ;
- les morts de Foster (coup de feu du garde au départ, androïde Walter) ne sont pas jouées volontairement : l'écran « Recommencer / Charger partie » (écran 102) a été vu une fois pendant la mise au point (androïde avant le piège du four) ;
- la revue fonctionnelle et visuelle de la vague K (navigateur) et le README restent à faire.
