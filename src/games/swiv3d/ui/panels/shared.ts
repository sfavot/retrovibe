/** Ressources partagées entre panneaux (chargées une fois par session) : chaînes de GLOBAL.BD et premier niveau pour ses palettes et tables. */
import type { PanelContext } from "../../../../ui/asset-viewer/viewer";
import { parseBd, type BdArchive } from "../../data/bd";
import { parseLevel, type Level } from "../../data/level";
import { parseStrings, type StringTables } from "../../data/strings";

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).toUpperCase();
}

export interface GlobalStrings {
  bd: BdArchive;
  strings: StringTables;
}

let stringsPromise: Promise<GlobalStrings> | null = null;

/** Chaînes de `GLOBAL.BD` (échec = erreur lancée ; le cache est vidé pour qu'un nouvel essai puisse réussir). */
export function loadStrings(ctx: PanelContext): Promise<GlobalStrings> {
  stringsPromise ??= (async () => {
    const path = ctx.files.resolve("GLOBAL.BD");
    if (!path) throw new Error("GLOBAL.BD absent du manifeste");
    const bd = parseBd(await ctx.fetchBytes(path), "GLOBAL.BD");
    return { bd, strings: parseStrings(bd) };
  })().catch((error: unknown) => {
    stringsPromise = null;
    throw error;
  });
  return stringsPromise;
}

let levelPromise: Promise<Level | null> | null = null;

/** Premier niveau livré (`TERRAN00.SLV`) : sa palette 11003 et sa table 109 servent aux blocs de GLOBAL.BD qui en dépendent. */
export function loadReferenceLevel(ctx: PanelContext): Promise<Level | null> {
  levelPromise ??= (async () => {
    const path = ctx.files.resolve("TERRAN00.SLV");
    if (!path) return null;
    return parseLevel(await ctx.fetchBytes(path), "TERRAN00.SLV");
  })().catch((error: unknown) => {
    console.error(error);
    levelPromise = null;
    return null;
  });
  return levelPromise;
}
