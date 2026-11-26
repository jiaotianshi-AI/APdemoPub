(function () {
  "use strict";
  var form = document.getElementById("login-form");
  var errorBox = document.getElementById("error");
  var submit = document.getElementById("submit");

  function showError(text) { errorBox.textContent = text; errorBox.hidden = false; }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errorBox.hidden = true;
    var username = document.getElementById("username").value;
    var password = document.getElementById("password").value;
    if (!username.trim() || !password) { showError("请输入账号名和密码。"); return; }
    submit.disabled = true;
    fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "apdemo" },
      body: JSON.stringify({ username: username, password: password })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      if (r.ok) { window.location.href = r.data.redirect || "/"; return; }
      showError(r.data.message || "登录失败，请稍后再试。");
      submit.disabled = false;
    }).catch(function () {
      showError("网络出错，请稍后再试。");
      submit.disabled = false;
    });
  });
})();
