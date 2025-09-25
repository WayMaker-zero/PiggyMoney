import type { IAnalyticsService } from '../ports/analytics';
import type { DateRange, Point, Transaction } from '../domain/types';

export class AnalyticsService implements IAnalyticsService {
  constructor(private readonly provider: { list(range?: DateRange): Promise<Transaction[]> }){}

  async getWeeklySeries(kind: 'balance'|'income'|'expense', range: DateRange): Promise<Point[]> {
    const items = await this.provider.list(range);
    return seriesAggregate(items, kind, 'week');
  }

  async getMonthlySeries(kind: 'balance'|'income'|'expense', range: DateRange): Promise<Point[]> {
    const items = await this.provider.list(range);
    return seriesAggregate(items, kind, 'month');
  }
}

function seriesAggregate(items: Transaction[], kind: 'balance'|'income'|'expense', gran: 'week'|'month'): Point[] {
  const sorted = [...items].sort((a,b)=> a.date.localeCompare(b.date));
  const buckets = new Map<string, number>();
  for (const t of sorted){
    const key = gran === 'week' ? isoWeekKey(t.date) : t.date.slice(0,7); // YYYY-Www or YYYY-MM
    const delta = t.type === 'income' ? t.amount : -t.amount;
    if (kind === 'income' && t.type !== 'income') continue;
    if (kind === 'expense' && t.type !== 'expense') continue;
    const v = kind === 'balance' ? delta : Math.abs(delta);
    buckets.set(key, (buckets.get(key) || 0) + v);
  }
  const out: Point[] = Array.from(buckets.entries())
    .sort((a,b)=> a[0].localeCompare(b[0]))
    .map(([x,y])=>({ x, y }));
  if (kind === 'balance') {
    // 累积成余额曲线
    let acc = 0;
    for (const p of out){ acc += p.y; p.y = acc; }
  }
  return out;
}

function isoWeekKey(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  const diff = (d.getTime() - yearStart.getTime())/86400000 + 1;
  const week = Math.ceil((diff - day)/7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2,'0')}`;
}

