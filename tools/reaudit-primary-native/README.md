# Ordinary primary retry and semiautomatic re-arm

These two tools package the completed early-tap native investigation. The
reader streams and checks the exact installed server hash, then reads only
2,896 selected bytes and 28 virtual slots. The checker validates retained
current-build common-reload evidence plus the fresh reset instructions.
Its 24 cases are static implications, not executed native commands.

Run serially with deployment inactive, at least 12 GiB available, and no other
heavy audit job. Use a new output directory beneath the same workspace:

```sh
audit_workspace=/home/junel/Desktop/cs2
audit_output="$audit_workspace/native-audit/reports/core-shooting-next/primary-packaged"
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-primary-native/read-reset.py --root "$audit_workspace" --output "$audit_output"
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-primary-native/check-proof.py --root "$audit_workspace" --output "$audit_output"
```

Dependencies are the retained `reaudit-common-reload-portable` report/listings,
the unchanged common-reload reader, and the `awp-clocks-next` metadata report
and reader. Their hashes and current server identities are checked. An absent
dependency is an error; do not bypass the identity checks or overwrite old
evidence. Raw locations remain in tools/local listings, not gameplay prose.

`tools/reaudit-primary-taps.mjs --repo PATH --output NEW.json` separately measures
the actual Range/Duel engines in 56 supplied ordinary input scenarios. It does
not claim to reconstruct native transition masks from DOM events.
