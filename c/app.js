// Подтверждение действия биометрией (Face ID / отпечаток) внутри Telegram.
// Страница ничего не хранит и никуда не ходит: секрет лежит в защищённом хранилище телефона,
// наружу уходит только одноразовая подпись через Telegram.WebApp.sendData (сообщение боту).
(function () {
  "use strict";
  var tg = window.Telegram && window.Telegram.WebApp;
  var statusEl = document.getElementById("status");
  var btn = document.getElementById("go");
  function say(t) { statusEl.textContent = t; }
  if (!tg || !tg.BiometricManager) { say("Откройте эту страницу из Telegram на телефоне."); return; }
  tg.ready(); tg.expand();

  var q = new URLSearchParams(location.search);
  var mode = q.get("m");            // "e" — подключить устройство, "c" — подтвердить действие
  var nonce = q.get("n") || "";     // одноразовый код от бота
  if (!/^[0-9a-f]{32}$/.test(nonce) || (mode !== "e" && mode !== "c")) { say("Ссылка недействительна."); return; }
  var bm = tg.BiometricManager;

  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function utf8(s) { return new TextEncoder().encode(s); }
  function send(obj) { tg.sendData(JSON.stringify(obj)); }   // Telegram закрывает окно после отправки

  function enroll() {
    bm.requestAccess({ reason: "Подтверждать действия биометрией" }, function (granted) {
      if (!granted) { say("Доступ к биометрии не выдан."); return; }
      var secret = hex(crypto.getRandomValues(new Uint8Array(32)));
      bm.updateBiometricToken(secret, function (ok) {
        if (!ok) { say("Не удалось сохранить ключ на устройстве."); return; }
        send({ t: "enroll", n: nonce, d: bm.deviceId, k: secret });
      });
    });
  }

  function confirmAction() {
    bm.authenticate({ reason: "Подтвердить действие" }, function (ok, token) {
      if (!ok || !token) { say("Не подтверждено."); showRetry(); return; }
      crypto.subtle.importKey("raw", utf8(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
        .then(function (key) { return crypto.subtle.sign("HMAC", key, utf8(nonce)); })
        .then(function (sig) { send({ t: "confirm", n: nonce, d: bm.deviceId, h: hex(sig) }); })
        .catch(function () { say("Ошибка подписи."); });
    });
  }

  function showRetry() {
    btn.textContent = "Повторить";
    btn.disabled = false;
    btn.hidden = false;
    btn.onclick = function () { btn.disabled = true; confirmAction(); };
  }

  bm.init(function () {
    if (!bm.isBiometricAvailable) { say("На этом устройстве биометрия недоступна или не настроена."); return; }
    if (mode === "c" && !bm.isBiometricTokenSaved) { say("Устройство не подключено. Сначала подключите его."); return; }
    if (mode === "c") {
      // подтверждение — сразу, без лишней кнопки: окно и так открыто нажатием «🔐 Подтвердить» в чате
      say("Подтверждение…");
      confirmAction();
      return;
    }
    say("Подключить это устройство?");
    btn.textContent = "Подключить";
    btn.hidden = false;
    btn.onclick = function () { btn.disabled = true; enroll(); };
  });
})();
