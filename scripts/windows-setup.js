const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const readline = require('node:readline/promises');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const state = path.join(os.homedir(), '.cyberboss-xlc');
const workspace = path.join(state, 'workspace');
const win = process.platform === 'win32';
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: 'inherit', shell: win });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}
function exists(command, args = ['--version']) {
  return spawnSync(command, args, { stdio: 'ignore', shell: win }).status === 0;
}
function configure() {
  fs.mkdirSync(workspace, { recursive: true });
  process.env.CYBERBOSS_STATE_DIR = state;
  process.env.CYBERBOSS_WORKSPACE_ROOT = workspace;
  process.env.CYBERBOSS_RUNTIME = 'codex';
  process.env.CYBERBOSS_HOME = root;
  process.env.CYBERBOSS_CHECKIN_WORKSPACE = workspace;
  process.env.CYBERBOSS_CHECKIN_MIN_INTERVAL_MS = '900000';
  process.env.CYBERBOSS_CHECKIN_MAX_INTERVAL_MS = '900000';
  process.env.CYBERBOSS_QUIET_START_HOUR = '1';
  process.env.CYBERBOSS_QUIET_END_HOUR = '9';
  process.env.CYBERBOSS_QUIET_TIMEZONE = 'Asia/Shanghai';
  const profile = path.join(state, 'profile.json');
  const saved = fs.existsSync(profile) ? JSON.parse(fs.readFileSync(profile, 'utf8')) : {};
  process.env.CYBERBOSS_USER_NAME = saved.name || 'User';
  process.env.CYBERBOSS_USER_GENDER = 'female';
  const instruction = path.join(state, 'weixin-instructions.md');
  if (!fs.existsSync(instruction)) fs.writeFileSync(instruction,
    '# 微信陪伴助手\n用中文短句自然聊天。根据用户明确提供的信息回应，不猜测现实状态。\n' +
    '可以记录日记和时间轴，主动联系时结合当前聊天；不要把唤醒当作用户发言。\n' +
    '不得假称继承了 ChatGPT 的聊天记忆。用户可在本文件添加自己的人设和记忆。\n' +
    '截图、健康、定位等能力只有实际接入且获得相应授权才能使用。\n', 'utf8');
  const accountsDir = path.join(state, 'accounts');
  const accounts = fs.existsSync(accountsDir) ? fs.readdirSync(accountsDir)
    .filter(n => n.endsWith('.json') && !n.endsWith('.context-tokens.json'))
    .map(n => JSON.parse(fs.readFileSync(path.join(accountsDir, n), 'utf8')))
    .sort((a,b) => String(b.savedAt).localeCompare(String(a.savedAt))) : [];
  if (accounts.length) {
    if (!accounts[0].userId) throw new Error('Saved WeChat account has no userId. Log in again.');
    process.env.CYBERBOSS_ACCOUNT_ID = accounts[0].accountId;
    process.env.CYBERBOSS_ALLOWED_USER_IDS = accounts[0].userId;
    process.env.CYBERBOSS_CHECKIN_USER_ID = accounts[0].userId;
  }
  return accounts.length;
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Please install Node.js 22 or newer.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\nCyberboss Windows 安装与启动\n1. 安装依赖与 Codex\n2. 登录 Codex 模型账号\n3. 微信扫码登录\n4. 启动微信陪伴（15分钟唤醒，01:00–09:00免打扰）\n5. 查看状态\n6. 打开本地人设与记忆文件\n');
    const choice = (await rl.question('输入编号：')).trim();
    if (choice === '1') {
      rl.close();
      if (!exists('git')) throw new Error('请先安装 Git for Windows：https://git-scm.com/downloads/win 。安装后重新打开。');
      run('npm', ['ci']);
      if (!exists('codex')) run('npm', ['install', '-g', '@openai/codex']);
      console.log('依赖已安装。下次选择 2 登录模型账号，然后选择 3 登录微信。');
      return;
    }
    if (!fs.existsSync(path.join(root, 'node_modules', 'dotenv'))) throw new Error('请先选择 1 安装依赖。');
    if (choice === '2') { rl.close(); run('codex', ['login']); return; }
    if (choice === '3') {
      const name = (await rl.question('希望 AI 怎么称呼你（仅保存在本机）：')).trim();
      if (!name) throw new Error('称呼不能为空。');
      fs.mkdirSync(state, { recursive: true });
      fs.writeFileSync(path.join(state, 'profile.json'), JSON.stringify({ name }), 'utf8');
    }
    rl.close();
    const accountCount = configure();
    if (choice === '3') { run(process.execPath, ['bin/cyberboss.js', 'login']); return; }
    if (choice === '4') {
      if (!accountCount) throw new Error('请先选择 3 完成微信扫码登录。');
      if (!exists('codex')) throw new Error('请先选择 1 安装 Codex。');
      run('codex', ['login', 'status']);
      console.log(`启动后在微信发送：/bind ${workspace}\n保持此窗口开启；电脑睡眠或关机会停止服务。`);
      run(process.execPath, ['scripts/shared-start.js']);
    } else if (choice === '5') run(process.execPath, ['scripts/shared-status.js']);
    else if (choice === '6') run('notepad.exe', [path.join(state, 'weixin-instructions.md')]);
    else throw new Error('请选择 1–6。');
  } finally { rl.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
