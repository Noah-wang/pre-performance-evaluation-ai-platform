import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, LogIn, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const errorText: Record<string, string> = {
  not_authenticated: "请先登录或注册账号后再接受邀请。",
  not_found: "邀请链接不存在或已失效。",
  revoked: "该邀请链接已被撤销。",
  expired: "该邀请链接已过期，请联系项目管理员重新生成。",
  already_accepted: "该邀请链接已被其他账号使用。",
  email_mismatch: "当前登录邮箱与邀请指定邮箱不一致，请切换账号后再试。",
  project_not_found: "邀请对应的项目不存在。",
};

const InviteAccept = () => {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [accepting, setAccepting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (loading || !user || !token || result || error || accepting) return;
    const accept = async () => {
      setAccepting(true);
      const { data, error: rpcError } = await (supabase as any).rpc("accept_project_invite", { _token: token });
      setAccepting(false);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      if (!data?.ok) {
        setError(errorText[data?.error] ?? "接受邀请失败，请联系管理员。");
        return;
      }
      setResult(data);
    };
    accept();
  }, [accepting, error, loading, result, token, user]);

  const loginUrl = `/auth?redirect=${encodeURIComponent(`/invite/${token}`)}`;

  return (
    <div className="min-h-screen bg-background p-6 flex items-center justify-center">
      <Card className="surface-card w-full max-w-xl">
        <CardContent className="p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <div className="section-eyebrow">PROJECT INVITE · 项目邀请</div>
              <h1 className="font-display text-2xl font-bold">加入评估项目</h1>
            </div>
          </div>

          {loading || accepting ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>正在处理邀请</AlertTitle>
              <AlertDescription>系统正在确认你的登录状态并加入项目，请稍候。</AlertDescription>
            </Alert>
          ) : !user ? (
            <Alert>
              <LogIn className="h-4 w-4" />
              <AlertTitle>需要先登录或注册</AlertTitle>
              <AlertDescription>
                点击下方按钮进入登录页。登录或注册完成后，系统会自动回到此页面并加入项目。
              </AlertDescription>
            </Alert>
          ) : result ? (
            <Alert className="border-success/30 bg-success/10">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <AlertTitle>已加入项目</AlertTitle>
              <AlertDescription>
                你已加入「{result.project_name}」。之后登录系统时，只会看到你参与的项目。
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>邀请处理失败</AlertTitle>
              <AlertDescription>{error || "接受邀请失败，请联系管理员。"}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {!user ? (
              <Button variant="hero" onClick={() => navigate(loginUrl)}>
                <LogIn className="h-4 w-4" /> 登录 / 注册并加入项目
              </Button>
            ) : result ? (
              <>
                <Button variant="outline" onClick={() => navigate("/work-groups")}>查看工作组</Button>
                <Button variant="hero" onClick={() => navigate(`/projects/${result.project_id}/workbench`)}>
                  进入项目工作台
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => navigate("/")} disabled={accepting}>返回工作台</Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default InviteAccept;
