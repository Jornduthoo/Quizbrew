// Which address do phones use to reach this laptop? Same idea as in LANcelot:
// real wifi/ethernet first, virtual adapters (VPN, VirtualBox, Docker, WSL) last.
const os = require('os');

const VIRTUAL = /vethernet|virtual|vmware|vbox|docker|wsl|hyper-v|tailscale|zerotier|hamachi|loopback|utun|tun|tap|bridge|br-/i;
const REAL = /wi-?fi|wlan|wireless|ethernet|^en\d|^eth\d|^wl/i;

function rank(i) {
  let score = 0;
  if (VIRTUAL.test(i.name)) score += 10;
  else if (REAL.test(i.name)) score -= 2;
  if (/^192\.168\.|^10\./.test(i.address)) score -= 1;
  return score;
}

function lanAddresses(interfaces = os.networkInterfaces()) {
  return Object.entries(interfaces)
    .flatMap(([name, list]) => (list || []).map(i => ({ name, ...i })))
    .filter(i => (i.family === 'IPv4' || i.family === 4) && !i.internal && !i.address.startsWith('169.254.'))
    .sort((a, b) => rank(a) - rank(b))
    .map(i => i.address);
}

function isLocal(address) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
}

module.exports = { lanAddresses, isLocal };
