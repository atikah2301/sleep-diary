const SECTIONS = [
  {
    title: "Falling asleep & winding down",
    open: true,
    items: [
      "Start a wind-down routine 30–60 minutes before bed — dim the lights, and switch to a low-key activity like reading or stretching.",
      "Cut screens (phone, TV, laptop) at least 30 minutes before bed. Blue light and stimulating content both delay sleep.",
      "If you can't fall asleep within about 20 minutes, get up and do something calm in dim light, then return to bed once you feel sleepy. Lying there frustrated trains your brain to associate bed with wakefulness.",
      "Try a breathing exercise (e.g. 4 seconds in, 6–8 seconds out) or a body scan to settle a racing mind.",
      "If worries keep surfacing, keep a notepad by the bed and jot them down to deal with tomorrow — or set aside 10 minutes earlier in the evening as dedicated \"worry time\" so it doesn't spill into bed.",
      "Avoid clock-watching. Turn the display away or cover it — checking the time increases anxiety about not sleeping.",
      "Being awake for 10–15 minutes after getting into bed before you drift off is completely normal. Bed time and sleep time aren't the same thing.",
    ],
  },
  {
    title: "Waking up feeling fresh",
    items: [
      "Get outside for 10–30 minutes of natural sunlight soon after waking — it's one of the strongest cues for resetting your body clock.",
      "Drink a glass of water shortly after waking to rehydrate after hours without fluids.",
      "Avoid hitting snooze repeatedly — the extra fragmented sleep it gives you is low quality and can leave you groggier.",
      "Get moving early, even briefly (a short walk or stretch) — light activity helps shift you out of sleep inertia faster than staying still.",
    ],
  },
  {
    title: "Setting a bed time & wake time",
    items: [
      "Aim to wake up at roughly the same time every day, ideally within a 30–60 minute window — even on weekends. A consistent wake time is the anchor for your body clock.",
      "Work backwards from your wake time to set a bed time, using your usual sleep duration — then build in a buffer before that for winding down, since falling asleep isn't instant.",
      "Keep bed time consistent too, but expect some natural night-to-night variation in how long it takes you to actually fall asleep.",
      "If you're adjusting your schedule, shift gradually (15–30 minutes every few days) rather than jumping straight to a new time.",
    ],
  },
  {
    title: "Your sleep environment",
    items: [
      "Keep the room cool — around 16–19°C is generally ideal for most people.",
      "Make it as dark as possible. Blackout curtains or an eye mask help block streetlight and early sunrise.",
      "Reduce noise where you can, or mask it consistently with a fan or white noise rather than letting it be unpredictable.",
      "Reserve the bed for sleep (and rest) — avoid working or scrolling from bed so your brain keeps a strong association between bed and sleep.",
      "A comfortable, supportive mattress and pillow matter more than most people budget for — discomfort is a common hidden cause of restless nights.",
    ],
  },
  {
    title: "Daytime habits that support sleep",
    items: [
      "Cut caffeine by early-to-mid afternoon — it has a longer half-life than most people expect and can still affect sleep onset at night.",
      "Get some exercise during the day, but avoid intense workouts in the couple of hours right before bed.",
      "Keep naps short (20–30 minutes) and earlier in the day — long or late naps eat into your night-time sleep drive.",
      "Go easy on alcohol before bed — it can help you fall asleep faster but fragments sleep and reduces quality later in the night.",
    ],
  },
];

function renderSection(section) {
  const items = section.items.map((item) => `<li>${item}</li>`).join("");
  return `
    <details class="card tips-section" ${section.open ? "open" : ""}>
      <summary>${section.title}</summary>
      <ul class="tips-list">${items}</ul>
    </details>
  `;
}

export function initTipsView(container) {
  container.innerHTML = `
    <p class="hint">General sleep hygiene tips. Not medical advice — if sleep problems persist, it's worth talking to a doctor.</p>
    ${SECTIONS.map(renderSection).join("")}
  `;
}
