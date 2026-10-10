# Scoped AWP native movement evidence

The current native acceleration branch applies at **both AWP zoom levels**.
It tests a positive current zoom level, more than one configured zoom level,
and the float32 product of mode speed and the native walking multiplier
strictly below 110. With scoped AWP speed 100 and configured count 2, both
levels preserve the same weapon scale through the walking branch.

The first accessor is bound to the current zoom integer through the retained
matching-hash AWP secondary dispatch: it advances that same instance field,
compares it with the configured count, and applies the selected scope. The
second accessor is joined to the current-server field named `m_nZoomLevels`.
The fixed static proof selects 3,640 bytes after verifying the complete server
digest. It does not discover new targets or scan executable code.

A guarded native replay covers 30 supplied fixtures and 32 floating-point
profile sequences, totaling 844 segment rows. It includes standing, walking
and crouching starts, releases, counter-input and diagonals; six additional
walking taper input controls; and two FTZ/DAZ profile controls. All 15 paired
zoom-level fixtures have identical intermediate states, endpoints and command
boundaries. Each level enters the native scoped-scale branch 326 times.
The guard records 122,145 reads and 71,693 writes with no unexpected access.

This extends the existing movement replay using its same 7,192 native code
bytes and accessor hooks. Only a supplied weapon-data pointer and configured
count add private state. The preserved release, counter-strafe and stance
oracles are unchanged. The [evidence ledger](evidence/reaudit-scoped-awp-native.json)
records source, fixture, tool and canonical execution hashes; the
[portable package](../tools/reaudit-scoped-awp-native/README.md) reproduces the
static proof, native execution and semantic export.

Portable validation passed under a 512 MiB memory cap with zero swap and one
CPU. The fixed static read ledger matches the retained proof exactly. A fresh
native run and semantic export reproduce the original complete file hashes,
as well as the canonical digest of all execution content.

The bench supplies getter speed 100, zoom level, stance, processed cap, command
schedule and floating-point environment. It does not invoke scope transitions,
upstream stance/tag/cap production, collision or the full command dispatcher.
Walking uses the existing explicit invalid service handle. Position remains
the derived uncollided midpoint displacement. These bounds establish the
scoped acceleration rule and supplied-state output, without claiming a live
physical-input or complete native movement replay.
