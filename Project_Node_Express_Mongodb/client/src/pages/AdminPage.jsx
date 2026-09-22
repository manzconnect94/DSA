// ============================================================
// 🧠 CONCEPT: An admin page — RBAC on the client, enforced on the server
// WHY IT MATTERS (interview angle): this page is only reachable behind
//   <ProtectedRoute requireRole="admin">, but that is COSMETIC. The
//   endpoints it calls are protected by requireRole('admin') middleware on
//   the server. Delete the client guard and a regular user reaches this
//   page — and sees nothing but 403s. That is the correct outcome, and it
//   is the demonstration that the server is where security lives.
// ============================================================

import { useState } from 'react';
import { useFetch } from '../hooks/useFetch';
import axiosClient, { extractErrorMessage } from '../api/axiosClient';

export default function AdminPage() {
  const { data: overview, isLoading, error, refetch } = useFetch('/admin/overview');
  const [report, setReport] = useState(null);
  const [reportRunning, setReportRunning] = useState(false);
  const [healthDuringReport, setHealthDuringReport] = useState(null);

  // ============================================================
  // 🧠 CONCEPT: Demonstrating a BLOCKED EVENT LOOP, live
  // WHY IT MATTERS (interview angle): this is the most visceral way to
  //   show why CPU-bound work must leave the main thread. We fire the
  //   report request and, 100ms later, fire a /health request. Then we
  //   time how long health took to respond.
  //     • mode=worker   -> health responds in ~5ms. The loop is free.
  //     • mode=blocking -> health takes as long as the ENTIRE report,
  //       because the single thread is busy and cannot even accept the
  //       connection.
  //   That second number IS the outage. Every user, every request, waits.
  // ============================================================
  async function runReport(mode) {
    setReportRunning(true);
    setReport(null);
    setHealthDuringReport(null);

    // Fire the health probe shortly after the report starts.
    const healthProbe = new Promise((resolve) => {
      setTimeout(async () => {
        const started = performance.now();
        try {
          await axiosClient.get('/health');
          resolve(Math.round(performance.now() - started));
        } catch {
          resolve(-1);
        }
      }, 100);
    });

    try {
      const [res, healthMs] = await Promise.all([
        axiosClient.get('/admin/report', { params: { mode, iterations: 20_000_000 } }),
        healthProbe,
      ]);
      setReport(res.data);
      setHealthDuringReport(healthMs);
    } catch (err) {
      setReport({ error: extractErrorMessage(err) });
    } finally {
      setReportRunning(false);
    }
  }

  if (isLoading) return <p className="muted">Loading admin overview…</p>;
  if (error) return <p className="form-error">{error}</p>;

  const data = overview?.data;

  return (
    <div className="page">
      <h1>Admin</h1>

      <div className="stat-row">
        <div className="stat-card">
          <strong>{data?.userCount ?? 0}</strong> users
          <small>via estimatedDocumentCount() — O(1) metadata read</small>
        </div>
        <div className="stat-card">
          <strong>{data?.taskCount ?? 0}</strong> tasks
        </div>
        <div className="stat-card">
          <strong>{data?.activeSessions ?? 0}</strong> active sessions
          <small>unrevoked, unexpired refresh tokens</small>
        </div>
      </div>

      {/* ============================================================
          🧠 CONCEPT: Surfacing cache hit rate
          WHY IT MATTERS (interview angle): "how do you know your cache is
            working?" — you measure it. A hit rate below ~70% on a
            read-heavy endpoint usually means the TTL is too short or the
            cache key is too specific (every request generating a unique
            key means you have a write-only cache).
          ============================================================ */}
      <h2>Cache</h2>
      <div className="stat-row">
        <div className="stat-card">
          <strong>{data?.cache?.hitRate ?? 0}%</strong> hit rate
          <small>
            {data?.cache?.hits ?? 0} hits / {data?.cache?.misses ?? 0} misses
          </small>
        </div>
        <div className="stat-card">
          backend: <strong>{data?.cache?.backend}</strong>
          <small>
            {data?.cache?.backend === 'in-memory-fallback'
              ? '⚠️ Redis is not running — this per-process Map would diverge across instances'
              : '✅ shared across every instance'}
          </small>
        </div>
        <button
          type="button"
          onClick={async () => {
            await axiosClient.post('/admin/cache/flush');
            refetch();
          }}
        >
          Flush cache
        </button>
      </div>

      <h2>Top users by task count</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Tasks</th>
            <th>Done</th>
          </tr>
        </thead>
        <tbody>
          {(data?.topUsers ?? []).map((u) => (
            <tr key={u.email || u.name}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.taskCount}</td>
              <td>{u.done}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <small className="hint">
        Computed with a <code>$group</code> + <code>$lookup</code> aggregation starting from the tasks collection —
        cheaper than starting from users and joining tasks onto each one.
      </small>

      <h2>Worker threads vs blocking the event loop</h2>
      <div className="callout">
        Both buttons run the same 20-million-iteration CPU computation. The difference is WHERE it runs. While the
        request is in flight we also ping <code>/api/health</code> and time the response — that number is the whole
        lesson.
      </div>

      <div className="demo-buttons">
        <button type="button" disabled={reportRunning} onClick={() => runReport('worker')}>
          ✅ Run in a WORKER THREAD
        </button>
        <button type="button" disabled={reportRunning} onClick={() => runReport('blocking')}>
          ❌ Run on the MAIN THREAD (blocks everything)
        </button>
      </div>

      {healthDuringReport !== null && (
        <div className={`perf-bar ${healthDuringReport > 500 ? 'bad' : 'good'}`}>
          <strong>/api/health responded in {healthDuringReport}ms while the report was running.</strong>
          {healthDuringReport > 500 ? (
            <span> ❌ The event loop was blocked — every other user was waiting too.</span>
          ) : (
            <span> ✅ The main loop stayed free; other requests were unaffected.</span>
          )}
        </div>
      )}

      {report && <pre className="demo-result">{JSON.stringify(report, null, 2)}</pre>}
    </div>
  );
}
