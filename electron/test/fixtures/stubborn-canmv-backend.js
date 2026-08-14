process.stdin.resume();
process.stdin.on('end', () => {
  // Deliberately keep the process alive to exercise the backend force-kill path.
});
process.on('SIGTERM', () => {
  // Deliberately ignore graceful termination on platforms that deliver SIGTERM.
});
setInterval(() => undefined, 1_000);
