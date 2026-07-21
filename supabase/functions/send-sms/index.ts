const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SERVICE = "sms";
const HOST = "sms.tencentcloudapi.com";
const ACTION = "SendSms";
const VERSION = "2021-01-11";

const encoder = new TextEncoder();

const toHex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const sha256Hex = async (value: string) => {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(hash);
};

const hmacSha256 = async (keyBytes: BufferSource, value: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
};

const normalizePhone = (phone: string) => {
  const clean = phone.replace(/[\s-]/g, "");
  if (clean.startsWith("+")) return clean;
  if (/^86\d{11}$/.test(clean)) return `+${clean}`;
  if (/^\d{11}$/.test(clean)) return `+86${clean}`;
  return clean;
};

const compactParam = (value: string, maxLength: number) => {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
};

const getRequiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`缺少短信配置：${name}`);
  return value;
};

const buildAuthorization = async (payload: string, timestamp: number) => {
  const secretId = getRequiredEnv("TENCENT_SMS_SECRET_ID");
  const secretKey = getRequiredEnv("TENCENT_SMS_SECRET_KEY");
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const hashedPayload = await sha256Hex(payload);
  const canonicalRequest = [
    "POST",
    "/",
    "",
    `content-type:application/json; charset=utf-8\nhost:${HOST}\n`,
    "content-type;host",
    hashedPayload,
  ].join("\n");
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    hashedCanonicalRequest,
  ].join("\n");

  const secretDate = await hmacSha256(encoder.encode(`TC3${secretKey}`), date);
  const secretService = await hmacSha256(secretDate, SERVICE);
  const secretSigning = await hmacSha256(secretService, "tc3_request");
  const signature = toHex(await hmacSha256(secretSigning, stringToSign));

  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhone(String(body.phone ?? ""));
    if (!phone || !/^\+\d{8,18}$/.test(phone)) {
      return new Response(JSON.stringify({ error: "请输入有效手机号，国内号码可直接填 11 位手机号" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const templateParams = Array.isArray(body.params) && body.params.length > 0
      ? body.params.map((item: unknown) => compactParam(String(item ?? ""), 120))
      : [
          compactParam(String(body.title ?? "绩效评估提醒"), 50),
          compactParam(String(body.body ?? "您有新的待处理事项，请登录系统查看。"), 120),
        ];

    const payload = JSON.stringify({
      SmsSdkAppId: getRequiredEnv("TENCENT_SMS_SDK_APP_ID"),
      SignName: getRequiredEnv("TENCENT_SMS_SIGN_NAME"),
      TemplateId: getRequiredEnv("TENCENT_SMS_TEMPLATE_ID"),
      TemplateParamSet: templateParams,
      PhoneNumberSet: [phone],
      SessionContext: body.notificationId ? String(body.notificationId) : undefined,
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const region = Deno.env.get("TENCENT_SMS_REGION") || "ap-guangzhou";
    const authorization = await buildAuthorization(payload, timestamp);

    const response = await fetch(`https://${HOST}`, {
      method: "POST",
      headers: {
        "Authorization": authorization,
        "Content-Type": "application/json; charset=utf-8",
        "Host": HOST,
        "X-TC-Action": ACTION,
        "X-TC-Version": VERSION,
        "X-TC-Timestamp": String(timestamp),
        "X-TC-Region": region,
      },
      body: payload,
    });

    const result = await response.json().catch(() => ({}));
    const sendStatus = result?.Response?.SendStatusSet?.[0];
    const ok = response.ok && sendStatus?.Code === "Ok";

    return new Response(JSON.stringify({
      ok,
      requestId: result?.Response?.RequestId,
      code: sendStatus?.Code,
      message: sendStatus?.Message,
      phone,
      raw: result,
    }), {
      status: ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("send-sms error", error);
    return new Response(JSON.stringify({ error: String((error as Error).message ?? error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
