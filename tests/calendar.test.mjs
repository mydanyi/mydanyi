// 贡献日历渲染的最小行为测试。数据是少量内联固定值，临时文件只落在 ../work 下。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCalendar } from '../scripts/render-calendar.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, '..', 'scripts', 'render-calendar.mjs');
const workDir = path.resolve(here, '..', '..', 'work');
const tmpDir = path.join(workDir, 'calendar-test-tmp');

const VIEW_W = 960;
const VIEW_H = 360;

function day(date, weekday, contributionCount) {
  return { date, weekday, contributionCount, color: '#ebedf0' };
}

function payload(weeks, totalContributions) {
  return {
    data: {
      user: {
        contributionsCollection: {
          contributionCalendar: {
            totalContributions: totalContributions,
            weeks: weeks.map((contributionDays) => ({ contributionDays })),
          },
        },
      },
    },
  };
}

function groups(svg) {
  const found = [];
  const re = /<g data-date="([^"]+)" data-count="([^"]+)">/g;
  let match;
  while ((match = re.exec(svg)) !== null) found.push({ date: match[1], count: match[2] });
  return found;
}

function polygons(svg) {
  const found = [];
  const re = /<polygon points="([^"]+)"/g;
  let match;
  while ((match = re.exec(svg)) !== null) found.push(match[1]);
  return found;
}

function coordsOf(polygonPoints) {
  return polygonPoints
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number));
}

// 只取指定日期 <g data-date="..."> 组内的方柱多边形，排除独立背景底板等其它 polygon。
function columnPolygons(svg, date) {
  const groupRe = new RegExp(`<g data-date="${date}" data-count="[^"]*">([\\s\\S]*?)</g>`);
  const group = groupRe.exec(svg);
  assert.ok(group, `未找到日期 ${date} 的方柱组`);
  const found = [];
  const polyRe = /<polygon points="([^"]+)"/g;
  let match;
  while ((match = polyRe.exec(group[1])) !== null) found.push(coordsOf(match[1]));
  return found;
}

test('保留每个日期的日期与次数，总格数正确', () => {
  const input = payload(
    [
      [day('2026-01-01', 3, 1), day('2026-01-02', 4, 2), day('2026-01-03', 5, 11), day('2026-01-04', 6, 0)],
      [
        day('2026-01-05', 0, 4),
        day('2026-01-06', 1, 0),
        day('2026-01-07', 2, 7),
        day('2026-01-08', 3, 0),
        day('2026-01-09', 4, 3),
        day('2026-01-10', 5, 1),
        day('2026-01-11', 6, 9),
      ],
    ],
    38,
  );

  const svg = renderCalendar(input);
  const cells = groups(svg);
  assert.equal(cells.length, 11, '总格数应为 11');
  assert.deepEqual(
    Object.fromEntries(cells.map((c) => [c.date, c.count])),
    {
      '2026-01-01': '1',
      '2026-01-02': '2',
      '2026-01-03': '11',
      '2026-01-04': '0',
      '2026-01-05': '4',
      '2026-01-06': '0',
      '2026-01-07': '7',
      '2026-01-08': '0',
      '2026-01-09': '3',
      '2026-01-10': '1',
      '2026-01-11': '9',
    },
  );
});

test('首尾不完整周按 weekday 定位，而不是按数组下标', () => {
  const Sunday = renderCalendar(payload([[day('2026-01-04', 0, 0)]], 0));
  const Saturday = renderCalendar(payload([[day('2026-01-10', 6, 0)]], 0));

  // 方柱底面（最大 y）与柱高无关，只反映基准位置；仅读各自日期组内的多边形。
  const baseY = (svg, date) =>
    Math.max(...columnPolygons(svg, date).flatMap((poly) => poly.map(([, y]) => y)));

  // 6 天 * 日向量 8.5 = 51px 的纵向差，体现按 weekday 放置。
  assert.ok(Math.abs(baseY(Saturday, '2026-01-10') - baseY(Sunday, '2026-01-04') - 51) < 0.01, 'weekday 应决定纵向位置');
});

test('全零贡献不产生 NaN 或 Infinity', () => {
  const svg = renderCalendar(
    payload([[0, 1, 2, 3, 4, 5, 6].map((wd, i) => day(`2026-01-0${i + 4}`, wd, 0))], 0),
  );
  assert.equal(groups(svg).length, 7);
  assert.ok(!/NaN|Infinity/.test(svg), '输出不应包含 NaN/Infinity');
});

test('极高次数仍把坐标限制在 viewBox 内', () => {
  const svg = renderCalendar(
    payload([[day('2026-01-04', 0, 100000), day('2026-01-05', 1, 1), day('2026-01-06', 2, 0)]], 100001),
  );
  assert.ok(!/NaN/.test(svg));
  for (const poly of polygons(svg)) {
    for (const [x, y] of coordsOf(poly)) {
      assert.ok(Number.isFinite(x) && x >= 0 && x <= VIEW_W, `x=${x} 越界`);
      assert.ok(Number.isFinite(y) && y >= 0 && y <= VIEW_H, `y=${y} 越界`);
    }
  }
});

test('相同输入输出完全稳定', () => {
  const input = payload([[day('2026-01-04', 0, 5), day('2026-01-05', 1, 12)]], 17);
  assert.equal(renderCalendar(input), renderCalendar(JSON.parse(JSON.stringify(input))));
});

test('GraphQL 失败时 CLI 非零退出且不覆盖已有文件', async () => {
  await mkdir(tmpDir, { recursive: true });
  const keepPath = path.join(tmpDir, 'keep.svg');
  const badPath = path.join(tmpDir, 'bad.json');
  try {
    await writeFile(keepPath, 'KEEP', 'utf8');

    await writeFile(badPath, JSON.stringify({ errors: [{ message: 'boom' }] }), 'utf8');
    let result = spawnSync(process.execPath, [scriptPath, '--input', badPath, '--output', keepPath], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'GraphQL errors 应导致非零退出');
    assert.equal(await readFile(keepPath, 'utf8'), 'KEEP');

    await writeFile(badPath, JSON.stringify({ data: { user: null } }), 'utf8');
    result = spawnSync(process.execPath, [scriptPath, '--input', badPath, '--output', keepPath], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'user 为 null 应导致非零退出');
    assert.equal(await readFile(keepPath, 'utf8'), 'KEEP');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
