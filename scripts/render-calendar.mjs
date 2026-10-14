// 单翼 @mydanyi 主页贡献日历：把 GitHub GraphQL 贡献数据渲染成自包含的立体 SVG。
// 纯函数 renderCalendar(payload) 之外没有全局状态；CLI 支持 --input/--output。
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const USERNAME = 'mydanyi';
export const DEFAULT_OUTPUT = 'assets/contributions.svg';

const VIEW_W = 960;
const VIEW_H = 360;
const ORIGIN_X = 85;
const ORIGIN_Y = 125;
const WEEK_DX = 15;
const WEEK_DY = 1.6;
const DAY_DX = -8.5;
const DAY_DY = 8.5;
const MAX_BAR = 70;
const ZERO_BAR = 5;
const RIGHT_LIMIT = VIEW_W - 40;

const PALETTE = {
  bar: { top: '#3fb950', right: '#238636', left: '#176c33' },
  zero: { top: '#123a22', right: '#0d2b19', left: '#082012' },
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif";

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function round2(value) {
  const r = Math.round(value * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function num(value) {
  return String(round2(value));
}

function point(x, y) {
  return `${num(x)},${num(y)}`;
}

function polygon(vertices, fill, stroke) {
  const points = vertices.map(([x, y]) => point(x, y)).join(' ');
  const extra = stroke ? ` stroke="${stroke}"` : '';
  return `<polygon points="${points}" fill="${fill}"${extra}/>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// 逐个保留有效日期，纵向位置只由 weekday 决定，不依赖数组下标假设格子完整。
function collectDays(calendar) {
  const days = [];
  let minDate = '';
  let maxDate = '';
  const weeks = Array.isArray(calendar.weeks) ? calendar.weeks : [];
  weeks.forEach((week, wi) => {
    const list = week && Array.isArray(week.contributionDays) ? week.contributionDays : [];
    list.forEach((raw, idx) => {
      if (!raw || typeof raw.date !== 'string' || raw.date.length === 0) return;
      const rawCount = Number(raw.contributionCount);
      const count = Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 0;
      const rawWeekday = Number(raw.weekday);
      const weekday =
        Number.isInteger(rawWeekday) && rawWeekday >= 0 && rawWeekday <= 6 ? rawWeekday : Math.min(6, Math.max(0, idx));
      days.push({ date: raw.date, count, weekday, wi });
      if (minDate === '' || raw.date < minDate) minDate = raw.date;
      if (maxDate === '' || raw.date > maxDate) maxDate = raw.date;
    });
  });
  return { days, minDate, maxDate };
}

function buildColumn(cell, weekDX, weekDY) {
  const { baseX, baseY, height, count } = cell;
  const color = count > 0 ? PALETTE.bar : PALETTE.zero;
  const b0 = [baseX, baseY];
  const b1 = [baseX + weekDX, baseY + weekDY];
  const b2 = [baseX + weekDX + DAY_DX, baseY + weekDY + DAY_DY];
  const b3 = [baseX + DAY_DX, baseY + DAY_DY];
  const lift = (p) => [p[0], p[1] - height];
  const t0 = lift(b0);
  const t1 = lift(b1);
  const t2 = lift(b2);
  const t3 = lift(b3);
  return (
    polygon([b2, b3, t3, t2], color.left) +
    polygon([b1, b2, t2, t1], color.right) +
    polygon([t0, t1, t2, t3], color.top)
  );
}

export function renderCalendar(payload) {
  const calendar =
    payload && payload.data && payload.data.user && payload.data.user.contributionsCollection
      ? payload.data.user.contributionsCollection.contributionCalendar
      : null;
  if (!calendar || typeof calendar !== 'object' || !Array.isArray(calendar.weeks)) {
    throw new Error('contributionCalendar 缺失或结构无效');
  }

  const { days, minDate, maxDate } = collectDays(calendar);
  const maxCount = days.reduce((max, d) => (d.count > max ? d.count : max), 0);
  const maxWeek = days.reduce((max, d) => (d.wi > max ? d.wi : max), 0);
  const nWeeks = maxWeek + 1;
  const weekDX = Math.min(WEEK_DX, (RIGHT_LIMIT - ORIGIN_X) / Math.max(nWeeks, 1));
  const weekDY = WEEK_DY * (weekDX / WEEK_DX);

  const cells = days.map((day) => {
    const baseX = ORIGIN_X + day.wi * weekDX + day.weekday * DAY_DX;
    const baseY = ORIGIN_Y + day.wi * weekDY + day.weekday * DAY_DY;
    const height = day.count > 0 && maxCount > 0 ? MAX_BAR * Math.sqrt(day.count / maxCount) : ZERO_BAR;
    return { date: day.date, count: day.count, weekday: day.weekday, wi: day.wi, baseX, baseY, height };
  });
  // 按基准 y 从远到近绘制，避免方柱遮挡顺序错误。
  cells.sort(
    (a, b) =>
      a.baseY - b.baseY ||
      a.wi - b.wi ||
      a.weekday - b.weekday ||
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
  );

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}" role="img" aria-label="${escapeXml(USERNAME)} 的 GitHub 贡献日历">`,
  );
  parts.push(`<title>${escapeXml(USERNAME)} 的 GitHub 贡献日历</title>`);
  parts.push(
    `<rect x="0.5" y="0.5" width="${VIEW_W - 1}" height="${VIEW_H - 1}" rx="16" fill="#0d1117" stroke="#303b4d" stroke-width="1"/>`,
  );
  parts.push(
    `<text x="24" y="40" font-family="${FONT}" font-size="20" font-weight="700" fill="#e6edf3">贡献日历</text>`,
  );
  parts.push(
    `<text x="${VIEW_W - 24}" y="40" font-family="${FONT}" font-size="12" fill="#7d8590" text-anchor="end">持续在开源的路上</text>`,
  );

  if (days.length > 0) {
    const p0 = [ORIGIN_X, ORIGIN_Y];
    const p1 = [ORIGIN_X + nWeeks * weekDX, ORIGIN_Y + nWeeks * weekDY];
    const p2 = [p1[0] + 7 * DAY_DX, p1[1] + 7 * DAY_DY];
    const p3 = [ORIGIN_X + 7 * DAY_DX, ORIGIN_Y + 7 * DAY_DY];
    parts.push(polygon([p0, p1, p2, p3], '#11161d', '#21262d'));
  }

  const groups = cells.map((cell) => {
    const title = `${cell.date}：${num(cell.count)} 次贡献`;
    return `<g data-date="${escapeXml(cell.date)}" data-count="${num(cell.count)}"><title>${escapeXml(
      title,
    )}</title>${buildColumn(cell, weekDX, weekDY)}</g>`;
  });
  parts.push(groups.join(''));

  const monthStart = new Map();
  for (const day of days) {
    const current = monthStart.get(day.wi);
    if (current === undefined || day.date < current) monthStart.set(day.wi, day.date);
  }
  let lastMonth = '';
  const labels = [];
  for (const wi of [...monthStart.keys()].sort((a, b) => a - b)) {
    const month = monthStart.get(wi).slice(0, 7);
    if (month === lastMonth) continue;
    lastMonth = month;
    const index = Number(month.slice(5, 7));
    if (!Number.isInteger(index) || index < 1 || index > 12) continue;
    const x = ORIGIN_X + wi * weekDX + 6 * DAY_DX;
    labels.push(
      `<text x="${num(x)}" y="292" font-family="${FONT}" font-size="12" fill="#6e7681">${MONTHS[index - 1]}</text>`,
    );
  }
  parts.push(labels.join(''));

  const totalRaw = Number(calendar.totalContributions);
  const total = Number.isFinite(totalRaw) ? totalRaw : days.reduce((sum, d) => sum + d.count, 0);
  const source =
    minDate && maxDate
      ? `${minDate} – ${maxDate} · 共 ${num(total)} 次贡献 · 数据来自 GitHub`
      : '数据来自 GitHub';
  parts.push(
    `<text x="24" y="336" font-family="${FONT}" font-size="12" fill="#6e7681">${escapeXml(source)}</text>`,
  );

  parts.push('</svg>');
  return parts.join('\n');
}

const QUERY = `query {
  user(login: "${USERNAME}") {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            weekday
            color
          }
        }
      }
    }
  }
}`;

function parseArgs(argv) {
  const options = { input: null, output: path.resolve(process.cwd(), DEFAULT_OUTPUT) };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' || arg === '--output') {
      const value = argv[i + 1];
      if (!value) throw new Error(`参数 ${arg} 缺少路径`);
      if (arg === '--input') options.input = path.resolve(process.cwd(), value);
      else options.output = path.resolve(process.cwd(), value);
      i += 1;
    } else if (arg.startsWith('--input=')) {
      options.input = path.resolve(process.cwd(), arg.slice('--input='.length));
    } else if (arg.startsWith('--output=')) {
      options.output = path.resolve(process.cwd(), arg.slice('--output='.length));
    } else {
      throw new Error(`未知参数 ${arg}`);
    }
  }
  return options;
}

async function loadPayload(options) {
  if (options.input) {
    return JSON.parse(await readFile(options.input, 'utf8'));
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('缺少 GITHUB_TOKEN 环境变量，且未提供 --input');
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': `${USERNAME}-contributions-renderer`,
    },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!response.ok) throw new Error(`GitHub API 请求失败：HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const payload = await loadPayload(options);
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const messages = payload.errors.map((e) => (e && e.message) || '未知错误').join('; ');
    throw new Error(`GraphQL 返回错误：${messages}`);
  }
  const svg = renderCalendar(payload);
  await writeFile(options.output, svg, 'utf8');
  process.stdout.write(`已生成 ${options.output}\n`);
}

// 仅在被直接执行时跑 CLI，被测试 import 时保持纯函数模块。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`生成失败：${error && error.message ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
