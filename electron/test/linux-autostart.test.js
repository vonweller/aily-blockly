const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createAutostartPlan,
  renderBootStartScript,
  renderSystemdUnit,
} = require('../python-runtime/linux-shared/autostart');

test('renders a systemd plan with unbuffered Python execution', () => {
  const unit = renderSystemdUnit({
    serviceName: 'cybercam',
    scriptPath: '/home/pi/cybercam/main.py',
    workingDirectory: '/home/pi/cybercam',
  });
  assert.match(unit, /ExecStart=.*python3 -u .*main\.py/);
  assert.match(unit, /Restart=on-failure/);

  const plan = createAutostartPlan({
    kind: 'systemd',
    serviceName: 'cybercam',
    scriptPath: '/home/pi/cybercam/main.py',
  });
  assert.equal(plan.kind, 'systemd');
  assert.ok(plan.commands.some(command => /systemctl enable/.test(command)));
});

test('renders a boot-start.sh plan without requiring systemd', () => {
  const script = renderBootStartScript({
    scriptPath: '/home/pi/cybercam/main.py',
    logPath: '/home/pi/cybercam/cybercam.log',
  });
  assert.match(script, /python3 -u/);
  assert.match(script, /nohup/);

  const plan = createAutostartPlan({
    kind: 'boot-start-sh',
    scriptPath: '/home/pi/cybercam/main.py',
  });
  assert.equal(plan.kind, 'boot-start-sh');
  assert.ok(plan.files.some(file => file.path.endsWith('/boot/start.sh')));
});
