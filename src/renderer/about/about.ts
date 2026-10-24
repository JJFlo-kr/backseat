const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

void window.backseat.about.getInfo().then((info) => {
  document.title = `${info.name} 정보`
  $('name').textContent = info.name
  $('version').textContent = `버전 ${info.version}`
  $('tagline').textContent = info.tagline
  $('license').textContent = `라이선스: ${info.license}`
  $('btn-repo').addEventListener('click', () => void window.backseat.about.open(info.repoUrl))
  $('btn-support').addEventListener('click', () => void window.backseat.about.open(info.supportUrl))
  $('btn-issues').addEventListener('click', () => void window.backseat.about.open(info.issuesUrl))
  document.body.dataset.ready = '1'
})

$('link-license').addEventListener('click', () => void window.backseat.about.openDoc('license'))
$('link-notices').addEventListener('click', () => void window.backseat.about.openDoc('notices'))
