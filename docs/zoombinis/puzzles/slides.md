# La fosse de monte-pierre (`SLIDES.MHK`, écran 12) : étude de rétro-ingénierie

Tâche T7. Épreuve 6 du parcours (3e de l'étape 2, entre Lilly et le camp 2) de `ZOOMBINI.EXE` (L'Odyssée des Zoombinis, version 1.0FR, NE 16 bits). Archive `SLIDES.MHK`, `Enter` `1170:0000`, `Exit` `1170:04db`, `Tick` `1170:0532`, `Key` `1170:1740` (descripteur `1530:24c6`, [../engine.md](../engine.md) §2.1). Le générateur de niveau est dans un module voisin, `1150:*` (appelé par `1170:0000`). Document d'étude seul (aucun code applicatif). Cadre général : [../engine.md](../engine.md) (scripts `SCRB` / `SCRS`, `tBMP`, aléatoire) et [../screens.md](../screens.md) (parcours, difficulté, groupe de Zoombinis). Corpus Ghidra : `archives/zoombinis/re/ZOOMBINI/`.

Confiance : **sûr** = lu dans le code ou vérifié sur les données ; **probable** = déduit de plusieurs indices concordants ; **hypothèse** = déduction non vérifiée.

## 0. Pièges de lecture

- **Plusieurs segments de données.** Le code de l'épreuve accède à deux familles de données : `DS` = `1530` (variables, notées `DS:xxxx`) et un segment de données lointain `14e8` (tableau des cases du plateau, masques, positions), noté ici `S14:xxxx`. Ghidra affiche ces accès `ES:[…]` sans segment (`*(int *)(i * 0x12 + 0x278)`) ou avec `DAT_14e8_…` ; il étiquette même à tort `0x240` d'un `"New Game"` du segment `DS`. Les petites tables de l'épreuve (`1d78`, `1d94`, `1db0`, `1dd4`, `1df8`, `1dfe`, `1e04`, `24e8`…) sont dans `DS` ; les tables de niveau 3 sont des segments lointains (`1488`, `1490`, `1498`, `14a0`, `14a8`, `14b0`) ; les 16 identifiants de Zoombinis de l'épreuve sont à `14c0:0000`. **Sûr** (désassemblage, tables relues dans les octets du NE).
- **Tables de saut dans le segment de code** : les `switch` de `1170:20cc` (table `1170:22ea`), `1170:23a2` (`1170:24f4`), `1170:250c` (`1170:26a0`), `1170:4bb8` (`1170:4da9`) et `1170:1740` (`1170:1810`) lisent des tables `CS:`. Ghidra ne désassemble pas leurs cibles : relues avec un script Ghidra jetable (projet copié dans le scratchpad). Aucune de ces routines n'a d'appelant direct.
- Les noms de variables sont **inventés** ; les adresses sont celles du code. Les arguments `pascal` sont dans l'ordre inverse de la signature décompilée ([../engine.md](../engine.md) §0).

## 0.1 Résumé exécutif

- Le joueur dispose d'un plateau de 117 pierres (13 rangées de 9, treillis hexagonal décalé) dont certaines sont des **emplacements** pour un Zoombini, séparés par des **pierres de liaison** qui portent un symbole : l'un des 4 attributs d'un Zoombini. Il glisse chaque Zoombini du groupe sur un emplacement. Une liaison **monte** quand les deux Zoombinis posés de part et d'autre ont la **même valeur** de l'attribut indiqué ; un emplacement est « relié » (état `0x1fc`) s'il est relié à une pierre de départ par une suite de liaisons montées. **Sûr** pour la règle, **probable** pour les niveaux 2 et 3 (voir §3).
- Le bouton « go » (écran, en bas à droite) n'est actif que si au moins un Zoombini est relié ; une fois cliqué (définitif), **les pierres montées s'élèvent et seuls les Zoombinis reliés traversent**. Tous les autres sont perdus (renvoyés au camp 1 par le moteur, [../screens.md](../screens.md) §3.4). **Sûr.**
- Pas de nombre d'erreurs tolérées, pas de chronomètre, pas de limite d'essais : on peut déplacer les Zoombinis autant qu'on veut avant « go ». **Sûr.**
- Quatre niveaux (0 à 3 en interne) : paires, chaînes de 3, réseau en échelle (3 entrées), réseau en nid d'abeilles (1 entrée, 26 emplacements). Le puzzle est **toujours résoluble** : il est construit à partir d'une solution (les liaisons sont tirées parmi les attributs réellement partagés). **Sûr** (niveaux 0 et 1), **probable** (niveaux 2 et 3).
- Nom : « la fosse de monte-pierre » (`STRL` 2000, n° 7) est correct : l'épreuve est celle des **pierres qui montent** (`SCRB` 7002, animation d'élévation de la pierre, §5). **Probable** pour le rapprochement de `STRL`, **sûr** pour la mécanique.

## 1. Identification

### 1.1 Écran et handlers

| Rôle | Adresse | Confiance |
|---|---|---|
| Écran 12 (descripteur `1530:24c6`) | Enter `1170:0000`, Exit `1170:04db`, Tick `1170:0532`, Key `1170:1740` | sûr |
| Générateur de niveau (appelé en fin d'Enter) | `1150:0000` | sûr |
| Clic de région (callback de `1038:0000(0xc000, 1, 0x24ba)`) | `1170:08f5(code)` | sûr |
| Dessin des boutons « retour » (1) et « go » (2) | `1170:03ad(redessiner, enfoncé, bouton)` ; état `1170:0478` | sûr |
| Propagation de la « montée » après un dépôt (niveaux 0 et 1) | `1170:26b4` | sûr |
| Propagation d'une liaison (niveaux 2 et 3) | `1170:40b5(loin, liaison, près)`, appelée par `1170:3eb1`, `1170:48c4`, `1170:3aa3`, `1170:3ca9` | sûr |
| Remise à zéro puis recalcul complet (niveaux 2 et 3) | `1170:3dc0` | sûr |
| Marque les Zoombinis reliés comme sauvés (`+0x127 = 1`) | `1170:2d65` | sûr |
| Active / désactive « go » (au moins un `0x1fc`) | `1170:2dba` | sûr |
| Son de retour d'information après un dépôt | `1170:4f98` (+ `1170:4f50` : compte les pierres montées) | sûr |
| Animation « rejet » quand on lâche un Zoombini sur une pierre qui n'est pas un emplacement | `1170:4ddd` (+ callback d'événements `1170:4bb8`) | probable |
| Choix d'une position d'attente libre pour un Zoombini déposé hors plateau | `1170:509f` | sûr |
| Filtres d'image des pierres (callbacks de feature) | `1170:20cc` (pierre), `1170:23a2` (anneau d'emplacement), `1170:250c` (pierre en train de monter), `1170:2093` (rappel de palette) | sûr |
| Pose / retrait des cases de départ au niveau 3, mise en place des positions | `1150:1a03`, `1150:1c62`, `1150:2222`, `1150:249e`, `1150:3093`, `1150:316c`, `1150:329c` | probable |
| Cycle de palette (effet décoratif) | `1170:2312`, `1150:2b6f` | probable |

### 1.2 Ressources de `SLIDES.MHK`

Inventaire vérifié sur l'archive (`original/zoombinis/SLIDES.MHK`).

| Tag | Ids | Usage | Confiance |
|---|---|---|---|
| `tBMP` | 5000 | fond 640 × 480 (RLE) ; `SHPL` 5000 = palette (10…246) | sûr |
| `tBMP` | 100 | « terrain » 160 × 120 (`11a8:1783`) | sûr (chargement), rôle non étudié |
| `tBMP` | 6000 | planche de **boutons** (6 images, chargée par `11a8:2ae6`, `DS:24da`) | sûr |
| `tBMP` | 7000 | groupe de formes 0 (112 images : pierres, anneaux, décors) ; **sans `REGS`** (parties posées telles quelles) | sûr |
| `tBMP` | 8000 | groupe de formes 1 (8 images : animation de « rejet ») | sûr |
| `SHPL` | 5000, 6000, 7000 | palettes (6000 et 7000 : l'entrée 255 seule) | sûr |
| `SCRB` | 7000 à 7013 (14, chargés par `11a8:14ab(14, 7000)`) et 8000 à 8002 (3, `11a8:15a6(0, 3, 8000)`) | voir §5 | sûr |
| `SCRS` | 13000 à 13005 (6, `1168:04d0`) = animations « normales » de Zoombini ; 14000 à 14003 (4, `1168:03ef`) = animations de **rejet** | voir §5 | sûr |
| `\0SND` | 7000, 7001, 7002, 8000, 8500 à 8505 | voir §5.3 | sûr |
| `NODE` / `PATH` | 1000 / 1000 | **chargés seulement au niveau 3** (`1168:2a5c` si `DS:9b66 == 3`) : 4 points `(414,180) (454,180) (494,180) (534,180)`, 1 chemin `[1,2,3,4]` | sûr (contenu), rôle probable : parcours de sortie des Zoombinis au niveau 3 |
| `REGS` | aucun | | sûr |

Groupes de formes déclarés à l'entrée (`11a0:0000(0, k, id)`) : groupe 0 = `tBMP` 7000, groupe 1 = `tBMP` 8000. Convention du moteur : id du groupe = id de son premier `SCRB`.

Archives communes : `ZOOMBINI.MHK` (sons de voix `20055…20063`, `20078`, `996`, `997`, `999` ; `SCRS` communs 100…150 ; `tBMP` 3000/3100/3200 des Zoombinis).

## 2. Règles exactes

### 2.1 Les objets

- Le **groupe** est celui de l'engagement en cours, lu par `1168:365d()` à l'entrée : un mot `n` (nombre de membres, 1 à 16, `DS:9c80`) suivi de 4 octets par membre ([../screens.md](../screens.md) §2.1, valeurs d'attribut 1 à 5). Chaque membre est un « snoid » (feature de Zoombini) dont les 4 attributs sont aux offsets `+0xec`, `+0xed`, `+0xee`, `+0xef` (attributs 0, 1, 2, 3). Les 16 identifiants de features des membres sont dans `14c0:0000` (16 mots).
- Le **plateau** est un tableau de **117 cases** (`0x75`), 13 rangées de 9, numérotées `i = 9 × rangée + colonne`. Case `i` = enregistrement de 18 octets à `S14:0276 + 18 i` :

| Offset | Contenu |
|---|---|
| `+0` | id de la feature (sprite) de la pierre |
| `+2` | **état** (voir ci-dessous) |
| `+4` | **contenu** : id du Zoombini posé (état `0x1fb`/`0x1fc`), ou code de symbole `0x1fe`…`0x201` (liaison), ou 0 |
| `+6…+0x11` | 6 voisins (mots, `-1` = pas de voisin), directions 0 à 5 |

- Tableaux parallèles : positions écran `(x, y)` de chaque pierre à `S14:0000 + 4 i` ; **masque de liaisons** de 6 bits par case à `S14:0ab0 + 2 i` (bit `k` = la case est reliée à son voisin `k`) ; copies des attributs des membres : attribut 0 à `S14:0b9a`, attributs 1, 2, 3 à `DS:9cde`, `9cfe`, `9d1e` (16 mots chacun, indexés par rang de membre) ; **positions d'attente** (16) à `S14:0bba` ; liste des emplacements `k` (1 à `DS:9c7a`) → numéro de case à `S14:0240 + 2 k`, position écran de l'emplacement `k` à `S14:01d4 + 4 k`.
- Grille : colonne `c` ↔ x décroissant, rangée ↔ y croissant. Exemple (rangées 0 à 2) : `(477,152) (435,152) …` ; rangée 1 `(461,170) (419,170) …` ; rangée 2 `(487,188) …` ; pas horizontal 42, pas vertical 18, rangées paires et impaires décalées. Rangée 12 : `(537,368) (495,368) …`. Un emplacement affiche son Zoombini à `(x + 24, y - 5)`. Sûr (tableau de 117 couples relu dans le segment lointain).
- **Voisins** (`1170:1828`), pour une case `i` : rangée paire (`i mod 18 < 9`) : `n0 = i-10`, `n1 = i-1`, `n2 = i+8`, `n3 = i+9`, `n4 = i+1`, `n5 = i-9` ; rangée impaire : `n0 = i-9`, `n1 = i-1`, `n2 = i+9`, `n3 = i+10`, `n4 = i+1`, `n5 = i-8`. Sur l'écran : 0 = haut-droite, 1 = droite, 2 = bas-droite, 3 = bas-gauche, 4 = gauche, 5 = haut-gauche. Un voisin n'est retenu que si le bit correspondant du masque est posé ; le code évite le débordement aux bords (colonnes 0 et 8, rangées 0 et 12). **Sûr.** Le sens de la propagation est **vers la gauche** (colonnes croissantes) : les pierres de départ sont à droite (colonne 0).

États d'une case (`+2`), **sûrs** pour la valeur, **probables** pour les noms :

| Valeur | Nom | Sens |
|---:|---|---|
| `0x1f4` (500) | vide | pas de pierre (valeur initiale partout) |
| `0x1f5` | liaison basse | pierre de liaison pas encore montée ; `+4` = symbole `0x1fe + a` (attribut `a`) ou 0 (liaison « libre ») |
| `0x1f6` | liaison montée | la liaison est satisfaite |
| `0x1f8` / `0x1f9` | pierre de départ | variante visuelle de la pierre de départ (`DS:9d5e`, voir §3) |
| `0x1fa` | emplacement libre | accepte un Zoombini |
| `0x1fb` | emplacement occupé | un Zoombini y est posé, pas relié |
| `0x1fc` | emplacement relié | le Zoombini posé est relié à un départ |

### 2.2 Ce que fait le joueur

1. Il **saisit** un Zoombini du groupe (clic sur sa feature, `11a8:0d61(1, 1, 0, point)` puis `1168:521e`) et le **glisse** : `1168:1742` exécute le glisser-déposer de façon bloquante (boucle interne qui suit le curseur jusqu'au relâchement) et enregistre en `DS:99d8` / `99da` l'emplacement visé. `1168:166e()` renvoie le **rang `k` (1 à `9c7a`) de l'emplacement** où le Zoombini a été lâché, 0 si nulle part. Tolérance de dépôt : `DS:9706` (non relevée). **Sûr** pour le flux, la valeur de la tolérance est un point ouvert.
2. Lâché **sur un emplacement** (`k ≠ 0`) : l'emplacement précédemment occupé par ce Zoombini est libéré (voir §2.3) ; si l'emplacement `k` était occupé, son occupant est renvoyé à une position d'attente (`1170:509f`) ; l'état de `k` devient `0x1fb`, `+4` = id du Zoombini ; la montée est recalculée ; un son de bilan est joué (§5.3).
3. Lâché **hors emplacement** (`k = 0`) : le Zoombini est retiré de son emplacement s'il en occupait un, les liaisons dépendantes sont rabaissées et il va à une position d'attente libre. S'il est lâché au-dessus de l'une des 117 pierres, l'animation de **rejet** est jouée (`1170:4ddd`, §5.1).
4. Bouton **go** : voir §2.5. Bouton **retour** (haut) : retour à la carte, groupe perdu après confirmation moteur (`11a0:16da`).

Les clics sont ignorés pendant l'animation de rejet (`DS:9c70 ≠ 0`), pendant une animation de fin (`DS:9d66 ≠ 0`), pendant une voix (`DS:9702 ≥ 1`) et après « go » (`DS:9c72 ≠ 0`). **Sûr.**

### 2.3 Règle de montée, niveaux 0 et 1 (`1170:26b4`)

Après un dépôt sur l'emplacement `k` (case `s = S14:0240[9c7c]`) :

1. **Libération de l'ancien emplacement** (`1170:08f5`, branche de dépôt) : pour chaque emplacement `j ≠ k` dont `+4` désigne le Zoombini déplacé : `+4 ← 0`, état `← 0x1fa`, sprite rafraîchi ; si la case précédente (`j-1`, la liaison à sa droite) est montée (`0x1f6`) elle redevient `0x1f5` ; les 5 cases suivantes (`j+1…j+5`) jusqu'à une case vide `500` sont rabaissées : `0x1f6 → 0x1f5`, `0x1fc → 0x1fb`. **Sûr.**
2. La case `s` passe à `0x1fb`.
3. On **remonte** de `s` vers la pierre de départ (voisins 0, 1 puis 2 par ordre de préférence) jusqu'à trouver une case dont l'état vaut `DS:9d5e` (pierre de départ).
4. On **redescend** de la pierre de départ le long de la rangée (voisins 5, 4 puis 3) en examinant chaque case :
   - `0x1fa` ou `500` : arrêt (rien au-delà n'est relié) ;
   - `0x1fb` : passe à `0x1fc` (relié) ;
   - `0x1f5` (liaison) :
     - **liaison libre** (`+4 = 0`, niveau 1 seulement) : elle monte (`0x1f6`) dès que la case précédente est `0x1fc` ;
     - **liaison à symbole** (`+4 = 0x1fe + a`) : soit `G` et `D` les emplacements gauche et droit. Si les deux sont `0x1fb` ou `0x1fc` et que l'attribut `a` du Zoombini de `G` est **égal** à celui du Zoombini de `D` (octets `+0xec + a`), la liaison passe à `0x1f6` ; sinon la propagation s'arrête ;
     - si l'un des voisins n'est pas occupé, arrêt.
5. Quand la case n'est plus bloquée, passage à la case suivante ; s'arrête sans voisin.

Conséquence : dans chaque rangée, un Zoombini est relié s'il est en tête de rangée (juste après la pierre de départ), ou si toutes les liaisons qui le séparent du départ sont montées. Deux Zoombinis qui ne partagent pas l'attribut demandé **bloquent** la rangée. **Sûr.**

Attribut demandé : le symbole `0x1fe + a`, `a` = 0 à 3 est l'indice de l'attribut ([../screens.md](../screens.md) §2.1 : ordre cheveux, yeux, nez, pieds **non vérifié**). Les sprites de symbole sont les parties `0x49`, `0x4a`, `0x4b`, `0x4c` de l'image de la pierre (§5.2).

### 2.4 Règle de montée, niveaux 2 et 3 (`1170:3dc0`, `1170:3aa3`, `1170:3ca9`, `1170:40b5`)

Plateau en treillis : les liaisons s'enchaînent dans toutes les directions autorisées par le masque. Chaque dépôt ou retrait déclenche `1170:3dc0`, qui **remet à zéro** la propagation (`0x1fc → 0x1fb`, `0x1f6 → 0x1f5`) puis la **recalcule** :

- **niveau 2** (`1170:3ca9`) : les trois emplacements d'entrée `19`, `55`, `91` passent de `0x1fb` à `0x1fc`, puis `1170:48c4(case)` propage dans le treillis ;
- **niveau 3** (`1170:3aa3(0x36)`) : l'emplacement d'entrée `55` passe de `0x1fb` à `0x1fc`, puis `1170:3eb1` est appliqué, dans l'ordre de la table `DS:24e8` (31 cases : `55 57 59 61 38 74 40 76 42 78 44 80 19 91 21 93 23 95 25 97 2 110 4 112 6 114 57 59 61 97 25`), à chaque case déjà `0x1f6` ou `0x1fc` ; la table sert de balayage ordonné pour qu'une passe suffise ;
- `1170:40b5(loin, liaison, près)` : pour une liaison à l'état `0x1f5` entre l'emplacement `près` (déjà occupé : `0x1fb`, `0x1fc` ou liaison montée) et l'emplacement `loin` :
  - si la liaison est **libre** (`+4 < 0x1fe`) : elle monte (`0x1f6`), et `loin` passe à `0x1fc` s'il est occupé (ou la liaison suivante à `0x1f6` si `loin` est une liaison basse) ;
  - sinon, si `près` et `loin` sont tous deux occupés et que l'attribut `+4 - 0x1fe` est **égal** chez les deux Zoombinis : la liaison passe à `0x1f6` et `loin` à `0x1fc` ; sinon rien.

Le niveau 2 relie donc simultanément jusqu'à 3 entrées ; le niveau 3 n'en a qu'une (case 55). **Probable** (règle lue, mais 3eb1/48c4 ont de nombreux appels imbriqués que je n'ai pas tous dépliés).

### 2.5 Bouton « go » et réussite d'un Zoombini

- « go » est **actif** quand `DS:9b64 ≠ 0` : mis à 1 par `1170:2dba` (au moins un emplacement `0x1fc`) ou par `1170:4f98` quand le nombre de pierres montées augmente ; l'image du bouton (planche `tBMP` 6000, image 1 = grisé, 2 = normal, 3 = enfoncé) l'indique. **Sûr.**
- Clic sur « go » (`1170:08f5` code 2), accepté **une seule fois** (`DS:9d74` passe à 1) :
  1. `1170:2d65` : tout Zoombini posé sur un emplacement `0x1fc` reçoit `+0x127 = 1` (sauvé) ;
  2. `1150:2c72` : recalcule les masques (efface les connecteurs vers les pierres montées) et rafraîchit toutes les pierres basses ;
  3. toute case à l'état `0x1f6`, `0x1fc` ou pierre de départ (`DS:9d5e`) reçoit le script `SCRB` 7002 (montée de la pierre) avec le filtre `1170:250c` ; la **première** rend la main par `DS:9d66` (suivi de fin d'animation) ; pour chaque `0x1fc`, le Zoombini joue `SCRS` 13000 ;
  4. son `\0SND` 7000 ; `DS:9c72 ← 1` (clics ignorés) ; les Zoombinis non reliés sont marqués (drapeaux `|= 0x4008000`) et ne participent plus à la traversée.
- **Un Zoombini est sauvé si et seulement s'il est sur un emplacement `0x1fc` au moment de « go »** (flag `+0x127`). À la sortie, `1168:36e1` (moteur, [../screens.md](../screens.md) §3.4) range les membres : ceux avec `+0x127 ≠ 0` sont marqués vivants (octet 8 de la fiche), les autres perdus. **Sûr** pour le flux, **probable** pour la lecture de `36e1` (décompilation partielle).
- Pas de seuil de réussite : aucun nombre de Zoombinis minimal, aucune notion d'« erreur ». L'épreuve est « parfaite » si tous les `n` Zoombinis sont `0x1fc` ; dans ce cas `1150:2f9e` (nombre de `0x1fc` ≥ `n`) joue une voix (`\0SND` de `ZOOMBINI.MHK` tirée dans `20055…20063`) et lève `DS:9d8a` (célébration, §4.3). **Sûr.**
- Une fois la dernière épreuve de l'étape terminée **sans perte** et hors entraînement, le moteur ajoute un monument et augmente le niveau de l'étape (hors périmètre de l'épreuve, [../screens.md](../screens.md) §3.4).

## 3. Les 4 niveaux

Le niveau est `DS:9b66 = 1168:515d()` (0 à 3) : en aventure `S+0xC2 + 2 × (étape - 1)` avec l'étape 2 (soit `S+0xC4`), en entraînement `[96f2] - 1` ([../screens.md](../screens.md) §1.6). Le générateur est `1150:0000`, précédé de `1170:33ce` (copie des attributs des membres) et, pour les niveaux 0 à 2, de `DS:9d5e = 0x1f8`, `DS:9d60 = 0x30`. Au **niveau 3 seulement**, `DS:9d5e = 0x1f8 + rand(0, 1)` (variante visuelle des pierres de départ, `0x1f9` donne `DS:9d60 = 0x18` ; sûr, rôle de `9d60` non élucidé).

Dans tous les cas : le nombre d'emplacements égale `n` pour les niveaux 0 et 1 (un emplacement par Zoombini) ; il est de 18 (niveau 2) ou 26 (niveau 3) cases, dont seules `n` sont conservées. **Sûr** (niveaux 0 et 1), **probable** (niveaux 2 et 3).

### 3.1 Niveau 0 : paires (`1170:2dfb` puis `1150:0000` cas 0)

Génération des **unités** (`1170:2dfb`) : on tire `r = rand(0..3)`, puis pour chaque Zoombini `i` non apparié on cherche, parmi les `j > i` non appariés, celui qui partage la valeur de l'attribut `r` (en essayant les 4 attributs dans l'ordre cyclique à partir de `r`) ; on enregistre le code `0x1fe + attribut` et on marque les deux. Un Zoombini sans partenaire devient un **singleton** (code `0x1f5`). La passe est répétée (jusqu'à 10 tentatives, avec échanges d'attributs entre singletons) pour limiter les singletons ; `n` impair accepte 1 singleton. Le nombre d'unités `u` = paires + singletons.

Chaque unité occupe **une rangée** : [pierre de départ] [emplacement A] [liaison à symbole] [emplacement B] (paire), ou [pierre de départ] [emplacement] (singleton). Pour les rangées dont la case de départ est impaire et `u ≥ 8`, le départ est étendu à 4 cases de pierre. Rangée de départ et pas (tables `DS:1d78` et `DS:1d94`, indexées par `u`) :

| `u` | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|
| case de départ | 54 | 45 | 36 | 27 | 18 | 9 | 0 | 18 | 18 | 9 | 9 | 0 | 0 |
| pas entre unités | 0 | 18 | 18 | 18 | 18 | 18 | 18 | 9 | 9 | 9 | 9 | 9 | 9 |

(18 = une rangée sur deux, 9 = toutes les rangées consécutives ; au-delà de `u = 13` la table sort de ses bornes : cas non atteint en pratique car le groupe fait au plus 16 membres et l'appariement échoue très rarement.) **Sûr** (code et tables).

Règle du joueur : placer deux Zoombinis de part et d'autre d'un symbole qui partagent l'attribut du symbole ; les singletons se placent n'importe où à côté du départ.

### 3.2 Niveau 1 : chaînes de 3 (`1170:312b` puis `1150:0000` cas 1)

Nombre de chaînes `u = ⌈n / 3⌉` (6 pour 16). Chaque chaîne occupe une rangée : [départ] [emplacement 1] [liaison a] [emplacement 2] [liaison b] [emplacement 3]. Les codes `a`, `b` sont tirés par `1170:32bb` (un Zoombini non utilisé qui partage une valeur d'attribut tirée au hasard avec le précédent ; l'attribut de départ de la recherche est `rand(0..3)`) ; **si personne ne convient, la liaison est « libre »** (code 0 : elle monte dès que l'emplacement précédent est relié). Les tables de rangée de départ et de pas sont les mêmes que pour le niveau 0 (pour 16 : départ 9, pas 18, rangées impaires 1 à 11). Dernière chaîne tronquée si `n` n'est pas multiple de 3. **Sûr.**

### 3.3 Niveau 2 : réseau en échelle

Cases du plateau (tables de `DS`, relues dans le NE) ; `D` = pierre de départ, `S` = emplacement, `L` = liaison :

```
r01  .  L  S  L  S  L  .  .  .
r02  D  S  .  .  .  .  S  .  .
r03  .  L  S  L  S  L  .  .  .
r05  .  L  S  L  S  L  .  .  .
r06  D  S  .  .  .  .  S  .  .
r07, r09, r11 : comme r01
r10  D  S  .  .  .  .  S  .  .   (r04, r08, r12 vides)
```

- 3 pierres de départ (`DS:1df8` = 18, 54, 90), 18 liaisons (`DS:1db0`) et 18 emplacements (`DS:1dd4` : `11 29 47 65 83 101` colonne 2, `13 31 49 67 85 103` colonne 4, `24 60 96` colonne 6, `19 55 91` colonne 1). Les emplacements des colonnes 1 sont les **entrées**, ceux de la colonne 6 les **sorties** (`DS:1dfe`). Les rails horizontaux (rangées 1, 3, 5, 7, 9, 11) ont la forme L-S-L-S-L ; les entrées et sorties sont reliées en diagonale aux rails voisins. **Probable** (liens diagonaux déduits des masques posés par `1150:0000`, cas 2).
- La solution est construite d'abord (`1170:34cf` classe les membres par nombre de partenaires potentiels ; trois appels à `1170:47af` posent les membres les plus connectés sur les emplacements, puis `1170:3896` écrit les symboles : pour chaque liaison entre deux emplacements occupés, un attribut commun tiré selon un ordre pondéré (`rand(1000)` : < 250, < 500, < 750, ≥ 750 donnent 4 ordres de priorité des attributs). Si `n` est inférieur à 18, les emplacements en surplus sont transformés en pierres basses sans symbole. Tous les Zoombinis sont ensuite retirés des emplacements pour être replacés par le joueur ; `DS:9c7a` = nombre d'emplacements conservés. **Probable.**

### 3.4 Niveau 3 : réseau en nid d'abeilles

Plateau (43 liaisons `L`, 26 emplacements `S`, départ `D` en case 54, tables des segments `1490` et `1488`) :

```
r00  .  .  S  .  S  .  S  .  .
r01  .  L  L  L  L  L  L  .  .
r02  .  S  .  S  .  S  .  S  .
r03  .  L  L  L  L  L  L  L  .
r04  .  .  S  .  S  .  S  .  S
r05  .  L  L  L  L  L  L  L  .
r06  D  S  L  S  L  S  L  S  .
r07  .  L  L  L  L  L  L  L  .
r08  .  .  S  .  S  .  S  .  S
r09  .  L  L  L  L  L  L  L  .
r10  .  S  .  S  .  S  .  S  .
r11  .  L  L  L  L  L  L  .  .
r12  .  .  S  .  S  .  S  .  .
```

- Une seule entrée : l'emplacement 55 (rangée 6, colonne 1), relié à la pierre de départ 54. Les emplacements se touchent par des liaisons (masques `0x24`, `9`, etc. posés par `1150:0000`, cas 3).
- Pour `n ≥ 6`, `1150:1a03` génère la solution en construisant une arborescence à partir de l'entrée (`1150:1c62` pose un membre puis explore ses voisins, `1150:2222` pose un partenaire qui partage un attribut tiré dans l'ordre `rand(0..2)` cyclique, `1150:1b3e` teste si deux membres partagent un attribut et mémorise l'attribut dans `DS:9d62`), jusqu'à ce que tous les membres soient posés (`1150:1f2e` : au moins un membre non posé). Ensuite `1150:1f55` supprime les cases d'emplacement non utilisées et les groupes de cases inutiles (appels à `1150:2449` / `1150:2b23`), `1150:316c` raccourcit les 13 sous-structures symétriques si besoin, puis les Zoombinis posés dans la solution (`DS:92c0` / `92c2` : 26 couples case / membre) sont **retirés** du plateau pour être reposés par le joueur. La solution est conservée dans ce tableau (utilisée par le code triche, §4.5). **Probable.**
- Pour `n < 6` : plateau réduit à une chaîne droite sur la rangée 6 (cases 55, 57, 59, 61, 63 ; liaisons 56, 58, 60, 62) avec tirage direct des symboles (`1150:1b3e`). Pour `n < 3` : dégénéré (1 ou 2 emplacements, case 55 et 57). **Probable.**

Effet particulier (niveau 3, `1170:3aa3`) : si les cases 57, 59, 61 sont toutes reliées et que le nombre d'emplacements occupés vaut exactement 4, `DS:9c6e ← 1` et un **cycle de palette** décoratif tourne (`1170:2312` toutes les 7 ticks, `1150:2b6f`). **Hypothèse** pour l'intention (effet de victoire pour un groupe de 4).

### 3.5 Tableau comparatif

| Niveau | Structure | Emplacements | Entrées | Départs | Liaisons libres |
|---:|---|---:|---:|---:|---|
| 0 | une paire (ou un seul) par rangée | `n` | 1 par rangée | 1 par rangée | non |
| 1 | une chaîne de 3 par rangée | `n` | 1 par rangée | 1 par rangée | oui (si pas de partenaire) |
| 2 | échelle à 6 rails, 3 entrées, 3 sorties | 18 (dont `n` conservés) | 3 | 3 | oui |
| 3 | nid d'abeilles, 1 entrée | 26 (dont `n` conservés) | 1 | 1 | oui |

## 4. Déroulé et état

### 4.1 Enter (`1170:0000`)

Ordre (sûr pour la liste, **probable** pour le détail des paramètres) :

1. met à 0 `DS:9704`, `9702`, `9c7c`, `9c7a`, `8556`, `9b64`, `9b62`, `9c72`, `9c70`, `9c66`, `9d70`, `9c6e`, `9d8c`, `9d8a`, `9d72 ← 0xffff` ;
2. ouvre `Slides.MHK` (`11b8:0fa2`, archive courante `11b8:0011`) ; alloue et remet à zéro les tableaux (`11c8:6a5c` : 117 cases × 18 octets, masques de 234 octets, etc.) ; met l'état de toutes les cases à `500` ;
3. `DS:9b66 ← 1168:515d()` ; au niveau 3 seulement, `1168:2a5c()` charge `NODE` / `PATH` 1000 ;
4. `11a8:1783()` terrain 100 ; `11a8:1475()` fond `SHPL` + `tBMP` 5000 ; `11a8:2ae6` planche des boutons 6000 ; groupes 0 (7000) et 1 (8000) ; 14 `SCRB` 7000…7013 et 3 `SCRB` 8000…8002 ; `SCRS` 14000…14003 (rejets) et 13000…13005 (normaux) ;
5. `11a8:0ad6` objet de logique d'écran (callbacks `1170:0478` « boutons » et `1170:045a`) ; `11a8:0ed9(1, 0xbba, 0x14e8, 16)` : enregistre les 16 positions d'attente (premier groupe) ;
6. `1058:048a(0xec, 10)` : sauve la palette ; `1168:0858`, `1168:2505` (voir [../engine.md](../engine.md) / [../screens.md](../screens.md) : mise en place du groupe) ; `1168:365d` : pointeur du groupe → `DS:9b5e`, `n = *9b5e` → `DS:9c80` et `DS:9d86` ;
7. **`1150:0000()`** : génère le plateau selon le niveau ; l'ordre de profondeur des décors `SCRB` 7003…7008 est fixé par `11a8:2a0a` par rapport aux rangées 1, 3, 5, 7, 9, 11 (cases 9, 27, 45, 63, 81, 99) ;
8. pour chaque emplacement `k = 1…9c7a` : une feature `SCRB` 7013 (anneau, 11 images, §5) à la position `S14:01d4 + 4 k`, callback `1170:23a2` (flags `0x188a000`) ;
9. `1170:03ad(0, 0, 1)` et `(0, 0, 2)` : dessine les boutons ; `1038:0000(0xc000, 1, 0x24ba)` : déclare les régions ; `11a8:313a` précharge les sons (`7001`, `7000`, `20000…29999`, `8000`, `8500…8599`, `425…499`, `7002`) ; `11a0:0ee7(0, 997)` : son d'entrée ; `DS:9b62 ← 1` ; `1168:5c57(S+0x36)` (compteur de dialogue de l'épreuve) ; `DS:a2c4 ← 0x4e6e` (voix d'introduction `20078`).

### 4.2 Interactions

- **Souris** : zones cliquables de `1038:0000` (table `DS:24ba`) :
  - bouton **retour** `(600, 403)–(639, 440)` (code 1) ;
  - bouton **go** `(600, 441)–(639, 478)` (code 2) ;
  - tout clic hors bouton arrive avec le code 3 (**probable** : zone implicite de l'écran) : saisie d'un Zoombini, cf. §2.2.
  Les images des boutons sont dans la planche 6000 : image 5 = retour normal, 6 = retour enfoncé, 1 = go grisé, 2 = go normal, 3 = go enfoncé. Enfoncement : `1170:03ad(1, 1, b)`, attente de 2 ticks (`1090:00c1(1, 0, 2, 0, 0)`), relâchement `1170:03ad(1, 0, b)`. **Sûr.** Sons communs de bouton : `\0SND` de `ZOOMBINI.MHK` 999 (retour).
- **Clavier** (`1170:1740`) : aucune touche en jeu normal. En mode de débogage (`DS:a43f ≠ 0`), la saisie de `s`, `o`, `v`, `l`, `e` dans cet ordre (« solve ») résout le niveau 3 en replaçant les membres de la solution ; la touche de code `0x16f` appelle `11a0:155e` sans mode de débogage (rôle non étudié). Les raccourcis généraux (`Ctrl+Q`, etc.) sont traités avant ([../engine.md](../engine.md) §7.2). **Sûr** pour la séquence, **hypothèse** pour la touche `0x16f`.
- **Glisser-déposer** : voir §2.2.

### 4.3 Tick (`1170:0532`)

Gardé par `DS:24e6` (non réentrant) et `DS:9b62 ≠ 0`. À chaque tour :

1. `11a8:04b9()` : avance toutes les animations.
2. **Sortie demandée** (`DS:8556 ≠ 0`) : si le son 996 est encore en lecture (`1028:0d9e(0x4e44, 0x53, 996)`), on attend ; sinon, si aucun dialogue bloquant (`DS:a2de` ∈ {0, 3}) et (`a406 ≠ 0` ou voix terminées `9702 = 0` ou `9704 > 0`) : `DS:8554 ← 8556`, `8556 ← 0`, `11b8:0011(0, 0)`, **Exit** `1170:04db`.
3. **Palette** : si `DS:9c6e ≠ 0` et > 6 ticks depuis `9d7e` : `1170:2312` (cycle) ; réarme.
4. **Fin de l'animation de montée** (`DS:9d66 ≠ 0` et la feature a fini, `*(9d66 × 2 + 0x6da) = 0`) :
   - son `\0SND` 7001 ; `11a8:04b9` ; attente bloquante de 60 ticks (`1090:00c1(1, 0, 0x3c, 0, 0)`) ; son 996 ; `9d66 ← 0` ;
   - niveau 3 : `1168:3dd0` ; marque les occupants des cases 55 (relié), 38 (relié avec 46 monté) et 74 (relié avec 64 monté) comme sauvés ; `1168:2982(45, 0, 200, 800)` fait **partir un à un** les Zoombinis sauvés, toutes les 45 ticks (marche de `1168:4231`) ; `1170:2d65` ;
   - niveau 2 : même chose pour les cases 19, 55, 91 ;
   - niveaux 0 et 1 : `1168:2982(45, 0, 240, 1280)` ;
   - `DS:8556 ← 5` : **suite = écran 5** (camp de base 2, BCTWO), avec la transition 12 → 5 (trajet n° 8, [../engine.md](../engine.md) §2.4). **Sûr** pour la suite, les valeurs 200/800 et 240/1280 des deux derniers paramètres de `2982` sont **non élucidées**.
5. **Célébration** (tout le groupe relié : `DS:9d8a ≠ 0`, `9d88 < 9d86`) : toutes les 30 ticks (> `0x1e`), un membre tiré au hasard (`1098:0098`), actif et non occupé, joue le `SCRS` `13000 + attribut 3` (donc 13001 à 13005 selon la valeur de l'attribut 3 du Zoombini) avec `1168:3f76` ; compteur `DS:9d88` ; quand `9d88 ≥ 9d86` (chacun a dansé) : remise à zéro. Retirer un Zoombini (`1150:2ff4`) arrête la célébration. **Probable** (le tirage ne vérifie pas qu'un même membre ne danse pas deux fois : jusqu'à 20 essais).
6. `1108:035b()` : fin de tour de l'écran (moteur).

### 4.4 Exit (`1170:04db`)

Si `DS:9b62 ≠ 0` : `9b62 ← 0` ; `11b8:00e8(1)` ; `11a8:021c` (libère les features, déclenche `1168:36e1`) ; `1028:0e53` (arrête les sons) ; libère la planche 6000 (`11b8:0a51`) ; `11b8:00e8` ; ferme `Slides.MHK` (`11b8:1076`) ; `11a8:3065` ; `1198:014f`. **Sûr.**

### 4.5 Variables de l'écran (noms inventés)

| DS | Nom | Rôle |
|---|---|---|
| `9b5a` | archive | poignée de `Slides.MHK` |
| `9b5e` | groupe | pointeur du groupe courant (`1168:365d`) |
| `9b62` | actif | écran ouvert (garde Enter / Exit / Tick) |
| `9b64` | goActif | bouton « go » actif |
| `9b66` | niveau | 0 à 3 |
| `9b6a…9b78` | décors | features `SCRB` 7003…7010 (profondeur) |
| `9c66`, `9c68` | rejet | feature d'animation 8000 + k, pierre visée |
| `9c6a` | zoombini | id du Zoombini en cours de dépôt |
| `9c6c`, `9c70` | rejet | événement en attente, animation de rejet en cours |
| `9c72` | goFait | « go » cliqué (clics ignorés) |
| `9c74`, `9c76`, `9c78` | compte | nombre de pierres montées avant / somme des indices avant / après |
| `9c7a` | nbEmpl | nombre d'emplacements |
| `9c7c` | dernierEmpl | rang de l'emplacement du dernier dépôt (1…`9c7a`), 0 hors plateau |
| `9c7e` | triche | avancement de la séquence « solve » |
| `9c80`, `9d86` | n | nombre de membres |
| `9c86` | nbDeparts | nombre de pierres de départ (liste à `9c88…`, +0x14 si `9d5e = 0x1f9`) |
| `9c9c` | ordre | rangs des membres triés par nombre de partenaires potentiels (`-1` = déjà posé) |
| `9cbc`, `9cbe` | unités | nombre d'unités ; liste de codes (16 mots) |
| `9cde`, `9cfe`, `9d1e` | attributs | attributs 1, 2, 3 des membres (attribut 0 : `S14:0b9a`) |
| `9d3e` | utilisés | membres déjà appariés (générateur) |
| `9d5e`, `9d60` | départ | type de pierre de départ (`0x1f8` / `0x1f9`), constante `0x30` / `0x18` |
| `9d62` | attribut | dernier attribut commun tiré |
| `9d64` | feature | première pierre de départ (profondeur) |
| `9d66` | suivi | feature dont la fin d'animation déclenche la sortie |
| `9d68…9d6e` | diversité | pour chaque attribut, nombre de valeurs distinctes dans le groupe (`1170:1fc5`) ; **non utilisé** par le code lu (**hypothèse** : reste d'une version antérieure) |
| `9d72` | drapeaux | drapeaux sauvegardés d'une feature (restaurés au clic suivant) |
| `9d74` | goClique | « go » déjà cliqué |
| `9d76`, `9d7e` | minuteurs | célébration (ticks), palette (ticks) |
| `9d88`, `9d8a`, `9d8c` | célébration | compteur, drapeau « tous reliés », garde |
| `24e2`, `24e4`, `24e6` | boutons | état de redessin du bouton go, des boutons, garde du Tick |

## 5. Animations et sons

### 5.1 `SCRB`

Format : [../engine.md](../engine.md) §3.2. Délai entre images : **6 ticks** (102 ms) pour toutes les features de l'écran (paramètre de `11a8:0ad6`). Images de `tBMP` 7000 (groupe 0) sauf mention.

| `SCRB` | Images | Rôle | Confiance |
|---|---:|---|---|
| 7000 | 2 | **pierre** : image 0 = composition de toutes les parties (base 98, 109, 110, 103, symboles 73 à 76, connecteurs 4, 8, 24…) ; image 1 vide. Le callback `1170:20cc` retire les parties selon l'état de la case (§5.2). Rejouée par `11a8:1be6(1, 7000, feature)` à chaque changement d'état | sûr |
| 7001 | 1 | pierre nue (image 97) | probable |
| 7002 | 7 | **montée** de la pierre : images 2 à 6 translatées de `y = 134, 125, 110, 95, 79` (la pierre s'élève de 55 pixels) ; callback `1170:250c` ; jouée sur les cases `0x1f6` / `0x1fc` / départ lors de « go » | sûr |
| 7003 à 7010 | 1 | décors fixes (3 à 8 : avant-plan du bord droit, y de 96 à 278 ; 7010 : bord gauche `(129, 294)`) ; 7003 et 7012 identiques `(504, 96)` | sûr |
| 7011 | 1 | décor `(0, 203)` | sûr |
| 7013 | 11 | **anneau d'emplacement** : 6 connecteurs (4, 8, 12, 16, 20, 24) et un disque central ; image 0 (disque 100), 2 (disque 101, **son 7002** à cette image), 4 à 10 (disques 102 à 108) : ondulation en 11 images ; filtre `1170:23a2` (connecteurs affichés selon le masque) | sûr (structure) |
| 8000, 8001, 8002 | 10 | **rejet** pour les rangées 9 à 12, 4 à 8, 0 à 3 (`4ddd` choisit 0 si la case est > 88, 1 si ≥ 36, sinon 2) : sprite de 8 images de `tBMP` 8000 déplacé le long d'une trajectoire à l'extrême droite ; **son 8000** à l'image 1 ; événements aux images 2 (n° 90, 91 ou 92) et 9 (n° 93) | probable |

Événements (octet bas du terminateur − 1, callback `1170:4bb8`) : `0x5a`, `0x5b`, `0x5c` (images 2 de 8000, 8001, 8002) lancent le `SCRS` 14000, 14001 ou 14002 sur le Zoombini rejeté (`1168:3f76`) ; `0x5d` (image 9) lance le `SCRS` 14003 (vol de 24 images, point de départ aléatoire `x = 70 + rand(0..42)`, `y = 152 + rand(0..200)`) et remet `DS:9c70 ← 0`. Les événements `0xf0…0xf3` et `0xfa…0xfd` pilotent des poses de Zoombini (`1168:4dc9`). **Probable** (le sens « rejet » vient du nom des scripts `SCRS` 14000+ et de la remise à zéro de `9c70`).

### 5.2 Filtre des pierres (`1170:20cc`, table `1170:22ea`)

Chaque pièce (« partie ») d'une image de pierre porte un numéro `w` d'image de `tBMP` 7000 ; le callback retire la pièce si la condition de présence n'est pas remplie. Valeurs de `w` : **sûres** (table relue) ; sens des pièces : **probable**.

| `w` | Pièce | Gardée si |
|---:|---|---|
| 4 | connecteur 0 | bit 0 du masque de la case posé |
| 8 | connecteur 1 | bit 1 posé |
| 0x18 | connecteur 5 | bit 5 posé |
| 0x49, 0x4a, 0x4b, 0x4c | symbole d'attribut 0, 1, 2, 3 | `+4 = 0x1fe, 0x1ff, 0x200, 0x201` |
| 0x67 | pierre de départ `0x1f8`, état haut | état ∈ {`0x1f6`, `0x1f8`, `0x1fc`} et `9d5e ≠ 0x1f9` |
| 0x6d | pierre de départ `0x1f9`, état haut | état ∈ {`0x1f6`, `0x1f9`, `0x1fc`} et `9d5e = 0x1f9` |
| 0x6e | pierre « emplacement » | état = `0x1fa` |

`1170:23a2` (anneau) applique le même principe aux 6 connecteurs (`4, 8, 0xc, 0x10, 0x14, 0x18` contre les bits 0 à 5) en décalant les pièces de `-0x16` en x et `+6` en y ; `1170:250c` (montée) filtre les pièces `0x67`/`0x6d` etc. selon le même principe (table `1170:26a0`, 5 entrées).

### 5.3 Sons

`\0SND` (11 025 Hz, 8 bits, [../engine.md](../engine.md) §6.1). Dans `SLIDES.MHK` (id ≥ 1000, archive de l'écran) :

| Id | Déclencheur | Rôle | Confiance |
|---:|---|---|---|
| 7000 | `1170:08f5`, clic « go » (`11a0:0ee7(0, 7000)`) | grondement de la montée des pierres | probable |
| 7001 | `1170:0532`, fin de l'animation de montée | son d'arrivée | probable |
| 7002 | image 2 de `SCRB` 7013 | ondulation de l'anneau d'emplacement | sûr |
| 8000 | image 1 de `SCRB` 8000 à 8002 | début de la séquence de rejet | sûr |
| 8500 | `1170:4f98`, le nombre de pierres montées **baisse** de 1 à 4 | retour d'information | sûr |
| 8501 | idem, baisse de 5 ou plus | | sûr |
| 8502 | idem, même nombre de pierres montées mais somme des indices différente (le Zoombini a changé de place sans effet) | | probable |
| 8503 | non trouvé | jamais joué dans le code lu | hypothèse |
| 8504 | le nombre de pierres montées **augmente** de 1 à 4 | | sûr |
| 8505 | idem, augmente de 5 ou plus | | sûr |

Avant de rejouer 8500/8501/8504/8505, `1170:4f98` arrête le même son s'il est déjà en cours (`1028:0c0a`) pour éviter l'empilement (seulement si les voix et effets sont activés, `DS:a43a`). **Sûr.**

Sons communs (`ZOOMBINI.MHK`) : 997 à l'entrée (`0ee7(0, 997)`, **hypothèse** : ambiance) ; 996 à la fin de la montée et attendu à la sortie ; 999 sur le bouton retour ; voix `20078` (`DS:a2c4`, introduction) et `20055…20063` (tirée par `1150:2f9e` quand tout le groupe est relié). Voix de Zoombini des `SCRS` : terminateurs `0xffc9…0xffd9` / `212` / `214` des scripts 13001-13005 et 14003, traduits par `11a8:32b2` + `1168:575b` ([../engine.md](../engine.md) §3.7).

### 5.4 `SCRS`

| `SCRS` | Images | Rôle | Confiance |
|---|---:|---|---|
| 13000 | 7 | un Zoombini s'élance sur sa pierre à la montée (pose depuis `(332, 147)`) | probable |
| 13001 à 13005 | 12 à 18 | **danses** de célébration (joue `13000 + attribut 3`) | probable |
| 14000, 14001, 14002 | 2 | rejet, trois hauteurs `(547, 207)`, `(526, 117)`, `(481, 79)` | probable |
| 14003 | 24 | vol d'un Zoombini rejeté depuis la zone de départ aléatoire | probable |

Les `SCRS` ont tous la pose 0 sauf 14000-14003 (pose 2) ; sens de la pose : point ouvert du moteur.

## 6. Écriture dans le tampon de partie (`S`)

L'épreuve elle-même n'écrit que :

- `S+0x36` : le compteur de dialogue de l'épreuve (mot de 16 bits modifié par `1168:5c57(S+0x36)` à l'entrée, comme `S+0x32` pour le bac (`10d8:0071`)). Son contenu : compteur de visites dans les 12 bits bas et drapeaux d'introduction par niveau dans les bits 12 et 13 (**hypothèse** : lu dans `1168:5c57`, décompilation incomplète) ;
- le groupe : `+0x127` des features (sauvé) lu à la sortie par `1168:36e1`.

Le reste est écrit par le **moteur** à la sortie ([../engine.md](../engine.md) §2.2, [../screens.md](../screens.md) §3.4) :

- `S + 0x56 + (écran - 7)` = `S + 0x5B` (épreuve 12) reçoit le bit `1 << niveau` (réussite) ; le bit `0x10 << niveau` s'il n'y a aucun Zoombini perdu ;
- épreuve **dernière de l'étape 2** : `1108:0000` pose `1 << (niveau & 3)` dans `S + 0x52` (bits 0 à 3, étape 2 terminée), sauf en entraînement ; si aucun Zoombini n'est perdu et que l'étape a été faite d'une traite (`S+0x54 ≠ 0`), `1168:36e1` ajoute un monument (étape 2, niveau + 1) et augmente le niveau de l'étape ;
- Zoombinis perdus (les `n - sauvés`) : renvoyés à la réserve du camp 1 (`S - 0x5B9E`, `S+0x4A += perdus`) ; survivants : groupe de l'écran suivant ;
- `S+0xCA ← 12` (écran courant), `S+0xCC ← 5` (reprise de partie au camp 2).

## 7. Points ouverts

1. **Liste des cibles de dépôt** (`1520:0000`, rectangles à `1520:0x00fc + 4 k`, propriétaire à `1520:0x2f0`) : le remplissage par l'épreuve (positions d'emplacement `S14:01d4 + 4 k`) et la tolérance `DS:9706` n'ont pas été tracés.
2. **Niveaux 2 et 3** : le détail de la génération (`1150:1a03` à `1150:329c`, `1170:47af`, `1170:3896`) et des cas particuliers (`n < 6`, `n < 3`, effet `DS:9c6e`) est résumé, pas exhaustif ; un portage doit pouvoir **générer** un plateau valide avec les règles de §3 (tables de cases ci-dessus) sans reproduire l'ordre exact des tirages. Les masques exacts posés par `1150:0000` (diagonales de l'échelle et du nid d'abeilles) n'ont pas été relevés un par un.
3. **Attributs** : l'ordre des 4 octets (cheveux, yeux, nez, pieds) et les noms des valeurs ne sont pas établis ([../screens.md](../screens.md) §2.1) ; la règle (égalité d'octet `+0xec + a`) suffit pour l'implémentation.
4. **Animation de rejet** : le rôle exact de `SCRB` 8000-8002, des `SCRS` 14000-14003 et des événements `0xf0…0xfd` est déduit ; vérifier visuellement (rendu des `tBMP` 8000) si la mécanique est conservée.
5. **Son 8502 / 8503**, son 7000 (premier appel `0ee7`) et rôles de 996 / 997 : à confirmer à l'écoute.
6. **Paramètres de `1168:2982`** (45, 0, 200/240, 800/1280) et condition de sortie (`DS:9702`, `9704`) : le délai de 45 ticks entre départs est sûr, le reste non.
7. **Touche `0x16f`** (`11a0:155e`) et `DS:9d68…9d6e` (diversité des attributs) : non utilisés dans le jeu normal.
8. **Palette** (`DS:9c6e`, cycle) : effet de victoire pour un petit groupe au niveau 3 (hypothèse).
9. **Image « 24 parties »** des `SCRB` ([../engine.md](../engine.md) §9, point 3) : aucune image de `SCRB` 7000-7013 et 8000-8002 n'atteint 24 parties (au plus 11), donc sans objet ici.
10. **Reprise après perte** : si `n` baisse d'un tour à l'autre (groupe réduit par les épreuves précédentes), les cas `n < 6` du niveau 3 sont les seuls à produire des plateaux plus courts ; les niveaux 0 à 2 s'adaptent par `u` / surplus d'emplacements. Aucun cas `n = 0` (le moteur n'entre pas dans l'épreuve sans groupe).
