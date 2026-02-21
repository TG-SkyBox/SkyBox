import { convertFileSrc } from "@tauri-apps/api/core";

const URL_PREFIXES = [
  "data:",
  "http://",
  "https://",
  "asset://",
  "tauri://",
  "asset:",
  "blob:",
  "file://",
];

const WINDOWS_PATH_REGEX = /^[a-zA-Z]:[\\/]/;

export const resolveThumbnailSrc = (
  thumbnail?: string | null,
): string | undefined => {
  if (!thumbnail) {
    return undefined;
  }

  const value = thumbnail.trim();
  if (!value) {
    return undefined;
  }

  if (URL_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return value;
  }

  const normalizedPath = value.replace(/\\/g, "/");

  try {
    const converted = convertFileSrc(normalizedPath);
    if (
      converted &&
      converted !== normalizedPath &&
      !WINDOWS_PATH_REGEX.test(converted) &&
      !converted.startsWith("/")
    ) {
      return converted;
    }
  } catch {
    // no-op, handled by fallback below
  }

  const hasTauriInternals =
    typeof window !== "undefined" &&
    typeof window === "object" &&
    "__TAURI_INTERNALS__" in window;

  if (hasTauriInternals) {
    return `http://asset.localhost/${encodeURIComponent(normalizedPath)}`;
  }

  return undefined;
};
