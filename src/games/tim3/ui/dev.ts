import "../../../ui/style.css";
import { mountApp } from "./app";

/**
 * Page de développement : monte le jeu seul, hors de l'application (`/src/games/tim3/ui/dev.html`, avant la vague J).
 * `?puzzle=TLEV1` ouvre ce puzzle ; `?base=…` change le dossier des fichiers (test de l'erreur de fichiers manquants).
 */
const params = new URLSearchParams(location.search);
void mountApp(document.getElementById("app")!, {
  base: params.get("base") ?? `${import.meta.env.BASE_URL}tim3`,
  debug: true,
  puzzle: params.get("puzzle") ?? undefined,
});
