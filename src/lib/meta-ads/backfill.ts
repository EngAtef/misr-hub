import type { SupabaseClient } from "@supabase/supabase-js";
import { syncAccount } from "./sync";
import { MetaError } from "./api";
import { RateLimitedError, isBlocked, resetRunCounters } from "./throttle";

/**
 * Drains the ad_sync_jobs queue for as long as the caller's time budget
 * allows. Both the Ads Center button and the twice-daily cron call this; the
 * queue is what makes them safe to run at the same time (claims are
 * `for update skip locked`, so two drainers never take the same month).
 */

export interface BackfillStepResult {
  processed: number;
  done: number;
  failed: number;
  empty: number;
  rows: number;
  spend: number;
  rateLimited: boolean;
  ranOutOfTime: boolean;
  items: {
    account: string;
    period: string;
    status: "done" | "error" | "skipped";
    rows?: number;
    spend?: number;
    error?: string;
  }[];
}

interface ClaimedJob {
  job_id: string;
  job_account_id: string;
  job_account_label: string;
  job_start: string;
  job_end: string;
  job_attempts: number;
}

export async function runBackfillStep(
  db: SupabaseClient,
  token: string,
  opts: { budgetMs: number; maxJobs?: number }
): Promise<BackfillStepResult> {
  resetRunCounters();
  const started = Date.now();
  const out: BackfillStepResult = {
    processed: 0,
    done: 0,
    failed: 0,
    empty: 0,
    rows: 0,
    spend: 0,
    rateLimited: false,
    ranOutOfTime: false,
    items: [],
  };
  const maxJobs = opts.maxJobs ?? 25;

  while (out.processed < maxJobs) {
    // A month has taken up to ~12s on the busiest accounts, so stop claiming
    // once there isn't room for one — a job abandoned mid-flight sits in
    // 'running' for 15 minutes before anyone can pick it up again.
    if (Date.now() - started > opts.budgetMs - 15_000) {
      out.ranOutOfTime = true;
      break;
    }

    const { data, error } = await db.rpc("fn_ads_backfill_claim", { p_limit: 1 });
    if (error) throw new Error(`Claiming a backfill job failed: ${error.message}`);
    const jobs = (data ?? []) as ClaimedJob[];
    if (!jobs.length) break;

    const job = jobs[0];
    const period = `${job.job_start}..${job.job_end}`;

    // an account Meta has already throttled goes back on the queue untouched
    if (isBlocked(job.job_account_id)) {
      await db.rpc("fn_ads_backfill_finish", { p_id: job.job_id, p_status: "pending" });
      out.rateLimited = true;
      break;
    }

    try {
      const r = await syncAccount(
        db,
        token,
        { id: job.job_account_id, label: job.job_account_label },
        job.job_start,
        job.job_end
      );
      // a month with no rows is a real answer — the account simply wasn't
      // running ads then. Marking it 'skipped' stops it being retried forever.
      const status = r.rows > 0 ? "done" : "skipped";
      await db.rpc("fn_ads_backfill_finish", {
        p_id: job.job_id,
        p_status: status,
        p_rows: r.rows,
        p_spend: r.spend,
      });
      out.processed += 1;
      out.rows += r.rows;
      out.spend += r.spend;
      if (status === "done") out.done += 1;
      else out.empty += 1;
      out.items.push({ account: job.job_account_label, period, status, rows: r.rows, spend: r.spend });
    } catch (e) {
      const rateLimited = e instanceof RateLimitedError;
      // Being throttled isn't this month's fault — put it back as pending so
      // the attempt counter doesn't burn down, and stop the run. Meta is
      // explicit that continuing to call while throttled extends the block.
      await db.rpc("fn_ads_backfill_finish", {
        p_id: job.job_id,
        p_status: rateLimited ? "pending" : "error",
        p_error: e instanceof Error ? e.message : "sync failed",
      });
      out.processed += 1;
      if (rateLimited) {
        out.rateLimited = true;
        out.items.push({ account: job.job_account_label, period, status: "skipped", error: e.message });
        break;
      }
      out.failed += 1;
      out.items.push({
        account: job.job_account_label,
        period,
        status: "error",
        error: e instanceof MetaError ? `${e.message}${e.hint ? ` — ${e.hint}` : ""}` : String(e),
      });
    }
  }

  out.spend = Math.round(out.spend * 100) / 100;
  return out;
}
