"""Bounded numeric velocity histories for the existing game-only read sampler.

Bindings are checked by reaudit-velocity-history.py against the current client.
The outer sampler reads these fields twice and rejects any changed snapshot.
No unrelated process, memory writes, or whole-memory dump is involved.
"""
import math
import struct


def read_velocity_fields(read, base, player, node):
    wrapper = read(player+0x5c8, 0x88)
    storage = struct.unpack_from('<Q', wrapper, 0x80)[0]
    current = struct.unpack_from('<Q', wrapper, 0x78)[0]
    flags = list(wrapper[0x70:0x74])
    result = dict(velocityHistoryStorage=storage, velocityCurrentValue=current,
                  velocityWrapperFlags=flags, velocityHistoryRings=[])
    if not storage:
        return result
    count = 2 if flags[0] & 0x20 else 1
    header = read(storage, count*32)
    for number in range(count):
        ring = header[number*32:(number+1)*32]
        data, packed = struct.unpack_from('<QI', ring)
        head, components, size, capacity = packed & 63, (packed >> 6) & 63, (packed >> 13) & 63, (packed >> 19) & 63
        offset = struct.unpack_from('<f', ring, 24)[0]
        row = dict(packed=packed, head=head, components=components, count=size, capacity=capacity,
                   copyWholeValue=bool(packed & 0x1000),
                   freeMask=struct.unpack_from('<I', ring, 12)[0],
                   validityTick=struct.unpack_from('<i', ring, 16)[0], timeOffset=offset, entries=[])
        if not math.isfinite(offset):
            raise ValueError('Nonfinite velocity history offset')
        if size:
            if not (data and 0 < size <= capacity <= 63 and 0 <= head < capacity and 1 <= components <= 8):
                raise ValueError('Unsupported or changing velocity history shape')
            metadata = read(data, capacity*8)
            for logical in range(size):
                physical = (head+logical) % capacity
                tick, value_index = struct.unpack_from('<ih', metadata, physical*8)
                if not 0 <= value_index < capacity:
                    raise ValueError('Unsupported or changing velocity history value index')
                values = read(data+capacity*8+value_index*components*40, components*40)
                vectors = [list(struct.unpack_from('<3f', values, component*40)) for component in range(components)]
                if not all(math.isfinite(x) for vector in vectors for x in vector):
                    raise ValueError('Nonfinite velocity history vector')
                row['entries'].append(dict(logical=logical, physical=physical, tick=tick,
                    valueIndex=value_index, vectors=vectors,
                    # Numeric words retain encoding/quantization metadata without dereferencing it.
                    valueWords=list(struct.unpack('<'+'I'*(len(values)//4),values))))
            if metadata != read(data, capacity*8):
                raise ValueError('Velocity history metadata changed during read')
        result['velocityHistoryRings'].append(row)
    if header != read(storage, count*32) or wrapper != read(player+0x5c8, 0x88):
        raise ValueError('Velocity history header changed during read')
    return result
