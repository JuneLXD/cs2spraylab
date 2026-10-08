// Single-file Valve VPK (v1/v2) reading and writing, for workshop map packages.
// Only archives that keep their data in the directory file (archive index 0x7FFF) are supported.
import fs from 'node:fs';
import zlib from 'node:zlib';

const SIGNATURE = 0x55AA1234, EMBEDDED = 0x7FFF;

/** Lists the entries of a VPK: path, and where its preload bytes and data live. */
export function listVpk(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(28);
    fs.readSync(fd, head, 0, 28, 0);
    if (head.readUInt32LE(0) !== SIGNATURE) throw new Error(`${file} is not a VPK`);
    const version = head.readUInt32LE(4), treeSize = head.readUInt32LE(8), header = version === 2 ? 28 : 12;
    const tree = Buffer.alloc(treeSize);
    fs.readSync(fd, tree, 0, treeSize, header);
    let pos = 0;
    const text = () => {const end = tree.indexOf(0, pos); const value = tree.toString('utf8', pos, end); pos = end + 1; return value;};
    const entries = [];
    for (let extension = text(); extension; extension = text()) for (let folder = text(); folder; folder = text())
      for (let name = text(); name; name = text()) {
        const preload = tree.readUInt16LE(pos + 4), archive = tree.readUInt16LE(pos + 6);
        const offset = tree.readUInt32LE(pos + 8), length = tree.readUInt32LE(pos + 12);
        pos += 18;
        if (archive !== EMBEDDED) throw new Error(`${file}: multi-file VPKs are not supported`);
        entries.push({path: `${folder === ' ' ? '' : `${folder}/`}${name}.${extension}`, preloadAt: header + pos, preload,
          dataAt: header + treeSize + offset, length});
        pos += preload;
      }
    return entries;
  } finally {fs.closeSync(fd);}
}

/** Reads one entry's bytes. */
export function readVpkEntry(file, entry) {
  const fd = fs.openSync(file, 'r');
  try {
    const out = Buffer.alloc(entry.preload + entry.length);
    if (entry.preload) fs.readSync(fd, out, 0, entry.preload, entry.preloadAt);
    if (entry.length) fs.readSync(fd, out, entry.preload, entry.length, entry.dataAt);
    return out;
  } finally {fs.closeSync(fd);}
}

/** Writes a VPK v1 holding `files` (a Map of path to bytes), with all data embedded. */
export function writeVpk(file, files) {
  const tree = new Map();
  for (const [path, data] of files) {
    const slash = path.lastIndexOf('/'), dot = path.lastIndexOf('.');
    const extension = path.slice(dot + 1), folder = slash < 0 ? ' ' : path.slice(0, slash), name = path.slice(slash + 1, dot);
    if (!tree.has(extension)) tree.set(extension, new Map());
    if (!tree.get(extension).has(folder)) tree.get(extension).set(folder, []);
    tree.get(extension).get(folder).push({name, data});
  }
  const parts = [], blobs = [];
  let offset = 0;
  const text = value => parts.push(Buffer.from(`${value}\0`, 'utf8'));
  for (const [extension, folders] of tree) {
    text(extension);
    for (const [folder, names] of folders) {
      text(folder);
      for (const {name, data} of names) {
        text(name);
        const entry = Buffer.alloc(18);
        entry.writeUInt32LE(zlib.crc32(data), 0); entry.writeUInt16LE(0, 4); entry.writeUInt16LE(EMBEDDED, 6);
        entry.writeUInt32LE(offset, 8); entry.writeUInt32LE(data.length, 12); entry.writeUInt16LE(0xFFFF, 16);
        parts.push(entry); blobs.push(data); offset += data.length;
      }
      text('');
    }
    text('');
  }
  text('');
  const body = Buffer.concat(parts), header = Buffer.alloc(12);
  header.writeUInt32LE(SIGNATURE, 0); header.writeUInt32LE(1, 4); header.writeUInt32LE(body.length, 8);
  fs.writeFileSync(file, Buffer.concat([header, body, ...blobs]));
}
