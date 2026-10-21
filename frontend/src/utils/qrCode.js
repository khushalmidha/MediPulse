/**
 * Self-contained, standards-compliant QR Code generator and React SVG component.
 * Supports Byte Mode (UTF-8), QR Versions 1 to 4 with Reed-Solomon Error Correction.
 * Renders real scannable SVG QR codes without external dependencies.
 */
import React from "react";

// GF(256) Math tables with primitive polynomial 0x11D (285)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    EXP[i + 255] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 285;
  }
})();

function gfMul(x, y) {
  if (x === 0 || y === 0) return 0;
  return EXP[LOG[x] + LOG[y]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsCompute(data, eccLength) {
  const gen = rsGeneratorPoly(eccLength);
  const remainder = new Array(eccLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < eccLength; i++) {
      remainder[i] ^= gfMul(gen[i], factor);
    }
  }
  return remainder;
}

// QR Table: [version, size, totalCodewords, dataCodewordsM, eccCodewordsM, alignmentCoords]
const QR_SPECS = [
  null,
  { version: 1, size: 21, totalCodewords: 26, dataCodewords: 16, eccCodewords: 10, align: [] },
  { version: 2, size: 25, totalCodewords: 44, dataCodewords: 28, eccCodewords: 16, align: [6, 18] },
  { version: 3, size: 29, totalCodewords: 70, dataCodewords: 44, eccCodewords: 26, align: [6, 22] },
  { version: 4, size: 33, totalCodewords: 100, dataCodewords: 64, eccCodewords: 36, align: [6, 26] },
];

export function encodeQrData(text) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(String(text || ""));

  // Select smallest QR version that fits
  let spec = null;
  for (let v = 1; v <= 4; v++) {
    const neededBits = 4 + 8 + bytes.length * 8;
    if (neededBits <= QR_SPECS[v].dataCodewords * 8) {
      spec = QR_SPECS[v];
      break;
    }
  }
  if (!spec) spec = QR_SPECS[4];

  // Build bitstream
  const bitstream = [];
  function pushBits(val, len) {
    for (let i = len - 1; i >= 0; i--) {
      bitstream.push((val >>> i) & 1);
    }
  }

  // Byte mode indicator: 0100
  pushBits(0b0100, 4);
  // Character count indicator (8 bits for v1-9)
  const count = Math.min(bytes.length, spec.dataCodewords - 3);
  pushBits(count, 8);
  // Data bytes
  for (let i = 0; i < count; i++) {
    pushBits(bytes[i], 8);
  }

  // Terminator (up to 4 zeroes)
  const maxDataBits = spec.dataCodewords * 8;
  const termLength = Math.min(4, maxDataBits - bitstream.length);
  for (let i = 0; i < termLength; i++) bitstream.push(0);

  // Pad to multiple of 8
  while (bitstream.length % 8 !== 0) bitstream.push(0);

  // Convert to bytes
  const dataBytes = [];
  for (let i = 0; i < bitstream.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bitstream[i + j];
    dataBytes.push(b);
  }

  // Pad bytes: alternating 0xEC, 0x11
  let padToggle = false;
  while (dataBytes.length < spec.dataCodewords) {
    dataBytes.push(padToggle ? 0x11 : 0xEC);
    padToggle = !padToggle;
  }

  // Compute Error Correction
  const eccBytes = rsCompute(dataBytes, spec.eccCodewords);

  return {
    spec,
    allBytes: [...dataBytes, ...eccBytes],
  };
}

export function generateQrMatrix(text) {
  const { spec, allBytes } = encodeQrData(text);
  const size = spec.size;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

  function setModule(r, c, val, func = true) {
    matrix[r][c] = Boolean(val);
    if (func) isFunction[r][c] = true;
  }

  // 1. Finder patterns at (0,0), (0, size-7), (size-7, 0)
  const finderPositions = [[0, 0], [0, size - 7], [size - 7, 0]];
  for (const [r0, c0] of finderPositions) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = r0 + r;
        const col = c0 + c;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          const isBlack = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          setModule(row, col, isBlack);
        } else {
          setModule(row, col, false);
        }
      }
    }
  }

  // 2. Alignment patterns
  if (spec.align.length >= 2) {
    const coords = spec.align;
    for (const ar of coords) {
      for (const ac of coords) {
        if (isFunction[ar][ac]) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const isBlack = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
            setModule(ar + r, ac + c, isBlack);
          }
        }
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isFunction[6][i]) setModule(6, i, i % 2 === 0);
    if (!isFunction[i][6]) setModule(i, 6, i % 2 === 0);
  }

  // 4. Dark module
  setModule(size - 8, 8, true);

  // 5. Reserve format information areas
  for (let i = 0; i < 9; i++) {
    if (!isFunction[8][i]) isFunction[8][i] = true;
    if (!isFunction[i][8]) isFunction[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunction[8][size - 1 - i]) isFunction[8][size - 1 - i] = true;
    if (!isFunction[size - 1 - i][8]) isFunction[size - 1 - i][8] = true;
  }

  // 6. Lay out data bits
  const bitStream = [];
  for (const b of allBytes) {
    for (let i = 7; i >= 0; i--) {
      bitStream.push((b >>> i) & 1);
    }
  }

  let bitIdx = 0;
  let upwards = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    const cols = [right, right - 1];
    const rows = upwards
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const r of rows) {
      for (const c of cols) {
        if (!isFunction[r][c]) {
          const bit = bitIdx < bitStream.length ? bitStream[bitIdx++] : 0;
          const maskInvert = (r + c) % 2 === 0;
          matrix[r][c] = Boolean(bit ^ (maskInvert ? 1 : 0));
        }
      }
    }
    upwards = !upwards;
  }

  // 7. Write Format Information (Level M, Mask 0: 101010000010010)
  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  const posTopLeft = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  for (let i = 0; i < 15; i++) {
    const [r, c] = posTopLeft[i];
    matrix[r][c] = Boolean(formatBits[i]);
  }
  for (let i = 0; i < 7; i++) {
    matrix[size - 1 - i][8] = Boolean(formatBits[i]);
  }
  for (let i = 7; i < 15; i++) {
    matrix[8][size - 15 + i] = Boolean(formatBits[i]);
  }

  return matrix;
}

/**
 * Generates an SVG string representation of the QR code.
 */
export function generateQrSvgString(value, size = 180) {
  const matrix = generateQrMatrix(value);
  const matrixSize = matrix.length;
  const padding = 2;
  const total = matrixSize + padding * 2;
  let rects = "";
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      if (matrix[r][c]) {
        rects += `<rect x="${c + padding}" y="${r + padding}" width="1" height="1" fill="#0f172a" />`;
      }
    }
  }
  return `<svg role="img" aria-label="QR Code for ${value || "token"}" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}"><rect width="${total}" height="${total}" fill="#ffffff"/>${rects}</svg>`;
}

/**
 * React Component rendering a clean, crisp, accessible SVG QR code.
 */
export function QrCodeSvg({ value, size = 180, className = "", style = {} }) {
  const matrix = React.useMemo(() => generateQrMatrix(value), [value]);
  const matrixSize = matrix.length;
  const padding = 2;
  const total = matrixSize + padding * 2;

  const rects = [];
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      if (matrix[r][c]) {
        rects.push(
          React.createElement("rect", {
            key: `${r}-${c}`,
            x: c + padding,
            y: r + padding,
            width: 1,
            height: 1,
            fill: "currentColor",
          })
        );
      }
    }
  }

  return React.createElement(
    "svg",
    {
      role: "img",
      "aria-label": `QR Code for ${value || "token"}`,
      viewBox: `0 0 ${total} ${total}`,
      width: size,
      height: size,
      className,
      style: { display: "block", shapeRendering: "crispEdges", ...style },
    },
    React.createElement("rect", { width: total, height: total, fill: "#ffffff" }),
    ...rects
  );
}

export default QrCodeSvg;
