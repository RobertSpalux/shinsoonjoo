#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""커버 변주 4종 — 피드 격자에서 서로 구분되게"""
from PIL import Image, ImageDraw, ImageFont
import os, math

W, H = 1080, 1350
OUT = "/home/claude/work/cover_out"

CREAM = "#faf9f6"; CREAM_SOFT = "#f3efe7"; LINE = "#e8e2d6"
STRONG = "#221e18"; BODY = "#48423a"; MUTED = "#6b6457"
FOREST = "#1b3a30"; FOREST_ROW = "#24493d"; FOREST_DEEP = "#12291f"
GOLD = "#a8842c"; GOLD_LT = "#c9a441"; ON_DARK = "#a9bfb5"
CLAY = "#7a3b2e"       # 보조 액센트(따뜻한 벽돌) — 커버 변주용
CLAY_LT = "#c2705c"

FD = "/usr/share/fonts/opentype/noto"
def kr(p):
    for i in range(12):
        try:
            f = ImageFont.truetype(p, 20, index=i)
            if "KR" in " ".join(f.getname()): return i
        except Exception: break
    return 0
S = {k: f"{FD}/NotoSansCJK-{v}.ttc" for k, v in
     {"black":"Black","bold":"Bold","medium":"Medium","regular":"Regular"}.items()}
_I = {p: kr(p) for p in S.values()}
def sans(w,s): return ImageFont.truetype(S[w], s, index=_I[S[w]])
def tw(d,s,f):
    b=d.textbbox((0,0),s,font=f); return b[2]-b[0]

PAD = 84

def footer(d, dark, nav="→ 넘겨보기"):
    f=sans("bold",28); fs=sans("regular",26); y=H-78
    d.text((PAD,y),"신순주의 선한 금융",font=f,fill=CREAM if dark else STRONG)
    bw=tw(d,"신순주의 선한 금융",f)
    d.text((PAD+bw+16,y+2),"· goodfinance.kr",font=fs,fill=ON_DARK if dark else MUTED)
    nf=sans("bold",29)
    d.text((W-PAD-tw(d,nav,nf),y),nav,font=nf,fill=GOLD_LT if dark else GOLD)

def toprule(d,color=GOLD):
    d.rectangle([(0,0),(W,9)],fill=color)

def overline(d,text,dark,color=GOLD):
    f=sans("bold",30)
    d.line([(PAD,PAD+16),(PAD+44,PAD+16)],fill=color,width=3)
    d.text((PAD+62,PAD),text,font=f,fill=ON_DARK if dark else MUTED)


# ── A. 숫자형 (딥그린) — 통계·금액이 주인공
def cover_A():
    img=Image.new("RGB",(W,H),FOREST); d=ImageDraw.Draw(img)
    toprule(d); overline(d,"2026년 7월 · 실손보험",True)
    d.text((PAD,300),"도수치료 1회",font=sans("bold",34),fill=ON_DARK)
    fn=sans("black",168); d.text((PAD-6,350),"43,850",font=fn,fill=GOLD_LT)
    d.text((PAD+tw(d,"43,850",fn)+14,440),"원",font=sans("black",74),fill=CREAM)
    ft=sans("black",84)
    for i,l in enumerate(["도수치료,","7월부터","이렇게 바뀝니다"]):
        d.text((PAD,590+i*106),l,font=ft,fill=CREAM)
    fs=sans("medium",36)
    d.text((PAD,940),"가격 · 횟수 · 시작 조건까지",font=fs,fill=ON_DARK)
    footer(d,True); return img


# ── B. 질문형 (크림) — 궁금증이 주인공
def cover_B():
    img=Image.new("RGB",(W,H),CREAM); d=ImageDraw.Draw(img)
    toprule(d); overline(d,"실손보험 주의",False)
    ft=sans("black",96)
    d.text((PAD,330),"해지하면",font=ft,fill=STRONG)
    d.text((PAD,450),"환급 못 받을",font=ft,fill=GOLD)
    d.text((PAD,570),"수 있습니다",font=ft,fill=STRONG)
    d.line([(PAD,730),(PAD+70,730)],fill=GOLD,width=4)
    fs=sans("medium",40)
    d.text((PAD,780),"해외 3개월 이상 나가 계셨다면",font=fs,fill=BODY)
    d.text((PAD,838),"먼저 확인해야 할 것이 있습니다",font=fs,fill=BODY)
    footer(d,False,"넘겨서 확인하세요 →"); return img


# ── C. 대비형 (딥그린/크림 분할) — 전후·비교가 주인공
def cover_C():
    img=Image.new("RGB",(W,H),CREAM); d=ImageDraw.Draw(img)
    d.rectangle([(0,0),(W,560)],fill=FOREST)
    toprule(d); overline(d,"세대별로 다릅니다",True)
    ft=sans("black",92)
    d.text((PAD,250),"내 실손,",font=ft,fill=CREAM)
    d.text((PAD,360),"몇 세대일까?",font=ft,fill=GOLD_LT)
    # 대비 블록
    box_y=640
    for i,(lab,val,col) in enumerate([("1~4세대","도수치료 보장",FOREST),
                                      ("5세대","기본 보장 제외",CLAY)]):
        by=box_y+i*170
        d.rounded_rectangle([(PAD-20,by),(W-PAD+20,by+140)],radius=16,
                            fill=CREAM_SOFT,outline=LINE,width=1)
        d.text((PAD+8,by+26),lab,font=sans("bold",34),fill=MUTED)
        d.text((PAD+8,by+72),val,font=sans("black",46),fill=col)
    d.text((PAD,1010),"같은 치료인데 결과가 다릅니다",font=sans("medium",36),fill=BODY)
    footer(d,False); return img


# ── D. 목록형 (딥잉크) — 항목·체크리스트가 주인공
def cover_D():
    img=Image.new("RGB",(W,H),FOREST_DEEP); d=ImageDraw.Draw(img)
    toprule(d,GOLD_LT); overline(d,"확인 필요",True,GOLD_LT)
    ft=sans("black",92)
    d.text((PAD,300),"내 암보험금,",font=ft,fill=CREAM)
    d.text((PAD,412),"진짜",font=ft,fill=CREAM)
    d.text((PAD+tw(d,"진짜 ",ft),412),"5,000만원",font=ft,fill=GOLD_LT)
    d.text((PAD,524),"맞을까?",font=ft,fill=CREAM)
    items=["계약 3장에 흩어진 진단비","특약마다 다른 지급 조건","합산해야 보이는 실제 금액"]
    fy=740
    for i,it in enumerate(items):
        d.ellipse([(PAD,fy+i*86+12),(PAD+16,fy+i*86+28)],fill=GOLD_LT)
        d.text((PAD+40,fy+i*86),it,font=sans("medium",38),fill=ON_DARK)
    footer(d,True,"합산해 보기 →"); return img


def main():
    os.makedirs(OUT,exist_ok=True)
    for name,fn in [("A-숫자형",cover_A),("B-질문형",cover_B),
                    ("C-대비형",cover_C),("D-목록형",cover_D)]:
        p=f"{OUT}/cover-{name}.png"; fn().save(p,"PNG",optimize=True); print("saved:",p)

    # 피드 격자 미리보기 (3열)
    tiles=[f"{OUT}/cover-{n}.png" for n in ["A-숫자형","B-질문형","C-대비형","D-목록형"]]
    tiles=tiles+[tiles[0],tiles[1]]
    tw_,th_=360,450
    grid=Image.new("RGB",(tw_*3+16,th_*2+8),"#ffffff")
    for i,t in enumerate(tiles[:6]):
        im=Image.open(t).resize((tw_,th_))
        grid.paste(im,((i%3)*(tw_+8),(i//3)*(th_+8)))
    grid.save(f"{OUT}/feed-preview.png"); print("saved: feed-preview")

if __name__=="__main__": main()
