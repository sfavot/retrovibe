# TIM3 : groupe `creatures` (vague Φ2)

Code : `src/games/tim3/engine/parts/creatures/` (`cat.ts`, `mouse.ts`, `mel.ts`, `mandrill.ts`, `flyers.ts`, `jack.ts`, `gator.ts`, `toaster.ts`, `strike.ts`, `overlap.ts`, `boxes.ts`, `kernel.ts`). Test : `test/tim3/engine/parts/creatures.test.ts`.

## Types portés (tous sans souche)
12 chat, 13 diable en boîte, 31 mandrill, 32 Boris, 33 Cupidon, 34 Père Noël, 42 souris, 52 fromage (aucun handler), 54 Mel, 58 maison de Mel, 61 alligator, 65 leprechaun, 66 trou de souris, 81 grille-pain.
Fonctions partagées : 43dc73 (zone de frappe : diable, alligator, grille-pain), 437208 (+ 4372f8, 4374e9 : chevauchement), 434cc4, 434eff, 434ec6, 43a28f (dans `kernel.ts`), 4371af (`pairIgnored`).

## Vérification
Scénarios `bench.py trace NIVEAU --keep <types>` (types portés + Φ1), 600 pas, identiques au banc : ~70 fichiers dans `test/tim3/traces/creatures/` (locaux, non versionnés). Les agents ont aussi comparé l'image (+0x18), +0x24, +0xFC en format v2 : 0 écart.
Non couverts par le banc : types 32, 33, 34, 65 (absents de tous les niveaux), slot 3 (édition) de plusieurs types, branches de 43dcb5 pour des types non portés.

## Besoins de noyau
- `World.pinballTimer` vaut 78 ; l'exe contient 0x78 = 120 (invisible en v1, décale le hasard partagé avec un flipper).
- Compteurs globaux non réinitialisés (477eb0 chat, 4780b8 souris, 477fc8 mandrill) : `WeakMap<World,…>` locales, à mettre dans `World` (sauvegardes).
- Champs absents de `Part` : +0xC8/+0xCC (`relativeOf`), +0xB0/+0xB1/+0xB8/+0xB9 (4350e6 lit +0xB8/+0xB9).
- `world.special(0x43f907)` (moteur) et `0x440454` (aquarium) : personne ne les enregistre.
- `melStates(world).s8` (0x481664, image de repos de Mel) lu par d'autres types.
- `realWorld(name, keep)` appelle le slot 2 avant de retirer les types : stubs de chargement parasites (le test les efface).

## Fidélité
- Chat : ANM en deux moitiés (affamé / repu), états jumeaux ; compteur de repos global (rand%140+80, animation rand%3) ; saute de 44 px après 13 pas accroupi ; mange la souris à portée (+0x2000).
- Souris : fuit un chat à moins de 0x40 px, va vers le fromage, retournement testé par 437208.
- Mel : le hasard n'est tiré que dans le clignotement ; slot 3 ne met pas à jour la position de dessin ; 444adc exposé (`melDropped`).
- Diable / grille-pain : f24 = ±2 reçu du moteur par courroie ; zones et tables de masse différentes.
- Alligator : souris ou Mel dans la gueule sont mangés, le reste est lancé (vx ±0x600, vy −0x1600).
