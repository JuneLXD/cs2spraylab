# CS2 aiming settings import — 2026-10-10

CS2 video imports previously changed crosshair scale without changing the trainer's
resolution/aspect ratio. Mouse imports ignored custom horizontal and vertical
magnitudes and conflated a negative `m_pitch` with the analog binding's inversion.

The importer now preserves valid video dimensions (including non-preset modes),
signed `m_yaw`, signed `m_pitch`, `sensitivity_y_scale`, and independent mouse-axis
inversions. Range and Duel share the conversion before their existing scope
multiplier. Config export preserves the mouse values; saved settings retain them
and the selected resolution. Old profiles receive the existing default coefficients.
The cm/360 readout and compensation preview account for custom axes.

Video settings explain that resolution selects the projection and requested render
height. Quality caps, adaptive scaling and window size can reduce the actual
framebuffer, including with 1920×1440 selected. This clarification does not alter
the quality policies, sensitivity or field of view.

## Validation

- TypeScript: `npx tsc --noEmit -p .` passed.
- 232 tests passed across `mouse-settings`, `keybinds`, `crosshair-cvars`,
  `changelog`, `simulation`, `scope-transition`, `presentation`, and Duel
  `input-timing` (Vitest, one worker).
- `tests/aim-settings.spec.ts` passed separately in Chromium for Range and Duel.
  Actual file uploads import a non-preset 1600×1200 mode and signed custom axes;
  the UI, saved storage and exported cfg are checked. Registered pointer handlers
  produce the expected −2.475° yaw and −1.32° pitch for 100/40 supplied counts,
  with camera aspect 4/3 and no page errors.
- Unit coverage includes JSON settings round trips, invalid dimensions and
  coefficients, disabled axes, console changes, compensation shape, legacy
  settings, touch behavior and AWP scope scaling.

Tests ran serially under 1 GiB (units) or 2 GiB (TypeScript/browser) memory caps,
with swap disabled and one CPU quota. Auto-deploy was paused. The first default-port
browser attempt connected to another checkout and was excluded. The first isolated
run, which reloaded the WebGL scene, hit its 2 GiB cgroup cap; kernel diagnostics
confirmed a cgroup OOM, with no earlyoom production kill. The final browser tests
use a smaller viewport, no scene reload, and separate processes at the same cap.
Persistence across serialization remains covered by the unit tests; browser tests
check saved storage directly. No game launch, native capture or asset rebuild ran.

Logs are retained on the audit host under
`native-audit/reports/aim-settings-fix/{focused-final,types-final,browser-guided,browser-duel}.log`.
This change addresses import and display wording only; it does not establish
physical mouse latency or native per-packet pitch-clamp equivalence.
