#!/usr/bin/env python3
"""Validate portable release execution and reconstruct stable accuracy input.

Run separately from Unicorn under the serialized 512 MiB host slot.
Raw reader/path metadata is retained only in the provenance sidecar.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

from bounded_elf import SERVER_SHA, file_sha, require

EXECUTION_SHA = "b8dbfe8e2b6997488e8f3b6da5ebf3fb01dbf68200f94ea9d03af07d6f8f46e9"
FIXTURE_SHA = "4600d5b952bef24f8fa6b21d6553b04f01a297f536acaf304da910459bf63a71"
FIXTURE_FILE_SHA = "eca45368486a58eb9753f21dbe3d0ec29403d82564c5c4c992de9905764d9abb"


def content_sha(value):
    digest = hashlib.sha256()
    for chunk in json.JSONEncoder(sort_keys=True, separators=(",", ":"), allow_nan=False).iterencode(value):
        digest.update(chunk.encode())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-report", type=Path, required=True)
    parser.add_argument("--compact", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    require(not args.output.exists(), "Refusing overwrite")
    args.output.mkdir(parents=True, exist_ok=False)
    provenance = {"status": "started", "preparerSha256": file_sha(Path(__file__))}
    code = 0
    try:
        comparison_path = Path(__file__).resolve().parent.parent / "reaudit-ground-friction-native/compare.py"
        provenance["comparisonModuleSha256"] = file_sha(comparison_path)
        require(provenance["comparisonModuleSha256"] == "3433a8539a8060af211097d350c35885a33e12f222f69b83ecb16dd424a384b6", "Comparison dependency changed")
        spec = importlib.util.spec_from_file_location("ground_native_comparison", comparison_path)
        comparison = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(comparison)
        require(args.native_report.stat().st_size <= 128 * 1024 * 1024, "Native report size budget exceeded")
        require(args.compact.stat().st_size <= 32 * 1024 * 1024, "Compact report size budget exceeded")
        with args.native_report.open() as stream:
            native = json.load(stream)
        require(native["schema"] == "cs2.native-friction-segment-oracle.v3", "Wrong native schema")
        require(native["serverSha256"] == SERVER_SHA, "Wrong native server")
        require(native["guardedNativeExecution"] is True and native["memoryGuard"]["unexpectedAccesses"] == 0, "Native guard failed")
        require(native["fixtureDefinitionSha256"] == FIXTURE_SHA and native["fixtureFileSha256"] == FIXTURE_FILE_SHA, "Native fixture identity changed")
        execution = comparison.content_digest(native, "release")
        require(execution == EXECUTION_SHA, "Native execution content changed")
        require(len(native["fixtures"]) == 105 and len(native["sequences"]) == 108, "Native case count changed")
        require(sum(len(s["rows"]) for s in native["sequences"]) == 10980, "Native row count changed")
        native_sha = file_sha(args.native_report)
        require(file_sha(args.fixtures) == FIXTURE_FILE_SHA, "Fixture file changed")
        definition = json.loads(args.fixtures.read_text())
        require(content_sha(definition) == FIXTURE_SHA, "Canonical fixture definition changed")
        require(definition["schema"] == "cs2.native-friction-segment-fixtures.v3", "Wrong fixture schema")
        require(content_sha(definition["fixtures"]) == content_sha(native["fixtures"]), "Native fixtures differ from fixture file")
        compact = json.loads(args.compact.read_text())
        require(compact["schema"] == "cs2.native-friction-release-endpoints.v3", "Wrong compact schema")
        require(compact["sourceSchema"] == native["schema"] and compact["sourceNativeSha256"] == native_sha, "Compact/raw source association changed")
        require(compact["readerSha256"] == native["readerSha256"], "Compact reader association changed")
        release_fixtures = [{"id": f["id"], "kind": f["kind"], "suppliedSpeed": f["suppliedSpeed"]}
                            for f in native["fixtures"] if f["kind"] == "release"]
        speeds = {f["id"]: f["suppliedSpeed"] for f in release_fixtures}
        sequences = []
        for sequence in native["sequences"]:
            if sequence["fixtureId"] not in speeds:
                continue
            rows = []
            for row in sequence["rows"]:
                item = {key: row[key] for key in ("command", "startFraction", "endFraction", "duration", "endTimeFromFixtureStart")}
                item["afterPostHelper"] = {key: row["afterPostHelper"][key] for key in ("speedX", "speedY")}
                item["nativeStopGateTaken"] = row["nativeStopGate"]["taken"]
                rows.append(item)
            sequences.append({"fixtureId": sequence["fixtureId"], "suppliedSpeed": speeds[sequence["fixtureId"]],
                              "mxcsrProfile": sequence["mxcsrProfile"], "rows": rows})
        semantics = {"serverSha256": SERVER_SHA, "fixtureDefinitionSha256": FIXTURE_SHA,
                     "fixtureFileSha256": FIXTURE_FILE_SHA, "guardedNativeExecution": True, "unexpectedAccesses": 0,
                     "releaseFixtures": release_fixtures, "derivedReleaseThresholds": native["derivedReleaseThresholds"],
                     "releaseSequences": sequences}
        observed = {key: compact[key] for key in semantics}
        semantic_sha = content_sha(semantics)
        require(content_sha(observed) == semantic_sha, "Compact endpoint semantics differ from verified native report")
        require(len(sequences) == 98 and len(release_fixtures) == 96, "Release case count changed")
        require(sum(len(s["rows"]) for s in sequences) == 10939, "Release endpoint count changed")
        stable = {"schema": "cs2.verified-accuracy-release-endpoints.v1", "sourceSchema": native["schema"],
                  "sourceExecutionSha256": execution, **semantics}
        target = args.output / "endpoints.json"
        with target.open("x") as stream:
            json.dump(stable, stream, sort_keys=True, separators=(",", ":"), allow_nan=False)
            stream.write("\n")
        provenance.update(status="passed", sourceNativePath=str(args.native_report.resolve()), sourceNativeSha256=native_sha,
                          sourceReaderSha256=native["readerSha256"], compactSourcePath=str(args.compact.resolve()),
                          compactSourceSha256=file_sha(args.compact), sourceExecutionSha256=execution,
                          reconstructedCompactSemanticSha256=semantic_sha, stableEndpointContentSha256=content_sha(stable),
                          outputSha256=file_sha(target), releaseSequences=98, uniqueReleaseFixtures=96, endpointRows=10939,
                          method="Exact canonical native execution check, then full compact endpoint/fixture/threshold reconstruction comparison")
    except Exception as error:
        code = 1
        provenance.update(status="failed", error={"type": type(error).__name__, "message": str(error)})
    finally:
        proof = args.output / "provenance.json"
        proof.write_text(json.dumps(provenance, indent=2) + "\n")
        print(json.dumps(provenance))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
