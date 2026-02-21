import { invoke } from "@tauri-apps/api/core";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function log(cmd: string, message: string, context?: any) {
  console.log(`[${cmd}]`, message, context ?? "");

  if (!isTauri()) return;

  try {
    await invoke(cmd, { message });
  } catch {}
}

export const logger = {
  debug: (message: string, context?: any) => log("log_debug", message),
  info: (message: string, context?: any) => log("log_info", message),
  warn: (message: string, context?: any) => log("log_warn", message),
  error: (message: string, context?: any) => log("log_error", message),
};
