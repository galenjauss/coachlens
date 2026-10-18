/** Remotion CLI/Studio config. The webpack override (real app imports) lives in webpack-override.mjs. */
import { Config } from '@remotion/cli/config'
// @ts-expect-error plain ESM module shared with scripts/*.mjs
import { webpackOverride } from './webpack-override.mjs'

Config.setVideoImageFormat('jpeg')
Config.setJpegQuality(95)
Config.setOverwriteOutput(true)
Config.setChromiumOpenGlRenderer('angle')
Config.overrideWebpackConfig(webpackOverride)
