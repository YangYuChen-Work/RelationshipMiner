import { useEffect, useState } from "react";
import {
  fetchDatabaseInfo,
  type DatabaseInfo,
} from "../api/tables";

export default function DatabaseInfoCard() {
  const [databaseInfo, setDatabaseInfo] = useState<DatabaseInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void fetchDatabaseInfo()
      .then((info) => {
        if (active) setDatabaseInfo(info);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : "获取数据库信息失败",
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const connected = databaseInfo?.connection_status === "connected";
  const statusLabel = error
    ? "状态未知"
    : databaseInfo
      ? connected
        ? "已连接"
        : "连接不可用"
      : "正在检查";

  return (
    <section
      aria-label="数据库信息"
      className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-800">数据库信息</h3>
        <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-full ${
              connected
                ? "bg-emerald-500"
                : error || databaseInfo?.connection_status === "unavailable"
                  ? "bg-red-500"
                  : "bg-amber-400"
            }`}
          />
          连接状态：{statusLabel}
        </p>
      </div>

      {databaseInfo ? (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500">数据库名称</dt>
            <dd className="mt-1 font-medium text-slate-800">
              {databaseInfo.database_name}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">连接地址</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-700">
              {databaseInfo.connection_address}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">已发现数据表</dt>
            <dd className="mt-1 font-medium text-slate-800">
              {databaseInfo.table_count} 张表
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-sm text-slate-500">
          {error ?? "正在获取数据库信息…"}
        </p>
      )}
    </section>
  );
}
