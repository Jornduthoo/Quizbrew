// Which address do phones use to reach this laptop? Same idea as in LANcelot:
// real wifi/ethernet first, virtual adapters (VPN, VirtualBox, Docker, WSL) last.
const os = require('os');
const { execFile } = require('child_process');

const VIRTUAL = /vethernet|virtual|vmware|vbox|docker|wsl|hyper-v|tailscale|zerotier|hamachi|loopback|utun|tun|tap|bridge|br-/i;
const VPN = /vpn|nord|wireguard|openvpn|proton|tailscale|zerotier|hamachi|utun|tun\d|tap/i;
const REAL = /wi-?fi|wlan|wireless|ethernet|^en\d|^eth\d|^wl/i;

function rank(i) {
  let score = 0;
  if (VIRTUAL.test(i.name) || VPN.test(i.name)) score += 10;
  else if (REAL.test(i.name)) score -= 2;
  if (/^192\.168\.|^10\./.test(i.address)) score -= 1;
  return score;
}

// What kind of network is this? A short word helps the quizmaster pick the right address.
// The keys are network.kind.<kind> in lang/*.json.
function kind({ name = '', address = '' }) {
  if (/^192\.168\.137\./.test(address)) return 'hotspot';
  if (/^192\.168\.(42|225)\.|^172\.20\.10\./.test(address)) return 'phone';
  if (VPN.test(name) || /^10\.5\.0\./.test(address)) return 'vpn';
  if (VIRTUAL.test(name)) return 'virtual';
  if (/wi-?fi|wlan|wireless|^wl/i.test(name)) return 'wifi';
  if (/ethernet|^en\d|^eth\d|\blan\b/i.test(name)) return 'cable';
  return '';
}

// Every IPv4 address of this laptop with the name of its network card, best first.
function lanInterfaces(interfaces = os.networkInterfaces()) {
  return Object.entries(interfaces)
    .flatMap(([name, list]) => (list || []).map(i => ({ name, ...i })))
    .filter(i => (i.family === 'IPv4' || i.family === 4) && !i.internal && !i.address.startsWith('169.254.'))
    .sort((a, b) => rank(a) - rank(b))
    .map(i => ({ address: i.address, name: i.name, kind: kind(i) }));
}

function lanAddresses(interfaces) {
  return lanInterfaces(interfaces).map(i => i.address);
}

function isLocal(address) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
}

// The IP in a Host header ("192.168.1.5:3000"), or '' for a name like localhost.
function hostIp(header = '') {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/.exec(String(header));
  return m ? m[1] : '';
}

// Let phones in through the Windows Firewall with one click. Windows asks the quizmaster for permission first.
const psCode = s => Buffer.from(s, 'utf16le').toString('base64');
const psText = s => `'${String(s).replace(/'/g, "''")}'`;
function openFirewall(port, cb) {
  if (process.platform !== 'win32') return cb({ error: 'network.fwWindowsOnly' });
  const ports = port >= 3000 && port <= 3010 ? '3000-3010' : String(Number(port));
  const rule = [
    // A "Block" rule from clicking Cancel on the first Windows question would win over our Allow rule.
    `Get-NetFirewallApplicationFilter -Program ${psText(process.execPath)} -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { $_.Action -eq 'Block' -and $_.Direction -eq 'Inbound' } | Remove-NetFirewallRule`,
    "Remove-NetFirewallRule -DisplayName 'Quizbrew' -ErrorAction SilentlyContinue",
    `New-NetFirewallRule -DisplayName 'Quizbrew' -Direction Inbound -Protocol TCP -LocalPort ${ports} -Action Allow -Profile Any | Out-Null`,
  ].join('; ');
  const ps = `$p = Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-EncodedCommand','${psCode(rule)}'; exit $p.ExitCode`;
  execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }, err => cb(err ? { error: 'network.fwFailed' } : { ok: true }));
}

module.exports = { lanAddresses, lanInterfaces, kind, isLocal, hostIp, openFirewall };
