// Starts Blender with tools/blender-server.py unless something (that server or the
// Blender MCP add-on) already listens on the pipeline port, then waits for it.
// `node tools/blender-server.mjs` starts it; `--stop` asks it to quit.
import net from 'node:net';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const port = Number(process.env.SPRAYLAB_BLENDER_PORT || 9876);
const blender = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reachable = () => new Promise(resolve => {
  const socket = net.connect(port, '127.0.0.1', () => {socket.destroy(); resolve(true);});
  socket.on('error', () => resolve(false));
});

/** Resolves true when this call started Blender, false when a server was already running. */
export async function ensureBlender() {
  if (await reachable()) return false;
  // A real window is required: the art scripts switch scenes through bpy.context.window.
  const child = spawn(blender, ['--factory-startup', '--no-window-focus', '--window-geometry', '0', '0', '960', '600',
    '--python', path.join(root, 'tools/blender-server.py')], {detached: true, stdio: 'ignore', env: {...process.env, SPRAYLAB_BLENDER_PORT: String(port)}});
  child.unref();
  const failed = new Promise((_, reject) => child.once('error', error => reject(new Error(`Could not start ${blender}: ${error.message}. Set BLENDER to blender.exe.`))));
  for (let attempt = 0; attempt < 360; attempt++) {
    if (await Promise.race([reachable(), failed])) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Blender did not listen on port ${port} within three minutes.`);
}

export function stopBlender() {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(JSON.stringify({type: 'quit', params: {}})));
    socket.on('data', () => socket.end());
    socket.on('close', () => resolve());
    socket.on('error', () => resolve());
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--stop')) await stopBlender();
  else console.log(await ensureBlender() ? `Started Blender on port ${port}` : `Blender already listening on port ${port}`);
}
