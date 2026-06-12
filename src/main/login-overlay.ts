/**
 * 登录窗口悬浮工具栏：用原生 WebContentsView 实现，独立于网页加载。
 * 提供返回起始页、刷新当前页、加载状态指示三个功能。
 * 窗口创建即存在，网页白屏期间也能操作。
 */
import { BrowserWindow, WebContentsView } from 'electron';

export interface LoginOverlayOptions {
  /** 点击"返回"按钮时主窗口导航到的 URL */
  startUrl: string;
}

/** 按钮点击通过 URL 查询参数传递动作标记，在 will-navigate 中拦截 */
const ACTION_BACK = '__cqb=back';
const ACTION_REFRESH = '__cqb=refresh';

function buildActionUrl(baseUrl: string, action: string): string {
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${action}`;
}

function buildToolbarHtml(startUrl: string): string {
  const backHref = buildActionUrl(startUrl, ACTION_BACK);
  const refreshHref = buildActionUrl(startUrl, ACTION_REFRESH);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; background: transparent; overflow: hidden; }
body { display: flex; align-items: center; gap: 5px; padding: 0 6px; }
.btn {
  display: inline-flex; align-items: center; gap: 3px;
  height: 28px; padding: 0 10px;
  border-radius: 14px; border: 1px solid rgba(0,0,0,0.1);
  background: rgba(255,255,255,0.92); backdrop-filter: blur(8px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  cursor: pointer; font-size: 12px; font-weight: 500;
  color: #1a1a1a; font-family: -apple-system, system-ui, sans-serif;
  text-decoration: none; white-space: nowrap; user-select: none;
  transition: background 0.15s, transform 0.05s;
}
.btn:hover { background: #fff; }
.btn:active { transform: scale(0.96); }
.btn.icon { padding: 0 8px; font-size: 14px; line-height: 1; }
.spinner {
  width: 14px; height: 14px; flex-shrink: 0;
  border: 2px solid rgba(0,0,0,0.12);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: cqb-spin 0.7s linear infinite;
  display: none;
}
body.loading .spinner { display: block; }
@keyframes cqb-spin { to { transform: rotate(360deg); } }
@media (prefers-color-scheme: dark) {
  .btn { background: rgba(40,40,42,0.92); border-color: rgba(255,255,255,0.12); color: #f0f0f0; }
  .btn:hover { background: rgba(55,55,57,1); }
  .spinner { border-color: rgba(255,255,255,0.12); border-top-color: #60a5fa; }
}
</style></head><body>
<a class="btn" href="${backHref}">\u2190 \u8fd4\u56de</a>
<a class="btn icon" href="${refreshHref}" title="\u5237\u65b0">\u21bb</a>
<div class="spinner"></div>
</body></html>`;
}

/**
 * 创建悬浮工具栏并附加到窗口左上角
 * 返回创建的 WebContentsView，窗口关闭时随窗口自动销毁
 */
export function createLoginOverlay(win: BrowserWindow, options: LoginOverlayOptions): WebContentsView {
  const overlay = new WebContentsView({
    webPreferences: { contextIsolation: true },
  });
  overlay.setBackgroundColor('#00000000');
  overlay.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildToolbarHtml(options.startUrl)));
  overlay.setBounds({ x: 8, y: 8, width: 155, height: 36 });

  // 拦截工具栏按钮导航，执行对应操作
  overlay.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (url.includes(ACTION_BACK)) {
      win.webContents.loadURL(options.startUrl);
    } else if (url.includes(ACTION_REFRESH)) {
      win.webContents.reload();
    }
  });

  // 加载状态：主窗口开始/停止加载时同步显示/隐藏 spinner
  win.webContents.on('did-start-loading', () => {
    if (!overlay.webContents.isDestroyed()) {
      overlay.webContents.executeJavaScript('document.body.classList.add("loading")').catch(() => {});
    }
  });
  win.webContents.on('did-stop-loading', () => {
    if (!overlay.webContents.isDestroyed()) {
      overlay.webContents.executeJavaScript('document.body.classList.remove("loading")').catch(() => {});
    }
  });

  win.contentView.addChildView(overlay);
  return overlay;
}
