# Rockets (jeu de Nim) : étude de rétro-ingénierie

Tâche E8. Scène 7 de `MATH` (Math Workshop, Brøderbund, v1.01, 1994, Win16), archive `NIM.DAT`, `Enter` `1070:0a37`, `Leave` `1070:0e7d`, `Tick` `1070:102d`, `Exit` `1070:1131`, `Key` `1070:2045` (engine.md §1.4). Document d'étude seul (aucun code applicatif). Lecteurs de données : `src/data/mohawk/` et `src/games/mathemagique/data/`. Les adresses sont des `sélecteur:offset` de la décompilation Ghidra (`archives/mathemagique/re/MATH/`), le segment de données est `1108` (noté `DS:xxxx`, ou `xxxx` seul pour une variable globale). Un fait sans mention est lu dans le code ; « hypothèse » marque une déduction non prouvée. Le désassemblage (`disasm.txt`) a été relu pour tous les points où le décompilé perd un argument (ordre des paramètres, `PUSH` de mots doubles) ; l'état initial du segment de données (tables, rectangles) est lu dans une image du segment `1108` (`ds.bin`, hors dépôt, sans relocations : les pointeurs lointains y apparaissent comme `ffff 0000`, ce qui cache les cibles des tableaux de boutons).

Conventions de lecture du décompilé, utiles pour relire les adresses citées :

- Une fonction `__stdcall16far` (Pascal) dépile ses arguments elle-même ; Ghidra nomme `param_1` l'argument **poussé en dernier** (le plus proche de l'adresse de retour), donc le dernier de la liste Pascal. Les `PUSH` de mots doubles inversent l'impression : `PUSH 0x20005` = `param_1 = 5`, `param_2 = 2`.
- `1018:04e1(hi, lo)` (aléa borné) renvoie `lo + 10a8:1473(hi - lo)`. `1018:04e1(5,2)` = entier uniforme dans [2, 5] ; `1018:04e1(100)` avec un seul `PUSH 0x64` = [0, 100] (`lo = 0`).
- Les ticks sont ceux de `DS:8722` (60 Hz nominal, 17 ms en pratique, engine.md §4.6) : 300 ticks ≈ 5 s.

## 0. Résumé exécutif

- Nim classique : N fusées (11 à 21), on retire de 1 à M fusées par tour (M de 2 à 5 contre Poly, 2 à 10 contre un ami), **celui qui lance la dernière gagne** (règle codée en dur : `DS:7c10 = 1`, jamais modifié).
- Poly est un personnage humain (Poly Gonzalez, salopette, `SHAP` 40000 n° 28), pas un perroquet. Son IA : elle joue le coup gagnant `reste mod (M+1)` sauf **erreur délibérée** décidée par son niveau interne (0 à 4, départ 2) ; son premier coup d'une partie est toujours une erreur quand un coup gagnant existe.
- Niveau adaptatif **caché** (aucune couleur ni indicateur) : +1 après deux victoires consécutives de l'enfant, −1 après deux victoires consécutives de Poly (avec un défaut d'origine : voir §1.5). Non sauvegardé, remis à 2 à chaque entrée dans la scène.
- Aucun score, aucun bit de masque de réussites écrit, aucune variable de progression. Seule variable du roster : un drapeau « l'introduction d'aide a déjà été jouée » (`DS:7c02`, `MWRoster` enregistrement +5420).
- Mécanisme des décalages `SCR`/`SHPL` de `NIM.DAT` (question ouverte de scr.md) : résolu au §2.6. Les scripts `30000` + type (21 vols de fusée) utilisent la `SHPL` 30000 avec un décalage égal au **type de la fusée**, écrit dans `DS:287c` par `1070:1778` ; les 11 scripts `30021`–`30031` sont les **dispositions** des 11 à 21 fusées ; `1070:1d25` appelle toujours le décalage 0.

## 1. Règles

### 1.1 Variables d'état (segment de données)

Noms inventés pour ce document ; les adresses sont celles du code.

| DS | Nom | Rôle | Preuve |
|---|---|---|---|
| `7c04` | `mode` | 1 = contre Poly, 0 = contre un ami | init 1 `1070:0a91` ; écrit `1070:012e`, `1070:019a` |
| `7c06` | `total` (N) | fusées de la partie, 11 à 21 | init 11 `1070:0a97` ; écrit `1070:1171` |
| `7c08` | `niveauPoly` | niveau interne de Poly, 0 à 4 | init 2 `1070:0a9d` ; `1070:090f`, `1070:0944` |
| `7c0a` | `serieEnfant` | victoires consécutives de l'enfant | `1070:08f7`, `1070:0932` |
| `7c0c` | `seriePoly` | victoires consécutives de Poly | `1070:08fd`, `1070:092c` |
| `7c0e` | `polyADejaJoue` | Poly a déjà joué dans cette partie | mis à 1 après son annonce (`1070:0829`), à 0 en fin de partie (`1070:08f1`, `1070:0926`) |
| `7c10` | `derniereGagne` | 1 = « la dernière fusée gagne » | init 1 `1070:0aa3` ; jamais réécrit ; lu `1070:0745`, `1070:08cc`, `1070:08d9` |
| `7c12` | `lancees` | fusées déjà lancées (total) | remis à 0 par `1070:1171` |
| `7c14` | `lanceesTour` | fusées lancées par l'enfant dans son tour (mode Poly seulement) | `1070:04fc`, `1070:0502`, `1070:087f` |
| `7c16` | (mort) | `4 × aléa + 11` écrit par `1070:127c`, jamais relu | grep des lectures : aucune |
| `7c18` | `partieEnCours` | au moins un lancement depuis la dernière remise à zéro | `1070:050f`, `1070:088c`, `1070:08bc` ; remis à 0 par `1070:1171` et `1070:0531` |
| `7c1a` | `polyVisible` | Poly est à l'écran | init 0 ; 1 après `1d25(… 2000)` |
| `7c1c` | `dernierType` | type de la dernière fusée lancée (0 à 20) | `1070:178a` |
| `7c1e` | `maxParTour` (M) | « Launch up to M Rockets » | init `1018:04e1(5,2)` `1070:0aee` |
| `7c20…7c26` | `emplacements[21]` | rectangle (x, y, droite, bas) de chaque emplacement, pas de 8 octets | `1070:1171` |
| `7cc8` | `typeEmplacement[21]` | type (0 à 20) ou −1 si lancée/vide | `1070:1171`, `1070:1778` |
| `7bc4` | `sonLancement[21]` | id `SND` de lancement par **type** | `1070:207b` |
| `7d10` | `modeAide` | 1 = mode d'aide (« ? ») actif | `1070:0077` |
| `7d12` | `aideSurvolee` | 1 = une zone a été survolée / l'invite d'aide est consommée | `1070:1f64`, `1070:009f` |
| `7d14` | `debutAide` | tick de départ du compte à rebours d'inactivité de l'aide | `1070:00c1` |
| `7d18` | `animEnCours` | 1 pendant `1070:1d25` | `1070:1d3e`, `1070:1ea4` |
| `7d1a`, `7d1c` | `commentaireDiffere`, échéance | commentaire de Poly sur M, 120 ticks après un clic sur le panneau | `1070:01c2` cas 3, `1070:102d` |
| `7d0a`, `7d0c` | état de clignement, échéance | yeux de Poly | `1070:1ecd` |
| `7d20` | `slotEnVol` | emplacement dont la fusée est en train de partir | `1070:18ba` |
| `7d22` / `7da2` | `scr[32]` / `sndl[32]` | handles `SCR` / `SNDL` 30000 + i (i de 0 à 31), pas de 4 octets | `1070:16d4` |
| `2850` | `tourAutomatique` | 1 = Poly doit jouer au prochain tick (0 / 1 / 2) | `1070:09fa` (pose), `1070:102d` (consomme) |
| `7c02` | `aideDejaExpliquee` | **variable sauvegardée** (roster) | `1070:0084`, `1070:0092` |

Les groupes de variables `7c0a`/`7c0c`/`7c08` ne sont **jamais sauvegardés** : l'adaptation vaut pour la visite en cours.

### 1.2 Mise en place (entrée dans la scène)

`1070:0a37` (dans l'ordre) : met à zéro les états (`7c0a`, `7c0c`, `7c0e`, `7c1a`, `7d10`…), mode Poly (`7c04 = 1`), N = 11 (`7c06`), niveau 2 (`7c08`), `7c10 = 1`, puis **M tiré dans [2, 5]** (`1018:04e1(5,2)`, `1070:0aee`). Ouvre `Nim.DAT` (`DS:2af8`), précharge 9 sons `\0SND` (§3), charge les `SHPL` 40000 (fond, boutons du jeu), 42000 (masques de clic) et la palette « Poly Palette » (`SHPL` 999, entrées 216 à 231), précharge les 32 scripts 30000–30031 (`1070:16d4`), dessine l'écran (§2.2), installe 3 groupes de boutons (`10a0:0000(0xc000, 3, 0x2ac4)`, §2.3), arrête les MIDI en cours (`1088:16a5(tMID, -1)`), **fondu d'entrée** de la palette (`1088:1b25(mode 1, durée 30, 236 entrées dès 10)`), joue la musique `SND` 201 si la préférence globale `DS:2d64` est non nulle (`1070:0df7` ; hypothèse : « musique activée », valeur 1 dans le roster modèle), puis :

1. `1d25(0, 0, 2000)` : Poly **entre** (non interruptible, 10 images, 70 ticks, sans son) ;
2. `1d25(1, 0, 2100)` : sa **salutation** (interruptible, 58 images, 504 ticks, 5 sons 18672–18676) ;
3. `7c1a = 1` ; `12ed(M, 8)` : Poly annonce la limite initiale M (cf. §1.7) ;
4. arme le clignement : prochain à `now + [120, 300]` ticks.

Qui commence : **personne n'est désigné**. L'enfant lance une fusée (il commence) ou clique sur Poly (elle commence) ; il n'y a ni pile ou face ni tour imposé.

### 1.3 Tour de l'enfant et fin de tour

Clic sur le champ de fusées (`01c2` param 4, `1070:03d7`–`052e`) :

1. `7d1a = 0` (annule le commentaire différé). Si `lancees == total` : si Poly est visible, elle dit « la partie est finie » (`12ed(0,3)` = `SCR` 9200). Sinon, si `lanceesTour < M` :
2. cherche, **des derniers emplacements vers le premier** (l'indice le plus élevé est devant), le premier emplacement dont le rectangle contient le curseur **et** dont le masque 1 bit pixel-exact est allumé à cet endroit (`SHPL` 42000, §2.4) ;
3. trouvé : curseur occupé, `1778(slot)` joue l'animation de vol en entier (bloquante, §2.5), `lancees++`, `lanceesTour = 0` en mode ami, `lanceesTour++` en mode Poly, `partieEnCours = 1`.

Si `lanceesTour ≥ M` le clic est ignoré (en mode Poly). **Mode ami : aucune limite n'est imposée** (`lanceesTour` reste 0, `1070:04f5`–`0502`) : la limite « Launch up to M » n'y est qu'affichée.

Fin du tour contre Poly :

- l'enfant a lancé M fusées : à la fin de `01c2`, `lanceesTour == M` et `lancees < total` posent `DS:2850 = 1` (`1070:0a03`) ; au **tick suivant** (`1070:1047`–`105a`) Poly joue automatiquement (`01c2(1)`) ;
- l'enfant a lancé moins de M : il clique sur Poly (zones 1 ou 2, `01c2` param 1 ou 2). Si `lanceesTour == 0` alors que la partie a commencé, elle répond « lance au moins une fusée » (`12ed(0,2)` : `SCR` tiré dans {9300, 9400, 9500, 9600, 4900} sans remise) ; sinon elle joue.
- Poly commence si l'enfant la clique avec `lancees == 0`.

### 1.4 IA de Poly

Déclenchée par `FUN_1070_01c2` cas 1 et 2 (`1070:06ce`–`0879` ; coup gagnant `073b`–`077b`, erreur délibérée `077f`–`081c`, annonce `081f`, sélection `0836`–`0879`), uniquement si `mode == 1`, Poly visible et `lancees < total`. Soit `R = total − lancees`.

**Étape A : le coup « gagnant » `t`.**

- `derniereGagne = 1` (seul cas atteignable) : `t = R mod (M+1)` (boucle `for (t = R; M+1 <= t; t -= M+1)`).
- (`derniereGagne = 0`, inatteignable en v1 : `t = (R−1) mod (M+1)`, variante « la dernière perd ».)

**Étape B : choix du nombre `k` de fusées.**

```
si t < 1  (ou t >= M+1) :           // pas de coup gagnant : R multiple de M+1
    répéter  k ← aléa[1, M]  tant que R < k
sinon :                              // un coup gagnant t ∈ [1, M] existe
    erreur ← vrai
    si polyADejaJoue :
        si R < M+1 :  erreur ← faux                    // fin de partie : joue toujours juste
        sinon selon niveauPoly :
            0 : erreur ← vrai
            n (1 à 4) : si R <= (n+1)*M + 1 alors erreur ← faux
    si erreur :
        répéter
            répéter  x ← aléa[1, M]  tant que R < x
        tant que x == t
        k ← x                       // coup quelconque ≠ t, tiré par rejet
    sinon k ← t
```

Conséquences (lues dans le code, `1070:079a`–`081c`) :

- **Le premier coup de Poly dans une partie est toujours une erreur délibérée** quand un coup gagnant existe (`polyADejaJoue = 0`). Contre l'enfant qui commence, la position qu'elle laisse n'est donc pas gagnante pour elle : l'enfant peut toujours gagner s'il joue parfaitement ensuite (`R mod (M+1)`). Hypothèse sur l'intention : c'est le but pédagogique du jeu (manuel : « figure out how many rockets should remain for Poly's last turn »).
- Niveau 0 : erreur à chaque coup tant que `R ≥ M+1`. Niveaux 1 à 4 : joue juste dès que `R ≤ (niveau+1)·M + 1` (donc, pour M = 5 et niveau ≥ 3, pratiquement tout le temps ; M = 2 : niveau 1 juste dès `R ≤ 5`).
- Le tirage de rejet ne boucle jamais indéfiniment sous les conditions atteignables (si `R == 1 == t` le cas `R < M+1` impose `erreur = faux`, sauf au premier coup où `R ≥ 11`).
- L'ordre des tirages dans un tour de Poly (utile pour une reproduction à graine fixe) : (1) étape B ; (2) `12ed(k, 1)` (voix, §3) ; (3) tirages de sélection des fusées ci-dessous.

**Étape C : annonce.** `12ed(k, 1)` : `polyADejaJoue = 1`, curseur occupé (`1008:0620`).

**Étape D : quelles fusées.** Pour chaque fusée à lancer : parcourt les emplacements de 0 à N−1 ; pour chaque emplacement encore plein, tire `aléa[1, 100]` et le retient si `> 70` (30 % ; si aucun n'est retenu après le tour complet, recommence au début) ; lance (`1778`, bloquant), `lancees++`. Le tirage favorise donc les premiers emplacements (distribution géométrique tronquée).

**Étape E : fin du coup.** `lanceesTour = 0`, `partieEnCours = 1` si besoin ; si `lancees != total`, `12ed(0, 9)` (invite « à toi » : `SCR` tiré dans {9300, 9400, 9500, 9600}). Sinon la fin de partie est traitée par le bas de `01c2` (§1.5).

Aléa : `10a8:1473(n)` = congruentiel `seed ← seed × 0x343fd + 0x269ec3` (mod 2³²), résultat `(seed >> 16) mod (n+1)` (division 16 bits non signée ; **aucun masque `& 0x7fff`**). Graine posée au premier appel (`DS:38f8 = 1` → `10a8:1460`) depuis l'horloge DOS (`1098:060f`, hypothèse : somme de composantes de date et heure). Les « tirages sans remise » (`10a8:13af`) sont décrits au §3.2.

### 1.5 Adaptation du niveau de Poly

Fin de partie (`lancees == total` et `partieEnCours`, `1070:08a6`–`0a03`), **mode Poly seulement** (`1070:08c2`). `gagnantEstPoly` = Poly a joué le dernier coup (variable locale `local_1e` : 1 quand le dernier coup est venu d'un clic sur Poly ou du tick automatique). Avec `derniereGagne = 1` :

```
si gagnantEstPoly :                          // 1070:08e6
    12ed(0, 4)                               // Poly se réjouit (§3)
    polyADejaJoue ← 0 ; serieEnfant ← 0 ; seriePoly++
    si seriePoly == 2 : si niveauPoly > 0 : niveauPoly-- ; serieEnfant ← 0
sinon :                                      // 1070:091b : l'enfant a gagné
    12ed(0, 5)                               // Poly félicite (§3)
    polyADejaJoue ← 0 ; seriePoly ← 0 ; serieEnfant++
    si serieEnfant == 2 : si niveauPoly < 4 : niveauPoly++ ; serieEnfant ← 0
```

- Départ à 2 (`Level 3` du manuel, qui compte à partir de 1), bornes **0 à 4** (5 valeurs, pas 6 : écart avec le manuel v2 ; `niveau == 4` est le dernier `case` du `switch`, `niveau ≥ 5` retomberait dans « toujours erreur »).
- Défaut d'origine (hypothèse : oubli) : `seriePoly` n'est **jamais remis à 0** après avoir atteint 2 (la ligne « remise à 0 » écrit `serieEnfant`). Résultat : deux victoires consécutives de Poly font baisser son niveau **une seule fois** ; la troisième, quatrième… ne changent plus rien tant que l'enfant ne gagne pas (cela remet `seriePoly` à 0). En revanche `serieEnfant` est bien remis à 0 : quatre victoires consécutives de l'enfant montent de deux niveaux. **À trancher** : reproduire (fidélité) ou corriger en symétrique (voir §8, décision).
- Le manuel v2 dit « augmente d'un niveau toutes les deux parties qu'elle perd » ; le code exige des victoires **consécutives**.
- Les parties interrompues (bouton Reset, changement de N ou de mode) ne comptent ni comme victoire ni comme défaite et **ne remettent pas `polyADejaJoue` à 0** (`1070:1171` ne le touche pas ; hypothèse : oubli, la prochaine « première » erreur de Poly peut donc être manquée).

Mode ami : à la fin de partie rien ne se passe (aucune voix, aucun son) hormis la séquence secrète du §1.9.

### 1.6 Niveaux visibles par l'enfant, score, fin de manche

- **Niveau de Poly : jamais montré** (aucune forme dédiée, aucun texte, aucune couleur). Les « couleurs » de l'écran sont les apparences des 21 types de fusées (§2.4), sans lien avec un niveau.
- **Score : aucun.** Pas de compteur de parties, pas de grade, pas d'écriture dans le masque de réussites du joueur (`1010:3fdf` n'est pas appelé).
- **Fin de manche** : toutes les fusées parties, la voix de Poly de §1.5 est jouée (non interruptible) puis le plateau est vide ; pas de relance automatique. L'enfant clique Reset (même N), un nouveau nombre sur le pavé, change de mode, ou Exit. Cliquer sur Poly (zones 1 et 2) ou sur un emplacement vide rejoue `12ed(0,3)` (`SCR` 9200, interruptible : « appuie sur Reset ou choisis un nombre »).

### 1.7 Limite M, nombre N, modes

- **M** (« Launch up to M Rockets »), panneau `SHAP` 40000 n° 18 (225 × 24) en (155, 124) et chiffre `SHAP` 40000 n° `17 + M` (34 × 24, chiffres 2 à 10) en (267, 124). Clic sur le panneau (`01c2` param 3, `1070:0353`–`03d4`), **seulement si `lancees == 0` ou `lancees == total`** (début ou fin de partie) : son `SND` 3043, `M++`, bouclage : mode Poly 5 → 2 ; mode ami 10 → 2. En mode Poly, `7d1a = 1` et `7d1c = now + 120` : 2 s plus tard (`tick`) Poly commente la nouvelle limite (`12ed(M, 8)`).
- **N** : pavé 11 à 21 plus « ? », voir §2.3. Changer N **recommence la partie** (`1070:1171`).
- **Mode** : boutons « Poly » / « a Friend ». `0105` param 1 (Poly) : `mode = 1`, Poly entre si absente (`12ed(0,7)` : `1d25(0,0,2000)`), partie réinitialisée, M ramené à 3 s'il sort de [2, 5], puis Poly annonce M (`12ed(M,8)`). `0105` param 2 (ami) : `mode = 0`, annule le commentaire différé, Poly **part** (`12ed(0,6)` : au revoir tiré dans {2200, 2300, 2400} puis `SCR` 9700, `polyVisible = 0`), partie réinitialisée. En mode ami Poly n'est visible qu'à la demande de l'aide (voir §1.8).

Le « tour » en mode ami est entièrement à la charge des joueurs : rien n'enregistre qui joue, la règle « dernière gagne/perd » n'est pas modifiable (`7c10` constant), la variante « fusées de même apparence » est purement humaine (manuel p. 44).

### 1.8 Mode d'aide (bouton « ? »)

Bouton 2 du groupe A (`0000` param 2, `1070:0031`) :

1. `7d1a = 0` ; tire le son associé à l'entrée `DS:2a78` : `SND` 3012 si `aléa[1,100] > 50`, sinon 3013 (`1070:0042`) ;
2. si Poly absente : elle entre (`1d25(0,0,2000)`, `polyVisible = 1`) ;
3. `modeAide = 1`, `debutAide = 0`, `166e(1)` : désactive les groupes A et B (Reset/Help/Exit, Poly/Friend) et les 5 zones de jeu du groupe C, **active la zone plein écran** (§2.3) : tout clic passe alors par `01c2` branche « aide » ;
4. première fois (`aideDejaExpliquee == 0`, variable du roster) : joue `SCR` 1100 (explication complète, 1610 ticks ≈ 26,8 s, interruptible), met `aideDejaExpliquee = 1`, **sauvegarde le roster** (`1050:0302`) ; sinon `aideSurvolee = 0` et joue `SCR` 4500 (version courte, 553 ticks, interruptible) ;
5. dessine le panneau stop `SHAP` 40000 n° 31 (25 × 25, `1070:20a7`) en (481, 254) ; si `aideSurvolee == 0`, `debutAide = now`.

Dans le mode d'aide, `1070:1f64` teste le curseur contre 10 rectangles (`DS:290c`, §2.3) : survol d'une zone de numéro ≥ 3 → curseur « ? » (`1008:063b(2)`), sinon curseur normal (`1070:1084`). Si `debutAide != 0`, `aideSurvolee == 0` et 300 ticks se sont écoulés sans survol, Poly rejoue l'introduction complète (`0e5d(1)` : `SCR` 1100) et redessine le panneau stop (`1070:10c0`–`10e6`).

Un clic (quelle que soit la zone, grâce à la zone plein écran) est traité par `1070:01c2` branche `modeAide` : `1f64` renvoie la zone survolée (1 à 10) et `aideSurvolee = 1` ; scripts joués (tous interruptibles, `1d25(1, 0, id)`) :

| Zone (n°) | Rectangle (g, h, d, b) | Élément | `SCR` joué (suite) | Preuve |
|---|---|---|---|---|
| 1, 2 | (472,139,527,432) ; (452,248,546,268) | Poly | mode ami : au revoir {2200, 2300, 2400} puis 9700, Poly part ; mode Poly : 4300, puis 4400 si 4300 n'a pas été interrompu. Dans les deux cas : sortie du mode d'aide (`166e(0)`, `modeAide = 0`) | `01c2` cas 1/2 de la branche aide |
| 3 | (264,357,318,380) | Reset | 9200 | cas 3 |
| 4 | (261,325,289,352) | Help (visage) | 4600, puis 4700 si non interrompu | cas 4 |
| 5 | (403,335,472,380) | « a Friend » | 3200 | cas 5 |
| 6 | (333,335,402,380) | « Poly » | 9000, puis 9100 si non interrompu | cas 6 |
| 7 | (34,159,488,309) | champ de fusées | 4200 | cas 7 |
| 8 | (51,335,250,380) | pavé de nombres | 3400, puis 3500 si non interrompu | cas 8 |
| 9 | (294,326,323,351) | Exit | 9800 | cas 9 |
| 10 | (157,123,380,149) | panneau « Launch up to » | 1000 | cas 10 |

Après les zones 3 à 10, le panneau stop est redessiné et le mode reste actif. Une zone nulle (clic hors zone) ne fait rien. Le retour de `1d25` vaut « interrompu » (`iVar4 == 0`) ; l'appelant enchaîne le second script seulement si le premier est allé au bout.

### 1.9 Séquence secrète (code mort)

À la fin d'une partie, si `dernierType == 4` et que l'historique de touches `DS:4f1c`/`0b73` (`1018:03fd`, sept bits par touche) correspond aux dernières frappes `z`, `e`, `r`, `o` (mode ami, `1070:09b7`) ou `h`, `o`, `m`, `e` (mode Poly, `1070:0958`), la scène joue `SCR` 1050 (éclair + effets de palette par le hook `1070:19e4`) puis `SCR` 2050 (Poly passée aux rayons X, 73 images). **La condition finale est `1098:036f(0) == 0x600`** : cette fonction ne renvoie que `0x800` (Maj), `0x400` (Ctrl) ou leur union (`1098:036f`, `GetKeyState` 0x10 et 0x11) : `0x600` est **inatteignable**. La séquence est du code mort dans cette version. Hors périmètre de l'implémentation TS (à signaler seulement).

## 2. Mise en page, ressources, animations

### 2.1 Ressources de `NIM.DAT`

Tags (`NIM.DAT`) : `\0SCR` 123, `\0SND` 182, `SHAP` 1423, `SHPL` 97, `SNDL` 123. Écran 576 × 432 (zone de jeu).

| Ressource | Contenu | Utilisation |
|---|---|---|
| `SHPL` 40000 | 31 formes, palette 10..190 (181 entrées) | fond et éléments fixes (voir ci-dessous) |
| `SHPL` 40100 | 6 formes (54 × 23 ×2, 27 × 26 ×2, 28 × 24 ×2) | boutons Reset, Help, Exit (2 états chacun) |
| `SHPL` 40300 | 4 formes (69 × 45 ×2, 70 × 45 ×2) | boutons « Poly » et « a Friend » (2 états) |
| `SHPL` 42000 | 22 masques **1 bit** (16 à 55 × 87 à 90) | tests de clic pixel-exacts des fusées |
| `SHPL` 999 | aucune forme, palette 216..231 (16 entrées), « Poly Palette » | couleurs de Poly |
| `SHPL` 30000 | 78 formes : 21 fusées × 3 tailles (formes `3k+1`, `3k+2`, `3k+3`) + flammes (68–78) | vols et dispositions |
| `SHPL` 1000 … 9800 | une `SHPL` par script de Poly (même id que le `SCR`) ; palette = index 255 seul | animations de Poly |
| `SHPL` 1050 | 8 formes, palette 192..214 (23 entrées) | éclair (code mort, §1.9) |

Mode de dessin : `10a8:0ce4(mode, y, x, indice, liste)`, indice **1-based** dans la liste ; mode 0 = copie opaque (fond, pavé), mode 8 = copie transparente (hypothèse, scr.md « question ouverte sur les modes de blit »).

### 2.2 Dessin de l'écran (ordre, `1070:0a37`)

| Ordre | Élément | `SHAP` | Position (x, y) | Preuve |
|---|---|---|---|---|
| 1 | fond plein écran 576 × 432 | 40000 n° 1 (mode 0) | (0, 0) | `1070:0bee` |
| 2 | panneau « Launch up to _ Rockets. » | 40000 n° 18 (225 × 24) | (155, 124) | `1070:0c07` |
| 3 | chiffre de M | 40000 n° `17 + M` (34 × 24) | (267, 124) | `1070:0c23` |
| 4 | étiquette « Number of Rockets » | 40000 n° 2 (190 × 16) | (55, 317) | `1070:0c79` |
| 5 | étiquette « Play with… » | 40000 n° 3 (130 × 18) | (337, 317) | `1070:0c8f` |
| 6, 7 | filets verticaux | 40000 n° 4 (5 × 59) | (255, 321) et (323, 321) | `1070:0ca5`, `1070:0cbb` |
| 8 | pavé de nombres : fond 199 × 45 puis case « enfoncée » du N courant | 40000 n° 17, puis n° `4 + (N − 10)` (35 × 22) | fond (51, 335) ; case `(53 + 32·c, 337 + 19·r)` | `1070:159e` |
| 9 | les N fusées | `SHPL` 30000 forme `288e[type]` (53 × 90, etc.) | positions de `SCR` 30010 + N (§2.4) | `1070:1171`, `1070:1b5c` |
| 10 | boutons graphiques A (Reset, Help, Exit) et B (Poly, a Friend) | `SHPL` 40100 et 40300 | aux rectangles du §2.3 | `1070:0d4b`–`0d71` |
| 11 | Poly (neutre) | 40000 n° 28 (97 × 291) | (451, 139) | `1070:1859` (vol), `1070:1e7c` (fin d'animation interrompue), `1070:12a3`, `1070:19e4` |
| 12 | yeux de Poly | 40000 n° 29 (fermés, 6 ticks) / n° 30 (ouverts) (53 × 29) | (470, 160) | `1070:1ecd` |
| 13 | panneau stop (aide) | 40000 n° 31 (25 × 25) | (481, 254) | `1070:20a7` |

Poly est une **image statique** (`SHAP` 28) posée en dernier plan quand `polyVisible` ; ses animations (`SCR` 1000–9800) sont jouées par-dessus et la dernière image de chaque script ramène la pose neutre. Les zones de sauvegarde du fond (`10a8:1023`) : champ de fusées (34, 159, 488, 309) dans `DS:285a`, colonne de Poly (404, 125 à 576, 432) dans `DS:285e`, vidées/restaurées avant chaque animation (`1018:0505`, `10a8:1115` ; hypothèse sur le détail).

Pavé : 12 cases en 2 rangées de 6, pas 32 × 19 à partir de (53, 337) : `11 12 13 14 15 16` puis `17 18 19 20 21 ?`.

### 2.3 Zones cliquables

**Géométrie des tests de point** : `10b0:0711` : `gauche ≤ x < droite` et `haut ≤ y < bas`. Coordonnées dans l'aire 576 × 432. Trois groupes de boutons `10a0` (groupe = pointeur sur un tableau d'éléments de 16 octets, nombre, rappel ; `10a0:0f04`) : `DS:2ac4` (`A`, rappel `1070:0000`), `DS:2ad0` (`B`, rappel `1070:0105`), `DS:2adc` (`C`, rappel `1070:01c2`). Les éléments `DS:2a94` (A : 3 boutons, mot de drapeaux `0x8040`), `DS:2aa4` (B : 2 boutons, `0x202c`), `DS:2ab4` (C : 6 boutons, `0x2000`). Un bouton = 20 octets : rectangle (8) à +0, mot de drapeaux à +0x12 ; usage des bits déduit de `1070:166e` et `1070:0d76` (hypothèse) : bit 2 = case « sélectionnée » pour B, bit 1 = désactivé pour C ; le mot de drapeaux du groupe (+6) a son bit 0 = désactivé pour A et B.

| Groupe | Param callback | Rectangle (g, h, d, b) | Rôle | Effet |
|---|---|---|---|---|
| A (`1070:0000`) | 1 | (264, 357, 318, 380) | Reset (`40100` n° 1/2) | `1171(1, N)` : même N, plateau remis, `2850 = 0` |
| A | 2 | (261, 325, 289, 352) | Help (n° 3/4) | mode d'aide (§1.8) |
| A | 3 | (294, 326, 323, 351) | Exit (n° 5/6) | au revoir de Poly s'il est visible (tiré dans {2200, 2300, 2400} sans remise, `1d25(1,0,id)`), clignement forcé ouvert, `polyVisible = 0`, puis `scene_rockets_exit` (`1070:1131` : fondu de sortie, retour au hub) |
| B (`1070:0105`) | 1 | (333, 335, 403, 380) | « Poly » (`40300` n° 1/2) | passe en mode Poly (§1.7) |
| B | 2 | (403, 335, 472, 380) | « a Friend » (n° 3/4) | passe en mode ami (§1.7) |
| C (`1070:01c2`) | 1 | (472, 139, 527, 431) | Poly (corps) | tour de Poly (§1.3/1.4) |
| C | 2 | (452, 248, 546, 268) | Poly (ceinture, panneau stop) | idem |
| C | 3 | (267, 124, 301, 148) | chiffre M | change M (§1.7) |
| C | 4 | (34, 159, 488, 309) | champ de fusées | lance une fusée (§1.3) |
| C | 5 | (51, 335, 250, 380) | pavé de nombres | choisit N (ci-dessous) |
| C | 6 | (0, 0, 576, 432) | **plein écran**, actif **seulement en mode d'aide** | capte tout clic en aide (§1.8) |

Ordre des enregistrements en mémoire (`DS:295c`…`2a60`, pas 20) ; l'association exacte « paramètre du rappel ↔ enregistrement » pour le groupe B n'est pas prouvée par le code (voir §8) ; elle est déduite du comportement des rappels (`0105` param 1 = passage en mode Poly, `0000` param 1/2/3 = Reset/Help/Exit). Trois enregistrements supplémentaires, **non rattachés à un groupe** dans ce que lit le code, existent en `DS:29c0`, `29d4`, `29e8` : (403, 356, 425, 380), (425, 356, 445, 380), (445, 356, 472, 380) (vestiges du bouton « a Friend » ; hypothèse).

États des boutons : `166e(0)` (normal) active A et B et les 5 zones de jeu, désactive la zone plein écran (`2a72 |= 2`) ; `166e(1)` (aide) fait l'inverse. Au départ la case « Poly » est la sélectionnée : `29aa[mode × 10] &= ~4`, `29aa[(mode == 0) × 10] |= 4` (`1070:0d76`–`0d94`) ; la forme claire du bouton B est vraisemblablement l'état sélectionné (hypothèse).

**Pavé de nombres** (cas 5 de `01c2`, `1070:0531`–`06cb`) : rectangle réduit de 4 px de chaque côté, soit (55, 339, 246, 376) ; `colonne = ⌊(x − 55) × 6 / 191⌋`, `ligne = ⌊(y − 339) × 2 / 37⌋` (divisions entières C, bornées à [0, 5] et [0, 1]) ; `i = 6 × ligne + colonne`.

- `i` de 0 à 10 : `N' = 11 + i`. Si `N' ≠ total` ou si la partie est finie : son 3043, case `i + 1` enfoncée (`159e`), puis `1171(1, N')` : partie recommencée avec N' fusées. Cliquer le N courant en cours de partie ne fait rien.
- `i = 11` (« ? ») : case `?` enfoncée, attend le relâchement de la souris, joue `SND` 3115 (1,6 s), puis (`1070:0617`–`0670`) **15 images** de 3 ticks où une case N'' de 11 à 21 s'allume, avec les contraintes `N'' ≠ total` et `N'' ≠ tirage précédent` (`aléa[11, 21]`), arrête le son, et la dernière case allumée devient le nouveau N (`1171(1, N'')`). Le résultat final diffère donc toujours du N courant.

**Clic sur le chiffre M** : § 1.7. **Clic sur Poly** : § 1.3.

### 2.4 Fusées : types, dispositions, test de clic

- **21 types** (apparences distinctes) indexés 0 à 20 : forme pleine taille de la `SHPL` 30000 `288e[t]` = `3k+1`, offsets `28b8[t]` (x) et `28e2[t]` (y) pour caler le script de vol, masque `SHPL` 42000 n° `⌊forme / 3⌋ + 1`.

| type | forme 30000 | taille (l × h) | masque 42000 | `28b8` | `28e2` |
|---:|---:|---|---:|---:|---:|
| 0 | 46 | 53 × 90 | 16 | 9 | 100 |
| 1 | 22 | 23 × 89 | 8 | 25 | 98 |
| 2 | 16 | 25 × 90 | 6 | 25 | 100 |
| 3 | 58 | 40 × 87 | 20 | 18 | 97 |
| 4 | 52 | 46 × 88 | 18 | 15 | 93 |
| 5 | 61 | 34 × 87 | 21 | 18 | 95 |
| 6 | 4 | 35 × 90 | 2 | 18 | 97 |
| 7 | 28 | 38 × 89 | 10 | 17 | 98 |
| 8 | 7 | 16 × 87 | 3 | 29 | 97 |
| 9 | 19 | 28 × 90 | 7 | 24 | 99 |
| 10 | 34 | 42 × 88 | 12 | 16 | 100 |
| 11 | 37 | 23 × 89 | 13 | 25 | 97 |
| 12 | 43 | 26 × 87 | 15 | 23 | 95 |
| 13 | 25 | 38 × 89 | 9 | 19 | 102 |
| 14 | 55 | 37 × 87 | 19 | 19 | 96 |
| 15 | 49 | 55 × 90 | 17 | 10 | 99 |
| 16 | 1 | 23 × 90 | 1 | 26 | 97 |
| 17 | 31 | 43 × 90 | 11 | 16 | 98 |
| 18 | 10 | 50 × 90 | 4 | 12 | 99 |
| 19 | 40 | 33 × 89 | 14 | 22 | 97 |
| 20 | 13 | 39 × 90 | 5 | 17 | 99 |

(tables `DS:288e`, `28b8`, `28e2` ; dimensions lues par `1018:045e` au chargement, `1070:0cd2`–`0cfb` ; masque : poignée `DS:7bf6 + ⌊forme/3⌋·4 + 8`, `1070:045c`–`0484`). Le type 4 est celui qui déclenche la séquence secrète (§1.9).

- **Dispositions** : `1171(·, N)` lit le `SCR` `30010 + N` (`1070:1b5c`) : une seule image, une cellule par fusée (cellule `c` = emplacement `c`), `x = gauche + position.x`, `y = haut + position.y` avec `(haut, gauche) = (159, 34)` pour tous (zone d'écrêtage (159, 34, 309, 499)), type = indice de la forme de la cellule dans `288e`. L'ordre des cellules est l'ordre de profondeur (les derniers sont devant) et l'ordre de balayage de Poly. Composition par N (nombre de fusées par type) :

| N | `SCR` | Types × quantité |
|---:|---:|---|
| 11 | 30021 | 7×3, 6×5, 15×3 |
| 12 | 30022 | 8×3, 20×4, 18×2, 2×3 |
| 13 | 30023 | 5×7, 9×6 |
| 14 | 30024 | 0×4, 11×3, 14×7 |
| 15 | 30025 | 12×3, 3×3, 4×3, 19×3, 16×3 |
| 16 | 30026 | 17×3, 14×3, 0×4, 3×4, 10×2 |
| 17 | 30027 | 11×7, 8×7, 2×3 |
| 18 | 30028 | 16×3, 9×6, 1×9 |
| 19 | 30029 | 20×3, 18×6, 9×9, 5×1 |
| 20 | 30030 | 6×2, 13×3, 4×4, 12×6, 3×5 |
| 21 | 30031 | 7×3, 19×3, 17×6, 15×6, 16×3 |

Les 11 dispositions sont fixes (pas d'aléa de placement). Les fusées de même type sont groupées (variante « même apparence » du manuel).
- **Rectangle d'un emplacement** : `(x, y, x + largeur, y + hauteur)` de la forme pleine taille (`7c24 = x + 7e22[type]`, `7c26 = y + 7e4c[type]`, `1070:1171`).
- **Test de clic** (cas 4, `1070:0429`–`0515`) : curseur dans le rectangle de l'emplacement, `dx = x − gauche`, `dy = y − haut`, le bit `(dx, dy)` du masque 1 bit (`SHAP` 42000, `pixels[dy × largeur + dx] == 1` avec `shap.ts`) doit être allumé. Emplacement vide : rectangle (0, 0, 0, 0), jamais touché.
- **Redessin autour d'un vol** : `1070:1947(0, slot)` redessine les autres fusées du rectangle ; pendant le vol, le hook 0 (`1070:19e4` param 0) redessine les emplacements d'indice **supérieur** au slot en vol, ainsi que Poly, par-dessus l'animation (rectangle (391, 239, 493, 390), `DS:2ae8`).

### 2.5 Animations `SCR` : catalogue et déclencheurs

Les durées sont des ticks (60 Hz nominal). Les sons sont joués par les opcodes `sound` des scripts (voir §3.1 pour les voix).

**Vols** (`SCR` 30000 + type, `SHPL` 30000) : 21 scripts de 21 images à 5 ticks (105 ticks), zone 73 × 356 (haut 28, gauche 106, bas 384, droite 179), hook 0 de paramètre 0 à chaque image (18 occurrences). Déclenchés par `1070:1778(slot)` pour chaque fusée lancée (enfant ou Poly). Avant la lecture, `1778` **réécrit la zone d'écrêtage de la ressource en mémoire** : `gauche' = x_slot − 28b8[type]`, `droite' = gauche' + 72`, `bas' = y_slot + 28e2[type]`, `haut' = bas' − 354` (`1070:17a1`–`1807`), de sorte que le script (dont les positions sont relatives) part de la fusée. Le son de lancement `7bc4[type]` est lancé juste avant (`1088:1498(0, \0SND, id)`), puis `1090:111c` joue le script **en bloquant**. Ensuite l'emplacement est libéré (`7cc8[slot] = −1`, rectangle à 0) et la région est redessinée. Il n'y a **aucune interruption** (descripteur `DS:2876` : drapeaux `0x13`).

**Dispositions** : `SCR` 30021–30031 (une image de 7 ticks, jamais jouées) : lues seulement par `1b5c` pour les positions (§2.4).

**Réactions de Poly** (`SHPL` de même id que le script, décalage 0 ; **toutes décalées de +40 en y au chargement** : `1d25` fait `haut += 0x28`, `bas += 0x28` dans l'en-tête, `1070:1e05`–`1e2f`) :

| Plage / id | Nombre | Déclencheur | Interruptible | Durée (ticks) / sons | Rôle de la voix (hypothèse sur la teneur) |
|---|---:|---|---|---|---|
| 2000 | 1 | entrée de Poly (`12ed(0,7)`, entrée de scène, aide en mode ami) | non | 70, sans son | pas de voix : transition |
| 2100 | 1 | salutation à l'entrée | oui | 504 ; 18672–18676 | bienvenue, présentation du jeu |
| 1000 | 1 | aide, zone 10 (panneau) | oui | 525 ; 19042, 19043, 19044 | explique la limite M |
| 1100 | 1 | aide complète (1re fois, ou après 300 ticks d'inactivité) | oui | 1610 ; 18900–18903, 18911, 18912, 18917, 18332, 18926–18929 | tour d'horizon de l'écran |
| 4500 | 1 | aide courte (déjà expliquée) | oui | 553 ; 18926–18929 | « clique sur ce que tu veux que j'explique » |
| 3200 | 1 | aide, zone 5 (ami) | oui | 168 ; 19029 | |
| 3400 puis 3500 | 2 | aide, zone 8 (pavé) | oui | 287 ; 18919 puis 287 ; 18920, 18921 | |
| 4200 | 1 | aide, zone 7 (fusées) | oui | 182 ; 18922 | |
| 4300 puis 4400 | 2 | clic sur Poly en aide (mode Poly) | oui | 112 ; 18939 puis 147 ; 18940 | |
| 4600 puis 4700 | 2 | aide, zone 4 (Help) | oui | 175 ; 18941 puis 175 ; 18942 | |
| 9000 puis 9100 | 2 | aide, zone 6 (« Poly ») | oui | 189 ; 18983, 18984 puis 616 ; 18985–18987 | |
| 9200 | 1 | aide, zone 3 (Reset) ; aussi `12ed(0,3)` | oui | 133 ; 18988 | |
| 9800 | 1 | aide, zone 9 (Exit) | oui | 280 ; 18917, 18332 | |
| 2200, 2300, 2400 | 3 | au revoir (Exit, passage en mode ami, clic sur Poly en aide en mode ami) | oui | 49 ; 19540 / 63 ; 19023 / 56 ; 18382 | « au revoir » |
| 9700 | 1 | départ de Poly (après l'au revoir) | non | 63, sans son | elle sort à droite |
| 1200–1900 (8) | 8 | l'enfant gagne (`12ed(0,5)`) | non | 154 à 329 ; 19041 (1200), 18993–18994, 18995, 18996–18998, 18999–19000, 19001–19002, 19003–19004, 19005–19006 | félicitations |
| 2500–3100 (7) | 7 | Poly gagne (`12ed(0,4)`) | non | 147 à 273 ; 19007…19021 | joie de Poly |
| 3300 (M = 2), 3600/3900 (3), 3700/4000 (4), 3800/4100 (5) | 7 | annonce de M (`12ed(M, 8)`) | oui | 238 à 280 ; 2 sons chacun | « tu peux lancer jusqu'à M » |
| 4800, 5000, 5100, 5200, 5300 | 5 | **remplissage** avant un coup de Poly (≈ 5,6 % des coups) | non | 84 à 133 ; 18943–18947 | gestes d'attente (« hmm… ») |
| 5400…8700 (33) | 33 | annonce de Poly « je lance k » (voir tables ci-dessous) | non | 77 à 161 ; 18948–18980 | « une / deux / … fusées » |
| 8800, 8900 | 2 | **réaction rare** (≈ 6 % des coups, au lieu de l'annonce) | non | 133 et 140 ; 18981, 18982 | remarque fantaisiste (hypothèse) |
| 9300, 9400, 9500, 9600 | 4 | invite « à toi » après un coup de Poly (`12ed(0,9)`) ; avec 4900 : « lance au moins une » (`12ed(0,2)`) | non | 70 à 84 ; 19035–19038 ; 4900 : 119 ; 19039 | |
| 2050, 1050 | 2 | séquence secrète (code mort) | non | 1064 / 308 | rayons X / éclair |

**Tables de choix** (`10a8:13af` : tirage **sans remise** par groupe, ids lus en `DS` `276c`–`282a`) :

| `12ed(p, 1)` (Poly annonce `p` fusées) | Ids possibles (table `DS`) |
|---|---|
| p = 1 | 5400, 5900, 6400, 6900, 7400, 7800, 8300 (`277a`) |
| p = 2 | 5500, 6000, 6500, 7000, 7900, 8400 (`278c`) |
| p = 3 | 5600, 6100, 6600, 7100, 7500, 8000, 8500 (`279c`) |
| p = 4 | 5700, 6200, 6700, 7200, 7600, 8100, 8600 (`27ae`) |
| p = 5 | 5800, 6300, 6800, 7300, 7700, 8200, 8700 (`27c0`) |
| remplissage | 4800, 5000, 5100, 5200, 5300 (`276c`) |
| rare | 8800 ou 8900 (`205f`, pile ou face) |

`12ed(p, 1)` : si `aléa[0,100] ≥ 95` (6/101) → script rare, **à la place** de l'annonce ; sinon, si un second `aléa[0,100] ≥ 95` (6/101) → un script de remplissage est joué d'abord (non interruptible) ; puis l'annonce de `p` (si `p ∉ 1..5`, aucune annonce).

| `12ed(·, 3)` | `1d25(1,0,9200)` |
|---|---|
| `12ed(·, 4)` | table `27d2` : 2500, 2600, 2700, 2800, 2900, 3000, 3100 (sans remise) |
| `12ed(·, 5)` | table `27e4` : 1300, 1400, 1500, 1600, 1700, 1800, 1900, 1200 (sans remise, 8 ids) |
| `12ed(·, 2)` | table `282a` : 9300, 9400, 9500, 9600, 4900 (sans remise) |
| `12ed(·, 9)` | table `281e` : 9300, 9400, 9500, 9600 (sans remise) |
| `12ed(·, 6)` | au revoir `2814` (2200, 2300, 2400, sans remise, interruptible) puis 9700 ; `polyVisible = 0` (si visible) |
| `12ed(·, 7)` | 2000 ; `polyVisible = 1` (si absente) |
| `12ed(M, 8)` | M = 2 : 3300 ; M = 3 : 3900 ou 3600 ; M = 4 : 4000 ou 3700 ; M = 5 : 4100 ou 3800 (pile ou face `205f`, interruptible) ; autre M : rien |

**Clignement** (`1070:1ecd`, appelé à chaque tick et au début de `1d25`) : si Poly est visible et aucune animation ne tourne : à l'échéance, forme n° 29 (yeux fermés) pendant 6 ticks puis n° 30 (ouverts) et nouvelle échéance `now + aléa[120, 300]`. `1d25` force d'abord l'état « yeux ouverts » (`1ecd(1)`) et réarme l'échéance à la fin de chaque animation.

### 2.6 Mécanisme des décalages `SCR` / `SHPL` et origine de `1070:1d25`

Un **descripteur d'animation** de 12 octets (`DS`) porte : +4 id de `SHPL`, +6 octet de décalage, +7 drapeaux ; `1090:1024` charge la `SHPL` d'id `id`, le script `id + décalage`, et la `SNDL` d'id `id + décalage` (engine.md §3.7). Rockets en a deux, deux mécanismes distincts :

1. **Descripteur `DS:2876`** (`SHPL` 30000, drapeaux `0x13`) : les vols et les dispositions. `1070:1778` écrit **`DS:287c = type de la fusée`** (`1070:1872`) juste avant `1090:1024(&2876)` : le script chargé est `30000 + type`, avec les formes de la `SHPL` 30000. C'est l'origine des 31 « décalages » (1 à 31, et 0 pour le type 0) des scripts `NIM` dans scr.md. Les `SNDL` 30000 à 30031 sont **vides** : les sons de vol sont joués explicitement. `1070:16d4` (à l'entrée) précharge les 32 scripts et listes de sons dans `DS:7d22 + 4i` et `7da2 + 4i` (`1090:140f(30000 + i)`, `10a8:078a`) : `1b5c` lit `7d22[10 + N]` (disposition) ; la réécriture de zone de `1778` s'applique sur ces ressources chargées.
2. **Descripteur `DS:2882`** (animations de Poly) : `1070:1d25(interruptible, décalage, id)` écrit `DS:2886 = id`, `DS:2888 = décalage`, `DS:2889 = (DS:2889 & 0xf7) | (interruptible & 1) << 3` puis charge `id + décalage`. **Tous** les appels du code passent le décalage 0 (`PUSH 0` en second argument à chaque site) : chaque script de Poly a sa propre `SHPL` de même id. Pas de décalage non nul côté Poly. Drapeaux de base `0x13` : bit 0 sauvegarde le fond, bit 1 conserve la musique MIDI, bit 4 attend la fin des sons de la `SNDL` ; bit 3 (interruptible) posé par l'argument.
3. `1d25` ajoute 40 au haut et au bas de la zone du script **avant** `1090:1024` (`1070:1e05`–`1e37`) : les scripts de Poly sont dessinés 40 px plus bas que leur zone stockée (la pose finale du script 2000 est à (451, 99) + 40 = (451, 139) = la forme n° 28 statique). Un lecteur TS doit appliquer ce décalage aux scripts de Poly de `NIM.DAT` (pas aux 30000+, ni à 1050).

Cas particulier de `1d25(·, ·, 0x802)` (= 2050) : joue d'abord `SCR` 1050 avec un descripteur ad hoc (`DS:2886 = 1050`, `+0x238/+0x236` = hook `1070:19e4`), puis 2050 : code mort (§1.9).

### 2.7 Boucle de `Tick` (`1070:102d`)

À chaque tour de la boucle principale (ordre exact) : (1) si `DS:2850 == 1` : `2850 = 2`, `01c2(1)` (tour automatique de Poly), `2850 = 0` ; (2) si `modeAide` et pas d'animation : curseur « ? » selon `1f64(curseur) ≥ 3`, mémorisé dans `DS:276a` ; invite d'inactivité après 300 ticks ; (3) commentaire différé de M : si `7d1a != 0` et `now > 7d1c`, `7d1a = 0`, `12ed(M, 8)` ; (4) clignement `1ecd(0)`.

## 3. Sons

### 3.1 Table des événements

Le code joue tout sur le canal 0 (`1088:1498(0, \0SND, id)` ; engine.md §6 : un WAVE et un MIDI simultanés par défaut). Durées lues dans les `WAVE` (11025 Hz).

| Événement | `SND` | Durée | Où |
|---|---|---|---|
| Musique de fond (si `DS:2d64 ≠ 0`) | 201 (MIDI) | – | `1070:0e04` ; `SND` 200 (MIDI) présent dans l'archive mais **jamais référencé** par la scène |
| Clic sur le chiffre M, clic sur une case du pavé | 3043 | 0,09 s | `01c2` cas 3 et 5 |
| Tirage « ? » du pavé | 3115 | 1,60 s | `1070:0607`, arrêté après les 15 images (`1070:0672`) |
| Bouton Help (variante au hasard 50/50) | 3012 (0,82 s) ou 3013 (1,10 s) | | `DS:2a78`, `1070:0042` |
| Lancement d'une fusée | `7bc4[type]` : l'un de 3033–3037 (2,7 à 3,9 s) et 3058–3064 (3,5 à 4,6 s) | | `1070:18c4` |
| Boutons Reset/Exit/Poly/Friend et entrées de la table `DS:2a74`…`2a93` | 3116 (0,51 s), 3114 (1,10 s) ×2, 3004, 3006, 3007 | | préchargés `1070:0b0d`…`0b7d` ; usage par bouton non établi ; **3004, 3006, 3007 n'existent dans aucune archive** (§8) |
| Voix de Poly | ids 18332, 18382, 18661…, 18672–19044, 19540, 19993–19999 | 0,4 à 3,9 s | opcodes `sound` des `SCR` (§2.5) |

Préchargés à l'entrée (`1088:1125`) : 3004, 3006, 3007, 3012, 3013, 3114, 3115, 3116, 3043 ; libérés à la sortie (`1070:0e7d`) avec 3033–3037, 3058–3064 et 201.

### 3.2 Tirages sans remise (`10a8:13af`)

Mécanisme commun aux tables du §2.5 et aux sons de lancement : `13af(masqueInitial, n, &état)` : `état |= masque` ; `départ = aléa[0, n−1]` ; tant que le bit `v` est pris dans `état` : `v = (v+1) mod n`, et si on revient à `départ` l'état est remis au masque (erreur « e2GetPoolValue Error » si l'état n'a jamais changé) ; marque `v` et le renvoie. Ce n'est **pas** un tirage uniforme parmi les restants (sondage linéaire : un élément précédé d'une longue série d'éléments pris est plus probable). L'état est global (`DS`), il **persiste entre les parties**.

Sons de lancement (`1070:207b`, appelé au début de `1171` donc à chaque nouvelle partie ou Reset) : pour chacun des 21 types, `7bc4[t] = 27f8[13af(0, 12, &2810)]`, soit les 12 ids de `DS:27f8` : 3033, 3034, 3035, 3036, 3037, 3058, 3059, 3060, 3061, 3062, 3063, 3064. Chaque type a donc un son fixe pour la partie, et les 12 premiers types reçoivent 12 sons distincts.

### 3.3 Rôle des voix de Poly

Sans transcription audio (aucune écoute possible dans ce travail), le rôle est tiré du déclencheur (§2.5). Le texte exact reste à relever à l'oreille (copie « à valider » côté UI si sous-titres). Remarques : les `SNDL` de 1100 et 4500 partagent 18926–18929 ; 9800 réutilise 18917 et 18332 de 1100 : 4500 et 9800 sont des extraits de l'explication complète. Pas de synchronisation labiale par `Cue#` (engine.md §6) : la bouche est dans les images du script.

## 4. Progression et roster

- **Masque de réussites** (`u32` du joueur, bit `5 × opération + niveau`, engine.md §7.1) : **Rockets n'écrit aucun bit** (aucun appel à `1010:3fdf` ni à `1078:0a55` dans le segment `1070`). Le Hall of Fame ne lit rien de Rockets.
- **Variables du roster** (`MWRoster`, enregistrement du joueur) : une seule, `DS:7c02` (`u16`, big-endian dans le fichier), à l'offset **5420** de l'enregistrement de variables (engine.md §7.1 « nim »). Sens : **l'introduction d'aide complète (`SCR` 1100) a déjà été jouée** (0/1). Lue/écrite par `0000` param 2 (`1070:0084`–`0098`), sauvegarde immédiate `1050:0302`. `1070:116a` (qui remet `7c02` à 0) n'est appelée par aucun site de code visible : rappel d'initialisation de la définition de variables (hypothèse, engine.md §7.2). Aucune valeur par défaut autre que 0.
- Rien d'autre n'est persistant : ni N, ni M, ni niveau de Poly, ni nombre de parties.

## 5. Clavier et souris

- **Clavier** : `scene_rockets_key` (`1070:2045`) enregistre la touche dans l'historique des séquences secrètes (`1018:03fd`) et renvoie 0 (non consommée) : **aucune commande clavier propre**. Restent le clavier générique des boutons graphiques (`10a0:098e` : Tab / Maj+Tab parcourent les boutons, Entrée active le bouton focalisé ; engine.md §5.2) et les touches globales (Ctrl+Q, Ctrl+V). Un clic clavier sur les boutons « invisibles » du groupe C (champ de fusées, pavé) lit la position du curseur de souris (`1098:039b`) : sans effet utile (hypothèse).
- **Souris** : le jeu ne reçoit pas de mouvements (pas de `WM_MOUSEMOVE`) ; la position est interrogée au moment du rappel (`1098:039b`) pour le pavé, le champ de fusées, l'aide (`1f64`). Boutons A : appui/relâchement avec forme d'appui (`10a0:0110`) ; boutons B et C : déclenchement immédiat (hypothèse d'après `(drapeaux & 0xe000) == 0x2000`, `10a0:0110`). Bouton droit : aucun traitement relevé.
- **Curseur** : normal ; occupé (`1008:0620`) pendant les vols, les animations et les tours de Poly ; « ? » (`1008:063b(2)`) en mode d'aide au-dessus des zones 3 à 10.
- Pendant une animation non interruptible, `7d18 = 1` coupe clignement et invites ; le traitement des clics reçus pendant les boucles `1090:111c` est un point ouvert (réentrance éventuelle des rappels, §8).

## 6. Différences avec le manuel de 1997 (v2, `manual-en.md` p. 39–40, 44, 50–51)

| Sujet | Manuel v2 | Code v1 (CD 1994) |
|---|---|---|
| Poly | « Poly Gonzales », s'oppose à l'enfant | idem ; c'est une **personne** (salopette), pas un perroquet |
| Nombre de fusées | « 11 à 21 », bouton `?` aléatoire | idem (`?` ≠ N courant, 15 cases animées) |
| Limite par tour | 2 à 5 contre Poly, 2 à 10 contre un ami ; clic sur le panneau pour changer | idem ; le panneau cycle (2→…→5→2 ; 2→…→10→2), **seulement au début ou à la fin d'une partie** (pas mentionné) ; M initial **aléatoire dans [2, 5]** |
| Qui commence | « clique sur Poly d'abord » | idem ; aucun autre moyen |
| Fin de tour | Poly joue seule si l'enfant a lancé le maximum | idem (tick suivant) ; sinon clic sur Poly (au moins une fusée requise) |
| Mode ami | règles libres, les règles ne sont pas imposées | confirmé : **aucune limite imposée**, aucun gagnant annoncé |
| Niveaux de Poly | **6** niveaux internes, départ « Level 3 », −1 niveau toutes les deux parties **consécutives** gagnées par elle, +1 toutes les deux parties qu'elle perd | **5** niveaux (0–4), départ 2 (= « Level 3 » si l'on compte à partir de 1), +1 après 2 victoires **consécutives** de l'enfant, −1 après 2 victoires consécutives de Poly (une seule fois par série : défaut d'origine) ; non sauvegardé, rejoué depuis 2 à chaque visite |
| Boutons | Reset, Help, Exit, « Play with Poly / a Friend » | idem |
| Aide | non décrite en détail | mode d'aide avec 10 zones, introduction longue la première fois, panneau stop |
| Variante « la dernière perd » | « decide that the player who launches the last rocket loses » (ami) | variable `7c10` mais jamais modifiable : **non gérée par le code** (à la charge des joueurs) |
| Contrôle Parents | « play 11 rockets, up to two » | exemple valide (N = 11, M = 2) |

Le manuel parle de « Control Room niveau 2 » (hub v2 à deux étages) ; la v1 n'a qu'un écran de hub (engine.md §8.1) : le « Rocket Table » est la zone 8 du hub.

## 7. Plan d'implémentation TS

Principe : un **module pur** (règles, IA, aléa) testé à graine fixe, un **automate de scène** qui orchestre animations/sons/entrées et **consomme** des services du moteur partagé. Copie visible : **aucune** (tout est voix ou dessins) ; aucun libellé à valider.

### 7.1 Module pur `src/games/mathemagique/logic/rockets.ts` (+ `legacy-rng.ts`)

Pas d'accès DOM, pas d'horloge. Types :

```ts
type Mode = "poly" | "friend";
interface RocketsRules { lastWins: true }            // constant ; variante misère = non gérée
interface Slot { type: number | null; x: number; y: number; w: number; h: number } // type null = lancée
interface RocketsState {
  mode: Mode; total: number; maxTake: number; slots: Slot[];
  launched: number; launchedThisTurn: number; started: boolean;   // lancees, lanceesTour, partieEnCours
  polyLevel: number; childStreak: number; polyStreak: number;     // niveauPoly 0..4, séries
  polyHasPlayed: boolean;                                         // polyADejaJoue
}
interface Rng { range(lo: number, hi: number): number }          // = 1018:04e1(hi, lo), bornes incluses
```

Fonctions :

- `createLegacyRng(seed)` : `seed' = (seed × 0x343fd + 0x269ec3) mod 2³²`, `rand(n) = (seed' >>> 16) % (n+1)` (`n = 0` → 0 sans avancer) ; `range(lo, hi) = lo + rand(hi − lo)`. Graine libre (horloge en production).
- `createPool(n)` + `poolPick(pool, rng)` : sondage linéaire de `10a8:13af`, état persistant et partageable.
- `newGame(total, maxTake, mode, layout)` : remet à zéro les compteurs de partie (pas `polyHasPlayed`, voir §1.5) ; `layout = parseLayout(scr 30010 + total)`.
- `polyChooseTake(R, M, level, hasPlayed, rng): number` : IA du §1.4 (étapes A et B).
- `polyPickSlots(slots, k, rng): number[]` : étape D (30 % par emplacement plein, balayage depuis 0).
- `canLaunch(state)`, `launch(state, slotIndex, byChild)`, `endOfTurnNeedsPoly(state)` (lanceesTour == M et reste > 0), `canChangeMaxTake(state)`, `nextMaxTake(mode, m)`, `choosePadValue(x, y)` (géométrie du pavé), `randomTotal(current, rng)` (15 tirages, dernier ≠ N courant et ≠ précédent), `hitTest(slots, x, y, masks)` (balayage de la fin, masque 1 bit).
- `applyGameResult(state, winner)` : règle de §1.5 ; **paramètre de compatibilité** `polyStreakResets: boolean` (défaut `false` = fidèle, `true` = corrigé) pour que l'équipe tranche sans toucher à la logique.
- `reaction12ed(kind, p, rng, pools, flags)` : renvoie la liste d'ids `SCR` à jouer (avec drapeau interruptible), sans les jouer : `{ scrId, interruptible }[]`. Tables de §2.5 dans un fichier de constantes (`rockets-data.ts`).

### 7.2 Automate de scène `src/games/mathemagique/ui/scenes/rockets.ts` (avec les agents `ui/`)

États : `entering` (fondu, 2000, 2100, annonce de M) → `idle` ↔ `busy` (vol de fusée, voix de Poly : entrées ignorées, curseur occupé) ↔ `help` → `exiting` (au revoir, fondu, retour au hub). Événements : clic par zone (§2.3), tick 60 Hz. À reproduire : `tourAutomatique` (traité au tick suivant), compte à rebours d'aide de 300 ticks, commentaire différé de 120 ticks, clignement `[120, 300]`. Le mode d'aide remplace le dispatch : un seul récepteur plein écran.

### 7.3 Services moteur nécessaires

- **Lecteur de `SCR`** avec : id + décalage (`SHPL` de base, §2.6), option **interruptible** (clic annule, sons coupés), option « attendre la fin des sons » (drapeau 4), **décalage vertical** de la zone (+40 pour Poly, réécriture pour les vols), **hooks** 0 avec paramètre (callback de redessin par-dessus) ; promesse `done | interrupted`.
- **Sons** : play/stop par id et canal, préchargement, MIDI avec arrêt global, préférence musique globale.
- **Curseur** (défaut / occupé / « ? »), **fondus de palette** entrée/sortie, **tick 60 Hz** (`now()` en ticks), **rouleau d'aléa** injectable.
- **Roster** : lecture/écriture de la variable `rockets.helpSeen` (`u16`, enregistrement +5420) et sauvegarde immédiate.
- **Boutons graphiques** 2 états et zones invisibles, test pixel-exact sur masque 1 bit.
- **Composition** : calque de fond + sprites en mode transparent (index 0 = transparent, hypothèse scr.md).

### 7.4 Tests unitaires (valeurs tirées du code, générateur congruentiel de graine 0)

Séquences de référence (`rand(n)` successifs, graine 0, `(seed >> 16) % (n+1)`) :

| Appel | Valeurs |
|---|---|
| `rand(4)` ×8 | 3, 4, 1, 2, 3, 2, 0, 0 |
| `rand(100)` ×8 | 38, 43, 72, 13, 11, 81, 83, 66 |
| `rand(5)` ×8 | 2, 3, 0, 1, 1, 1, 1, 5 |
| graine 1, `rand(4)` ×8 | 1, 0, 4, 3, 2, 4, 3, 3 |
| `poolPick(n = 3)` ×7, graine 0 | 2, 0, 1, 1, 2, 0, 1 (réinitialisation après 3) |
| `poolPick(n = 12)` ×13, graine 0 | 2, 3, 6, 1, 7, 4, 5, 8, 9, 0, 10, 11, 10 |

IA `polyChooseTake(R, M, niveau, aDejaJoué, rng(graine 0))` :

| Cas | R | M | niveau | a déjà joué | Résultat | Remarque |
|---|---:|---:|---:|---|---:|---|
| premier coup (coup gagnant 2) | 14 | 3 | 2 | non | 3 | erreur délibérée (1er tirage `range(1,3)` = 3 ≠ 2) |
| niveau 1, hors seuil (7) | 9 | 3 | 1 | oui | 3 | gagnant 1 ; `9 > 2·3+1` : erreur |
| niveau 2, dans le seuil (10) | 9 | 3 | 2 | oui | 1 | joue juste sans tirage |
| niveau 1, dans le seuil | 7 | 3 | 1 | oui | 3 | `7 mod 4 = 3`, aucun tirage consommé |
| pas de coup gagnant | 8 | 3 | 4 | oui | 3 | `8 mod 4 = 0` : tirage `range(1,3)` rejeté si > R |
| fin de partie | 2 | 5 | 0 | oui | 2 | `R < M+1` : toujours juste |
| niveau 0, `R` multiple de 5 | 20 | 4 | 0 | oui | 3 | pas de coup gagnant : tirage |
| niveau 3, seuil `5·4+1 = 21` | 17 | 5 | 3 | oui | 5 | `17 mod 6 = 5`, juste |

Propriétés à tester sans valeur fixe : jamais `k < 1` ni `k > min(M, R)` ; au premier coup avec coup gagnant `t`, `k ≠ t` ; `niveau 0` ⇒ `k ≠ t` tant que `R ≥ M+1` ; `niveau n ≥ 1` ⇒ `k = t` si `R ≤ (n+1)M + 1` (après le 1er coup) ; sur 10 000 tirages à graines variées, la fréquence de `k = t` pour `R > (n+1)M+1` est nulle.

Sélection de fusées (`polyPickSlots`, graine 0, 11 emplacements pleins) : `k = 1` → `[5]` ; `k = 3` → `[5, 1, 6]`.

Adaptation (`applyGameResult`, départ niveau 2, séries 0/0) : victoires de Poly ×4 → niveau 2, 1, 1, 1 (séries Poly 1, 2, 3, 4) ; puis victoires de l'enfant ×6 → niveau 1, 2, 2, 3, 3, 4 (séries enfant 1, 0, 1, 0, 1, 0) ; avec `polyStreakResets = true` (série remise à 0 après chaque baisse) les quatre victoires de Poly donneraient niveau 2, 1, 1, 0 (test de caractérisation du défaut).

Géométrie du pavé (`choosePadValue`) : (55, 339) → N = 11 ; (54, 339) → hors zone ; (100, 350) → 12 ; (150, 357) → 13 ; (200, 358) → 21 ; (245, 375) → « ? » (case 12) ; (246, 339) → hors zone.

Mise en page : `parseLayout(scr 30010 + N)` → exactement N cellules, types comme dans la table du §2.4 (ex. N = 11 : 3 du type 7, 5 du type 6, 3 du type 15, premières positions (122,163), (97,188), (72,213)) ; slots = rectangle `(x, y, x + w, y + h)` de la forme pleine taille.

Résolution des ressources : `resolveScrResources(30000 + t)` → `SHPL` 30000, décalage t ; `SNDL` 30000 + t vide ; scripts de Poly → `SHPL` de même id, décalage 0.

Sons : `launchSounds(pool)` donne 21 ids tous dans les 12 de `DS:27f8` ; les 12 premiers sont distincts.

Aide : séquence de zones → scripts du tableau du §1.8 ; `12ed` kinds → listes d'ids (§2.5).

### 7.5 Notes d'ordonnancement

- Un vol bloque : N fusées de Poly = N × 105 ticks (1,75 s) plus les voix ; l'annonce `12ed(k, 1)` précède les vols, l'invite `12ed(0, 9)` les suit.
- Un script de Poly interrompu redessine le fond et Poly neutre ; un script terminé laisse sa dernière image (pose neutre).
- Ne pas oublier `+40` en y pour les scripts de Poly de `NIM.DAT` et l'écriture de zone pour les vols.

## 8. Questions ouvertes

1. **Association paramètre ↔ bouton du groupe B** : le code des rappels (`0105`) prouve « param 1 = mode Poly », le tableau de boutons place le rectangle (403–472) avant le rectangle (333–403) ; le sens d'énumération des groupes (`10a0:0f04`, `10a0:0e6f`) n'est pas établi. Sans conséquence si l'UI traite deux boutons nommés.
2. **Enregistrements `DS:29c0`, `29d4`, `29e8`** (trois petits rectangles du bas du bouton « a Friend ») : non rattachés à un groupe par le code lu (les pointeurs de tableaux sont des relocations non visibles dans les données).
3. **Sons 3004, 3006, 3007** préchargés mais absents de toutes les archives : préchargement silencieusement vide ? À vérifier dans `1088:1125`. La table de sons de boutons `DS:2a74`–`2a93` (3116, 3012|3013, 0, 3114, 3114, 3004, 3006, 3007) n'est pas rattachée à des boutons précis.
4. **Défaut `7c0c` (jamais remis à 0)** : intentionnel ou non ? Décision à prendre : fidèle (une seule baisse par série) ou symétrique ; également le « premier coup toujours erroné » (pédagogie) et l'oubli de `7c0e` au Reset.
5. **Six niveaux (manuel v2) contre cinq (code v1)** : un 6e niveau « parfait » a-t-il existé en v2 (clamp `< 5`) ? La v1 plafonne à 4.
6. **Préférence `DS:2d64`** : confirmée comme condition de la musique 201 ; reste à relier à la boîte de préférences et à sa persistance (engine.md §7.1, octets 10–11 de l'en-tête).
7. **Réentrance des clics pendant une animation** (boucle `1090:111c` + `1088:105b`) : les clics non interruptibles sont-ils ignorés, mis en file ou traités ? `7d18 = 1` n'empêche pas les rappels des groupes.
8. **`10a8:0e86(a, b)`** (appelé avec (10, 184) puis (216, 17) à l'entrée, (192, 23) pour 1050) : sémantique supposée « réserver/animer la plage de palette » ; sans effet sur la logique.
9. **Teneur des voix** : non transcrites ; tout sous-titrage serait à valider.
10. **Code mort** : séquence secrète (`== 0x600` inatteignable) ; `7c16` ; `7c10` ; `1070:116a`. Les `SCR` 1050 et 2050 sont jouables mais jamais déclenchés.

## Écarts avec les autres documents (à reporter)

- **engine.md §5.3** (« aucune touche utile ») : confirmé ; ajouter que la séquence secrète enregistrée par `1070:2045` ne peut pas aboutir (`1098:036f(0) == 0x600` impossible, §1.9).
- **engine.md §7.1, ligne « nim `7c02` »** (« idem », « niveau/progression, hypothèse ») : c'est un **drapeau « introduction d'aide déjà jouée »**, pas une progression.
- **engine.md §1.6** (`2acc`–`2ae4` « rappels de Rockets ») : précisé en §2.3 (A = Reset/Help/Exit, B = Poly/ami, C = zones de jeu).
- **engine.md §8.2** (« Dans Rockets, Poly est l'adversaire (palette « Poly Palette », `1070:0bc6`) ») : confirmé ; `SHPL` 999 = palette 216..231 seule.
- **engine.md §2.4 / tableau « Rockets »** : « `SCR` 123, `SND` 182, `SHAP` 1423 ; IA » : le fond est `SHAP` 40000 n° 1 (`SHPL` 40000), pas une `SHPL` 100 + k (engine.md §2.4 : « `PatFill` et `Nim` n'ont pas de tel fond », exact) ; l'IA est documentée ici (§1.4). Question 12 d'engine.md (progression de Rockets) : réponse : **aucune progression**.
- **scr.md « Origine de l'octet décalage pour les 31 scripts NIM »** : résolu (§2.6) : `1070:1778` écrit `DS:287c`.
- **scr.md « La zone est copiée aux offsets +0x0c… repère écran »** : pour `NIM.DAT`, la zone stockée n'est **pas** la zone d'écran : `1070:1d25` ajoute 40 en y aux scripts de Poly, `1070:1778` réécrit entièrement la zone des vols.
- **scr.md « 1 script POLLY hors plage »** : sans rapport avec `NIM.DAT`.
- **scr.md « Statistiques »** : les 387 hooks de NIM = 21 vols × 18 + 9 hooks d'effets de palette dans `SCR` 1050 (arguments 1 à 9, code mort) ; le hook 0 de paramètre 0 redessine les emplacements d'indice supérieur et Poly (`1070:19e4`).
- **engine.md §3.6** : les drapeaux de descripteur `0x13` (vols, Poly) activent les bits 0 (fond sauvegardé), 1 (MIDI conservé) et 4 (attente des sons) ; le bit 3 (interruptible) est posé à la volée par `1d25`.

## Annexe A. Tables brutes du segment de données

Rectangles d'aide (`DS:290c`, 10 × 8 octets `(g, h, d, b)`) : 1 (472,139,527,432), 2 (452,248,546,268), 3 (264,357,318,380), 4 (261,325,289,352), 5 (403,335,472,380), 6 (333,335,402,380), 7 (34,159,488,309), 8 (51,335,250,380), 9 (294,326,323,351), 10 (157,123,380,149).

Formes `288e` (21) : 46, 22, 16, 58, 52, 61, 4, 28, 7, 19, 34, 37, 43, 25, 55, 49, 1, 31, 10, 40, 13. `28b8` : 9, 25, 25, 18, 15, 18, 18, 17, 29, 24, 16, 25, 23, 19, 19, 10, 26, 16, 12, 22, 17. `28e2` : 100, 98, 100, 97, 93, 95, 97, 98, 97, 99, 100, 97, 95, 102, 96, 99, 97, 98, 99, 97, 99.

Tables de scripts (mots de 16 bits) : `276c` = {4800, 5000, 5100, 5200, 5300} ; `277a` = {5400, 5900, 6400, 6900, 7400, 7800, 8300} ; `278c` = {5500, 6000, 6500, 7000, 7900, 8400} ; `279c` = {5600, 6100, 6600, 7100, 7500, 8000, 8500} ; `27ae` = {5700, 6200, 6700, 7200, 7600, 8100, 8600} ; `27c0` = {5800, 6300, 6800, 7300, 7700, 8200, 8700} ; `27d2` = {2500, 2600, 2700, 2800, 2900, 3000, 3100} ; `27e4` = {1300, 1400, 1500, 1600, 1700, 1800, 1900, 1200} ; `27f8` (sons de lancement) = {3033, 3034, 3035, 3036, 3037, 3058, 3059, 3060, 3061, 3062, 3063, 3064} ; `2814` = {2200, 2300, 2400} ; `281e` = {9300, 9400, 9500, 9600} ; `282a` = {9300, 9400, 9500, 9600, 4900}. Les mots d'état de tirage sans remise suivent chaque table (4 octets : `2776`, `2788`, `2798`, `27aa`, `27bc`, `27ce`, `27e0`, `27f4`, `2810`, `281a`, `2826`, `2834`).

Autres : rectangle des yeux `DS:2852` (470, 160, 523, 189) ; rectangle du champ `DS:2a38` (34, 159, 488, 309) ; rectangle de la zone de Poly `DS:7cfa` (404, 125, 576, 432) ; rectangle de redessin pendant un vol `DS:2ae8` (391, 239, 493, 390) ; position du chiffre M `DS:2a24` (267, 124, 301, 148) ; position du panneau stop `DS:2af0` (481, 254, 507, 280).

## Implémentation (tâche H3)

Code : `src/games/mathemagique/scenes/rockets-logic.ts` (pur) et `scenes/rockets.ts` (`createRocketsScene(services)` rend une `RocketsScene`, une `Scene` qui expose en plus `state`, `busy`, `polyVisible`, `helpOpen`, `lastResult`, `played`, `helper` pour les tests). Tests : `test/mathemagique/rockets.test.ts` (45 tests, ceux qui lisent `NIM.DAT` sont ignorés sans `original/mathemagique/`). **Copy visible : aucune** (tout est voix ou dessin), rien à valider.

### Fait

- **Logique** : `polyChooseTake` (§1.4, étapes A et B), `polyPickSlot(s)` (étape D), tirages sans remise (`RocketsPools`, §2.5), planificateurs de scripts de Poly (`12ed` : `planAnnounceTake`, `planAnnounceMaxTake`, `planReminder`, `planPrompt`, `planGameOver`, `planPolyWins`, `planChildWins`, `planFarewell`, `planEnter`), adaptation du niveau `applyGameResult` avec `RocketsRules.polyStreakResets` (défaut `false` = défaut d'origine reproduit, décision de la vague H), pavé (`choosePadValue`, `randomTotalSequence`), dispositions (`parseLayout`), géométrie des vols (`flightClip`), test de clic pixel-exact (`hitTestSlots`).
- **Scène** : entrée (`useArchive` `NIM.DAT`, palettes `SHPL` 40000 et 999, sons préchargés, fondu de 30 ticks, musique `SND` 201 seulement si « Ambient Sounds » est actif, Poly entre `2000`, salue `2100`, annonce M) ; jeu contre Poly (tour de l'enfant, fin de tour au M-ième lancement ou clic sur Poly, rappel « lance au moins une », IA, annonce, vols, invite « à toi », fin de partie, voix de victoire, adaptation du niveau) ; mode ami (Poly part `2200`/`2300`/`2400` puis `9700`, aucune limite par tour, aucune voix de fin) et retour au mode Poly (elle revient, M ramené à 3 hors de [2, 5]) ; changement de M (cycle 5 → 2 / 10 → 2, seulement au début ou à la fin de partie, commentaire de Poly 120 ticks plus tard) ; pavé de nombres et tirage « ? » (15 images de 3 ticks, son 3115) ; Reset ; aide « ? » par `PolyHelper` + `ROCKETS_POLY` (zones de §1.8, panneau stop, drapeau du roster `rocketsHelpIntroSeen` enregistré tout de suite) ; Exit (au revoir, fondu de sortie, `ctx.scenes.request(SceneId.hub)`) ; `exit()` de la scène = même sortie sans au revoir ; clignement des yeux ; `endScene()` dans `leave`.
- **Vols** : mécanisme des décalages du §2.6 : `scr.start(archive, 30000 + type, { clipOverride: flightClip(...), blocking: true, flags: sauvegarde du fond + MIDI conservé + attente des sons })` ; la `SHPL` 30000 est résolue par le lecteur (décalage = type). L'emplacement qui part est retiré du décor avant le vol ; à chaque tick, les fusées d'indice supérieur et Poly sont redessinées par-dessus (rôle du hook 0 de `1070:19e4`). Scripts de Poly : `offsetY: 40`, canal `voice`, fond **sans** Poly statique (chaque script dessine tout le personnage), pose neutre redessinée si le script est interrompu.
- **Vérifié** : tous les vecteurs du §7.4 passent (aléa graine 0 et 1, `poolPick` n = 3 et 12, les 8 cas de `polyChooseTake` et les propriétés sur 10 000 graines, `polyPickSlots` `[5]` / `[5, 1, 6]`, adaptation 2,1,1,1 puis 1,2,2,3,3,4 et la variante corrigée 2,1,1,0, géométrie du pavé, 11 dispositions avec leur composition, masques et tailles de fusées, présence dans `NIM.DAT` de tous les scripts et sons utilisés). Une partie complète est jouée au clic sur le moteur (TestHost, vraies données) : l'enfant fait jouer Poly en premier, applique `reste mod (M+1)` et gagne ; aussi mode ami, aide (1100 puis 4500, roster), Exit vers le hub. Rendu inspecté image par image (décor, vol, annonce de Poly) hors navigateur en exportant les images présentées.

### Écarts et hypothèses

- **Départ de Poly sans fusée devant** : en mode ami, les zones de clic de Poly (groupe C, 1 et 2) sont désactivées tant qu'elle est absente, pour que le bord droit du champ (x de 472 à 499) reste cliquable ; l'original les garde actives (§2.3).
- **Sons des boutons** (hypothèse, §8 q.3) : lecture ordonnée de la table `DS:2a74` sur les cinq boutons : Reset 3116, Help 3012 ou 3013 (50/50), Exit sans son, « Poly » et « a Friend » 3114. 3004, 3006 et 3007 (absents de toutes les archives) ne sont pas joués.
- **Fondu de sortie** : 30 ticks, comme celui d'entrée (la durée de `1070:1131` n'est pas relevée). Le noir est tenu : la scène suivante doit lancer son propre fondu (ou `clearFade`).
- **Tirages sans remise** : l'état (`RocketsPools`) est par visite de la scène ; l'original le garde dans le segment de données, donc d'une visite à l'autre.
- **Intro** : `2000` puis `2100` à chaque entrée ; le drapeau `rocketsHelpIntroSeen` ne concerne que l'aide (§1.8) ; sans joueur courant (`currentPlayerId = 0`) l'introduction longue est rejouée à chaque ouverture de l'aide et rien n'est enregistré.
- **Boutons B** : activés à l'appui, A au relâchement (hypothèse du §2.3). Le pavé et le chiffre de M lisent la position vivante de la souris au moment du rappel (l'événement ne la porte pas).
- **Clics pendant une animation** (§8 q.7) : ignorés (le lecteur gèle gadgets et pointeur en mode bloquant ; entre deux actions de la file, `busy` les ignore aussi). Un clic interrompt seulement les scripts interruptibles (salutation, annonce de M, aide, au revoir).
- **Hors périmètre** (code mort) : séquence secrète (§1.9). Non gérés : `7c16`, variante « la dernière perd ».

### Dette et points ouverts

- Le lecteur de scripts compose avant `Scene.tick` et appelle les hooks avant la composition : le hook 0 de l'original (redessin des fusées de devant et de Poly par-dessus un vol) est donc remplacé par `drawFront`, appelé à chaque tick après la composition. Un rappel « après composition » dans `scr-player` le rendrait inutile.
- À vérifier dans le navigateur (vague finale) : absence de traces entre deux scripts de Poly, bord du bouton « a Friend » sous Poly, enchaînement fondu / musique / entrée de Poly.
