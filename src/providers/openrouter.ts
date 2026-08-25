import type { Provider, ProviderConfig, UsageResult } from '../shared/types';
import { HttpClientWithRetry } from '../main/http';

/**
 * OpenRouter API Key 信息响应
 *
 * 端点来自 slkiser/opencode-quota 的交叉验证：
 * GET https://openrouter.ai/api/v1/key（Bearer key）→ data.{label, usage, limit}
 * - usage：本计费周期已消费金额（美元）
 * - limit：月度预算上限（美元）；null 表示未设上限（按量后付费）
 */
interface OpenRouterKeyResponse {
  data?: {
    label?: string;
    usage?: number;
    limit?: number | null;
    is_free_tier?: boolean;
    rate_limit?: { requests?: number; interval?: string };
  };
}

/**
 * OpenRouter Provider
 *
 * 额度语义与订阅套餐不同：这是 API 消费预算（美元计价）。
 * - 设置了 limit：显示"月度预算"百分比卡 + 消费金额行
 * - 未设置 limit（null）：仅显示消费金额行（后付费，无上限）
 */
export class OpenRouterProvider implements Provider {
  name = 'OpenRouter';

  private httpClient = new HttpClientWithRetry(3, 1000);

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw new Error('[OpenRouter] API Key is required');
    }

    const baseUrl = ((config._baseUrl as string) || 'https://openrouter.ai').replace(/\/+$/, '');
    const resp = await this.httpClient.get(`${baseUrl}/api/v1/key`, {
      'Authorization': `Bearer ${apiKey}`,
    });

    if (resp.status === 401) {
      throw new Error('[OpenRouter] Unauthorized (401): API Key 无效或已删除');
    }
    if (resp.status === 429) {
      throw new Error('[OpenRouter] Rate limited (429): 请求过于频繁，请稍后重试');
    }
    if (resp.status >= 400) {
      throw new Error(`[OpenRouter] API error ${resp.status}: ${resp.body.slice(0, 200)}`);
    }

    let parsed: OpenRouterKeyResponse;
    try {
      parsed = JSON.parse(resp.body) as OpenRouterKeyResponse;
    } catch (e) {
      throw new Error(`[OpenRouter] Failed to parse response: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!parsed.data) {
      throw new Error('[OpenRouter] Invalid response: missing data block');
    }

    const usage = Number(parsed.data.usage ?? 0) || 0;
    const limit = typeof parsed.data.limit === 'number' && parsed.data.limit > 0 ? parsed.data.limit : null;

    const spendText = limit != null
      ? `$${usage.toFixed(2)} / $${limit.toFixed(2)}`
      : `$${usage.toFixed(2)}`;

    if (limit != null) {
      const usageRate = Math.max(0, Math.min(100, (usage / limit) * 100));
      return {
        used: usage,
        total: limit,
        expiresAt: '',
        details: {
          currency: 'USD',
          quotas: [
            {
              label: 'quota.openrouterBudget',
              used: usage,
              total: limit,
              usageRate: Math.round(usageRate * 10) / 10,
              resetAt: '',
              currency: 'USD',
              limitType: 'openrouter-budget',
            },
            {
              label: 'quota.openrouterSpend',
              labelParams: { amount: spendText },
              used: usage,
              total: limit,
              usageRate,
              resetAt: '',
              hideBar: true,
              currency: 'USD',
              limitType: 'openrouter-spend',
            },
          ],
        },
      };
    }

    // 未设预算上限：后付费，只显示消费金额（托盘视为额度充足）
    return {
      used: 0,
      total: 0,
      expiresAt: '',
      details: {
        currency: 'USD',
        quotas: [
          {
            label: 'quota.openrouterSpendUnlimited',
            labelParams: { amount: spendText },
            used: usage,
            total: 0,
            usageRate: 0,
            resetAt: '',
            hideBar: true,
            currency: 'USD',
            limitType: 'openrouter-spend',
          },
        ],
      },
    };
  }
}
