# AM1.EXE : verbes et objets (gestionnaires par type d'objet)

Référence pour réimplémenter **ce que chaque verbe fait à chaque objet** dans *Armaeth* (`AM1.EXE`, Grandslam 1994, DOS) : répartition des gestionnaires, algorithme des 11 fonctions de verbe, catalogue des gestionnaires de type d'objet (familles 1 et 5 des tables `1ec8:000a`), mots magiques (famille 6), événements différés (famille 8), réactions (famille 9). Les adresses sont des `segment:offset` Ghidra (base `1000`, voir `re-index.md`), `DGROUP:xxxx` un offset du segment de données.

Confiance : **certain** = lu instruction par instruction dans `archives/armaeth/re/disasm.txt` (ou, pour les fonctions non exportées, désassemblé à la main depuis `AM1.EXE`) et recoupé avec les messages `A1FMSG.SYS` ; **probable** = comportement lu mais rôle d'un appel auxiliaire déduit du contexte ; **hypothèse** = lecture plausible non vérifiée. Les textes cités sont des **extraits de 10 mots au plus** (les messages `V…` complets se lisent avec `MessageTable`).

Documents voisins : `parser.md` (analyse de la phrase, boucle d'exécution §6, file de messages §7, comportements de verbe §8), `engine.md` (enregistrement d'objet 144 octets §6.1, score et événements différés §9.3), `formats.md` (messages `TMS`/`MSG`, monde), `characters.md` (IA des personnages, familles 2), `movement.md` (déplacements, trajets), `interface.md` (icônes, curseur).

## 0. Ce qu'il faut retenir

1. **La clé des familles 1 (objet direct) et 5 (objet indirect) est le nombre du nom** (`code % 1000` d'un nom de classe 15, égal au `Num` du type d'objet) et **non** l'objet lui-même : un gestionnaire sert tous les objets de ce `Num`. Il n'est appelé **que si au moins un objet de ce type a été résolu** (visible, dans la salle ou l'inventaire) ; sa clé `Num / 100` doit en plus passer la porte de chapitre `4b1e`. Les noms de classes 4, 6, 9 (décor, méta-noms) n'ont **jamais** de gestionnaire d'objet, seulement le gestionnaire de verbe (§1.2).
2. **Ordre d'appel pour chaque couple (objet indirect, objet direct)** : gestionnaire de l'indirect (famille 5), puis du direct (famille 1), puis le gestionnaire de verbe (`AX = 0`). Le premier qui renvoie ≠ 0 est un « succès » ; la politique de verbe (`4cc6`) décide ensuite de s'arrêter (0), de passer à l'objet indirect suivant (2) ou de continuer (3, 7).
3. **Un gestionnaire d'objet qui ne réussit pas peut interdire le verbe générique** : il appelle `22fc:065b` (met le pointeur de verbe à 0) puis met en file un message et renvoie 0 ; le verbe n'est alors pas exécuté pour cette itération. C'est le motif le plus fréquent (« le coffre est fermé », « trop loin », « vous ne pouvez utiliser que ce que vous détenez »).
4. **Un gestionnaire qui réussit affiche son message tout de suite** (`200c:0004`, jamais via la file) et renvoie 1 ou 7. Les messages de **refus** passent par la file à priorité (`1e58:000a`, p0 à p4) et ne sont affichés que si **aucun** gestionnaire n'a réussi pendant la commande (`parser.md` §7.2).
5. **L'état d'un objet statique est son octet `Ego` (+0x2D)** : c'est aussi l'indice de la description (`classe 30 + Ego`, numéro `Num`), donc les descriptions `30016`… `36016` décrivent exactement les états de la stèle. Portes, coffres, grilles, herses, torche, feu, nains, Prytwen, fioles… sont des automates à `Ego` + `Fig` (+0x2E, image). Le changement d'état passe par `1a37:0002/003a/007f` (§2) qui ré-applique `placer`.
6. **Le héros n'est pas figé sur `Num 1`** : `4bfe` désigne le personnage contrôlé (Killian, crapaud, Prytwen, nain…, familles 2 et 9). Beaucoup de gestionnaires testent `HERO.Num == 1` avant un effet réservé à Killian.
7. **« Trop loin » n'est pas une fin** : `2363:000c` mémorise la commande (verbe, préposition, `Ser`/`Typ` des objets) et le héros **marche tout seul vers l'objet** (`2363:0154`), puis la commande est **rejouée** (`2363:01ea`) à l'arrivée (§1.5).
8. **Les clés, serrures et portes sont des tables en dur** de `DGROUP:0676..0700` (§2.4) : quelle clé ouvre quel coffre, quelles portes ont une serrure, deux salles de part et d'autre.
9. Le **score** (`2255:00e8(chapitre, indice)`) est attribué par ces gestionnaires ; la table complète des ids, des points et des sources est au §9.
10. **Couverture** : 122 adresses de gestionnaires distinctes hors commandes système (famille 4, déjà au `parser.md` §9.1). Lues et décrites en détail : les 11 fonctions de verbe, les 37 de la famille 1 et 14 de la famille 5 (dont les 2 stubs), les 6 mots magiques, les 8 réactions (76). Lues, décrites plus sommairement : les 13 événements différés (famille 8) et les 8 décors (famille 3). Seulement pointées : les 22 procédures `Fct` de la famille 2 (IA, `characters.md`) et les 3 de la famille 7 (`interface.md`).

## 1. Répartition des gestionnaires

### 1.1 Variables lues par les gestionnaires (certain)

Tous les gestionnaires lisent les mêmes globales (`parser.md` §5.1, §6.1) ; il n'y a pas d'argument sauf `AX` (verbes).

| Notation ici | Adresse | Contenu |
|---|---|---|
| `VERB` | `4cba` | numéro du verbe (`code % 1000` ; classe 22) |
| `PREP` | `4cbc` | préposition : 1 `dans`, 2 `hors`, 3 `sur`, 4 `sous`, 5 `devant`, 6 `derrière`, 7 `avec`, 8 `à` ; 0 = aucune |
| `Dc`, `Ic` | `4dc2`, `4dc8` | code du nom direct / indirect de l'itération (0 si absent) |
| `D`, `I` | `4dba:4dbc`, `4dbe:4dc0` | pointeurs d'objet direct / indirect résolus (0 si aucun) |
| `D.A`, `D.B` | `4dc4`, `4dc6` | direct **tenu** (dans l'inventaire du héros) ; direct **à portée** (`2120:0075`, 7 si oui) |
| `I.A`, `I.B` | `4dca`, `4dcc` | idem pour l'indirect |
| `TALK` | `4cc4` | drapeau « bavard » : 7 sauf phrase vide ; certains succès n'affichent leur `V015` que s'il est ≠ 0 |
| `HERO` | `4bfe:4c00` | personnage contrôlé ; `ROOM` `4b84:4b86` : salle chargée |

Un objet est « tenu » si son conteneur est le héros (`D.A = 1`), « à portée » si `2120:0075` est vrai (même salle, écart de profondeur ≤ 8, recouvrement horizontal à 5 px) ; un objet contenu dans l'inventaire a toujours `B = 7`.

### 1.2 Familles et clés (certain)

`1ec8:000a(AX = clé, DX = famille)` renvoie un pointeur far (dichotomie dans `{clé, offset, segment}` de 6 octets) ; porte `4b1e[clé / 100]` pour les familles 1, 2, 5, 9 (défauts `10c8:0130`, `10c8:0006`, `10c8:0134`, `2363:03ec`). Les tables complètes sont aux §4 à §8.

| Famille | Clé | Rôle ici | Section |
|---:|---|---|---|
| 0 | numéro du verbe | gestionnaire de verbe (11 fonctions pour 36 clés) | §3 |
| 1 | `Num` du **direct** | « ce qu'on fait à cet objet » | §4 |
| 5 | `Num` de l'**indirect** | « ce qu'on fait à partir de / vers cet objet » (contenants, destinataires) | §4 |
| 6 | numéro du nom propre (classe 13) | mots magiques | §5 |
| 8 | identifiant d'événement différé (clé = `Num` ou 1001+) | fin d'une séquence programmée | §8 |
| 9 | `Num` du **héros** | autorise la réaction « marcher vers l'objet » | §1.5 |
| 2, 3, 7 | `Num` | procédures `Fct` (IA, décors, curseur) : hors du sujet | §6.2 |

Les familles 1 et 5 ne sont consultées que si `206a:0002` a résolu au moins un objet (`22fc:0432` : `iRam47f8e ≠ 0`) et si le nom n'est pas de classe 13. Corollaire : **les branches « D absent » de certains gestionnaires (torche, mettre…) ne sont jamais atteintes par la phrase tapée** (probable : elles servent peut-être à l'exécution des clics `2210:0008`, qui met aussi `D` à 0).

### 1.3 Boucle et valeurs de retour (certain, `22fc:04f2..05e0`, `2210:0008`)

```text
pour chaque nom indirect (ou une itération vide)                       // ordre des candidats : parser.md §6.3
  pour chaque objet indirect I_j trouvé par 206a:0002
    pour chaque nom direct
      pour chaque objet direct D_k
        r = famille5[Ic % 1000]()       si ≠ 0 -> succès
        sinon r = famille1[Dc % 1000]()  si ≠ 0 -> succès
        sinon r = verbe(AX = 0)          si ≠ 0 -> succès
        succès : nOK++ ; selon POLICY : 0 -> sortir de TOUT (22fc:05e3) ;
                                         2 -> passer à l'objet INDIRECT suivant (22fc:05c1) ;
                                         autre (3, 7) -> D_k suivant
si nOK == 0 et une réaction est armée : 2363:0154 (nOK++)
si nOK == 0 : afficher la file ; file vide -> S015
```

* Politique `POLICY` (`4cc6`) = valeur renvoyée par le gestionnaire de verbe appelé avec `AX = 7` : **0** pour `prendre`, `mettre/jeter`, `inventaire` et le défaut `333c:0008` ; **3** pour `regarder`, `fouiller` (qui exécute le corps de `regarder`) et `zwygks` ; aucun verbe ne renvoie 2. Un succès sur un verbe de politique 0 arrête donc toute la commande ; sur `regarder`/`fouiller` toutes les combinaisons sont parcourues.
* Un gestionnaire d'objet ne reçoit pas d'argument ; `AX` à l'appel est du bruit (basse moitié d'un pointeur). Retour ≠ 0 = succès (1 ou 7), 0 = non traité.
* Les gestionnaires qui échouent après avoir mis un message en file **renvoient 0** ; la file n'est affichée que si personne n'a réussi, donc **un échec suivi d'un succès (autre objet, autre combinaison) perd silencieusement son message**.
* `2210:0008` répète exactement cette séquence (verbe interrogé avec `AX = 7`, puis `[0474]`, `[0258]`, `[0684]` avec `AX = 0`) pour les actions construites au clic ; `2210:011e` / `2210:021e` résolvent les gestionnaires direct / indirect de `D` / `I` (famille 1 / 5).

### 1.4 Désactivation du verbe générique : `22fc:065b` (certain)

Met à zéro la paire `DGROUP:0684/0686`, copie de travail du pointeur du gestionnaire de verbe. Appelé **avant** `1e58:000a` par presque tous les refus des gestionnaires d'objet : le verbe n'est pas exécuté pour cet objet. L'appel est local à l'itération en cours (`22fc:0402` recharge la copie à chaque objet direct).

### 1.5 Réaction « trop loin » : `2363:000c`, `2363:0154`, `2363:01ea` (certain pour la structure, probable pour les codes)

* `2363:000c(cible)` : cherche le gestionnaire de **famille 9** de clé `HERO.Num` et l'appelle avec le héros. Le gestionnaire (§7) répond vrai si le héros est disponible (état `Ego` 0, 1 ou 8) ; sinon il affiche tout de suite `V093` « Pas maintenant ! » et répond faux (pas de réaction). Si vrai : arme `REACT` (`4cc8 = 7`), `5222 = 7`, et copie dans `5224..5234` le verbe, la préposition, `TALK`, `Ser`/`Typ` du direct, de l'indirect et de la **cible**.
* `2363:0154` (fin de commande **sans** succès, `22fc:05e3`) : retrouve la cible par `Ser`/`Typ` (`1a7b:02b7`), fait marcher le héros vers elle (`22ef:0000`, §2.3), essaie deux fois (indicateurs 1 puis 0), efface `REACT` et `HERO+0x43`. Si rien n'est armé (ou pas de héros, ou cible introuvable) elle appelle `2363:03e4`, qui efface seulement `5222`.
* `2363:01ea(héros, code)` est appelée par les procédures `Fct` des acteurs (héros `246c:0933`, ours `26da:00f1`, pie, Prytwen, nains, Sarhûl, crapaud, Minas…) avec un code de fin de marche : 1, 2 et 4 **rejouent la commande mémorisée** (recharge `VERB`, `PREP`, `D`, `I` d'après les `Ser`/`Typ`, `TALK = 7`, `2210:011e/021e/0008`) ; 3 abandonne ; 5 relance le calcul de trajet (`3187:0000`, sinon message `G44`) ; 0 ne fait rien. Dans tous les cas la marche est arrêtée (`30d9:0114`, `2273:0190`, `HERO.Err = 0x11`). La signification exacte des codes 1..5 est une hypothèse (résultat du suivi de trajet).

Conséquence pour la réimplémentation : « prendre la clef » depuis l'autre bout de la salle **n'échoue pas** : le message `V008` « Vous êtes trop loin » est mis en file, le héros marche vers la clef, puis `prendre la clef` est rejoué.

## 2. Motifs et fonctions auxiliaires

Les sections suivantes les citent par leur sigle. Tous les messages `V…` sont de classe `V` (22) sauf mention.

### 2.1 Messages

* **`enq(p, n)`** = `1e58:000a(AX = p, DL = 'V', BX = n)` : file à priorité (`parser.md` §7.2). Priorités utilisées par les gestionnaires : p0 (repli), p1 (« rien de tel »), p2, p3 (états : fermé, trop loin, non tenu), p4 (refus fermes).
* **`say(n)`** = `200c:0004(AX = 'V', DX = n)` : affichage immédiat (ne passe pas par la file, n'est pas perdu).
* **`sayNear(obj, n)`** = `209c:000c(AX = classe, DX = numéro, obj)` / `209c:0092` : n'affiche que si `obj` est dans la salle du héros (ou contient le héros) ; `0092` exige en plus que le héros soit `Num 1` ou qu'un script tourne.
* Dans le code, chaque refus charge `SI` (numéro du message) et `DI` (priorité) puis saute au tronc commun du gestionnaire (`…:03fd` pour `prendre`) qui exécute `AX = DI`, `BX = SI`, `DL = 'V'`, `1e58:000a` ; c'est pourquoi les numéros apparaissent en hexadécimal dans le désassemblage (`0x1d` = `V029`).

### 2.2 Recherche et déplacement d'objets

| Appel | Rôle |
|---|---|
| `21e7:0006(AX = Num)` | premier objet de `Num` dans le **contenu du héros** (tous états) ; `21e7:0022(obj, Num, −1, −1)` : dans le contenu de `obj` ; `21e7:003c` : recherche dans une liste chaînée par `+0x80`, filtre `Num` et intervalle d'`Ego` |
| `21fb:0002(AX = Num)` | premier objet de `Num` parmi les **frères du héros** (même conteneur, donc la salle) ; `21fb:005a(obj, Num, …)` : idem pour un objet quelconque |
| `22b7:0000(obj, AX = Num)` | prochain frère de `Num` **à portée** de `obj` (`2120:0075`) |
| `1a7b:03b0(AX = Num, DX = code d'erreur)` | premier objet de `Num` de la liste globale de type 2 (`4c0a`, ordre inverse de création) ; absent et `DX ≠ 0` : `gm_abort(DX)` |
| `1a7b:02b7(liste, Ser, Num)` | recherche générale dans les listes globales (réactions) |
| `20ac:0060(cont, obj)` | **capacité** : `Pds(contenu de cont) + Pds(obj) + [Num(obj) ≠ 9] Pds(contenu de obj) ≤ Chg(cont)` (certain) |
| `19dc:0000(dest, obj, AL = Cod, DX)` | **déplace** `obj` dans `dest` (`Cod 1` salle, `2` objet) : détache de l'ancien conteneur, rattache (`1a7b:0118`), met à jour `Cod` (+0x5B) et le conteneur (+0x5C), place (`1aba:000e`) ; renvoie 0 ou `0x11` si bien placé, autre valeur = refus (échec de placement). `DX = −1` autorise le repli, `DX = 7` force (probable). `19dc:04f1` en est la variante de rattachement pour un objet pris dans les listes globales (`zwygks`) |
| `19a6:000a` (`gm_create_object`) | crée un objet de `Num` `DX` (modèle `A1FDEF.SYS`) dans un conteneur ; 24 paramètres de pile (vitesses, `Ego`, `Fig`, poids…) |
| `1a6b:0006(ancien, …, DX = Num)` | **remplace** `ancien` par un objet neuf de `Num` : même conteneur, copie les 7 mots de position `+0x52..+0x5F`, détruit l'ancien, applique l'état |
| `19a6:01a5(cont, obj, AL)` | **détruit** `obj` (le détache, libère sprite et mémoire, met `4bfe = 0` si c'était le héros) |

### 2.3 États, animations, marche

* **`setState`** : `1a37:003a(obj, Fig ; AL = Gst, DL = Mob, BL = Ego)`, `1a37:0002(obj ; AL = Ego, DL = Fig)` (garde Gst, Mob, Dep, Txt) et `1a37:007f(obj, Fig, Txt, Dep, mode ; AL = Gst, DL = Mob, BL = Ego)` écrivent `Gst` (+5), `Mob` (+6), `Dep` (+7), `Txt` (+8), `Ego` (+0x2D), `Fig` (+0x2E) puis rappellent `placer` (`1aba:000e`). Écrire seulement `ES:[+0x2D]` change l'état sans changer le dessin (armoire `2815`). Toute description (`classe 30 + Ego`) suit.
* **`playAnim`** = `16f5:0132(AX = n° d'animation ANM, obj, partenaire, Ego, Hor, Ver, Prf, mode, classe, numéro)` (22 octets de pile) : arrête l'objet (`30d9:0114`), lie les deux objets (`+0x3A`), met `Anm` (+0x30), recopie les pas de `A1FANI.SYS`, règle les vitesses `+0x60/61/62`, change l'état (`1a37:003a`), lance le premier pas, puis affiche le message `(classe, numéro)` si ≠ 0 (`mode 1` : `209c:000c`, `2` : `209c:0092`, sinon `200c:0004`) ; joue le son de l'animation si l'objet est dans la salle chargée (`gm_sound_play(7,0,7)`).
* **`die`** = `2594:0004(héros, AX = cause, DX/BX = classe/numéro du message, partenaire)` : séquence de mort / défaite du personnage (message `G…` ou `V…`, animation de mort, destruction du héros ou transformation). Causes vues : 1 (défaite face à Prytwen, nain, Minas), 18 (« disparaître dans le néant », `erin`), 32 (geyser), 33 (lave), 35 (poison, étranglement, crapaud venimeux).
* **`walkTo`** = `22ef:0000(npc, cible, AX = drapeau)` : recopie la position de `cible` (`+0x54/56/58`, plan `+0x53`) dans les champs cible de `npc` (`+0x70..+0x74`, `+0x6F`), mémorise `Num`/`Ser` de la cible si `drapeau ≠ 0` (poursuite), calcule le trajet (`3187:0000`) si les deux objets sont dans la salle chargée ; met `+0x6E`. C'est ainsi que Prytwen, Minas, les nains et le héros « viennent vers vous ».
* **`near`** = `2241:003a(a, b, AX = tolérance X, DX = tolérance Y, BX = tolérance P, 0)` : vrai si `|Xa − Xb| ≤ tolX`, `|Ya − Yb| ≤ tolY` (−1 = pas de test) et `|Pa − Pb| ≤ tolP`.
* **`stop`** = `2273:0190(obj)` : `Hor = Ver = Prf = 0` ; `2273:000c(a, b)` : tourne `a` et `b` l'un vers l'autre et les immobilise.
* **`event`** = `23a2:0002(obj, AX = opération, DX = événement, BX = compteur, procédure)` : crée / modifie une entrée de la file d'événements différés (`engine.md` §9.3) ; à l'échéance `1ec8:000a(procédure, 8)(obj)` est appelée (§8).
* **`score`** = `2255:00e8(AX = chapitre, DX = indice)` : voir `engine.md` §9.3 et §9 ci-dessous.
* **Son** : `2f9b:000e(AX = classe, DX = numéro, BX, 0)` lance une piste (classe `'B'` = 66), `2f9b:0375` l'arrête, `2f33:000e` joue un jingle (`audio.md`).
* **Liste** : `21ad:000a(AX = message « vide » V, DX = message d'en-tête V, BX = séparateur 0/7, liste, caractère final)` écrit l'en-tête puis le nom (`O<Num>`) de chaque objet de la liste non caché (`Inv = 0`) et qui n'est pas le héros ; liste vide : message `AX`. Appels : inventaire (`V036/V037`), `regarder objet` (`V031/V032`), fouille d'un nain (`V042/V205`).
* **Divers** : `13e9:021c(héros, obj)` lâche l'objet tenu au pied du héros (probable) ; `1469:0002(obj)` pose l'objet sur un support de la salle et renvoie vrai s'il y arrive (probable) ; `219b:006c(obj, AX)` règle la visibilité / le dessin du héros (invisibilité, probable) ; `1664:0004(obj)` affiche ou ferme le panneau de contenu d'un objet (`1664:0004(0,0)` désélectionne) ; `18a9:067c` / `1793:0006(AX)` redessinent l'inventaire / recalculent le trajet (probable).

### 2.4 Tables en dur de `DGROUP:0676` (certain, lues dans `AM1.EXE`)

| Table | Accès | Contenu |
|---|---|---|
| clés | `217d:0002(n)` | **est-ce une clé ?** `{6, 22, 109, 108, 331}` (clef en or, vieille clef rouillée, clef de bronze, trousseau, clef ouvragée) |
| serrures | `217d:0036(n)` | **clé d'un contenant** : coffret `9 → 6`, gros coffre de chêne `21 → 22`, gros coffre de bronze `110 → 109`, coffre de fer `319 → 108` ; `gm_abort(0x6a)` si inconnu |
| portes | `217d:0088(n)` | portes à serrure, 3 lignes : **porte** 111 / 309 / 329 ; **gardien** 101 (Prytwen) / 301 / 301 (nain soldat) ; **clé requise** 109 / 331 / 331 ; **mot** 2 / 1 / 1 ; **salle A** 105 / 305 / 305 ; **salle B** 104 / 0 / 309 |
| positions | `217d:0126(n, côté, état)` | position `(X, Y, P)` du battant par porte, côté (A/B) et état (fermé/ouvert) : 111 `(112,52,24)` fermée A, `(96,52,24)` ouverte A, `(88,48,16)` / `(95,48,16)` côté B ; 309 `(133,74,44)` / `(114,74,44)` ; 329 `(72,54,8)` / `(62,54,8)`, `(40,119,151)`… (le détail des deux dernières lignes n'est pas relevé) |

## 3. Gestionnaires de verbe (famille 0, 11 fonctions)

`AX = 7` : interrogation, le gestionnaire renvoie sa **politique** sans rien faire ; `AX = 0` : exécution. Tous les refus ci-dessous passent par la file sauf mention « immédiat ». Les messages de repli `V023` « Que voulez-vous faire au juste ? » (aucun nom) et `V029` « Perdez-vous la raison ? » (un nom au moins) sont ceux du défaut.

### 3.1 Défaut `333c:0008` : 23 verbes (1-4, 8, 11, 12, 18, 19, 21-26, 30-32, 34, 37-40) (certain)

Octets lus : `AX ≠ 0 → 0` ; sinon `Dc ≠ 0 → V029 p0` ; `Ic ≠ 0 → V029 p0` ; sinon `V023 p0` ; renvoie 0 (jamais un succès : un verbe sans gestionnaire d'objet ne fait **rien** d'autre qu'un refus). `enq` p0 : tout autre message de priorité ≥ 1 mis en file pendant la commande l'emporte (le niveau de file monte, `parser.md` §7.2).

### 3.2 `regarder` / `r` / `voir` : `33b2:0007` (verbe 5), politique 3 (certain)

Détail complet au `parser.md` §8.2, recoupé ici instruction par instruction. Résumé de l'algorithme (`AX = 0`) :

1. `197e:0272 ≠ 0` (trop sombre) → `say(V041)`, succès.
2. **Indirect résolu** (`I`) : caché (`Inv ≠ 0`) `V026 p3` ; `PREP ≠ dans` `V035 p3` ; `I` non contenant `V029 p3` ; `I.B = 0` → réaction + `V008 p3` ; `I = HERO` → 0 ; si `D` résolu : contenu dans `I` → comme l'objet seul (ci-dessous), sinon `V022 p4` ; si `D` absent mais `Dc` de classe 15 `V022 p1` ; autre nom `V029 p0` ; **sans nom direct** : contenu de `I` non vide → `1664:0004(I)` (panneau de contenu), succès ; vide → `V033 p4`.
3. **Indirect nommé mais non résolu** : classe 6 : `6002` (« salle ») liste les objets de la salle (`21ad:000a(V031, V032, 0)`), autre 6xxx `V029 p0` ; classe 15 `V026 p1` ; autre classe `V029 p0`.
4. **Direct résolu** : caché `V026 p3` ; sinon `enq(p10, classe = D.Ego, numéro = D.Num)` = la description de l'objet dans son état (messages `30+Ego`), affichée en fin de commande ; renvoie 0.
5. **Direct nommé sans objet** : classe 4/9 : `1e08:0014(code) ≥ 0` → texte `D<n>` (p9) ou `I<n>` (p8) s'il est non vide, décor absent : `V026 p0` seulement si `TALK ≠ 0` ; classe 6 : `6001` (« objet ») liste les objets de la salle, `6002` (« salle ») message `L<id de la salle>`, `6004` `V038 p1`, autre `V029 p0` ; classe 15 `V026 p1` ; autre classe `V029 p0`.
6. **Aucun nom** : si un autre gestionnaire a déjà réussi → 0 ; sinon se comporte comme `regarder salle` (code 6002 → message `L<id>`).

### 3.3 `prendre` / `p` : `3371:000d` (verbe 6), politique 0 (certain)

(Messages en `enq` p3 sauf indication.) `AX ≠ 0 → 0`.

* **Aucun indirect** : *D résolu* — tenu `V039` p3 ; objet = héros `V029` p3 ; **à portée** (`D.B`) : si `Ram (+0x1E) = 0` `V020` p3 ; si `20ac:0060(HERO, D)` faux `V021` p4 ; sinon `19dc:0000(HERO, D, 2)` (l'objet entre dans l'inventaire), `V015` immédiat si `TALK ≠ 0`, **succès (7)**. **Hors de portée** : trop sombre `V041` p3 (file) ; `Ram = 0` `V020` p3 ; poids ok → réaction + `V008` p3 ; poids trop fort `V021` p4. *D absent* : `Dc` classe 4/9 : décor présent `V020` p2, absent `V026` p0 ; classe 15 `V026` p1 ; sinon `V029` p0 ; `Dc = 0` → 0.
* **Avec indirect résolu** (`dans X`, `à X`) : caché `V026` p3 ; non contenant `V029` p3 ; `PREP ∉ {dans, à}` `V023` p3 ; `X` hors de portée → réaction + `V008` p3 ; *D résolu* : non contenu dans `X` `V022` p3, sinon `Ram = 0` `V020` p4, `20ac:0060` faux `V021` p4, sinon transfert ; *D absent* : `Dc` de classe 15 `V022` p1 (« Cela ne s'y trouve pas »), autre nom `V029` p0, sans nom → 0.
* **Indirect nommé mais absent** : classe 15 `V026` p1 ; classe 4/9 `V029` p2 (décor présent) ou p0 ; **autre classe** (6, 13, 19…) : `SI`/`DI` ne sont pas initialisés et la file reçoit `(priorité = n° du nom, message V<classe>)` (défaut de code, probable).

### 3.4 `mettre` (15) / `jeter` (16) : `3340:0001`, politique 0 (certain)

Un seul gestionnaire, `VERB` non relu : les deux verbes sont identiques. `AX ≠ 0 → 0`.

* **Sans indirect résolu** : si un nom indirect est présent mais non résolu → classe 15 `V024` p1, autre `V029` p0. Sans nom indirect : *D résolu* : non tenu `V024` p3 ; sinon : si `HERO.Dep ≠ 0` **et** `HERO.Cod = 1` (le héros est en l'air / sur une zone particulière) `13e9:021c(HERO, D)`, `V015` ; sinon `1469:0002(D)` vrai → `V015` ; sinon `19dc:0000(conteneur du héros, D, HERO.Cod, −1)` : 0 ou `0x11` → `V015` ; autre résultat `V094` « Pas ici, il n'y a pas la place ! » (immédiat). *D absent* : `Dc` classe 15 `V024` p1, `Dc ≠ 0` autre `V029` p0, aucun nom → 0. Succès = 7.
* **Avec indirect résolu `I`** : caché `V026` p3 ; `I` non contenant (`Ctn = 0`) `V029` p3 (le test « `I = D` » `V029` compare `I` à une variable locale encore **non initialisée** : défaut de code, jamais vrai en pratique) ; `PREP ∉ {dans, à}` `V023` p3 ; *D résolu* : non tenu `V024` p3 ; `I.B = 0` → réaction + `V008` p3 ; sinon `19dc:0000(I, D, 2)`, `V015`, succès. **Aucun contrôle de capacité ni de poids ici** ; seuls les gestionnaires de la famille 5 peuvent refuser (coffret : valeur ≥ 50, coffres : fermés…). *D absent* : classe 15 `V024` p1 sinon `V029` p0.

### 3.5 `inventaire` (17) : `3312:000a`, politique 0 (certain)

Si le héros existe : `21ad:000a(V036 « rien », V037 en-tête, séparateur 7, contenu du héros +0x7C)`. Renvoie 7. F10 appelle `3312:000a(0)` (`parser.md` §8.5).

### 3.6 `fouiller` (7) : `32f6:000c`, politique 3 (certain)

`AX ≠ 0` : appelle `33b2:0006`, l'entrée réelle de `regarder` (son prologue `push cx` commence un octet avant `33b2:0007`, adresse qu'utilisent Ghidra et `parser.md`), donc renvoie la politique de `regarder` (3). `AX = 0` : refuse (0) s'il y a **deux** noms ou **aucun** ; avec un seul nom : le déplace en position d'**indirect** (copie `D → I`, `Dc → Ic`, `D.A`, `D.B`), vide les champs directs, force `PREP = dans`, appelle `regarder` (`33b2:0006`), restaure tout et renvoie son résultat. `fouiller le coffre` = `regarder dans le coffre`.

### 3.7 `briser` (10) `3311:0004`, `lire` (20) `3316:0004` (certain)

`AX ≠ 0 → 0` ; sinon `enq(p0, V052 « Démolir ne sert à rien. »)` / `enq(p0, V098 « essayez plutôt de "regarder" »)`, renvoie 0. Les objets qui acceptent `lire` ou `briser` le font dans leur gestionnaire de famille 1 (inscriptions, stèle, boule…).

### 3.8 `o` (42) : `332e:0000` (certain)

Trop sombre → `say(V041)` ; sinon `21ad:000a(V031, V032, 0)` sur la liste d'objets de la salle (`salle +0x22`) ; renvoie 7 (même effet que `regarder objet`).

### 3.9 `escalader` (9), `monter` (13), `descendre` (14) : `3332:0004` (certain pour les adresses, probable pour le sens vertical)

`AX ≠ 0 → 0`. Sinon sur la **case du héros** `Sol` (+0x5A) : si `Sol ∈ [7..10] ∪ [23..26] ∪ [40..43]` (échelles / escaliers), `HERO.Ver = +1` et succès (7) **quel que soit le verbe** ; sinon si `HERO.Dep ∈ {2, 4}` (déplacement lié aux zones) : `HERO.Ver = +1` pour `descendre`, `−1` pour `monter` / `escalader`, succès ; sinon `enq(p4, V044 « Vous n'êtes pas au bon endroit. »)`, renvoie 0. L'axe `Ver` est celui de `engine.md` §7.2 (signe à confirmer à l'écran).

### 3.10 `zwygks` (41) : `3317:000a` (certain pour les actions, hypothèse pour l'intention)

Politique **3**. Mot de triche (non documenté par le jeu) : indirect résolu ≠ héros → `19dc:04f1(HERO, I, 2)` (l'objet entre dans l'inventaire, même invisible) ; sinon, avec `Ic` de classe 15 : `1a7b:03b0(Num, 0)` et même effet ; avec `Dc` de classe 15 sans objet résolu : **tous** les objets de type 2 de ce `Num` (liste globale) passent dans l'inventaire (`19dc:0000(HERO, obj, 2)`). Renvoie 7, jamais de message.

## 4. Catalogue par type d'objet (familles 1 et 5)

Chaque entrée : **clé** = `Num`, nom français (`O<Num>` ; mots du dictionnaire), gestionnaire direct `F1` et indirect `F5`, verbes traités, préconditions, effets, messages. Sigles : `D`/`I` objet direct / indirect ; « p3 » = file, priorité 3 ; « immédiat » = `say`. Les verbes non cités tombent sur le défaut (§3.1) ou, pour `regarder`, `prendre`, `mettre`, `fouiller`, `inventaire`, sur leur gestionnaire de verbe. **Index des noms** : clé/clef → 6, 22, 108, 109, 331 ; coffre → 21, 110, 319 ; coffret → 9 ; grille → 103, 309, 316 ; porte → 111, 210, 329 ; herse → 207, 317 ; serrure → 27, 102, 324, 334 ; nain → 201-204, 301 ; os/squelette → 2, 13, 14 ; bois → 12, 17 ; feu → 18 ; torchère → 114 ; inscription → 16, 115.

### 4.0 Entrées par défaut

* `F1[0]` `10c8:0130` et `F5[0]` `10c8:0134` : `MOV AX,7 ; RETF`, **sans effet** ; ce sont les gestionnaires renvoyés quand la porte de chapitre est fermée : toute commande sur un objet de ce chapitre « réussit » en silence (certain).

### 4.1 `3` · la pie (`oiseau`, `pie`) · F1 `2774:05ce`, F5 `2774:0606`

* F1 : `manger` (11) → `V038` « Vous avez mieux à faire. » p4, désactive le verbe ; autre verbe → 0.
* F5 (la pie comme **indirect**, toute préposition) : `V029` p4, désactive le verbe, 0. (certain)

### 4.2 `4` · l'ours (`ours`, `fourrure`, `peau`) · F1 `26da:06c6`, F5 `26da:07ea`

* `manger` (11), `pousser` (19) → `V075` « Faites-le vous-même ! » p4 ; `nourrir` (12) → `V053` « Non ! » p4 ; `attaquer` (21) → `V054` « Vous n'êtes pas assez fort ! » p4. Tous désactivent le verbe.
* `fouetter` (23) : exige le **fouet** `Num 10` dans l'inventaire (`21e7:0006`), sinon `V080` p3 ; l'ours doit être proche (`near(ours, héros, 40, −1, 8)`), sinon réaction + `V008` p3 ; `ours.Ego ∈ {0, 1}` (réveillé), sinon `V081` p3 ; `say(V077)` « Sans pitié aucune… coup de fouet » ; puis `rand() % 5 ≠ 0` (4 fois sur 5) : l'ours s'éloigne (`2151:02a0` choisit une cible d'errance, `Err = 0`), `say(V078)` « Gagné ! L'ours a peur du fouet… » ; sinon `say(V079)` « Raté, l'ours esquive le coup ! ». Succès (1) dans les deux cas.
* F5 : `V029` p4, désactive le verbe. (certain)

### 4.3 `9`, `21`, `110`, `319` · coffret / gros coffre de chêne / gros coffre de bronze / coffre de fer · F1 `22c1:0002`, F5 `22c1:029e` (coffret : F5 `2566:000e`)

Automate sur `Ego` : **0** fermé et verrouillé, **1** fermé non verrouillé, **2** ouvert (`Fig` 0, 0, 1 ; descriptions `30021`, `31021`… : « fermé à clef », « n'est pas fermé à clef », « grand ouvert »). Clé exigée : `217d:0036(Num)` (§2.4).

F1 (verbes 3 `ouvrir`/`débloquer`, 4 `fermer`, 7 `fouiller` ; autres → 0) :

* Préambule : `D.B = 0` → réaction + `V008` p3 ; `PREP ∉ {0, avec}` → `V023` p0 ; (désactivent le verbe).
* **ouvrir**, Ego 0 : sans `PREP` `V014` p1 ; indirect absent `V046` p1 « Inutile d'essayer de forcer ce coffre » ; `I` non tenu `V013` p3 « Vous ne pouvez utiliser que ce que vous détenez » ; `I.Num ≠ clé` : `V047` « Vous n'avez pas la bonne clef » p3 si `I` est une clé (§2.4), sinon `V046` p3 ; **bonne clé** → `setState(Ego 2, Fig 1, Gst 0, Mob 0, Dep 0, Txt 0)`, `V015` (si `TALK`), succès 7. Ego 1 : s'ouvre sans clé (même `setState`). Ego 2 : `V045` p4 « Il est déjà ouvert ».
* **fermer**, Ego 2 : `setState(Ego 1, Fig 0)` et désélectionne l'objet s'il l'était ; sans `avec` : `V015`, succès ; avec `avec` : enchaîne le verrouillage ci-dessous (« fermer le coffre avec la clef » ferme **et** verrouille). Ego 1 : sans `PREP` `V048` p3 « Ce coffre est déjà fermé » ; avec `avec` : mêmes contrôles de clé qu'à l'ouverture ; **bonne clé** → `setState(Ego 0, Fig 0)`, `say(V049)` « Le coffre est maintenant solidement fermé ». Ego 0 : `V048` p4.
* **fouiller** : `Ego = 2` → 0 (la fouille normale ensuite) ; sinon `V051` p4 « Le coffre est fermé », désactive. (certain, `22c1:0296`)

F5 `22c1:029e` (clés 21, 110, 319) : `PREP ∈ {dans, à}` et `I.Ego ≠ 2` → `V051` p4 + désactive le verbe : **on ne peut ni regarder dedans, ni prendre, ni mettre dans un coffre fermé** (la capacité et la forme du contenu ne sont pas testées ici). Renvoie 0.

F5 coffret `2566:000e` : `PREP ∈ {dans, à}` ; `I.B = 0` → réaction + `V008` p3 ; `I.Ego ≠ 2` → `V065` « Le coffret est fermé. » p4. Verbes 5, 6, 7 → rien. Verbes 15, 16 (mettre/jeter) : `D` requis ; `D = I` `V053` p4 ; `D` non tenu `V024` p3 ; `D.Val (+0x18) ≥ 50` : `19dc:0000(coffret, D, 2)`, **`score(0, 0)`** (id 0, 5 pts), succès ; sinon `V040` p4 « Mettre ÇA dans ce joli coffret ! Vous plaisantez !! ». Le coffret n'accepte donc que les trésors de valeur ≥ 50 (diadème 300, clé en or 1000, pépite, baguette…). (certain)

### 4.4 `12` · la torche (`torche`, `bois`) · F1 `2420:011e`

États `Ego` 0..3 **allumée** (0 « presque consumée », 1 « faiblement », 2 « brûle », 3 « éclaire bien car neuve »), 4..7 = éteinte (état + 4), **8** neuve et éteinte. Verbes 1 `allumer`, 2 `éteindre`, 6 `prendre` ; autres → 0.

* **allumer** : `Ego < 4` → `V012` « Votre torche brûle déjà. » p4, désactive, 0. Sinon exige `PREP ∈ {dans, avec}` et un indirect (`V014` p1 sinon) dont `Num ∈ {12 (autre torche), 18 (feu), 114 (torchère), 116, 216}` (`V014` p1 sinon). Autre torche : doit brûler (`Ego < 4`, sinon `V016` « Vous n'avez pas de feu. » p3). Feu : `I.B = 0` → réaction + `V008` p3 ; `Ego(feu) < 3` → `V009` p4 (mort) / `V017` p4 (« ne fait plus de flammes »). Torchère / 116 / 216 hors de portée : réaction + `V008` p3. **Succès** : état neuf `Ego − 4` (4..7) ou 3 (si 8, `Tim (+0x32) := 36000` = `DGROUP:5262`), `setState(Gst 7, Mob 1, Ego = Fig)`, `Lum (+0x0A) := 0`, `Rep (+0x34) := 1000`, **`score(0, 1)`** (id 1, 5 pts), `V015` si `TALK`, renvoie 1.
* **éteindre** : `Ego < 4` → `2420:0398` (état + 4, `Lum := 0`, `Gst = Mob = 0`), redessin, `V015`, succès ; sinon `V018` « La torche est déjà éteinte. » p3, désactive. Pas de score.
* **prendre** (`D` absent ou déjà tenu ; sinon prise standard) : cherche un objet de `Num 17` (`bois`) parmi les frères du héros (`21fb:0002(17)`), absent → 0 ; `HERO.Sol ≠ 0x41` → réaction + `V008` p3 ; `Pds(contenu) + 5 > Chg(héros)` → `V021` p4 ; sinon **crée une torche neuve** (`Num 12`, `Cod 2`, conteneur = héros) et `V015`, succès. (Le bois est une réserve illimitée de torches, voir `245d` ci-dessous ; cette branche « D absent » est probablement morte pour la phrase tapée, §1.2.)
* Procédure `Fct` (F2) `2420:000e` : toutes les 100 mises à jour décompte `Tim` par 100 ; à 0 passe à l'état inférieur avec la durée `DGROUP:525C[état] = {12000, 18000, 24000, 36000}` et affiche `V001..V004` dans la salle du héros ; à l'état 0 la torche est détruite (`V001` « s'est éteinte, vous la jetez »). `Lum` croît avec l'état et le temps restant. (certain)

### 4.5 `16` · la stèle (`stèle`, `dalle`, `inscription`, `texte`) · F1 `2500:016c`, `2500:026c`

Automate sur `Ego` : **0** normale (fermée), **1** « bloquée, hors position » (serrure débloquée, mécanisme coincé), **2** coulisse (ouverture), **3** coulisse (fermeture), **4** ouverte (passage), **5** normale à nouveau (fermée, réarmée), **6** couverte de ronces (état initial, `Ego 6` dans le monde). Descriptions `30016..36016`.

Verbes : `ouvrir` 3, `fermer` 4, `pousser` 19 → `2500:026c(D)` ; `briser` 10 → `V066` p4 ; `lire` 20 ; `nettoyer` 26.

* **lire** : `HERO.Sol = 0x27` → `V068` « L'inscription est en anciennes runes… Illisible » p4 ; sinon `V008` p3.
* **nettoyer** : `1a7b:03b0(20, 0)` (les ronces) absent → `V091` « C'est déjà fait ! » p4 ; `HERO.Sol ≠ 0x27` → `V008` p4 ; sinon `HERO.Ego := 7` si le héros est `Num 1` et pas déjà à 6 (déclenche la coupe, voir ronces) ; succès sans message.
* `2500:026c` (**ouvrir / fermer / pousser**) : `Ego = 6` → `V056` « La stèle est encombrée… » p3. Si un objet de la salle a `Sol = 0x27` → `V056` p3 ; un objet sur `Sol = 0x50` (80) active le drapeau « Pas maintenant » (`V093` p4). `PREP ≠ avec` → `say(V014)` et succès (rien ne change). Outil `I` : `15006` (clef en or) « G », `15011` (levier) « L », autre clé « K ».
  * **ouvrir**, Ego 0 ou 5 : outil G tenu, `HERO.Sol = 0x24` (devant la serrure, sinon `V057` « Vous êtes trop loin de la serrure » p4) et rien sur `0x50` : **Ego 0 → Ego 2** (`Gst 7, Mob 1, Fig 0`, `say(V061)` « Après un léger déclic la stèle se met à glisser ») ; **Ego 5 → Ego 1** (`say(V060)` « …le mécanisme reste bloqué… », `X += 2`, **`score(0, 2)`** id 2). Outil L : `V059` « Cette stèle est bloquée… même avec ce levier » p4 (tenu) / `V013` p1 ; outil K : `V082` p4 (« Ce n'est pas la bonne clef », tenu) / `V013` p1 ; sinon `V014`.
  * Ego 1 : outil L tenu, `HERO.Sol = 0x2C` (sinon `V064` « Pousser la stèle depuis cet endroit… » p4) → `say(V063)` « Avec un gros effort sur le levier… », **Ego 1 → 2** ; outil G tenu → `V062` « La serrure est déjà débloquée » p3 ; sinon `V013` / `V082` / `V014`.
  * Ego 2, 3 → `V029` p3 ; Ego 4 → `V055` « La stèle est déjà ouverte. » p4 (p3 pour `pousser`).
  * **fermer** : Ego 0, 5 → `V058` « La stèle est déjà fermée. » p3 ; Ego 1 → `V062` p4 ; Ego 2, 3 → `V029` p3 ; **Ego 4** : outil G tenu, `Sol = 0x24`, rien sur `0x50` → Ego 3 (`say(V061)`) ; sans la clef en or : outil K `V082` ou, sinon, `V054` « Vous n'êtes pas assez fort ! » (p3 si l'outil est tenu, p1 sinon).
  * **pousser** : Ego 0 ou 5 : levier tenu `V059` p3, levier non tenu `V013` p1, autre outil ou aucun `V054` ; Ego 1 : sans levier `V054` p3, avec levier comme l'ouverture au levier (`V013` p1 non tenu, `V064` p4 si `Sol ≠ 0x2C`, `V093` p4 si `0x50` occupé, sinon `V063` et Ego 2) ; Ego 2, 3 `V029` p3 ; Ego 4 `V055` p3.
* Les serrures `15027` (clé 27, `258d:000a`) et `15102` (clé 102, `27d8:000e`) renvoient `2500:026c` sur la stèle trouvée par `1a7b:03b0(16)` pour `ouvrir`/`fermer` ; `briser` → `V066` p4 (p3 pour 102). (certain)
* F2 `2500:0008` : Ego 2 : `X += 1` par tic jusqu'à 98, Ego 3 : `X −= 1` jusqu'à 54 ; à l'arrivée : état 4 (resp. 0), **`score(0, 3)`** (id 3, 30 pts), `4b50 := 7` (contrôle rendu au joueur), rafraîchit la salle. (certain)

### 4.6 `17` · le bois (`bois`) · F1 `245d:000e`

Seul `prendre` : **réserve de torches**. Avec `D` : `HERO.Sol = 0x41` sinon réaction + `V008` p3 (désactive) ; `Pds(contenu) + 5 > Chg` → `V021` p4 ; sinon crée une torche `Num 12` (`Cod 2`, héros) et `V015`, succès (1). Le tas (`Num 17`, 6 exemplaires dans la salle 8, `Pds 3000`, non ramassable) reste en place.

### 4.7 `18` · le feu (`feu`, `braise`) · F1 `264c:0126`, F5 `264c:01ac`

États `Ego` 0..6 : 0 mort, 1 presque éteint, 2 braises, 3 petites flammes, 4 faiblit, 5 brûle bien, 6 très beau feu (durées `DGROUP:5264[état]`).

* F1 : hors de portée → réaction + `V008` p3 ; `allumer` (1) : `Ego = 0` → `V011` « Il est impossible de rallumer le feu, à moins… » p3, sinon `V010` « Le feu brûle encore » p3 ; `éteindre` (2) : `Ego = 0` → `V009` « Inutile, le feu est mort » p3, sinon `V019` « Impossible, mais essayez toujours de piétiner ce feu » p3 ; désactivent le verbe. Autres → 0.
* F5 (feu comme indirect, `dans`/`à`) : `I.B = 0` → réaction + `V008` p4 ; seuls `mettre` / `jeter` (15, 16) ; `D` absent `V024` p1 ; `D.Num ≠ 12` `V020` p3 ; torche non tenue `V013` p3 ; `Ego(feu) = 0` → `say(V009)` succès (la torche n'est pas consommée) ; sinon **`264c:02b0(feu, torche)`** : la torche est **détruite**, le feu passe à l'état `Ego + 1` (borné à 6), `Tim := DGROUP:5264[état]`, `say` selon l'état (2 → `V027`, <6 → `V028` « Le feu reprend vigueur », 6 → `V015`) ; puis **`score(0, 4)`** (id 4, 20 pts), succès. (certain)

### 4.8 `20` · les ronces (`ronce`, `roncier`) · F1 `257b:0060`

Verbes 1 `allumer` → `V053` « Non ! » p4 ; 8 `arracher/couper`, 10 `briser`, 26 `nettoyer` : `HERO.Sol ≠ 0x27` → `V008` p4 ; sinon `HERO.Ego := 7` (si le héros est `Num 1` et pas déjà à 6), succès sans message (la coupe est faite par l'IA du héros). Désactive le verbe pour `V008`/`V053`. F2 `257b:000a` : quand l'animation de coupe est finie (`16f5:02a2`) détruit les ronces, passe la **stèle** (`Num 16`) à `Ego 5` et **`score(0, 5)`** (id 5, 20 pts) ; `G20` annonce la découverte. (certain pour les deux gestionnaires)

### 4.9 `101` · Prytwen le voleur (`prytwen`, `homme`, `voleur`) · F1 `28b1:0b6e`, F5 `28b1:0fba`

Personnage à états `Ego` : 0 éveillé / en attente, 1 « en affaire » (en pourparlers), 2 **assommé** (« a son compte »), 3 **mort**, 4 il s'en va, 5 il attend votre or. F2 `28b1:0000` (IA, `characters.md`), F8 `28b1:11e0`, F9 `28b1:1482`.

F1 :

* Préambule commun : `D.B = 0` → réaction + `V074` « Idée intéressante, approchez-vous ! » p3.
* **prendre** (6) : le héros doit être `Num 1` avec `Ego 0` (sinon `V053` p4) ; Prytwen `Ego 1` → `V092` « Ce n'est pas le moment ! » p3 ; **`Ego 2`** : `20ac:0060` faux → `V120` p3 « trop lourdement chargé pour pouvoir soulever » ; sinon Prytwen `Ver := 1`, état `Ego 2, Fig 2`, `19dc:0000(HERO, Prytwen, 2)`, `26ab:01fc(HERO, 7)` (le héros passe en mode « porteur »), **`score(1, 4)`** (id 104, 10 pts), `say(V101)` « Non sans effort, vous chargez péniblement Prytwen » ; `Ego 3` → `V134` p3 ; autre état → `V076` « Essayez toujours. » p3.
* **fouiller** (7) : tenu `V102` p4 ; `Ego ∈ {2, 3}` → 0 (fouille normale, `V103` « Vous lui faites les poches »), sinon `V075` p3.
* **mettre / jeter Prytwen** (15, 16) : avec une préposition `V104` « A votre place, j'abandonnerai Prytwen ici » p3 (tenu) / `V023` p3 ; sans : non tenu `V024` p3 ; sinon état `Ego 2, Fig 1`, `19dc:0000(conteneur du héros, Prytwen, HERO.Cod, −1)` : refus → état rétabli `Ego 2, Fig 2` et `V094` p4 ; sinon `246c:0240(HERO, 7)`, `say(V105)` « Sans ménagement, vous jetez Prytwen sur le sol ».
* **tuer** (22) : tenu `V102` p3 ; `Ego 1` `V135` p3 ; `Ego 2` `V140` « Cette lacheté ne serait pas digne de vous ! » p3 ; `Ego 3` `V091` p3 ; sinon comme **attaquer**.
* **attaquer** (21) : tenu `V106` p4 ; héros ≠ `Num 1`/`Ego ≠ 0` `V053`/`V093` p4 ; `Ego 1` `V135`, `Ego 2` `V091`, `Ego 3` `V090` « C'est désormais inutile » (p3) ; sinon combat perdu d'avance : `playAnim(13, Prytwen, héros, Ego 1, …, V107)` (animation 14 si la salle est la 105) « Engager des pourparlers… idée intéressante », `die(héros, 1)`, le héros prend la position de Prytwen, **`score(1, 0)`** (id 100, 10 pts).
* **fouetter** (23) : tenu `V102` ; sans fouet `V080` p3 ; `Ego 2` `V108` « On ne frappe pas un homme à terre ! » p4 ; `Ego 3` `V090` ; sinon le fouet est **détruit**, Prytwen (si `Ego 0` et pas le héros) vient vers vous (`walkTo`) et `say(V109)` « Manqué ! Prytwen vous arrache le fouet des mains ».

F5 (`PREP ∈ {dans, à}`) : `regarder` (5) : `I.B = 0` réaction + `V074` ; tenu `V102` p4 ; `Ego ∈ {2, 3}` → 0 sinon `V075` p3 ; `prendre X à Prytwen` (6) : tenu `V102`, hors de portée `V074`, `Ego ∈ {2, 3}` → réécrit `PREP := dans` et 0 (prise standard dans ses poches), sinon `V076` p4 ; `mettre` / `jeter` (15, 16) → `V029` p0 ; `parler` (24) : `Ego 1` `V135` p4, `Ego ∈ {2, 3}` `V136` « Prytwen n'est plus en état de parler » p4, sinon `walkTo(Prytwen, héros)` et `say(V110)` « Prytwen n'est pas un homme de grande conversation » ; tout autre verbe `V023` p4. **Donner** à Prytwen (32) n'est donc pas traité ici (il récupère l'or par son IA, `Ego 5`). (certain)

### 4.10 `103` · la grille du cachot (`grille`, `porte`) · F1 `2846:00ec`

Automate `Ego` : 0 fermée, 1 s'ouvre, 2 se ferme, 3 ouverte. Verbes `ouvrir` 3 / `fermer` 4 ; `PREP ∉ {0, avec}` → `V023` p0.

* Hors de la zone d'action (`near(grille, héros, 20, −1, 8)` faux) → réaction + `V008` p4.
* **ouvrir**, Ego 0 : sans `PREP` `V014` p0 ; indirect autre que le trousseau (`Num 108`) : absent `V014` p0, non-objet `V023` p0, non tenu `V013` p3, clé `V082` p4, sinon `V023` p0 ; **trousseau**, non tenu `V013` p4 ; **trousseau tenu** : si le héros est *derrière* la grille (`HERO.P < grille.P`), le trousseau est posé dans la salle (`1a37:0002` : `Ego 0, Fig 1`, position `(58, 49, 8)`) et `say(V113)` « La serrure bien huilée fonctionne… vous accrochez les clefs au clou » ; dans tous les cas `4b50 := 0` (contrôle du héros suspendu), `stop(héros)`, son `'B' 101`, **événement différé 15** (compteur 2, procédure 103), succès. Ego 1, 2 → `V029` p0 ; Ego 3 → `V111` « La grille est déjà ouverte » p3.
* **fermer**, Ego 3 : `2846:0398(grille, héros, 0)` (commence à se refermer) succès ; Ego 0 `V112` « déjà fermée » p3 ; Ego 1, 2 `V029` p0.
* `2846:0398(grille, autre, mode, drapeau)` : démarre l'animation (`Gst 7, Mob 1, Ego = 1` ouverture / `2` fermeture, son `'B' 102`, `Bag (+0x36) := 9`) ; si le héros est la cause (piège à dalle) `say(V118)` « Oups !! … la fermeture de la grille ! ». `2846:04d6` : prédicat « grille ouverte » (`Ego == 3`).
* F8 `2846:042c` (événements 15, 16, 17) : 15 → `2846:0398(…, ouverture)` ; 16 → `sayNear(G112)` + rend le contrôle ; 17 → rend le contrôle, `147f:0352` (nouvelle scène) et, si le héros est passé devant, **`score(1, 5)`** (id 105, 10 pts). (probable)

### 4.11 `105` · la pépite d'or géante · F1 `27dd:000c`

Seul `prendre` : tenu `V039` p4 ; hors de portée et sans indirect → réaction + `V008` p4 ; indirect hors de portée → `V008` ; `20ac:0060` faux → `V116` « trop lourdement chargé pour pouvoir emmener une pépite » p4 ; sinon `19dc:0000(HERO, pépite, 2)` et `say(V117)` « Avec un effort surhumain vous parvenez à arracher… », succès (1). (La pépite pèse 450 pour une capacité de héros de 500 : un seul autre objet léger passe.)

### 4.12 `108` · le trousseau de clefs · F1 `282d:000c`

Seul `prendre` : si `20ac:0060(HERO, D)` vrai → `1a37:0002(D, Ego 0, Fig 0)` (remet l'icône de l'inventaire) puis **renvoie 0** (la prise standard suit). (certain)

### 4.13 `111`, `309`, `329` · les portes à serrure (porte du cachot, grille de fer, porte de métal) · F1 `20b5:000e`

Lignes de la table §2.4 : `111` gardien Prytwen, clé `109` (bronze), salles 105 ↔ 104 ; `309` et `329` gardien nain soldat, clé `331` (ouvragée), salles 305 ↔ 0 et 305 ↔ 309. Automate `Ego` : 0 fermée à clef, 1 fermée, 2 ouverte. Verbes 3 `ouvrir`, 4 `fermer` ; `D` doit être l'objet de la table (`gm_abort(0xa5)` sinon).

* `D.B = 0` → réaction + `V008` p3 ; `PREP ∉ {0, avec}` (porte à clé) → `V023` p0.
* **ouvrir** : Ego 2 → `V083` « La porte est ouverte. » p4 ; Ego 1 → `20b5:0248(Num, 2)` (ouverture : place le battant dans la salle visible à la position de la table, `setState` selon le côté) et `V015` ; Ego 0 : sans `PREP` `V084` « La porte est fermée. » p4 ; indirect non tenu `V013` p3 ; **clé = clé de la table** → ouvre ; autre clé `V082` p3 ; non-clé `V014` p3.
* **fermer** : Ego 0 → `V084` p4 ; Ego 1 → sans `PREP` `V091` p3, avec une clé : si c'est la bonne `20b5:0248(Num, 0)` (verrouille) + `say(V085)` « Crrrriic Clac ! C'est fait. » ; Ego 2 → `20b5:0248(Num, 1)` (referme) puis, si `PREP = avec`, verrouillage comme ci-dessus ; sinon `V015`.
* `20b5:0248(Num, nouvel état)` : retrouve la ligne de la table, le battant et les deux salles ; si le battant est dans l'autre salle, le déplace (`1a7b:0118`) ; calcule `(X, Y, P)` par `217d:0126` et applique `setState` (`Fig = 2·côté + état`). (probable)

### 4.14 `113` · l'armoire · F1 `2815:0006`, F5 `2815:0112`

`Ego` 1 fermée, 2 ouverte (écrit directement, sans animation). F1 : `ouvrir` : hors de portée → réaction + `V008` p3 ; `Ego 1 → 2` et `say(V015)` ; `Ego 2` `V083` p3. `fermer` : `Ego 2 → 1` ; `Ego 1` `V084` p3. `fouiller` : hors de portée `V008` ; `Ego ≠ 2` → `V084` p4 ; sinon 0. F5 (`dans`) : `I.B = 0` → réaction + `V008` p4 ; verbes 5, 6, 7, 15, 16 avec `I.Ego ≠ 2` → `V084` p4 + désactive. (certain)

### 4.15 `114` · la torchère · F1 `2832:0008`

Seul `tirer` (25), **uniquement si `D.Ego ≠ 0`** (une des torchères est piégée ; les autres → 0 et le défaut `V029`). Hors de portée : réaction + `V008` p3. Cherche la dalle (`Num 104`, `gm_abort(0x8a)` sinon) et balaie sa salle : un objet sur `Sol 0x2E` (46) → `say(V133)` « il se produit un léger déclic. Une dalle semble vouloir bouger » succès ; un objet sur `Sol 0x51` (81) → drapeau. Selon `dalle.Ego` : **0** (fermée) ou **3** (ouverte) : drapeau → `V093` p4 ; sinon `say(V114)` « …une grosse dalle se met lentement à glisser » (ouverture) ou `say(V115)` « …la dalle reprend lentement sa place » (fermeture), son `'B' 101`, **événement différé 18** (compteur 10, procédure 104) ; **4** → `say(V119)` « le mécanisme du passage secret est cassé » ; 1, 2 (en mouvement) → `V029` p0. Succès (1). (certain) F8 `27ed:01e0` (événement 18) lance le mouvement de la dalle : `setState(Gst 7, Mob 1, Ego = 1)` si elle était à `Ego 0`, sinon `Ego = 2`, `Tim := 22` ; la procédure `Fct` `27ed:000a` termine (états 3 ouvert / 0 fermé) et attribue **`score(1, 6)`** (id 106, 40 pts).

### 4.16 `115` · l'inscription / le graffiti (`inscription`, `graffiti`, `message`, `texte`) · F1 `2895:0004`

Verbes 5 `regarder`, 20 `lire`, 26 `nettoyer`. Visibilité `SI` : −1 si la grille (`Num 103`, parmi les frères) est *devant* le héros (`grille.P > héros.P`) ; sinon `near(héros, D, 16, −1, 10)` (1 proche, 0 loin).

* `SI < 0` : `V132` p4 « Il est impossible de voir les inscriptions de là où vous êtes ». 
* **regarder** : proche → description d'état (`say` de la classe `30+Ego`, numéro 115) ; loin → compteur `D.Set (+0x2C)` ; tous les 5 appels la description, sinon `V121..V124` en tournant (« Certaines inscriptions sont écrites… »).
* **lire** : loin → `V124..V129` en tournant par `D.Mc1 (+0x20) % 6` ; proche : `Ego 0` (moisie) `V131` « trop sale pour être lisible » ; `Ego ≠ 0` (nettoyée) `V130` « Pas.ag. s..ret sous le tr.ne… » + **`score(1, 8)`** (id 108, 5 pts).
* **nettoyer** : loin `V008` p3 + réaction ; `Ego ≠ 0` `V106` « C'est déjà fait ! » ; sinon `setState(D, Ego 1, Fig 1)`, **`score(1, 7)`** (id 107, 5 pts), `V138` « La moisissure s'enlève sans peine ». Tous immédiats, succès 1. (certain)

### 4.17 `201`-`204`, `301` · les nains (`nain`) et le nain soldat · F1 `2a44:0eb8`, F5 `2a44:11e2`

États `Ego` (descriptions `30201`.. ; 0..4 certain, 5-8 probable) : 0 éveillé / hostile, 1 en combat (« occupé »), 2 **assommé**, 3 **mort**, 4 s'éloigne ; 5, 6 propres à l'IA ; 7 et 8 endormi (réveillés par l'événement 3/4 ou un coup de fouet). F2 `2a44:000c`, F8 `2a44:12fc` (événements 3, 4 : réveil), F9 `2a44:13fa`.

F1 (verbes 6, 7, 21, 22, 23) : `D.B = 0` → réaction + `V008` p3 (prendre, fouetter) / `V074` p3 (autres).

* **prendre** : `Ego 1` `V201` « Le nain est occupé pour l'instant. » p4 ; `Ego 2` `V202` « S'il se réveillait il vous trancherait le cou ! » ; `Ego 3` `V203` « Laissez-le reposer en paix. » ; sinon `V076` p4.
* **fouiller** : `Ego ∈ {2, 3}` → liste de ses objets `21ad:000a(V042, V205 « Le nain possède : », 7, contenu)` succès ; autre état `V204` « Je doute qu'il vous laisse faire ! » p4.
* **tuer** (22) : `Ego 2` ou `Ego ∈ {7, 8}` (endormi) : exige une arme dans l'inventaire — épée d'orichalque `Num 314` ou hache `Num 206`. Nain ordinaire : épée → animation de mort `Num − 177` (24..27), `Ego := 3`, `Err := 0x11`, `say(V366)` « Victoire facile et sans honneur » ; hache seule → même chose avec `V207` « Profitant traîtreusement du sommeil… » ; ni l'une ni l'autre `V208` « Vous n'avez pas de hache… » p4. Nain soldat (`301`, armure) : épée seulement (animation 38, `V366`) ; hache seule `V367` « La hache n'entamera pas son armure » p4 ; sans arme `V368` p4. `Ego 3` → `V091` p3. Autres états → corps à corps ci-dessous.
* **attaquer** (21) et autres états de **tuer** : `Ego 1` `V201` ; `Ego 2` `V108` « On ne frappe pas un homme à terre ! » ; `Ego 3` `V090` ; sinon, le héros doit être `Num 1` (sinon `V053` immédiat, succès) : `playAnim(29, nain, héros, V206 « L'entreprise est hasardeuse… »)`, `die(héros, 1)`, le héros prend la position du nain, succès sans message supplémentaire.
* **fouetter** (23) : sans fouet `V080` p4 ; `Ego 1` `V201`, `Ego ∈ {2, 3}` `V108` p4 ; `Ego ∈ {7, 8}` → éveil (`setState(Gst 7, Mob 2, Ego 0)`) ; puis `2a44:135a(héros, nain)` (éveil et poursuite, voir ci-dessous) et `say(V209)` « Ce nain est farouche et insensible aux coups ». Succès.

F5 (le nain comme **indirect**, `PREP ∈ {dans, à}`) : `prendre X au nain` (6) : hors de portée → réaction + `V074` p3 ; `Ego 1` `V201` p4 ; `Ego ∈ {2, 3}` → réécrit `PREP := dans`, 0 (prise standard dans ses poches) ; sinon `V204` p4. `parler` (24) : `Ego 1` `V201` ; `Ego ∈ {2, 3}` `V226` « Le nain n'est plus en état de parler » ; `Ego ∈ {7, 8}` → éveil ; sinon (ou après éveil) `2a44:135a(héros, nain)` et `say(V210)` « Rien qu'à voir la lueur de haine… il est clair qu'il n'a guère envie… » succès. Tout autre verbe `V023` p4 + désactive.

`2a44:135a(héros, nain)` : refuse (0) si le héros est invisible (`Inv ≠ 0`) ; éveille (`Ego ≥ 7 → 0`), `walkTo(nain, héros, 7)` (puis 0), met `+0x28 := 1`, `Ego := 0`, `Err := 0`, renvoie 7. F8 `2a44:12fc` (événement 3 ou 4) : si `Ego ≥ 7`, éveil, arrêt, `sayNear(G342)`. F9 `2a44:13fa` : vrai si `Ego ∈ {0, 4}`, sinon `V093`. (probable)

### 4.18 `210`, `211`, `212` · la poterne, la niche, le parchemin · F1 `2a1c:0004`, F5 `2a3e:000c`, F1 `2a39:0006`

* `210` (poterne vermoulue, salle 212) : la niche (`Num 211`, requise, `gm_abort(0x5d)`) ; « près » = `0 ≤ HERO.Y − D.Y ≤ 16`. `allumer` (1) → `V218` « La poterne est trop humide pour pouvoir brûler. » p4. `ouvrir` (3), `briser` (10), `attaquer` (21) : loin → `V008` p3 ; `Ego ≠ 0` (déjà détruite) `V091` p4 ; sans `avec` `V227` « Le bois est certes vermoulu mais vos seuls poings ne suffiront pas » p0 ; indirect autre qu'un objet `V014` p1 ; non tenu `V024` p3 ; selon `I.Num` : **206 (hache)** → poterne `setState(Ego 1, Fig 1)`, niche `setState(Ego 1, Fig 0)`, **`score(2, 0)`** (id 200, 10 pts), `say(V222)` « La petite poterne vole en éclats sous les coups de hache » ; 6 (clef en or) ou 109 `V220` « La clef ne rentre pas dans cette serrure » p3 ; 108 (trousseau) `V221` « La serrure est définitivement grippée » ; **11 (levier)** `13e9:021c(héros, levier)` (il tombe) et `say(V219)` « Oups, le levier vous échappe des mains ! » ; autre `V023` p4. `fermer` (4) : `Ego 0` → `V029` immédiat ; sinon `V223` « Impossible, la porte est démolie ! » immédiat.
* `211` (niche, F5) : `PREP = dans` (sinon `V023` p4) ; niche `Ego 0` → `V224` « La niche est fermée, donc hors d'accès. » p4 ; sinon `prendre` → **`score(2, 3)`** (id 203, 5 pts), 0 (prise standard).
* `212` (parchemin, F1) : `lire` (20) : tenu → **`score(2, 1)`** (id 201, 20 pts) et `say(V225)` « Le parchemin utilise un langage d'homme, très ancien » ; non tenu `V024` p3. (certain)

### 4.19 `302` · le Sarhûl (`sarhûl`, `monstre`, `bête`, `animal`) · F1 `2cdf:054a` (corps `2cdf:0686`), F5 `2cdf:06d2`

États : 0 normal, 1 « le spectacle n'est pas beau », 2 occupé (mange), 3 occupé (profitez-en). F2 `2cdf:0004`, F9 `2cdf:0706`.

* `prendre` (6), `briser` (10), `manger` (11), `attaquer` (21), `tuer` (22) : hors de portée → réaction + `V074` p3, à portée `V075` « Faites-le vous-même ! » p3.
* `nourrir` (12) : hors de portée → réaction + `V008` p3 ; sans jambon (`Num 311`) `V313` « Vous n'avez rien à lui offrir, sinon vous-même ! » p4 ; avec : le jambon est détruit, `playAnim(40, Sarhûl, Ego 2, V312 « Le Sarhûl vous arrache le jambon des mains »)`, succès.
* `fouetter` (23) : sans fouet `V080` p3 ; loin → `V008` ; `Ego 0` : `walkTo(Sarhûl, héros, héros visible)` et `say(V307)` « Manqué ! Par contre le Sarhûl, lui, ne vous manquera pas… » ; `Ego 1` `V097` « Hélas ! Il est trop tard !!! » p3 ; sinon `V092` p3.
* F5 : `parler` (24) → `V308` « Grompf, sglup, miam ! » p3 ; autre verbe `V023` p4 (désactive). (certain)

### 4.20 `303` · Minas Thyl la sorcière (`minas`, `thyl`, `sorcière`) · F1 `2dd9:0df8`, F5 `2dd9:0fd0`

États `Ego` : 0 normal, 4 « emmène vers un sort peu enviable » (hors jeu), 5 « attend quelque chose de votre part », 6 « ce n'est pas le moment », 7 normal (autre). Elle porte la baguette (`Num 320`) tant qu'elle ne l'a pas perdue. Drapeaux : `+0x20` (compteur de la baguette), `+0x42`. F2 `2dd9:0006`, F8 `2dd9:1440`, F9 `2dd9:1570`.

F1 : `prendre` (6) → à portée `V075` p4, sinon réaction + `V074` ; `briser` (10) `V310` « Minas Thyl est immortelle ! » p4 ; `manger` (11) `V311` « Yuck ! Pas question ! » p4 ; `fouiller` (7), `pousser` (19), `attaquer` (21) : loin → réaction + `V008` ; si elle a sa baguette (`21e7:0022(Minas, 320)`) et `Ego ∈ {0, 5, 7}` → **le héros est changé en crapaud** (`2dd9:14cc` : Minas passe en `Ego 1` avec `say(V314)` « Impudent ! Voilà ce que tu mérites… », puis `2d52:06b0` remplace le héros par un crapaud `Num 327`) ; sans baguette `say(V309)` « Slap ! Slap Slap !! Comment oses-tu ? » (immédiat, succès) ; avec baguette mais `Ego` hors `{0, 5, 7}` : `Ego 4` `V093` p3, autre `V092` p3. `tuer` (22) : loin → réaction + `V074` ; héros ≠ `Num 1` `V053` ; `Ego ∈ {0, 5, 7}` → `die(héros, 35, V315)` « Meurs donc ! … vous serre brièvement le cou » ; `Ego 4` `V093` p4 ; sinon `V092` p3.

F5 (Minas comme indirect) :

* **prendre X à Minas** (6) : loin → réaction + `V008` p3 ; `Ego ∉ {0, 5, 7}` → `V093` p4 ; avec baguette → crapaud (idem) ; sans baguette → `V309` (ou `V093`).
* **parler** (24, `PREP = à`) : `Ego ∈ {0, 5, 7}` (sinon `V090` si 4 / `V092`) → Minas revient à `Ego 0`, `walkTo(Minas, héros)` et `say(V316)` « Que veux-tu, mortel, as-tu quelque présent pour Minas Thyl ? » (héros invisible : `V363` « Qui parle ? »).
* **donner X à Minas** (32) : héros invisible → `V364` « Inutile, elle ne vous voit pas ! » p4 ; `Ego` hors `{0, 5, 7}` → `V090` / `V092` ; Minas hors de portée → elle vient (`walkTo`) et `V317` « Approche-toi, mortel… » p4 ; sinon elle passe à `Ego 5` puis, selon `D.Num` : **304 (fiole de sang de dragon)** → `say(V372)` « Ma fiole de sang de dragon ! Tu me l'avais donc volée ? » puis, avec baguette, le héros devient crapaud (`V374`), sans baguette `die(héros, 35, V375)` ; **313 (émeraude)** `V318` ; **315 (boule de cristal)** `V320` ; **321 (talisman)** `V373` ; **6, 22, 108, 109 (clés)** `V325` « Les clefs sont toujours utiles… » ; autre objet : `Val ≥ 10` accepté, `V326` « Donne toujours, mortel, un trésor ne m'a jamais fait de tort » ; `Val < 10` **refusé** (`V327` « Et que veux-tu que je fasse de cet objet ? » p4, rien n'est pris) ; **320 (baguette)** : `+0x20 := 7`, première fois `V321` puis **le talisman** (`Num 321`, qu'elle porte) passe dans l'inventaire du héros, **`score(3, 1)`** (id 301, 20 pts) et `V323` « En échange de ma baguette je te donne ce Talisman » ; fois suivantes `V322` ; sans talisman `V324`. Dans tous les cas animation 45 (elle disparaît) et `Ego := 6`. Pour les cadeaux ordinaires, suit un second message : si `+0x20 = 0` `V319` « ce n'est pas ce que je t'ai demandé » sinon `V329`/`V328` selon qu'elle a ou non sa baguette ; le cadeau est ensuite rangé dans l'inventaire de Minas (`19dc:0000(Minas, D, 2)`). (certain)

### 4.21 `304` · la petite fiole (`fiole`, `elixir`, `sang`) · F1 `2b9d:0002`

États `Ego` : 0 sang de dragon (poison), 1 transformée (« élixir d'invisibilité »), 2 vide. Seul `boire` (34) : non tenue `V013` p3 ; `Ego 0` : héros `Num 1` (sinon `V053` p4), `die(héros, 35)`, `Ego := 2`, `say(V330)` « Gloup, gloup, gloup… sentez comme du feu » ; `Ego 1` : héros invisible (`219b:006c(héros, 7)`), **événement différé** `(héros, 1, compteur 2500, procédure 1002)`, `1793:0006(7)`, `Ego := 2`, `say(V331)` « Vous avalez d'un trait tout l'élixir d'invisibilité » ; `Ego 2` `V365` « La fiole est vide ! » p4. F8 `1002` (`2b9d:0102`) : fin de l'invisibilité (`219b:006c(héros, 0)`), `sayNear(V362)`. (certain)

### 4.22 `305` · le grimoire (`grimoire`, `livre`) · F1 `2b87:0008`

`Ego` 0 fermé, 1 ouvert. Verbes : `allumer` 1 → `V332` « Ce serait une grave erreur ! » ; `briser` 10 → `V334` ; `prendre` 6 → `V333` « Le grimoire de Minas Thyl appartient à Addanc » ; `utiliser` 31 → `V340` « Il suffit de le lire ! » (tous immédiats, succès 1) ; `ouvrir` 3 / `fermer` 4 : loin → réaction + `V008` p3 ; `Ego` déjà à la valeur → `V091` p4 ; sinon `setState(Ego, Fig)` ; `lire` 20 : loin → réaction + `V008` ; fermé `V335` p4 (couverture) ; sans baguette `V339` p4 ; avec la baguette (`Num 320` dans l'inventaire) : **`score(3, 5)`** (id 305, 10 pts) puis `V336..V338` tour à tour (compteur `+0x20 % 3`). (certain)

### 4.23 `308` · la planche · F1 `2bb1:000c`

États : 0 portée / sur le sol, 1 posée en travers du gouffre. `prendre` (6) et `arracher` (8) : tenue `V039` p3 ; `Ego 0` → 0 (prise standard) ; `Ego 1` : un autre objet sur `Sol 0x3F` → `say(V093)` ; héros sur `Sol 0x3F` (sur la planche) mais pas `Num 1` → `say(V053)` ; héros `Num 1` sur la planche → la reprendre le fait tomber (`planche.Ego := 0`, dans l'inventaire, `HERO.P += 8`, `25ea:03ca(héros, 8, V304)` « L'idée n'est pas tout à fait bonne, mais soit ! ») ; héros sur `Sol 0x3E` (au bout) → prise normale, `V015` ; ailleurs → réaction + `V008` p3. `mettre` / `jeter` / `utiliser` (15, 16, 30, 31), **seulement dans la salle 312 (`0x138`)** : non tenue `V013` p3 ; `HERO.Sol ≠ 0x3E` `say(V305)` « il faudrait vous en approcher » ; sinon planche dans la salle en `(209, 100, 40)`, `Ego := 1`, **`score(3, 2)`** (id 302, 20 pts), `say(V306)` « La planche repose désormais au-dessus du vide ». (probable)

### 4.24 `310` · la vanne · F1 `2bd6:0002`

Objet auxiliaire `Num 215` (requis). `ouvrir` 3 / `fermer` 4 : loin → réaction + `V008` p3 ; déjà dans l'état → `V091` p4 ; sinon `Num 215.Fig := vanne.Ego := (ouvrir ? 1 : 0)`, son `'B' 304`, `say(V301)` « …un bruit d'écoulement d'eau assez fort » / `say(V302)` « Non sans effort vous refermez la vieille vanne ». `arracher` (8), `briser` (10), `pousser` (19), `attaquer` (21), `tirer` (25) → `V303` « La vanne ne peut être que fermée ou ouverte. » p1. (certain)

### 4.25 `311` · le jambon (`jambon`, `gigot`) · F1 `2c14:000a`

`manger` (11) : non tenu `V024` p1 ; sinon `1a6b:0006` remplace le jambon par un **os** (`Num 330`, `Cod 2`, dans l'inventaire) et `say(V369)` « Merci… terriblement faim… Je vous rends l'os » (message prononcé par un tiers). (probable)

### 4.26 `315` · la boule de cristal (`boule`) · F1 `2bea:0008`, F5 `2bea:0230`

* F1 : `briser` (10), `attaquer` (21) : non tenue : hors de portée → réaction + `V074` p3, sinon `V013` p3 ; tenue : la boule est posée dans la salle (`19dc:0000`) et remplacée par des **éclats** (`Num 326`), `say(V347)` « Vous jetez la boule sur le sol où elle explose ». `mettre` / `jeter` / (30) : non tenue `V024` p3 ; `1469:0002(D)` vrai → succès ; sinon, **si le coussin (`Num 325`) est dans l'inventaire** : coussin et boule déposés dans la salle, boule posée sur le coussin (`P + 1`), `say(V348)` « Avec la plus grande prudence vous déposez délicatement la boule » ; sans coussin la boule se brise comme ci-dessus.
* F5 : `regarder` (5) avec `PREP = dans` : tenue → **`score(3, 10)`** (id 310, 10 pts), jingle, `say(V349)` « En regardant dans la boule de cristal je vois se former une image » ; non tenue `V024` p3. (probable)

### 4.27 `316`, `334` · la belle grille ouvragée et sa serrure · F1 `2c1e:0106`, `2cdc:0000`

Serrure `Num 334` (`22b7:0000`) : l'automate `Ego` est celui de la grille du cachot (0 fermée, 1 s'ouvre, 2 se ferme, 3 ouverte). Verbes 3 `ouvrir`, 4 `fermer`, 19 `pousser`. **Serrure hors de portée** : `ouvrir`/`fermer` → réaction sur la serrure + `V095` « Vous êtes trop loin de la serrure. » p3. `pousser` (sans condition sur la serrure) : grille hors de portée → réaction + `V008` p3, sinon `V096` « Ne soyez pas ridicule ! » p3. Serrure à portée : `ouvrir` : `Ego 0` → cible 1 ; `Ego 1, 2` → `V029` p1 ; `Ego 3` → `V091` p3 ; `fermer` : `Ego 3` → cible 2 ; `Ego 0` `V091` ; 1, 2 `V029`. Puis `PREP = avec` obligatoire (`V014` p1), indirect nommé (`V013` p1 sinon), tenu (`V024` p3), **clé `Num 331`** → `setState(grille, Gst 7, Mob 1, Ego = cible)`, son `'B' 305`, succès sans message ; autre clé `V082` p3 ; non-clé `V014` p3. `2cdc:0000` (serrure 334) redirige `ouvrir`/`fermer` sur la grille. `2c1e:02de` : prédicat « grille ouverte ». F2 `2c1e:0008` : fin du coulissement, **`score(3, 8)`** (id 308). (probable)

### 4.28 `317`, `324` · la herse de pierre (double) et sa serrure · F1 `2c4d:00a8`, `2c80:0000`

Mêmes règles, avec la serrure `Num 324` (`22b7:0000`/`21fb:0002`) et les **deux battants** (objets `Num 317` de la salle, `Fig` 63 et 64) : la **clef en or** (`Num 6`) manœuvre les deux battants simultanément (`ouvrir` : cible 1 si `Ego 0` ; `fermer` : cible 2 si `Ego 3`) ; `pousser` → `V096` ; loin → `V095` + réaction ; autre clé `V082`, non-clé `V014`. `2c4d:0312` : prédicat « herse ouverte ». `2c80:0000` (serrure 324) redirige `ouvrir`/`fermer` vers `2c4d:00a8`. F2 `2c4d:000c`. (probable)

### 4.29 `327` · le crapaud (`crapaud`, `grenouille`) · F1 `2d52:0496`, F5 `2d52:0620`

Objet créé par métamorphose (`2d52:06b0` : remplace un personnage par un crapaud `Num 327` en gardant son `Num` dans `+0x28`, son état dans `+0x24`, `playAnim(46)`). Verbes : `prendre` (6) `V341` « Quelle idée ! Sûrement pas !! » p4 ; `manger` (11) `V342` ; `nourrir` (12) `V094` p4 ; `attaquer`/`tuer` (21, 22) : à portée, détruit le crapaud et `say(V343)` « D'un grand coup de talon vous expédiez le crapaud » ; `embrasser` (37) et `aider` (38) : loin → réaction + `V074` ; héros `Num 1` à `Ego ≠ 0` `V093` p4 ; crapaud dont `+0x28 = 1` : `die(héros, 35, V344)` « Pouah ! Celui-là est venimeux » puis le héros part dans une direction au hasard (si le héros n'est pas `Num 1` : `V053` p4) ; sinon `playAnim(47, crapaud, Ego 2, V345)` « Avec un profond dégoût vous parvenez malgré tout à embrasser » (le crapaud se transforme). `+0x28` reçoit le `Num` de la créature métamorphosée par `2d52:06b0` : l'interprétation de la valeur 1 (créature issue de `Num 1`) est une hypothèse. F5 : `parler` (24, `PREP = à`) : réveille le crapaud (`Ego 1 → 0`), le héros marche vers lui (`walkTo`) et `say(V346)` « Le crapaud semble s'agiter. Il vous répond "crooaac croac" » ; autre verbe `V023` p4. F8 `2d52:07fe` (événement 8) : `Ego 1 → 0`. F9 `2d52:0838`. (probable)

### 4.30 `328` · la couronne inestimable (`couronne`) · F1 `2c83:0004`

Seule la prise, la pose et `porter` sont permises : verbes 5, 6, 15, 16 → 0 (standard) ; **`porter` (39)** : non tenue `V024` p3 ; héros ≠ `Num 1` `V053` ; `HERO.Ego ≠ 0` `V092` p4 ; sinon `4b53 := 0`, `4b50 := 0`, `4b51 := 6`, `27ed:0194` (replace la dalle `Num 104` : `Y := 139`, `setState`), **détruit tous les objets de type 2 mobiles ou animés** (monstres, PNJ), remplace le héros par un personnage `Num 333` « le roi » (poids 800, capacité 500, `1a6b:0006`) et lance l'animation 18 avec `V358` : c'est le **déclenchement de la fin du jeu** (couronnement). Autre verbe → `V385` « Que cherchez-vous à faire avec cette couronne ? » p4. (probable)

### 4.31 `332` · la bouteille (`bouteille`, `hydromel`, `potion`) · F1 `2c9c:000a`

États : 0 hydromel, 1 potion nauséeuse (après `tehrehanan`), 2 entamée, 3 vide. Seul `boire` (34) : non tenue `V013` p3 ; `HERO.Anm (+0x30) = 0x21` (en pleine animation) `V097` p4 ; `Ego 0` → bouteille à l'état 3, `say(V377)` « Gloup, gloup… Merci bien, cet hydromel » ; `Ego ∈ {1, 2}` : `event(héros, op 1 = ajouter, événement 0, compteur 400, procédure 1001)` ; `Ego 1 → 2` `V354` (potion infecte) / `2 → 3` `V383`, et le héros est **protégé de la lave** 400 tics (cumulables) ; la branche `V359` « Cet enchantement vous protège déjà ! » n'est atteinte que si l'ajout renvoie 0 (jamais en pratique, probable) ; `Ego 3` `V378` « la bouteille est vide ! ». F8 `1001` (`2c9c:00ee`) : `sayNear(V360)` « …vous protégeait des laves vient de prendre fin », et si le héros est sur `Sol 0x34` (lave) `die(héros, 33, V361)`. (certain)

### 4.32 Objets sans gestionnaire propre : les outils

Ces types n'ont **aucune** entrée en famille 1 ni 5 : seuls `regarder`, `prendre`, `mettre` / `jeter`, `fouiller`, `inventaire` s'appliquent (§3) ; leur rôle est celui d'**outil** testé par le gestionnaire de l'objet cible.

| Objet (`Num`) | Sert à |
|---|---|
| la petite clef en or (6) | stèle (`2500:026c`), herse (`2c4d:00a8`, deux battants) ; clé inadaptée pour coffre, poterne (`V220`), grille ouvragée |
| la vieille clef rouillée (22), la clef de bronze (109) | coffre de chêne (21), coffre de bronze (110) ; la bronze ouvre aussi la porte 111 |
| le trousseau de clefs (108) | coffre de fer (319), grille du cachot (103) |
| la clef ouvragée (331) | grille ouvragée (316), portes 309 et 329 (portée par le nain soldat) |
| le levier (11) | stèle (état 1) ; tombe des mains devant la poterne |
| la hache (206), l'épée d'orichalque (314) | poterne ; tuer un nain endormi (l'épée seule vient à bout du nain soldat) |
| le fouet (10) | ours, Prytwen, nains, Sarhûl (`fouetter`) |
| la baguette (320) | grimoire (`lire`), mots `tehrehanan` et `ezhrimanoth` ; rendue à Minas contre le talisman |
| le talisman (321) | mots `erin` et `sillerynn` |
| le seau (25), la fiole (304), la bouteille (332) | `sillerynn` (seau), `ezhrimanoth` (fiole), `tehrehanan` (bouteille) |
| le coussin (325), les éclats (326), l'os (330), le jambon (311) | coussin : pose de la boule ; éclats : débris de la boule ; os : reste du jambon ; jambon : Sarhûl |
| diadème (8), doublons (7), pépite (105), chaîne (106), chandelier (107), diamants (209), vaisselle (208), ducats (312), émeraude (313), lingot (322) | trésors (`Val` ≥ 10) : acceptés par le coffret (valeur ≥ 50) et par Minas Thyl |
| os / squelettes (2, 13, 14), nid / ruche (19, 24), pelle (26), bouclier (205), pichet (213), dague (214), chaudron (306), passerelle (318), trou (323) | décor ou accessoires sans règle propre (réponse du défaut `V023`/`V029`) |

## 5. Mots magiques (famille 6, classe 13)

Appelés avec `AX = 0` seulement ; le « verbe » est un nom propre (`armaeth` 13001, `tinhuel` 13002, `erin` 13003, `tehrehanan` 13004, `ezhrimanoth` 13005, `sillerynn` 13006). Tous renvoient 7 en cas d'effet, 0 sinon (certain).

| Clé | Mot | Gestionnaire | Effet |
|---:|---|---|---|
| 1 | `armaeth` | `3443:0008` → `3443:0028(0)` | **ferme la herse de granite** (`Num 207`) : uniquement dans les salles `0xCA` (202) et `0x131` (305) (sinon `V217` « Rien ne se produit… ! ») ; herse `Ego 3` (ouverte) → `say(V212)` « …commence à redescendre », `29fd:017a(herse, 0)` (Ego 2) ; `Ego 0` → `V211` « La herse est déjà refermée. » p3 ; `Ego 4` → `V213` « Les nains ont bloqué le mécanisme » p4 ; `Ego 1, 2` `V029` p3 |
| 2 | `tinhuel` | `3443:0018` → `3443:0028(7)` | **ouvre** la herse : `Ego 0` → compteur `+0x28` incrémenté, `V214` ou `V215` (aléatoire `1/compteur`) « Votre formule magique déclenche l'ouverture », `29fd:017a(herse, 7)` ; `Ego 3` → `V216` « La herse est déjà ouverte. » p3 ; `Ego 4` `V213` p4 ; `Ego 1, 2` `V029` p3 |
| 3 | `erin` | `3474:000c` | `erin <lieu de classe 19>` : un seul nom (sinon `V023` p0), de classe 19 ; le **talisman** (`Num 321`) doit être dans l'inventaire (`V386` p4) ; la salle d'identifiant = numéro du lieu doit exister (`gm_find_scene`, sinon `V387` p4) ; héros `Num 1` à `Ego 0`/`Fig 0` (sinon `say(V089)` « Songeriez-vous à partir ? Pas maintenant ! », immédiat) : `HERO+0x38 := lieu`, `die(héros, 18)` (« disparaître dans le néant »), `4b50 := 7`, `say(V086)` (même salle) ou `say(V087)` « Merveilleuse magie ! » ; autre personnage : `Inf := 6`, `Sal := lieu`, `19dc:0000(salle, héros, 1, 7)` direct |
| 4 | `tehrehanan` | `3454:000c` | exige la **baguette** (`Num 320`, `V353` p3 sinon) et la **bouteille** (`Num 332`, `V379` p3) : `Ego 0 → 1`, `V380` « Cette formule magique semble bien produire un effet », **`score(3, 12)`** (id 312, 30 pts) ; `Ego ∈ {1, 2}` `V381` ; `Ego 3` `V382` |
| 5 | `ezhrimanoth` | `346c:0008` | baguette (`V353`) et **fiole** (`Num 304`, `V351` « Qu'espérez-vous faire sans la fiole ? ») : `Ego 0 → 1` (direct), `V350` « Le contenu de la petite fiole se met à bouillonner », **`score(3, 11)`** (id 311, 30 pts) ; déjà fait `V352` |
| 6 | `sillerynn` | `345e:0004` | exige le talisman (`V384` p3 sinon) : le **seau** (`Num 25`) est remplacé par la **couronne** (`Num 328`, dans l'inventaire), **`score(3, 13)`** (id 313, 30 pts), jingle, `V355` « le petit seau se met à luire » ; sans seau : couronne déjà créée `V356` « vous ne pouvez pas créer de seconde couronne », sinon `V357` |

## 6. Procédures d'objet (familles 2 et 3, pointeurs)

### 6.1 Famille 3 (décors, clé = `Num` de décor `Typ 1`) (probable)

Procédures `Fct` des décors animés (la clé n'est **pas** le nom d'un objet) : `3` `343c:000e` (jour/nuit : `Fig` selon `197e:0272`, piste `'B' 2`), `5` `3426:000a` (image aléatoire, piste sonore selon l'éclairage, s'auto-détruit dans certains cas), `101` et `102` `341b:0008` (clignotement : 1 chance sur 4, minuterie 100), `104` `340f:000a` (image aléatoire, minuterie), `105` `340b:0006` (piste `'B' 104` à l'image 5), `301` `3416:000c` et `302` `3421:000e` (état et minuterie aléatoires), `304` `33ef:0004` (**geyser** : états `Fig` 0..2, mortel si le héros est à moins de 24 px et 10 de profondeur et à `Ego 0` : `die(héros, 32, V376)` « Ce geyser projette une grosse pierre brûlante »).

### 6.2 Famille 2 (`Fct` des objets de type 2) : renvoi

Clé → adresse : `0` `10c8:0006` (errance générique) ; `1` héros `246c:000a` ; `2` `2405:0106` (squelette animé, détruit en fin de cycle) ; `3` pie `2774:0004` ; `4` ours `26da:000e` ; `12` torche `2420:000e` (§4.4) ; `16` stèle `2500:0008` (§4.5) ; `18` feu `264c:0002` (durée `DGROUP:5264`) ; `20` ronces `257b:000a` (§4.8) ; `23` bulle « plouf » `2588:0006` (7 tics, `sayNear(V025)`, puis détruite) ; `101` Prytwen `28b1:0000` ; `103` grille `2846:000a` ; `104` dalle `27ed:000a` ; `201..204`, `301` nains `2a44:000c` ; `207` herse de granite `29fd:0000` (`score(2, 2)` id 202) ; `302` Sarhûl `2cdf:0004` ; `303` Minas `2dd9:0006` ; `316` grille `2c1e:0008` ; `317` herse `2c4d:000c` ; `327` crapaud `2d52:000e` ; `333` roi `2caf:000e` (`score(3, 7)` id 307). L'IA de chacun est dans `characters.md` ; la famille 7 (`1564:0004` curseur, `1537:000e`, `1611:000c`) dans `interface.md`.

## 7. Famille 9 : réactions (certain pour la structure)

Clé = **`Num` du héros contrôlé** (`2363:000c` lit `HERO.Num`), appelée avec le héros. Chaque entrée répond **vrai (7)** si l'état du personnage permet de partir vers l'objet, sinon affiche `V093` « Pas maintenant ! » (immédiat) et répond faux :

| Clé | Gestionnaire | Condition « disponible » |
|---:|---|---|
| 1 (Killian) | `2683:0000` | `Ego ∈ {0, 1, 8}` |
| 3 (pie) | `2774:045c` | `Ego ∈ {0, 1, 3, 4}` |
| 4 (ours) | `26da:0444` | `Ego ∈ {0, 1}` |
| 101 (Prytwen) | `28b1:1482` | `Ego ∈ {0, 4}` |
| 201-204, 301 (nains) | `2a44:13fa` | `Ego ∈ {0, 4}` |
| 302 (Sarhûl) | `2cdf:0706` | `Ego = 0` |
| 303 (Minas) | `2dd9:1570` | `Ego ∈ {0, 7}` |
| 327 (crapaud) | `2d52:0838` | `Ego ∈ {0, 7}` |

(Le héros peut être l'un de ces personnages après métamorphose : crapaud, voir §4.20 et §4.29 ; hypothèse sur les autres cas.)

## 8. Famille 8 : événements différés (probable)

Entrées `{Typ, Num, Ser, événement, compteur, procédure}` (`engine.md` §9.3). À l'échéance, `1ec8:000a(procédure, 8)` est appelée avec l'objet et l'événement en `AX`. Procédures :

| Clé | Gestionnaire | Événements et effet |
|---:|---|---|
| 1 | `2683:017a` (héros) | 2 : si le héros est dans la salle `0x130` (lave) à `Ego ≠ 6` → `die(héros, 35, G301)` ; 10 : si `Fig = 3` `sayNear(G9)` et programme l'événement 11 (compteur = `Tim`) ; 11 : si `Fig = 3` `die(héros, 2, G8)` |
| 4 | `26da:0800` (ours) | 9 : `Ego 0 → 1`, ré-armé à 24000 ; `Ego 1` : dans la salle chargée, ré-armé à 100 ; sinon remplace l'ours par sa **fourrure** (`Num 5`) et crée sa **carcasse** (`Num 15`) |
| 101 | `28b1:11e0` (Prytwen) | 6 : s'il est porté, le dépose ; sinon séquences de réveil / combat (`G103..G106`, animations 13-15, `die(héros, 1)`) ; 7 ; 14 : vol des poches (`G107`) ; détail dans `characters.md` |
| 103 | `2846:042c` (grille) | 15, 16, 17 : voir §4.10 |
| 104 | `27ed:01e0` (dalle) | 18 : lance le coulissement (`Ego` 0 → 1, sinon → 2 ; `Tim := 22`) ; `27ed:000a` le termine (3 ouvert / 0 fermé) |
| 201 | `2a44:12fc` (nains) | 3, 4 : réveil (`Ego ≥ 7 → 0`), `sayNear(G342)` |
| 303 | `2dd9:1440` (Minas) | 5 : sur la lave (`Sol 0x34`) → `2dd9:1510` : animation 36 |
| 327 | `2d52:07fe` (crapaud) | 8 : `Ego 1 → 0` |
| 1001 | `2c9c:00ee` | fin de la protection contre la lave (§4.31) |
| 1002 | `2b9d:0102` | fin de l'invisibilité (§4.21) |
| 1003 | `33ef:0192` | dans la salle `0x130` : redessin et ré-armement (événement 13, compteur 5) : cadence du geyser |
| 2000 | `21cc:008e` | affichage du titre de chapitre (événements 100..103) |
| 2001 | `1611:0256` | fond rebondissant (événements 200, 201) ; en fin `gm_cm_script_step(6)` |

## 9. Score attribué par ces gestionnaires

`2255:00e8(chapitre, indice)` : id = `chapitre × 100 + indice`. Chaque entrée n'est comptée **qu'une fois** (le signe de `points` est inversé ensuite ; les appels suivants ne rejouent que le jingle).

| Id | Points | Déclencheur |
|---:|---:|---|
| 0 | 5 | coffret : première valeur ≥ 50 posée dedans (`2566:000e`) |
| 1 | 5 | torche : première fois allumée (`2420:011e`) |
| 2 | 20 | stèle : débloquer la serrure à la clef en or (`2500:026c`) |
| 3 | 30 | stèle : fin du premier coulissement (`2500:0008`) |
| 4 | 20 | feu : nourri d'une torche (`264c:01ac`) |
| 5 | 20 | ronces coupées, stèle découverte (`257b:000a`) |
| 100 | 10 | attaquer Prytwen (`28b1:0b6e`) |
| 101, 102 | 40, 30 | Prytwen (`28b1:0000`, IA) |
| 104 | 10 | porter Prytwen assommé (`28b1:0b6e`) |
| 105 | 10 | passer la grille du cachot ouverte (`2846:042c`) |
| 106 | 40 | dalle / passage secret (`27ed:000a`) |
| 107, 108 | 5, 5 | nettoyer puis lire l'inscription (`2895:0004`) |
| 200 | 10 | poterne détruite à la hache (`2a1c:0004`) |
| 201 | 20 | lire le parchemin (`2a39:0006`) |
| 202 | 40 | herse de granite (`29fd:0000`) |
| 203 | 5 | prendre dans la niche (`2a3e:000c`) |
| 204, 205 | 10, 10 | nains (`2a44:000c`), arrivée en `147f:000a` |
| 300 | 40 | Minas (`2dd9:0006`) |
| 301 | 20 | rendre la baguette à Minas (`2dd9:0fd0`) |
| 302 | 20 | planche posée sur le gouffre (`2bb1:000c`) |
| 303, 304 | 20, 20 | `246c:034b`, `13a8:000a` (déplacements / terrain) |
| 305 | 10 | lire le grimoire à la baguette (`2b87:0008`) |
| 307, 308 | 50, 40 | roi (`2caf:000e`), grille (`2c1e:0008`) |
| 309 | 30 | `2a44:000c` |
| 310 | 10 | regarder dans la boule (`2bea:0230`) |
| 311, 312, 313 | 30, 30, 30 | `ezhrimanoth`, `tehrehanan`, `sillerynn` |
| 103, 306 | 0, 30 | non trouvés dans les gestionnaires étudiés |

Total 725 (`engine.md` §9.3).

## 10. Notes pour la réimplémentation

* Modéliser chaque objet statique comme un automate `(Ego, Fig, Gst, Mob)` ; **la description affichée est `30+Ego`/`Num`**, le dessin est `Fig`. Les gestionnaires ne changent jamais `Num`, sauf `1a6b:0006` (remplacement) et `19a6:01a5` (destruction).
* Implémenter d'abord la boucle §1.3 avec les trois étages (famille 5, famille 1, verbe) et le drapeau « désactiver le verbe » ; les gestionnaires deviennent des fonctions `(ctx) → 0 | 1` qui lisent `ctx.verb`, `ctx.prep`, `ctx.d`, `ctx.i`, `ctx.talk` et écrivent la file ou `say`.
* La **réaction** « marcher vers l'objet puis rejouer » (§1.5) est la mécanique de confort la plus visible : `prendre une clef lointaine` doit se terminer par la prise.
* Les tables de clés, serrures et portes (§2.4) se lisent dans `AM1.EXE` à `DGROUP:0676` (segment de données = fichier + `0x32D7 × 16`, en-tête `0x4000`).
* Les **priorités** de la file fixent quel refus l'emporte : p4 (clé erronée, fermé) > p3 (trop loin, non tenu) > p1 (« rien de tel ») > p0 (repli).
* `rand() % n` (modulo non corrigé) est utilisé par le fouet (1/5), `armaeth`/`tinhuel` (1/compteur), le crapaud (direction), voir `engine.md` §11.

## 11. Questions ouvertes

1. **Codes de `2363:01ea`** (1..5) et rôle exact de `Err` : quelle valeur de fin de marche rejoue la commande (1, 2, 4) ; à valider en jeu (`prendre` un objet lointain).
2. **Fonctions auxiliaires non lues** : `13e9:021c` (lâcher l'objet tenu), `1469:0002` (poser sur support), `219b:006c` (invisibilité), `2151:02a0` (cible d'errance), `246c:0240` (réaction au sol), `25ea:03ca`, `26ab:01fc` (IA du héros porteur), `2d52:06b0` (métamorphose en crapaud), `147f:0352` (entrée de scène) : rôle déduit de l'usage uniquement.
3. **Famille 3 et 8** : détail des séquences (Prytwen `28b1:11e0`, ours `26da:0800`, grille `2846:042c`) à confirmer ; la logique complète des IA relève de `characters.md`.
4. **Codes de `die`** (causes 1, 2, 18, 32, 33, 35) et messages `G…` associés : table non relevée.
5. **Direction de `Ver`** pour `monter`/`descendre` (§3.9) et pour la zone d'échelle (`Sol` 7..10, 23..26, 40..43).
6. **Table des portes** : positions des deux dernières lignes (`217d:0126`) et sens exact de la colonne « mot » (2 / 1 / 1).
7. **Branches « D absent »** (torche, bois, mettre) : jamais atteintes par la phrase tapée ; peut-être par `2210:0008` (clic) ; à vérifier.
8. **Effet exact de `Num 17` (`bois`)** comme source de torches et quantité illimitée ; valeur initiale de `Ego` des torches créées (8 : probable).
9. **Famille 9** : clé = `Num` du héros contrôlé ; les cas 3, 4, 101, 201.. supposent que le héros puisse être ces personnages (hypothèse) — quand le devient-il ?
10. **Score ids 103 et 306** : source non trouvée parmi les gestionnaires étudiés.

## 12. Corrections à reporter dans les autres documents

* *(reporté)* **`engine.md` §6.1, `Inv` +0x2F** : décrit comme « teinte (décalage de palette) ». Les gestionnaires et `219b:0000` montrent que `Inv ≠ 0` = objet **caché / invisible** (le héros invisible après l'élixir : `V364` « elle ne vous voit pas », `V363`). Corriger le libellé ; le miroir est bien `+0x44`.
* *(reporté)* **`engine.md` §6.1, `Ego` +0x2D** : « classe d'IA » seulement pour les objets à `Gst 7`. Pour les objets statiques c'est l'**état** (portes, coffres, grilles, torche, feu, nains…) et l'indice de la description `30+Ego` (`parser.md` §7.1) ; ajouter les sémantiques du §4.
* *(reporté)* **`parser.md` §6.4** : ajouter que les familles 1 et 5 ne sont appelées **que si au moins un objet est résolu** (`22fc:0432`) et que la clé est le nombre du nom, pas le `Num` d'un objet précis.
* *(reporté)* **`parser.md` §6.3, remarque 3** : la politique 2 passe à l'objet **indirect suivant** (pas au nom) ; aucun verbe ne la produit ; `fouiller` (`32f6`) n'est pas de politique 0 mais appelle le prologue de `regarder` (politique 3).
* *(reporté)* **`parser.md` §6.7** : la famille 9 est indexée par le `Num` du **héros contrôlé** et `2363:0154` fait **marcher le héros vers la cible** ; la commande est rejouée par `2363:01ea` (appelée par les `Fct` des acteurs). Remplacer « réaction des PNJ / monstres ».
* *(reporté)* **`parser.md` §8.4 (`mettre`/`jeter`)** : l'algorithme complet est au §3.4 ci-dessus ; `V040` n'appartient pas à `3340:0001` mais au gestionnaire du coffret (`2566:000e`).
* *(reporté)* **`parser.md` §8.6** : `3332:0004` se lit (§3.9) : cases d'échelle `Sol` 7..10, 23..26, 40..43 ; `lire` / `briser` / `zwygks` / `o` confirmés ; `zwygks` met dans l'inventaire **tous** les objets de ce type (§3.10).
* *(reporté)* **`parser.md` §9.2** : `armaeth` / `tinhuel` ferment / ouvrent la herse de granite (`Num 207`) dans les salles 202 et 305 ; `tehrehanan`, `ezhrimanoth`, `sillerynn` ont des préconditions et des scores précis (§5) ; plus de « hypothèse ».
* *(reporté)* **`parser.md` §8.2** : `regarder` : le code `6004` donne `V038` p1 ; sinon exact.
* *(reporté)* **`engine.md` §9.3** (événements différés) : ajouter les procédures de la famille 8 (§8) et les événements armés par les verbes : 15 (grille du cachot, compteur 2), 18 (dalle, 10), `1001` (lave, 400), `1002` (invisibilité, 2500).
* *(reporté)* **`parser.md` §6.4 (note sous la table des verbes)** : l'octet « de remplissage » avant `3371:000d`, `33b2:0007`, `3340:0001` est le `PUSH CX` du prologue (sonde de pile `CX = 10 ; CALL 3938:094e`) : les adresses de la table (`3371:000c`, `33b2:0006`, `3340:0000`) sont les **vraies entrées**.
* *(reporté)* **`re-index.md`** : renommer `1a37:0002/003a/007f` en `set_object_state` (Ego/Fig…), `1a6b:0006` en `replace_object`, `22fc:065b` en `disable_verb_handler`, `20ac:0060` en `can_carry`, `2363:000c/0154/01ea` en `arm_reaction / walk_to_target / replay_command`, `2255:00e8` en `award_score`.
