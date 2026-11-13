export const PURPOSE_LABEL: Record<string, string> = { general: "Group email", renewal_reminder: "Renewal reminder" };

export const sentWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
