/**
 * /api/factory/generate 대기열 폴링 — API2(2026-10-15).
 * 서버는 생성하지 않고 ai_jobs 에 넣은 뒤 202 { job_id } 를 돌려준다. 생성은 로컬 PC 러너(scripts/ai_job_runner.py)가 한다.
 * 여기서 /api/factory/jobs/<id> 를 폴링해 종전 응답과 같은 { status, json } 을 돌려준다
 * (json = 종전 응답 본문 · status = 종전 HTTP 상태).
 * 기다려도 queued 그대로면(PC 꺼짐) 503 + queued:true — 작업은 대기열에 남아 PC 가 켜지면 생성된다.
 */
const POLL_MS = 5_000;
const WAIT_MS = Number(process.env.FACTORY_JOB_WAIT_MS ?? 25 * 60_000);

/** @returns {Promise<{status:number, json:any}|null>} 202 대기열 응답이 아니면 null(호출자가 종전대로 처리) */
export async function waitFactoryJob(siteUrl, secret, res, json, { pollMs = POLL_MS, waitMs = WAIT_MS, fetchImpl = fetch } = {}) {
  if (res.status !== 202 || !json?.job_id) return null;
  const id = json.job_id;
  const started = Date.now();
  let last = null;
  while (Date.now() - started < waitMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    try {
      const r = await fetchImpl(`${siteUrl}/api/factory/jobs/${id}`, {
        headers: { "x-factory-secret": secret },
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) continue;
      last = await r.json();
    } catch {
      continue; // 폴링 일시 실패는 다음 회차에
    }
    if (last.status === "done" || last.status === "error") {
      const status = last.result_status ?? (last.status === "done" ? 200 : 500);
      return { status, json: last.result ?? { error: last.error ?? "생성 실패" } };
    }
  }
  const state = last?.status ?? "queued";
  return {
    status: 503,
    json: {
      error:
        state === "running"
          ? `로컬 PC 생성이 ${Math.round(waitMs / 60000)}분 안에 끝나지 않음 — 작업은 계속(job ${id})`
          : `로컬 PC 꺼짐 — 대기열에 남음(job ${id})`,
      queued: true,
      job_id: id,
    },
  };
}
