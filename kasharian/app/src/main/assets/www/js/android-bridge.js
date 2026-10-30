/* Native Android integrations for the packaged APK. In a normal browser this file is inert. */
(function (root) {
  'use strict';
  const bridge = root.KHNativeStorage;
  if (!bridge) return;

  root.KHNativeFiles = {
    saveText(name, mime, text) {
      const bytes = new TextEncoder().encode(String(text));
      this.saveBytes(name, mime, bytes);
    },
    saveBytes(name, mime, value) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      bridge.saveFile(String(name || 'KasHarian-export'), String(mime || 'application/octet-stream'), root.btoa(binary));
    }
  };

  const permissionCallbacks = Object.create(null);
  root.__khNativeNotificationPermissionResult = function (id, granted) {
    const resolve = permissionCallbacks[id];
    if (!resolve) return;
    delete permissionCallbacks[id];
    resolve(!!granted);
  };
  root.KHNativePermissions = {
    requestNotifications() {
      return new Promise((resolve) => {
        const id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        permissionCallbacks[id] = resolve;
        bridge.requestNotificationsPermission(id);
      });
    }
  };
})(window);
