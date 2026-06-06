import type { Provider, ProviderConfig, QuotaItem, UsageResult } from '../shared/types';
import { HttpClientWithRetry } from '../main/http';

interface MiniMaxModelRemains {
  start_time: number;
  end_time: number;
  remains_time: number;
  current_interval_total_count: number;
  current_interval_usage_count: number;
  model_name: string;
  current_interval_status: number;
  current_interval_remaining_percent: number;
  current_weekly_total_count: number;
  current_weekly_usage_count: number;
  current_weekly_status: number;
  current_weekly_remaining_percent: number;
  weekly_start_time: number;
  weekly_end_time: number;
  weekly_remains_time: number;
  interval_boost_permille: number;
  weekly_boost_permille: number;
}

interface MiniMaxRemainsResponse {
  model_remains: MiniMaxModelRemains[];
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

function toISODate(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

const MODEL_DISPLAY: Record<string, string> = {
  general: 'MiniMax',
  video: 'Video',
};

export class MiniMaxProvider implements Provider {
  name = 'MiniMax';

  private httpClient = new HttpClientWithRetry(3, 1000);

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw new Error('[MiniMax] API Key is required');
    }

    const baseUrl = (config._baseUrl as string) || 'https://www.minimaxi.com';
    const url = `${baseUrl}/v1/token_plan/remains`;

    const resp = await this.httpClient.getJson<MiniMaxRemainsResponse>(url, {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    });

    if (resp.base_resp?.status_code !== 0) {
      throw new Error(`[MiniMax] API error: ${resp.base_resp?.status_msg || 'Unknown error'}`);
    }

    const models = resp.model_remains;
    if (!models?.length) {
      throw new Error('[MiniMax] No model data returned');
    }

    const mainModel = models.find(m => m.model_name === 'general') || models[0];

    const quotas: QuotaItem[] = [];
    for (const m of models) {
      const limitType = MODEL_DISPLAY[m.model_name] || m.model_name;

      quotas.push(this.buildQuota(
        m.current_interval_total_count, m.current_interval_usage_count,
        m.current_interval_remaining_percent, m.current_interval_status,
        m.interval_boost_permille,
        'quota.minimaxDaily', 'quota.minimaxDailyUnlimited',
        toISODate(m.end_time), toISODate(m.start_time), limitType,
      ));

      quotas.push(this.buildQuota(
        m.current_weekly_total_count, m.current_weekly_usage_count,
        m.current_weekly_remaining_percent, m.current_weekly_status,
        m.weekly_boost_permille,
        'quota.minimaxWeekly', 'quota.minimaxWeeklyUnlimited',
        toISODate(m.weekly_end_time), toISODate(m.weekly_start_time), limitType,
      ));
    }

    // 百分制：tray calcPercent 用 (total-used)/total，这里 total=100, used=已用百分比
    const used = 100 - mainModel.current_interval_remaining_percent;

    return {
      used,
      total: 100,
      expiresAt: toISODate(mainModel.end_time),
      details: { quotas },
    };
  }

  // status: 1=正常有限额度, 3=无限额度; boost: 千分位配额加成(2000=2x), 仅区间且仅 general
  private buildQuota(
    total: number, usageCount: number, remainingPercent: number, status: number,
    boostPermille: number,
    normalLabel: string, unlimitedLabel: string,
    resetAt: string, startAt: string, limitType: string,
  ): QuotaItem {
    const isUnlimited = status === 3;
    const usedPercent = Math.max(0, Math.min(100, 100 - remainingPercent));

    if (total > 0) {
      // 有具体计数（如 video 0/3），不加成
      return {
        label: normalLabel,
        used: usageCount,
        total,
        usageRate: usedPercent,
        resetAt, startAt, limitType,
      };
    }

    if (!isUnlimited) {
      const boostMultiplier = boostPermille / 1000;
      return {
        label: normalLabel,
        labelParams: { boostPermille: String(boostPermille) },
        used: Math.round(usedPercent * boostMultiplier),
        total: Math.round(100 * boostMultiplier),
        usageRate: usedPercent,
        resetAt, startAt, limitType,
      };
    }

    // 无限额度
    return {
      label: unlimitedLabel,
      used: usageCount,
      total: 0,
      usageRate: 0,
      resetAt, startAt, limitType,
      hideBar: true,
    };
  }
}
