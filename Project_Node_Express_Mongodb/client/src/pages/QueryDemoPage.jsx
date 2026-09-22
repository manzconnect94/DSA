// ============================================================
// 🧠 CONCEPT: A UI for the backend's slow-vs-fast query demo
// WHY IT MATTERS (interview angle): this page makes the database concepts
//   from server/controllers/queryDemoController.js tangible — you click a
//   button and see 501 queries vs 1, COLLSCAN vs IXSCAN, with real
//   millisecond numbers from your own machine.
//   ⚠️ Seed data first, or the difference will be invisible:
//       cd server && npm run seed:big
// ============================================================

import { useState } from 'react';
import axiosClient, { extractErrorMessage } from '../api/axiosClient';

function Result({ title, payload }) {
  if (!payload) return null;
  return (
    <div className="demo-result">
      <h3>{title}</h3>
      <pre>{JSON.stringify(payload, null, 2)}</pre>
    </div>
  );
}

export default function QueryDemoPage() {
  const [running, setRunning] = useState(null);
  const [error, setError] = useState(null);
  const [results, setResults] = useState({});

  async function run(key, url) {
    setRunning(key);
    setError(null);
    const startedAt = performance.now();

    try {
      const res = await axiosClient.get(url);
      const roundTripMs = Math.round(performance.now() - startedAt);
      setResults((prev) => ({ ...prev, [key]: { ...res.data, _clientRoundTripMs: roundTripMs } }));
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setRunning(null);
    }
  }

  const buttons = [
    {
      key: 'compare',
      label: '⚡ Run the comparison (slow vs fast)',
      url: '/demo/compare',
      note: 'Runs both paths back to back and reports the speedup ratio and round-trips saved.',
    },
    {
      key: 'slow',
      label: '🐌 Slow path',
      url: '/demo/tasks-slow',
      note: 'COLLSCAN on an unindexed field + no projection + no lean() + N+1 loop + JS aggregation.',
    },
    {
      key: 'fast',
      label: '🚀 Fast path',
      url: '/demo/tasks-fast',
      note: 'IXSCAN + $project + $lookup + $group — one single query.',
    },
    {
      key: 'explain',
      label: '🔍 .explain("executionStats")',
      url: '/demo/explain',
      note: 'COLLSCAN vs IXSCAN vs a covered query, with real docsExamined counts.',
    },
    {
      key: 'populate',
      label: '🔗 Loop vs populate() vs $lookup',
      url: '/demo/populate',
      note: 'The N+1 problem and its two fixes, timed.',
    },
    {
      key: 'indexes',
      label: '📇 Index inventory + $indexStats',
      url: '/demo/indexes',
      note: 'Which indexes exist, and which have never been used (write tax for nothing).',
    },
  ];

  return (
    <div className="page">
      <h1>Query performance demos</h1>

      <div className="callout">
        <strong>⚠️ Seed data first.</strong> With only a handful of documents, a COLLSCAN and an IXSCAN are both
        sub-millisecond and these numbers are meaningless. Run:
        <pre>cd server &amp;&amp; npm run seed:big</pre>
        That inserts 50,000 tasks, at which point the difference is obvious.
      </div>

      <div className="demo-buttons">
        {buttons.map((b) => (
          <div key={b.key} className="demo-button-row">
            <button type="button" disabled={running !== null} onClick={() => run(b.key, b.url)}>
              {running === b.key ? 'Running…' : b.label}
            </button>
            <small>{b.note}</small>
          </div>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}

      {/* ============================================================
          🧠 CONCEPT: What to look for in the output
          WHY IT MATTERS (interview angle): the numbers only teach you
            something if you know which ones matter. This legend is the
            same checklist you would use reading a real explain() plan in
            production.
          ============================================================ */}
      <details className="concept-note" open>
        <summary>What to look for in the results</summary>
        <ul>
          <li>
            <code>dbQueryCount</code> — the slow path makes <strong>1 + N</strong> queries (one per task). The fast
            path makes <strong>1</strong>. Network round-trips usually dominate everything else.
          </li>
          <li>
            <code>winningStage: COLLSCAN</code> — ❌ no index. MongoDB read every document in the collection.
          </li>
          <li>
            <code>winningStage: IXSCAN</code> — ✅ a B-tree seek instead of a scan.
          </li>
          <li>
            <code>PROJECTION_COVERED</code> with <code>totalDocsExamined: 0</code> — ✅✅ answered from the index
            alone; the documents were never read.
          </li>
          <li>
            <code>efficiencyRatio</code> — <code>totalDocsExamined ÷ nReturned</code>. 1:1 is ideal. 100:1 means you
            examined 100 documents to return 1.
          </li>
          <li>
            <code>SORT</code> in the plan — ❌ an in-memory sort, which fails outright above 100MB. Add an index
            matching the sort order.
          </li>
          <li>
            <code>timesUsedSinceRestart: 0</code> on the indexes page — an index nobody queries. It still taxes every
            single write. Drop it.
          </li>
        </ul>
      </details>

      {buttons.map((b) => (
        <Result key={b.key} title={b.label} payload={results[b.key]} />
      ))}
    </div>
  );
}
