// node --import ./tests/support/register.mjs: lets tests import main-process sources (see ts-resolve.mjs).
import { register } from 'node:module'

register('./ts-resolve.mjs', import.meta.url)
