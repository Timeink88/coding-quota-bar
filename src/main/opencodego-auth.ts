import { BrowserWindow, session, shell } from 'electron';
import { createLoginOverlay } from './login-overlay';
import type { ConfigManager } from './config';
import type { ProviderTypeConfig } from '../shared/types';

const loginWindows = new Map<string, BrowserWindow>();

let _getConfigManager: () => ConfigManager | null = () => null;
let _getPopupWindow: () => BrowserWindow | null = () => null;

export function setOpencodegoAuthDeps(deps: {
  getConfigManager: () => ConfigManager | null;
  getPopupWindow: () => BrowserWindow | null;
}): void {
  _getConfigManager = deps.getConfigManager;
  _getPopupWindow = deps.getPopupWindow;
}

/**
 * OpenCode Go 网页登录：弹出 BrowserWindow 让用户通过 OAuth 登录
 */
export function opencodegoWebLogin(accountId: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const existing = loginWindows.get(accountId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      resolve({ success: false, error: 'Login window already open' });
      return;
    }

    const partition = `persist:opencodego-${accountId}`;

    const win = new BrowserWindow({
      width: 1024,
      height: 768,
      minWidth: 480,
      minHeight: 400,
      autoHideMenuBar: true,
      title: 'OpenCode Go Login',
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });

    win.setMenuBarVisibility(false);
    loginWindows.set(accountId, win);

    // 限制导航：仅放行 OAuth 流程相关的可信域名（防钓鱼、防劫持）。
    // 用 host 后缀匹配，覆盖 OAuth 提供商所有子域名（未来加新子域无需改代码）。
    //   - opencode.ai / auth.opencode.ai：应用与授权服务
    //   - *.google.com / *.google.co.uk：Google OAuth（含 accounts/www/myaccount/gds 等子域）
    //   - *.github.com：GitHub OAuth（含 login/sessions 等子域）
    const allowedHostSuffixes = [
      'opencode.ai',
      'auth.opencode.ai',
      'google.com',
      'google.co.uk',
      'github.com',
    ];
    const isAllowed = (url: string): boolean => {
      try {
        const host = new URL(url).hostname.toLowerCase();
        return allowedHostSuffixes.some(suffix =>
          host === suffix || host.endsWith('.' + suffix)
        );
      } catch {
        return false;
      }
    };
    win.webContents.on('will-navigate', (event, url) => {
      if (!isAllowed(url)) event.preventDefault();
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowed(url)) return { action: 'allow' };
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // 悬浮工具栏（返回/刷新/加载指示），独立渲染层，窗口创建即存在
    createLoginOverlay(win, { startUrl: 'https://opencode.ai/auth' });

    let resolved = false;
    let checkInterval: ReturnType<typeof setInterval> | null = null;

    // 登录成功后的处理
    const onLoginSuccess = async () => {
      console.log('[OpenCodeGo] Login detected!');
      resolved = true;
      if (checkInterval) clearInterval(checkInterval);

      // 保存认证状态到配置
      if (_getConfigManager()) {
        const config = _getConfigManager()!.getConfig();
        if (config) {
          const providers = structuredClone(config.providers);
          const opencodego = providers.opencodego as ProviderTypeConfig;
          if (opencodego?.accounts) {
            const account = opencodego.accounts.find(a => a.id === accountId);
            if (account) {
              account.authMode = 'weblogin';
              account.opencodegoLoggedIn = true;
              await _getConfigManager()!.updateConfig({ providers });
            }
          }
        }
      }

      win.close();
      loginWindows.delete(accountId);

      const popup = _getPopupWindow();
      if (popup && !popup.isDestroyed()) {
        popup.webContents.send('opencodego-web-login-success', accountId);
      }

      resolve({ success: true });
    };

    // 页面加载完成后轮询检测登录
    win.webContents.on('did-finish-load', () => {
      const url = win.webContents.getURL();
      console.log(`[OpenCodeGo] did-finish-load: ${url}`);

      if (checkInterval) clearInterval(checkInterval);

      // 如果 URL 变为 /workspace/wrk_xxx，说明已登录
      if (/\/workspace\/wrk_/.test(url)) {
        if (!resolved) onLoginSuccess();
        return;
      }

      // 开始轮询检测
      checkInterval = setInterval(async () => {
        if (resolved || win.isDestroyed()) {
          if (checkInterval) clearInterval(checkInterval);
          return;
        }
        const currentUrl = win.webContents.getURL();
        if (/\/workspace\/wrk_/.test(currentUrl)) {
          await onLoginSuccess();
        }
      }, 2000);
    });

    win.on('closed', () => {
      if (checkInterval) clearInterval(checkInterval);
      loginWindows.delete(accountId);
      if (!resolved) resolve({ success: false, error: 'Window closed' });
    });

    console.log('[OpenCodeGo] Opening login window...');
    win.loadURL('https://opencode.ai/auth');
  });
}

/**
 * OpenCode Go 网页登出：清除 authMode 和 session 数据
 */
export async function opencodegoWebLogout(accountId: string): Promise<void> {
  const configManager = _getConfigManager();
  if (!configManager) return;
  const config = configManager.getConfig();
  if (!config) return;

  const providers = structuredClone(config.providers);
  const opencodego = providers.opencodego as ProviderTypeConfig;
  if (opencodego?.accounts) {
    const account = opencodego.accounts.find(a => a.id === accountId);
    if (account) {
      account.authMode = 'apikey';
      account.opencodegoLoggedIn = false;
      await configManager.updateConfig({ providers });
    }
  }

  // 清除 session partition 数据
  const partition = `persist:opencodego-${accountId}`;
  const ses = session.fromPartition(partition);
  await ses.clearStorageData();
}
