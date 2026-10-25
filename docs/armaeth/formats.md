# Formats de données d'Armaeth

Armaeth (Grandslam Video, 1994, DOS), version CD adaptée par Rob Northen Computing. Document fondé sur l'étude des fichiers de données **et** sur la rétro-ingénierie de `AM1.EXE` (voir `re-index.md` : décompilation Ghidra, adresses `segment:offset` au sens de ce document). Lecteurs TypeScript : `src/games/armaeth/data/` (`text`, `dictionary`, `commands`, `font`, `world`, `tables`), tests dans `test/armaeth/`. Images, sprites et scènes : voir `graphics.md`. Sons et `A1FMIX.SYS` : voir `audio.md`.

Source : le CD extrait, répertoires `ARMAETH.FRE/` (préfixe `A1F`), `ARMAETH.ENG/` (`A1A`), `ARMAETH.DEU/` (`A1D`). Tout est **little-endian**, sauf mention contraire (l'archive RNC est big-endian).

Légende : **confirmé (données)** = vérifié par un calcul ou un rendu sur les fichiers ; **confirmé (RE `adresse`)** = comportement lu dans le code de `AM1.EXE` à cette adresse ; **hypothèse** = lecture plausible non démontrée. Quand la RE corrige le premier jet, la correction est signalée. Les lecteurs ne nomment un champ que si l'un des deux premiers cas le soutient ; sinon ils exposent des champs `unknownN` ou les octets bruts.

## Lancement

`START.BAT [E|F|D] [lecteur:]` entre dans le répertoire de langue, lance `CDPATCH`, `ARMINS`, puis `ARMAETH.BAT`, qui contient (confirmé, 21 octets) :

```
vga
sc0
am1 * a1f
```

`vga` et `sc0` sont des pilotes résidents (`VGA.EXE` 16 Ko, `SC0.EXE` 50 Ko), `am1 * a1f` le moteur (`*` = lecteur courant, `a1f` = préfixe de langue ; `a1a`, `a1d` pour l'anglais et l'allemand). `AIDE.BAT` / `HELP.BAT` lancent `sos.exe * a1f` : **`SOS.EXE` est le programme d'aide (indices hiérarchiques), pas un pilote son** (confirmé, voir `A1FSOS.SYS`). `INSTALL.BAT` lance `HDINST.EXE`, qui décompresse `ARMAETH.RNC` sur le disque dur.

## Fichiers → rôle → taille → dépendance de la langue

Tailles de la version française. « Langue » : **non** = identique octet pour octet dans les 3 langues ; **segments** = ne diffère que par 4 mots de pointeurs mémoire par ressource (voir plus bas) ; **oui** = contenu différent ; **ordre** = mêmes données, ordre de petites tables différent.

| Fichier | Rôle | Taille | Langue |
|---|---|---|---|
| `A1F00A..00E.VGA` | scènes du « chapitre 0 » (ids 0 à 22) | 138 à 286 Ko | `00A/B/D` : non (EN=FR) ; `00C` : ordre ; `00E` : **oui** (141 437 octets en FR contre 95 575 en EN/DE) |
| `A1F01A..01C.VGA` | scènes du chapitre 1 (ids 101-111) | 40 à 129 Ko | `01C` non ; `01A/B` ordre (FR) |
| `A1F02A..02C.VGA` | scènes du chapitre 2 (ids 201-212) | 60 à 151 Ko | ordre (FR) |
| `A1F03A..03D.VGA` | scènes du chapitre 3 (ids 301-315) | 5,8 à 91 Ko | `03B`, `03D` non ; `03A`, `03C` ordre (FR) |
| `A1FOBJ.VGA` | sprites d'objets et de personnages (92 ressources) | 115,1 Ko | segments |
| `A1FANM.VGA` | sprites d'animations (47 ressources) | 84,5 Ko | segments |
| `A1FDEC.VGA` | sprites de décor animé (20 ressources) | 25,5 Ko | segments |
| `A1FINT.VGA` | icônes d'interface (30 ressources ; pas des sprites d'intro, voir `screens.md`) | 9,6 Ko | segments |
| `A1FDEF.SYS` | un modèle d'objet de 28 octets par ressource sprite | 5 300 | non |
| `A1FANI.SYS` | 47 animations (enregistrements de 12 octets) et leur table de pas (147 mots) | 862 | non |
| `A1FMSG.SYS` | messages du jeu (1 087 chaînes, XOR 0xFF) | 113,3 Ko | oui |
| `A1FTMS.SYS` | index des messages (id → offset dans `MSG`) | 6 532 | oui |
| `A1FDIC.SYS` | dictionnaire de l'analyseur de commandes (669 mots) | 12 044 | oui |
| `MSGINT`, `MSGUTL`, `MSGHRD` | messages d'erreur / utilitaires (**non chargé par `AM1.EXE`** : lu par `SC0`, `SOS` et l'installateur, `screens.md`) / matériel (texte clair) | 948 / 2 127 / 621 | oui |
| `A1FCM1..4.SYS` | quatre scripts de commandes à jetons (CM2 = récit d'intro, CM4 = conseils de jeu) | 72 / 2 137 / 80 / 1 079 | CM1, CM3 non ; CM2, CM4 oui |
| `A1FSOS.SYS` | arbre des menus d'aide de `SOS.EXE` | 26 294 | oui |
| `A1FMIX.SYS` | tables de sons / pistes (« mix ») | 99,5 Ko | quasi non (octets de remplissage) |
| `A1FGPH.SYS` | police bitmap proportionnelle 5 × 7 | 1 236 | FR=EN ; DE +7 octets |
| `A1FCFG.SYS` = `SVG001.STD` | état initial du monde : 60 salles, 132 objets (identiques) | 21 868 | CFG : FR 21 868 / EN-DE 21 826 ; STD : non |
| `A1FTMP.SVG` | instantané du monde au même format (reliquat de dev en FR : 136 objets ; 10 octets en EN/DE) | 22 444 | oui |
| `A1FTMP.SCR` | 10 octets nuls | 10 | non |
| `A1FINS.SYS` | enregistrement d'installation (`\ARMAETH`) | 236 | non |
| `ARMAETH.RNC` | archive Rob Northen de tous les fichiers (installation disque dur) | 1,8 Mo | oui (contient la langue) |

## Graphismes (`.VGA`, sprites, scènes, palette)

Les archives `.VGA`, le format des sprites, celui des scènes (décompression des pixels, grille de marche, objets posés) et la palette sont décrits dans **`graphics.md`**. Rappels utiles aux lecteurs de ce document, déjà établis :

- les ids de ressources sont les mêmes dans `A1FDEF.SYS` et dans les tables des `.VGA` (confirmé (données) : 189 ressources, ordre `INT`, `DEC`, `OBJ`, `ANM`) ; la centaine d'un id (1xx, 2xx, 3xx) est le numéro de chapitre, comme pour les scènes ;
- les fichiers de scènes n'ont pas d'indice : le nom est `A1F` + chiffre des centaines + lettre `'A' + (id % 100) / 5` + `.VGA`, donc cinq scènes par fichier (confirmé (RE `1e68:0322`)) ; les salles de l'état du monde portent ces ids (voir « État du monde ») ;
- la palette de 256 entrées VGA 6 bits est dans `AM1.EXE` à l'offset fichier 246 402 (confirmé (données) et (RE `gm_init_video`)).

## Textes

### Encodage

- **Confirmé (RE `2013:00ec`, `1dd4:002a`)** : `MSG` et `DIC` sont stockés en **NOT bit à bit** (`~octet`, soit XOR 0xFF ; le NUL de fin est 0xFF). `A1FSOS.SYS` suit le même codage (confirmé (données), lu par `SOS.EXE`).
- **Page de code : CP437 retenue** (hypothèse sur CP437 contre CP850). Tous les octets >= 0x80 des messages FR, EN et DE (0x80-0x9A, 0xA0-0xA5) sont communs aux deux pages ; la table de normalisation des accents (message 10 de `MSGINT`) liste exactement 0x80-0x9A et 0xA0-0xA5, sans 0x9B-0x9F (qui diffèrent). Rien ne permet de trancher, le lecteur utilise `src/data/cp437.ts`.
- **Marques dans les messages (confirmé (RE `327a:0044`, `gm_draw_text`))** : **0xFE (■) = saut de ligne** (202 en FR) ; **0xFA (·) est une espace** : `gm_draw_text` coupe les mots sur `0x20`, `0xFA` ou `0xFE` et réécrit `0xFA` en `0x20` (14 occurrences en FR, souvent en fin de message) ; ce n'est pas une fin de paragraphe (`parser.md` § 13.2 et § 15). Un message absent est remplacé par `S045`. Il n'y a aucun autre code de contrôle (< 0x20) dans `MSG` (confirmé (données)).
- Les textes de `CM2`/`CM4` sont en **XOR 0xBB** (confirmé (RE `1346:0004`) ; blanc 0x20 stocké 0x9B). `MSGINT`, `MSGUTL`, `MSGHRD` sont en clair (CRLF).

### `A1FMSG.SYS` + `A1FTMS.SYS`

`MSG` est une suite de chaînes terminées par NUL, sans en-tête (1 087 NUL). `TMS` est son index : `u16 nombre` (1 088), `u16 longueur max + 1` (1 051), puis `nombre` entrées `{u16 id, u32 offset}`. **Confirmé (RE `gm_load_tms` `2013:0000`)** : le moteur charge l'index en mémoire, cherche l'id par **dichotomie** (les entrées sont donc triées par id), lit le texte entre l'offset de l'entrée et celui de la suivante, applique le NOT et pose un NUL. Le second `u16` est la taille du tampon de lecture (un texte plus long provoque `gm_abort`). **Confirmé (données)** : 4 + 6 × 1 088 = 6 532 ; chaque offset suit un NUL ; la dernière entrée est la sentinelle `{0xFFFF, taille de MSG}` (115 992) ; la plus longue chaîne fait 1 050 octets (1 051 avec le NUL) en FR ; 1 087 messages dont 1 064 non vides.

**Identifiant** : `gm_get_message(classe, numéro)` calcule `classe * 1000 + numéro` ; la classe est une **lettre** (`lettre - 0x40`, A = 1) ou un **petit entier** (`valeur + 0x1E`, d'où les classes 31 à 38 ; ids jusqu'à 38 301). Les classes présentes dans `TMS` (hors sentinelle) sont 3, 4, 5, 7, 9, 12, 15, 19, 22, 26 et 30 à 38 (confirmé (données)). Exemples : `3101` « le passage est barré… », `4003` (abeille), `7003`. Lecteur : `MessageTable.messages(id)`, `messageId`, `messageClass`.

### `A1FDIC.SYS` — dictionnaire de l'analyseur

`u16 nombre` (669 en FR, 758 en EN, 829 en DE), puis `nombre` enregistrements de 18 octets : **`u16 code` en clair + mot de 16 octets NOT 0xFF, complété par des NUL** (13 lettres au plus). **Confirmé (RE `gm_load_dic` `1dd4:002a`)** ; confirmé (données) : 2 + 18 × 669 = 12 044, mots **triés** (sans accent, minuscules), plusieurs mots par code (synonymes, pluriels).

**Recherche (confirmé (RE `gm_dic_lookup` `1dd4:0156`))** : comparaison de préfixe (`strncmp`) sur les N premières lettres, N = octet `DGROUP:4b4c` (8 dans l'état initial, voir « État du monde »), arrondi au pair et borné entre 4 et 16 ; tous les mots voisins qui ont ce préfixe sont renvoyés (60 codes au plus, doublons supprimés). Si rien n'est trouvé et que le mot se termine par `s` ou `x`, la recherche est refaite sans cette lettre. Avant la recherche, le texte tapé est mis en minuscules et les accents sont normalisés avec la table du message 10 de `MSGINT` (confirmé (RE `1d89:0002`)). Lecteur : `lookupWord`.

**Classes (`code / 1000`)** et rôle dans l'analyse (confirmé (RE `gm_parse_command` `1d89:0002`) : les codes sont triés en emplacements) : classe **1** = préposition (on garde `code % 1000`) ; classes **13, 22, 24** = verbe ou forme spéciale (code entier, un seul par phrase) ; classe **26** = cas à part ; **toute autre classe** = nom (objet, décor, lieu), deux au plus (complément direct et indirect). Contenu observé en FR (confirmé (données), sens des classes 6, 13, 24, 26 inconnu) :

| Classe | Mots | Contenu observé |
|---|---|---|
| 1 | 18 | prépositions et positions (`a`, `dans`, `dehors`, `dessus`, `dessous`, `devant`, `derriere`, `avec`…) |
| 4 | 30 | éléments de décor fixes (`abeille` 4003, `braise` 4201, `chaudron` 4306…) |
| 6, 13, 24, 26 | 4, 6, 13, 9 | non étudiées (13001 = `armaeth`) |
| 9, 15 | 306, 153 | noms d'objets (`arbre` 9003…, `banc`, `bouteille`) |
| 19 | 60 | lieux (`cabane` 19003, `caverne` 19007…) |
| 22 | 70 | verbes (`allumer`/`bruler` 22001, `eteindre` 22002, `attaquer`/`assommer`/`frapper` 22021, `jeter`/`laisser`/`abandonner` 22016, `inventaire` 22017…) |

**Lien avec `TMS` (confirmé (données))** : tout code distinct des classes 4, 9, 15 et 22 existe comme id dans `TMS` (20, 209, 92 et 35 codes sur autant) ; les lieux (19) n'ont un message que dans 18 cas sur 60, les classes 1, 6, 13, 24 n'en ont aucun, la 26 en a 2 sur 5. Les mots fantaisie à la fin (`wwww`, `zwygks`, `zz`, `zzzz`) : sentinelles ou mots-pièges (hypothèse).

### `MSGINT`, `MSGHRD`, `MSGUTL`

Texte en clair CP437, CRLF : première ligne = nombre de messages (29, 19 et 62), puis une ligne ` <numéro> <texte>` par message, numérotés de 1 à n. **Confirmé (RE `gm_load_text_table` `351f:0002`)** pour `MSGINT` (chargé par `2065:000a`) et `MSGHRD` (`356b:000e` : erreurs matérielles et de disque, INT 24h, invites de disque). **`MSGUTL` (messages du programme d'installation et de contrôle numérique : `INSTAL-1`, « Contrôle du tableau numérique ») n'est référencé nulle part dans `AM1.EXE`** (confirmé (RE)) : il est lu par `SC0.EXE`, `SOS.EXE` et l'installateur (`screens.md`). Le **message 10 de `MSGINT`** est la table de normalisation des accents : des paires `caractère → lettre de base` (`//::--`, puis `áa àa âa äa éé…`) ; `strchr` + octet suivant, appliquée aux seuls caractères qui ne sont ni lettre ni chiffre (confirmé (RE `1d89:0002`)). Lecteur : `parsePlainMessages`, `parseAccentTable`, `normalizeText` (normalisation fidèle du texte tapé).

### `A1FCM1..4.SYS` — scripts de commandes

**Correction de la RE** : ce ne sont pas des tables « Mc » mais des **suites de commandes du langage à jetons** (voir plus bas). Enregistrement (confirmé (RE `gm_cm_script_step` `1346:0004` et confirmé (données) : chaque fichier se découpe exactement à sa taille, 72, 2 137, 80 et 1 079 octets) :

| Octet | Contenu |
|---|---|
| 0 | u16 **groupe** du jeton (0 à 10) |
| 2 | u16 **indice** du jeton dans son groupe |
| 4 | u16 répétition : nombre de rappels (tics) à attendre quand `cnt` vaut 0 ; vaut 1 partout, inopérant tant que `cnt != 0` (`parser.md` § 12.3 et § 15) |
| 6 | u16 `n` : nombre d'arguments (0 à 16) |
| 8 | u16 `L` : longueur du texte (0 à 0x7FF) |
| 10 | `n` × u16 arguments (le moteur complète à 16 avec 0xFFFF) |
| 10 + 2n | `L` octets de texte XOR 0xBB |

Le moteur lit un enregistrement, applique le XOR au texte puis appelle `gm_script_dispatch(groupe, jeton, arguments, texte)` (`124c:0002`) : **c'est exactement la même entrée que pour une commande tapée `/jeton …`**. Contenu (confirmé (données)) : `CM1` (6 enregistrements) et `CM3` (7) sont des séquences d'initialisation sans texte (`cnt 7`, `dgs 99`, puis `lum`, `dsk` et `sys 3` ou `sys 8`) ; `CM2` (33) est le **récit d'introduction** : dix enregistrements `tta` (groupe 4, jeton 11) portent chacun un paragraphe (« Il y a longtemps, très longtemps, un peuple de nains vivait… », « Vous êtes KILLIAN… ») entre des commandes `ecr`/`ttl` (fenêtre de texte), `mus` (musique), `lmr` et `dsk` ; `CM4` (8) affiche un `tta` « CONSEILS DE JEU » de 981 octets. Seul `tta` porte du texte dans les quatre fichiers ; la sémantique fine des autres jetons (hypothèse) reste à établir fonction par fonction. Lecteur : `parseCm`.

### Langage de commandes à jetons de trois lettres (confirmé (RE `109a:0002`, `124c:0002`))

Table en `DGROUP:05ee` (offset fichier 224 624 + 0x5ee ; 11 groupes, nombre en `05ec`) ; chaque groupe est une chaîne de jetons de trois lettres ; `/jeton arguments` dans la ligne de saisie (`gm_parse_command` renvoie à `gm_script_tokenize` quand la ligne commence par `/`) cherche les trois lettres dans les groupes (jusqu'à 16 entiers en `DGROUP:763c`), puis saute à `DGROUP:00C6 + 4 × groupe`. Groupes et gestionnaires : 0 `fin rem nop sys cnt dgs xit sec mse` (`139a:0006`) ; 1 `heu lum trf ral lmr wat rvb` (`1250:0008`) ; 2 `rlf rel vue` (`10f2:0008`) ; 3 `inf loc dec img pos dic exp` (`10fb:0006`) ; 4 `aut aff dsp cmd exe sub sal ecr msg peo ttl tta` (`105e:0004`) ; 5 `cga pal mon buz adl rol mus brt fbt msl mst` (`111f:0006`) ; 6 `scn niv sol aes pds ref aev` (`123d:000a`) ; 7 les 24 jetons de listes d'objets `adi…rgo` (`117d:0002`) ; 8 `ego fig txt dep tim fct dir dpx dpy por hor mob gst inv` (champs d'objet, `1218:000a`) ; 9 `xpy trj sor att raz get let mov chr sl1 sl2 sl3` (position et déplacement, `11dc:000c`) ; 10 `cle dsk isr sem nil rsv svg skp sau res pil lir mod` (`137b:0006` ; `svg nv1 nv2` fixe `DGROUP:4b4e = nv1 * 100 + nv2` et réécrit la sauvegarde). Lecteur : `TOKEN_GROUPS`, `tokenName`, `findToken`. Le chemin du texte tapé par la joueuse est distinct : normalisation des accents, minuscules, recherche dans `DIC`, classement par classe, puis `gm_execute_command` (`22fc:0002`) exécute verbe + objets (voir `re-index.md`).

### `A1FSOS.SYS` — arbre d'aide

`u16 nombre` (607), puis `nombre` enregistrements de 8 octets `{u16 lien, u16 enfant, u16 longueur, u16 0}`, puis **le texte NOT 0xFF sans terminateurs**. **Confirmé (données)** : 2 + 8 × 607 = 4 858 = début du texte ; la somme des longueurs vaut exactement la longueur du texte (21 436) ; les chaînes sont des titres de menu et des textes d'aide. `lien` chaîne les options sœurs (0 = fin), `enfant` désigne le sous-menu (0 = texte terminal) : **hypothèse**, à valider avec `SOS.EXE` (non lu par `AM1.EXE`). Lecteur : `parseHelp`.

## État du monde : `A1FCFG.SYS`, `SVG001.STD`, `A1FTMP.SVG`

**Confirmé (données)** : `A1FCFG.SYS` et `SVG001.STD` sont **identiques octet pour octet** (21 868 octets) ; `SVG001.STD` est identique dans les 3 langues, `A1ACFG.SYS` / `A1DCFG.SYS` font 21 826 (une salle de 42 octets en moins : 59 salles). `A1FTMP.SVG` (22 444 octets) est un instantané de même format (136 objets au lieu de 132 ; reliquat de développement en FR, 10 octets en EN/DE). **Correction de la RE** : le premier jet comptait 59 salles à `0x17E` et laissait la fin « non étudiée » ; la disposition exacte est :

1. **En-tête de 54 octets = 27 mots** (confirmé (RE `gm_load_world` `192e:0008`, lecture `fread(0x36)`, écriture `gm_save_world` `1d4a:0002`) : mots 0 et 1 = signature `0x786B`, `0x00CA` (sinon erreur 0x18) ; mot 2 = dernier numéro de série d'objet (213) ; mot 3 : octet bas = nombre de lettres significatives du dictionnaire (8) ; mot 4 = chapitre × 100 + niveau (`DGROUP:4b4e`, 3) ; mot 10 = score (`DGROUP:4b5a`) ; mot 11 = numéro de série de l'objet héros (158) ; mot 12 = identifiant de la salle courante (1) ; mot 13 = **nombre d'objets (132)** ; mot 14 = **nombre de salles (60)** ; les autres mots (heure, luminosité, indicateurs : hypothèse) sont exposés bruts ;
2. `u16 n` (1 à 100, erreur 0xC7 sinon) puis **n enregistrements de 8 octets** : c'est la **table de score** `{id = chapitre × 100 + indice, points, son, répétitions}` (`engine.md` § 9.3, lue par `2255:00e8`), pas une table de zones géométriques : n = 35, ids 0-5, 100-108, 200-205, 300-313, somme des valeurs absolues = **725** (score maximal) ;
3. `u16 capacité`, `u16 b`, puis `b` enregistrements de 12 octets : la **file d'événements différés** `{Typ, Num, Ser, événement, compteur, procédure}` où « procédure » est une **clé** de la famille 8 (`1ec8:000a`), pas un offset ; opérations et passage `compteur = 0 -> déclenchement` : `objects.md` § 8 et `engine.md` § 9.3 ( confirmé (RE `23a2:03c2`)) ; `0, 0` dans `CFG` et `TMP.SVG` ;
4. **60 enregistrements de salle de 42 octets** à partir de 0x154 (confirmé (données) : ids 0-18, 20-22, 101-111, 201-212, 301-315 = les ids de scènes, y compris la salle 0 que le premier jet n'avait pas vue). Le mot 0 est l'id ; les mots 17 à 20 (octets 0x22-0x29, têtes de deux listes d'objets) sont remis à zéro à la lecture (confirmé (RE `192e:0008`)). Les pointeurs `seg:off` à segment `0x6172` sont des instantanés mémoire sans valeur. Champs établis (`engine.md` § 5.1) : +0x02 décalage de lumière (s16), +0x04 extérieur, +0x05/+0x06/+0x08 musique (classe, id, numéro), +0x0A six **sorties** (indice de la salle voisine, 0 = aucune ; symétriques : 156 liaisons), +0x16 six codes de barrage ;
5. **132 enregistrements d'objet de 144 octets** (0x90) jusqu'à la fin (confirmé (RE) : 54 + 2 + 35 × 8 + 4 + 60 × 42 + 132 × 144 = 21 868, vérifié sur le fichier).

**Objet (144 octets)** : disposition identique sur disque et en mémoire pour les octets 0x00-0x7B (le chargeur copie par blocs 0x00-0x43, 0x52-0x7B ; 0x44-0x51 est reconstruit, 0x7C-0x8F sont des pointeurs lointains remplis au chargement). Champs établis (confirmé (RE `gm_create_object` `19a6:000a`, `gm_dump_object` `1265:0008`) et (données)) : +0x00 `Num` (id de la ressource sprite) ; +0x02 `Ser` (numéro de série, unique : 132 valeurs distinctes) ; +0x04 `Typ` (0 `INT`, 1 `DEC`, 2 `OBJ`) ; +0x05..+0x08 `Gst`, `Mob`, `Dep`, `Txt` ; +0x54, +0x56, +0x58 `X`, `Y`, `P` (X <= 320) ; +0x5B `Cod` (1 = dans une salle, 2 = dans un autre objet, 3 = objet d'interface rattaché à la salle d'indice 0, 4 = transitoire) ; +0x5C = identifiant de la salle (Cod 1) ou numéro de série du contenant (Cod 2) (confirmé (données) sur les 132 objets). La table complète des 144 octets (offsets, noms du dump, rôles) est dans `engine.md` § 6.1 et **remplace** celle, approximative, de `re-index.md` ; `parseWorld` en expose les champs utiles (lumière, valeur, poids, capacité, `Ego`, `Fig`, présence, plan, `P`, `Sol`, vitesses) et conserve les octets bruts. `Fct` (+0x8C) est un pointeur vers la procédure de comportement de l'objet.

**CFG et STD sont identiques enregistrement par enregistrement** (test), `CFG` est l'état initial (`gm_savegame_slot` `2052:000c` lit et écrit les parties sous le nom `svg` + 3 chiffres, dont `SVG001.STD` : hypothèse), `TMP.SVG` est écrit puis relu par `gm_snapshot_world` (`203f:00c8`, retour en arrière : hypothèse). Lecteur : `parseWorld`.

## `A1FMIX.SYS`

Tables de sons et pistes (`gm_load_mix` `3024:0002` : 4 mots 68, 55, 4 666, 2 122, puis 68 × 8 octets et 55 × 42 octets, le reste = données). Détail, pilotes et séquenceur : voir **`audio.md`**. Non lu par les lecteurs de ce document.

## `A1FGPH.SYS`

**Correction de la RE** (confirmé (RE `gm_load_gph` `325a:0002`, dessin `327a:0044` et `32e1:00a2`) et (données) : 6 + 512 + 718 = 1 236) : `u16` largeur de cellule (5), `u16` hauteur de cellule (7), `u16` taille des données (718), **256 mots d'offsets** (un par code CP437), puis 718 octets de glyphes. Mot d'offset : **quartet haut = largeur du glyphe en pixels**, 12 bits bas = offset dans les données ; **0 = pas de glyphe** (le dessin retombe alors sur l'entrée du code 0, ici un blanc de largeur 2 : c'est aussi la largeur de l'espace 0x20) ; 124 codes ont un glyphe (le A mesure 4, é 4…). Glyphe : un octet `(première ligne << 4) | dernière ligne` puis une valeur par ligne, **bit 0 = pixel le plus à gauche** (A : `15 06 09 0F 09 09` = lignes 1 à 5, `0110/1001/1111/1001/1001`). La largeur d'un texte est la somme `largeur + espacement` moins un espacement final (`325a:01ac`). Le premier jet voyait une table de mots à 0x48 et des glyphes à 0x208 : c'était une lecture des mêmes octets décalée. Les 7 octets de plus en allemand correspondent aux glyphes ä ö ü Ä Ö Ü ß (hypothèse). Lecteur : `parseGph`.

## `A1FDEF.SYS`, `A1FANI.SYS`, `A1FINS.SYS`, `A1FTMP.SCR`

- **`A1FDEF.SYS`** (confirmé (RE `gm_def_lookup` `10b3:0006`) et (données)) : quatre `u16` = nombre de ressources `INT`, `DEC`, `OBJ`, `ANM` (30, 20, 92, 47), puis **189 enregistrements de 28 octets** dans cet ordre ; 8 + 28 × 189 = 5 300. Le premier mot est l'id de la ressource (la suite d'ids est celle des `.VGA`). Les 26 octets suivants servent de **modèle d'objet** quand le jeton `add*` crée un objet (`117d:0002` → `gm_create_object`) : octet 4 -> `Mob` (+6) et +0x25 de l'objet, octet 5 -> `Dep` (+7) et +0x27, octet 6 -> `Txt` (+8) et +0x26, octet 3 -> +0x24, octet 0x18 (signé) -> +0x0A ; sens des autres octets : inconnu (**hypothèse** pour tout champ non cité). Lecteur : `parseDef`.
- **`A1FANI.SYS`** (confirmé (RE `gm_load_ani` `16f5:000e`) et (données)) : `u16 n1` (47), `u16 n2` (147), `n1` enregistrements de 12 octets, `n2` mots ; 4 + 12 × 47 + 2 × 147 = 862. **Correction** : le premier jet comptait 296 octets finaux de « numéros d'images » ; ce sont 147 mots de pas. Enregistrement : mot 0 = numéro d'animation (1 à 47, égal à l'id `ANM`) ; mot 1 = **classe de son** (65 = `A` : un son est joué ; 32 = espace : aucun) ; mots 2 et 3 = numéros de son (0 sinon) ; **mot 4 = nombre de pas** (copié dans `Nbr` +0x36 de l'objet) ; **mot 5 = indice du premier pas** dans la table de mots. Chaque pas écrit l'octet bas d'un mot dans `Tim` (+0x32) de l'objet (`16f5:038c`). Un mot non nul au mot 2 déclenche un son (`FUN_16f5_0132`). Lecteur : `parseAni`.
- **`A1FINS.SYS`** (confirmé (RE `gm_init_paths` `1e68:0008`) et (données)) : 236 octets lus en `DGROUP:4f9a` ; octet 0 = type d'installation (0 : fichier fourni), octet 1 = lettre du lecteur (`C`), `\ARMAETH` à 0x10. Le reste (espaces et zéros) : inconnu. Lecteur : `parseInstall`.
- **`A1FTMP.SCR`** : 10 octets nuls ; lu et écrit par `gm_read_tmp_scr` / `gm_write_tmp_scr` (`1664:06b6`, `1664:0057`) ; rôle (état de salle temporaire) : **hypothèse**. Lecteur : `parseTmpScr`.

## `ARMAETH.RNC` — archive Rob Northen

Confirmé :

- En-tête de 11 octets : `RNCA`, u16 BE 674, u16 BE 0x884F, u16 BE 674, u8 0 (sens de 0x884F non établi ; 674 = début des données) ; puis **46 entrées** `nom ASCII\0` suivies d'un `u32` big-endian = offset du fichier dans l'archive, et un NUL de fin de table (à l'offset 673). Le premier fichier (`A1FINS.SYS`) est à 674.
- Chaque fichier est précédé d'un en-tête **RNC ProPack** : `RNC` + méthode + u32 BE taille décompressée + u32 BE taille compressée + CRC. Méthode **1** pour 43 fichiers ; **méthode 0 (copie brute)** pour `AIDE.BAT`, `ARMAETH.BAT`, `A1FTMP.SCR` (en-tête de 8 octets `RNC\0` + u32 BE taille). **Confirmé** : les tailles décompressées sont exactement les tailles des fichiers du CD (`AM1.EXE` 254 892, `A1F00A.VGA` 210 498, `A1FMSG.SYS` 115 992…) et `offset + 18 + taille compressée` = offset de l'entrée suivante pour les 43 fichiers de méthode 1. Le décompresseur n'a pas été écrit (les fichiers existent déjà sur le CD).
- 46 fichiers : 35 fichiers `A1F*` (dont `A1FTMP.SCR` et `A1FTMP.SVG`), `MSGUTL`, `MSGINT`, `MSGHRD`, `AM1.EXE`, `SC0.EXE`, `SC1.EXE`, `SOS.EXE`, `VGA.EXE`, `AIDE.BAT`, `SVG001.STD`, `ARMAETH.BAT`. Hypothèse : c'est ce que `HDINST.EXE` copie sur disque.
- Les `.VGA` du CD ne sont **pas** compressés eux-mêmes (aucune signature `RNC` à l'intérieur).


## Inconnues restantes

La RE a répondu aux points 1 à 5 du premier jet (codec des scènes, palette, section d'animation des sprites, grille de marche, disposition du monde : voir `graphics.md` et ci-dessus). Reste :

1. **Champs de salle** (42 octets) : les rôles non listés dans `engine.md` § 5.1 ; **objet** : octets +0x24..+0x2B et champs du curseur / du trajet, voir `engine.md` § 6.1.
2. (Mots 1 à 3 de `ANI` : résolus, `audio.md`.) Octets de `DEF` non cités, mots d'en-tête du monde autres que ceux nommés (`engine.md` § 9.4).
3. **Sémantique des jetons** : seuls les groupes 3, 4, 7, 8, 9 et le jeton `svg` sont nets ; effet de chaque jeton des `CM1..4` (`dgs`, `cnt`, `ttl`, `dsp`…) (le mot de répétition est élucidé : `parser.md` § 15).
4. ~~Classes de `DIC` et rôle de 0xFA~~ : élucidés, voir `parser.md` § 4.2 (classes) et § 13.2 (0xFA = espace).
5. **CP437 contre CP850** (indécidable sur les octets présents) ; `MSGUTL` est lu par `SC0`, `SOS` et l'installateur (`screens.md`).
6. `A1FSOS.SYS` : `lien`/`enfant` à confirmer dans `SOS.EXE`.
