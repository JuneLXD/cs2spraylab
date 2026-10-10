"""Produce portable numeric evidence without native locations or host paths."""
import hashlib
import json
from pathlib import Path
import struct


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def float_bits(values):
    if isinstance(values, dict):
        return {key: float_bits(value) for key, value in values.items()}
    if isinstance(values, list):
        return [float_bits(value) for value in values]
    return struct.pack('<f', values).hex()


def summarize(root, output, original, tools, originals, stages):
    native_path = output / 'native-tables.json'
    native = json.loads(native_path.read_text())
    old = json.loads((original / 'native-tables.json').read_text())
    comparison_path = original / 'trainer-comparison.json'
    comparison = json.loads(comparison_path.read_text())
    assert comparison['nativeReportSha256'] == sha(original / 'native-tables.json')
    for key in ('tables', 'alternateTables', 'rngValues'):
        assert float_bits(native[key]) == float_bits(old[key]), key
    for key in ('weapons', 'scalarFields', 'fields', 'decodedSha256', 'compiledSha256',
                'identityReportSha256', 'parserSha256'):
        assert native['inputs'][key] == old['inputs'][key], key
    assert native['tableExecutionCounts'] == old['tableExecutionCounts']
    assert native['totalExecutionCounts'] == old['totalExecutionCounts']
    assert native['mappedPages'] == old['mappedPages'] == 23
    assert comparison['rawModeEntries'] == comparison['tableEntries'] == 896
    assert comparison['parameterMismatches'] == 0 and len(comparison['parameterChecks']) == 84
    assert all(row['equal'] for row in comparison['parameterChecks'])
    for key, count in (('rawModeSummary', 1792), ('tableSummary', 1792), ('rngSummary', 224)):
        assert comparison[key] == {'values': count, 'bitMismatches': 0,
                                   'maxAbsoluteError': 0, 'maxUlps': 0}
    native_inputs = native['inputs']
    reads, code_hashes = [], []
    for stage in ('current', 'arithmetic', 'rng'):
        path = output / stage / 'current-read.json'
        report = json.loads(path.read_text())
        ranges = report.get('codeRanges', report.get('ranges'))
        reads.append({'stage': stage, 'selectedBytes': report['selectedBytes'],
                      'reportSha256': sha(path), 'rangeCount': len(ranges)})
        for index, item in enumerate(ranges):
            # Some original range names embed an import address. Keep only
            # stage+ordinal in the portable manifest, with the exact byte hash.
            code_hashes.append({'stage': stage, 'range': index,
                                'bytes': item['bytes'], 'codeSha256': item['codeSha256']})
    assert sum(row['selectedBytes'] for row in reads) == 2826
    comparison_summary = {key: comparison[key] for key in
        ('commit', 'probeSha256', 'nativeReportSha256', 'sourceHashes', 'weapons',
         'rawModeEntries', 'rawModeSummary', 'tableEntries', 'tableSummary',
         'parameterMismatches', 'rngRange', 'rngSummary')}
    comparison_summary.update({'reportSha256': sha(comparison_path), 'parameterComparisons': 84,
        'association': 'Actual-source comparison used the immutable original native report. '
                       'This packaged replay independently produced identical float32 table/RNG bits and input values.'})
    primary = {name: 1 if name in ('m4a1s', 'usp') else 0 for name in native['tables']}
    # Original raw-output filenames may embed native import locations. They
    # remain in the local proof, while portable preservation records use ordinals.
    original_hashes = [{'fileOrdinal': index, 'sha256': digest}
                       for index, digest in enumerate(originals.values())]
    return {
        'schemaVersion': 1,
        'status': 'Current Linux arithmetic and bound RNG match the trainer for all supplied common-weapon modes.',
        'method': 'Hash-bound selected native code in isolated Unicorn memory; actual native constructor, '
                  'RandomFloat and integer RNG execute through current typed PLT/export bindings. '
                  'Parameters are parsed from the retained native KV3 export.',
        'serverSha256': native['serverSha256'], 'tier0Sha256': native['tier0Sha256'],
        'wholeArtifactHashesVerified': native['wholeArtifactHashesVerified'],
        'decodedWeaponDataSha256': native_inputs['decodedSha256'],
        'compiledWeaponDataSha256': native_inputs['compiledSha256'],
        'resourceIdentityReportSha256': native_inputs['identityReportSha256'],
        'kv3ParserSha256': native_inputs['parserSha256'],
        'packagedToolHashes': tools, 'stages': stages,
        'packagedNativeReportSha256': sha(native_path),
        'originalNativeReportSha256': sha(original / 'native-tables.json'),
        'originalProofUnchanged': True, 'originalProofFileHashes': original_hashes,
        'packagedReplayMatchesOriginal': {'nativeInputs': True, 'tableFloat32Bits': True,
                                         'rngFloat32Bits': True, 'executionCounts': True},
        'selectedReads': reads, 'selectedBytes': 2826, 'selectedCodeHashes': code_hashes,
        'metadataBoundary': 'Selected byte total excludes streamed full-file hashes and typed ELF '
                            'relocation/symbol table traversal. No code scan or analysis database.',
        'nativeParameterFields': native_inputs['fields'], 'weapons': native_inputs['weapons'],
        'scalarFields': native_inputs['scalarFields'],
        'rules': {'entriesPerMode': 64, 'seedResetPerMode': True,
                  'randomDrawsPerEntry': 2, 'automaticInterpolation': 0.55,
                  'automaticSuppression': [0.75, 0.8125, 0.875, 0.9375],
                  'semiautomaticInterpolationOrSuppression': False,
                  'arithmetic': 'Native float32 instruction sequence; constants are not a fitted model.'},
        'tableEntries': 896, 'tableScalarValues': 1792,
        'tableExecutionCounts': native['tableExecutionCounts'],
        'totalExecutionCounts': native['totalExecutionCounts'],
        'tableInvocationCounts': native['tableInvocationCounts'],
        'mappedPrivatePages': native['mappedPages'], 'executionBoundary': native['executionBoundary'],
        'modeMeaning': {'tables': 'Raw native mode 0', 'alternateTables': 'Raw native mode 1',
                        'trainerPrimaryNativeMode': primary,
                        'trainerAlternateNativeMode': {name: 1 for name in primary},
                        'limit': 'Trainer supported mapping is compared separately from raw-mode arithmetic. '
                                 'Default silenced M4A1-S and USP-S use native mode 1.'},
        'tables': native['tables'], 'alternateTables': native['alternateTables'],
        'rngRange': native['rngRange'], 'rngValues': native['rngValues'], 'rngValueCount': 224,
        'actualSourceComparison': comparison_summary,
        'limits': [
            'Supplied-state entry follows successful resource lookup; cache allocation and live resource construction are not executed.',
            'Named parameter fields use current paired-load code plus retained schema interpretation; compiled-resource identity is retained from pass39, not a new export.',
            'The authored scalar zero angle is supplied as zero to both fields; no missing value uses a trainer default.',
            'Private GOT targets and supplied caller/resource memory are setup. No numeric RNG/table function is stubbed.',
            'This is offline native instruction execution, not a CS2 session or proof of runtime invocation.',
            'Per-command seed generation, table index selection, shot scheduling, aim punch and camera behavior remain outside this proof.',
            'Older Windows oracles and their exact artifact guards are preserved unchanged.'
        ]
    }
