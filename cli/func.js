

const spinnerFrames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
let frameIndex = 0;

const interval = setInterval(() => {
    const frame = spinnerFrames[frameIndex % spinnerFrames.length];
    // 使用 ANSI 转义序列将输出设为绿色（32），并在行首覆盖之前内容
    process.stdout.write(`\r\x1b[32m${frame} 加载中... \x1b[0m`);
    frameIndex++;
}, 80);

// 模拟一个耗时任务（例如 5 秒）
setTimeout(() => {
    clearInterval(interval);
    process.stdout.write('\r\x1b[32m加载完成！      \x1b[0m\n');
}, 10000);