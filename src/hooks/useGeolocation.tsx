import { useState } from "react";
import { toast } from "sonner";

export interface GeoCoords {
  lng: number;
  lat: number;
  accuracy: number;
}

/**
 * 浏览器原生 GPS 定位 hook
 * 注意：必须 HTTPS 环境；用户首次需授权浏览器定位权限
 */
export const useGeolocation = () => {
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<GeoCoords | null>(null);

  const getCurrent = (): Promise<GeoCoords | null> => {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) {
        toast.error("当前浏览器不支持定位");
        return resolve(null);
      }
      setLoading(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c: GeoCoords = {
            lng: pos.coords.longitude,
            lat: pos.coords.latitude,
            accuracy: pos.coords.accuracy,
          };
          setCoords(c);
          setLoading(false);
          toast.success(`定位成功，精度约 ${Math.round(c.accuracy)} 米`);
          resolve(c);
        },
        (err) => {
          setLoading(false);
          const map: Record<number, string> = {
            1: "您拒绝了定位授权，请在浏览器设置中开启",
            2: "无法获取位置（可能信号弱或室内）",
            3: "定位超时，请在户外重试",
          };
          toast.error(map[err.code] ?? `定位失败：${err.message}`);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  };

  return { loading, coords, getCurrent };
};
