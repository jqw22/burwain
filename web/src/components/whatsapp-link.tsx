// A "WhatsApp" button that opens a chat with a UK (or international) mobile number
// using WhatsApp's free click-to-chat link (wa.me). Nothing is sent by the app.

/** Turns a mobile number as typed (e.g. "07700 900123" or "+44 7700 900123") into wa.me digits ("447700900123"). */
export function whatsappNumber(mobile: string | null | undefined): string | null {
  if (!mobile) return null;
  const trimmed = mobile.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = "44" + digits.slice(1); // UK number
  }
  if (digits.startsWith("440")) digits = "44" + digits.slice(3); // "+44 (0)7700…"
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function WhatsAppLink({ mobile, name }: { mobile: string | null | undefined; name?: string }) {
  const number = whatsappNumber(mobile);
  if (!number) return null;
  return (
    <a
      href={`https://wa.me/${number}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={name ? `WhatsApp ${name}` : "WhatsApp"}
      className="ml-2 inline-block rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700"
    >
      WhatsApp
    </a>
  );
}
