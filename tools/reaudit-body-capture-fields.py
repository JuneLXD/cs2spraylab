import struct

def read_body_fields(read, base, player, node):
    # read(address, count) -> bytes; module base/player accepted for the caller API.
    b = read(node, 0x114)
    f3 = lambda offset: list(struct.unpack_from('<3f', b, offset))
    parent = struct.unpack_from('<Q', b, 0x38)[0]
    out = {
        'sceneParent': parent,
        'sceneLocalAngles': f3(0xb8),
        'sceneAbsoluteAngles': f3(0xd4),
        'sceneAbsoluteOrigin': f3(0xc8),
        'sceneNodeToWorld': list(struct.unpack_from('<8f', b, 0x10)),
        'sceneAbsUpdateSourceAngles': f3(0xf0),
        'sceneAbsUpdateSourceOrigin': f3(0xe4),
        'sceneAbsTransformDirty': b[0x110],
    }
    if parent:
        try: out['sceneParentNodeToWorld'] = list(struct.unpack('<8f', read(parent + 0x10, 32)))
        except (OSError, ValueError, struct.error): out['sceneParentNodeToWorld'] = None
    return out
