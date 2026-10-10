#!/usr/bin/env python3
"""Guarded 134-byte GetInaccuracy normalization block on v3 endpoint samples.

Prepared for a separately granted serialized slot. This does not execute the
owner getter, full inaccuracy function, movement dispatcher, or game.
"""
import argparse
import json
import math
import struct
import sys
from pathlib import Path

from bounded_elf import Reader, SERVER_SHA, file_sha, require, sha

START, STOP = 0x1495C84, 0x1495D0A
CONSTANTS = {0x819FB8: "7b14ae3e", 0x8CDE0C: "3333733f", 0x8CD13C: "0000803f"}
FRAME, STACK = 0x50000800, 0x50000000
PROFILES = {"nearest-gradual": 0x1F80, "nearest-ftz-daz": 0x9FC0}
SOURCES = {
    "current-inaccuracy-proof.json": "824eb4eb4b04ad6bc47e29a2b857120a00ea6e6cb13fb1083ce70db4747088ee",
    "get-inaccuracy.txt": "8d04b1f3fdbbc9f58e880dbd1935a40fc4620e2813e3b593b701c360146f6284",
    "common-getters-proof.json": "504e2c71f541941e100aaa83cbb0f67d5c3f20948e5978edd4721e6c0dd6fc75",
}


def f32(value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--input-sha256", required=True)
    parser.add_argument("--native-report", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root, output = args.root.resolve(), args.output.resolve()
    require(not output.exists(), "Refusing overwrite")
    output.mkdir(parents=True, exist_ok=False)
    report = {"status": "started", "schema": "cs2.native-movement-inaccuracy-normalization.v2",
              "readerSha256": file_sha(Path(__file__)), "serverSha256": SERVER_SHA,
              "sourceInputHashes": SOURCES, "selectedReadByteCap": 146,
              "totalByteCapExcludingStreamingHash": 3794, "sequences": [], "thresholdCases": [],
              "limits": [
                  "Only the call-free normalization block executes; the owner getter, speed getter, coefficient and power paths do not execute.",
                  "Endpoint samples and positive normalization speed are supplied from exact-hash v3 release fixtures; no live velocity or command timing is sampled.",
                  "A zero result means zero movement contribution on the ordinary native path, not zero total inaccuracy or spread.",
                  "First zero is an evaluated endpoint relative to a supplied release boundary, not a continuous crossing or physical input latency.",
                  "MXCSR controls are supplied to match each source sequence and are not observed live process state."]}
    reader = None
    exit_code = 0
    try:
        require(file_sha(Path(__file__).with_name("bounded_elf.py")) == "0c41202cb771e5252977b4158b5ab93f41b2665682527d40859950c57d4fe695", "Reader helper changed")
        source_data = {}
        for path, expected in SOURCES.items():
            raw = (Path(__file__).with_name("prerequisites") / path).read_bytes()
            require(sha(raw) == expected, "Retained source changed")
            source_data[path] = raw
        native_proof = json.loads(source_data["current-inaccuracy-proof.json"])
        require(native_proof["serverSha256"] == SERVER_SHA and native_proof["wholeArtifactHashRecomputed"], "GetInaccuracy current identity missing")
        source_listing = source_data["get-inaccuracy.txt"].decode()
        require(args.input.stat().st_size <= 32 * 1024 * 1024, "Input exceeds bounded report size")
        require(file_sha(args.input) == args.input_sha256, "V3 endpoint report changed")
        source = json.loads(args.input.read_text())
        require(source["schema"] == "cs2.native-friction-release-endpoints.v3", "Wrong endpoint schema")
        require(source["serverSha256"] == SERVER_SHA and source["guardedNativeExecution"] is True, "Source native identity/guard missing")
        require(source["unexpectedAccesses"] == 0, "Source guard failed")
        require(source["sourceSchema"] == "cs2.native-friction-segment-oracle.v3", "Wrong full source schema")
        require(file_sha(args.native_report) == source["sourceNativeSha256"], "Full v3 native report changed")
        require(file_sha(args.fixtures) == source["fixtureFileSha256"], "Fixture file changed")
        definition = json.loads(args.fixtures.read_text())
        require(sha(canonical(definition)) == source["fixtureDefinitionSha256"], "Fixture definition identity changed")
        require(definition["schema"] == "cs2.native-friction-segment-fixtures.v3", "Wrong fixture schema")
        expected_release_fixtures = [{"id": f["id"], "kind": f["kind"], "suppliedSpeed": f["suppliedSpeed"]}
                                     for f in definition["fixtures"] if f["kind"] == "release"]
        require(expected_release_fixtures == source["releaseFixtures"], "Release fixture identities differ from definition")
        require(definition["ownerExternalVector"] == [0, 0, 0], "External owner vector not zero")
        require(definition["initialAccelerationWork"] == [0, 0, 0] and definition["initialCarriedDelta"] == [0, 0, 0], "Initial velocity helper state changed")
        require(definition["mxcsrProfiles"] == PROFILES, "Source MXCSR profiles changed")
        report["endpointInput"] = {"path": str(args.input.resolve()), "sha256": args.input_sha256,
                                   "fixtureDefinitionSha256": source["fixtureDefinitionSha256"],
                                   "fixtureFileSha256": source["fixtureFileSha256"],
                                   "readerSha256": source["readerSha256"],
                                   "sourceSchema": source["sourceSchema"],
                                   "sourceNativeSha256": source["sourceNativeSha256"],
                                   "sourceNativePath": str(args.native_report.resolve()),
                                   "compactEndpointSchema": source["schema"]}
        fixtures = {f["id"]: f for f in source["releaseFixtures"]}
        require(len(fixtures) == len(source["releaseFixtures"]), "Duplicate fixture identity")
        require(sum(len(s["rows"]) for s in source["releaseSequences"]) <= 25000, "Case budget exceeded")
        binary = root / "cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so"
        report["observedServerSha256"] = file_sha(binary)
        require(report["observedServerSha256"] == SERVER_SHA, "Current server mismatch")
        report["fullServerHashVerified"] = True
        sys.path.insert(0, str(root / "native-audit/python"))
        from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_GRP_CALL
        from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE, UC_HOOK_MEM_READ, UC_HOOK_MEM_WRITE, UC_MEM_READ
        from unicorn.x86_const import UC_X86_REG_RBP, UC_X86_REG_RIP, UC_X86_REG_MXCSR, UC_X86_REG_XMM0, UC_X86_REG_XMM1
        with binary.open("rb") as stream:
            reader = Reader(stream, False)
            reader.limit = 3794
            header = reader.read(0, 64, "elf-header")
            require(header[:6] == b"\x7fELF\x02\x01" and struct.unpack_from("<H", header, 18)[0] == 62, "ELF mismatch")
            phoff = struct.unpack_from("<Q", header, 32)[0]
            phsize, phnum = struct.unpack_from("<HH", header, 54)
            require(phsize == 56 and 0 < phnum <= 64, "Program-header cap exceeded")
            headers = reader.read(phoff, phsize * phnum, "program-headers")
            for index in range(phnum):
                kind, flags, off, va, _, filesz, _, _ = struct.unpack_from("<IIQQQQQQ", headers, index * phsize)
                if kind == 1:
                    reader.loads.append({"flags": flags, "offset": off, "va": va, "size": filesz})
            code = reader.virtual(START, STOP - START, "inaccuracy-normalization-block", executable=True)
            literals = {}
            for address, expected in CONSTANTS.items():
                raw = reader.virtual(address, 4, "normalization-constant")
                require(raw.hex() == expected, "Normalization constant changed")
                literals[address] = raw
        decoder = Cs(CS_ARCH_X86, CS_MODE_64)
        decoder.detail = True
        instructions = list(decoder.disasm(code, START))
        require(sum(i.size for i in instructions) == len(code), "Decode does not cover exact block")
        require(all(not i.group(CS_GRP_CALL) for i in instructions), "Unexpected call")
        for insn in instructions:
            text = f"{insn.address:x}: {insn.mnemonic} {insn.op_str}"
            require(any(line.split(" ;")[0] == text for line in source_listing.splitlines()), "Native block differs from retained source listing")
        report["block"] = {"entry": hex(START), "stop": hex(STOP), "bytes": len(code), "hex": code.hex(), "sha256": sha(code)}
        pcs = {i.address: i.size for i in instructions}
        counts, accesses = {"instructions": 0, "reads": 0, "writes": 0, "cases": 0}, {}
        mxcsr_results = {}
        # This deliberately maps a few exact pages rather than the full ELF.
        u = Uc(UC_ARCH_X86, UC_MODE_64)
        for page in sorted({START & ~4095, STOP & ~4095, STACK, *[at & ~4095 for at in literals]}):
            u.mem_map(page, 4096)
        u.mem_write(START, code)
        for at, raw in literals.items():
            u.mem_write(at, raw)
        reads = {(FRAME - 0x58, 4), (FRAME - 0x3C, 4), (FRAME - 0x38, 4), *[(at, 4) for at in literals]}
        writes = {(FRAME - 0x3C, 8), (FRAME - 0x34, 4), (FRAME - 0x60, 4)}
        current = {"instructions": 0}

        def guard_code(machine, address, size, _):
            require(pcs.get(address) == size, "Instruction outside exact block")
            current["instructions"] += 1
            counts["instructions"] += 1
            require(current["instructions"] <= 80, "Instruction budget exceeded")

        def guard_memory(machine, operation, address, size, value, _):
            reading = operation == UC_MEM_READ
            require((address, size) in (reads if reading else writes), "Unexpected native data span")
            label = "reads" if reading else "writes"
            counts[label] += 1
            key = (label, address, size)
            accesses[key] = accesses.get(key, 0) + 1

        u.hook_add(UC_HOOK_CODE, guard_code)
        u.hook_add(UC_HOOK_MEM_READ | UC_HOOK_MEM_WRITE, guard_memory)

        def execute(x, y, speed, profile):
            require(all(math.isfinite(v) for v in (x, y, speed)) and 0 < speed <= 1000, "Invalid supplied normalization inputs")
            require(profile in PROFILES, "Unknown source MXCSR profile")
            current["instructions"] = 0
            u.mem_write(STACK, bytes(4096))
            u.mem_write(FRAME - 0x58, struct.pack("<f", speed))
            u.reg_write(UC_X86_REG_RBP, FRAME)
            u.reg_write(UC_X86_REG_XMM0, int.from_bytes(struct.pack("<ff", x, y), "little"))
            u.reg_write(UC_X86_REG_XMM1, 0)
            u.reg_write(UC_X86_REG_MXCSR, PROFILES[profile])
            u.emu_start(START, STOP, count=80)
            require(u.reg_read(UC_X86_REG_RIP) == STOP, "Did not stop at exact normalization boundary")
            actual = u.reg_read(UC_X86_REG_MXCSR)
            require(actual & ~0x3F == PROFILES[profile], "MXCSR controls changed")
            result = struct.unpack("<f", (u.reg_read(UC_X86_REG_XMM0) & 0xFFFFFFFF).to_bytes(4, "little"))[0]
            require(math.isfinite(result) and 0 <= result <= 1, "Invalid normalized result")
            counts["cases"] += 1
            key = f"{profile}:{actual:#x}"
            mxcsr_results[key] = mxcsr_results.get(key, 0) + 1
            return result

        for sequence in source["releaseSequences"]:
            fixture = fixtures[sequence["fixtureId"]]
            if fixture["kind"] != "release":
                continue
            speed, profile = fixture["suppliedSpeed"], sequence["mxcsrProfile"]
            rows, first = [], None
            prior_time = -math.inf
            for row in sequence["rows"]:
                endpoint = row["afterPostHelper"]
                result = execute(endpoint["speedX"], endpoint["speedY"], speed, profile)
                when = row["endTimeFromFixtureStart"]
                require(math.isfinite(when) and when >= prior_time, "Endpoint time moved backwards")
                item = {"command": row["command"], "startFraction": row["startFraction"], "endFraction": row["endFraction"],
                        "duration": row["duration"], "endTimeFromFixtureStart": when,
                        "suppliedVelocity": [endpoint["speedX"], endpoint["speedY"]],
                        "nativeNormalizedMovement": result, "zeroMovementContribution": result == 0, "nativeStopGateTaken": row["nativeStopGateTaken"]}
                if first is None and result == 0:
                    first = {"row": len(rows), "endpoint": item, "previousEndpoint": rows[-1] if rows else None}
                rows.append(item)
                prior_time = when
            report["sequences"].append({"fixtureId": fixture["id"], "mxcsrProfile": profile,
                                        "suppliedNormalizationSpeed": speed, "rows": rows, "firstZeroEndpoint": first})
        for speed in (200, 215, 225, 230, 240):
            threshold = f32(f32(0.34) * f32(speed))
            bits = struct.unpack("<I", struct.pack("<f", threshold))[0]
            for delta in (-1, 0, 1):
                value = struct.unpack("<f", struct.pack("<I", bits + delta))[0]
                for profile in PROFILES:
                    result = execute(value, 0, speed, profile)
                    report["thresholdCases"].append({"suppliedNormalizationSpeed": speed, "threshold": threshold,
                                                      "float32Neighbor": delta, "speedX": value, "speedY": 0,
                                                      "mxcsrProfile": profile, "nativeNormalizedMovement": result})
        report["memoryGuard"] = {"policy": "Exact instruction PCs/sizes; exact data address/width allowlists; 80 instructions per case; no calls.",
                                 "counts": counts, "unexpectedAccesses": 0,
                                 "accesses": [{"operation": op, "address": hex(at), "bytes": size, "count": count}
                                              for (op, at, size), count in sorted(accesses.items())]}
        report["mxcsrExecutionResults"] = mxcsr_results
        report["guardedNativeExecution"] = True
        report["status"] = "passed"
    except Exception as error:
        exit_code = 1
        report["status"] = "failed"
        report["error"] = {"type": type(error).__name__, "message": str(error)}
    finally:
        report["reads"] = [] if reader is None else reader.reads
        report["bytesReadExcludingStreamingHash"] = 0 if reader is None else reader.bytes
        target = output / "proof.json"
        target.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
        print(json.dumps({"status": report["status"], "output": str(target), "sha256": file_sha(target),
                          "releaseSequences": len(report["sequences"]), "cases": report.get("memoryGuard", {}).get("counts"),
                          "error": report.get("error")}))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
