# AWP movement / weapon-event phase evidence

This is a static caller proof. The native command caller completes its movement
loop, calls typed post-movement preparation, then processes remaining weapon
events. The fresh read checks that order in a straight-line caller block and
confirms the same receiver and move-data arguments. The actual movement callback
samples its maximum speed before calling its movement dispatcher.

Retained current-hash lower bindings join the remaining callback to active
weapon postframe and the actual AWP class. The AWP wrapper processes eligible
automatic rescope before common input; eligible secondary input reaches the
AWP secondary implementation through its common wrapper and thunk. On the
demonstrated subtick preprocessing branch, primary/secondary button payloads
are separated from movement records into remaining-event records.

Remaining events install their own normalized tick/fraction, apply edges, and
invoke a callback at the final record of each distinct fraction. **This does
not map a 128 Hz trainer step to a native command, prescribe a half-step
reordering, or prove a universal additional tick of delay.** It establishes
ordering within the demonstrated native command path. A scope change made in
that command's remaining-event phase cannot change movement already completed
for that command. Eligibility, earlier external callbacks and live invocation
association remain separate questions. No gameplay change follows from this
package alone.

The only fresh native read is the already-resolved caller body: two ranges,
1,350 bytes total, with a 1,356-byte enclosing span. The gap is not read. The
reader first verifies the full server SHA-256:
`c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`.
It validates retained REA body provenance, instruction boundaries and ordering,
and refuses output overwrite or unexpected branches. There is no callee read,
emulation, broad scan or live process. The lower joins are retained evidence;
their original provenance and hash-check limitations are preserved in the
checker output. Raw locations stay in implementation/proof artifacts.

The reader requires Python 3, Capstone and pyelftools. The retained checker uses
only the Python standard library and bundled small text/JSON files. A matching
server library must be supplied separately for a new caller read. From the repo,
with deployment inactive and at least 12 GiB available, run serially:

```bash
free -g
systemctl --user is-active spraylab-deploy.service
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-awp-movement-phase-native/read-caller.py --binary /path/to/libserver.so --location tools/reaudit-awp-movement-phase-native/pawn-caller-location.json --caller-rea tools/reaudit-awp-movement-phase-native/pawn-caller-rea.json --out /tmp/awp-phase-caller-new
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-awp-movement-phase-native/check-retained.py --out /tmp/awp-phase-retained-new.json
```

The second command validates the packaged proof and lower joins without reading
the binary again. Its generated report is the portable, address-free evidence
ledger. Neither command executes native code or measures trainer behavior.
