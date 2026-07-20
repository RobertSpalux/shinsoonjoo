import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { checkArticleById } from "@/lib/compliance/server";
import type { ComplianceAck } from "@/lib/compliance/banned-terms";

/**
 * B등급 금지표현 '확인함' 토글 — compliance_acks(jsonb)에 (field,term,offset) 이력을 기록/삭제.
 * 저장 후 서버에서 다시 검사해 최신 판정을 돌려준다(클라이언트가 배지·게이트를 갱신).
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
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
