/* 사이트와 같은 질문 정의·교육과정 데이터를 패키지 안으로 복사한다(저장소 안에서 실행하는 prepack용). */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
for (const f of ['planning.js', 'curriculum-data.js']) {
  const from = join(root, f), to = join(here, '..', 'data', f);
  if (existsSync(from)) copyFileSync(from, to);
  else if (!existsSync(to)) throw new Error(`${f}를 찾을 수 없어요.`);
}
