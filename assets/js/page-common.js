/* 带"退出登录"按钮的页面共用：按钮 id 为 logout-btn */
(function () {
  "use strict";
  var btn = document.getElementById("logout-btn");
  if (!btn) return;
  btn.addEventListener("click", function () {
    btn.disabled = true;
    fetch("/api/logout", { method: "POST", credentials: "same-origin", headers: { "X-Requested-With": "apdemo" } })
      .catch(function () { /* 忽略网络错误，仍然回到登录页 */ })
      .then(function () { window.location.href = "/login"; });
  });
})();
