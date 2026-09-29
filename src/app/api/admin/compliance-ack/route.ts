import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { checkArticleById } from "@/lib/compliance/server";
import type { ComplianceAck } from "@/lib/compliance/banned-terms";
import { allClaimsHavePages, claimsMissingPages } from "@/lib/compliance/verify-pages";

/**
 * B등급 금지표현 '확인함' 토글 — compliance_acks(jsonb)에 (field,term,offset) 이력을 기록/삭제.
 * 저장 후 서버에서 다시 검사해 최신 판정을 돌려준다(클라이언트가 배지·게이트를 갱신).
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if ((body as { bulk?: boolean }).bulk === true) {
    return bulkAck(String((body as { articleId?: string }).articleId ?? ""));
  }
  const { articleId, field, term, offset, checked } = body as {
    articleId?: string;
    field?: string;
    term?: string;
    offset?: number;
    checked?: boolean;
  };
  if (!articleId || !field || !term || typeof offset !== "number") {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: row, error: readErr } = await supabase
    .from("premium_articles")
    .select("compliance_acks")
    .eq("id", articleId)
    .maybeSingle();
  if (readErr || !row) {
    return NextResponse.json({ error: "기사를 찾을 수 없습니다" }, { status: 404 });
  }

  const acks: ComplianceAck[] = Array.isArray(row.compliance_acks) ? row.compliance_acks : [];
  const same = (a: ComplianceAck) => a.field === field && a.term === term && a.offset === offset;
  let next: ComplianceAck[];
  if (checked) {
    next = acks.some(same)
      ? acks
      : [...acks, { field, term, offset, ackedAt: new Date().toISOString() }];
  } else {
    next = acks.filter((a) => !same(a));
  }

  const { error: writeErr } = await supabase
    .from("premium_articles")
    .update({ compliance_acks: next })
    .eq("id", articleId);
  if (writeErr) {
    console.error("compliance-ack write error:", writeErr);
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }

  const result = await checkArticleById(articleId);
  return NextResponse.json({ success: true, result });
}

/**
 * 「근거 대조 완료 — 전체 확인」 — 남은 B등급을 한꺼번에 확인 처리한다.
 * - verify_claims 전 항목에 원문 쪽수가 있어야 한다(서버에서도 다시 본다 — 버튼 비활성만 믿지 않는다).
 * - A등급은 건드리지 않는다. ack 는 B등급만 대조되므로 A가 남으면 판정은 계속 block 이다.
 * - 누른 시각은 각 ack 의 ackedAt(같은 시각)과 bulk:true 로 남는다.
 */
async function bulkAck(articleId: string) {
  if (!articleId) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  const supabase = createAdminClient();
  const { data: row, error: readErr } = await supabase
    .from("premium_articles")
    .select("compliance_acks, verify_claims")
    .eq("id", articleId)
    .maybeSingle();
  if (readErr || !row) {
    return NextResponse.json({ error: "기사를 찾을 수 없습니다" }, { status: 404 });
  }
  if (!allClaimsHavePages(row.verify_claims)) {
    const n = claimsMissingPages(row.verify_claims);
    return NextResponse.json(
      { error: `근거 쪽수가 없는 항목이 ${n || "전부"}건 있습니다 — verify_claims 에 원문 쪽수를 적은 뒤 누르세요` },
      { status: 409 }
    );
  }

  const before = await checkArticleById(articleId);
  if (!before) return NextResponse.json({ error: "검사 실패" }, { status: 500 });
  const pending = before.findings.filter((f) => f.grade === "B" && !f.acked);
  const acks: ComplianceAck[] = Array.isArray(row.compliance_acks) ? row.compliance_acks : [];
  const at = new Date().toISOString();
  const next = [
    ...acks,
    ...pending.map((f) => ({ field: f.field, term: f.term, offset: f.offset, ackedAt: at, bulk: true })),
  ];

  if (pending.length) {
    const { error: writeErr } = await supabase
      .from("premium_articles")
      .update({ compliance_acks: next })
      .eq("id", articleId);
    if (writeErr) {
      console.error("compliance-ack bulk write error:", writeErr);
      return NextResponse.json({ error: "저장 실패" }, { status: 500 });
    }
  }

  const result = await checkArticleById(articleId);
  return NextResponse.json({ success: true, result, acked: pending.length, ackedAt: at });
}
