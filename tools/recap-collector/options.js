/**
 * options.js — where the address and the connection code live.
 *
 * Saving also asks Chrome for permission to talk to the VAM OS address. That
 * permission is requested at this moment, from a click, because Chrome only
 * grants optional permissions in response to one — and asking for "any site"
 * up front is a bigger ask than this tool deserves.
 */

const $ = (id) => document.getElementById(id);

function setStatus(message, tone) {
  $("status").textContent = message;
  $("status").className = tone ?? "";
}

async function load() {
  const stored = await chrome.storage.sync.get(["appUrl", "token", "groups"]);
  $("appUrl").value = stored.appUrl ?? "";
  $("token").value = stored.token ?? "";
  $("groups").value = stored.groups ?? "";
}

$("save").addEventListener("click", async () => {
  const appUrl = $("appUrl").value.trim().replace(/\/+$/, "");
  const token = $("token").value.trim();
  const groups = $("groups").value.trim();

  if (!/^https:\/\/[^\s/]+/.test(appUrl)) {
    setStatus("Địa chỉ phải bắt đầu bằng https://", "error");
    return;
  }
  if (!token) {
    setStatus("Chưa nhập mã kết nối.", "error");
    return;
  }

  const origin = `${new URL(appUrl).origin}/*`;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    setStatus("Chrome chưa cho phép gửi tới địa chỉ này. Bấm Lưu lại và chọn “Cho phép”.", "error");
    return;
  }

  await chrome.storage.sync.set({ appUrl, token, groups });
  setStatus("Đã lưu. Mở group Facebook rồi bấm biểu tượng tiện ích để bắt đầu.", "ok");
});

load();
