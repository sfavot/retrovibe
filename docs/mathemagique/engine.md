# MATH.EXE : cadre global du moteur (rétro-ingénierie)

Tâche T5. Ce document décrit le fonctionnement global de `MATH` (Math Workshop MPC, Brøderbund, v1.01, 1994, NE Windows 3.x 16 bits) : démarrage, machine à scènes, correspondance activités / archives, format des scripts d'animation `\0SCR`, rendu, entrées, audio, persistance, interface commune. Il s'appuie sur la décompilation Ghidra de [re-index.md](re-index.md) (`archives/mathemagique/re/MATH/`) et sur un désassemblage complémentaire (voir §0). Les formats d'archive sont dans [formats.md](formats.md) ; le pixel format des `SHAP` et la palette sont dans [shap.md](shap.md), la grammaire des `\0SCR` dans [scr.md](scr.md). Ce document est le **cadre global** : les études détaillées plus récentes (liste ci-dessous) font foi quand elles sont plus précises, et ce document les résume et y renvoie.

Les adresses sont des `sélecteur:offset` de Ghidra (sélecteur du segment n = `0x1000 + 8 × (n - 1)`, segment de données `1108` = segment 34). Un fait sans mention est lu dans le code ; **hypothèse** marque une déduction non vérifiée.

## Documents détaillés

- [scr.md](scr.md) : grammaire, cellules, chronologie et résolution `SCR` → `SHPL` / `SNDL` des scripts d'animation (§3).
- [shap.md](shap.md) : format des `SHAP` (LZ + RLE), blitters, `SHPL` et palette, `tBMP` / `tPAL` (§3.8, §4.3, §4.4).
- [formats.md](formats.md) : formats des archives Mohawk et des ressources.
- [re-index.md](re-index.md) : index de la décompilation, amorçage des fonctions et table des 11 scènes (§0.1, §1.4).
- [screens/common.md](screens/common.md) : titre, hub / Control Room, connexion / préférences / roster, séquences secrètes et Math Trivia, crédits, Hall of Fame, sortie (§1.4, §1.5, §6, §7, §8).
- [screens/bowling.md](screens/bowling.md) : Bowling for Numbers (règles, progression, rang, ressources).
- [screens/rhythm.md](screens/rhythm.md) : Rhythm Shop (fractions, `PLST` / `STLV`, moteur musical).
- [screens/hidden.md](screens/hidden.md) : Hidden Picture Puzzles.
- [screens/patterns.md](screens/patterns.md) : Puzzle Patterns.
- [screens/sticklers.md](screens/sticklers.md) : Super Sticklers.
- [screens/pattern-windows.md](screens/pattern-windows.md) : Pattern Windows.
- [screens/rockets.md](screens/rockets.md) : Rockets (Nim contre Poly).

## 0. Conventions et pièges de lecture

1. **Fonctions de scène absentes de la décompilation : corrigé.** Treize handlers de scène (les `Enter` de 9 scènes, le `Leave` `1078:01eb` et les `Exit` `1030:0364`, `1040:0422`, `1070:1131`) n'étaient pas des fonctions Ghidra, car ils ne sont appelés que par pointeur lointain. Ils existent maintenant dans le corpus (`SeedFunctions.java`) et les 48 handlers non nuls des 11 scènes sont nommés `scene_<scène>_<enter|leave|tick|exit|key>` : voir [re-index.md](re-index.md), section « Amorçage des fonctions » (table des scènes reprise au §1.4). Les noms `bowling.dat`, `hidden.dat`, `patterns.dat`, `stickler.dat`, `PatFill.DAT`, `Nim.DAT`, `credits.dat`, `trophy.dat` ont donc maintenant leur `Enter` dans le re-index. Les adresses des §1.4 et §2 avaient été relevées par un désassembleur x86 16 bits maison appliqué au NE avec ses relocations ; re-index.md les recoupe (13 fonctions créées « vérifiées une à une », adresses identiques).
2. **Tag `\0SCR` et non `'SCR '`.** Le tag des scripts d'animation est `0x00534352` (`\0SCR`, comme `\0SND` = `0x00534e44`), vu dans le code en `0x534352` (`1090:140f`, `1018:0a04`). L'export de tags du re-index cherchait `'SCR '` avec une espace : d'où « jamais référencé ». De même, `"LPHSLDNS"` (`1108:0b60`) n'est pas un format : ce sont les tags `SHPL` et `SNDL` stockés en dwords petit-boutiste (`0x0b60` = `'LPHS'`, `0x0b64` = `'LDNS'`), passés à `1018:0a87` (préchargement).
3. **Faux positifs du re-index.** `mainscrn.dat` « référencé » par `10d8:38e8/6d22/6db9` et `milkyway.dat` par `1010:3adc`, `1040:1692`, `1048:192e`, `1070:1778/1d25`, `1090:0094` sont des coïncidences de constantes : `0x10d8` est le sélecteur de segment `10d8` poussé avant des appels, `0x236` est l'offset du tableau de hooks dans l'objet animation (`mov es:[bx+0x236], <offset de fonction>`, ex. `1010:3b66`). Les vraies ouvertures sont au §2.
4. **Objets C++ à vtables.** Les gestionnaires (ports graphiques `10d8`, périphériques audio `10d0`, gadgets `10a0`) sont des classes Borland C++ : leurs méthodes n'ont aucun appelant direct (`CALLF [BX+n]`). Les tables de méthodes sont dans le segment de données (§1.6).
5. Le décompilateur perd souvent les arguments (`FUN_1050_03fa`, `FUN_1088_0b49`…) : les valeurs données ici viennent de `disasm.txt` ou de mon désassemblage.

## 1. Démarrage et enchaînement des écrans

### 1.1 Séquence de `WinMain` (`1008:0000`)

`1000:0000` (`entry`) : `INITTASK`, `WAITEVENT`, `INITAPP`, mémorise `hInstance`/`hPrevInstance`/ligne de commande dans `1108:0016`–`1108:001e`, efface le BSS, appelle les initialiseurs C (`1000:00de`), puis `1008:0000`, puis `1000:5666` (sortie). Dans `1008:0000`, dans l'ordre :

| # | Adresse | Action |
|---|---|---|
| 1 | `1008:0000` | copie les paramètres dans `1108:8750`–`8758` ; `1000:550c` (init runtime) ; **quitte si le 3e paramètre est non nul** (hypothèse : instance précédente → une seule instance) |
| 2 | `1008:0000` | `GETWINFLAGS` & `0x20` (mode étendu 386) sinon boîte « Program requires Windows to run in enhanced mode. » (`1098:026b`, titre `EXIT`) |
| 3 | `1088:104c(1008:0402)` | enregistre le **rappel d'inactivité** `1008:0402` dans `1108:3352` (appelle le `Tick` de la scène courante, §1.3) |
| 4 | `1088:0e54(1008:02f3)`, `1088:0e63(1098:026b)` | crochets de sortie : `32e6` = nettoyage avant sortie (`1008:02f3` : retire le rappel d'inactivité, restaure l'archive, libère la musique de transition, arrête les sons) et `32ea` = affichage du message d'erreur fatale (`MessageBox`, titre `EXIT`) ; `1098:0d40(1078:0000)` et `1098:0d1a(1008:06c1)` posent deux rappels de la procédure de fenêtre (`345a`, appelé à l'activation ; `345e`, usage non établi) |
| 5 | `1000:17bb` | gestionnaire d'OS Mohawk (« MOHAWK OS Manager » : classe de fenêtre, timer, hook) ; message `unable to initialize OS manager` |
| 6 | `1088:0f8e(60)` | **gestionnaire de timer** : `timeSetEvent` périodique de `(60 + 999) / 60 = 17 ms` ; callback `1088:1021` incrémente le tick global `1108:8722` (32 bits) tant que l'appli est active (`1108:3458`) et décrémente 4 compteurs `1108:871a`–`8721` (§4.6) |
| 7 | `1000:32e9`, `1000:3aba`, `1000:2d5c` | tas (`unable to initialize heap`) ; exige ≥ `0x189c40` octets libres (≈ 1,54 Mo) sinon `Not enough free memory` |
| 8 | `10b8:1738`, `10c0:3116` | gestionnaire de fichiers bas niveau (DOS via DPMI, `GlobalDosAlloc`) ; gestionnaire de ressources Mohawk (`unable to initialize resource manager`) |
| 9 | `10c8:073e` | **configuration** : ouvre `MOHAWK.INI` (répertoire Windows) ; s'il manque, le crée en copiant `MOHAWK.WIN` (modèle livré sur le disque) ; `unable to initialize configuration file manager` |
| 10 | `10d0:03e3` | **son** : énumère `WAVEOUT*`/`MIDIOUT*`, lit la section `[Audio]` de `MOHAWK.INI` (`DefaultWaveDevice`, `DefaultMidiDevice`, `fCacheDefaultMidiDevice`), charge `MIDIMAP.DAT` (`10d0:1a78`) ; `unable to initialize sound` |
| 11 | `10a8:1330` → `1098:06c6` | calcule le répertoire de l'exécutable (`path too long: limit %d characters`) |
| 12 | `1078:0019` | lit `math.cfg` (clé `INSTALLFROMDIR`, §7.3), normalise le chemin (`10a8:08aa`), y ajoute `milkyway.dat` et **vérifie qu'il existe** ; sinon fatal `Math Workshop CD must be inserted in drive %c` |
| 13 | `10a8:0b1d(0x1b0, 0x240)` | **initialisation graphique** : hauteur 432, largeur 576 (§4.1) ; vérifie le mode d'écran (`1098:0000`) ; crée la fenêtre (titre « Math Workshop MPC », `1108:0224`), la palette, le port d'écran et le « work port » |
| 14 | `10a8:0a87` ×2, `10d8:9c75` | charge les polices `NCSclB10` (`4a10`) et `NCSclB12` (`4a14`) |
| 15 | `10a8:0936("milkyway.dat")` | ouvre l'archive système ; `10a8:0430` charge `CURS` 1 (sablier) → `4b38`, `CURS` 2 (point d'interrogation) → `4b3a`, et le son « transition music » (`\0SND` 65000, un MIDI) → `4a24` (verrouillé par `10a8:0a51`) |
| 16 | `1008:0471` | **enregistre les structures de sauvegarde** de chaque scène et dimensionne le tampon de roster (§7.1) ; fatal `Old Roster File must be deleted!` si le premier mot du fichier ≠ `0x20` |
| 17 | `1008:0000` fin | `1108:1b20 = 8` (**scène suivante = écran titre**), puis boucle `while (1008:053a()) 1088:105b();` |

Code mort : `1008:0521` et `1078:0012` sont des fonctions vides ; le code copie `1108:4a2c` (chemin du roster, vide) puis y ajoute `"MWSite"` (`1108:0101`) sans jamais l'utiliser (hypothèse : reliquat d'une gestion de « site » réseau).

### 1.2 Prérequis vérifiés au démarrage

- Mode d'écran : `1098:0000` demande `10d8:94df` pour **640 × 480 × 256 couleurs** (`0x280`, `0x1e0`, `0x100`) ; échec → « This program requires an SVGA card set to 256 colors and a minimum resolution of 640 x 480 » ; un second test avec « 1000 » couleurs doit au contraire échouer (le jeu refuse un affichage en hautes couleurs ; hypothèse sur le sens exact de `10d8:94df`, qui compare le mode courant aux paramètres `{largeur, hauteur, couleurs}`).
- CD : seul le fichier `milkyway.dat` est testé, dans `INSTALLFROMDIR` (le CD, ou une copie disque). Les autres archives sont ouvertes à la demande (§2) ; si elles manquent, le fichier manager remonte une erreur fatale (`unable to open %s`, `10a8:0936`).
- Le jeu n'a **aucune vidéo d'introduction** : l'écran titre démarre directement (§1.4). Le Guide vidéo des parents est un programme distinct (§8.7).

### 1.3 Boucle principale

```
while (1008:053a() != 0) 1088:105b();          // 1008:0000
```

- `1008:053a` (une itération) : si une scène est demandée (`1b20 ≠ -1`) → `1038:0000` (commutation, §1.4) ; lit la position souris (`1098:039b`, `GETCURSORPOS`) ; si le curseur est en mode « attente » (`1108:4b3c == 1`) la boucle ne traite pas les messages (revient au curseur normal 3 ticks après la dernière activité) ; sinon `1098:02f3` (`PEEKMESSAGE`/`TRANSLATEMESSAGE`/`DISPATCHMESSAGE`, renvoie 1 pour une touche, 2 pour un clic) ; **sans message** → `10a0:001b` (gestionnaire de gadgets : survol, boutons, §5.2).
- `1088:105b` (« laisser respirer Windows », appelée depuis 20 endroits, dont chaque boucle d'attente et `10a8:0430`) : `1098:08dc` (vide la file puis traite 1 message + les `WM_PAINT`), puis, si l'appli est active, le **rappel `1108:3352` = `1008:0402`**, qui sélectionne le work port (`DAT_8bd6`, `10d8:9fa3`) puis appelle le `Tick` (`descripteur + 8`) de la scène courante.
- Un second pump existe dans la boîte d'impression `10d8:38e8` (§4.8).
- Curseur : `1008:063b(n)` change le mode (0 flèche système, 1 sablier = `CURS` 1, 2 point d'interrogation = `CURS` 2) ; `1008:0620` = « occupé » (mode 1), `1008:0618` = retour au mode 0. Les activités appellent `1008:0620` avant tout chargement.
- Pas de `WM_TIMER` ni de `WM_MOUSEMOVE` : la souris est **interrogée** (`GETCURSORPOS`), le temps vient du tick `1108:8722`.

### 1.4 Machine à scènes

Deux variables : `1108:1b1e` = scène courante, `1108:1b20` = scène demandée (`-1` = aucune). `1038:0000` (appelée en tête de `1008:053a`) : si `1b20 ≠ -1`, `1b1e = 1b20`, `1b20 = -1`, puis appelle `Enter` du descripteur de la scène (`CALLF [BX]`). **C'est le seul changement de scène** : toute fonction qui écrit `1b20` (grep `[0x1b20]` : `1008:02bc`, `1010:3fd8`, `1020:0d68`, `1028:176c`, `1030:038f`, `1040:044d`, `1048:0450`, `1060:0d5e`, `1068:0700/0708`, `1078:0484/0701`) demande une transition ; elle prend effet au tour de boucle suivant.

La table des scènes est à `1108:1b22` (11 pointeurs lointains, bornés par `1008:0471`). Chaque entrée pointe un **descripteur** dont les champs sont des pointeurs lointains :

| Offset | Rôle | Appelé par |
|---|---|---|
| `+0x00` | `Enter` : ouvre le `.DAT`, construit l'écran, fondu d'entrée | `1038:0000` |
| `+0x04` | `Leave` : libère les ressources (SHPL, SNDL, ports), restaure l'archive précédente | la scène elle-même (au moment de la sortie) |
| `+0x08` | `Tick` : logique d'inactivité de la scène (animations, minuteries, IA) | rappel `1008:0402` à chaque `1088:105b` |
| `+0x0c` | `Exit` : fondu de sortie + `Leave` + `1b20 = 0` (retour au hub) ; nul pour titre, crédits, hub, bowling | boutons « sortie » de la scène |
| `+0x10` | `Key(touche)` : renvoie ≠ 0 si la touche est consommée | `1008:0859` (§5.3) |
| `+0x14` | pointeur vers la **définition des variables sauvegardées** (§7.1) ; nul si rien à sauver | `1008:0471` |
| `+0x18…` | données de la scène (par ex. `+0x18` = u32 `10800` pour le bowling : durée de partie par défaut en **ticks**, soit 180 s, écrite dans l'en-tête du roster, §7.1) | |

Table complète (adresses `sélecteur:offset`). Les fonctions sont nommées `scene_<scène>_<handler>` dans le corpus Ghidra (colonne « Nom ») ; les adresses sont celles de la table `1108:1b22` lue par `SeedFunctions.java` et coïncident avec le désassemblage d'origine ([re-index.md](re-index.md), « Les 11 scènes et leurs handlers ») :

| # | Descripteur (DS) | Segment | Scène | Nom (`scene_<nom>_*`) | `Enter` | `Leave` | `Tick` | `Exit` | `Key` | Sauvegarde |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `0c0e` | `1020` | Hub / Control Room (`MAINSCRN.DAT`) | `hub` | `1020:0000` | `1020:0584` | `1020:06f6` | – | `1020:11b0` | 1 var |
| 1 | `031a` | `1010` | Bowling for Numbers (`BOWLING.DAT`) | `bowling` | `1010:0000` | `1010:03a3` | `1010:05d1` | – (`1010:3fa3`) | `1010:2b64` | 4 vars |
| 2 | `151a` | `1028` | Rhythm Shop (`RHYTHM.DAT`) | `rhythm` | `1028:0f99` | `1028:13f7` | `1028:15cd` | `1028:173a` | `1028:2de2` | 3 vars |
| 3 | `2134` | `1060` | Pattern Windows (`PatFill.DAT`) | `patwin` | `1060:06f4` | `1060:0a8e` | `1060:0bb0` | `1060:0d22` | `1060:1786` | 5 vars |
| 4 | `197c` | `1030` | Hidden Picture Puzzles (`hidden.dat`) | `hidden` | `1030:0000` | `1030:0142` | `1030:02ab` | `1030:0364` | `1030:1ef2` | 1 var |
| 5 | `1c04` | `1040` | Puzzle Patterns (`patterns.dat`) | `patterns` | `1040:0000` | `1040:012f` | `1040:0298` | `1040:0422` | `1040:1678` | 1 var |
| 6 | `1d50` | `1048` | Super Sticklers (`stickler.dat`) | `sticklers` | `1048:0000` | `1048:0155` | `1048:02be` | `1048:0422` | `1048:1914` | 1 var |
| 7 | `2838` | `1070` | Rockets (`Nim.DAT`) | `rockets` | `1070:0a37` | `1070:0e7d` | `1070:102d` | `1070:1131` | `1070:2045` | 1 var |
| 8 | `26a0` | `1068` | Écran titre (`title.dat`) | `title` | `1068:0364` | `1068:0505` | `1068:05af` | – | – | – |
| 9 | `2b8a` | `1078` | Crédits (`credits.dat`) | `credits` | `1078:00e4` | `1078:01eb` | `1078:024a` | – | – | – |
| 10 | `2c24` | `1078` | Hall of Fame / trophée (`trophy.dat`) | `trophy` | `1078:0523` | `1078:0635` | `1078:06a8` | `1078:06d9` | – | – |

Les index 0 à 10 sont ceux de `1b20`. Écran affiché en premier : `1b20 = 8`, donc **le titre** (`1068:0364`). Détail dans [screens/common.md](screens/common.md) §1. Déroulé de `1068:0364` : ouvre `title.dat` ; **seulement au démarrage du programme** (pas au retour des crédits), charge `SHPL` 200 (265 × 119, « Brøderbund PRESENTS », dessinée en (155, 140)) avec fondu d'entrée de la palette (`1088:1b25`) et arme le compte à rebours `871a = 300` ticks ; charge le fond plein écran `SHPL` 105 (576 × 432, `1018:0000(5)`), 10 animations `\0SCR` (`1000`–`5000` par 500 et `10000`), le son `1000` (musique de 17,4 s, bouclée) ; l'attente d'un clic/une touche ou de la fin du compte à rebours (`1088:1091`) ne vaut que pour ce **logo** de première entrée (sans logo, elle rend la main tout de suite) ; fondu vers le titre. L'animation `500` est une **horloge** : `1068:0785` lit l'heure (`1098:0660`) et saute à l'image `heure×12 + minute/5 + 1` (`1090:0432`, voir §3.5) ; elle est dessinée une fois dans le décor, pas animée. `Tick` (`1068:05af`) fait boucler les animations du décor ; la porte (`SCR` 10000, jouée jusqu'au bout) ne part qu'au clic ou à la fin de la musique (`1068:06d3(1)`).

### 1.5 Graphe des transitions

```
démarrage ──► 8 titre ──(clic sur la porte ou fin de musique : 1068:06d3(1))──► 0 hub
                  │ └─(plaque en bas à gauche : 1068:06d3(2))─► 9 crédits ──(1078:0484)──► 8 titre
0 hub ──(clic sur une zone : 1020:098a → 1b20 = DI, 1020:0d68)──► 1 bowling | 2 rhythm | 3 patfill
                                                                   | 4 hidden | 5 patterns | 6 stickler | 7 nim
2–7 ──(Exit +0x0c : fondu, Leave, 1b20 = 0)──► 0 hub
1 bowling ──(1010:0934 après une animation de Gus : 1010:3fa3(0))──► 0 hub
1 bowling ──(zone « trophée » : 1010:0bc5(2) → 1010:3fa3(10))──► 10 trophée ──(1078:06d9)──► 1 bowling
```

Le hub a **deux tables de rectangles distinctes** ([screens/common.md](screens/common.md) §0 point 2, §2.4, §11) : les **clics** passent par 14 + 3 + 9 enregistrements de gadgets de 20 octets (`DS:0c70` décor, `0d98` pupitre, `0e20` « jouets », rappels `1020:098a`, `0e7b`, `172e`), tandis que les 15 `RECT` de `1108:1050` sont la table de **survol / aide** (`1020:11e5`, mode « ? »). Leurs rectangles et leurs indices diffèrent (le dôme est découpé en 4 tranches d'ids 2–5 dans la table de clic, 6–9 dans la table de survol).

Table du clic du hub (`1020:098a`, argument = indice de l'enregistrement de `DS:0c70`) : 1 = sifflet de fin de journée (actif seulement pendant l'invite « quitter », §8.5), 2–5 (verrière) → scène 3 (Pattern Windows ; fenêtres de vitrail), 6 (chevalet) → 6 (Super Sticklers), 7 (engrenage) → 2 (Rhythm Shop), 8 (étagère) → 7 (Rockets), 9 (cadre au papillon) → 5 (Puzzle Patterns), 10 (rideau aux quilles) → 1 (Bowling), 11 (télévision) → 4 (Hidden Pictures), 12 et 13 (**Poly, tête et corps**) → `1020:10e2(0x10004)` = `1080:0000` en **mode 4**, soit **Math Trivia** (§7.4, pas un écran secret ; les séquences secrètes n'y servent qu'à afficher des photos), 14 = plein écran (désactivé sauf pendant l'invite « quitter »). Dans la table de survol (`DS:1050`), les zones 1–2 sont Poly, 3–5 les trois boutons du pupitre, 14 le rideau (Bowling) et 15 la télé. Chaque départ joue d'abord une animation du hub (`1090:0ff9`) dont l'id de son est posé dans `1108:0f82` (ex. `9100`, `9200`, `9300`, `9000`, `1000`, `8900`, `1200`).

### 1.6 Autres tables de pointeurs de fonctions du segment de données

Relevées à partir des relocations du segment `1108` (691 pointeurs lointains dont 429 vers du code). Hors descripteurs de scène :

| DS | Cibles | Rôle |
|---|---|---|
| `08c4`–`08f4` | `1010:0959`, `1010:09a4`, `1010:0a70`, `1010:0b5d`, `1010:0bc5`, `1080:1192` | rappels des **groupes de boutons** du bowling (réponses, sortie, aide, trophée…) |
| `0b40`–`0b5c` | 8 pointeurs vers les chaînes `main`, `bowling`, `hidden pictures`, `puzzle patterns`, `sticklers`, `title`, `credits`, `trophy` | noms des 8 fonds plein écran `SHPL` `100 + k` (§2.4), utilisés par `1018:0000` pour les messages d'erreur |
| `0eec`–`0f10` | `1020:098a`, `1020:0e7b`, `1080:1192`, `1020:172e` | rappels du hub (clic sur zone, saisie) |
| `196c`–`1978` | `1030:0857`, `1030:0396`, `1030:0490`, `1030:0577` | rappels de boutons de Hidden Pictures |
| `1bf4`–`1c00` | `1040:0949`, `1040:0454`, `1040:0543`, `1040:066f` | idem, Puzzle Patterns |
| `1d40`–`1d4c` | `1048:0965`, `1048:0458`, `1048:0556`, `1048:0684` | idem, Super Sticklers |
| `24a6`–`24ca` | `1060:0000`, `1060:008a`, `1060:03d5`, `1080:1192` | rappels de Pattern Windows (impression : `1060:008a`) |
| `2596`–`263e`, `269c` | `1068:0000/0040/007a/0016/0053/008c/002c/0066/009e` (petits thunks vers `1068:00b2`/`015a`/`0203`), `1068:06d3` | **boutons du titre** : états survol/appui/relâché, puis rappel de clic `1068:06d3` |
| `2acc`–`2ae4` | `1070:0000`, `1070:0105`, `1070:01c2` | rappels de Rockets (groupe A = Reset / Help / Exit, B = Poly / ami, C = zones de jeu : [screens/rockets.md](screens/rockets.md) §2.3) |
| `2c3c`–`2c54`, `2d16`, `2d22` | `1078:0c89`, `0ca7`, `0cc2`, `0cd4`, `1078:0709`, `1078:0829` | Hall of Fame : page précédente/suivante, certificat, sortie |
| `316c` | `1088:0e3a`, `1088:0e48` | curseur « interrogation » / retour |
| `353e`–`3682` | `10a0:15ae`, `1609`, `1623`, `1bcc`, `1be2`, `1bf8`, `1c0c`, `1c1f`, `1c32`, `1c46`, `1c58`, `1c6a` | vtables des **gadgets** (3 familles de boutons × états) |
| `3bdc`–`3d6a` | `10d0:0b7c`, `0c80`, `0d19`…`4481`, `1000:5a26` (méthode virtuelle pure) | vtables des classes **périphérique audio** (WAVE, MIDI) |
| `3c95`–`4340` | `10d8:02f3` … `10d8:ac83` | vtables de la hiérarchie de **ports graphiques** : classe de base (`3c95`), `DIB.DRV` (`3e16`), `DISPLAY` (`3f5e`), polices (`412c`), pilote d'imprimante (`41bf`, `4276`), WinG (`4324`) (assignation par les chaînes voisines : hypothèse) |

## 2. Activités ↔ archives

### 2.1 Carte définitive

« Nature » = ce que fait réellement l'activité, d'après les études détaillées (aucune n'est un exercice de calcul classique sauf le Bowling). « Progression » = ce que la scène écrit dans le roster (§7.1) ; **seul le Bowling écrit le masque de réussites** (Rhythm Shop, Hidden, Patterns, Sticklers, Pattern Windows et Rockets n'en écrivent aucun bit et n'apparaissent pas dans le Hall of Fame).

| Activité (manuel Deluxe) | Scène | Segment | `.DAT` principal | Autres archives ouvertes par la scène | Nature (confirmée) | Progression | Remarque |
|---|---|---|---|---|---|---|---|
| Control Room (hub, sélection, Poly) | 0 | `1020` | `MAINSCRN.DAT` (`1020:01ad`) | – | hub à un seul écran ; connexion, préférences, Math Trivia | drapeau « introduction longue de Poly vue » (`4fa4`) | `MAINSCRN` = hub |
| **Bowling for Numbers** (+, −, ×, ÷, équivalence, estimation) | 1 | `1010` | `BOWLING.DAT` (`1010:000d`) | `GUS.DAT` (`1010:44ef`, `1010:457a`), `POLLY.DAT` (`1010:4363`), `TROPHY.DAT` via scène 10 | quiz d'arithmétique à choix multiple (4 réponses, 10 bonnes = 1 strike) | **masque de réussites** (30 bits) + niveau, strikes et sous-type par opération ; rang 1 à 25 | 6 opérations × 4 niveaux + bonus ([screens/bowling.md](screens/bowling.md)) |
| **Rhythm Shop** | 2 | `1028` (+ `1058`, `1038`) | `RHYTHM.DAT` (`1028:10c8`) | `MidiMPC.DAT` (`1028:10bb`), `RSHELP.DAT` (`1028:10df`) | fractions / mesures : reconstituer la mesure d'un morceau avec Cutter, Gluer, Melder | niveau courant et compteur de variante (0–3) par morceau, drapeau d'aide ; pas de masque | aide = `RSHELP` ([screens/rhythm.md](screens/rhythm.md)) |
| **Pattern Windows** (vitrail) | 3 | `1060` | `PatFill.DAT` (`1060:079e`) | – | coloriage de vitrail (10 motifs, 15 couleurs) ; ni énigme ni score | aucune progression ; sauvegarde des 3 peintures par motif (vitrail) | `PATFILL` = Pattern Windows ✔ ([screens/pattern-windows.md](screens/pattern-windows.md)) |
| **Hidden Picture Puzzles** | 4 | `1030` | `hidden.dat` (`1030:000d`) | `POLLY.DAT` (`1030:1f86`) | puzzle de polyominos (jigsaw) qui révèle une photo | aucune (drapeau « Poly a présenté le jeu » seul) | ✔ ([screens/hidden.md](screens/hidden.md)) |
| **Puzzle Patterns** | 5 | `1040` | `patterns.dat` (`1040:000d`) | `POLLY.DAT` (`1040:17c7`) | puzzle de dominos (8 pièces de 2 cases, grille 4 × 4) | aucune (même drapeau Poly) | ✔ ([screens/patterns.md](screens/patterns.md)) |
| **Super Sticklers** | 6 | `1048` | `stickler.dat` (`1048:000d`) | `POLLY.DAT` (`1048:19f4`) | puzzle de lignes (fragments de dessin au trait à glisser sur un gabarit) | aucune (même drapeau Poly) | ✔ ([screens/sticklers.md](screens/sticklers.md)) |
| **Rockets** (jeu de Nim) | 7 | `1070` | `Nim.DAT` (`1070:0afb`) | – | Nim contre Poly (IA à niveau caché) ou contre un ami | aucune (drapeau « introduction d'aide jouée » seul) | `NIM` = **Rockets**, pas Boiler Room ([screens/rockets.md](screens/rockets.md)) |
| Écran titre | 8 | `1068` | `title.dat` (`1068:037c`) | – | – | – | |
| Crédits | 9 | `1078` | `credits.dat` (`1078:00ee`) | – | – | – | |
| Hall of Fame / certificats | 10 | `1078` | `trophy.dat` (`1078:0535`) | – | lit le masque du Bowling ; imprime les certificats | lecture seule du masque | accessible uniquement depuis le Bowling |
| Boiler Room | – | – | – | – | – | – | **absente de la v1** (aucun segment, `.DAT` ni chaîne ; le hub n'a qu'un étage et trois boutons de pupitre, [screens/common.md](screens/common.md) §9 ; ajout du manuel Deluxe v2) |

Archives non-scènes : `MILKYWAY.DAT` = ressources système (2 curseurs + 2 MIDI : `65000` « transition music », `65001`), ouverte au démarrage (`1008:0000`) et testée comme sentinelle du CD (`1078:0019`) — **ce n'est pas Rockets** ; `POLLY.DAT` = animations de Poly (aide, §8.2) ; `GUS.DAT` = animations de Gus (bowling uniquement, §8.3) ; `RSHELP.DAT` = aide du Rhythm Shop ; `MIDIMPC.DAT` = 45 morceaux MIDI du Rhythm Shop (ids 101…) ; `MIDIMAP.DAT` (`SYSX` id 1, 192 octets) = 64 messages MIDI d'initialisation des 16 canaux, envoyés à l'ouverture de la sortie MIDI (`10d0:1a78`, [screens/rhythm.md](screens/rhythm.md) §2.4) ; `SYSTEM.DAT` (`RSFL`, 2 octets) : **jamais référencé** par `MATH`.

### 2.2 Comment les archives sont ouvertes

- Chaque `Enter` appelle `10a8:0936(nom, &handle)` (ouverture, résolue dans `INSTALLFROMDIR`, casse indifférente) puis `10a8:0000(handle)` qui la rend **archive courante** (`1108:36d0`) : tous les chargements `10a8:0430(nom_debug, id, tag, &handle)` s'y adressent (l'ordre des arguments cité est celui de la décompilation, qui est l'inverse de l'empilement). Le nom du fichier est un littéral du segment de données de la scène (ex. `bowling.dat` en `1108:0b2b`, juste avant les variables du bowling).
- Les aides (Poly, Gus) ouvrent leur archive **temporairement** : `10a8:0080(1)` sauvegarde l'archive courante, `10a8:0936(polly.dat)`, jouer l'animation (`1090:111c`), `10a8:09f3` ferme, `10a8:0080(ancienne)` restaure (ex. `1010:442d`, `1010:44ef`).
- Handles par scène : `4b46` (bowling), `4b4a` (Poly), `4b4e` (Gus), `4f4c` (hub), `7bb2` (titre), `7eba` (trophée).

### 2.3 Tags effectivement utilisés (fonctions chargeuses)

| Tag | Chargeur | Remarque |
|---|---|---|
| `\0SCR` | `1090:140f`, `1018:0a04` | script d'animation (§3) |
| `SHPL` | `10a8:0640`, `1018:0a04` | liste de formes + palette (§3.8) |
| `SHAP` | `1088:1a35` (décodage `10d8:ad2c`), `10a8:0379`, `1018:0ac2` | image |
| `SNDL` | `10a8:078a`, `1090:1024` | sons d'un script, préchargés par `1088:1125` |
| `\0SND` | `1088:1125` | WAVE ou MIDI selon l'en-tête interne (`MHWK`+`WAVE`/`MIDI`, `10d0:0ead`) |
| `STRL` | `1010:306c`, `1018:0518`, `1028:0f99`, `10a8:058c` | listes de chaînes |
| `TARG`, `UNIT` | `1010:306c` | cibles et unités de l'estimation du bowling (3 de chaque, tableaux de u32 big-endian : [screens/bowling.md](screens/bowling.md) §3) |
| `PUZZ` | `1030:18eb` (`10a8:058c`) | définition des pièces/puzzles ; **le tag est partagé, pas la structure** : Hidden `1 + 15 n` octets (106, 121 ou 136 ; polyominos, ids `1000 + 32 × niveau + k`), Patterns 40 octets (ids 6600–7900 par 50), Sticklers `8 + 6 n` octets (50 à 98 ; ids `2100 + 900 × niveau + 100 × k`) |
| `PTRN` | `1060:1735` | motifs de Pattern Windows (10 ressources de **100 octets** exactement : 50 mots big-endian signés, [screens/pattern-windows.md](screens/pattern-windows.md) §2.1) |
| `PLST` | `1058:0000` | motif cible, 4 variantes et outils de chaque morceau du Rhythm Shop (386 octets ; `STLV` 30000 : 45 couples id MIDI → id `PLST`, [screens/rhythm.md](screens/rhythm.md) §2.1–2.2) |
| `CURS` | `1008:0000` | curseurs 16×16 (32 octets image, 32 octets masque, 4 octets : point chaud, hypothèse) |
| `SYSX`, `RSFL` | – | `SYSX` lu par `10d0:1a78` (`MIDIMAP.DAT`) ; `RSFL` jamais lu |
| `tBMP`, `tPAL`, `tWAV` | – | de `MPC/PVG.MHK`, lus seulement par `PVG.EXE` ; `tWAV`/`tMID` dans `MATH` ne sont que les noms de deux classes de son (`1108:3396`) |

### 2.4 Convention d'identifiants

- **Fonds plein écran** : `SHPL` `100 + k`, dont la 1re forme est le fond de 576 × 432 : 100 `MAINSCRN` (hub), 101 `BOWLING`, 102 `HIDDEN`, 103 `PATTERNS`, 104 `STICKLER`, 105 `TITLE`, 106 `CREDITS`, 107 `TROPHY` (`1018:0000(k)` charge `100 + k` dans `1108:4ece + 4k`, `k` indexe la table des noms `0b40`). La `SHPL` 100 du hub contient 4 autres formes (pupitre, écran de télé noir, main « stop », Poly : [screens/common.md](screens/common.md) §2.2). `PatFill`, `Nim` et `Rhythm` n'ont pas de tel fond `100 + k` : leur fond plein écran est la forme n° 1 de la `SHPL` 40000 (Pattern Windows, Rockets) ou 30000 (Rhythm Shop) de leur archive.
- Un écran de jeu est une famille d'ids par centaines (`BOWLING` : `1200`–`1499`, `1600`–`1760`, `10000`…, `PATFILL` `1000`–`3700`…). Pour un script : id `SCR` = id `SHPL` + décalage ; la `SNDL` a le même id sauf pour 270 scripts du bowling (§3.7).
- Plages utiles : `MAINSCRN` SHPL 100, 200, 301–313, 315–320, 400–418, 1000–7100+ ; `TITLE` 105, 200, 500, 1000–5000/500, 10000 ; `POLLY` SCR 20000–… (113) ; `GUS` SCR 22000–23400/100, 24950–25300/50, 30000–… /50 (`1010:44ef(n)` joue `22000 + 100n`, `1010:457a(n)` joue `30000 + 50n` si `n < 31` sinon `24950 + 50(n-31)`).
- MIDI : `STICKLER`/`HIDDEN`/`PATTERNS` 100–101, `NIM` 200–201, `PATFILL` 1000–1001, `BOWLING` 2000–2010, `MIDIMPC` 101–… (45), `MILKYWAY` 65000–65001 (marqueurs de boucle `setup end` / `loop start` / `loop end` dans les pistes).

## 3. Les ressources `\0SCR` : scripts d'animation

**Une `\0SCR` est un script d'animation par sprites** (« cast members » = formes `SHAP` d'une `SHPL`), exécuté par l'interprète `1090:0094`. Ce n'est ni une liste de zones cliquables ni une description d'écran : les zones cliquables sont des tableaux de `RECT` du segment de données (ex. hub `1108:1050`, §1.5), les boutons des groupes `10a0` (§5.2). Vérifié sur les **995** scripts des 13 archives qui en contiennent : tous se décodent exactement jusqu'à l'opcode `END`. La grammaire complète, les cellules, la chronologie et le lecteur TS (`src/games/mathemagique/data/scr.ts`) sont dans [scr.md](scr.md) ; cette section en est le résumé.

### 3.1 Chargement

`e2SetupAnim` = `1090:1024(anim)` : charge `SHPL` (id du descripteur) via `10a8:0640`, alloue l'objet animation et le remplit (`1090:06fa`), charge le script `\0SCR` (id + décalage) par `1090:140f` (`10a8:0430` avec tag `0x534352`), puis la liste de sons `SNDL` (`10a8:078a`, qui précharge chaque son par `1088:1125` ; formule exacte de l'id : §3.7). `1090:06fa` parcourt d'abord le script pour **repérer les formes réellement utilisées** (opcodes `0x80–0x9f`) et ne charge que celles-ci (erreur `Cast member out of range %d` si l'index dépasse le nombre de formes de la `SHPL`). Sur les 46 323 références de forme des données, seules 4 dépassent, dans un seul script (`POLLY.DAT` 35900 : formes 5 et 6 pour une `SHPL` de 4 formes) : le moteur lèverait l'erreur, d'où l'hypothèse (scr.md) d'un script jamais joué ou joué avec un autre descripteur.

### 3.2 Format binaire (petit-boutiste, contrairement au reste de l'archive)

```
u16 haut, u16 gauche, u16 bas, u16 droite      // 8 octets : zone d'effet / écrêtage (px, repère écran 576×432)
octets d'opcodes …                              // se termine par 0x00 ; la fin de la ressource est du bourrage (non nul)
```

Le bourrage après `END` n'est pas toujours nul : dans 5 archives (`MAINSCRN`, `NIM`, `PATFILL`, `RHYTHM`, `RSHELP`, soit 351 scripts) ce sont des restes de tampon, sans effet puisque l'interprète et la passe de pré-chargement s'arrêtent à `END` (scr.md). La zone est copiée dans l'objet (`+0x0c` gauche = `P[1]`, `+0x0e` haut = `P[0]`, `+0x10` droite = `P[3]`, `+0x12` bas = `P[2]`). Les sprites peuvent dépasser la zone (mesuré sur Pattern Windows, Puzzle Patterns, Hidden) : elle sert de **fenêtre d'écrêtage et de zone sale** (chaque rectangle sale est intersecté avec elle : `1090:0cae`, `1090:0e53`), et ses coordonnées d'origine servent de repère aux sprites. Exception : pour `NIM.DAT`, la zone stockée n'est pas la zone d'écran (`1070:1d25` ajoute 40 px en y aux scripts de Poly, `1070:1778` réécrit entièrement la zone des vols : [screens/rockets.md](screens/rockets.md) §2.6).

### 3.3 Opcodes

Table de longueurs `1108:340f` (opérandes après l'opcode) et de masques `1108:3402`. Les valeurs sont petit-boutistes ; `c` = indice de cellule `opcode & 0x1f`.

| Opcode | Opérandes | Sens (interprète `1090:0094`, avance rapide `1090:0432`) | Occurrences / 995 scripts |
|---|---|---|---:|
| `0x00` | – | **fin** : le script est terminé quand le dernier délai est écoulé | 995 |
| `0x01` | `u16 n`, `u16 d` | **image** : compose (`0a7f`) ; quand le délai de l'image précédente est écoulé, **présente** l'état des cellules (copie des rectangles sales à l'écran, `0a1b`), `compteur += n` et fixe la durée de cette image à `n × d` ticks | 30150 (`d` = 7 dans 29547 cas, 5 : 441, 4 : 162) |
| `0x02` | `u16 t` | attente passive de `t` ticks (non utilisé dans les données) | 0 |
| `0x03` | `u16 id` | attend la fin du délai de l'image courante puis **joue le son** `id` (`1088:1498(0, \0SND, id)`) : le son part avec l'image suivante | 2042 |
| `0x04` | `u16 id` | arrête le son `id` (`1088:16a5`) | 0 |
| `0x05` | `u16 id` | attend la fin du son `id` (`1088:1818`) | 0 |
| `0x06` | `u8 n` | attend le repère/niveau `n` du MIDI (`1088:1972('tMID')`) | 0 |
| `0x07` | – | compose les cellules dans le work port **sans attendre ni présenter** (`0a7f`) | 2042 |
| `0x10`–`0x13` | `u16 a` | **hook** `k = opcode & 3` : appelle `anim+0x236+4k(a, anim)` ; la scène y pose sa fonction (ex. `1010:3bfc`) | 495 (hook 0 ; `a` = 0 dans 484 cas, 1 à 9 sinon) |
| `0x14`–`0x17` | 4 octets | ignorés (avance de 5) | 0 |
| `0x20`–`0x3f` | `u16 m`, `u16 o` | **drapeaux** de la cellule `c` : `flags = (flags & m) \| o` (mode de blit dans le quartet bas ; `0x000a` converti en `0x0008` au 1er affichage, `1090:0c25`) | 8537 (`m=0xfff0, o=0x000a`), 206 (`o=0`) |
| `0x60`–`0x7f` | `i16 x`, `i16 y` | **position** de la cellule `c` (ancien rectangle effacé, nouveau marqué sale) ; relative au coin `(gauche, haut)` de la zone | 38705 (total des opérations de cellule : 93771) |
| `0x80`–`0x9f` | `u16 forme`, `u16 forme'` | **forme** de la cellule `c` : indice de 1 à n dans la `SHPL` ; `0` = cellule vidée et remise à zéro (`1090:0e21`). Le 2e `u16` est toujours égal au 1er (46323/46323) : ignoré par l'interprète | 46323 (dont 5126 avec forme 0) |
| autre | – | l'interprète s'arrête (erreur : renvoie « terminé ») | 0 |

Aucun script de données n'utilise `0x02`, `0x04`, `0x05`, `0x06`, `0x14`–`0x17` ni les hooks 1–3 ; les autres cas sont implémentés dans le moteur (sons/MIDI synchrones, attentes).

### 3.4 État d'une animation (objet alloué par `1090:06fa`, `0x3d4 + 4n` octets)

32 cellules de 12 octets à `+0x246` (indice 0 = fond ; **les cellules sont dessinées par indice croissant**) : `u16 forme`, `u16 drapeaux` (quartet bas = mode de blit transmis à `10d8:5ff3`), `i32 x` et `i32 y` en 16.16 (seul le mot haut sert), initialisées à `0x80000000` (hors écran) par `1090:0e21`. Autres champs : `+0x00` port de travail (`DAT_8bd6`), `+0x04` port cible, `+0x08` port de fond sauvegardé, `+0x0c`–`+0x13` zone, `+0x1c` poignée de la ressource `\0SCR`, `+0x20` compteur de programme (pointeur dans le script), `+0x24` échéance d'une attente, `+0x28`, `+0x2a` compteur d'images, `+0x2c` délai de l'image courante, `+0x2e` échéance (tick), `+0x32` nombres de rectangles sales (×2 listes de 32 de 8 octets à `+0x36` et `+0x136`), `+0x236` 4 hooks, `+0x3c6` poignée `SNDL`, `+0x3d0` tableau des pointeurs de formes (indice 1 en `+0x3d4`).

### 3.5 Temps et exécution

- Unité : le **tick** `1108:8722`, nominal 60 Hz (en réalité un événement `timeSetEvent` de 17 ms, §4.6). Une image `01 n d` dure `n × d` ticks ; avec `d = 7` : ≈ 119 ms, soit 8,4 images/s par image logique.
- `1090:0094(anim)` (une « étape ») : exécute les opcodes jusqu'au premier qui doit attendre, renvoie 1 quand le script est terminé. Cadence : par défaut (`1108:8732 = 0`) l'échéance de l'image se recale sur l'instant présent (pas de rattrapage) ; avec `8732 ≠ 0` (posé par le hub autour de `1090:111c`, `1020:0ffb`) elle s'additionne (cadence exacte, rattrapage).
- `1090:111c(anim)` : **joue jusqu'au bout** en boucle `1090:0094` + `1088:105b`. Drapeaux de l'octet `+7` du descripteur : bit 0 = sauvegarder le fond dans un port « animation » ; bit 1 = ne pas arrêter le MIDI en cours ; bit 2 = à l'interruption, avancer en rapide jusqu'à l'état final (`1090:0432(0x7fff)`) ; bit 3 = **interruptible** par clic/touche (`1098:04d9(3)`) ; bit 4 = attendre la fin de tous les sons du `SNDL` ; bit 5 = restaurer le fond à la fin ; bit 6 = (lu par `06fa`, rôle non établi).
- `1090:0432(n, anim)` = avance rapide sans attendre jusqu'à l'image `n` (utilisé par l'horloge du titre) ; `1090:138c(avancer, anim)` remet le compteur de programme au début et efface les cellules (si `avancer ≠ 0`, exécute jusqu'à la première image, `1090:13e1`) ; `1090:135a` libère (`1090:0022` : formes, SNDL, ressource) ; `1090:1464` = installe + exécute une étape (`1090:13e1`).
- Composition (`1090:0a7f`) : pour chaque rectangle sale, `10d8:2f77` fixe l'écrêtage, chaque cellule non vide est dessinée par `1090:0c25` → `10d8:5ff3(mode, y, x, forme)`, puis `10a8:1274`/`1254` recopient vers l'écran. Les rectangles sales (`1090:0e53`) sont fusionnés (jusqu'à 32 par liste).

### 3.6 Descripteur d'animation (12 octets, dans le segment de données de la scène)

`u32 pointeur (état alloué, nul avant 1090:1024)`, `u16 id SHPL`, `u8 décalage`, `u8 drapeaux (ci-dessus)`, `u32 port de fond sauvegardé`. Exemple (titre, `1108:26b8`…) : ids 2000, 2500, 1000, 1500, 3000, 3500, 4000, 4500, 5000, 10000 avec drapeaux `0x03`. Les hooks s'enregistrent par `mov es:[bx+0x236], offset` suivi du segment (ex. `1010:3b66` → `1010:3bfc`).

### 3.7 Relation `SCR` ↔ `SNDL` ↔ `SHPL` ↔ `SHAP`

- `SNDL(i)` existe pour 725 des 995 scripts : tous sauf **270 scripts de `BOWLING.DAT`** (ids `1201`–`1209`, `1211`–`1219`… `1491`–`1499`, soit 9 sur 10 dans `1200`–`1499`). Ces 270 scripts jouent les sons de la `SNDL` de la dizaine inférieure (`1200`, `1210`…) ; ailleurs, tous les `SND_PLAY` d'un script figurent dans la `SNDL` de même id (995/995). **La formule de l'id est établie** (scr.md, « Résolution `SCR` → `SHPL` et `SNDL` ») : `1010:3adc(n)` calcule `base = ((n-1)/100)*100 + 1200` et `dizaine = (((n-1) % 100) / 10) * 10`, charge l'animation avec la `SHPL` `base` et le **décalage `dizaine`** (octet `DAT_1108_0516`), donc la `SNDL` d'id `base + dizaine` (`1090:1024` charge toujours la `SNDL` d'id `id + décalage`) ; il charge ensuite les dix scripts `base + dizaine + i` dans les dix descripteurs `4ea2…4ec6` sans recharger de `SNDL`. Il n'y a donc pas de mécanisme supplémentaire : c'est le décalage ordinaire du descripteur (l'hypothèse d'un « 2e décalage » est écartée).
- Une `SHPL` (en-tête 8 octets, **big-endian**, §3.8) donne `base` = id de la première `SHAP` et `n` = nombre de formes ; la forme d'indice `k` (1 à n) est la `SHAP` d'id `base + k - 1` (`1088:1a35`).
- `SCR(i)` utilise la `SHPL` d'id `i - décalage` où `décalage` est l'octet `+6` du descripteur. Dans 11 archives sur 13, `SHPL(i)` existe pour chaque `SCR(i)` (décalage 0). `BOWLING.DAT` : les 297 scripts `1201`–`1499` (hors dizaines) utilisent `SHPL` 1200/1300/1400 avec un décalage de 1 à 99 ; `NIM.DAT` : 31 scripts (décalages 1 à 31) ont en revanche leur propre `SNDL`, **vide** d'après [screens/rockets.md](screens/rockets.md) §2.6 (les sons de vol sont joués explicitement). L'origine du décalage est établie : `1070:1778` écrit `DS:287c` = type de la fusée avant `1090:1024` (script `30000 + type` avec la `SHPL` 30000) ; côté Poly, `1070:1d25` passe toujours le décalage 0.
- Les 11 `SNDL` qui pointent hors de leur archive (formats.md) sont probablement des sons chargés depuis l'archive courante au moment du jeu (hypothèse).

### 3.8 `SHPL` (rappel et précisions)

En-tête big-endian `u16 base`, `u16 n formes`, `u16 premier index de palette`, `u16 nombre de couleurs | drapeaux<<14`, puis `nombre × 4` octets (R, G, B, drapeau ; ordre RGB confirmé par la copie vers des `PALETTEENTRY` ; 4e octet = 0 dans 21461 entrées sur 22990, 1 dans 1529). `10a8:0640` copie ces entrées dans le tampon de palette logique `1108:8bda + 4 × premier` puis `1098:0857` applique un **relèvement non linéaire** : pour chaque composante non nulle, `c ← c + 31 - ⌊c/8⌋` (donc 255 reste 255, 1 devient 32, 8 devient 38). Les fonds plein écran ont `premier = 10`, `nombre = 236` (couleurs 10 à 245) ; les `SHPL` d'animation ont `nombre = 0` et réutilisent la palette de l'écran. Confirmé par le rendu des écrans (shap.md, « Palette » : sans éclaircissement les couleurs sont trop sombres) ; ce relèvement est la seule conversion, et il n'est pas appliqué aux `tPAL` de `PVG.MHK`. **Désaccord** sur le champ « nombre » de l'en-tête : cette section y voyait `nombre | drapeaux<<14`, shap.md ne décrit qu'un compte d'entrées `c` (copie de `c × 4` octets) sans drapeaux ; les valeurs observées (0, 1, 15…17, 40, 80, 236) sont compatibles avec un simple compte, la partie « drapeaux » n'est pas établie.

### 3.9 Exemple décodé (`BOWLING.DAT`, `SCR` 1200, 108 octets)

```
zone (haut 227, gauche 406, bas 314, droite 488)
cell12 forme 1 ; cell12 pos (-54,-57) ; cell12 drapeaux (&fff0)|000a
FRAME n=2 d=7 ; cell1 forme 2 ; cell1 pos (6,-46) ; cell1 drapeaux … ; RENDER ; SND_PLAY 14300
FRAME 1×7 ; cell1 pos (5,-3) ; FRAME 1×7 ; cell1 forme 3 ; cell1 pos (-1,26) ; FRAME 2×7 …
END
```

### 3.10 Conséquences pour la réimplémentation

Un lecteur de `\0SCR` est une boucle d'à peine 100 lignes (§3.3), plus : pile de 32 cellules, horloge à 60 Hz, écrêtage à la zone, sons synchronisés (`SND_PLAY`) et hooks de scène (`HOOK0`). La partie coûteuse n'est pas ici mais dans les `Tick` des activités (§9).

## 4. Rendu

### 4.1 Fenêtre et résolution

- Fenêtre `CreateWindow` style `0x80800000` (`WS_POPUP | WS_BORDER`, sans légende) **plein écran** (taille de l'écran + bordures, origine `(-bordure, -bordure)`), fond de classe = `BLACK_BRUSH` (`1098:006e`), classe enregistrée de procédure `1098:0966`, icône `AppIcon`. La zone de jeu fait **576 × 432** (`10a8:0b1d(0x1b0, 0x240)` = hauteur, largeur), centrée dans l'écran 640 × 480 ; les 64 × 48 px restants sont noirs. Confirmé : chaque fond plein écran (`SHPL` 100–107) est une `SHAP` de 576 × 432.
- Procédure de fenêtre `1098:0966` : `WM_PAINT` (`0x0f`) recompose via `10a8:12d1` et le port de travail ; `WM_ACTIVATE` (`6`) / `WM_ACTIVATEAPP` (`0x1c`, mémorise l'activité dans `1108:3458`, recontrôle le périphérique son et propose « Sound driver missing or unavailable. ») ; `WM_QUERYNEWPALETTE` (`0x30f`) → réalisation de la palette (`10a8:0d9c`/`0dc4`) ; `WM_SYSCOMMAND` `0xf060` (`SC_CLOSE`) → quitter ; touches et souris (§5).

### 4.2 Ports, tampons, composition

Hiérarchie C++ de « ports » (`10d8`, vtables §1.6). Trois ports permanents : **port d'écran** (`DAT_8bba`, DC de la fenêtre), **work port** (`DAT_8bd6`, tampon hors écran de composition, créé par `10a8:0eb8("work port")`), **back port** (`e2GetBackPort`). Les animations ouvrent des ports « animation » pour sauvegarder le fond (drapeau bit 0/5). Les fonds et formes sont dessinés dans le work port puis recopiés (`BitBlt`/WinG) : `10a8:12d1` met à jour une zone, `10a8:1274` copie d'un port à l'autre, `10a8:119f`/`1212` gèrent la région d'écrêtage (`e2ClipRect`, `e2GetClipRgn`), `10a8:1023` sauvegarde un rectangle (`e2SaveRect`).

### 4.3 Formes (`SHAP`)

Chargement `1088:1a35` : `10c0:086e` (recherche `(tag, id)`) → `10c0:0aac` (verrouillage) → `10d8:ad2c` convertit la forme **sur place** : l'en-tête big-endian (largeur, hauteur, pas, drapeaux) est lu par `10b0:0630` (échange d'octets), l'indicateur `(drapeaux & 0xf00) == 0x100` marque une forme compressée par LZ et le mot de l'offset 16 doit valoir `0x400` (taille de l'anneau, toujours cette valeur d'après shap.md) ; `10d8:ae3a` (LZSS à anneau de 1024 octets) la décompresse et efface l'indicateur ; le bitmap est ensuite stocké en RLE par ligne si le drapeau `0x010` est posé. Le dessin `10d8:5ff3` refuse une forme encore compressée, lit les mêmes champs et appelle la méthode `+0x38` du port (blit avec mode, position, forme). **Le pixel format est établi dans [shap.md](shap.md)** : indexé 8 bits (ou masque 1 bit), big-endian, LZ puis RLE, index 0 = transparent en mode de dessin 8 ; les 16 258 `SHAP` des 18 `.DAT` se décodent sans erreur. Taille mesurée de l'image du titre : 576 × 432, pas = largeur ; une icône 25 × 25 a un pas de 28 (multiple de 4).

### 4.4 Palette

- Palette logique de 256 entrées créée à l'initialisation (`10a8:0b1d` : `10d8:3589`), les **entrées 10 à 245 marquées `PC_RESERVED`** (octet 3 = 1) pour pouvoir être animées ; les 20 couleurs système (0–9 et 246–255) sont conservées. `10d8:6db9` lit la palette système et prépare l'accès (6×6×6 + 20 couleurs).
- Chargement d'une `SHPL` : écrit dans le tampon `8bda`, applique le relèvement (§3.8), puis `10a8:0dc4` (`AnimatePalette` sur `premier..premier+nombre`) l'applique à l'écran sans refaire de BitBlt.
- **Fondus** : `1088:1b25(mode, durée, nombre, premier, cible)` — les scènes l'appellent avec `(1, 30, 236, 10, 0 ou pointeur de palette)` (cible 0 = noir) ; `1088:1b9b` prépare (copie la palette courante en `+0x776`, la cible en `+0x16`), `1088:1cee` interpole chaque composante RGB (`départ + (cible - départ) × t / 256`, `t` croît avec le temps écoulé lu par `1000:28b8`) et applique `AnimatePalette`, en boucle avec `1088:105b` jusqu'à `t = 256`. Le mode 0 progresse par paliers de 4 niveaux. L'unité exacte de la durée (30) reste à établir.
- Animation de palette ailleurs : rotation du « kaléidoscope » de Pattern Windows, **confirmée** (`1060:1627` fait tourner les entrées 180–194 d'un cran toutes les 8 ticks pendant 300 ticks, [screens/pattern-windows.md](screens/pattern-windows.md)) ; cyclage de palette de la fanfare du Bowling (`1010:42a2`) et de l'animation de victoire de Puzzle Patterns.

### 4.5 Curseurs

`CURS` 1 et 2 de `MILKYWAY.DAT` → `4b38`/`4b3a` ; installés par `10d8:9adb`. Le curseur système est utilisé hors mode « occupé » (§1.3). En **mode aide** du hub, le curseur passe en mode 2 (point d'interrogation) quand la souris survole une zone d'indice ≥ 3 de la table de survol `DS:1050` (`1020:06f6`) ; le Rhythm Shop et Rockets font de même dans leur propre mode d'aide.

### 4.6 Temps

Un seul mécanisme : **tick global** `1108:8722` alimenté par `timeSetEvent(17 ms)` (`1000:2a2a`, `1088:0f8e(60)`), incrémenté seulement quand l'appli est active ; plus 4 **compte à rebours** `871a`…`8721` (décrémentés à chaque tick ; `1088:1074`/`1091`/`10d2`/`10ec` = attentes bornées, interruptibles par entrée). Le Rhythm Shop ajoute un `timeSetEvent(4 ms)` propre (`1038:0543` → rappel `1038:0e95`) pour la cadence des mesures. Pas de `SetTimer`. Les scripts d'animation n'utilisent que le tick ; les fondus de palette (`1088:1cee`), le séquenceur MIDI et le gestionnaire de fichiers lisent l'horloge en ms `1000:28b8` (= `timeGetTime`).

### 4.7 Polices

`NCSclB10`/`NCSclB12` chargées au démarrage (`10a8:0a87`) ; l'installeur copie les cinq `.FON` `NCSclB10`–`24`, `MARKET__.TTF` et `NEWZURCA.TTF` (`MATH.BDF` ; les autres `.TTF` du CD ne sont pas listés) ; `10d8` crée des `.FOT` temporaires pour les `.TTF` (chaînes `!GFX%04lX.FOT`) ; `BRODFONT.DLL` n'est pas importée par `MATH`. Les textes de l'interface sont presque tous dessinés dans les formes ; le texte à l'écran n'existe que pour : « LEVEL n » / « BONUS ROUND » (`1010:4140`), « Rank: » et les noms (Hall of Fame, `1078:0860`), le nom du joueur (saisie `1080`), la boîte « À propos », la liste des noms, la zone de saisie et le champ du timer du moniteur de connexion, les problèmes du bowling (`%d + %d =`, etc., `1108:0340`–`0386`) et les phrases d'estimation. Divergence de nom : bowling.md désigne la police de `4a10` (celle des rangs) par `NCSclB14`, alors que ce document (étape 14 du §1.1) la lit comme `NCSclB10` ; non tranché.

### 4.8 Impression

Boîte d'impression `10d8:38e8` (`PRINTDLG` de `COMMDLG`, boîte « Printing… »/« Cancel », messages `Print Error`, `Not enough memory.`, `Not enough room on disk.`, `General error.`) ; deux jobs : **vitrail de Pattern Windows** (`1060:008a` → `1088:0000`, titre de document « Stained Glass ») et **certificat** (`1078:0709` cas 3 → `1088:0120`, document « Certificate »). Le certificat (`1088:0a9f`) dessine d'abord les textes (`1088:0b49`) : titre « <Opération> Certificate of Merit » (`Addition`, `Subtraction`, `Multiplication`, `Division`, `Equivalence`, `Estimation`), « this certificate is awarded to », le nom et « who has achieved the rank of » + grade global, en `Market` / `NewZurica` ; puis `BKG.WMF` (`1088:09bd`), puis, bit par bit pour `i` de 0 à 4, `RIB1.WMF`…`RIB4.WMF` et `RIBB.WMF` (bonus) si le bit `i` du quintet de l'opération est posé. La mise en page est paysage, 10,1 × 7,7 pouces (extent des WMF) ; les rectangles exacts des textes ne sont pas reconstruits ([screens/common.md](screens/common.md) §6.3). Voir les ressources `PVGWMF/` (30 WMF) : hors `MATH`.

## 5. Entrées

### 5.1 Souris

`WM_LBUTTONDOWN` (`0x201`), `WM_RBUTTONDOWN` (`0x204`), `WM_MBUTTONDOWN` (`0x207`) → `1098:0966` convertit le point en coordonnées de jeu (`10d8:7778`) et appelle `1008:05c0(bouton 1/2/3, point)` ; ce routeur propose le clic d'abord à un gestionnaire propre à la scène (bowling `1010:46b8`, Pattern Windows `1060:1cd3`, hub `1020:20b8` → `1020:1990`) puis à `10a0:001b` (gadgets). Aucun `WM_MOUSEMOVE` : le survol est interrogé à chaque tour (`1098:039b`). Le numéro du bouton est mémorisé dans `1108:4b34` et transmis aux rappels, mais les trois boutons déclenchent la même chose (common.md §0 point 3) ; aucune scène étudiée ne traite le bouton droit ou du milieu à part (Bowling, Pattern Windows, Rockets : aucun traitement spécifique ; Hidden, Patterns et Sticklers mémorisent seulement le bouton qui a saisi une pièce pour le mode glisser). Le hub n'a pas de mode « cliquer-glisser ». Les activités de puzzle lisent deux préférences de l'en-tête du roster (§7.1) : `DS:02b8` = mode de la souris (**cliquer-poser** si ≠ 0, valeur par défaut 1 ; **glisser** si 0) et `DS:2d64` = musique de fond.

### 5.2 Gadgets : `10a0`

Gestionnaire de « **groupes de boutons graphiques** » (message `too many graphic button groups:`, 10 groupes maximum) : `10a0:0000(tableau, nombre, drapeaux)` installe les groupes de la scène (`3538` = tableau de groupes de 12 octets, `88b6` = nombre de groupes, `88b4` = drapeaux ; bowling : 5 groupes, hub : 4, titre : 1, trophée : 2) ; chaque bouton est un `RECT` + id + drapeaux + formes d'état chargées par `10a0:1dd4`/`1068:02a7`/`10a8:0124` (nombre d'états et rôle : hypothèse, voir les vtables `353e`–`3682`). Structure établie par [screens/common.md](screens/common.md) §0 point 3 : un **groupe** = 12 octets (pointeur lointain vers le tableau de boutons, nombre, drapeaux dont bit 0 = groupe inactif, rappel recevant l'indice 1 à n de l'enregistrement) ; un **bouton** = 16 octets (vtable, enregistrements, drapeaux `+0xa`, table de sons) ; un **enregistrement** = 20 octets (`RECT` puis état, drapeaux en `+0x12` : bit 0 masqué, bit 1 désactivé, bit 2 enfoncé), rectangle `[gauche, droite[ × [haut, bas[`. Les boutons à 3 états sont ceux du segment `1038` (vtable `DS:1b4e`) ; le sens exact des drapeaux de groupe (`0x2068`, `0x206c`, `0x8040`, `0xc000`) reste non établi. `10a0:001b` (inactivité) suit la souris : survol, appui, relâchement, rappel du bouton (tables §1.6) ; `10a0:098e` implémente le **clavier** des boutons : Tab / Maj+Tab (`0x809`) parcourent les boutons (`10a0:0aed`), Entrée (`0xd`) active le bouton survolé ou, à défaut, celui qui a le focus (`10a0:0bed`, clignotement de 30 ticks) ; `10a0:1480`/`1517` sauvegardent/restaurent l'état.

### 5.3 Clavier

`WM_KEYDOWN` : F1–F12 (`0x70`–`0x7b`) et flèches (`0x25`–`0x28`) ; `WM_SYSKEYDOWN` F10 (`0x79`, pour empêcher le menu système) ; `WM_CHAR` pour tout le reste. Dans les trois cas `1008:0859(code)` avec drapeaux Maj `0x800` / Ctrl `0x400` ajoutés (`1098:036f`). Ordre de traitement : (1) gadgets `10a0:098e` ; (2) `Key` de la scène (`descripteur + 0x10`) ; (3) globaux : **Ctrl+Q (`0x11`) quitte** (`1008:02da` : `1108:00f6 = 1`, `1088:0e72("")` → sortie propre sans message) et **Ctrl+V (`0x16`) affiche la boîte « À propos »** (`1008:06c1` : 340 × 152 px, « Math Workshop / Version 1.01 / © Copyright 1994 Brøderbund Software, Inc. / All Rights Reserved. », dessinée avec la police `4a10`, attend un clic/une touche). `Alt+F4`/fermeture → même sortie.

Touches par scène (relevées dans les `Key` ou les rappels ; détail dans le § « Clavier » de chaque étude) :

| Scène | Touches |
|---|---|
| Hub | `Key` (`1020:11b0`) : moniteur ouvert → saisie du nom (`1080:0581`), sinon historique des séquences secrètes (`1018:03fd`) ; Tab / Maj+Tab / Entrée sur les gadgets |
| Bowling | `1`–`4` (`0x31`–`0x34`) choisissent la réponse correspondante (`1010:2b64` → `1010:09a4`) **seulement pendant une partie** (`4ca6 ≠ 0`, sinon ignorées) ; saisie de texte et du nom (`1080:0581`) quand le moniteur est ouvert |
| Rhythm Shop | `1`–`9` choisissent l'**outil** (boutons Cutter / Gluer / Melder et assimilés, pas des instruments) ; Tab passe à l'outil suivant (`1028:2de2`) |
| Pattern Windows | `x`/`X` couleur suivante (14 → 0), `z`/`Z` précédente (0 → 14), soit 15 couleurs (`1060:1786`) ; ignorées en mode aide ; redirigées vers la saisie du nom quand le moniteur est ouvert |
| Hidden Pictures, Puzzle Patterns, Super Sticklers | Espace (`0x20`) = **rotation** de la dernière pièce / du dernier fragment (`1030:14c5`, `1040:1678` → `1040:11b2`, `1048:1914` → `1048:1509`), équivalent du bouton Rotate ; ce n'est ni « puzzle suivant » ni l'aide |
| Rockets | aucune touche propre : `1070:2045` n'enregistre que la séquence secrète et renvoie 0 (non consommée) ; cette séquence est du **code mort** (la condition finale `1098:036f(0) == 0x600` est inatteignable, `1098:036f` ne renvoie que `0x400`, `0x800` ou leur union) |
| Hub, Pattern Windows, Rockets | `1018:03fd` accumule les derniers codes dans un historique 32 bits (`H = (H << 7) \| (code & 0x7f)`, plus un cumul `X`) ; **Ctrl+A (code 1) remet l'historique à zéro** ; `1018:043a` le compare aux séquences secrètes. Le test n'a lieu qu'à l'ouverture du moniteur en mode 4, c'est-à-dire au clic sur Poly : `1080:0000` y teste **19 séquences** et affiche la photo de l'équipe correspondante (§7.4, [screens/common.md](screens/common.md) §4) |

## 6. Audio

- **Couche applicative** `1088` : deux classes de sons (`tWAV` = 0, `tMID` = 1, chaînes `1108:3396`). `1088:1125(\0SND, id)` charge un son : `10c0:086e/0aac`, détection du type par l'en-tête interne (`MHWK`…`WAVE`/`MIDI`, `10d0:0ead`), création d'un objet périphérique et inscription dans la table (`1088:1371` recherche, `13c5`/`141f` allocation/libération). `1088:1498(canal, \0SND, id)` lance (le canal `-1` choisit le plus ancien libre, `1088:15bb`) ; `1088:16a5` arrête, `1088:176d` met en pause, `1088:1818` « en cours ? », `1088:194a` attend/arrête, `1088:12c6` libère. Table des voix `1108:33a8` (6 octets : id, état, âge) ; compteurs initiaux `33a2/33a4 = 1` : **un WAVE et un MIDI simultanés** par défaut. Le Rhythm Shop y ajoute ses propres appareils via `10d0:0ead` (14 `SND` préchargés et un appareil WAVE dédié `DS:77c5` pour l'impulsion `30006`) : c'est son « mixage » ([screens/rhythm.md](screens/rhythm.md) §3.1). Les autres activités jouent tout sur le canal 0 (Rockets : `1088:1498(0, \0SND, id)`).
- **WAVE** : `waveOut` (`10d0:3a51` ouvre le périphérique, `3bd9` prépare/écrit des tampons en streaming, `3f47`/`40f4` lisent la position, `4204`/`43c4` pause/reprise, `427c` rompt la boucle, `3b70` vitesse de lecture `WAVEOUTSETPLAYBACKRATE`). Le débit de l'en-tête (11025 Hz en pratique) est traduit via la clé `Audio.WaveRateTranslations` de `MOHAWK.INI` si le périphérique n'accepte pas 11025 Hz. PCM 8 bits mono non signé (formats.md). Aucune référence à `Cue#` (`0x43756523`) dans le code : **pas de synchro labiale par repères** ; la voix est synchronisée par les scripts `\0SCR` (`SND_PLAY` + `FRAME`).
- **MIDI** : `midiOut` (`10d0:1be5` ouvre ; `1404`/`2989` envoient `MIDIOUTLONGMSG`/`SHORTMSG` ; `MIDIOUTCACHEPATCHES`/`CACHEDRUMPATCHES` aux `10ab`/`1258`) avec un **séquenceur logiciel** (`10d0:2ae4`, `2c06`, `2d02`, `2e02` : `timeSetEvent`, lecture de la piste `MTrk`, repères texte `setup end` / `loop start` / `loop end` pour boucler). Choix du périphérique : `MOHAWK.INI` `[Audio]` ; liste de périphériques connus et réglages (`MidiMap.TargetDevices`, `MidiMap.TargetDeviceInfo`, `XSYSMidiMap.TargetDevices`) dans `MOHAWK.WIN`/`MOHAWK.INI` ; `MIDIMAP.DAT` (`SYSX`, `Bn 79 00` : reset de contrôleurs) envoyé à l'ouverture. `Prg#` (propre à Mohawk) est **décodé** : `u16 n` puis `n` couples (programme GM, masque de canaux), soit la structure `PATCHARRAY` de `midiOutCachePatches` ; il sert à précharger les timbres avant la lecture sur les cartes à mémoire d'échantillons ([screens/rhythm.md](screens/rhythm.md) §2.3 ; qu'il soit lu par le pilote `10d0` est une hypothèse, aucune constante `Prg#` n'étant dans le code). `MIDIMAP.DAT` : 64 messages d'initialisation (reset des contrôleurs, volume 127, expression 90, pan centre) pour les 16 canaux. Le Rhythm Shop réécrit en outre le MIDI en mémoire avant lecture (une seule mesure, vélocité 0 des emplacements vides) et s'appuie sur les repères texte `Cue Point` (`FF 07`) du MIDI, rappelés par `1028:26b0` (rhythm.md §3).
- **Musique** : activité par activité (ids §2.4) ; MIDI « transition » (`MILKYWAY` 65000) joué à l'entrée du hub **si `DS:2d64` ≠ 0** (`1008:0522` → `1088:1498(0, \0SND, 65000)`, appelé par `1020:0147` et `1020:1e35`). Le titre joue une musique WAVE bouclée (`TITLE` 1000, 17,4 s). **Il existe un réglage marche/arrêt** : la vue Préférences du moniteur (Ctrl + clic sur Sign-in, §7.4) a la bascule **Ambient Sounds** (`DS:2d64`, enregistrée dans l'en-tête du roster, §7.1), qui commande le MIDI 65000 et les bavardages d'ambiance du hub, ainsi que la musique de fond des activités (MIDI 100 pour Hidden / Patterns / Sticklers, 2000–2003 du Bowling, 201 de Rockets) ([screens/common.md](screens/common.md) §3, §11).
- Aucun appel `sndPlaySound` ni `mciSendCommand` : `MMSYSTEM` n'est utilisé que par `10d0`, `1000:4614`/`4673`/`412f` (messages MIDI) et le timer.

## 7. Persistance

### 7.1 Fichier `MWRoster` (222 384 octets = 41 × 5 424)

Ouvert/créé dans le répertoire de l'exécutable par `1050:03fa` (`MWRoster`, mode 3 ; s'il manque il est créé par `10b8:0192` puis rempli ; erreurs `Could not Open/Create Roster file.`, `Problem writing user file`, `Seek Error`, `Problem reading user file`). Le modèle livré (`MWROSTER`, `MATH.INF` : 222 384 octets) n'a que 5 octets non nuls (en-tête ci-dessous). Structure :

- **Enregistrement 0** (offset 0, 5424 octets) = en-tête + liste des joueurs (détail : [screens/common.md](screens/common.md) §3.5) :
  - octets 0–11 : définition `DS:1ebc`, **entiers big-endian** (seul le masque de chaque joueur est natif) : `u16` version `0x0020` (`00 20` ; sinon fatal « Old Roster File must be deleted! »), `u16` **nombre de joueurs** (DS `1e8e`, pas un champ nul), `u32` **timer du Bowling en ticks** (DS `0332` = 10800, stocké `00 00 2a 30` ; 10 800 ticks = **180 s**, et non 3 h ; réglable de 1 à 999 s dans le moniteur, valeur par défaut venant du descripteur du bowling `+0x18`), `u16` **Click & Stick Mouse** (DS `02b8`, 1 = cliquer-poser, 0 = glisser, valeur 1 dans le modèle livré), `u16` **Ambient Sounds** (DS `2d64`, 1 = oui ; relu dans `1020:0141`/`1020:06f6` ; il commande aussi la musique des activités, §6 : ce n'est pas seulement un drapeau de phrases d'attente de Poly) ;
  - puis **40 entrées de 37 octets** (dès l'octet 12 ; l'entrée `i` de 1 à 40 est à `12 + 37 × (i − 1)`) : `u8 utilisé`, `char nom[32]` (NUL terminal ; saisie bornée à 28 caractères et par la largeur de pixels, `10d8:6bf0 > 0x6d`), `u32 masque de réussites` (**natif, petit-boutiste**, à l'octet 33 de l'entrée). La liste est triée par ordre alphabétique pour l'affichage (`1080:1ab8` tient un tableau d'indices `82e2`, 40 mots). L'identifiant du joueur courant `1e90` est **1-based**.
- **Enregistrements 1 à 40** (offset `5424 × id`) : variables des scènes, dans l'ordre du registre (index de scène croissant), **entiers en big-endian**, tableaux d'octets bruts. Taille utile 5 422 octets arrondie à 5 424 (`1050:006c`). Sauf le Bowling (progression réelle) et le Rhythm Shop / Pattern Windows (réglages), ces variables sont des drapeaux « Poly a déjà présenté le jeu » et non des niveaux :

| Offset | Scène | Variable (DS) | Contenu |
|---|---|---|---|
| 0 | hub | `4fa4` ×1 u16 | introduction longue de Poly (`SCR` 5800) déjà jouée ; 0 = nouveau joueur (common.md §11 point 6) |
| 2 | bowling | `4cb8` ×6 u16 | **index plat du sous-type** de problème, par opération |
| 14 | bowling | `4cc4` ×6 u16 | niveau courant (0–4) par opération (`1010:0000` : `4d0c ← tableau[op]`) |
| 26 | bowling | `4cd0` ×30 u16 | strikes (0–9) du niveau `op × 5 + niveau` (`4d0e` ← cette case) |
| 86 | bowling | `4d30` ×1 u16 | Poly a déjà présenté le jeu (choisit la variante de l'animation d'aide, `1010:4363`) |
| 88 | rhythm | `7798` ×45 u8 | **compteur de variante** (0–3) dans la `PLST` de chacun des 45 morceaux (3 niveaux × 15) |
| 133 | rhythm | `76e2` ×1 u16 | niveau courant (0–2, « Level Brothers ») |
| 135 | rhythm | `4ff4` ×1 u16 | drapeau d'aide (première explication générale déjà vue) |
| 137 | patfill | `7040` ×1 u16 | motif courant (0–9) |
| 139 | patfill | `7044` ×10 u8 | version courante (0–2) de chaque motif |
| 149 | patfill | `5bb2` ×5262 u8 | le vitrail : 3 versions × 10 motifs, 2 cellules par octet (5 262 = 3 × 1 754) |
| 5411 | patfill | `704e` ×1 u8 | couleur courante (0–14, `x`/`z`) |
| 5412 | patfill | `746b` ×1 u16 | la grande présentation de Poly (`SCR` 1700) a déjà été vue |
| 5414 | hidden | `50d8` u16 | Poly a déjà présenté le jeu (discours long `25100` si 0, sinon court `25250`) |
| 5416 | patterns | `57d6` u16 | idem (`SCR` 35100 si 0, sinon 35250) |
| 5418 | stickler | `5946` u16 | idem |
| 5420 | nim | `7c02` u16 | l'introduction d'aide complète (`SCR` 1100) a déjà été jouée |

- **Masque de réussites** (`u32` à l'octet 33 de l'entrée du joueur, écrit à `idx × 37 + 8` avec `idx` 1-based) : bit `5 × opération + niveau`, écrit par `1010:3fdf` à la réussite d'un niveau (10 strikes, [screens/bowling.md](screens/bowling.md) §1.9, §2.2). Opérations 0 à 5 = Addition, Soustraction, Multiplication, Division, Équivalence (fractions `%d/%d`), Estimation (ordre des colonnes et des certificats, `1088:0b49`) ; niveaux 0 à 3 = `LEVEL 1`–`4`, niveau 4 = `BONUS ROUND` (`1010:4140`). **Seul le Bowling écrit ce masque** ; les autres activités n'en touchent aucun bit.
- **Grade** (`1018:0518`) : `grade = 1 + nombre de bits de niveau 0 à 3 positionnés` sur les 6 opérations (le bonus ne compte pas), soit 1 à 25, indexant la `STRL` 5000 (25 grades, identiques dans `TROPHY.DAT` et `BOWLING.DAT`, de « Rookie Roller » à « Strike Master »). Le grade est global à toutes les opérations. Le Hall of Fame (`1078:0860`) lit le masque par tranches de 5 bits : une case par opération, active si la tranche est non nulle, qui dessine un ruban par niveau réussi (§8.6).
- Écriture : `1010:3fdf`, `1078:0a55` (lecture de l'en-tête à l'entrée du trophée), `1050:0331` (mode lecture/écriture de tous les enregistrements enregistrés), `1050:0302` (appel standard des scènes à la sortie). L'en-tête est réécrit en entier à chaque fermeture du moniteur (`1080:08fe`) et le masque à chaque niveau réussi.

### 7.2 Lecture/écriture

`1050:03fa(mode, taille, tampon, index)` ; `1050:00fa(sens, tampon, définition)` convertit variables ↔ tampon (tailles 1/2/4 ; 2 et 4 octets sont échangés). `1050:0000` enregistre une définition (jusqu'à 20, `DAT_5b86` ; fatal au-delà). `1050:0635` appelle les rappels de sauvegarde `+6`. `1108:1e90` = identifiant du joueur courant (1-based ; 0 = personne : les activités du hub sont alors précédées de la boîte de connexion, `1020:098a`). Quand ça s'écrit : l'en-tête à chaque fermeture du moniteur et à chaque niveau réussi, les variables d'un joueur par `1050:0302` à la sortie des activités, à la création d'un joueur et à la fin de l'accueil du hub ([screens/common.md](screens/common.md) §3.5). **Aucune écriture du roster n'a été vue sur le chemin de sortie du jeu** (Ctrl+Q, sifflet) : le crochet `1008:02f3` décrit au §1.1 est absent de `disasm.txt` et n'a pas été relu par common.md, donc les variables non sauvées seraient perdues, à confirmer.

### 7.3 Configuration

- `math.cfg` (copie de `MATH.BDF` par l'installeur, dans le répertoire d'installation ; contient `InstallFromDir`/`InstallToDir`, `productversion=1.01`) lu par `1078:0019` : chemin du CD. Les `.DAT` restent sur le CD ; sont copiés sur disque : `MATH.EXE`, `MIDIMAP.DAT`, `MOHAWK.WIN`, `MWROSTER`, `DIB.DRV`, polices, `BROEMIDI(.EXE)`.
- `MOHAWK.INI` (créé depuis `MOHAWK.WIN`) : `[Audio]` (`DefaultWaveDevice`, `DefaultMidiDevice`, `fCacheDefaultMidiDevice`, `Audio.WaveRateTranslations`), `[Graphics]` `fWinGEnable` (`10d8:ab41` : charge `WING.DLL` par `LoadLibrary` si la clé n'est pas fausse, résout les ordinaux `1001`, `1002`, `1003`, `1006`, `1009` = `WinGCreateDC`, `WinGRecommendDIBFormat`, `WinGCreateBitmap`, `WinGSetDIBColorTable`, `WinGBitBlt` : hypothèse d'après les numéros WinG), `MidiMap.*`.

### 7.4 Moniteur : connexion, préférences, roster, Math Trivia (`1080`)

`1080:0000(mode, …)` (appelé par `1010:0bc5(1)` depuis le Bowling, `1060:03d5` depuis Pattern Windows et `1020:10e2` depuis le hub) dessine un « moniteur » par-dessus l'écran courant. Détail : [screens/common.md](screens/common.md) §3 et §4. Modes :

- **1 = connexion** : liste triée des joueurs affichée **trois noms à la fois** avec flèches (et non des pages de 8, qui sont celles du Hall of Fame), boutons New Player et OK, saisie du nom au clavier (`1080:0581`, 28 caractères et 110 px au plus) ; si le roster est vide, passe directement à la saisie d'un nouveau nom ; création : `1050:03fa` écrit un enregistrement vide ;
- **2 = roster (édition)** : même liste avec Delete et Add (atteint depuis la vue Préférences) ;
- **3 = préférences** (Ctrl seul + clic sur le bouton Sign-in, non documenté par le manuel) : bascules **Ambient Sounds** (`2d64`) et **Click & Stick Mouse** (`02b8`), champ du **timer du Bowling** (1 à 999 s), bouton Roster ;
- **4 = Math Trivia**, ouvert par le clic sur **Poly** (tête ou corps, zones 12–13 de la table de clic) : si l'historique de touches `1018:03fd` correspond à l'une des **19 séquences** secrètes, affiche la photo `SHPL` 301–320 correspondante de `MAINSCRN.DAT` (sans 314, id `0x12d`–`0x140`), sans voix de Poly ; sinon tire sans répétition l'une des **19 trivia** (`SHPL` 400–418, dessins humoristiques de géométrie / arithmétique) et Poly raconte l'histoire `SCR 6100 + 100 × n` (`1020:1f66`). Avec Ctrl, un clic passe à la trivia suivante.

Rien dans `MATH` n'écrit de CSV : il n'y a ni écran « Progress » ni « Export File » en v1 (le manuel Deluxe les ajoute). Sur les 19 séquences, 12 sont des codes de deux lettres (initiales : hypothèse) et 7 (`mike`, `anna`, `blah`, `stan` et trois codes en `…e sam`, `…e tom`, `…e art`) ne sont pas reconstituées en entier (§10).

## 8. Interface commune

### 8.1 Hub (Control Room), scène 0

Un seul écran, **un seul étage** (`SHPL` 100 + `SCR` 1000–10400) : les « Level 1 / Level 2 » et la Boiler Room du manuel Deluxe n'existent pas en v1 ; le pupitre n'a que **3 boutons** (Quit, Help, Sign-in). Détail : [screens/common.md](screens/common.md) §2 et §9. `Enter` (`1020:0000`) : ouvre `mainscrn.dat`, joue le MIDI de transition (si Ambient Sounds), charge le fond `SHPL` 100 (5 formes : fond, pupitre, écran de télé noir, main « stop », Poly), tire 4 sons d'attente distincts (`4fce`–`4fd4`, ids 3065–3088) ; **Ctrl seul** à l'entrée coupe les animations (`874a = 1`, non documenté). L'accueil comporte trois couches (common.md §11 point 6) : accueil de première entrée (`SCR` 5000–5300), salutation après connexion (5400–5700) et introduction longue `5800` si `4fa4 = 0`. `Tick` (`1020:06f6`) lance les animations d'attente et bavardages de Poly (tirage `10a8:13af`, minuteries `4f78`, `4f9e`, `4fa8`) ; ils cessent après ≈ 30 min d'inactivité (`4f7c ≥ 0x1a5e0` ticks) ; quatre leviers du pupitre basculent des interrupteurs d'ambiance. Les clics passent par 14 + 3 + 9 enregistrements de gadgets et animent les objets du décor avant de lancer l'activité (`1020:098a`, §1.5). Si aucun joueur n'est connecté (`1e90 = 0`), le clic sur une activité joue `SCR` 5000 puis ouvre la boîte de connexion (`1020:10e2(0x10001)`) sans rien lancer.

### 8.2 Poly

Poly est une **fillette brune en salopette**, l'hôtesse du hub (`SHAP` `MAINSCRN` 104) ; ce n'est pas un perroquet (confusion possible avec Algebird, l'oiseau du Rhythm Shop). `POLLY.DAT` (113 `SCR` : 20000–…) ne contient pas de scène : ce sont ses animations d'aide dans les activités, ouvertes temporairement à la demande par `1010:4363` (+ `442d` pour la fermeture), `1030:1f86`/`2077`, `1040:17c7`/`18b8`, `1048:19f4`/`1ae5` (deux animations successives à `1108:32aa` puis `1108:32da`). Le choix introduction longue / courte dépend du drapeau « Poly a déjà présenté le jeu » **propre à chaque activité** (§7.1, et non de `4d30`, qui est celui du Bowling) ; les ids diffèrent selon l'activité et **les sources ne donnent pas la même famille** : Hidden `25100` (première fois) / `25250` (hidden.md), Patterns `35100` / `35250` (patterns.md), Sticklers `30100` / `30250` (sticklers.md, qui relève que ces ids (posés en `32de`) sont à recouper avec le décalage d'id du descripteur ; les `20100` / `20250` notés auparavant ici ne sont confirmés par aucune étude). Dans Rockets, Poly est l'adversaire (palette « Poly Palette », `1070:0bc6`, `SHPL` 999 = palette 216–231 seule).

### 8.3 Gus

`GUS.DAT` (54 `SCR`) : réactions de Gus (le gorille qui lance la boule) dans le bowling (`1010:44ef(n)` : `22000 + 100n`, `n` de 0 à 14 ; `1010:457a(n)` : `30000 + 50n`/`24950 + 50(n-31)`). Un clic sur Gus (`1010:0bc5(3)`) joue une réaction tirée parmi 3 (table d'octets `1108:0a2a`) ; Ctrl+Maj + clic joue la réaction 15 (œuf de Pâques, `1010:0c37`). Au retour au hub, `1010:0934` joue une réaction au hasard (`10a8:13af`).

### 8.4 Niveaux et sélection

Pas de sélecteur global de niveau. Le **Bowling** choisit l'opération et le niveau par ses propres boutons (variables `4b52` opération, `4d0c` niveau) : 4 niveaux plus un **bonus**, qui n'est jouable qu'une fois les 4 niveaux de l'opération réussis et tire ses problèmes au hasard parmi les sous-types des niveaux 1 à 4 ([screens/bowling.md](screens/bowling.md) §2). Les **trois jeux de puzzles** ont 3 niveaux (les « Level Brothers » : vert, orange, rouge), sans bonus, de 9 puzzles chacun, soit 27 :
- Hidden : 3 tailles de grille (4, 5, 6 cases de côté) et 3 menus de 9 photos ; la photo est choisie par la vignette, tandis que `PUZZ` `1000 + 32 × niveau + k` désigne le **découpage** (`k` de 0 à 8 tiré au hasard sans remise par niveau, `10a8:13af`, historique non sauvegardé) ;
- Patterns : `PUZZ` 6600–7900 par 50 ; le `SCR` de victoire est `20000 + 900 × L + 100 × k` ;
- Sticklers : `PUZZ` `2100 + 900 × niveau + 100 × k`.
Le niveau courant des puzzles n'est pas sauvegardé (Sticklers repart toujours du vert). Le niveau de Poly dans Rockets est caché, adaptatif (0 à 4, départ 2) et non sauvegardé.

### 8.5 Sortie

Le **bouton Quit** est le 1er du pupitre : il ouvre l'invite du sifflet (`SCR` 10300) ; un 2e clic sur le sifflet confirme (`SCR` 10100 puis `1008:02da`), un clic ailleurs annule ([screens/common.md](screens/common.md) §7). Il n'y a ni boîte « Voulez-vous quitter ? » ni sauvegarde automatique. Sorties directes : **Ctrl+Q** (§5.3), croix/SC_CLOSE, Alt+F4. Chaque activité revient au hub par son `Exit`.

### 8.6 Hall of Fame et certificats (scène 10, `1078`)

Atteint **uniquement depuis le Bowling** (bouton « trophée », `1010:0bc5(2)`). `Enter` `1078:0523` : ouvre `trophy.dat`, fond `SHPL` 107, charge les `STRL` de grades (`1018:0518`), puis `1078:0860` remplit une page de **8 joueurs** (`DAT_82b4` = page, jamais remise à 0 d'un accès à l'autre dans une session ; tri alphabétique du roster) : nom, « Rank: » + grade global, et pour chacune des 6 opérations une case, active si au moins un des 5 bits de la tranche est à 1 (`masque >> 5 × op & 0x1f`) et qui **dessine un ruban par niveau réussi** (5 rubans par cellule, bit par bit). Le grade vaut `1 + (bits de niveau 0 à 3 positionnés)` sur toutes les opérations, bonus exclu (§7.1). Les flèches (`1078:0a9f`, rappels `0c89`/`0ca7`/`0cc2`/`0cd4`) changent de page (`(joueurs - 1) / 8 + 1` pages). Le bouton « Print My Certificate » (`1078:0709` cas 3) imprime le certificat de la cellule sélectionnée pour ce joueur (`1088:0120`, §4.8) ; la sortie (`1078:06d9`) revient au bowling (`1b20 = 1`). Pas d'écran d'impression à l'écran : le certificat n'existe que sur papier ([screens/common.md](screens/common.md) §6).

### 8.7 Guide vidéo des parents (PVG)

`MATH` **ne lance rien** : aucun import `WINEXEC`/`LOADMODULE`/shell, aucune chaîne `PVG`/`QTW`/`.mov`. Le guide est un **programme séparé** : l'installeur crée un 2e élément de groupe « Parents' Video Guide » dont la commande est `$InstallFromDir$\PVG.EXE` (`MATH.BDF` section `[pgi2]`), plus « Setup for Math Workshop MPC » = `BROEMIDI.EXE` (`[pgi3]`). `PVG.EXE` lit `MPC/PVG.MHK` (`tBMP` ×128, `tPAL` ×8, `tWAV` ×4) et les vidéos QuickTime (`QTW/`, `.mov` convertis en `.mp4` côté dépôt : `INTRO`, `GETINV`, `STRAT`, `TODAY`). Hors périmètre de la réimplémentation du jeu ; à traiter comme une page/visionneuse à part.

## 9. Tableau des écrans

Complexité : S = petit (≤ 1 j), M = moyen, L = gros. « Moteur commun » (§1–§6) est un préalable à tout. « Nature » = gameplay confirmé par les études détaillées ; « Progression » = ce que la scène écrit dans le roster (§7.1) : **seul le Bowling écrit le masque de réussites**.

| Écran / activité | DAT | Entrée | Nature | Progression | Ressources principales | Code | Complexité |
|---|---|---|---|---|---|---|---|
| **Moteur commun** : lecteur `\0SCR`, ports, palette/fondus, sons, gadgets, roster | – | `1090:0094`/`111c`, `10a8`, `10a0`, `1088`, `1050` | – | – | `SCR`, `SHPL`, `SHAP`, `SNDL`, `\0SND` | segments `1090`, `10a0`, `10a8`, `1088`, `1050`, `1018` | **L** (en plusieurs tâches) |
| Titre | `TITLE` | `1068:0364` | porte d'entrée, horloge dans le décor, logo à la 1re entrée | – | `SHPL` 105/200, `SCR` 500 (horloge), 1000–5000, 10000 ; son 1000 (WAVE bouclé) | `1068` (2 Ko) | S |
| Crédits | `CREDITS` | `1078:00e4` | pages de crédits en boucle | – | `SCR` 2000, 22 `SHAP` | `1078` (animation `024a`) | S |
| Hub / Control Room | `MAINSCRN` | `1020:0000` | hub à un étage, pupitre à 3 boutons, Poly | drapeau d'introduction longue (`4fa4`) | `SCR` 93, `SND` 258, `SHAP` 1870 ; 14 + 3 + 9 enregistrements de clic, table de survol de 15 `RECT` | `1020` (8,4 Ko) | M |
| Connexion / préférences / roster / Math Trivia + séquences secrètes | `MAINSCRN` | `1080:0000` | moniteur à 4 vues (connexion, roster, préférences, trivia) | en-tête et liste des joueurs du roster | `SHPL` 100, 301–320 (photos de l'équipe) et 400–418 (trivia) ; `MWRoster` | `1080` (9 Ko) + `1018:03fd` | M |
| Bowling for Numbers (+ Gus, Poly, estimation, bonus, rang) | `BOWLING` (+`GUS`, `POLLY`) | `1010:0000` | quiz d'arithmétique à choix multiple | **masque de réussites**, niveau, strikes, sous-type, rang 1–25 | `SCR` 381, `SND` 168, `SHAP` 5291, `STRL` ×8, `TARG`/`UNIT` ×3 | `1010` (18,6 Ko) | **L** |
| Hall of Fame / certificats | `TROPHY` | `1078:0523` | tableau des rubans par joueur et opération ; impression | lecture du masque | `SHAP` 14, `STRL` 5000 (25 grades) ; `BKG`/`RIB*.WMF` | `1078` + `1088` (impression) | M |
| Rhythm Shop | `RHYTHM` + `RSHELP` + `MIDIMPC` | `1028:0f99` | fractions / mesures (Cutter, Gluer, Melder) pour reconstituer la mesure d'un morceau | niveau courant, variante par morceau, drapeau d'aide ; pas de masque | `SCR` 76, `SND` 134, `PLST` 45, `STLV`, `STRL` 30001 (45 titres) ; 45 MIDI | `1028` (16 Ko) + `1058` (6,6 Ko) + `1038` | **L** |
| Pattern Windows | `PatFill` | `1060:06f4` | coloriage de vitrail (10 motifs, 15 couleurs, kaléidoscope de palette, impression) | aucune progression ; sauvegarde du vitrail (5262 octets) | `SCR` 28, `PTRN` 10 (100 octets chacun), `STRL` 40000 (10 noms) | `1060` (7,4 Ko) + impression | M |
| Hidden Picture Puzzles | `hidden` | `1030:0000` | puzzle de polyominos (jigsaw) qui révèle une photo | drapeau Poly seul | `SCR` 28, `PUZZ` 27 (`1 + 15 n` octets : 106, 121 ou 136) | `1030` (9,1 Ko) | M |
| Puzzle Patterns | `patterns` | `1040:0000` | puzzle de dominos (jigsaw, 8 pièces de 2 cases) | drapeau Poly seul | `SCR` 28, `PUZZ` 27 (40 octets) | `1040` (7,2 Ko) | M |
| Super Sticklers | `stickler` | `1048:0000` | puzzle de lignes (fragments de dessin à coller sur un gabarit) | drapeau Poly seul | `SCR` 28, `PUZZ` 27 (`8 + 6 n` octets : 50 à 98) | `1048` (7,8 Ko) | M |
| Rockets (Nim) | `Nim` | `1070:0a37` | Nim contre Poly (IA à niveau caché de 0 à 4) ou contre un ami | drapeau d'introduction seul | `SCR` 123, `SND` 182, `SHAP` 1423 ; IA | `1070` (9 Ko) | M |
| Poly (aide) / Gus | `POLLY`, `GUS` | `1010:4363`, `1010:44ef` | animations d'aide de Poly / réactions de Gus (gorille) | – | `SCR` 113 / 54 | intégré aux scènes | S (une fois le lecteur `\0SCR` fait) |
| Guide vidéo des parents | `MPC/PVG.MHK`, `QTW/` | – (`PVG.EXE`) | programme séparé | – | `tBMP`/`tPAL`/`tWAV`, 4 vidéos | hors `MATH` | S (page à part) |

## 10. Questions ouvertes

Questions de l'ancienne version **résolues** par les études détaillées (retirées de la liste) :

- Pixel format et algorithme des `SHAP`, relèvement de palette et ordre RGB : [shap.md](shap.md) (§3.8, §4.3, §4.4).
- Rôle des zones du hub, bouton de sortie, étages, réglages, textes visibles, zones 12–13 : [screens/common.md](screens/common.md) §2, §7, §9, §11 (§1.5, §8.1, §8.5).
- Inventaire des zones de clic par scène : sections « Mise en page » / « Disposition » de chaque étude de [screens/](screens/) et [screens/common.md](screens/common.md) §1–§6.
- Grade en fonction du masque et critère de réussite d'un niveau : [screens/bowling.md](screens/bowling.md) §1.9, §2.2, §2.4 ; [screens/common.md](screens/common.md) §3.6 (§7.1).
- Variables du roster (bowling, Hidden, Patterns, Stickler, Nim, Rhythm, Pattern Windows) et rôle de `DAT_0332 = 10800` : §7.1 (études par activité).
- Sons simultanés et mixage du Rhythm Shop : [screens/rhythm.md](screens/rhythm.md) §3.1 (§6).
- `Prg#` et `SYSX` : [screens/rhythm.md](screens/rhythm.md) §2.3–2.4 (§6).
- Liste et effet des séquences secrètes : [screens/common.md](screens/common.md) §4.3 (19 séquences, photos de l'équipe) ; il reste 7 codes à reconstituer (ci-dessous).
- Boiler Room : absente de la v1 (hub à un étage, trois boutons de pupitre : [screens/common.md](screens/common.md) §9 ; [screens/bowling.md](screens/bowling.md) §0) ; le manuel de la v1 n'est pas disponible dans le dépôt.
- Progression et difficulté de Hidden / Patterns / Stickler / Rockets et formats `PUZZ`, `PTRN`, `PLST`, `STLV`, `TARG`, `UNIT` : aucune progression ni score pour les trois puzzles et Pattern Windows ; Rockets a un niveau de Poly caché et non sauvegardé ; formats dans chaque étude (§2.3).
- Id de `SNDL` des 270 scripts du bowling : [scr.md](scr.md), « Résolution `SCR` → `SHPL` et `SNDL` » (§3.7).
- Origine du décalage des 31 scripts `NIM` (question de scr.md) : [screens/rockets.md](screens/rockets.md) §2.6 (§3.7).

Questions **restant ouvertes** :

1. **Mode de blit** (quartet bas des drapeaux de cellule, `2`/`8`/`10`) : shap.md (« Dessin, modes et transparence ») lit dans `10d8:4438` une table de modes (0 copie, 1 AND, 2 OR, 3 XOR, 4 NOT…, **8 copie qui saute les octets sources à 0**, donc index 0 transparent), alors que scr.md et patterns.md la donnent encore comme non établie : désaccord de mise à jour, pas de contradiction de fond. Reste ouvert : la méthode de dessin du port qui choisit entre les blitters `4438`, `45d1` et `494d` (shap.md, points ouverts), le mode `2` (jamais dessiné) et les zéros isolés des copies littérales RLE en mode 8.
2. **Rôle de `+0x04`/`+0x0c`** des descripteurs dans les scènes où ils diffèrent (appels indirects non résolus) ; les fonctions `1038:*` sont des gadgets partagés (boutons à 3 états, tables de pièces et minuterie 4 ms du Rhythm Shop : rhythm.md, common.md §0), mais leur sémantique fine (`1038:01af`, drapeaux de groupe `0x2068` / `0x8040` / `0xc000`) n'est pas établie.
3. **Cue#** des WAVE (non lus par `MATH`) : sémantique des repères.
4. **Séquences secrètes** : préfixe et séquence complète des 7 codes `mike`, `anna`, `blah`, `stan`, `…e sam`, `…e tom`, `…e art` (common.md §12 question 1) ; les 12 codes de deux lettres sont des initiales (hypothèse).
5. **Chemin du roster** : `MWRoster` est relatif au répertoire de l'exécutable (chaîne `4a2c` vide) ; vérifier le comportement en lecture seule (CD) (common.md §12 question 4).
6. **Hooks 1 à 3, opcodes 2/4/5/6** des `\0SCR` : implémentés mais jamais présents dans les données (probablement utilisés par le code de scène, non par les 995 scripts) (scr.md).
