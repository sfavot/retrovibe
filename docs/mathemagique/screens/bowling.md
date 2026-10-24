# Bowling for Numbers : étude de rétro-ingénierie (tâche E2)

Activité de la scène 1 (`BOWLING.DAT` + `GUS.DAT` + `POLLY.DAT`), segment `1010` de `MATH` (≈ 18,6 Ko), `Enter` `1010:0000`, `Leave` `1010:03a3`, `Tick` `1010:05d1`, `Key` `1010:2b64`. Cadre général : [engine.md](../engine.md), [re-index.md](../re-index.md), [scr.md](../scr.md), [formats.md](../formats.md). Les adresses sont des `sélecteur:offset` Ghidra (DS = `1108`). Un fait sans mention est lu dans le code ; **hypothèse** marque une déduction non vérifiée.

Méthode : décompilation Ghidra relue contre le désassemblage (les arguments des appels `stdcall16far` sont faux ou manquants dans la décompilation : tous les appels `10a8:1473`/`10a8:14c1` et `10a8:0ce4` ont été relus dans `disasm.txt`). Les tables de données viennent du segment de données du NE (`original/mathemagique/MATH`, segment 34, relocations appliquées pour les pointeurs lointains). L'algorithme de génération a été **porté en Python** (scratch, hors dépôt) et exécuté pour les 6 opérations × tous les sous-types × tous les indices (≈ 3 700 problèmes) sans boucle infinie ; les valeurs d'exemple du §8 en sortent.

## 0. Vue d'ensemble

- Le joueur choisit une **opération** (6 boutons : `+ − × ÷ = ≈`) et un **niveau** (1 à 4, puis « BONUS »), clique **GO!**, et reçoit des **problèmes à choix multiple** : 4 cases de réponse, on clique la bonne (ou touche `1`–`4`). **10 bonnes réponses** (non nécessairement consécutives) dans le temps imparti = **1 strike** (une des 10 animations de quilles par bonne réponse). **10 strikes** terminent le niveau (bit de progression, rang +1).
- Pas de score numérique, pas de « frames »/lancers au sens du vrai bowling : le « strike zone » (10 petites quilles en haut) compte les strikes du niveau ; l'animation de quilles compte les bonnes réponses de la partie en cours.
- Opérations présentes : addition, soustraction, multiplication, division, équivalence de fractions (« = »), estimation (« ≈ »). **Aucune voix ne lit les nombres** (voir §5) : les problèmes sont uniquement dessinés.
- Le jeu n'a ni Custom Play, ni Boiler Room, ni tableau de progrès par pourcentage (v2 seulement, §7). En revanche la durée de partie est réglable (1–999 s) dans l'écran de connexion/préférences (`1080:0956`, §1.8).

## 1. Règles

### 1.1 Variables d'état (segment de données)

| DS | Rôle |
|---|---|
| `4b52` | opération courante 0–5 (+, −, ×, ÷, =, ≈) |
| `4d0c` | niveau courant 0–4 (4 = bonus) |
| `4d0e` | strikes déjà faits dans ce niveau (0–9 ; passe à 10 puis est remis à 0 par `29b1`) |
| `4c98` | bonnes réponses de la partie en cours (0–9) |
| `4c58` | **sous-type** (index plat dans les tables de l'opération) du problème courant |
| `4c56` | **indice du problème** dans l'espace du sous-type (0 … `CNT[op][sous-type]`) |
| `4c9a`–`4ca0` | les 4 réponses affichées (`u16`) ; `4c96` = case de la bonne réponse (0–3) |
| `4c54` / `4b54` (256 octets) | nombre de problèmes déjà tirés / drapeaux « déjà posé » (historique anti-répétition) |
| `4c5a`, `4c5e[7]`, `4c7a[7]`, `4c88[7]`, `4c6c[7]` | **file de reprise** (§1.5) : n, indices, sous-types, case cliquée à tort, compte à rebours |
| `4c5c` | −1 = problème neuf ; sinon indice (dans la file) du problème repris |
| `4ca6` | partie en cours (0/1) ; `4ca8` échéance (tick) ; `4ca4`/`4ca2` demi-largeur de la barre de temps (courante/précédente) |
| `0332` | durée de partie en ticks (défaut `10800` = 180 s ; sauvé dans l'en-tête du roster) |
| `0338` | id MIDI de fond (`2000 + niveau`, bonus : `2000 + rand(0..3)`) |
| `4dee` | jamais écrit (toujours 0) : drapeau mort « bonne réponse toujours en case 0 » (`1010:1154`) |
| `4cb8[6]`, `4cc4[6]`, `4cd0[30]`, `4d30` | variables sauvées (§2) |

### 1.2 Générateur aléatoire

Un seul RNG pour tout le jeu (`10a8:1473` et `10a8:14c1`) : congruentiel linéaire 32 bits `s ← s × 0x343FD + 0x269EC3 (mod 2³²)`, sortie `(s >> 16) % (n + 1)` (**16 bits hauts complets, pas de masque `& 0x7FFF`**).

- `rand(n)` = `10a8:1473(n)` renvoie 0…**n** inclus (`n = 0` → 0 sans avancer l'état).
- `rand1(n)` = `10a8:14c1(n)` = `rand(n − 1)`, renvoie 0…n−1.
- Graine : paresseuse, au premier appel (`DS:38f8 ≠ 0` → `10a8:1460`) : `s = (AX << 16) | DX` renvoyés par `1098:060f` (somme de champs de l'heure système obtenus par `1000:5594`/`1000:5542`). Non reproductible ; en TS : graine = horloge.
- Exception : `1010:2fb8` (masques éparpillés, §1.7) sauve l'état, le remplace par `signext16(e[2])`, tire, puis restaure : **déterministe** pour (n, k, graine).

### 1.3 Déroulé d'une partie

1. Entrée (`1010:0000`) : ouvre `bowling.dat`, charge fond `SHAP 101` + palette `SHPL 101`, boutons, sons `1000`–`1010`, `STRL`/`TARG`/`UNIT` (§3), tire un jeu d'animations de quilles (`1010:3adc(0)`), lit l'opération/niveau/progrès du joueur (`4cc4[op]`, `4cd0[5·op+niveau]`), recalcule le sous-type (`1010:2aef`) et dessine le rang et les strikes.
2. Choix de l'opération (`1010:0959`) et du niveau (`1010:0b5d`) : voir §2.1. Les deux **réinitialisent** la file de reprise, l'historique et la musique (`1010:0e23`).
3. **GO!** (`1010:0a70`, cas 1) : joue `SND 1007`, bascule GO → STOP, grise les 6 opérations et les niveaux (flags `|= 2`), `4c98 = 0`, tire le 1er problème (`1010:0f18`), `4ca8 = tick + 0332`, `4ca6 = 1`, lance le MIDI `0338` en boucle si la musique est active (`DS:2d64 ≠ 0`).
4. Chaque problème (`1010:0f18` → `1010:108d`) : voir §1.4–1.7. Réponse : clic dans une des 4 cases (callback `1010:09a4`, param 1–4) ou touche `1`–`4` (`1010:2b64`, seulement si `4ca6 ≠ 0`).
5. **Bonne réponse** : (`4d32 = 1` pendant le traitement, ce qui suspend le test de temps) la bonne case est mise en surbrillance (`1010:3923`), l'animation de quilles n° `4c98` du jeu courant est jouée (`1010:3c8e`), si c'était une reprise on dépile la file (`4c5a--`), `4c98++` ; si `4c98 == 10` → **strike** (§1.9), sinon problème suivant.
6. **Mauvaise réponse** : la case cliquée passe en surbrillance (couleur palette `0x7e` = (105,197,185) au lieu de `0x1b` = (246,234,164)), `SND 1000`, la bonne case est montrée (`1010:3923`), attente de **90 ticks** (`1088:10d2(0x5a)`, interruptible), puis nouveau problème. Si le problème était neuf (`4c5c == −1`) il est **mis en file de reprise** avec le compte à rebours 6 et la case cliquée. **Aucune pénalité** : `4c98` n'est pas décrémenté, pas de perte de temps autre que l'attente.
7. **STOP** (cas 2) : `1010:3d9d(1)` arrête partie/musique, restaure GO. **Aide** (cas 3) : `SND 1008`, arrête la partie et lance l'écran d'aide de Polly (`1010:4363`, `POLLY.DAT`). **Sortie** (cas 4) : arrête, `1010:0934` (réaction de Gus au hasard `rand(0..14)` via `1010:44ef` puis `1010:3fa3(0)` = retour au hub).
8. **Temps écoulé** (`Tick` cas 0, `4ca8 ≤ tick` et `4d32 == 0`) : `1010:2a83` : arrête la partie, `SND 1022`, réaction de Gus « triste » `GUS.DAT` n° `31 + rand(0..7)` (§4.4), nouveau jeu de quilles aléatoire. Les strikes déjà obtenus restent acquis.
9. Barre de temps (rect `(162,122,409,138)`, `SHPL 1008` formes 1–2, 247×16) : demi-largeur de la partie masquée `= 121 − 121 × restant / 0332` (division entière), dessinée symétriquement depuis les deux bords ; recalculée à chaque tick de scène (`Tick` cas 0).
10. Durée : `0332` ticks (tick ≈ 1/60 s, `timeSetEvent` 17 ms, engine.md §4.6). Défaut **10 800 = 180 s**. L'écran `1080` (nom du joueur ; ouvert depuis l'étiquette de nom, `1010:0bc5` param 1) lit un champ numérique, accepte **1–999** (`≤ 0x3E7`) et stocke `valeur × 60` (`1080:0952`–`0956`). Corrige engine.md §7.1 (« 3 h »).

Strikes : les 10 pions du strike zone (`SHPL 1100`, 10 formes 16×14 aux rects `1108:056c + 8k`, k = 0…9) sont redessinés par `1010:2823` : `4d0e` formes pleines, les autres effacées.

### 1.4 Choix du sous-type et du problème (`1010:0f18`)

**Sous-type `4c58`** :
- niveaux 1–4 (`4d0c ≤ 3`) : `4c58 = 4cb8[op]`, un **index plat** dans les tables de l'opération (les sous-types des niveaux 1 à 4 mis bout à bout) ;
- bonus (`4d0c = 4`) : `4c58 = rand1(BONUS_N[op])` avec `BONUS_N = [9, 11, 10, 8, 13, 4]` (`1108:0436`) : un sous-type quelconque parmi **tous ceux des 4 niveaux**.

**Progression du sous-type dans un niveau** : `1108:0479 + 4·op` → table de seuils par opération (octets ; `0x0a` = 10 clôt un niveau, le bonus a son propre `0a`) :

| Op | Seuils (octets à `1108:043c…`) | Sous-types par niveau (L1 / L2 / L3 / L4 / bonus) |
|---|---|---|
| + (`043c`) | `5 10 | 5 10 | 5 10 | 3 6 10 | 10` | 0–1 / 2–3 / 4–5 / 6–8 / (aléatoire 0–8) |
| − (`0446`) | `2 4 6 10 | 5 10 | 5 10 | 3 6 10 | 10` | 0–3 / 4–5 / 6–7 / 8–10 |
| × (`0452`) | `3 5 10 | 2 10 | 4 10 | 4 7 10 | 10` | 0–2 / 3–4 / 5–6 / 7–9 |
| ÷ (`045d`) | `5 10 | 10 | 5 10 | 4 7 10 | 10` | 0–1 / 2 / 3–4 / 5–7 |
| = (`0466`) | `5 10 | 3 6 8 10 | 2 4 7 10 | 3 6 10 | 10` | 0–1 / 2–5 / 6–9 / 10–12 |
| ≈ (`0474`) | `10 | 10 | 10 | 10 | 10` | 0 / 1 / 2 / 3 (un par niveau = bande 0–3) |

Règle : dans un niveau, le sous-type passe au suivant quand `4d0e` (strikes) atteint le seuil (`1010:29b1` : `si seuil[4cb8[op]] == 4d0e alors 4cb8[op]++`). Exemple + niveau 4 : sous-type 6 pour 0–2 strikes, 7 pour 3–5, 8 pour 6–9. Au changement de niveau, `1010:2aef` recalcule `4cb8[op]` : repart de 0, saute autant de `0x0a` que de niveaux inférieurs, puis avance tant que `seuil[i] ≤ 4d0e`.

**Indice du problème `4c56`** : chaque sous-type est un petit espace de problèmes **énumérés** de 0 à `CNT` (octets à `1108:04c8 + 4·op` → `0491` +, `049a` −, `04a5` ×, `04af` ÷, `04b7` =, `04c4` ≈) :

| Op | `CNT` par sous-type (valeur max de l'indice ; nombre de problèmes = valeur + 1) |
|---|---|
| + | 40, 54, 59, 59, 49, 49, 63, 63, 255 |
| − | 35, 17, 34, 41, 59, 59, 59, 65, 71, 63, 255 |
| × | 32, 21, 65, 25, 90, 47, 71, 143, 255, 215 |
| ÷ | 47, 48, 107, 56, 44, 82, 255, 255 |
| = | 35, 35, 25, 97, 57, 255, 143, 143, 143, 143, 107, 107, 107 |
| ≈ | recalculé à l'entrée par `1010:306c` : **182, 154, 142, 190** (niveaux 1–4 ; le segment contient 191 en repli, voir la correction n° 1 de « Implémentation (logique) ») |

Tirage (`1010:0f18`, partie « problème neuf », `4c5c == −1`) :
```
si CNT[op][sub] < 4c54 : 4c54 = 0 ; effacer les 256 drapeaux 4b54      // tout le sous-type a été posé
répéter 4c56 = rand(CNT[op][sub]) tant que 4b54[4c56] ≠ 0
4c54++ ; 4b54[4c56] = 1
```
Particularité : l'historique est **indexé par l'indice seul**, pas par (sous-type, indice), et n'est remis à zéro que quand le compteur dépasse `CNT` du sous-type **courant** (ou au changement d'op/niveau, `1010:0e23`).

### 1.5 File de reprise (« retries »)

À chaque nouveau problème (`0f18` entre) : `4c5c = −1`, tous les compteurs de la file sont décrémentés. Si `4c6c[0] ≤ 3` **et** `rand(4c6c[0]) == 0` (probabilité 1/(c+1), certaine à 0), le **plus ancien** problème manqué est reposé : `4c56 = 4c5e[0]`, `4c58 = 4c7a[0]`, `4c5c = n−1`, l'entrée est recopiée en fin de file avec compteur remis à **6** et la file est décalée d'un cran (n inchangé). Une bonne réponse à un problème repris retire l'entrée (`4c5a--`). Une mauvaise réponse à un problème **neuf** ajoute `{4c56, 4c58, case cliquée, 6}` (7 entrées au plus). Une mauvaise réponse à une reprise ne modifie pas la file.
Effet : un problème manqué revient 3 à 6 problèmes plus tard. Le problème repris est régénéré à l'identique (mêmes opérandes), les **distracteurs sont retirés au sort à nouveau**, et la bonne réponse est placée dans une case **autre que celle cliquée à tort** : `4c96 = (case_cliquée + 1 + rand1(3)) & 3` (problème neuf : `4c96 = rand1(4)`).
La file est vidée à chaque changement d'opération/niveau/fin de niveau (`4c5a = 0` dans `1010:0e23`) mais **pas** au GO/STOP/temps écoulé.
Cas dégénéré (file vide, `4c6c[0]` périmé ≤ 3 et tirage nul) : sans effet visible (`4c5c` reste −1).

### 1.6 Opérandes (`1010:1486`) et réponses (`1010:2150`, appelé par `1010:108d`)

Notation : `N = 4c56`. `Q(A, D, B, N) = (N div D + B, N mod D + A)` (fonction `1010:20c1`). Résultat dans `e[0..3]` (mots), `e[2] = e[3] = 0` au départ. `sb(x)` = octet signé de `DS:x`.

**Addition** (`« %d + %d ="` ; sous-types 6 et 7 : `« %d + %d + %d ="`, formats `1108:0340`/`034a`) :

| sub | opérandes | plages |
|---|---|---|
| 0 | `N<36` : `(a,b)=Q(0,6,0,N)` ; sinon `a=b=N−30` | 0–10 |
| 1 | `Q(6,5,0,N)` | a 0–10, b 6–10 |
| 2 | `Q(10,10,0,N)`, si `b>14` : `b+=5` | a 0–5, b 10–14 ∪ 20–24 |
| 3 | `Q(30,10,0,N)`, si `b>34` : `b+=5` | b 30–34 ∪ 40–44 |
| 4 | `Q(15,10,6,N)`, si `b>19` : `b+=5` | a 6–10, b 15–19 ∪ 25–29 |
| 5 | `Q(15,10,11,N)`, idem | a 11–15 |
| 6 | `(a,t)=Q(0,16,1,N)`, `(b,c)=Q(0,4,5,t)`, `c=2c+3` | a 1–4, b 5–8, c 3,5,7,9 |
| 7 | `(a,t)=Q(0,16,2,N)`, `(b,c)=Q(10,4,6,t)` | a 2–5, b 6–9, c 10–13 |
| 8 | `a=500+(((N×300) & 0xFFFF)>>8)` (**débordement 16 bits**, plage 500–755), `b=100+(((N×90000)>>8) mod 300)` ; si `a` et `b` de même parité, on échange | ≈ 100–755 |

**Soustraction** (`%d - %d =`) : on calcule `(a,b)` puis on **échange pour avoir a ≥ b** ; réponse `a − b`.
| sub | calcul |
|---|---|
| 0 | `Q(0,6,0,N)` |
| 1 | `N<12` : `Q(6,4,0,N)` ; sinon `a=N−12, b=10` |
| 2 | `Q(6,7,6,N)` |
| 3 | `Q(11,14,0,N)` |
| 4 | `(a,t)=Q(0,12,2,N)` ; `b = t div 4 + (t mod 4)×10 + 17` |
| 5 | `(a,t)=Q(0,15,2,N)` ; `b = t div 5 + (t mod 5)×10 + 57` |
| 6 | `(a,t)=Q(0,10,3,N)` ; `si a>5 : a++` ; `b=20t+20` |
| 7 | `(a,t)=Q(0,11,3,N)` ; `si a>5 : a++` ; `b=20t+10` |
| 8 | `(a,t)=Q(0,9,11,N)` ; `si a>14 : a++` ; `b=10t+20` |
| 9 | `(a,t)=Q(0,8,11,N)` ; `si a>14 : a++` ; `b=10t+120` |
| 10 | comme addition sub 8 (500–755 / 100–399), sans échange de parité |

**Multiplication** (`%d x %d =` ; sub 9 : `%d x %d x %d =`, `e[2]=1` par défaut) :
| sub | calcul |
|---|---|
| 0 | `Q(0,11,0,N)`, `a==2 → a=10` (a ∈ {0,1,10}) |
| 1 | `Q(0,11,0,N)`, `a = (a==0 ? 2 : 5)` |
| 2 | `Q(0,11,3,N)`, `a>4 → a++` |
| 3 | `Q(0,13,11,N)` |
| 4 | `Q(0,13,6,N)` |
| 5 | `(a,b)=Q(13,12,0,N)` ; `a = sb(0xA66+a)` ∈ {1,2,5,10} (table `1,2,5,10,50` à `1108:0a66`) |
| 6 | `Q(0,9,3,N)` ; `b = 10b+20` |
| 7 | `(a,b)=Q(0,12,0,N)` ; `a=10a+10`, `b=10b+10` |
| 8 | `Q(68,32,2,N)` (a 2–9, b 68–99) |
| 9 | `(a,t)=Q(0,36,2,N)`, `(b,c)=Q(4,6,3,t)` |

**Division** (`%d Ö %d =` : l'octet `0xD6` est le signe ÷ de la fonte du jeu) : 1486 produit `(d, q)` (diviseur, quotient) ; **2150 (i=0) transforme** `e = (d×q, d)` et `réponse = q`. Donc affiché `dividende ÷ diviseur`.
| sub | calcul de (d, q) |
|---|---|
| 0 | `N<8` : `d=sb(0xA6B+N)`, `q=sb(0xA73+N)` (tables `2,4,8,2,3,6,3,9` / `4,2,1,3,2,1,3,1`) ; sinon `Search20ec(0xA2D,5)` |
| 1 | `Search20ec(0xA3C,7)` ; si `6<N<14` : `q++` |
| 2 | `(d,q)=Q(1,12,3,N)` ; `d<7 → d=sb(0xA63+d)` ∈ {1,2,5,10}, `q ×= 100 div d` ; `d>9 → d++` |
| 3 | `(d,q)=Q(2,19,0,N)` ; `d=sb(0xA67+d)` ∈ {2,5,10} ; `q ×= 10 div d` |
| 4 | `(d,q)=Q(1,15,0,N)` ; `d=sb(0xA68+d)` ∈ {5,10,50} ; `q ×= 50 div d` |
| 5 | `Search20ec(0xA51,7)` |
| 6 | `(d,q)=Q(0,64,2,N)` ; `q += (d+99) div d` |
| 7 | `(d,q)=Q(0,64,6,N)` ; idem |

`Search20ec(table, n)` (`1010:20ec`) : table de triplets `(seuil, x, y)` ; premier `i` tel que `seuil[i] > N` : `d = x_i`, `q = N − seuil[i−1] + y_i`. Tables (triplets `seuil, x, y`) : `0xA2D` = `(8,0,0)(21,1,0)(28,2,0)(38,5,1)(48,10,1)` ; `0xA3C` = `(0,0,0)(5,2,6)(14,3,1)(24,4,1)(29,5,6)(39,6,1)(49,10,1)` ; `0xA51` = `(0,0,0)(37,2,13)(58,3,13)(70,4,13)(77,5,13)(81,6,13)(83,7,13)`. NB : des diviseurs 1 apparaissent (sub 0 : N 8–20 ; sub 2 : `d=1`).

**Équivalence** (graphique ; détail §1.7) et **Estimation** (§1.8).

**Réponses** (`1010:2150`, `4c9a[0..3]`). Bonne réponse (`i = 0`) : + : `a+b+c` ; − : `a−b` ; × : `a·b·c` ; ÷ : `q` ; = et ≈ : §1.7/1.8. Distracteurs (`i = 1..3`) : on perturbe un opérande ou la réponse :
```
perturber(v) : si v <= 3 : rand1(4)+1  (1..4)  sinon rand(v) + v/2 (v/2 tronqué)   // intervalle [v/2, 3v/2]
+ : idx = (e1<e0 ? 1 : 0) ; (si sub∈{6,7} et e[idx] > e2 : idx=2)  → copie[idx] = perturber(e[idx]) ; réponse = somme de la copie
− : si e0 <= 3 ou trunc(3·e1/2) > e0 : réponse[i] = perturber(réponse[0])   sinon copie[1] = perturber(e1), réponse = e0 − copie1
× : idx = (sub>=9 ? 2 : 1) ; (copie[0]=1 si e0==0) ; copie[idx] = perturber(e[idx]) ; réponse = produit
÷ : réponse[i] = perturber(réponse[0])
```
Chaque distracteur est refait (`1010:108d`) tant qu'il est **égal à une réponse déjà posée** (`10a8:1341`) ou **> 19 999**. Enfin la bonne réponse (case 0 au départ) est **échangée** avec la case `4c96`. Les nombres sont affichés en `"%d"` (pas de séparateur de milliers).

### 1.7 Équivalence de fractions (op 4)

Question = image (sous-types 0–1) ou **masque binaire** de cellules (8, 12 ou 24 cellules), dessiné par `1010:2bb0` ; réponses = images, masques ou fractions « k/8 », « k/12 », « k/24 » (texte `%d/%d`, `1010:12ad`).

Helpers : `mask(n,k,r)` (`1010:2e4b`) = `k` bits contigus à partir du bit 0, **tournés de r** vers le haut dans n bits (`k=0 → 0`, `k=n → plein`) ; `popcnt(n,x)` (`2f08`) ; `scatter(n,k,graine)` (`1010:2fb8`) : si `k<2` ou `k ≥ n−1` : `mask(n,k,graine)` ; sinon, RNG réinitialisé à `signext16(graine)`, répéter : pour i = 0…n−1 (restant `R = n−i`, à poser `k`) : poser le bit i si `R == k` ou `rand1(2) ≠ 0`, jusqu'à avoir posé k bits ; rejeter (et relancer) si `rejet(sub,k,m)` : sous-types 2–5 seulement, rejet si `k ≤ 1` ou `k ≥ 7` ou si le masque 8 bits a **≤ 3 plages** de bits identiques (`1010:2f34`) ; puis RNG restauré.

| sub | question (`e`) | réponse correcte (i = 0) | distracteurs |
|---|---|---|---|
| 0 | image `e0 = N` (36 images `SHPL 1800` formes 1–36, forme `N+1`) | `e0` (la même image) | image hors de la **bande** de la bonne : `rand(CNT)` jusqu'à `< lo` ou `≥ hi` |
| 1 | idem | image de la **même bande** : `lo + rand1(hi−lo)`, ≠ `e0` (sauf e0 = 0) | idem |
| 2 | `N<24` : `k=2(N div 8)+2`, `r=N mod 8` ; sinon `k=8N−192` (0 ou 8) ; `e0 = mask(8,k,r)` | `mask(8,k,r')`, `r' = rand1(8) ≠ r` | `k'` tiré comme à la question (`rand1(26)`) ≠ k, rotation au hasard |
| 3 | `N<56` : `k=N div 8+1, r=N mod 8`, `e0=mask(8,k,r)`, `e2=1` ; `56≤N<96` : `k=(N−56) div 8+2`, graine `(N−56) mod 8`, `e0=scatter(8,k,graine)`, `e2=0` ; `N≥96` : `k=8N−768` (0/8), `e0=mask` | **même k**, représentation inverse : `e2 = 0` → `mask(8,k,rand1(8))` ; `e2 ≠ 0` → `scatter(8,k,rand1(8))` | `k'=popcnt(8, rand1(256)) ≠ k`, idem |
| 4 | `N<56` : `k=N div 8+1, r=N mod 8` ; sinon `k=8N−448` (0/8) ; `e0=mask(8,k,r)` | texte **k/8** | `rand(8) ≠ k` |
| 5 | `e0 = N` (masque brut 8 bits), `k=popcnt(8,N)` | k/8 | `rand(8) ≠ k` |
| 6, 7 | `k=N div 12+1`, graine `N mod 12`, `e0=scatter(12,k,graine)` | sub 6 : `e0` **tourné de 4 ou 8 cellules** (`rand1(2)+1` × 4, rotation circulaire 12 bits) ; sub 7 : masque 12 cellules de même k (`scatter(12,k,rand1(12))`) | masque : `k'=popcnt(12, rand1(144)) ≠ k` |
| 8, 9 | idem 6, 7 (question 12 cellules) | texte **k/12** (sub 9 : fraction **simplifiée** par 2 et 3, `1018:064d(3,…)`) | `rand1(12)+1 ≠ k` |
| 10, 11, 12 | `(t,r0)=Q(0,3,0,N)` ; `cx=1, s=0`, tant que `t>s : cx++, s+=cx` ; `k = 24−(3cx−3)−r0`, graine `3(s−t)` ; masque **24 cellules** (8 lignes × 3) stocké en `4d10` : `mask(24,k,graine)` (sub 10, 11) ou `scatter(24,k,graine)` (sub 12) | texte **k/24** (sub 11, 12 simplifiée) | `rand1(24)+1 ≠ k` |

Bandes des images 0–1 (octets à `1108:0a7b`) : `[0,1) [1,8) [8,22) [22,26) [26,30) [30,33) [33,36)` : 0 = assiette vide ; 1–7 = pizza entière (2/2, 4/4, 3/3 …) ; 8–21 = moitié ; 22–25, 26–29 = quarts ; 30–32, 33–35 = tiers (rendu `SHPL 1800` vérifié).

### 1.8 Estimation (op 5, `≈`)

Ressources chargées une fois à l'entrée par `1010:306c` pour 3 catégories `k` : 0 longueurs, 1 durées, 2 poids : unités = `STRL 1000+k` + `UNIT 1000+k` ; objets/évènements = `STRL 1005+k` + `TARG 1005+k` (formats §3). La question est `« About how many <unité> <long|tall|wide | does it take|pass before|are you|pass while|pass | …weigh> <objet> ? »` (formats `1108:038c`, `03b0`, `03d1` ; mots à `0aeb…0b26`), la réponse est un **entier** : `(cible + unité/2) div unité`.

Précalcul (`1010:306c`) :
1. Enregistrements `(n° objet 1-based, colonne, valeur)` triés par valeur croissante (`qsort` MSC `1000:7376` ; **ordre des ex æquo non reproduit**, sans effet sur les réponses). Longueurs : un enregistrement par valeur **non nulle** des 3 colonnes (colonne = long/tall/wide) ; durées : colonne = 2e u32 (1–5, choix de la phrase) ; poids : un par objet.
2. Pour chaque unité `q` de valeur `U` et chaque **bande** `j` = 0–3 (= niveau 1–4) : multiplicateurs `lo = [1,5,20,20]`, `hi = [20,50,100,9999]` (mots à `1108:0ab3`/`0abb`) : `lo_idx` = nombre de cibles `< U·lo[j]` ; `hi_idx` = (premier indice de cible `≥ U·hi[j] + U/2`, recherche entamée en `lo_idx−1`) `− 1` ; effectif `cnt[q][j] = hi_idx − lo_idx + 1`, **forcé à 0** pour les longueurs si (`q<9` et `j=3`) ou (`q>8` et `j<2`) et pour les poids si (`q<6` et `j=3`) ou (`q>5` et `j<2`).
3. `T[j][k] = Σ_q cnt[q][j]` : longueurs `465 321 267 141`, durées `55 34 15 63`, poids `98 57 67 77` (j = 0…3) ; `CNT[5][j] = Σ_k min(T[j][k], 64) − 1` = **182, 154, 142, 190**.

Problème (`1010:1486` cas 5, sous-type = bande `j`) : parcourir `k = 0,1,2` en cumulant `min(T[j][k],64)` jusqu'à dépasser `N` ; indice local `idx = N − cumul_précédent` (si le quota est plafonné à 64 : `idx = ((N − cumul) × T[j][k]) >> 6`) ; parcourir les unités en cumulant `cnt[q][j]` jusqu'à dépasser `idx` ; `e0 = q`, `e1 = lo_idx[q][j] + (idx − cumul_avant_q)` (indice dans la liste triée), `e2 = k`. Bonne réponse : `ans = (valeur + U/2) div U` et `e3 = min(3, ⌊log_M ans⌋)` (`−1` si `ans = 0`) avec `M[k] = [4, 6, 4]` (mots `1108:033a`). Distracteurs (« erreurs d'ordre de grandeur ») : `s = (e3 + i) & 3` ; `ans[i] = ans[0]` multiplié par `M[k]` (si `e3 < s`, `s − e3` fois) ou **divisé** (si `s < e3`, `e3 − s` fois) ; rejetés si égaux ou > 19 999.
Exemples : `(≈, bande 0, N=0)` → « combien de *pinheads* de large mesure *a toothpick* » : réponse **1** ; `(bande 3, N=189)` → « combien de *kilograms* pèse *a cow* » : **686**.

### 1.9 Strike et fin de niveau (`1010:28b9`, `29b1`)

Après le 10e bon : `3d9d(0)` (arrêt de partie), `4d0e++`, `4cd0[5·op+niveau] = 4d0e`, animation de **strike** choisie `rand1(49)` ou, si `4d0e ∈ {3,6,10}`, `49 + rand1(20)` (= table de 70 ids `SCR` à `1108:0974` : 0–48 « courants » 10200…17900, 49–68 « spéciaux » 10000, 10100, 10800…), jouée par `1010:407a`/`397f` avec `SND 1020` (5,5 s, fanfare) puis `SND 1011` ; strike zone redessiné ; `29b1` (progression du sous-type, §1.4) ; si `4d0e == 10` **niveau terminé** (§2.2) et bannière `1010:4140` ; sinon, une fois sur 3 (`rand1(3) == 0`), réaction de Gus `GUS.DAT` n° `rand1(31)`. Dans tous les cas nouveau jeu de quilles aléatoire (`3adc(0)`), GO redevient actif (clignote).

## 2. Progression

### 2.1 Sélection

- **Opérations** (group 0, 6 boutons, `SHPL 1030` 6 × 2 états, callback `1010:0959`) : `+` `(41,125)-(76,158)`, `−` `(77,125)-(112,158)`, `×` `(41,159)-(76,189)`, `÷` `(77,159)-(112,189)`, `=` `(41,190)-(76,223)`, `≈` `(76,190)-(112,223)`. Clic : `op = param − 1`, `niveau = 4cc4[op]`, `4d0e = 4cd0[5·op+niveau]`, `SND 1000+param` (nom de l'opération), `0e23(2)`.
- **Niveaux** (group 3, `SHPL 1010`) : 4 boutons ronds 28×28 `(228,262) (255,247) (285,247) (310,262)` + « BONUS » `(253,272)-(313,295)` ; callback `1010:0b5d` : `niveau = param − 1`, `4cc4[op] = niveau`, `4d0e = 4cd0[…]`, `SND 1009` (boutons 1–4, 0,08 s) ou `SND 1010` (bonus). Le niveau courant est surligné ; **le bonus n'est actif que si les 4 bits de niveau de l'opération sont à 1** (`(mask >> 5·op) & 0xF == 0xF`, `1010:0ea1`). Pas de changement possible pendant une partie (flags `|= 2`).
- Opération/niveau mémorisés par joueur ; à l'entrée on restaure l'op du bouton marqué (flag 4, par défaut `+`).

### 2.2 Montée de niveau (`1010:29b1`)

Quand `4d0e == 10` : `1010:3fdf` fait `masque |= 1 << (5·op + niveau)` (u32 `DS:5ba8` et écriture dans l'entrée du joueur du roster : `idx × 37 + 8` avec `idx` = n° de joueur **1-based** `DS:1e90`, soit l'octet 33 de l'entrée de 37 octets de engine.md §7.1) ; `4cd0[5·op+niveau] = 0` ; `niveau++` ; si `niveau == 4` et que les 4 bits de niveau ne sont pas tous posés, ou si `niveau > 4` → `niveau = 0` ; `4cc4[op] = niveau`, `4d0e = 4cd0[nouveau]`, recalcul du sous-type, `0e23(2)` (le rang est redessiné par `3f39`). Le bonus terminé pose le bit `5·op+4` puis repart au niveau 1.
Un joueur peut rejouer un niveau déjà fait ; le bit reste posé.

### 2.3 Variables du roster (scène 1, entier **big-endian** dans le fichier)

| Offset (rec. joueur) | DS | Contenu établi |
|---|---|---|
| 2, 6 × u16 | `4cb8` | **index plat du sous-type** par opération (cf. §1.4) |
| 14, 6 × u16 | `4cc4` | niveau courant par opération (0–4) |
| 26, 30 × u16 | `4cd0` | strikes (0–9) du niveau `5·op + niveau` |
| 86, u16 | `4d30` | Polly a déjà présenté le jeu (choisit l'animation d'aide `4e84` si 0, `4f1a` sinon, `1010:4363`) |
| u32 de l'entrée du joueur | `5ba8` | masque : bit `5·op + niveau` (niveaux 0–3, bit 4 = bonus) |

### 2.4 Rang (25)

`1018:0518` (appelé par `1010:3f39`, `1078:0709`, `1078:0860`) : `rang = 1 + Σ_{op=0..5} Σ_{niveau=0..3} bit(5·op+niveau)` (les **bits bonus ne comptent pas**). Chaîne n° `rang` (1-based) de `STRL 5000` : **25 grades** (« Rookie Roller » … « Strike Master »), identiques à la table du manuel v2 (liste : §3.3). Affiché au rect `(205,231)-(357,246)` (fonte `NCSclB14`/`4a10`). Le rang 25 = les 24 niveaux terminés.

## 3. Formats des ressources `BOWLING.DAT`

### 3.1 `UNIT` (3 : ids 1000, 1001, 1002)
Tableau de `u32` big-endian : taille de chaque **unité** de la `STRL` du même id. Longueurs (`UNIT 1000`, 14, unité = **1/100 de pouce**) : pinheads 6, peas 30, sugar cubes 50, marshmallows 125, baseballs 350, grapefruits 500, faces 800, basketballs 1000, beachballs 2400, inches 100, feet 1200, yards 3600, centimeters 40, meters 3960. Durées (`UNIT 1001`, secondes) : seconds 1, minutes 60, hours 3600, days 86400, months 2 628 000, years **31 536 000** (365 j, le manuel dit 365,25). Poids (`UNIT 1002`, 6 unités + …, unité = **1/1000 d'once**) : pennies 100, new pencils 400, eggs 2000, cans of soda 12 800, 1/2 gallons of milk 70 000, cats 112 000, ounces 1000, pounds 16 000, grams 40, kilograms 35 000.

### 3.2 `TARG` (3 : 1005, 1006, 1007)
`u32` big-endian, un groupe par objet de la `STRL` du même id : `TARG 1005` = 81 × 3 (long, tall, wide ; 0 = non applicable ; mêmes unités que `UNIT 1000`), `TARG 1006` = 58 × 2 (durée en secondes ; **numéro de phrase 1–5** : 1 « does it take », 2 « pass before », 3 « are you », 4 « pass while », 5 « pass »), `TARG 1007` = 61 × 1 (poids, unités de `UNIT 1002`). Le code ne lit jamais d'autre octet.

### 3.3 `STRL` (8 : 1000, 1001, 1002, 1005, 1006, 1007, 1016, 5000)
Format formats.md. 1000 = 14 unités de longueur ; 1001 = 6 unités de temps ; 1002 = 10 unités de poids ; 1005 = 81 objets (« an eyebrow », « a pick-up truck », « a  string of spaghetti » [double espace], …) ; 1006 = 58 évènements (« to blink your eyes », …) ; 1007 = 61 objets ; **1016** = 5 phrases (« does it take », « pass before », « are you », « pass while », « pass ») **jamais chargée** (le code utilise les copies du segment de données `0afa…0b26`) ; 5000 = 25 rangs : Rookie Roller, Ball Polisher, Twinkle Toes, Gutter Nut, Cereal Bowler, Lane Brain, Alley Duster, Toe Jammer, Spare Ribber, Pin Pal, Spare Splitter, Alley Cat, Bowl Fighter, Slammin' Slider, Bowlmeister, Side Splitter, Steam Roller, Alley Rapper, King Pin, Strikenator, Super Bowler, Pin Crusher, Star Shooter, Pin Wizard, Strike Master.
Les autres textes de l'activité sont dans le segment de données : formats `%d + %d =`… (`0340`–`0386`), phrases d'estimation (`038c`–`03d1`), « LEVEL X » (`041a`, le 7e octet est remplacé par `'1' + niveau`), « BONUS ROUND » (`0422`), mots `long/tall/wide/does it take/…` (`0aeb`–`0b26`), noms de fichiers.

## 4. Mise en page (576 × 432)

### 4.1 Fond et zones (rects `(g,h,d,b)` en pixels)

Fond `SHAP 101` (avec `SHPL 101`, palette de l'écran) : machine à bowling ; les symboles `+ − × ÷ = ≈`, le bouton « GO! », le trophée, les cadres des réponses y sont **dessinés** ; les états actifs sont des formes ajoutées.

| Zone | Rect | Source |
|---|---|---|
| fenêtre du problème | `(160,71)-(411,122)` ; texte centré dans `(170,81)-(401,122)` (fonte `4a20`/`NCSclB14`) | `1108:051c`, `0524` |
| barre de temps | `(162,122)-(409,138)`, `SHPL 1008` | `053c` |
| 4 cases de réponse (boutons) | `(138,142)-(208,196)`, `(212,…)-(282,…)`, `(286,…)-(356,…)`, `(360,…)-(430,…)` (70×54, pas 74) ; texte dans `(140,144)-(206,194)` + 74·i | `0694`, `05bc` |
| GO!/STOP | `(441,108)-(486,153)` (`SHPL 998` : GO normal/actif, STOP normal/actif) | `0714` |
| Aide (visage) | `(457,159)-(492,193)` (`SHPL 1002` formes 1–2) | `073c` |
| Sortie (« EXIT » rouge/vert) | `(64,231)-(109,261)` (`SHPL 1002` formes 3–4) | `0750` |
| Étiquette du nom | `(205,212)-(357,227)` (fond `SHAP 990`, 158×36 ; nom dessiné) | `0870` |
| Trophée Hall of Fame | `(492,111)-(524,144)` | `0884` |
| Gus | `(96,241)-(212,402)` (clic = réaction ; `SHAP 970` 116×161 restaure le fond au retour du Hall of Fame) | `0898`, `0564` |
| Rang | `(205,231)-(357,246)` | `054c` |
| tunnel des quilles | `(396,227)-(488,314)` | `055c` |
| œil clignotant | `(161,253)-(196,273)` (`SHPL 980`, 2 × 25×20) | `0554` |
| strike zone | 10 rects 16×14 : x = 120, 153, 187, 224, 261, 297, 333, 370, 404, 437 (y 38–68, arc) | `056c`–`05b4` |

Groupes de gadgets (`10a0:0000`, 5 groupes à `1108:08bc`, callbacks) : 0 opérations (`0959`), 1 réponses (`09a4`, param 1–4), 2 GO/STOP/aide/sortie (`0a70`, param 1 GO, 2 STOP, 3 aide, 4 sortie), 3 niveaux (`0b5d`, param 1–5), 4 divers (`0bc5` : 1 nom → écran `1080` ; 2 trophée → `4dfc = 1`, scène 10 ; 3 Gus). Couleurs de case de réponse : `SHAP 1007` (masque 1 bit 70×54) rempli de la couleur de palette `0x1b` (crème) ou `0x7e` (turquoise, surbrillance) (`1010:3d0d`).

### 4.2 Sprites (`SHPL`)
`998` GO/STOP (4 × 45×45) ; `1002` aide (35×34, 33×34) et EXIT (45×30, 42×30) ; `1010` niveaux 1–4 (22×22 normal / 28×28 actif) + BONUS (54×18 / 60×23) ; `1030` 6 opérations × 2 états ; `1008` barre de temps (2 × 247×16) ; `1100` 10 pions du strike zone ; `1044` bannière de niveau (312×141 ×2, 116×82, 113×226, 100×26) ; `1800` 60 formes (36 images de pizza pour l'équivalence, parts, signes, beignets…, 47×47 ; formes 37+ = décor et symboles utilisés par `2bb0`) ; `980` œil ; `970`/`990` formes isolées.

### 4.3 Animations `SCR`
- **Quilles** (`1200`–`1499`, 300 scripts) : 30 jeux × 10 scripts. `1010:3adc(0)` tire un jeu `k = rand1(30)` (`n = 10k+1`), `base = 1200 + 100·⌊(n−1)/100⌋`, `dizaine = 10·(k mod 10)`. Les 10 scripts `base+dizaine+i` (i = 0–9) sont chargés dans les 10 descripteurs `1108:4ea2…` (`SHPL` `base`, décalage `dizaine`, `SNDL` `base+dizaine` ; scr.md). La bonne réponse n° `i` joue le script `i` (`1010:3c8e`, hook 0 `1010:3bfc` : attend la fin de l'image puis rejoue le 1er son du `SNDL`). Zone `(406,227)-(488,314)` (décalé de ≈ 10 px). Rendu vérifié : pions entrant dans le tunnel, boule, pions renversés.
- **Strikes** : 69 scripts `SCR 10000`–`18100` (table `0974`, §1.9), plein écran `SHPL` de même id, chacun avec son `SNDL` (voix de Gus 14xxx, fanfares).
- `SCR 1600`–`1760` (9 scripts, `SNDL` identique 14387–14389) : non référencés par le segment 1010 (hypothèse : bruits de quilles partagés des banques `100`).
- **Gus (`GUS.DAT`, 54 `SCR`)** : `1010:44ef(n)` : `SCR 22000 + 100n` (n 0–14, réactions au départ du jeu) ; `1010:457a(n)` : `n<31` → `30000 + 50n` (31 réactions de joie, 0–30), `n ≥ 31` → `24950 + 50(n−31)` (8 réactions de dépit, 31–38). Clic sur Gus : `457a(4|10|20)` au hasard (octets `0a2a`), Ctrl+Maj+clic : `457a(15)`.
- **Polly (`POLLY.DAT`)** : aide (bouton visage) : `1010:4363`, groupe de boutons `1108:3286`, première visite `SCR` descripteur `4e84` puis `4f1a` ; menu de sujets `1010:0c74` (param 1 ferme, autres : descripteur `4fe2 + 0x32·(param−1)`, 13 au plus) ; Polly se tait 300 ticks après (`Tick` cas 3). Détail des sujets : non relevé (§9).
- Repos (`Tick` cas 2) : l'œil clignote toutes les `120 + rand(0..180)` ticks (état 1 pendant 7 ticks) ; (cas 4) GO clignote toutes les 20 ticks tant que GO est actif et non pressé.

### 4.4 Rôles
Gus = le gorille qui lance (réactions, strike, dépit au temps écoulé, clic sur lui) ; Polly = aide (écran d'explications) ; pas de commentaire sur la réponse donnée.

## 5. Sons

`\0SND` de `BOWLING.DAT` : 168 (WAVE PCM 8 bits 11 025 Hz sauf `14423` 22 050 Hz ; MIDI 2000–2007, 2010).

| Id | Durée | Évènement (code) |
|---|---|---|
| 1000 | 0,30 s | mauvaise réponse (`1010:09a4`) |
| 1001–1006 | 0,96 ; 1,22 ; 1,60 ; 1,05 ; 1,45 ; 1,39 s | nom de l'opération cliquée (`1000 + param`, `1010:0959`) : + − × ÷ = ≈ (**hypothèse** : voix « Addition… ») |
| 1007 | 0,94 s | clic sur GO (`0x3ef`) |
| 1008 | 0,83 s | clic sur Aide (`0x3f0`) |
| 1009 / 1010 | 0,08 / 0,37 s | niveaux 1–4 / bonus (`0x3f1`/`0x3f2`) |
| 1011 | 0,33 s | après un strike (`0x3f3`) |
| 1020 | 5,52 s | fanfare du strike (`0x3fc`, `1010:407a`, cyclage de palette pendant la lecture, `1010:42a2`) |
| 1021 | 7,29 s | bannière de niveau/bonus (`0x3fd`, `1010:4140`) |
| 1022 | 2,56 s | temps écoulé (`0x3fe`, `1010:2a83`) |
| MIDI 2000–2003 | – | musique de fond en boucle : `2000 + niveau` (niveaux 1–4), `2000 + rand(0..3)` en bonus ; seulement si la musique est active (`DS:2d64`) ; 2004–2007, 2010 non référencés par le segment 1010 |
| 3044–3052, 10005, 12115… | – | voix/effets des `SCR` de Gus/strikes (via `SNDL`) |
| 14300–14320, 14442–14451 | 0,3–2 s | un son par jeu de quilles (`SNDL base+dizaine`, règle de scr.md `1010:3adc`) |
| 14100–14487 | 0,1–8,7 s | bruitages et **répliques de Gus** des animations de strike (`SNDL` 10000–18100) ; `18100` (8,66 s) |

**Nombres parlés** : **il n'y en a pas**. Le segment 1010 ne joue que des ids constants ou issus d'un `SNDL`/table ; aucune concaténation de mots-nombres. Rien à assembler pour une traduction française de la lecture des problèmes. Pour une version française il faut : retraduire/réenregistrer les voix de Gus/Polly (14xxx, 1001–1008, 1020–1022), les ~ 230 chaînes `STRL` (unités, objets, évènements, rangs ; accords et articles : « about how many X *long/tall/wide* is Y » → phrases à reconstruire entièrement car la grammaire est dans le format `%l1 %s %l2` : **hypothèse** `%l1`/`%l2` = chaîne n° arg de la `STRL` passée), les trois phrases d'estimation, « LEVEL X », « BONUS ROUND » et les formes `SHAP` qui contiennent du texte (« GO! », « STOP », « EXIT », « help », « BONUS »).

## 6. Clavier et souris

- Souris : clic gauche sur les groupes ci-dessus ; le bowling remarque aussi le **maintien** sur GO/STOP (`1010:46b8` : `4df0 = 1`, `4dfa` = bouton, `1098:0437` pour le relâchement) pour arrêter le clignotement. Les boutons droit/milieu (`4b34`) ne sont lus que là (**aucun traitement spécifique**). Ctrl+Maj+clic sur Gus = réaction 15.
- Clavier (`1010:2b64`) : si `DS:2d60 == 1` (saisie de texte dans l'écran `1080`) la touche va à `1080:0581` ; sinon `1`–`4` (`0x31`–`0x34`) répondent **seulement si une partie est en cours** (`4ca6 ≠ 0`), sinon ignorées. Tab/Maj+Tab/Entrée du gestionnaire de gadgets (engine.md §5.2) : applicables aux groupes (hypothèse), Ctrl+Q / Ctrl+V globaux.
- Curseur sablier pendant les chargements (`1008:0620`).

## 7. Écarts avec le manuel v2 (1997)

| v2 (manuel pp. 27–32) | CD v1 (1994) |
|---|---|
| Custom Play (plages A, B, C, Build Sample) | **absent** (aucun code ; seuls le roster et `1080` existent) |
| Timer 1–999 s dans Preferences | présent sous une forme proche (champ de l'écran `1080`, `0332 = s × 60`, défaut 180 s) ; le manuel v2 ne donne pas le défaut |
| 25 rangs, table « Bowling Ranks » | identique (même `STRL 5000`) ; règle de calcul = §2.4 (v2 : « le rang monte à chaque niveau terminé », cohérent) |
| Hall of Fame, certificats, unités d'estimation | identiques (table d'unités du manuel = `UNIT`/`TARG` ; le manuel dit année = 365,25 j, les données 365 j ; « 1 mois = 30,42 j » = 2 628 000 s ✓) |
| Suivi de progrès (% de bonnes réponses, Export) et Boiler Room | **absents** du bowling v1 |
| Bonus après les 4 niveaux | identique (§2.1) |
| « dix bonnes réponses = strike » | identique |

## 8. Plan d'implémentation TS

### 8.1 Module logique pur `src/games/mathemagique/bowling/logic.ts` (sans rendu, testable)

- `Lcg` : `next(n)` (= `rand`), `next1(n)` (= `rand1`), état 32 bits, graine injectable (tests) ; `scatter` utilise une instance locale puis restaure.
- Données : `THRESHOLDS[op]`, `COUNTS[op]`, `BONUS_N`, tables d'octets `0xA2D/0xA3C/0xA51/0xA63–0xA73/0xA7B`, `MULT`, `LO/HI` (copiées du NE ou lues d'un JSON généré par script ; ne pas relire `MATH` à l'exécution).
- `buildOperands(op, sub, n, est?) : number[4]` (§1.6–1.8) ; `buildQuestion(rng, op, sub, n, {previousWrongSlot?}) → { operands, answers[4], correctSlot, text(format), drawing }` (réponses + distracteurs + permutation, §1.6) ; `answerOf`, `perturb`.
- `QuestionPicker` : état `{used:Uint8Array(256), usedCount, retryQueue(≤7), subIndex}` ; `next(op, level, subIndex, rng)` (§1.4–1.5) ; `onAnswer(correct, slot)`.
- `Progress` : `{ strikes[6][5], level[6], subIndex[6], mask, roundCorrect }` ; `onCorrect`, `onStrike` (→ `subIndex`, `levelCompleted`, `maskBit`), `rank(mask)` (§2.4), `bonusUnlocked(op, mask)`, `recomputeSubIndex(op, level, strikes)`.
- `EstimationTables.build(strl, unit, targ)` : `T`, `cnt`, `lo`, `hi`, `counts` (§1.8) ; tri stable par (valeur, n°).
- `GameTimer` : durée en ticks (défaut 10 800), `barHalfWidth(elapsed)` = `121 − floor(121 × remaining / total)`.

### 8.2 Machine à états de scène (`bowling/scene.ts`)
États : `Idle` (GO clignote, œil clignote) → `Playing` (question, `answered`) → `Reveal` (surbrillance, 90 ticks si faux ; animation de quilles si juste) → `Strike` (animation, sons, bannière éventuelle) / `TimeUp` → `Idle` ; sous-états `Help` (Polly), `Login` (`1080`, scène partagée), `HallOfFame` (scène 10 puis retour). Événements : clic groupe, touche 1–4, tick, fin d'animation.

### 8.3 Services moteur nécessaires
Lecture `SCR`/`SNDL` avec jeu de descripteurs (10 pour les quilles, 1 pour Gus/strike) et hook 0 ; lecteur `SHAP`/`SHPL` avec palettes (changement de 2 couleurs pour les cases, cyclage de palette 8 entrées pour la fanfare) ; texte dans la fonte du jeu (`NCSclB14`, `÷` = `0xD6`) ; sons WAVE + MIDI en boucle ; ticks 60 Hz ; persistance roster (`4cb8`, `4cc4`, `4cd0`, `4d30`, masque) ; gadgets (groupes, états, clignotement) ; saisie du nom/durée (écran `1080`) ; Polly (`POLLY.DAT`).

### 8.4 Tests unitaires (valeurs issues du code)
1. RNG : graine 1 → `rand(9)` ×5 = `[1,5,4,8,7]` ; graine 0 → `rand1(4)` ×5 = `[2,3,2,1,3]` ; `rand(0) = 0` sans avancer l'état.
2. Opérandes (aucun aléa) : `(+,0,N=39) = [9,9]` ; `(+,6,63) = [4,8,9]` ; `(+,8,5) = [357,505]` ; `(+,8,255) = [348,542]` ; `(−,4,59) = [49,6]` → 43 ; `(−,10,0) = [500,100]` → 400 ; `(×,5,47) = [10,24,1]` → 240 ; `(×,9,215) = [7,8,9]` → 504 ; `(÷,0,10) → dividende 2, diviseur 1, rép. 2` ; `(÷,2,0) → 100 ÷ 1 = 100` ; `(÷,2,107) → 144 ÷ 12 = 12` ; `(=,2,12)` : `e = [0xF0, 4, 4]` (masque 8 bits, k=4, r=4) ; la bonne réponse est un masque de 4 bits de rotation ≠ 4 (graine 1 : 0x1E) ; `(=,10,35)` : `e = [11,10,9]`, k=10, graine 9, masque 24 cellules `mask(24,10,9)`.
3. Plages : pour chaque (op, sub) et tout `N ≤ CNT`, 4 réponses distinctes, toutes ≤ 19 999, exactement une bonne ; soustraction jamais négative ; division exacte (`dividende mod diviseur = 0`).
4. Tables : `COUNTS` et `THRESHOLDS` ci-dessus ; nombre de sous-types `[9,11,10,8,13,4]` ; `CNT[5] = [182,154,142,190]` calculé depuis les ressources ; `T = [[465,55,98],[321,34,57],[267,15,67],[141,63,77]]`.
5. Estimation : `(bande 0, N=0)` → unité « pinheads », objet n° 4 « a toothpick » col. 2 (valeur 6) → réponse 1 ; `(bande 3, N=189)` → « kilograms », « a cow » (24 000 000) → 686 (N=190 : « a small car » → 914) ; `e3` et distracteurs ×/÷ 4 ou 6.
6. Progression : `rank(0) = 1`, `rank(tous les bits de niveau) = 25`, bits bonus ignorés ; `29b1` : fin de niveau 4 sans les 3 autres bits → niveau 1 ; avec → bonus ; bonus fini → niveau 1 ; seuils (+ niveau 4 : sous-type 6/7/8 à 0/3/6 strikes) ; `recomputeSubIndex(+, 3, 3) = 7`.
7. File de reprise : après une erreur le problème revient entre 3 et 6 questions plus tard ; la bonne réponse n'est jamais dans la case cliquée ; pop sur bonne réponse.
8. Barre de temps : `barHalfWidth` vaut 0 au début, 121 à `total`.
9. Équivalence : `mask(8,2,0)=0x03`, `mask(8,4,4)=0xF0`, `mask(12,…)` rotations, `scatter` déterministe à graine égale, rejet ≤ 3 plages (sub 2–5), bandes d'images.

## 9. Questions ouvertes

1. **Graine** : fonctions `1000:5594`/`1000:5542` non décodées ; seule certitude = dérivée de l'heure.
2. **Ordre des ex æquo du `qsort`** (`1000:7376`) pour les cibles d'estimation : non reproduit (n'altère pas les réponses).
3. Rôles exacts des 5 groupes de gadgets (format des en-têtes `1108:0684…`, flags `206c`/`2068`/`8040`) : déduits des rects et des callbacks ; **l'association aide/sortie ↔ boutons `0750`/`073c`** est déduite des formes (visage, « EXIT »).
4. Hook 0 `1010:3bfc` et séquence `1010:407a`/`42a2`/`4718`/`47ac` (sauvegarde/restauration de fond, cyclage de palette) : décrits fonctionnellement, pixels non vérifiés.
5. Écran d'aide de Polly (`1010:4363`, `0c74`, descripteurs `4fe2…`) : sujets, textes et ordre non relevés ; `POLLY.DAT` à étudier à part.
6. `SCR 1600`–`1760` : usage non trouvé dans le segment 1010.
7. MIDI 2004–2007, 2010 non référencés ici ; `STRL 1016` jamais chargée.
8. Sens exact des drapeaux de groupe (`0x2068`…) et de la navigation clavier Tab/Entrée dans le bowling.
9. Wording : toute copy nouvelle ou modifiée (traduction des 230 chaînes, bannières) est **à valider** avant livraison.

## Écarts avec engine.md / scr.md

1. engine.md §1.4 ligne 1 / §7.1 : `0332 = 10800` n'est pas « 3 h » mais **10 800 ticks (180 s)** réglable 1–999 s (`1080:0956`).
2. engine.md §7.1 : `4cb8` n'est pas « par opération (hypothèse) » vague : c'est l'**index plat du sous-type** ; `4cd0` = strikes (0–9) du niveau ; rang = **1 + nombre de bits de niveau** (bonus exclus), correspondance « non établie » → établie.
3. engine.md §7.1 : le masque est écrit à `idx × 37 + 8` avec `idx` 1-based (cohérent avec l'octet 33 de l'entrée).
4. engine.md §8.4 : « le bonus est de 5 niveaux » : le bonus tire ses problèmes au hasard parmi les sous-types des niveaux 1–4 ; il n'est jouable qu'après les 4 niveaux.
5. engine.md §5.3 : touches 1–4 actives **seulement pendant une partie**.
6. formats.md `TARG/UNIT` : « tableaux de u32 big-endian » précisé (§3) ; `STRL 1016` n'est pas utilisée.
7. scr.md : confirme `3adc` ; la `SNDL` d'un jeu contient un seul son (14300–14320 / 14442–14451).

## Implémentation (logique)

Tâche I1a : logique pure du Bowling, sans scène ni rendu, dans `src/games/mathemagique/game/bowling/` (`index.ts` ré-exporte tout). Tests : `test/mathemagique/bowling-logic.test.ts` (tous les vecteurs de §8.4 ; les tests qui lisent `BOWLING.DAT` sont `describe.skipIf(!hasOriginalFiles)`). Vérification croisée : les 10 854 problèmes de tous les (opération, sous-type, indice) × 2 graines sortent identiques (opérandes, 4 réponses, case, état final du hasard) du port Python de l'étude, corrigé des débordements 32 bits de la correction n° 1.

### Fichiers

| Fichier | Contenu |
|---|---|
| `tables.ts` | constantes copiées du segment : `SUBTYPE_COUNTS`, `STRIKE_THRESHOLDS`, `PROBLEM_MAX`, tables d'octets de × et ÷, bandes d'images, multiplicateurs d'estimation |
| `data.ts` | `loadBowlingData(archive)` : unités, cibles, objets (`STRL`/`UNIT`/`TARG` 1000–1007) et les 25 rangs (`STRL 5000`) ; `parseU32Table` |
| `estimation.ts` | `EstimationTables.build(data)` (précalcul de `1010:306c`), `operands`, `answer`, `prompt`, `problemMax`, `formatEstimationPrompt` |
| `equivalence.ts` | `contiguousMask`, `scatteredMask`, `popcount`, `rotateMask12`, `simplifyFraction` |
| `operands.ts` | `buildOperands` (`1010:1486`) |
| `questions.ts` | `buildQuestion` (`1010:108d` + `1010:2150`), types `BowlingQuestion`, `Choice`, `Prompt` |
| `picker.ts` | `QuestionPicker` (`1010:0f18` : sous-type, historique, file de reprise) |
| `progress.ts` | `BowlingProgress` (variables du roster, strikes, niveaux, masque, rang), `GameTimer`, `backgroundMusicId`, `pickPinSet`, `pinAnimationId`, `gusTimeUpReaction` |

### API pour la scène

```
const data = loadBowlingData(MohawkArchive.parse(bowlingDat));           // une fois à l'entrée
const estimation = EstimationTables.build(data);
const picker = new QuestionPicker(estimation);
const progress = BowlingProgress.load(roster, playerId);                 // sous-types recalculés (1010:2aef)
const timer = GameTimer.fromRoster(roster);                               // 10 800 ticks par défaut
```

- **Choix d'opération / de niveau** : `progress.selectOperation(op)`, `progress.selectLevel(l)` (renvoie faux pour le bonus tant que `bonusUnlocked(op)` est faux), puis `picker.reset()` (= `1010:0e23`). Pas de `reset` au GO!, au STOP ni au temps écoulé.
- **GO!** : `progress.startRound()`, `timer.start(clock.ticks)`, `backgroundMusicId(progress.level, rng)`, `pickPinSet(rng)` pour les quilles (`pinAnimationId(jeu, nᵒ de bonne réponse)` = id du `SCR`), puis la question.
- **Question** : `picker.next({ operation: progress.operation, level: progress.level, subType: progress.subType }, rng)` renvoie un `BowlingQuestion` : `prompt` (`arithmetic` avec `operator`, `operands` et `text` ; `estimation` avec `text` et `parts` ; `picture` = image ou masque de 8/12/24 cellules), `choices[4]` (`number` | `image` | `mask` | `fraction` avec `text`), `correctSlot`, `retry`. `picker.pick(...)` + `buildQuestion(...)` séparément si la scène veut le détail.
- **Réponse** (case cliquée `slot`, touche 1–4 = case 0–3) : `correct = slot === question.correctSlot` ; `picker.answered(correct, slot)` ; si bonne : `timer.suspended = true` pendant l'animation, `progress.correctAnswer()` (vrai au 10ᵉ → `progress.strike(rng)` → `StrikeResult` : `animation` (indice 0–68 de la table de 70 scripts `1108:0974`), `levelCompleted`, `maskBit`, `level`, `gusCheer`) ; si fausse : surbrillance, 90 ticks, nouvelle question.
- **Temps** : `timer.expired(tick)` à chaque tick, `timer.barHalfWidth(tick)` pour la barre (0 à 121).
- **Persistance** : `progress.save(roster, playerId)` puis l'enregistrement du roster par l'hôte (à la fin d'un niveau, à la sortie).
- **Rang** : `progress.rank` (1 à 25) ; le nom est `data.ranks[progress.rank - 1]`.
- **Textes** : aucun texte nouveau. Les nombres sont formatés `"%d"` ; le signe ÷ est le caractère `÷` (la fonte du jeu l'encode `0xD6`, `encodeText`) ; les gabarits d'estimation (`ESTIMATION_FORMATS`) sont ceux de l'exécutable.

### Corrections de l'étude

1. **Estimation, bornes sur 32 bits** (`1010:3592`–`3602` : `IMUL EDX,EAX`, comparaisons non signées `JC`) : `U × multiplicateur (+ U/2)` perd sa retenue au-delà de 2³². Seule la borne haute de la bande 4 déborde (mois et années) : le total des durées de la bande 4 est **63** (et non 65), donc `CNT[5] = [182, 154, 142, 190]` (et non 191), et le vecteur « vache » devient `(bande 3, N=189)` → « a cow » → 686 (N=190 : « a small car » → 914). Les valeurs 182/154/142 et les autres totaux sont inchangés.
2. **Effectifs en octets signés** : `lo`/`hi` sont des octets et l'effectif `hi − lo + 1` est un octet signé (`SUB AL`, `INC AL`, `CBW`). Les effectifs réels (≤ 102) n'atteignent pas 128 : aucun effet, mais une extension à de nouvelles données devra le garder en tête.
3. **Simplification des fractions** (`1018:064d(3, …)`, `1010:12ad`) : réduction par 2 (tant que numérateur et dénominateur sont pairs) puis par 3 ; `k/n` égaux donnent « 1 » ; texte affiché `k` seul si `k = 0` ou `k = n` après réduction (sous-types 9, 11, 12 seulement), sinon `k/n` ; les sous-types 4, 5, 8, 10 affichent toujours `k/n` (« 0/8 », « 8/8 »).
4. **Équivalence, sous-type 6** : la bonne réponse est la question tournée de 4 ou 8 cellules (rotation circulaire sur 12 bits) ; les sous-types 3, 6, 7 (masques éparpillés, 8 puis 12 cellules) tirent leurs distracteurs sur `popcount(8, rand1(256))` / `popcount(12, rand1(144))` (le second, ≤ 144, est lu dans le désassemblage).

### Écarts assumés

- **Historique anti-répétition** : l'original boucle indéfiniment si tous les indices de `0..CNT` sont déjà marqués alors que le compteur n'a pas dépassé `CNT` (possible avec les marques posées par les reprises ou par un autre sous-type au bonus). Ici l'historique est vidé dans ce cas ; tout le reste (indice partagé entre sous-types, remise à zéro quand `CNT < compteur`) est reproduit.
- **File vide** : l'original tire `rand(compteur périmé)` même sans problème en attente, sans effet visible hormis la consommation du hasard ; non reproduit.
- **Sous-types au chargement** : `BowlingProgress.load` recalcule le sous-type de toutes les opérations (l'original ne le fait que pour l'opération restaurée) ; les valeurs sont identiques pour un roster cohérent.
- **Hasard** : le générateur du jeu est `MsvcRandom` (graine injectée) ; les masques éparpillés utilisent un générateur local réamorcé sur `signext16(graine)` (équivalent de la sauvegarde / restauration de l'état global).
- **Boucles de rejet** : plafonnées (5 000 essais pour les distracteurs, 100 000 pour les masques) avec une erreur explicite ; jamais atteintes sur tout l'espace testé.

### Questions ouvertes pour la scène

- Table de 70 ids `SCR` des strikes (`1108:0974`) : `StrikeResult.animation` n'en donne que l'indice (0–68, voir §1.9) ; la table elle-même reste à extraire.
- Réaction de Gus au départ (`1010:0934`, `rand(0..14)`) et au clic : non couvertes ici (sans lien avec les règles).

## Implémentation (scène)

Tâche I1b : `src/games/mathemagique/scenes/bowling.ts` (`createBowlingScene(services, { textInput? })`, enregistrée pour `SceneId.bowling`) et `scenes/bowling-view.ts` (rectangles, ids de ressources, dessin pur). Tests : `test/mathemagique/bowling-scene.test.ts` (vrais `.DAT`). La table des 69 strikes est dans `game/bowling/strike-scripts.ts` (`STRIKE_SCRIPTS`, `strikeScriptId`), lue dans le segment de données de `MATH` (NE 34, `0974`, suivie du mot `0xFFFF`).

### Architecture

- Les attentes bloquantes de l'original sont une file d'étapes (`Step`) : animation de quilles, fanfare, bannière, réaction de Gus, 90 ticks après une erreur. Pendant la file, les groupes de gadgets sont inactifs, les touches 1 à 4 ignorées et le test de temps suspendu (`4d32`).
- Dessin : `base` (fond `SHAP 101`, Gus `SHAP 970`, étiquette `SHAP 990`, formes de niveau au repos) ; `canvas` = `base` + nom, rang, pions, barre, cases, question, œil ; l'écran reçoit des rectangles de `canvas` (les quilles et animations ne sont jamais écrasées). Après une animation plein écran : `repaintAll`.
- Gadgets : opérations (exclusif, forme « active » `1031 + 2i`), niveaux (formes de repos dans `base`, active `1011 + 2k`, bonus désactivé tant que les 4 bits manquent), commandes (GO / STOP à la même zone, aide, EXIT ; GO clignote toutes les 20 ticks au repos), nom / trophée / Gus, 4 réponses (actives seulement en partie). Sons d'appui : 1001 à 1006, 1007, 1008, 1009, 1010.

### Faits établis pendant l'étude de la scène

- **Table d'aide de Polly** (`DS:08f8`, 14 rectangles) : Polly `(420,272,516,432)` puis les 13 sujets dans l'ordre `subject1` à `subject13` = réponses, nom, tunnel, fenêtre du problème, GO / STOP, niveaux, rang, opérations, strike zone, trophée, **Gus (sujet 11, `SCR 21000`)**, EXIT, barre de temps. Les ids `20500 + 50k` de `BOWLING_POLY` sont confirmés (l'animation 21000 est bien dans la zone de Gus). `helpZoneAt` les expose.
- **Formes** : `SHPL 998` GO (998 repos, 999 clair), STOP (1000, 1001) ; `1002/1003` visage (repos / bouche ouverte), `1004/1005` EXIT (rouge / vert) ; niveaux : forme sombre au repos (22×22) et claire plus grande en actif ; opérations : `1030 + 2i` repos (déjà dans le fond), `1031 + 2i` actif ; `SHAP 1008` barre pleine, `1009` barre éteinte (dessinée aux deux extrémités sur la demi-largeur masquée) ; `SHPL 980` : 980 paupière, 981 yeux (état 2 = ouvert, 7 ticks à l'état 1, puis `120 + rand(0..180)`).
- **`SHPL 1044` = lumières de bannière** (pas du texte) : 1044 (312×141) en `(128,62)`, 1046 en `(420,66)`, 1048 en `(38,66)`, tous peints dans les 8 entrées 218 à 225. Fanfare / bannière (`1010:42a2`) : entrées mises à la couleur 27 (crème), formes posées, puis couleurs arc-en-ciel d'origine tournées toutes les 8 ticks tant que le son (1020 ou 1021) joue.
- **Strike** (`1010:28b9`, `407a`, `397f`) : palette de la `SHPL` du strike chargée, fanfare 1020 avec lumières, `SCR 18000` (Gus se prépare), le strike, `SCR 18050` (pose finale) sauf pour `12800`, son 1011, pions, puis (niveau terminé) bannière « LEVEL n » du **nouveau** niveau ou « BONUS ROUND » (non dessinée ici, voir copy), puis réaction de Gus. `SCR 18100` (clip depuis `x = 0`, son 14440) est vraisemblablement l'entrée de Gus.
- **Mise en page de l'équivalence** (`1010:2bb0`, arguments `(y, x, valeur)`) : image = `SHAP 1800 + n` ; 8 cellules : disque `1836`, parts `1837 + k` aux décalages `x = [23,23,23,23,7,0,0,7]`, `y = [0,7,23,23,23,23,7,0]`, quadrillage `1845`, demi-traits `1846 + j` ; 12 cellules (beignets, 3 colonnes × 4 lignes, pas 19 × 8) : boîte `1850`, saveur `1852 + (bit haut mod 5)`, étiquette `1851` ; 24 cellules (8 colonnes × 3 lignes, pas 14 × 13) : cadre `1858`, cube `1857`, traits `1859`. Fonte : `NCSclB14` pour opérations et réponses, `NCSclB12` pour l'estimation (`4a14`), `NCSclB10` pour le nom et le rang (`4a10`, la doc d'engine.md « `4a10` = B10 » est confirmée par `1010:3ee4` / `3f39`).

### Écarts et hypothèses

- **Entrée de Gus non jouée** (`SCR 18100` supposé) : Gus est peint au repos dès l'entrée ; le drapeau « retour du Hall of Fame » (`4dfc`) n'a donc pas d'objet.
- Strike, bannière et réactions de Gus sont **interruptibles par un clic** (drapeau 8) ; les flags exacts du descripteur ne sont pas établis. La fanfare et la bannière attendent la fin du son (plafonné à 600 ticks).
- Mauvaise réponse : la bonne case est mise en évidence tout de suite (comme `3923`), pas de flash de la case cliquée ; l'attente de 90 ticks est interrompue par un clic.
- Réaction de Gus au clic : `457a(4|10|20)` tirée au hasard, Ctrl + Maj + clic : 15. Réaction de sortie : `NoRepeatPool(15)` (`1010:0934`, `10a8:13af`).
- Barre de temps redessinée en entier à chaque changement de demi-largeur (l'original ne repeint que la bande nouvellement masquée).
- Opération et niveau au GO : l'opération restaurée est toujours `+` à l'entrée (le roster ne la sauvegarde pas).
- L'aide de Polly passe par `PolyHelper` / `BOWLING_POLY` (sans la main « stop » : non documentée pour le Bowling). Le trophée revient au Bowling (`trophyExit`).
- Le nom (étiquette) ouvre le moniteur en mode connexion (palette du hub le temps du dialogue) ; à la fermeture le joueur est rechargé.
- Pas de nouvelle copy : « LEVEL n » / « BONUS ROUND » (`1010:4140`) ne sont **pas** affichés (la bannière ne montre que les lumières) : **Copy à valider** si on veut les reproduire dans la fenêtre du problème.
