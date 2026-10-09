# aim_redline lighting comparison

The user's `../maps/Screenshot.png` showed a warm warehouse, strong local shading,
lit lamps, red emergency-light wash and RL FREIGHT logos. The previous glTF import
retained geometry and base textures, but dropped the baked illumination and all
overlay meshes. Its generic hemisphere light could not reproduce that appearance.

This pass restores the map's installed irradiance and direct-light shadow atlas,
visible overlays, original texture alpha, lamp emission, beam tint and the UV2
surface coordinates used by Dust shipping crates. Only baked static surfaces use
the new shader; player and bot lighting still follows the existing engine path.

## Evidence and conversion

- Source: the user-provided `../maps/redline.vpk` plus the local CS2 install.
- Native comparison: `../native-audit/reports/native-redline-front.png`, captured
  offline at `setpos -1102.362 433.071 0; setang 0 0 0`, with HUD and viewmodel hidden.
  The native session renders 1280×960 stretched to the desktop; comparison browser
  captures therefore use 4:3 camera projection stretched to the screenshot width.
- Browser camera: `(11, 1.6256, -28)`, yaw π, vertical FOV 73.739795 degrees.
- Native map lighting: version 8, game version 2, baked shadow index 0 for the sun,
  pitch/yaw 53/27 degrees. Source 2 Viewer bakes the world lightmap UV scale into
  the exported UVs, so the browser must not multiply it a second time.
- The 8192² float irradiance EXR is box-filtered in linear space to 4096², then
  encoded as lossless WebP RGBM with range 16. About 0.0182% of texels exceed that
  range. The shadow atlas is also 4096². RGBM uses no sRGB decoding or mipmaps.
- The optimizer preserves unused UV attributes and uses 16-bit UV quantization.
  Default attribute pruning removed the bake entirely; coarse 12-bit precision is
  insufficient for the small chart borders in this atlas.
- Native `F_FORCE_UV2` crates need TEXCOORD_1 for the surface and TEXCOORD_2 for
  lighting. The importer normalizes these to surface UV0 / lighting UV1.
- Twenty-six material instances regain alpha from the original compiled textures.
  Seven native overlay materials remain visible. Lamp emission was zero in the
  adapted glTF despite the native self-illumination flag.
- The roof beam draw-call tint is already linear (`0.173439, 0.157281, 0.139022`).
  VRF 20 gamma-converts it again. The importer reverses that extra conversion for
  this verified material instead of increasing the whole scene's exposure.

Primary references: [VRF export support](https://s2v.app/ValveResourceFormat/guides/format-support.html)
and the [VRF renderer/exporter source](https://github.com/ValveResourceFormat/ValveResourceFormat/tree/f19322f829a27adfe8e1ca29b8410cf8aab0f3b6).
The raw world, entity and shader extracts remain under `../native-audit/map-lighting`.

## Rebuild

Use Source 2 Viewer CLI 20.0 as in `tools/import-map.mjs`. The Python interpreter
needs `OpenEXR`, `numpy` and `Pillow`; it can be supplied with `--python` from a
virtual environment. On this shared machine keep the hard memory cap:

```sh
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=200% \
  node tools/import-map.mjs ../maps/redline.vpk --game ../cs2-game --python python3 --keep
```

The importer emits `public/revamp/maps/aim_redline.glb`, `aim_redline-lightmap.webp`,
`aim_redline-sun-shadow.webp` and encoding metadata `aim_redline-lighting.json`.
These are local game assets, ignored by Git like the other imported resources.
The model URL is versioned to avoid retaining the old model in a browser cache.

## Initial lighting pass validation

- Full import from the original VPK and installed stock dependencies completed.
- Three importer regressions and seventeen focused lighting-resource, workshop
  and changelog checks pass. The workshop URL expectation was updated for the
  intentional cache version. TypeScript and the production build pass.
- Final Chromium comparison and a start/play/fire smoke check on the built LAN
  preview returned no JavaScript, shader or HTTP errors. Both lighting textures
  are required by the smoke check. The comparison scene (bots/viewmodel hidden)
  records 136 draw calls and 802,619 triangles; this is not a main-PC FPS test.
- Collision/spawns SHA-256 remains
  `620cca9d53d2b3f868817c73db58ea7615e051df97899fa2a6a64f78accc25db`.
- Local rendered model SHA-256:
  `d45bc30dbc6d9b9cef5456e11ee86051b6a7c4c447495e8888ad3fc26f7cd297`.
- Lightmap SHA-256:
  `57134bc02b42b17388f084c6310d67cc787da63336e8a6e07abba7728d46f8fa`.
- Sun shadow SHA-256:
  `db0c671939f7c984d6aa9b5132de5352717fdf3dc6b7320930f3bae808d59b84`.
- Local browser evidence: `../native-audit/reports/map-final.png`,
  `map-final.json`, `map-preview-playing.png` and
  `map-production-preview-check.json`. A native/browser toggle is served at
  `http://192.168.0.18:5191/map-lighting.html`; the built preview remains on 5190.

## Floor decal repair

A subsequent user screenshot exposed a solid, apparently raised patch beside the
stairs. The side-lane reproduction uses camera `(26, 1.6256, -22)`, yaw π.
Raycasting confirms `hr_dust_decal_road_striping` is exported at Y=0.3937 m while
the concrete floor is at Y=0. Its adapted color image is RGB, although the
original texture is RGBA with alpha 0–186. The material declares `F_OVERLAY` and
`F_TRANSLUCENT`, which the previous alpha recovery did not recognize.

The importer now recognizes flag-based overlays alongside the static-overlay
shader and restores translucent materials' original alpha. It projects all
eight horizontal floor decals (2,267 vertices) onto nearby opaque floor geometry,
with a 1 mm separation and non-depth-writing overlay materials. Projection runs
only during import; walls and decals without a complete nearby receiver retain
their geometry. Tiny compiler clipping overruns at floor edges use a 1 mm search.
Native decal lighting UVs remain intact: borrowing receiver UVs crosses unrelated
lightmap charts at 97 vertices and creates edge artifacts. Collision is unchanged.

This repair restores alpha on 58 material instances, up from 26. Comparison
captures are `../native-audit/reports/map-floor-before.png` and
`map-floor-after.png`; the model cache version advances to `lighting-3`.

Validation: six importer regressions and seventeen runtime/workshop/changelog
checks pass, along with the full import, TypeScript/build, the side-lane browser
comparison and the built-preview start/fire smoke check. Chromium reports no
JavaScript, shader or HTTP errors. The comparison view remains at 111 draw calls
and 744,348 triangles before and after this repair. Its sampled decal height is
0.001001 m, above a receiver at 0.000001 m. Collision/spawn data retains the hash
recorded above. Final model SHA-256 is
`fb28932aed84685d70ca380b3ad884dd841561290c396a339db733b6689ae128`.
The before/after toggle is at `http://192.168.0.18:5191/floor-repair.html`.

## Limits

This is a closer browser rendering, not Source 2 shader parity. Directional
irradiance, native reflection probes, postprocessing/color grading, bloom, and
the complete layered floor/container materials are not reproduced. Static metal
uses local baked radiance as a reflection approximation. Bots do not yet sample
native light probes. The generic arena lights are suppressed on baked geometry
to avoid counting the same illumination twice.

Two extra static texture samples per baked fragment replace adding many real-time
lights. The atlases add about 18 MB to the first map download and roughly 128 MiB
of uncompressed GPU texture storage. The earlier user-reported 500 FPS / 2.1 ms
measurement predates this change and must not be presented as its benchmark.
