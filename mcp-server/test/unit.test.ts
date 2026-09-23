import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { OpenAgentsClient } from '../src/client.js';
import { loadConfig } from '../src/config.js';
import { normalizeError, OpenAgentsError, redactSensitiveText } from '../src/errors.js';
import { projectToTask, selectTasks } from '../src/task-view.js';

test('config defaults to the production HTTPS and WSS origins', () => {
  const config = loadConfig({
    OPENAGENTS_LOGIN_ID: 'worker-1',
    OPENAGENTS_PASSWORD: 'test password value'
  });
  assert.equal(config.baseUrl.toString(), 'https://app.openagentsworld.com/');
  assert.equal(config.websocketUrl.toString(), 'wss://app.openagentsworld.com/');
});

test('config rejects insecure remote credential transport but permits explicit loopback tests', () => {
  assert.throws(
    () => loadConfig({ OPENAGENTS_BASE_URL: 'http://example.net' }),
    (error: unknown) => error instanceof OpenAgentsError && error.code === 'INSECURE_BASE_URL'
  );
  const local = loadConfig({
    OPENAGENTS_BASE_URL: 'http://127.0.0.1:8099',
    OPENAGENTS_ALLOW_INSECURE_LOCALHOST: 'true'
  });
  assert.equal(local.websocketUrl.toString(), 'ws://127.0.0.1:8099/');
});

test('redaction removes passwords and OpenAgents tokens from errors', () => {
  const password = 'test password value';
  const text = redactSensitiveText(
    `password=${password} Bearer abc.def oa_sub_exampletoken 0123456789abcdef0123456789abcdef0123456789abcdef`,
    [password]
  );
  assert.doesNotMatch(text, /test password value/);
  assert.doesNotMatch(text, /oa_sub_exampletoken/);
  assert.doesNotMatch(text, /0123456789abcdef0123456789abcdef0123456789abcdef/);

  const safe = normalizeError(new OpenAgentsError('TEST', `bad ${password}`), [password]);
  assert.equal(safe.code, 'TEST');
  assert.doesNotMatch(JSON.stringify(safe), /test password value/);
});

test('task projection includes owner delivery and review fields but strips credentials', () => {
  const task = projectToTask({
    id: 'proj-safe',
    title: 'Safe task',
    description: 'Full task description',
    budget: 50,
    currency: 'TRY',
    deadline: '2027-01-01T00:00:00.000Z',
    skills: ['Node.js'],
    status: 'under_review',
    paymentStatus: 'checkout_creating',
    owner: { id: 'acct-owner', name: 'Owner', email: 'private@example.test' },
    worker: { id: 'acct-worker', name: 'Worker', ip: '127.0.0.1' },
    deliveryPreferences: {
      acceptedTargets: ['github'],
      preferredLocation: 'https://github.com/openagentsworld/example',
      reviewInstructions: 'Run npm test and verify the CTA.'
    },
    deliverables: ['Delivery submitted. Hidden until payment is confirmed.'],
    deliveryAvailable: false,
    deliveryMeta: { source: 'github', redactedUntilPaid: true, token: 'must-not-escape' },
    submissionAccess: { token: 'oa_sub_must_not_escape' },
    review: {
      status: 'pending',
      notes: '',
      evidence: {
        steps: [
          {
            name: 'clone',
            status: 'ok',
            output: 'SECRET-RAW-OUTPUT clone',
            findings: ['SECRET-FINDING'],
            fatalErrors: ['SECRET-FATAL'],
            interactions: ['SECRET-INTERACTION']
          },
          { name: 'install', status: 'failed', output: 'npm ERR SECRET-RAW-OUTPUT install' }
        ],
        blockers: ['blocker-one', 'blocker-two'],
        warnings: ['warning-one']
      }
    },
    createdAt: 10
  });

  assert.equal(task.description, 'Full task description');
  assert.equal(task.deliveryPreferences.reviewInstructions, 'Run npm test and verify the CTA.');
  assert.deepEqual(task.deliverables, ['Delivery submitted. Hidden until payment is confirmed.']);
  assert.equal(task.deliveryAvailable, false);
  assert.equal(task.delivery?.redactedUntilPaid, true);
  assert.equal(task.paymentStatus, 'checkout_creating');
  assert.deepEqual(task.review?.evidenceSummary, {
    steps: [
      { name: 'clone', status: 'ok' },
      { name: 'install', status: 'failed' }
    ],
    blockers: ['blocker-one', 'blocker-two'],
    warnings: ['warning-one']
  });
  assert.doesNotMatch(
    JSON.stringify(task),
    /SECRET-RAW-OUTPUT|SECRET-FINDING|SECRET-FATAL|SECRET-INTERACTION|private@example|must-not-escape|oa_sub_/
  );

  // The platform submission target is surfaced for the worker, but the commit
  // token must never reach the model-facing view.
  const gatewayTask = projectToTask({
    id: 'proj-gateway',
    title: 'Gateway task',
    status: 'in_progress',
    worker: { id: 'acct-worker', name: 'Worker' },
    submissionAccess: {
      branch: 'proj-gateway',
      repo: 'https://github.com/openagentsworld/openagents-submissions',
      token: 'oa_sub_secret_must_not_escape',
      tokenVersion: 2,
      endpoint: 'https://app.openagentsworld.com/api/submissions/proj-gateway/commit',
      endpointPath: '/api/submissions/proj-gateway/commit',
      helperPath: '/api/submissions/helper/v1.mjs',
      lastSubmittedAt: null,
      lastCommitSha: null
    }
  });
  assert.equal(gatewayTask.submissionAccess?.branch, 'proj-gateway');
  assert.equal(gatewayTask.submissionAccess?.repo, 'https://github.com/openagentsworld/openagents-submissions');
  assert.equal(gatewayTask.submissionAccess?.endpoint, 'https://app.openagentsworld.com/api/submissions/proj-gateway/commit');
  assert.equal(gatewayTask.submissionAccess?.helperPath, '/api/submissions/helper/v1.mjs');
  assert.equal(gatewayTask.submissionAccess?.tokenVersion, 2);
  assert.doesNotMatch(JSON.stringify(gatewayTask), /oa_sub_|secret_must_not_escape/);

  // An incomplete target (no repo/endpoint) is omitted entirely.
  const partialGateway = projectToTask({
    id: 'proj-partial',
    worker: { id: 'acct-worker' },
    submissionAccess: { branch: 'proj-partial', token: 'oa_sub_partial' }
  });
  assert.equal(partialGateway.submissionAccess, null);

  // Defaults: review without evidence yields empty arrays; missing paymentStatus yields null.
  const withoutEvidence = projectToTask({
    id: 'proj-bare-review',
    title: 'Bare review',
    description: 'No evidence attached',
    budget: 1,
    currency: 'TRY',
    status: 'review_failed',
    review: { status: 'failed', notes: 'needs work' },
    createdAt: 5
  });
  assert.deepEqual(withoutEvidence.review?.evidenceSummary, { steps: [], blockers: [], warnings: [] });
  assert.equal(withoutEvidence.paymentStatus, null);

  const withoutReview = projectToTask({
    id: 'proj-bare',
    title: 'Bare',
    description: 'No review at all',
    budget: 1,
    currency: 'TRY',
    status: 'open',
    createdAt: 1
  });
  assert.equal(withoutReview.review, null);
  assert.equal(withoutReview.paymentStatus, null);
});

test('task listing filters, deduplicates, and paginates deterministically', () => {
  const raw = {
    openProjects: [
      { id: 'proj-2', title: 'Two', description: 'Second', budget: 75, currency: 'TRY', skills: ['React'], status: 'open', createdAt: 20 },
      { id: 'proj-1', title: 'One', description: 'First', budget: 50, currency: 'TRY', skills: ['Node.js'], status: 'open', createdAt: 10 }
    ],
    myProjects: [
      { id: 'proj-2', title: 'Two', description: 'Second', budget: 75, currency: 'TRY', skills: ['React'], status: 'open', createdAt: 20 }
    ]
  };
  const first = selectTasks(raw, { scope: 'all', minBudget: 50, currency: 'TRY', limit: 1 });
  assert.equal(first.totalMatched, 2);
  assert.deepEqual(first.tasks.map((task) => task.id), ['proj-2']);
  assert.ok(first.nextCursor);
  const second = selectTasks(raw, { scope: 'all', minBudget: 50, currency: 'TRY', limit: 1, cursor: first.nextCursor! });
  assert.deepEqual(second.tasks.map((task) => task.id), ['proj-1']);
  assert.equal(second.nextCursor, null);
});

// CANCEL_RF: cancelTask ön-kontrol tablosu. Sahte HTTP login + WS sunucu üzerinden:
// open/in_progress/review_failed kabul edilir ve WS project_cancel gönderilir;
// under_review/released/cancelled reddedilir (WS isteği hiç gitmez);
// owner-dışı NOT_OWNER, bilinmeyen kimlik PROJECT_NOT_FOUND.
test('cancelTask preflight accepts review_failed and rejects disallowed states', async () => {
  const account = { id: 'acct-owner', loginId: 'owner', nickname: 'Owner Test', avatarType: 'ai_bot', avatarColor: '#6366f1' };
  const project = (id: string, status: string, ownerId = 'acct-owner'): Record<string, unknown> => ({
    id, title: `Task ${id}`, description: `Fixture ${id}`, budget: 10, currency: 'TRY', status,
    owner: { id: ownerId, name: ownerId }, createdAt: 1
  });
  const openProjects = [project('proj-open', 'open'), project('proj-foreign', 'open', 'acct-other')];
  const myProjects = [
    project('proj-progress', 'in_progress'),
    project('proj-rf', 'review_failed'),
    project('proj-review', 'under_review'),
    project('proj-released', 'released'),
    project('proj-cancelled', 'cancelled')
  ];
  const cancelRequests: Array<Record<string, unknown>> = [];

  const httpServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.url === '/api/auth/login') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, authToken: 'unit-token', account }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Set<{ close: () => void }>();
  httpServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.send(JSON.stringify({ type: 'connected' }));
      ws.on('message', (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        if (message.type === 'join') {
          ws.send(JSON.stringify({ type: 'joined', account, room: 'beach', position: { x: 0, z: 0, rotationY: 0 } }));
        } else if (message.type === 'project_list') {
          ws.send(JSON.stringify({ type: 'project_list', openProjects, myProjects }));
        } else if (message.type === 'project_cancel') {
          cancelRequests.push(message);
          const target = [...openProjects, ...myProjects].find((item) => item.id === message.projectId);
          if (target && ['open', 'in_progress', 'review_failed'].includes(String(target.status))) {
            ws.send(JSON.stringify({
              type: 'project_updated',
              project: { ...target, status: 'cancelled', paymentStatus: 'cancelled' }
            }));
          } else {
            ws.send(JSON.stringify({ type: 'error', code: 'INVALID_STATUS', message: 'Cannot cancel this project' }));
          }
        }
      });
      ws.on('close', () => sockets.delete(ws));
    });
  });

  const config = loadConfig({
    OPENAGENTS_BASE_URL: `http://127.0.0.1:${port}`,
    OPENAGENTS_ALLOW_INSECURE_LOCALHOST: 'true',
    OPENAGENTS_LOGIN_ID: 'owner',
    OPENAGENTS_PASSWORD: 'unit password value',
    OPENAGENTS_REQUEST_TIMEOUT_MS: '2000'
  });
  const client = new OpenAgentsClient(config);
  try {
    await client.login();

    for (const taskId of ['proj-rf', 'proj-open', 'proj-progress']) {
      const result = await client.cancelTask(taskId);
      assert.equal(result.task.status, 'cancelled');
    }
    assert.deepEqual(
      cancelRequests.map((item) => item.projectId),
      ['proj-rf', 'proj-open', 'proj-progress'],
      'only open/in_progress/review_failed must reach the WS cancel request'
    );

    const expectCode = async (taskId: string, code: string) => {
      await assert.rejects(
        client.cancelTask(taskId),
        (error: unknown) => error instanceof OpenAgentsError && error.code === code
      );
    };
    await expectCode('proj-review', 'INVALID_STATUS');
    await expectCode('proj-released', 'INVALID_STATUS');
    await expectCode('proj-cancelled', 'INVALID_STATUS');
    await expectCode('proj-foreign', 'NOT_OWNER');
    await expectCode('proj-missing', 'PROJECT_NOT_FOUND');
    assert.equal(cancelRequests.length, 3, 'rejected preflights must not send WS cancel requests');
  } finally {
    await client.close();
    for (const socket of sockets) socket.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

/**
 * 22 Eyl: `/api/submissions/<id>/commit` dosyaları commit eder VE teslimi kendi
 * uygular; MCP'nin ardından WS üzerinden ikinci submit denemesi INVALID_STATUS
 * alıp `DELIVERY_SUBMIT_FAILED_AFTER_COMMIT` döndürüyordu (teslim gerçekten
 * düşmüşken). Bu üç senaryo o davranışı ve uzlaştırma yollarını kilitler.
 */
async function startSubmissionFixture(options: {
  gatewayResponse: Record<string, unknown>;
  projectStatusAfterCommit?: string;
  deliverResponse?: 'accept' | 'reject';
}) {
  const account = { id: 'acct-worker', loginId: 'worker-1', nickname: 'Worker One', avatarType: 'ai_bot', avatarColor: '#22c55e' };
  let project: Record<string, unknown> = {
    id: 'proj-submit',
    title: 'Submit fixture',
    description: 'Submission gateway fixture',
    budget: 50,
    currency: 'TRY',
    status: 'in_progress',
    owner: { id: 'acct-owner', name: 'acct-owner' },
    worker: { id: 'acct-worker', name: 'worker-1' },
    deliveryPreferences: { acceptedTargets: ['github'], preferredLocation: 'https://github.com/' },
    createdAt: 1
  };
  const gatewayRequests: Array<Record<string, unknown>> = [];
  const deliverRequests: Array<Record<string, unknown>> = [];

  const httpServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.url === '/api/auth/login') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, authToken: 'unit-token', account }));
        return;
      }
      if (req.url === '/api/submissions/proj-submit/commit') {
        gatewayRequests.push(JSON.parse(body || '{}') as Record<string, unknown>);
        if (options.projectStatusAfterCommit) {
          project = { ...project, status: options.projectStatusAfterCommit };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(options.gatewayResponse));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  project = {
    ...project,
    submissionAccess: {
      endpoint: `http://127.0.0.1:${port}/api/submissions/proj-submit/commit`,
      branch: 'proj-submit',
      repo: 'https://github.com/openagentsworld/openagents-submissions',
      token: 'oa_sub_unit_token'
    }
  };

  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Set<{ close: () => void }>();
  httpServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.send(JSON.stringify({ type: 'connected' }));
      ws.on('message', (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        if (message.type === 'join') {
          ws.send(JSON.stringify({ type: 'joined', account, room: 'beach', position: { x: 0, z: 0, rotationY: 0 } }));
        } else if (message.type === 'project_list') {
          ws.send(JSON.stringify({ type: 'project_list', openProjects: [], myProjects: [project] }));
        } else if (message.type === 'project_deliver') {
          deliverRequests.push(message);
          if (options.deliverResponse === 'reject') {
            ws.send(JSON.stringify({ type: 'error', code: 'SERVER_REJECTED', message: 'Delivery rejected by the platform.' }));
          } else {
            project = { ...project, status: 'under_review' };
            ws.send(JSON.stringify({ type: 'project_updated', project }));
          }
        }
      });
      ws.on('close', () => sockets.delete(ws));
    });
  });

  const config = loadConfig({
    OPENAGENTS_BASE_URL: `http://127.0.0.1:${port}`,
    OPENAGENTS_ALLOW_INSECURE_LOCALHOST: 'true',
    OPENAGENTS_LOGIN_ID: 'worker-1',
    OPENAGENTS_PASSWORD: 'unit password value',
    OPENAGENTS_REQUEST_TIMEOUT_MS: '2000'
  });
  return {
    client: new OpenAgentsClient(config),
    gatewayRequests,
    deliverRequests,
    async close() {
      for (const socket of sockets) socket.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  };
}

const SUBMIT_FILES = [{ path: 'index.html', content: '<h1>Fixture</h1>' }];

test('submitFiles skips the redundant submit when the gateway already applied the delivery', async () => {
  const fixture = await startSubmissionFixture({
    gatewayResponse: {
      ok: true,
      commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      url: 'https://github.com/openagentsworld/openagents-submissions/tree/proj-submit',
      branch: 'proj-submit',
      status: 'under_review'
    },
    projectStatusAfterCommit: 'under_review',
    deliverResponse: 'accept'
  });
  try {
    await fixture.client.login();
    const result = await fixture.client.submitFiles({ taskId: 'proj-submit', files: SUBMIT_FILES, submitDelivery: true });
    assert.equal(result.deliverySubmitted, true, 'gateway commit + delivery counts as submitted');
    assert.equal(result.commitSha, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(result.task?.status, 'under_review');
    assert.equal(fixture.gatewayRequests.length, 1, 'exactly one gateway commit');
    assert.equal(fixture.deliverRequests.length, 0, 'no second WS submit after a gateway delivery');
  } finally {
    await fixture.client.close();
    await fixture.close();
  }
});

test('submitFiles reconciles instead of reporting a false failure after an unlabelled commit', async () => {
  const fixture = await startSubmissionFixture({
    gatewayResponse: {
      ok: true,
      commitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      url: 'https://github.com/openagentsworld/openagents-submissions/tree/proj-submit'
    },
    projectStatusAfterCommit: 'under_review',
    deliverResponse: 'accept'
  });
  try {
    await fixture.client.login();
    const result = await fixture.client.submitFiles({ taskId: 'proj-submit', files: SUBMIT_FILES, submitDelivery: true });
    assert.equal(result.deliverySubmitted, true, 'reconciled delivery must not surface DELIVERY_SUBMIT_FAILED_AFTER_COMMIT');
    assert.equal(result.task?.status, 'under_review');
    assert.equal(fixture.deliverRequests.length, 0, 'the rejected preflight must not double-submit');
  } finally {
    await fixture.client.close();
    await fixture.close();
  }
});

test('submitFiles still fails loudly when the delivery never landed', async () => {
  const fixture = await startSubmissionFixture({
    gatewayResponse: {
      ok: true,
      commitSha: 'cccccccccccccccccccccccccccccccccccccccc',
      url: 'https://github.com/openagentsworld/openagents-submissions/tree/proj-submit'
    },
    projectStatusAfterCommit: 'in_progress',
    deliverResponse: 'reject'
  });
  try {
    await fixture.client.login();
    await assert.rejects(
      fixture.client.submitFiles({ taskId: 'proj-submit', files: SUBMIT_FILES, submitDelivery: true }),
      (error: unknown) => error instanceof OpenAgentsError && error.code === 'DELIVERY_SUBMIT_FAILED_AFTER_COMMIT',
      'a real submit failure must keep the existing error contract'
    );
    assert.equal(fixture.deliverRequests.length, 1, 'the WS submit must be attempted once');
  } finally {
    await fixture.client.close();
    await fixture.close();
  }
});

test('submitFiles can commit without submitting the delivery', async () => {
  const fixture = await startSubmissionFixture({
    gatewayResponse: {
      ok: true,
      commitSha: 'dddddddddddddddddddddddddddddddddddddddd',
      url: 'https://github.com/openagentsworld/openagents-submissions/tree/proj-submit',
      status: 'under_review'
    },
    projectStatusAfterCommit: 'under_review',
    deliverResponse: 'accept'
  });
  try {
    await fixture.client.login();
    const result = await fixture.client.submitFiles({ taskId: 'proj-submit', files: SUBMIT_FILES, submitDelivery: false });
    assert.equal(result.deliverySubmitted, false);
    assert.equal(result.task, null);
    assert.equal(fixture.deliverRequests.length, 0);
  } finally {
    await fixture.client.close();
    await fixture.close();
  }
});
