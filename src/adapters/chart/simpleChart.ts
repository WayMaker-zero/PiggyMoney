import type { IChartProvider } from '../../ports/chart';
import type { Point } from '../../domain/types';

// Lightweight canvas line chart for MVP (no deps)
export const SimpleChart: IChartProvider = {
  renderLine(el, series, options) {
    let canvas = el.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      el.innerHTML = '';
      el.appendChild(canvas);
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = el.getBoundingClientRect();
    const w = Math.max(320, rect.width);
    const h = Math.max(160, rect.height);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    drawAxes(ctx, w, h);
    drawLine(ctx, series.data, w, h);
  },
  dispose(el) {
    el.innerHTML = '';
  }
};

function drawAxes(ctx: CanvasRenderingContext2D, w: number, h: number){
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  // x axis
  ctx.beginPath(); ctx.moveTo(40, h-30); ctx.lineTo(w-10, h-30); ctx.stroke();
  // y axis
  ctx.beginPath(); ctx.moveTo(40, 10); ctx.lineTo(40, h-30); ctx.stroke();
}

function drawLine(ctx: CanvasRenderingContext2D, data: Point[], w: number, h: number){
  if (!data.length) return;
  const values = data.map(p => p.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.1 || 1;
  const ymin = min - pad; const ymax = max + pad;
  const left = 40; const right = w - 10; const top = 10; const bottom = h - 30;
  const xstep = (right - left) / Math.max(1, data.length - 1);
  ctx.strokeStyle = '#8ab4ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((p, i) => {
    const x = left + i * xstep;
    const y = bottom - ((p.y - ymin) / (ymax - ymin)) * (bottom - top);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

