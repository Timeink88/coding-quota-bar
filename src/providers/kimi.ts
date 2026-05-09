import type { Provider, ProviderConfig, QuotaItem, UsageResult } from '../shared/types';

const TOKEN_EXPIRED = 'TOKEN_EXPIRED';

interface KimiUsageDetail {
  limit: string;
  used?: string;
  remaining?: string;
  resetTime?: string;
}

interface KimiRateLimitWindow {
  duration: number;
  timeUnit: string;
}

interface KimiRateLimit {
  window: KimiRateLimitWindow;
  detail: KimiUsageDetail;
}

interface KimiUsage {
  scope: string;
  detail: KimiUsageDetail;
  limits?: KimiRateLimit[];
}

interface KimiApiResponse {
  usages: KimiUsage[];
}

interface JwtPayload {
  device_id: string;
  ssid: string;
  sub: string;
  [key: string]: unknown;
}

/**
 * 解码 JWT payload（base64url → JSON）
 */
function decodeJwtPayload(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = parts[1];
  const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  return JSON.parse(decoded);
}

/**
 * 安全解析字符串为整数
 */
function safeParseInt(val: string | undefined | null, fallback = 0): number {
  if (!val) return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

/**
 * 根据周额度上限推断订阅等级
 */
const KIMI_PLAN_MAP: Record<number, string> = {
  1024: 'Andante',
  2048: 'Moderato',
  7168: 'Allegretto',
};

function inferPlanLevel(weeklyLimit: number): string {
  return KIMI_PLAN_MAP[weeklyLimit] || `${weeklyLimit}`;
}

export class KimiProvider implements Provider {
  name = 'Kimi';

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const accountId = config.accountId || 'unknown';
    const token = config.webToken;
    if (!token) {
      console.log(`[Kimi] No webToken for account ${accountId}, returning TOKEN_EXPIRED`);
      return { used: 0, total: 0, expiresAt: '', error: TOKEN_EXPIRED, details: { quotas: [] } };
    }

    console.log(`[Kimi] Fetching usage for account ${accountId}, token length: ${token.length}`);

    try {
      // 解码 JWT 提取请求头参数
      const jwt = decodeJwtPayload(token);

      // sub 为空说明不是真实用户登录，直接视为未登录
      if (!jwt.sub || (typeof jwt.sub === 'string' && jwt.sub.trim() === '')) {
        console.log(`[Kimi] Token has no sub field (anonymous), returning TOKEN_EXPIRED`);
        return { used: 0, total: 0, expiresAt: '', error: TOKEN_EXPIRED, details: { quotas: [] } };
      }

      const deviceId = jwt.device_id || '';
      const sessionId = jwt.ssid || '';
      const trafficId = jwt.sub || '';
      console.log(`[Kimi] JWT decoded: device_id=${deviceId}, ssid=${sessionId.slice(0, 8)}..., sub=${trafficId}`);

      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      console.log(`[Kimi] Calling GetUsages API...`);
      const response = await fetch(
        'https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Cookie': `kimi-auth=${token}`,
            'Origin': 'https://www.kimi.com',
            'Referer': 'https://www.kimi.com/code/console',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
            'connect-protocol-version': '1',
            'x-language': 'en-US',
            'x-msh-platform': 'web',
            'r-timezone': timezone,
            'x-msh-device-id': deviceId,
            'x-msh-session-id': sessionId,
            'x-traffic-id': trafficId,
          },
          body: JSON.stringify({ scope: ['FEATURE_CODING'] }),
        },
      );

      console.log(`[Kimi] API response status: ${response.status}`);

      if (response.status === 401 || response.status === 403) {
        console.log(`[Kimi] Auth failed (${response.status}), returning TOKEN_EXPIRED`);
        return { used: 0, total: 0, expiresAt: '', error: TOKEN_EXPIRED, details: { quotas: [] } };
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.error(`[Kimi] API error: HTTP ${response.status}, body: ${text.slice(0, 200)}`);
        return { used: 0, total: 0, expiresAt: '', error: `HTTP ${response.status}: ${text.slice(0, 100)}`, details: { quotas: [] } };
      }

      const data = (await response.json()) as KimiApiResponse;
      console.log(`[Kimi] API response: ${JSON.stringify(data).slice(0, 300)}`);
      return this.transformResult(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Kimi] Fetch error: ${msg}`);
      return { used: 0, total: 0, expiresAt: '', error: msg, details: { quotas: [] } };
    }
  }

  private transformResult(data: KimiApiResponse): UsageResult {
    const coding = data.usages?.find(u => u.scope === 'FEATURE_CODING');
    if (!coding?.detail) {
      console.log(`[Kimi] No FEATURE_CODING data in response, usages count: ${data.usages?.length ?? 0} — likely no coding subscription`);
      return { used: 0, total: 0, expiresAt: '', error: 'KIMI_NO_SUBSCRIPTION', details: { quotas: [] } };
    }

    const detail = coding.detail;
    const limit = safeParseInt(detail.limit);
    const used = detail.used ? safeParseInt(detail.used) : (detail.remaining ? limit - safeParseInt(detail.remaining) : 0);
    const resetTime = detail.resetTime || '';

    console.log(`[Kimi] Usage: ${used}/${limit}, plan: ${inferPlanLevel(limit)}, reset: ${resetTime}`);

    const quotas: QuotaItem[] = [];

    // 周额度（主指标）
    quotas.push({
      label: 'quota.kimiWeeklyQuota',
      used,
      total: limit,
      usageRate: limit > 0 ? (used / limit) * 100 : 0,
      resetAt: resetTime,
    });

    // 速率限制（5h 窗口）
    if (coding.limits && coding.limits.length > 0) {
      const rateLimit = coding.limits[0];
      const rlDetail = rateLimit.detail;
      if (rlDetail) {
        const rlLimit = safeParseInt(rlDetail.limit);
        const rlUsed = rlDetail.used ? safeParseInt(rlDetail.used) : (rlDetail.remaining ? rlLimit - safeParseInt(rlDetail.remaining) : 0);
        console.log(`[Kimi] Rate limit: ${rlUsed}/${rlLimit} per ${rateLimit.window.duration / 60}h`);
        quotas.push({
          label: 'quota.kimiRateLimit',
          labelParams: { n: Math.round(rateLimit.window.duration / 60) },
          used: rlUsed,
          total: rlLimit,
          usageRate: rlLimit > 0 ? (rlUsed / rlLimit) * 100 : 0,
          resetAt: rlDetail.resetTime || '',
        });
      }
    }

    return {
      used,
      total: limit,
      expiresAt: resetTime,
      level: inferPlanLevel(limit),
      details: { quotas },
    };
  }
}
