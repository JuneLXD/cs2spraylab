"""Stream retained native scene/source-angle captures; never reads a live process.

Run under: systemd-run --user --scope --quiet -p MemoryMax=512M
  -p MemorySwapMax=0 -p CPUQuota=100% python3 native-audit/reaudit-scene-runtime.py
"""
import collections
import argparse
import hashlib
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'native-audit'
CAPTURE = ROOT / "reports/reaudit-motion-runtime-003"
OUT = ROOT / "reports/reaudit-scene-orientation/runtime-analysis.json"
ANGLE_FIELDS = ("sceneLocalAngles", "sceneAbsUpdateSourceAngles", "sceneAbsoluteAngles")


def wrapped_delta(a, b):
    return (a - b + 180.0) % 360.0 - 180.0


def angle_distance(a, b):
    return max(abs(wrapped_delta(x, y)) for x, y in zip(a, b))


def euler_quaternion(angles):
    p, y, r = [math.radians(a) / 2 for a in angles]
    sp, cp, sy, cy, sr, cr = math.sin(p), math.cos(p), math.sin(y), math.cos(y), math.sin(r), math.cos(r)
    return (sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy,
            cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy)


def quaternion_distance(a, b):
    na, nb = math.sqrt(sum(x*x for x in a)), math.sqrt(sum(x*x for x in b))
    assert na > 0 and nb > 0
    dot = abs(sum(x*y for x, y in zip(a, b))) / (na*nb)
    return math.degrees(2 * math.acos(min(1, max(-1, dot))))


def example(row):
    x = row["extra"]
    return dict(monotonic=row["monotonic"], frame=row["frame"], tick=row["tick"],
                sourceAngles=row["sourceAngles"], localAngles=x["sceneLocalAngles"],
                evaluatedAngles=x["sceneAbsUpdateSourceAngles"], absoluteAngles=x["sceneAbsoluteAngles"],
                quaternion=x["sceneNodeToWorld"][4:8], dirty=x["sceneAbsTransformDirty"],
                storedVelocity=row["storedVelocity"])


class Stats:
    def __init__(self):
        self.rows = 0
        self.frames, self.ticks = set(), set()
        self.values = {k: set() for k in (*ANGLE_FIELDS, "quaternion", "sourceAngles", "parent", "pawnEntity")}
        self.dirty = collections.Counter()
        self.limits = {}
        self.maxima = {}
        self.previous = None
        self.changes = collections.Counter()
        self.transitions = []
        self.orientation_transitions = []
        self.dirty_runs = []
        self.counts = collections.Counter()
        self.unwrapped_yaw = None
        self.first = self.last = None

    def limit(self, key, values):
        if key not in self.limits:
            self.limits[key] = [[v, v] for v in values]
        for pair, v in zip(self.limits[key], values):
            pair[0] = min(pair[0], v)
            pair[1] = max(pair[1], v)

    def maximum(self, key, value, row):
        if key not in self.maxima or value > self.maxima[key]["value"]:
            self.maxima[key] = dict(value=value, sample=example(row))

    def add(self, row):
        x = row["extra"]
        source = row["sourceAngles"]
        quat = x["sceneNodeToWorld"][4:8]
        dirty = x["sceneAbsTransformDirty"]
        t = row["monotonic"]
        if self.first is None:
            self.first = example(row)
        self.last = example(row)
        self.rows += 1
        self.frames.add(row["frame"])
        self.ticks.add(row["tick"])
        self.dirty[dirty] += 1
        for key in ANGLE_FIELDS:
            self.values[key].add(tuple(x[key]))
            self.limit(key + "Degrees", x[key])
        self.values["quaternion"].add(tuple(quat))
        self.values["sourceAngles"].add(tuple(source))
        self.values["parent"].add(x["sceneParent"])
        self.values["pawnEntity"].add(row["pawnEntity"])
        self.limit("sourceAnglesDegrees", source)
        self.limit("storedVelocityUnitsPerSecond", row["storedVelocity"])
        horizontal_speed = math.hypot(*row["storedVelocity"][:2])
        self.limit("horizontalSpeedUnitsPerSecond", [horizontal_speed])
        self.counts["horizontalSpeedAbove1"] += horizontal_speed > 1
        self.counts["localDiffersFromEvaluated"] += x["sceneLocalAngles"] != x["sceneAbsUpdateSourceAngles"]
        self.counts["sourceDiffersFromLocalAbove0.0001Degree"] += angle_distance(source, x["sceneLocalAngles"]) > 0.0001
        self.counts[f"evaluatedDiffersFromAbsolute_dirty{dirty}"] += x["sceneAbsUpdateSourceAngles"] != x["sceneAbsoluteAngles"]
        self.counts[f"sourceSceneSeparationAbove1Degree_dirty{dirty}"] += angle_distance(source, x["sceneAbsoluteAngles"]) > 1
        self.limit("absoluteOriginUnits", x["sceneAbsoluteOrigin"])
        self.limit("frameDeltaSeconds", [row["frameDelta"]])
        self.limit("quaternionNorm", [math.sqrt(sum(v*v for v in quat))])
        if self.previous is None:
            self.unwrapped_yaw = source[1]
        else:
            before = self.previous
            self.unwrapped_yaw += wrapped_delta(source[1], before["sourceAngles"][1])
            if source != before["sourceAngles"]:
                self.changes["sourceAngles"] += 1
                self.changes["sourceAnglesWhileMoving"] += math.hypot(*row["storedVelocity"][:2]) > 1
            for key in (*ANGLE_FIELDS, "sceneAbsTransformDirty", "sceneParent"):
                if x[key] != before["extra"][key]:
                    self.changes[key] += 1
                    if key in ANGLE_FIELDS:
                        self.changes[key + "WhileMoving"] += horizontal_speed > 1
            if quat != before["extra"]["sceneNodeToWorld"][4:8]:
                self.changes["quaternion"] += 1
            if row["frame"] < before["frame"]:
                self.changes["frameWentBackwards"] += 1
            if dirty != before["extra"]["sceneAbsTransformDirty"] and len(self.transitions) < 12:
                self.transitions.append(dict(before=example(before), after=example(row)))
            if dirty != before["extra"]["sceneAbsTransformDirty"] and len(self.orientation_transitions) < 12:
                old = before["extra"]
                if (angle_distance(old["sceneAbsUpdateSourceAngles"], old["sceneAbsoluteAngles"]) > 1e-5
                        or angle_distance(x["sceneAbsUpdateSourceAngles"], x["sceneAbsoluteAngles"]) > 1e-5):
                    self.orientation_transitions.append(dict(before=example(before), after=example(row)))
        self.limit("sourceYawUnwrappedDegrees", [self.unwrapped_yaw])
        if not self.dirty_runs or self.dirty_runs[-1]["dirty"] != dirty:
            self.dirty_runs.append(dict(dirty=dirty, start=t, end=t, rows=1))
        else:
            self.dirty_runs[-1]["end"] = t
            self.dirty_runs[-1]["rows"] += 1
        self.maximum("sourceVsSceneWrappedAngleDegrees", angle_distance(source, x["sceneAbsoluteAngles"]), row)
        self.maximum("sourceVsLocalAnglesDegrees", angle_distance(source, x["sceneLocalAngles"]), row)
        self.maximum("sourceVsEvaluatedAnglesDegrees", angle_distance(source, x["sceneAbsUpdateSourceAngles"]), row)
        self.maximum("sourceVsSceneQuaternionDegrees", quaternion_distance(euler_quaternion(source), quat), row)
        self.maximum("localVsEvaluatedAnglesDegrees", angle_distance(x["sceneLocalAngles"], x["sceneAbsUpdateSourceAngles"]), row)
        self.maximum("evaluatedVsAbsoluteAnglesDegrees", angle_distance(x["sceneAbsUpdateSourceAngles"], x["sceneAbsoluteAngles"]), row)
        self.maximum("absoluteAnglesVsQuaternionDegrees", quaternion_distance(euler_quaternion(x["sceneAbsoluteAngles"]), quat), row)
        self.maximum("pawnVsSceneQuaternionDegrees", quaternion_distance(row["pawnTransform"][4:8], quat), row)
        origin_error = max(abs(a-b) for a, b in zip(x["sceneAbsUpdateSourceOrigin"], x["sceneAbsoluteOrigin"]))
        self.maximum(f"evaluatedVsAbsoluteOriginUnits_dirty{dirty}", origin_error, row)
        self.maximum("sceneNodeVsAbsoluteOriginUnits", max(abs(a-b) for a, b in zip(x["sceneNodeToWorld"][:3], x["sceneAbsoluteOrigin"])), row)
        self.maximum("sourceFieldVsNestedSourceDegrees", angle_distance(source, x["swayInputs"]["fields"]["sourceAngles"]), row)
        self.previous = row

    def finish(self, detailed=True):
        if not self.rows:
            return dict(rows=0)
        unique = {}
        for key, values in self.values.items():
            unique[key] = dict(count=len(values))
            if len(values) <= 12 and key != "pawnEntity":
                unique[key]["values"] = sorted(values)
        return dict(rows=self.rows, uniqueFrames=len(self.frames), uniqueTicks=len(self.ticks),
                    durationSeconds=self.last["monotonic"]-self.first["monotonic"],
                    dirtyCounts=dict(self.dirty), unique=unique, ranges=self.limits, changes=dict(self.changes),
                    counts=dict(self.counts),
                    maxima=self.maxima if detailed else {k: v["value"] for k, v in self.maxima.items()},
                    first=self.first, last=self.last,
                    dirtyRuns=self.dirty_runs if detailed else len(self.dirty_runs),
                    dirtyTransitionExamples=self.transitions if detailed else [],
                    orientationDirtyTransitionExamples=self.orientation_transitions if detailed else [])


def input_segments(path):
    raw = path.read_bytes()
    events = [json.loads(line) for line in raw.splitlines()]
    held, active, segments, group = set(), {}, [], None
    for event in events:
        t, a = event["monotonic"], event["action"]
        if "key" in a and "down" in a:
            key = a["key"]
            if a["down"]:
                held.add(key)
                active[key] = t
            else:
                held.discard(key)
                if key in active:
                    segments.append(dict(kind="key-hold", key=key, start=active.pop(key), end=t))
        if "motion" in a:
            motion = a["motion"]
            if group is None or motion != group["motion"] or t-group["end"] > 0.5 or sorted(held) != group["heldKeys"]:
                group = dict(kind="mouse-sweep", motion=motion, start=t, end=t, heldKeys=sorted(held), count=0)
                segments.append(group)
            group["end"] = t
            group["count"] += 1
    for segment in segments:
        segment["observationStart"] = segment["start"] - 0.03
        segment["observationEnd"] = segment["end"] + 0.35
        segment["stats"] = Stats()
    return hashlib.sha256(raw).hexdigest(), segments


def analyze(stem, manifest, capture_dir):
    path = capture_dir / (stem + "-snapshot.jsonl")
    inputs = ROOT / "reports" / (stem + "-inputs.jsonl")
    input_hash, segments = input_segments(inputs)
    stats, clean, moving = Stats(), Stats(), Stats()
    digest = hashlib.sha256()
    source_holds = []
    hold = None
    for line in path.open("rb"):
        digest.update(line)
        row = json.loads(line)
        stats.add(row)
        if hold is None or row["sourceAngles"] != hold["sourceAngles"]:
            if hold is not None and hold["end"] - hold["start"] >= 0.25:
                source_holds.append(hold)
            hold = dict(start=row["monotonic"], end=row["monotonic"], rows=0,
                        sourceAngles=row["sourceAngles"], initial=example(row), final=example(row), maxHorizontalSpeed=0)
        hold["end"] = row["monotonic"]
        hold["rows"] += 1
        hold["final"] = example(row)
        hold["maxHorizontalSpeed"] = max(hold["maxHorizontalSpeed"], math.hypot(*row["storedVelocity"][:2]))
        if row["extra"]["sceneAbsTransformDirty"] == 0:
            clean.add(row)
        if math.hypot(*row["storedVelocity"][:2]) > 1:
            moving.add(row)
        for segment in segments:
            if segment["observationStart"] <= row["monotonic"] <= segment["observationEnd"]:
                segment["stats"].add(row)
    assert digest.hexdigest() == manifest["snapshotSha256"]
    assert input_hash == manifest["inputSha256"]
    assert stats.rows == manifest["rows"]
    if hold is not None and hold["end"] - hold["start"] >= 0.25:
        source_holds.append(hold)
    for segment in segments:
        segment["stats"] = segment["stats"].finish(False)
    return dict(stem=stem, snapshotSha256=digest.hexdigest(), inputSha256=input_hash,
                allSamples=stats.finish(), cleanAbsoluteCacheSamples=clean.finish(), measuredMovingSamples=moving.finish(), inputSegments=segments,
                sourceAngleHoldsAtLeast250ms=source_holds)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, default=CAPTURE)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    manifest = json.loads((args.capture / "snapshot-manifest.json").read_text())
    results = [analyze(stem, window, args.capture) for stem, window in manifest["windows"].items()]
    binding_path = ROOT / "reports/reaudit-20261009/keys-before.vcfg"
    binding_bytes = binding_path.read_bytes()
    bindings = dict(re.findall(r'"([twgshf])"\s+"([^"]+)"', binding_bytes.decode()))
    assert bindings == {"t": "+forward", "w": "+lookatweapon", "g": "+back", "s": "+use", "f": "+left", "h": "+right"}
    has_moving_turns = any(c["allSamples"]["changes"].get("sourceAnglesWhileMoving", 0) for c in results)
    findings = [
        {"id": "SOR01", "status": "observed", "finding": "Scene local, evaluated and absolute yaw and the scene quaternion change during the logged stationary source-yaw sweeps. A fixed scene-yaw implementation is contradicted in these captures. Captured scene parent pointers remain null."},
        {"id": "SOR02", "status": "observed", "finding": "Source yaw and scene yaw are distinct values during turning, including clean-cache samples. Scene yaw also continues changing during some holds of an exactly constant source-angle field. This is observed lag/convergence, not identification of an animation writer or a smoothing formula."},
        {"id": "SOR03", "status": "observed", "finding": "For every clean absolute-cache sample, evaluated scene angles equal absolute scene angles exactly, and the scene quaternion matches those absolute angles within 0.00001 degree. Local versus evaluated angles can still differ when the absolute cache is clean."},
        {"id": "SOR04", "status": "observed", "finding": "Dirty samples include cases where the evaluated angle has advanced but the absolute angle/quaternion still contain the earlier value. Retained orientationDirtyTransitionExamples show both invalidation and refresh. Dirty flags also occur without angle changes, so dirtiness alone is not orientation staleness."},
        {"id": "SOR05", "status": "observed" if has_moving_turns else "coverage-limit", "finding": ("The corrected T/G input window includes source-angle changes while measured horizontal speed exceeds 1 unit/second. See the T-held mouse-sweep segments and measuredMovingSamples for the actual moving-turn observations." if has_moving_turns else "Measured horizontal movement occurs in the F/H holds at constant 90-degree source/scene yaw. The logged W/S holds and W+mouse sweeps have zero measured velocity. The preserved bindings identify the capture setup error: T/G are forward/backward, W is inspect, and S is use. No source-angle change occurs while stored horizontal speed exceeds 1 unit/second, so these earlier windows do not verify moving-turn behavior.")},
        {"id": "SOR06", "status": "unverified", "finding": "The capture does not identify who writes scene yaw, establish reset rules, or distinguish a general animation/body-follow law from other update mechanisms. Requested fps_max 60/30 settings are not proof of different HUD/presentation cadence."},
    ]
    for capture in results:
        s, clean = capture["allSamples"], capture["cleanAbsoluteCacheSamples"]
        assert s["unique"]["sceneAbsoluteAngles"]["count"] > 1
        assert s["unique"]["parent"]["values"] == [0]
        assert clean["maxima"]["evaluatedVsAbsoluteAnglesDegrees"]["value"] == 0
        assert s["maxima"]["absoluteAnglesVsQuaternionDegrees"]["value"] < 1e-5
    report = dict(clientSha256=manifest["clientSha256"], captureDirectory=str(args.capture), terminalStatus=manifest.get("terminalStatus"),
                  bindingEvidence=dict(path=str(binding_path), sha256=hashlib.sha256(binding_bytes).hexdigest(), bindings=bindings),
                  method="Streaming JSONL; hashes and row counts checked against retained manifest. Angle differences use shortest wrapped degrees. Quaternion distance normalizes operands and treats q/-q as identical. Input windows extend 30ms before and 350ms after logged actions; logs mark command dispatch, not exact in-game application. Speed subsets contain disconnected intervals; their change counters must not be interpreted as a continuous trace.",
                  limitations=["Scene dirtiness can concern translation or scale; a dirty flag alone does not show orientation is stale.", "These observations do not identify the writer or prove spawn-only, teleport, respawn, equip or universal body-follow behavior.", "Repeated sample rows within a captured client frame are retained and unique-frame counts reported separately; these counters do not establish presentation cadence.", "The two fps_max settings are requested caps only. A distinct lower HUD update cadence is not established by this comparison.", "The source angle is the captured native source field, not a claim that it equals every downstream rendered view transform."], findings=findings, captures=results)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    for capture in results:
        s = capture["allSamples"]
        print(json.dumps(dict(stem=capture["stem"], rows=s["rows"], frames=s["uniqueFrames"],
                              dirtyCounts=s["dirtyCounts"], sceneAngles=s["unique"]["sceneAbsoluteAngles"],
                              quaternion=s["unique"]["quaternion"], sourceRanges=s["ranges"]["sourceAnglesDegrees"],
                              sourceUnwrapped=s["ranges"]["sourceYawUnwrappedDegrees"],
                              changes=s["changes"], maxSeparation=s["maxima"]["sourceVsSceneWrappedAngleDegrees"]["value"],
                              cleanRows=capture["cleanAbsoluteCacheSamples"]["rows"])))
    print(args.out)


if __name__ == "__main__":
    main()
