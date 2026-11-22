// Подтверждение действия биометрией (Face ID / отпечаток) внутри Telegram.
// Страница ничего не хранит и никуда не ходит: секрет лежит в защищённом хранилище телефона,
// наружу уходит только одноразовая подпись через Telegram.WebApp.sendData (сообщение боту).
(function () {
  "use strict";
  var tg = window.Telegram && window.Telegram.WebApp;
  var statusEl = document.getElementById("status");
  var btn = document.getElementById("go");
  var diagEl = document.getElementById("diag");
  function say(t) { statusEl.textContent = t; }
  if (!tg || !tg.BiometricManager) { say("Откройте эту страницу из Telegram на телефоне."); return; }
  tg.ready(); tg.expand();

  var q = new URLSearchParams(location.search);
  var mode = q.get("m");            // "e" — подключить устройство, "c" — подтвердить действие
  var nonce = q.get("n") || "";     // одноразовый код от бота
  if (!/^[0-9a-f]{32}$/.test(nonce) || (mode !== "e" && mode !== "c")) { say("Ссылка недействительна."); return; }
  var bm = tg.BiometricManager;
  // Android показывает окно отпечатка надёжно только в ответ на касание — там запуск по кнопке.
  var needTap = tg.platform === "android" || tg.platform === "android_x";
  var waitTimer = null;

  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function utf8(s) { return new TextEncoder().encode(s); }
  function send(obj) { tg.sendData(JSON.stringify(obj)); }   // Telegram закрывает окно после отправки

  function diag(extra) {
    // Только состояние клиента и биометрии — без секретов и кода подтверждения.
    if (!diagEl) { return; }
    diagEl.textContent = [
      tg.platform + " " + tg.version,
      "тип: " + (bm.biometricType || "-"),
      "доступ: " + (bm.isAccessRequested ? (bm.isAccessGranted ? "да" : "нет") : "не запрашивался"),
      "ключ: " + (bm.isBiometricTokenSaved ? "есть" : "нет"),
      extra || ""
    ].join(" · ");
    diagEl.hidden = false;
  }
  function fail(text, err) {
    clearTimeout(waitTimer);
    say(text);
    diag(err ? String(err.message || err) : "");
    showButton("Повторить", start);
  }
  function showButton(label, fn) {
    btn.textContent = label;
    btn.disabled = false;
    btn.hidden = false;
    btn.onclick = function () { btn.disabled = true; btn.hidden = true; fn(); };
  }

  // Доступ бота к биометрии: если сброшен (переустановка Telegram, выключено в настройках бота) — запросить снова.
  function withAccess(reason, next) {
    if (bm.isAccessGranted) { next(); return; }
    try {
      bm.requestAccess({ reason: reason }, function (granted) {
        if (!granted) {
          fail("Доступ к биометрии не выдан. Разрешите его: меню бота (⋮) → «Биометрия», затем «Повторить».");
          return;
        }
        next();
      });
    } catch (e) { fail("Не удалось запросить доступ к биометрии.", e); }
  }

  function enroll() {
    say("Подключение…");
    withAccess("Подтверждать действия биометрией", function () {
      var secret = hex(crypto.getRandomValues(new Uint8Array(32)));
      try {
        bm.updateBiometricToken(secret, function (ok) {
          if (!ok) { fail("Не удалось сохранить ключ на устройстве."); return; }
          send({ t: "enroll", n: nonce, d: bm.deviceId, k: secret });
        });
      } catch (e) { fail("Не удалось сохранить ключ на устройстве.", e); }
    });
  }

  function confirmAction() {
    say("Приложите палец / посмотрите в камеру…");
    withAccess("Подтверждать действия биометрией", function () {
      clearTimeout(waitTimer);
      waitTimer = setTimeout(function () {
        fail("Окно отпечатка не появилось.", "нет ответа 10 с");
      }, 10000);
      try {
        bm.authenticate({ reason: "Подтвердить действие" }, function (ok, token) {
          clearTimeout(waitTimer);
          if (!ok || !token) { fail("Не подтверждено."); return; }
          crypto.subtle.importKey("raw", utf8(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
            .then(function (key) { return crypto.subtle.sign("HMAC", key, utf8(nonce)); })
            .then(function (sig) { say("Отправка…"); send({ t: "confirm", n: nonce, d: bm.deviceId, h: hex(sig) }); })
            .catch(function (e) { fail("Ошибка подписи.", e); });
        });
      } catch (e) { fail("Не удалось открыть окно отпечатка.", e); }
    });
  }

  function start() {
    if (mode === "e") { enroll(); } else { confirmAction(); }
  }

  try {
    bm.init(function () {
      if (!bm.isBiometricAvailable) { say("На этом устройстве биометрия недоступна или не настроена."); diag(); return; }
      if (mode === "c" && !bm.isBiometricTokenSaved) {
        say("Это устройство не подключено. На ноутбуке: python faceid.py enroll — и подключите его заново.");
        diag(); return;
      }
      if (mode === "e") {
        say("Подключить это устройство?");
        showButton("Подключить", enroll);
        return;
      }
      if (needTap) {
        say("Подтвердить действие?");
        showButton(bm.biometricType === "face" ? "Подтвердить лицом" : "Подтвердить отпечатком", confirmAction);
        return;
      }
      confirmAction();   // iPhone: окно открыто нажатием «🔐 Подтвердить» в чате — Face ID сразу
    });
  } catch (e) { say("Биометрия Telegram недоступна."); diag(String(e.message || e)); }
})();
