import { useEffect, useRef } from "react";
import { loadAMap } from "@/lib/amap";

export interface MapPoint {
  id: string;
  lng: number;
  lat: number;
  title: string;
  subtitle?: string;
}

interface Props {
  points: MapPoint[];
  height?: number;
  onPointClick?: (id: string) => void;
}

export const AMapView = ({ points, height = 360, onPointClick }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadAMap()
      .then((AMap) => {
        if (cancelled || !ref.current) return;
        if (!mapRef.current) {
          mapRef.current = new AMap.Map(ref.current, {
            zoom: 11,
            center: [116.397428, 39.90923],
            viewMode: "2D",
          });
        }
        markersRef.current.forEach((m) => m.setMap(null));
        markersRef.current = [];

        if (points.length === 0) return;

        const positions: [number, number][] = [];
        points.forEach((p) => {
          const marker = new AMap.Marker({
            position: [p.lng, p.lat],
            title: p.title,
            // 自定义科技风 marker
            content: `
              <div style="position:relative;">
                <div style="
                  width:32px;height:32px;border-radius:50%;
                  background:linear-gradient(135deg, hsl(195, 85%, 48%) 0%, hsl(209, 54%, 35%) 100%);
                  border:2px solid #fff;
                  box-shadow:0 0 0 3px hsl(195, 85%, 48%, 0.25), 0 6px 14px hsl(217, 60%, 16%, 0.4);
                  display:flex;align-items:center;justify-content:center;
                  color:#fff;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;
                ">📍</div>
                <div style="
                  position:absolute;inset:-6px;border-radius:50%;
                  border:2px solid hsl(195, 85%, 48%, 0.4);
                  animation:amap-pulse 2s ease-out infinite;
                  pointer-events:none;
                "></div>
              </div>
              <style>
                @keyframes amap-pulse {
                  0% { transform:scale(0.8); opacity:1; }
                  100% { transform:scale(1.8); opacity:0; }
                }
              </style>
            `,
            offset: new AMap.Pixel(-16, -16),
          });
          // 科技风 InfoWindow
          const info = new AMap.InfoWindow({
            isCustom: true,
            content: `
              <div style="
                position:relative;
                min-width:220px;
                background:linear-gradient(180deg, hsl(0 0% 100% / 0.97) 0%, hsl(214 32% 97% / 0.97) 100%);
                backdrop-filter:blur(16px);
                border:1px solid hsl(195 85% 48% / 0.35);
                border-radius:10px;
                box-shadow:0 0 0 1px hsl(195 85% 48% / 0.15), 0 16px 40px -12px hsl(217 60% 16% / 0.35);
                font-family:'Inter','Noto Sans SC',sans-serif;
                overflow:hidden;
              ">
                <div style="
                  height:3px;
                  background:linear-gradient(90deg, hsl(195 85% 48%), hsl(209 54% 50%), hsl(38 90% 56%));
                "></div>
                <div style="padding:12px 14px 10px;">
                  <div style="
                    font-size:10px;font-family:'JetBrains Mono',monospace;
                    letter-spacing:0.2em;text-transform:uppercase;
                    color:hsl(209 54% 50%);margin-bottom:6px;
                  ">— LOCATION</div>
                  <div style="
                    font-family:'Playfair Display',serif;
                    font-size:15px;font-weight:600;
                    color:hsl(217 60% 16%);
                    line-height:1.3;
                  ">${p.title}</div>
                  ${p.subtitle ? `
                    <div style="
                      margin-top:6px;padding-top:6px;
                      border-top:1px dashed hsl(214 22% 88%);
                      font-size:12px;color:hsl(220 14% 42%);
                      font-family:'JetBrains Mono',monospace;
                    ">${p.subtitle}</div>
                  ` : ""}
                </div>
                <div style="
                  position:absolute;left:50%;bottom:-8px;
                  transform:translateX(-50%) rotate(45deg);
                  width:14px;height:14px;
                  background:hsl(214 32% 97%);
                  border-right:1px solid hsl(195 85% 48% / 0.35);
                  border-bottom:1px solid hsl(195 85% 48% / 0.35);
                "></div>
              </div>
            `,
            offset: new AMap.Pixel(0, -28),
          });
          marker.on("click", () => {
            info.open(mapRef.current, [p.lng, p.lat]);
            onPointClick?.(p.id);
          });
          marker.setMap(mapRef.current);
          markersRef.current.push(marker);
          positions.push([p.lng, p.lat]);
        });

        if (positions.length === 1) {
          mapRef.current.setZoomAndCenter(15, positions[0]);
        } else {
          mapRef.current.setFitView(markersRef.current, false, [40, 40, 40, 40]);
        }
      })
      .catch((e) => {
        if (ref.current) {
          ref.current.innerHTML = `
            <div style="
              padding:32px 24px;text-align:center;
              font-family:'Inter','Noto Sans SC',sans-serif;
              color:hsl(220 14% 42%);font-size:13px;
              display:flex;flex-direction:column;align-items:center;gap:8px;
            ">
              <div style="
                font-family:'JetBrains Mono',monospace;font-size:10px;
                letter-spacing:0.2em;color:hsl(0 72% 51%);
              ">— MAP_LOAD_ERROR</div>
              <div>${e.message}</div>
              <div style="font-size:11px;color:hsl(220 14% 55%);">请确认高德 Key 已设置域名白名单</div>
            </div>`;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [points, onPointClick]);

  return (
    <div className="relative surface-card overflow-hidden p-0">
      {/* 顶部装饰条 */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px] z-10 pointer-events-none"
        style={{ background: "linear-gradient(90deg, transparent, hsl(var(--cyan) / 0.6), hsl(var(--accent) / 0.8), hsl(var(--cyan) / 0.6), transparent)" }}
      />
      <div
        ref={ref}
        style={{ height, width: "100%" }}
        className="bg-muted/30"
      />
      {/* 右下角坐标系标识 */}
      <div className="absolute bottom-2 right-3 text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground/70 bg-card/70 backdrop-blur px-1.5 py-0.5 rounded pointer-events-none z-10">
        WGS-84 · AMap
      </div>
    </div>
  );
};
