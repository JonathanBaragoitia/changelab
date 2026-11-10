export async function refreshStaffNotices({
  api,
  esc,
  navigate,
  toast,
  isCurrent = () => true,
  actorId,
}) {
  const host = document.querySelector('#staff-notices');
  try {
    const { recipient, notices } = await api('/api/staff-notices');
    if (!isCurrent()) return;
    if (actorId && recipient !== actorId) {
      host.hidden = false;
      host.innerHTML =
        '<summary>La cuenta ha cambiado en otra pestaña</summary><p>Actualiza esta página para cargar tu sesión actual.</p>';
      return;
    }
    const wasOpen = host.open,
      historyOpen = host.querySelector('[data-read-history]')?.open;
    const unread = notices.filter((n) => !n.read),
      read = notices.filter((n) => n.read);
    const row = (n) =>
      '<article class="order"><strong>' +
      esc(n.message) +
      '</strong><p>' +
      esc(n.by) +
      ' · ' +
      esc(new Date(n.at).toLocaleString('es-ES')) +
      '</p><div class="chips"><button class="chip" data-notice-open="' +
      esc(n.id) +
      '">Abrir apartado</button>' +
      (!n.read
        ? '<button class="chip" data-notice-read="' + esc(n.id) + '">Marcar leído</button>'
        : '<span>Leído</span>') +
      '</div></article>';
    host.innerHTML =
      '<summary>Avisos internos · ' +
      unread.length +
      ' sin leer</summary><div class="disclosure-body"><p>Cada aviso conserva responsable y fecha. Se actualiza cada 30 segundos.</p>' +
      (unread.length ? unread.map(row).join('') : '<p>No tienes avisos pendientes de leer.</p>') +
      (read.length
        ? '<details data-read-history><summary>Historial de avisos leídos · ' +
          read.length +
          '</summary>' +
          read.map(row).join('') +
          '</details>'
        : '') +
      '</div>';
    host.hidden = false;
    host.open = wasOpen;
    if (historyOpen && host.querySelector('[data-read-history]'))
      host.querySelector('[data-read-history]').open = true;
    host
      .querySelectorAll('[data-notice-open]')
      .forEach(
        (b) =>
          (b.onclick = () => navigate(notices.find((n) => n.id === b.dataset.noticeOpen).section)),
      );
    host.querySelectorAll('[data-notice-read]').forEach(
      (b) =>
        (b.onclick = async () => {
          b.disabled = true;
          try {
            await api(
              '/api/staff-notices/' + encodeURIComponent(b.dataset.noticeRead) + '/read',
              {},
            );
            await refreshStaffNotices({ api, esc, navigate, toast, isCurrent, actorId });
          } catch (e) {
            if (isCurrent()) toast(e.message, true);
            if (b.isConnected) b.disabled = false;
          }
        }),
    );
  } catch {
    if (isCurrent()) host.hidden = true;
  }
}
