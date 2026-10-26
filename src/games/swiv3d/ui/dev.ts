import "../../../ui/style.css";
import { mountApp } from "./app";

/**
 * Page de développement : monte le jeu seul, hors de l'application (`/src/games/swiv3d/ui/dev.html`).
 * `?skip=boot` passe les vidéos et logos de démarrage ; `?level=TERRAN01` (ou `DEMO`) joue ce niveau tout de suite, sans menus.
 * En dev : F9 = mission accomplie, F8 = game over.
 */
const params = new URLSearchParams(location.search);
void mountApp(document.getElementById("app")!, {
  base: `${import.meta.env.BASE_URL}swiv3d`,
  level: params.get("level") ?? undefined,
  skipBoot: params.get("skip") === "boot",
  debug: true,
});
