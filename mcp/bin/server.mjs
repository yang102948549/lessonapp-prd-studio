#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
/* 사이트에서 쓰는 브라우저용 스크립트를 그대로 불러와 질문 정의와 교육과정을 공유한다 */
const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(dataDir, 'curriculum-data.js'), 'utf8') + '\n' + readFileSync(join(dataDir, 'planning.js'), 'utf8'), sandbox);
const { Planning, CurriculumData } = sandbox;
const UNITS = CurriculumData.units; // [학년군, 교과, 과목, 단원, [[코드, 원문], ...]]

const SCHOOLS = ['초등학교', '중학교', '고등학교'];
const text = s => ({ content: [{ type: 'text', text: s }] });
const fail = s => ({ isError: true, content: [{ type: 'text', text: s }] });

/* 학교급·학년 → 학년군 (사이트의 curriculum.js와 같은 규칙) */
function bandsFor(school, grades) {
  const all = [...new Set(UNITS.map(r => r[0]))];
  const head = school ? school[0] : '';
  const pool = head ? all.filter(b => b.startsWith(head)) : all;
  if (!grades?.length || !head) return pool;
  const fit = pool.filter(b => {
    const m = b.match(/(\d)(?:~(\d))?$/), lo = Number(m[1]), hi = Number(m[2] || m[1]);
    return grades.some(n => n >= lo && n <= hi);
  });
  return fit.length ? fit : pool;
}
const scope = ({ school, grades, subject, course, unit }) => {
  const bands = bandsFor(school, grades);
  return UNITS.filter(r => bands.includes(r[0]) && (!subject || r[1] === subject) && (!course || r[2] === course) && (!unit || r[3] === unit));
};
const fmt = (r, [code, t]) => `- [${code}] ${t}  (${r[0]} · ${r[1]}${r[2] !== r[1] ? ' · ' + r[2] : ''} · ${r[3]})`;
const findStandard = code => {
  for (const r of UNITS) for (const s of r[4]) if (s[0] === code) return fmt(r, s);
  return null;
};

const server = new McpServer({ name: 'lessonapp-prd-mcp', version: '0.1.0' });

const filter = {
  school: z.enum(SCHOOLS).optional().describe('학교급'),
  grades: z.array(z.number().int().min(1).max(6)).optional().describe('학년 숫자 목록. 초등 1~6, 중등 1~3. 고등은 1이면 고1, 2·3이면 고2~3'),
  subject: z.string().optional().describe('교과. 예: 국어, 수학, 사회, 과학, 영어, 제2외국어'),
  course: z.string().optional().describe('과목. 예: 통합과학1, 독일어'),
  unit: z.string().optional().describe('단원(영역)')
};

server.registerTool('browse_curriculum', {
  title: '교육과정 목차 보기',
  description: '2022 개정 교육과정의 학년군·교과·과목·단원(영역) 목차와 성취기준 개수를 보여 줍니다. 필터를 더할수록 한 단계씩 깊이 내려갑니다.',
  inputSchema: filter
}, async args => {
  const rows = scope(args);
  if (!rows.length) return fail('조건에 맞는 교육과정이 없어요. 필터를 줄여 보세요.');
  const level = args.course ? 3 : args.subject ? 2 : 1; // 1: 교과, 2: 과목, 3: 단원
  const tree = new Map();
  rows.forEach(r => {
    const key = [r[0], r[1], r[2], r[3]].slice(0, level + 1).join(' / ');
    tree.set(key, (tree.get(key) || 0) + r[4].length);
  });
  return text([...tree].map(([k, n]) => `${k} (성취기준 ${n}개)`).join('\n'));
});

server.registerTool('search_standards', {
  title: '성취기준 검색',
  description: '성취기준 원문을 키워드와 필터로 검색합니다. 교과서 단원명이 아니라 교육과정 성취기준 단위입니다. 반환된 코드는 build_prd의 standards에 넘길 수 있습니다.',
  inputSchema: { query: z.string().optional().describe('원문에서 찾을 낱말. 예: 분수, 토론'), ...filter, limit: z.number().int().min(1).max(50).default(20) }
}, async ({ query, limit = 20, ...f }) => {
  const out = [];
  let total = 0;
  for (const r of scope(f)) for (const s of r[4]) {
    if (query && !s[1].includes(query) && !s[0].includes(query)) continue;
    total++;
    if (out.length < limit) out.push(fmt(r, s));
  }
  if (!total) return fail('검색 결과가 없어요. 낱말을 줄이거나 필터를 풀어 보세요.');
  return text(`${total}개 중 ${out.length}개\n${out.join('\n')}`);
});

server.registerTool('get_standard', {
  title: '성취기준 원문 조회',
  description: '성취기준 코드(예: 6수01-01)로 원문과 소속을 조회합니다.',
  inputSchema: { code: z.string().describe('성취기준 코드. 대괄호는 있어도 없어도 됩니다.') }
}, async ({ code }) => {
  const c = code.replace(/[\[\]\s]/g, '');
  const hit = findStandard(c);
  return hit ? text(hit) : fail(`${c} 코드를 찾을 수 없어요.`);
});

const answersShape = z.record(z.union([z.string(), z.array(z.string())])).describe('질문 id → 답. 여러 개를 고르는 질문은 문자열 배열');

server.registerTool('get_planning_questions', {
  title: '기획 질문 보기',
  description: '수업 웹앱 기획 질문(학교급, 학년, 과목, 단원과 주제, 수업 단계, 배움의 목표, 활동, 화면 흐름 등)을 순서대로 보여 줍니다. 앞선 답(answers)에 따라 보이는 질문과 선택지가 달라지므로, 지금까지의 답을 넘기면 아직 답하지 않은 질문부터 안내합니다. 교사에게 한 번에 한두 개씩 물어보세요.',
  inputSchema: { answers: answersShape.default({}), only_unanswered: z.boolean().default(true), step_id: z.string().optional().describe('이 질문 하나만 선택지까지 자세히') }
}, async ({ answers = {}, only_unanswered = true, step_id }) => {
  const visible = Planning.visibleSteps(answers);
  const done = id => { const v = answers[id]; return Array.isArray(v) ? v.length > 0 : !!v; };
  const labelOf = o => (typeof o === 'string' ? o : o.label);
  const one = s => {
    const opts = Planning.options(s.id, answers).map(labelOf);
    return `## ${s.id} · ${s.title}${s.multi ? ' (여러 개 선택)' : ''}\n${s.question}\n${s.help}${opts.length ? '\n선택지: ' + opts.join(' | ') : ''}`;
  };
  if (step_id) {
    const s = visible.find(x => x.id === step_id);
    return s ? text(one(s)) : fail(`${step_id} 질문은 지금 답으로는 보이지 않아요.`);
  }
  const list = only_unanswered ? visible.filter(s => !done(s.id)) : visible;
  const head = `전체 ${visible.length}개 중 ${visible.filter(s => done(s.id)).length}개 답함`;
  if (!list.length) return text(`${head}\n모든 질문에 답했어요. build_prd로 기획서를 만드세요.`);
  const shown = list.slice(0, 4);
  return text(`${head}. 다음 질문 ${shown.length}개 (질문 id는 build_prd의 answers 키로 씁니다)\n\n${shown.map(one).join('\n\n')}${list.length > shown.length ? `\n\n…남은 질문 ${list.length - shown.length}개` : ''}`);
});

server.registerTool('build_prd', {
  title: 'PRD 초안 만들기',
  description: '지금까지의 답으로 수업 웹앱 PRD 초안(마크다운)을 만듭니다. 답하지 않은 항목은 [미정]으로 남고, 빠진 핵심 항목과 서로 충돌하는 답을 함께 알려 줍니다. standards에 성취기준 코드를 넘기면 원문을 교육과정 절로 싣습니다.',
  inputSchema: { title: z.string().default('나의 수업 웹앱'), answers: answersShape, standards: z.array(z.string()).optional().describe('성취기준 코드 목록') }
}, async ({ title = '나의 수업 웹앱', answers, standards }) => {
  const body = Planning.sections(answers).map(([t, v], i) => `## ${i + 1}. ${t}\n${v}`).join('\n\n');
  let cur = '';
  if (standards?.length) {
    const lines = [], missing = [];
    for (const code of standards.map(c => c.replace(/[\[\]\s]/g, ''))) {
      const hit = findStandard(code);
      hit ? lines.push(hit) : missing.push(code);
    }
    cur = `## 교육과정 성취기준 (2022 개정, 원문)\n${lines.join('\n')}${missing.length ? `\n\n찾지 못한 코드: ${missing.join(', ')}` : ''}\n\n`;
  }
  const todo = Planning.checks(answers).filter(c => !c.done).map(c => c.label);
  const issues = Planning.conflicts(answers);
  const notes = [todo.length ? `빠진 핵심 항목: ${todo.join(', ')}` : '', issues.length ? `확인할 충돌:\n${issues.map(i => '- ' + i).join('\n')}` : ''].filter(Boolean).join('\n\n');
  return text(`# ${title} PRD\n\n> 질문 답변을 정리한 설계 초안입니다. [미정] 항목과 자료 원문을 확인하세요.\n\n${cur}${body}${notes ? '\n\n---\n' + notes : ''}`);
});

await server.connect(new StdioServerTransport());
