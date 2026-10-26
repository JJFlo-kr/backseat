// UI/UX tools in the app: one store under <userData>/uiux and the editor's IPC for it.
// Renderer input is checked here too (lengths, tokens, folders): the renderer is sandboxed but not trusted.
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { IPC } from '../../shared/ipc'
import type { UiuxProjectState, UserOverviewInput } from '../../shared/types'
import { UIUX_SCHEMA_VERSION, type ProjectProfile, type SkillRef } from '../../shared/uiux/types'
import { readTokens } from '../../shared/uiux/validate'
import { assertSafeId, UiuxStore } from './store'

let store: UiuxStore | null = null

/** The app's UI/UX store (created on first use; userData exists once the app is ready). */
export function uiuxStore(): UiuxStore {
  store ??= new UiuxStore(join(app.getPath('userData'), 'uiux'))
  return store
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const texts = (v: unknown, max: number, count = 12): string[] => (Array.isArray(v) ? v.map((x) => text(x, max)).filter(Boolean).slice(0, count) : [])
const TOKEN_PATH = /^(colors|ratio|shadows|type|box)(\.[A-Za-z]+){0,2}$/

export async function projectState(projectId: string): Promise<UiuxProjectState | null> {
  const s = uiuxStore()
  const profile = await s.getProject(assertSafeId(projectId, 'projectId'))
  if (!profile) return null
  const [overview, rules, paths] = await Promise.all([s.getOverview(projectId), s.getRules(projectId), s.getPaths()])
  return { profile, overview, rules, folder: paths.paths[projectId] ?? null }
}

/** Spec §5.5: without an agent the user types the basics; everything is marked as the user's, basis "user". */
export async function saveUserOverview(projectId: string, input: UserOverviewInput) {
  const s = uiuxStore()
  if (!(await s.getProject(assertSafeId(projectId, 'projectId')))) throw new Error('unknown project')
  const prev = await s.getOverview(projectId)
  const user = (value: string) => ({ value, source: 'user' as const })
  const screens = texts(input.screenKinds, 80)
  return s.saveOverview({
    schemaVersion: UIUX_SCHEMA_VERSION,
    projectId,
    basis: 'user',
    summary: user(text(input.summary, 300)),
    purpose: user(text(input.purpose, 1000)),
    goals: texts(input.goals, 200).map(user),
    audiences: texts(input.audiences, 300).map(user),
    // An agent's structure and flows stay until the user replaces them through an agent again.
    workflows: prev?.workflows ?? [],
    architecture: prev?.architecture ?? { nodes: [], edges: [] },
    stack: prev?.stack ?? [],
    designState: [...(prev?.designState.filter((c) => !c.value.startsWith('screen:')) ?? []), ...screens.map((k) => user(`screen: ${k}`))],
    designConstraints: prev?.designConstraints ?? [],
    sources: prev?.sources ?? [],
    unknowns: prev?.unknowns ?? [],
    generatedAt: new Date().toISOString()
  })
}

export function installUiuxIpc(): void {
  ipcMain.handle(IPC.uiuxListProjects, () => uiuxStore().listProjects())
  ipcMain.handle(IPC.uiuxCreateProject, (_e, f: { name?: unknown; repo?: unknown }) => {
    const name = text(f?.name, 80)
    if (!name) throw new Error('a project needs a name')
    const repo = text(f?.repo, 200)
    return uiuxStore().createProject(repo ? { name, repo } : { name })
  })
  ipcMain.handle(IPC.uiuxSaveProject, async (_e, p: ProjectProfile) => {
    const cur = await uiuxStore().getProject(assertSafeId(text(p?.projectId, 64), 'projectId'))
    if (!cur) throw new Error('unknown project')
    // Only the fields the panel edits; ids, timestamps and schema stay the store's.
    const next: ProjectProfile = { ...cur, name: text(p.name, 80) || cur.name }
    const repo = text(p.repo, 200)
    if (repo) next.repo = repo
    else delete next.repo
    const agentId = text(p.agentId, 64)
    if (agentId) next.agentId = agentId
    else delete next.agentId
    const skills = texts(p.skillIds, 64, 20).filter((id) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id))
    if (skills.length) next.skillIds = skills
    else delete next.skillIds
    return uiuxStore().saveProject(next)
  })
  ipcMain.handle(IPC.uiuxProjectState, (_e, projectId: unknown) => projectState(text(projectId, 64)))
  ipcMain.handle(IPC.uiuxSaveUserOverview, (_e, projectId: unknown, input: UserOverviewInput) => saveUserOverview(text(projectId, 64), input ?? ({} as UserOverviewInput)))
  ipcMain.handle(IPC.uiuxSaveRules, async (_e, projectId: unknown, r: { tokens?: unknown; locks?: unknown; skill?: SkillRef }) => {
    const pid = assertSafeId(text(projectId, 64), 'projectId')
    const tokens = readTokens(r?.tokens)
    if (!tokens.ok) throw new Error(`invalid design values: ${tokens.errors.slice(0, 3).join('; ')}`)
    const locks = texts(r?.locks, 60, 80).filter((p) => TOKEN_PATH.test(p))
    const prev = await uiuxStore().getRules(pid)
    const next = {
      projectId: pid,
      tokens: tokens.value,
      locks,
      pageOverrides: prev?.pageOverrides ?? {},
      componentRules: prev?.componentRules ?? [],
      themes: prev?.themes ?? ['light']
    }
    const skill = r?.skill && typeof r.skill.id === 'string' ? { id: text(r.skill.id, 64), name: text(r.skill.name, 80), source: r.skill.source } : prev?.skill
    return uiuxStore().saveRules(skill ? { ...next, skill } : next)
  })
  ipcMain.handle(IPC.uiuxSetPath, (_e, projectId: unknown, folder: unknown) => {
    const f = folder === null ? null : text(folder, 400)
    if (f !== null && !(existsSync(f) && statSync(f).isDirectory())) throw new Error('not a folder')
    return uiuxStore().setPath(text(projectId, 64), f)
  })
  ipcMain.handle(IPC.uiuxPickFolder, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const r = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })
}
