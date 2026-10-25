# Armaeth : déplacement, placement, barrages et trajets (`AM1.EXE`)

Étude détaillée du déplacement des objets mobiles (`179d:0004`), de la recherche de position valide (`1aba:000e` et `1b11:000c`), des codes de barrage des sorties (`1414:0006`) et des trajets (`3187:0000`, `305e:0002`, `30d9:0006` et `30d9:0184`). Elle complète et corrige `engine.md` § 7 et § 13 (questions 1 à 3 et 6) ; la structure des objets est dans `engine.md` § 6, les scènes dans `graphics.md`. Les objets, les personnages et l'interface sont traités par `objects.md`, `characters.md` et `interface.md`.

Sources : désassemblage et décompilation Ghidra (`archives/armaeth/re/`), relus fonction par fonction, puis recoupés par des calculs sur les données du jeu (`A1FCFG.SYS`, 60 scènes `A1F*.VGA`). Aucune exécution dynamique : ce qui dépend du rythme réel ou d'un objet précis du scénario est dit comme tel. Script de validation : `validate.ts` et ses modules (`lib.ts`, `place.ts`, `mover.ts`, `graph.ts`, `render.ts`) dans le dossier de travail de l'étude, hors dépôt ; leurs résultats sont cités à chaque section.

**Confiance** (même échelle que `engine.md`) : **certain** = lu en entier dans le code, **probable** = lu mais un rôle ou une valeur reste déduit, **hypothèse** = lecture plausible non établie. **Validé** = recoupé par un calcul sur les données.

Conventions : adresses `segment:offset` Ghidra (base `1000`). Les variables `iRam0004xxxx` du décompilat valent `DGROUP:(xxxx - 0x42d70)` : par exemple `iRam0004a48c` est `DS:771c`, la position X de la **copie de sauvegarde** de l'objet en `DS:76c8` (l'objet est copié octet pour octet en `76c8` avant tout déplacement ; X = `76c8 + 0x54`). Une position est `(X, Y, P)` : X = centre du sprite, **Y = pied** (hauteur à l'écran, relative à la fenêtre de la scène), P = profondeur ; `N` = plan de marche, `Sol` = type de case sous les pieds. Cases : `colonne = X >> 2`, `rangée = P >> 3`.

## 1. Données utilisées

### 1.1 Grille de marche, limites, plans

- **Grille** (`engine.md` § 7.1, `1cc3:02b0..048a`, validée) : par plan, 21 rangées de 81 cases ; `type[plan][rangée][colonne]` (octet) et `iv[...]` (mot `hi << 8 | lo`, `0xFFFF` = case vide). Remplissage : pour un enregistrement `{type, plan, rangée, c0, hi0, lo0, c1, hi1, lo1}`, `n = c1 - c0 + 1`, pour `i = 0 .. n - 1` : `lo = lo0 + trunc((lo1 - lo0) * i / n)`, `hi = hi0 + trunc((hi1 - hi0) * i / n)` (produit sur 16 bits signés, division entière tronquée vers zéro) ; une seule case : moyenne `(a + b) >> 1`. **`lo` est la hauteur Y du sol** pour un type >= 2 (`hi` vaut 179 pour un sol) ; pour un type 1 (obstacle plein) `[lo, hi]` est l'étendue verticale du mur.
- **Limites de la salle** (`1cc3:0290..02d1`, mots +0x12..+0x1C de l'en-tête de scène, c'est-à-dire `header.words[9..14]` de `readScene`) : `Xmin = 4ac8`, `Xmax = 4aca`, `Ymin = 4ace`, `Ymax = 4ad0`, `Pmin = 4ad4`, `Pmax = 4ad6` (typiquement `0, 319, 0, 179, 8, 159` ; scène 3 : `0, 199, 0, 99, 8, 111` ; scène 202 : `Ymin = 14`). Étendues maximales hors salle : `4acc = 319` (X), `4ad2 = 199` (Y), `4ad8 = 255` (P), minimum 0.
- **Nombre de plans** : `DGROUP:4ae0`, copié du mot +0x1E de l'en-tête (1 à 3) **puis ajusté par `147f:000a`** (niveau initial = 3 ; règles par salle : `engine.md` § 5.5, **certain**, code porté et testé : salle 5 stèle `Num 16`/`Ego 4` -> 2 ; salle 108 dalle `Num 104`/`Ego 3` -> 2 ; salle 202 : 2 avant le chapitre 3 ; salle 205 : sous-niveau >= 3 -> 1 ; salles 212 et 312 : 1 ou 2 selon `Num 215` / `Num 318`). Le mouvement et le placement utilisent `4ae0`, pas le compte du fichier.
- **Zones** (`4ada`, `4ade` enregistrements de 16 octets, uniquement pour `Dep` 2 et 4) : `{u8 type, u8 0xFF (jamais un plan), s16 rangée, s16 col début, s16 Y haut (hi), s16 Y bas (lo), s16 col fin}`. 71 zones dans les données (types 11, 15, 16, 17, 19, 48, 49, 50, 51, 59) ; aucun objet de `CFG` n'a `Dep` 2 ou 4.
- Types de case présents (cases remplies, 60 scènes) : 1 (19 737), 2 (30 880), 3 à 7, 28, 29, 33, 35 à 40, 44 à 47, 52 à 58, 60 à 65, 68, 69, 80 à 83, 90 à 92, 110 à 114. Le type 0 est « rien ».
- **Étendues horizontales par rangée** (`DGROUP:4bac`, 20 paires) : servent au masque de profondeur (§ 3.4).

### 1.2 Champs d'objet utilisés

`X +0x54`, `Y +0x56`, `P +0x58`, `N +0x53`, `Sol +0x5A`, `Xyp +0x52`, `Err +0x3E`, `Inf +0x3F`, `Col +0x3C`, `Dep +0x07`, `Txt +0x08`, `Typ +0x04`, `Hau +0x4C`, `Lar +0x4D`, vitesses `Hor +0x60`, `Ver +0x61`, `Prf +0x62` (octets signés), pas par tic `dpX +0x45`, `dpY +0x46`, `dpP +0x47`, conteneur `+0x5C` (far). Les pas viennent de l'enregistrement d'animation de 12 octets : `rec[2] -> dpX`, `rec[3] -> dpY`, `dpP = 1` (`engine.md` § 6.3). **Mesuré** sur la figure 0 de chaque mobile de `CFG` (`OBJ`/`ANM`) : héros (Num 1) `dpX 2`, `dpY 4` ; ours (Num 4) `3` et `2` ; pie (Num 3, `Dep 1`) `4` et `3` ; nains (201 à 204, 301), Minas (303), objet 101 : `2` et `4`. Les scripts peuvent les changer (`dpx`, `dpy`, `dir`, `dep`, `mob`, `txt`, `parser.md`).

**`Txt`** (+0x08) fait plus que décrire l'objet : `Txt == 2` rend l'objet **immatériel pour le terrain** (pas de test de collision de case `1c96:0102`, pas de masque de profondeur, murs ignorés par le placement et par le déplacement `Dep 0`, traverse les barrages `1414:0006`, § 5) ; `Txt != 0` rend le contact avec un autre objet non bloquant (`Err 9`, § 3.3) ; seul `Txt == 0` est soumis au masque de profondeur. Dans `CFG` : `Txt 2` = les 29 objets d'interface (type 0, `Dep 1`) et 27 objets de type 2 (19 de `Dep 1`, 8 de `Dep 0`) ; `Txt 1` = 12 objets de type 2 ; tous les mobiles (`Mob 2`) ont `Txt 0` (**probable**, rôle d'ensemble déduit de ces usages).

## 2. Le déplacement : `179d:0004` (certain, validé pour `Dep 0`)

Appelé une fois par mise à jour pour les objets `Mob == 2` dont `Cod == 1` (`majObjet` `1890:0006`, `engine.md` § 6.2). Le résultat est `o.Err` ; **tant que `Err != 0`, l'appel suivant ne fait rien** (première ligne : `si Err != 0 retour`) : c'est la procédure de l'objet (`Fct`, `246c:0240` pour les personnages) qui lit `Err`, agit et le remet à 0. Cela vaut aussi pour `Err 9`, `0x0A` et `0x11`, qui sont des succès. Le déplacement est **un pas par appel, à vitesse constante** : il n'y a ni accélération ni inertie ; la chute (`Dep 3`) et le vol (`Dep 1`) sont des pas constants (§ 2.6, § 2.7).

### 2.1 Prologue

```text
vol       = (Dep == 1 || Dep == 3)
dansSalle = (conteneur == salle courante 4b84:4b86)
si !dansSalle || (Typ == 0 && vol) : boîte = [0,4acc] x [0,4ad2] x [0,4ad8]
sinon                              : boîte = [4ac8,4aca] x [4ace,4ad0] x [4ad4,4ad6]
si Xyp == 1 : si dansSalle : r = placer(o, 5) ; si r ∉ {0, 0x11} : retour   // l'objet vient d'entrer dans la salle chargée
sinon si Xyp == 2 et !dansSalle : Xyp = 1
Sol0 = o.Sol ; sauvegarde = copie de l'objet (0x90 octets) en 76c8
si dansSalle : animStep(o, 0)          // met à jour Hau/Lar (engine.md § 6.3)
Hau, Lar = o.Hau, o.Lar
si vol : N' = 0, Sol' = 0   sinon : N' = sauvegarde.N, Sol' = sauvegarde.Sol
X' = X + Hor * dpX            (sens = signe de Hor, pas dpX de la sauvegarde)
P' = P + sgn(Prf) * (dpP != 0 ? 1 : 0)
Y' = Y + (Ver != 0 && Dep != 0 ? sgn(Ver) * dpY : 0)        // pour Dep 0, Ver est ignoré
```

`placer(o, 5)` : voir § 4.1 (type de case demandé = `Sol`, repli sur le mode 1). Les limites `boîte` sont utilisées par le test final des bords (§ 2.8) ; le test d'entrée de `Dep 0` utilise les limites de la salle, pas la boîte.

### 2.2 `Dep 0` : marche sur le sol (certain, **validé**)

```text
si !dansSalle : appliquer(X', Y, P', N')                       // aucune vérification de sol
sinon si X' ∉ [4ac8, 4aca] ou P' ∉ [4ad4, 4ad6] : appliquer(X', Y, P', N')   // sortie vers un bord, traitée en § 2.8
sinon :
   si (X'>>2, P'>>3) == (X>>2, P>>3) :                          // même case
        Y' = hauteurSol(N, X', P')                              // § 2.3 (1c96:0000)
   sinon :                                                      // changement de case : choix du plan
        niveau = {dist 0xFFF, type 0, plan -}, dessous = {dist 0xFFF, type 0, plan -}
        pour plan de 4ae0 - 1 à 0 :                              // du dernier au premier
            t = type[plan][P'>>3][X'>>2] ; si t == 0 : suivant
            d = lo - Y                                          // Y = ancienne hauteur
            si d > 0 :  // sol plus bas que les pieds
                  si d < dessous.dist : dessous = {d, t, plan}  // y compris un type 1 (jamais choisi plus loin)
                  suivant
            si t >= 2 et -d < niveau.dist : niveau = {-d, t, plan}
            si hi < Y : suivant                                 // l'intervalle finit au-dessus des pieds
            si t >= 2 : arrêter la boucle                       // pieds dans [lo, hi] d'un sol : on s'arrête là
            si Txt == 2 : suivant
            sinon : Err = 1 ; échec                             // mur plein couvrant Y
        choix :
            niveau.type < 2 :  dessous.type < 2 ? Err = 5 (échec) : dessous
            sinon : dessous.type < 2 ? niveau
                    : (dpY < niveau.dist ? dessous : (dessous.dist >= niveau.dist ? niveau : dessous))
        N' = plan choisi ; Sol' = son type
        Y' = hauteurSol(N', X', P')
   si |Y' - Y| > dpY : Err = (Y' > Y ? 5 : 6) ; échec          // 5 = sol trop bas (chute), 6 = marche trop haute
   appliquer(X', Y', P', N')
```

Remarques :

- **Escaliers et ponts** : un plan est choisi à chaque *changement de case* parmi ceux dont le sol est proche de la hauteur actuelle ; à l'intérieur d'une case le plan ne change pas. La contrainte `|ΔY| <= dpY` (4 pour le héros) est la seule limite de pente. **Validé** : sur 269 000 pas simulés depuis chaque échantillon praticable des 60 scènes (`validate.ts`, héros `dpX 2`, `dpY 4`, `dpP 1`), 97,6 % des pas en X (2 px) et 86,3 % des pas franchissant une rangée réussissent ; les échecs sont `Err 1` (mur, 1,4 % des pas en X, 8,9 % des franchissements de rangée), `5` et `6` (falaises : 0,14 % des pas en X), `0x0A` (bord de la salle) ; 322 pas changent de plan (par exemple en salle 5). Par ailleurs 99,99 % des écarts de hauteur entre deux échantillons voisins du sol de toutes les salles sont `<= 4` : la grille est dessinée pour la contrainte `dpY` du héros (les 20 écarts de 5 à 13 sur 271 528 sont des falaises, par exemple en salle 12).
- La valeur initiale `0xFFF` des distances et le choix « niveau » (le sol à la hauteur des pieds ou au-dessus) contre « dessous » (sol plus bas) donnent la **priorité à la marche à niveau** : on ne descend sur un autre plan que si le plan actuel n'offre plus de sol à portée de `dpY`.
- Hors d'une case praticable (`Err 5` sans candidat) le héros reste sur place : c'est ainsi que les types 0 bornent la zone de marche.

### 2.3 Hauteur du sol (`1c96:0000`, certain, **validé 59 / 59**)

```text
hauteurSol(plan, X, P) :
   i = (plan * 21 + (P >> 3)) * 81 + (X >> 2) ; h0 = lo(i)
   r = h0
   si X & 3 : d = type(i+1) >= 2 ? lo(i+1) - h0 : type(i-1) >= 2 ? h0 - lo(i-1) : 0 ; r = h0 + (((X & 3) * d) >> 2)
   si P & 7 : d = type(i+81) >= 2 ? lo(i+81) - h0 : type(i-81) >= 2 ? h0 - lo(i-81) : 0 ; r += ((P & 7) * d) >> 3
```

Décalages arithmétiques sur des entiers signés. C'est une approximation **plane** (la pente en P est lue à la colonne de base, sans interpolation croisée). Le placement (§ 4.3) utilise une variante **bilinéaire** (les quatre coins de la case, extrapolés par `2 * lo - lo(voisin opposé)` si le voisin n'est pas praticable) qui diffère de 1 sur 0,8 % des points (3 048 de 400 992 échantillons).

**Validation sur `CFG`** : les 60 objets de type 2, en salle, `Dep 0`, sur case praticable : les deux formules redonnent `Y` pour **59 objets, soit tous ceux qui sont déjà posés** (`Sol != 0`) ; `Sol` est égal au type de la case pour 59 ; 36 d'entre eux exigent l'interpolation (28 avec `X & 3` et `P & 7` non nuls). Le soixantième (objet 207, série 50, salle 202, `Sol = 0`) n'a jamais été posé : sa hauteur 105 est de 1 au-dessus du sol (104). Contrôle visuel : superposition de la grille sur les décors des salles 1 et 202 (points verts = plan 0, bleus = plan 1, rouges = murs de type 1) : la grille suit exactement le relief des images (pelouse et lac de la salle 1, sol et ponts de pierre de la salle 202).

### 2.4 `Dep 1` : vol libre

`Dep 1` (pie, objets au sol de `CFG`) n'a **pas de test de sol** : `X', Y', P'` sont appliqués puis soumis aux collisions (§ 3). Y avance de `sgn(Ver) * dpY` par tic. Une case dont l'intervalle `[lo, hi]` recouvre la hauteur de l'objet bloque un voleur avec `Err 2` (résultat 2 de `1c96:0102` pour `Dep 1` ou `3`, § 3.4) ; `Sol'` vaut 0 : si `o.Sol != 0` le changement de type appelle `13a8:000a(0)`, qui refuse le type 0 (`Err 2`) : **un objet de `Dep 1` doit avoir `Sol == 0`** (c'est le cas dans `CFG`).

### 2.5 `Dep 2` et `Dep 4` : zones (`4ada`)

```text
si !dansSalle : Err = 0x15 ; échec
c = X' >> 2 ; r = P' >> 3 ; Y' = Y + sgn(Ver) * dpY (Ver != 0)
pour zone dans les 4ade zones :
    si zone.rangée == r et zone.c0 <= c <= zone.c1 et zone.lo <= Y' <= zone.hi :
          Sol' = zone.type ; N' = 0 ; appliquer(X', Y', P', 0) ; fin
Err = 5
```

Seul `Dep 4` modifie l'animation (`animStep` : à l'arrêt avec `Ver != 0`, la direction est forcée à 3, « vers le fond »). **Probable** : les zones modélisent les échelles et les surfaces de nage/escalade (types 11, 15...) ; aucun objet de `CFG` ne les utilise (le script `dep` les active, § 1.2), donc **non validé**.

### 2.6 `Dep 3` : chute « à cases » (certain pour le code, jamais exercé par `CFG`)

```text
dY = dpY != 0 ? dpY : 4 ; bas = Y + dY ; haut = bas - Hau + 1        // X' et P' sont ignorés
si dansSalle :
    pour plan de 4ae0 - 1 à 0 : si type(plan, P>>3, X>>2) >= 2 et haut <= lo <= bas : Err = 7 ; Inf = type ; échec   // atterri
sinon : si haut <= Ymax(4ad0) <= bas : Err = 7 ; Inf = 2 ; échec
o.Y = bas - 1                                                            // chute de dY - 1 pixels par tic, écrite dans l'objet
r = placer(o, 6, tolérance P libre, tolérance Y = max(Hau, 4), signe Y = +1, tolérance X libre)   // § 4
si r == 0x17 : bord bas (côté 5) ; sinon si r ∈ {0, 0x11} : suite
sinon : si X - Lar/2 < Xmin : côté 3 ; X + Lar/2 > Xmax : côté 1 ; P - 2 < Pmin : côté 0 ; P + 2 > Pmax : côté 2 ;
        sinon 2e placement (tolérance Y libre, signe Y = +1) : 0x17 -> côté 5 ; échec -> Err = 0x16
suite : (X', Y', P') = position écrite par le placement ; Tim += 1 ;
        si Tim > 4 : Hor = sgn(ancienX - nouveauX), Prf = sgn(ancienP - nouveauP), Ver = 1 (signe inversé, voir § 8) ; animStep(o, 7) si changement
```

Le résultat `Err 7` ne déplace pas l'objet (position restaurée) : c'est le signal « posé » pour la procédure de l'objet (qui le fixe, `Mob 0`). **Probable** : c'est la chute des objets lâchés (`dep 3` posé par les scripts). La mise à jour des vitesses en fin de chute sert à orienter l'animation.

### 2.7 Appliquer, collisions, changement de type

```text
appliquer(X', Y', P', N') :
    o.X, o.Y, o.P, o.N = X', Y', P', N'
    Err = collisionObjets(o)                      // 1a50:0006, § 3.3
    si Err ∉ {0, 9} : échec
    si dansSalle :
        r = collisionTerrain(o)                   // 1c96:0102, § 3.4
        si r != 0 : Err = r ; échec
        si Sol' != Sol0 :
            si 13a8:000a(Sol', 7, o) != 0 : Err = 2 ; Inf = Sol' ; échec     // type refusé par cet objet, § 7
            si Err == 0 : Err = 0x11
        o.Sol = Sol'
    → § 2.8
```

`échec` = aller en § 2.9 (restauration). `Err 9` (contact avec un objet de `Txt != 0`) n'empêche pas le mouvement.

### 2.8 Bords et sorties

Après un déplacement réussi, avec la **nouvelle** position (limites = `boîte`) :

```text
si P < Pmin : côté 0 ; si P > Pmax : côté 2                      // sortie dès que le centre sort de la boîte en P
sinon :
   gauche = X - (Lar >> 1)
   si gauche < Xmin : touche = vrai ; côté 3 ; si X < Xmin : SORTIE
   sinon si gauche + Lar - 1 > Xmax : touche = vrai ; côté 1 ; si X > Xmax : SORTIE
   puis : si Y - Hau + 1 < Ymin : touche ; côté 4 ; si Y < Ymin : SORTIE
          sinon si Y > Ymax : touche ; côté 5 ; SORTIE
```

Un sprite qui déborde seulement par le bord (centre encore dans la boîte) n'est pas une sortie : `touche` donne `Err = 0x0A` avec `Inf = côté`. En cas de **SORTIE** (`Err` encore 0, 9 ou 0x11) :

```text
emplacement = salle ? inv4b94[côté] : côté ; Inf = emplacement
code = conteneur.barrages[emplacement] ; si code != 0 et 1414:0006(code, 1, o) != 0 : Err = 0x0F      // § 5
sinon si conteneur.sorties[emplacement] != 0 : Err = 0x0B
sinon si Txt == 2 : Err = 0x0C                                  // (engine.md écrivait « Typ == 2 » : c'est Txt, +0x08)
sinon : Err = dansSalle ? 0x0E : 0x01
```

### 2.9 Fin : succès ou restauration

```text
si Err ∈ {0, 9, 0x11} : si touche : Err = 0x0A ; Inf = côté
sinon : // le mouvement est annulé
     sauvegarde.Inf = o.Inf ; sauvegarde.Col = o.Col ; sauvegarde.(+0x66) = o.(+0x66)     // ces trois champs survivent
     o = sauvegarde (0x90 octets)
o.Err = Err
```

Donc `Err 0x0B`, `0x0F`, `0x0C`, `0x0E`, `1`, `2`, `5` à `8`, `0x15`, `0x16` **ne déplacent pas** l'objet ; `0`, `9`, `0x0A` et `0x11` le déplacent. Le traitement d'une sortie (`186d:000c`, changement de salle, `Err 0x12`) est dans `engine.md` § 5.4 ; à noter que `186d:000c` **réévalue** le barrage (avec `DX = 2`) : pour les codes à tirage au sort (5 et 6) le premier test (mouvement) peut laisser passer et le second bloquer (`Err = 0x0F`, retour 0).

### 2.10 Codes `Err` produits par le déplacement

| Code | Origine | Sens |
|---|---|---|
| `0` | | pas fait |
| `1` | `179d` (mur de type 1 couvrant Y), `1c96:0102`, bord hors salle | obstacle plein |
| `2` | `13a8:000a` (type refusé, `Inf` = type) ou `1c96:0102` (vol sur une case) | refus de case |
| `4` | `1c96:0102` | masque de profondeur (§ 3.4) |
| `5` | `179d` | pas de case praticable, ou sol plus bas que `dpY` |
| `6` | `179d` | marche plus haute que `dpY` |
| `7` | `179d` (`Dep 3`) | atterri, `Inf` = type de case |
| `8` / `9` | `1a50:0006` | contact avec un autre objet (8 bloque, 9 non) |
| `0x0A` | `179d` | pas fait, sprite sur un bord (`Inf` = côté) |
| `0x0B` | `179d` | sortie existante (`Inf` = emplacement) |
| `0x0C` | `179d` | bord sans sortie pour un objet `Txt 2` |
| `0x0E` | `179d` | bord sans sortie, objet normal en salle (disparition) |
| `0x0F` | `179d`, `186d:000c` | barrage |
| `0x11` | `179d`, `1b11:000c` | pas fait, le type de case a changé |
| `0x12` | `186d:000c`, `engine.md` § 5.4 | en transit de salle |
| `0x14` | `1b11:000c` | aucune position trouvée |
| `0x15` | `179d` (`Dep 2/4` hors salle), `1b11:000c` | opération impossible hors salle |
| `0x16` | `179d` (`Dep 3`) | 2e placement refusé |
| `0x17` | `1b11:000c` | fenêtre de recherche vide (conflit de bornes) |

## 3. Collisions

### 3.1 Résumé

Dans l'ordre : (1) `1a50:0006` objets, (2) `1c96:0102` terrain (cases, puis masque de profondeur), (3) `13a8:000a` type de case. `Dep 0` ajoute en amont la contrainte de pente (§ 2.2).

### 3.2 Masque de profondeur (couche B de la scène)

Le test est fait par le pilote vidéo (`pilote[+0x2e]`, table `DS:0eac`) : un pixel opaque du sprite de l'objet tombe-t-il sur une valeur du plan de priorité (`DS:0ee0`) égale à `P` ? Il n'est fait que si `(P & 7) == 0` (P multiple de 8), `Txt == 0`, et si la **boîte horizontale du sprite** `[X - Lar/2, X - Lar/2 + Lar - 1]` recoupe l'étendue de la rangée `[4bac + 4 * (P >> 3), 4bae + 4 * (P >> 3)]` (la table de 20 paires, `graphics.md`). Résultat `> 0` : `Err 4`. C'est un test partiel (rangées de profondeur seulement), il ne s'applique pas entre deux rangées. **Défaut d'origine reproduit** (certain, code porté et testé) : le test lit **toujours le sprite en miroir** (`1000:0e1a` saute en `0eea`), quel que soit le sens de l'objet.

### 3.3 Objets : `1a50:0006` (certain)

Parcourt la liste A de la salle (objets de type 2, chaînage `Lis` +0x80), hors l'objet. Deux objets se touchent si : même **`P` exactement** ; recouvrement horizontal `[X - Lar/2, +Lar)` ; et, si l'objet est dans la salle ou a `Dep != 0`, recouvrement vertical strict `(Y - Hau, Y]` (sinon seulement X et P). Alors `o.Col = autre.Ser` ; `o.Err = (o.Txt != 0 || autre.Txt != 0) ? 9 : 8` ; l'autre objet reçoit `Err = 8 + (o.Txt != 0)` et `Col = o.Ser` s'il n'avait pas d'erreur ou s'il a `Gst 7`. La boucle s'arrête au premier contact sauf si `o.Txt == 0` et `autre.Txt != 0`. **`Err 8` bloque, `Err 9` non.**

### 3.4 Terrain : `1c96:0102` (certain)

Pour un objet de `Txt != 2` : colonnes de `max(gauche, Xmin) >> 2` à `min(gauche + Lar - 1, Xmax) >> 2` à la rangée `P >> 3`, plans du dernier au premier. Une case bloque si elle est définie, `lo <= Y` et `Y - (Hau - 1) <= hi`, **et** (type 1 ou `hi < Y`) : résultat 1, `Inf = type` ; pour un objet de `Dep` 1 ou 3 toute case qui recouvre ainsi la hauteur de l'objet bloque avec le résultat 2. Sans blocage : masque de profondeur (§ 3.2) -> résultat 4. Pour `Txt == 2` : résultat 0 sans rien tester.

## 4. Placement : `1aba:000e` et `1b11:000c`

### 4.1 `placer(o, mode)` : `1aba:000e` (certain)

Après `1833:01fc` (ressource sprite) et `Err = 0`, selon le mode. `gm_object_behavior_main(AX = mode', DX = signe X, BX = tolérance X, p1 = type, p2 = tolérance P, p3 = signe P, p4 = tolérance Y, p5 = signe Y)` (ci-dessous `rech`; tolérance −1 = illimitée ; signe 0 = libre) :

| Mode | Effet |
|---|---|
| 0 | tout à zéro : `N = X = Y = P = Sol = Xyp = 0` (objet absent) |
| 1 | `rech(6, 0, −1, 0, −1, 0, −1, 0)` : le plus proche de la position actuelle, sans contrainte |
| 2, 6, 8 | `Xyp = mode`, aucune vérification |
| 3 | `rech(6, 0, **10**, 0, **4**, 0, −1, 0)` : tolérance **10 en X et 4 en P** |
| 4, 5 | `rech(6, ..., p1 = o.Sol)` : exige le type de case `Sol` ; si échec (résultat ∉ {0, 0x11}) et mode 5 : mode 1 |
| 9 | tirage `X = rand() % 4acc`, `P = rand() % 4ad8`, `Y = rand() % (4ad2 - 10) + 10` pour `Dep 1/3` sinon `4ad2`, `N = Sol = 0`, puis comme le mode 1 |
| 10 | `Sol = 0` puis `rech(AX = o.Inf, ..., p1 = 0)` : **`AX` = le côté `Inf`** (0 à 5, 6 = libre) |
| 7, > 10 | `gm_abort` |

Si le résultat est 0 ou 0x11 : drapeaux `4c18` (c'est le héros), `4c16` (c'est la sélection), `4c1a` (`Typ 0`), et redessin du fond si `Mob == 0` dans la salle ou `DX = 99`. Le **mode** de `AX` pour `rech` (0 à 5, 6) est un **côté** de la salle, dans la numérotation de `engine.md` § 5.1 : la recherche **fige une des six bornes** :

| `AX` | Côté | Effet sur la fenêtre de recherche | Échantillonnage |
|---|---|---|---|
| 0 | fond | `Pmax := Pmin` | 1 sous-position en P |
| 1 | droite | `Xmin := Xmax` | 1 sous-position en X |
| 2 | avant | `Pmin := Pmax` | 1 sous-position en P |
| 3 | gauche | `Xmax := Xmin` | 1 sous-position en X |
| 4 | haut | `Ymax := Ymin` | complet |
| 5 | bas | `Ymin := Ymax` | complet |
| 6 et plus | aucun | | complet |

L'arrivée dans une salle (`1aba:0310`, `engine.md` § 5.4) utilise le mode 10 avec `Inf` = côté géométrique d'arrivée (`4b88[opposé]`) : l'objet est posé sur le bord opposé à celui par lequel il est sorti, **le long de ce bord seulement**.

### 4.2 Paramètres de `1b11:000c` (certain)

`gm_object_behavior_main(param_1 = type, param_2 = tolérance P, param_3 = signe P, param_4 = tolérance Y, param_5 = signe Y, param_6 = objet ; AX = côté, DX = signe X, BX = tolérance X)`. Avec `cur = (cx, cy, cp)` la position de l'objet à l'appel :

- **tolérance** `t >= 0` : fenêtre `[cur - t, cur + t]` intersectée avec la fenêtre courante ; si l'intersection est vide, résultat 0x17 pour ce plan. `t < 0` : pas de contrainte.
- **signe** `-1` : candidats `<= cur` (fenêtre max := cur, vide -> 0x17 si `cur` sous le minimum) ; `+1` : `>= cur` ; `0` : libre, mais si `cur` est hors fenêtre la **cible** de la distance est ramenée au bord le plus proche.
- **type** `p1 > 0` : seules les cases de ce type (la comparaison est faite sur le type de la case) ; `p1 == 0` : toute case praticable de type >= 2 que l'objet accepte (`13a8:000a(type, 0, o) == 0`) ; `p1 < 0` : comme 0 (l'exclusion de type n'est jamais atteinte).
- Les trois cibles de distance sont `(tgtX, tgtY, tgtP)` = `cur` ramené dans la fenêtre pour les signes 0.

Fenêtres de départ : salle -> limites de la salle ; hors salle -> `[0, 4acc] x [0, 4ad2] x [0, 4ad8]`.

### 4.3 Algorithme de recherche (**probable pour l'ensemble, certain pour chaque pas** ; porté et testé, § 4.5)

```text
placer_recherche(o) :
   copie de o en DS:7936 ; garde d'entrée (0e9a != 0 : gm_abort)
   meilleur = ∞ (578 = 0x7fff)
   vol = (Dep != 0) ; pente = dansSalle && !vol ; zoneDep = (Dep ∈ {2, 4})
   table[P] = '*' pour chaque autre objet de la liste A de la salle avec Txt == 0 (P < 0x104)   // accélère le test d'objets
   nPlans = (!dansSalle || zoneDep) ? 1 : 4ae0
   pour plan de 0 à nPlans - 1 :
       o.N = plan ; meilleur_plan = {r3d = r2d = 0x7fff, d2xp = d2 = 0x7fffffff}
       si meilleur < 0x7fff : tolérances X, P, Y := min(tolérance, meilleur) (−1 devient meilleur)
       fenêtres, côté (AX 0..5), tolérances et signes (§ 4.2) ; échec -> 0x17, plan suivant
       si zoneDep : plan suivant (les zones sont balayées après, § 4.4)
       pas_x = (AX ∈ {1, 3}) ? 1 : 4 ; pas_p = (AX ∈ {0, 2}) ? 1 : 8
       départ_x = tgtX & 3 ; départ_p = tgtP & 7
       spirale de cases autour de (tgtX >> 2, tgtP >> 3) (§ 4.4) :
          pour chaque case (col, rangée) de la bande courante, bornée par la fenêtre :
              X0 = col * 4, P0 = rangée * 8 ; ignorer si !(X0 <= Xmax && Xmin < X0 + 4) ou !(P0 <= Pmax && Pmin < P0 + 8)
              t = vol ? 0 : (dansSalle ? type[plan][rangée][col] : 2)
              si pente : (p1 == 0 ? t >= 2 && t != exclu && accepte(t) : t == p1) sinon ignorer
              [Y_min, Y_max] de la case :
                  marche : 4 coins h(a) h(b) h(c) h(d) (§ 2.3 bilinéaire), Y_min/Y_max = min/max des 4 ; hors salle : cur Y
                  vol    : [Ymin, Ymax], puis, si dansSalle et Txt != 2 : Y_max = lo - 1 (le sol de la case) ;
                           case vide : ignorée sauf au plan 0 ; Y_min = hi(plan suivant non vide) + Hau - 1 ; vide si Y_max < Y_min
                  puis intersection avec [Ymin, Ymax] de la fenêtre
              si dansSalle et Txt != 2 : rogner [Y_min, Y_max] par les murs [lo, hi] des cases de l'empreinte du sprite
                  (colonnes de col*4 - Lar/2 - 3 à col*4 + Lar/2 + 2), jusqu'à un point fixe ; vide -> ignorer la case (la rangée de l'empreinte est celle de la case, `4a4e0`, et non `p >> 3` ; capacité de la mémoire des murs `((Lar >> 2) + 1) * plans` ; certain, code porté et testé) ; les murs
                  qui ne recouvrent pas les extrémités sont mémorisés pour le test fin (1b11:16b4, § 4.4)
              Y de départ = tgtY ramené dans [Y_min, Y_max] ; (vol : essais dans l'ordre Y, Y-1, Y+1, Y-2, Y+2... jusqu'aux bornes)
              pour i de 0 à pas_x - 1, j de 0 à pas_p - 1 :                 // échantillons de la case
                   X = X0 + ((départ_x + i) & 3) ; P = P0 + ((départ_p + j) & 7)    // départ au plus proche de la cible, avec repli
                   hors fenêtre X ou P : suivant
                   Y = vol ? Y courant : (hors salle ? cur Y : bilinéaire(X & 3, P & 7))
                   Y hors [Ymin, Ymax] : suivant (vol : abandonner ce Y)
                   d2xp = (X - tgtX)² + (P - tgtP)² ; d2 = d2xp + (Y - tgtY)²
                   accepter si (vol ? d2 <= meilleur_plan.d2 : d2xp <= meilleur_plan.d2xp)          // égalité acceptée : le dernier gagne
                   si table[P] != 0 et 1a50:0006 == 8 : suivant
                   si dansSalle et Txt != 2 : test des murs mémorisés (-1 : abandonner la case, 1 : suivant) ;
                        si (P & 7) == 0 et Txt == 0 : masque de profondeur (§ 3.2) ; positif -> suivant
                   enregistrer(X, Y, P, plan, t) ; (1b11:140e, ci-dessous)
                   si !dansSalle || r3d == 0 || (pente && r2d == 0) || Y_max < Y_min : fin du plan
       fin du plan : si r3d < meilleur : meilleur = r3d, copier ; si dansSalle && r3d == 0 : fin
   après les plans : si dansSalle : balayage des zones (§ 4.4)
   fin : si meilleur < 0x7fff : o.{X, Y, P, N} = résultat ; Xyp = dansSalle ? 2 : 1 ; Sol = type (dansSalle) ;
                                 retour 0 si Sol inchangé, 0x11 sinon
         sinon : retour DS:0ea8 s'il est non nul (0x17 ou 0x15 laissés par la recherche, voir § 8), sinon 0x14 ; o.(+0x52..+0x5E) restauré depuis la copie
```

**Distance et rayons (`1b11:140e`, certain)** : à chaque enregistrement `r3d = isqrt(d2)` où `isqrt` est une dichotomie `lo = 0, hi = |dx| + |dp| + |dy|` qui rend `lo` quand `hi - lo <= 1` (ou `mid` si `mid² == d`) ; `r2d = isqrt(d2xp)` avec `hi = r3d`. Si `d2 == 0` alors `r3d = r2d = 0`. Puis la fenêtre est **rognée** : `Xmin = max(Xmin, tgtX - r)`, `Xmax = min(Xmax, tgtX + r)`, idem P, avec `r = vol ? r3d : r2d`, et `Y` avec `r3d` ; les bornes de la spirale sont recalculées. **Conséquences** : le critère de classement dans un plan est la distance en **X et P seulement** (la hauteur n'y entre pas) pour un marcheur, en 3D pour un voleur ; le critère **entre plans** est le rayon `r3d` (donc le plan le plus bas gagne les égalités au sens de l'entier) ; une distance d'un pixel sur un axe donne `r3d = 0` (la dichotomie rend `lo = 0` quand `hi = 1`), donc « parfait » et l'arrêt immédiat.

**Départage** : les égalités (`<=`) sont acceptées, donc **le dernier candidat à égalité parcouru gagne** ; l'ordre de parcours est celui du § 4.4. Les rayons entiers sont des bornes basses : quand `d2` est un carré parfait ou quand `hi = r3d` est trop petit, `r2d` peut valoir `floor(sqrt(d2xp)) - 1`, et la fenêtre est alors trop étroite d'une unité (des candidats exactement à la distance limite sont écartés).

### 4.4 Spirale de cases, balayage des zones, murs

**Spirale** (`1b11:09d6..0a84`, certain, simulée) : bande de cases `(rLo..rHi, cLo..cHi)` (rangées = P, colonnes = X) initiale = la case de la cible, taille `s = 1`, état `e = 4`.

```text
après chaque bande :  e = (e + 1) & 3 ; selon e :
   0 : cLo += 1 ; cHi += s ; rLo = rHi
   1 : cLo = cHi ; rLo -= s ; rHi -= 1 ; s += 1
   2 : cLo -= s ; cHi -= 1 ; rHi = rLo
   3 : cHi = cLo ; rLo += 1 ; rHi += s ; s += 1
si la bande est une ligne entièrement hors [colMin..colMax] ou [rowMin..rowMax] : comptée vide ; 4 vides consécutives -> fin
```

Les bandes successives (rangée, colonne) relatives à la cible `(0, 0)` sont : `(0,0)`, `(-1,0)`, `(-1,-2..-1)`, `(0..1,-2)`, `(1,-1..1)`, `(-2..0,1)`, `(-2,-3..0)`, `(-1..2,-3)`, `(2,-2..2)`, ... À l'intérieur d'une bande, colonnes croissantes puis rangées croissantes. **Constat** : la case `(0, -1)` (**même rangée, colonne de gauche**) n'est **jamais visitée** (vérifié par simulation de 40 bandes et au désassemblage `1b11:0a26..0a63`). Conséquence : une cible dont seule la case immédiatement à gauche est praticable est placée sur une autre case (une rangée plus haut ou plus bas) ; le cas se produit dans moins de 1 % des cibles aléatoires des scènes à un plan (5 sur 600, `validate.ts`). La fenêtre de terminaison se resserre avec le rognage du § 4.3, ce qui arrête la spirale plus tôt.

**Zones** (après tous les plans, en salle, `1b11:0614..085d`) : pour chaque zone dont le type est accepté (même filtre, sans la règle `t >= 2`), échantillons `(P, Y, X)` des intervalles `[8 * rangée, 8 * rangée + 7]`, `[lo, hi]`, `[4 * c0, 4 * c1 + 3]` rognés par les fenêtres, parcourus **en tournant à partir du plus proche de la cible** (`(départ + i) % n + min`), distance 3D `d2 < meilleur` (strict), puis test d'objets (`1a50 == 8` -> suivant) et `1c96:0102 == 0` ; le meilleur recevra `plan = 0`, `type` = type de zone. Pour `Dep 2/4` c'est le **seul** balayage.

**Murs** (`1b11:16b4`, **probable**) : pour chaque mur mémorisé qui recouvre horizontalement le sprite à l'abscisse candidate et verticalement `[Y - Hau + 1, Y]` : si sa colonne est dans l'empreinte « cœur » (la case à `X0`) il rogne `[Y_min, Y_max]` (retour −1 : la case est abandonnée) sinon il compte comme gêne de bord (retour 1 : l'échantillon est écarté) ; 0 si aucun. L'indicateur d'**OU** de `1b11:16b4` est porté tel quel (son sens, cumul des gênes de bord sur l'ensemble des murs, est une **hypothèse**) ; l'empreinte utilise la rangée de la case (`4a4e0`) et la mémoire des murs a pour capacité `((Lar >> 2) + 1) * plans` (**certain**, code porté et testé).

### 4.5 Validation (`validate.ts`)

- **Identité** : les 59 objets déjà posés de `CFG` (type 2, `Dep 0`, `Sol != 0`), replacés à leur propre `(X, Y, P)` avec `rech(6, libre)`, sont retrouvés à l'identique, au même plan et avec `Err = 0` (59 / 59).
- **Plus proche** : 600 cibles aléatoires dans les scènes à un plan (15 par scène, `Dep 0`, `Hau 40`, `Lar 20`). Comparaison du résultat à une recherche exhaustive (distance X/P minimale sur toutes les positions praticables) : 534 / 600 identiques tel quel ; **539** en excluant la case ignorée par la spirale ; **597** en supprimant en plus le rognage de la fenêtre de Y (qui écarte des candidats plus proches en X/P mais trop éloignés en hauteur de la première position trouvée, § 4.3) ; les 3 restants sont expliqués par la borne `r2d` trop petite d'une unité (cas `d2xp = 436`, `r3d = 20`, `r2d = 19`). Le port reproduit donc exactement ces comportements ; il n'y a pas de référence dynamique pour les confirmer.
- **Non porté dans ce prototype d'étude** : collision objet-objet, masque de profondeur, zones, mur mémorisé (`16b4`), jeu de 13a8 (tous les types >= 2 acceptés). Le moteur (`src/games/armaeth/engine/placement.ts`, `game/hero.ts`) porte depuis le mur mémorisé et la table `13a8:000a`.

### 4.6 Usage par clic

`1504:0002` (clic gauche, `engine.md` § 8.2) : position du clic `(cx, cy)` relative à la fenêtre de la scène (curseur moins `pilote[+0x1e]`, `[+0x20]`) ; si `cx ∈ [Xmin, Xmax]` et `cy ∈ [Ymin, Ymax]` : le héros est **posé provisoirement** en `(cx, cy, P actuel)` et `rech(AX = 6, signe X 0, tolérance X **4**, type 0, tolérance P −1, signe P 0, tolérance Y **1**, signe Y 0)` est lancé. Comme la hauteur du sol dépend de P, la **hauteur cliquée sélectionne la profondeur** : on obtient le point praticable le plus proche en (X, P) dont la hauteur de sol est à ±1 de la hauteur cliquée et X à ±4 du clic, c'est-à-dire P tel que `sol(cx, P) ≈ cy`. Succès (0 ou 0x11) : `Xc, Yc, Pc, Nc` du héros = ce point, `Cib = 7`, `Ser = 0`, `gm_compute_path`, puis le héros est remis à sa position (`Err = 0`). Échec (clic sur un mur, hors sol) : le héros s'est arrêté (`gm_reset_object_motion`) et ne repart pas, sans message.

## 5. Barrages : `1414:0006` (certain pour la logique, **probable** pour le sens des objets cités)

`1414:0006(code, mode, o)` rend **0 = libre, 7 = bloqué** ; 3 appelants : le déplacement (`179d`, `mode = 1`), `186d:000c` (sortie, `mode = 2`) et `228e:0000` (choix d'une sortie par un personnage, `mode = 0`). `mode != 0` : si l'objet testé est le héros et qu'un message est prévu, il est affiché (classe `C`). `mode == 2` : en plus, certains codes **orientent l'objet** (`Hor`, `Prf`) quand il passe. Le résultat est évalué à chaque fois (aucune mémoire) : les codes qui tirent au hasard donnent deux tirages indépendants entre `179d` et `186d:000c` (§ 2.9).

Notations : `Num`, `Txt`, `Sol`, `Dep`, `Mob` de `o` ; `hero(o)` = `o` est l'objet contrôlé (`DGROUP:4bfe`) ; `Ego(n)` = `Ego` (+0x2D, « état ») du **premier** objet de type 2 de `Num = n` dans la liste globale (`1a7b:03b0(AX = n, DX = code d'abandon)` : `gm_abort(DX)` si l'objet n'existe pas) ; `contient(n)` = `o` porte (liste `Pos`) un objet de `Num n` (`21e7:0022`).

**Prédicats d'état** (tous les objets cités existent dans `CFG` ; `Ego == 3` ou `4` est probablement l'état « ouvert », hypothèse) :

| Nom | Fonction | Définition | Objet dans `CFG` |
|---|---|---|---|
| `E` | `2500:0650` | `Ego(16) == 4` | Num 16, salle 5 (la dalle ; `Ego` vaut 6 au départ) |
| `F` | `2846:04d6` | `Ego(103) == 3` | Num 103, salle 110 (grille / porte) |
| `A` | `27ed:0251` | `Ego(104) == 3` | Num 104, salle 108 |
| `B` | `29fd:01d6` | `Ego(207) == 3` | Num 207, salle 202 (série 50, objet lourd, jamais déplacé) |
| `C` | `2c4d:0312` | `Ego(317) == 3` | Num 317, salle 309 (herse, 2 objets : le premier trouvé compte) |
| `D` | `2c1e:02de` | `Ego(316) == 3` | Num 316, salle 309 (grille) |
| `Nuit` | `197e:0272` | niveau de lumière `< −40` (`pilote[+0x0A]`, § 7.5 d'`engine.md`) | |
| `G(o, k)` | `20b5:03bc` | état d'une entité de la table `DGROUP:0694` de clé `k` ; **non lu en entier** (§ 8, question 1) | `k = 309` (salle 305, série 55), `329` (salle 305, série 142) |
| `chance(n)` | `1e08:0000` | `rand() % n == 0` (`n` dans `AX`, non relevé) | |

**Codes** (colonne « Bloque quand ») :

| Code | Bloque quand | Message (classe `C`, héros bloqué) | Emplacements de `CFG` |
|---|---|---|---|
| 0 | jamais | | |
| 1 | `Num == 3` (la pie) | | 2->3 |
| 2 | `Num ∉ {1, 4}` (passent : héros, ours) | | 6->7 |
| 3 | `Num ∉ {1, 3}` (passent : héros, pie) | | 9->10 |
| 4 | `Dep != 1` et `Txt != 2` (passent : volants, objets immatériels) | | 4->9, 8->9, 9->8, 9->4 |
| 5 | `Num != 3`, ou (`Num == 3`, `!Nuit`, `!chance`) | | 1->10, 2->10, 5->10, 11->10 |
| 6 | `Num != 3`, ou (`Num == 3`, `!chance`) | | 10->1, 10->5, 10->2, 10->11 |
| 7 | non lu en entier (porte sur `Inf > 5` et la salle courante) ; aucun usage | | |
| 8 | jamais (défaut) | | 207->208, 208->207 |
| 101 | `Num ∈ {3, 4}`, ou (`Txt != 2` et `!E`) ; `mode == 2` et passage : `Hor = +1`, `Prf = 0` | `C101` | 5->101 |
| 102 | `!hero(o)`, `Txt != 2`, `!F`, sauf (salle courante 110, `o` dans la salle courante et `o.P <` `P` de l'objet Num 103) | | 109->110, 110->109 |
| 103 | `Txt != 2` et `!G(o, 329)` | | 104->105, 105->104 |
| 104 | `Txt != 2` et `!E` ; `mode == 2` et passage : `Hor = −1`, `Prf = 0` | `C101` | 101->5 |
| 105 | jamais (défaut) | | |
| 201 | `Txt != 2` et `!A` ; `mode == 2` et passage : `Hor = +1`, `Prf = 0` | `C201` | 108->202 |
| 202 | `Num != 1` (seul le héros passe) | | 209->210, 210->209, 210->211, 211->210 |
| 203 | `!hero(o)` et `Mob == 2` (tout mobile sauf le héros) | | 102->212 |
| 204 | `Txt != 2` et `!A` ; `mode == 2` et passage : `Hor = 0`, `Prf = +1` | `C201` | 202->108 |
| 205 à 209 | jamais (défaut) | | |
| 301 | `Txt != 2` et `!B` | `C301` | 202->305 |
| 302 | `Num == 301`, ou (`Sol ∈ {64, 91}`, `!G(o, 309)`, `Txt != 2`), ou (`Txt != 2` et `!B`) | `C301` | 305->202 |
| 303 | `Num == 301`, ou (`Sol ∈ {64, 91}`, `!G(o, 309)`, `Txt != 2`) | | 305->308 |
| 304 | `Num ∈ {201, 202, 203, 204, 301}` (les nains) | | 205->302 |
| 305 | `Num == 303` (Minas) et `!contient(320)` | | 302->205 |
| 306 | `Num == 301`, ou (`Txt != 2` et [(`Sol ∈ {64, 91}` et `!G(o, 309)`) ou `!G(o, 329)`]) | | 305->309 |
| 307 | `Txt != 2` et : `Sol ∈ {57, 113}` ; ou `Sol ∈ {56, 114}` et (`!D` ou `!G(o, 329)`) ; ou autre `Sol` et `!G(o, 329)` | | 309->305 |
| 308 | `Txt != 2` et : (`Sol ∈ {58, 112}` et `!D`) ; ou (`Sol ∈ {57, 113}` et `D`) ; ou (sinon) `!C` | `C302` (par le test 309) | 309->314 |
| 309 | `Txt != 2` et `!C` | `C302` | 314->309 |
| autres | jamais | | |

Lecture : les codes 1 à 6 organisent le chapitre 0 (forêt, salles 1 à 11) autour de **la pie (Num 3, volante, `dpX 4`) et de l'ours (Num 4, `dpX 3`)**, le héros étant Num 1 ; 101 et 104 sont les deux sens de la **dalle de granite** de la salle 5 ; 201 et 204 les deux sens de la **lourde dalle** de la salle 108/202 ; 202 et 203 réservent un passage au héros ; 301 à 309 sont les herses et portails de pierre du chapitre 3 (nains Num 201 à 204 et 301, Minas Num 303). Les messages (`messageId('C', n)` = `3000 + n`, `A1FMSG.SYS`) : `C101` « une dalle de granite barre le passage », `C201` « une lourde dalle barre le passage », `C301` « la herse de pierre est redescendue », `C302` « le portail de pierre s'est refermé » ; affichés seulement avec `mode != 0` et quand l'objet testé est le héros. Chaque salle donne un code par **emplacement** (`barrages[6]` à côté de `sorties[6]`, `engine.md` § 5.1), indexé après `inv4b94[côté]`. **39 emplacements** de `CFG` ont un barrage non nul : codes 1 à 6 et 8 : 17 ; 101 à 104 : 6 ; 201 à 204 : 7 ; 301 à 309 : 9.

Particularités : (1) les codes 5, 6 et `G` font intervenir le hasard. (2) `228e:0000(o, salle, drapeau)` (jeton `sor`, IA) choisit **au hasard** une sortie parmi celles qui existent (même identifiant de salle, ou même centaine si l'argument est un multiple de 100, ou `−1` pour toutes) et qui sont libres (`barrage == 0`, ou `1414(code, 0, o) == 0` quand le drapeau est posé), fixe comme cible un point à ±1000 au-delà du bord correspondant et appelle `gm_compute_path` : le personnage marche jusqu'au bord, la sortie est franchie par `179d` (§ 2.8), `186d:000c` change de salle. (3) Le héros n'a aucun traitement spécial hors le message.

## 6. Trajets

### 6.1 Graphe de navigation : `305e:0002` (certain pour la forme, **validé** par les tailles)

Construit pour l'objet courant, à chaque calcul de trajet : `ng <= 250` nœuds de 16 octets `{u8 rangée, u8 plan, u8 c0, u8 c1, u16 coût = 0x7d00 (32000), u16 aux = 0, u8 voisins[8] = 0xFF}`.

```text
pour rangée de 0 à (Pmax >> 3) + 1 :  (abandon si Pmax >> 3 + 1 > 20 ou colonnes > 80)
   début[rangée] = nombre de nœuds
   pour plan de 0 à 4ae0 - 1 :
      colonnes de 0 à (Xmax >> 2) :
         segment praticable maximal [c, c'] :
             type de la case de départ > 1 (et != 0xFF) et accepté par l'objet (13a8:000a(type, ·, o) == 0)
             s'étend à la case suivante tant que : son type est accepté (les types peuvent changer dans un segment)
                et |lo(case) - lo(case suivante)| * dpX <= dpY * 4      // pente par case de 4 px
             un type refusé est mémorisé pour ne pas être retesté
      un nœud par segment
   mobiles volants (Dep != 0) : une case compte si 305e:06fc(plan, rangée, col, Hau + 6) : le vide sous le plafond d'un plan supérieur >= Hau + 6
voisins (8 au plus, dans les rangées rangée - 1 .. rangée + 1, autre nœud) :
   même rangée : les segments se touchent (c0' - c1 == 1 ou l'inverse) et |lo(case a) - lo(case b)| * dpX <= dpY * 4
   rangées différentes : colonnes communes ; d = min sur les colonnes communes de |lo(a) - lo(b)| ;
                         voisins si d * dpP <= dpY * 8
                         + règle des plans intermédiaires (`305e:0572..05c4`) : le lien entre rangées voisines teste aussi
                           les plans situés entre les plans des deux nœuds (certain, code porté et testé)
```

**Validé** : pour le héros (`dpX 2`, `dpY 4`, `dpP 1`, tous les types >= 2 acceptés), les 59 scènes de jeu donnent entre 0 et 64 nœuds (médiane 20, maximum 64 en salle 8) et aucun nœud n'atteint 8 voisins ; la scène 0 (cadre d'interface) n'a pas de grille de jeu. Superposition sur la salle 202 : les segments (en magenta) longent exactement le sol et les marches des ponts.

### 6.2 Calcul : `gm_compute_path` `3187:0000` (**probable**, algorithme relu, détails de départage non validés)

`gm_compute_path(o, AX = reprise (0 ou 7), DX = métrique (0 3D, 1 X seul, 2 P seul))` : `AX = 7` (`30d9:0788` après un blocage, `2363:024b`, `2683:0091`, `2683:00a1`) conserve la destination du trajet en cours (le dernier nœud de `Chm` sert d'obstacle de départ : le lien départ -> saut courant est coupé pour forcer un autre itinéraire) ; `AX = 0` : clic (`1504:023f`), errance (`2151:0078`), `228e`, `22ef`, `30d9:0095`, `30d9:0256`. `DX != 0` n'est passé que par `228e:0266` (sortie par un côté).

1. Libère les tampons (`52ea` nœuds, `52fc` listes de travail). Vérifie salle courante et `dpX, dpY, dpP != 0` (sinon aucun trajet, `Nbc = -1`). Si la cible est un objet (`Cib != 0` et `Ser != 0`) : retrouve l'objet (`21fb:00c6`) et recopie sa position dans `Xc, Yc, Pc, Nc` (`bVar23 = Dep de la cible != 0`, `bVar24 = Sol de la cible == 83`).
2. Construit le graphe (§ 6.1). **Nœud de départ** = nœud de la rangée `P >> 3` couvrant la colonne `X >> 2` (même plan `N` pour un marcheur ; pour un volant : `Y <` sol de la case) ; **nœud d'arrivée** = idem pour `(Xc, Pc)` (plan égal à `Nc` ; n'importe quel plan pour une cible d'errance sans nœud trouvé, `Cib == 0` ; cible volante : `Yc <` sol de la case).
3. **Vague** (parcours en largeur sur les nœuds, coût du lien = **1 si la rangée change, 0 sinon**, coûts initiaux 32000) : depuis le départ (coût 0), chaque nœud de la frontière visite ses voisins ; un lien qui n'améliore pas le coût du voisin est **coupé** (octet remis à `0xFF`). Dès que le nœud d'arrivée est atteint, on passe en phase 2 : on ne laisse plus améliorer que l'arrivée, puis la vague s'éteint ; la phase 2 de la vague `3187` **rejoue la frontière** (certain, code porté et testé). Le coût compte donc le **nombre de changements de rangée** (de profondeur), pas la distance.
4. Si l'arrivée n'a pas de nœud ou n'est pas atteignable (coût 32000) et que la cible n'est pas un objet : **repli** sur le nœud atteint (coût dans `[0, 32000)`) le plus proche de `(Xc, Yc, Pc)` selon la métrique `DX` : `d² = (4 * écart de colonnes)² [DX != 2] + (8 * écart de rangées)² [DX != 1] + (écart de Y au sol)²` (`DX = 1` : seulement X, `DX = 2` : seulement P, sinon somme des trois) ; départage par le plus petit coût ; la colonne cible est ramenée de 1 en dehors du nœud (`c0 - 1` ou `c1 + 1`).
5. **Élagage** par niveaux de coût de l'arrivée vers le départ (suppression des nœuds qui n'ont pas de voisin au niveau suivant), puis **recherche en profondeur avec borne** dans le graphe élagué, depuis le départ : à chaque étape, le voisin retenu minimise la **marche horizontale** (`|colonne - bord du nœud voisin|`, cumulée) ; le trajet complet le plus court en marche cumulée (plus la distance finale à la colonne cible) est conservé.
6. Résultat : `Chm` (+0x68) = tableau de **4 octets `{rangée, plan, c0, c1}` par nœud**, **de l'arrivée (indice 0) au premier saut (indice `Nbc - 1`)** ; `Nbc` = nombre de nœuds sans le départ (−1 = pas de trajet, 0 = déjà au bon nœud) ; `X1, X2` (+0x76, +0x77) = colonnes du nœud d'arrivée ; `Def = (Nbc >= 0)` ; `Mod = Dir = Inv = 0`.

Retour : `Nbc >= 0` (vrai) ou faux.

### 6.3 Suivi : `30d9:0006` et `30d9:0184` (**probable**)

`30d9:0006(o)` est appelé à chaque mise à jour des objets qui suivent un trajet (procédures de personnage) ; retours : `6` = pas de trajet (`Def == 0`), `3` = cible mobile absente, `4` = recalcul impossible, `1` / `2` = arrivée (selon `Cib`), `5` = « même décision qu'avant malgré un blocage » ou rien à faire sans destination, `0` = en marche (codes **certains**, code porté et testé ; remplace l'ancienne lecture « 5 = arrivé », « 2 = collision avec la cible »). Hors salle chargée : `30d9:08c8` déplace directement l'objet à `dpX, dpP, dpY` par tic vers la cible (arrivé quand `|ΔP| < 2`, `|ΔX| < 6`, `|ΔY| < 4`, retour 1 ou 2).

`30d9:0184` règle `Hor`, `Prf`, `Ver` (valeurs -1, 0, +1 que `179d:0004` convertit en mouvement) ; le **sous-état `Mod`** (+0x63) :

- `Mod 0` (alignement) : fenêtre de colonnes cible = `[c0, c1]` du nœud courant `Chm[Nbc - 1]` si l'objet est déjà sur sa rangée, sinon `[c0 + Lar/4 + 1, c1 - Lar/4 - 1]` (fenêtre vide : milieu `(c0 + c1) / 2`, pour entrer entier dans le nœud). `Hor = +1` si l'objet est à gauche de la fenêtre, `-1` à droite, 0 dedans. Dedans : si le nœud est sur la rangée de l'objet -> **nœud atteint** (`Nbc -= 1`, nœud suivant) ; sinon `Mod = 1`.
- `Mod 1` (changement de rangée) : `Prf = sgn(rangée du nœud - rangée de l'objet)` ; une fois la rangée atteinte : `Mod = 0`, `Nbc -= 1`. Bloqué (`Err` ∉ {0, 0x11, 9, 0x0A}) : mémorise la direction de contournement (`+0x65`, `+0x64`), `Mod = 2`.
- `Mod 2` (contournement) : marche latérale (direction `+0x64`, +1 au départ, inversée au bord du nœud) jusqu'à ce que `Prf` puisse avancer, puis `Mod = 1`. Le contournement est **borné par les colonnes du nœud** et n'a qu'**un seul retournement** (certain).
- Si le blocage est `Err 4` (masque de profondeur) ou `Err 8` avec `(P & 7) != 7` : `P += 1` (esquive ; **uniquement en `Mod 0`, hors du nœud**, certain) ; tout autre blocage sur un objet qui n'est pas une cible mobile -> **recalcul** `gm_compute_path(o, 7)` ; échec -> retour 4.
- `Ver` (volants seulement) : vers la hauteur cible (`dY / dpY` contre `dX / dpX + dP`) ; un volant en dessous de 30 est ramené vers le haut.
- **Destination** = nœud d'une seule colonne : l'arrivée est jugée **à la case** (certain).
- Si la cible est un objet mobile : à chaque tic, si l'objet cible est resté dans le nœud d'arrivée (même rangée, même plan, colonne dans `[X1, X2]`) la cible est simplement mise à jour ; sinon **le trajet est recalculé**.

**Interruptions** : nouveau clic (`gm_reset_object_motion(héros)`) ; changement de salle (`Err 0x12`, `majObjet` remet le mouvement à zéro) ; blocage (recalcul ci-dessus) ; `Err` qui ne se résorbe pas ; cible mobile qui change de nœud ; lumière trop faible (`197e:0272`, le héros ne marche plus et affiche un message).

### 6.4 Cible d'errance : `2151:0006`

Tire une cible `(Xc, Yc, Pc)` : `rand() % (max - min + 40) + min - 20` pour X (`[Xmin, Xmax]` de la salle, `[0, 4acc]` hors salle) et pour P ; Y seulement pour `Dep 1` (tiré dans `[Ymin - 20, Ymax + 20)`), sinon 0 ; pour `Dep 1`, si la salle n'a pas de sortie par le haut (`sorties[4] == 0`) et `Y < Hau` alors `Y = 30` ; si elle en a une et `0 < Y < Hau` alors `Y = Hau + 10`. Si l'argument `AX` est non nul (coordonnée imposée), `2151:01b4` est appelé à la place (non lu). Puis `Cib = Ser = Nc = 0` et `gm_compute_path` (en salle) ou `2151:028a` (hors salle). À l'arrivée dans une salle (`1aba:0310`), la cible est tirée à 12..24 px devant l'objet (10..20 sur Y pour les côtés 4 et 5), sauf pour le héros et `Ctl != 0`.

## 7. `13a8:000a` : type de case accepté par l'objet (partiel)

`13a8:000a(AX = type, DX = effet, o)` rend **0 = accepté, 7 = refusé** ; `DX != 0` applique en plus des effets de bord pour certains types (messages, dégâts : `1a7b`, `2846:0398`, `2255:00e8`...). Appelé par le déplacement avec `DX = 7` (changement de type), par la recherche de placement et par le graphe avec `DX = 0`. Dispatch par **décade** (`AX / 10`, table `13a8:03a2`, 12 entrées) puis par `AX % 10` : décades 1, 2, 7 et 10 : toujours accepté ; décade 0 : types 0 et 1 refusés, 2 accepté, 7 à 9 acceptés ; **3 à 6 réservés** : acceptés pour le héros (`Num 1`) quand son `Ego < 2`, ou quand `Ego == 6` et `Anm ∈ {2, 19}`, et pour `Num 23`, refusés pour tous les autres ; 35 : héros accepté sauf `Ego == 8`, sinon seul `Num 18` ; 37 : héros accepté avec `Ego 0` (ou `Ego 6` avec `Anm ∈ {4, 5}`), ours (`Num 4`) accepté, tous les autres refusés ; 38 : refusé pour les nains (`Num` 201 à 204, 301) ; 39 : héros seul. Les autres types (47, 52, 60 à 64, 68, 80 à 83, 90 à 92, 110 à 114) dépendent de `Num`, de `Ego` ou d'objets du scénario (`21e7:0022`, `20b5:0634`, `23a2:01c0`). **Reste à faire** : table complète (`engine.md` § 13, question 5).

## 8. Questions ouvertes

1. **`20b5:03bc` (prédicat `G`)** : sa définition (table `DGROUP:0694`, clés 309 et 329, `217d:0088`, `20b5:04f8`) n'est lue que dans les grandes lignes ; **dépend** de l'IA des créatures (`characters.md`). Les codes 103, 302, 303, 306 et 307 en dépendent ; les clés 309 et 329 sont deux objets de la salle 305 (séries 55 et 142) et `contient(320)` (code 305) un objet porté.
2. **`gm_chance_one_in` : valeurs `n`** des codes 5 et 6 et des messages : l'argument est dans `AX` à l'appel, non relevé.
3. **`13a8:000a`** : table complète (§ 7), en particulier le rôle de `Ego` (`Ego == 6`, `8`) et de `Anm` du héros.
4. **États des portes** : valeurs de `Ego` des objets de `Num` 16, 103, 104, 207, 316 et 317 (dalles, herses, grilles) et scripts qui les changent ; l'hypothèse « `Ego == 3` ou `4` = ouvert » n'est pas établie (`objects.md`, `characters.md`).
5. **`Dep` 2 et 4** : aucun objet de `CFG` ne les utilise (activés par le jeton `dep` des scripts) ; les 71 zones sont inexplorées en dynamique. **`Dep 3`** : idem.
6. **`Err` non nul laissé par le placement** : la variable `DS:0ea8` n'est écrite qu'aux fins `0x11`, `0`, `0x14`, `0x15`, `0x17` : en cas d'échec après un succès précédent elle garde `0x11` (observé dans le décompilat seul : à vérifier au désassemblage et en dynamique) ; `0x17` du plan 0 persiste de la même manière.
7. **Spirale** : la case `(0, -1)` n'est jamais visitée (§ 4.4) : bogue d'origine ou conséquence d'un décompilat trompeur ? Le désassemblage confirme la machine d'états ; à valider sur des cas limites en DOSBox.
8. **Chute** (`Dep 3`) : le signe de `Hor`/`Prf` en fin de chute (`ancien - nouveau`) est l'**opposé** du déplacement : à confirmer (bogue ou convention d'animation).
9. **Cible mobile** : le sens exact de `Cib` (+0x78, 7 pour un point, autre pour un objet ?) et de `bVar24` (cible `Sol == 83`) dans `gm_compute_path`.
10. **Départage du chemin** : l'ordre des voisins (indice 0..7 dans l'ordre de découverte) peut influer sur le trajet choisi à marche cumulée égale ; non validé.
11. **Rythme** : durée d'un tic et donc vitesse réelle de marche (2 px par tic pour le héros) : voir `engine.md` § 3 (à valider en DOSBox).
12. **Masque de profondeur** : l'appel du pilote (`pilote[+0x2e]`) n'est pas lu en entier ; son défaut de miroir est reproduit (§ 3.2).
13. **Repli aléatoire du placement du héros** : compté par `heroPlacementFallbacks` dans le port ; **ne se déclenche jamais** sur les 56 salles jouables (test).
14. **Salle 8, tas de bois** : le couloir ne laisse passer que `X` 197..199 à `P` 56 ; un `X` pair finit donc en `G44`, comme dans l'original (`characters.md` § 4.4 ; test).

## 9. Corrections à reporter

- *(reporté)* **`engine.md` § 7.2** (pseudo-code) : `o.Typ == 2 : Err = 0x0C` est faux : c'est **`Txt == 2`** (`+0x08`, octet `179d:08e5`) ; idem la phrase du § 5.4 (« objet de type 2 ») ; `Dep 1/3` : `X', P', Y' appliqués directement` est faux pour `Dep 3` (§ 2.6 ici) ; pour `Dep 2/4` : `N' = 0`, `Err = 0x15` hors salle ; code manquant `Err 7` (atterri) ; l'ordre « bords » du pseudo-code est imprécis : la sortie est jugée **sur la nouvelle position** et `Err 0x0A` correspond à un **sprite qui touche le bord** (§ 2.8). Le test d'entrée de `Dep 0` utilise les limites de la salle, la boîte maximale n'intervient que pour le test de sortie ; `Err 5` = pas de sol praticable ou sol **plus bas** de plus de `dpY`, `Err 6` = sol **plus haut** de plus de `dpY`.
- *(reporté)* **`engine.md` § 7.3** : « `placer(o, mode)` » : le mode 3 est `tolérance X 10, tolérance P 4` (pas seulement P) ; les modes 4 et 5 passent `p1 = Sol` ; le mode 10 passe **`AX = o.Inf`** (le côté) ; les « modes AX 0 à 5 » sont des **côtés** qui figent une borne (tableau § 4.1) ; `gm_object_behavior_main` : métrique **X et P seulement** pour un marcheur, 3D pour un voleur, rayon 3D entre plans (§ 4.3) ; `cRam4a4db` = « marche en salle » (`Dep 0` et en salle), `cRam4a4da` = `Txt == 2` ; les sept paramètres sont `(AX = côté, DX = signe X, BX = tolérance X, p1 = type, p2 = tolérance P, p3 = signe P, p4 = tolérance Y, p5 = signe Y)` ; balayage = **spirale de bandes** avec la case `(0, -1)` omise.
- *(reporté)* **`engine.md` § 7.4** : le test de profondeur se limite à `(P & 7) == 0`, `Txt == 0` et à la boîte horizontale de la rangée (déjà là) ; **`1a50:0006`** : `Err 8` bloque et `Err 9` non (`engine.md` § 13, question 5 en partie résolue).
- *(reporté)* **`engine.md` § 7.6** : le coût d'un lien est le **nombre de changements de rangée** (pas « 1 par changement de type ») ; voisinage : seuils `|Δlo| * dpX <= dpY * 4` (même rangée) et `<= dpY * 8 / dpP` (rangées voisines, sur les colonnes communes) ; le trajet retenu minimise la **marche horizontale** cumulée ; `Chm` va de l'arrivée au premier saut ; le clic héros fixe `tolérance X 4` et `tolérance Y 1` (§ 4.6) : « tolérance libre sur P » (§ 8.2) est exacte mais incomplète.
- *(reporté)* **`engine.md` § 5.4** (codes de barrage) : la table complète est ici (§ 5) ; le résultat de `1414:0006` est **7 = bloqué**, 0 = libre ; les codes 8 et 105 sont libres.
- *(reporté)* **`engine.md` § 13** : questions 1 (placement), 2 (`Dep`) et 3 (barrages) **résolues pour l'essentiel** (restes : § 8 ci-dessus, points 1 à 5) ; question 6 (zones) : format des enregistrements de zone `{type, 0xFF, rangée, c0, hi, lo, c1}` (`Y haut` avant `Y bas`) ; octets 2 à 3 des décors de scène toujours ouverts.
- *(reporté)* **`graphics.md`** (reporté ; correction ultérieure sur le mot 8, vérifiée sur les données) : les mots 9 à 14 de l'en-tête de scène (`header.words`, octets +0x12 à +0x1C) sont les **limites de la salle** `Xmin, Xmax, Ymin, Ymax, Pmin, Pmax` ; le mot 8 (+0x10) n'est **pas** `Pmax + 1` (faux pour les 60 scènes : par exemple `words[8] = 160` avec `Pmax = 151`) : son rôle reste à établir ; le mot 17 (+0x22) est le nombre de zones (déjà dit) ; les zones ont le format du § 1.1.
- *(code : hors documentation, à faire côté `src/`)* **`src/games/armaeth/data/scene.ts`** (code, hors périmètre de cette étude) : exposer `limits` (mots 9 à 14) et un lecteur de zones typé aiderait la suite ; les champs sont aujourd'hui dans `header.words` et `zones` (octets bruts).
