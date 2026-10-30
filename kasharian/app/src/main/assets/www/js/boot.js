/* Boot: choose the first screen, auto-lock, service worker. */
(function () {
  'use strict';
  const A = KHApp, { db, root, session, S } = A;
  function start() {
    if (!db().pin) {
      if (!db().profile) return root('welcome');
      return root('pinsetup', { flow: 'newpin' });          // profile saved but PIN not yet
    }
    if (!db().onboarded) { session.unlocked = true; return root('opening'); }
    root('lock');
  }
  document.addEventListener('visibilitychange', () => {
    const mins = db().settings.autolockMin;
    if (document.hidden) A.session.hiddenAt = Date.now();
    else if (A.session.unlocked && A.session.hiddenAt && Date.now() - A.session.hiddenAt >= mins * 60000) A.lockNow();
  });
  // Di jendela terisolasi (pratinjau/iframe) mengakses navigator.serviceWorker bisa melempar error; aplikasi tetap harus mulai.
  try { if (!window.KHNativeStorage && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* tanpa service worker */ }
  start();
})();
