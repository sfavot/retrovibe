# The Incredible Machine 3 : le moteur de TIMWIN.EXE et le découpage du portage

Il n'existe aucune réimplémentation de TIM3 : ScummVM (`engines/dgds`) ne couvre pas la série TIM, et OpenTIM ne vise que TIM1 et TEMIM. **La référence de comportement est donc le binaire lui-même** (`TIMWIN.EXE`, PE32 Win32s, Borland C++ 1994, sans symboles), lu en statique, plus **OpenTIM** comme « pierre de Rosette » pour le noyau commun.

Le moteur reste comparable aux autres : un moteur sans tête qui tourne à pas fixe, et un hôte qui fait le lien avec le navigateur. La différence tient au cœur : ici, c'est une **simulation physique en virgule fixe**, pas un interpréteur de scripts.

Niveaux de certitude, comme dans `formats.md` : **vérifié** (lu dans le désassemblage et contrôlé par script, ou par les traces du banc Unicorn), **lu** (source externe), **supposé**. Les adresses sont celles de l'image chargée (base 0x400000). Les scripts d'étude sont hors dépôt (`scratchpad/tools-tim3/` : `pe.py`, `asmidx.py`, `q.py`, `rd.py`, `ptypes.py`) ; le code du jeu n'est exécuté que dans le banc Unicorn hors dépôt (D2).

## 1. Taille et répartition du code (vérifié)

| Zone (VA) | Contenu | Taille |
| --- | --- | --- |
| 0x410000–0x42a000 | fenêtres, dialogues, menus | ~100 Ko |
| **0x42a000–0x449000** | **jeu : simulation, pièces, éditeur, niveaux** | **127 Ko, 617 fonctions** |
| 0x449000–0x467400 | bibliothèques : GFX Dynamix (`GFXDevWinG`, `GFXBitmap`…), son HMI SOS, flux, RTL Borland | ~120 Ko |

La section CODE fait 356 Ko, soit environ 1 800 fonctions et 120 898 instructions. Les seuls imports sont KERNEL32, USER32, GDI32, COMDLG32 et WINMM (`timeGetTime`, `mciSendStringA`). WinG et SOS sont chargés à l'exécution.

**À réécrire pour la simulation** : environ 430 fonctions, 82 Ko de x86, ~26 000 instructions. Le noyau compte 79 fonctions et 21 Ko ; les handlers de pièces, 350 fonctions et 61 Ko, dont 40,5 Ko de code propre à un type. Ce total contient encore du dessin et du son ; la physique pure en représente sans doute 60 à 70 %.

## 2. Modèle : types de pièces et pièces (vérifié pour les offsets, supposé pour le sens)

La simulation est écrite en **C, sans vtable** : elle repose sur une **table de descripteurs de types** à `0x4733a0`, avec 281 entrées.
- Les types **0 à 148** sont les pièces de `INFO.RES`.
- Les types 149 à 280 sont des décors et des variantes.

**Descripteur de type**, 0x70 octets (**vérifié** : les 281 descripteurs construits par `engine/types.ts` sont identiques à ceux relevés dans le banc après le démarrage, test `tables.test.ts`) :
- +0x00 à +0x1C : **8 handlers**.
  - Slot 0 : acceptation d'un contact (appelé avec la pièce qui touche ; 434bf0 rend 1).
  - Slot 1 : « run », appelé à chaque pas.
  - Slot 2 : réinitialisation (polygone courant, angles des côtés).
  - Slot 3 : édition (retourner en X ou en Y, tourner) ; slot 4 : secondaire (redimensionnement des murs).
  - Slot 5 : réaction à une traction de corde (appelé par 43a31d, 43f050, 446f52, 4471d1 : `World.pull`) ; slot 6 : dessin.
  - Slot 7 : liens, et **initialisation du type** quand on l'appelle avec 0 au démarrage : 43c500 donne aux pentes 99 … 102 et 126 les polygones de la pente 2, 43c65c donne aux lasers 92 et 93 ceux du laser 91.
- +0x20 catégorie, +0x24 sommets par polygone, +0x28 / +0x2C / +0x30 drapeaux initiaux des pièces (+0x0C, +0x10, +0x14), +0x34 / +0x38 boîte de collision fixe.
- Depuis `PART%d.PAR` (**433b54**, mot n° entre parenthèses) : densité +0x4C (0), masse +0x50 (1 ; 0 → 1000), élasticité +0x54 (2), **frottement +0x58 (3)**, +0x60 (4, écrasé ensuite par la vitesse terminale), +0x44 / +0x48 (5, 6), +0x3C / +0x40 (7, 8), taille de la forme +0x64 / +0x68 (9, 10), drapeaux de forme (11), polygones `{flag, x, y}` (fin au bit 0x4000).
- Copies en miroir (434019) : drapeau 0x8 → x' = largeur − x − 1, 0x10 → y' = hauteur − y − 1, les deux → les deux ; les deux premiers modes inversent l'ordre des sommets. Pour les pentes, la largeur et la hauteur sont celles de l'image i de l'ANM avant le miroir du polygone i.
- Les décors 110 … 280 partagent deux descripteurs (0x476824, 0x476cf4) : chaque PAR lu les réécrit, le dernier l'emporte. Il faut garder ce partage.

**Pièce en mémoire**, 0x10C octets (0xA2 dans TEMIM) ; le détail des champs est dans `engine/part.ts` :
- +0x08 : type ; +0x0C, +0x10, +0x14 : drapeaux (+0x0C : 1 roule, 2 contact lourd, 4 contact mobile, 8 traitée, 0x40 déplacée dans le pas, 0x800 / 0x1000 / 0x2000 liste ; +0x10 : 0x10 / 0x20 retournée, 0x1000 touchée par un sommet, 0x2000 sortie ; +0x14 : 0x40 verrouillée, 0x800 gravité inversée, 0x1000 décor, 0x2000 mur, 0x4000 en attente).
- +0x18 image, +0x1C / +0x20 images précédentes.
- **+0x2C/+0x30 : position en 1/512 de pixel** ; +0x34/+0x38 en pixels ; +0x3C/+0x40 au pas précédent ; +0x44/+0x48 position de dessin.
- **+0x54/+0x58 : vitesse** ; +0x5C masse ; +0x60 quantité de mouvement.
- +0x64 forme, +0x6C image, +0x7C boîte de collision (largeur, hauteur).
- +0xD4 / +0xD8 : nombre de sommets et polygone (partagé avec le type, ou propre : murs) ; chaque sommet porte l'angle 16 bits du côté qui en part.
- +0xDC pièce en contact, +0xE0 / +0xE1 côtés touchés, +0xE2 angle du côté, +0xE4 indice.
- +0xE8 / +0xEC / +0xF0 / +0xF4 / +0xF8 : état d'édition (position, image, drapeaux) que 43ada7 recopie au démarrage.
- +0xFC / +0x104 : compteurs propres au type (rotation des balles…).

Listes chaînées (**vérifié** par les traces) :
- **0x48117c** : pièces statiques.
- **0x481184** : pièces mobiles.
- **0x4815f8** : liste auxiliaire.

**L'ordre d'insertion dans ces listes fait partie du comportement.** 4393e0 trie par masse du type croissante, puis, à masse égale, cordes d'abord, puis y décroissant, puis x décroissant (paniers : y croissant) ; les pièces au drapeau +0x14 & 0x1000 (décors) vont au bout, dans l'ordre du LEV. Les pièces non verrouillées partent au bac (0x48118c) dans 43267a.

## 3. Le pas de simulation (vérifié)

**4359a4** est la boucle « machine en marche ». Elle appelle `433334()`, met à jour l'image et le son, puis attend jusqu'à « attente précédente + 32 ms ». La simulation avance donc d'**un pas par image**, au plus à environ 31 Hz, **sans pas variable** : la physique ne dépend pas de l'horloge.

**433334** (666 octets) fait les passes suivantes, dans un ordre fixe :
1. Pièces statiques : effacement de flags, puis liste auxiliaire → slot 1.
2. 43aad1 (cordes et courroies, supposé) ; statiques avec le flag 0x800 → slot 1 ; **engrenages (14, 86)** → slot 1 ; autres statiques → slot 1.
3. Pièces mobiles : **cafetière (62)** → slot 1 ; puis, pour chaque mobile, **434221** (gravité et vitesse terminale).
4. Mobiles hors seaux → **4335ce** : déplacement (43428c), puis collisions (42bb02, **43a31d**).
5. **Seaux (17, 108)** à part : leur masse est celle du type plus celle de leur contenu.
6. Mobiles restants → **43373c** : pièces attachées (corde, courroie : 434382, 434652, 4347e3), puis slot 1.
7. **Lasers (91, 92, 93, 95)** → 43d013 ; puis mise à jour de la grille et de l'affichage.

C'est la même structure que `advance_parts` de TEMIM, d'après OpenTIM. Précisions (**vérifié**, `engine/step.ts`) :
- Les balles (0, 9, 28, 44, 68 ; 87 selon son image) n'appellent pas leur slot 1 dans 4335ce mais après la réponse au contact, dans 43373c (43be61).
- 4335ce : si la pièce touchée est mobile et n'a pas encore bougé dans ce pas, on annule, on la fait bouger d'abord, puis on recommence.
- 43373c : contact lourd (une des deux pièces au drapeau +0x10 & 0x8000, ou l'autre au +0x0C & 0x4000) → roulement 434382 si la pièce roule, sinon rebond 434652 ; contact mobile → choc 4347e3 (quantité de mouvement le long de la ligne des centres, coefficient 0xC0/256).
- Collisions (42bb02, `engine/collide.ts`) : chaque sommet de la pièce qui bouge décrit un segment de sa position précédente à sa position actuelle ; s'il coupe un côté de l'autre pièce (42be0c), elle est ramenée sur ce côté décalé d'un pixel vers l'extérieur ; puis les sommets de l'autre pièce contre ses côtés, à mouvement inversé (42c1d6). Le contact du pas précédent est testé en premier ; s'il continue la même pente (42b94f), la pièce passe en « roule ». Les positions fines sont ensuite recalées au bord du pixel dans le sens du mouvement.
- Après le pas, 43abff (43ac4f) recopie position, dessin, image et compteurs « courants » dans les champs « précédents ». Le banc relève l'état après ce point.
- État de départ (pas 0) : 43252d charge le LEV (431d3f, 43173e par pièce), remet tout à l'état d'édition (43ada7), range le bac (43267a) ; « Démarrer » refait 43ada7. Les extrémités de murs (435b14) ne servent qu'au dessin.

Le chargeur de niveau est **431d3f** :
- magic 0xACEF ;
- pression rangée en **0x481380**, gravité en **0x481384** ;
- valeurs par défaut 67 et 272, posées par 432bec.

## 4. Arithmétique (vérifié)

- **Aucune instruction en virgule flottante.** Les positions sont en **1/512 de pixel** (`sar 9`). La vitesse est en 1/512 de pixel par pas et s'ajoute telle quelle à la position (Euler explicite). Une pièce qui sort de [−1000, 2000] pixels est retirée.
- **Atmosphère** (4340b0, identique à `atmosphere.rs` d'OpenTIM) :
  - si g < 140 → g/4 + 1 ; si g > 278 → 2g ;
  - si p < 70 → p/2 ; sinon 16p.
- **Accélération** (4340ef) :
  - densité égale à celle de l'air → 0 ;
  - densité supérieure → `g − air·g/densité` ;
  - sinon `−(g − densité·g/air)`.
  - Les divisions sont entières (`idiv`, troncature vers 0). Les **produits sont 16×16 signés** (413808 : opérandes tronqués à 16 bits).
  - Contrôle : la boule de bowling, aux réglages par défaut, accélère de **269** (**vérifié** dans le banc).
- **Vitesse terminale** : `0x2600 − air` (9 695, **vérifié** dans le banc) ; **0x3000** pour la balle de phazer (20) et le boulet (43).
  - Accélération forcée à 0 pour les types 20, 32, 33, 63, 79 et 109.
  - Quantité de mouvement (+0x60) : `mul16(|vx| + |vy| sur 16 bits, masse)`. Une pièce qui roule est collée au sol de ±0x400 à chaque déplacement (43428c), qui efface aussi le bit de gravité inversée.
  - Le bit 0x08 de +0x15 inverse la gravité.
  - La balle programmable (87) a sa propre accélération.
  - Une pièce posée reste collée au sol à ±0x400 près.
- **Trigonométrie** :
  - **table cosinus Q14 de 2 049 entrées sur [0, π]** (0x470230) ;
  - table d'arctangente (0x471234) ;
  - angles sur 16 bits.
  - Même format qu'OpenTIM.
- **Hasard (correction)** : il y a bien un générateur pseudo-aléatoire, **4520a4**, un Fibonacci additif retardé sur une table de 56 mots (0x47961c, indices 0x479614 / 0x479618), sans constante de congruence (d'où l'oubli). Il est appelé par des handlers (chat, Mel, chauve-souris, mandrill, flipper, lampe d'Aladdin, cisailles…) et par l'interface (419803, 422e31, 4241ae). Il n'est jamais réamorcé par l'horloge (4520fc n'a pas d'appelant) : à état initial égal, la **simulation est déterministe (vérifié)**. Dans le jeu, l'état au début d'un puzzle dépend des appels faits par l'interface avant ; le banc et le portage partent de la table de l'exe (`engine/random.ts`).

**Règle du portage** : uniquement des entiers 32 bits (`Math.imul`, `| 0`, `Math.trunc` pour `idiv`, `>>` pour `sar`), et des helpers nommés `mul16`, `idiv` et `sar` dans `engine/fixed.ts`, testés contre des valeurs relevées dans l'exe. Aucun `number` flottant dans l'état de la simulation.

## 5. Familles de pièces, de la plus simple à la plus dure

| Famille | Exemples | Code propre | Difficulté |
| --- | --- | --- | --- |
| Murs, pentes, décors | briques, tuyaux, pentes | aucun (noyau + polygones) | faible |
| Balles, corps rigides | bowling, basket, tennis, ballon de plage, balle programmable | noyau ; **collision et rebond** (42bb02, 43a31d) | faible pour le noyau, **élevée pour la collision** |
| Électricité, lasers | interrupteurs, prises, générateurs, lasers, miroirs | logique discrète + lancer de rayon (43d013) | moyenne |
| Rotation | moteurs, engrenages, courroies, convoyeurs, Trans-Roto-Matic | passes dédiées, propagation | moyenne à élevée |
| Couplages de masses | cordes, poulies, seaux, bascules, ballons | cas à part dans 433334, flèche des cordes | élevée |
| Animaux et personnages | chat (1,6 Ko), Mel (1,6 Ko), souris, mandrill, alligator | machines à états liées aux images ANM | longue, mécanique |
| Création et destruction | explosions, fusées, feux d'artifice, canon | pièces créées ou retirées en cours de pas | élevée (ordre des listes) |

Environ 100 des 149 types ont du code propre (`dis/pertype_size.txt`). Les **handlers lisent les images et les états d'animation** : les ANM font donc partie du moteur, pas seulement du rendu.

## 6. Références

- **OpenTIM** (GPL-3.0, Rust et C, cible TIM1 et TEMIM) est compatible avec la licence du dépôt. On le **lit et on le traduit avec attribution**, comme ScummVM ailleurs. Ce qu'on en tire :
  - `structures/` : la pièce TEMIM, les types 0 à 0x41, les cordes, les courroies ;
  - `src/atmosphere.rs`, `math.rs`, `tim_c.rs` : la flèche des cordes (256 sections au plus) et les courroies ;
  - `src/parts/mod.rs` et `c_src/main.c` : pas encore lus.
  - Il faut l'adapter aux offsets de TIM3 et y ajouter les pièces nouvelles (balle programmable, lasers, seaux qui fuient, Trans-Roto-Matic…).
- **timgres** (CC0) documente le format des LEV de TIM2 et TIM3 (voir `formats.md`).
- **TIM1 DOS** (fourni, `TIM.EXE` compressé en LZEXE, 16 bits) appartient à la même lignée : mêmes constantes, numéros 0 à 65 alignés. Il n'est **pas utile comme banc**, car l'exe de TIM3 et OpenTIM couvrent déjà le noyau commun. Il n'est pas porté.

## 6 bis. Portage (vague Φ1, état)

- Noyau dans `src/games/tim3/engine/` : `fixed.ts`, `tables.ts`, `random.ts`, `types.ts`, `part.ts`, `lists.ts`, `world.ts`, `gravity.ts`, `move.ts`, `collide.ts`, `bounce.ts` (réponses aux contacts), `step.ts`, `trace.ts` ; handlers par adresse dans `engine/parts/registry.ts`, familles dans `engine/parts/<famille>/` (`core`, `balls`, `walls`, `slopes`). Tables tirées de l'exe par `scripts/tim3/gen-tables.py` (D13).
- **Traces identiques au banc** (600 pas, tous les champs du format v1) : les 206 scénarios « balles, murs, pentes, décors » (un par niveau, `bench.py trace N --keep …` avec les types 0, 1, 2, 9, 28, 43, 44, 46, 48, 56, 60, 63, 68, 82 … 85, 99 … 106, 110 … 115, 118, 121 … 135, 140 … 147, 149 … 280) et 25 niveaux complets sur 206 (dont TLEV2, ELEV4, ELEV13, ELEV15, MLEV29, MLEV30, HLEV24, RLEV25 et 17 HH). `TIM3_TRACES_ALL=1 npx vitest run test/tim3/engine/traces.test.ts` compare aussi les niveaux qui attendent Φ2.
- Ce qui attendait Φ2 côté noyau est porté (groupe `mechanics`, voir ci-dessous) ; restent aux familles : panneau solaire 38, slot 1 des lasers (43c6de, 43c986) et handlers du mélangeur 95 (`electric`).

### Vague Φ2, groupe `mechanics` (état)

- **Types portés** (`engine/parts/mechanics/`) : cordes et câbles 10, 76, poulie 7, bout de corde 49 (`rope.ts`), courroie 8 (`belt.ts`), seaux 17, 108 (`bucket.ts`), bascules 3, 139 (`seesaw.ts`), taquet 23 (`cleat.ts`), engrenages 14, 86 (`gears.ts`), tapis 5 (`conveyor.ts`), moteur à souris 6 (`motors.ts`), moteur électrique 50 et aspirateur 51 (`electric-motors.ts`), cafetière 62 (`coffee.ts`), pompe 16, ventilateur 24, moulinet 40 (`air.ts`), générateur 26 (`generator.ts`), Trans-Roto-Matic 89, 90 et mixeur 107 (`trm.ts`), noyau du laser (`laser.ts` : 43c65c, 43c88a, 43ce78, 43d013, 43d43e).
- **Noyau** : chargeur générique des liens du LEV (43173e : courroie, deux cordes, liens +0x90 … +0xA4, corde de poulie, +0xD0 des fiches, slot 7 des lasers) ; rangement au bac (43267a / 42f978 / 43925f : cordes, courroies, branchements et poulies détachés, pièces corde et courroie au bac : c'est ainsi que les cordes « hors de l'aire » disparaissent des listes) ; ordre du bac (417133, table `data/tables/bin-order.ts` générée) ; liste auxiliaire 0x4815f8 (nœuds {pièce, effort}, 43ab07 `World.auxInsert`) ; 439695 (`World.redraw` : octet +0x28 et extrémités des cordes) et la dernière boucle de 433334 ; décompte de +0x28 après le pas (4309a6, 42d2e6) ; recopie des cordes dans 43ac4f ; tension 43a31d ; seaux 43518f, 43ab9a, 435309.
- **Mesures** (banc v1, 600 pas) : scénarios `-mech` (types Φ1 + `mechanics`, un par niveau qui en contient : 109) **109 / 109 identiques** ; les 206 scénarios Φ1 restent identiques ; niveaux complets **187 / 206** identiques (`TIM3_TRACES_ALL=1`). Les 19 autres attendent le panneau solaire 38 (12) ou le slot 1 des lasers / le mélangeur 95 (7).
- **API pour les autres groupes** :
  - `Part` : `ropes: [RopeData | null, RopeData | null]` (+0xA8/+0xAC ; `RopeData` : `ropePart`, `end1`, `end2`, `slot1`, `slot2`, `n18`, `ends`, `prevEnds`…), `belt: BeltData | null` (+0x84), `ropeAnchor` (Int8Array de 12 : +0xB0 … +0xBB ; points 0, 1 : cordes ; 4 : +0xB8), `fC8`, `fCC` (434cc4), `beam` (tampon du faisceau +0x90).
  - Slot 5, signature unique : `fn(world, target, puller, slot, flags, mass, force)` ; appel par `world.pull(puller, target, flags, mass, force, slot)`.
  - `World` : `auxInsert`, `redraw(part, n)` (à appeler là où l'exe appelle 439695), `callType`, `special(adresse, pièce, arg)`, `running`, `sound(id, part, priorité, drapeaux)` / `stopSound` avec les crochets `onSound` / `onStopSound`, comptes à rebours globaux (`pinballTimer` = 120, `rocketTimer`, `lampTimer`, `mouseIdleTimer`, `cleatTimer`, `catTimer`, `newtonMouseTimer`, `mandrillTimer`, `trimmerTimer`), `resizeHandle` (0x4815b4).
  - `engine/zone.ts` : `boxScan` (434eff), `imageScan` (434cc4, écarts en +0xC8/+0xCC), `hotspotScan` (4350e6), `usesBox` (434ec6 → spéciales 43f92f, 440058, 443c19), `wakeInBeam` (43beb8), `recyclePart` / `createPart` (432d00), `newPart` (432d78), `insertCreated`, `addMobile`, `placeAt`, `clonePart` (439830) ; `bounce.ts` exporte `centreAngle` (43712c) ; `TypeAnim.stateFirst` (44b2c0).
  - `parts/mechanics` : `traceBeam(world, laser, direction)` (43ce78, pour les slots des lasers et du mélangeur), `cutRopes` (442af6), `otherBeltEnd` (439f44), `ropeFlags` (439f67), `polygonScan` (434fab), spéciales `0x43f907` (démarrage du moteur à souris) et `0x43d013`.
- **Écart volontaire** : 434fab (bascule qui lance les pièces posées) lit le polygone d'une pièce sans polygone dans un registre non initialisé quand celle-ci est la première des mobiles (cheville 72 créée en marche, solution de RLEV22) : l'exe prend alors les octets de la bascule (pointeurs du tas, propres à l'allocateur). Le moteur ignore la pièce sans polygone (comportement déterministe) ; RLEV22 reste réussi au même pas que le banc (777), la trace en diffère à partir du pas 145.
- **Écarts connus / non portés** : 438b1b (image d'une poulie voisine quand une poulie est rangée au bac, journalisé) ; 43d59c et suivantes (appelées par d'autres types que les lasers) ; dessin des cordes et courroies (vague R) ; 0x481580 supposé nul.

## 7. Vérification du comportement

Il n'y a pas de banc ScummVM. Les méthodes possibles, de la plus utile à la moins utile :

1. **Émulation du processeur avec Unicorn (Python, hors dépôt)**.
   - Principe : charger `TIMWIN.EXE` à son adresse de base et simuler la trentaine d'imports atteints (fichiers redirigés vers les ressources extraites, dessin et son neutralisés). On appelle ensuite l'initialisation (433b13), le chargeur de niveau (431d3f), puis le pas de simulation 433334 en boucle, et on relève chaque pièce à chaque pas.
   - Ce que ça donne : des **traces exactes au bit près**, sans écran, sur les 206 niveaux et sur des scénarios minimaux (une balle, une corde, deux engrenages…).
   - Coût : un chargeur PE et des stubs.
   - **Cela exécute le code du jeu dans un émulateur : il faut l'accord de l'utilisatrice (D2).**
2. **Wine + winedbg**.
   - Principe : point d'arrêt à 0x4359eb (retour du pas), lecture des listes. `TIMWIN` est un PE32 qui n'a pas besoin de Win32s.
   - Ce que ça donne : la vérité du jeu complet, interface comprise.
   - Limites : difficile à scripter sur des milliers de pas, instable sous Rosetta. Utile en contrôle ponctuel (interface, cadence, son).
3. **Lecture statique seule + tests de propriétés**.
   - Exemples de tests : 269 et 9 695, déterminisme, équivalence avec les constantes d'OpenTIM.
   - Complément : des **tests de bout en bout « le puzzle est résolu »** à partir des solutions du jeu (`SOLVE.RES`, `BINSOLVE.RES`, bloc solution des LEV).
   - Limite : les divergences fines (arrondis, ordre des passes) restent invisibles tant qu'un puzzle ne diverge pas.
4. **Captures ou vidéos** : contrôle visuel d'ensemble à ±1 pixel près.
5. DOSBox-X + Windows 3.11 + Win32s : **écarté** (pas de média Windows, Win32s instable).

**Format de trace commun** au banc et au moteur TypeScript, une ligne par pièce et par pas : `pas, index dans la liste, type, x, y (1/512), vx, vy, flags, état`. Le test compare au premier écart et affiche le contexte : passe, pièce, valeur attendue et valeur obtenue. Les traces de référence restent **locales**, dans `test/tim3/traces/`, non versionné ; les tests sont ignorés si elles sont absentes.

## 8. Interface d'origine (lu dans les ressources, à détailler en vague U)

L'écran fait 640×480 en 8 bits et l'aire de jeu 568×378 (`TIMWIN.INI`). L'interface comprend :
- le bac de pièces à droite, avec glisser-déposer ;
- les boutons de retournement en X et en Y, et de taille + et − ;
- le lien des cordes et des courroies ;
- Démarrer et Arrêter ;
- le but et les indices du professeur, avec sa voix et la synchronisation des lèvres ;
- les menus du jeu : choix du puzzle par niveau, Labo (« Professor Tim's Workshop », mode libre avec réglage de la gravité, de la pression, du fond et de la musique), options.

Les bitmaps d'interface sont dans `RESOURCE.001` et dans `FRENCH.DAT` pour celles qui contiennent du texte. Les `ITF` décrivent probablement les zones d'interface (supposé). Ces menus sont de l'interface Windows en partie (dialogues de l'exe, zone 0x410000) : ce qui n'est pas dessiné par le jeu sera refait en DOM (D7).

## 9. Découpage en dossiers

```
src/games/tim3/
  data/     volume Dynamix (map, .00x, .DAT de langue), LZW et RLE, BMP v1000 et DGDS, palettes, ANM, ITF,
            polices FNT et PFT, LEVELS.INF, LEV, PAR, textes (Windows-1252), archives VOC, WAV, solutions
  engine/   fixed.ts (arithmétique exacte), tables.ts (cosinus, arctangente), types.ts (descripteurs),
            part.ts (état d'une pièce), lists.ts, world.ts (niveau chargé), step.ts (433334),
            gravity.ts, move.ts, collide.ts, attach.ts (cordes, courroies, poulies), buckets.ts, lasers.ts,
            parts/<famille>/*.ts (handlers par type), trace.ts, editor.ts (placement, retournement, taille, liens),
            goals.ts (conditions de victoire), session.ts (puzzle et Labo), save.ts
  render/   aire de jeu, pièces animées, cordes et courroies, interface dessinée, curseurs
  audio/    musique HMI → spessasynth, effets WAV, voix (VoiceBank), synchronisation des lèvres
  ui/       app (mountGameShell), hôte, pointeur (glisser-déposer, toucher), menus DOM, saves, copy.ts, title, help
```

Les familles de `engine/parts/` forment des **groupes indépendants** pour les sous-agents (vague Φ2). Chaque groupe ne modifie que son dossier et signale tout besoin dans le noyau.

## 10. Ce qui se teste sans navigateur

- Lecteurs : chaque ressource lue jusqu'au dernier octet ; chaque LEV relu et réécrit à l'identique ; images comparées à des sommes de contrôle.
- Arithmétique : `fixed.ts` contre des valeurs relevées dans l'exe ; tables identiques octet pour octet à celles de l'exe.
- Physique : scénarios minimaux et 206 niveaux comparés aux traces du banc (si D2) ; propriétés (déterminisme, pas de dérive après sauvegarde et reprise).
- Bout en bout : chaque puzzle chargé avec sa solution, mis en marche, puis **condition de victoire atteinte** dans le nombre de pas attendu.
- Éditeur : placement, chevauchements refusés, retournement, taille, liens corde, courroie et poulie, pièces fixes non déplaçables.
- Sauvegardes : aller-retour d'une machine du Labo et de la progression.
