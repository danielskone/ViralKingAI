/**
 * Ready-made UGC ad scripts (also kept in Daniel's "UGC Scripts" doc). Each spoken line is in quotes,
 * so the worker uses it word for word, and is 8 words or fewer, so each scene is 5 seconds.
 * `caption` stays on screen for the whole video (a call to action like "Comment LINK").
 */
export type UgcScript = { label: string; hint: string; scenes: number; text: string; caption?: { title: string; sub: string } };

const SHOT_END = "Bright cozy home, soft window light, handheld phone-style UGC shot.";
const two = (hook: string, cta: string) =>
  `Scene 1: the person holds the product up beside their face with an excited smile and says "${hook}" ` +
  `Scene 2: they show the product up close to the camera, then point down toward the link and say "${cta}" ${SHOT_END}`;

const SELFIE_END = "Bright bathroom vanity, soft natural window light, arm's-length selfie phone shot, real UGC creator look.";
const three = (hook: string, demo: string, cta: string) =>
  `Scene 1: the person holds the product up beside their face, wide-eyed and excited, and says "${hook}" ` +
  `Scene 2: they use the product close to the camera, showing how it works, and say "${demo}" ` +
  `Scene 3: they step back, smile, hold the product up and say "${cta}" ${SELFIE_END}`;

export const UGC_SCRIPTS: UgcScript[] = [
  { label: "Skincare routine", hint: "15 s · 3 scenes · hook, demo, payoff", scenes: 3,
    text: three("Okay, this is my new holy grail!", "Look how smooth my skin feels already!", "Tap the link below and grab yours!") },
  { label: "Pore pad review", hint: "15 s · 3 scenes · hook, demo, payoff", scenes: 3,
    text: three("My pores have never looked this small!", "Just one swipe every single night.", "Seriously, get these, the link is below!") },
  { label: "Honest first impression", hint: "15 s · 3 scenes · any product", scenes: 3,
    text: three("Okay, I was not expecting this!", "Look at this, it's honestly so good.", "Trust me, grab yours at the link!") },
  {
    label: "Comment to get the link", hint: "5 s · “Comment LINK” on screen", scenes: 1,
    caption: { title: "Comment LINK", sub: "and I will DM you the link" },
    text: "One 5-second shot: in a bright living room with a decorated Christmas tree behind them, the person holds the product at chest height, looks straight into the camera with an excited, wide-eyed smile and says \"Comment LINK and I'll DM you the link!\" Handheld phone-style UGC shot, soft daylight.",
  },
  { label: "Black Friday deal", hint: "10 s · 2 scenes", scenes: 2, text: two("Okay, this is seriously my best find ever!", "Black Friday deal, grab yours at the link!") },
  { label: "Sale is live", hint: "10 s · 2 scenes", scenes: 2, text: two("Okay, I'm obsessed with this, look at it!", "Black Friday sale is live, link below!") },
  { label: "Stocking stuffer", hint: "10 s · 2 scenes", scenes: 2, text: two("Best stocking stuffer of the season, honestly!", "Save big this Black Friday, link below!") },
  { label: "Bestseller", hint: "10 s · 2 scenes", scenes: 2, text: two("Okay, this is the number one bestseller!", "The Black Friday deal ends soon, tap below!") },
  { label: "Perfect gift", hint: "10 s · 2 scenes", scenes: 2, text: two("The perfect gift for literally everyone, look!", "Black Friday special, tap the link below!") },
  { label: "Can't believe the price", hint: "10 s · 2 scenes", scenes: 2, text: two("I can't believe how cheap this is!", "Black Friday price, tap the link right now!") },
  { label: "Christmas party", hint: "10 s · 2 scenes", scenes: 2, text: two("This is perfect for my Christmas party!", "Tap the link below and grab yours!") },
];

/** Keep the on-screen caption short and plain. */
export function captionFrom(title: FormDataEntryValue | null, sub: FormDataEntryValue | null) {
  const t = String(title ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const s = String(sub ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return t ? { caption_title: t, caption_sub: s || null } : { caption_title: null, caption_sub: null };
}
