const path = require('path');
const electronLog = require('electron-log');

// 初始化日志系统
function initLogger(appDataPath) {
    // 配置日志文件路径
    const logDir = path.join(appDataPath, 'logs');
    electronLog.transports.file.resolvePathFn = () => path.join(logDir, 'app.log');
    
    // 配置日志格式
    electronLog.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
    
    // 配置日志文件大小限制 (1MB)
    electronLog.transports.file.maxSize = 1024 * 1024;
    
    // 配置日志级别
    electronLog.transports.file.level = 'info';
    electronLog.transports.console.level = 'info';
    
    // 将原生console重定向到electron-log
    console.log = electronLog.info.bind(electronLog);
    console.error = electronLog.error.bind(electronLog);
    console.warn = electronLog.warn.bind(electronLog);
    console.info = electronLog.info.bind(electronLog);
    
    // 捕获未处理的异常和承诺拒绝
    process.on('uncaughtException', (err) => {
        electronLog.error('Uncaught Exception:', err);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        electronLog.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });
    
    electronLog.info('日志系统已初始化，日志文件路径:', electronLog.transports.file.getFile().path);
    return electronLog.transports.file.getFile().path;
}

module.exports = {
    initLogger,
    // 导出日志对象，方便在其他地方直接使用
    log: electronLog
};