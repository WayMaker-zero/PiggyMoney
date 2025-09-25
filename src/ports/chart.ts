import type { Point } from '../domain/types';

export interface IChartProvider {
  renderLine(el: HTMLElement, series: { name: string; data: Point[] }, options?: Record<string, unknown>): void;
  dispose(el: HTMLElement): void;
}

