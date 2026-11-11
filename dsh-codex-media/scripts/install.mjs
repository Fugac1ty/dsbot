#!/usr/bin/env node
/**
 * Install `dsh-codex-media` into a DSH profile without pnpm.
 *
 * The plugin is a normal bundle package. Installation is therefore two edits in
 * the profile plus one symlink:
 *
 *   1. profile/package.json : dependency  "dsh-codex-vision": "link:<pluginDir>"
 *   2. profile/package.json : dsh.profile.bundles 末尾加 "dsh-codex-vision"
 *   3. profile/node_modules/dsh-codex-vision -> <pluginDir>
 *
 * A running profile with HMR enabled recomposes as soon as the bundle list
 * changes, so `codex_vision` appears without a restart. Without HMR, restart
 * the DSH process.
 *
 * Usage:
 *   node scripts/install.mjs --profile /path/to/$DSH_HOME/profiles/web
 *   node scripts/install.mjs --dsh-home /path/to/dsh-home --profile-name web
 *   node scripts/install.mjs --profile ... --dry-run
 *   node scripts/install.mjs --profile ... --uninstall
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_NAME = 'dsh-codex-media'
const PACKAGE_JSON = 'package.json'

/** @param {string[]} argv @returns {Record<string, string|boolean>} */
function parseArgs(argv) {
  const result = { profileName: 'web', dryRun: false, uninstall: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    switch (token) {
      case '--profile':
        result.profile = argv[++index]
        break
      case '--dsh-home':
        result.dshHome = argv[++index]
        break
      case '--profile-name':
        result.profileName = argv[++index]
        break
      case '--dry-run':
        result.dryRun = true
        break
      case '--uninstall':
        result.uninstall = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
      default:
        if (token.startsWith('-')) fail(`未知参数：${token}`)
    }
  }
  return result
}

function printHelp() {
  console.log(`用法：
  node scripts/install.mjs --profile <profile 目录>
  node scripts/install.mjs --dsh-home <DSH_HOME> [--profile-name web]
  node scripts/install.mjs --profile <profile 目录> --dry-run
  node scripts/install.mjs --profile <profile 目录> --uninstall

默认 profile 目录：$DSH_HOME/profiles/web（$DSH_HOME 缺省为 ~/.dsh）。`)
}

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(`dsh-codex-media install: ${message}`)
  process.exit(1)
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read and parse the profile manifest. @param {string} file @returns {Record<string, any>} */
function readManifest(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    fail(`无法读取 ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
    if (!isObject(parsed)) fail(`${file} 不是 JSON 对象`)
    return parsed
  } catch (error) {
    fail(`${file} 不是合法 JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Atomically write JSON with a timestamped backup. @param {string} file @param {Record<string, any>} value @param {boolean} dryRun */
function writeManifest(file, value, dryRun) {
  const text = `${JSON.stringify(value, null, 2)}\n`
  if (dryRun) {
    console.log(`[dry-run] 将写入 ${file}:`)
    console.log(text)
    return
  }
  if (existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = `${file}.bak-${stamp}`
    writeFileSync(backup, readFileSync(file))
    console.log(`备份：${backup}`)
  }
  const temporary = `${file}.tmp-${process.pid}`
  writeFileSync(temporary, text)
  renameSync(temporary, file)
}

/** @param {string} profileDir @param {boolean} dryRun */
function ensureLink(profileDir, dryRun) {
  const nodeModules = join(profileDir, 'node_modules')
  const linkPath = join(nodeModules, PLUGIN_NAME)
  const existing = existsSync(linkPath) || safeLstat(linkPath) !== undefined
  if (existing) {
    const stat = safeLstat(linkPath)
    if (stat?.isSymbolicLink() || stat?.isDirectory()) {
      console.log(`已存在 ${linkPath}，保持不变`)
      return
    }
    fail(`${linkPath} 已存在且不是目录/软链，请手工处理`)
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}创建链接：${linkPath} -> ${PLUGIN_DIR}`)
  if (dryRun) return
  mkdirSync(nodeModules, { recursive: true })
  symlinkSync(PLUGIN_DIR, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

/** @param {string} target @returns {import('node:fs').Stats|undefined} */
function safeLstat(target) {
  try {
    return lstatSync(target)
  } catch {
    return undefined
  }
}

/** @param {string} profileDir @param {Record<string, any>} manifest */
function install(profileDir, manifest, dryRun) {
  const spec = `link:${PLUGIN_DIR}`
  const dependencies = isObject(manifest.dependencies) ? manifest.dependencies : (manifest.dependencies = {})
  if (dependencies[PLUGIN_NAME] !== spec) {
    console.log(`${dryRun ? '[dry-run] ' : ''}依赖：${PLUGIN_NAME} -> ${spec}`)
    dependencies[PLUGIN_NAME] = spec
  }

  const profile = isObject(manifest.dsh?.profile) ? manifest.dsh.profile : (manifest.dsh = { profile: {} }).profile
  const bundles = Array.isArray(profile.bundles) ? profile.bundles : (profile.bundles = [])
  if (!bundles.includes(PLUGIN_NAME)) {
    console.log(`${dryRun ? '[dry-run] ' : ''}启用 bundle：${PLUGIN_NAME}`)
    bundles.push(PLUGIN_NAME)
  } else {
    console.log(`bundle 已启用：${PLUGIN_NAME}`)
  }

  writeManifest(join(profileDir, PACKAGE_JSON), manifest, dryRun)
  ensureLink(profileDir, dryRun)
  console.log('')
  console.log('完成。若 profile 开着 HMR，会在几秒内自动加载 codex_vision；否则重启 DSH 进程。')
  console.log('验证方式：让 agent 调用 codex_imagegen（生图）或 codex_vision（识图），或在 GUI 的新会话里查看工具列表。')
  console.log('Codex 未登录时工具会提示：在宿主机执行 `codex login`（或 `printenv OPENAI_API_KEY | codex login --with-api-key`）。')
}

/** @param {string} profileDir @param {Record<string, any>} manifest */
function uninstall(profileDir, manifest, dryRun) {
  if (isObject(manifest.dependencies) && PLUGIN_NAME in manifest.dependencies) {
    console.log(`${dryRun ? '[dry-run] ' : ''}移除依赖：${PLUGIN_NAME}`)
    delete manifest.dependencies[PLUGIN_NAME]
  }
  const bundles = manifest.dsh?.profile?.bundles
  if (Array.isArray(bundles)) {
    const index = bundles.indexOf(PLUGIN_NAME)
    if (index !== -1) {
      console.log(`${dryRun ? '[dry-run] ' : ''}停用 bundle：${PLUGIN_NAME}`)
      bundles.splice(index, 1)
    }
  }
  writeManifest(join(profileDir, PACKAGE_JSON), manifest, dryRun)
  const linkPath = join(profileDir, 'node_modules', PLUGIN_NAME)
  const stat = safeLstat(linkPath)
  if (stat !== undefined) {
    console.log(`${dryRun ? '[dry-run] ' : ''}删除链接：${linkPath}`)
    if (!dryRun) {
      if (stat.isSymbolicLink() || stat.isDirectory()) rmSync(linkPath, { recursive: true, force: true })
      else unlinkSync(linkPath)
    }
  }
  console.log('完成。重启或等待 HMR 后 codex_vision 消失。')
}

const options = parseArgs(process.argv.slice(2))
const explicitProfile = typeof options.profile === 'string' ? resolve(options.profile) : undefined
const dshHome = typeof options.dshHome === 'string' ? resolve(options.dshHome) : resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const profileName = typeof options.profileName === 'string' ? options.profileName : 'web'
const profileDir = explicitProfile ?? join(dshHome, 'profiles', profileName)

if (!existsSync(join(profileDir, PACKAGE_JSON))) {
  fail(`找不到 profile manifest：${join(profileDir, PACKAGE_JSON)}（用 --profile 或 --dsh-home 指定正确位置）`)
}
console.log(`插件目录：${PLUGIN_DIR}`)
console.log(`profile：${profileDir}（${basename(profileDir)}）`)
console.log('')

const manifest = readManifest(join(profileDir, PACKAGE_JSON))
if (options.uninstall === true) uninstall(profileDir, manifest, options.dryRun === true)
else install(profileDir, manifest, options.dryRun === true)
