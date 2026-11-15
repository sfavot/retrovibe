# TIM3 : famille « electric » (vague Φ2)

Code : `src/games/tim3/engine/parts/electric/` (`switches.ts`, `lamps.ts`, `zone.ts`, `support.ts`) ; tests : `test/tim3/engine/parts/electric.test.ts`. Niveaux de certitude comme dans `engine.md` : **vérifié** (comparé au banc), **lu** (désassemblage seul). Chaque fonction porte `// <adresse> <nom>` dans le code ; OpenTIM (TEMIM) n'a que l'interrupteur et la prise (`src/parts/mod.rs`), les autres handlers viennent du seul désassemblage.

## État par type

| Type | Handlers (adresses) | État |
| --- | --- | --- |
| 20 pulsation de phazer | 0 440ad4, 1 440b62, 2 440b35 (+ 440a51 : type 19 → 41) | porté, **lu** (jamais posé dans un LEV : créé par 27) |
| 21 interrupteur | 0 440c00, 1 440cee, 2 440c8b, 3 440d18 | porté, **vérifié** |
| 22 télécommande | 0 440d68, 1 440ddf, 2 440d92, 5 440e36 | porté, **vérifié** (slot 5 : test de logique) |
| 25 lampe torche | 0 441138, 1 4411ac, 2 44117f, 3 4411ca | porté, **vérifié** |
| 27 Super Phazer | 1 4413e4, 2 44153a, 3 44157c, 5 4415bf, 7 4414ea | porté, **vérifié** (HH20 complet) |
| 29 lampe à lave | 1 4416c0, 2 441654, 5 4416ff | porté, **vérifié** |
| 30 loupe | 1 44175c, 3 44197e, 6 441a0a (dessin : sans effet) | porté ; **lu** pour le foyer sur une pièce à point d'accroche (voir Noyau) |
| 38 panneau solaire | 1 442ee7, 2 442ec0 | porté, **lu** (globales 0x481618 à 0x481674 recalculées depuis les ANM des types 36, 70, 75, 78, 80, 109) |
| 91, 92, 93 lasers, 95 mélangeur | 1 43c6de / 43c986, 2 43cb08 (95) ; 43c88a et le tracé 43ce78 sont dans `mechanics/laser.ts`, 3 43c93b / 43cc9e | portés (`lasers.ts`) |
| 94 miroir | 2 4472f0, 3 447314 | porté, **vérifié** |
| 96 prise activée par laser | 1 4473a1, 2 447358 | porté, **vérifié** |
| 120 prise électrique | 1 44823e, 2 448218 | porté, **vérifié** |
| 136 ordinateur à message | 0 4483b6, 2 448404, 6 448424 (dessin), 7 448380 | porté, **vérifié** (TLEV23, MLEV30) |
| 137 minuteur | 0 4484bc, 1 4485b3, 2 448532 | porté (scénario MLEV10 sans déclenchement : slot 1 **lu**) |
| 148 détecteur laser | 1 44887c, 2 44891d | porté, **vérifié** ; le +0x24 est posé par la passe 43d013 (mechanics) |

## Le courant électrique (lu, vérifié sur 21, 120, 96)

Pas de simulation de réseau : un état par pièce (+0x24) et deux liens (+0xA0 / +0xA4, `links[4]` et `links[5]`, remplis au chargement par les champs « branchés » du LEV). Les sources (interrupteur, télécommande, minuteur, ordinateur, détecteur, laser…) posent +0x24 ; leur slot 1 le recopie dans les pièces liées (`feedLinks`). La prise 120 force **1** dans ses liens (elle ne propage pas son propre état) ; la prise laser 96 propage son état puis le remet à 0 (la passe lasers le repose à chaque pas). Le slot 2 des prises déduit l'image des liens : bit 0 si +0xA0 est lié, bit 1 si +0xA4 l'est (+ 7 et + 14 pour 96). Le bit +0x10 & 0x40 (« traitée ») est posé par ces slots 1.

## Besoins de noyau (à `mechanics`)

1. **Slot 5 à quatre arguments** : 43a31d appelle `slot5(bout, pièce, 0, drapeaux, masse, quantité de mouvement)`. Les slots 5 de 22, 27 et 29 n'utilisent que la pièce (2e argument) et les drapeaux : ils sont enregistrés comme `Handler(world, pièce, drapeaux)`, à appeler `world.call(5, pièce, drapeaux)`. Rendent 1 si la corde cède, 0 sinon ; `flags === 1` incrémente `ropes[0].n18`.
2. **Champs de `Part` absents** : +0xB8 / +0xB9 (point d'accroche, octets signés posés par le slot 2 de types des autres groupes, lus par 4350e6 et par la loupe) et +0xC8 / +0xCC (écarts posés par 434cc4). Ils vivent provisoirement dans `zone.ts` (`extra(part)`, table annexe) : les groupes qui posent les accroches devront écrire dans `Part` et `zone.ts` les lira. +0xB0 / +0xB1 sont du dessin : ignorés.
3. **Services dupliqués dans `zone.ts`** : recherche dans une boîte 434cc4 (`imageScan`), 434eff (`boxScan`), 4350e6 (`hotspotScan`), « réveil » du faisceau 43beb8 (`wakeInBeam`), création d'une pièce 432d00/432c1c (`createPart`, recyclage d'une pièce détruite du même type, drapeau +0x0C & 0x10, comme l'exe). À remplacer par les versions du noyau (seaux, convoyeur… les utilisent aussi). `434ec6` (boîte propre des types 6, 12 et 50 : 43f92f, 440058, 443c19) n'est pas portée : ces types prennent la boîte d'image.
4. **Liens vers le bac** : dans l'exe, une prise dont la fiche (pièce branchée) est dans le bac n'a pas de lien (TLEV12 : la prise de l'index 0 a l'image 0, celle de l'index 16, dont la fiche est posée, l'image 1). `World.unplug` (438fe3) couvre TLEV12 et la plupart des niveaux, mais pas TLEV26 ni RLEV13 : la prise 120 y garde `links[5]` (image 2 au lieu de 1 au pas 0). Les scénarios `sw21out` et `mirror13` sont ignorés pour cette raison (`KERNEL_GAPS` dans le test) ; l'indice `4 + fD0` ou l'ordre de résolution des fiches est à revoir côté `mechanics`.
5. **Slot 7 avec une pièce** : l'exe l'appelle au chargement pour les types 91, 92, 93 et 95 (allocation du tampon du faisceau, 43c65c) ; 21, 26, 38, 96, 120 passent par la mise du +0xD0 des fiches (431c15). Pas encore dans `addFromLev`.
6. **Fonctions d'autres groupes appelées par `world.special`** : 444bda (type 55, touché par la pulsation), 446014 (type 74, réveillé), 43bf49 (type 12), 43f907 (type 6) et 440454 (type 15) par le minuteur ; sans elles, souches journalisées.
7. **Passe lasers 43d013** (mechanics) : doit poser +0x24 du détecteur 148, des prises 96 et du mélangeur 95, et lire le faisceau construit par 43ce78 (tampon +0x90 / +0x98, longueur +0x104). Tables du rayon : 0x477d04 … 0x477dc8 (non extraites).

## Noyau repris par `mechanics`

`zone.ts` réexporte `engine/zone.ts` (boîtes, création, réveil) ; `extra()` lit +0xB8 / +0xB9 (`ropeAnchor[8..9]`) et +0xC8 / +0xCC (`fC8`, `fCC`). Slot 5 : `fn(world, cible, tireur, emplacement, flags, masse, effort)`. `434ec6` concerne les types 6, 12 et **42** (corrigé : `sub 6, sub 6, sub 0x1e`), pas 50.

## Écart de noyau restant (une ligne)

`World.addFromLev` (431c15) pose le côté de branchement `fD0` des fiches pour les types 21, 26, 38 et **96, 120** ; le code actuel liste `0x5f` (mélangeur) et `0x77` (119) au lieu de `0x60` et `0x78`. Conséquence : `World.unplug` coupe `links[4]` au lieu de `links[5]` sur les prises 120 dont une fiche est au bac, d'où les 4 niveaux complets encore différents (HLEV20, RLEV13, TLEV26, TLEV28) et les scénarios `mirror13` / `sw21out`. Correction non appliquée (noyau) : remplacer `case 0x5f: case 0x77:` par `case 0x60: case 0x78:` dans `world.ts`.

## Écarts connus

- Le banc écrit les valeurs `--raw` ; le test compare, pour les seuls types de la famille, l'image (+0x18), l'état (+0x24) et le compteur +0x104 en plus du format v1.
- La loupe (30) ne peut viser que des pièces dont +0xB8 / +0xB9 sont fournis par `zone.ts` : sans accroche posée par les autres groupes, elle ne cible rien (cas des 8 niveaux qui la posent : aucun écart observé, car aucune pièce à accroche n'y est chauffée avant d'autres types non portés).
- Les scénarios couvrent surtout l'initialisation (slots 2, liens) et le repos : peu de déclenchements réels (la télécommande, l'interrupteur et le minuteur ne sont touchés que si une pièce de Φ1 tombe dessus). La logique de bascule, de propagation, de tir (27) et de détecteur est complétée par des tests unitaires.

## Tests

`test/tim3/engine/parts/electric.test.ts` : (1) scénarios `--keep` (types de la famille + Φ1) comparés au banc en format v2 `--raw`, traces locales dans `test/tim3/traces/electric/*.tsv` (28 scénarios, 19 comparés et 9 ignorés : lasers 91 à 93 / 95, panneau 38, et les deux écarts de noyau ci-dessus : `bench.py trace NIVEAU --keep …,<types Φ1> --steps 300 --format v2 --raw`), ignorés si un type n'est pas porté (`TIM3_TRACES_ALL=1` pour les forcer) ; (2) niveaux complets où la famille intervient (traces v1 : 15 identiques, 82 ignorés tant qu'un type d'un autre groupe manque) ; (3) tests de logique des handlers.
