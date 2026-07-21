export const extractFunctionErrorMessage = async (error: unknown) => {
  const fallback = error instanceof Error ? error.message : "操作失败";
  const context = (error as { context?: unknown } | null)?.context;

  if (context && typeof (context as Response).clone === "function") {
    try {
      const cloned = (context as Response).clone();
      const body = await cloned.json();
      const message = body?.error ?? body?.message ?? body?.detail;
      if (message) return String(message);
    } catch {
      // Fall through to text parsing.
    }
  }

  if (context && typeof (context as Response).clone === "function") {
    try {
      const text = await (context as Response).clone().text();
      if (text) return text;
    } catch {
      // Keep the original SDK error message if the response body is unavailable.
    }
  }

  return fallback;
};
