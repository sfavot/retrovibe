// Utilitaires partagés par les scripts Ghidra de rétro-ingénierie de SMURF.EXE.
// Ce n'est pas un GhidraScript : simple classe d'aide (Ghidra la compile avec les scripts voisins).

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

import ghidra.program.model.address.Address;
import ghidra.program.model.address.SegmentedAddressSpace;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryAccessException;
import ghidra.program.model.mem.MemoryBlock;

public final class ReCommon {
    private ReCommon() {}

    /** Dossier de sortie : variable d'environnement RE_OUT (posée par run.sh). */
    public static File outDir() {
        String s = System.getenv("RE_OUT");
        File d = new File(s != null ? s : "archives/teleportaschtroumpf/re");
        d.mkdirs();
        return d;
    }

    public static SegmentedAddressSpace space(Program p) {
        return (SegmentedAddressSpace) p.getAddressFactory().getDefaultAddressSpace();
    }

    /**
     * Segment DGROUP : le startup Borland commence par « MOV DX, imm16 » (opcode BA) à l'entrée.
     * On lit l'octet directement (valable même avant le désassemblage).
     */
    public static int dgroupSegment(Program p) throws MemoryAccessException {
        Address entry = p.getSymbolTable().getExternalEntryPointIterator().next();
        byte[] b = new byte[3];
        p.getMemory().getBytes(entry, b);
        if ((b[0] & 0xff) != 0xBA) throw new IllegalStateException("startup Borland inattendu à l'entrée " + entry);
        return (b[1] & 0xff) | ((b[2] & 0xff) << 8);
    }

    /** Adresse linéaire (seg*16) du début de DGROUP. */
    public static long dgroupLinear(Program p) throws MemoryAccessException {
        return dgroupSegment(p) * 16L;
    }

    /** Blocs de code : tout ce qui commence avant DGROUP (hors en-tête). Le loader nomme ces blocs CODE_n. */
    public static List<MemoryBlock> codeBlocks(Program p) throws MemoryAccessException {
        long dg = dgroupLinear(p);
        List<MemoryBlock> l = new ArrayList<>();
        for (MemoryBlock b : p.getMemory().getBlocks()) {
            if (!b.isInitialized() || b.getName().startsWith("HEADER")) continue;
            if (b.getStart().getOffset() < dg) l.add(b);
        }
        return l;
    }

    /** Contenu initialisé de DGROUP (du segment DGROUP:0000 à la fin des données du fichier ; le BSS est exclu). */
    public static byte[] dgroupBytes(Program p) throws MemoryAccessException {
        Memory mem = p.getMemory();
        long dg = dgroupLinear(p);
        long end = 0;
        for (MemoryBlock b : mem.getBlocks()) {
            if (b.getName().startsWith("HEADER")) continue;
            if (!b.isInitialized()) continue; // BSS : hors fichier
            end = Math.max(end, b.getEnd().getOffset() + 1);
        }
        byte[] out = new byte[(int) (end - dg)];
        SegmentedAddressSpace sp = space(p);
        for (int i = 0; i < out.length; i++) {
            // lecture par adresse segmentée : seg=DGROUP, off=i (i < 65536)
            out[i] = mem.getByte(sp.getAddress(dgroupSegment(p), i));
        }
        return out;
    }

    /** Écrit un fichier texte UTF-8. */
    public static void write(File f, String content) throws IOException {
        Files.write(f.toPath(), content.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * « seg:off » normalisé sur le segment du bloc de code qui contient l'adresse (les adresses
     * segmentées de Ghidra pour une même adresse linéaire peuvent s'afficher avec des segments
     * différents, ex. 1000:6c11 = 15f9:0c81 ; on garde la forme que verra un appel lointain).
     */
    public static String addr(Program p, Address a) {
        long lin = a.getOffset();
        MemoryBlock b = p.getMemory().getBlock(a);
        long seg = b != null ? (b.getStart().getOffset() >> 4) : (lin >> 4);
        return String.format("%04x:%04x", seg, lin - seg * 16);
    }

    /** Segment (paragraphe) du bloc contenant l'adresse. */
    public static int segmentOf(Program p, Address a) {
        MemoryBlock b = p.getMemory().getBlock(a);
        return (int) ((b != null ? b.getStart().getOffset() : a.getOffset()) >> 4);
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

    /** Chaîne C trouvée dans DGROUP : offset de début (dans DGROUP), contenu (octets bruts, sans le NUL). */
    public static final class Str {
        public final int off;
        public final byte[] raw;
        public Str(int off, byte[] raw) { this.off = off; this.raw = raw; }
        public int end() { return off + raw.length; }
        /** Texte lisible : ASCII tel quel, octets >= 0x80 décodés en CP437. */
        public String text() { return new String(raw, java.nio.charset.Charset.forName("IBM437")); }
    }

    private static boolean strByte(int b) {
        return (b >= 0x20 && b <= 0x7e) || b == '\n' || b == '\r' || b == '\t' || (b >= 0x80 && b != 0xff);
    }

    /**
     * Chaînes terminées par NUL de DGROUP : suites d'au moins 3 octets imprimables (ASCII, retours,
     * CP437) contenant au moins 2 caractères alphanumériques ASCII ou « % ». Clé = offset de début.
     * La recherche suit les NUL : une chaîne commence juste après un octet non imprimable.
     */
    public static java.util.TreeMap<Integer, Str> findStrings(byte[] dg) {
        java.util.TreeMap<Integer, Str> out = new java.util.TreeMap<>();
        int i = 0;
        while (i < dg.length) {
            if (!strByte(dg[i] & 0xff)) { i++; continue; }
            int j = i;
            while (j < dg.length && strByte(dg[j] & 0xff)) j++;
            boolean nul = j < dg.length && dg[j] == 0;
            int len = j - i;
            if (nul && len >= 3) {
                int alnum = 0;
                for (int k = i; k < j; k++) {
                    int c = dg[k] & 0xff;
                    if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '%') alnum++;
                }
                if (alnum >= 2) {
                    out.put(i, new Str(i, java.util.Arrays.copyOfRange(dg, i, j)));
                    // octets parasites devant un nom de fichier de scène (« $$s01a000s.hy8 ») : on ajoute aussi
                    // la chaîne amputée, que le code référence directement
                    int k = 0;
                    while (k < 3 && i + k < j && !Character.isLetterOrDigit(dg[i + k] & 0xff) && dg[i + k] != '%' && dg[i + k] != '\\' && dg[i + k] != '?') k++;
                    if (k > 0 && k < 3 && j - (i + k) >= 5 && (dg[i + k] == 's' || dg[i + k] == 'S')
                            && Character.isDigit(dg[i + k + 1]) && Character.isDigit(dg[i + k + 2]))
                        out.put(i + k, new Str(i + k, java.util.Arrays.copyOfRange(dg, i + k, j)));
                }
            }
            i = j + 1;
        }
        return out;
    }

    /**
     * Valeurs 16 bits que l'instruction peut utiliser comme offset DGROUP : constantes immédiates des
     * PUSH/MOV (type « imm ») et adresses absolues d'opérande mémoire en DGROUP (type « mem »).
     * Le résultat associe chaque offset à son type ; « imm » prime sur « mem ».
     */
    public static java.util.Map<Long, String> dgroupOperands(Program p, ghidra.program.model.listing.Instruction ins, long dgLinear, int dgSize) {
        java.util.Map<Long, String> out = new java.util.LinkedHashMap<>();
        String mn = ins.getMnemonicString();
        boolean immOk = mn.equals("PUSH") || mn.equals("MOV") || mn.equals("LEA") || mn.equals("PUSHD");
        for (int op = 0; op < ins.getNumOperands(); op++) {
            for (Object o : ins.getOpObjects(op)) {
                if (o instanceof ghidra.program.model.scalar.Scalar && immOk) {
                    long v = ((ghidra.program.model.scalar.Scalar) o).getUnsignedValue() & 0xffffL;
                    if (v < dgSize) out.putIfAbsent(v, "imm");
                } else if (o instanceof Address) {
                    long lin = ((Address) o).getOffset();
                    long off = lin - dgLinear;
                    if (off >= 0 && off < dgSize) out.putIfAbsent(off, "mem");
                }
            }
        }
        return out;
    }
}
