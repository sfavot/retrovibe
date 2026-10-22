import {
  BACK_SURFACE,
  DRAW_CLEARRECT,
  DRAW_DRAWBAR,
  DRAW_DRAWLINE,
  DRAW_FILLRECTABS,
  DRAW_PRINTTEXT,
  RENDERFLAG_CAPTUREPUSH,
  RENDERFLAG_COLLISIONS,
  RENDERFLAG_DOUBLECOORDS,
  RENDERFLAG_FROMSPLIT,
  RENDERFLAG_NOINVALIDATE,
  s16,
} from "./core";
import type { DrawImpl } from "./draw";

/** Type de zone « clic » (Hotspots::kTypeClick). */
const TYPE_CLICK = 2;
/** Numéro de la fonction de centrage dans la table des fonctions du TOT. */
const FUNCTION_CENTER = 13;
const STR_SIZE = 80;

/** Écrit les valeurs d'un format `%d` avec zéros et virgule/point décimal (cas des variables de largeur fixe). */
function formatNumber(value: number, digits: number, british: boolean): string {
  let buf = String(value | 0);
  const pad = (position: number): void => {
    while (buf.length - 1 < digits) buf = buf.slice(0, position) + "0" + buf.slice(position);
  };
  if (buf[0] === "-") pad(1);
  else pad(0);
  const at = Math.max(0, buf.length + 1 - digits);
  const mark = british ? "." : ",";
  return buf.slice(0, at) + mark + buf.slice(at);
}

/** Texte centré dans un rectangle (Draw::printTextCentered) ; exécute d'abord la fonction de centrage du script. */
async function printTextCentered(
  draw: DrawImpl,
  id: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  text: string,
  fontIndex: number,
  color: number,
): Promise<void> {
  const vm = draw.core.vm!;
  const centerOffset = vm.script.loaded ? vm.script.functionOffset(FUNCTION_CENTER) : 0;
  if (centerOffset !== 0) {
    await vm.runFunction(centerOffset, () => {
      const v = vm.vars;
      v.writeVar32(17, id);
      v.writeVar32(18, left);
      v.writeVar32(19, top);
      v.writeVar32(20, right - left + 1);
      v.writeVar32(21, bottom - top + 1);
    });
  }
  if (text === "") return;
  if (fontIndex >= 16 || !draw.fonts[fontIndex]) return;

  draw.transparency = 1;
  draw.destSpriteX = left;
  draw.destSpriteY = top;
  draw.fontIndex = fontIndex;
  draw.frontColor = color;
  draw.textToPrint = text;
  const width = draw.stringLength(text, fontIndex);
  draw.destSpriteX += Math.trunc((right - left + 1 - width) / 2);
  draw.spriteOperation(DRAW_PRINTTEXT);
}

/**
 * Draw_v2::printTotText : affiche le texte `id` de la table des textes du TOT.
 * Un texte est un en-tête (rectangle et fond), une liste de traits décoratifs, puis un flux de commandes
 * (position, police/couleur, zones cliquables, soulignement…) mêlées aux caractères.
 */
export async function printTotText(draw: DrawImpl, id: number): Promise<void> {
  const vm = draw.core.vm!;
  id &= 0xfff;

  const item = vm.resources?.getTextItem(id);
  if (!item) return;
  // Copie : la normalisation des octets de contrôle ci-dessous modifie le texte.
  const data = item.slice();
  const size = data.length;
  const u16 = (o: number): number => (data[o] | (data[o + 1] << 8)) & 0xffff;
  const i16 = (o: number): number => s16(u16(o));

  const isSubtitle = (data[1] & 0x80) !== 0;
  if (isSubtitle && !draw.doSubtitles) return;

  let ptr = 0;
  const flags = draw.renderFlags;
  let destX: number;
  let destY: number;
  let spriteRight: number;
  let spriteBottom: number;

  if (flags & RENDERFLAG_DOUBLECOORDS) {
    destX = s16((u16(0) & 0x7fff) * 2);
    spriteRight = s16(u16(4) * 2 + 1);
  } else {
    destX = s16(u16(0) & 0x7fff);
    spriteRight = i16(4);
  }

  if (flags & RENDERFLAG_FROMSPLIT) {
    const start = draw.core.splitStart;
    destY = start;
    spriteBottom = u16(6) - u16(2);
    if (flags & RENDERFLAG_DOUBLECOORDS) spriteBottom *= 3;
    spriteBottom += start;
    if (flags & RENDERFLAG_DOUBLECOORDS) {
      spriteBottom += draw.backDeltaY;
      destY += draw.backDeltaY;
    }
  } else {
    destY = i16(2);
    spriteBottom = i16(6);
    if (flags & RENDERFLAG_DOUBLECOORDS) {
      destY *= 2;
      spriteBottom *= 2;
    }
  }

  ptr += 8;

  if (flags & RENDERFLAG_CAPTUREPUSH) {
    draw.capturePush(destX, destY, spriteRight - destX + 1, spriteBottom - destY + 1);
    vm.captureCounter++;
  }

  draw.destSpriteX = destX;
  draw.destSpriteY = destY;
  draw.spriteRight = spriteRight;
  draw.spriteBottom = spriteBottom;
  draw.destSurface = BACK_SURFACE;

  draw.backColor = data[ptr++];
  draw.transparency = 1;
  draw.spriteOperation(DRAW_CLEARRECT);

  draw.backColor = 0;
  const savedFlags = draw.renderFlags;
  draw.renderFlags &= ~RENDERFLAG_NOINVALIDATE;

  // Traits décoratifs : rectangle relatif, puis type (ligne, cadre, aplat) et couleur.
  while ((draw.destSpriteX = i16(ptr)) !== -1) {
    draw.destSpriteX += destX;
    draw.destSpriteY = i16(ptr + 2) + destY;
    draw.spriteRight = i16(ptr + 4) + destX;
    draw.spriteBottom = i16(ptr + 6) + destY;
    ptr += 8;

    const cmd = data[ptr++];
    switch ((cmd & 0xf0) >> 4) {
      case 0:
        draw.frontColor = cmd & 0xf;
        draw.spriteOperation(DRAW_DRAWLINE);
        break;
      case 1:
        draw.frontColor = cmd & 0xf;
        draw.spriteOperation(DRAW_DRAWBAR);
        break;
      case 2:
        draw.backColor = cmd & 0xf;
        draw.spriteOperation(DRAW_FILLRECTABS);
        break;
    }
  }
  ptr += 2;

  // Fin du flux de commandes (octet 1) ; derrière, la table des variables insérées (23 octets chacune).
  let ptrEnd = ptr;
  while (ptrEnd < size && data[ptrEnd] !== 1) {
    // Les anciennes versions du format convertissent les octets de contrôle inconnus en espaces.
    if (vm.script.versionMinor < 2 && data[ptrEnd] > 3 && data[ptrEnd] < 32) data[ptrEnd] = 32;
    switch (data[ptrEnd]) {
      case 2:
      case 5:
        ptrEnd += 5;
        break;
      case 3:
      case 4:
        ptrEnd += 2;
        break;
      case 6:
        ptrEnd++;
        switch (data[ptrEnd] & 0xc0) {
          case 0x40:
            ptrEnd += 9;
            break;
          case 0x80:
            ptrEnd += 3;
            break;
          case 0xc0:
            ptrEnd += 11;
            break;
          default:
            ptrEnd++;
            break;
        }
        break;
      case 10:
        ptrEnd += data[ptrEnd + 1] * 2 + 2;
        break;
      default:
        ptrEnd++;
        break;
    }
  }
  ptrEnd++;

  let fontIndex = 0;
  let frontColor = 0;
  let strPos = 0;
  let strPos2 = -1;
  let offX = 0;
  let offY = 0;
  let colId = 0;
  let colCmd = 0;
  let maskChar = 0;
  const mask = new Uint8Array(STR_SIZE);
  const str = new Uint8Array(STR_SIZE).fill(32);
  draw.backColor = 0;
  draw.transparency = 1;
  const byteAt = (o: number): number => (o >= 0 && o < size ? data[o] : 1);

  /** Chaîne C : jusqu'au premier octet nul de `str`, ou jusqu'à `limit`. */
  const cstr = (limit: number): string => {
    let s = "";
    for (let i = 0; i < limit && i < STR_SIZE && str[i] !== 0; i++) s += String.fromCharCode(str[i]);
    return s;
  };

  for (;;) {
    const cur = byteAt(ptr);
    if (((cur >= 1 && cur <= 7) || cur === 10) && strPos !== 0) {
      const end = Math.max(strPos, strPos2);
      if (end < STR_SIZE) str[end] = 0;
      const strPosBak = strPos;
      const text = cstr(STR_SIZE);
      const font = draw.fonts[fontIndex];
      let width = font ? text.length * font.charWidthDefault : 0;

      if (colCmd & 0x0f) {
        // Texte dans un bouton : zone cliquable et centrage par le script.
        const rectLeft = offX - 2;
        const rectTop = offY - 2;
        const rectRight = offX + width + 1;
        const rectBottom = (font ? font.charHeight : 0) + offY + 1;
        if (colId !== -1) {
          draw.addHotspot({
            id: (colId + 0xd000) & 0xffff,
            left: rectLeft,
            top: rectTop,
            right: rectRight,
            bottom: rectBottom,
            flags: TYPE_CLICK,
            key: 0,
            funcEnter: 0,
            funcLeave: 0,
            funcPos: 0,
          });
        }
        await printTextCentered(draw, colCmd & 0x0f, rectLeft + 2, rectTop + 2, rectRight - 2, rectBottom - 2, text, fontIndex, frontColor);
      } else {
        draw.destSpriteX = offX;
        draw.destSpriteY = offY;
        draw.fontIndex = fontIndex;
        draw.frontColor = frontColor;
        draw.textToPrint = text;
        if (isSubtitle) {
          draw.fontIndex = draw.subtitleFont;
          draw.frontColor = draw.subtitleColor;
        }
        draw.spriteOperation(DRAW_PRINTTEXT);

        // Caractères soulignés (commande 8).
        width = text.length;
        const f = draw.fonts[fontIndex];
        for (let pos = 0; pos < width; pos++) {
          if (mask[pos] === 0) continue;
          const cw = f ? f.charWidthDefault : 0;
          const ch = f ? f.charHeight : 0;
          draw.destSpriteX = pos * cw + offX;
          draw.spriteRight = draw.destSpriteX + cw - 1;
          draw.spriteBottom = offY + ch;
          draw.destSpriteY = draw.spriteBottom;
          draw.spriteOperation(DRAW_DRAWLINE);
        }
      }

      let advance = 0;
      const used = draw.fonts[draw.fontIndex];
      if (used) for (let i = 0; i < strPosBak; i++) advance += used.charWidth(str[i]);
      offX += advance;
      strPos = 0;
      strPos2 = -1;
      mask.fill(0);
      str.fill(32);
    }

    const c = byteAt(ptr);
    if (c === 1) break;

    switch (c) {
      case 2:
      case 5:
        ptr++;
        offX = s16(destX + i16(ptr));
        offY = s16(destY + i16(ptr + 2));
        if (draw.renderFlags & RENDERFLAG_DOUBLECOORDS) {
          offX += i16(ptr);
          offY += i16(ptr + 2);
        }
        ptr += 4;
        break;

      case 3:
        ptr++;
        fontIndex = ((byteAt(ptr) & 0xf0) >> 4) & 7;
        frontColor = byteAt(ptr) & 0x0f;
        ptr++;
        if (isSubtitle) {
          draw.subtitleFont = fontIndex;
          draw.subtitleColor = frontColor;
        }
        break;

      case 4:
        ptr++;
        frontColor = byteAt(ptr++);
        if (isSubtitle) draw.subtitleColor = frontColor;
        break;

      case 6:
        ptr++;
        colCmd = byteAt(ptr++);
        colId = -1;
        if (colCmd & 0x80) {
          colId = i16(ptr);
          ptr += 2;
        }
        if (colCmd & 0x40) {
          draw.addHotspot({
            id: (colId + 0xd000) & 0xffff,
            left: destX + i16(ptr),
            top: destY + i16(ptr + 4),
            right: destX + i16(ptr + 2),
            bottom: destY + i16(ptr + 6),
            flags: TYPE_CLICK,
            key: 0,
            funcEnter: 0,
            funcLeave: 0,
            funcPos: 0,
          });
          ptr += 8;
        }
        break;

      case 7:
        ptr++;
        colCmd = 0;
        break;
      case 8:
        ptr++;
        maskChar = 1;
        break;
      case 9:
        ptr++;
        maskChar = 0;
        break;

      case 10: {
        // Caractères codés par numéro (polices à deux octets) : seuls l'avance et le masque sont conservés.
        ptr++;
        for (let n = byteAt(ptr++); n > 0; n--) {
          if (strPos < STR_SIZE) mask[strPos] = maskChar;
          strPos++;
          ptr += 2;
        }
        break;
      }

      case 186: {
        // Valeur d'une variable insérée dans le texte.
        const kind = byteAt(ptrEnd + 17) & 0x7f;
        const varOffset = (byteAt(ptrEnd + 18) | (byteAt(ptrEnd + 19) << 8)) * 4;
        let buf: string;
        const vars = vm.vars;
        if (kind === 0) buf = String(vars.readOff32(varOffset) | 0);
        else if (kind === 1) buf = vars.readString(varOffset, 19);
        else buf = formatNumber(vars.readOff32(varOffset), byteAt(ptrEnd + 17), vm.host.language === "gb");
        for (let i = 0; i < buf.length && strPos + i < STR_SIZE; i++) str[strPos + i] = buf.charCodeAt(i) & 0xff;
        mask.fill(maskChar, 0, Math.min(buf.length, STR_SIZE));
        if (byteAt(ptrEnd + 17) & 0x80) {
          strPos2 = strPos + buf.length;
          strPos++;
          ptrEnd += 23;
          ptr++;
        } else {
          strPos += buf.length;
          if (byteAt(ptr + 1) !== 32) {
            if (byteAt(ptr + 1) === 2 && i16(ptr + 4) === draw.destSpriteY) {
              ptr += 5;
              if (strPos < STR_SIZE) {
                str[strPos] = 32;
                mask[strPos] = maskChar;
              }
              strPos++;
            }
          } else {
            if (strPos < STR_SIZE) {
              str[strPos] = 32;
              mask[strPos] = maskChar;
            }
            strPos++;
            while (byteAt(ptr + 1) === 32) ptr++;
            if (byteAt(ptr + 1) === 2 && i16(ptr + 4) === draw.destSpriteY) ptr += 5;
          }
          ptrEnd += 23;
          ptr++;
        }
        break;
      }

      default:
        // Caractère ordinaire (y compris l'espace) ; les octets de contrôle inconnus sont gardés tels quels.
        if (c !== 32 && strPos < STR_SIZE) str[strPos] = c;
        if (strPos < STR_SIZE) mask[strPos] = maskChar;
        strPos++;
        ptr++;
        break;
    }
    if (strPos >= STR_SIZE) strPos = STR_SIZE - 1;
  }

  draw.renderFlags = savedFlags;
  if (!(draw.renderFlags & RENDERFLAG_COLLISIONS)) return;

  await draw.hotspots?.check(0, 0);
  if (vm.captureCounter !== 0) {
    vm.captureCounter--;
    draw.capturePop(true);
  }
}
