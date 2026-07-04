import type { AuthConfig, MessageResponse } from "./types";
import { STORAGE_AUTH_KEY } from "./types";

const form = document.getElementById("options-form") as HTMLFormElement;
const emailInput = document.getElementById("email") as HTMLInputElement;
const tokenInput = document.getElementById("apiToken") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const testBtn = document.getElementById("test") as HTMLButtonElement;
const clearBtn = document.getElementById("clear-cache") as HTMLButtonElement;

function setStatus(text: string, kind: "ok" | "err" | "" = ""): void {
  statusEl.textContent = text;
  statusEl.className = kind;
}

async function loadSaved(): Promise<void> {
  const data = await chrome.storage.sync.get(STORAGE_AUTH_KEY);
  const auth = data[STORAGE_AUTH_KEY] as AuthConfig | undefined;
  if (auth?.email) emailInput.value = auth.email;
  if (auth?.apiToken) tokenInput.value = auth.apiToken;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const auth: AuthConfig = {
    email: emailInput.value.trim(),
    apiToken: tokenInput.value.trim(),
  };
  await chrome.storage.sync.set({ [STORAGE_AUTH_KEY]: auth });
  setStatus("Saved. Open your Bitbucket profile to see the chart.", "ok");
});

testBtn.addEventListener("click", async () => {
  setStatus("Testing…");
  const res = (await chrome.runtime.sendMessage({
    action: "testConnection",
    email: emailInput.value.trim(),
    apiToken: tokenInput.value.trim(),
  })) as MessageResponse;

  if ("ok" in res && res.ok && "displayName" in res && res.displayName) {
    setStatus(`Connected as ${res.displayName}.`, "ok");
    return;
  }
  const err =
    "error" in res && typeof res.error === "string" ? res.error : "Connection failed";
  setStatus(err, "err");
});

clearBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ action: "clearCache" });
  setStatus("Contribution cache cleared.", "ok");
});

void loadSaved();
