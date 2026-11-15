# TIM3 : famille « pyro » (vague Φ2)

Code : `src/games/tim3/engine/parts/pyro/` (`kernel.ts` fonctions partagées, `explosives.ts`, `flames.ts`, `launchers.ts`, `flyers.ts`) ; tests : `test/tim3/engine/parts/pyro.test.ts`. Niveaux de certitude comme dans `engine.md` : **vérifié** (comparé au banc), **lu** (désassemblage seul). Chaque fonction traduite porte son adresse dans son commentaire. OpenTIM (TEMIM) n'a que la dynamite et l'explosion (`src/parts/mod.rs`) ; le reste vient du seul désassemblage.

## État par type

| Type | Handlers (slot adresse) | État |
| --- | --- | --- |
| 18 canon | 1 4407d3, 2 440718, 3 4408dc | porté, **vérifié** (tir du boulet 43 dans les mobiles) |
| 19 dynamite | 0 440974, 1 4409d0, 2 440994, 3 440a20 | porté, **vérifié** (mèche, explosion 440a51) |
| 36 fusée | 1 442458, 2 4425e4, 3 4426ee | porté, **vérifié** (repos animé au hasard, poussée, flamme) |
| 41 explosion | 1 443354 | porté, **vérifié** (souffle, murs percés ou coupés en deux) |
| 45 lampe d'Aladdin | 1 443cad, 2 443c48 | porté, **vérifié** |
| 55 explosifs télécommandés | 0 444b60, 1 444ba0, 2 444b80 | porté, **vérifié** (déclenchés par +0x24) |
| 70 missile | 0 4458f8, 1 445944, 2 445a89, 3 445b6f | porté, **vérifié** (quatre explosions au contact) |
| 73 trappe | 0 445e0c, 1 445eef, 2 445e61, 3 445eb7 | porté, **vérifié** (ouverture ; poussée des mobiles posés **lue**) |
| 74 nitroglycérine | 0 445f70, 1 445f8a, 2 445ff4 | porté, **vérifié** (explose au choc) |
| 75 allumette à ressort | 1 44611c, 2 446094, 3 4462ab, 5 4462ee | porté ; repos **vérifié**, allumage et passage de la corde à une cheville (72) **lus** |
| 78 silex et amadou | 0 446384, 1 44640f, 2 4463b0 | porté, **vérifié** |
| 79 montgolfière | 0 44649c, 1 446555, 2 4464bc, 5 44670a | porté, **vérifié** (brûleur, crevaison) ; lâcher de corde et slot 5 **lus** |
| 80 feux d'artifice | 1 446849, 2 44676c | porté, **vérifié** |
| 109 dirigeable | 0 447a78, 1 4478c6, 2 447810 | porté, **vérifié** (vol, demi-tour, feu, explosion) |
| 138 bougie | 1 4487e5, 2 448798 | porté, **vérifié** |

Slot 3 (édition) : porté mais pas tracé (éditeur, vague U) ; les appels d'affichage et 439695 (rafraîchissement des cordes et courroies attachées) sont laissés à l'éditeur. Slot 6 (dessin) : défaut 42deab. Aucun de ces types n'a de slot 7.

## Fonctions partagées (`kernel.ts`)

- **Feu, 43beb8** (`flame`, exportée) : 4350e6 allume (+0x24 = 1) les pièces inflammables (+0x14 & 4) dont le point de mise à feu (+0xB8, `ropeAnchor[8..9]`) tombe dans le rectangle ; puis 434eff agit sur les mobiles dont la boîte le recoupe : cafetière 62 et ballon 4 (+0x24 = 1), chat 12 (saut, états 4 ou 14), nitroglycérine 74 (explose), dirigeable 109 (+0x24 = 2). Les chaînes passent par +0xC4 (`bucketNext`), comme dans l'exe.
- **Voisins, 434cc4** (`nearby`, exportée) : rectangle d'image (ou boîte pour 6, 12, 42 selon leur image : 434ec6), écarts relevés en +0xC8 / +0xCC.
- **Explosion** : le souffle (443354, à l'image 1) projette les mobiles (force selon la masse, 4434f3 ; direction 43712c ; 43a28f), allume ballon, montgolfière et dirigeable, fait exploser nitroglycérine et dynamite ; sur les statiques : explosifs télécommandés, murs 1, 48, 60, 83, 85, 125 percés d'un trou de 64 px aligné sur 16 px (443569 : raccourcis, coupés en deux par une copie 439830, ou détruits ; seule la position en pixels change, +0x2C/+0x30 restent), aquarium 15 cassé (440454), moteur à souris 6 lancé (43f907).
- **Création en cours de pas** : 432d00 (recyclage d'une pièce créée puis détruite du même type dans les mobiles, sinon 432d78), 432c1c (descripteur, position d'édition −1, slot 7, slot 2, géométrie), insertion triée 4393e0 (`insertSorted`, chargement = 0 : la position d'édition −1 compte dans le tri), drapeau +0x0C & 0x10 (retirées par 43ada7 au redémarrage). Les pièces créées et détruites restent dans les listes (tracées, ignorées par le pas).
- **Caches de l'exe** : les globales écrites au premier slot 2 d'un type (0x481dbc…, 0x481618…, 0x481f4c…) sont des fonctions pures de l'ANM (44b2c0, `stateFrame`) : recalculées à la demande. Les comptes à rebours 0x477fe4 (fusées) et 0x4780bc (lampes), 120 dans l'image de l'exe et partagés par toutes les pièces du type, sont gardés par monde ; ils tirent le hasard (4520a4) comme le flipper.
- **Convention slot 0** : l'exe passe la pièce qui touche et relit la touchée par +0xDC ; ici `part` = touchée, `arg` = toucheuse (absente quand 43373c appelle le slot 0 du dirigeable sur lui-même).
- **Slot 5** (75, 79) : signature de `World.pull` (pièce, tireur, emplacement, drapeaux, masse, effort).

## Besoins de noyau (à `mechanics`)

1. **Création et destruction de pièces en cours de pas** : 432d00, 432d78, 432c1c, 439830 (copie) vivent dans `pyro/kernel.ts` (`recyclePart`, `newPart`, `insertCreated`, `clonePart`), et en double dans d'autres groupes (`creatures/kernel.ts`, `electric/zone.ts`). À regrouper dans le noyau. Points d'exactitude :
   - 4393be (décrochage de la pièce recyclée) ne met pas à jour la tête de liste : si la pièce recyclée est la tête des mobiles, l'exe corrompt la liste ; on reproduit et on le note (`World.note`), jamais rencontré ;
   - **pool de 150 pièces** (0x481000, 432a78) : l'exe ne crée plus rien quand il est vide ; `newPart` ne compte pas (aucun scénario n'en approche).
2. **Recherches de voisins et feu** (434cc4, 434eff, 4350e6, 43beb8, 434ec6) : exportées par `pyro` (`nearby`, `flame`) ; d'autres groupes ont leurs copies, à regrouper.
3. **43712c** (angle entre centres) n'est pas exportée de `bounce.ts` : copie locale `centreAngle` dans `kernel.ts`, à remplacer par l'export.
4. **44b2c0 / 44b19c** : chaque groupe a son `stateFrame` / `stateFirst` ; une méthode `TypeAnim.stateFirst(n)` du noyau suffirait.
5. **Comptes à rebours globaux** 0x477fe4 et 0x4780bc : tenus par monde dans `kernel.ts` (`pyroGlobals`) ; pourraient rejoindre `World` à côté de `pinballTimer`.
6. **Écart du noyau trouvé** : `World.pinballTimer` vaut 78, mais 0x477d00 vaut **120** (0x78) dans l'image de l'exe. Visible en v2 (image +0x18 du flipper 43, dont le boulet de canon) : premier clignotement au pas 40 de TLEV15 au lieu de 26 ; l'ordre des tirages du hasard en dépend aussi. Avec 120, les 52 scénarios pyro sont identiques jusqu'à l'image du flipper.
7. **Créations qui dépendent d'autres groupes** : bout de corde 49 (slot 7 43e715, mechanics) pour la montgolfière, cheville 72 (slot 2 445d52, misc) pour l'allumette, murs (slot 2 43e8cc, walls) pour le souffle ; ces trois sont enregistrés.

## Scénarios comparés au banc

Traces v2 locales dans `test/tim3/traces/pyro/` (non versionnées), 600 pas, comparées sur les champs v1, la masse, et l'image +0x18 et le compteur +0x104 des types de la famille. Types conservés : ceux de Φ1 (balles, murs, pentes, décors) plus ceux du scénario.

- **Niveaux d'origine** (`bench.py trace <NIVEAU> --keep <Φ1>,<types> --format v2`) : 30 scénarios (ELEV2, ELEV8, ELEV11, ELEV17, ELEV19, ELEV21, HH6, HH11, HH26, HH38, HH41, HLEV1, HLEV19, HLEV23, HLEV29, MLEV3, MLEV5, MLEV17, MLEV23, MLEV24, RLEV13, TLEV8 … TLEV16, TLEV25). En marche libre, seuls la nitroglycérine (chute), le dirigeable et le repos animé des fusées et lampes agissent.
- **Niveaux allumés** : le même niveau avec +0x0A de l'enregistrement (+0x24 au départ) mis à 1 (ou 2 : crevé, explosé) pour des types choisis (`LIT` dans le test). `TIM3_PYRO_WRITE_LEV=<dossier> npx vitest run test/tim3/engine/parts/pyro.test.ts` écrit les LEV, puis `bench.py trace --lev <dossier>/<NOM>.LEV --keep … --format v2`. 22 scénarios : tirs de canon, fusées, missiles et feux d'artifice, mèches de dynamite, explosifs télécommandés, trappes, montgolfières et dirigeables crevés ou en feu, bougies, lampes et silex allumés ; explosions en chaîne et murs coupés en deux (TLEV9F, HLEV1F, ELEV21F).
- Résultat : **52 scénarios sur 52 identiques au banc**.
- **Niveaux complets** (traces v1 de `test/tim3/traces/`) qui contiennent un type pyro : 97 identiques sur 118 ; les 21 autres attendent des types d'autres groupes (16, 23, 26, 38, 50, 89 … 95, 107…), dont MLEV7 (écart sur la fusée au pas 15, avec un laser 93 et un moteur 50 non portés).

## Non vérifié

- Allumette allumée : la détente fait passer la corde à une cheville ; sans corde, l'exe plante (lecture à +4 d'un bloc nul), donc pas de scénario sans les cordes (mechanics). Montgolfière crevée avec corde (bout de corde 49) : idem.
- Trappe : la poussée des mobiles posés (434cc4, +0x800) n'a pas de mobile posé dans les scénarios.
- Canon dont l'image n'est aucune des six orientations : l'exe lit un registre non initialisé ; le port prend l'orientation 0 et le note.
- 435b14 après une explosion (extrémités de murs, +0x104 des murs) : dessin, non porté.
