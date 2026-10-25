# AM1.EXE : analyseur de commandes, exécution des verbes et scripts

Étude de l'analyse du texte tapé dans *Armaeth* (`AM1.EXE`, Grandslam 1994, DOS), de l'exécution des phrases, de l'interpréteur de jetons de trois lettres (`/jeton`, fichiers `CM1..CM4`) et de l'affichage des messages. Référence pour une réimplémentation en TypeScript. Les adresses sont des `segment:offset` Ghidra (segment de base `1000`, voir `re-index.md`), les noms `gm_*` viennent de `re-index.md`, les noms `FUN_xxxx_yyyy` sont des fonctions non nommées par le projet. `DGROUP:xxxx` est un offset dans le segment de données.

Confiance : **certain** = lu dans le code (désassemblage ou décompilat recoupé), souvent aussi vérifié sur les données ; **probable** = rôle déduit du contexte ; **hypothèse** = lecture plausible non vérifiée.

Documents voisins : `formats.md` (formats `DIC`, `TMS`/`MSG`, `CM`, monde), `re-index.md` (index des fonctions), `graphics.md` (police GPH, palette), `audio.md` (jetons sonores). `engine.md` (boucle principale, objets, déplacements) et `screens.md` (écrans) sont écrits en parallèle : les sujets hors périmètre y sont renvoyés.

Scripts de travail utilisés pour les contrôles chiffrés : tables de comportements (§6.4) et classes du dictionnaire (§4) extraites directement de `AM1.EXE` et de `A1FDIC.SYS` ; messages lus avec `A1FTMS.SYS` + `A1FMSG.SYS`.

## 0. Ce qu'il faut retenir

1. **Il n'y a qu'une grammaire très pauvre** : `[verbe] [groupe nominal 1] [préposition] [groupe nominal 2]`. Les articles sont ignorés, il n'y a **aucun pronom**, aucune mémoire de « il / le » / dernier objet, aucun enchaînement de commandes : un second verbe est **jeté sans message** (§5). La seule mémoire est la dernière phrase tapée (rappel par `Inser`).
2. **Il n'existe pas de mot de direction, ni « aller », ni « examiner »** dans le dictionnaire de 669 mots (vérifié). Le déplacement se fait au clavier (flèches) et à la souris (voir `engine.md`) ; « examiner » = `regarder` / `voir` / `r` ; « nord » donne le message d'incompréhension (§5.4).
3. **Les verbes sont presque tous « vides »** : le dictionnaire compte 35 numéros de verbes (la table des gestionnaires a 36 entrées, le n° 30 n'ayant pas de mot) ; 13 ont un gestionnaire propre (`regarder`, `prendre`, `fouiller`, `mettre`/`jeter`, `inventaire`, `lire`, `briser`, `escalader`/`monter`/`descendre`, `o`, `zwygks`) ; les 23 autres appellent un gestionnaire par défaut qui ne fait que **mettre en file** un message d'échec de priorité 0. Le comportement réel (ouvrir un coffre, allumer, donner...) est dans des **gestionnaires par type d'objet** (§6.4), appelés *avant* le gestionnaire du verbe.
4. **Les messages d'échec passent par une file à priorité** (§7) : chaque gestionnaire y dépose des messages, seul le niveau de priorité le plus haut est affiché, et seulement si **aucun** gestionnaire n'a réussi.
5. **Le langage de jetons n'est pas un accès de développeur seulement** : les scripts `CM1..CM4` s'en servent pour l'amorçage, l'introduction, la fin et les conseils (§12). La saisie `/jeton` n'est limitée que par un « niveau » (`dgs`) remis à 0 à la fin de chaque script : en jeu, **seuls les jetons du groupe 0 passent** (`/dgs 99` rouvre tout), voir §11.2.
6. **Le texte est tapé dans une boîte modale** : pendant la saisie, le monde est figé (§2).

## 1. Vue d'ensemble du chemin

```
touche (3580:0004, INT 16h)
  -> 3588:0118  traduction en événement {type, donnée}          (§2.1)
  -> 1023:0016  répartiteur d'entrées (appelé par la boucle principale 18a9:0008 via 1023:000c)
       -> 1e22:0008  ouverture de la ligne de saisie             (§2.2)
            -> 1e22:02c2  automate de saisie (8 états)
                 Entrée -> 1d89:0002 gm_parse_command           (§3, §5)
                              ├ ligne commençant par « / » -> 109a:0002 gm_script_tokenize -> 124c:0002 gm_script_dispatch  (§11)
                              └ sinon : mots -> 1dd4:0156 gm_dic_lookup -> emplacements DGROUP:4cba..4d42
                                    -> 22fc:0002 gm_execute_command  (§6)
                                          ├ gestionnaires par type d'objet (1ec8:000a, tables DGROUP)   (§6.4)
                                          ├ gestionnaire du verbe                                       (§8)
                                          └ file de messages 1e58:000a / 1e58:009e                      (§7)
                                                -> 200c:0004 -> 2013:00ec gm_get_message -> 327a:0044 gm_draw_text   (§13)
scripts CM1..CM4 -> 1346:0004 gm_cm_script_step -> 124c:0002 gm_script_dispatch                       (§12)
```

`gm_parse_command` a deux appelants : la saisie (`1e22:017b`/`1e22:02c2`, état 5) et les jetons `cmd`/`exe` du groupe 4 (`105e:0004`) : un script peut donc exécuter une phrase comme si elle était tapée (§11.3).

## 2. Entrées clavier et ligne de saisie

### 2.1 Traduction des touches en événements (`3588:0118`, certain)

`FUN_3588_0118(flush, ?, attente, &type, &donnée, &brut)` interroge `gm_wait_key` (`3580:0004`, INT 16h AH=1 puis AH=0, non bloquant avec les arguments `(7,0,0)`) et renvoie un événement `{type, donnée}` :

| Type | Origine | Donnée |
|---:|---|---|
| 0 | pas de touche | - |
| 1 | touche avec un caractère ASCII (octet bas du mot INT 16h non nul) | le caractère (CP437, tel que tapé : majuscules, accents, ponctuation, `Tab`, `Ctrl-lettre`) |
| 2 | touche étendue de fonction | n° : F1-F10 = 1-10, Maj+F = 11-20, Ctrl+F = 21-30, Alt+F = 31-40 |
| 3 | Alt + lettre ou chiffre | la lettre majuscule (`Q`..`M`) ou le chiffre (`1`..`0`, `-`, `=`) |
| 4 | navigation | `Home`=1, `End`=2, `↑`=3, `↓`=4, `←`=5, `→`=6, `PgUp`=7, `PgDn`=8, `Maj+Tab`=9, `Inser`=10, `Suppr`=11, `Ctrl-Home`=12, `Ctrl-End`=13, `Ctrl-←`=14, `Ctrl-→`=15, `Ctrl-PgUp`=16, `Ctrl-PgDn`=17, `Ctrl-Break`=18 (code de balayage 0), `Ctrl-PrtSc`=19 |

Les deux tables de traduction sont dans le segment de code `3588` : types à `3588:0008 + code de balayage`, données à `3588:008d + code de balayage` (0x85 entrées ; un code de balayage hors tables renvoie 0x456 sans événement). Extraites du fichier : par exemple `0x3B..0x44` -> type 2 données 1..10 ; `0x47` -> type 4 donnée 1.

### 2.2 Ouverture : `1023:0016` (répartiteur d'entrées, certain)

Appelé à chaque itération de la boucle principale (`18a9:0008` -> `1023:000c`). Lit un événement ; **si un script `CM` tourne** (`DGROUP:4b34 ≠ 0`) tous les caractères sont ignorés et seules F1 (information) et F8 (saut du script) agissent (§12.4). Sinon, pour un événement de type 1 :

- ignorés : espace (0x20), `Entrée` (0x0D), `Retour arrière` (0x08), `Tab` (0x09), `Échap` (0x1B) ;
- `+` `=` (0x2B, 0x3D) et `-` `_` (0x2D, 0x5F) ne **n'ouvrent pas** la ligne : ils règlent le mouvement vertical du héros (champs `+0x61` ; l'aide `S021` : « (-) haut et (+) bas ») ;
- **tout autre caractère ouvre la ligne de saisie** : `1e22:0008(AX = caractère, DX = 2)`. Ce caractère est le premier de la ligne. `Inser` (type 4, donnée 10) ouvre la ligne avec l'état 4 (`DX = 4`, rappel de la dernière phrase).

### 2.3 Automate de saisie `1e22:02c2` (certain)

La ligne tient dans `DGROUP:4e0c` (longueur `4eb0`, **maximum `4eb2 = 0x28 = 40` caractères**), la dernière phrase validée dans `DGROUP:4e5e`. Les huit états :

| État | Adresse | Rôle |
|---:|---|---|
| 0 | `02dc` | vide la ligne (longueur 0), puis état 1 |
| 1 | `02e7` | redessine la boîte et le texte (`4e0c`), arme le clignotement (compteur `4a750 = 3000`), puis état 6 |
| 2 | `038a` | ajoute le caractère reçu si longueur < 40, sinon bip (`3574:0072`, DOS écrit le caractère 7) ; puis état 1 |
| 3 | `03bc` | efface le dernier caractère (si longueur > 0), état 1 |
| 4 | `03ca` | recopie `4e5e` dans `4e0c` (rappel), longueur = `strlen`, état 1 |
| 5 | `03ec` | `strcpy(4e5e, 4e0c)` (mémorise la phrase), `r = gm_parse_command(4e0c)`, restaure l'écran (`327a:05e2`), puis état **7 si `r == 0`** (réussi : fin de saisie) sinon état **4** (échec : la phrase est remise dans la ligne pour correction) |
| 6 | `0424` | sondage (`3588:0118(7,0,0)`) et clignotement du curseur ; dispatch des événements ci-dessous |
| 7 | `04aa` | ferme : recopie le fond sauvegardé (pilote vidéo `+0x32`, page 2) et **retourne** |

Événements gérés à l'état 6 : type 1 : `0x1B` -> état 7 (annule) ; `0x08` -> 3 ; `0x0D` -> 5 ; tout autre caractère (y compris espace, `Tab`, contrôles, accents) -> 2. Type 4 : `Inser` (10) -> 4 ; `Suppr` (11) -> 0. Tous les autres événements sont ignorés. **Il n'y a ni curseur déplaçable, ni insertion au milieu** : on ne peut qu'ajouter, effacer le dernier caractère ou tout effacer.

Le curseur est le caractère `_` (`DGROUP:4e0a`, octet `5F`), alterné entre la couleur du fond et celle du texte tous les 3000 sondages (rythme lié au processeur ; à remplacer par une durée en réimplémentation). Cet automate **ne rend jamais la main à la boucle principale** avant l'état 7 : le monde est figé pendant la saisie et l'exécution (messages compris).

Géométrie de la boîte (`1e22:0008`, certain) : largeur `[4dde]*0x28 + 0x2c = 244` px (4dde = largeur de cellule GPH = 5, voir `font.ts`), centrée sur 320 ; haut `y = 0xA8 = 168`, hauteur `[4de0] + 4 = 11` (cellule de 7). Rectangle extérieur creux de couleur `0xEE` (pilote `+0x6a`), rectangle intérieur rempli `0xFA` bordé `0xDD`, texte à `(x+3, y+2)` en `0xDD`/`0xEE` par `FUN_1e14_0000` -> pilote `+0x6e`. Le fond sous la boîte est sauvegardé à l'ouverture (pilote `+0x32`, page 2) et recopié à la fermeture.

**Cas particuliers** : `Entrée` sur une ligne vide ne ferme pas la boîte (`gm_execute_command` renvoie 0 pour une phrase vide, `gm_parse_command` répond 7 -> état 4 -> la ligne vide revient). Un mot inconnu ou trois groupes nominaux laissent aussi la boîte ouverte avec la phrase restaurée ; une phrase reconnue mais sans effet ferme la boîte (le message d'incompréhension est affiché par `gm_execute_command`, qui renvoie 7 comme tout succès).

### 2.4 Touches hors saisie (rappel, détail dans `engine.md`)

Types 2 à 4 de `1023:0016`, sans script en cours (tables dans le code, `1023:0216` et `1023:019e`) :

| Touche | Action | Confiance |
|---|---|---|
| F1 | `2401:0002` : plein écran du message `S021` (aide : touches et commandes) | certain |
| F2 | `23a2:0474` -> `gm_savegame_slot(1)` : sauvegarder | certain (appel) / probable (sens, d'après l'aide) |
| F3 | `23e9:000e` -> `gm_savegame_slot(0)` : restaurer | idem |
| F4 | `23ee:000a` : continuer (ressusciter). Si `4b67 ≠ 0` message `S049`, sinon `2594:043a` | probable |
| F5 | `23e9:0016` -> `gm_savegame_slot(-1)` : recommencer | idem |
| F6 | `23f0:0010` -> `14cf:000c(0x2a)` : score (messages `S042`, `S027..S035`) | probable |
| F7, F8 | `23fa:0006`, `23fa:003c` : réservés au développement (actifs si `dgs > 10`, écrivent le registre CRTC 0Ch/0Dh à 0) | probable |
| F10 | `23f0:0008` -> `3312:000a(0)` : inventaire | certain |
| Flèches, `Home`, `End`, `PgUp`, `PgDn` | vecteur de déplacement (champs héros `+0x60`, `+0x62`) : `Home` (−1,−1), `End` (−1,+1), `↑` (0,−1), `↓` (0,+1), `←` (−1,0), `→` (+1,0), `PgUp` (+1,−1), `PgDn` (+1,+1) | certain (valeurs) |
| `Alt P` / `Alt N` / `Alt A` / `Alt Z` | pas à pas / normal / ralentir / accélérer (`DGROUP:4b53`, `4b52`, `4b51`) | probable (aide `S021` + code `1023:027c`) |

Pendant un script : F1 reste active, **F8 saute** (`4b38 ← 7` puis `gm_cm_script_step(1)`), F2-F6 et F10 font un bip, F7 et F9 ne font rien.

## 3. Normalisation du texte (`gm_parse_command`, `1d89:0002`)

Certain (désassemblage lu en entier). La ligne reçue (`4e0c`) est **modifiée sur place** :

1. La table du message 10 de `MSGINT` est chargée une fois (`2065:0022(10)` -> `DGROUP:4afc:4afe`) : 72 octets, 36 paires `caractère -> remplaçant` (`//`, `::`, `--`, puis `á→a à→a â→a ä→a é→e è→e ê→e ë→e í→i ì→i î→i ï→i ó→o ò→o ô→o ö→o ú→u ù→u û→u ü→u ç→c Ç→C å→a Ä→a Å→a æ→a Æ→a É→E ÿ→y Ö→O Ü→U ñ→n Ñ→N`, en CP437).
2. `lib_strlwr` met la ligne en minuscules **ASCII** (via `_ctype`).
3. Pour chaque caractère `c` : s'il est lettre ou chiffre selon `_ctype` (bits 1, 2, 4, soit `& 7`) il est recopié tel quel. Sinon `strchr(table, c)` : trouvé -> on recopie l'**octet suivant** de la table (`é` -> `e`, mais aussi `/`, `:`, `-` qui sont conservés) ; non trouvé (espace, `'`, `,`, `.`, `?`, `!`, `Tab`, tout contrôle) -> **séparateur** : écrit une seule espace si la sortie n'est pas vide et ne finit pas déjà par une espace.
4. Conséquences : `l'épée` -> `l epee` (d'où les mots dictionnaire à une lettre : `l`, `d`, `j`, `m`, `p`, `r`, `o`) ; `chauve-souris` garde son `-` et ne correspondra pas au mot `chauvesouris` ; **les majuscules accentuées `É`, `Ç`, `Ö`, `Ü`, `Ñ` sortent en majuscules ASCII** (`E`, `C`, `O`, `U`, `N`) *après* le passage en minuscules, donc ne retrouvent aucun mot du dictionnaire (anomalie du jeu d'origine, `normalizeText` de `src/games/armaeth/data/text.ts` (réexportée sous le nom `normalize` par `engine/parser.ts`) la reproduit si on lui passe un texte déjà en minuscules).
5. Si la ligne commence par `/` : `gm_script_tokenize` (§11). Sinon l'analyse de phrase ci-dessous.

La ligne affichée à l'écran reste celle tapée ; seule la copie passée à l'analyse est normalisée (l'historique `4e5e` garde le texte brut).

## 4. Dictionnaire et classes de mots

### 4.1 Recherche (`gm_dic_lookup`, `1dd4:0156`, certain)

Entrée : un mot normalisé ; sortie : jusqu'à **60** codes `u16` (`code = classe*1000 + numéro`) dans un tableau de pile.

- Longueur significative `N = DGROUP:4b4c` (octet bas du mot 3 de l'en-tête du monde : **8** à l'état initial, sauvegardé avec la partie) : arrondi au pair supérieur, borné à **[4, 16]**. Modifiable par la commande `dictionnaire nn` (§9).
- Comparaison `strncmp(mot, entrée, N)` : deux mots sont égaux s'ils ont les mêmes `N` premiers octets **ou s'ils sont entièrement égaux** s'ils sont plus courts que `N` (le NUL est comparé). Un mot plus court que `N` qui n'est que le début d'un mot du dictionnaire **ne correspond pas** (`prend` ≠ `prendre`, `prends` ≠ `prendre` ; seul l'infinitif est dans le dictionnaire).
- Recherche dichotomique (démarre sur le dernier élément) puis balayage des voisins vers le bas puis vers le haut tant que le préfixe correspond, dans la limite de 60 codes. Doublons de codes supprimés (le doublon est remplacé par le dernier code du tableau : **l'ordre n'est pas conservé**).
- Si rien n'est trouvé et que le mot finit par `s` ou `x`, cette lettre est supprimée **dans le mot** et on recommence (jusqu'à épuisement des `s`/`x` finaux). Aucune autre règle de pluriel ou de conjugaison.
- Le dictionnaire est lu une fois (`gm_load_dic` `1dd4:002a`) : mots en `7b6c`, codes en `7b68`.
- `lookupWord` (`dictionary.ts`) reproduit ces règles ; seul l'ordre des codes diffère (sans conséquence : les candidats sont triés ensuite, §6.2).

### 4.2 Classes (`code / 1000`) : rôle de chacune

Table établie par `gm_parse_command` (rôle dans la phrase, certain) et par les gestionnaires (sens, certain/probable). Effectifs : mots du dictionnaire français (`A1FDIC.SYS`, 669 mots).

| Classe | Mots / codes | Rôle dans l'analyse | Sens et usage | Confiance |
|---:|---|---|---|---|
| (0) | - | un mot dont le premier caractère est un chiffre devient le **code `atoi(mot)`** (classe `n/1000`, 0 si < 1000) | `dictionnaire 6` lit ainsi son nombre (§9). Taper `22006` équivaut au verbe 22006 | certain |
| 1 | 18 / 8 | **préposition** : on garde `code % 1000` (une seule par phrase) | 1 `d/dans/dedans/interieur`, 2 `dehors/exterieur/hors`, 3 `dessus/sur`, 4 `dessous/sous`, 5 `avant/devant`, 6 `arriere/derriere`, 7 `avec`, 8 `a/au` | certain |
| 4 | 30 / 20 | nom (emplacement nominal) | éléments mobiles de décor (`abeille`, `rat`, `braise`, `bulle`, `chaudron`...). Résolus **dans la table de décor de la salle** (§6.3), description = message de classe `D` (4) | certain |
| 6 | 4 / 3 | nom | « méta-noms » traités par `regarder` : 6001 `objet` (liste des objets de la salle), 6002 `salle` (description de la salle), 6003 `inscription/texte` (sans effet propre, gestionnaires d'objets) | certain |
| 9 | 306 / 209 | nom | éléments de décor de la scène (`arbre`, `porte`, `banc`...), résolus comme la classe 4 ; description = message de classe `I` (9) | certain |
| 13 | 6 / 6 | **« verbe »** (emplacement du verbe) | noms propres magiques : `armaeth` 13001, `tinhuel` 13002, `erin` 13003, `tehrehanan` 13004, `ezhrimanoth` 13005, `sillerynn` 13006. Gestionnaires de la famille 6 (§9.2) | certain (rôle) / probable (sens) |
| 15 | 153 / 92 | nom | **objets manipulables** : `Num` du type d'objet = numéro du code (§6.2) ; message `O<Num>` = groupe nominal indéfini (« une petite clef en or ») | certain |
| 19 | 60 / 60 | nom | noms de lieux (`cabane`, `caverne`...) ; ne désignent aucun objet, consommés par le sort `erin` (§9.2) | probable |
| 22 | 70 / 35 | **verbe** (un seul par phrase) | les verbes ; numéro = clé de la table des gestionnaires de verbes (§6.4, §8). Le message `V<numéro>` du même numéro **n'a aucun rapport** (les messages `V001..V098` sont des réponses de gestionnaires, pas des verbes) | certain |
| 24 | 13 / 10 | **« verbe »** (commande système) | `sauvegarder` 1, `restaurer` 2, `quitter/terminer` 3, `information/informer` 4, `dictionnaire` 6, `continuer` 7, `recommencer` 8, `score` 9, `musique` 11, `volume` 12 (§9.1) | certain |
| 26 | 9 / 5 | **jeté sans effet** | articles et particules : 26001 `l/la/le`, 26002 `un/une`, 26003 `en`, 26004 `par`, 26005 `de/du` | certain |

Écart avec `dictionary.ts` : `wordRole` marque la classe 13 « verbe » et la 26 « special ». Pour 13, c'est exact en tant que *place* dans la phrase (emplacement du verbe) ; pour 26, le moteur **supprime** le code de la liste (rien n'est mémorisé). Les classes 4, 6, 9, 15, 19 vont toutes dans les emplacements nominaux.

Mots pièges / de triche : `zwygks` 22041 (verbe, §8.7), `wwww` 9022, `zzzz` 9047, `zz` 15217 (noms de classes 9/15 sans équivalent naturel : hypothèse, mots de développement ou leurres).

Verbes du dictionnaire (numéro : mots) : 1 `allumer/bruler`, 2 `eteindre`, 3 `debloquer/ouvrir`, 4 `fermer`, 5 `r/regarder/voir`, 6 `attraper/capturer/emmener/emporter/p/prendre`, 7 `fouiller`, 8 `arracher/couper`, 9 `escalader/grimper`, 10 `briser/casser/demolir/detruire`, 11 `devorer/manger`, 12 `nourrir`, 13 `monter`, 14 `descendre`, 15 `introduire/m/mettre/placer`, 16 `abandonner/j/jeter/laisser`, 17 `inventaire`, 18 `entretenir/raviver`, 19 `deplacer/pousser`, 20 `lire`, 21 `assommer/attaquer/combattre/frapper`, 22 `massacrer/tuer`, 23 `fouetter`, 24 `demander/discuter/parler`, 25 `tirer`, 26 `essuyer/frotter/laver/nettoyer`, 31 `utiliser`, 32 `donner/offrir`, 34 `boire`, 37 `embrasser`, 38 `aider`, 39 `chausser/porter`, 40 `devetir/enlever`, 41 `zwygks`, 42 `o`.

## 5. Remplissage des emplacements (grammaire acceptée)

### 5.1 Variables (certain)

| Adresse | Contenu |
|---|---|
| `DGROUP:4cba` | **code complet du verbe** (classes 13, 22 ou 24) ; 0 si absent |
| `DGROUP:4cbc` | **préposition** (`code % 1000`, 1-8) ; 0 si absente ; forcée à 8 quand le second groupe nominal n'a pas de préposition |
| `DGROUP:4cbe` | nombre de candidats du groupe nominal **direct** (≤ 60) ; liste dans `DGROUP:4cca` |
| `DGROUP:4cc0` | nombre de candidats du groupe nominal **indirect** ; liste dans `DGROUP:4d42` |

### 5.2 Algorithme (boucle `1d89:0175..02ae`, certain)

Initialisation : `4cba = 4cbc = 4cbe = 4cc0 = 0`. Pour chaque mot (`strtok` sur l'espace) :

1. Premier caractère chiffre : liste de 1 code = `atoi(mot)`. Sinon `gm_dic_lookup`. **Aucun résultat -> message `S015` (« mot non compris »), réponse 7, la saisie reste ouverte.**
2. Les codes du mot sont triés code par code (un code supprimé est remplacé par le dernier du tableau, donc l'ordre n'est pas conservé) :
   - classe **26** : supprimé ;
   - classe **1** : si `4cbc == 0` alors `4cbc ← code % 1000` **et le mot est entièrement consommé** (les autres sens du même mot sont perdus) ; sinon supprimé ;
   - classes **13, 22, 24** : si `4cba == 0` alors `4cba ← code` et le mot est consommé ; sinon supprimé (**un second verbe est jeté sans message**) ;
   - toute autre classe : conservée (candidat nominal).
3. S'il reste des candidats (`n > 0`) :
   - si `4cbe ≠ 0` **et** `4cc0 ≠ 0` : trop de noms -> `S015`, réponse 7 ;
   - choix de l'emplacement : si `4cbc == 0` : emplacement **direct** si `4cbe == 0`, sinon emplacement **indirect** avec `4cbc ← 8` (« à ») ; si `4cbc ≠ 0` : emplacement **indirect** si `4cc0 == 0`, sinon direct ;
   - le nombre et les codes sont recopiés (`memmove`) dans `4cbe/4cca` ou `4cc0/4d42`.

Autrement dit : un groupe nominal précédé d'une préposition est le complément indirect ; sans préposition le premier groupe est direct et le suivant devient indirect avec « à ». Deux groupes nominaux consécutifs sans préposition (« donner clef nain ») sont donc acceptés.

À la fin des mots : `gm_execute_command()` (§6). Valeur de retour de `gm_parse_command` : 0 si l'exécution a répondu ≠ 0, 7 sinon (les valeurs 0/7 sont les booléens « faux/vrai » du jeu ; 7 = vrai).

### 5.3 Phrases acceptées par `gm_execute_command`

Conditions initiales (`22fc:0032..00b8`) : phrase vide -> rien (`4cc4 ← 0`, retour 0) ; sinon exécution seulement si **verbe présent** (`4cba ≠ 0`) **et** (`4cbc == 0` ou complément indirect présent) **et** (pas de couple direct+indirect sans préposition, ce qui ne peut pas arriver puisque la préposition est forcée). Sinon : **message `S015`** (§6.6). Ainsi `la clé`, `dans le coffre` ou `avec` seuls donnent `S015`.

### 5.4 Ce qui n'existe pas

Directions, « aller », « examiner », « tout », « ça/cela », « il/elle », « oui/non » : absents du dictionnaire (vérifié mot par mot sur `A1FDIC.SYS`). « Mémoire de pronom » : aucune ; « plusieurs commandes » : aucune (la virgule ou « et » sont des séparateurs / un mot inconnu). Rappel de la dernière phrase : `Inser`.

## 6. Exécution : `gm_execute_command` (`22fc:0002`)

### 6.1 Variables globales (certain)

| Adresse | Rôle |
|---|---|
| `4cc2` | nombre de gestionnaires ayant **réussi** pendant cette commande |
| `4cc4` | drapeau « bavard » (7 au début ; 0 pour une phrase vide) : les gestionnaires n'affichent leur message de réussite (`V015`) que s'il est ≠ 0 |
| `4cc6` | **politique d'itération** renvoyée par le gestionnaire de verbe appelé avec `AX = 7` (§6.5) |
| `4cc8` | réaction en attente (posée par `2363:000c`, §6.7) |
| `4dc2`, `4dc8` | code du nom direct / indirect traité dans l'itération courante (0 si aucun) |
| `4dba:4dbc`, `4dbe:4dc0` | pointeurs d'objet (far) direct / indirect résolus (0 si aucun) |
| `4dc4`, `4dc6` | drapeaux A, B du candidat direct ; `4dca`, `4dcc` : ceux du candidat indirect |
| `7a08` / `7a58` | tableaux de 10 candidats indirects / directs, 8 octets chacun |
| `4bfe:4c00` | pointeur du héros (far) ; `4b84:4b86` salle courante |
| `4ae6` | drapeau « à redessiner » mis à 7 en fin de commande |

### 6.2 Résolution des noms de classe 15 en objets (`206a:0002`, certain)

Pour un code `15nnn` : tous les objets dont **`Num == nnn`** (champ `+0x00`, type de l'objet) trouvés dans (a) la liste d'objets de la **salle** du héros (`salle+0x22:+0x24`, chaînage `+0x80`) ; si le héros est lui-même contenu dans un objet (`Cod +0x5B ≠ 1`) la liste de ce conteneur ; (b) l'**inventaire** du héros (`+0x7C:+0x7E`, chaînage `+0x80`). Maximum 10. Chaque objet doit être **visible** (`219b:0000`, certain) : champ `+0x2F` (Inv) nul **et** (salle courante affichée -> pas trop sombre `197e:0272 == 0`, c'est-à-dire palette pilote `+0x0A` ≥ −0x28 ; ailleurs -> `Lum(objet) + Lum(héros) > 0x1F`).

Chaque candidat devient une entrée de 8 octets : pointeur (4), **drapeau A** (octet +4 : 7 = le héros lui-même, 1 = dans l'inventaire du héros, 0 = dans la salle), **drapeau B** (octet +5 : 7 = *à portée*, 0 sinon ; calculé par `2120:0075` pour la salle, 7 pour l'inventaire et le héros), **distance** (mot +6, carré de la distance `206a:0240`, ≤ 64000, 0 pour l'inventaire). Tri croissant par distance (tri à bulles) : **l'inventaire passe avant, puis les objets les plus proches**.

*À portée* (`2120:0075`, probable) : même salle ; écart de profondeur `+0x58` < 9 ; recouvrement horizontal à 4 pixels près (largeur `+0x4D`) ; et, pour la salle affichée, aucun autre objet « solide » (`+0x08 == 0`) dans la bande de profondeur comprise entre les deux.

Pour les noms de classes 4 et 9 il n'y a pas d'objet : la présence est testée dans la table de décor de la salle (`DGROUP:4b14`, `4b18` entrées de 10 octets, premier mot = code ; `1e08:0014(code)` renvoie l'indice ou −1).

Pour un complément indirect trouvé (`4dbe`), les candidats directs sont **complétés** : si moins de 10 candidats, `21e7:0022(Num, −1, −1, contenu de l'objet indirect)` ajoute l'objet de type `Num` contenu dans l'indirect (`« prendre la clef dans le coffre »` fonctionne même si la clef n'est pas encore visible séparément ; l'entrée a A = B = 0).

### 6.3 Boucles (`22fc:01e7..05e0`, certain)

```
pour chaque candidat INDIRECT c_i (ou une seule itération « vide » si 4cc0 == 0)
  si classe 15 : remplir 7a08 par 206a ; sinon liste vide
  4dc8 = code ; gestionnaire_indirect = table 5 [numéro]            (sauf classe 13)
  pour chaque objet indirect o_j de la liste (ou « vide »)
    4dbe/4dc0 = o_j ; 4dca/4dcc = ses drapeaux
    pour chaque candidat DIRECT c_k
      si classe 15 : remplir 7a58 par 206a (+ contenu de o_j) ; 4dc2 = code ; gestionnaire_direct = table 1 [numéro]
      pour chaque objet direct o_l (ou « vide »)
        4dba/4dbc = o_l ; 4dc4/4dc6 = ses drapeaux
        appeler  gestionnaire_indirect() ; si ≠ 0 -> « réussi »
        sinon    gestionnaire_direct()   ; si ≠ 0 -> « réussi »
        sinon    gestionnaire_du_verbe(AX = 0) ; si ≠ 0 -> « réussi »
        « réussi » : 4cc2++ ; selon 4cc6 : 0 -> terminer tout ; 2 -> passer à l'indirect suivant ; autre -> continuer
```

Remarques : (1) les gestionnaires d'objet sont appelés **avant** le gestionnaire du verbe et peuvent le désactiver pour l'itération (`22fc:065b` met le pointeur du gestionnaire de verbe à 0, appelé par `2420:011e`) ; (2) `4dc2` etc. restent les **codes de mots** même pour les classes 4, 6, 9 : les gestionnaires de verbe y lisent le nom (`regarder arbre` : classe 9) ; (3) la valeur de `4cc6` dépend du verbe : `regarder` et `fouiller` -> 3 (tout parcourir ; `fouiller` (`32f6`) n'est pas de politique 0 : il appelle le prologue de `regarder`), `prendre`/`inventaire`/défaut -> 0 (s'arrêter au premier succès). La politique 2 passe à l'**objet indirect suivant** (pas au nom suivant) ; elle est prévue par le code mais **aucun verbe ne la produit** (`objects.md` § 1.3) ; (4) les **clics** de l'interface n'appellent pas `22fc:0002` mais `2210:0008`, qui répète la même séquence (indirect, direct, verbe) avec `4cc4 = 0` et sans résolution de noms ni boucles sur les candidats (`interface.md` § 5.3).

### 6.4 Tables de gestionnaires (`1ec8:000a`, certain)

`FUN_1ec8_000a(AX = clé, DX = famille 0..9)` renvoie un pointeur far de gestionnaire (ou 0) par **dichotomie** dans une table d'entrées de 6 octets `{clé u16, offset u16, segment u16}` (segment du fichier + 0x1000 en mémoire Ghidra) en DGROUP :

| Famille | Table (DGROUP) | Entrées | Clé | Porte (`4b1e`) | Appelants / rôle |
|---:|---|---:|---|---|---|
| 0 | `0a2c` | 36 | n° du verbe de classe 22 | non | gestionnaire de verbe (`22fc:017f`) |
| 1 | `07ca` | 46 | `Num` de l'objet **direct** | oui (défaut `10c8:0130` = `MOV AX,7 ; RETF`) | `22fc:0438` |
| 2 | `0732` | 25 | `Num` d'objet | oui (défaut `10c8:0006`, vraie fonction) | appelée par le moteur (`1890:0006`, `2210:*`) : `Fct` des personnages (`characters.md` § 2) |
| 3 | `09f4` | 9 | `Num` d'objet | non | moteur (hors analyseur) |
| 4 | `0b06` | 11 | n° de la commande système (classe 24) | non | `22fc:00e9` |
| 5 | `08e0` | 20 | `Num` de l'objet **indirect** | oui (défaut `10c8:0134` = `MOV AX,7 ; RETF`) | `22fc:0269` |
| 6 | `0b4a` | 6 | n° du nom de classe 13 | non | `22fc:017f` (avec `DX = 6`) |
| 7 | `0b70` | 3 | 1, 2, 5 | non | `Fct` des objets **`INT`** : 1 curseur (`1564:0004`), 2 bouton désactivé (`1537:000e`), 5 joyau (`1611:000c`) ; rôle établi (`interface.md` § 3) |
| 8 | `09a4` | 13 | `Num` (dont 1001-1003, 2000, 2001) | non | procédures des **événements différés**, appelée par `23a2:0250` (`engine.md` § 9.3, `objects.md` § 8) |
| 9 | `095a` | 12 | `Num` d'objet | oui (défaut `2363:03ec`) | réaction « trop loin » ; clé = `Num` du **héros contrôlé** (`2363:000c`, § 6.7, `objects.md` § 7) |

« Porte » : si `DGROUP:4b1e[clé / 100]` vaut 0 (10 mots, indice 0 à 9), la famille renvoie le gestionnaire par défaut au lieu de chercher. Les défauts des familles 1 et 5 renvoient 7 sans rien faire : porte fermée, toute commande sur un objet de ce groupe est « réussie » en silence. **Condition d'appel (corrigée, `objects.md` § 1.2)** : les familles 1 et 5 ne sont appelées que si **au moins un objet est résolu** (`22fc:0432`, `iRam47f8e ≠ 0`) et si le nom n'est pas de classe 13 ; la clé est le **nombre du nom** (`code % 1000`, égal au `Num` du type d'objet), pas le `Num` d'un objet précis : un gestionnaire sert tous les objets de ce `Num`. **Seul le jeton `cle`** écrit cette table (`cle g v`), et `CM2` exécute `cle 0..3, 7` : les gestionnaires dont la clé est < 400 sont donc activés par l'introduction. (Jeu complet : un jeu restauré sans passer par `CM2` ne les aurait pas.)

La clé des familles 1, 2, 5, 9 est le nombre d'un nom de classe 15 : `1[…]`, `3 oiseau/pie`, `4 ours/fourrure`, `9 coffret`, `12 torche`, `16 stèle/dalle/inscription`, `18 feu/braise`, `20 ronce`, `21`/`110`/`319 coffre`, `27 serrure`, `101 homme/Prytwen/voleur`, `103 grille/porte`, `105 pépite`, `108 clef/trousseau`, `113 armoire`, `114 torchère`, `115 inscription/graffiti`, `201..204`/`301 nain`, `210 porte/poterne`, `212 parchemin`, `302 monstre/Sarhul`, `303 Minas/sorcière/Thyl`, `304 fiole/elixir`, `305 grimoire`, `308 planche`, `310 vanne`, `311 gigot`, `315 boule`, `316 grille`, `317 herse`, `324/334 serrure`, `327 crapaud`, `328 couronne`, `332 bouteille/hydromel`. Le détail des gestionnaires d'objet (familles 1 et 5) est au `objects.md` § 4, celui des `Fct` des personnages (adresses `28b1`, `2a44`, `2cdf`, `2dd9`...) au `characters.md` § 2 et § 7 à § 8.

Table des verbes (famille 0), clé -> gestionnaire :

| Clé | Verbe | Gestionnaire | Confiance |
|---:|---|---|---|
| 1-4, 8, 11, 12, 18, 19, 21-26, 30-32, 34, 37-40 | `allumer`, `eteindre`, `ouvrir`, `fermer`, `arracher`, `manger`, `nourrir`, `raviver`, `pousser`, `attaquer`, `tuer`, `fouetter`, `parler`, `tirer`, `nettoyer`, `utiliser`, `donner`, `boire`, `embrasser`, `aider`, `porter`, `enlever` | `333c:0008` (défaut, §8.1) | certain |
| 5 | `regarder` | `33b2:0007` | certain |
| 6 | `prendre` | `3371:000d` | certain |
| 7 | `fouiller` | `32f6:000c` | certain |
| 9, 13, 14 | `escalader`, `monter`, `descendre` | `3332:0004` | certain (adresse) / hypothèse (rôle) |
| 10 | `briser` | `3311:0004` | certain |
| 15, 16 | `mettre`, `jeter` | `3340:0001` | certain |
| 17 | `inventaire` | `3312:000a` | certain |
| 20 | `lire` | `3316:0004` | certain |
| 41 | `zwygks` | `3317:000a` | certain (adresse) |
| 42 | `o` | `332e:0000` | certain |

(Les noms de fonction de ce document suivent Ghidra (`3371:000d`, `33b2:0007`, `3340:0001`). L'octet qui précède n'est pas un « remplissage » : c'est le `PUSH CX` du prologue (sonde de pile `CX = 10 ; CALL 3938:094e`). Les adresses inscrites dans la table (`3371:000c`, `33b2:0006`, `3340:0000`) sont donc les **vraies entrées** ; `fouiller` appelle d'ailleurs `33b2:0006`, `objects.md` § 3.6.)

### 6.5 Protocole d'un gestionnaire de verbe

Appel `AX = 7` : « interrogation » : le gestionnaire ne fait rien et renvoie la **politique** (stockée en `4cc6`) : 0 pour la plupart, 3 pour `regarder` et `zwygks`. Appel `AX = 0` : exécution ; la valeur de retour est 0 (non traité) ou 7 (traité). La plupart des échecs déposent un message dans la file (§7) **puis renvoient 0**.

### 6.6 Après les boucles (`22fc:05e3..0634`, certain)

1. Si aucun succès (`4cc2 == 0`) et réaction en attente (`4cc8 ≠ 0`) : `2363:0154` (§6.7) et `4cc2++`.
2. Si toujours aucun succès : `1e58:009e()` affiche la file ; si elle était vide -> **message `S015`** (AX = 'S', DX = 15).
3. `4ae6 ← 7` (redessin), retour 7.

Cas particuliers avant les boucles : classe de verbe 24 -> gestionnaire famille 4 appelé directement (`22fc:0118`), puis fin ; **sans héros** (`4bfe:4c00 == 0`) : message `S016` (octet `4b67 == 0`) ou `S049` (sinon), retour 7 ; classe 13 -> famille 6 (le « verbe » est un nom propre), les gestionnaires d'objets sont ignorés.

### 6.7 Réactions (`2363:000c`, `2363:0154`, probable)

`2363:000c(cible)` cherche le gestionnaire de **famille 9** de clé = `Num` du **héros contrôlé** (`4bfe`, et non de l'objet visé) et l'appelle avec le héros : il répond vrai (7) si le personnage est disponible (`Ego` 0, 1 ou 8 pour Killian ; table dans `objects.md` § 7), sinon affiche `V093` et répond faux. Si vrai, il mémorise le contexte (verbe, préposition, `Ser` et `Typ` des objets direct, indirect et visé dans `47f92..47fa4`) et arme `4cc8`. `2363:0154`, appelé en fin de commande sans succès, retrouve la cible par `Ser`/`Typ` (`1a7b:02b7`) et lance la marche (`22ef:0000`, au plus deux essais) puis efface `4cc8` et le champ `+0x43` du héros ; la commande est **rejouée** par `2363:01ea` (appelée par les `Fct` des acteurs à l'arrivée d'un trajet : `objects.md` § 1.5, `characters.md` § 4.4). Ce n'est donc **pas** une « réaction des PNJ / monstres » : c'est le mécanisme « trop loin, j'y vais puis je recommence » (certain pour la structure, probable pour les codes). **Qui marche vers qui** : `objects.md` § 1.5 lit « le héros marche vers la cible » (cohérent avec « prendre la clef » de loin), `characters.md` § 13 lit « le personnage marche vers le héros ». **Tranché sous DOSBox-X (`dosbox.md` § 4.1)** : c'est **le héros** qui marche vers l'objet, puis la commande est rejouée (`V084` pour l'armoire de la salle 105 sans Prytwen ; pas de fenêtre `V008`) ; seule exception, le gestionnaire propre à Prytwen : en sa présence dans la salle 105 le héros ne bouge pas, **Prytwen** marche vers lui et dit `G119` (« n'aime pas que l'on fouine… »). Les verbes de classe 13 ont des gestionnaires précis (`characters.md` § 9.4) ; le verbe 39 (*chausser/porter*) sur la couronne déclenche le couronnement (`characters.md` § 10.1).

## 7. Messages et file à priorité

### 7.1 Identifiants (certain)

`gm_get_message(AX = classe, DX = numéro)` : la classe est une lettre (`toupper(c) - 0x40`) ou un petit nombre (`n + 0x1E` si < 0x41) ; id = `classe*1000 + numéro` ; recherche dichotomique dans `A1FTMS.SYS`. **Message absent : remplacé par le message `S045`** (puis, s'il manque aussi, par une chaîne fixe en `DGROUP:51f0`).

Classes présentes (vérifiées sur `A1FMSG.SYS`) et usage dans l'analyseur :

| Classe | Lettre | Usage |
|---:|---|---|
| 3 | C | passages barrés (`3101`...) |
| 4, 9 | D, I | descriptions des éléments de décor (classes de mots 4 et 9) |
| 5 | E | erreurs système (`5011`, `5012`) |
| 7 | G | accidents / événements de déplacement |
| 12 | L | description de la salle (numéro = id de salle, `12000` = écran d'interface) |
| 15 | O | **groupe nominal indéfini** du type d'objet (« une petite clef en or ») : listes d'objets |
| 19 | S | messages système : `S015` incompréhension, `S016`/`S049` plus de héros, `S021` aide, `S027..S043` score et abandon, `S045` message perdu, `S070..S072` fins d'épisode |
| 22 | V | réponses des gestionnaires de verbes (`V001..V098`) |
| 26 | Z | accidents de terrain (lave) |
| 30-38 | 0-8 | **descriptions d'objets** : classe = 30 + octet `+0x2D` de l'objet (« état », 0 à 8), numéro = `Num` |

### 7.2 File à priorité (`1e58:000a`, `1e58:00d8`, `1e58:009e`, certain)

`1e58:000a(AX = priorité, DL = classe, BX = numéro)` :
- priorité < niveau courant (`DGROUP:4ed2`) : ignoré ;
- priorité > niveau : **vide la file**, niveau ← priorité ;
- puis ajoute `(classe, numéro)` s'il n'y est pas déjà (au plus 10 ; octets de classe en `4eb4`, mots de numéro en `4ebe`, compte en `4ed4`).

`1e58:00d8` remet niveau et compte à 0 au **début** de chaque commande (`22fc:0029`). `1e58:009e` affiche les messages dans l'ordre **inverse** de l'ajout (du dernier au premier), chacun dans sa fenêtre et avec attente (§13), et renvoie le compte. Il n'est appelé que s'il n'y a eu **aucun succès** : les messages mis en file par des gestionnaires qui ont échoué *puis réussi autrement* sont donc perdus.

Priorités observées : 0 (défaut du verbe, §8.1), 1 (« rien de tel ici » sur un nom de classe 15), 2, 3 (états de l'objet : caché, déjà possédé, trop loin, pas un conteneur...), 4 (« trop chargé »), 8-10 (descriptions : décor 8-9, objet 10).

## 8. Gestionnaires de verbes

Convention des messages : `V0nn` = classe 22, numéro nn ; le champ d'objet `Inv` = octet `+0x2F` (caché), `Ram` = `+0x1E` (ramassable), `Ctn` = `+0x1F` (conteneur), `Pds`/`Chg` = poids `+0x1A`/capacité `+0x1C`. Textes cités par leur identifiant ; extraits courts en vérification seulement.

### 8.1 Défaut `333c:0008` (23 verbes, certain)

`AX ≠ 0` -> 0. Sinon met en file, **priorité 0**, `V023` s'il n'y a **ni nom direct ni nom indirect** (`4dc2 == 0 && 4dc8 == 0`), `V029` sinon ; renvoie 0. Les verbes sans gestionnaire de type d'objet aboutissent donc à ces messages, sauf si un gestionnaire d'objet a réussi (aucun message) ou a mis en file un message plus prioritaire.

### 8.2 `regarder` (verbe 5, `33b2:0007`, certain) : « examiner »

Politique : 3. Exécution (`AX = 0`) :
1. Obscurité (`197e:0272 ≠ 0`) : message direct `V041` (« trop noir »), succès (7).
2. **Complément indirect résolu** (`4dbe`, p. ex. `regarder dans le coffre`) : objet caché `Inv ≠ 0` -> file `V026` (priorité 3) ; préposition ≠ `dans` (1) -> `V035` (3) ; indirect non conteneur (`Ctn == 0`) -> `V029` (3) ; non à portée (`4dcc == 0`) : `2363:000c` + `V008` (3) ; indirect = héros : retour 0 ; si un objet direct résolu n'est pas contenu dans l'indirect -> `V022` (4). Sans nom direct : contenu non vide -> `1664:0004(indirect)` (affiche le contenu dans le panneau), succès ; vide -> `V033` (4) ; nom direct de classe 15 non trouvé -> `V022` (1).
3. **Sans indirect résolu mais avec un nom indirect** (`4dc8 ≠ 0`) : `6002` -> liste des objets de la salle (`21ad:000a`), succès ; classe 15 -> `V026` (1) ; autre -> `V029` (0).
4. **Sans indirect, objet direct résolu** (`4dba`) : objet caché -> `V026` (prio 3) ; sinon **file `(classe = octet +0x2D, numéro = Num)` priorité 10** : c'est la description de l'objet dans son état courant (classes 30-38). Renvoie 0 : elle est affichée en fin de commande.
5. **Sans objet, nom direct de classe 4 ou 9** : décor présent -> description `D`/`I` en file (priorité 9 pour 4, 8 pour 9) si non vide ; absent -> échec si `4cc4 ≠ 0`.
6. **Nom direct de classe 6** : 6001 `objet` -> liste des objets de la salle (`21ad:000a`, messages `V031` « rien » / `V032` « Je vois »), succès ; 6002 `salle` -> `200c:0004('L', numéro de la salle)`, succès ; 6004 -> `V038` (priorité 1) ; autre 6xxx -> `V029` (priorité 0) (`objects.md` § 3.2).
7. **Aucun nom** : si un autre gestionnaire a déjà réussi (`4cc2 ≠ 0`) retour 0 ; sinon `regarder` se comporte comme `regarder salle` (le code charge le code 6002 = 0x1772).

### 8.3 `prendre` (verbe 6, `3371:000d`, certain)

Politique : 0 (le premier succès arrête tout). Décisions :
- **Objet direct résolu, sans indirect** : déjà possédé (A ≠ 0) -> file `V039` (3) ; objet = héros -> `V029` (3) ; **à portée** (B ≠ 0) : `Ram ≠ 0` ? poids `Pds(objet) + Pds(contenu du héros) ≤ Chg(héros)` (`20ac:0060`) ? -> `19dc:0000(héros, objet, mode 2)` (l'objet entre dans l'inventaire), `V015` si `4cc4 ≠ 0`, succès ; trop lourd -> `V021` (4) ; `Ram == 0` -> `V020` (3). **Hors de portée** : obscurité -> `V041` ; `Ram` et poids ok -> `2363:000c` + `V008` (3) ; sinon `V021`/`V020`.
- **Avec complément indirect résolu** (`dans X`, `à X`) : `X` caché -> `V026` (3) ; non conteneur -> `V029` ; préposition ni `dans` ni `à` -> `V023` ; X hors de portée -> `V008` ; objet direct non contenu dans X -> `V022` (3) ; sinon même transfert qu'au-dessus.
- **Nom direct non résolu** : classe 4/9 : décor présent -> `V020` (2), absent -> `V026` (0) ; classe 15 -> `V026` (1) ; autre -> `V029` (0). Idem pour un nom indirect non résolu.

### 8.4 `mettre` / `jeter` (verbes 15, 16, `3340:0001`, certain : algorithme complet dans `objects.md` § 3.4)

Un seul gestionnaire pour deux verbes (le numéro est relu en `4cba`). Contrôles : obscurité, objet direct déjà tenu (`2f`), cible conteneur (`Ctn`), prépositions `dans`/`sur`, atteignabilité, puis `19dc:0000` pour déplacer l'objet (conteneur ou salle) ; échecs en file. **Algorithme complet : `objects.md` § 3.4.** `V040` n'appartient pas à `3340:0001` mais au gestionnaire du coffret (`2566:000e`) ; `mettre` ne contrôle ni capacité ni poids (seules les familles 5 refusent).

### 8.5 `inventaire` (verbe 17, `3312:000a`, certain)

Politique 0. Si le héros existe : `21ad:000a(AX = 0x24 → V036 « rien », DX = 0x25 → V037 en-tête, BX = 7, liste = inventaire du héros +0x7C)` : écrit l'en-tête puis le nom (`O<Num>`) de chaque objet non caché, un par ligne, dans une fenêtre ; succès. F10 appelle le même code (`3312:000a(0)`).

### 8.6 `fouiller` (7, `32f6:000c`), `lire` (20, `3316:0004`), `briser` (10, `3311:0004`), `o` (42, `332e:0000`), `escalader`/`monter`/`descendre` (`3332:0004`)

- `fouiller X` (`32f6:000c`) = `regarder dans X` : sauve les variables, déplace le nom direct en indirect avec `4cbc = 1`, appelle `33b2:0006`, restaure ; refuse s'il y a déjà les deux noms (retour 0) (certain).
- `lire` : met en file `V098` (priorité 0) -> « essayez plutôt de regarder » (certain).
- `briser` : `V052` (priorité 0) (certain).
- `o` (« objets ») : obscurité -> `V041` ; sinon liste des objets de la salle comme `regarder objet` (`21ad:000a(0x1f, 0x20, 0)` sur `salle+0x22`) (certain).
- `3332:0004` (`objects.md` § 3.9, certain pour les adresses, probable pour le sens vertical) : sur la case du héros, `Sol` ∈ 7..10, 23..26 ou 40..43 (échelles, escaliers) -> `Ver = +1` et succès quel que soit le verbe ; sinon, si `Dep ∈ {2, 4}` : `Ver = +1` pour `descendre`, `-1` pour `monter` / `escalader` ; sinon `V044`, échec. `lire`, `briser`, `zwygks` et `o` sont confirmés (`objects.md` § 3.7, § 3.8, § 3.10) ; `fouiller` n'est pas de politique 0 : il appelle le prologue de `regarder` (politique 3).

### 8.7 `zwygks` (verbe 41, `3317:000a`, probable)

Politique 3. Désigne un objet par un nom de classe 15 (ou par un pointeur déjà résolu) et le place dans l'inventaire du héros (`19dc:0000`/`19dc:04f1`, mode 2), même s'il n'est pas visible (`1a7b:03b0` cherche dans les listes globales). Avec un nom direct de classe 15 sans objet résolu, `zwygks` met dans l'inventaire **tous** les objets de type 2 de ce `Num` (`objects.md` § 3.10). Mot absurde, à effet de **triche** (hypothèse sur l'intention).

## 9. Commandes système (classe 24) et noms propres (classe 13)

### 9.1 Famille 4 (clé = numéro, appelée avec le verbe seul)

| Clé | Mots | Gestionnaire | Rôle | Confiance |
|---:|---|---|---|---|
| 1 | `sauvegarder/sauver` | `23e9:0004` | `gm_savegame_slot(1)` | certain |
| 2 | `restaurer` | `23e9:000e` | `gm_savegame_slot(0)` | certain |
| 3 | `quitter/terminer` | `2404:0002` | `14cf:000c(0x2b)` (`S043`) puis `gm_cm_script_step(9)` = **CM4** (conseils) qui se termine par `xit` | certain |
| 4 | `information/informer` | `2401:0002` | plein écran `S021` | certain |
| 5 | (aucun mot) | `23f1:000a` | simple `RETF` | certain |
| 6 | `dictionnaire` | `23f1:0074` | `23f1:000c(n)` : n = premier nom nominal numérique (`dictionnaire 6`), 8 par défaut ; `±` : −1 -> N−2, 1 -> N+2, impair -> n+1 ; hors [4, 20] -> erreur fatale `MSGINT 9` ; écrit `4b4c` | certain |
| 7 | `continuer` | `23ee:000a` | `S049` si `4b67 ≠ 0`, sinon `2594:043a` (résurrection) | probable |
| 8 | `recommencer` | `23e9:0016` | `gm_savegame_slot(−1)` | certain |
| 9 | `score` | `23f1:0000` | `14cf:000c(0x2a)` | probable |
| 11 | `musique` | `23eb:0000` | `2fe0:0026(0)` (module son) | probable (appel) |
| 12 | `volume` | `23eb:0008` | lit le nombre tapé (`4cbe`/`4cca`) pour régler le volume | hypothèse |

### 9.2 Famille 6 (noms propres de classe 13), tous après `AX == 0`

| Clé | Nom | Gestionnaire | Comportement relevé | Confiance |
|---:|---|---|---|---|
| 1, 2 | `armaeth`, `tinhuel` | `3443:0008`, `3443:0018` -> `3443:0028` | `armaeth` **ferme**, `tinhuel` **ouvre** la herse de granite (`Num 207`), seulement dans les salles `0xCA` (202) et `0x131` (305) (sinon `V217`) ; réponses selon l'état `Ego` de la herse, aléa `1/compteur` pour `V214`/`V215` (`objects.md` § 5) | certain |
| 3 | `erin` | `3474:000c` | `erin <lieu de classe 19>` : exige le **talisman** (`Num 321`) dans l'inventaire, trouve la salle `gm_find_scene(numéro du lieu)` et **téléporte** le héros (animation de départ 18, `+0x3F ← 6`, `19dc:0000`) (`objects.md` § 5) | certain |
| 4 | `tehrehanan` | `3454:000c` | exige la baguette (`Num 320`) et la bouteille (`Num 332`) : `Ego 0 -> 1`, `V380`, `score(3, 12)` (30 points) | certain |
| 5 | `ezhrimanoth` | `346c:0008` | exige la baguette et la fiole (`Num 304`) : `Ego 0 -> 1`, `V350`, `score(3, 11)` (30 points) | certain |
| 6 | `sillerynn` | `345e:0004` | exige le talisman : remplace le seau (`Num 25`) par la couronne (`Num 328`), `score(3, 13)` (30 points), jingle, `V355` | certain |

## 10. Récapitulatif des variables de commande hors `4cxx`

`DGROUP:4b34` script en cours ; `4b67` « aventure terminée » (hypothèse : `S016` si 0, `S049` sinon quand le héros n'existe plus, `continuer` n'agit que si 0) ; `4b36` « cnt » ; `4b38` mode saut ; `4b42` pause ; `4b50` contrôle du héros autorisé ; `4b66` délai de lecture (§13.4) ; `4b3a/4b3c/4b3e` couleurs du texte scripté (`ecr`) ; `4b4c` lettres significatives ; `4b1e..4b30` portes des gestionnaires ; `05ea` niveau de groupe autorisé (`dgs`) ; `4cac` souris active (`mse`) ; `4b53/4b52` pause du jeu ; `4b51` diviseur de vitesse ; `4b54/4b55/4b56` heure (`heu`).

## 11. Interpréteur de jetons

### 11.1 Découpage (`gm_script_tokenize`, `109a:0002`, certain)

Entrée : la ligne normalisée commençant par `/`. Exigences : au moins 4 caractères, sinon bip (`3574:0072`) et retour 0. Les **trois caractères qui suivent `/`** sont cherchés par `strstr` dans les 11 chaînes de groupes (`DGROUP:05ee`, un pointeur far par groupe, nombre en `05ec = 11`) : chaque chaîne est une suite de jetons de 3 lettres séparés par une espace ; l'indice du jeton = position / 4 (`strstr` accepte donc un faux positif à cheval sur deux jetons). Non trouvé : bip, 0. Les 16 arguments `DGROUP:763c..` sont remplis avec `0xFFFF`. Si la ligne dépasse 5 caractères : `strtok` sur l'espace à partir du 6e caractère, `atoi` de chaque morceau (16 au plus). Variante : un `*` en 6e position (`/ttl * texte`) dépose le **reste de la ligne** comme texte (début à l'offset 7) sans argument. Le texte transmis est vide sinon. Appelle `gm_script_dispatch(groupe, indice, args, texte)`.

### 11.2 Répartiteur (`gm_script_dispatch`, `124c:0002`, certain)

`groupe < 0`, `groupe > 10` ou **`groupe > DGROUP:05ea`** -> bip, retour 0. Sinon saute à `[DGROUP:00C6 + 4*groupe]`. `05ea` vaut **0** au démarrage ; `dgs n` l'écrit. Les scripts `CM` commencent par `dgs 99` (ou 9 pour `CM4`) puis finissent par `dgs 0` : **un `/jeton` tapé en jeu n'est exécutable que dans le groupe 0**, jusqu'à ce que le joueur tape `/dgs 99` (qui est dans le groupe 0). Les valeurs de retour des gestionnaires sont 7 (succès) ou 0 (échec avec bip).

### 11.3 Entrée `/` depuis la saisie ou depuis un script

La saisie `/inf 5` passe par `gm_parse_command` (normalisation de la ligne : minuscules, séparateurs en espaces, `-` conservé -> `-1` reste utilisable). Un script peut taper une phrase avec les jetons `cmd` (affiche puis exécute) ou `exe` (exécute) du groupe 4.

### 11.4 Les 119 jetons

Tous les gestionnaires prennent `(indice du jeton, arguments, texte)`. « a0.. » = arguments. Un argument absent vaut `0xFFFF` (−1). **Résolution d'objet** : `gm_resolve_object_ref(args, i)` (`1118:0008`, certain) lit `args[i]` : si `< 1` -> le héros (`4bfe`) ; sinon l'objet de ce `Num` dans la liste d'objets de la salle courante (`21e7:003c`, avec plage d'état optionnelle), à défaut dans les listes globales (`1a7b:02b7`). Adresse = case dans le gestionnaire (offset donné par la table de sauts du gestionnaire, extraite du fichier).

**Groupe 0 : `139a:0006` (contrôle des scripts)**

| Jeton | Args | Effet | Case | Confiance |
|---|---|---|---|---|
| `fin` | - | `4b38 ← 0` (fin du mode saut, §12.4) | `139a:001e` | certain |
| `rem` | - | aucun (commentaire), retour 7 | `139a:00e0` | certain |
| `nop` | - | idem | `139a:00e0` | certain |
| `sys` | a0 | `gm_cm_script_step(état = a0)` : lance ou enchaîne un script (§12.2) | `139a:002c` | certain |
| `cnt` | a0 | `4b36 ← a0` : « continuer » sans rendre la main (§12.3) | `139a:0036` | certain |
| `dgs` | a0 | `05ea ← a0` : plus haut groupe accepté (§11.2) | `139a:0042` | certain |
| `xit` | - | `gm_quit(0, 0)` : quitte le jeu | `139a:004e` | certain |
| `sec` | - | efface (24 octets à 0) le bloc de liaison du pilote vidéo `DGROUP:0eb8` en conservant son pointeur `+0x14` : réinitialise la liaison pilote | `139a:005a` | certain (effet) / probable (but) |
| `mse` | a0 | `4cac ← a0` : sondage de la souris actif | `139a:00a6` | certain |

**Groupe 1 : `1250:0008` (temps, lumière, palette)**

| Jeton | Args | Effet | Case | Confiance |
|---|---|---|---|---|
| `heu` | a0, a1, a2 | heure du jeu : `4b54 ← a0` (défaut 23), `4b55 ← a1` (défaut 59), `4b56 ← a2` (défaut 99) | `1250:0034` | certain |
| `lum` | a0, a1 | `4ae2 ← a0`, `4ae4 ← a1`, `4ae6 ← 7` : niveau de luminosité cible (le moteur ajuste la palette) | `1250:0072` | probable |
| `trf` | a0 | si a0 > 0 : trouve la salle `a0` (`gm_find_scene`) et la fixe comme destination (`4b80`, `10dc:00b2`) ; si le héros est de type OBJ (`Typ 2`) il y est aussi envoyé (`+0x3F ← 6`, `+0x66 ← id de salle`) | `1250:0092` | probable |
| `ral` | a0 | `4b51 ← a0` (0..255) : diviseur de vitesse du jeu | `1250:00bc` | probable |
| `lmr` | a0, objet a1 | `objet+0x0A ← a0` (`Lum`) | `1250:00d8` | certain |
| `wat` | a0 | attente de `a0` tics BIOS (18,2 Hz) (`gm_delay_ticks`) | `1250:00ea` | certain |
| `rvb` | a0, a1, a2 | palette du pilote avec décalages (R, V, B) : `pilote+0x4a(palette 4b04, a0, a1, a2)` | `1250:00fa` | certain |

**Groupe 2 : `10f2:0008` (tracé, débogage)**

| Jeton | Args | Effet | Confiance |
|---|---|---|---|
| `rlf` | ? | `gm_draw_line()` (`12c2:000c`) : tracé de ligne direct en `A000` ; arguments lus par la fonction | probable |
| `rel` | ? | idem | probable |
| `vue` | objet a0 | `305e:0002` + `1140:000a(objet, …)` : tracé d'un cadre autour de l'objet | hypothèse |

**Groupe 3 : `10fb:0006` (informations de débogage)**

| Jeton | Args | Effet | Case | Confiance |
|---|---|---|---|---|
| `inf` | objet a0 | `gm_dump_object` : fenêtre de tous les champs de l'objet | `10fb:001e` | certain |
| `loc` | objet a0 (> 0) | affiche la position : « salle nnn » (`Cod 1`), « objet nnn » (`Cod 2`), « Nulle Part » ou « Erreur » (chaînes `DGROUP:0056..007a`, numéro à 3 chiffres écrit dans le gabarit) | `10fb:004c` | certain |
| `dec` | - | pour chaque entrée de la table de décor de la salle (`4b14`, 10 octets) de classe 4 : affiche son message | `10fb:00e4` | certain |
| `img` | - | idem pour la classe 9 | `10fb:00fe` | certain |
| `pos` | objet a0 | `21ad:000a(0x20, liste +0x7C de l'objet)` : liste son contenu | `10fb:0138` | probable |
| `dic` | a0 | `23f1:000c` : comme `dictionnaire n` | `10fb:0172` | probable |
| `exp` | objet a0 | `1664:0004(objet)` : désigne l'objet comme suivi (`DGROUP:3b76`, drapeau `4c16`) | `10fb:017e` | hypothèse |

**Groupe 4 : `105e:0004` (texte et phrases)**

| Jeton | Args | Effet | Case | Confiance |
|---|---|---|---|---|
| `aut` | a0 (≥ 0) | `4b66 ← a0` : délai de lecture automatique en tics (0 = attendre une touche, §13.4) | `105e:001c` | certain |
| `aff` | texte | affiche le texte dans la fenêtre par défaut, **couleurs de `ecr`** (`4b3a/4b3c/4b3e`), restaure ensuite couleurs et délai | `105e:0030` | certain |
| `dsp` | texte | comme `aff`, avec délai automatique `4b66 = len + len/3` (≤ 255 tics) pour ce texte | `105e:0030` | certain |
| `cmd` | texte | affiche le texte tel qu'**une commande tapée** (bas de l'écran, `y = 0xA0`), attend 25 tics, puis l'exécute comme `exe` | `105e:0112` | certain |
| `exe` | texte | `gm_parse_command(texte)` : exécute la phrase | `105e:0170` | certain |
| `sub` | a0 | purge les objets marqués de la liste globale (`4c0a`), recharge le monde depuis `TMP` (`gm_save_world`/`gm_load_world`) puis, si a0 > 0, fixe la salle de destination `4b80` | `105e:0198` | hypothèse |
| `sal` | a0 | pour la table des salles (`4b7c`, 21 mots × 6 par salle), met à 0 les mots dont le mot `+10` / 100 vaut a0 | `105e:026c` | hypothèse |
| `ecr` | a0, a1, a2 | `4b3a ← a0`, `4b3c ← a1`, `4b3e ← a2` : couleurs (indices de palette) du texte scripté | `105e:02be` | certain |
| `msg` | a0, a1 | `gm_show_message_id(classe = a0, numéro = a1)` si a0 et a1 ≥ 0 | `105e:02e2` | certain |
| `peo` | a0, a1, a2 | `vga_set_text_colors(a0, a1, a2)` (pilote `+0x72`) | `105e:02fc` | certain |
| `ttl` | a0, a1, a2, a3 | fixe la fenêtre de `tta` : `x = a0`, `y = a1`, largeur `a2`, hauteur `a3` (`DGROUP:0042..0048`) | `105e:031e` | certain |
| `tta` | texte | affiche le texte dans la fenêtre de `ttl` (centrage désactivé), couleurs de `ecr`, attend une touche / un clic puis restaure le fond | `105e:033a` | certain |

**Groupe 5 : `111f:0006` (vidéo EGA et son)**

| Jeton | Args | Effet | Case | Confiance |
|---|---|---|---|---|
| `cga` | a0 (0..5), a1 (0..15) | règle les registres de palette EGA à partir d'une table de 6 × 4 octets (`DGROUP:0088`) ; **EGA seulement** (octet 0 du pilote = 1), sinon bip | `111f:001e` | certain |
| `pal` | a0..a15 | palette EGA : 16 registres (EGA seulement) | `111f:009e` | certain |
| `mon` | - | palette EGA monochrome (16 octets de `DGROUP:0094`) (EGA seulement) | `111f:00e4` | probable |
| `buz` | - | `3024:02e4` : sélection du haut-parleur | `111f:0128` | hypothèse |
| `adl` | - | `3024:0301` : sélection AdLib | `111f:0130` | hypothèse |
| `rol` | - | `3024:032c` : sélection Roland | `111f:0138` | hypothèse |
| `mus` | a0..a5 | `gm_sound_play(a0, a1, a2, a3, a4, a5)` (`2f33:000e`) | `111f:0140` | certain (appel), voir `audio.md` |
| `brt` | a0..a3 | `gm_sound_select_track` (`2f9b:000e`) | `111f:0160` | certain (appel) |
| `fbt` | a0, a1, a2 | `snd_start_track(a0, a1, a2 < 0 ? 0x80 : 0xA0)` (`40f7:156b`) | `111f:0178` | certain (appel) |
| `msl` | a0 | `529c ← a0` : musique active | `111f:0198` | probable |
| `mst` | a0 | a0 = 0 : `gm_sound_init` ; sinon arrête (`2fe0:0099`, `snd_stop_isr`, `529c = 0`, `529a = 7`, `5298 = −1`) | `111f:01a4` | probable |

**Groupe 6 : `123d:000a` (scène, niveaux)**

| Jeton | Args | Effet | Case | Confiance |
|---|---|---|---|---|
| `scn` | - | `21cc:000e()` | `123d:0022` | non établi |
| `niv` | a0, a1 | niveaux `4b4e ← a0*100 + a1` si `0 ≤ a0 ≤ a1 < 10` (a1 par défaut a0) | `123d:0036` | certain |
| `sol` | a0 | `4ae0 ← max(a0, 1)` | `123d:0066` | non établi (sens) |
| `aes` | - | `147f:000a()` | `123d:007a` | non établi |
| `pds` | a0, a1 | `133e:0006(clamp(a0, 0, 0xB4), a1)` | `123d:0082` | non établi |
| `ref` | a0 > 0 | `gm_show_text(10dc:0160(a0))`; `10dc:0160` est un stub qui renvoie 0 | `123d:00a0` | certain (stub) |
| `aev` | - | `147f:0352()` | `123d:00b6` | non établi |

**Groupe 7 : `117d:0002` (listes d'objets).** Le suffixe désigne la famille de ressource et de liste : `i` = INT (liste globale `4c0e`), `d` = DEC (liste `salle+0x26`), `o` = OBJ (liste `salle+0x22`). Préfixes : `ad` créer, `dl` supprimer, `zp` vider, `cp`/`ct` désigner le héros, `nx` héros suivant, `lb`/`rg` lister. Sens des préfixes d'après les opérations (hypothèse sur les mnémoniques). Le message `DGROUP:00a4` « numéro non précisé » est affiché si a0 < 1 pour `ad*`.

| Jetons | Args | Effet | Cases | Confiance |
|---|---|---|---|---|
| `adi` `add` `ado` | a0 (id DEF), a1, a2 | `gm_def_lookup(famille 0/1/2, a0)` (`10b3:0006`) puis `gm_create_object` (24 paramètres tirés de l'enregistrement DEF de 28 octets) dans la salle (`add`, `ado`) ou la liste globale (`adi`) ; `10dc:007a` (désigne le héros si aucun) ; a2 ≠ 0 : le nouvel objet devient le héros (`10dc:0022`), sinon le héros précédent est conservé ; a1 == 0 : l'objet est ensuite relâché (`10dc:000c`, `Ctl ← 0`) | `117d:001a`, `0030`, `003a` | certain (appels) / probable (rôle de a1) |
| `dli` `dld` `dlo` | a0 | trouve dans la liste l'objet de `Num = a0` (a0 = −1 : le héros) et le supprime (`19a6:01a5`) | `117d:01ac`, `01de`, `01fa` | probable |
| `zpi` `zpd` `zpo` | - | `gm_destroy_scene_objects` | `117d:0292`, `029e`, `02a4` | probable |
| `cpi` `cpd` `cpo` | a0 | relâche le contrôle du héros courant (`10dc:000c` : `Ctl +0x40 ← 0`, `4bfe ← 0`) puis continue comme `cti/ctd/cto` | `117d:02aa` | probable |
| `cti` `ctd` `cto` | a0 | cherche l'objet `Num = a0` dans la liste et le **désigne comme héros** (`10dc:0022` : `Ctl +0x40 ← 7`, réinitialise son mouvement, `4bfe ← objet`, `4b50`) et fixe la salle courante | `117d:02d6`, `02ec`, `0308` | probable |
| `nxi` `nxd` `nxo` | - | héros suivant : objet suivant le héros actuel dans la liste (boucle au début) | `117d:03d4`, `0420`, `0464` | probable |
| `lbi` `lbd` `lbo` | a0 | trouve `Num = a0` dans la liste et lui retire le contrôle (`10dc:000c`, `Ctl ← 0`) | `117d:04a8`, `04be`, `04da` | probable |
| `rgi` `rgd` `rgo` | - | affiche la liste (noms d'objets, `21ad:000a(0x20, liste)`) | `117d:0558`, `057e`, `0592` | probable |

**Groupe 8 : `1218:000a` (champs d'objet).** Objet = `args[1]` (sauf mention) ; absent ou −1 -> le héros.

| Jeton | Args | Effet | Case | Confiance |
|---|---|---|---|---|
| `ego` | a0 | `+0x2D ← a0` (« état », sélectionne la classe de description 30-38) | `1218:0036` | certain |
| `fig` | a0 | `+0x2E ← a0` puis `1a37:0002` | `1218:0054` | certain |
| `txt` | a0 | `+0x08 ← a0` puis `1a37:0002` | `1218:0088` | certain |
| `dep` | a0 | `+0x07 ← a0` puis `1a37:0002` | `1218:00a6` | certain |
| `tim` | a0, a1 ; objet a2 | `+0x32 ← a0`, `+0x34 ← a1` | `1218:00c4` | certain |
| `fct` | a0 ; objet a1 | `+0x8C:+0x8E ← (a0 == 0 ? 10c8:0006 : 0)` (pointeur de comportement) | `1218:00f2` | certain |
| `dir` | a0, a1, a2 ; objet a3 | `+0x60 ← a0`, `+0x62 ← a1`, `+0x61 ← a2` (vecteur de déplacement) | `1218:011c` | certain |
| `dpx` | a0 | `+0x45 ← a0` | `1218:0168` | certain |
| `dpy` | a0 | `+0x46 ← a0` | `1218:0186` | certain |
| `por` | - | `20b5:0248()` | `1218:01a4` | non établi |
| `hor` | - | `10dc:015c` (retourne), puis bip et retour 0 | `1218:01bc` | certain (stub) |
| `mob` | a0 (0..2) | `+0x06 ← a0` | `1218:01c4` | certain |
| `gst` | a0 | `+0x05 ← (a0 ≠ 0 ? 7 : 0)` | `1218:01e6` | certain |
| `inv` | - | `219b:006c(objet)` | `1218:0200` | non établi |

**Groupe 9 : `11dc:000c` (position, trajectoire, déplacements).**

| Jeton | Args | Effet | Case | Confiance |
|---|---|---|---|---|
| `xpy` | a0..a4 ; objet a5 | `+0x54 ← a0`, `+0x58 ← a1`, `+0x56 ← a2`, `+0x53 ← a3`, `+0x5A ← a4` (chaque argument ≥ 0) puis `1aba:000e` | `11dc:0024` | certain |
| `trj` | a0..a3 ; objet a4 | efface la trajectoire (`+0x78/0x7A`) ; `+0x70 ← a0`, `+0x74 ← a1`, `+0x72 ← a2` ; si l'objet est dans la salle courante calcule le chemin (`gm_compute_path`) ; échec : texte « Pas de chemin » (`DGROUP:00b8`) ; sinon `+0x6E ← 7` | `11dc:00b2` | certain |
| `sor` | objet a2 | `228e:0000(objet)` | `11dc:0174` | non établi |
| `att` | objet a1 | `21fb:005a(objet)` puis `22ef:0000(cible, objet)` | `11dc:01a4` | non établi |
| `raz` | objet a0 | `gm_reset_object_motion` | `11dc:01f6` | certain |
| `get` | objet a1 | place l'objet dans un autre (`19dc:0000`, mode 2) | `11dc:0226` | probable |
| `let` | objet a1 | `21e7:0022(objet)` (premier contenu) puis `19dc:0000` vers la salle de l'objet | `11dc:0282` | hypothèse |
| `mov` | a0 ; objet a1 | envoie l'objet dans la salle `a0` : `+0x3F ← 6`, `+0x66 ← a0`, `19dc:0000` | `11dc:02d6` | probable |
| `chr` | a3 ; objet a4 | `23a2:0002(objet, a3)` : arme une minuterie (table de 12 octets) | `11dc:0324` | hypothèse |
| `sl1` | a3 | `1611:032e(a3)` : séquence visuelle (effet de fin : palette `1611:0164`, objets INT, termine par `gm_cm_script_step` et `1611:0366`) | `11dc:0362` | hypothèse |
| `sl2` | - | `1611:01de()` : crée un objet INT de type 3 et décale la palette | `11dc:0378` | hypothèse |
| `sl3` | - | `1611:0366()` : nettoie l'effet | `11dc:0384` | hypothèse |

**Groupe 10 : `137b:0006` (système).**

| Jeton | Args | Effet | Case | Confiance |
|---|---|---|---|---|
| `cle` | a0 (0..9), a1 | `4b1e[a0] ← a1` (porte de la famille de gestionnaires, §6.4) ; réinitialise le mouvement et efface le pointeur de comportement (`+0x8C:+0x8E`) des objets de la salle dont `Num/100 == a0` | `137b:001e` | certain |
| `dsk` | a0 | `0ebc ← a0` : indicateur de disque (7 = CD, noms à plat) | `137b:008c` | certain |
| `isr` | - | appelle le point d'entrée `+0x14` du bloc de liaison du pilote (`vga_init_block`) | `137b:0098` | probable |
| `sem` | a0 | `4b40 ← a0` | `137b:00b6` | non établi |
| `nil` | a0 | `4b42 ← a0` : met en **pause** (≠ 0) ou relance le script en cours | `137b:00c2` | certain |
| `rsv` | a0 | `gm_savegame_slot()` (CM2 : `rsv −1`) | `137b:00ce` | probable |
| `svg` | a0, a1 | `4b4e ← a0*100 + a1` (0 ≤ a0 ≤ a1 < 10) puis stubs `10dc:015e`/`0164` ; sinon textes « Syntaxe : svg nv1 nv2 » / « Niveaux invalides » | `137b:00d8` | certain |
| `skp` | a0 | `4b44 ← a0` | `137b:0120` | non établi |
| `sau` | - | `gm_save_world(fichier 16-17)` | `137b:012c` | probable |
| `res` | - | `gm_load_world(fichier)` puis ferme | `137b:013e` | probable |
| `pil` | a0 | a0 < 0 : `203f:00ac` ; sinon `gm_snapshot_alloc` (pile d'instantanés `TMP.SVG`) | `137b:0162` | probable |
| `lir` | a0 | si a0 ≥ 0 : `gm_load_scene` (pilote `+0x66`, `+0x5a`, `+0x2a` autour) | `137b:0178` | probable |
| `mod` | - | `gm_init_video()` | `137b:01ac` | certain |

## 12. Scripts `CM1..CM4`

### 12.1 Enregistrement (certain)

`{u16 groupe, u16 jeton, u16 rep, u16 n, u16 L}` + `n × u16` arguments (complétés à 16 par `0xFFFF`) + `L` octets de texte (XOR `0xBB`, ≤ 0x7FF, NUL ajouté) : lu par `gm_cm_script_step` (`1346:0004`) ; `n` doit être ≤ 16 (sinon erreur 0xB6) et `L` < 0x800 (erreur 0xB7). Le **mot 3 (`rep`) est un nombre de tics d'attente**, le mot 4 `n`.

### 12.2 États de `gm_cm_script_step(AX = état)` (certain)

Table de sauts `1346:032b` (10 états) :

| État | Adresse | Rôle |
|---:|---|---|
| 0 | `0022` | ouvre `CM1` (fichier 7) puis lit |
| 4 | `0028` | ouvre `CM2` (fichier 9) |
| 5 | `002e` | ouvre `CM3` (fichier 2) |
| 9 | `0034` | ouvre `CM4` (fichier 19) |
| (ouverture) | `003a` | ferme l'éventuel fichier ouvert, ouvre, `4b34 ← 1` (script en cours), `4b50 ← 0` (le héros ne répond plus), `4b42 = 4b38 = 4b36 ← 0` |
| 1 | `0092` | lit un enregistrement (10 octets, arguments, texte) ; EOF ou lecture courte -> état 3 ; si `4b38 == 0` **ou** enregistrement `fin` : `gm_script_dispatch(...)` ; sinon (mode saut) l'enregistrement est ignoré ; suite : `4b36 ≠ 0` -> état 1 (continuer immédiatement) |
| 2 | `0244` | reprise : si script actif et non en pause : `rep--` ; si `rep` valait 0 **ou** `4b38 ≠ 0` -> état 1 ; sinon **rend la main** à l'appelant |
| 3 | `028c` | ferme le fichier ; `4b34 = 4b42 = 4b38 ← 0`, `4b50 ← 7`, `4b36 ← 7` |
| 6, 7 | `02e1` | mémorise « 7 ? » (`62c ← (état == 7)`), puis ouvre `CM3` (état 5) |
| 8 | `0300` | si `62c ≠ 0` : état 9 (`CM4`) puis état 3 |

La mémoire du texte (`gm_alloc(L+2)`) est libérée à chaque tour.

### 12.3 Sémantique de `rep` et `cnt`

Après chaque enregistrement exécuté : **si `cnt` (`4b36`) ≠ 0 on enchaîne immédiatement** (état 1) ; sinon, avec `rep = 0` on enchaîne, avec `rep ≥ 1` on **rend la main** à la boucle principale (qui rappelle l'état 2 à chaque tour tant qu'un script tourne et que `4b42 == 0` : `18a9:0525`), `rep` étant décrémenté à chaque rappel. Les quatre fichiers commencent par `cnt 7` et ont `rep = 1` partout : **aucun enregistrement ne rend jamais la main** ; les pauses sont obtenues par `wat` et par les fenêtres de texte qui attendent une touche.

### 12.4 Mode saut (F8)

`F8` pendant un script (`1023:0240`) : `4b38 ← 7` puis `gm_cm_script_step(1)`. Les enregistrements sont alors lus **sans être exécutés** jusqu'à un `fin` (groupe 0, jeton 0), qui est exécuté (`4b38 ← 0`) : on saute donc tout jusqu'au prochain `fin`.

### 12.5 Quand chaque script tourne (certain, appelants de `1346:0004`)

| Script | État | Déclencheur | Contenu |
|---|---:|---|---|
| `CM1` (72 o) | 0 | `1005:005a` : amorçage du moteur | `cnt 7`, `dgs 99`, `dsk 7`, `lum 0`, `dgs 0`, `sys 3` |
| `CM2` (2 137 o) | 4 | `1005:01e0` : fin de l'initialisation, avant la partie | `cnt 7`, `dgs 99`, `sec`, `pil 2048`, `lir 21`, `mus ...`, `wat`, `lir 20`, `pil −1`, `ecr 237 238 234`, `ttl 62 66 196 120`, dix `tta` (récit d'introduction), `wat 40`, **`fin`**, `cnt 7`, `rsv −1`, `cle 0..3 7`, `lum 0`, `dgs 0`, `sys 3` |
| `CM3` (80 o) | 6 | fin d'épisode / mort : `1611:0322` (fin de la séquence `sl*`), `2500:0151`, `27ed:0179`, `29fd:015f` (juste après le message `S070`) | `cnt 7`, `dgs 99`, `sec`, `lum 0`, `fin`, `dgs 0`, `sys 8` |
| `CM4` (1 079 o) | 9 | `quitter` / `terminer` (`2404:0002` -> `1503:0000`) ; aussi via l'état 7 (jamais appelé) | `cnt 7`, `dgs 9`, `sec`, `ecr 250 238 221`, `ttl 0 0 0 0`, `tta` (« conseils de jeu »), `fin`, `xit` |

États 1 (rappel après `F8`) et 2 (rappel par la boucle principale) ne sont pas des déclencheurs de script. Notes : `sys 3` termine, `sys 8` (fin de `CM3`) enchaîne sur `CM4` seulement si l'état 7 a été utilisé (jamais) ; `CM4` se termine par `xit` (quitte le jeu).

## 13. Affichage du texte

### 13.1 Chemin (certain)

`gm_show_message_id(AX = classe, DX = numéro)` (`200c:0004`) : ignore `DX ≤ 0` ; `gm_get_message` -> pointeur far -> `gm_show_text` (`200c:0014`, ignore NULL) -> `gm_print_text_default` (`327a:0004`) -> `gm_draw_text` (`327a:0044`). Les messages sont des chaînes CP437 terminées par NUL ; `0xFE` = saut de ligne, `0xFA` = espace.

`gm_draw_text(AX = interlettre, DX = hauteur de fenêtre, BX = largeur de fenêtre ; pile : attente, couleur bord 2, couleur bord 1, couleur de fond, « partiel », mode (7), centré, y, x, texte)` (ordre des paramètres lu dans les appels de `327a:0004`, `105e:033a`).

Paramètres de la **fenêtre par défaut** (`327a:0004`) : interlettre 1, largeur 0 (= 320), hauteur 0xA0, `x = 0`, `y = 0x15` (21), centré (7), attente (7), couleurs = les trois couleurs de texte du pilote (`+0x0c` fond, `+0x0e` et `+0x10` bords). Les bornes appliquées : largeur ramenée à 320 si < 3 cellules ou > 320 ; hauteur ramenée à 200 de la même façon puis arrondie à `((h − 16) / 7)*7 + 16` (156 pour 160) ; `y` à 0 si la fenêtre sortirait de l'écran.

### 13.2 Mise en page (`327a:0044`, certain sauf mention)

Cellule GPH (5 × 7) et table des avances : `4dde`, `4de0` (largeur, hauteur), `4de2:4de4` (mots de la table, quartet haut = avance, voir `font.ts`), `4de6:4de8` (données de glyphes) ; un glyphe sans entrée utilise celui du code 0. La largeur d'un caractère vaut `avance + interlettre`.

1. **Largeur de ligne maximale** `Wm = largeur − 2*cellule − interlettre` ; **nombre de lignes maximal** `(hauteur − 2*7) / 7` (20 pour la fenêtre par défaut). Le tampon de lignes (`4dd8:4dda`, taille `4ddc`) doit contenir `strlen + 0x28` octets (sinon erreur fatale 0xDF).
2. **Découpage en mots** : un mot s'arrête sur `0x20`, `0xFA` (réécrit en `0x20` dans le message) ou `0xFE`. Un mot qui tient (`largeur ligne + largeur mot ≤ Wm`) est ajouté, puis les espaces qui suivent sont ajoutées tant qu'elles tiennent (une espace qui ne tient pas est consommée et force le retour à la ligne). Un mot qui ne tient pas passe à la ligne suivante ; **un mot plus large que la ligne est coupé caractère par caractère**. `0xFE` termine la ligne (une ligne vide si deux se suivent). Les espaces en début de ligne sont supprimées.
3. **Page** : quand le nombre de lignes maximal est atteint ou le texte épuisé, la page est dessinée. Une page suivante est recomposée avec le reste du texte.
4. **Rectangle** : largeur = `2*(cellule + interlettre) + ligne la plus large` si « centré » (rétréci au texte et centré sur 320 : `x = (320 − largeur)/2`), sinon la largeur de la fenêtre ; hauteur = `7 * (lignes + 2)`.
5. **Cadre** (`32e1:0008`, lecture directe de `A000`) : cinq rectangles emboîtés `i = 0..4` (`i = 2` omis) : `i = 0` rempli de la couleur de fond, contour couleur de bord 1 pour `i = 0, 3` et couleur de bord 2 pour `i = 1, 4` (contours creux sauf `i = 0`).
6. **Texte** (`32e1:00a2`) : première ligne à `y0 + 7`, `x = x0 + cellule + interlettre`, interligne 7 ; chaque pixel de glyphe écrit **deux octets** (`x` en couleur de bord 1, `x+1` en couleur de bord 2 : ombre à droite).
7. Zone modifiée mémorisée (`4dce..4dd4`) ; `327a:05e2` la restaure en copiant la page de fond (pilote `+0x32`).

### 13.3 Pagination et attente

Si le paramètre « attente » est ≠ 0 ou s'il reste du texte, après chaque page : `1db5:0004` (attente) puis `327a:05e2` (restauration), puis la page suivante. L'attente (`1db5:003e`, certain) vide le tampon clavier, puis attend un **clic de bouton** (gauche ou droit, si `4cac ≠ 0`) ou **Entrée / Échap** ; toute autre touche fait un bip.

### 13.4 Délai de lecture automatique

`DGROUP:4b66` : si ≠ 0 `1db5:0004` remplace l'attente par `gm_delay_ticks(4b66)` (tics BIOS à 18,2 Hz) : réglé par `aut n` ou, temporairement, par `dsp`. Valeur initiale 0 (attente d'une touche).

### 13.5 Couleurs

Les trois couleurs de texte du pilote vidéo (`+0x0c`, `+0x0e`, `+0x10`) sont posées par `gm_init_video` (`1d7b:0000`) depuis `DGROUP:4b08/4b0c/4b10` (indices de palette) et modifiables par `peo` ; `aff`, `dsp` et `tta` les remplacent temporairement par `4b3a/4b3c/4b3e` (`ecr`). Valeurs en dur : ligne de saisie `0xEE` / `0xFA` / `0xDD`. Les indices réels dépendent de la palette (`graphics.md`).

## 14. Parcours de bout en bout

### 14.1 « prendre la clé » (clef en or posée dans la salle, à portée)

1. `p` ouvre la ligne (`1023:0016` -> `1e22:0008(AX='p', DX=2)`) ; les autres touches passent par l'état 2 de `1e22:02c2` ; `Entrée` -> état 5 : `4e5e ← "prendre la clé"`.
2. `1d89:0002` : minuscules, `é -> e` : `prendre la cle`.
3. `prendre` -> `[22006]` (verbe) : `4cba = 22006`. `la` -> `[26001]` (supprimé). `cle` -> `[15006, 15022, 15108, 15109, 15331]` (5 types de clefs, classe 15) : `4cbe = 5`, liste en `4cca`.
4. `22fc:0002` : `4cba / 1000 = 22` (ni 13 ni 24), héros présent. `1ec8:000a(6, famille 0)` -> `3371:000d` ; appelé avec `AX = 7` -> retour 0 : `4cc6 = 0`.
5. Boucle indirecte : une seule itération (`4cc0 == 0`). Boucle directe : pour chaque code, `206a:0002(numéro)` retrouve les objets de ce `Num` visibles (`219b:0000`) dans la salle et l'inventaire ; la clef or (`Num 6`) est trouvée avec A = 0, B = 7 (si à portée par `2120:0075`). Familles 5 (indirect) et 1 (direct, clé 6) : pas d'entrée -> pas de gestionnaire. Appel de `3371:000d(AX = 0)`.
6. `3371` : pas d'indirect, objet direct résolu, `A = 0`, objet ≠ héros, `B ≠ 0`, `Ram (+0x1E) ≠ 0`, poids ok (`20ac:0060`) -> `19dc:0000(héros, objet, 2)` : l'objet est déplacé dans l'inventaire du héros ; `4cc4 ≠ 0` -> `200c:0004('V', 15)` (message `V015`, « Ok » ) ; renvoie 7.
7. `22fc` : `4cc2 = 1`, `4cc6 == 0` -> fin ; pas de file affichée ; `4ae6 ← 7` ; retour 7 -> `gm_parse_command` renvoie 0 -> état 7 : la boîte se ferme.
8. Si la clef est hors de portée : `V008` mis en file (priorité 3), `2363:000c` arme une réaction, aucun succès : fin de commande, la file est affichée (« Vous êtes trop loin ») dans la fenêtre par défaut (§13).

### 14.2 « regarder » (ou `voir`, `r`) seul = examen de la salle

`regarder` -> `[22005]`, aucun nom : `4cba = 22005` seul. Gestionnaire `33b2:0007` : `4cc2 == 0` donc `4dc2 ← 6002` (« salle ») -> `200c:0004('L', numéro de la salle = champ +0 de l'enregistrement de salle 4b84)` : le message `L<id de salle>` est affiché (fenêtre par défaut, attente). Retour 7.

`regarder la clé` : même chaîne que 14.1 jusqu'à `33b2:0007` (politique 3) : l'objet direct résolu et non caché -> `1e58:000a(prio 10, classe = octet +0x2D, numéro = Num)` renvoie 0 ; fin des boucles sans succès : `1e58:009e` affiche la description (classe 30 pour l'état 0, p. ex. `30006`). Si plusieurs clefs sont visibles, les descriptions de toutes sont mises en file (priorité 10) et affichées **du dernier au premier**.

### 14.3 « nord » (déplacement tapé)

`nord` n'est pas dans le dictionnaire : `gm_dic_lookup` renvoie 0, `1d89:02ae` affiche le message `S015` (AX = 'S', DX = 15), la saisie reste ouverte avec le texte restauré (état 4). Les déplacements se font aux touches fléchées (§2.4) et à la souris (`1564:0004`, voir `engine.md`).

### 14.4 « mettre la clef dans le coffre »

`mettre` [22015], `la` (supprimé), `clef` [5 types] -> direct (`4cbe = 5`), `dans` [1001] -> `4cbc = 1`, `le` (supprimé), `coffre` [15021, 15110, 15319] -> **indirect** (`4cbc ≠ 0`, `4cc0 == 0`) : `4cc0 = 3`. `22fc` : boucle indirecte sur les 3 codes (une seule `206a:0002` par code), gestionnaire de **famille 5** du coffre si présent (`22c1:029e` pour 21, 110, 319), puis boucle directe (candidats complétés par le contenu du coffre), puis gestionnaire de verbe `3340:0001`.

## 15. Notes pour la réimplémentation TypeScript

- Modèle de phrase : `{ verb?: number, prep?: number, direct: number[], indirect: number[] }` avec `direct`/`indirect` ≤ 60 codes, la préposition forcée à 8 pour un second groupe sans préposition. Les mots de classe 26 sont supprimés ; un second verbe est ignoré.
- Le moteur d'exécution doit reproduire : (1) l'ordre d'appel *indirect, direct, verbe* et le critère « le premier retour ≠ 0 compte comme un succès » ; (2) les politiques d'itération 0/2/autre ; (3) la **file de messages à priorité** (vidée à chaque commande, affichée à l'envers, seulement sans succès) ; (4) le repli `S015` ; (5) la table de portes `4b1e`. Les gestionnaires par type d'objet (≈ 180 fonctions) sont à étudier à part (modules `2363-2f32`, `3187-3340` ; `engine.md`).
- `src/games/armaeth/data/dictionary.ts` : `wordRole` doit traiter la classe 13 comme « emplacement verbe » mais *famille 6*, la classe 26 comme « ignorée », les classes 4/9 comme décor et ajouter les chiffres (classe 0). `lookupWord` est correct ; ajouter un code par défaut `N = 8`.
- `src/games/armaeth/data/commands.ts` : le champ `repeat` est le nombre de rappels (tics) à attendre quand `cnt == 0` (§12.3) ; il vaut 1 partout mais est inopérant tant que `cnt != 0`.
- `src/games/armaeth/data/text.ts` : `0xFA` n'est pas une fin de paragraphe : c'est une espace réécrite en `0x20` (§13.2) ; le message `S045` remplace tout message absent.

## 16. Questions ouvertes

1. **Gestionnaires par type d'objet** (familles 1, 2, 3, 5, 8, 9 : ≈ 130 entrées, adresses en §6.4) : sens exact de chaque verbe pour chaque objet (ouvrir, allumer, donner...). C'est le coeur du contenu du jeu et il est hors périmètre de cette étude ; il faut les décompiler un par un (`28b1`, `2a44`, `2cdf`, `2dd9`, `22c1`, `2774`, `26da`...).
2. **Verbes `mettre`/`jeter`** (`3340:0001`) et `escalader`/`monter`/`descendre` (`3332:0004`) : seulement esquissés (§8.4, §8.6).
3. **Valeurs de `4cc6`** : seules les politiques 0 et 3 sont émises par les gestionnaires de verbe lus ; la valeur 2 (passer à l'indirect suivant) n'est produite par aucun d'eux (peut-être par un gestionnaire d'objet utilisé comme verbe : à vérifier).
4. **Famille 9 / `2363:0154`** : réaction des PNJ (déclenchée en fin de commande si la commande a échoué) : interprétation hypothétique.
5. **Jetons non établis** : `scn`, `sol`, `aes`, `pds`, `aev` (groupe 6), `por`, `inv` (groupe 8), `sor`, `att`, `let`, `chr`, `sl1..3` (groupe 9), `sem`, `skp` (groupe 10), `buz/adl/rol`, `sub`, `sal`, `vue`, `exp`, `lbi/lbd/lbo`. Aucun d'eux n'est utilisé par `CM1..CM4`.
6. **`dgs` et F7/F8** : le rôle de `dgs > 10` dans `23fa:0006/003c` (écriture CRTC) est inconnu ; la commande `/dgs 99` rouvrirait donc tout l'interpréteur en jeu : à confirmer dynamiquement.
7. **Mots-pièges** `zwygks`, `wwww`, `zzzz`, `zz` : intention (triche, leurre) non établie ; `zwygks` a un vrai gestionnaire.
8. **Texte scripté** : `tta`/`aff` utilisent les couleurs `4b3a..4b3e` dont les valeurs initiales sont des indices de palette posés par `ecr` (`237 238 234` pour l'introduction, `250 238 221` pour les conseils) ; leur correspondance exacte avec la palette VGA (`graphics.md`) n'a pas été recoupée.
9. **Mise en page de `gm_draw_text`** : l'algorithme est lu dans le décompilat (le désassemblage de `327a:0044` n'a pas été relu instruction par instruction pour les cas limites : mot coupé, ligne vide, `0xFE` consécutifs, texte épuisé pile à la limite de page).

## 17. À vérifier en analyse dynamique

- Taper une phrase (`prendre la clé`, `regarder`, `mettre la clef dans le coffre`) dans un émulateur DOS avec points d'arrêt sur `22fc:0002`, `1e58:000a`, `1ec8:000a` pour confirmer l'ordre des appels, la file de messages (ordre d'affichage inversé) et les politiques d'itération.
- Mesurer à l'écran la fenêtre par défaut (positions `x`, `y`, largeur rétrécie, cadre à 5 anneaux) et la pagination (20 lignes) sur un long message (`S021`, introduction `CM2`).
- Tester `/dgs 99` puis `/inf 0`, `/adi n` en jeu pour confirmer le verrouillage de groupe ; tester F8 pendant l'introduction (saut jusqu'à `fin`).
- Tester la saisie : 40 caractères maximum, `Inser` (rappel), `Suppr`, `Échap`, `É` majuscule (la lettre devient `E` majuscule et n'est pas reconnue), `chauve-souris`.
- Vérifier la valeur initiale de `DGROUP:4b4c` (8) et l'effet de `dictionnaire 4` / `dictionnaire 20` sur la reconnaissance de mots courts.
