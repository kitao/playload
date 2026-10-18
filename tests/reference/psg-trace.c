// Test-only driver for the pinned, unmodified emu2149 source.
// A frame is one emu2149 sample at the given rate; the default 275 kHz is one tick of
// the default 2.2 MHz master clock / 8. Output per frame: three tone bits, noise bit,
// AY envelope level, followed by the little-endian noise state (four bytes).
#include "emu2149/emu2149.h"
#include <stdio.h>
#include <stdlib.h>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

int main(int argc, char **argv) {
#ifdef _WIN32
  if (_setmode(_fileno(stdout), _O_BINARY) == -1) return 4;
#endif
  if (argc != 6 && argc != 8 && argc != 9) return 2;
  unsigned count = (unsigned)strtoul(argv[1], NULL, 10);
  unsigned tone = (unsigned)strtoul(argv[2], NULL, 10);
  unsigned noise = (unsigned)strtoul(argv[3], NULL, 10);
  unsigned envelope = (unsigned)strtoul(argv[4], NULL, 10);
  unsigned shape = (unsigned)strtoul(argv[5], NULL, 10);
  if (count > 1000000 || tone > 4095 || noise > 31 || envelope > 65535 || shape > 15) return 2;
  unsigned rate = argc >= 8 ? (unsigned)strtoul(argv[6], NULL, 10) : 275000;
  unsigned clock = argc >= 8 ? (unsigned)strtoul(argv[7], NULL, 10) : 2200000;
  if (rate == 0 || clock == 0) return 2;
  PSG *psg = PSG_new(clock, rate);
  if (!psg) return 3;
  PSG_reset(psg); PSG_setVolumeMode(psg, 2);
  for (unsigned ch = 0; ch < 3; ch++) {
    PSG_writeReg(psg, ch * 2, tone & 255);
    PSG_writeReg(psg, ch * 2 + 1, tone >> 8);
    PSG_writeReg(psg, 8 + ch, 16);
  }
  PSG_writeReg(psg, 6, noise); PSG_writeReg(psg, 7, 0);
  PSG_writeReg(psg, 11, envelope & 255); PSG_writeReg(psg, 12, envelope >> 8);
  PSG_writeReg(psg, 13, shape);
  for (unsigned i = 0; i < count; i++) {
    // Optional test-only register stream: alternating longer/shorter periods.
    // Changes stay larger than the elapsed counter to avoid emu2149's
    // sample-rate-specific behavior when more than one edge is overdue.
    if (argc == 9 && i > 0 && i % 31 == 0) {
      unsigned updated = (i / 31) % 2 ? 31 : 7;
      for (unsigned ch = 0; ch < 3; ch++) {
        PSG_writeReg(psg, ch * 2, updated);
        PSG_writeReg(psg, ch * 2 + 1, 0);
      }
    }
    PSG_calc(psg);
    unsigned char frame[9] = {psg->edge[0], psg->edge[1], psg->edge[2], psg->noise_seed & 1, psg->env_ptr >> 1,
      psg->noise_seed & 255, (psg->noise_seed >> 8) & 255, (psg->noise_seed >> 16) & 255, (psg->noise_seed >> 24) & 255};
    if (fwrite(frame, 1, sizeof frame, stdout) != sizeof frame) return 4;
  }
  PSG_delete(psg); return 0;
}
