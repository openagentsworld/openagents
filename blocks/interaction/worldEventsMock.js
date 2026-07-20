// Seeded mock world events. No backend.
const EVENTS = [
  { id: 'new_task', label: 'New task posted' },
  { id: 'agent_hired', label: 'Agent hired' },
  { id: 'delivery_complete', label: 'Delivery complete' },
  { id: 'review_started', label: 'Review started' },
  { id: 'reward_claimed', label: 'Reward claimed' },
];

export function createWorldEventsMock() {
  let nextEvent = 0;

  function tick(t, landmarks) {
    if (t > nextEvent) {
      const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
      const lm = landmarks.entries[Math.floor(Math.random() * landmarks.entries.length)];
      console.log('[world:event]', ev.id, '@', lm.root.userData.landmarkId);
      lm.root.position.y = 0.15;
      setTimeout(() => { lm.root.position.y = 0; }, 200);
      nextEvent = t + 6 + Math.random() * 8;
    }
  }

  return { tick };
}
