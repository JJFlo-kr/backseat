import { applyDom, isLocale, setMessages, t } from '../../shared/i18n'
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

void window.backseat.about.getInfo().then((info) => {
  setMessages(isLocale(info.locale) ? info.locale : 'ko', info.messages ?? {})
  applyDom(document)
  document.title = t('about.windowTitle', { name: info.name })
  $('name').textContent = info.name
  $('version').textContent = t('about.version', { version: info.version })
  $('tagline').textContent = info.tagline
  $('license').textContent = t('about.license', { license: info.license })
  $('btn-repo').addEventListener('click', () => void window.backseat.about.open(info.repoUrl))
  $('btn-support').addEventListener('click', () => void window.backseat.about.open(info.supportUrl))
  $('btn-issues').addEventListener('click', () => void window.backseat.about.open(info.issuesUrl))
  document.body.dataset.ready = '1'
})

$('link-license').addEventListener('click', () => void window.backseat.about.openDoc('license'))
$('link-notices').addEventListener('click', () => void window.backseat.about.openDoc('notices'))
