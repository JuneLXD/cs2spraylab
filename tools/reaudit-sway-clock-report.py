"""Preserve bounded source-clock findings; no game access or target execution.

This consumes the hash-bound layout/disassembly retained by the static probes.
It never edits the sampler helper, which may be imported by a live capture.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'native-audit'
OUT = ROOT / 'reports/reaudit-sway-clock-inputs'
layout = json.loads((OUT / 'layout.json').read_text())
raw_source = ROOT / 'reports/reaudit-look-sway'
manifests = [json.loads((raw_source / name).read_text()) for name in (
    'ranges-sway-clock-owner.json', 'ranges-sway-current-angle-resolver.json')]
assert all(m['clientSha256'] == layout['clientSha256'] for m in manifests)
range_digests = [{k: row[k] for k in ('name', 'bytes', 'sha256')}
                 for row in layout['ranges']]
range_digests += [{k: row[k] for k in ('name', 'bytes', 'sha256')}
                  for manifest in manifests for row in manifest['ranges']]

report = {
    'schemaVersion': 1,
    'baseline': 'f70dfbb',
    'clientSha256': layout['clientSha256'],
    'productionChange': False,
    'scope': 'Sway writer current-angle input and player-time ownership; bounded static evidence',
    'helper': 'native-audit/reaudit-sway-clock-inputs.py:read_sway_fields',
    'helperSha256': layout['scriptSha256'],
    'reportProbeSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'rangeDigests': range_digests,
    'observations': [
        {'id': 'SC01', 'rule': 'The sway writer passes an entity-identity integer selector to the player-time accessor. Nonzero selector, or no active controller on the zero-selector path, returns global current time directly.',
         'evidence': ['writer-time-accessor', 'writer-cache-selection']},
        {'id': 'SC02', 'rule': 'For the ordinary active controller, current global time is reduced by an integer tick offset. If ceiling mode is enabled, its tick is positive, and global time reaches that tick, the result instead uses ceiling tick minus offset, converted to seconds. A different converter virtual method is a distinct unmodeled branch.',
         'evidence': ['time-controller']},
        {'id': 'SC03', 'rule': 'The presented-frame player pair is a separate prediction-interface getter. Positive cached predicted tick uses global fraction only when requested and global frame delta is nonzero; nonpositive cached predicted tick falls back to global integer tick with fraction zero. The sway writer does not directly call this getter.',
         'evidence': ['prediction-player-pair', 'writer-time-accessor']},
        {'id': 'SC04', 'rule': 'Sway current-angle input selects raw QAngles or one of two interpolation caches from the interpolation-enabled byte, shared mode/state and packed pawn flags. The requested source-cache time comes from one of two shared time slots; it need not equal the history writer time.',
         'evidence': ['writer-cache-selection', 'writer-cache-alternate-selection', 'writer-cache-slot-selection', 'sway-current-angle-resolver']},
        {'id': 'SC05', 'rule': 'The source-cache resolver returns an already cached QAngle when the requested time exactly matches its cached time. A changed requested time can invoke interpolation-history evaluation, update the cache, and clear the selected dirty flag after successful evaluation. Source-angle cache histories are distinct from the four samples used for look sway.',
         'evidence': ['sway-current-angle-resolver', 'sway-cache-evaluator']},
        {'id': 'SC06', 'rule': 'The source-update caller requests the virtual current angle, updates raw/cache state when needed, and calls the sway history writer even if the returned angle compares equal. A separate pawn-update caller reaches the writer only when its recorded gate byte is zero. These are caller conditions, not a proof that there is exactly one writer invocation per tick.',
         'evidence': ['source-update-caller', 'pawn-update-caller']},
        {'id': 'SC07', 'rule': 'The virtual source-angle getter has additional global and pawn gates that can delegate to an alternate angle getter. That alternate getter can resolve an associated entity and its angle virtual method, or follow transform/orientation paths. Their runtime branch selection is not established by the ordinary four-sample history replay.',
         'evidence': ['source-angle-getter', 'sway-source-angle-alternative']},
    ],
    'controllerClock': {
        'symbols': {'G': 'global current-time float', 'O': 'controller signed integer offset ticks',
                    'C': 'controller signed integer ceiling tick', 'E': 'controller ceiling-enabled byte'},
        'noControllerOrNonzeroDomain': 'G',
        'ordinaryUnclamped': 'f32(G - f32(f32(O) * f32(1/64)))',
        'ordinaryCeilingCondition': 'E and C > 0 and G >= f32(f32(C) * f32(1/64))',
        'ordinaryClamped': 'f32(f32(C - O) * f32(1/64))',
        'limits': 'Finite ordinary states only. Nondefault converter and integer overflow are not modeled.',
    },
    'currentAngleSelector': [
        {'condition': 'interpolation disabled', 'source': 'raw'},
        {'condition': 'interpolation enabled, mode -1', 'source': 'cache0'},
        {'condition': 'interpolation enabled, mode 0, context state 1', 'source': 'cache0'},
        {'condition': 'interpolation enabled, mode 0, other context state, alternate-cache flag set', 'source': 'cache1'},
        {'condition': 'interpolation enabled, mode 0, other context state, alternate-cache flag clear', 'source': 'raw'},
        {'condition': 'interpolation enabled, mode 1, context state 1', 'source': 'cache1 if alternate-cache flag set, otherwise cache0'},
        {'condition': 'interpolation enabled, mode 1, other context state', 'source': 'raw'},
        {'condition': 'other mode', 'source': 'raw'},
    ],
    'captureFieldsAdded': [
        'Clock-domain selector, time-controller presence/default-converter binding, tick offset, ceiling and enable flag',
        'Global current time, frame delta, integer/fractional clocks, frame number, prediction cached tick',
        'Shared interpolation mode/state, both source-cache times, helper-mode byte',
        'Raw source angle, both angle-cache QAngles, both cached times, packed state/dirty flags',
        'Interpolation enable, source-getter and pawn-update gate bytes, existing sway history/angles/rate',
    ],
    'captureGuarantee': 'The helper only uses the parent sampler\'s approved read callback; all reads are bounded to 128 bytes and every block is returned for a second coherence read. It owns no process handles, target lifetime, writes or retries.',
    'remainingRuntimeMetadata': [
        'Observed clock-controller and interpolation branches during the new capture, checked against newly written sample times/angles.',
        'Prediction/interpolation source histories and evaluated endpoint pairs when requested source time changes; current cache outputs alone identify results but not the complete reconstruction path.',
        'The global alternative-getter gates and any related entity/transform state when that branch is relevant.',
        'Caller/invocation identity or equivalent coherent state transitions sufficient to distinguish duplicate writer invocations and missed writes.',
        'Presentation/input/prediction ordering that maps a trainer input event to native source-angle history; a 128 Hz trainer step alone does not identify it.',
    ],
    'trainerBoundary': [
        'Do not sample every second trainer tick and call it native history parity. Native history time, interpolated current angle and HUD smoothing time have distinct owners.',
        'A faithful model needs a selected source-angle state with its time, four previous sway entries and the HUD global timestamp, preserving native duplicate/history behavior.',
        'The old capture proved exact endpoint/rate and HUD arithmetic, but did not prove the timestamp ownership or cache branch because the necessary fields were absent.',
    ],
    'limits': [
        'Static findings do not establish current runtime values or default settings.',
        'No new emulation or target execution was performed by these clock probes.',
        'The current helper omits interpolation-ring payload and the source getter\'s global alternate-path gates; no claim closes those branches.',
        'The new runtime capture is parent-owned and is not analyzed by this static report.',
        'R8 is excluded; production source is unchanged.',
    ],
}
assert '0x' not in json.dumps(report) and '/home/' not in json.dumps(report)
path = OUT / 'findings.json'
path.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'output': str(path), 'observations': len(report['observations']),
                  'ranges': len(range_digests), 'bytes': sum(r['bytes'] for r in range_digests)}))
