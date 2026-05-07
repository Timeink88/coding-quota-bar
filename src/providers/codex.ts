import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { HttpClient } from '../main/http';
import type { Provider, ProviderConfig, QuotaItem, UsageResult } from '../shared/types';

const TOKEN_EXPIRED = 'TOKEN_EXPIRED';

/** ~/.codex/auth.json 结构 */
interface CodexAuthFile {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

/** Usage API 响应 */
interface CodexUsageResponse {
  rate_limit?: {
    limit_reached?: boolean;
    primary_window?: CodexWindowInfo;
    secondary_window?: CodexWindowInfo;
  };
  plan_type?: string;
  credits?: {
    balance?: string | null;
  };
}

interface CodexWindowInfo {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
  reset_after_seconds?: number;
}

/** Token 刷新响应 */
interface TokenRefreshResponse {
  access_token: string;
}

/**
 * 解码 JWT payload（不验证签名，仅提取 claims）
 */
function decodeJWTPayload(token: string): Record<string, unknown> | null {
  const segments = token.split('.');
  if (segments.length < 2) return null;

  let base64 = segments[1];
  // 补齐 padding
  const padLength = (4 - base64.length % 4) % 4;
  base64 += '='.repeat(padLength);
  // URL-safe → standard
  base64 = base64.replace(/-/g, '+').replace(/_/g, '/');

  try {
    const json = Buffer.from(base64, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * 检查 access_token 是否过期（提前 60s 判定）
 */
function isTokenExpired(accessToken: string): boolean {
  const claims = decodeJWTPayload(accessToken);
  if (!claims) return true;
  const exp = claims.exp as number | undefined;
  if (!exp) return true;
  return Date.now() / 1000 > exp - 60;
}

/**
 * 从 id_token 中提取用户信息
 */
function extractUserInfo(idToken: string): { email?: string; planType?: string } {
  const claims = decodeJWTPayload(idToken);
  if (!claims) return {};
  const email = claims.email as string | undefined;
  const authInfo = claims['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
  const planType = authInfo?.chatgpt_plan_type as string | undefined;
  return { email, planType };
}

export class CodexProvider implements Provider {
  name = 'Codex';

  async fetchUsage(_config: ProviderConfig): Promise<UsageResult> {
    // 1. 读取 auth 文件
    const authFilePath = path.join(os.homedir(), '.codex', 'auth.json');
    let authFile: CodexAuthFile;
    try {
      const raw = fs.readFileSync(authFilePath, 'utf-8');
      authFile = JSON.parse(raw);
    } catch {
      return {
        used: 0, total: 0, expiresAt: '',
        error: TOKEN_EXPIRED,
        details: { quotas: [] },
      };
    }

    const tokens = authFile.tokens;
    if (!tokens?.access_token) {
      return {
        used: 0, total: 0, expiresAt: '',
        error: TOKEN_EXPIRED,
        details: { quotas: [] },
      };
    }

    let accessToken = tokens.access_token;
    const accountId = tokens.account_id;

    // 2. 检查并刷新 token
    if (isTokenExpired(accessToken) && tokens.refresh_token) {
      try {
        const refreshResp = await HttpClient.post(
          'https://auth.openai.com/oauth/token',
          JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
          }),
        );
        if (refreshResp.status >= 200 && refreshResp.status < 300) {
          const refreshData = JSON.parse(refreshResp.body) as TokenRefreshResponse;
          accessToken = refreshData.access_token;
          console.log('[Codex] Token refreshed successfully');
        } else {
          console.warn(`[Codex] Token refresh failed: HTTP ${refreshResp.status}`);
        }
      } catch (e) {
        console.warn('[Codex] Token refresh error:', e);
      }
    }

    // 3. 调用 usage API
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'User-Agent': 'CodexBar',
    };
    if (accountId) {
      headers['ChatGPT-Account-Id'] = accountId;
    }

    let resp;
    try {
      resp = await HttpClient.get('https://chatgpt.com/backend-api/wham/usage', headers);
    } catch (e) {
      return {
        used: 0, total: 0, expiresAt: '',
        error: `[Codex] Network error: ${(e as Error).message}`,
        details: { quotas: [] },
      };
    }

    if (resp.status === 401 || resp.status === 403) {
      return {
        used: 0, total: 0, expiresAt: '',
        error: TOKEN_EXPIRED,
        details: { quotas: [] },
      };
    }

    if (resp.status !== 200) {
      return {
        used: 0, total: 0, expiresAt: '',
        error: `[Codex] HTTP ${resp.status}`,
        details: { quotas: [] },
      };
    }

    // 4. 解析响应
    let data: CodexUsageResponse;
    try {
      data = JSON.parse(resp.body);
    } catch {
      return {
        used: 0, total: 0, expiresAt: '',
        error: '[Codex] Invalid response',
        details: { quotas: [] },
      };
    }

    // 5. 提取用户信息（id_token）
    let planFromJWT: string | undefined;
    if (tokens.id_token) {
      const info = extractUserInfo(tokens.id_token);
      planFromJWT = info.planType;
    }

    return this.transformResult(data, planFromJWT);
  }

  private transformResult(data: CodexUsageResponse, planFromJWT?: string): UsageResult {
    const rateLimit = data.rate_limit;
    const limitReached = rateLimit?.limit_reached ?? false;

    const primaryWindow = rateLimit?.primary_window;
    const secondaryWindow = rateLimit?.secondary_window;

    const planType = data.plan_type || planFromJWT;
    // 格式化 plan type：首字母大写
    const level = planType ? planType.charAt(0).toUpperCase() + planType.slice(1).toLowerCase() : undefined;

    const quotas: QuotaItem[] = [];

    // 主窗口（3h）
    if (primaryWindow) {
      quotas.push({
        label: 'quota.codexPrimaryWindow',
        used: primaryWindow.used_percent ?? 0,
        total: 100,
        usageRate: primaryWindow.used_percent ?? 0,
        resetAt: primaryWindow.reset_at
          ? new Date(primaryWindow.reset_at * 1000).toISOString()
          : '',
        limitType: 'codex',
      });
    }

    // 次窗口（1d）
    if (secondaryWindow) {
      quotas.push({
        label: 'quota.codexSecondaryWindow',
        used: secondaryWindow.used_percent ?? 0,
        total: 100,
        usageRate: secondaryWindow.used_percent ?? 0,
        resetAt: secondaryWindow.reset_at
          ? new Date(secondaryWindow.reset_at * 1000).toISOString()
          : '',
        limitType: 'codex',
      });
    }

    // 余额
    if (data.credits?.balance != null) {
      quotas.push({
        label: 'quota.codexCredits',
        used: parseFloat(data.credits.balance),
        total: 0,
        usageRate: 0,
        resetAt: '',
        hideBar: true,
        currency: 'USD',
        limitType: 'codex-credits',
      });
    }

    return {
      used: primaryWindow?.used_percent ?? 0,
      total: 100,
      expiresAt: primaryWindow?.reset_at
        ? new Date(primaryWindow.reset_at * 1000).toISOString()
        : '',
      level,
      details: {
        quotas,
        limitReached,
      },
    };
  }
}
