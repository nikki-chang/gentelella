import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import morgan from 'morgan';

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(morgan('dev'));

const DATA_DIR = path.resolve('./examples/failure-csv-api/data');
const CSV_PATH = path.join(DATA_DIR, 'failures.csv');

// Ensure data dir and csv exist with header
const HEADER = [
  '失效类型','序号','当前状态','优先级','问题分类','型号名称','芯片版本',
  '芯片等级','封装批次','SCAN_ID','下一步计划','问题描述','问题是否复现','ATE测试结果',
  'SLT复测结果','板级分析进展','FA进展','问题进展','根本原因','所属模块','改进措施',
  '开始时间','结束时间','第一责任人','OA单号','失效分析采集表','失效分析报告','分析用时'
];

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CSV_PATH)) {
  const headerLine = stringify([HEADER], { header: false });
  fs.writeFileSync(CSV_PATH, headerLine, 'utf8');
}

// Helpers
function readAll() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, { columns: HEADER, skip_empty_lines: true, relax_column_count: true });
  // ensure every record has an id (use 序号 as id if present, otherwise generate)
  return records.map((r, idx) => {
    return { __id: r['序号'] || String(idx + 1), ...r };
  });
}

function writeAll(records) {
  // records: array of objects using HEADER keys
  const rows = records.map((r) => HEADER.map((h) => r[h] ?? ''));
  const csv = stringify(rows, { header: false });
  fs.writeFileSync(CSV_PATH, stringify([HEADER], { header: false }) + csv, 'utf8');
}

// Routes
// GET /api/failures             -> JSON array
// GET /api/failures?format=csv  -> CSV file (for direct download)
// POST /api/failures            -> create (body JSON with keys matching header names)
// PATCH /api/failures/:id       -> update fields
// DELETE /api/failures/:id      -> remove

app.get('/api/failures', (req, res) => {
  const all = readAll();
  if (req.query.format === 'csv') {
    // return raw CSV
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(fs.readFileSync(CSV_PATH, 'utf8'));
    return;
  }
  res.json({ items: all });
});

app.post('/api/failures', (req, res) => {
  const payload = req.body || {};
  const all = readAll();
  // Generate an id if 序号 not provided
  const nextId = String((all.length ? Math.max(...all.map((r) => Number(r.__id) || 0)) + 1 : 1));
  const row = {};
  HEADER.forEach((h) => { row[h] = payload[h] ?? ''; });
  row['序号'] = payload['序号'] ?? nextId;
  const toWrite = [...all.map(r => {
    // strip __id when writing
    const copy = {};
    HEADER.forEach(h => { copy[h] = r[h] ?? ''; });
    return copy;
  }), row];
  writeAll(toWrite);
  res.status(201).json({ item: { __id: row['序号'], ...row } });
});

app.patch('/api/failures/:id', (req, res) => {
  const id = req.params.id;
  const payload = req.body || {};
  const all = readAll();
  const idx = all.findIndex((r) => String(r.__id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const rec = all[idx];
  HEADER.forEach((h) => { if (Object.prototype.hasOwnProperty.call(payload, h)) rec[h] = payload[h]; });
  // persist (strip __id)
  writeAll(all.map((r) => {
    const copy = {}; HEADER.forEach(h => { copy[h] = r[h] ?? ''; }); return copy;
  }));
  res.json({ item: all[idx] });
});

app.delete('/api/failures/:id', (req, res) => {
  const id = req.params.id;
  let all = readAll();
  const idx = all.findIndex((r) => String(r.__id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const removed = all.splice(idx, 1)[0];
  writeAll(all.map((r) => { const copy = {}; HEADER.forEach(h => { copy[h] = r[h] ?? ''; }); return copy; }));
  res.json({ removed });
});

// Serve static (optional) to inspect CSV via browser
app.use('/data', express.static(DATA_DIR));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  // keep console minimal; this is a dev server log
  console.log(`failure-csv-api listening on http://localhost:${port}`);
});
