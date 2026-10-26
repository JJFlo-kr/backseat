// Fixture for the overview tests: a small valid ProjectOverview and architecture builders.
import type { ArchEdge, ArchNode, Architecture, Claim, ProjectOverview, Provenance } from '../../src/shared/uiux/types.ts'

export const node = (id: string, type: ArchNode['type'] = 'module', extra: Partial<ArchNode> = {}): ArchNode =>
  ({ id, type, label: id, source: 'verified', ...extra })
export const edge = (from: string, to: string, extra: Partial<ArchEdge> = {}): ArchEdge =>
  ({ from, to, relation: 'uses', source: 'verified', ...extra })
export const claim = (value: string, source: Provenance = 'verified', paths: string[] = []): Claim =>
  ({ value, source, evidence: paths.map((path) => ({ path })) })

export const overview = (arch?: Architecture): ProjectOverview => ({
  schemaVersion: 1, projectId: 'p1', revision: 3, basis: 'agent',
  summary: claim('Capture tool for AI coding', 'verified', ['README.md']),
  purpose: claim('Tell the agent what is wrong on screen', 'estimated'),
  goals: [claim('Fast comparison of numbers', 'user'), claim('Brand expression', 'estimated'), claim('Trust and security', 'unknown'), claim('Have fun', 'estimated')],
  audiences: [claim('Developers using Claude Code', 'verified', ['docs/users.md'])],
  workflows: [{ id: 'w1', name: 'Send a capture', steps: ['Press hotkey', 'Draw', 'Press Enter'], screens: ['editor', 'ghost'], source: 'verified' }],
  architecture: arch ?? {
    nodes: [node('editor', 'screen', { evidence: [{ path: 'src/renderer/editor/editor.ts' }] }), node('main', 'module'),
      node('store', 'store', { source: 'estimated' }), node('mcp', 'external', { source: 'unknown' }),
      node('tools', 'module', { parent: 'main', label: 'Tools <b>x</b>' })],
    edges: [edge('editor', 'main'), edge('main', 'store', { source: 'estimated' }), edge('main', 'mcp'), edge('tools', 'store')]
  },
  stack: [claim('Electron 45', 'verified', ['package.json'])],
  designState: [claim('Dark editor chrome', 'verified')],
  designConstraints: [claim('Fit 760 px', 'user')],
  sources: [{ path: 'README.md' }],
  unknowns: ['License terms'],
  questions: ['Who pays?'],
  generatedAt: '2026-10-27T00:00:00Z'
})
