// Utilitaires partagés par les scripts Ghidra de rétro-ingénierie de MATH et des DLL Broderbund (NE Win16).
// Ce n'est pas un GhidraScript : simple classe d'aide (Ghidra la compile avec les scripts voisins).

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

import ghidra.program.model.address.Address;
import ghidra.program.model.address.SegmentedAddress;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.MemoryBlock;

public final class ReCommon {
    private ReCommon() {}

    /** Dossier de sortie du programme : RE_OUT/RE_PROG (variables posées par run.sh). */
    public static File outDir(Program p) {
        String s = System.getenv("RE_OUT");
        String prog = System.getenv("RE_PROG");
        File d = new File(s != null ? s : "archives/mathemagique/re", prog != null ? prog : p.getName());
        d.mkdirs();
        return d;
    }

    /** « sel:off » de Ghidra (mode protégé : les sélecteurs du loader NE sont 1000, 1008, 1010...). */
    public static String addr(Address a) {
        if (a instanceof SegmentedAddress) {
            SegmentedAddress s = (SegmentedAddress) a;
            return String.format("%04x:%04x", s.getSegment(), s.getSegmentOffset());
        }
        return a.toString();
    }

    /** « MODULE::NOM » si la fonction est le thunk d'un import, sinon null. */
    public static String thunkLabel(ghidra.program.model.listing.Function f) {
        if (!f.isThunk()) return null;
        ghidra.program.model.listing.Function t = f.getThunkedFunction(true);
        if (t == null || t.getExternalLocation() == null) return null;
        return t.getExternalLocation().getLibraryName() + "::" + t.getExternalLocation().getLabel();
    }

    /** Nom d'une fonction appelée pour les en-têtes : « MODULE::NOM » pour un import, sinon l'adresse. */
    public static String calleeName(ghidra.program.model.listing.Function c) {
        String t = thunkLabel(c);
        return t != null ? t : addr(c.getEntryPoint());
    }

    public static boolean isCode(Program p, Address a) {
        MemoryBlock b = p.getMemory().getBlock(a);
        return b != null && b.isExecute();
    }

    /** Blocs de données initialisés (segments de données du NE : Data<n>). */
    public static List<MemoryBlock> dataBlocks(Program p) {
        List<MemoryBlock> l = new ArrayList<>();
        for (MemoryBlock b : p.getMemory().getBlocks()) {
            if (b.isInitialized() && !b.isExecute() && b.getName().startsWith("Data")) l.add(b);
        }
        return l;
    }

    /** Segment de données automatique (DGROUP) : le plus gros bloc de données ; null s'il n'y en a pas. */
    public static MemoryBlock dgroup(Program p) {
        MemoryBlock best = null;
        for (MemoryBlock b : dataBlocks(p)) if (best == null || b.getSize() > best.getSize()) best = b;
        return best;
    }

    /** Sélecteur (partie segment) du début d'un bloc. */
    public static int selector(MemoryBlock b) {
        return ((SegmentedAddress) b.getStart()).getSegment();
    }

    public static int dgroupSelector(Program p) {
        MemoryBlock b = dgroup(p);
        return b == null ? -1 : ((SegmentedAddress) b.getStart()).getSegment();
    }

    /** Écrit un fichier texte UTF-8. */
    public static void write(File f, String content) throws IOException {
        Files.write(f.toPath(), content.getBytes(StandardCharsets.UTF_8));
    }

    /** Échappe tabulations et retours pour une cellule TSV. */
    public static String esc(String s) {
        StringBuilder sb = new StringBuilder();
        for (char c : s.toCharArray()) {
            switch (c) {
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\\': sb.append("\\\\"); break;
                default:
                    if (c < 0x20 || c == 0x7f) sb.append(String.format("\\x%02x", (int) c)); else sb.append(c);
            }
        }
        return sb.toString();
    }

    // ------------------------------------------------------------------------------------------
    // Chaînes de DGROUP et références heuristiques
    // ------------------------------------------------------------------------------------------

    /** Chaîne C : offset de début dans le segment, contenu (octets bruts, sans le NUL). */
    public static final class Str {
        public final int off;
        public final byte[] raw;
        public Str(int off, byte[] raw) { this.off = off; this.raw = raw; }
        /** Texte lisible : ASCII tel quel, octets >= 0x80 décodés en CP1252 (Windows). */
        public String text() { return new String(raw, java.nio.charset.Charset.forName("windows-1252")); }
    }

    private static boolean strByte(int b) {
        return (b >= 0x20 && b <= 0x7e) || b == '\n' || b == '\r' || b == '\t' || (b >= 0xa0 && b != 0xff);
    }

    /**
     * Chaînes terminées par NUL : suites d'au moins 3 octets imprimables contenant au moins 2 caractères
     * alphanumériques ASCII ou « % ». Clé = offset de début dans le bloc.
     */
    public static java.util.TreeMap<Integer, Str> findStrings(byte[] dg) {
        java.util.TreeMap<Integer, Str> out = new java.util.TreeMap<>();
        int i = 0;
        while (i < dg.length) {
            if (!strByte(dg[i] & 0xff)) { i++; continue; }
            int j = i;
            while (j < dg.length && strByte(dg[j] & 0xff)) j++;
            boolean nul = j < dg.length && dg[j] == 0;
            if (nul && j - i >= 3) {
                int alnum = 0;
                for (int k = i; k < j; k++) {
                    int c = dg[k] & 0xff;
                    if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '%') alnum++;
                }
                if (alnum >= 2) out.put(i, new Str(i, java.util.Arrays.copyOfRange(dg, i, j)));
            }
            i = j + 1;
        }
        return out;
    }

    /** Octets d'un bloc mémoire. */
    public static byte[] bytes(MemoryBlock b) throws Exception {
        byte[] out = new byte[(int) b.getSize()];
        b.getBytes(b.getStart(), out);
        return out;
    }

    /**
     * Valeurs 16 bits que l'instruction peut utiliser comme offset du segment de données : constantes
     * immédiates des PUSH/MOV/LEA (type « imm ») et adresses absolues d'opérande mémoire dans le bloc
     * (type « mem »). « imm » prime sur « mem ».
     */
    public static java.util.Map<Long, String> dataOperands(ghidra.program.model.listing.Instruction ins, MemoryBlock dg) {
        java.util.Map<Long, String> out = new java.util.LinkedHashMap<>();
        String mn = ins.getMnemonicString();
        boolean immOk = mn.equals("PUSH") || mn.equals("MOV") || mn.equals("LEA") || mn.equals("PUSHD");
        long size = dg.getSize();
        for (int op = 0; op < ins.getNumOperands(); op++) {
            for (Object o : ins.getOpObjects(op)) {
                if (o instanceof ghidra.program.model.scalar.Scalar && immOk) {
                    long v = ((ghidra.program.model.scalar.Scalar) o).getUnsignedValue() & 0xffffL;
                    if (v < size) out.putIfAbsent(v, "imm");
                } else if (o instanceof Address && dg.contains((Address) o)) {
                    out.putIfAbsent(((Address) o).getOffset() - dg.getStart().getOffset(), "mem");
                }
            }
        }
        return out;
    }

    /** Vrai si un PUSH DS / PUSH SS / « ,DS » est voisin (passage d'un pointeur lointain vers les données). */
    public static boolean nearDs(ghidra.program.model.listing.Instruction ins) {
        ghidra.program.model.listing.Instruction p = ins.getPrevious(), n = ins.getNext();
        ghidra.program.model.listing.Instruction[] xs = { p, n, p == null ? null : p.getPrevious(), n == null ? null : n.getNext() };
        for (ghidra.program.model.listing.Instruction x : xs) {
            if (x == null) continue;
            String t = x.toString();
            if (t.equals("PUSH DS") || t.equals("PUSH SS") || t.endsWith(",DS") || t.endsWith(",SS")) return true;
        }
        return false;
    }
}
