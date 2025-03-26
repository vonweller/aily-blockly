const fs = require('fs');
const path = require('path');
const util = require('util');

// 日志文件设置
const MAX_LOG_SIZE = 1024 * 1024; // 1MB

// 原始的控制台方法
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;

// 获取带时间戳的日志字符串
function getFormattedLog(type, args) {
    const timestamp = new Date().toISOString();
    const message = util.format.apply(null, args);
    return `[${timestamp}] [${type}] ${message}\n`;
}

// 检查并管理日志文件大小
function checkAndTruncateLog(filePath) {
    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size >= MAX_LOG_SIZE) {
            // 文件超过1MB，保留后半部分内容
            const content = fs.readFileSync(filePath, 'utf8');
            const halfLength = Math.floor(content.length / 2);
            // 寻找半长度后的第一个完整行的开始
            const newLinePos = content.indexOf('\n', halfLength) + 1;
            const newContent = content.substring(newLinePos > 0 ? newLinePos : halfLength);
            fs.writeFileSync(filePath, newContent);
            originalConsoleLog(`日志文件已截断，保留最新的日志内容`);
        }
    }
}

// 写入日志文件
function writeToLogFile(logFilePath, data) {
    try {
        // 检查文件大小
        checkAndTruncateLog(logFilePath);
        // 追加新日志
        fs.appendFileSync(logFilePath, data);
    } catch (err) {
        // 出错时恢复到原始控制台
        originalConsoleError('Error writing to log file:', err);
    }
}

// 初始化日志系统
function initLogger(appDataPath) {
    // 确保日志目录存在
    const logDir = path.join(appDataPath, 'logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    // 设置日志文件路径
    const logFilePath = path.join(logDir, `app.log`);

    // 重写控制台方法
    console.log = function() {
        originalConsoleLog.apply(console, arguments);
        writeToLogFile(logFilePath, getFormattedLog('INFO', arguments));
    };

    console.error = function() {
        originalConsoleError.apply(console, arguments);
        writeToLogFile(logFilePath, getFormattedLog('ERROR', arguments));
    };

    console.warn = function() {
        originalConsoleWarn.apply(console, arguments);
        writeToLogFile(logFilePath, getFormattedLog('WARN', arguments));
    };

    console.info = function() {
        originalConsoleInfo.apply(console, arguments);
        writeToLogFile(logFilePath, getFormattedLog('INFO', arguments));
    };

    // 捕获未处理的异常和承诺拒绝
    process.on('uncaughtException', (err) => {
        console.error('Uncaught Exception:', err);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    console.log('日志系统已初始化，日志文件路径:', logFilePath);
    return logFilePath;
}

module.exports = {
    initLogger,
};