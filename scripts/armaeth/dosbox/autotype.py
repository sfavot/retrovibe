#!/usr/bin/env python3
"""Traduit un scénario de touches en UNE commande AUTOTYPE de DOSBox-X (format décrit dans run.sh).

Ce qu'on a mesuré d'AUTOTYPE (docs/armaeth/dosbox.md, « Entrées clavier ») :
  * une seule commande par session : deux commandes qui se suivent figent DOSBox-X dès que la seconde démarre
    pendant le jeu ; toutes les touches tiennent donc dans une ligne (~3500 caractères au plus : environ 600 s de scénario) ;
  * une touche coûte PACE + 0,058 s (0,262 s pour PACE = 0,2) et une virgule 2 x PACE s (virgule = « une cadence
    de silence en plus de la sienne ») : le temps du scénario est simulé ici pour poser les virgules ;
  * le délai de départ (-w) vaut 30 s au plus.
Les instants sont ceux de la vidéo (l'AUTOTYPE démarre quelques ms avant le lancement de am1) ; l'erreur est de
l'ordre de la demi-seconde et s'accumule peu (le simulateur corrige à chaque touche). Un scénario est déterministe
d'un lancement à l'autre (mêmes images, à l'image près).
Sortie : la commande, sur la sortie standard.
"""
import os
import shlex
import sys

TEXT_KEYS = {" ": "space", "'": "quote", ".": "period", ",": "comma", "-": "minus", "=": "equals",
             ";": "semicolon", "/": "slash", "\\": "backslash", "[": "lbracket", "]": "rbracket"}
PACE = float(os.environ.get("AT_PACE", "0.2"))  # s : cadence d'AUTOTYPE (< 0,25 s : sinon la touche est tenue assez longtemps pour se répéter)
KEY_COST = PACE + 0.058    # s qu'occupe une touche (mesuré : 0,262 s à 0,2 et 0,556 s à 0,5)
COMMA_COST = 2 * PACE      # s qu'occupe une virgule
MAX_LINE = 3500            # la ligne de commande de DOSBox-X tient ~4000 caractères (3024 passent, 3824 non)


def keys_of_text(text: str):
    for ch in text:
        if ch.isascii() and ch.isalnum():
            yield ch.lower()
        elif ch in TEXT_KEYS:
            yield TEXT_KEYS[ch]
        else:
            sys.exit(f"caractère non saisissable : {ch!r} (accents : taper la lettre sans accent)")


def parse(path: str):
    """Liste de (instant voulu, touche) ; les touches d'une ligne se suivent sans attendre."""
    events = []
    for n, raw in enumerate(open(path, encoding="utf-8"), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        toks = shlex.split(line)
        try:
            t = float(toks[0])
        except ValueError:
            sys.exit(f"{path}:{n}: instant attendu en premier, lu {toks[0]!r}")
        for tok in toks[1:]:
            if tok.startswith("+"):  # +2.5 : attente supplémentaire avant la touche suivante
                t += float(tok[1:])
            elif tok.startswith("!"):  # !texte libre : une touche par caractère
                for key in keys_of_text(tok[1:]):
                    events.append((t, key))
                    t += KEY_COST
            else:
                events.append((t, tok))
                t += KEY_COST
    return sorted(events, key=lambda e: e[0])


ENTER_KEY = os.environ.get("AT_ENTER", "enter")  # touche envoyée pour « enter » (essais de fiabilité)


def build(events):
    events = [(t, ENTER_KEY if k == "enter" else k) for t, k in events]
    w0 = min(30.0, events[0][0]) if events else 0.0
    now = w0  # instant où la prochaine touche sortirait sans virgule
    tokens = []
    for t, key in events:
        gap = t - now
        if gap > COMMA_COST / 2:
            n = round(gap / COMMA_COST)
            tokens += [","] * n
            now += n * COMMA_COST
        tokens.append(key)
        now += KEY_COST
    return w0, tokens


def main(path: str) -> None:
    w0, tokens = build(parse(path))
    if not tokens:
        return
    cmd = f"autotype -w {w0:g} -p {PACE:g} " + " ".join(tokens)
    if len(cmd) > MAX_LINE:
        sys.exit(f"scénario trop long : {len(cmd)} caractères d'AUTOTYPE (max {MAX_LINE}) ; raccourcir les attentes")
    print(cmd)


if __name__ == "__main__":
    main(sys.argv[1])
