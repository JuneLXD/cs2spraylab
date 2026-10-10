"""Prepared read-only TransformHistory capture, distinct from velocity history.

Caller obligations: bind the full client hash and game-owned process; re-read
every returned guardBlock after the entire snapshot; reject changes or read
errors. This helper never opens a process, invokes native code or writes memory.
The shared current record has several writers. Neither it nor sampled globals
identify the last interpolation invocation's arguments or selected endpoints.
"""
import math
import struct

CLIENT_SHA256 = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
MAX_CAPTURE_BYTES = 8192
# The observed live pawn embeds a named network-variable subclass. Exact RTTI
# and ABI relocation bindings prove its zero-displacement skeleton/scene base;
# registration and scene transform virtuals match CSkeletonInstance.
SCENE_NODE_CLASSES = (0x44dcf80, 0x44d2198, 0x43df2b0)


def read_transform_history_fields(read, base, player, node):
    guards = []
    total = 0

    def take(address, length):
        nonlocal total
        if not (0 < address < address+length <= 2**63 and 0 < length <= 256):
            raise ValueError('Invalid TransformHistory read address or size')
        total += length
        if total > MAX_CAPTURE_BYTES:
            raise ValueError('TransformHistory read budget exceeded')
        raw = read(address, length)
        if len(raw) != length:
            raise ValueError('Short TransformHistory read')
        guards.append((address, raw.hex()))
        return raw

    def q(address): return struct.unpack('<Q', take(address, 8))[0]

    def fail(reason):
        return dict(fields=dict(transformHistoryValid=False, transformHistoryReason=reason), guardBlocks=guards)

    if q(node) not in tuple(base+table for table in SCENE_NODE_CLASSES):
        return fail('scene node class unbound')
    if q(node+0x30) != player:
        return fail('scene node owner mismatch')
    wrapper = q(node+0x68)
    if not wrapper:
        return fail('transform wrapper unavailable')
    header = take(wrapper, 0x60)
    getq = lambda at: struct.unpack_from('<Q', header, at)[0]
    if getq(0) != base+0x44d23f8:
        return fail('TransformHistory procedural wrapper class unbound')
    # Exact nonvirtual registered callbacks plus zero member-pointer adjustors.
    if not (getq(0x28)==node and getq(0x30)==base+0x16f4040 and getq(0x38)==0 and
            getq(0x40)==node and getq(0x48)==base+0x16f4300 and getq(0x50)==0 and getq(0x58)==node):
        return fail('TransformHistory callback or owner binding changed')
    flags = list(header[0x10:0x14])
    if flags[1] & 63 != 1:
        return fail('only one TransformHistory component is decoded')
    current, storage = getq(0x18), getq(0x20)
    if not current or current & 15 or not storage or storage & 7:
        return fail('current record or history storage unavailable/unaligned')
    parent = q(node+0x38)
    parent_token = q(node+0x78)
    attachment_token = struct.unpack('<I', take(node+0x128, 4))[0]
    node_fields = take(node+0xb8, 0x48)
    node_flags = take(node+0x104, 0x10)
    finite_node = struct.unpack_from('<18f', node_fields)
    if not all(math.isfinite(x) for x in finite_node):
        return fail('nonfinite scene angles/origins/scales')

    def record(raw):
        # A 96-byte value has meaningful fields through byte85; trailing
        # padding is guarded but is neither decoded nor exported as data.
        values = list(struct.unpack_from('<18f', raw))
        if not all(math.isfinite(x) for x in values):
            raise ValueError('Nonfinite TransformHistory value')
        if raw[0x54] not in (0, 1) or raw[0x55] not in (0, 1):
            raise ValueError('Invalid TransformHistory boolean flags')
        token = struct.unpack_from('<Q', raw, 0x48)[0]
        attachment = struct.unpack_from('<I', raw, 0x50)[0]
        force_world = bool(raw[0x54])
        return dict(localOrigin=values[0:3], localOriginW=values[3], localQuaternion=values[4:8],
            worldOrigin=values[8:11], worldOriginW=values[11], worldQuaternion=values[12:16],
            localScale=values[16], worldScale=values[17],
            parentIdentityWords=list(struct.unpack_from('<2I', raw, 0x48)),
            parentIdentityMatchesNode=token==parent_token, parentIdentityIsInvalid=token==0xffffffff,
            attachmentToken=attachment, attachmentMatchesNode=attachment==attachment_token,
            forceWorld=force_world, flag55=bool(raw[0x55]),
            parentlessConsumerChoiceIfInvokedNow=None if parent else ('world' if force_world or token!=0xffffffff else 'local'))

    fields = dict(transformHistoryValid=True, transformHistoryClassBound=True,
        transformHistoryCallbacksBound=True, transformWrapperFlags=flags,
        transformHasParent=bool(parent), transformParentIdentityWords=[parent_token&0xffffffff, parent_token>>32],
        transformAttachmentToken=attachment_token,
        transformSceneLocalAngles=list(finite_node[0:3]), transformSceneLocalScale=finite_node[3],
        transformSceneAbsoluteOrigin=list(finite_node[4:7]), transformSceneAbsoluteAngles=list(finite_node[7:10]),
        transformSceneAbsoluteScale=finite_node[10], transformSceneEvaluatedLocalOrigin=list(finite_node[11:14]),
        transformSceneEvaluatedLocalAngles=list(finite_node[14:17]), transformSceneEvaluatedLocalScale=finite_node[17],
        transformSceneFlags=list(node_flags), transformSceneDirty=bool(node_flags[0xc]),
        transformCurrentRecord=record(take(current, 96)), transformHistoryRings=[])
    ring_count = 2 if flags[0]&0x20 else 1
    headers = take(storage, ring_count*32)
    for number in range(ring_count):
        raw = headers[number*32:(number+1)*32]
        data, packed, free_mask, validity_tick, offset_ticks, time_offset = struct.unpack_from('<QIIiif', raw)
        head, components, count, capacity = packed&63, (packed>>6)&63, (packed>>13)&63, (packed>>19)&63
        if not math.isfinite(time_offset) or components != 1 or not 0 <= count <= capacity <= 32:
            raise ValueError('Unsupported TransformHistory ring shape')
        if capacity and not (data and data%8==0 and head < capacity):
            raise ValueError('Invalid TransformHistory ring storage/head')
        if not capacity and (count or head):
            raise ValueError('Invalid empty TransformHistory ring')
        ring = dict(packed=packed, head=head, components=components, count=count, capacity=capacity,
            freeMask=free_mask, validityTick=validity_tick, offsetTicks=offset_ticks,
            timeOffset=time_offset, copyWholeValue=bool(packed&0x1000), entries=[])
        if count:
            entries = take(data, capacity*8)
            for logical in range(count):
                physical = (head+logical)%capacity
                tick, value_index = struct.unpack_from('<ih', entries, physical*8)
                if not 0 <= value_index < capacity:
                    raise ValueError('Invalid TransformHistory value index')
                # This 96-byte stride is bound directly to TransformHistory's
                # current reader/writer. No velocity decoder is imported.
                value = record(take(data+capacity*8+value_index*96, 96))
                ring['entries'].append(dict(logical=logical, physical=physical, tick=tick,
                    valueIndex=value_index, value=value))
        fields['transformHistoryRings'].append(ring)
    fields['transformCubicGlobalFlag'] = bool(take(base+0x468bce0, 1)[0])
    scope = take(base+0x46b81b0, 5)
    fields['transformPastNewestGateTick'] = struct.unpack_from('<i', scope)[0]
    fields['transformPastNewestGateEnabled'] = bool(scope[4])
    fallback = list(struct.unpack('<4f', take(base+0x46b7120, 16)))
    if not all(math.isfinite(x) for x in fallback):
        raise ValueError('Nonfinite quaternion zero-norm fallback')
    fields['transformQuaternionZeroNormFallback'] = fallback
    fields['transformInvocationArgumentsCaptured'] = False
    fields['transformCapturedBytes'] = total
    return dict(fields=fields, guardBlocks=guards)


def self_test():
    """Synthetic decoder only; no native execution or process reads."""
    memory, reads = {}, []
    base, player, node = 0x10000000, 0x20000000, 0x20010000
    wrapper, current, rings, data = 0x20020000, 0x20030000, 0x20040000, 0x20050000
    def put(a, b): memory.update({a+i: v for i,v in enumerate(b)})
    def q(a, v): put(a, struct.pack('<Q', v))
    def read(a, n):
        reads.append((a,n))
        return bytes(memory[a+i] for i in range(n))
    put(node, bytes(0x134)); q(node, base+0x44dcf80); q(node+0x30, player)
    q(node+0x68, wrapper); q(node+0x78, 0xffffffff)
    put(wrapper, bytes(0x60)); q(wrapper, base+0x44d23f8)
    put(wrapper+0x10, bytes([1,1,0,0])); q(wrapper+0x18, current); q(wrapper+0x20, rings)
    for at,v in [(0x28,node),(0x30,base+0x16f4040),(0x40,node),(0x48,base+0x16f4300),(0x58,node)]:q(wrapper+at,v)
    value = bytearray(96)
    struct.pack_into('<18f', value, 0, 1,2,3,1, 0,0,0,1, 4,5,6,1, 0,0,0,1, 1,1)
    struct.pack_into('<Q', value, 0x48, 0xffffffff)
    value[0x55] = 1
    put(current, value)
    packed = 1<<6 | 1<<13 | 2<<19 | 0x1000
    put(rings, struct.pack('<QIIiifI', data, packed, 2, 0, 1, 1/64, 0))
    put(data, struct.pack('<ihhihh', 100,1,0, 0,0,0))
    put(data+16+96, value)
    put(base+0x468bce0, b'\1'); put(base+0x46b81b0, bytes(5)); put(base+0x46b7120, struct.pack('<4f',0,0,0,1))
    assertions = 0
    def expect(actual, wanted):
        nonlocal assertions
        assert actual == wanted, (actual,wanted)
        assertions += 1
    out = read_transform_history_fields(read, base, player, node)
    f = out['fields']
    expect(f['transformHistoryValid'], True)
    expect(f['transformCurrentRecord']['localOrigin'], [1,2,3])
    expect(f['transformCurrentRecord']['parentlessConsumerChoiceIfInvokedNow'], 'local')
    expect(f['transformHistoryRings'][0]['entries'][0]['valueIndex'], 1)
    expect(f['transformHistoryRings'][0]['entries'][0]['value']['worldOrigin'], [4,5,6])
    expect(f['transformHistoryRings'][0]['timeOffset'], 1/64)
    expect(f['transformInvocationArgumentsCaptured'], False)
    expect(all(read(a,len(bytes.fromhex(b)))==bytes.fromhex(b) for a,b in out['guardBlocks']), True)
    q(node, base+0x43df2b0)
    expect(read_transform_history_fields(read,base,player,node)['fields']['transformHistoryValid'], True)
    q(node, base+0x44dcf80)
    q(node, base+0x43df2b8); reads.clear()
    expect(read_transform_history_fields(read,base,player,node)['fields']['transformHistoryValid'], False)
    expect(any(a==wrapper for a,n in reads), False)
    q(node, base+0x44dcf80)
    try: read_transform_history_fields(read, base, player, 0)
    except ValueError: assertions += 1
    else: raise AssertionError('Null node during teardown was accepted')
    try: read_transform_history_fields(lambda a,n: b'', base, player, node)
    except ValueError: assertions += 1
    else: raise AssertionError('Short process read was accepted')
    put(current+0x54, b'\1')
    expect(read_transform_history_fields(read,base,player,node)['fields']['transformCurrentRecord']['parentlessConsumerChoiceIfInvokedNow'], 'world')
    q(wrapper+0x30, base+1); reads.clear()
    expect(read_transform_history_fields(read,base,player,node)['fields']['transformHistoryValid'], False)
    expect(any(a==current for a,n in reads), False)
    q(wrapper+0x30, base+0x16f4040)
    put(data+4, struct.pack('<h', 2))
    try: read_transform_history_fields(read,base,player,node)
    except ValueError: assertions += 1
    else: raise AssertionError('Out-of-range index was accepted')
    # Largest admitted shape: two distinct 32-entry rings, wrapped metadata
    # and reversed value indices. It must stay within the read budget.
    put(wrapper+0x10, bytes([0x21,1,0,0]))
    packed = 31 | 1<<6 | 32<<13 | 32<<19 | 0x1000
    for ring, storage in enumerate((data, data+0x1000)):
        put(rings+ring*32, struct.pack('<QIIiifI', storage, packed, 0, 0, ring, ring/64, 0))
        for logical in range(32):
            physical, index = (31+logical)%32, 31-logical
            put(storage+physical*8, struct.pack('<ihh', 200+ring*100-logical, index, 0))
            modified = bytearray(value)
            struct.pack_into('<f', modified, 0, ring*100+logical)
            put(storage+32*8+index*96, modified)
    f = read_transform_history_fields(read,base,player,node)['fields']
    expect(len(f['transformHistoryRings']), 2)
    expect(f['transformHistoryRings'][1]['entries'][31]['value']['localOrigin'][0], 131)
    expect(f['transformCapturedBytes'] <= MAX_CAPTURE_BYTES, True)
    put(rings+8, struct.pack('<I', 1<<6 | 1<<13 | 33<<19))
    try: read_transform_history_fields(read,base,player,node)
    except ValueError: assertions += 1
    else: raise AssertionError('Oversized capacity was accepted')
    return dict(assertions=assertions, maximumReadBytes=max(n for a,n in reads),
        method='Synthetic guarded decoding only; no native invocation, process read or runtime validation.')


if __name__ == '__main__':
    import json
    print(json.dumps(self_test()))
