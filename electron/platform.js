const platform = {
  isWin32: process.platform === "win32",
  isDarwin: process.platform === "darwin",
  isLinux: process.platform === "linux",
}

console.log("platform", process.platform, platform);

module.exports = platform;
