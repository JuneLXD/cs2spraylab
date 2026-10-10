#!/usr/bin/env python3
"""Bounded ELF reads and streaming artifact hashes; no section or code scan."""
import argparse
import hashlib
import json
import struct
from pathlib import Path


SERVER_SHA = "c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a"
DEFAULT_READ_MAX = 3794
WITH_CODE_READ_MAX = 3794


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def file_sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class Reader:
    def __init__(self, stream, read_code):
        self.stream = stream
        self.limit = WITH_CODE_READ_MAX if read_code else DEFAULT_READ_MAX
        self.reads = []
        self.bytes = 0
        self.loads = []

    def read(self, offset, size, label, va=None):
        require(offset >= 0 and 0 < size <= 4096, "Invalid bounded read")
        require(self.bytes + size <= self.limit, "Read budget exceeded")
        self.stream.seek(offset)
        raw = self.stream.read(size)
        require(len(raw) == size, "Truncated file read")
        self.bytes += size
        self.reads.append({"label": label, "fileOffset": hex(offset),
                           "virtualAddress": None if va is None else hex(va),
                           "bytes": size, "sha256": sha(raw), "hex": raw.hex()})
        return raw

    def mapped(self, va, size, executable=False):
        matches = [p for p in self.loads if p["va"] <= va and
                   va + size <= p["va"] + p["size"] and
                   (not executable or p["flags"] & 1)]
        require(len(matches) == 1, "Range lacks unique required PT_LOAD mapping")
        return matches[0]

    def virtual(self, va, size, label, executable=False):
        load = self.mapped(va, size, executable)
        return self.read(load["offset"] + va - load["va"], size, label, va)

