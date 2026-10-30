/* Terapkan tema tersimpan sebelum layar tampil, supaya tidak berkedip. */
try { var storage = window.KHNativeStorage || window.localStorage; var m = storage.getItem('kh-theme'); if (m === 'light' || m === 'dark') document.documentElement.setAttribute('data-theme', m); } catch (e) { /* tema otomatis */ }
