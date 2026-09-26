// One color per day for pins and routes. Picked to stay readable on aerial imagery.
const palette = ['#2f6fed', '#e0663a', '#16a085', '#b04ad6', '#d4a012', '#d6456f', '#3a9fd6']

export function dayColor(dayIndex: number): string {
  return palette[dayIndex % palette.length] ?? '#2f6fed'
}
