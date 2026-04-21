import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3333),

  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_USER: z.string().min(1).default("postgres"),
  DB_PASSWORD: z.string().default("postgres"),
  DB_NAME: z.string().min(1).default("mimiciv"),

  DB_MAX: z.coerce.number().int().positive().default(10),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().min(1).default("openai/gpt-oss-120b:free"),
  OPENROUTER_JUDGE_MODEL: z.string().min(1).optional(),
  /**
   * Optional separate OpenRouter key used only for the LLM-as-Judge.
   * Useful to sidestep per-key rate limits when agent+judge share a model,
   * or to let the judge run on a different account/plan.
   */
  OPENROUTER_API_KEY_JUDGE: z.string().min(1).optional(),

  /**
   * Minimum delay (ms) enforced between consecutive LLM calls on the same
   * API key. 0 = no throttling. A value like 3000–4000 keeps us under the
   * ~20 req/min free-tier ceiling. The --delay CLI flag overrides this.
   */
  OPENROUTER_REQUEST_DELAY_MS: z.coerce.number().int().nonnegative().default(0),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);

