#!/bin/sh
# Compile le harnais de référence : le vrai pilote AdLib de ScummVM (adlib_ms.cpp, mididrv_ms.cpp, midiparser*.cpp compilés par ScummVM) et
# MidiDriver_ADLIB_Lure (extrait tel quel de engines/lure/sound.h / sound.cpp à la compilation, jamais copié dans le dépôt), avec un OPL
# « journal » à la place de l'émulateur. Usage : SCUMMVM_SRC=<sources de ScummVM> SCUMMVM_OUT=<dossier de compilation de ScummVM, avec
# audio/*.o et common/libcommon.a> sh build.sh <dossier de travail>
set -e
work="${1:?dossier de travail}"; mkdir -p "$work"; here="$(cd "$(dirname "$0")" && pwd)"
S="${SCUMMVM_SRC:?}"; O="${SCUMMVM_OUT:?}"
start=$(grep -n "^class MidiDriver_ADLIB_Lure" "$S/engines/lure/sound.h" | cut -d: -f1)
sed -n "${start},$((start+28))p" "$S/engines/lure/sound.h" > "$work/lure_driver_decl.inc"
first=$(grep -n "Note that the values higher than 0xF000" "$S/engines/lure/sound.cpp" | cut -d: -f1)
last=$(grep -n "End of namespace Lure" "$S/engines/lure/sound.cpp" | cut -d: -f1)
sed -n "${first},$((last-1))p" "$S/engines/lure/sound.cpp" > "$work/lure_driver_impl.inc"
cp "$here/harness.cpp" "$here/stubs.c" "$work/"
cd "$work"
cc -c stubs.c -o stubs.o
g++ -std=c++11 -O1 -DHAVE_CONFIG_H -DMACOSX -DPOSIX -DHAS_FSEEKO_OFFT_64 -w -I"$O" -I"$S" -I"$S/engines" -I. harness.cpp -c -o harness.o
g++ harness.o stubs.o "$O/audio/adlib_ms.o" "$O/audio/mididrv_ms.o" "$O/audio/midiparser.o" "$O/audio/midiparser_smf.o" "$O/audio/mididrv.o" "$O/audio/chip.o" "$O/audio/fmopl.o" "$O/common/libcommon.a" -framework CoreFoundation -lz -Wl,-undefined,dynamic_lookup -o harness
