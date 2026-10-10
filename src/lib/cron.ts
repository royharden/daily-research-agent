// Client-side cron next-run computation (mirrors _shared/deno-utils.ts).
export function nextCronRun(expr: string, after = new Date()): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minF, hourF, domF, monF, dowF] = parts;
  const matchField = (f: string, val: number, max: number): boolean => {
    if (f === "*") return true;
    for (const part of f.split(",")) {
      let step = 1;
      let range = part;
      if (part.includes("/")) {
        const [r, s] = part.split("/");
        range = r;
        step = Number(s) || 1;
      }
      let start = 0;
      let end = max;
      if (range !== "*") {
        if (range.includes("-")) {
          [start, end] = range.split("-").map(Number);
        } else {
          start = Number(range);
          end = range.includes("/") ? max : start;
        }
      }
      for (let v = start; v <= end; v += step) {
        if (v === val) return true;
      }
    }
    return false;
  };
  const d = new Date(after.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 31; i++) {
    if (
      matchField(minF, d.getMinutes(), 59) &&
      matchField(hourF, d.getHours(), 23) &&
      matchField(domF, d.getDate(), 31) &&
      matchField(monF, d.getMonth() + 1, 12) &&
      matchField(dowF, d.getDay(), 6)
    ) {
      return d;
    }
    d.setTime(d.getTime() + 60_000);
  }
  return null;
}
