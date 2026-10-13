// Epoch milliseconds identify one instant; calendar boundaries use the viewer's timezone.
export function localChatDay(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function chatDayLabel(timestamp: number, now: number, today: string, yesterday: string): string {
  if (localChatDay(timestamp) === localChatDay(now)) return today;
  const previous = new Date(now);
  previous.setDate(previous.getDate() - 1);
  if (localChatDay(timestamp) === localChatDay(previous.getTime())) return yesterday;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function localChatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
}
