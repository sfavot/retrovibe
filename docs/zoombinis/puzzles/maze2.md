# Le gouffre des véhibules (`MAZE2.MHK`, écran 18) : étude de rétro-ingénierie

Écran 18 de `ZOOMBINI.EXE` (L'Odyssée des Zoombinis, Broderbund / TERC, version 1.0FR, NE 16 bits), archive `MAZE2.MHK`. Étude de rétro-ingénierie, **relue ligne à ligne sur le corpus Ghidra (`archives/zoombinis/re/ZOOMBINI/`) en H9r** et complétée par les règles pures `src/games/zoombinis/game/puzzles/maze2.ts` (tests `test/zoombinis/puzzles/maze2.test.ts`). Cadre moteur : [../engine.md](../engine.md) (table des écrans `1530:14fe`, `SCRB` / `SCRS`, `REGS`, RNG) ; parcours, niveaux, sortie d'une épreuve : [../screens.md](../screens.md) §1.6, §3.4, §6.3.

Conventions : adresses `segment:offset` du code (`1118:xxxx` = module de l'épreuve, `1100:xxxx` = module d'aide propre à l'épreuve, seul appelant `1118`) ; `DS:xxxx` = segment de données `1530` (variables notées aussi `[xxxx]`) ; `S14:xxxx` = second segment de données `1450` (tableaux initialisés et tampons de l'épreuve), `S15:xxxx` = `1520` (table générique de dépôt par glisser-déposer, `1168:1742`). Confiance : **sûr** (lu dans le code ou vérifié sur les données ou par émulation), **probable** (déduit de plusieurs indices), **hypothèse**. Les données initialisées de l'exécutable (`S14` = segment `1450`, `DS` = `1530`) ont été relues directement dans les segments NE (sans relocation). Les arguments des appels `far` sont donnés dans l'ordre logique (corrigés de l'inversion du §0.2 d'`engine.md`). `rand(max, min)` = `10a8:04e8` : entier de `min` à `max` inclus.

Ce que fait l'épreuve en une phrase : le joueur glisse des Zoombinis, un par un, sur des rampes de lancement ; chacun voyage dans une bulle, **case par case, sur une grille de 13 × 13** posée au-dessus du gouffre, en suivant des panneaux, des aiguillages et des boutons ; il doit arriver sur la falaise en haut à droite (sortie 3). Les erreurs ne coûtent rien (le Zoombini repart du lieu où il s'est posé) ; seuls comptent ceux qui se trouvent sur la falaise 3 quand on quitte l'écran.

## 0. Résumé exécutif

- **But** : amener les Zoombinis de la falaise de départ (en bas à gauche) à la falaise 3 (en haut à droite). Un Zoombini est « sauvé » (`+0x127 = 1`) à l'instant où il entre dans une case de sortie de type `0x17` (`1118:1fb4`). Les autres sont perdus à la sortie de l'écran (renvoyés au dernier camp, `1168:36e1`, screens.md §3.4). **Sûr.**
- **Aucune règle cachée à deviner** : chaque aiguillage conditionnel (« panneau », case de type 2) **affiche** sur la carte l'icône du trait qu'il teste (attribut + valeur, plaque de la planche `tBMP 5100` images 11 à 30, dessin `1100:2679`). Le Zoombini tourne dans la direction du panneau si **son** trait correspond ; sinon il va tout droit. Le joueur lit les panneaux et choisit la rampe de départ. Ce qui est tiré au hasard : quels traits sont affichés sur les panneaux (choisis d'après la composition réelle de l'équipe, §4), quels jeux de sprites colorent les cases, et l'alternance des cartes d'une visite à l'autre. **Sûr** pour le mécanisme ; **probable** pour l'idée « règle visible » (l'image est celle d'une plaque de trait, vérifiée par rendu).
- **Erreurs** : pas de limite. Tout le groupe part de la falaise 0 (`DS:8920 = 0x10` : les 16 premières places de la falaise 0 sont prises ; **probable** pour `+0x76 = 0`). Un Zoombini rejeté (tourbillon, collision) revient sur la falaise où il avait été lancé (le numéro de falaise `+0x76` n'est modifié qu'à l'arrivée sur une sortie) et peut être relancé. Un Zoombini qui atterrit sur une autre falaise y reste ; 7 images après l'arrivée il quitte la liste des Zoombinis en vol (`1118:3263`) et peut être relancé **s'il y a une rampe active sur cette falaise**. C'est le mécanisme des **relais** du niveau 3 (rampes 12 et 14 sur la falaise 2, rampe 8 sur la falaise 1 : on y arrive en atterrissant sur la sortie correspondante) ; sans rampe active sur sa falaise, le Zoombini est perdu. Au plus 10 Zoombinis dans la liste en vol (lancés et non rejetés ou arrivés depuis moins de 7 images, cases d'attente comprises). **Sûr.**
- **Fin** : le bouton « Go » (région 2) n'est actif qu'après qu'**un** Zoombini au moins a atteint la sortie 3 (`[8916] = 1`) ; il mène à Zoombiniville (`[8556] = 6`). Le bouton « Map » ramène à la carte (`[8556] = 1`) en abandonnant le groupe. Tout Zoombini qui n'est pas sur la falaise 3 est perdu. **Sûr.**
- **Quatre niveaux** (+ un cas particulier) : nombre de panneaux conditionnels (4 / 5 / 7-8 / 9), présence d'aiguillages tournants, de boutons (types 4-7) et de cases d'attente (type 5), nombre de rampes (1 à 3) et relais par les falaises 1 et 2 au niveau 3 (§3). **Sûr.**
- **Écrit à la sortie** : rien d'autre que ce que fait `1168:36e1` pour toute épreuve (marque de réussite écran 18, Zoombinis perdus rendus au camp 2, monument éventuel, progression), plus `S+0x51` par `1108:0000` (§6).

## 1. Identification

### 1.1 Lieu

Les 15 noms de `TEXTSTR.MHK` `STRL` 2000 donnent, en 14e position, **« le gouffre des véhibules »** pour l'écran 18 (correspondance par ordre, engine.md §2.3). Confirmation par le contenu : le fond `tBMP 5000` est un gouffre rocheux entre quatre falaises (rendu vérifié), et les objets mobiles sont des **bulles de savon** (planche `tBMP 10000`, images 1 à 40 : bulles qui ondulent, 41 à 62 : éclaboussures, tourbillon) : « véhibules » = véhicules-bulles. Correspondance : **probable** (nom par ordre) renforcée par le rendu ; je n'ai pas trouvé de texte du jeu qui nomme explicitement l'épreuve. Rapprochement avec l'original : cette épreuve ressemble à celle que les versions anglaises appellent « Bubblewonder Abyss » (souvenir, **hypothèse** : je n'ai aucun texte anglais du jeu sous la main pour le confirmer).

### 1.2 Handlers (table `1530:14fe`, descripteur `1530:180c`)

| Rôle | Adresse | Notes |
|---|---|---|
| Enter | `1118:0000` (4 514 octets) | §1.3 et §5 |
| Exit | `1118:145f` | une seule fois (`[8914]`) : `11a8:021c` (qui appelle `1168:36e1(0, 1)` hors entraînement), fermeture de l'archive et des ressources |
| Tick | `1118:1503` | machine à files d'événements (§5.1) |
| Key | `1118:2989` | ne traite que le code `0x16f` (`11a0:155e`, hors épreuve) ; renvoie faux pour toute autre touche si le mode de test `[a43f]` est coupé. Aucun raccourci de jeu. |
| Régions cliquables | table `DS:1800`, `1038:0000(0xc000, 1, 0x1800)`, callback `1118:2285` | région 1 = Map, 2 = Go, 3 = zone de jeu (§5.2) |

Appels propres à l'épreuve : `1118:4a3e` (charge la carte du niveau), `1118:4ad2` (construit le niveau), `1118:4c6e` / `1118:4cf0` (crée les objets de la carte), `1118:11b8` (charge un `REGS` et échange ses mots), `1118:127e` (libère), `1118:12c0` (dessin des boutons Map / Go), `1118:13fc` (rafraîchissement des boutons), `1118:1fb4` (arrivée sur une sortie), `1118:29cc` (animation d'une rampe), `1118:3140` à `1118:3e9e` (rappels d'événements), `1100:0000` (initialisation d'un Zoombini), `1100:0b69`, `1100:1301`, `1100:1527`, `1100:1a9d`, `1100:20dc`, `1100:102a` (une case de chaque type, §2.3), `1100:02cf` (collision), `1100:2679` (dessin d'une case).

### 1.3 Ressources de `MAZE2.MHK` (vérifiées sur l'archive) et usage

| Ressource | Contenu | Usage |
|---|---|---|
| `tBMP 100` | terrain 160 × 120 | `11a8:1783(100)`, déplacement libre des Zoombinis (engine.md §3.4) |
| `tBMP 5000` + `SHPL 5000` | fond 640 × 480 | `11a8:1475(5000)` : le gouffre |
| `tBMP 5100` (198 images) | cases de la grille | `11a8:2ae6(5100)` → `[886e]` ; ancres `REGS 18000` (X) et `18001` (Y) → `[887e]`, `[8882]` ; `REGS 18002` jamais chargé |
| `tBMP 6000` (6 images) | boutons Map / Go | `1118:12c0`, image 1 Go inactif, 2 Go, 3 Go enfoncé, 5 Map, 6 Map enfoncé (image 4 non vue) |
| `tBMP 7000` (31) + `SCRB 7000`-`7027` (28) | marques et plaques de rampes | groupe 0 |
| `tBMP 8000` (14) + `SCRB 8000`-`8013` | calques d'ordre et décors de falaises | groupe 1 |
| `tBMP 9000` (218) + `SCRB 9000`-`9007` | rampes de lancement (3 familles) et décors animés | groupe 2 |
| `tBMP 10000` (64) + `SCRB 10000`-`10043` | bulles, éclaboussures, tourbillon | groupe 3 ; ancres `REGS 17000` (X) / `17001` (Y) ; `REGS 17002` non chargé |
| `tBMP 12000` (1) + `SCRB 12000`-`12002` | curseur / pointeur (non étudié) | groupe 4 |
| `SCRB 11000`-`11002` | scripts de 2 et 27 images (non étudiés) | hors groupes du chargement (id 11xxx) |
| `SCRS 14000`-`14007` (« REJECT ») | poses de Zoombini rejeté (`1168:03ef(0, 8, 14000)`) | §5.4 |
| `SCRS 15000`-`15095` (« NORMAL ») | marches, attente, collisions, poses de rampe, danses (`1168:04d0(0, 0x60, 15000)`) | §5.4 |
| `REGS 16000` | positions écran des 169 cases | §2.1 |
| `REGS 16600`-`16609` | cartes de niveau | §3 |
| `REGS 16001`, `16002`, `16499`, `16500`, `16501`* | non référencés par une constante dans le code (*sauf `16501`, chargé : voir §2.1) | `16001` et `16002` : 338 mots chacun, ≠ `16000` ; `16499` : 40 mots (4 enregistrements de 10 mots) ; `16500` : grille 13 × 13 de valeurs 0 à 3 (esquisse de la disposition ?) |
| `\0SND 5100`-`5103`, `9000`, `9001`, `10000`-`10004`, `11000`, `12000` | sons | §5.5 |

Les `SCRB` sont inscrits en 5 plages (`11a8:14ab(28, 7000)`, puis `11a8:15a6(14, 8000)`, `(8, 9000)`, `(44, 10000)`, `(2, 12000)` (donc `SCRB 12000`-`12001`) ; les groupes de formes 0 à 4 reçoivent `tBMP 7000, 8000, 9000, 10000, 12000`, sans `REGS` automatiques : `11a0:0000(0, k, id)`) ; la plage `SCRB 11000`-`11002` n'est pas inscrite. Les `SCRS` communs `100`-`150` et les poses des Zoombinis viennent de `ZOOMBINI.MHK` (engine.md §3.3). **Sûr.**

## 2. Modèle de l'épreuve

### 2.1 La grille et ses coordonnées

- Grille **13 × 13** de cases `(r, c)`, `r` = ligne (indice `+0x6e` / `+0x72` des objets), `c` = colonne (`+0x70` / `+0x74`). Tableau des types de case `S14:0d18` (13 mots par ligne, adresse `0xd18 + 0x1a·r + 2·c`), tableau des identifiants d'objets `S14:0bc6` (même disposition), tous deux remis à zéro à l'entrée (`11c8:6a5c`, 0x152 octets).
- **Position écran de la case `(r, c)`** : `REGS 16000` (169 paires `(x, y)` de mots signés, indice `2·(13·r + c)`) ; `(0, 0)` = case hors du losange. Cases valides : ligne 0 colonnes 2 à 10, ligne 1 colonnes 0 à 10, lignes 2 à 10 colonnes 0 à 12, ligne 11 colonnes 2 à 11, ligne 12 colonnes 3 à 10. Exemples : `(0, 2) = (53, 131)`, `(0, 10) = (105, 301)`, `(10, 0) = (439, 70)`, `(6, 6) = (328, 203)`, `(12, 10) = (617, 280)`. La ligne croît vers la droite de l'écran (≈ +40 px en x par ligne), la colonne vers le bas (≈ +21 px en y par colonne). Un Zoombini est dessiné à `position_case + (4, −38)` (`1100:0b69`). **Sûr.**
- **Directions** (octet / mot `+0x58` d'un Zoombini, champ `g` d'une case) : `0` = colonne − 1 (vers le haut de l'écran), `1` = ligne + 1 (vers la droite), `2` = colonne + 1 (vers le bas), `3` = ligne − 1 (vers la gauche). Un pas qui sortirait de `0..12` laisse la case inchangée (`1100:0b69`) ou la borne à 0 / 12 (`1100:1527`, `1100:1a9d`). Dans toutes les cartes réelles, aucun trajet ne sort du losange : il aboutit à une sortie ou à un tourbillon (vérifié par simulation, §7). **Sûr.**
- **Cases de sortie** (valeur `0x14` à `0x17` dans `S14:0d18`, posées par `1118:4ad2` d'après deux tables de `S14` : types `0x320`, 18 mots, cases `0x344`, 18 paires `(r, c)`) :

| Sortie | Valeur | Cases | Falaise (rectangle de dépôt `S14:13d8 + 8·i`) |
|---|---|---|---|
| 0 | `0x14` | `(0,10) (1,10) (2,10) (2,11) (2,12)` | bas gauche, rect `(0, 250)`-`(300, 479)` |
| 1 | `0x15` | `(0,2) (1,2) (1,1) (1,0)` | haut gauche, rect `(0, 0)`-`(200, 175)` |
| 2 | `0x16` | `(10,12) (10,11) (11,11) (12,10)` | bas droite, rect `(450, 230)`-`(639, 400)` |
| 3 | `0x17` | `(10,0) (10,1) (10,2) (11,2) (12,3)` | **haut droite, rect `(400, 0)`-`(639, 200)` : la falaise à atteindre** |

- `REGS 16501` (169 mots, valeurs 0 à 2) est chargé par `1118:11b8` en `[88d2]` : il ne sert qu'à choisir la famille de sprite de l'éclaboussure d'une collision (`+ [88d2][r·12 + c]` dans `1100:02cf`, pas de 24 octets au lieu de 26 : **hypothèse** d'une relique ou d'un défaut de l'original ; sans effet sur les règles).

### 2.2 Les rampes de lancement (« zones », 14)

Un Zoombini est lancé en le déposant sur une **rampe** (pad). 14 rampes numérotées 1 à 14 (indice interne 0 à 13). Tables `S14` : point de dépôt `0x38 + 4i` (`x`, `y`), case de départ `0x2e8 + 4i` (`r`, `c`), direction `0xfe + 2i`, classe de pose `0x11a + 2i`, miroir `0xaa + 2i`, paramètre `0xe2 + 2i`, script de rampe `0x28e + 2i`, position de la plaque `0x2b0 + 4i`.

| Rampe | Point de dépôt | Case de départ | Dir. | Classe | Script rampe | Falaise |
|---:|---|---|---:|---:|---:|---|
| 1 | (101, 283) | (0, 9) | 0 | 0 | `SCRB 9000` | 0 (bas gauche) |
| 2 | (148, 282) | (1, 9) | 0 | 0 | 9000 | 0 |
| 3 | (188, 280) | (2, 9) | 0 | 0 | 9000 | 0 |
| 4 | (195, 275) | (4, 10) | 1 | 1 | `SCRB 9001` | 0 |
| 5 | (203, 297) | (4, 11) | 1 | 1 | 9001 | 0 |
| 6 | (210, 316) | (4, 12) | 1 | 1 | 9001 | 0 |
| 7 | (95, 65) | (3, 0) | 1 | 1 | 9001 | 1 (haut gauche) |
| 8 | (100, 81) | (3, 1) | 1 | 1 | 9001 | 1 |
| 9 | (104, 96) | (3, 2) | 1 | 1 | 9001 | 1 |
| 10 | (622, 271) | (12, 10) | 0 | 0 | 9000 | 2 (bas droite) |
| 11 | (576, 288) | (11, 10) | 0 | 0 | 9000 | 2 |
| 12 | (545, 287) | (10, 10) | 0 | 0 | 9000 | 2 |
| 13 | (543, 286) | (8, 11) | 3 | 2 | `SCRB 9003` | 2 |
| 14 | (554, 308) | (8, 12) | 3 | 2 | 9003 | 2 |

Le miroir vaut 1 pour les rampes 13 et 14 (0 sinon), le paramètre `+0xf1` vaut 2 pour les rampes 4 à 9, 13, 14 (0 sinon) : orientation du Zoombini posé sur la rampe (**probable**). **Aucune rampe n'est sur la falaise 3.** Les rampes **actives** d'un niveau sont celles de l'en-tête de sa carte (§3.1) ; les autres ne peuvent pas recevoir de Zoombini (`S15:02f0 = 0xfff6`). La falaise d'une rampe est celle dont le rectangle de dépôt (`S14:13d8`) contient son point de dépôt (le glisser-déposer est limité au rectangle de la falaise du Zoombini). Les rampes 7 à 14 ne servent donc qu'à un Zoombini arrivé sur leur falaise (relais). **Sûr.**

### 2.3 Les types de case (champ `kind`, mot `+0x6c` d'un objet de carte)

La valeur de `S14:0d18` de la case détermine ce qui arrive à un Zoombini qui **entre** dans la case (aiguillage du Tick, `1118:1503` lignes 148-198). Une case sans objet vaut 0 (sol libre). **Sûr** pour les effets ; les noms sont de moi.

| `kind` | Nom | Effet à l'entrée (fonction) |
|---:|---|---|
| 0 | sol | le Zoombini continue tout droit (`1100:0b69`) |
| 1 | tourbillon | **rejeté** : pose `SCRS 14006`, puis retour à la file de sa falaise de lancement (§5.3). Objet : tourbillon `SCRB 10031` (`1100:1301`) |
| 2 | panneau conditionnel | si l'octet d'attribut `+0xec + a` du Zoombini égale `v` (`a`, `v` = trait du panneau, §2.4), sa direction devient `g` ; sinon inchangée. Puis il avance (`1100:1527`) |
| 3 | flèche / aiguillage | la direction du Zoombini devient `g` ; si `rec9 ≠ 0` (aiguillage tournant), `g` passe ensuite à la direction suivante autorisée (`g ← (g+1) mod 4` en sautant les directions de `f` = 0), son sur `5101`/`5102` alterné, puis le Zoombini avance (`1100:1a9d`) |
| 4 | aiguillage à bouton | même effet que le type 3 ; en plus tournés par les boutons du même type (type 6, ci-dessous) |
| 5 | case d'attente | le Zoombini **s'arrête** (animation d'attente en boucle `SCRS 15056`-`15075`) ; il est libéré par un bouton du même type ou dès qu'un autre Zoombini part vers sa case (`1100:20dc`, `1100:0b69`…) |
| 6 | bouton | son `5103` ; **tous** les objets de même type : les aiguillages de type 4 passent à la direction autorisée suivante, les cases d'attente de type 5 relâchent leur occupant ; puis le Zoombini avance (`1100:102a`) |
| `0x14`-`0x17` | sortie 0 à 3 | arrivée sur la falaise (`1118:1fb4`) |

Détails exacts :

- **Panneau (type 2)** : `+0x82` = `a + 1` (indice d'attribut + 1), `+0x84` = `v` ; test `trait[+0xeb + (+0x82)] == +0x84`, soit octet d'attribut `a` (`+0xec`…`+0xef`) égal à `v` (1 à 5). Sans correspondance, `g` est ignoré. **Sûr.**
- **Aiguillage (types 3 et 4)** : `1100:1a9d` fait `dir_Zoombini = g` **avant** de faire tourner `g` (le Zoombini qui actionne l'aiguillage prend l'ancienne direction). Rotation : `g ← g + 1 (mod 4)` puis tant que `f[g] = 0`, `g ← g + 1`. Le mot `rec9` (`+0x7e`) à 1 déclenche cette rotation à chaque passage ; à 0 elle n'a lieu que par un bouton (type 4 seulement : la fonction de bouton `1100:102a` ne tourne que les objets de `kind` 4). Les aiguillages tournants des cartes sont des `kind` 3 (16603, 16604, 16605, 16609) ou des `kind` 4 de type 1 (16600, 16601, 16606), jamais liés à un bouton (le type 1 n'a aucune liste de bouton, `102a` ne fait rien pour un bouton de type 1). Le mot `rec9` d'un panneau est ignoré (16601 en a un à 1). **Sûr.**
- **Case d'attente (type 5)** : à l'arrivée, `case.occupant = id du Zoombini` (`+0x86`, `1100:20dc`, sans tester l'occupant précédent). Si un Zoombini **part vers** une case d'attente déjà occupée (test dans `1100:0b69`, `1527`, `1a9d`, au calcul de sa case visée : destination de type 5 avec `+0x86 ≠ 0`), l'ancien occupant est libéré (file `[894e]`, traitée au Tick suivant) avec **la direction du nouvel arrivant** (`occupant.+0x58 = arrivant.+0x58`, direction déjà corrigée par le panneau ou l'aiguillage de la case quittée) ; le nouvel arrivant devient l'occupant en arrivant. Un Zoombini lancé depuis une rampe de direction 1 ou 3 (bond sur sa case de départ) ne libère donc pas l'occupant d'une case d'attente (aucune carte ne met de case d'attente sur un départ). Un bouton (type 6) du même type libère l'occupant avec sa direction d'origine. Tant qu'il est retenu, le Zoombini rejoue `SCRS 15055 + 5·(dir) + variante`, dont la fin (événement `0x3d`) le remet en file de traitement : il reste donc dans la case. **Sûr** pour le mécanisme.
- **Bouton (type 6)** : actionné à **chaque** entrée d'un Zoombini dans la case (pas de mémoire d'état). Le type est le champ `rec3` (`+0x72`, 1 à 8 ; 1 est le type « à part » des aiguillages tournants et n'a aucun effet pour un bouton). Les cibles sont tous les objets de même type : `kind` 4 (rotation) et `kind` 5 (libération de l'occupant, dans l'ordre inverse d'enregistrement ; il garde sa direction). **Sûr.**
- **Collision** : si deux Zoombinis **réservent** la même case dans la même fenêtre de temps, ils sont **tous deux rejetés** (§5.4). Mécanisme (`1118:3ecd` et ses trois variantes) : à la 4e image de chaque pas de case (`+0xc8 = 3`, événement `0x14`, `0x1e`, `0x28` ou `0x32` selon la direction, lu par le rappel `1118:3e9e`) le Zoombini incrémente le compteur de sa case visée `(S14:0x7d0 + 0x4e·r + 6·c)` ; à 1 il y inscrit son identifiant (`+0x7d2`) ; à 2 la paire (premier, second) est mise en file `[8952]` et l'identifiant est effacé (le compteur reste à 2) ; au-delà de 2 le compteur et l'identifiant sont remis à 0. La réservation est levée à la fin du pas (image 6, `1118:1503` file `[8948]`) si l'identifiant est encore le sien. Le **bond de lancement** des rampes de direction 1 et 3 (2 images) n'a pas de 4e image : il ne réserve rien. La fenêtre de collision d'un pas de 6 images est donc de 3 images d'écart de phase au plus. **Sûr** pour le mécanisme ; la durée d'une image n'a pas d'effet sur les règles.

### 2.4 Traits et icônes

Un Zoombini a 4 octets d'attribut de 1 à 5 (screens.md §2.1) : `+0xec` (attribut 0), `+0xed`, `+0xee`, `+0xef` (attribut 3). Un **trait** est le couple `(a, v)` ; son indice dans les tables de l'épreuve est `k = 5·a + v` (1 à 20 ; décalages `DS:18f0 = {0, 5, 10, 15}`) ; la table `DS:189c` donne `(a, v)` de `k = 0` à 19 (`k = 0` → `(0, 0)` : ne correspond jamais). Icône d'un panneau : image **`10 + 5·a + v`** de `tBMP 5100` (11 à 30, plaques de 26 × 11 px : 11-15 coiffes, 16-20 yeux, 21-25 nez de cinq couleurs, 26-30 pieds, d'après le rendu ; l'ordre des attributs coiffe / yeux / nez / pieds est donc **probable**, cohérent avec l'hypothèse d'engine.md). La marche d'un Zoombini dépend du type de pieds : les `SCRS` de marche sont indexés par `+0xbf` (1 à 5) et ceux de lancement par `+0xef`, qui semblent être la même valeur (**probable**).

## 3. Niveaux de difficulté

`1168:515d()` renvoie le niveau (0 à 3 ; en entraînement `[96f2] − 1`). À l'entrée : `niveau = 515d()` ; **si `niveau = 3` et que l'équipe compte moins de 5 Zoombinis (`[88e4] < 5`), `niveau = 4`** (`1118:05ab`). `1118:4a3e(niveau)` charge la carte (`REGS` `16600`-`16609`), `1118:4ad2(niveau)` construit la partie.

### 3.1 Format d'une carte de niveau (`REGS 16600 + i`, mots big-endian)

L'id vient de `1118:4a3e` : `16600 + compteur` (Ghidra affiche `0x40d8 + compteur` comme une adresse de chaîne ; `0x40d8 = 16600`). **Sûr.** Les dix cartes se lisent sans reste (taille = `10 + 10 n` mots).

```
mot 0       n    nombre d'enregistrements
mots 1..9        numéros (1 à 14) des rampes actives, 0 = vide  (lus par 1118:0000 : [893c][1..9])
                 (mot 1 à 3 seuls utilisés : 1 à 3 rampes par carte)
puis n enregistrements de 10 mots (adresse mot 10 + 10·j)  -- 1118:4c6e/4cf0
   0  kind    1 à 6 (§2.3)
   1  r       ligne
   2  c       colonne
   3  type    0 pour kind 1 ; 1 pour kind 2 et 3 ; 1 à 8 pour 4 à 6 : lien bouton / aiguillage / attente
   4..7  f1..f4   directions autorisées (f[d] = 1 : la direction d peut être prise, `d` = 0..3)
   8  g       direction courante (kind 2 : direction du panneau ; kind 3, 4 : direction d'envoi)
   9  rot     1 = le kind 3 / 4 tourne à chaque passage
```

(`f` sert à la rotation et au dessin des 4 « pétales » de direction ; pour un panneau, `f` ne contient que `g`.) Les en-têtes (mots 1 à 3 : rampes actives) : `16600` (1, 4), `16601` (1, 3), `16602` (1, 4), `16603` (2), `16604` (3), `16605` (3), `16606` (2, 4, 12), `16607` (1, 3, 14), `16608` (3, 5, 8), `16609` (3). **Sûr.**

Chaque enregistrement crée un objet (`11a8:0ad6`, délai `rand(25, 20)`, sans script, `1118:4cf0`) : `S14:0bc6[r][c] = id`, `S14:0d18[r][c] = kind`, position écran `REGS16000[(r, c)]` (`+0xd6`), jeu de sprites `+0x80` = `[8974 + 2·(type − 1)]` : le type 1 prend la base 31 (images 31-51 de `tBMP 5100`), les types 2 à 8 reçoivent **dans un ordre aléatoire** les bases {52, 73, 94, 115, 136, 157, 178} (tirage sans remise `rand(local_a, 2)` avec `local_a` de 8 à 2, `1118:4ad2` : 7 tirages dont le dernier, `rand(2, 2)`, n'avance pas le hasard ; les bases viennent de `DS:1886`, vérifiées). Chaque objet est enregistré dans la liste de son type (`[8960]`…, tableaux `S14:10ea`, `1248`, `127a`, `12ac`, `12de`, `1310`, `1342`, `1374`, 20 places chacun) pour que le bouton retrouve ses cibles. Pour un panneau, l'enregistrement reçoit le trait `k = S14:07a8[[892c]]` (un par panneau dans l'ordre du fichier, §4). **Sûr.**

### 3.2 Les dix cartes

| Fichier | Niveau (carte alternée) | Générateur | Rampes actives | Cases `kind 1 / 2 / 3 / 4 / 5 / 6` | Panneaux | Remarque |
|---|---|---|---|---|---:|---|
| `16600` | 0 (1re, `[177a] = 0`) | `1118:67d3` | 1, 4 | 2 / 4 / 9 / 1 / 0 / 0 | 4 | 1 aiguillage tournant (`kind` 4 type 1, (4,8)) |
| `16601` | 0 (2e, `[177a] = 1`) | `67d3` | 1, 3 | 1 / 4 / 13 / 1 / 0 / 0 | 4 | idem en (2,4) ; une flèche parasite sans direction en (0,0), hors du losange (reproduite) ; un panneau a `rec9 = 1` (ignoré) |
| `16602` | 1 (`[177c] = 0`) | `1118:6b4d` | 1, 4 | 1 / 5 / 12 / 1 / 0 / 0 | 5 | aiguillage tournant (`kind` 4 type 1, (3,3)) |
| `16603` | 1 (`[177c] = 1`) | `1118:6f02` | 2 | 1 / 8 / 15 / 2 / 0 / 2 | 8 | boutons et aiguillages de types 4 et 5, aiguillage tournant `kind 3` (4,8) |
| `16604` | 2 (`[177e] = 0`) | `6f02` | 3 | 1 / 7 / 16 / 3 / 0 / 2 | 7 | aiguillage tournant `kind 3` (7,3) |
| `16605` | 2 (`[177e] = 1`) | `1118:7532` | 3 | 1 / 8 / 14 / 2 / 0 / 2 | 8 | aiguillage tournant `kind 3` (2,2) |
| `16606` | 3 (`[1780] = 0`) | `1118:7acf` | 2, 4, 12 | 5 / 9 / 12 / 5 / 3 / 4 | 9 | rampe 12 sur la falaise 2 (relais) ; aiguillage tournant `kind` 4 type 1 (10,6) |
| `16607` | **jamais choisie** (`[1780]` ne vaut que 0 ou 2) | — | 1, 3, 14 | 4 / 9 / 18 / 4 / 2 / 4 | 9 | donnée inutilisée (rampe 14, falaise 2) |
| `16608` | 3 (`[1780] = 2`) | `7acf` | 3, 5, 8 | 4 / 9 / 18 / 5 / 2 / 4 | 9 | rampe 8 sur la falaise 1 (relais) |
| `16609` | 4 (équipe < 5) | `7532` | 3 | 1 / 8 / 14 / 2 / 3 / 2 | 8 | **`16605` plus trois cases d'attente** (types 3, 4, 5 en (4,4), (5,8), (0,6)) : voir point 8 |

Alternance : `1118:4ad2` incrémente après usage `[177a]` (modulo 2), `[177c]`, `[177e]` (modulo 2) ou `[1780] += 2` (modulo 4, soit 0 / 2). Ces compteurs sont des variables initiales de `DS` (valeur 0) et **persistent entre deux visites de l'épreuve dans la même session** : la première visite du niveau 0 joue `16600`, la deuxième `16601`, la troisième `16600`… Le niveau 1 alterne `6b4d` + `16602` puis `6f02` + `16603` ; le niveau 2 alterne `6f02` + `16604` puis `7532` + `16605` ; le niveau 3 alterne `16606` / `16608` avec `7acf`. Pas de sauvegarde dans le fichier de partie (**probable** : aucune écriture dans `S`). **Sûr.**

**Relais (correction de la première lecture)** : les « rampes-pièges » 12, 14 et 8 du niveau 3 n'en sont pas. Aucun Zoombini ne part d'une autre falaise que la 0 : ces rampes ne servent qu'à un Zoombini qui a atterri sur la falaise 2 (sortie 2) ou 1 (sortie 1), et qui repart de là vers la sortie 3. L'ancienne simulation (§7) les lançait depuis la falaise de départ, d'où ses tourbillons. Les niveaux 0 à 2 n'ont que des rampes sur la falaise de départ (rampes 1 à 6) ; seul le niveau 3 en place sur d'autres falaises (2, 4, 12 ; 1, 3, 14 ; 3, 5, 8). Un Zoombini qui atterrit sur la falaise 0 (sortie 0) peut aussi être relancé. **Sûr.**

## 4. Choix des panneaux (génération de la règle)

Chaque générateur remplit `S14:07a8[0..]` (indice `[8928]`) de traits `k` (1 à 20 ; 0 = panneau inerte), consommés dans l'ordre des enregistrements `kind 2` du fichier (`1118:4cf0`, compteur `[892c]` ; `k` → attribut `DS:189c[4k]` et valeur `DS:189c[4k+2]`). Ils reposent sur la composition **réelle** du groupe : `1168:365d` liste les Zoombinis dont `+0xe0 ≠ 0` et `+0x127 ≠ 0` (le groupe courant, avant la remise à 0 de `+0x127` par `1168:3dd0`), dans l'ordre de la liste d'objets ; `n = [88e4]` ≤ 16.

**Statut : réécrits bit à bit** dans `maze2.ts` (`generateTraits`), puis **vérifiés par émulation x86-16 du désassemblage résolu** (`1118:5206` à `1118:7acf`, avec le même générateur congruentiel) sur 4 800 groupes aléatoires (1 à 16 membres, attributs de 1 à 5, groupes très peu variés ou presque identiques, niveaux 0 à 4) : pour les cinq générateurs, traits écrits, nombre d'écritures et état final du hasard sont identiques dans tous les cas. Onze vecteurs de l'émulateur sont figés dans les tests. **Sûr.** Les fonctions que le texte précédent avait seulement résumées (`5643`, `5ad6`, `5e8f`, `61fd`, `67d3`, `6b4d`, `6f02`, `7532`, `7acf`) sont donc closes.

**Tableaux** (`n` membres ; trait `k` = `5·attribut + valeur`) :

| Élément | Rôle |
|---|---|
| `S14:056c` | copie de travail de l'équipe : `n` lignes de 4 mots (valeurs 1 à 5, **0 = retiré**), `1118:5206` (tout recopier) |
| `S14:06ac[1..20]` | histogramme `H[k]` des membres non retirés (`1118:5390`) |
| `S14:0e6a`, `S14:0f0a` (20 × 4 mots), `[893a]` | traits déjà utilisés : une valeur par attribut (`0e6a`) et ligne entière (`0f0a`) ; `[893a]` = nombre de lignes |
| `S14:06d6` → `S14:072a`, `[8930]`, `[8932]` | traits que **personne** ne porte (`H[k] = 0`), liste compacte à partir du rang 1 (`1118:6645` + `6688`) ; vide → les 20 traits (`1118:67a7`) ; tirage `072a[rand(8930, 8932)]` (`[8932]` = 1 si non vide) |
| `S14:0700` → `S14:0754`, `[8934]`, `[8936]` | même chose pour la liste de repli de `6f02` / `7532` (`1118:66f6` + `6739`) |
| `DS:18f0`, `DS:18f8`, `DS:193c`, `S14:13f8` | décalages d'attribut {0, 5, 10, 15} ; ⌈r/2⌉ ; taille de groupe visée {1,1,1,1,4,4,4,7,7,7,10,10,10,13,13,13,16} (indice : membres restants ; la première lecture se trompait sur ce tableau) ; attribut (1 à 4) de chaque trait (le trait 20, lu hors table par `65b9`, vaut 4 dans le fichier) |

**Outils** (arguments dans l'ordre `(max, min)` des appels `04e8`) :
- `1118:5390(p)` : remet `H` à 0 ; **retire** (ligne mise à 0) tout membre portant `p` (si `p ≠ 0`) ; compte les restants et incrémente `H` pour leurs 4 traits ; renvoie le nombre de restants.
- `1118:52a6(p)` : ne garde que les porteurs de `p`. `1118:658e` : nombre de traits à `H ≠ 0`. `1118:5da8(k) = H[k]`.
- `1118:5e24(max, min)` : trait de plus grand `H ∈ [min, max]` (**premier** en cas d'égalité) ; `1118:559d(ex)` : de plus grand `H` hors `ex` ; `1118:65b9(max, min, ref)` : comme `5e24` mais limité à l'attribut de `ref` et à `k < 20`.
- `1118:5643(mode, ex)` : trait de plus **petit** `H > 0` (le **dernier** en cas d'égalité : comparaison `≤`), hors `ex`, dont un membre n'a aucune de ses 4 valeurs déjà utilisée dans `0e6a` (test actif tant que `[893a] < 3`) ; **retire ce seul membre**, l'enregistre (mode 0 : seule la valeur de l'attribut du trait dans `0e6a`, la ligne dans `0f0a` ; sinon ligne entière dans les deux si `[893a] < 4`) et recompte `H`.
- `1118:5ad6(ex)` : même choix de trait (plus petit `H > 0`, dernier) mais le test ne porte que sur la valeur de l'attribut du trait dans `0e6a` (tant que `[893a] < 4`) ; enregistre la ligne du membre dans `0e6a` (si `[893a] < 20`), retire **tous** les porteurs, recompte.
- `1118:5e8f(max, min)` : trait de plus grand `H ∈ [min, max]` (premier) dont un porteur passe le test de `0e6a` (valeur de l'attribut du trait) ; retire **tous** les porteurs en les enregistrant dans `0f0a` et `0e6a` (si `[893a] < 20`) ; `1118:61fd(max, min)` : idem avec le test « n'importe quelle valeur dans `0f0a` », enregistrement dans `0f0a` seul.

**Générateurs** (`T[i]` = `S14:07a8`, `rand(m)` = tirage dans la liste `072a`, `rand'` = dans la liste creuse `0700` puis `072a` si 0) :
- Début commun (`67d3`, `6b4d`, `6f02`) : `5206`, `r = 5390(0)`, liste des absents (ou les 20 traits), puis `T[0]` = `5e24(2,1)` si `r < 3`, sinon la première réussite de `5e24(5,2)`, `(9,6)`, `(16,10)`, `(16,1)`, sinon `rand(m)`.
- **`67d3`** (niveau 0, 4 panneaux) : `T[1] = T[0]`, `r = 5390(T[1])` ; si moins de 5 traits portés : `T[2]`, `T[3]` = `rand(m)` ; sinon `T[2] = 5e24(⌈r/2⌉, 1)` (repli `rand(m)`), `5390(T[2])`, `T[3] = 65b9(⌈r/2⌉, 1, T[2])` (repli `rand(m)`), échange de `T[2]` et `T[3]` si le second est plus porté que le premier. (Le test `[1778] = 2` qui ajouterait un doublon n'est jamais vrai ici.)
- **`6b4d`** (niveau 1, 1re carte, 5 panneaux) : `T[0] = T[1] = T[2]`, `r = 5390(T[2])` ; puis `T[3]`, `T[4]` : avec moins de 5 traits, `559d(0)` (repli `rand(m)`) puis `rand(m)`, échange si `T[3]` est porté ; sinon comme `67d3`.
- **`6f02`** (niveau 1 carte 2 : 8 panneaux ; niveau 2 carte 1 : 7) : `T[0]`, `52a6(T[0])`, `5390(0)`, liste creuse ; `T[2]`, (`T[3] = T[2]` au niveau 1), puis deux autres `5ad6(T[0])` chacun avec repli `rand'` ; `5206`, `r = 5390(T[0])` ; deux derniers panneaux : avec moins de 5 traits, `559d(0)` puis `rand(m)` (dans cet ordre si `[1778] = 1`, inversé sinon), sinon comme `67d3`.
- **`7532`** (niveau 2 carte 2, niveau 4 : 8 panneaux) : `a = 5ad6(0)` sur l'équipe entière (**avant** `T[0]`) ; `T[0]` = `5e8f(1,1)` si `n < 2`, sinon `(4,2)`, `(8,5)`, `(12,9)`, `(16,1)` (repli `rand(m)`) ; `52a6(T[0])`, liste creuse ; `T[2] = T[3] = a` (peut valoir 0 : deux panneaux inertes) ; `T[4]`, `T[5]` = `5ad6(T[0])` avec repli `rand'` ; `5206`, `5390(T[0])`, `r = 5390(a)`, liste creuse ; deux derniers : avec moins de 5 traits, `0700[rand]` seul (peut valoir 0) puis `559d(0)` (repli `0700[rand]` seul), sinon `5e24(⌈r/2⌉,1)` / `65b9` avec repli `rand'` et échange.
- **`7acf`** (niveau 3, 9 panneaux) : `T[0..2]` = trois `5643(0,0)` (repli `rand(m)`), un quatrième `b` gardé en réserve ; `5390(T[0])`, `5390(T[1])`, `r = 5390(T[2])`, cible `c = DS:193c[r]` ; boucle (compteur `i` de 0 à `c − 1`, incrémenté par le `for` **après** la mise à jour, d'où un recouvrement d'un membre) : `i = 0` → `T[3] = 5e8f(1,1)` (repli `T[rand(2,0)]`), `e = H[T[3]]`, retrait, `i = e`, `reste = c − e` ; puis, tant que `reste ≠ 0`, `5e8f(reste, 1)` (repli `rand(m)`), retrait, `i += e`, `reste = c − i` ; ces retraits réécrivent les listes de traits utilisés ; `T[4] = b` ; `5206`, `5390(0)`, liste des absents, `5390(b)` ; `T[5]`, `T[6]` = `61fd(3,1)` (repli `T[0]` si aucun trait absent, sinon `rand(m)`), chacun suivi de son retrait ; `T[7]`, `T[8]` = `rand(20, 1)` : **les deux derniers panneaux n'ont aucun lien avec l'équipe**.

**Défaut de l'original confirmé** : `6739` compacte `S14:0700` en `S14:0754`, mais les tirages relisent `S14:0700[rand(8934, 8936)]`. La liste `0700` est creuse (`0700[k] = k` si `H[k] = 0`, 0 sinon) : un rang tiré dont le trait est porté donne 0. Effets : tirage non uniforme parmi les absents, un repli sur `072a` dans `6f02` et `7532` (sauf `7532` avec moins de 5 traits, où le résultat 0 reste : **panneau inerte**), et un nombre de tirages différent de celui d'une lecture correcte. Reproduit tel quel (`drawSparse`). Chaque panneau ne fait qu'**ajouter** un détour (le Zoombini qui ne correspond pas va tout droit) : un panneau inerte ne rend jamais une carte injouable.

## 5. Déroulement

### 5.1 Entrée (`1118:0000`) et variables

Ordre : initialisation à zéro des variables et des tampons (`11c8:6a5c`) ; ouverture `Maze2.MHK` (`11b8:0fa2`) ; `11a8:1783(100)` terrain, `11a8:1475(5000)` fond ; groupes 0-4 et `SCRB` (§1.3) ; `1168:5e79(0x3716, 0x1118)` (rappel d'un Zoombini : `1118:3716`) ; `SCRS` REJECT (8) et NORMAL (96) ; `REGS 16000` → `[889e]` ; `1118:11b8(16501)` → `[88d2]` ; `REGS 17000` → `[8896]`, `17001` → `[889a]` ; `tBMP 5100` → `[886e]` ; `REGS 18000` → `[887e]`, `18001` → `[8882]` ; `1058:048a(236, 10)` ; objet de calque `[88d8]` ; `1168:0858(0)` crée les Zoombinis ; `[88e4]` = nombre de Zoombinis (`1168:365d`), `[899a] = [88e4] − 1` ; niveau (§3) ; `[893c] = 4a3e(niveau)`, `[8940] = n` ; création des plaques et marques de rampes actives (`SCRB 7000 + z − 1` et `7014 + z − 1`, positions `S14:0x38 + 4·z`, une rampe = un « point de dépôt » enregistré par `11a8:0ad6` lorsqu'il porte l'indicateur `0x2000`, ce qui renseigne `S15:00fc + 4·z` et `S15:0000`) ; `1118:4ad2(niveau)` ; calques d'ordre (`SCRB 8011`, 3 + 8 objets) ; boutons (`1118:12c0(0, 0, 1)` et `(0, 0, 2)`) ; `1168:2505` (place l'équipe, `[9702]` Zoombinis en cours de placement) ; `1168:274e(0x1e, 0, 0x2d)` ; `1168:3dd0(0, 0)` : tous les Zoombinis ont `+0x127 = 0` ; régions ; `11a0:0ee7(0, 997)` (son d'entrée) ; plages de sons préchargées (`11a8:313a`) ; **musique `30035 + 515d()`** (une `tMID` par niveau 0 à 3 de `MIDIMPC.MHK`) ; `[a2c4] = 20068`. **Sûr.** Les positions initiales des Zoombinis sur la falaise 0 relèvent du code générique `1168:2505` (non étudié).

Variables de jeu (`DS`, **sûr** sauf mention) :

| `DS` | Rôle |
|---|---|
| `[88e0]` | niveau 0-4 |
| `[88e4]` | nombre de Zoombinis du groupe (`n`) |
| `[88e6]` | 1 après le 1er clic de jeu : initialise les tables de scripts de chaque Zoombini (`1100:0000`) |
| `[88ee]` | rampe visée par le dernier dépôt (indice + 1) |
| `[88f8..8908]` | identifiants des Zoombinis dans la liste en vol (au plus 10), `[890e]` leur nombre ; un id y entre au lancement et en sort au rejet (`1118:3784`, événement `0x5c` de `SCRS 14006`, ou gerbe de collision) ou 7 images après un atterrissage (`1118:3263`, événement `0x5b` de `SCRS 14007`) |
| `[8916]` | 1 dès qu'un Zoombini a atteint la sortie 3 : active « Go » ; `[8988]` nombre de ces arrivées |
| `[8920..8926]` | compteurs de places occupées dans la file d'attente de chaque falaise (0 à 19, bouclent) |
| `[8928]` | rang d'écriture des traits ; `[892c]` rang de lecture (§4) |
| `[8948]`, `[894a]`, `[894c]`, `[894e]`, `[8950]`, `[8952]`, `[8954]`, `[8956]`, `[895a]`, `[895c]` | files d'événements du Tick (§5.2) ; `[8956]` est alimenté par `1118:3263` pour un Zoombini arrivé sur la falaise 3 (danse de fin) |
| `[899a]` / `[899c]` / `[899e]` | danse finale : nombre de Zoombinis − 1 / nombre déjà dansés / drapeau |
| `[1778]` | indice de la carte du niveau ; `[177a]`, `[177c]`, `[177e]`, `[1780]` alternances ; `[1782]` alternance du son de rotation |
| `[88dc]`, `[88da]`, `[88e8]`, `[88ec]` | mis à 0 à l'entrée ; `[88dc]` posé par l'événement `0x0a` de la rampe ; jamais lus (inutilisés) |

### 5.2 Tick (`1118:1503`) : files d'événements

Le Tick n'a pas de machine à états explicite : les rappels d'événements des animations (§5.4) **empilent** des identifiants dans des files, que le Tick vide à chaque tour dans cet ordre (**sûr**) :

1. Si `[8556] ≠ 0` (sortie demandée) : si `1028:0d9e(996, SND)` renvoie ≠ 0 (**sûr** : le son 996 de « Go » joue encore ; « 20036 » était le mot bas de l'étiquette `SND`, voir fleens.md §4.2), attend ; puis si `[a2de] ∈ {0, 3}` et (`[a406] ≠ 0` ou `[9702] = 0` ou `[9704] > 0`) : `[8554] = [8556]`, `[8556] = 0`, `11b8:0011(0, 0)`, Exit. `[a2de] = 2` : annule la demande.
2. `[8954]` (rampes) → `1118:29cc(zone)` : la rampe lance son script `S14:028e[zone]` (9000 / 9001 / 9003) avec le rappel `1118:39c5` ; éventuelle plaque supérieure `+1` ; réordonne les calques par rapport au Zoombini (`+0x94`).
3. `[894e]` (libérations de cases d'attente) → `1100:0b69(Zoombini)` : repart dans sa direction.
4. `[894c]` (objets d'effet terminés) → repasse l'objet sous le calque `[88d8]`.
5. `[894a]` → réordonne la plaque de rampe sous le Zoombini.
6. `[8956]` (Zoombinis sauvés qui ont fini `SCRS 14007`) : lance `SCRS 15090 + attribut 3` (danse) sur le Zoombini.
7. `[895a]`, `[895c]` (fixés par `1118:3716`, Zoombini arrivé sur la falaise 1 ou 3) → retrie les Zoombinis posés sur cette falaise (`1100:2301`).
8. `[8950]` (arrivées) → pour chaque Zoombini : selon `+0x76` (falaise, 0 à 3) : falaise 0 : `+0x20 = 1`, falaise 1 : `+0x20 = 0x8001`, falaise 2 : `+0x20 = 1`, falaise 3 : `+0x20 = 0x4008001` et, si `1168:02cc() = [88e4]` (tous sauvés), `[899e] = 1` + voix `rand(20063, 20055)` ; puis `+0x121 = 0`, mode `1168:4231(0, 0, 7, Zoombini)` et **destination** `+0x116 = S14:042c[falaise·0x50 + 4·compteur]` (compteur de `[8920 + 2·falaise]`, 0 à 19 puis bouclé) : le Zoombini marche jusqu'à sa place dans la file de la falaise.
9. `[8948]` (pas terminés) → aiguillage selon `S14:0d18[r][c]` de la case atteinte (`+0x72`, `+0x74`) : tableau du §2.3.
10. `[8952]` (paires en collision) → `1100:02cf(a, b)`.
11. Danse finale si `[899e] ≠ 0` et `[899a] > [899c]` : toutes les 30 ticks, tire un Zoombini non encore choisi (`1098:0098`) et lui joue `SCRS 15090 + attribut 3` (rappel `1118:393d` ; l'événement `0xffff` incrémente la fin de danse).

Le Zoombini et les objets de case sont aussi mis à jour par le moteur d'animation (`11a0:033a`) à chaque tour de boucle.

### 5.3 Souris et glisser-déposer (`1118:2285`)

Régions (callback avec l'identifiant de région) :

- **Région 1 : « Map »**. Son `999`, bouton enfoncé (`1118:12c0`), `[9704] = 1`, `[8556] = 1`, `11a0:16da()` (boîte de confirmation « ce groupe sera perdu » si le groupe est non vide, screens.md §3.4). Si `[8556]` est déjà posé, le clic force la sortie.
- **Région 2 : « Go »**. Sans effet si `[8916] = 0`. Sinon son `996`, bouton enfoncé, `[8556] = 6` (Zoombiniville).
- **Région 3 : zone de jeu**. Ignorée si `[9702] > 0` (placement initial en cours). Au premier clic : `[88e6] = 1` et `1100:0000` sur chaque Zoombini (initialise les tables de scripts : walks `15014 + variante`…, attentes `15054 + …`, poses de rampe `14999 + …`). Puis : `11a8:0d61(1, 1, 0, x, y)` (Zoombini sous le curseur, indicateurs `1` ou `0x8001`) ; **refus** si `[890e] ≥ 10` ou si ce Zoombini est déjà dans la liste en vol (donc pendant ses 7 images d'atterrissage aussi). Sinon `1168:1742(0, S14:13d8 + 8·(+0x76), x, y, Zoombini)` : glisser-déposer contraint au **rectangle de sa falaise** ; critère de dépôt : le point de dépôt `S15:00fc + 4·z` d'une rampe `z` (< `S15:0000`) dans le carré de ±15 px (`[9706] = 15`) centré sur la position du Zoombini, rampe libre (`S15:02f0 + 2z = 0`). `[88ee] = 1168:166e()` (rampe + 1, 0 si aucune). Dépôt hors rampe : le Zoombini retourne à sa place (`+0xe6`). Dépôt sur rampe : refusée si `S14:0070 + 2·(z + 1) ≠ 0` (rampe déjà en cours de lancement) ; sinon **lancement** :
   - `+0x20 = 0x4008001` ; id ajouté à `[88f8]`, `[890e]++` ;
   - `+0xf1 = S14:00e2[z]`, `+0xf2 = S14:00aa[z]`, destination `+0xa6/+0xa8 = S14:0038 + 4z`, direction `+0x58 = S14:00fe[z]`, case de départ `(+0x6e, +0x70) = S14:02e8 + 4z`, case visée `(+0x72, +0x74)` = départ pour les directions 1 et 3, départ avec colonne ∓ 1 pour les directions 0 et 2 ; `+0x6a = 0`, `+0x78 = S14:011a[z]` ;
   - l'objet de rampe (`S14:01ec[z]`) reçoit `+0x94` = Zoombini et `+0x88` = `z + 1` ; `[8954]` ← `z` ; `S14:0070[z + 1] = z + 1` (rampe occupée).
   - Clic (sans glisser) sur un Zoombini posé sur une falaise 1 ou 3 : remet à jour le calque (`[895a]`, `[895c]`).

### 5.4 Séquence d'un lancement et d'un pas (événements `SCRB` / `SCRS`)

**Rampe** (`SCRB 9000`, 35 images ; `9001`, `9003` : 36 ; rappel `1118:39c5`, un jeu d'événements par famille : `9000` → `0x32`, `0x3d`, `0x3e`, `0x40`, `0x41`, `0x42` ; `9001` → `0x32`, `0x47`, `0x48`, `0x4b`, `0x42` ; `9003` → `0x32`, `0x51`, `0x52`, `0x55`, `0x56`) :

| Image | Événement (octet − 1) | Effet |
|---:|---|---|
| 1 | `0x32` + son `\0SND 9000` | fait jouer la plaque de la rampe (`SCRB S14:02aa[+0x8a]`) |
| 2 | `0x3d` / `0x47` / `0x51` | `1118:2b48` : le Zoombini prend sa pose assise (`SCRS 14999 + 5·classe + variante`) |
| 16 | `0x3e` / `0x48` / `0x52` | `1118:2c09` : `SCRS 14000 + classe` (Zoombini dans le canon ; décalage de position selon la direction) |
| 19 | son `\0SND 9001` (+ `0x40` pour la famille 9000 : réordonne les calques, file `[894a]`) | |
| 30 | `0x41` / `0x4b` / `0x55` | `1118:2dad` : crée la bulle (`SCRB 10000 + dir` pour la direction 0, `10042` pour 1, `10043` pour 3) et joue le premier pas (direction 0 : marche normale ; directions 1 et 3 : `SCRS 15080 + attribut 3`, `15085 + attribut 3`) |
| 34 (35 pour 9001 et 9003) | `0x42` (famille 9000 et 9001) / `0x56` (9003) | **libère la rampe** : `1168:170f(0, z + 1)` (`S15:02ee + 2·(z+1) = 0`) et `S14:0070[z + 1] = 0` |

La rampe est donc de nouveau utilisable environ 34 images après le dépôt (6 à 7 ticks de 17 ms par image, soit ≈ 3,5 à 4 s). Pendant ce temps le dépôt sur la même rampe est refusé. **Sûr** pour la séquence, **probable** pour la durée.

**Pas** (`SCRS 15015 + 5·dir + (variante − 1)`, 7 images, une case par pas) : événement `0x14 / 0x1e / 0x28 / 0x32` (octet 21 / 31 / 41 / 51) aux images 1 à 5, effectif **à la 4e image** (`+0xc8 = 3`) : enregistrement dans le compteur de collision (§2.3) ; événement de fin `0x15 / 0x1f / 0x29 / 0x33` (octet 22 / 32 / 42 / 52) à l'image 6 : le Zoombini est mis en file `[8948]` ; le Tick lit alors la case atteinte. Chaque case de type 0, 2, 3, 4, 6 relance immédiatement un pas dans la nouvelle direction (déplacement de `(+0x72, +0x74)` à partir de `(+0x6e, +0x70)` puis position `REGS 16000[…] + (4, −38)`, bulle suivant le Zoombini). Un pas dure 6 images : la 7e (événement de fin) relance le pas suivant, la période est donc de 6 images ; la durée d'une image en ticks (≈ 6, **probable**) n'a pas d'effet sur les règles. **Sûr** pour les 6 images.

**Tourbillon (type 1)** : `1100:1301` crée l'objet tourbillon `SCRB 10031` et joue `SCRS 14006` (26 images ; événements `1` aux images 0, 1, 4, 5, 8, 9 ; `0x5c` à l'image 25) sur le Zoombini avec le rappel `1118:3784` : à la fin (événement `0xffff`) il est mis en file `[8950]` (retour à sa falaise) ; à `0x5c` : libère les objets d'effet (`+0x82`, `+0x84`), retire le Zoombini des listes en vol (`[88f8]`, `[890e]--`) et vide son compteur de collision.

**Collision** (`1100:02cf(a, b)`) : selon les directions des deux Zoombinis, choisit deux poses de collision `SCRS 15035 + 5·g + variante` (g = 0 à 3 : groupe d'images à `(230,129)`, `(215,131)`, `(229,122)`, `(244,128)`), crée deux éclaboussures `SCRB 10012` à `10029` (famille 6 × zone `S14 [88d2]` 0 à 2), événements `0x3d` (REJECT `SCRS 14004` avec `1118:3784`) et `0x3f` (nettoyage `[894c]`), son `\0SND 10000` à `10004` des scripts `SCRB 10004` à `10011` (images 0 et 7). Les deux Zoombinis reviennent ensuite à leur falaise de lancement (`[8950]`). **Sûr** pour l'enchaînement, **probable** pour les noms des familles de sprites.

**Atterrissage** (`1118:1fb4`, case de sortie) : `+0x76 = sortie` ; falaise 3 → `+0x127 = 1`, `[8988]++`, « Go » actif dès la première (`[8916]`) ; script `SCRS 15075 + pieds` (2 images, sans événement) et gerbe `SCRB 10040` (8 images, événement `0x79` à l'image 2, rappel `1118:348d`) qui lance `SCRS 14007` (6 images, `0x5c` à l'image 5) sur le Zoombini avec le rappel `1118:3263` : à l'image 5 il quitte la liste en vol (et, sur la falaise 3, est mis en file `[8956]`), à la fin il rejoint la file `[8950]` (marche jusqu'à sa place). Délai de sortie de la liste : 7 images. **Sûr.**

**Rejet** : tourbillon `SCRS 14006` (26 images, `0x5c` à l'image 25 : sortie de la liste, fin : file `[8950]`) ; collision : gerbe `SCRB 10012`… (événement `0x3e` à l'image 6) qui lance `SCRS 14004` (6 images, `0x5c` à l'image 5) : sortie de la liste 11 images après la collision, retour 12 images après. **Sûr.**

**Case d'attente** : aucun son trouvé. **Rotation d'un aiguillage** : son `5101` puis `5102` alternés (`[1782]`). **Bouton** : son `5103`. **Arrivée sur la falaise 3 de tous les Zoombinis** : voix `rand(20063, 20055)`.

### 5.5 Sons et musique

`11a0:0ee7(0, id)` met un son en file (engine.md §6.2). Ids de l'épreuve : `997` à l'entrée ; `996` (clic « Go ») ; `999` (clic « Map ») ; `5101` / `5102` (rotation d'un aiguillage) ; `5103` (bouton) ; `9000` (rampe, image 1) et `9001` (rampe, image 19) ; `10000` à `10004` (éclaboussures, bulles) ; `10001`, `10002` et `10003` (scripts `SCRB 10036`-`10040`, `10004`-`10011`) ; `20055`-`20063` (voix de réussite totale) ; `30035 + niveau` (musique, `tMID` de `MIDIMPC.MHK`) ; `\0SND 5100`, `11000`, `12000` jamais trouvés dans un événement ou un appel (**inutilisés** ou déclenchés par une route non tracée). Plages préchargées par `11a8:313a` : 996-997, 20000-29999 (flux), 11000, 10000, 10002-10004, 9000-9001, 5100-5103, 12000, 10001.

## 6. Ce qui est écrit à la sortie

`1118:145f` → `11a8:021c` → **`1168:36e1(0, 1)`** (sauf entraînement `[96f2] ≠ 0` : le groupe est vidé, aucune marque) :

- tout Zoombini dont `+0x127 = 0` est **perdu** (aucun cas « conservé malgré tout » ; un Zoombini dont `+0xe0 = 0` est remis à `+0x127 = 0`) ; les autres sont conservés dans le groupe courant `S−0x56D2` (fiche de 19 octets : 4 attributs, identifiant, `+0xd6`, 10 octets d'état, drapeau « présent ») ;
- **réussite** : `S[0x56 + (18 − 7)] |= 1 << niveau_étape4` (octet `S+0x61`, bits 0 à 3) ; si aucun Zoombini perdu, mêmes marques « sans perte » `0x10 << niveau` ; si de plus le drapeau d'étape `S+0x54` est non nul et que l'on n'est pas en entraînement : ajout d'un **monument** (étape 4, niveau + 1) dans le premier emplacement libre de `S+0xA2` / `S+0xB2`, date du jour, et **niveau de l'étape 4 + 1** (`S+0xC8`, 3 au plus, `[9700] = 1`) ;
- **Zoombinis perdus** : rendus au camp 2 (étape 4 : réserve `S−0x5938`, `S+0x4C += perdus`) ;
- le passage à Zoombiniville (`[8556] = 6`) fait ensuite `1108:0000` poser `S+0x51 |= 1 << (niveau & 3)` (progression de l'étape 4) ;
- « Map » avec confirmation : `[a406] = 1` : `S−0x56D2 = 0` (groupe vidé), pas de marque de réussite ; sans confirmation l'écran reste.

Voir screens.md §3.4 et §6.3. Rien d'autre n'est écrit par l'épreuve (pas de score, pas de compteur d'erreurs). **Sûr** pour le chemin ; le détail des octets du tampon vient de screens.md.

## 7. Vérification

- **Traits (§4)** : émulation x86-16 du désassemblage (voir §4) : 4 800 groupes, aucune différence avec `generateTraits`.
- **Mécanique d'une case (§2)** : `maze2.ts` réécrit `1100:0b69`, `1527`, `1a9d`, `102a`, `20dc`, `1301`, `02cf` et la file d'événements de `1118:1503` ; les tests couvrent chaque type de case sur des cartes synthétiques et une vraie carte.
- **Solvabilité** : le robot (`planMaze2`) cherche, sur les cartes réelles et des groupes aléatoires, une suite de lancers qui sauve tout le groupe. Niveau 0 : 36 groupes sur 36 ; niveau 1 : 36 sur 36 ; niveau 2 : 33 sur 36 ; niveau 3 : 13 sur 36 (budget de 300 000 lancers simulés, groupes de 6, 10 et 16 ; les échecs sont des recherches interrompues, pas des preuves d'impossibilité : sur l'un d'eux, un budget de 400 000 lancers trouve la solution). Niveau 4 (carte `16609`, 1 à 4 Zoombinis) : 100 groupes sur 100, comme la carte `16605` avec les mêmes groupes. Avec une carte de niveau 3 (`16606`), 2 à 4 Zoombinis sont tous sauvés mais **un Zoombini seul ne l'est jamais** (les cases d'attente et les relais demandent un second arrivant).
- La première simulation de cette étude (script Python hors dépôt) lançait les rampes 12, 14 et 8 depuis la falaise de départ, ce qui les faisait paraître piégées (§3.2) ; elle ne comptait ni les collisions ni les cases d'attente.

## 8. Points ouverts

1. ~~Générateurs de traits~~ **Tranché (sûr)** : réécrits bit à bit et vérifiés (§4). Le défaut `S14:0700` au lieu de `0754` est **confirmé** (lectures de la liste creuse, résultat 0 possible) et reproduit.
2. ~~Placement initial de l'équipe~~ **Tranché en H9** : les 20 places de chaque falaise (`S14:042c + 0x50 × falaise + 4 × rang`) sont relues dans l'exécutable (§10.1) ; l'équipe prend les places 0 à 15 de la falaise 0 (`DS:8920 = 0x10`, **sûr** pour les compteurs), valeur initiale de `+0x76` à 0 (**probable**), marche de retour vers la place suivante de la file de la falaise (`1118:1503`, étape 8). Mode `1168:4231` des poses assises : voir §10.
3. ~~Dessin des cases~~ **Tranché en H9 (sûr, `1100:2679` relue en entier ; vérifié au rendu)** : voir §10.2.
4. **Sons** : **tranché pour l'essentiel en H9** (§10.4). Restent non identifiés : `SCRS 14003` et `14005` (aucun appelant ; `1118:2d2a` joue `14003` mais n'est appelée par rien), `\0SND 5100`, `11000`, `12000` (chargés, jamais déclenchés).
5. **`REGS 16001`, `16002`, `16499`, `16500`, `17002`, `18002`, carte `16607`** : données non référencées par le code (probablement des variantes de développement).
6. **Hypothèses de nommage** : « Bubblewonder Abyss », ordre coiffe / yeux / nez / pieds, `+0xbf = +0xef`.
7. **Durées exactes** : une image = 6 ticks (**probable**, §10.3) ; voix d'introduction `[a2c4] = 20068` rejouée par F1 (kit) ; textes d'aide (`11a0:155e`) toujours non étudiés.
8. **Carte `16609`** (équipe < 5, niveau 3) : **tranché (sûr pour le mécanisme, probable pour l'intention)**. `1118:05ab` fait passer le niveau 3 à 4 pour moins de 5 Zoombinis ; `1118:4a3e` charge alors `REGS 16609` et `1118:4ad2` appelle `7532` (le générateur de la 2e carte du niveau 2), sans toucher aux compteurs d'alternance. La carte est celle de `16605` plus trois cases d'attente (types 3, 4 et 5), avec la rampe 3 seule et sans relais. Intention probable : une variante allégée du dernier niveau pour un petit groupe, car le niveau 3 (rampes à relais, cases d'attente à libérer par un second arrivant, 9 panneaux dont deux sans lien avec l'équipe) est injouable avec un seul Zoombini et mal adapté à moins de 5. Le robot sauve les 1 à 4 Zoombinis de `16609` dans 100 cas sur 100.

## 9. Module de règles (`src/games/zoombinis/game/puzzles/maze2.ts`)

Fonctions pures, sans rendu ni texte ; tests dans `test/zoombinis/puzzles/maze2.test.ts`.
- **Données** : `readMaze2Maps(regs)` (les 10 cartes depuis les `REGS` décodés), `MAZE2_RAMPS` (14 rampes : point de dépôt, case de départ, direction, script, plaque, falaise), `MAZE2_EXITS`, `MAZE2_CLIFF_RECTS`, `maze2CellPosition` / `maze2ZoombiniPosition` (`REGS 16000`, décalage `(4, −38)`).
- **Mise en place** : `maze2Level` (3 → 4 sous 5 Zoombinis), `chooseMaze2Map` + `Maze2Rotation` (alternance persistante par session), `setupMaze2` (jeux de sprites, traits, délais dans l'ordre des tirages de l'original), `generateTraits`, `buildMaze2World` (monde sans hasard, pour les tests et la reprise).
- **Simulation** : `launchMaze2` (refus : inconnu, déjà en vol, 10 en vol, rampe inactive ou d'une autre falaise, rampe occupée), `advanceMaze2` (une image : rappels d'animation puis les files du Tick dans l'ordre de `1118:1503`), `settleMaze2`, `maze2MemberState`, `maze2Outcome` (sauvés = sur la falaise 3, perdus = les autres, « Go » actif, tous sauvés).
- **Robot** : `planMaze2` (recherche du meilleur d'abord, relais et cases d'attente compris, budget de lancers simulés), `replayMaze2`.

Écarts et choix :
- Le temps est compté en images d'animation ; les durées sont celles des scripts (§5.4). La phase d'un Zoombini dans son pas dépend, dans l'original, du moment du clic : le module la donne par l'instant du lancer, que l'écran choisira.
- Le Zoombini lancé revient à sa falaise sans autre effet (le retour animé et la place sur la falaise relèvent de l'écran).
- Un id Zoombini nul est réservé (« pas d'occupant »).
- Les cartes sont reproduites telles quelles, y compris la flèche parasite en (0, 0) de `16601`.

## 10. Écran (`src/games/zoombinis/scenes/puzzles/maze2.ts`, tâche H9)

Fabrique : `createMaze2Scene()` (écran 18 ; tests `test/zoombinis/puzzles/maze2-scene.test.ts`, sur les vrais fichiers). L'écran est une mise en scène de la simulation du §9 : le kit commun (`puzzle-kit.ts`) porte l'arrivée, le glisser-déposer, les boutons, l'aide F1, l'enregistrement et la musique `30035 + niveau` ; l'écran dessine les cases, anime les rampes et suit les segments de chaque Zoombini lancé.

### 10.1 Falaises et files d'attente (point 2 tranché)

Les 4 tableaux de 20 places `(x, y)` (`S14:042c`, relus dans les segments NE) : falaise 0 `(287,394) (260,426) (224,447) (188,441) (157,455) (263,384) (219,397) (184,388) (155,402) (121,417) (226,354) (189,349) (156,354) (131,375) (85,394) (164,311) (125,324) (79,352) (29,318) (15,285)` ; falaise 1 (`(4,86)`…`(98,93)`), 2 (`(633,311)`…`(614,336)`) et 3 (`(621,18)`…`(594,104)`) : voir `CLIFF_PLACES`. Compteurs de file `[8920 + 2 × falaise]` : 16, 0, 0, 0 ; chaque Zoombini qui revient (rejeté ou arrivé sur une falaise) prend la place suivante de **sa** falaise (`+0x76`), le compteur boucle modulo 20 ; il y marche en ligne droite. L'équipe (16 au plus) occupe les places 0 à 15 de la falaise 0 : le kit l'y place (3/4 debout, les autres entrent à pied à 30 puis 45 ticks, hors « moins d'action »). Le terrain `tBMP 100` n'est pas porté (dans les épreuves, l'original ne s'en sert que pour valider un dépôt, `engine.md` §4).

### 10.2 Dessin des cases (`1100:2679`, point 3 tranché)

Les images viennent de `tBMP 5100`, ancrées par `REGS 18000` / `18001` **indexés par le numéro d'image (1 à 198 ; le mot 0 est inutilisé)** et posées sur la position de la case (`REGS 16000`, le centre de la plaque) : une plaque de 41 × 21 px.
- tourbillon (`kind 1`) : image `2 + (compteur mod 4)` (le compteur avance toutes les `delay` ticks de la case, 20 à 25) ;
- panneau, flèche, aiguillage (`kind 2` à `4`) : la plaque `base`, un pétale `base + 1 + d` par direction autorisée (`f[d] ≠ 0`), l'indicateur `base + 5 + g` (direction courante) ; le panneau ajoute l'icône du trait `10 + 5 × attribut + valeur` (11 à 30), absente pour un panneau inerte (trait 0, `+0x82` nul) ;
- case d'attente (`kind 5`) : `base + 9 + (compteur mod 6)` ; bouton (`kind 6`) : `base + 19`, puis `base + 15 + k` (k de 0 à 3, une image par échéance) tant qu'il est enfoncé ; `kind 7` (`base + 20`) : jamais créé par une carte.
La flèche parasite de `16601` (case `(0, 0)`, position nulle) n'est pas dessinée. Les bases sont celles des jeux de sprites tirés (§3.1) : le type 1 prend 31 (plaques grises à pétales blancs), les autres types des plaques colorées (gemmes).

### 10.3 Décor, rampes et temps

- **Une image d'animation = 6 ticks** (délai des features et des `SCRS`, **probable** ; le déroulé confirme la lecture du §5.4 : pose assise `SCRS 15000…` de 14 images de l'image 2 à l'image 16, canon `SCRS 14000…` de 14 images jusqu'à l'image 30, première bulle à l'image 30 de la rampe). La simulation (`advanceMaze2`) avance d'une image toutes les 6 ticks, seulement quand quelque chose bouge ; un lancer est pris à l'image suivante, ce qui aligne la rampe, le Zoombini et la simulation.
- **Machines à bulles** (`SCRB 9005 + falaise`, `1118:0000`, `S14:01e6`, `S14:0272`) : une machine par falaise (la falaise 0 toujours, les falaises 1 et 2 si l'une de leurs rampes est active ; images 126 et suivantes de `tBMP 9000`). Elles sont posées sur leur première image et **jouent leur script à chaque lancer depuis une rampe de leur falaise** : c'est le « fait jouer la plaque » de l'événement `0x32` du §5.4 (`S14:02aa[+0x8a]`, `+0x8a` = falaise de la rampe). Corrige le §5.4.
- **Plaques** `SCRB 7014 + z − 1` (5 images : 1, 4, 5, 4, 1) : posées au point de dépôt de chaque rampe active (indicateur `0x2000`, `1118:0000`), elles ne jouent **pas** au lancer ; leur script est celui de la **mise en surbrillance** de la cible (`1168:1742`, `DS:9708`) : elles s'allument quand un Zoombini porté survole la rampe (**probable**). Les marques `SCRB 7000 + z − 1` sont des images fixes.
- **Rampes** : l'objet `SCRB S14:028e[z]` (9000, 9001, 9003) est `relative` et posé sur la position de sa plaque (`S14:02b0`, premier élément de la première image) ; pour les rampes 4 à 9, 13 et 14 (`S14:0152 ≠ 0`) un **cache** `SCRB script + 1` (9002, 9004), posé au même endroit, joue en même temps et passe devant le Zoombini dans le canon (`1118:29cc`).
- **Calques de falaise** (`SCRB 8000` à `8013`, `tBMP 8000`) : créés **par rampe** : 8000, 8004 et 8011 toujours ; 8001 si une rampe 4 à 6 est active, 8002 pour la rampe 4, 8003 pour la 5 ; 8005 si une rampe 7 à 9 est active (sinon 8010), 8006 pour la 7, 8007 pour la 8 ; 8008 si une rampe 13 ou 14 est active, 8009 pour la 13 ; 8012 et 8013 ne sont créés par aucun code étudié. Les formes violettes tramées de 8002, 8003, 8005, 8008 et 8009 ressemblent à des échelles accrochées aux rampes concernées (**probable** ; elles sont dessinées telles quelles). L'ordre dynamique avec les Zoombinis (`[894a]`, `[895a]`, `[895c]`, `11a8:2a0a`) n'est pas porté : les calques sont derrière les objets en vol et les rampes, les Zoombinis posés sont devant.
- **Grille `tBMP 12000`** (610 × 310, la grille 13 × 13 en violet) et `SCRB 12000` à `12002` : aide de mise au point jamais créée par le code ; non dessinée.
- **Bulle** : feature `relative` (`SCRB 10000 + direction` à chaque pas, `10042` / `10043` pour le bond des rampes de direction 1 / 3) dont le coin haut-gauche suit les pieds du Zoombini à `(−26, −52)` ; ce décalage est **probable** (calé sur les images de 52 × 67, le rattachement `11a8:1f5c` de l'original n'est pas porté). Les groupes 7000 à 10000 n'ont pas de `REGS` automatiques (les positions des `SCRB` de bulles sont celles des coins des images).

### 10.4 Sons (point 4)

Entrée : jingle `997` puis musique `30035 + niveau` ; aide F1 : `20068`. Rampe : `9000` (image 1) et `9001` (image 19), joués par le script. Aiguillage tournant : `5101` puis `5102` en alternance (`[1782]`, un son par rotation spontanée ; la rotation par un bouton n'en joue pas, **probable**). Bouton : `5103` à chaque entrée. Gerbe d'atterrissage `SCRB 10040` : `10002` (image 4) ; éclaboussures `SCRB 10004` à `10011` : `10003` (image 1) et `10000` (image 8) ; scripts `10030` à `10034` : `10004` ; `10036` à `10039` : `10001` ; tous joués par leurs scripts. « Go » : `996` ; carte : `999` (kit). Tous sauvés : voix `20055` à `20063`. Case d'attente : aucun son. `\0SND 5100` n'est que chargé ; `11000` et `12000` ne sont jamais déclenchés.

### 10.5 Écarts du port

- Le kit n'a qu'une zone de transport : le glisser n'est pas limité au rectangle de la falaise du Zoombini ; un dépôt sur une rampe d'une autre falaise est refusé (il rentre), ce qui ne change aucun résultat. Dépôt sur une rampe occupée : hors cible (le kit ne prend que les cibles libres), il rentre sur sa place.
- La marche de retour est une ligne droite (pas de terrain) ; l'ordre de dessin des Zoombinis posés (`1 + y / 1000`) n'est pas retrié par falaise (`1100:2301`).
- Poses de collision : groupe `15035 + 5 × direction + pieds − 1` (la direction du Zoombini, **probable** : les quatre groupes d'images rebondissent vers le bas, la gauche, le haut et la droite, soit l'opposé du mouvement) posées à mi-chemin de la case visée ; éclaboussure `10012 + 3 × direction + zone` (famille = direction, **probable** ; zone lue dans `REGS 16501` avec le pas de 12 mots de l'original).
- Retour au tourbillon : bulle retirée, tourbillon `SCRB 10031` posé sur la case (coin `(−26, −27)`, **probable**) et `SCRS 14006` (26 images) ; l'atterrissage joue `SCRS 15075 + pieds`, la gerbe `10040`, puis `SCRS 14007` deux images plus tard (le script `14007` démarre à l'image 2 de la gerbe, événement `0x79`).
- La danse du Zoombini qui vient d'arriver sur la falaise 3 (`[8956]`, étape 6) est interrompue par sa marche de retour une image plus tard : non portée. La danse finale (`15090 + pieds`, un Zoombini toutes les 30 ticks, `n − 1` au plus) tire au hasard parmi ceux qui n'ont pas encore dansé et sont immobiles.
- « Go » : aucune marche de sortie (`1118:2285` ne fait que le son et `[8556] = 6`) ; le kit change d'écran quand le son 996 est fini ou au clic suivant. Les Zoombinis hors de la falaise 3 (y compris ceux d'une case d'attente, d'un relais ou de la falaise 0) sont perdus par `exitPuzzle`.
- Une partie enregistrée pendant l'épreuve retrouve le groupe entier, perdus compris (kit).
