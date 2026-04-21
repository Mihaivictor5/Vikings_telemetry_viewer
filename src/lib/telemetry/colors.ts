export const CHANNEL_COLORS = [
  "hsl(var(--chan-1))",
  "hsl(var(--chan-2))",
  "hsl(var(--chan-3))",
  "hsl(var(--chan-4))",
  "hsl(var(--chan-5))",
  "hsl(var(--chan-6))",
  "hsl(var(--chan-7))",
  "hsl(var(--chan-8))",
];

export function colorForIndex(i: number): string {
  return CHANNEL_COLORS[i % CHANNEL_COLORS.length];
}
