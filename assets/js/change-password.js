(function () {
  "use strict";
  var form = document.getElementById("pw-form");
  var errorBox = document.getElementById("error");
  var submit = document.getElementById("submit");
  function showError(text) { errorBox.textContent = text; errorBox.hidden = false; }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errorBox.hidden = true;
    var oldPw = document.getElementById("old").value;
    var new1 = document.getElementById("new1").value;
    var new2 = document.getElementById("new2").value;
    if (!oldPw) { showError("请输入当前密码。"); return; }
    if (new1.length < 8) { showError("新密码至少需要 8 个字符。"); return; }
    if (new1 !== new2) { showError("两次输入的新密码不一致。"); return; }
    submit.disabled = true;
    fetch("/api/change-password", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "apdemo" },
      body: JSON.stringify({ oldPassword: oldPw, newPassword: new1 })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
    }).then(function (r) {
      if (r.ok) { window.location.href = r.data.redirect || "/"; return; }
      if (r.status === 401) { window.location.href = "/login"; return; }
      showError(r.data.message || "修改失败，请稍后再试。");
      submit.disabled = false;
    }).catch(function () {
      showError("网络出错，请稍后再试。");
      submit.disabled = false;
    });
  });
})();
