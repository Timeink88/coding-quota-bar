import { app } from 'electron';

/**
 * 正式打包环境下屏蔽主进程调试日志（console.log/warn/info/debug），
 * console.error 不屏蔽，错误始终输出。开发模式不受影响。
 */
if (app.isPackaged) {
  console.log = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.debug = () => {};
}
