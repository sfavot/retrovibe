// Utilitaires partagés par les scripts Ghidra de rétro-ingénierie (scripts/re/ et scripts/<jeu>/re/).
// Ce n'est pas un GhidraScript : simple classe d'aide (Ghidra la compile avec les scripts voisins).
//
// Pensé pour les exécutables DOS MZ 16 bits en real mode ; rien n'y suppose un jeu ou un compilateur
// précis. Les particularités d'un jeu passent par des variables d'environnement posées par son run.sh :
//   RE_OUT              dossier de sortie (obligatoire)
//   RE_DGROUP           segment de DGROUP en hexadécimal (ex. 1a3c) ; à défaut, détecté par le startup
//                       Borland (« MOV DX, imm16 » à l'entrée), ce qui ne marche pas avec Microsoft C
//   RE_RTL_SEG          segment hexadécimal du code de bibliothèque/startup (ex. 1000) : fonctions
//                       typées « rtl » et exclues des références de tables de chaînes ; vide = aucun
//   RE_STR_ALIAS_REGEX  regex (Java) : une chaîne précédée de 1 à 2 octets parasites dont le reste
//                       correspond est aussi publiée sans ces octets ; vide = aucune
//
// Mode « plat 32 bits » (exécutables PE, programme dont l'espace d'adresses par défaut n'est pas
// segmenté) : détecté automatiquement par isFlat(). Il n'y a alors ni segment ni DGROUP ; la « zone de
// données » que parcourent les exports est l'étendue des blocs initialisés non exécutables (hors
// RE_FLAT_EXCLUDE, liste de noms de blocs séparés par des virgules ; défaut : .reloc,.idata,.rsrc), les
// adresses s'écrivent sur 8 chiffres hexadécimaux et les chaînes sont référencées par leur adresse
// absolue. Le chemin 16 bits n'est pas modifié.
//
// Mode « NE protégé 16 bits » (exécutables Win16, loader NE de Ghidra) : détecté par isNe(). Les adresses
// sont des « sélecteur:offset » du loader (1000, 1008, 1010...), sans lien linéaire entre segments ; les
// données sont les blocs Data<n> (DGROUP = le plus gros), les chaînes sont en CP1252. Les fonctions
// d'aide de ce mode sont regroupées en fin de classe (préfixe ne*). RE_PROG (facultatif) : sous-dossier de
// RE_OUT, pour plusieurs programmes dans un même corpus.

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

import ghidra.program.model.address.Address;
import ghidra.program.model.address.SegmentedAddress;
import ghidra.program.model.address.SegmentedAddressSpace;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryAccessException;
import ghidra.program.model.mem.MemoryBlock;

public final class ReCommon {
    private ReCommon() {}

    /** Variable d'environnement non vide, ou null. */
    public static String env(String name) {
        String s = System.getenv(name);
        return s == null || s.isEmpty() ? null : s;
    }

    /** Dossier de sortie : variable d'environnement RE_OUT (posée par run.sh), plus RE_PROG s'il est posé. */
    public static File outDir() {
        String s = env("RE_OUT");
        if (s == null) throw new IllegalStateException("RE_OUT non défini (voir scripts/re/run-lib.sh)");
        String prog = env("RE_PROG");
        File d = prog == null ? new File(s) : new File(s, prog);
        d.mkdirs();
        return d;
    }

    /** Préfixe « seg: » du code de bibliothèque/startup (RE_RTL_SEG), ou null. */
    public static String rtlPrefix() {
        String s = env("RE_RTL_SEG");
        return s == null ? null : s.toLowerCase() + ":";
    }

    /** Vrai pour un programme plat (PE 32 bits) : l'espace d'adresses par défaut n'est pas segmenté. */
    public static boolean isFlat(Program p) {
        return !(p.getAddressFactory().getDefaultAddressSpace() instanceof SegmentedAddressSpace);
    }

    /** Plus petite valeur immédiate prise pour une référence de chaîne sans « PUSH DS » voisin (16 bits seulement). */
    public static long smallImm(Program p) {
        return isFlat(p) ? 0 : 0x200;
    }

    private static boolean flatExcluded(MemoryBlock b) {
        String ex = env("RE_FLAT_EXCLUDE");
        for (String n : (ex == null ? ".reloc,.idata,.rsrc" : ex).split(",")) {
            if (b.getName().equalsIgnoreCase(n.trim())) return true;
        }
        return false;
    }

    private static boolean flatDataBlock(MemoryBlock b) {
        return b.isInitialized() && !b.isExecute() && !b.getName().toUpperCase().startsWith("HEADER") && !flatExcluded(b);
    }

    /** Mode plat : adresse de début de la zone de données (premier bloc initialisé non exécutable). */
    private static long flatBase(Program p) {
        long lo = Long.MAX_VALUE;
        for (MemoryBlock b : p.getMemory().getBlocks()) {
            if (flatDataBlock(b)) lo = Math.min(lo, b.getStart().getOffset());
        }
        if (lo == Long.MAX_VALUE) throw new IllegalStateException("aucun bloc de données initialisé");
        return lo;
    }

    /** Mode plat : contenu de la zone de données ; les trous (BSS, blocs exclus) valent 0. */
    private static byte[] flatBytes(Program p) throws MemoryAccessException {
        long base = flatBase(p);
        long end = base;
        for (MemoryBlock b : p.getMemory().getBlocks()) {
            if (flatDataBlock(b)) end = Math.max(end, b.getEnd().getOffset() + 1);
        }
        byte[] out = new byte[(int) (end - base)];
        for (MemoryBlock b : p.getMemory().getBlocks()) {
            if (!flatDataBlock(b)) continue;
            byte[] tmp = new byte[(int) b.getSize()];
            b.getBytes(b.getStart(), tmp);
            System.arraycopy(tmp, 0, out, (int) (b.getStart().getOffset() - base), tmp.length);
        }
        return out;
    }

    /** Adresse affichée d'une chaîne (offset dans la zone de données) : « seg:off » en 16 bits, 8 chiffres en plat. */
    public static String strAddr(Program p, int off) throws MemoryAccessException {
        if (isFlat(p)) return String.format("%08x", flatBase(p) + off);
        return String.format("%04x:%04x", dgroupSegment(p), off);
    }

    public static SegmentedAddressSpace space(Program p) {
        return (SegmentedAddressSpace) p.getAddressFactory().getDefaultAddressSpace();
    }

    /**
     * Segment DGROUP : RE_DGROUP s'il est posé ; sinon le startup Borland commence par
     * « MOV DX, imm16 » (opcode BA) à l'entrée. On lit l'octet directement (valable même avant le
     * désassemblage).
     */
    public static int dgroupSegment(Program p) throws MemoryAccessException {
        if (isFlat(p)) return 0;
        String forced = env("RE_DGROUP");
        if (forced != null) return Integer.parseInt(forced, 16);
        Address entry = p.getSymbolTable().getExternalEntryPointIterator().next();
        byte[] b = new byte[3];
        p.getMemory().getBytes(entry, b);
        if ((b[0] & 0xff) != 0xBA) throw new IllegalStateException("startup Borland inattendu à l'entrée " + entry + " (poser RE_DGROUP)");
        return (b[1] & 0xff) | ((b[2] & 0xff) << 8);
    }

    /** Adresse linéaire (seg*16) du début de DGROUP. */
    public static long dgroupLinear(Program p) throws MemoryAccessException {
        if (isFlat(p)) return flatBase(p);
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
        if (isFlat(p)) return flatBytes(p);
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
        if (isNe(p)) return neAddr(a);
        if (isFlat(p)) return String.format("%08x", a.getOffset());
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
        private final java.nio.charset.Charset charset;
        public Str(int off, byte[] raw) { this(off, raw, IBM437); }
        public Str(int off, byte[] raw, java.nio.charset.Charset charset) { this.off = off; this.raw = raw; this.charset = charset; }
        public int end() { return off + raw.length; }
        /** Texte lisible : ASCII tel quel, octets >= 0x80 décodés en CP437 (CP1252 en mode NE). */
        public String text() { return new String(raw, charset); }
    }

    private static boolean strByte(int b, int highMin) {
        return (b >= 0x20 && b <= 0x7e) || b == '\n' || b == '\r' || b == '\t' || (b >= highMin && b != 0xff);
    }

    /**
     * Chaînes terminées par NUL de DGROUP : suites d'au moins 3 octets imprimables (ASCII, retours,
     * CP437) contenant au moins 2 caractères alphanumériques ASCII ou « % ». Clé = offset de début.
     * La recherche suit les NUL : une chaîne commence juste après un octet non imprimable.
     */
    public static java.util.TreeMap<Integer, Str> findStrings(byte[] dg) {
        return findStrings(dg, false);
    }

    /** Variante : flat = true pour la zone de données d'un PE (voir minLen ci-dessous). */
    public static java.util.TreeMap<Integer, Str> findStrings(byte[] dg, boolean flat) {
        String re = env("RE_STR_ALIAS_REGEX");
        java.util.regex.Pattern alias = re == null ? null : java.util.regex.Pattern.compile(re, java.util.regex.Pattern.DOTALL);
        // plat : les données d'un PE sont plus bruitées (tables, flottants) ; on exige 4 caractères et 3 alphanumériques
        // (mode 16 bits : 3 et 2, inchangé)
        int minLen = flat ? 4 : 3;
        int minAlnum = minLen == 4 ? 3 : 2;
        return scanStrings(dg, minLen, minAlnum, 0x80, alias, IBM437);
    }

    private static final java.nio.charset.Charset IBM437 = java.nio.charset.Charset.forName("IBM437");

    private static java.util.TreeMap<Integer, Str> scanStrings(byte[] dg, int minLen, int minAlnum, int highMin,
            java.util.regex.Pattern alias, java.nio.charset.Charset cs) {
        java.util.TreeMap<Integer, Str> out = new java.util.TreeMap<>();
        int i = 0;
        while (i < dg.length) {
            if (!strByte(dg[i] & 0xff, highMin)) { i++; continue; }
            int j = i;
            while (j < dg.length && strByte(dg[j] & 0xff, highMin)) j++;
            boolean nul = j < dg.length && dg[j] == 0;
            int len = j - i;
            if (nul && len >= minLen) {
                int alnum = 0;
                for (int k = i; k < j; k++) {
                    int c = dg[k] & 0xff;
                    if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '%') alnum++;
                }
                if (alnum >= minAlnum) {
                    out.put(i, new Str(i, java.util.Arrays.copyOfRange(dg, i, j), cs));
                    // octets parasites devant une chaîne que le code référence directement sans eux
                    // (ex. « $$s01a000s.hy8 ») : si RE_STR_ALIAS_REGEX correspond au reste, on ajoute
                    // aussi la chaîne amputée
                    if (alias != null) {
                        int k = 0;
                        while (k < 3 && i + k < j && !Character.isLetterOrDigit(dg[i + k] & 0xff) && dg[i + k] != '%' && dg[i + k] != '\\' && dg[i + k] != '?') k++;
                        if (k > 0 && k < 3 && alias.matcher(new String(dg, i + k, j - (i + k), java.nio.charset.StandardCharsets.ISO_8859_1)).matches())
                            out.put(i + k, new Str(i + k, java.util.Arrays.copyOfRange(dg, i + k, j), cs));
                    }
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
        boolean flat = isFlat(p);
        String mn = ins.getMnemonicString();
        boolean immOk = mn.equals("PUSH") || mn.equals("MOV") || mn.equals("LEA") || mn.equals("PUSHD");
        for (int op = 0; op < ins.getNumOperands(); op++) {
            for (Object o : ins.getOpObjects(op)) {
                if (o instanceof ghidra.program.model.scalar.Scalar && immOk) {
                    long v = flat ? (((ghidra.program.model.scalar.Scalar) o).getUnsignedValue() & 0xffffffffL) - dgLinear
                                  : ((ghidra.program.model.scalar.Scalar) o).getUnsignedValue() & 0xffffL;
                    if (v >= 0 && v < dgSize) out.putIfAbsent(v, "imm");
                } else if (o instanceof Address) {
                    long lin = ((Address) o).getOffset();
                    long off = lin - dgLinear;
                    if (off >= 0 && off < dgSize) out.putIfAbsent(off, "mem");
                }
            }
        }
        return out;
    }

    // ------------------------------------------------------------------------------------------
    // Mode NE protégé 16 bits (Win16) : sélecteur:offset du loader NE, blocs Data<n>
    // ------------------------------------------------------------------------------------------

    private static Program neProgram;
    private static boolean neValue;

    /** Vrai pour un exécutable NE (Win16) : « New Executable (NE) » est le nom du loader de Ghidra. */
    public static boolean isNe(Program p) {
        if (p != neProgram) {
            String fmt = p.getExecutableFormat();
            neValue = fmt != null && fmt.contains("(NE)");
            neProgram = p;
        }
        return neValue;
    }

    /** « sel:off » de Ghidra (mode protégé : les sélecteurs du loader NE sont 1000, 1008, 1010...). */
    public static String neAddr(Address a) {
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
    public static String neCalleeName(Program p, ghidra.program.model.listing.Function c) {
        String t = thunkLabel(c);
        return t != null ? t : addr(p, c.getEntryPoint());
    }

    public static boolean isCode(Program p, Address a) {
        MemoryBlock b = p.getMemory().getBlock(a);
        return b != null && b.isExecute();
    }

    /** Blocs de données initialisés (segments de données du NE : Data<n>). */
    public static List<MemoryBlock> neDataBlocks(Program p) {
        List<MemoryBlock> l = new ArrayList<>();
        for (MemoryBlock b : p.getMemory().getBlocks()) {
            if (b.isInitialized() && !b.isExecute() && b.getName().startsWith("Data")) l.add(b);
        }
        return l;
    }

    /** Segment de données automatique (DGROUP) : le plus gros bloc de données ; null s'il n'y en a pas. */
    public static MemoryBlock neDgroup(Program p) {
        MemoryBlock best = null;
        for (MemoryBlock b : neDataBlocks(p)) if (best == null || b.getSize() > best.getSize()) best = b;
        return best;
    }

    /** Sélecteur (partie segment) du début d'un bloc. */
    public static int selector(MemoryBlock b) {
        return ((SegmentedAddress) b.getStart()).getSegment();
    }

    /** Sélecteur de DGROUP (DS), ou -1 s'il n'y a pas de segment de données. */
    public static int neDgroupSelector(Program p) {
        MemoryBlock b = neDgroup(p);
        return b == null ? -1 : selector(b);
    }

    /** Chaînes d'un bloc de données NE : CP1252, octets >= 0xa0 seulement au-delà de l'ASCII. */
    public static java.util.TreeMap<Integer, Str> neFindStrings(byte[] block) {
        return scanStrings(block, 3, 2, 0xa0, null, java.nio.charset.Charset.forName("windows-1252"));
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
    public static java.util.Map<Long, String> neDataOperands(ghidra.program.model.listing.Instruction ins, MemoryBlock dg) {
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
    public static boolean neNearDs(ghidra.program.model.listing.Instruction ins) {
        ghidra.program.model.listing.Instruction p = ins.getPrevious(), n = ins.getNext();
        ghidra.program.model.listing.Instruction[] xs = { p, n, p == null ? null : p.getPrevious(), n == null ? null : n.getNext() };
        for (ghidra.program.model.listing.Instruction x : xs) {
            if (x == null) continue;
            String t = x.toString();
            if (t.equals("PUSH DS") || t.equals("PUSH SS") || t.endsWith(",DS") || t.endsWith(",SS")) return true;
        }
        return false;
    }

    /**
     * Offsets de chaînes de `strs` (chaînes du bloc DGROUP) que l'instruction référence par une constante
     * (« imm ») ou un opérande mémoire (« mem »), avec leur type. Une petite constante (< 0x200) n'est
     * prise que près d'un PUSH DS.
     */
    public static java.util.LinkedHashMap<Integer, String> neStringOperands(ghidra.program.model.listing.Instruction ins,
            MemoryBlock dg, java.util.Map<Integer, Str> strs) {
        java.util.LinkedHashMap<Integer, String> out = new java.util.LinkedHashMap<>();
        boolean nearDs = neNearDs(ins);
        for (java.util.Map.Entry<Long, String> e : neDataOperands(ins, dg).entrySet()) {
            int v = (int) (long) e.getKey();
            if (!strs.containsKey(v)) continue;
            if (v < 0x200 && e.getValue().equals("imm") && !nearDs) continue;
            out.put(v, e.getValue());
        }
        return out;
    }
}
