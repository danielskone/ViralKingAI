/** Call-to-action lines the creator says at the end of the video, from soft to strong. */
export const CTA_OPTIONS: { value: string; label: string; hint: string; level: "Slight" | "Medium" | "Strong" }[] = [
  { level: "Slight", value: "Link's right below if you want one.", label: "Slight · link's below", hint: "“Link's right below if you want one.”" },
  { level: "Slight", value: "I'll leave the link down there for you.", label: "Slight · I'll leave the link", hint: "“I'll leave the link down there for you.”" },
  { level: "Slight", value: "Honestly, you need one, the link's below.", label: "Slight · you need one", hint: "“Honestly, you need one, the link's below.”" },
  { level: "Medium", value: "Tap the link below and grab yours.", label: "Medium · tap and grab", hint: "“Tap the link below and grab yours.”" },
  { level: "Medium", value: "Seriously, go grab one, the link's right below.", label: "Medium · go grab one", hint: "“Seriously, go grab one, the link's right below.”" },
  { level: "Medium", value: "Trust me, tap the link and get yours.", label: "Medium · trust me", hint: "“Trust me, tap the link and get yours.”" },
  { level: "Strong", value: "Tap the link now before they sell out!", label: "Strong · before they sell out", hint: "“Tap the link now before they sell out!”" },
  { level: "Strong", value: "Run, don't walk, tap the link and grab yours today!", label: "Strong · run, don't walk", hint: "“Run, don't walk, tap the link and grab yours today!”" },
  { level: "Strong", value: "They're going fast, tap the link right now!", label: "Strong · going fast", hint: "“They're going fast, tap the link right now!”" },
];
export const DEFAULT_CTA = "Tap the link below and grab yours.";

/** Only accept one of our lines, so nothing else reaches the script. */
export function ctaFrom(v: FormDataEntryValue | null | undefined): string | null {
  const s = String(v ?? "");
  return CTA_OPTIONS.some((o) => o.value === s) ? s : null;
}
