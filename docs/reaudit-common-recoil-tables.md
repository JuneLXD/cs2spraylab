# Current Linux common-weapon recoil tables — pass 43

The trainer's table generator and numeric random stream match the current
Linux native arithmetic for AK-47, M4A4, M4A1-S, AWP, Glock, USP-S and Deagle.
No recoil magnitude, pattern smoothing or suppression correction is needed.

The comparison executes the actual trainer functions, not a second authored
formula. All 896 native table entries across two raw modes match bit for bit:
1,792 angle/magnitude values, zero absolute error and zero ULP difference.
All 224 separate random samples across 14 supplied seeds also match bit for bit.
The supported primary/alternate imports match their selected native modes in
84 parameter comparisons and a separate 896-entry consumer comparison. These
checks overlap; they are not 1,792 distinct native table entries.

## Native execution and provenance

The native oracle uses the current Linux server SHA-256
`c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`
and tier0 SHA-256
`a3d4f81bb46eeca0d1d0a60a0c3bb3661a6398888359d0121ac795c6bd40d5af`.
Both complete hashes are checked before reading or emulating selected bytes.
The current table-cache miss binds the arithmetic helper. Its imports bind
the actual tier0 stream constructor, floating sampler and integer generator
through the ELF relocation/export tables.

Unicorn executes the selected native instructions in private memory. The
table phase invokes 14 constructors, 1,792 floating samples and 1,792 integer
generator calls, with 138,068 executed instructions and 23 mapped pages.
No RNG result or table arithmetic is replaced by an authored numeric stub.
Private import pointers bind the exact selected native functions. Unexpected
calls, exits, mapped regions or instruction budgets fail the probe.

Inputs come from the retained native weapon export, SHA-256
`46e7a84b46c620e8daf11c403ee9152a5faa1a033407748b527862aa3147236b`,
whose compiled-resource identity was established in pass 39. The exporter
retains both native mode values. Deagle's authored scalar zero angle is
explicitly supplied as zero to both mode fields; it is not replaced by a
trainer default.

Execution begins after successful resource lookup. Allocation, cache insertion,
live resource objects and complete firing calls are outside this oracle. The
native array-to-field mapping and every supplied input are retained with the
code and data hashes. This does not turn a numeric invocation into a live
gameplay trace.

## Mode mapping

Native modes 0 and 1 are not universally "primary" and "alternate" in the
trainer's exported data. M4A1-S and USP-S default to their silenced mode 1;
their current alternate imports also contain mode 1. The raw mode-0 tables
are tested by supplying their native parameters to the actual table function,
without claiming an implemented suppressor-removal flow.

| Weapon | Native mode-0 magnitude / variance | Native mode-1 magnitude / variance |
| --- | --- | --- |
| M4A1-S | 25 / 3 | 21 / 0 |
| USP-S | 29 / 0 | 23 / 0 |
| AWP | 78 / 15 | 25 / 2 |
| Glock | 18 / 0 | 30 / 5 |

The current automatic smoothing and first-four-shot suppression agree with
the trainer. Mode selection, the AWP's additional magnitude blend and the
pistol's command-seed selector remain separate from table generation.

## Limits and reproduction

This pass supplements the older Windows build-2000924 all-weapon fixtures;
those files retain their original identities. Only the seven priority weapons
are reverified against this Linux build. It does not establish per-command
seed generation, physical input scheduling, camera presentation or complete
shot directions. In particular, it does not remove the default-gameplay
boundary in the [Deagle selector report](reaudit-pistol-recoil.md).

`tools/reaudit-common-recoil-tables.mjs --repo PATH --native FILE --output NEW.json`
bundles the actual `recoilTable`, `UniformRandomStream` and imported weapon
data, records source hashes, and compares both raw modes and supported imports.
It refuses to overwrite a report and exits unsuccessfully on any parameter,
table or RNG mismatch. Run serially under a 512 MiB, zero-swap, one-CPU scope
with deployment inactive and at least 12 GiB available.

The [native reproduction package](../tools/reaudit-common-recoil-native/README.md)
completed all five stages under the same cap. Its output independently matches
the original 896 entries, 224 RNG samples, supplied inputs and execution counts.
The [portable native proof](evidence/reaudit-common-recoil-native.json) records
both native report hashes and the actual-source comparison's association with
the unchanged original. The [compressed trainer report](evidence/reaudit-common-recoil-trainer.json.gz)
retains every comparison and the bundled source hashes. Original raw artifacts
remain under `native-audit/reports/core-shooting-next/common-recoil-table/` in
the parent workspace; packaged reproduction is in `common-recoil-packaged-001`.
