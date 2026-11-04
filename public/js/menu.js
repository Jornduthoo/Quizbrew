// The quizmaster's top bar (laptop, remote and the network help page): line icons, the join dialog
// with every address of this laptop, the settings dialog and the Windows Firewall button.
(function () {
  const { $, h } = QB;
  const P = {
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
    screen: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    check: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M9.5 11.5l2 2 3.5-4"/>',
    raffle: '<path d="M3 8a2 2 0 0 0 0 4v5h18v-5a2 2 0 0 1 0-4V5H3z" transform="translate(0 1)"/><path d="M14 6v12" stroke-dasharray="2 2"/>',
    remote: '<rect x="7" y="2" width="10" height="20" rx="3"/><circle cx="12" cy="8" r="2"/><path d="M10 14h.01M14 14h.01M10 17h.01M14 17h.01"/>',
    wifi: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    sound: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    mute: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  };
  const icon = name => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  const fillIcons = (root = document) => root.querySelectorAll('[data-ico]').forEach(el => {
    if (!el.querySelector('svg.ico')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.ico));
  });
  fillIcons();

  // What kind of network an address is on: a word helps pick the right one.
  const kindText = k => (k ? t(`network.kind.${k}`) : '');

  // The list of addresses with a button to put another one on the QR code.
  async function renderAddresses(box, { onPick, compact } = {}) {
    let data;
    try { data = await fetch('/api/host/addresses').then(r => r.json()); } catch { return null; }
    if (!data || !data.list) return null;
    box.replaceChildren();
    if (!data.list.length) {
      box.append(h('li', { class: 'addr none' }, t('network.noNetwork')));
      return data;
    }
    for (const a of data.list) {
      const bad = a.kind === 'vpn' || a.kind === 'virtual';
      const label = [a.name, kindText(a.kind)].filter(Boolean).join(' · ');
      const pick = a.chosen
        ? h('span', { class: 'addr-on' }, t('network.onQr'))
        : h('button', { class: 'ghost-btn small', type: 'button', onclick: async () => {
          const r = await fetch('/api/host/address', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: a.address }) }).then(x => x.json());
          if (onPick) onPick(r);
          renderAddresses(box, { onPick, compact });
        } }, t('network.useThis'));
      box.append(h('li', { class: 'addr' + (a.chosen ? ' chosen' : '') + (bad ? ' bad' : '') },
        h('code', {}, a.url.replace(/^https?:\/\//, '')),
        compact && !label ? null : h('span', { class: 'addr-kind' }, label),
        pick));
    }
    return data;
  }

  // One click lets phones in through the Windows Firewall (Windows asks for permission first).
  function firewallButton(btn, err) {
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      if (err) err.textContent = '';
      let r;
      try { r = await fetch('/api/host/firewall', { method: 'POST' }).then(x => x.json()); } catch { r = { error: 'error.generic' }; }
      btn.disabled = false;
      if (r.ok) { btn.classList.add('done'); btn.lastChild.textContent = t('network.fwDone'); } else if (err) err.textContent = t(r.error || 'error.generic');
    });
  }

  window.Menu = { icon, fillIcons, renderAddresses, firewallButton };

  // ---- The top bar of the laptop and the remote ----
  const modal = $('#settings-modal');
  if ($('#settings-btn') && modal) {
    $('#settings-btn').addEventListener('click', () => modal.showModal());
    modal.querySelector('[data-close]').addEventListener('click', () => modal.close());
    modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });
    const venue = $('#settings-venue');
    if (venue && $('#venue-tile')) venue.addEventListener('click', () => { modal.close(); $('#venue-tile').click(); });
    else if ($('#settings-venue-row')) $('#settings-venue-row').hidden = true;
    firewallButton($('#settings-fw'), $('#settings-fw-error'));
  }

  const join = $('#join-modal');
  if ($('#join-btn') && join) {
    const show = info => {
      $('#join-qr').innerHTML = info.qr;
      $('#join-big').textContent = info.url.replace(/^https?:\/\//, '');
    };
    $('#join-btn').addEventListener('click', async () => {
      join.showModal();
      const data = await renderAddresses($('#join-list'), { onPick: show, compact: true });
      if (data) { show(data); $('#join-others').hidden = data.list.length < 2; }
    });
    join.querySelector('[data-close]').addEventListener('click', () => join.close());
    join.addEventListener('click', e => { if (e.target === join) join.close(); });
  }
})();
