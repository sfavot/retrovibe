// Harnais de référence : le vrai MidiDriver_ADLIB_Multisource / MidiDriver_ADLIB_Lure (extraits verbatim de ScummVM), le vrai
// MidiParser_SMF, un OPL « journal » à la place de l'émulateur. Journalise (tick, registre, valeur).
#include <unistd.h>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <string>
#include <fstream>
#include <sstream>
#define FORBIDDEN_SYMBOL_ALLOW_ALL
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <string>
#include <fstream>
#include <sstream>
#define FORBIDDEN_SYMBOL_ALLOW_ALL
#define protected public
#define private public
#include "common/scummsys.h"
#include "common/file.h"
#include "audio/adlib_ms.h"
#include "audio/midiparser.h"
#include "audio/fmopl.h"
#undef protected
#undef private

#define LURE_MAX_SOURCES 10
namespace Lure {
#include "lure_driver_decl.inc"
#include "lure_driver_impl.inc"
}

static long g_tick = 0;
class LogOpl : public OPL::OPL, public Audio::RealChip {
public:
	bool init() override { return true; }
	void reset() override {}
	void write(int a, int v) override {}
	void writeReg(int r, int v) override { printf("%ld %d %d\n", g_tick, r, v); }
};

class GDrv : public MidiDriver_ADLIB_Multisource {
public:
	OplInstrumentDefinition bank[128];
	GDrv() : MidiDriver_ADLIB_Multisource(OPL::Config::kOpl2) { memset(bank, 0, sizeof(bank)); _instrumentBank = bank; }
	void openLog() {
		_opl = new LogOpl();
		_isOpen = true;
		determineMelodicChannels();
		for (int i = 0; i < MAXIMUM_SOURCES; i++) {
			for (int j = 0; j < MIDI_CHANNEL_COUNT; j++)
				_controlData[i][j].volume = _defaultChannelVolume;
			applyControllerDefaults(i);
		}
		initOpl();
	}
	void tick() { onTimer(); }
};
class Drv : public Lure::MidiDriver_ADLIB_Lure {
public:
	void openLog() {
		_opl = new LogOpl();
		_isOpen = true;
		determineMelodicChannels();
		for (int i = 0; i < MAXIMUM_SOURCES; i++) {
			for (int j = 0; j < MIDI_CHANNEL_COUNT; j++)
				_controlData[i][j].volume = _defaultChannelVolume;
			applyControllerDefaults(i);
		}
		initOpl();
	}
	void tick() { onTimer(); }
};

// Équivalent de MidiMusic (sound.cpp) sans les ressources du jeu : mêmes appels au pilote et à l'analyseur.
class Music : public MidiDriver_BASE {
public:
	MidiDriver_ADLIB_Multisource *_driver; int8 _source; MidiParser *_parser; bool _isPlaying; bool _loop;
	std::vector<uint8> _data;
	Music(MidiDriver_ADLIB_Multisource *d, int8 source, bool loop, const std::vector<uint8> &data) : _driver(d), _source(source), _loop(loop), _data(data) {
		_parser = MidiParser::createParser_SMF(source);
		_parser->setMidiDriver(this);
		_parser->setTimerRate(_driver->getBaseTempo());
		_parser->property(MidiParser::mpDisableAllNotesOffMidiEvents, 1);
		_parser->property(MidiParser::mpAutoLoop, _loop);
		_parser->loadMusic(_data.data(), _data.size());
		_parser->setTrack(0);
		_isPlaying = true;
	}
	~Music() override {
		_parser->unloadMusic();
		if (_isPlaying) _driver->deinitSource(_source);
		delete _parser;
	}
	void send(uint32 b) override { send(-1, b); }
	void send(int8 source, uint32 b) override { _driver->send(source, b); }
	void metaEvent(byte type, const byte *data, uint16 length) override { metaEvent(-1, type, data, length); }
	void metaEvent(int8 source, byte type, const byte *data, uint16 length) override {
		if (type == MIDI_META_END_OF_TRACK) stopMusic();
		_driver->metaEvent(source, type, data, length);
	}
	void onTimer() { if (_isPlaying) _parser->onTimer(); }
	void stopMusic() { _isPlaying = false; _parser->unloadMusic(); _driver->deinitSource(_source); }
};

static std::vector<uint8> readFile(const std::string &p) {
	std::ifstream f(p, std::ios::binary);
	return std::vector<uint8>((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
}
static std::vector<uint8> hex(const std::string &s) {
	std::vector<uint8> v; std::istringstream is(s); std::string t;
	while (is >> t) v.push_back((uint8)strtol(t.c_str(), nullptr, 16));
	return v;
}

struct Cmd { long tick; std::string line; };

int main(int argc, char **argv) {
	// scénario : lignes "tick play source fichier boucle" | "tick stop source" | "tick raw source octets-hex" | "tick meta source type octets-hex" | "tick stopall" | "end tick"
	std::ifstream f(argv[1]);
	std::vector<Cmd> cmds; std::vector<std::string> header; long endTick = 0; long autoExtra = -1; std::string line;
	while (std::getline(f, line)) {
		if (line.empty() || line[0] == '#') continue;
		std::istringstream is(line); std::string a; is >> a;
		if (a == "end") { std::string v; is >> v; if (v == "auto") { is >> autoExtra; endTick = 100000000; } else endTick = atol(v.c_str()); continue; }
		if (a == "driver" || a == "bank") { header.push_back(line); continue; }
		cmds.push_back({atol(a.c_str()), line.substr(line.find(' ') + 1)});
	}
	Drv ldrv; GDrv gdrv; bool generic = false; bool gstatic = false;
	for (auto &c : cmds) {
		std::istringstream is(c.line); std::string op; is >> op;
		(void)op;
	}
	MidiDriver_ADLIB_Multisource *dp;
	if (!header.empty()) {
		for (auto &h : header) {
			std::istringstream is(h); std::string op; is >> op;
			if (op == "driver") { std::string k; is >> k; generic = (k != "lure"); gstatic = (k == "generic-static"); }
			else if (op == "bank") { int p; is >> p; std::string rest; std::getline(is, rest); auto b = hex(rest); AdLibBnkInstrumentDefinition d; memcpy(&d, b.data(), sizeof(d)); d.toOplInstrumentDefinition(gdrv.bank[p]); }
		}
	}
	if (generic) { if (gstatic) gdrv._allocationMode = MidiDriver_ADLIB_Multisource::ALLOCATION_MODE_STATIC; gdrv.openLog(); dp = &gdrv; } else { ldrv.openLog(); dp = &ldrv; }
	MidiDriver_ADLIB_Multisource &drv = *dp;
	std::vector<Music *> musics(10, nullptr);
	for (g_tick = 1; g_tick <= endTick; g_tick++) {
		for (auto &c : cmds) {
			if (c.tick != g_tick) continue;
			std::istringstream is(c.line); std::string op; is >> op;
			if (op == "play") { int s; std::string file; int loop; is >> s >> file >> loop; delete musics[s]; musics[s] = new Music(dp, s, loop != 0, readFile(file)); }
			else if (op == "stop") { int s; is >> s; delete musics[s]; musics[s] = nullptr; }
			else if (op == "raw") { int s; is >> s; std::string rest; std::getline(is, rest); auto b = hex(rest); uint32 w = b[0] | (b.size() > 1 ? b[1] << 8 : 0) | (b.size() > 2 ? b[2] << 16 : 0); drv.send(s, w); }
			else if (op == "meta") { int s; std::string type; is >> s >> type; std::string rest; std::getline(is, rest); auto b = hex(rest); drv.metaEvent(s, (byte)strtol(type.c_str(), nullptr, 16), b.data(), b.size()); }
			else if (op == "stopall") { drv.stopAllNotes(); }
			else if (op == "srcvol") { int s, v; is >> s >> v; drv.setSourceVolume(s, v); }
			else if (op == "fade") { int d, t; is >> d >> t; drv.startFade(d, t); }
			else if (op == "uservol") { int m, v; is >> m >> v; drv._userVolumeScaling = true; drv._userMusicVolume = m; drv._userSfxVolume = v; drv.applySourceVolume(0xFF); }
		}
		dp == &ldrv ? ldrv.tick() : gdrv.tick();
		for (int i = 0; i < 10; i++) if (musics[i]) musics[i]->onTimer();
		if (autoExtra >= 0) {
			long maxCmd = 0; for (auto &c : cmds) if (c.tick > maxCmd) maxCmd = c.tick;
			bool any = false; for (int i = 0; i < 10; i++) if (musics[i] && musics[i]->_isPlaying) any = true;
			static long idle = 0;
			if (!any && g_tick >= maxCmd) { if (++idle > autoExtra) break; } else idle = 0;
		}
	}
	fflush(stdout); _exit(0);
}

namespace Common {
class NullMutex : public MutexInternal { public: bool lock() override { return true; } bool unlock() override { return true; } };
Mutex::Mutex() { _mutex = new NullMutex(); }
Mutex::~Mutex() { delete _mutex; }
bool Mutex::lock() { return true; }
bool Mutex::unlock() { return true; }
StackLock::StackLock(MutexInternal *mutex, const char *n) : _mutex(mutex), _mutexName(n) {}
StackLock::StackLock(const Mutex &mutex, const char *n) : _mutex(mutex._mutex), _mutexName(n) {}
StackLock::~StackLock() {}
bool StackLock::lock() { return true; }
bool StackLock::unlock() { return true; }
}
