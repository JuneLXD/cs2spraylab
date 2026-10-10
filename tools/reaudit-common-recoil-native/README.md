# Current native common-weapon recoil tables

Reproduce both 64-entry native modes for AK-47, M4A4, M4A1-S, AWP, Glock,
USP-S and Desert Eagle, plus 224 RNG draws. This package reads the exact
installed Linux server and tier0 artifacts, follows their typed RNG imports,
parses retained native weapon data, and executes the selected arithmetic in
private Unicorn memory. It never loads a native library into the host process
or launches the game.

From the repository root, after obtaining the shared host execution slot:

```sh
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% \
  python3 -B tools/reaudit-common-recoil-native/run.py \
  --root /home/junel/Desktop/cs2 \
  --output /home/junel/Desktop/cs2/native-audit/reports/common-recoil-reproduction-NEW
```

`--output` must not exist. `--root` defaults from the script location for both
the normal checkout and worktrees immediately under `native-audit`. The root
must contain `cs2-game`, retained reports and the installed Python dependencies
under `native-audit/python` (Capstone, pyelftools and Unicorn). Node is used only
for the native KV3 parser; all five stages are serial children of the same cap.
Every stage stops on failed identity or boundary assertions, preserving its
log without retries. Optional `--portable-report NEW.json` writes an additional
sanitized copy; the local `portable-evidence.json` is always written.

Required retained inputs are the native `weapons.vdata` from `common-burst-next`,
its pass39 identity report from `awp-clocks-next`, and the original proof plus
trainer comparison under `core-shooting-next/common-recoil-table`. These files
are inputs, never outputs. Original script/result hashes are verified unchanged
after replay. A different build intentionally fails the exact hash guards.

The reader stages inspect the known cache caller, its directly bound arithmetic
helper, selected PLT imports, and exact-name tier0 exports. They record 2,826
selected bytes separately from streamed artifact hashes and typed ELF metadata
traversal. There is no code discovery scan. Native raw ranges and disassembly
remain only in local outputs.

The emulator begins after resource lookup with supplied caller state and ends
before the epilogue. Only the selected arithmetic blocks, actual RNG exports and
bound PLT instructions may execute. Instruction and data guards reject unknown
access; each call has a 200,000-instruction limit. Supplied resource fields are
read-only, output writes cover exactly the two tables, and RNG/stack storage is
private and bounded. GOT pointers bind the actual native exports. No numerical
function is replaced with Python, JavaScript or a guessed return value.

Parameter values come from the native export, including both authored modes,
the full-auto flag and recoil seed. Desert Eagle's authored scalar zero angle
is explicitly supplied as zero to both fields. No absent field falls back to
trainer data. Current paired-load code and retained schema interpretation bind
the resource field layout; live resource construction is outside this replay.

`tables` means raw mode 0; `alternateTables` means raw mode 1. The trainer's
default M4A1-S and USP-S use native mode 1. The existing separate comparator
checks both every raw mode and actual supported trainer mappings. Packaging
verifies that its new output has the same float32 bits and input values as the
immutable original used by that comparator; it does not pretend the comparator
ran again. Both report hashes remain in the portable manifest.

This proves table/RNG arithmetic at supplied native data. It does not establish
the per-command seed producer, table selection, fire clocks, aim punch or camera
behavior. Older Windows fixtures and their build guards remain untouched.
