const DAY = 24 * 60 * 60 * 1000;

const LADDER = [0, 1, 3, 7, 16, 40, 90, 200, 400].map((days) => days * DAY);

export const RELEARN = 10 * 60 * 1000;

export type Schedule = {
  box: number;
  due_at: number;
  lapses: number;
  reps: number;
};

export function nextSchedule(schedule: Schedule, known: boolean, now: number): Schedule {
  if (!known) {
    return {
      box: 0,
      due_at: now + RELEARN,
      lapses: schedule.lapses + 1,
      reps: schedule.reps,
    };
  }
  const box = Math.min(Math.max(schedule.box, 0) + 1, LADDER.length - 1);
  return {
    box,
    due_at: now + LADDER[box],
    lapses: schedule.lapses,
    reps: schedule.reps + 1,
  };
}
