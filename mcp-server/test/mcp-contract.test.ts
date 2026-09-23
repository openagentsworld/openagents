import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import WebSocket, { type RawData } from 'ws';

type RecordValue = Record<string, unknown>;

const serverPath = fileURLToPath(new URL('../../../server.js', import.meta.url));
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const mcpEntry = fileURLToPath(new URL('../src/index.js', import.meta.url));

function environment(overrides: Record<string, string>): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
  return { ...inherited, ...overrides };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(baseUrl: string, child: ChildProcess, stderr: () => string): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`OpenAgents test server exited early: ${stderr()}`);
    try {
      const response = await fetch(`${baseUrl}/api/auth/config`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for OpenAgents test server: ${stderr()}`);
}

async function post(baseUrl: string, pathname: string, payload: RecordValue): Promise<RecordValue> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.json() as RecordValue;
  if (!response.ok || body.ok === false) throw new Error(String(body.error || body.message || `HTTP ${response.status}`));
  return body;
}

async function registerAccount(baseUrl: string, loginId: string, email: string, password: string, nickname: string): Promise<RecordValue> {
  const registered = await post(baseUrl, '/api/auth/register', { loginId, email, password, nickname });
  const code = String(registered.testVerificationCode || '');
  assert.ok(code, 'test verification code must be returned');
  return post(baseUrl, '/api/auth/verify', { loginId, email, code, nickname });
}

function structured(result: Awaited<ReturnType<Client['callTool']>>): RecordValue {
  return result.structuredContent as RecordValue || {};
}

async function createMcpClient(baseUrl: string, loginId: string, password: string) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpEntry],
    cwd: projectRoot,
    stderr: 'pipe',
    env: environment({
      OPENAGENTS_BASE_URL: baseUrl,
      OPENAGENTS_ALLOW_INSECURE_LOCALHOST: 'true',
      OPENAGENTS_LOGIN_ID: loginId,
      OPENAGENTS_PASSWORD: password,
      OPENAGENTS_REQUEST_TIMEOUT_MS: '4000'
    })
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
  const client = new Client({ name: `test-${loginId}`, version: '1.0.0' });
  await client.connect(transport);
  return { client, transport, stderr: () => stderr };
}

function waitForWsMessage(socket: WebSocket, predicate: (message: RecordValue) => boolean, timeoutMs = 5_000): Promise<RecordValue> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);
    const onMessage = (data: RawData): void => {
      const message = JSON.parse(data.toString()) as RecordValue;
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
  });
}

async function joinObserver(wsUrl: string, authToken: string, name: string): Promise<WebSocket> {
  const socket = new WebSocket(wsUrl);
  const connected = waitForWsMessage(socket, (message) => message.type === 'connected');
  await connected;
  const joined = waitForWsMessage(socket, (message) => message.type === 'joined');
  socket.send(JSON.stringify({
    type: 'join', authToken, name, room: 'beach', avatar: '#6366f1', avatarType: 'ai_bot'
  }));
  await joined;
  return socket;
}

test('MCP authenticates, spawns characters, runs marketplace lifecycle, and exposes owner delivery', { timeout: 45_000 }, async (t) => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}`;
  const stateDir = await mkdtemp(join(tmpdir(), 'openagents-mcp-test-'));
  let serverStderr = '';
  const server = spawn(process.execPath, [serverPath], {
    cwd: projectRoot,
    env: environment({
      PORT: String(port),
      PUBLIC_BASE_URL: baseUrl,
      OPENAGENTS_TEST_MODE: 'true',
      OPENAGENTS_PAYMENT_MOCK: 'true',
      OPENAGENTS_REVIEW_MODE: 'off',
      OPENAGENTS_AMBIENT_AGENT_COUNT: '0',
      OPENAGENTS_STATE_FILE: join(stateDir, 'state.json'),
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_BOT_USERNAME: '',
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '', RESEND_API_KEY: '',
      VIBECRAFT_TRIGGER_URL: ''
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (chunk) => { serverStderr = `${serverStderr}${chunk.toString()}`.slice(-20_000); });
  server.stdout.on('data', () => {});

  let ownerMcp: Awaited<ReturnType<typeof createMcpClient>> | null = null;
  let workerMcp: Awaited<ReturnType<typeof createMcpClient>> | null = null;
  let outsiderMcp: Awaited<ReturnType<typeof createMcpClient>> | null = null;
  let observer: WebSocket | null = null;
  let replacement: WebSocket | null = null;
  t.after(async () => {
    replacement?.close();
    observer?.close();
    await Promise.allSettled([ownerMcp?.client.close(), workerMcp?.client.close(), outsiderMcp?.client.close()].filter(Boolean) as Promise<void>[]);
    if (server.exitCode === null) server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (server.exitCode === null) server.kill('SIGKILL');
    await rm(stateDir, { recursive: true, force: true });
  });

  await waitForServer(baseUrl, server, () => serverStderr);

  const ownerPassword = 'OwnerPass!12345';
  const workerPassword = 'WorkerPass!12345';
  const outsiderPassword = 'OutsiderPass!12345';
  const observerAuth = await registerAccount(baseUrl, 'mcpobserver', 'mcpobserver@example.test', 'ObserverPass!12345', 'MCP Observer');
  await registerAccount(baseUrl, 'mcpowner', 'mcpowner@example.test', ownerPassword, 'MCP Owner');
  await registerAccount(baseUrl, 'mcpworker', 'mcpworker@example.test', workerPassword, 'MCP Worker');
  await registerAccount(baseUrl, 'mcpoutsider', 'mcpoutsider@example.test', outsiderPassword, 'MCP Outsider');

  ownerMcp = await createMcpClient(baseUrl, 'mcpowner', ownerPassword);
  workerMcp = await createMcpClient(baseUrl, 'mcpworker', workerPassword);

  const tools = await ownerMcp.client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      'openagents_cancel_task',
      'openagents_claim_task',
      'openagents_create_task',
      'openagents_get_notifications',
      'openagents_get_review_feedback',
      'openagents_list_tasks',
      'openagents_login',
      'openagents_move',
      'openagents_read_chat',
      'openagents_send_chat',
      'openagents_submit_delivery',
      'openagents_submit_files',
      'openagents_task_status'
    ]
  );

  const ownerLogin = await ownerMcp.client.callTool({
    name: 'openagents_login',
    arguments: { avatarType: 'cyborg', avatarColor: '#123456' }
  });
  const workerLogin = await workerMcp.client.callTool({
    name: 'openagents_login',
    arguments: { avatarType: 'pixel_agent' }
  });
  assert.equal(ownerLogin.isError, undefined);
  assert.equal(workerLogin.isError, undefined);
  const ownerAccount = structured(ownerLogin).account as RecordValue;
  const workerAccount = structured(workerLogin).account as RecordValue;
  assert.equal(ownerAccount.avatarType, 'cyborg');
  assert.equal(workerAccount.avatarType, 'pixel_agent');

  observer = await joinObserver(wsUrl, String(observerAuth.authToken), 'MCP Observer');
  const usersPromise = waitForWsMessage(observer, (message) => message.type === 'user_list');
  observer.send(JSON.stringify({ type: 'list' }));
  const users = await usersPromise;
  const userIds = (users.users as RecordValue[]).map((user) => user.id);
  assert.ok(userIds.includes(ownerAccount.id), 'owner MCP character must be visible');
  assert.ok(userIds.includes(workerAccount.id), 'worker MCP character must be visible');

  const reviewInstructions = 'Run npm test; verify the primary CTA works and no console errors occur.';
  const createResult = await ownerMcp.client.callTool({
    name: 'openagents_create_task',
    arguments: {
      title: 'MCP lifecycle fixture',
      description: 'Build and verify the MCP lifecycle fixture.',
      budget: 0,
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
      skills: ['Node.js', 'MCP'],
      acceptedTargets: ['github'],
      preferredLocation: 'https://github.com/openagentsworld/mcp-e2e-fixture',
      defaultTestCommand: 'npm test',
      reviewInstructions
    }
  });
  assert.equal(createResult.isError, undefined);
  const taskId = String((structured(createResult).task as RecordValue).id);
  assert.match(taskId, /^proj-/);

  const workerOpen = await workerMcp.client.callTool({
    name: 'openagents_list_tasks', arguments: { scope: 'open', limit: 25 }
  });
  const openTasks = structured(workerOpen).tasks as RecordValue[];
  const openTask = openTasks.find((task) => task.id === taskId);
  assert.equal(openTask?.description, 'Build and verify the MCP lifecycle fixture.');
  assert.equal((openTask?.deliveryPreferences as RecordValue).reviewInstructions, reviewInstructions);

  const claimResult = await workerMcp.client.callTool({
    name: 'openagents_claim_task', arguments: { taskId }
  });
  assert.equal((structured(claimResult).task as RecordValue).status, 'in_progress');

  const sourceUrl = 'https://github.com/openagentsworld/mcp-e2e-fixture/tree/completed';
  const submitResult = await workerMcp.client.callTool({
    name: 'openagents_submit_delivery',
    arguments: {
      taskId,
      deliverables: ['Implemented fixture and passed npm test.'],
      source: 'github',
      sourceUrl,
      repo: 'https://github.com/openagentsworld/mcp-e2e-fixture',
      branch: 'completed',
      commitSha: 'abcdef1234567890',
      testCommand: 'npm test',
      notes: 'All acceptance checks passed.'
    }
  });
  assert.equal((structured(submitResult).task as RecordValue).status, 'under_review');

  const ownerBeforeReview = await ownerMcp.client.callTool({
    name: 'openagents_list_tasks', arguments: { scope: 'mine', limit: 25 }
  });
  const hiddenTask = (structured(ownerBeforeReview).tasks as RecordValue[]).find((task) => task.id === taskId)!;
  assert.equal(hiddenTask.deliveryAvailable, false);
  assert.equal((hiddenTask.delivery as RecordValue).redactedUntilPaid, true);

  await post(baseUrl, '/api/review-result', {
    projectId: taskId,
    decision: 'passed',
    notes: 'MCP contract test passed',
    reviewedBy: 'mcp-contract-test'
  });

  const ownerAfterReview = await ownerMcp.client.callTool({
    name: 'openagents_list_tasks', arguments: { scope: 'mine', limit: 25 }
  });
  const deliveredTask = (structured(ownerAfterReview).tasks as RecordValue[]).find((task) => task.id === taskId)!;
  assert.equal(deliveredTask.deliveryAvailable, true);
  assert.deepEqual(deliveredTask.deliverables, ['Implemented fixture and passed npm test.']);
  assert.equal((deliveredTask.delivery as RecordValue).sourceUrl, sourceUrl);
  assert.equal((deliveredTask.deliveryPreferences as RecordValue).reviewInstructions, reviewInstructions);

  // Review feedback tool: fail path with evidence, owner+worker visibility, third-party denial.
  const failCreate = await ownerMcp.client.callTool({
    name: 'openagents_create_task',
    arguments: {
      title: 'MCP review feedback fixture',
      description: 'Fails review so the worker can read the feedback back.',
      budget: 0,
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
      skills: ['Node.js'],
      acceptedTargets: ['github'],
      preferredLocation: 'https://github.com/openagentsworld/mcp-e2e-fixture',
      reviewInstructions: 'Run npm test and verify the CTA.'
    }
  });
  assert.equal(failCreate.isError, undefined);
  const failTaskId = String((structured(failCreate).task as RecordValue).id);

  const preClaimFeedback = structured(await ownerMcp.client.callTool({
    name: 'openagents_get_review_feedback', arguments: { taskId: failTaskId }
  }));
  assert.equal(preClaimFeedback.taskId, failTaskId);
  assert.equal(preClaimFeedback.status, 'not_requested');
  assert.ok(preClaimFeedback.review === null || (preClaimFeedback.review as RecordValue).status === 'not_requested');

  assert.equal((structured(await workerMcp.client.callTool({
    name: 'openagents_claim_task', arguments: { taskId: failTaskId }
  })).task as RecordValue).status, 'in_progress');

  assert.equal((structured(await workerMcp.client.callTool({
    name: 'openagents_submit_delivery',
    arguments: {
      taskId: failTaskId,
      deliverables: ['Fixture delivered but install fails.'],
      source: 'github',
      sourceUrl: 'https://github.com/openagentsworld/mcp-e2e-fixture/tree/broken',
      repo: 'https://github.com/openagentsworld/mcp-e2e-fixture',
      branch: 'broken',
      commitSha: '1234567890abcdef',
      testCommand: 'npm test'
    }
  })).task as RecordValue).status, 'under_review');

  const failNotes = 'Install step failed; fix the lockfile.';
  await post(baseUrl, '/api/review-result', {
    projectId: failTaskId,
    decision: 'fail',
    notes: failNotes,
    reviewedBy: 'mcp-contract-test',
    evidence: {
      steps: [
        { name: 'clone', status: 'ok', output: 'SECRET-RAW-OUTPUT clone' },
        { name: 'install', status: 'failed', output: 'npm ERR! SECRET-RAW-OUTPUT install', findings: ['SECRET-FINDING'], fatalErrors: ['SECRET-FATAL'] }
      ],
      blockers: ['npm install failed'],
      warnings: ['legacy dependencies']
    }
  });

  const workerFeedback = structured(await workerMcp.client.callTool({
    name: 'openagents_get_review_feedback', arguments: { taskId: failTaskId }
  }));
  assert.equal(workerFeedback.taskId, failTaskId);
  const failedReview = workerFeedback.review as RecordValue;
  assert.equal(failedReview.decision, 'fail');
  assert.equal(failedReview.notes, failNotes);
  assert.equal(failedReview.reviewerName, 'mcp-contract-test');
  assert.equal(workerFeedback.status, 'failed');
  const failSummary = failedReview.evidenceSummary as RecordValue;
  assert.deepEqual(failSummary.steps, [
    { name: 'clone', status: 'ok' },
    { name: 'install', status: 'failed' }
  ]);
  assert.deepEqual(failSummary.blockers, ['npm install failed']);
  assert.deepEqual(failSummary.warnings, ['legacy dependencies']);
  assert.doesNotMatch(JSON.stringify(workerFeedback), /SECRET-RAW-OUTPUT|SECRET-FINDING|SECRET-FATAL/);

  const ownerFeedback = structured(await ownerMcp.client.callTool({
    name: 'openagents_get_review_feedback', arguments: { taskId: failTaskId }
  }));
  assert.equal((ownerFeedback.review as RecordValue).decision, 'fail');

  outsiderMcp = await createMcpClient(baseUrl, 'mcpoutsider', outsiderPassword);
  await outsiderMcp.client.callTool({ name: 'openagents_login', arguments: {} });

  // Invisible task (not in the outsider's open/mine lists): denied without leaking existence.
  const deniedUnseen = await outsiderMcp.client.callTool({
    name: 'openagents_get_review_feedback', arguments: { taskId: failTaskId }
  });
  assert.equal(deniedUnseen.isError, true);
  assert.equal(structured(deniedUnseen).code, 'PROJECT_NOT_FOUND');
  assert.equal(structured(deniedUnseen).retryable, false);

  // Visible-but-forbidden task (open listing): explicit participant-only denial.
  const openCreate = await ownerMcp.client.callTool({
    name: 'openagents_create_task',
    arguments: {
      title: 'MCP open visibility fixture',
      description: 'Stays open so a non-participant can probe the feedback tool.',
      budget: 0,
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
      skills: ['Node.js'],
      acceptedTargets: ['github'],
      preferredLocation: 'https://github.com/openagentsworld/mcp-e2e-fixture',
      reviewInstructions: 'Run npm test and verify the CTA.'
    }
  });
  const openTaskId = String((structured(openCreate).task as RecordValue).id);
  const denied = await outsiderMcp.client.callTool({
    name: 'openagents_get_review_feedback', arguments: { taskId: openTaskId }
  });
  assert.equal(denied.isError, true);
  assert.equal(structured(denied).code, 'NOT_PARTICIPANT');
  assert.equal(structured(denied).retryable, false);

  // M3: account notifications — same source and field names as the web AI Worker Feedback box.
  const workerNotifs = structured(await workerMcp.client.callTool({
    name: 'openagents_get_notifications', arguments: {}
  }));
  assert.equal(workerNotifs.unreadOnly, true);
  assert.ok((workerNotifs.unreadCount as number) >= 1);
  const workerFailed = (workerNotifs.notifications as RecordValue[]).find(
    item => item.type === 'review_failed' && (item.data as RecordValue)?.projectId === failTaskId
  );
  assert.ok(workerFailed, 'worker must see its review_failed notification');
  assert.equal(workerFailed!.read, false);
  assert.ok(typeof workerFailed!.message === 'string' && workerFailed!.message.includes(failTaskId));
  assert.ok(typeof workerFailed!.createdAt === 'number');

  // (ii) userId isolation: the owner account never sees the worker's review_failed notification.
  const ownerNotifs = structured(await ownerMcp.client.callTool({
    name: 'openagents_get_notifications', arguments: { unreadOnly: false, limit: 50 }
  }));
  assert.equal(ownerNotifs.unreadOnly, false);
  assert.ok(!(ownerNotifs.notifications as RecordValue[]).some(
    item => item.type === 'review_failed' && (item.data as RecordValue)?.projectId === failTaskId
  ), 'owner must not see the worker review_failed notification');
  const outsiderNotifs = structured(await outsiderMcp.client.callTool({
    name: 'openagents_get_notifications', arguments: { unreadOnly: false }
  }));
  assert.equal((outsiderNotifs.notifications as RecordValue[]).length, 0);
  assert.equal(outsiderNotifs.unreadCount, 0);

  // (i, read half) Mark the worker notification read through a raw WS session, re-login the
  // worker MCP client, and prove unreadOnly=false still returns it while unreadOnly=true hides it.
  const workerRelogin = await post(baseUrl, '/api/auth/login', { loginId: 'mcpworker', password: workerPassword });
  const workerRawWs = await joinObserver(wsUrl, String(workerRelogin.authToken), 'Worker Raw Reader');
  const rawList = await new Promise<RecordValue>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('raw notifications_list timeout')), 5000);
    workerRawWs.on('message', (data: RawData) => {
      const message = JSON.parse(data.toString()) as RecordValue;
      if (message.type !== 'notifications_list') return;
      clearTimeout(timer);
      resolve(message);
    });
    workerRawWs.send(JSON.stringify({ type: 'notifications_get' }));
  });
  const rawTarget = (rawList.notifications as RecordValue[]).find(
    item => item.type === 'review_failed' && (item.data as RecordValue)?.projectId === failTaskId
  )!;
  assert.ok(rawTarget, 'raw session must see the worker notification');
  await new Promise<RecordValue>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('raw notifications_marked_read timeout')), 5000);
    workerRawWs.on('message', (data: RawData) => {
      const message = JSON.parse(data.toString()) as RecordValue;
      if (message.type !== 'notifications_marked_read') return;
      clearTimeout(timer);
      resolve(message);
    });
    workerRawWs.send(JSON.stringify({ type: 'notifications_read', notificationIds: [rawTarget.id] }));
  });
  workerRawWs.close();
  await workerMcp.client.callTool({ name: 'openagents_login', arguments: {} });
  const afterReadAll = structured(await workerMcp.client.callTool({
    name: 'openagents_get_notifications', arguments: { unreadOnly: false, limit: 50 }
  }));
  const readEntry = (afterReadAll.notifications as RecordValue[]).find(
    item => item.type === 'review_failed' && (item.data as RecordValue)?.projectId === failTaskId
  );
  assert.ok(readEntry, 'unreadOnly=false must still return the read notification');
  assert.equal(readEntry!.read, true);
  const afterReadUnread = structured(await workerMcp.client.callTool({
    name: 'openagents_get_notifications', arguments: { unreadOnly: true }
  }));
  assert.ok(!(afterReadUnread.notifications as RecordValue[]).some(
    item => (item.data as RecordValue)?.projectId === failTaskId
  ), 'unreadOnly=true must hide the read notification');

  // M4: task_status — open tasks visible to everyone, full fields to participants.
  const outsiderOpenStatus = structured(await outsiderMcp.client.callTool({
    name: 'openagents_task_status', arguments: { taskId: openTaskId }
  }));
  const openStatusTask = outsiderOpenStatus.task as RecordValue;
  assert.equal(openStatusTask.id, openTaskId);
  assert.equal(openStatusTask.status, 'open');
  assert.ok(typeof openStatusTask.deadline === 'string' && openStatusTask.deadline);
  assert.ok(!('payoutSummary' in openStatusTask), 'non-participants must not receive payoutSummary');

  const ownerStatus = structured(await ownerMcp.client.callTool({
    name: 'openagents_task_status', arguments: { taskId: failTaskId }
  }));
  const ownerStatusTask = ownerStatus.task as RecordValue;
  assert.equal(ownerStatusTask.status, 'review_failed');
  assert.equal(ownerStatusTask.paymentStatus, 'review_failed');
  assert.equal((ownerStatusTask.review as RecordValue).decision, 'fail');
  assert.ok('payoutSummary' in ownerStatusTask, 'participants must receive the payoutSummary field');

  const workerStatus = structured(await workerMcp.client.callTool({
    name: 'openagents_task_status', arguments: { taskId: failTaskId }
  }));
  assert.equal((workerStatus.task as RecordValue).paymentStatus, 'review_failed');

  const statusUnseen = await outsiderMcp.client.callTool({
    name: 'openagents_task_status', arguments: { taskId: failTaskId }
  });
  assert.equal(statusUnseen.isError, true);
  assert.equal(structured(statusUnseen).code, 'PROJECT_NOT_FOUND');

  // CANCEL_RF: owner can close review_failed tasks through MCP (escrow-free path);
  // lifecycle guards and the worker task_cancelled notification are contract-checked.
  // (i) non-owner worker attempt → NOT_OWNER before any WS cancel is sent.
  const workerCancelDenied = await workerMcp.client.callTool({
    name: 'openagents_cancel_task', arguments: { taskId: failTaskId }
  });
  assert.equal(workerCancelDenied.isError, true);
  assert.equal(structured(workerCancelDenied).code, 'NOT_OWNER');

  // (ii) invisible task for the outsider → denied without leaking existence.
  const outsiderCancelDenied = await outsiderMcp.client.callTool({
    name: 'openagents_cancel_task', arguments: { taskId: failTaskId }
  });
  assert.equal(outsiderCancelDenied.isError, true);
  assert.equal(structured(outsiderCancelDenied).code, 'PROJECT_NOT_FOUND');

  // (iii) owner cancels the review_failed task → cancelled + escrow-free payment cleanup.
  const ownerCancel = await ownerMcp.client.callTool({
    name: 'openagents_cancel_task', arguments: { taskId: failTaskId }
  });
  assert.equal(ownerCancel.isError, undefined);
  const cancelledTask = structured(ownerCancel).task as RecordValue;
  assert.equal(cancelledTask.status, 'cancelled');
  assert.equal(cancelledTask.paymentStatus, 'cancelled');

  // (iv) the worker receives a persisted task_cancelled notification for the project.
  const workerCancelNotifs = structured(await workerMcp.client.callTool({
    name: 'openagents_get_notifications', arguments: { unreadOnly: true, limit: 50 }
  }));
  const cancelNotif = (workerCancelNotifs.notifications as RecordValue[]).find(
    item => item.type === 'task_cancelled' && (item.data as RecordValue)?.projectId === failTaskId
  );
  assert.ok(cancelNotif, 'worker must see the task_cancelled notification');
  assert.equal((cancelNotif!.data as RecordValue).reason, 'cancelled_by_owner');
  assert.ok(String(cancelNotif!.message).includes(failTaskId));

  // (v) under_review tasks stay non-cancellable (review in progress).
  const underReviewCreate = await ownerMcp.client.callTool({
    name: 'openagents_create_task',
    arguments: {
      title: 'MCP under-review cancel guard fixture',
      description: 'Reaches under_review so the owner cancel attempt must be rejected.',
      budget: 0,
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
      skills: ['Node.js'],
      acceptedTargets: ['github'],
      preferredLocation: 'https://github.com/openagentsworld/mcp-e2e-fixture',
      reviewInstructions: 'Run npm test.'
    }
  });
  const underReviewTaskId = String((structured(underReviewCreate).task as RecordValue).id);
  await workerMcp.client.callTool({ name: 'openagents_claim_task', arguments: { taskId: underReviewTaskId } });
  await workerMcp.client.callTool({
    name: 'openagents_submit_delivery',
    arguments: {
      taskId: underReviewTaskId,
      deliverables: ['Guard fixture delivered.'],
      source: 'github',
      sourceUrl: 'https://github.com/openagentsworld/mcp-e2e-fixture/tree/guard',
      repo: 'https://github.com/openagentsworld/mcp-e2e-fixture',
      branch: 'guard',
      commitSha: 'fedcba0987654321',
      testCommand: 'npm test'
    }
  });
  const underReviewCancel = await ownerMcp.client.callTool({
    name: 'openagents_cancel_task', arguments: { taskId: underReviewTaskId }
  });
  assert.equal(underReviewCancel.isError, true);
  assert.equal(structured(underReviewCancel).code, 'INVALID_STATUS');

  const replacementAuth = await post(baseUrl, '/api/auth/login', { loginId: 'mcpowner', password: ownerPassword });
  replacement = await joinObserver(wsUrl, String(replacementAuth.authToken), 'Replacement Owner');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const displacedResult = await ownerMcp.client.callTool({
    name: 'openagents_list_tasks', arguments: { scope: 'mine', limit: 1 }
  });
  assert.equal(displacedResult.isError, true);
  assert.equal(structured(displacedResult).code, 'SESSION_REPLACED');

  assert.doesNotMatch(ownerMcp.stderr(), new RegExp(ownerPassword));
  assert.doesNotMatch(workerMcp.stderr(), new RegExp(workerPassword));
  assert.doesNotMatch(outsiderMcp.stderr(), new RegExp(outsiderPassword));
});
