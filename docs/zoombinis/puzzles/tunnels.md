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
| Key | `1190:1199` (débogage et touche d'aide `0x16f`) |
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

`sortie` reçoit le résultat du **premier embranchement** seul (`A'` pour les entrées 1-2, `¬A'` pour 3-4) ; la valeur renvoyée est « **faux choix** » (vrai quand la condition ci-dessus est fausse). Exactement une entrée est correcte pour un Zoombini donné à 2 règles ; deux (une par côté) à 1 règle, sauf :

- **Niveau 0 seulement** (`1190:0be9`, `a0ce`) : `a0ce = rand(0..1)` est tiré à chaque entrée dans l'écran. Si `a0ce = 0` seules les entrées **extérieures 1 et 4** sont valables (une entrée « correcte » 2 ou 3 est comptée **fausse**) ; si `a0ce = 1` seules les entrées **intérieures 2 et 3** (1 et 4 sont fausses). (Lecture du code, sûr ; la raison visuelle — deux tunnels bouchés au niveau 0 — est **probable** : à vérifier sur les décors 6004–6011.)

Les chaînes de débogage `Left / Bottom accept:`, `Left / Top accept:`, `Right / Bottom accept:`, `Right / Top accept:`, `Right accepts:`, `Left accepts:` (dans `1190:1206…`) correspondent à ces `w` : une règle avec `w₀ ≠ 0` est « acceptée à gauche » ; avec 2 règles, `w₁ ≠ 0` = « haut ». Soit, avec nos formules : entrée 1 = gauche + haut, 2 = gauche + bas, 3 = droite + bas, 4 = droite + haut (**probable**, l'association « extérieur = haut » n'est pas visible à l'écran).

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

1. **Sortie demandée** (`8556 ≠ 0`) : attend la fin de la voix en cours (ids 4000–4701 ou 7000–7099 : `a402`) puis dialogue de perte et changement d'écran, comme dans les gorges.
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
| −1 | fin d'un `SCRS` | **arrivée** si le choix était correct (`a104 = 0`, `+0x127 = 1`) : place d'arrivée du tunnel (tableaux ci-dessous), objet mis devant le précédent (`11a8:2a0a`), `a0cc` = compte `02cc` s'il valait 0, quota d'animations d'attente (+1 à 10 et 12 arrivés, +2 à 14, +2 au dernier ; au dernier, voix `0x4e57…0x4e5f` au hasard) ; sinon (**faux choix**) : l'avertissement sonore, un tunnel de repli (`1190:41e4`), position `DS:0000` (toute place libre) et script de retour ; la file est dépilée (`205e`) |
| 0 | `e1` des `SCRS` 8500+ | bascule de l'indicateur `+0xf2` (miroir du Zoombini) et `1168:4dc9(a0f4 − 1, …)` (pose) |
| 10 | `e11` | enchaînement sur le `SCRS` de renvoi (`a10e`, 8000 + 2 × tunnel) |
| 13 | `e14` | réaction du gardien : objet `a110` reçoit le script `a112`, rappel `1639` (copie de `a110/a114` vers `a0e6/a0e8`) |
| 240…243 | | `a0f4 = événement − 0xef` (numéro de pied pour une voix) |
| 250…253 | | `1168:4dc9(événement − 0xfa, …)` (variante de pose) |

Places d'arrivée (16 points par tunnel, `seg 1510`, premier et dernier) : entrée 1 = (277,62) … (200,133) ; entrée 4 = (403,60) … (370,127) ; entrée 2 = (288,213) … (259,280) ; entrée 3 = (414,217) … (371,268).

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

1. Géométrie des tunnels : association entrée → « haut / bas » et raison visuelle du filtre `a0ce` au niveau 0 (à confirmer sur les décors, `SCRB` 6004–6011 ?).
2. Le mot 6 de l'entrée de file (script de renvoi `a10e`) et la table de voix `3a5a…3ae6` : ids exacts non extraits.
3. Corps de `1190:41e4` et de `1190:1aff` (tirage d'une place d'attente de repli).
4. Rôle précis de `a0f4` (réussites consécutives par entrée) dans le choix des voix.
5. Conséquence visible de `a0d2 = 0` pour les Zoombinis déjà dans un tunnel (ils restent comptés arrivés ; ceux en cours reviennent en bas) : non testé en jeu.
6. Même aide vocale `0x16f` que les gorges (identité de la touche).
