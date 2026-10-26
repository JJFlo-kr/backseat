// Readable Markdown of a rules set and skill contexts for the profile export; the overview part comes from
// src/shared/uiux/overviewText.ts, the same text the overview view saves. Every statement carries
// its provenance in words (never by marker or colour alone), written by the same helpers as the overview. Pure; all text is a message key (UI language).
// tests/uiux-app-export.test.ts
import type { Translate } from '../../shared/i18n.ts'
import { BUILTIN_SKILL } from '../../shared/uiux/builtin.ts'
import { claimMd, mdText, overviewToMarkdown } from '../../shared/uiux/overviewText.ts'
import type { DesignRules, ProjectOverview, ProjectProfile, SkillContext } from '../../shared/uiux/types.ts'

const day = (iso: string): string => (iso || '').slice(0, 10)

/** path: value lines of the design values (nested objects flattened). */
function flattenTokens(v: unknown, prefix = ''): string[] {
  if (v === null) return [`${prefix}: -`]
  if (typeof v !== 'object') return [`${prefix}: ${mdText(String(v ?? ''))}`]
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => flattenTokens(x, prefix ? `${prefix}.${k}` : k))
}

function rulesToMarkdown(r: DesignRules, tr: Translate): string[] {
  const lines = ['', `## ${tr('uiux.export.rules.title', { revision: r.revision })}`]
  if (r.skill) {
    const builtin = r.skill.id === BUILTIN_SKILL.id
    lines.push(tr('uiux.export.rules.skill', { skill: builtin ? tr('uiux.panel.builtinSkill') : mdText(r.skill.name), version: builtin ? '' : mdText(r.skill.version ?? '') }))
  }
  lines.push('', `### ${tr('uiux.export.rules.values')}`, ...flattenTokens(r.tokens).map((l) => `- ${l}`))
  lines.push('', `### ${tr('uiux.export.rules.locks')}`, ...(r.locks.length ? r.locks.map((l) => `- ${mdText(l)}`) : [`- ${tr('uiux.export.ov.none')}`]))
  if (r.componentRules.length) lines.push('', `### ${tr('uiux.export.rules.components')}`, ...r.componentRules.map((c) => `- ${mdText(c)}`))
  const screens = Object.entries(r.pageOverrides)
  if (screens.length) {
    lines.push('', `### ${tr('uiux.export.rules.screens')}`)
    for (const [screen, values] of screens) lines.push(`- ${mdText(screen)}: ${Object.entries(values).map(([k, x]) => `${k} = ${mdText(JSON.stringify(x))}`).join(', ')}`)
  }
  lines.push('', `### ${tr('uiux.export.rules.themes')}`, `- ${r.themes.map(mdText).join(', ')}`)
  return lines
}

function skillContextToMarkdown(c: SkillContext, tr: Translate): string[] {
  const lines = ['', `### ${mdText(c.skill.name)}${c.skill.version ? ` ${mdText(c.skill.version)}` : ''}`]
  for (const [k, f] of Object.entries(c.fields)) lines.push(...claimMd(f, tr, `- ${mdText(k)}:`))
  if (c.missing.length) lines.push(`- ${tr('uiux.export.skills.missing')}: ${c.missing.map(mdText).join(', ')}`)
  return lines
}

/** The Markdown that sits beside the profile JSON. */
export function profileToMarkdown(
  parts: { profile: ProjectProfile; rules: DesignRules | null; overview: ProjectOverview | null; skillContexts: SkillContext[]; exportedAt: string },
  tr: Translate
): string {
  const { profile, rules, overview, skillContexts } = parts
  const lines = [`# ${tr('uiux.export.profile.title', { name: mdText(profile.name) })}`, '']
  if (profile.repo) lines.push(`- ${tr('uiux.export.profile.repo', { repo: mdText(profile.repo) })}`)
  lines.push(`- ${tr('uiux.export.profile.exported', { date: day(parts.exportedAt) })}`)
  lines.push(`- ${tr('uiux.export.profile.noPaths')}`)
  if (rules) lines.push(...rulesToMarkdown(rules, tr))
  if (skillContexts.length) {
    lines.push('', `## ${tr('uiux.export.skills.title')}`)
    for (const c of skillContexts) lines.push(...skillContextToMarkdown(c, tr))
  }
  if (overview) {
    // The overview keeps its own title; it follows as a section of this file.
    lines.push('', overviewToMarkdown(overview, tr, { projectName: profile.name, headingOffset: 1 }).trimEnd())
  }
  return lines.join('\n') + '\n'
}
