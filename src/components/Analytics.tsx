import Script from "next/script";
import AnalyticsClient from "@/components/AnalyticsClient";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

/**
 * GA4 태그 — 내부 트래픽을 싣지 않는다(IX1).
 *  - localhost·127.0.0.1 → 태그 자체를 안 싣는다.
 *  - /admin·/preview 로 들어온 세션 → 태그를 안 싣고, 이 브라우저에 내부 표식(gf_internal)을 남긴다.
 *  - 내부 표식이 있는 브라우저가 공개 페이지를 보면 traffic_type=internal 로 보낸다
 *    (GA4 관리 > 데이터 필터 「Internal Traffic」 을 활성으로 두면 보고서에서 빠진다).
 *  - goodfinance.kr 밖(Vercel Preview 등) 또는 ?ga_debug=1 → debug_mode(DebugView 확인용) + internal.
 */
export default function Analytics() {
  if (!GA_ID) return null;
  return (
    <>
      <Script id="ga4-init" strategy="afterInteractive">
        {`(function(){
var id='${GA_ID}',h=location.hostname,p=location.pathname,mark=false;
if(h==='localhost'||h==='127.0.0.1'||h==='0.0.0.0'||h==='[::1]')return;
var internalPath=/^\\/(admin|preview)(\\/|$)/.test(p);
try{if(internalPath)localStorage.setItem('gf_internal','1');mark=localStorage.getItem('gf_internal')==='1';}catch(e){}
if(internalPath)return;
var prod=h==='goodfinance.kr'||h==='www.goodfinance.kr',debug=!prod||/[?&]ga_debug=1/.test(location.search);
window.dataLayer=window.dataLayer||[];
window.gtag=function(){dataLayer.push(arguments);};
gtag('js',new Date());
var cfg={};if(mark||!prod)cfg.traffic_type='internal';if(debug)cfg.debug_mode=true;
gtag('config',id,cfg);
var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+id;document.head.appendChild(s);
})();`}
      </Script>
      <AnalyticsClient gaId={GA_ID} />
    </>
  );
}
