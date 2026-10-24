// Every message bundle, for the main process and the MCP server (renderers never import this: they get
// a merged bundle in their init message). Import attributes let plain Node (the unit tests) load it too.
import type { Locale, Messages } from './i18n'
import ko from '../locales/ko.json' with { type: 'json' }
import en from '../locales/en.json' with { type: 'json' }
import ja from '../locales/ja.json' with { type: 'json' }
import zhCN from '../locales/zh-CN.json' with { type: 'json' }
import zhTW from '../locales/zh-TW.json' with { type: 'json' }
import es from '../locales/es.json' with { type: 'json' }
import ptBR from '../locales/pt-BR.json' with { type: 'json' }
import de from '../locales/de.json' with { type: 'json' }
import fr from '../locales/fr.json' with { type: 'json' }

export const BUNDLES: Record<Locale, Messages> = {
  ko,
  en,
  ja,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  es,
  'pt-BR': ptBR,
  de,
  fr
}
