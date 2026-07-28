import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ReactNode } from "react";

export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  // 已经拿到用户后再出现 loading（例如角色刷新），不能把整棵路由树换成加载态：
  // 那会卸载当前页面，正在进行的报告生成等状态随之丢失。只在首次鉴权时挡屏。
  if (loading && !user) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="font-serif text-vermillion text-lg">载入中…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
};
