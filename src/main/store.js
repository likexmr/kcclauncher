// 영구 설정/계정. electron-store(userData/config.json).
const Store = require("electron-store");

const store = new Store({
  name: "config",
  defaults: {
    site: "https://korcomclient.xyz",
    azureClientId: "", // 비면 client-id.js 기본값. KCC_AZURE_CLIENT_ID 로 덮어쓰기 가능
    ramMb: 2048,
    javaPath: "", // 비면 관리형 자바 8 자동
    gameDir: "", // 비면 기본 인스턴스
    closeOnLaunch: false,
    accounts: [], // [{type,name,uuid,accessToken,msRefresh,obtained}]
    selectedUuid: "",
    installedBuild: 0,
  },
});

function accounts() { return store.get("accounts") || []; }
function selected() { return accounts().find((a) => a.uuid === store.get("selectedUuid")) || accounts()[0] || null; }

function upsertAccount(acc) {
  const list = accounts().filter((a) => a.uuid !== acc.uuid);
  list.push(acc);
  store.set("accounts", list);
  store.set("selectedUuid", acc.uuid);
}

function removeAccount(uuid) {
  const list = accounts().filter((a) => a.uuid !== uuid);
  store.set("accounts", list);
  if (store.get("selectedUuid") === uuid) store.set("selectedUuid", list[0] ? list[0].uuid : "");
}

module.exports = { store, accounts, selected, upsertAccount, removeAccount };
