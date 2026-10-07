# Runs inside Blender's UI process: blender --python tools/blender-server.py
# Serves the subset of the Blender MCP socket protocol that tools/blender-command.mjs
# uses (execute_code, get_scene_info), so the asset pipeline can drive Blender
# without installing an add-on. Code runs on Blender's main thread with a window
# context, because the art scripts switch scenes through bpy.context.window.
import io
import json
import os
import socket
import traceback
from contextlib import redirect_stdout

import bpy

PORT = int(os.environ.get('SPRAYLAB_BLENDER_PORT', '9876'))
# Start from an empty file. The factory scene's selected Cube would otherwise be
# exported by art scripts that export the selection across all scenes.
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(('127.0.0.1', PORT))
server.listen(4)
server.setblocking(False)
pending = {}


def run(command):
    kind = command.get('type')
    params = command.get('params') or {}
    if kind == 'get_scene_info':
        scene = bpy.context.scene
        return {'name': scene.name, 'object_count': len(scene.objects), 'objects': [obj.name for obj in list(scene.objects)[:20]]}
    if kind == 'execute_code':
        output = io.StringIO()
        window = bpy.context.window_manager.windows[0]
        with bpy.context.temp_override(window=window), redirect_stdout(output):
            exec(params.get('code', ''), {'bpy': bpy, '__name__': '__main__'})
        return {'executed': True, 'result': output.getvalue()}
    if kind == 'quit':
        bpy.app.timers.register(lambda: bpy.ops.wm.quit_blender() and None, first_interval=0.2)
        return {'quitting': True}
    raise ValueError(f'Unknown command type: {kind}')


def poll():
    try:
        connection, _ = server.accept()
        connection.setblocking(False)
        pending[connection] = b''
    except BlockingIOError:
        pass
    for connection in list(pending):
        try:
            data = connection.recv(1 << 20)
        except BlockingIOError:
            continue
        except OSError:
            pending.pop(connection, None)
            continue
        if not data:
            pending.pop(connection, None)
            connection.close()
            continue
        pending[connection] += data
        try:
            command = json.loads(pending[connection].decode('utf-8'))
        except ValueError:
            continue
        pending.pop(connection, None)
        try:
            response = {'status': 'success', 'result': run(command)}
        except Exception as error:
            response = {'status': 'error', 'message': f'{error}\n{traceback.format_exc()}'}
        connection.setblocking(True)
        try:
            connection.sendall(json.dumps(response).encode('utf-8'))
        finally:
            connection.close()
    return 0.05


bpy.app.timers.register(poll, first_interval=0.1, persistent=True)
print(f'SprayLab Blender server listening on 127.0.0.1:{PORT}', flush=True)
