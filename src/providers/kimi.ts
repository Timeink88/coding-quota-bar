import type { Provider, ProviderConfig, QuotaItem, UsageResult } from '../shared/types';
import { HttpClientWithRetry } from '../main/http';

/**
 * Kimi Coding Plan 用量 API 响应类型
 *
 * 参考 Golden0Voyager/kimi-code-usage 的解析逻辑：
 * - 数组形态（真实接口）：data[] 里 model_name === "all" 为周汇总行，
 *   其余行为分模型限额；
 * - 对象形态（防御性兜底）：usage 为总用量，limits[] 为各窗口限额
 *   （detail 携带名称和额度，window 携带窗口时长）。
 * 字段名存在 camelCase / snake_case 变体，逐字段容错。
 */
interface KimiUsageRow {
  model_name?: string;
  name?: string;
  title?: string;
  limit?: number;
  limit_amount?: number;
  used?: number;
  used_amount?: number;
  remaining?: number;
  percentage?: number;
  resetTime?: string;
  resetAt?: string;
  reset_at?: string;
  reset_time?: string | number;
  resetIn?: number;
  reset_in?: number;
  ttl?: number;
}

interface KimiUsagesResponse {
  data?: KimiUsageRow[];
  usage?: KimiUsageRow;
  limits?: Array<{
    detail?: KimiUsageRow;
    window?: { duration?: number; timeUnit?: string };
  }>;
}

/** 归一化后的一行用量（仅含已解析的字段） */
interface NormalizedRow {
  name: string;
  used: number;
  total: number;
  resetAt: string;
  periodHours?: number;
}

function firstFinite(...values: Array<number | undefined>): number | undefined {
  for (const v of values) {
    if (v != null && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * 解析重置时间为 ISO 字符串
 * 支持三种来源：ISO 字符串（resetTime/reset_at/reset_time）、Unix 秒、
 * 相对秒数（reset_in/resetIn/ttl）
 */
function parseResetAt(row: KimiUsageRow): string {
  const iso = row.resetTime ?? row.resetAt ?? (typeof row.reset_time === 'string' ? row.reset_time : undefined);
  if (iso) {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const epoch = typeof row.reset_time === 'number' ? row.reset_time : undefined;
  if (epoch != null && Number.isFinite(epoch) && epoch > 0) {
    const d = new Date(epoch * 1000);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const inSeconds = firstFinite(row.reset_in, row.resetIn, row.ttl);
  if (inSeconds != null && inSeconds > 0) {
    return new Date(Date.now() + inSeconds * 1000).toISOString();
  }
  return '';
}

/** 归一化一行用量：额度字段、已用字段、名称字段均做变体容错 */
function normalizeRow(row: KimiUsageRow, fallbackName = ''): NormalizedRow | null {
  const total = firstFinite(row.limit, row.limit_amount);
  if (total == null) return null;

  let used = firstFinite(row.used, row.used_amount);
  if (used == null) {
    const remaining = firstFinite(row.remaining);
    used = remaining != null ? Math.max(0, total - remaining) : 0;
  }

  return {
    name: row.model_name || row.name || row.title || fallbackName,
    used: used ?? 0,
    total,
    resetAt: parseResetAt(row),
  };
}

/** 兼容对象形态：从 window.duration + timeUnit 推导窗口标签与小时数 */
function windowLabel(duration?: number, timeUnit?: string): { name: string; periodHours?: number } {
  if (duration == null || !Number.isFinite(duration)) return { name: '' };
  const unit = (timeUnit || '').toUpperCase();
  if (unit === 'HOUR' || unit === 'MINUTE') {
    const hours = unit === 'MINUTE' ? duration / 60 : duration;
    return { name: `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`, periodHours: hours };
  }
  if (unit === 'DAY') return { name: `${duration}d`, periodHours: duration * 24 };
  if (unit === 'MONTH') return { name: `${duration}mo`, periodHours: duration * 24 * 30 };
  return { name: '' };
}

/**
 * 解析响应为归一化行列表（数组形态优先，对象形态兜底）
 * （导出供单测/脚本验证解析逻辑）
 */
export function parseUsagePayload(resp: KimiUsagesResponse): NormalizedRow[] {
  if (Array.isArray(resp.data) && resp.data.length > 0) {
    const rows = resp.data
      .map(r => normalizeRow(r))
      .filter((r): r is NormalizedRow => r != null);
    if (rows.length > 0) {
      const weekly = rows.find(r => r.name === 'all');
      if (weekly && weekly.periodHours == null) weekly.periodHours = 168;
      return rows;
    }
  }

  const rows: NormalizedRow[] = [];
  if (resp.usage) {
    const row = normalizeRow(resp.usage);
    if (row) rows.push({ ...row, name: 'all', periodHours: 168 });
  }
  if (Array.isArray(resp.limits)) {
    resp.limits.forEach((limit, i) => {
      if (!limit?.detail) return;
      const win = windowLabel(limit.window?.duration, limit.window?.timeUnit);
      const row = normalizeRow(limit.detail, win.name || `Limit ${i + 1}`);
      if (row) rows.push({ ...row, periodHours: win.periodHours });
    });
  }
  return rows;
}

/**
 * Kimi Coding Plan Provider
 *
 * 端点：GET {baseUrl}/usages（404 时回退 /usage，兼容旧路径）
 * 鉴权：Bearer API Key（Kimi Coding 平台的 sk-kimi- 开头 Key，
 * 开放平台的 sk- Key 会返回 401）
 * UA 伪装为 KimiCLI（服务端可能校验 User-Agent）
 */
export class KimiProvider implements Provider {
  name = 'Kimi';

  private httpClient = new HttpClientWithRetry(3, 1000);

  private getBaseUrl(config: ProviderConfig): string {
    return (config._baseUrl as string || 'https://api.kimi.com/coding/v1').replace(/\/+$/, '');
  }

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw new Error('[Kimi] API Key is required');
    }

    const baseUrl = this.getBaseUrl(config);
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'KimiCLI/1.6',
    };

    let resp = await this.httpClient.get(`${baseUrl}/usages`, headers);
    // 旧版路径兼容：/usages 404 时回退 /usage
    if (resp.status === 404) {
      resp = await this.httpClient.get(`${baseUrl}/usage`, headers);
    }
    if (resp.status === 401) {
      throw new Error('[Kimi] Unauthorized (401): 需要 Kimi Coding 平台的 API Key（sk-kimi- 开头），开放平台（sk- 开头）的 Key 无效');
    }
    if (resp.status === 429) {
      throw new Error('[Kimi] Rate limited (429): 请求过于频繁，请稍后重试');
    }
    if (resp.status >= 400) {
      throw new Error(`[Kimi] API error ${resp.status}: ${resp.body.slice(0, 200)}`);
    }

    let parsed: KimiUsagesResponse;
    try {
      parsed = JSON.parse(resp.body) as KimiUsagesResponse;
    } catch (e) {
      throw new Error(`[Kimi] Failed to parse response: ${e instanceof Error ? e.message : String(e)}`);
    }

    const rows = parseUsagePayload(parsed);
    if (rows.length === 0) {
      throw new Error('[Kimi] Empty usage data: response contains no recognizable quota rows');
    }

    const quotas: QuotaItem[] = rows.map(row => {
      const isWeekly = row.name === 'all';
      const usageRate = row.total > 0
        ? Math.max(0, Math.min(100, (row.used / row.total) * 100))
        : 0;
      return {
        label: isWeekly ? 'quota.kimiWeekly' : row.name,
        used: row.used,
        total: row.total,
        usageRate: Math.round(usageRate * 10) / 10,
        resetAt: row.resetAt,
        periodHours: row.periodHours ?? (isWeekly ? 168 : undefined),
        limitType: isWeekly ? 'kimi' : row.name,
        displayUnit: 'count',
      };
    });

    // 周汇总行（model_name === 'all'）作为 provider 级用量，驱动托盘百分比和总览
    const weekly = rows.find(r => r.name === 'all') ?? rows[0];
    const weeklyQuota = quotas[rows.indexOf(weekly)];

    return {
      used: weeklyQuota.used,
      total: weeklyQuota.total,
      expiresAt: weekly.resetAt,
      details: {
        quotas,
      },
    };
  }
}
