#!/usr/bin/env python3
"""Compare portable native normalization with the preserved original execution."""
import argparse
import hashlib
import json
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def execution_digest(proof):
    values = {key: proof[key] for key in ("serverSha256", "sequences", "thresholdCases", "mxcsrExecutionResults")}
    values["blockSha256"] = proof["block"]["sha256"]
    values["guardCounts"] = proof["memoryGuard"]["counts"]
    digest = hashlib.sha256()
    for chunk in json.JSONEncoder(sort_keys=True, separators=(",", ":"), allow_nan=False).iterencode(values):
        digest.update(chunk.encode())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proof", type=Path, required=True)
    parser.add_argument("--proof-sha256", required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--original-proof", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert not args.output.exists(), "Refusing overwrite"
    assert digest(args.proof) == args.proof_sha256, "Normalization report changed"
    proof = json.loads(args.proof.read_text())
    source = json.loads(args.source.read_text())
    assert proof["status"] == "passed" and proof["guardedNativeExecution"] is True
    assert proof["memoryGuard"]["unexpectedAccesses"] == 0
    assert source["schema"] == "cs2.verified-accuracy-release-endpoints.v1"
    assert source["guardedNativeExecution"] is True and source["unexpectedAccesses"] == 0
    assert digest(args.source) == proof["endpointInput"]["sha256"], "Endpoint report changed"
    assert source["fixtureDefinitionSha256"] == proof["endpointInput"]["fixtureDefinitionSha256"]
    assert source["serverSha256"] == proof["serverSha256"]
    assert digest(args.original_proof) == "8afbe32b9d37c38908eb31d353d97a2b05b20d71c869d6b8243083e7493efe41", "Original normalization proof changed"
    original = json.loads(args.original_proof.read_text())
    assert original["status"] == "passed" and original["guardedNativeExecution"] is True
    assert original["memoryGuard"]["unexpectedAccesses"] == 0
    original_execution = execution_digest(original)
    portable_execution = execution_digest(proof)
    assert original_execution == portable_execution, "Portable normalization execution differs"
    derived = {(row["fixtureId"], row["mxcsrProfile"]): row for row in source["derivedReleaseThresholds"]}
    boundaries = []
    for row in proof["sequences"]:
        native = row["firstZeroEndpoint"]
        previous = derived[(row["fixtureId"], row["mxcsrProfile"])]["firstQualifiedBoundary"]
        stopped = derived[(row["fixtureId"], row["mxcsrProfile"])]["firstExactStopBoundary"]
        assert native is not None and native["row"] == previous["rowIndex"]
        assert native["endpoint"]["endTimeFromFixtureStart"] == previous["timeFromFixtureStart"]
        assert native["endpoint"]["endTimeFromFixtureStart"] < stopped["timeFromFixtureStart"]
        assert native["endpoint"]["nativeStopGateTaken"] is False
        boundaries.append({"fixtureId": row["fixtureId"], "mxcsrProfile": row["mxcsrProfile"],
                           "nativeFirstZeroEndpointSeconds": native["endpoint"]["endTimeFromFixtureStart"],
                           "sourceFirstExactStopEndpointSeconds": stopped["timeFromFixtureStart"]})
    assert len(boundaries) == 98 and len({r["fixtureId"] for r in boundaries}) == 96
    assert len(proof["thresholdCases"]) == 30
    assert all((r["nativeNormalizedMovement"] == 0) == (r["float32Neighbor"] <= 0) for r in proof["thresholdCases"])
    manifest_path = Path(__file__).with_name("manifest.json")
    manifest = json.loads(manifest_path.read_text())
    out = {
        "schema": "cs2.ground-friction-accuracy-portable-summary.v1",
        "status": "passed",
        "localProofIdentifier": "AUDIT-GROUND-FRICTION-ACCURACY-01",
        "identifierKind": "Locally assigned proof identifier, not an REA-issued ledger ID",
        "method": "Canonically verified movement execution and reconstructed compact input; guarded normalization exactly matches preserved original execution",
        "originalNormalizationProofSha256": digest(args.original_proof),
        "normalizationExecutionContentSha256": portable_execution,
        "matchesOriginalNormalizationExecution": True,
        "sourceMovementExecutionContentSha256": proof["endpointInput"]["sourceExecutionSha256"],
        "stableEndpointContentSha256": proof["endpointInput"]["stableEndpointContentSha256"],
        "preparationProofSha256": proof["endpointInput"]["preparationProofSha256"],
        "serverSha256": proof["serverSha256"],
        "normalizationProofSha256": args.proof_sha256,
        "normalizerSha256": proof["readerSha256"],
        "summaryToolSha256": digest(Path(__file__)),
        "manifestSha256": digest(manifest_path),
        "stableEndpointFileSha256": proof["endpointInput"]["sha256"],
        "sourceRawNativeProofSha256": proof["endpointInput"]["sourceNativeSha256"],
        "fixtureDefinitionSha256": proof["endpointInput"]["fixtureDefinitionSha256"],
        "guardedNativeExecution": True,
        "nativeCodeBytes": proof["block"]["bytes"],
        "constantBytes": 12,
        "nativeExecutionCounts": proof["memoryGuard"]["counts"],
        "unexpectedAccesses": 0,
        "releaseSequences": len(boundaries),
        "uniqueReleaseFixtures": len({r["fixtureId"] for r in boundaries}),
        "endpointCases": sum(len(r["rows"]) for r in proof["sequences"]),
        "thresholdNeighborCases": len(proof["thresholdCases"]),
        "allDerivedBoundarySelectionsMatchNativeNormalization": True,
        "allMovementZeroBoundariesPrecedeExactStop": True,
        "allThresholdNeighborsBelowOrAtAreZeroAndAboveArePositive": True,
        "mxcsrExecutionResults": proof["mxcsrExecutionResults"],
        "commonClassBinding": {
            "weapons": ["ak47", "m4a4", "m4a1s", "deagle", "glock", "usp", "awp"],
            "normalizationSpeed": "Shared getter selects current-mode native maximum speed; no crouch or owner velocity scaling in that getter",
            "retainedProofSha256": "504e2c71f541941e100aaa83cbb0f67d5c3f20948e5978edd4721e6c0dd6fc75"},
        "staticPublicationAssociation": {
            "proved": "Completed segment velocity is passed to owner setter; its ordinary changed-vector path clears the getter refresh bit and copies the exact vector read by GetInaccuracy",
            "ordinaryLocalXYInlinePaths": "Update separate local and quantized fields and rejoin; no direct rewrite of the published vector or refresh bit in those paths",
            "remainingBoundary": "Pre-copy notification, range helper and optional indirect component callbacks are uninspected; complete setter side effects and live shot schedule remain unproved",
            "retainedProofs": manifest["staticPublicationProofs"]},
        "limits": proof["limits"] + [
            "The supplied 250-unit speed is a sensitivity input, not a common-weapon identity.",
            "Static publication association does not prove all callbacks leave the published vector and refresh bit unchanged."],
        "boundaries": boundaries}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "sha256": digest(args.output), "status": "passed", "releaseSequences": len(boundaries)}))


if __name__ == "__main__":
    main()
