#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
네이버 먼저 승인된 글(naver_only)에 **본진판만** 채운다 — 네이버 칸은 한 글자도 건드리지 않는다 (MN1b, 2026-10-15).

    python scripts/main_fill.py <meta_main.json> <main.md>            # 검사만(드라이런, 쓰기 0)
    python scripts/main_fill.py <meta_main.json> <main.md> --apply    # 검사 통과 시 premium_articles 본진 칸 PATCH

meta_main.json: slug · title(본진 제목) · summary · key_points[] · faq_json[] (+ verify_claims_append[] — 기존 근거 뒤에 덧붙임)

쓰는 칸(ALLOWED)만 쓴다: title · summary · key_points · faq_json · main_website_markdown · verify_claims(덧붙임만).
  naver_title · naver_blog_content · raw_source_name(네이버 키트 해시 재료)·발행 플래그는 쓰지 않는다.
막는 경우: 본진이 이미 접수·승인·발행됨 · 본진 원고가 이미 있음 · 네이버 원고와 겹치는 문장 · 게이트 실패
  (금소법 rules_finance_gate · 금지어 A · WRITING-SPEC · 분량 · 제목 각도 · 실손 자기부담금 문구).
쓰고 나서 네이버 키트 해시(pams_kit.content_hash naver)가 그대로인지 다시 읽어 확인한다.

왜: draft_insert.py 는 새 행만 넣는다. 네이버 단독 글의 본진판은 같은 행(같은 slug·같은 본진 URL)에 채운다(관제탑 MN1b).
    MCP SQL·REST 수작업으로 넣으면 이 검사를 건너뛴다.
"""
import argparse
import json
import os
import sys

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import draft_weekly as dw  # noqa: E402
import pams_kit as kit  # noqa: E402
import preflight  # noqa: E402

ALLOWED = ("title", "summary", "key_points", "faq_json", "main_website_markdown", "verify_claims")
META_KEYS = ("slug", "title", "summary", "key_points", "faq_json")
COLS = ("id,slug,title,naver_title,category,summary,key_points,faq_json,verify_claims,main_website_markdown,"
        "naver_blog_content,raw_source_name,raw_source_url,is_main_published,is_naver_published,"
        "ad_reviews(channel,status,review_no)")


def build_patch(article, meta, main_md, replace=False):
    """→ 본진 칸 PATCH dict(순수 함수). 막아야 하면 KitError."""
    miss = [k for k in META_KEYS if not meta.get(k)]
    if miss:
        raise kit.KitError("meta 에 빠진 값: " + ", ".join(miss))
    if meta["slug"] != article.get("slug"):
        raise kit.KitError(f"slug 불일치 — meta {meta['slug']} / DB {article.get('slug')}")
    if kit.channel_locked(article, "main") or article.get("is_main_published"):
        raise kit.KitError("본진이 이미 접수·승인·발행됨 — 원안 변경 불가")
    if (article.get("main_website_markdown") or "").strip() and not replace:
        raise kit.KitError("본진 원고가 이미 있다 — 덮어쓰려면 --replace (원고 확인 뒤에만)")
    main = (main_md or "").strip()
    if not main:
        raise kit.KitError("본진 원고가 비었다")
    have = list(article.get("verify_claims") or [])
    seen = {(c.get("claim"), c.get("basis")) for c in have}
    add = [c for c in meta.get("verify_claims_append") or [] if (c.get("claim"), c.get("basis")) not in seen]
    patch = {"title": meta["title"].strip(), "summary": meta["summary"].strip(), "key_points": meta["key_points"],
             "faq_json": meta["faq_json"], "main_website_markdown": main}
    if add:
        patch["verify_claims"] = have + add
    bad = [k for k in patch if k not in ALLOWED]
    if bad:
        raise kit.KitError("허용 밖 칸: " + ", ".join(bad))
    return patch


def overlap_with_naver(main_md, naver):
    """본진 문장 중 네이버 원고와 겹치는 문장(draft_weekly.overlap 같은 규칙) → (겹침 목록, 문장 수, 8자 조각 공유율)."""
    notices = preflight.parse_required_notices() + [preflight.parse_actual_loss_notice()[0]]
    cfg = dw.load_topics()
    for v in (cfg.get("notices") or {}).values():
        notices += list(v)
    exempt = notices + dw.canonical_lines(main_md)
    corpus = dw.build_corpus([("naver", naver or "")])
    hits = dw.overlap(main_md, corpus, exempt)
    sents = [s for s in dw.sentences(main_md) if len(dw._norm(s)) >= 20]
    grams = set()
    for s in sents:
        grams |= dw.shingles(s)
    shared = len([g for g in grams if g in corpus[0]]) / len(grams) if grams else 0.0
    return hits, len(sents), shared


def gates(article, patch):
    """→ [(이름, 통과, 내용)]. 본진 칸을 채운 뒤의 모습으로 잰다."""
    merged = {**article, **patch}
    out = []
    notice, rx = preflight.parse_actual_loss_notice()
    cfg = dw.load_topics()
    silson = bool(rx.search(merged["title"] + " " + merged["main_website_markdown"]))
    notices = list(cfg["notices"].get("silsonGeneration", [])) if silson else []
    fin = dw.finance_gate({"title": merged["title"], "naver_title": "", "main": merged["main_website_markdown"],
                           "naver": ""}, {"category": "실손"}, notices, preflight.parse_required_notices())
    fin = [i for i in fin if "(네이버)" not in i["reason"] and not i["reason"].startswith("네이버 ")]
    out.append(("금소법 게이트(rules_finance_gate)", not fin, " / ".join(f"{i['reason']} → {i['sentence'][:40]}" for i in fin) or "통과"))
    ok, d = preflight.check_banned({"title": merged["title"], "main_website_markdown": merged["main_website_markdown"]})
    out.append(("금지어 §6.10(본진)", ok, d))
    out.append(("실손 자기부담금", (not silson) or notice in merged["main_website_markdown"], notice if silson else "해당 없음"))
    out += [("WRITING-SPEC", *preflight.check_writing_spec(merged)), ("분량", *preflight.check_length(merged)),
            ("제목 각도", *preflight.check_title_variation(merged))]
    hits, n, shared = overlap_with_naver(merged["main_website_markdown"], article.get("naver_blog_content"))
    out.append(("네이버와 문장 겹침", not hits,
                f"본진 문장 {n} · 겹침 {len(hits)} ({len(hits) / max(1, n):.1%}) · 8자 조각 공유율 {shared:.1%}"
                + "".join(f"\n      {h['ratio']} {h['sentence'][:70]}" for h in hits)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("meta")
    ap.add_argument("main_md")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--replace", action="store_true")
    a = ap.parse_args()
    env = kit.load_env()
    meta = json.load(open(a.meta, encoding="utf-8"))
    url, h = kit._rest(env)
    r = requests.get(url, params={"slug": f"eq.{meta.get('slug')}", "select": COLS, "limit": "1"}, headers=h, timeout=30)
    if r.status_code != 200 or not r.json():
        print(f"기사를 찾지 못했다 — {meta.get('slug')} ({r.status_code})")
        sys.exit(1)
    art = r.json()[0]
    try:
        patch = build_patch(art, meta, open(a.main_md, encoding="utf-8").read(), a.replace)
    except kit.KitError as e:
        print(f"⛔ {e}")
        sys.exit(1)
    results = gates(art, patch)
    for name, ok, d in results:
        print(f"  [{name}] {'통과' if ok else '실패'} — {d}")
    before = kit.content_hash(art, "naver")
    print(f"  쓰는 칸: {', '.join(patch)} · 네이버 키트 해시 {before[:12]}…")
    if not all(ok for _, ok, _ in results):
        print("결과: 실패 — 쓰지 않았다")
        sys.exit(1)
    if not a.apply:
        print("(드라이런 — --apply 를 붙이면 본진 칸만 저장)")
        return
    w = requests.patch(url, params={"id": f"eq.{art['id']}"}, json=patch,
                       headers={**h, "Content-Type": "application/json", "Prefer": "return=minimal"}, timeout=30)
    if w.status_code not in (200, 204):
        print(f"저장 실패 {w.status_code} {w.text[:200]}")
        sys.exit(1)
    after = requests.get(url, params={"id": f"eq.{art['id']}", "select": COLS}, headers=h, timeout=30).json()[0]
    same = kit.content_hash(after, "naver") == before and after.get("naver_title") == art.get("naver_title")
    print(f"저장: {art['id']} · 네이버 해시 {'그대로' if same else '🔴 바뀜'} · is_main_published={after.get('is_main_published')}")
    sys.exit(0 if same else 2)


if __name__ == "__main__":
    main()
