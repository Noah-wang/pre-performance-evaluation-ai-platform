const jsonHeaders = { "Content-Type": "application/json" };

const responseJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

const resolveServicePath = (pathname: string) => {
  const serviceName = pathname.split("/").filter(Boolean)[0];
  if (!serviceName) return null;
  return `/home/deno/functions/${serviceName}`;
};

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname === "/_internal/health") {
    return responseJson({ message: "ok" });
  }

  if (pathname === "/_internal/metric") {
    return responseJson(await EdgeRuntime.getRuntimeMetrics());
  }

  const servicePath = resolveServicePath(pathname);
  if (!servicePath) {
    return responseJson({ msg: "missing function name in request" }, 400);
  }

  const createWorker = async () => {
    const envVarsObj = Deno.env.toObject();
    const envVars = Object.keys(envVarsObj).map((key) => [key, envVarsObj[key]]);

    return await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: 256,
      workerTimeoutMs: 5 * 60 * 1000,
      noModuleCache: false,
      envVars,
      forceCreate: false,
      cpuTimeSoftLimitMs: 30 * 1000,
      cpuTimeHardLimitMs: 60 * 1000,
      context: { useReadSyncFileAPI: true },
    });
  };

  const callWorker = async (): Promise<Response> => {
    try {
      const worker = await createWorker();
      return await worker.fetch(req);
    } catch (error) {
      if (error instanceof Deno.errors.WorkerAlreadyRetired) return await callWorker();
      if (error instanceof Deno.errors.WorkerRequestIdleTimeout) {
        return responseJson({ msg: String(error) }, 504);
      }
      if (error instanceof Deno.errors.WorkerRequestCancelled) {
        return responseJson({ msg: "函数执行被中断，请稍后重试" }, 504);
      }
      return responseJson({ msg: String(error) }, 500);
    }
  };

  return await callWorker();
});
