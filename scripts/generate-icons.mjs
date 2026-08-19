#!/usr/bin/env node
/**
 * 확장 툴바 아이콘 PNG 생성 (16/32/48/128px).
 *
 * 🔴 브라우저 렌더링 없이 순수 Node로 만든다. 도형이 축에 정렬된 사각형 3개뿐이라 픽셀을 직접
 *    계산해 채우고, `node:zlib`(내장)으로 PNG를 손으로 인코딩한다 — 새 의존성 0개.
 *
 * 좌표·배색 전부 claude.ai/design "MEDIATE 로고 03 SHIFT 전개.dc.html"의 **정사각 락업**
 * (viewBox 0 0 96 96, "앱 아이콘 · 정사각" 항목)을 그대로 쓴다 — 다크 배경 + 크림 바 2개 +
 * 레드 액센트 바 1개. 2026-08-13 사용자 지시: "로고 이미지 원본만 사용" — 재배색하지 않는다.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'src', 'assets', 'icons');
mkdirSync(outDir, { recursive: true });

// 원본 "앱 아이콘 · 정사각" 락업 배색 그대로 — 재배색 없음.
const BG = [32, 30, 29, 255]; // #201e1d
const BAR = [248, 244, 244, 255]; // #f8f4f4 (구조 바 2개)
const ACCENT = [236, 48, 19, 255]; // #ec3013 (하단 액센트 바)

// [x, y, w, h, isAccent] — 정사각 락업 원본 좌표(viewBox 0 0 96 96)를 그대로 쓴다.
const RECTS = [
  [14, 24, 52, 12, false],
  [30, 42, 52, 12, false],
  [14, 60, 68, 12, true],
];
const VIEWBOX = 96;
const SIZES = [16, 32, 48, 128];

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    buf[i * 4] = BG[0];
    buf[i * 4 + 1] = BG[1];
    buf[i * 4 + 2] = BG[2];
    buf[i * 4 + 3] = BG[3];
  }
  const scale = size / VIEWBOX;
  for (const [rx, ry, rw, rh, isAccent] of RECTS) {
    const color = isAccent ? ACCENT : BAR;
    const x0 = Math.round(rx * scale);
    const y0 = Math.round(ry * scale);
    const x1 = Math.round((rx + rw) * scale);
    const y1 = Math.round((ry + rh) * scale);
    for (let y = Math.max(0, y0); y < Math.min(size, y1); y += 1) {
      for (let x = Math.max(0, x0); x < Math.min(size, x1); x += 1) {
        const idx = (y * size + x) * 4;
        buf[idx] = color[0];
        buf[idx + 1] = color[1];
        buf[idx + 2] = color[2];
        buf[idx + 3] = color[3];
      }
    }
  }
  return buf;
}

/** 표준 CRC-32(PNG가 매 청크 끝에 요구하는 무결성 체크). */
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** 8비트 RGBA(color type 6), 무압축 필터(타입 0), deflate — PNG 스펙 최소 구현. */
function encodePng(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  const ihdr = chunk('IHDR', ihdrData);

  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // 필터 타입 None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = chunk('IDAT', deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

for (const size of SIZES) {
  const png = encodePng(size, renderIcon(size));
  const path = join(outDir, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`[generate-icons] icon-${size}.png (${png.length} bytes)`);
}
