# La muraille de signes (`NET.MHK`, écran 15) : étude de rétro-ingénierie

Tâche T8. Écran 15 de `ZOOMBINI.EXE` (version 1.0FR), archive `NET.MHK` (1,2 Mo), troisième et dernière épreuve de l'itinéraire B de l'étape 3 ; sa sortie ferme l'étape (monument, niveau + 1, camp 2). Document d'étude seul. Cadre : [../engine.md](../engine.md), [../screens.md](../screens.md) ; conventions de [fleens.md](fleens.md) (adresses `segment:offset`, `[xxxx]` = `DS:xxxx`, `S+0xNN` = tampon de partie, tableaux de travail des segments `1458` / `1468` / `14c0`, confiance **sûr** / **probable** / **hypothèse**). « Mudball Wall » est une lecture de l'effet (boules de boue lancées par une catapulte contre un mur de dalles) ; la chaîne `STRL` 2016 contient « muraille » et « catapultaboue ».

Les routines de rappel `1120:0476` et `1120:2900` (événements des Zoombinis) et les cibles de `switch` `1120:2960…2d4a` ne sont pas des fonctions du corpus ; elles ont été lues dans une copie du projet Ghidra.

## 0. Résumé

- Un mur de **25 dalles** (5 × 5 : niveaux 0 et 1) ou **125 dalles** (5 × 5 × 5 : niveaux 2 et 3) cache des **groupes de Zoombinis** (tailles 3, 2, 1, 3, 2, 1… ajustées pour que la somme vaille le nombre de Zoombinis `n`, ex. 16 → 2, 2, 1, 3, 2, 1, 3, 2). Chaque dalle porte un **signe** défini par 2 (niveaux 0 et 1) ou 3 (niveaux 2 et 3) attributs de 5 valeurs. **Sûr.**
- Le joueur règle sur la catapulte 2 ou 3 sélecteurs de 5 symboles et tire une boule de boue ; la boule frappe la dalle dont les signes sont **exactement** ceux qui ont été réglés. La dalle ne montre rien si elle n'a pas de groupe ; sinon, le groupe de `g` Zoombinis passe le mur (`g` = 1 à 3). Il faut donc **déduire la disposition des signes** à partir des impacts. **Sûr.**
- Munitions : `7 + (nombre de groupes) (+ 1 au niveau 3)` boules, plus un dernier tir qui est joué avant l'arrêt (soit 16 tirs pour 16 Zoombinis aux niveaux 0 à 2, 17 au niveau 3). **Sûr** pour le calcul, **probable** pour le détail du dernier tir.
- Les Zoombinis qui n'ont pas franchi le mur à la fin sont **perdus**. **Probable** (marquage de survie localisé au passage du mur, 2.6).

## 1. Identification

### 1.1 Handlers

Écran 15, descripteur `1530:19a2`.

| Rôle | Adresse | Remarque |
|---|---|---|
| Enter | `1120:0000` | 955 octets |
| Exit | `1120:04fd` | 87 octets |
| Tick | `1120:0554` | 2513 octets ; garde `[1a08]` et `[89ea]` (écran entré) |
| Key | `1120:10cd` | 74 octets (sans effet de jeu : touches de test) |
| Clic (n = 1 carte, 2 Go, 3 tir, 4–8 sélecteur 1, 9–13 sélecteur 2, 14–18 sélecteur 3) | `1120:0f25(n)` | 392 octets |
| Construction du mur | `1120:1461` | 1620 octets : tables de signes + groupes + objets de dalles |
| Taille des groupes | `1120:2d8d` | 250 octets |
| Création des objets de décor | `1120:1161` | 493 octets : sélecteurs, catapulte, numéros de dalles |
| Réglage d'un sélecteur et tir | `1120:1b9b(valeur, rangée)` | 906 octets |
| Tuile atteinte | `1120:2657` | 673 octets |
| Impact | `1120:248b(tuile)` | 460 octets (réaction du mur) |
| Chute d'une boule | `1120:2e87(tuile)` | 363 octets |
| Départ du Zoombini suivant | `1120:1abd` | 222 octets |
| Rappels d'animations | `1120:213e` (boule), `1120:20e7`, `1120:2900`, `1120:2ff2`, `1120:0476` | |
| Boutons | `1120:03bb(redessiner, appuyé, bouton)` | comme Fleens |

### 1.2 Ressources de `NET.MHK`

| Tag | Ids | Usage |
|---|---|---|
| `tBMP` + `SHPL` | 5000 (`SHPL` 5000), 5001 (`SHPL` 5001), 6000 (`SHPL` 6000) | fonds 640 × 480 : l'Enter charge 5000 aux niveaux 0 et 1 et 5001 aux niveaux 2 et 3 (`1120:0184…0195`, **probable**) ; 6000 : décor des signes |
| `tBMP` | 100 | terrain |
| `tBMP` | 7000 (groupe 0, `SCRB` 7000–7047, 48 scripts), 8000 (groupe 1, `SCRB` 8000–8007), 9000 (groupe 2, 154 `SCRB` 9000–9153 : dalles), 10000 (groupe 3, `SCRB` 10000–10018 : sélecteurs et catapulte) ; `tBMP` 7000 est aussi chargée en `[19c0]` (planche des boutons et du compteur de boue : `11a8:2ae6(0x1770 = 6000)`) | |
| `REGS` | 7000 / 7001 (ancrage des parties du groupe 0), 9000 / 9001 (ancrage du groupe 2 ; tableaux de zéros d'après engine.md 4.3) | |
| `SCRB` | 7000–7047, 8000–8007, 9000–9153, 10000–10018 | voir ci-dessous |
| `SCRS` | 13000–13050 (51) + 14000–14002 (3) | Zoombinis : `1168:04d0(13000, 51, 0)` et `1168:03ef(14000, 3, 0)` (sauts, réceptions, joie) |
| `\0SND` | 7000–7021, 8000–8002, 10000–10004 | sons |

`SCRB` : 7000 (objet « boue / mur » à 4 états, `[8b08]`, scripts 7001… selon `[8b4c]`), 7001–7016 : tas de boue (1 par tir, 0 à 16), 8000–8004 : réactions des 5 colonnes de la catapulte (`[89fc..]`), 8005 : `0x1f45` (catapulte animée, `[89fa]`), 9000–9024 (niveaux 0–1) ou 9025–9149 (niveaux 2–3) : une dalle chacune (`[8a0e + 2·tuile]`), 10000 / 10001 : bouton de tir (`0x2710`, `0x2711`), 10002–10006 : symboles du sélecteur 1 (niveaux 2 et 3), 10007–10011 : sélecteur 2, 10012–10016 : sélecteur 3, 10017 / 10018 (`0x2721`, `0x2722`) : états du bouton de tir (prêt, tir en cours). Sons préchargés par l'Enter : 996–997, 20000–29999 (flux), 300–324, 425–499, 99, 375–399 (voix des Zoombinis), 7000–7035 puis 10000+.

Ressources communes : `ZOOMBINI.MHK` (Zoombinis, voix 20000+), `MIDIMPC.MHK` (musique). `NODE` / `PATH` : l'écran n'en a pas.

## 2. Règles

### 2.1 Tirages initiaux (`1120:0000` et `1120:1461`, **sûr**)

À l'Enter : niveau `[89ee]` (0–3, `1168:515d`) ; `[8b6e] = 25` (niveaux 0, 1) ou 125 (niveaux 2, 3) = nombre de dalles ; trois valeurs de sélecteurs initiales `[8b7e]`, `[8b82]`, `[8b86]` = `rand(0..4)` (symbole affiché au départ pour les trois sélecteurs) ; mise à zéro des compteurs ; `n = [89b2]` = nombre de Zoombinis (`1168:365d`) ; `1120:2d8d` calcule les groupes (2.2) ; munitions `[8b4a] = [89c2] + 7 + (niveau == 3 ? 1 : 0)` (`[89c2]` = nombre de groupes), `[8b4e] = [8b4a]`, `[8b4c] = 16 − [8b4a]` (hauteur initiale du tas de boue) ; `1120:1161` crée les objets de décor.

Le **mur** (`1120:1461`, relancé à la fin de l'animation d'arrivée `[8b5e]`) est construit comme suit.

1. Trois tableaux de signes de `[8b6e]` mots : `P` (`1458:00FA`), `Q` (`1458:01F4`), `R` (`1458:02EE`, niveaux 2 et 3 seulement), et un tableau `G` de tailles de groupes (`1458:040A`, mis à zéro).
2. **Niveaux 0 et 1** (5 × 5) : on tire 5 couples `(a_k, b_k)` en rejetant les valeurs déjà prises (`a_k` et `b_k` sont deux permutations de {0…4}, `rand(0..4)` avec rejet) ; pour `k` = 0..4 : tout le « rang » `k` (cases `5k … 5k+4`) reçoit `P = a_k`, toute la « colonne » `k` (cases `k, 5+k, …, 20+k`) reçoit `Q = b_k`. Donc la dalle (rang `r`, colonne `c`) porte le couple `(a_r, b_c)` : **chaque couple apparaît une fois**.
3. **Niveau 1** : on applique ensuite aux colonnes de `Q` des **rotations cycliques** : pour chaque rang `r` de 1 à 4, le rang est la copie du rang précédent… (cumulée) tournée cumulativement de `s` crans à chaque rang (`s = rand(0..1) + 2`, soit 2 ou 3, tiré une seule fois : `1080:0028(1)` en `1120:1674`). Le résultat est un carré latin de `Q` : la valeur de `Q` d'une dalle ne dépend plus seulement de sa colonne. Chaque couple `(P, Q)` reste unique.
4. **Niveaux 2 et 3** (5 × 5 × 5) : `a_k, b_k, c_k` trois permutations ; `P` est constant par plan de 25 (indice `⌊t/25⌋ = a_k` : `P[t] = a_{⌊t/25⌋}`), `Q[t] = b_{⌊(t mod 25)/5⌋}`, `R[t] = c_{t mod 5}`. **Niveau 3** : on mélange ensuite `P` et `R` par rotations cycliques de `rand(0..1) + 2` crans (2 ou 3, tiré une fois, `1120:1731`) sur chaque couple (plan, rang) (boucles de `1120:1461`) pour casser la structure en couches ; chaque triplet reste unique.
5. **Groupes** : pour chacun des `[89c2]` groupes, une dalle tirée au hasard (`rand(0..24)` ou `rand(0..124)`) qui n'a pas déjà de groupe reçoit la taille du groupe (`G[t] = taille`).
6. **Objets** : pour chaque dalle, un objet (`SCRB 9000 + t` niveaux 0–1, `9025 + …` niveaux 2–3) ; pour celles qui ont un groupe, son image est choisie parmi les variantes `150 + taille` (`+3` aux niveaux 2 et 3).
7. **Rôles des attributs** : niveaux 0 à 2 : `[89cc], [89ce]` = (1, 2) ou (2, 1) (`rand(0..1)`) ; selon `[89cc]`, la correspondance sélecteur ↔ tableau est `(sélecteur 3 ↔ P, sélecteur 2 ↔ Q)` ou `(sélecteur 3 ↔ Q, sélecteur 2 ↔ P)`. Niveau 3 : `[89cc]`, `[89ce]`, `[89d0]` trois entiers distincts tirés (`rand(0..2)`) et `[8ba8] = rand(0..5)` choisit l'une des **6 permutations** d'affectation sélecteurs ↔ `P, Q, R` (cas 0 à 5 de `1120:2657`).

### 2.2 Tailles de groupes (`1120:2d8d`, **sûr**)

`n` = nombre de Zoombinis. On génère la suite cyclique 3, 2, 1, 3, 2, 1, … en soustrayant chaque terme de `n` jusqu'à ce que le reste soit ≤ 0 ; `[89c2]` = longueur. Si la somme dépasse `n` d'un excédent `e`, on retire 1 aux groupes de taille > 1 en balayant du premier au dernier jusqu'à épuiser `e` ; si un excédent reste après un balayage (cas `n` = 1 : suite [3], excédent 2), tous les groupes sont ramenés à la taille 1 et `[89c2] = n`. Exemples : `n` = 16 → 2, 2, 1, 3, 2, 1, 3, 2 (8 groupes) ; `n` = 3 → 3 ; `n` = 1 → 1 ; `n` = 2 → 2 ; `n` = 4 → 2, 2. La somme vaut toujours `n`.

### 2.3 Ce que fait le joueur

Clic (`1120:0f25(n)`), toujours désactivé si `[8556] ≠ 0` (sortie en cours) ou `[89e0] ≠ 0` (animation bloquante) :
- `n = 4…8` : règle le **sélecteur 1** sur la valeur `n − 4` (seulement aux niveaux 2 et 3) ; `n = 9…13` : **sélecteur 2** valeur `n − 9` ; `n = 14…18` : **sélecteur 3** valeur `n − 14` (si `[8b8c] == 0` ou `[8b6c] ≠ 0` : pas de tir en cours ou jeu terminé). `1120:1b9b(valeur, rangée)` mémorise la valeur précédente (`[8b80]`, `[8b84]`, `[8b88]`), joue l'animation de symbole (`SCRB 10002 + valeur`, `10007 + valeur`, `10012 + valeur`) et, si la combinaison est complète (`[8b82] ≥ 0` et `[8b86] ≥ 0` ; niveaux 2–3 : aussi `[8b7e] ≥ 0`), anime le lanceur (`SCRB 0x1B72`…`0x1B73`) ; `[8b50]` = 1 et `[8b56]` = 1 (« nouvelle combinaison », compte les changements).
- `n = 3` : **tir** : accepté si `[8ba6] == 0`, `[8b8c] == 0` et `[8b6c] == 0` ; pose `[8ba6] = [8b8c] = 1`, horodate `[8bae]`, `1120:1b9b(0, 0)` : mémorise les valeurs, joue le bouton (`SCRB 0x2711`), calcule la dalle visée `[89da] = 1120:2657()` (2.4) et lance la boule (animation `SCRB 0x1B74 + [19ba]`, `[19ba]` = 1 si la colonne visée est 0, 2 si elle est 4, 0 sinon, rappel `1120:213e`).
- `n = 1` : carte : voix 999, `[8556] = 1` (abandon). `n = 2` : Go : seulement si `[89ec] ≠ 0` (au moins un Zoombini a passé, 2.6) ; voix 996 ; `1168:2982(45, 0, 0xFF9C, 600)` fait marcher hors de l'écran, avec un décalage de 45 ticks entre eux, les Zoombinis marqués `+0x127 ≠ 0` ; `[8556] = 5` (écran suivant : le camp de base 2).
- Les sélecteurs sont des boutons inertes quand un tir est en cours. Une inactivité de 7200 ticks (≈ 2 min) ou de 720 ticks après un tir relance un rappel visuel du bouton (script `0x2722`).

### 2.4 Dalle atteinte (`1120:2657`, **sûr**)

Soient `s1`, `s2`, `s3` les valeurs courantes des trois sélecteurs (`[8b7e]`, `[8b82]`, `[8b86]`). Le résultat est l'indice de la première dalle `t` telle que :
- niveaux 0 et 1 : si `[89cc] == 2` : `P[t] == s3 ∧ Q[t] == s2` ; sinon : `Q[t] == s3 ∧ P[t] == s2` ;
- niveaux 2 et 3 : selon `[8ba8]` (0 à 5, toujours 0 au niveau 2) : `[8ba8]` 0 : `P = s3, Q = s2, R = s1` ; 1 : `P = s2, Q = s3, R = s1` ; 2 : `P = s1, Q = s3, R = s2` ; 3 : `P = s3, Q = s1, R = s2` ; 4 : `P = s2, Q = s1, R = s3` ; 5 : `P = s1, Q = s2, R = s3`.
**Probable** : la construction du mur (2.1) fait qu'il existe exactement une dalle pour chaque combinaison. Le tir est donc **déterministe** : le joueur règle des symboles et ne choisit pas une position.

### 2.5 Impact et gain

À l'atterrissage (`1120:248b(t)`, rappel `213e`) : `g = G[t]` : si `g > 0` : `[8b9a] = g` (Zoombinis autorisés à passer), `[8bba]++`, `[89b8] += g` (compte des Zoombinis déjà libérés), et `G[t] = −1` (marqué consommé : **une dalle ne donne qu'une fois**) ; sinon `[8b9a] = 0`, `[8ba6] = 0`, `[8b8e]++` (tir manqué). Un tir qui retombe sur une dalle déjà consommée ou vide est un tir manqué (`g` = −1 ou 0). Après un impact utile, `1120:1abd` (appelée par le Tick) envoie jusqu'à trois Zoombinis à la file de départ : `[89b4]` = indice du prochain Zoombini à partir, `[8b78..8b7c]` = les trois à la catapulte (`1168:4231(0, 10, …)` vers le point (233, 392)) ; un par un, quand il arrive sur la plate-forme, il est lancé par-dessus le mur (événement 4 de `1120:2900`), atterrit de l'autre côté (événement 20 / 2, pose `+0x127 = 1`) et rejoint la file d'arrivée : points `1468:01F4 + 4·[89e4]`.

### 2.6 Fin, erreurs tolérées, perdus

- **Munitions** : à chaque fin d'animation de boule (`[8ba4]` terminé), `[8b4a]` est décrémenté ; quand il valait déjà 0 avant la décrémentation (donc au tir numéro `[8b4a]_init + 1`), `[8b6c] = 1` : **plus de tir** ; commentaire vocal : si `rand(0..4) ≥ niveau` ou `(S+0x3C & 0xFFF) < 4` (conditions d'aide pour joueur débutant) et qu'il y avait un échec partiel (`0 < [89b8] < n`) : un id 20045–20048 ; sinon, si le dernier tir était utile, un compteur de commentaires `[1978]` est incrémenté. Pas de pénalité autre que la fin de l'épreuve.
- **Tirs perdus** : la tolérance est donc de `[8b4a]_init` boules + 1 tir (16 pour 16 Zoombinis aux niveaux 0 à 2) pour trouver les `[89c2]` groupes ; un tir manqué ne fait rien d'autre que consommer une boule.
- **Succès** : `[89b8] ≥ n` : tous les Zoombinis sont libérés ; le dernier d'entre eux qui arrive déclenche le commentaire de victoire (`rand(0x4e57..0x4e5f)` = 20055–20063, `11a0:0ee7`).
- **Go** (région 2) : `[89ec] ≠ 0`, levé quand le premier Zoombini a rejoint la file d'arrivée (`1120:2cae`).
- **Perdus** : à la sortie `1168:36e1` marque perdus tous les objets avec `+0x127 == 0` : ceux qui n'ont pas franchi le mur (`+0x127 = 1` posé à l'événement 2, au lancement, et à l'arrivée de l'autre côté). Un Zoombini qui n'a jamais été envoyé à la catapulte, ou qui reste dans la file, est perdu. Rendu : camp 1 (`S−0x5B9E`, `S+0x4A += perdus`) car l'épreuve est dans l'étape 3.
- **Abandon par la carte** : le groupe est perdu (règle générale).
- Entraînement : Exit → tous sauvés.

## 3. Niveaux

| Niveau | Dalles | Attributs | Disposition | Sélecteurs actifs | Munitions (n = 16) | Particularités |
|---|---:|---:|---|---|---:|---|
| 0 | 25 | 2 | rangs (`P`) × colonnes (`Q`), carré direct | 2 (rangées 2 et 3) | 15 (+1 dernier tir) | `[89cc]` ∈ {1, 2} échange `P` / `Q` |
| 1 | 25 | 2 | idem puis colonnes de `Q` en carré latin (rotations) | 2 | 15 (+1) | |
| 2 | 125 | 3 | trois permutations (plans × rangs × colonnes) | 3 | 15 (+1) | affectation sélecteurs ↔ attributs fixe (`[8ba8] = 0`) |
| 3 | 125 | 3 | idem avec mélange de plans | 3 | 16 (+1) | affectation sélecteurs ↔ attributs tirée parmi 6 permutations ; fond 5001 ; une munition de plus |

(Chiffres des munitions : `7 + 8 + (niveau 3 ? 1 : 0)` ; le nombre de groupes dépend de `n` : 8 pour 16 Zoombinis. Le premier terme est constant à tous les niveaux.) Le niveau n'agit sur aucune autre variable ; les attributs des Zoombinis (valeur `+0xEF`) ne servent qu'au choix des animations d'attente.

## 4. Déroulé et état

### 4.1 Variables

| DS | Rôle |
|---|---|
| `89ee` | niveau (0–3) |
| `8b6e` | nombre de dalles (25 ou 125) |
| `89b2` | `n` : nombre de Zoombinis |
| `89c2` | nombre de groupes ; `1458:03F2[k]` tailles ; `1458:040A[t]` groupe de la dalle `t` |
| `89b8` | Zoombinis libérés (cumul des `g`) |
| `89b4` | indice du prochain Zoombini à envoyer à la catapulte |
| `89a4` | indice du Zoombini en vol (−1 si aucun) |
| `8b78`, `8b7a`, `8b7c` | handles des trois Zoombinis à la catapulte |
| `8b4a` | munitions restantes ; `8b4e` copie ; `8b4c` tas de boue (0–16) |
| `8b7e`, `8b82`, `8b86` | valeurs des sélecteurs 1, 2, 3 (−1 = aucune) ; `8b80`, `8b84`, `8b88` précédentes |
| `8b9a` | Zoombinis encore autorisés à passer pour l'impact en cours |
| `89da` | dalle visée |
| `89cc`, `89ce`, `89d0`, `8ba8` | rôles des attributs (2.1.7) |
| `8ba6`, `8b8c` | tir en cours (deux drapeaux) |
| `8b6c` | épreuve terminée (plus de munitions) |
| `89ec` | Go autorisé ; `89ea` écran entré (garde du Tick) |
| `89e0` | animation bloquante ; `89e2` mode de test |
| `8b50`, `8b56` | « combinaison modifiée » (déclenche l'animation de remise à jour du lanceur) |
| `8bae` | horodatage du dernier tir (inactivité) |
| `8b8a`, `8b9c`, `89dc`, `8bb6`, `8bb8`, `8bba`, `8bb2`, `8baa` | animations de joie (jusqu'à `[8bb6]` = 3 (2 en entraînement…)), cadence de 30 ticks |

### 4.2 Tick (`1120:0554`)

Chaque tour (si `[1a08] == 0` et `[89ea] ≠ 0`) : pompe `11a8:04b9` ; sortie demandée (`[8556] ≠ 0`) comme pour les deux autres épreuves ; animation du tas de boue (`[8b6a]`, `[8b48]`) ; fin de l'animation d'arrivée `[8b5e]` → `1120:1461` (construction du mur) ; si un tir est en cours (`[8ba4]`) : à sa fin, compte la munition (2.6) ; sinon enchaîne les séquences du lanceur (`[8b5a]`, `[8b5c]`, `[8b60]`, `[8b62]`, `[8b64]`) ; départ du Zoombini suivant (`1120:1abd`) et décomptes `[8b9a]`, `[8b98]` ; animation de dalle touchée (`[8b9e]`, `[8ba0]`, scripts `SCRB 8000 + colonne`) ; animations de joie de Zoombinis non marqués (délai 30 ticks, `[8bb8] < [8bb6]`) ; rappels d'inactivité.

### 4.3 Zones

- 15 boutons de sélecteur : 5 symboles par sélecteur, trois rangées (la rangée 1 n'existe qu'aux niveaux 2 et 3) ; bouton de tir. Les rectangles sont dans la table de `1038` (`DS:1986` → `1458:0504`, valeurs créées à l'exécution).
- Boutons carte (600,403)-(639,440) et Go (600,441)-(639,478).
- Positions de la file de départ (`DS:19c4`) : (233,392), (209,378), (196,390), (185,365), (167,380), (160,408), (135,397) ; points de la file d'arrivée en `1468:01F4`.

## 5. Animations et sons

- Sons du Net : 7000–7021 (catapulte, boue, dalles), 8000–8002, 10000–10004 (boutons, symboles). Voix communes : 20055–20063 (victoire), 20045–20048 (échec partiel), 996 (Go), 999 (carte), 20036 (attente de fin avant sortie).
- Événements des Zoombinis (`1120:2900`, table `1120:2D55`) : −1 (fin de script), 0 (basculement de pose), 2 (impact : le Zoombini rejoint le point de la file, `+0x127 = 1`), 4 (envoi à la catapulte, `[89a4]`), 20 (0x14) et 30 (0x1E) : étapes du vol et de la réception (`SCRS 13000+…` : `0x32D8 + 3·(attribut 3 − 1) + (2 − [89d6])` pour le saut, `0x32E7 + 3·… + [89d6]` pour la réception) ; 240–243, 250–253 : poses (comme Fleens).
- Dalles : un `SCRB` par dalle (9000+), réaction `SCRB 8000 + colonne` au tir, révélation du numéro de groupe.
- Mur : `SCRB 7000` (4 états, `[8b4c] + 0x1B77`…), tas de boue `7001…7016`.

## 6. Tampon de partie

- Aucune règle persistante écrite par cet écran. `S+0x3C` (mémoire de dialogue de l'écran 15, `S+0x28 + 2 × (15 − 5)`) lue pour moduler les commentaires (2.6).
- Groupe courant reconstruit par `1168:36e1` : attributs inchangés ; fiche[8] = 1 pour les Zoombinis passés.
- Progression : `S+0x5E |= 1 << niveau` (écran 15, `S+0x56 + 8`) ; sans perte : `S+0x5E |= 0x10 << niveau` ; dernière épreuve de l'étape 3 : si aucun perdu, `S+0x54 ≠ 0` et pas d'entraînement, le monument (étape 3, niveau + 1) est ajouté, `S+0x52 |= 1 << (niveau + 4)` (bits 4–7 de l'étape 3), et le niveau de l'étape 3 (`S+0xC6`) augmente de 1 (3 au plus) ; sortie vers l'écran 5 (camp 2). Perdus rendus au camp 1.

## 7. Points ouverts

1. Détail exact du mélange du niveau 3 (boucles de `1120:1461`, tableau `P` / `R` par plans, lecture à confirmer) : l'amplitude de rotation (2 ou 3) est sûre pour le niveau 1 ; pour le niveau 3 l'indexation `[5·plan + rang + 25·k]` est lue dans le décompilé, non vérifiée. Seule la propriété « un couple / triplet de signes ↔ une dalle » est supposée (`1120:2657` renvoie la première dalle correspondante).
2. Écran de fond selon le niveau (5000 / 5001) et placement des objets de dalles (coordonnées dans les `SCRB` 9000+).
3. Règle exacte du dernier tir (`[8b4a]` lu avant décrémentation) ; rôle de `[89dc]`, `[8b9c]`, `[8b8a]` (compteurs de départ des Zoombinis).
4. Marquage des Zoombinis survivants : `+0x127` est posé dans `2900` (événements 2 et −1) ; non testé en jeu que les non partis sont perdus.
5. Régions de clic des 15 symboles (créées à l'exécution), points d'arrivée `1468:01F4`.
6. `D8b6c` (munitions épuisées) après victoire : la fin est détectée par la file d'attente des Zoombinis, non par un test explicite de `[89b8] ≥ n` dans le Tick.
