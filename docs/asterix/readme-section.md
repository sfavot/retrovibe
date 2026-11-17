# Astérix : section du README, à coller à la publication

Préparée en vague F (`docs/asterix/plan.md`) ; rien de ce fichier n'est encore dans `README.md`. À la publication :
ajouter la ligne au tableau des jeux (après celle du Téléportaschtroumpf), coller la section après celle du
Téléportaschtroumpf, puis supprimer ce fichier.

## Ligne du tableau des jeux

```markdown
| [Astérix : le défi de César (Infogrames Multimedia, 1995)](https://sfavot.github.io/retrovibe/#/asterix) | jouable (en cours de validation) |
```

## Section

```markdown
## Astérix : le défi de César

Réimplémentation du jeu de plateau et de mini-jeux *Astérix : le défi de César* (Infogrames Multimedia, 1995, réalisé par Bertrand Brocard ; adaptation PC d'IKOS ; CD pour DOS, en français). César met les Gaulois au défi de rapporter un souvenir de chaque province : de 1 à 4 joueurs font le tour d'un plateau de 54 cases, entre quiz, marchand, quinze mini-jeux d'adresse et d'observation et jeux d'ambiance annoncés par Panoramix. Sa logique est écrite en dur dans `ASTERIX.EXE` : elle a été reconstituée d'après le désassemblage de l'exécutable, cité adresse par adresse. Le jeu partage son moteur avec *Le Téléportaschtroumpf*, dont il est l'ancêtre direct. Ajouts de l'adaptation : clic et toucher directs (l'original se pilotait aux flèches), sauvegarde automatique au début de chaque tour (« Continuer » sur l'écran de présentation).

### Fichiers de données

`scripts/asterix-extract.sh [jeu.7z] [manuels.rar]` lit les deux archives placées dans `archives/asterix/` (non versionnées, jamais exécutées) et prépare `original/asterix/` (58,5 Mo) : `ASTERIX.EXE` (lu pour ses tables, jamais exécuté), `MDF/<module>/` (images MCG et MCC, sprites HY8, polices PFN, quiz et générique tels quels ; les 736 voix, musiques et bruitages VOC convertis en MP3, `<nom>.VOC.mp3` ; les 148 vidéos MUX et MUK réencodées sans perte dans un conteneur maison compressé en LZMA, `<nom>.MUX.vid` et `<nom>.MUK.vid`, avec le son des MUX en MP3 à part), `audio.json` (nombre d'échantillons et fréquence d'origine de chaque son : durées exactes, calage des vidéos), `MANUEL.pdf` (le manuel, édition Macintosh) et `CARTE.pdf` (la carte du jeu : le plan du plateau), `files.json`, puis l'inventaire `docs/asterix/files.md`. Il faut `7zz`, `unar`, `python3` et `ffmpeg` ; compter quelques minutes. `COVER.webp` est la pochette du CD, prise en couverture du manuel (`npx vite-node scripts/asterix/cover.mts`) ; l'extraction la conserve.

### Architecture

- `src/engine/infogrames/` — moteur commun aux jeux Infogrames de cette famille (voir *Le Téléportaschtroumpf*), avec ce qu'Astérix y a ajouté : images MCC et conteneur vidéo `.vid` (compressé en LZMA).
- `src/games/asterix/data/` — lecteurs propres au jeu : tables de `ASTERIX.EXE`, animations MUK, quiz, générique.
- `src/games/asterix/engine/` — ce que le jeu fournit au moteur : chemins des fichiers.
- `src/games/asterix/game/` — règles pures : état de la partie, plateau, dé, objets, durée, fin.
- `src/games/asterix/scenes/` — les écrans, portés en scripts séquentiels (un générateur par fonction d'origine) : logos et introduction, menu, joueurs et réglages, plateau, cases, quiz, carte, score, démonstration, sauvegarde.
- `src/games/asterix/scenes/minigames/` — les quinze mini-jeux (M22 à M36).
- `src/games/asterix/ui/` — page du jeu (canvas), écran de présentation, aide et crédits, pages de développement.

### Pages de développement

Avec `npm run dev` : `src/games/asterix/ui/asset-viewer.html` est une visionneuse des ressources (images, sprites, vidéos, sons, quiz, générique) et `src/games/asterix/ui/dev.html` lance le jeu seul, sans la page d'accueil (`?direct&intro=0&seed=n&resume` pour la recette, `&minigame=NN` pour jouer un mini-jeu hors partie).

### Documentation

`docs/asterix/` : plan (`plan.md`, décisions, écarts à l'original), inventaire (`files.md`), formats (`formats.md`), rétro-ingénierie (`re-index.md`, `engine.md`) et mini-jeux (`minigames/`). Les tests sont dans `test/asterix/`.
```
