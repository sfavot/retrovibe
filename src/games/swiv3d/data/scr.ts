/** Une ligne d'un fichier `.SCR` de SWIV 3D (`ANIMS/BR_TER*.SCR`) : six entiers puis deux lettres, séparés par des espaces. */
export interface ScrLine {
  /** Les six entiers, dans l'ordre du fichier. */
  values: [number, number, number, number, number, number];
  /** Les deux lettres de fin de ligne (par exemple `g r` ou `b l`). */
  codes: [string, string];
}

// TODO : la signification des champs est en cours de rétro-ingénierie, voir docs/swiv3d/re-index.md. Les noms restent neutres.

/** Découpe un fichier `.SCR` en lignes ; ignore les lignes vides, lance sur une ligne qui n'a pas la forme « 6 entiers + 2 lettres ». */
export function parseScr(bytes: Uint8Array): ScrLine[] {
  const text = new TextDecoder("latin1").decode(bytes);
  const lines: ScrLine[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const fields = raw.trim().split(/\s+/).filter(Boolean);
    if (fields.length === 0) continue;
    if (fields.length !== 8 || !fields.slice(0, 6).every((f) => /^-?\d+$/.test(f)) || !fields.slice(6).every((f) => /^[A-Za-z]$/.test(f))) {
      throw new Error(`SCR ligne ${i + 1} invalide : « ${raw.trim()} »`);
    }
    lines.push({
      values: fields.slice(0, 6).map(Number) as ScrLine["values"],
      codes: [fields[6]!, fields[7]!],
    });
  }
  return lines;
}
