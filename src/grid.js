import { CONFIG } from './config.js';

const MAX_CELLS = 1 << 20;

export class SpatialGrid {
  constructor(width, height, cellSize) {
    this.setBounds(width, height, cellSize);
  }

  setBounds(width, height, cellSize) {
    this.width = width;
    this.height = height;

    let cs = cellSize;
    let cols = Math.max(1, Math.ceil(width / cs));
    let rows = Math.max(1, Math.ceil(height / cs));
    while (cols * rows > MAX_CELLS) {
      cs *= 2;
      cols = Math.max(1, Math.ceil(width / cs));
      rows = Math.max(1, Math.ceil(height / cs));
    }

    this.cellSize = cs;
    this.cols = cols;
    this.rows = rows;
    this.cellCount = cols * rows;

    this.cellStart = new Int32Array(this.cellCount + 1);
    this.items = new Int32Array(0);
    this.count = 0;
  }

  build(x, y, n) {
    if (this.items.length < n) this.items = new Int32Array(n);
    this.count = n;

    const { cols, rows, cellSize, cellStart } = this;
    cellStart.fill(0);

    for (let i = 0; i < n; i++) {
      const c = this.cellIndex(x[i], y[i]);
      cellStart[c + 1]++;
    }

    for (let c = 0; c < this.cellCount; c++) {
      cellStart[c + 1] += cellStart[c];
    }

    const cursor = this.cursor || (this.cursor = new Int32Array(this.cellCount + 1));
    for (let c = 0; c <= this.cellCount; c++) cursor[c] = cellStart[c];

    for (let i = 0; i < n; i++) {
      const c = this.cellIndex(x[i], y[i]);
      this.items[cursor[c]++] = i;
    }

    void cols; void rows; void cellSize;
  }

  cellIndex(x, y) {
    let cx = Math.floor(x / this.cellSize);
    let cy = Math.floor(y / this.cellSize);

    cx %= this.cols;
    if (cx < 0) cx += this.cols;
    cy %= this.rows;
    if (cy < 0) cy += this.rows;

    return cy * this.cols + cx;
  }

  wrapCell(cx, cy) {
    cx %= this.cols;
    if (cx < 0) cx += this.cols;
    cy %= this.rows;
    if (cy < 0) cy += this.rows;
    return cy * this.cols + cx;
  }

  forEachNeighbor(i, px, py, fn) {
    const { cols, rows, cellSize, cellStart, items } = this;

    const cx = Math.floor(px / cellSize);
    const cy = Math.floor(py / cellSize);

    for (let oy = -1; oy <= 1; oy++) {
      const gy = cy + oy;
      if (gy < 0 || gy >= rows) {
        if (gy < -rows || gy >= rows * 2) continue;
      }
      for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox;
        if (gx < 0 || gx >= cols) {
          if (gx < -cols || gx >= cols * 2) continue;
        }

        const c = this.wrapCell(cx + ox, cy + oy);
        const start = cellStart[c];
        const end = cellStart[c + 1];

        for (let k = start; k < end; k++) {
          const j = items[k];
          if (j > i) fn(j);
        }
      }
    }
  }

  forEachPair(fn) {
    const { cols, rows, cellStart, items } = this;

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const c = cy * cols + cx;
        const start = cellStart[c];
        const end = cellStart[c + 1];
        if (start === end) continue;

        for (let a = start; a < end; a++) {
          for (let b = a + 1; b < end; b++) {
            fn(items[a], items[b]);
          }
        }

        const nexts = [
          [cx + 1, cy],
          [cx, cy + 1],
          [cx + 1, cy + 1],
          [cx - 1, cy + 1],
        ];

        for (const [nx, ny] of nexts) {
          const wrappedX = ((nx % cols) + cols) % cols;
          const wrappedY = ((ny % rows) + rows) % rows;
          if (wrappedX === cx && wrappedY === cy) continue;

          const nc = wrappedY * cols + wrappedX;
          const ns = cellStart[nc];
          const ne = cellStart[nc + 1];

          for (let a = start; a < end; a++) {
            for (let b = ns; b < ne; b++) {
              const i = items[a];
              const j = items[b];
              if (i < j) fn(i, j);
              else fn(j, i);
            }
          }
        }
      }
    }
  }

  stats() {
    let occupied = 0;
    let maxCell = 0;
    for (let c = 0; c < this.cellCount; c++) {
      const n = this.cellStart[c + 1] - this.cellStart[c];
      if (n > 0) occupied++;
      if (n > maxCell) maxCell = n;
    }
    return {
      cols: this.cols,
      rows: this.rows,
      cellCount: this.cellCount,
      occupiedCells: occupied,
      occupancy: this.cellCount ? occupied / this.cellCount : 0,
      maxCellFill: maxCell,
      avgFill: this.count ? this.count / this.cellCount : 0,
      cellSize: this.cellSize,
    };
  }
}

export function cellSizeFor(maxRadius) {
  const minimum = Math.max(1, maxRadius * 2);
  const optimal = 12;
  return Math.max(minimum, optimal);
}

export function createDefaultGrid(width, height) {
  return new SpatialGrid(width, height, cellSizeFor(CONFIG.maxRadius));
}