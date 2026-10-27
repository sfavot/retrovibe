# Le gouffre des véhibules (`MAZE2.MHK`, écran 18) : étude de rétro-ingénierie

Écran 18 de `ZOOMBINI.EXE` (L'Odyssée des Zoombinis, Broderbund / TERC, version 1.0FR, NE 16 bits), archive `MAZE2.MHK`. Document d'étude seul (aucun code applicatif). Cadre moteur : [../engine.md](../engine.md) (table des écrans `1530:14fe`, `SCRB` / `SCRS`, `REGS`, RNG) ; parcours, niveaux, sortie d'une épreuve : [../screens.md](../screens.md) §1.6, §3.4, §6.3.

Conventions : adresses `segment:offset` du code (`1118:xxxx` = module de l'épreuve, `1100:xxxx` = module d'aide propre à l'épreuve, seul appelant `1118`) ; `DS:xxxx` = segment de données `1530` (variables notées aussi `[xxxx]`) ; `S14:xxxx` = second segment de données `1450` (tableaux initialisés et tampons de l'épreuve), `S15:xxxx` = `1520` (table générique de dépôt par glisser-déposer, `1168:1742`). Confiance : **sûr** (lu dans le code ou vérifié sur les données), **probable** (déduit de plusieurs indices), **hypothèse**. Les arguments des appels `far` sont donnés dans l'ordre logique (corrigés de l'inversion du §0.2 d'`engine.md`). `rand(max, min)` = `10a8:04e8` : entier de `min` à `max` inclus.

Ce que fait l'épreuve en une phrase : le joueur glisse des Zoombinis, un par un, sur des rampes de lancement ; chacun voyage dans une bulle, **case par case, sur une grille de 13 × 13** posée au-dessus du gouffre, en suivant des panneaux, des aiguillages et des boutons ; il doit arriver sur la falaise en haut à droite (sortie 3). Les erreurs ne coûtent rien (le Zoombini repart du lieu où il s'est posé) ; seuls comptent ceux qui se trouvent sur la falaise 3 quand on quitte l'écran.

## 0. Résumé exécutif

- **But** : amener les Zoombinis de la falaise de départ (en bas à gauche) à la falaise 3 (en haut à droite). Un Zoombini est « sauvé » (`+0x127 = 1`) à l'instant où il entre dans une case de sortie de type `0x17` (`1118:1fb4`). Les autres sont perdus à la sortie de l'écran (renvoyés au dernier camp, `1168:36e1`, screens.md §3.4). **Sûr.**
- **Aucune règle cachée à deviner** : chaque aiguillage conditionnel (« panneau », case de type 2) **affiche** sur la carte l'icône du trait qu'il teste (attribut + valeur, plaque de la planche `tBMP 5100` images 11 à 30, dessin `1100:2679`). Le Zoombini tourne dans la direction du panneau si **son** trait correspond ; sinon il va tout droit. Le joueur lit les panneaux et choisit la rampe de départ. Ce qui est tiré au hasard : quels traits sont affichés sur les panneaux (choisis d'après la composition réelle de l'équipe, §4), quels jeux de sprites colorent les cases, et l'alternance des cartes d'une visite à l'autre. **Sûr** pour le mécanisme ; **probable** pour l'idée « règle visible » (l'image est celle d'une plaque de trait, vérifiée par rendu).
- **Erreurs** : pas de limite. Un Zoombini rejeté (tourbillon, collision) revient sur la falaise où il avait été lancé (**probable** : le code le remet en file d'arrivée avec le numéro de falaise `+0x76` qu'il avait, qui n'est modifié qu'à l'arrivée sur une sortie) et peut être relancé ; un Zoombini qui atterrit sur une mauvaise falaise (sorties 0 à 2) y reste et ne peut être relancé que s'il y a une rampe sur cette falaise. Au plus 10 Zoombinis sont en vol en même temps. **Sûr.**
- **Fin** : le bouton « Go » (région 2) n'est actif qu'après qu'**un** Zoombini au moins a atteint la sortie 3 (`[8916] = 1`) ; il mène à Zoombiniville (`[8556] = 6`). Le bouton « Map » ramène à la carte (`[8556] = 1`) en abandonnant le groupe. Tout Zoombini qui n'est pas sur la falaise 3 est perdu. **Sûr.**
- **Quatre niveaux** (+ un cas particulier) : nombre de panneaux conditionnels (4 / 5 / 7-8 / 8-9), présence d'aiguillages tournants, de boutons (types 4-7) et de cases d'attente (type 5), nombre de rampes (1 à 3) et rampes-pièges (§3). **Sûr.**
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

Le miroir vaut 1 pour les rampes 13 et 14 (0 sinon), le paramètre `+0xf1` vaut 2 pour les rampes 4 à 9, 13, 14 (0 sinon) : orientation du Zoombini posé sur la rampe (**probable**). **Aucune rampe n'est sur la falaise 3.** Les rampes **actives** d'un niveau sont celles de l'en-tête de sa carte (§3.1) ; les autres ne peuvent pas recevoir de Zoombini (`S15:02f0 = 0xfff6`). **Sûr.**

### 2.3 Les types de case (champ `kind`, mot `+0x6c` d'un objet de carte)

La valeur de `S14:0d18` de la case détermine ce qui arrive à un Zoombini qui **entre** dans la case (aiguillage du Tick, `1118:1503` lignes 148-198). Une case sans objet vaut 0 (sol libre). **Sûr** pour les effets ; les noms sont de moi.

| `kind` | Nom | Effet à l'entrée (fonction) |
|---:|---|---|
| 0 | sol | le Zoombini continue tout droit (`1100:0b69`) |
| 1 | tourbillon | **rejeté** : pose `SCRS 14006`, puis retour à la file de sa falaise de lancement (§5.3). Objet : tourbillon `SCRB 10031` (`1100:1301`) |
| 2 | panneau conditionnel | si l'octet d'attribut `+0xec + a` du Zoombini égale `v` (`a`, `v` = trait du panneau, §2.4), sa direction devient `g` ; sinon inchangée. Puis il avance (`1100:1527`) |
| 3 | flèche / aiguillage | la direction du Zoombini devient `g` ; si `rec9 ≠ 0` (aiguillage tournant), `g` passe ensuite à la direction suivante autorisée (`g ← (g+1) mod 4` en sautant les directions de `f` = 0), son sur `5101`/`5102` alterné, puis le Zoombini avance (`1100:1a9d`) |
| 4 | aiguillage à bouton | même effet que le type 3 ; en plus tournés par les boutons du même type (type 6, ci-dessous) |
| 5 | case d'attente | le Zoombini **s'arrête** (animation d'attente en boucle `SCRS 15056`-`15075`) ; il est libéré par un bouton du même type ou par l'arrivée d'un autre Zoombini (`1100:20dc`, `1100:0b69`...) |
| 6 | bouton | son `5103` ; **tous** les objets de même type : les aiguillages de type 4 passent à la direction autorisée suivante, les cases d'attente de type 5 relâchent leur occupant ; puis le Zoombini avance (`1100:102a`) |
| `0x14`-`0x17` | sortie 0 à 3 | arrivée sur la falaise (`1118:1fb4`) |

Détails exacts :

- **Panneau (type 2)** : `+0x82` = `a + 1` (indice d'attribut + 1), `+0x84` = `v` ; test `trait[+0xeb + (+0x82)] == +0x84`, soit octet d'attribut `a` (`+0xec`…`+0xef`) égal à `v` (1 à 5). Sans correspondance, `g` est ignoré. **Sûr.**
- **Aiguillage (types 3 et 4)** : `1100:1a9d` fait `dir_Zoombini = g` **avant** de faire tourner `g` (le Zoombini qui actionne l'aiguillage prend l'ancienne direction). Rotation : `g ← g + 1 (mod 4)` puis tant que `f[g] = 0`, `g ← g + 1`. Le mot `rec9` (`+0x7e`) à 1 déclenche cette rotation à chaque passage ; à 0 elle n'a lieu que par un bouton (type 4 seulement : la fonction de bouton `1100:102a` ne tourne que les objets de `kind` 4). **Sûr.**
- **Case d'attente (type 5)** : à l'arrivée, `case.occupant = id du Zoombini` (`+0x86`). Si un Zoombini **entre** dans une case d'attente déjà occupée (test dans `1100:0b69`, `1527`, `1a9d` : case de destination de type 5 avec `+0x86 ≠ 0`), l'ancien occupant est libéré (file `[894e]`) avec **la direction du nouvel arrivant** (`occupant.+0x58 = arrivant.+0x58`), puis le nouvel arrivant devient l'occupant. Un bouton (type 6) du même type libère l'occupant avec sa direction d'origine. Tant qu'il est retenu, le Zoombini rejoue `SCRS 15055 + 5·(dir) + variante`, dont la fin (événement `0x3d`) le remet en file de traitement : il reste donc dans la case. **Sûr** pour le mécanisme.
- **Bouton (type 6)** : actionné à **chaque** entrée d'un Zoombini dans la case (pas de mémoire d'état). Le type est le champ `rec3` (`+0x72`, 1 à 8 ; 1 est le type « à part » des aiguillages tournants). **Sûr.**
- **Collision** : si deux Zoombinis entrent en même temps dans la même case, ils sont **tous deux rejetés** (§5.3). Mécanisme : à la 4e image de chaque pas (`+0xc8 = 3`, événement `0x14`, `0x1e`, `0x28` ou `0x32` selon la direction) le Zoombini incrémente un compteur de la case `(S14:0x7d0 + 0x4e·r + 6·c)` ; à 1 il y inscrit son identifiant (`+0x7d2`) ; à 2 la paire est mise en file `[8952]` et la case est vidée ; au-delà de 2 la case est vidée. **Sûr.**

### 2.4 Traits et icônes

Un Zoombini a 4 octets d'attribut de 1 à 5 (screens.md §2.1) : `+0xec` (attribut 0), `+0xed`, `+0xee`, `+0xef` (attribut 3). Un **trait** est le couple `(a, v)` ; son indice dans les tables de l'épreuve est `k = 5·a + v` (1 à 20 ; décalages `DS:18f0 = {0, 5, 10, 15}`) ; la table `DS:189c` donne `(a, v)` de `k = 0` à 19 (`k = 0` → `(0, 0)` : ne correspond jamais). Icône d'un panneau : image **`10 + 5·a + v`** de `tBMP 5100` (11 à 30, plaques de 26 × 11 px : 11-15 coiffes, 16-20 yeux, 21-25 nez de cinq couleurs, 26-30 pieds, d'après le rendu ; l'ordre des attributs coiffe / yeux / nez / pieds est donc **probable**, cohérent avec l'hypothèse d'engine.md). La marche d'un Zoombini dépend du type de pieds : les `SCRS` de marche sont indexés par `+0xbf` (1 à 5) et ceux de lancement par `+0xef`, qui semblent être la même valeur (**probable**).

## 3. Niveaux de difficulté

`1168:515d()` renvoie le niveau (0 à 3 ; en entraînement `[96f2] − 1`). À l'entrée : `niveau = 515d()` ; **si `niveau = 3` et que l'équipe compte moins de 5 Zoombinis (`[88e4] < 5`), `niveau = 4`** (`1118:05ab`). `1118:4a3e(niveau)` charge la carte (`REGS` `16600`-`16609`), `1118:4ad2(niveau)` construit la partie.

### 3.1 Format d'une carte de niveau (`REGS 16600 + i`, mots big-endian)

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

Chaque enregistrement crée un objet (`11a8:0ad6`, délai `rand(25, 20)`, sans script, `1118:4cf0`) : `S14:0bc6[r][c] = id`, `S14:0d18[r][c] = kind`, position écran `REGS16000[(r, c)]` (`+0xd6`), jeu de sprites `+0x80` = `[8974 + 2·(type − 1)]` : le type 1 prend la base 31 (images 31-51 de `tBMP 5100`), les types 2 à 8 reçoivent **dans un ordre aléatoire** les bases {52, 73, 94, 115, 136, 157, 178} (tirage sans remise `rand(local_a, 2)`, `1118:4ad2`). Chaque objet est enregistré dans la liste de son type (`[8960]`…, tableaux `S14:10ea`, `1248`, `127a`, `12ac`, `12de`, `1310`, `1342`, `1374`, 20 places chacun) pour que le bouton retrouve ses cibles. Pour un panneau, l'enregistrement reçoit le trait `k = S14:07a8[[892c]]` (un par panneau dans l'ordre du fichier, §4). **Sûr.**

### 3.2 Les dix cartes

| Fichier | Niveau (carte alternée) | Générateur | Rampes actives | Cases `kind 1 / 2 / 3 / 4 / 5 / 6` | Panneaux | Remarque |
|---|---|---|---|---|---:|---|
| `16600` | 0 (1re, `[177a] = 0`) | `1118:67d3` | 1, 4 | 2 / 4 / 9 / 1 / 0 / 0 | 4 | 1 aiguillage tournant à 2 directions |
| `16601` | 0 (2e, `[177a] = 1`) | `67d3` | 1, 3 | 1 / 4 / 13 / 1 / 0 / 0 | 4 | idem |
| `16602` | 1 (`[177c] = 0`) | `1118:6b4d` | 1, 4 | 1 / 5 / 12 / 1 / 0 / 0 | 5 | |
| `16603` | 1 (`[177c] = 1`) | `1118:6f02` | 2 | 1 / 8 / 15 / 2 / 0 / 2 | 8 | boutons de types 4 et 5, 1 aiguillage `kind 3` tournant |
| `16604` | 2 (`[177e] = 0`) | `6f02` | 3 | 1 / 7 / 16 / 3 / 0 / 2 | 7 | |
| `16605` | 2 (`[177e] = 1`) | `1118:7532` | 3 | 1 / 8 / 14 / 2 / 0 / 2 | 8 | |
| `16606` | 3 (`[1780] = 0`) | `1118:7acf` | 2, 4, 12 | 5 / 9 / 12 / 5 / 3 / 4 | 9 | rampe 12 = piège (mène à un tourbillon) |
| `16607` | **jamais choisie** (`[1780]` ne vaut que 0 ou 2) | — | 1, 3, 14 | 4 / 9 / 18 / 4 / 2 / 4 | 9 | donnée inutilisée |
| `16608` | 3 (`[1780] = 2`) | `7acf` | 3, 5, 8 | 4 / 9 / 18 / 5 / 2 / 4 | 9 (8 rangs de règle seulement) | rampe 8 = piège |
| `16609` | 4 (équipe < 5) | `7532` | 3 | 1 / 8 / 14 / 2 / 3 / 2 | 8 | **`16605` plus trois cases d'attente** (types 3, 4, 5) |

Alternance : `1118:4ad2` incrémente après usage `[177a]` (modulo 2), `[177c]`, `[177e]` (modulo 2) ou `[1780] += 2` (modulo 4, soit 0 / 2). Ces compteurs sont des variables initiales de `DS` (valeur 0) et **persistent entre deux visites de l'épreuve dans la même session** : la première visite du niveau 0 joue `16600`, la deuxième `16601`, la troisième `16600`… Le niveau 1 alterne `6b4d` + `16602` puis `6f02` + `16603` ; le niveau 2 alterne `6f02` + `16604` puis `7532` + `16605` ; le niveau 3 alterne `16606` / `16608` avec `7acf`. Pas de sauvegarde dans le fichier de partie (**probable** : aucune écriture dans `S`). **Sûr.**

Pièges de lecture : les « rampes » 12, 14 et 8 des cartes de niveau 3 sont des rampes-pièges (leur premier chemin mène directement à un tourbillon dans tous les essais simulés). Les niveaux 0 à 2 n'ont que des rampes sur la falaise de départ (rampes 1 à 6) ; seul le niveau 3 en place sur d'autres falaises (2, 4, 12 ; 1, 3, 14 ; 3, 5, 8), ce qui permet de **relancer** depuis une falaise où l'on a atterri par erreur (rampes 12 et 14 : falaise 2 ; rampe 8 : falaise 1).

## 4. Choix des panneaux (génération de la règle)

Chaque générateur remplit le tableau `S14:07a8[0..]` (indice `[8928]`) de traits `k` (1 à 20 ; 0 = case neutre), consommés dans l'**ordre des enregistrements `kind 2` du fichier** (`1118:4cf0`, compteur `[892c]`). La longueur écrite dépasse ou égale le nombre de panneaux de la carte. Ils reposent sur la composition **réelle** de l'équipe.

**Tableaux et utilitaires** (tous `S14` ; `n = [88e4]` = nombre de Zoombinis du groupe, au plus 16 ; **sûrs**) :

| Élément | Rôle |
|---|---|
| `S14:056c` | copie de travail de l'équipe : `n` lignes de 4 mots (valeurs d'attribut 1 à 5, 0 = « retiré ») (`1118:5206`, via `1168:365d`) |
| `S14:06ac[1..20]` | histogramme `H[k]` : nombre de Zoombinis (non retirés) portant le trait `k` (`1118:5390`) |
| `S14:06d6` → `S14:072a` | liste des traits que **personne** ne porte (`H[k] = 0`) : `1118:6645` construit, `1118:6688` compte (`[8930]`, minimum `[8932] = 1`) ; vide → `1118:67a7` met les 20 traits |
| `S14:0700` → `S14:0754` | même chose pour la liste de repli de `6f02`/`7532` (`1118:66f6`, `1118:6739`) ; les tirages relisent `S14:0700[rand(…)]` et non `0754` (probable défaut de l'original) |
| `S14:0e6a`, `S14:0f0a` (20 × 4 mots), `[893a]` | traits déjà utilisés par des panneaux, comme lignes d'équipe |

- `1118:5390(p)` : remet `H` à 0 ; pour chaque membre, **le retire** (ligne mise à 0) s'il porte le trait `p` (si `p ≠ 0`) ; compte les membres restants et incrémente `H` pour leurs 4 traits. Renvoie le nombre de membres restants.
- `1118:52a6(p)` : ne garde dans la copie de travail que les membres portant `p`.
- `1118:5e24(max, min)` : trait `k` de plus grand `H[k]` compris entre `min` et `max` (premier en cas d'égalité) ; `0` sinon. `1118:559d(ex)` : trait de plus grand `H` hors `ex`. `1118:65b9(max, min, ref)` : idem restreint au même attribut que `ref`, `k < 20`. `1118:658e()` : nombre de traits à `H ≠ 0`. `1118:5da8(k) = H[k]`. Table `DS:18f8[i] = ceil(i/2)` (0 1 1 2 2 3 3 4 4 …).
- `1118:5ad6(ex)`, `1118:5643(m, ex)`, `1118:5e8f(max, min)`, `1118:61fd(max, min)` : choisissent un trait **peu porté** (plus petit `H > 0`, ou borné) dont un porteur n'a pas encore sa valeur d'attribut utilisée par un panneau précédent (listes `0e6a`/`0f0a`), l'enregistrent et retirent les porteurs. **Lu dans le code, détail non réécrit ici** : la structure (choisir un trait, recopier un représentant, retirer les porteurs, recompter `H`) est sûre ; les cas limites de bouclage (`[893a] < 3` ou `< 4`, `< 0x14`) ne sont pas tous tracés.

**Niveau 0 (`67d3`, 4 panneaux)** : `p0 = 5e24(2, 1)` si moins de 3 membres sont à classer, sinon la première réussite parmi `5e24(5, 2)`, `(9, 6)`, `(16, 10)`, `(16, 1)` (un trait porté par peu de Zoombinis d'abord) ; en cas d'échec, trait absent de l'équipe (`rand` dans `072a`). Panneau 0 et 1 = `p0` (dupliqué), `5390(p0)`, puis panneau 2 et 3 : traits tirés parmi les traits « de milieu de gamme » (`5e24(ceil(restants/2), 1)`, `65b9`) ou, s'il reste moins de 5 traits, traits absents au hasard ; les deux derniers sont éventuellement échangés pour que le plus rare passe en second.
**Niveau 1 (`6b4d`, 5 panneaux)** : même début ; les panneaux 0, 1 et 2 portent le **même** trait ; puis 2 panneaux comme ci-dessus (`559d` ou traits absents). `6f02` (cartes `16603`/`16604`, 7 à 8 panneaux) : trait 0 (dupliqué), puis `52a6`, puis trois traits via `5ad6`, copie du panneau 2 en panneau 3 si `[88e0] = 1`, etc.
**Niveau 2 (`6f02` ou `7532`, 7 à 8)** et **4 (`7532`)** : `7532` commence par `5ad6`, `5e8f(1,1)`…`(16,1)`, duplique, puis alterne `5ad6` et traits absents.
**Niveau 3 (`7acf`, 8 à 9 panneaux)** : trois traits tirés par `5643(0, 0)`, un quatrième (`local_8`), `5390` sur les trois premiers ; taille de groupe `DS:193c[restants] ∈ {1, 4, 7, 10, 13, 16}` ; deux traits issus de `5e8f`/`61fd(3, 1)`, puis **deux traits purement aléatoires** `rand(20, 1)` (les deux derniers panneaux n'ont aucun lien avec l'équipe).

Équivalent fonctionnel recommandé si l'on ne reproduit pas bit à bit : (1) calculer `H[k]` ; (2) donner aux premiers panneaux des traits portés par quelques Zoombinis (ni tous, ni aucun), en retirant les porteurs de l'étape suivante ; (3) compléter par des traits absents de l'équipe (panneaux inertes, `H = 0`) ; (4) au niveau 3 finir par deux traits aléatoires. Toute carte doit rester jouable quel que soit le tirage : chaque panneau ne fait qu'**ajouter** un détour (le Zoombini qui ne correspond pas va tout droit). **Probable** pour cette lecture d'intention.

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
| `[88f8..8908]` | identifiants des Zoombinis en vol (au plus 10), `[890e]` leur nombre |
| `[8916]` | 1 dès qu'un Zoombini a atteint la sortie 3 : active « Go » ; `[8988]` nombre de ces arrivées |
| `[8920..8926]` | compteurs de places occupées dans la file d'attente de chaque falaise (0 à 19, bouclent) |
| `[8928]` | rang d'écriture des traits ; `[892c]` rang de lecture (§4) |
| `[8948]`, `[894a]`, `[894c]`, `[894e]`, `[8950]`, `[8952]`, `[8954]`, `[8956]`, `[895a]`, `[895c]` | files d'événements du Tick (§5.2) ; `[8956]` n'est jamais alimenté |
| `[899a]` / `[899c]` / `[899e]` | danse finale : nombre de Zoombinis − 1 / nombre déjà dansés / drapeau |
| `[1778]` | indice de la carte du niveau ; `[177a]`, `[177c]`, `[177e]`, `[1780]` alternances ; `[1782]` alternance du son de rotation |
| `[88dc]`, `[88da]`, `[88e8]`, `[88ec]` | mis à 0 à l'entrée ; `[88dc]` posé par l'événement `0x0a` de la rampe ; jamais lus (inutilisés) |

### 5.2 Tick (`1118:1503`) : files d'événements

Le Tick n'a pas de machine à états explicite : les rappels d'événements des animations (§5.4) **empilent** des identifiants dans des files, que le Tick vide à chaque tour dans cet ordre (**sûr**) :

1. Si `[8556] ≠ 0` (sortie demandée) : si `1028:0d9e(20036, 0x53, 996)` renvoie ≠ 0 (**probable** : un son est encore en cours), attend ; puis si `[a2de] ∈ {0, 3}` et (`[a406] ≠ 0` ou `[9702] = 0` ou `[9704] > 0`) : `[8554] = [8556]`, `[8556] = 0`, `11b8:0011(0, 0)`, Exit. `[a2de] = 2` : annule la demande.
2. `[8954]` (rampes) → `1118:29cc(zone)` : la rampe lance son script `S14:028e[zone]` (9000 / 9001 / 9003) avec le rappel `1118:39c5` ; éventuelle plaque supérieure `+1` ; réordonne les calques par rapport au Zoombini (`+0x94`).
3. `[894e]` (libérations de cases d'attente) → `1100:0b69(Zoombini)` : repart dans sa direction.
4. `[894c]` (objets d'effet terminés) → repasse l'objet sous le calque `[88d8]`.
5. `[894a]` → réordonne la plaque de rampe sous le Zoombini.
6. `[8956]` (jamais alimenté) : lancerait `SCRS 15090 + attribut 3` sur un Zoombini.
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
- **Région 3 : zone de jeu**. Ignorée si `[9702] > 0` (placement initial en cours). Au premier clic : `[88e6] = 1` et `1100:0000` sur chaque Zoombini (initialise les tables de scripts : walks `15014 + variante`…, attentes `15054 + …`, poses de rampe `14999 + …`). Puis : `11a8:0d61(1, 1, 0, x, y)` (Zoombini sous le curseur, indicateurs `1` ou `0x8001`) ; **refus** si `[890e] ≥ 10` ou si ce Zoombini est déjà dans la liste en vol. Sinon `1168:1742(0, S14:13d8 + 8·(+0x76), x, y, Zoombini)` : glisser-déposer contraint au **rectangle de sa falaise** ; critère de dépôt : le point de dépôt `S15:00fc + 4·z` d'une rampe `z` (< `S15:0000`) dans le carré de ±15 px (`[9706] = 15`) centré sur la position du Zoombini, rampe libre (`S15:02f0 + 2z = 0`). `[88ee] = 1168:166e()` (rampe + 1, 0 si aucune). Dépôt hors rampe : le Zoombini retourne à sa place (`+0xe6`). Dépôt sur rampe : refusée si `S14:0070 + 2·(z + 1) ≠ 0` (rampe déjà en cours de lancement) ; sinon **lancement** :
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

**Pas** (`SCRS 15015 + 5·dir + (variante − 1)`, 7 images, une case par pas) : événement `0x14 / 0x1e / 0x28 / 0x32` (octet 21 / 31 / 41 / 51) aux images 1 à 5, effectif **à la 4e image** (`+0xc8 = 3`) : enregistrement dans le compteur de collision (§2.3) ; événement de fin `0x15 / 0x1f / 0x29 / 0x33` (octet 22 / 32 / 42 / 52) à l'image 6 : le Zoombini est mis en file `[8948]` ; le Tick lit alors la case atteinte. Chaque case de type 0, 2, 3, 4, 6 relance immédiatement un pas dans la nouvelle direction (déplacement de `(+0x72, +0x74)` à partir de `(+0x6e, +0x70)` puis position `REGS 16000[…] + (4, −38)`, bulle suivant le Zoombini). ≈ 7 images de 6 ticks (≈ 0,7 s) par case (**probable** : délai de 6 ticks pour les Zoombinis, 7 pour les effets).

**Tourbillon (type 1)** : `1100:1301` crée l'objet tourbillon `SCRB 10031` et joue `SCRS 14006` (26 images ; événements `1` aux images 0, 1, 4, 5, 8, 9 ; `0x5c` à l'image 25) sur le Zoombini avec le rappel `1118:3784` : à la fin (événement `0xffff`) il est mis en file `[8950]` (retour à sa falaise) ; à `0x5c` : libère les objets d'effet (`+0x82`, `+0x84`), retire le Zoombini des listes en vol (`[88f8]`, `[890e]--`) et vide son compteur de collision.

**Collision** (`1100:02cf(a, b)`) : selon les directions des deux Zoombinis, choisit deux poses de collision `SCRS 15035 + 5·g + variante` (g = 0 à 3 : groupe d'images à `(230,129)`, `(215,131)`, `(229,122)`, `(244,128)`), crée deux éclaboussures `SCRB 10012` à `10029` (famille 6 × zone `S14 [88d2]` 0 à 2), événements `0x3d` (REJECT `SCRS 14004` avec `1118:3784`) et `0x3f` (nettoyage `[894c]`), son `\0SND 10000` à `10004` des scripts `SCRB 10004` à `10011` (images 0 et 7). Les deux Zoombinis reviennent ensuite à leur falaise de lancement (`[8950]`). **Sûr** pour l'enchaînement, **probable** pour les noms des familles de sprites.

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

Simulation Python hors dépôt (scratchpad) des règles du §2 sur les dix cartes réelles, avec traits de panneaux et Zoombinis tirés au hasard, un Zoombini à la fois, sans collision ni case d'attente : de chaque rampe active, tous les trajets (300 essais par rampe) se terminent par un tourbillon ou une sortie, jamais hors du losange ni en boucle : niveau 0 et 1 : sortie 3 ou tourbillon ; niveau 2 : idem ; niveau 3 : rampes-pièges toujours en tourbillon, autres rampes vers les sorties 1, 2 ou une case d'attente. Cela valide la lecture des directions, des cases de départ et des types de case (§2.1 à 2.3). Les mêmes essais montrent que la sortie 3 est atteignable quelle que soit l'affectation des traits aux panneaux dans les niveaux 0 à 2 (proportions de 15 à 85 % selon les tirages). Les générateurs de traits (§4) n'ont pas été simulés.

## 8. Points ouverts

1. **Générateurs de traits (§4)** : les corps de `5643`, `5ad6`, `5e8f`, `61fd` sont résumés, pas réécrits ; relire `1118:5643`, `1118:5ad6`, `1118:5e8f`, `1118:61fd`, `1118:67d3`, `1118:6b4d`, `1118:6f02`, `1118:7532`, `1118:7acf` pour une reproduction bit à bit. Le défaut apparent des tirages `S14:0700` au lieu de `0754` est à confirmer en jeu.
2. **Placement initial de l'équipe** sur la falaise 0 et file d'attente (`1168:2505`, `1168:274e`, `S15:03ec`), valeur initiale de `+0x76` (supposée 0) ; mode `1168:4231` des poses assises.
3. **Dessin des cases** : `1100:2679` (images de `tBMP 5100` : tourbillon 2-5, flèche base + 5…, case d'attente base + 9…, bouton base + 19, animations de bouton base + 15…) non détaillé ; correspondance précise image / type.
4. **Sons** : `\0SND 5100`, `11000`, `12000` non trouvés dans un événement ; id `20036` attendu avant de quitter (`1028:0d9e`) non identifié ; scripts `SCRB 11000`-`11002`, `12000`-`12002`, `SCRS 14003`, `14005`, `14007` (rôle exact : `14003` et `14007` appelés par `1118:2d2a` et l'événement `0x78` de `1118:348d`).
5. **`REGS 16001`, `16002`, `16499`, `16500`, `17002`, `18002`, carte `16607`** : données non référencées par le code (probablement des variantes de développement).
6. **Hypothèses de nommage** : « Bubblewonder Abyss », ordre coiffe / yeux / nez / pieds, `+0xbf = +0xef`.
7. **Durées exactes** (délais de 6 / 7 ticks, longueur d'un pas), voix d'introduction (`[a2c4] = 20068`) et textes d'aide (`11a0:155e`).
8. **Carte `16609`** (équipe < 5, niveau 3) : même carte que le niveau 2 plus trois cases d'attente ; l'intention du niveau 4 n'est pas établie.
