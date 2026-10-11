import { describe, expect, it } from "vitest";
import {
  mutationSchema,
  meetingInputSchema,
  taskInputSchema,
} from "./contracts";
import { kstDate, kstInstant, kstTime } from "./dates";
const id = "10000000-0000-4000-8000-000000000001";
const task = {
  text: "제안서 검토",
  personId: null,
  date: null,
  time: null,
  done: false,
  type: "general",
  importance: 3,
};
describe("workspace contracts", () => {
  it("allows independent work without inventing a person or date", () => {
    expect(taskInputSchema.parse(task)).toMatchObject({
      personId: null,
      date: null,
    });
    expect(taskInputSchema.safeParse({ ...task, time: "14:30" }).success).toBe(
      false,
    );
  });
  it("rejects invalid calendar dates and ambiguous clocks", () => {
    for (const date of ["2026-02-30", "2026-13-01", "2026-1-2"])
      expect(taskInputSchema.safeParse({ ...task, date }).success).toBe(false);
    expect(
      taskInputSchema.safeParse({ ...task, date: "2026-10-08", time: "25:00" })
        .success,
    ).toBe(false);
  });
  it("preserves unknown dates and converts KST midnight across UTC day boundaries", () => {
    expect(kstInstant(null)).toBeNull();
    expect(kstInstant("2026-10-08")).toBe("2026-10-07T15:00:00.000Z");
    expect(kstDate("2026-10-07T15:00:00Z")).toBe("2026-10-08");
    expect(kstTime(kstInstant("2026-10-08", "23:59"))).toBe("23:59");
  });
  it("does not accept legacy IDs, a client workspace, or arbitrary operations", () => {
    const mutation = {
      requestId: id,
      operations: [
        { type: "task.save", id, version: null, source: "task", value: task },
      ],
    };
    expect(mutationSchema.safeParse(mutation).success).toBe(true);
    expect(
      mutationSchema.safeParse({ ...mutation, workspaceId: id }).success,
    ).toBe(false);
    expect(
      mutationSchema.safeParse({ ...mutation, requestId: `person_${id}` })
        .success,
    ).toBe(false);
    expect(
      mutationSchema.safeParse({
        ...mutation,
        operations: [{ type: "execute_sql" }],
      }).success,
    ).toBe(false);
  });
  it("allows guest-only meetings but requires an explicit participant", () => {
    const meeting = {
      name: "새 만남",
      date: null,
      placeType: "unclassified",
      personIds: [],
      guests: ["게스트"],
      description: "",
      eventUrl: null,
      imageUrl: null,
      imageSourceUrl: null,
    };
    expect(meetingInputSchema.safeParse(meeting).success).toBe(true);
    expect(
      meetingInputSchema.safeParse({ ...meeting, guests: [] }).success,
    ).toBe(false);
    expect(
      meetingInputSchema.safeParse({
        ...meeting,
        imageUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });
});
