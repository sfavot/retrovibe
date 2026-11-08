# Les grottes de passe-clos (`TUNNELS.MHK`, écran 8) : étude de rétro-ingénierie

Tâche T6. Deuxième épreuve de l'étape 1 de L'Odyssée des Zoombinis (`ZOOMBINI.EXE` 1.0FR). Même cadre que [bridge.md](bridge.md) (lire d'abord son §2.1 pour les attributs, ses conventions de confiance et la structure Enter / Tick / régions) ; moteur dans [../engine.md](../engine.md), parcours et sortie dans [../screens.md](../screens.md).

Confiance : **sûr** = lu dans le code ; **probable** = déduit de plusieurs indices ; **hypothèse** = non vérifié.

## 0. Résumé

- Un embranchement de grotte avec **quatre entrées** en bas de l'écran (deux à gauche, deux à droite). Le joueur glisse chaque Zoombini sur **l'une des quatre entrées** ; selon la règle cachée, une seule entrée est la bonne pour ce Zoombini. Bonne entrée : le Zoombini traverse la grotte et arrive à la sortie de ce tunnel. Mauvaise : il est renvoyé en arrière et le **budget d'erreurs** diminue.
- La règle est tirée à l'entrée de l'écran : **une règle** (niveau 0, sépare gauche / droite) ou **deux règles** (niveaux 1 à 3, premier embranchement gauche / droite, second haut / bas, d'où les quatre entrées). Chaque règle accepte un ensemble de traits (OU) ; ce qu'elle n'accepte pas va de l'autre côté (sûr).
- Budget d'erreurs : **16, 18, 20, 22** selon le niveau 0 à 3 (`DS:a0d2`) ; à 0 les tunnels s'effondrent (sûr pour le compteur, **probable** pour l'interprétation).
- Les Zoombinis qui n'ont pas atteint la fin d'un tunnel quand le joueur quitte l'écran sont perdus (même logique que les gorges).

## 1. Identification

| Élément | Valeur |
|---|---|
| Écran | 8, descripteur `1530:3b7a` |
| Archive | `TUNNELS.MHK` (chaîne `1530:3c7d`) |
| Enter | `1190:0107` ; réinitialisation `1190:0000` |
| Exit | `1190:06a2` (→ `11a8:021c` → `1168:36e1(0, 1)`, comme `10c0:058d`) |
| Tick | `1190:06ff` |
| Key | `1190:1199` (touche d'aide `0x16f` et touches du mode de test, §4.5) |
| Clic de région | `1190:0be9(id)` (table `DS:3b6e` ; `1038:0000(0xc000, 1, 0x3b6e)`) |
| Règle, niveau 0 / 1 / 2 / 3 | `1190:2748` / `2af8` / `2d12` / `381c` ; choix de deux règles : `1190:3a48` |
| Test d'acceptation | `1190:2588` |
| Callbacks d'événements des Zoombinis (`+0x10`) | `1190:1673` (table `CS:1acf`), `1190:1575`, `1190:15a2`, `1190:15cd`, `1190:1639` |
| Dépile de la file | `1190:1e34`, `1190:201d`, `1190:205e`, `1190:2088` |
| Voix du narrateur | `1190:2137(0…3)` |
| Renvoi des Zoombinis en bas (effondrement) | `1190:14bc` (libère les 4 entrées, ramène les occupants à y = 460) ; `1190:41e4` (non lu) |

Ressources (vérifiées) : `tBMP` 100 (« Terrain » 160 × 120), 300 (fond 640 × 480 ; palette `SHPL` 300), 400 (6 boutons ; `DS:3b92/3b94`), 4000, 4200, 4400, 4600, 5000, 6000, 7000, 9000 (planches) ; `NODE` / `PATH` 1000 (chargés par `1168:2a5c`, 2 chemins ; non exploités par cette épreuve, la marche se fait par scripts) ; `SCRB` 4000–4038, 4200–4226, 4400–4423, 4600–4617 (voix des gardiens), 5000–5003 (entrées), 6000–6011, 7000–7004, 9000–9006 ; `SCRS` 8000–8007 et 8500–8564 ; `\0SND` 4000–4038, 4200–4227, 4400–4427, 4600–4618, 4700–4703, 6000, 7000, 8500–8508. Groupes de formes (`11a0:0000` / `11a8:14ab` / `11a8:15a6`) : 0 = 5000 (4 `SCRB`), 1 = 6000 (12), 2 = 7000 (5), 3 = 9000 (7), 4 = 4000 (39), 5 = 4200 (27), 6 = 4400 (24), 7 = 4600 (18). `1168:03ef(8, 8, 8000)` : `SCRS` 8000–8007 (« REJECT ») ; `1168:04d0(5, 65, 8500)` : `SCRS` 8500–8564 (« NORMAL »). Palette sauvée `1058:048a(236, 10)`.

Décor (`SCRB`, première image, sûr) : 9000–9006 = sept pans de rocher en avant-plan fixes ; 6000–6003 = quatre piliers fixes, 6004–6011 = animations de choc des piliers (son 6000) ; 5000–5003 = les **quatre zones d'entrée** (positions (68, 426), (146, 416), (421, 422), (506, 432)) ; 7000–7004 = plafond qui s'effondre (`7000` : 61 images, son 7000) et chutes de pierres (`7001`–`7004`). Les quatre jeux 4000/4200/4400/4600 sont les **voix des quatre gardiens** (crapauds de pierre) : chaque `SCRB` est une réplique avec son `\0SND` (4000–4038, 4200–4227, 4400–4427, 4600–4618).

## 2. Règle

### 2.1 Structure des règles en mémoire (`DS:a02a…`, 28 octets remis à 0 par `1190:0000`)

| Adresse | Contenu |
|---|---|
| `a02a` mot | **nombre de règles** : 1 (niveau 0) ou 2 (niveaux 1 à 3) |
| `a02c` mot | **w₀** de la règle 0 : 1 = « la gauche accepte la règle » (voir §2.3) |
| `a02e` octet | nombre de conditions de la règle 0 (1 ou 2) |
| `a02f…a033` | numéros d'attribut (1 à 4) des conditions |
| `a034…a038` | valeurs (1 à 5) |
| `a039…a045` | règle 1, même disposition (w₁ en `a039`, nombre en `a03b`, attributs `a03c…`, valeurs `a041…`) |

Une règle accepte un Zoombini si **au moins une** de ses conditions « attribut[idx] = valeur » est vraie (OU).

### 2.2 Tirage selon le niveau

Tout est tiré à l'Enter (après la création du groupe et de ses 16 objets), sur les Zoombinis **présents** (`1168:365d`) :

- **Niveau 0** (`2748`) : identique au niveau 0 de [bridge.md](bridge.md) §2.2 (20 candidates « attribut a = v », effectif cible `⌊n/2⌋, +1, −1, −2…`), avec un **filtre supplémentaire** : si `DS:96ec` et `DS:96f0` non nuls (règle du pont, tirée au niveau 0, effectif unique), et s'il existe une candidate d'effectif non nul **différent** de `96f0`, toutes les candidates d'effectif égal à `96f0` sont exclues. `a02a = 1`, `a02c` = `rand(0..1)`, 1 condition. À noter : en entraînement `96ec/96f0` sont remis à 0 par `1190:0000`.
- **Niveau 1** (`2af8`) : 20 candidates « attribut = valeur » ; **deux règles** choisies par `3a48` (ci-dessous) ; chacune 1 condition, `a02c`/`a039` = `rand(0..1)` indépendants.
- **Niveau 2** (`2d12`) : 40 candidates « attribut, deux valeurs » (4 attributs × 10 paires de valeurs, comme le niveau 1 des gorges) ; 1 600 paires ordonnées ; deux règles à 2 conditions chacune (même attribut, deux valeurs).
- **Niveau 3** (`381c`) : 150 candidates « deux attributs » (comme le niveau 2 des gorges) ; 22 500 paires ordonnées (`3a48(150, 22500)`) ; deux règles à 2 conditions (deux attributs différents).

**Choix d'une paire de règles** (`1190:3a48`, `2d12` pour le niveau 2, même algorithme ; sûr). Pour chaque paire ordonnée (i, j) de candidates avec i ≠ j (la candidate i sera la règle 0, la j la règle 1), on range chaque Zoombini du groupe dans l'une des 4 classes `A ∧ B`, `A ∧ ¬B`, `¬A ∧ B`, `¬A ∧ ¬B` (A, B = satisfait la candidate i, j). Puis :

1. on garde les paires dont le **nombre de classes non vides** est maximal (4 si possible) ;
2. parmi elles, on minimise `Σ |cₖ − cₗ|` pour les 6 couples de classes (répartition la plus **équilibrée**) ;
3. tirage uniforme parmi les paires ex æquo (`10a8:04e8(k, 1)`, `k`-ième dans l'ordre i·N + j).

### 2.3 Acceptation (`1190:2588(&sortie, snoid, entrée, règles)`)

`entrée` = zone de dépôt 1 à 4 (§4.2). Soient `A` = le Zoombini satisfait la règle 0, `B` = il satisfait la règle 1 (calculé seulement s'il y a 2 règles) ; puis `A' = (w₀ ≠ 0) ? A : ¬A`, `B' = (w₁ ≠ 0) ? B : ¬B`.

| Entrée | Position | 1 règle (niveau 0) : correcte si | 2 règles : correcte si |
|---:|---|---|---|
| 1 | gauche, extérieure (x ≈ 68) | `A'` | `A' ∧ B'` |
| 2 | gauche, intérieure (x ≈ 146) | `A'` | `A' ∧ ¬B'` |
| 3 | droite, intérieure (x ≈ 421) | `¬A'` | `¬A' ∧ ¬B'` |
| 4 | droite, extérieure (x ≈ 506) | `¬A'` | `¬A' ∧ B'` |

`sortie` reçoit le résultat du **premier embranchement** seul (`A'` pour les entrées 1-2, `¬A'` pour 3-4) ; la valeur renvoyée est « **faux choix** » (vrai quand la condition ci-dessus est fausse). Exactement une entrée est correcte pour un Zoombini donné à 2 règles ; deux (une par côté) à 1 règle, puis l'exception suivante en retire une : **il n'y a qu'une seule entrée valable par Zoombini, à tous les niveaux** (H2) :

- **Niveau 0 seulement** (`1190:0be9`, `a0ce`) : `a0ce = rand(0..1)` est tiré une fois par entrée dans l'écran, en tête d'`Enter` (`1190:0000`, premier tirage). Si `a0ce = 0` seules les entrées **extérieures 1 et 4** sont valables (une entrée « correcte » 2 ou 3 est comptée **fausse**) ; si `a0ce = 1` seules les entrées **intérieures 2 et 3** (1 et 4 sont fausses). (Lecture du code, sûr ; la raison visuelle — deux tunnels bouchés au niveau 0 — reste **probable**, non vérifiée en jeu.)

Les chaînes de débogage `Left / Bottom accept:`, `Left / Top accept:`, `Right / Bottom accept:`, `Right / Top accept:`, `Right accepts:`, `Left accepts:` (dans `1190:1206…`) correspondent à ces `w` : une règle avec `w₀ ≠ 0` est « acceptée à gauche » ; avec 2 règles, `w₁ ≠ 0` = « haut ». Soit, avec nos formules : entrée 1 = gauche + haut, 2 = gauche + bas, 3 = droite + bas, 4 = droite + haut (**sûr** depuis H2 : les places d'arrivée de `1510:0040` / `0x80` / `0xc0` / `0x100` placent les tunnels des entrées 1 et 4 en haut de l'écran, y 60 à 133, et ceux des entrées 2 et 3 en bas, y 213 à 283).

### 2.4 Erreurs, fin

- Chaque **faux choix** (retour de `2588` ≠ 0 après l'exception du niveau 0) crée une entrée de file avec le drapeau « erreur » (`a104` ≠ 0) ; quand cette entrée est traitée par le Tick (§4.3), `a0d2 −= 1`.
- Budget initial `a0d2` : **16** (niveau 0), **18**, **20**, **22** (`1190:0107`).
- Voix d'avertissement (quand le budget **avant** décrément vaut 5, 4, 3, 2) : `\0SND` 4700, 4701, 4702, 4703 (`DS:a1a0 = 0x125c … 0x125f`), accompagnées d'un éboulement (`SCRB` 7001–7003 au hasard).
- À `a0d2 = 0` : `a0e0 = 1` (plus de clic), `1190:14bc` renvoie en bas les Zoombinis qui étaient dans un tunnel, voix `1190:2137(2)`, puis l'animation d'effondrement (`SCRB` 7000, événement −1 → `a0e2 = 1` par `15cd`) ; le bouton Continuer redevient actif quand `a0e2 ≠ 0`.
- Le bouton **Continuer** est actif quand `a0cc ≠ 0` (au moins un Zoombini est arrivé au bout d'un tunnel ; `a0cc` reçoit alors le nombre d'arrivés) **et** (`a0e0 = 0` ou `a0e2 ≠ 0`).
- Aucune fin automatique, même si les 16 sont passés.

## 3. Les quatre niveaux

| | Niveau 0 | Niveau 1 | Niveau 2 | Niveau 3 |
|---|---|---|---|---|
| Règles | 1 | 2 | 2 | 2 |
| Forme d'une règle | 1 attribut = 1 valeur | 1 attribut = 1 valeur | 1 attribut ∈ 2 valeurs | 2 attributs (1 valeur chacun), OU |
| Candidates | 20 | 20 → 400 paires | 40 → 1 600 paires | 150 → 22 500 paires |
| Entrées valables | 2 sur 4 (selon `a0ce`) | 4 | 4 | 4 |
| Budget d'erreurs `a0d2` | 16 | 18 | 20 | 22 |
| Groupe | 16 Zoombinis | idem | idem | idem |

(Niveau = `DS:a0d0` = `1168:515d()` ; sûr.)

## 4. Déroulé et état

### 4.1 Variables (DS)

| Adresse | Rôle |
|---|---|
| `a0c6/a0c8` | poignée d'archive |
| `a0ca` | écran actif (1 après Enter) |
| `a0cc` | nombre de Zoombinis arrivés au premier succès ; 0 = Continuer grisé |
| `a0ce` | tirage du niveau 0 (entrées valables, §2.3) |
| `a0d0` | niveau ; `a0d2` budget d'erreurs |
| `a0d4` | objet « plafond » (`SCRB` 7000) |
| `a0d6…a0de` | quatre gardiens (tableau d'objets créés depuis `DS:3bc6`, groupes 4000, 4200, 4400, 4600) ; `a0de` objet de contrôle (flag `0x1000`) |
| `a0e0` | 1 = épreuve terminée par effondrement ; `a0e2` = effondrement fini ; `a0e4` = un script de marche est en cours |
| `a0e6/a0e8/a0ea` | objet et script de réaction en attente (voix de gardien) ; `a0ea` = rappel `15a2` |
| `a0f0` | délai aléatoire (ticks) avant la prochaine phrase d'encouragement |
| `a0f4…` | 4 compteurs (un par entrée) de réussites consécutives (jusqu'à 2 pour déclencher une réaction) |
| `a0fe` | 0 → 1 (effondrement lancé) → 2 → 3 |
| `a100` | **file de décisions** : mot = longueur (≤ 5), puis entrées de 28 octets à partir de `a102` |
| `a190…a196` | nombre d'arrivés par entrée 1 (`a190`), 4 (`a192`), 2 (`a194`), 3 (`a196`) ; tableaux d'identifiants `a046` (1), `a066` (4), `a086` (2), `a0a6` (3) |
| `a198`, `a19a` | compteurs de répliques tirées (limitent les répétitions à 3) |
| `a19c` | objet `SCRB` 9000 (flag `0x8000`) |
| `a1a0`, `a19e` | voix d'avertissement en attente / en cours |
| `a1a2` | objet « chute de pierre » (`SCRB` 7001) |
| `a1a4` | taille du groupe ; `a1a6` voix de réussite en attente |
| `a1a8`, `a1aa`, `a1ac`, `a1b0` | quota et compteur d'animations d'attente, dernier instant, période (**60 ticks**, 120 si `DS:908a ≠ 0`) |

Entrée d'une file (28 octets, mots) : 0 identifiant d'objet du Zoombini (`a102`) ; 1 **erreur** (`a104`) ; 2 phase (`a106`, 0 à 4) ; 3-4 position de départ ; 5 `SCRS` de marche (`a10c`) ; 6 `SCRS` de renvoi ; 7-8 gardien (objet `a110`, script `a112`) ; 9 voix ; 10-11 second objet (`a116`) et son script (`a118`) ; 12 ; 13 **entrée** 1 à 4 (`a11c`) (lecture de `0be9`, mots 7 à 12 **probable**).

### 4.2 Zones cliquables (table `DS:3b6e`, rectangles de 0x24 octets)

| id | Rectangle | Rôle |
|---:|---|---|
| 1 | (600, 403)–(639, 440) | bouton **carte** (son 999, `8556 = 1`, dialogue de perte) |
| 2 | (600, 441)–(639, 478) | bouton **Continuer** (si actif) : `970c = 0`, son 996, arrête la voix en cours, `1168:2982(45, 0, 30, 670)`, `8556 = 9` (hutte à pizza), voix `2137(3)` |
| 3 | (0, 0)–(640, 480) | prise d'un Zoombini |

Prise d'un Zoombini (`0be9`, région 3) : si `a0e0 = 0` et `9702 < 1` et `96f4 = 0` ; l'objet doit avoir `+0x124 ∈ {0, 6}` ; le Zoombini peut déjà être dans un tunnel (`+0x127 ≠ 0`) : il est alors repris (`96fe = 1`, retour sans règle). Glisser-déposer `1168:1742` (rayon de prise `DS:9706 = 40` px). Zones de dépôt : 4 entrées (`SCRB` 5000–5003, indicateur `0x108a000`, `a0e0…`) et 16 places d'attente en bas : (399,402) (367,398) (337,397) (306,400) (274,400) (240,403) (381,424) (351,424) (322,428) (292,422) (261,426) (371,458) (342,459) (310,457) (277,457) (245,459) (valeurs de `seg 1510:0000`). Points d'accroche des entrées (`DS:3bb6`) : (98,424), (178,415), (453,421), (533,430).

`1168:166e` renvoie l'entrée (1 à 4) ou 0. Si 0 et le Zoombini venait d'une entrée, il est renvoyé sur une place d'attente ; sinon le **choix est enregistré** : calcul de `2588`, tirage de la réplique du gardien (voir §5), construction de l'entrée de file (`4ab0`, 28 octets) puis `201d` (file plafonnée à 5).

### 4.3 Tick `1190:06ff`

Protégé contre la ré-entrée (`DS:3bce`). Dans l'ordre :

1. **Sortie demandée** (`8556 ≠ 0`) : attend la fin de la voix en cours (`a402`, le dernier son démarré, s'il est dans 4000–4699 et joue encore : `bVar4`) puis dialogue de perte et changement d'écran, comme dans les gorges.
2. **Voix d'avertissement** (`a1a0`/`a19e`) : retombée quand le son est fini.
3. **Réaction d'un gardien en attente** (`a0e6`) : lancée dès que la voix est libre (`11a8:1b89` + `11a8:3533`), rappel `15a2` ou aucun.
4. **Effondrement** (`a0d2 = 0`) : voir §2.4 ; sinon traitement de la tête de file si aucun script de marche n'est en cours (`a0e4 = 0`) :
   - tête de file d'identifiant 0 : `1190:2088` enchaîne les réactions de gardien préparées (enchaînement exact des phases `a106` non résolu) ;
   - sinon, phase `a106 = 0` : le Zoombini est repris (`1168:521e`), son script `a10c` (`SCRS` 8500 + 4 × (pied − 1) + (entrée − 1)) est démarré, rappel `1190:1673`, `a106 = 1` ; si le choix est correct `+0x28 = 4` (délai entre images), sinon `a0d2 − 1` avec avertissement possible (voix 4700–4703, §2.4) ; `a0e4 = 1`.
5. **Phrase d'encouragement** : si `a0e0 = 0` et le temps écoulé sans action (`11a8:22ad`) dépasse `a0f0` : `2137(0)` (une des 10 phrases) et nouveau `a0f0 = rand(5400, 10800)` ticks (≈ 92 à 184 s).
6. **Effondrement terminé** (`a0fe = 2`) : `SCRB` 7000 joué (son 7000), rappel `15cd` : `a0e2 = 1`, voix de regret `20045…20048` possible.
7. `1108:035b` ; animations d'attente (période `a1b0`) : un Zoombini arrivé joue le `SCRS` `0x216f + pied` = 8559 + pied (**8560…8564**, événement 211).

### 4.4 Événements des Zoombinis (`1190:1673`, argument = octet bas − 1)

| Événement | Sources | Effet |
|---:|---|---|
| −1 | fin d'un `SCRS` | **arrivée** si le choix était correct (`a104 = 0`, `+0x127 = 1`) : drapeaux `\|= 0x4008000` (`1190:1839`), place d'arrivée du tunnel (tableaux ci-dessous), objet replacé par `11a8:2a0a` **juste avant la cave** `a19c` (premier du tunnel) ou juste après l'arrivé précédent du tunnel (`1190:1985`, voir §8.4), `a0cc` = compte `02cc` s'il valait 0, quota d'animations d'attente (+1 à 10 et 12 arrivés, +2 à 14, +2 au dernier ; au dernier, voix `0x4e57…0x4e5f` au hasard) ; sinon (**faux choix**) : l'avertissement sonore, un tunnel de repli (`1190:41e4`), position `DS:0000` (toute place libre) et script de retour ; la file est dépilée (`205e`) |
| 0 | `e1` des `SCRS` 8500+ | bascule de l'indicateur `+0xf2` (miroir du Zoombini) et `1168:4dc9(a0f4 − 1, …)` (pose) |
| 10 | `e11` | enchaînement sur le `SCRS` de renvoi (`a10e`, 8000 + 2 × tunnel) |
| 13 | `e14` | réaction du gardien : objet `a110` reçoit le script `a112`, rappel `1639` (copie de `a110/a114` vers `a0e6/a0e8`) ; `11a8:29c4(0)` (`1190:17b2`) fige l'ordre de dessin, que `1639` et `15cd` rallument (`29f6`) : non porté |
| 240…243 | | `a0f4 = événement − 0xef` (numéro de pied pour une voix) |
| 250…253 | | `1168:4dc9(événement − 0xfa, …)` (variante de pose) |

Places d'arrivée (16 points par tunnel, `seg 1510`, premier et dernier) : entrée 1 = (277,62) … (200,133) ; entrée 4 = (403,60) … (370,127) ; entrée 2 = (288,213) … (259,280) ; entrée 3 = (414,217) … (371,268).


### 4.5 Clavier (`1190:1199`)

Hors du mode de test (`DS:a43f = 0`), seule `0x16f` (F1) agit : `11a0:155e` (aide vocale), rend 1. En mode de test, la fonction cherche le code dans la table `CS:148c` (12 mots, cibles aux 12 mots suivants, `CS:14a4`) ; **toutes les touches de la table autres que F1 rendent 0** (non consommées : elles passent ensuite aux raccourcis généraux). Relevé sur les octets de l'exécutable (cibles hors du désassemblage), **sûr**.

| Touche | Cible | Effet | Confiance | Porté |
|---|---|---|---|---|
| `F1` (`0x16f`) | `120a` | `11a0:155e` ; rend 1, **même hors mode de test** | sûr | oui (`kit.key`) |
| `H` | `1217` | `DS:a1a8 += 4` : quatre animations de victoire de plus (quota des danses, §4.3) | sûr | oui (`danceQuota`) |
| `a` | `121f` | `11a8:04b9` puis message de la ligne d'état d'après `a02a` / `a02c` / `a039` : 1 règle : `a02c ≠ 0` « Left accepts: », sinon « Right accepts: » ; 2 règles : `(a02c, a039)` = `(≠0, ≠0)` « Left / Top accept: », `(≠0, 0)` « Left / Bottom accept: », `(0, ≠0)` « Right / Top accept: », `(0, 0)` « Right / Bottom accept: » (`1198:03cf(-1, texte)`). Puis dessine, pour chaque règle (`a02e + 13 i`), les icônes d'attributs de ses conditions (`1168:5e91`, à partir de x = 250, pas de 30) | sûr (message), probable (icônes) | message seulement |
| `C` | `1381` | gardien de `a0d6` (groupe 4000) : `n = a1b8 + 1` ; si `n` est hors de `4000…4038`, `n = 4000` ; `11a8:1be6(1, n, objet)`, `11a8:3533`, `a1b8 ← n`, message « SCRB id: n » | sûr | oui |
| `F` | `1381` | idem avec `a0da` (4200…4226) | sûr | oui |
| `I` | `1381` | idem avec `a0dc` (4400…4423) | sûr | oui |
| `O` | `1381` | idem avec `a0d8` (4600…4617) | sûr | oui |
| `w` | `1432` | `2137(1)` : phrase d'introduction (première visite de l'exécution si `a18e ≠ 1`, sinon une des 8 suivantes) | sûr | oui |
| `W` | `142c` | `a18e ← 1`, puis `2137(1)` | sûr | oui (le compteur de visites passe à 2 au moins) |
| `t` | `143b` | `2137(0)` : phrase d'encouragement | sûr | oui |
| `T` | `1444` | `2137(2)` : phrase d'effondrement (4420 à 4422) | sûr | oui |
| `e` | `144d` | `2137(3)` : phrase de sortie (tous sauvés, avec perdus, ou après l'effondrement) | sûr | oui |

`2137` empile une entrée de conversation dans la file de 5 (`201d`, refusée si pleine) : les touches `w W t T e` ne l'exécutent pas tout de suite, la file la joue à son tour (§8.3). Le compteur `a1b8` est partagé entre `C F I O` (une touche d'une autre série repart au début de sa série).

**Écarts** : `a` n'affiche pas les icônes d'attributs sous la ligne d'état (message seulement) ; le port n'a pas `a1b8` hors de la scène (remis à 0 à chaque entrée, non vérifié dans l'original) ; `W` règle le compteur de visites du port (`DS:a18e` n'y est qu'un indicateur « première visite » déduit de ce compteur). Les messages utilisent `showDebugMessage` (la ligne d'état du mode de test, en haut à gauche, effacée au prochain redessin de la zone).

## 5. Animations et sons

| Ressource | Rôle |
|---|---|
| `SCRS` 8500–8519 | trajet correct (pied 1 à 5 × entrée 1 à 4) : 28 à 65 images, sons 8500–8508 (pas, roues…) |
| `SCRS` 8520–8559 | trajets avec un mauvais embranchement (huit cas `SI` = 0…7 : premier embranchement juste ou non × entrée), événements 13 puis 10 |
| `SCRS` 8560–8564 | attente (1 image + son dépendant du Zoombini, événement 211) |
| `SCRS` 8000–8007 | renvoi après un faux choix (24 à 32 images, événement 213) |
| `SCRB` 4000…4600 | répliques des gardiens (une par son) |

Sons (sûr pour les ids, **probable** pour l'attribution) : `a2c4 = rand(20069..20070)` = consigne d'introduction vocale rejouable par la touche `0x16f` (`11a0:155e`) ; pas de son à l'entrée (contrairement aux gorges) ; 999 / 996 sur les boutons ; voix d'avertissement 4700–4703 ; voix de réussite 20055–20063 ; voix de regret 20045–20048 (`15cd`) ; chaque réplique de gardien tire dans des tables DS (`3a5a…3ae6`, `1098:0098` sans remise : 10, 4, 8, 7, 11, 6, 8 variantes selon l'entrée et le résultat) : ids `0xfa5`, `0x1140`… ; musique : aucune repérée.

## 6. Écriture dans le tampon de partie `S`

À l'**entrée** : `S+0x2c` (mémoire de dialogue de l'écran 8) +1 (`1168:5c57`) ; `S+0xCA/CC` par le changement d'écran. À la **sortie** (`1168:36e1(0, 1)`) : voir [bridge.md](bridge.md) §6 avec l'index d'épreuve **1** : bit `1 << niveau` dans `S+0x57` (écran 8), bit `0x10 << niveau` si aucun perdu et `S+0x54 ≠ 0`. Les **perdus** = Zoombinis à `+0x127 = 0` (restés en bas, renvoyés ou jamais arrivés) → réserve de l'étape 1 (choix des Zoombinis, `S+0xA1FC`). Les Zoombinis arrivés (`+0x127 = 1`) gardent `fiche[8] = 1`.

## 7. Points ouverts

Tranchés en H2 (§8) : 1 (géométrie et `a0ce`), 3 (`1190:1aff`, `1190:41e4`), 4 (`a0f4`), 5 (effet de `a0d2 = 0`) ; 2 en grande partie (tables de voix, §8.3). Restent :

1. Raison visuelle de l'exception `a0ce` du niveau 0 (tunnels bouchés ?), non vérifiée en jeu.
2. Le corps de `1190:2088` pour les phases au-delà de la conversation (aucune connue). La « voix en cours » est portée (**sûr**, `1190:06ff`) : `bVar4` = `a402` dans 4000–4699 et encore en cours, `bVar1` = `a402` dans 7000–7099 et encore en cours ; départ d'une marche, réaction de gardien et voix de réussite attendent ni l'un ni l'autre, l'effondrement et la conversation du budget épuisé seulement `bVar4`, l'avertissement retombe à la fin de son id (`a1a0`). Les pas en boucle (8500 / 8503, `\0SND` répétés `0xffff`) ne retiennent donc rien (avant : « aucun effet en cours », la file restait bloquée).
3. Compaction des places d'attente de `1190:1aff` et drapeau `0x04000000` de `1190:41e4` : non portés (§8.4).
4. Même aide vocale `0x16f` que les gorges : F1, sans condition (`1190:1199`).

## 8. Points tranchés et écarts du portage (tâche H2)

Code : `src/games/zoombinis/game/puzzles/tunnels.ts` (règles, pur), `src/games/zoombinis/scenes/puzzles/tunnels.ts` (`createTunnelsScene`), tests `test/zoombinis/puzzles/tunnels.test.ts`.

### 8.1 Règles

- **Ordre des tirages** à l'`Enter` (`1190:0107`) : `a0ce` (`1190:0000`), puis, après la création du groupe (`1168:0858`, un tirage d'attente par membre), les règles, puis `a2c4 = rand(20069..20070)`, la phrase d'introduction (`2137(1)`, tirage sans remise) et `a0f0 = rand(5400..10800)`. À chaque dépôt, les tirages sans remise des gardiens (§8.3) suivent l'ordre de `1190:0be9`.
- **Candidates** (les attributs s'énumèrent 4, 3, 2, 1 : l'octet bas du candidat est l'attribut 4, table `CS:2ae0`) : niveaux 0 et 1, 20 candidates (attribut puis valeur 1 à 5) ; niveau 2, 40 (attribut puis paire de `DS:3c24` : 12, 13, 14, 15, 23, 24, 25, 34, 35, 45) ; niveau 3, 150 (paires d'attributs (4, 3), (4, 2), (4, 1), (3, 2), (3, 1), (2, 1) de `DS:3c4c` / `3c64`, la valeur de l'attribut haut en boucle externe). L'ordre sert au départage des ex æquo (`rand(1..k)`, k-ième dans l'ordre).
- **Paire de règles** (`3a48`, `2d12`) : 4 classes `A∧B…`, classes non vides maximales, écart total minimal des six couples, tirage parmi les ex æquo ; puis `w₀`, `w₁` (`rand(0..1)` chacun). Les paires i = j ne comptent aucune classe et sont donc exclues d'office.
- **Niveau 0** : effectif cible `n/2`, `n/2 + 1`, `n/2 − 1`, `n/2 − 2`… (jamais `n/2 + 2`) ; `a0ce` à 0 : seules les entrées 1 et 4 sont valables ; à 1 : seules 2 et 3. **Une seule entrée est donc valable par Zoombini à tous les niveaux** (le robot en prend une, et sauve tout le groupe sans erreur).
- **Filtre de la règle du pont** (`DS:96ec` / `96f0`) : implémenté (`avoidCount`) et branché : les gorges écrivent leur règle de niveau 0 dans la session (`setBridgeMemory`), l'écran des grottes lit `bridgeAvoidCount(session)` (effectif non nul si la candidate l'est aussi ; en entraînement, `1190:0000` remet les deux à 0 : la mémoire est effacée). Ces variables sont dans la zone de données, pas dans le tampon `S` : elles ne sont pas sauvegardées, comme dans l'original. Plus d'écart.
- **Budget** : 16, 18, 20, 22 ; une erreur retire 1 **au départ du Zoombini** dans le tunnel (pas au dépôt, pas au retour) ; avertissements aux budgets avant décrément 5, 4, 3, 2 (voix 4700 à 4703, jouées au retour, avec une chute de pierres `SCRB` 7001 + rand(0..2), **probable** pour l'argument du tirage).
- **Effondrement** (point 5, **sûr** pour la logique, **probable** pour l'abscisse du renvoi) : à `a0d2 = 0`, plus personne n'est pris (`96f4` termine un transport) ; l'effondrement ne démarre que quand aucune marche n'est en cours (`a0e4 = 0`) et qu'aucune voix ne joue : le Zoombini de la dernière erreur finit donc son retour. Alors `1190:14bc` fait redescendre les quatre premières entrées de la file (ceux restés aux entrées) à y = 460 (`0x1cc`), non sauvés ; les arrivés restent sauvés ; une phrase du gardien 3 (`2137(2)`, 4420 à 4422) précède le plafond (`SCRB` 7000, son 7000) ; à sa fin `a0e2 = 1`, et une voix de regret (20045 à 20048) peut partir (`rand(0..4) > niveau` ou moins de 4 visites, au moins un sauvé et un perdu). « Continuer » est actif si au moins un est arrivé et si l'effondrement est fini.
- **Réussites consécutives `a0f4`** (point 4) : +1 au **dépôt** d'un bon choix, remis à 0 par une erreur ; la réaction d'un gardien n'a lieu que si le compteur vaut moins de 2 **après** l'incrément, donc seulement à la **première** réussite consécutive d'une entrée (au départ pour le gardien extérieur, à l'arrivée pour le gardien du tunnel).

### 8.2 Écran

- **Table des événements `1190:1673`** (clés `CS:1acf`) : −1 → `17e1` (arrivée ou retour), 0 → `16d2` (le Zoombini se retourne ; pose `4dc9(a0f4 − 1)` jamais utilisée ici), 10 → `1707` (enchaînement sur le script de retour `a10e`, qui finit au point `DS:3bec + 4 × ⌊(a10e − 8000) / 2⌋` : (145, 455), (210, 434), (430, 434), (476, 455) ; `1190:41e4` puis `1168:3f76`), 13 → `174b` (le gardien joue son choc `a112`, puis, au rappel `1639`, sa réplique `a114`), 240 à 243 → `16c6`, 250 à 253 → `16b1` (poses, jamais émises par les `SCRS` de l'écran).
- **Code de trajet** `SI` (0 à 7) du dépôt : entrée 1 → `A' ? 1 : 0`, 2 → `A' ? 3 : 2`, 3 → `¬A' ? 4 : 5`, 4 → `¬A' ? 6 : 7` (`A'` = premier embranchement bon). Gardien du trajet `DS:3b96` = [0, 1, 0, 2, 2, 3, 1, 3] ; choc = `SCRB` 6004 + `SI` ; marche correcte = `SCRS` 8500 + 4 × (pieds − 1) + (entrée − 1) ; marche fausse = 8519 + 5 × `SI` + pieds ; retour = 8000 + `SI`. Les quatre gardiens sont les `SCRB` 6000 à 6003 (créés dans l'ordre 1, 2, 0, 3) : 0 à gauche (42, 292), 1 en haut (255, 76), 2 au milieu (266, 241), 3 à droite (511, 303).
- **Arrivée** : le script de marche est posé depuis la position du Zoombini (la première case de l'image 0 tombe sur les pieds, `1168:3f76`) ; à sa fin le Zoombini est à la dernière case et marche (état 10 puis 7) vers la prochaine place libre du tunnel. **Probable** : l'original ne met pas la position à jour à la fin d'un script d'écran ; l'écran la déduit de la dernière case.
- **Places d'arrivée** (`1510:0040` entrée 1, `0x80` entrée 4, `0xc0` entrée 2, `0x100` entrée 3, 16 points) et d'attente (`1510:0000`) : relevées dans le NE, voir le code. Points d'accroche des entrées `DS:3bb6`.
- **Boutons** : `tBMP` 400, images 1 (« go » grisé), 2 (« go »), 3 (« go » enfoncé), 5 (carte), 6 (carte enfoncée) ; positions (600, 441) et (600, 403) (`1190:0574`). Le bouton enfoncé est tenu 6 ticks (**probable**, l'original fait une pause de `1090:00c1`).
- **Animations de victoire** : `SCRS` 8559 + pieds, un arrivé tiré sans remise toutes les 60 ticks (120 avec « moins d'action »), quota +1 à 10 et 12 arrivés, +2 à 14, +2 au dernier ; au dernier sauvé, voix de réussite 20055 à 20063.

### 8.3 Voix des gardiens (table `3a5a…3ae6` et `1190:2137`, extraites)

Chaque identifiant est un `SCRB` joué sur le gardien (avec son `\0SND` du même numéro). Tirages sans remise (`1098:0098`) :

| Rôle | Gardien | Ids |
|---|---|---|
| réplique après un choc (10, `4005` limité à 3 répétitions) | 0 | 4000 à 4009 |
| réaction du gardien extérieur gauche, premier embranchement bon à gauche (11) | 0 | 4010 à 4020 |
| réplique après un choc (4) / réaction à un bon choix (6) | 1 | 4600 à 4603 / 4604 à 4609 |
| réplique après un choc (8) / réaction à un bon choix (8) | 2 | 4200 à 4207 / 4208 à 4215 |
| réplique après un choc (7, `4416` limité) | 3 | 4404, 4403, 4413, 4414, 4415, 4416, 4400 |
| réaction du gardien extérieur droit (6) | 3 | 4417, 4405, 4406, 4407, 4401, 4418 |

Conversations de `2137` (entrée de file d'identifiant 0, traitée par `2088` : A, B, seconde réplique de A, seconde réplique de B) : encouragement (10 variantes, `2137(0)`), introduction (4 variantes à la première visite de l'exécution, `DS:a18e = 1`, sinon 8), effondrement (4420 à 4422), sortie par « go » (8 tous sauvés, 9 avec perdus, 7 après effondrement). Les listes exactes sont dans `TALK_*` du code de l'écran. Les répliques de choc et de réaction se jouent sur le gardien du trajet ; l'introduction et l'encouragement tiennent la file (5 entrées au plus).

### 8.4 Écarts

- **Sortie par « go »** (**sûr**) : `1190:0be9` remet `DS:970c` à 0 (posé à 1 par `1190:0000` pour les marches de l'épreuve, tout droit) avant `1168:2982(45, 0, 30, 670)` : la sortie suit `NODE` / `PATH` 1000 (`1168:2f9f`), chemins (287, 87) → (430, 83) → (536, 80) → (670, 30) et (304, 238) → (494, 228) → (536, 80) → (670, 30). L'ordre de dessin dynamique `11a8:231b` reste actif dans l'écran (laissé par `11a8:021c`) jusqu'à l'effondrement (`1190:0b06` : `11a8:29c4(0)`) ; drapeaux d'ordre de `1190:0107` : cave 9000 `0x8000`, entrées `0x0108a000` (au fond), gardiens `0x0c180000` (déjà triés), pans 9001 à 9006 `0` (triés une fois), plafond 7000 `0x0d181000` (devant). Le Zoombini qui sort passe ainsi derrière le gardien du haut. Avant : ligne droite et Zoombinis dessinés par-dessus tout le décor. Écart : les pierres 7001 à 7003 (`1190:19fd`, hors corpus) gardent les drapeaux du port.
- **Arrivés derrière la cave (bug 20, corrigé)** : à l'arrivée (`1190:17e1`, code hors du corpus Ghidra, relu dans les octets du segment et ses relogements NE), `1190:1839` fait `+0x20 |= 0x4008000` (`66 26 81 4f 20 00 80 00 04`), puis `1190:1985` appelle `11a8:2a0a(si, di, id)` avec `si = a19c` (la cave 9000) et `di = 0` pour le premier arrivé du tunnel, sinon `si` = l'arrivé précédent du même tunnel (listes `a046`, `a086`, `a0a6`, `a066` indexées par `a190`, `a194`, `a196`, `a192`) et `di = 1`. `2a0a` insère l'objet **avant** l'ancre si `di = 0`, **après** sinon. Avec `0x8000`, `11a8:231b` le laisse en tête de liste, dans cet ordre : l'arrivé est dessiné **derrière la cave** (rocher de la moitié droite, ouvertures des tunnels transparentes), on ne le voit plus que par l'ouverture de son tunnel. Les drapeaux ne bougent plus jusqu'à la fin de l'écran (seuls `1168:1742`, qui les restaure, et `1168:36e1`, à la sortie, écrivent `+0x20` ; jouer un script ne les touche pas). La sortie par « go » (`1168:2f9f`, nœud qui suit le plus proche : depuis (414, 217), montée tout droit vers (536, 80), puis (670, 30) ; depuis (389, 223), par (494, 228)) passe donc **derrière** le rocher : les Zoombinis disparaissent dans la montagne et ne réapparaissent qu'à l'ouverture sombre du haut à droite. Le port dessinait les arrivés devant la cave (ordre trié des mobiles) : ils traversaient la paroi. Corrigé (`hideBehindCave`) ; `Snoid` doit garder ces bits quand il charge un script (`scenes/snoid.ts`, `DRAW_ORDER_FLAGS`), sans quoi le premier pas de la marche les efface. Les autres pistes sont écartées : le « Terrain » `tBMP` 100 (`DS:3fd8`) n'est lu que par `1168:1e27` (validation d'un dépôt hors cible) et `11a8:1783` / `185c` (chargement, libération) ; aucun rectangle de découpe (`+0xe2` / `+0xe4`, lu par le dessin des Zoombinis `1168:0aa6`) n'est posé dans le segment `1190`. Verrouillé par le test « sortie par « go » depuis le tunnel du bas à droite ».
