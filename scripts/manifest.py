"""Génère files.json dans un dossier original/<jeu>/ : liste triée des fichiers extraits.

Usage : python3 -I manifest.py <dossier original/<jeu>>
Chaque entrée : {"path": chemin relatif au dossier (séparateur /), "size": octets}.
Partagé par les scripts d'extraction ; pour le Téléportaschtroumpf, lu par src/games/teleportaschtroumpf/data/files.ts (résolution de noms insensible à la casse).
"""
import json
import os
import sys


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Usage : manifest.py <dossier>")
    racine = sys.argv[1]
    entrees = []
    for dossier, _, noms in os.walk(racine):
        for nom in noms:
            complet = os.path.join(dossier, nom)
            chemin = os.path.relpath(complet, racine).replace(os.sep, "/")
            if chemin == "files.json":
                continue
            entrees.append({"path": chemin, "size": os.path.getsize(complet)})
    entrees.sort(key=lambda e: e["path"])
    with open(os.path.join(racine, "files.json"), "w", encoding="utf-8") as f:
        json.dump(entrees, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"{len(entrees)} fichiers listés")


if __name__ == "__main__":
    main()
