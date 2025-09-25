import type { DateRange, Point } from '../domain/types';

export interface IAnalyticsService {
  getWeeklySeries(kind: 'balance'|'income'|'expense', range: DateRange): Promise<Point[]>;
  getMonthlySeries(kind: 'balance'|'income'|'expense', range: DateRange): Promise<Point[]>;
}

