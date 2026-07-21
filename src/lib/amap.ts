import { supabase } from "@/integrations/supabase/client";

/**
 * 高德地图 JS API 加载器（单例）
 * - Key: Web 端 JS API Key，配域名白名单后可前端公开
 * - 安全密钥 jscode: 由 edge function 从后端 secret 安全下发
 */
const AMAP_KEY = "4538d9e9c55dbca22a48e4d14c595071";

let loadPromise: Promise<any> | null = null;

const fetchJsCode = async (): Promise<string> => {
  try {
    const { data } = await supabase.functions.invoke("amap-config");
    return (data as any)?.jscode ?? "";
  } catch {
    return "";
  }
};

export const loadAMap = (): Promise<any> => {
  if (typeof window === "undefined") return Promise.reject("SSR");
  // @ts-ignore
  if (window.AMap) return Promise.resolve(window.AMap);
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const jscode = await fetchJsCode();
    // 安全密钥配置：必须在加载 JS API 之前设置
    // @ts-ignore
    window._AMapSecurityConfig = { securityJsCode: jscode };

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_KEY}&plugin=AMap.Geocoder,AMap.Marker,AMap.InfoWindow`;
      script.async = true;
      script.onload = () => {
        // @ts-ignore
        resolve(window.AMap);
      };
      script.onerror = () => reject(new Error("高德地图加载失败，请检查网络或域名白名单"));
      document.head.appendChild(script);
    });
  })();

  return loadPromise;
};

/** 反向地理编码：经纬度 → 文字地址 */
export const reverseGeocode = async (lng: number, lat: number): Promise<string | null> => {
  try {
    const AMap = await loadAMap();
    return new Promise((resolve) => {
      const geocoder = new AMap.Geocoder();
      geocoder.getAddress([lng, lat], (status: string, result: any) => {
        if (status === "complete" && result.regeocode) {
          resolve(result.regeocode.formattedAddress);
        } else {
          resolve(null);
        }
      });
    });
  } catch {
    return null;
  }
};
