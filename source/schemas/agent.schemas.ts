import z from "zod";

export const summaryChunkSchema = z.object({
  from: z.number(),
  to: z.number(),
  content: z.string(),
});

export type SummaryChunkInput = z.input<typeof summaryChunkSchema>;
export type SummaryChunkOutput = z.output<typeof summaryChunkSchema>;
