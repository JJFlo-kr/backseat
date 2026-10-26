/**
 * A stand-in for the project's agent in the UI/UX self-test: it answers jobs through the same code the MCP job
 * tools use (openJob = backseat_job_get, submitJobResult = backseat_job_submit), against the self-test's
 * temporary store. Results are synthetic and project-relative; they only exercise the panel's B–D flows.
 */
import { openJob, submitJobResult } from './mcp/jobs'
import { uiuxStore } from './uiux/appstore'
import { listJobs } from './uiux/jobs-app'
import { defaultTokens } from '../shared/uiux/builtin'
import type { DesignTokens, JobType, UiuxJob } from '../shared/uiux/types'

const ev = [{ path: 'src/App.tsx', note: 'screens' }]

/** The newest job of a type for the project, once the panel created it. */
export async function newestJob(projectId: string, type: JobType): Promise<UiuxJob | undefined> {
  return (await listJobs(projectId)).filter((j) => j.type === type).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

function results(projectId: string, job: UiuxJob): unknown {
  switch (job.type) {
    case 'project_overview':
      return {
        projectId,
        summary: { value: '작은 팀의 할 일 관리 앱', source: 'verified', evidence: [{ path: 'README.md' }] },
        purpose: { value: '팀의 할 일을 한곳에서 빠르게 확인하고 정리한다', source: 'verified', evidence: [{ path: 'README.md' }] },
        goals: [{ value: '빠른 확인', source: 'estimated' }, { value: '가독성', source: 'user' }],
        audiences: [{ value: '팀장과 팀원', source: 'verified', evidence: [{ path: 'docs/users.md' }] }],
        workflows: [
          { id: 'w-add', name: '할 일 추가', steps: ['대시보드 열기', '새 할 일 입력', '담당자 지정'], screens: ['dash', 'editor'], source: 'verified' },
          { id: 'w-review', name: '오늘 할 일 확인', steps: ['로그인', '대시보드 보기'], screens: ['login', 'dash'], source: 'estimated' }
        ],
        architecture: {
          nodes: [
            { id: 'login', type: 'screen', label: '로그인', source: 'verified', evidence: ev },
            { id: 'dash', type: 'screen', label: '대시보드', source: 'verified', evidence: ev },
            { id: 'editor', type: 'screen', label: '할 일 편집', parent: 'dash', source: 'estimated' },
            { id: 'api', type: 'module', label: 'API 클라이언트', source: 'verified', evidence: [{ path: 'src/api.ts' }] },
            { id: 'db', type: 'external', label: '작업 서버', source: 'unknown' }
          ],
          edges: [
            { from: 'login', to: 'dash', relation: '로그인 후 이동', source: 'verified', evidence: ev },
            { from: 'dash', to: 'api', relation: '목록 요청', source: 'verified', evidence: [{ path: 'src/api.ts' }] },
            { from: 'api', to: 'db', relation: 'HTTP', source: 'estimated' }
          ]
        },
        stack: [{ value: 'React 18', source: 'verified', evidence: [{ path: 'package.json' }] }],
        designState: [{ value: '파란 계열 기본색, 둥근 버튼', source: 'estimated' }],
        designConstraints: [{ value: '표는 촘촘하게 유지', source: 'user' }],
        sources: [{ path: 'README.md' }, { path: 'src/App.tsx' }],
        unknowns: ['다크 모드 계획']
      }
    case 'capabilities':
      return { skills: [{ id: 'ui-ux-pro-max', name: 'UI UX Pro Max', source: 'agent', version: '28b3b8d', description: '디자인 규칙 검색 스킬' }] }
    case 'skill_setup':
      return {
        projectId,
        skillId: job.skillId,
        fields: {
          product_type: { value: 'productivity SaaS', source: 'verified', evidence: [{ path: 'README.md' }] },
          stack: { value: 'react', source: 'verified', evidence: [{ path: 'package.json' }] }
        },
        missing: ['brand_colors']
      }
    case 'design_proposal': {
      const base = defaultTokens()
      const variant = (id: string, direction: string, name: string, primary: string, radius: number): unknown => {
        const tokens: DesignTokens = JSON.parse(JSON.stringify(base)) as DesignTokens
        tokens.colors.primary = primary
        tokens.box.radius = radius
        return { proposalId: id, projectId, direction, name, rationale: `${name}: 빠른 확인과 가독성을 우선합니다.`, tokens, changes: [`primary → ${primary}`, `radius → ${radius}`], preserved: ['표 밀도'], checks: [], previewKind: 'sample' }
      }
      return { proposals: [variant('A', 'A', '최소 변경', '#1D4ED8', 6), variant('B', 'B', '균형', '#0F766E', 8), variant('C', 'C', '다른 방향', '#7C3AED', 12)] }
    }
    case 'style_audit':
      return { findings: [{ area: '버튼', issue: '모서리 둥글기가 세 가지로 섞여 있음', source: 'verified', evidence: [{ path: 'src/styles/button.css', note: 'line 12' }], suggestion: '모서리를 8px로 통일' }] }
    case 'implementation_report':
      return { summary: '기본 버튼 색과 모서리를 요청한 값으로 바꿨습니다.', changedFiles: [{ path: 'src/styles/button.css', note: 'primary, radius' }], notDone: ['다크 모드는 범위 밖이라 하지 않음'], checksRun: ['npm test'] }
  }
}

/** Fetch and answer a job like an agent would. Returns the outcome kind (with the errors when rejected). */
export async function answerJob(projectId: string, job: UiuxJob): Promise<string> {
  const store = uiuxStore()
  await openJob(store, job.jobId)
  const out = await submitJobResult(store, { jobId: job.jobId, inputRevision: job.inputRevision, result: results(projectId, job) })
  return out.kind === 'rejected' ? `rejected: ${out.errors.slice(0, 3).join('; ')}` : out.kind
}
