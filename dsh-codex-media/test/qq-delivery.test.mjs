// Unit tests for the optional direct QQ delivery bridge. A local HTTP server
// impersonates OneBot v11; Aurabot's data dir is a temp fixture, so no real QQ
// connection or credentials are touched.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import {
  QqDeliveryError,
  defaultAurabotDataDir,
  deliverImageToQq,
} from '../lib/qq-delivery.mjs'

const TINY_PNG = await readFile(new URL('./fixtures/tiny.png', import.meta.url))
const scratchDirs = []
const servers = []

async function scratch() {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-codex-media-qq-test-'))
  scratchDirs.push(dir)
  return dir
}

/** Start a fake OneBot HTTP server; resolves with its URL and captured requests. */
async function startOneBot(responder = () => ({ status: 'ok', retcode: 0, data: { message_id: 42 } })) {
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: body.length > 0 ? JSON.parse(body) : undefined })
    const reply = responder(requests[requests.length - 1])
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(reply))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const address = server.address()
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests }
}

/** Create an Aurabot data dir fixture. */
async function makeDataDir({ httpUrl, httpToken = 'tok', sessions = {}, enabled = true, dryRun = false }) {
  const dir = await scratch()
  await writeFile(path.join(dir, 'config.json'), JSON.stringify({
    enabled,
    dryRun,
    snowluma: { httpUrl, httpToken },
  }))
  await writeFile(path.join(dir, 'sessions.json'), JSON.stringify({ chats: sessions }))
  return dir
}

async function makeImage() {
  const dir = await scratch()
  const file = path.join(dir, 'image.png')
  await writeFile(file, TINY_PNG)
  return file
}

after(async () => {
  for (const server of servers) await new Promise((resolve) => server.close(resolve))
  for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true })
})

describe('deliverImageToQq', () => {
  it('sends a group image through OneBot with the stored token', async () => {
    const { baseUrl, requests } = await startOneBot()
    const dataDir = await makeDataDir({ httpUrl: baseUrl, sessions: { 'group:123456': { sessionId: 'session-a' } } })
    const imagePath = await makeImage()

    const result = await deliverImageToQq({ sessionId: 'session-a', imagePath, dataDir })
    assert.deepEqual(result, { status: 'sent', chatId: 'group:123456', kind: 'group', messageId: 42 })
    assert.equal(requests.length, 1)
    const request = requests[0]
    assert.equal(request.url, '/send_group_msg')
    assert.equal(request.headers.authorization, 'Bearer tok')
    assert.equal(request.body.group_id, 123456)
    assert.equal(request.body.message[0].type, 'image')
    const base64 = request.body.message[0].data.file.replace(/^base64:\/\//, '')
    assert.deepEqual([...Buffer.from(base64, 'base64')], [...TINY_PNG])
  })

  it('sends private images through send_private_msg', async () => {
    const { baseUrl, requests } = await startOneBot()
    const dataDir = await makeDataDir({ httpUrl: baseUrl, sessions: { 'private:777': { sessionId: 'session-b' } } })
    const imagePath = await makeImage()
    const result = await deliverImageToQq({ sessionId: 'session-b', imagePath, dataDir })
    assert.deepEqual(result, { status: 'sent', chatId: 'private:777', kind: 'private', messageId: 42 })
    assert.equal(requests[0].url, '/send_private_msg')
    assert.equal(requests[0].body.user_id, 777)
  })

  it('skips when the session is not an Aurabot chat', async () => {
    const { baseUrl, requests } = await startOneBot()
    const dataDir = await makeDataDir({ httpUrl: baseUrl, sessions: { 'group:1': { sessionId: 'other' } } })
    const imagePath = await makeImage()
    const result = await deliverImageToQq({ sessionId: 'session-x', imagePath, dataDir })
    assert.deepEqual(result, { status: 'skipped', reason: 'not-an-aurabot-chat' })
    assert.equal(requests.length, 0)
  })

  it('respects Aurabot disabled / dry-run state', async () => {
    const { baseUrl, requests } = await startOneBot()
    const imagePath = await makeImage()
    const disabled = await makeDataDir({ httpUrl: baseUrl, sessions: { 'group:1': { sessionId: 's' } }, enabled: false })
    assert.deepEqual(await deliverImageToQq({ sessionId: 's', imagePath, dataDir: disabled }), { status: 'skipped', reason: 'aurabot-disabled' })
    const dryRun = await makeDataDir({ httpUrl: baseUrl, sessions: { 'group:1': { sessionId: 's' } }, dryRun: true })
    assert.deepEqual(await deliverImageToQq({ sessionId: 's', imagePath, dataDir: dryRun }), { status: 'skipped', reason: 'aurabot-dry-run' })
    assert.equal(requests.length, 0)
  })

  it('skips when OneBot HTTP is not configured', async () => {
    const dataDir = await makeDataDir({ httpUrl: '', sessions: { 'group:1': { sessionId: 's' } } })
    const imagePath = await makeImage()
    assert.deepEqual(await deliverImageToQq({ sessionId: 's', imagePath, dataDir }), { status: 'skipped', reason: 'no-onebot-http' })
  })

  it('reports a missing image and an oversized image', async () => {
    const { baseUrl } = await startOneBot()
    const dataDir = await makeDataDir({ httpUrl: baseUrl, sessions: { 'group:1': { sessionId: 's' } } })
    await assert.rejects(
      deliverImageToQq({ sessionId: 's', imagePath: path.join(dataDir, 'nope.png'), dataDir }),
      (error) => error instanceof QqDeliveryError && error.code === 'IMAGE_MISSING',
    )
    const imagePath = await makeImage()
    await assert.rejects(
      deliverImageToQq({ sessionId: 's', imagePath, dataDir, maxBytes: 10 }),
      (error) => error instanceof QqDeliveryError && error.code === 'IMAGE_TOO_LARGE',
    )
  })

  it('turns a non-zero retcode into SEND_REJECTED with the chat id', async () => {
    const { baseUrl } = await startOneBot(() => ({ status: 'failed', retcode: 100, message: 'bad token' }))
    const dataDir = await makeDataDir({ httpUrl: baseUrl, sessions: { 'group:9': { sessionId: 's' } } })
    const imagePath = await makeImage()
    await assert.rejects(
      deliverImageToQq({ sessionId: 's', imagePath, dataDir }),
      (error) => {
        assert.ok(error instanceof QqDeliveryError)
        assert.equal(error.code, 'SEND_REJECTED')
        assert.match(error.message, /group:9/)
        assert.match(error.message, /retcode 100/)
        return true
      },
    )
  })

  it('reports an unreachable OneBot endpoint as HTTP_FAILED', async () => {
    const dataDir = await makeDataDir({ httpUrl: 'http://127.0.0.1:1', sessions: { 'group:1': { sessionId: 's' } } })
    const imagePath = await makeImage()
    await assert.rejects(
      deliverImageToQq({ sessionId: 's', imagePath, dataDir, timeoutMs: 2000 }),
      (error) => error instanceof QqDeliveryError && error.code === 'HTTP_FAILED',
    )
  })
})

describe('defaultAurabotDataDir', () => {
  it('prefers AURABOT_DATA_DIR and otherwise uses DSH_HOME/plugins-data/aurabot', () => {
    assert.equal(defaultAurabotDataDir({ AURABOT_DATA_DIR: '/x/aurabot', DSH_HOME: '/h' }), '/x/aurabot')
    assert.equal(defaultAurabotDataDir({ DSH_HOME: '/h' }), path.join('/h', 'plugins-data', 'aurabot'))
    assert.equal(defaultAurabotDataDir({}), undefined)
  })
})
