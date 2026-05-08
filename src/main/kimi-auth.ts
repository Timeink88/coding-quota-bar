import { BrowserWindow, session, shell } from 'electron';
import type { ConfigManager } from './config';
import type { ProviderTypeConfig } from '../shared/types';

const loginWindows = new Map<string, BrowserWindow>();

let _getConfigManager: () => ConfigManager | null = () => null;
let _getPopupWindow: () => BrowserWindow | null = () => null;

export function setKimiAuthDeps(deps: {
  getConfigManager: () => ConfigManager | null;
  getPopupWindow: () => BrowserWindow | null;
}): void {
  _getConfigManager = deps.getConfigManager;
  _getPopupWindow = deps.getPopupWindow;
}

/**
 * 从 session 中查找 kimi-auth cookie
 */
async function findKimiAuthCookie(ses: Electron.Session): Promise<string | null> {
  const cookies = await ses.cookies.get({ url: 'https://www.kimi.com' });
  const authCookie = cookies.find(c => c.name === 'kimi-auth');
  return authCookie?.value ?? null;
}

/**
 * 解码 JWT payload（base64url → JSON）
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const decoded = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * 验证 kimi-auth token 是否代表有效登录
 * - JWT 中 sub 字段必须非空（代表真实用户 ID）
 * - exp 字段必须未过期
 */
function isValidLoginToken(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    console.log('[Kimi] Token validation: failed to decode JWT');
    return false;
  }

  // sub 必须存在且非空（表示已认证的用户）
  const sub = payload.sub;
  if (!sub || (typeof sub === 'string' && sub.trim() === '')) {
    console.log(`[Kimi] Token validation: sub is empty, not a real login (payload keys: ${Object.keys(payload).join(',')})`);
    return false;
  }

  // 检查过期时间
  if (typeof payload.exp === 'number') {
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      console.log(`[Kimi] Token validation: expired (exp: ${payload.exp}, now: ${now})`);
      return false;
    }
  }

  console.log(`[Kimi] Token validation: valid (sub: ${String(sub).slice(0, 8)}...)`);
  return true;
}

/**
 * Kimi 网页登录：弹出 BrowserWindow 让用户登录，提取 kimi-auth cookie
 */
export function kimiWebLogin(accountId: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const existing = loginWindows.get(accountId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      resolve({ success: false, error: 'Login window already open' });
      return;
    }

    const partition = `persist:kimi-${accountId}`;

    // 先清除该分区的 session 数据，确保无残留旧 cookie
    session.fromPartition(partition).clearStorageData().then(() => {
      const win = new BrowserWindow({
        width: 1024,
        height: 768,
        minWidth: 480,
        minHeight: 400,
        autoHideMenuBar: true,
        title: 'Kimi Login',
        webPreferences: {
          partition,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      });

      win.setMenuBarVisibility(false);
      loginWindows.set(accountId, win);

      // 限制导航：只允许 Kimi 及其相关域名
      const allowedOrigins = [
        'https://www.kimi.com',
        'https://kimi.com',
        'https://passport.kimi.com',
        'https://account.moonshot.cn',
      ];
      win.webContents.on('will-navigate', (event, url) => {
        if (!allowedOrigins.some(o => url.startsWith(o))) {
          event.preventDefault();
        }
      });
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (allowedOrigins.some(o => url.startsWith(o))) {
          return { action: 'allow' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
      });

      let resolved = false;
      let checkInterval: ReturnType<typeof setInterval> | null = null;

      // 登录成功后的处理
      const onLoginSuccess = async (token: string) => {
        console.log('[Kimi] Login detected!');
        resolved = true;
        if (checkInterval) clearInterval(checkInterval);

        // 保存 token 和登录状态到配置
        const configManager = _getConfigManager();
        if (configManager) {
          const config = configManager.getConfig();
          if (config) {
            const providers = structuredClone(config.providers);
            const kimi = providers.kimi as ProviderTypeConfig;
            if (kimi?.accounts) {
              const account = kimi.accounts.find(a => a.id === accountId);
              if (account) {
                account.authMode = 'weblogin';
                account.webToken = token;
                account.kimiLoggedIn = true;
                await configManager.updateConfig({ providers });
              }
            }
          }
        }

        win.close();
        loginWindows.delete(accountId);

        const popup = _getPopupWindow();
        if (popup && !popup.isDestroyed()) {
          popup.webContents.send('kimi-web-login-success', accountId);
        }

        resolve({ success: true });
      };

      /**
       * 检查 cookie 并验证 token 有效性
       * 只有通过 JWT 验证（sub 非空 + 未过期）才认为登录成功
       */
      const checkLogin = async () => {
        if (resolved || win.isDestroyed()) return;
        const token = await findKimiAuthCookie(win.webContents.session);
        if (token && isValidLoginToken(token)) {
          await onLoginSuccess(token);
        }
      };

      // 页面加载完成后开始轮询检测
      win.webContents.on('did-finish-load', () => {
        if (checkInterval) clearInterval(checkInterval);

        // 立即检查一次
        checkLogin();

        // 开始轮询（每 2 秒检查一次）
        checkInterval = setInterval(checkLogin, 2000);
      });

      win.on('closed', () => {
        if (checkInterval) clearInterval(checkInterval);
        loginWindows.delete(accountId);
        if (!resolved) resolve({ success: false, error: 'Window closed' });
      });

      console.log('[Kimi] Opening login window...');
      win.loadURL('https://www.kimi.com');
    }); // clearStorageData().then
  });
}

/**
 * Kimi 网页登出：清除 webToken、登录状态和 session 数据
 */
export async function kimiWebLogout(accountId: string): Promise<void> {
  const configManager = _getConfigManager();
  if (!configManager) return;
  const config = configManager.getConfig();
  if (!config) return;

  const providers = structuredClone(config.providers);
  const kimi = providers.kimi as ProviderTypeConfig;
  if (kimi?.accounts) {
    const account = kimi.accounts.find(a => a.id === accountId);
    if (account) {
      account.webToken = '';
      account.kimiLoggedIn = false;
      await configManager.updateConfig({ providers });
    }
  }

  // 清除 session partition 数据（包括 cookies、localStorage 等）
  const partition = `persist:kimi-${accountId}`;
  const ses = session.fromPartition(partition);
  await ses.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
  });
}
