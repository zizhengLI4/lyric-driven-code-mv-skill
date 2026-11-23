import { deflateSync, inflateSync } from 'node:zlib';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const table = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = data => { let crc = 0xffffffff; for (const n of data) crc = table[(crc ^ n) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), out.length - 4); return out;
}

/** PNG RGBA8、每行 filter=0；只使用 Node 内置 zlib。 */
export function encodePNG({ width, height, data }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('PNG 尺寸须为 1–4096 的整数');
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || data.byteLength !== width * height * 4) throw new Error('RGBA 数据长度或类型错误');
  const rgba = Buffer.from(data.buffer, data.byteOffset, data.byteLength), rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 2 })), chunk('IEND', Buffer.alloc(0))]);
}

/** 恢复导出只接受本模块支持的完整 RGBA8 PNG，检查 CRC、尺寸与解压行。 */
export function inspectPNG(input, { template = true } = {}) {
  const png = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (png.length < 45 || !png.subarray(0, 8).equals(signature)) throw new Error('无效 PNG 签名');
  let width, height, ended = false, first = true, offset = 8; const parts = [];
  while (offset < png.length) {
    if (offset + 12 > png.length) throw new Error('PNG 截断');
    const length = png.readUInt32BE(offset), end = offset + 12 + length;
    if (end > png.length) throw new Error('PNG 数据块截断');
    const type = png.toString('ascii', offset + 4, offset + 8), body = png.subarray(offset + 4, end - 4), data = png.subarray(offset + 8, end - 4);
    if (crc32(body) !== png.readUInt32BE(end - 4)) throw new Error('PNG CRC 校验失败');
    if (first && type !== 'IHDR') throw new Error('PNG 缺少首个 IHDR');
    if (type === 'IHDR') {
      if (!first || length !== 13) throw new Error('PNG IHDR 错误');
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (!width || !height || width > 7680 || height > 7680 || ![0, 2, 3, 4, 6].includes(data[9]) ||
          ![1, 2, 4, 8, 16].includes(data[8]) || data[10] || data[11] || data[12] > 1) throw new Error('PNG IHDR 格式或尺寸错误');
      if (template && (width > 4096 || height > 4096 || data[8] !== 8 || data[9] !== 6 || data[12])) {
        throw new Error('PNG 须为非交错 RGBA8 且尺寸不超过4096');
      }
    } else if (type === 'IDAT') parts.push(data);
    else if (type === 'IEND') { if (length || end !== png.length) throw new Error('PNG IEND 错误'); ended = true; }
    offset = end; first = false;
  }
  if (!ended || !parts.length) throw new Error('PNG 不完整');
  if (!template) return { width, height };
  const expected = (width * 4 + 1) * height;
  let rows; try { rows = inflateSync(Buffer.concat(parts), { maxOutputLength: expected }); } catch { throw new Error('PNG 解压失败'); }
  if (rows.length !== expected) throw new Error('PNG 解压行尺寸不符');
  for (let y = 0; y < height; y++) if (rows[y * (width * 4 + 1)] !== 0) throw new Error('PNG 不是模板 filter=0 格式');
  return { width, height };
}
