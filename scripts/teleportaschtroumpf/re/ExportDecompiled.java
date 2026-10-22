// Post-script : décompile chaque fonction et écrit le corpus d'étude.
//
// Sorties dans archives/teleportaschtroumpf/re/ :
//   decomp/<seg>_<off>_<nom>.c   une décompilation par fonction (en-tête de commentaires : taille,
//                                appelants, appelés, chaînes référencées)
//   functions.tsv                adresse, nom, type, taille, nb d'instructions, appelants, appelés,
//                                statut de décompilation, fichier
//
// Les constantes égales à l'offset d'une chaîne de DGROUP sont annotées dans le C :
//   0x1234 /* "s22a001d.mcg" */  (heuristique : seulement dans la fonction qui contient le PUSH/MOV).
//@category Teleportaschtroumpf.RE

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;

public class ExportDecompiled extends GhidraScript {
    private static final Pattern HEX = Pattern.compile("0x[0-9a-fA-F]{3,4}\\b");

    @Override
    protected void run() throws Exception {
        File out = ReCommon.outDir();
        File dir = new File(out, "decomp");
        dir.mkdirs();
        long dgLin = ReCommon.dgroupLinear(currentProgram);
        TreeMap<Integer, ReCommon.Str> strs = ReCommon.findStrings(ReCommon.dgroupBytes(currentProgram));

        DecompInterface ifc = new DecompInterface();
        ifc.toggleCCode(true);
        ifc.toggleSyntaxTree(false);
        if (!ifc.openProgram(currentProgram)) throw new IllegalStateException("décompileur : " + ifc.getLastMessage());

        StringBuilder tsv = new StringBuilder();
        tsv.append("# adresse\tnom\ttype\ttaille_octets\tnb_instructions\tappelants\tappeles\tdecompilation\tfichier\n");
        Map<String, Integer> stat = new TreeMap<>();
        int n = 0;
        for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
            n++;
            String addr = ReCommon.addr(currentProgram, f.getEntryPoint());
            String name = f.getName();
            String kind = name.startsWith("lib_") ? "lib"
                    : name.startsWith("frag_") ? "fragment"
                    : addr.startsWith("1000:") ? "rtl" // code Borland (startup + bibliothèque) non identifié
                    : "func";
            long size = f.getBody().getNumAddresses();
            int nins = 0;
            // chaînes référencées (heuristique) par les instructions de la fonction
            Map<Integer, String> mine = new LinkedHashMap<>();
            for (Instruction ins : currentProgram.getListing().getInstructions(f.getBody(), true)) {
                nins++;
                boolean nearDs = false;
                for (Map.Entry<Long, String> e : ReCommon.dgroupOperands(currentProgram, ins, dgLin, 0x10000).entrySet()) {
                    int v = (int) (long) e.getKey();
                    ReCommon.Str s = strs.get(v);
                    if (s == null) continue;
                    if (v < 0x200 && e.getValue().equals("imm")) {
                        Instruction p = ins.getPrevious();
                        Instruction nx = ins.getNext();
                        nearDs = (p != null && (p.toString().equals("PUSH DS") || p.toString().endsWith(",DS")))
                                || (nx != null && (nx.toString().equals("PUSH DS") || nx.toString().endsWith(",DS")));
                        if (!nearDs) continue;
                    }
                    mine.putIfAbsent(v, s.text());
                }
            }
            TreeSet<String> callers = new TreeSet<>(), callees = new TreeSet<>();
            for (Function c : f.getCallingFunctions(monitor)) callers.add(ReCommon.addr(currentProgram, c.getEntryPoint()));
            for (Function c : f.getCalledFunctions(monitor)) callees.add(ReCommon.addr(currentProgram, c.getEntryPoint()));

            String status;
            String body;
            try {
                DecompileResults res = ifc.decompileFunction(f, 90, monitor);
                if (res == null || !res.decompileCompleted() || res.getDecompiledFunction() == null) {
                    status = res != null && res.isTimedOut() ? "timeout" : "erreur";
                    body = "/* échec de décompilation : " + (res == null ? "?" : res.getErrorMessage()) + " */\n";
                } else {
                    body = res.getDecompiledFunction().getC();
                    status = (body.contains("halt_baddata") || body.contains("Bad instruction") || body.contains("bad instruction data")
                            || body.contains("Could not recover jumptable") || body.contains("Treating indirect jump as call")) ? "partielle" : "ok";
                }
            } catch (Exception e) {
                status = "erreur";
                body = "/* exception : " + e + " */\n";
            }
            stat.merge(status, 1, Integer::sum);

            // annotation des offsets de chaînes dans le code C
            Matcher m = HEX.matcher(body);
            StringBuffer sb = new StringBuffer();
            while (m.find()) {
                int v = Integer.parseInt(m.group().substring(2), 16);
                String s = mine.get(v);
                m.appendReplacement(sb, Matcher.quoteReplacement(s == null ? m.group() : m.group() + " /* \"" + trunc(s) + "\" */"));
            }
            m.appendTail(sb);

            String file = addr.replace(':', '_') + "_" + (name.startsWith("FUN_") ? "fun" : name.replaceAll("[^A-Za-z0-9_]", "_")) + ".c";
            StringBuilder hdr = new StringBuilder();
            hdr.append("/* ").append(addr).append(' ').append(name).append(" (").append(kind).append(") ; ").append(size)
               .append(" octets, ").append(nins).append(" instructions ; décompilation : ").append(status).append(" */\n");
            hdr.append("/* appelants : ").append(callers.isEmpty() ? "-" : String.join(" ", callers)).append(" */\n");
            hdr.append("/* appelés   : ").append(callees.isEmpty() ? "-" : String.join(" ", callees)).append(" */\n");
            if (!mine.isEmpty()) {
                hdr.append("/* chaînes référencées (heuristique, DS=").append(String.format("%04x", ReCommon.dgroupSegment(currentProgram))).append(") :\n");
                for (Map.Entry<Integer, String> e : mine.entrySet())
                    hdr.append(" *   ").append(String.format("%04x", e.getKey())).append("  \"").append(trunc(ReCommon.esc(e.getValue()))).append("\"\n");
                hdr.append(" */\n");
            }
            ReCommon.write(new File(dir, file), hdr + sb.toString());

            tsv.append(addr).append('\t').append(name).append('\t').append(kind).append('\t').append(size).append('\t').append(nins)
               .append('\t').append(String.join(",", callers)).append('\t').append(String.join(",", callees))
               .append('\t').append(status).append('\t').append(file).append('\n');
            if (n % 100 == 0) println("[re] décompilé " + n);
        }
        ifc.dispose();
        ReCommon.write(new File(out, "functions.tsv"), tsv.toString());
        println("[re] fonctions décompilées : " + n + " ; statuts : " + stat);
    }

    private static String trunc(String s) {
        s = s.replace("*/", "* /").replace("\"", "'");
        return s.length() > 70 ? s.substring(0, 70) + "..." : s;
    }
}
