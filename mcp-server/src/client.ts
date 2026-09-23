import WebSocket, { type RawData } from 'ws';
import { OpenAgentsError } from './errors.js';
import { projectToTask, reviewFeedbackFromReview, selectTasks } from './task-view.js';
import {
  asNumber,
  asRecord,
  asString,
  type AvatarType,
  type ChatEntry,
  type CreateTaskInput,
  type JsonObject,
  type ListTasksInput,
  type ListTasksResult,
  type LoginResult,
  type MoveAgentInput,
  type MoveAgentResult,
  type NotificationView,
  type GetNotificationsInput,
  type GetNotificationsResult,
  type ReadChatInput,
  type ReadChatResult,
  type ReviewFeedbackView,
  type SendChatInput,
  type SendChatResult,
  type OpenAgentsAccount,
  type RawProjectList,
  type SubmitDeliveryInput,
  type SubmitFilesInput,
  type SubmitFilesResult,
  type TaskStatusView,
  type TaskView
} from './types.js';
import type { OpenAgentsConfig } from './config.js';

interface AvatarSelection {
  avatarType?: AvatarType | undefined;
  avatarColor?: string | undefined;
}

interface PendingWaiter {
  predicate: (message: JsonObject) => boolean;
  resolve: (message: JsonObject) => void;
  reject: (error: OpenAgentsError) => void;
  timer: NodeJS.Timeout;
}

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

/** Odada görülen son chat mesajlarının MCP belleğinde tutulduğu üst sınır. */
const CHAT_BUFFER_LIMIT = 200;

/**
 * 22 Eyl: `/api/submissions/<id>/commit` dosyaları commit'ler VE teslimi kendi
 * uygular — görev `under_review`'a geçer, sahip/işçi bildirimi gider. Aynı görev
 * için ardından WS üzerinden ikinci bir submit denemesi `INVALID_STATUS` alır;
 * bu yüzden `openagents_submit_files` teslim gerçekten düşmüşken
 * `DELIVERY_SUBMIT_FAILED_AFTER_COMMIT` dönüyordu. Commit yanıtındaki `status`
 * bu listedeyse teslim zaten inmiş demektir: ikinci submit atlanır.
 */
const GATEWAY_DELIVERED_TASK_STATUSES = [
  'under_review',
  'review_failed',
  'review_passed',
  'review_passed_payment_pending',
  'payment_paid_release_ready',
  'released',
  'completed'
] as const;

function gatewayAlreadyDelivered(status: string): boolean {
  return (GATEWAY_DELIVERED_TASK_STATUSES as readonly string[]).includes(status);
}

function serverError(message: JsonObject): OpenAgentsError {
  const code = asString(message.code, 'SERVER_REJECTED');
  const text = asString(message.message, 'OpenAgents rejected the request.');
  const recoveryByCode: Record<string, string> = {
    AUTH_REQUIRED: 'Call openagents_login with valid MCP environment credentials.',
    PROJECT_NOT_FOUND: 'Refresh tasks with openagents_list_tasks and verify the taskId.',
    PROJECT_NOT_OPEN: 'Refresh the task. Another worker may already have claimed it.',
    CANNOT_ACCEPT_OWN: 'Use a separate AI worker account to claim this task.',
    NOT_WORKER: 'Use the worker account that claimed this task.',
    INVALID_STATUS: 'Refresh the task and act only from an allowed lifecycle state.',
    DELIVERY_TARGET_NOT_ALLOWED: 'Use one of the owner-approved delivery targets returned by openagents_list_tasks.',
    DELIVERY_LOCATION_REQUIRED: 'Provide a valid HTTPS delivery location for the selected source.'
  };
  return new OpenAgentsError(code, text, {
    retryable: ['PROJECT_NOT_OPEN', 'INVALID_STATUS'].includes(code),
    recovery: recoveryByCode[code] || 'Refresh the task state and correct the request before retrying.'
  });
}

function safeAccount(value: unknown): OpenAgentsAccount {
  const account = asRecord(value);
  return {
    id: asString(account.id),
    loginId: asString(account.loginId),
    nickname: asString(account.nickname),
    avatarType: asString(account.avatarType, 'ai_bot'),
    avatarColor: asString(account.avatarColor, '#6366f1')
  };
}

// Mirrors the OpenAgents gateway file rules so a bad path or an oversized
// payload fails locally with a clear message instead of a server rejection.
function normalizeGatewayFiles(files: SubmitFilesInput['files']): Array<{ path: string; contentBase64: string }> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new OpenAgentsError('SUBMISSION_FILES_REQUIRED', 'At least one file is required for a gateway submission.', {
      recovery: 'Pass the repository-relative paths and contents of the delivered files.'
    });
  }
  if (files.length > 80) {
    throw new OpenAgentsError('SUBMISSION_TOO_MANY_FILES', 'The gateway accepts at most 80 files per submission.', {
      recovery: 'Split the delivery into a smaller set of files.'
    });
  }
  const normalized: Array<{ path: string; contentBase64: string }> = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    const filePath = String(file?.path || '').replace(/\\+/g, '/').replace(/^\/+/, '').trim();
    const segments = filePath.split('/').filter(Boolean);
    const blockedSegment = segments.some((segment) => {
      const lower = segment.toLowerCase();
      return ['node_modules', '.git', '.runtime', 'data'].includes(lower) || lower.startsWith('.env');
    });
    const blockedFilename = segments.at(-1)?.toLowerCase() || '';
    if (!filePath || filePath.length > 180 || filePath.includes('..') || blockedSegment
      || ['openagents-submit.mjs', 'openagents-submit-v1.mjs', 'submission-helper-v1.mjs'].includes(blockedFilename)) {
      throw new OpenAgentsError('SUBMISSION_INVALID_PATH', `Invalid gateway file path: ${file?.path || ''}`, {
        recovery: 'Use plain repository-relative paths; dependency, VCS, runtime, data and .env files are rejected.'
      });
    }
    if (seen.has(filePath)) {
      throw new OpenAgentsError('SUBMISSION_DUPLICATE_PATH', `Duplicate gateway file path: ${filePath}`, {
        recovery: 'Send each file path exactly once.'
      });
    }
    seen.add(filePath);
    const buffer = typeof file.contentBase64 === 'string' && file.contentBase64
      ? Buffer.from(file.contentBase64, 'base64')
      : typeof file.content === 'string'
        ? Buffer.from(file.content, 'utf8')
        : null;
    if (!buffer) {
      throw new OpenAgentsError('SUBMISSION_MISSING_CONTENT', `Missing content for ${filePath}`, {
        recovery: 'Provide content or contentBase64 for every file.'
      });
    }
    totalBytes += buffer.length;
    if (totalBytes > 16 * 1024 * 1024) {
      throw new OpenAgentsError('SUBMISSION_TOO_LARGE', 'The gateway submission exceeds the 16 MB total limit.', {
        recovery: 'Deliver a smaller set of files; the platform accepts at most 16 MB per submission.'
      });
    }
    normalized.push({ path: filePath, contentBase64: buffer.toString('base64') });
  }
  return normalized;
}

function collectProjects(raw: RawProjectList): JsonObject[] {
  const byId = new Map<string, JsonObject>();
  for (const project of [...raw.openProjects, ...raw.myProjects]) {
    const id = asString(project.id);
    if (id) byId.set(id, project);
  }
  return [...byId.values()];
}

// Notification projection: only the safe scalar fields plus the opaque data
// object. Other users' notifications never reach this client because the
// server keys notifications_list to the authenticated account.
function notificationView(value: unknown): NotificationView | null {
  const record = asRecord(value);
  const id = asString(record.id);
  if (!id) return null;
  return {
    id,
    type: asString(record.type, 'unknown'),
    message: asString(record.message),
    data: record.data && typeof record.data === 'object' ? record.data as JsonObject : {},
    read: record.read === true,
    createdAt: asNumber(record.createdAt)
  };
}

export class OpenAgentsClient {
  private socket: WebSocket | null = null;
  private pending: PendingWaiter | null = null;
  private account: OpenAgentsAccount | null = null;
  private loginResult: LoginResult | null = null;
  private connectPromise: Promise<LoginResult> | null = null;
  private operationTail: Promise<void> = Promise.resolve();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private hasLoggedIn = false;
  private shuttingDown = false;
  private sessionWasReplaced = false;
  private lastSelection: AvatarSelection = {};
  private chatLog: ChatEntry[] = [];

  constructor(readonly config: OpenAgentsConfig) {}

  get secrets(): string[] {
    return [this.config.password];
  }

  async login(selection: AvatarSelection = {}): Promise<LoginResult> {
    return this.runExclusive(async () => {
      this.lastSelection = { ...selection };
      return this.loginInternal(true);
    });
  }

  async listTasks(input: ListTasksInput): Promise<ListTasksResult> {
    return this.runExclusive(async () => {
      const raw = await this.getRawProjectsInternal();
      return selectTasks(raw, input);
    });
  }

  // Reuses the project_list infrastructure; no new WS contract. Full feedback
  // is visible only to the task owner or the assigned worker.
  async getReviewFeedback(taskId: string): Promise<{ taskId: string; review: ReviewFeedbackView | null; status: string }> {
    return this.runExclusive(async () => {
      const raw = await this.getRawProjectsInternal();
      const project = collectProjects(raw).find((item) => asString(item.id) === taskId);
      if (!project) {
        throw new OpenAgentsError('PROJECT_NOT_FOUND', 'Task not found.', {
          recovery: 'Refresh tasks with openagents_list_tasks and verify the taskId.'
        });
      }
      const ownerId = asString(asRecord(project.owner).id);
      const workerId = asString(asRecord(project.worker).id);
      if (!this.account || (this.account.id !== ownerId && this.account.id !== workerId)) {
        throw new OpenAgentsError('NOT_PARTICIPANT', 'Review feedback is visible only to the task owner and the assigned worker.', {
          recovery: 'Use the OpenAgents account that owns or claimed this task.'
        });
      }
      const review = reviewFeedbackFromReview(project.review);
      return { taskId, review, status: review?.status ?? 'not_requested' };
    });
  }

  // M3: the account's own persisted notifications via the existing
  // notifications_get contract — the server only ever returns the caller's.
  async getNotifications(input: GetNotificationsInput): Promise<GetNotificationsResult> {
    return this.runExclusive(async () => {
      await this.ensureConnectedInternal();
      const response = await this.request(
        { type: 'notifications_get' },
        (message) => message.type === 'notifications_list'
      );
      const all = (Array.isArray(response.notifications) ? response.notifications : [])
        .map(notificationView)
        .filter((item): item is NotificationView => item !== null)
        .sort((left, right) => right.createdAt - left.createdAt);
      const unreadCount = all.filter(item => !item.read).length;
      const notifications = (input.unreadOnly ? all.filter(item => !item.read) : all)
        .slice(0, Math.max(1, Math.min(50, input.limit)));
      return { unreadOnly: input.unreadOnly, notifications, unreadCount };
    });
  }

  // M4: lightweight lifecycle snapshot using the same raw project feed as
  // get_review_feedback — no new WS contract.
  async getTaskStatus(taskId: string): Promise<{ task: TaskStatusView }> {
    return this.runExclusive(async () => {
      const raw = await this.getRawProjectsInternal();
      const project = collectProjects(raw).find((item) => asString(item.id) === taskId);
      if (!project) {
        throw new OpenAgentsError('PROJECT_NOT_FOUND', 'Task not found.', {
          recovery: 'Refresh tasks with openagents_list_tasks and verify the taskId.'
        });
      }
      const ownerId = asString(asRecord(project.owner).id);
      const workerId = asString(asRecord(project.worker).id);
      const isParticipant = Boolean(this.account && (this.account.id === ownerId || this.account.id === workerId));
      const status = asString(project.status);
      if (!isParticipant && status !== 'open') {
        throw new OpenAgentsError('NOT_PARTICIPANT', 'Task status is visible to everyone only while the task is open.', {
          recovery: 'Use the OpenAgents account that owns or claimed this task.'
        });
      }

      const reviewRecord = asRecord(project.review);
      const review = Object.keys(reviewRecord).length > 0
        ? {
            status: asString(reviewRecord.status, 'not_requested'),
            decision: typeof reviewRecord.decision === 'string' ? reviewRecord.decision : null
          }
        : null;

      const task: TaskStatusView = {
        id: asString(project.id),
        title: asString(project.title),
        status,
        paymentStatus: asString(project.paymentStatus, null),
        deadline: typeof project.deadline === 'string' && project.deadline ? project.deadline : null,
        review
      };
      if (isParticipant) {
        task.payoutSummary = project.payoutSummary && typeof project.payoutSummary === 'object'
          ? project.payoutSummary as JsonObject
          : null;
      }
      return { task };
    });
  }

  async createTask(input: CreateTaskInput): Promise<{ task: TaskView; reconciled: boolean }> {
    return this.runExclusive(async () => {
      await this.ensureConnectedInternal();
      const sentAt = Date.now();
      try {
        const response = await this.request(
          {
            type: 'project_create',
            title: input.title,
            description: input.description,
            budget: input.budget,
            currency: 'TRY',
            paymentProvider: 'shopier',
            deadline: input.deadline,
            skills: input.skills,
            deliveryPreferences: {
              acceptedTargets: input.acceptedTargets,
              preferredLocation: input.preferredLocation,
              defaultInstallCommand: input.defaultInstallCommand || '',
              defaultTestCommand: input.defaultTestCommand || '',
              reviewInstructions: input.reviewInstructions
            }
          },
          (message) => message.type === 'project_created'
        );
        return { task: projectToTask(asRecord(response.project)), reconciled: false };
      } catch (error) {
        if (!(error instanceof OpenAgentsError) || error.code !== 'REQUEST_TIMEOUT') throw error;
        const raw = await this.getRawProjectsInternal();
        const matches = raw.myProjects.filter((project) =>
          asString(project.title) === input.title
          && asString(project.description) === input.description
          && (typeof project.createdAt === 'number' && project.createdAt >= sentAt - 2_000)
        );
        if (matches.length === 1) return { task: projectToTask(matches[0]!), reconciled: true };
        throw new OpenAgentsError('OUTCOME_UNKNOWN', 'Task creation timed out and could not be reconciled safely.', {
          retryable: false,
          recovery: 'List your tasks and check for a matching recent task before attempting another create.'
        });
      }
    });
  }

  async claimTask(taskId: string): Promise<{ task: TaskView; reconciled: boolean }> {
    return this.runExclusive(async () => {
      await this.ensureConnectedInternal();
      const before = await this.getRawProjectsInternal();
      const project = collectProjects(before).find((item) => asString(item.id) === taskId);
      if (!project) {
        throw new OpenAgentsError('PROJECT_NOT_FOUND', 'Task not found.', {
          recovery: 'Refresh open tasks and use the returned taskId.'
        });
      }
      if (asString(project.status) !== 'open') {
        throw new OpenAgentsError('PROJECT_NOT_OPEN', 'Task is no longer open.', {
          retryable: true,
          recovery: 'Refresh open tasks; another worker may have claimed it.'
        });
      }
      const owner = asRecord(project.owner);
      if (asString(owner.id) === this.account?.id) {
        throw new OpenAgentsError('CANNOT_ACCEPT_OWN', 'A task owner cannot claim their own task.', {
          recovery: 'Configure a separate OpenAgents AI worker account for claiming work.'
        });
      }

      try {
        const response = await this.request(
          { type: 'project_accept', projectId: taskId },
          (message) => {
            if (message.type !== 'project_updated') return false;
            const updated = asRecord(message.project);
            const worker = asRecord(updated.worker);
            return asString(updated.id) === taskId
              && asString(updated.status) === 'in_progress'
              && asString(worker.id) === this.account?.id;
          }
        );
        return { task: projectToTask(asRecord(response.project)), reconciled: false };
      } catch (error) {
        if (!(error instanceof OpenAgentsError) || error.code !== 'REQUEST_TIMEOUT') throw error;
        const raw = await this.getRawProjectsInternal();
        const updated = collectProjects(raw).find((item) => asString(item.id) === taskId);
        const worker = asRecord(updated?.worker);
        if (updated && asString(updated.status) === 'in_progress' && asString(worker.id) === this.account?.id) {
          return { task: projectToTask(updated), reconciled: true };
        }
        throw new OpenAgentsError('OUTCOME_UNKNOWN', 'Task claim timed out and was not confirmed.', {
          retryable: false,
          recovery: 'Refresh the task before attempting another claim.'
        });
      }
    });
  }

  async submitDelivery(input: SubmitDeliveryInput): Promise<{ task: TaskView; reconciled: boolean }> {
    return this.runExclusive(async () => {
      await this.ensureConnectedInternal();
      const before = await this.getRawProjectsInternal();
      const project = collectProjects(before).find((item) => asString(item.id) === input.taskId);
      if (!project) {
        throw new OpenAgentsError('PROJECT_NOT_FOUND', 'Task not found.', {
          recovery: 'Refresh your tasks and use the returned taskId.'
        });
      }
      const worker = asRecord(project.worker);
      if (asString(worker.id) !== this.account?.id) {
        throw new OpenAgentsError('NOT_WORKER', 'Only the assigned worker can submit this delivery.', {
          recovery: 'Use the OpenAgents account that claimed this task.'
        });
      }
      if (!['in_progress', 'review_failed'].includes(asString(project.status))) {
        throw new OpenAgentsError('INVALID_STATUS', 'Task must be in progress or returned for revision.', {
          recovery: 'Refresh the task and submit only from in_progress or review_failed.'
        });
      }
      const preferences = asRecord(project.deliveryPreferences);
      const acceptedTargets = Array.isArray(preferences.acceptedTargets)
        ? preferences.acceptedTargets.filter((item): item is string => typeof item === 'string')
        : [];
      if (!acceptedTargets.includes(input.source)) {
        throw new OpenAgentsError('DELIVERY_TARGET_NOT_ALLOWED', `Owner accepts only: ${acceptedTargets.join(', ') || 'no configured targets'}.`, {
          recovery: 'Choose a delivery source listed in deliveryPreferences.acceptedTargets.'
        });
      }

      const deliveryMeta: JsonObject = {
        source: input.source,
        sourceUrl: input.sourceUrl
      };
      const optionalFields: Array<keyof SubmitDeliveryInput> = [
        'repo', 'prUrl', 'branch', 'commitSha', 'artifactUrl', 'driveUrl',
        'figmaUrl', 'notionUrl', 'installCommand', 'testCommand', 'notes'
      ];
      for (const field of optionalFields) {
        const value = input[field];
        if (typeof value === 'string' && value) deliveryMeta[field] = value;
      }

      try {
        const response = await this.request(
          {
            type: 'project_deliver',
            projectId: input.taskId,
            deliverables: input.deliverables,
            deliveryMeta
          },
          (message) => {
            if (message.type !== 'project_updated') return false;
            const updated = asRecord(message.project);
            return asString(updated.id) === input.taskId && asString(updated.status) === 'under_review';
          }
        );
        return { task: projectToTask(asRecord(response.project)), reconciled: false };
      } catch (error) {
        if (!(error instanceof OpenAgentsError) || error.code !== 'REQUEST_TIMEOUT') throw error;
        const raw = await this.getRawProjectsInternal();
        const updated = collectProjects(raw).find((item) => asString(item.id) === input.taskId);
        if (updated && asString(updated.status) === 'under_review') {
          return { task: projectToTask(updated), reconciled: true };
        }
        throw new OpenAgentsError('OUTCOME_UNKNOWN', 'Delivery submission timed out and was not confirmed.', {
          retryable: false,
          recovery: 'Refresh your task. Do not resubmit until its delivery status is known.'
        });
      }
    });
  }

  async submitFiles(input: SubmitFilesInput): Promise<SubmitFilesResult> {
    const committed = await this.runExclusive(async () => {
      await this.ensureConnectedInternal();
      const raw = await this.getRawProjectsInternal();
      const project = collectProjects(raw).find((item) => asString(item.id) === input.taskId);
      if (!project) {
        throw new OpenAgentsError('PROJECT_NOT_FOUND', 'Task not found.', {
          recovery: 'Refresh tasks with openagents_list_tasks and verify the taskId.'
        });
      }
      const worker = asRecord(project.worker);
      if (asString(worker.id) !== this.account?.id) {
        throw new OpenAgentsError('NOT_WORKER', 'Only the assigned worker can submit files for this task.', {
          recovery: 'Use the OpenAgents account that claimed this task.'
        });
      }
      const access = asRecord(project.submissionAccess);
      const endpoint = asString(access.endpoint);
      const branch = asString(access.branch);
      const repo = asString(access.repo);
      const token = asString(access.token);
      if (!endpoint || !branch || !token) {
        throw new OpenAgentsError(
          'SUBMISSION_ACCESS_UNAVAILABLE',
          'OpenAgents did not expose a submission target for this task and account.',
          {
            recovery: 'Claim the task with this account first: the platform hands the task branch, repository and commit token only to the assigned worker.'
          }
        );
      }

      const files = normalizeGatewayFiles(input.files);
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            branch,
            files,
            message: typeof input.message === 'string' && input.message.trim()
              ? input.message.trim()
              : `Solution for ${branch}`
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(Math.max(this.config.requestTimeoutMs, 30_000))
        });
      } catch (error) {
        throw new OpenAgentsError('SUBMISSION_CONNECTION_FAILED', 'Could not reach the OpenAgents submission gateway.', {
          retryable: false,
          recovery: 'The commit may or may not have been processed: reconcile with openagents_task_status or list_tasks before submitting again.',
          cause: error
        });
      }

      const body = asRecord(await response.json().catch(() => ({})));
      if (!response.ok || body.ok === false) {
        throw new OpenAgentsError(
          'SUBMISSION_REJECTED',
          asString(body.error, `The submission gateway rejected the commit (HTTP ${response.status}).`),
          {
            retryable: response.status === 429 || response.status >= 500,
            recovery: 'Verify the file paths, sizes and token, then retry once and reconcile if the outcome stays unknown.'
          }
        );
      }
      const commitSha = asString(body.commitSha);
      if (!commitSha) {
        throw new OpenAgentsError('SUBMISSION_OUTCOME_UNKNOWN', 'The submission gateway did not confirm a commit sha.', {
          recovery: 'Reconcile with openagents_task_status or list_tasks before submitting again.'
        });
      }
      return {
        taskId: input.taskId,
        branch,
        repo,
        commitSha,
        url: asString(body.url),
        files: files.map((file) => file.path),
        // Gateway commit + teslimi tek adımda uyguluyorsa yanıtın `status` alanı
        // görevin teslim sonrası durumunu taşır (aşağıda kullanılır).
        gatewayStatus: asString(body.status)
      };
    });

    if (input.submitDelivery === false) {
      return { ...committed, deliverySubmitted: false, task: null };
    }

    // Teslim zaten gateway commit'iyle uygulandıysa ikinci kez submit etme.
    if (gatewayAlreadyDelivered(committed.gatewayStatus)) {
      const task = await this.refreshTaskView(committed.taskId).catch(() => null);
      return {
        taskId: committed.taskId,
        branch: committed.branch,
        repo: committed.repo,
        commitSha: committed.commitSha,
        url: committed.url,
        files: committed.files,
        deliverySubmitted: true,
        task
      };
    }

    let delivery: { task: TaskView; reconciled: boolean };
    try {
      delivery = await this.submitDelivery({
        taskId: committed.taskId,
        deliverables: input.deliverables && input.deliverables.length > 0 ? input.deliverables : committed.files,
        source: 'github',
        sourceUrl: committed.repo || committed.url || committed.branch,
        repo: committed.repo || undefined,
        branch: committed.branch,
        commitSha: committed.commitSha,
        notes: input.notes
      });
    } catch (error) {
      // Sonuç bilinmiyorsa önce uzlaştır: teslim gerçekten düşmüş olabilir
      // (örneğin commit yanıtı status taşımıyor ama görev artık teslim edilmiş
      // bir durumda). Uzlaştırma başarılıysa hatayı gizleme, başarı dön.
      const reconciledTask = await this.refreshTaskView(committed.taskId).catch(() => null);
      if (reconciledTask && gatewayAlreadyDelivered(reconciledTask.status)) {
        return {
          taskId: committed.taskId,
          branch: committed.branch,
          repo: committed.repo,
          commitSha: committed.commitSha,
          url: committed.url,
          files: committed.files,
          deliverySubmitted: true,
          task: reconciledTask
        };
      }
      // The files are already on the platform branch; surface that fact instead of
      // hiding a successful commit behind a delivery error.
      const detail = error instanceof OpenAgentsError ? `${error.code}: ${error.message}` : String((error as Error)?.message || error);
      throw new OpenAgentsError(
        'DELIVERY_SUBMIT_FAILED_AFTER_COMMIT',
        `Files were committed to ${committed.branch} (${committed.commitSha.slice(0, 12)}) but the delivery submit failed — ${detail}`,
        {
          retryable: false,
          recovery: 'The commit is on the platform branch; resolve the delivery error and retry the submit (openagents_submit_delivery with repo/branch/commitSha, or submit_files again).'
        }
      );
    }
    return { ...committed, deliverySubmitted: true, task: delivery.task };
  }

  async cancelTask(taskId: string): Promise<{ task: TaskView; reconciled: boolean }> {
    return this.runExclusive(async () => {
      await this.ensureConnectedInternal();
      const before = await this.getRawProjectsInternal();
      const project = collectProjects(before).find((item) => asString(item.id) === taskId);
      if (!project) {
        throw new OpenAgentsError('PROJECT_NOT_FOUND', 'Task not found.', {
          recovery: 'Refresh tasks with openagents_list_tasks and verify the taskId.'
        });
      }
      const owner = asRecord(project.owner);
      if (this.account && asString(owner.id) !== this.account.id) {
        throw new OpenAgentsError('NOT_OWNER', 'Only the task owner can cancel this task.', {
          recovery: 'Use the OpenAgents account that created this task.'
        });
      }
      if (!['open', 'in_progress', 'review_failed'].includes(asString(project.status))) {
        throw new OpenAgentsError('INVALID_STATUS', 'Only open, in_progress, or review_failed tasks can be cancelled.', {
          retryable: false,
          recovery: 'Refresh the task and act only from an allowed lifecycle state.'
        });
      }

      try {
        const response = await this.request(
          { type: 'project_cancel', projectId: taskId },
          (message) => {
            if (message.type !== 'project_updated') return false;
            const updated = asRecord(message.project);
            return asString(updated.id) === taskId && asString(updated.status) === 'cancelled';
          }
        );
        return { task: projectToTask(asRecord(response.project)), reconciled: false };
      } catch (error) {
        if (!(error instanceof OpenAgentsError) || error.code !== 'REQUEST_TIMEOUT') throw error;
        const raw = await this.getRawProjectsInternal();
        const updated = collectProjects(raw).find((item) => asString(item.id) === taskId);
        if (updated && asString(updated.status) === 'cancelled') {
          return { task: projectToTask(updated), reconciled: true };
        }
        throw new OpenAgentsError('OUTCOME_UNKNOWN', 'Task cancellation timed out and was not confirmed.', {
          retryable: false,
          recovery: 'Refresh the task with openagents_list_tasks before deciding whether to retry.'
        });
      }
    });
  }

  async moveAgent(input: MoveAgentInput): Promise<MoveAgentResult> {
    return this.runExclusive(async () => {
      await this.ensureConnectedInternal();
      const rotationY = input.rotationY ?? 0;
      const moving = input.moving === true;
      const hasTarget = input.targetX !== undefined || input.targetZ !== undefined;
      const payload: JsonObject = {
        type: 'agent_position',
        x: input.x,
        z: input.z,
        rotationY
      };
      if (moving) {
        payload.moving = true;
        if (hasTarget) {
          payload.targetX = input.targetX ?? input.x;
          payload.targetZ = input.targetZ ?? input.z;
        }
      }
      // Sunucu hareket için doğrudan ack göndermez (yalnızca odaya yayın +
      // hata mesajı). Bekleme penceresinde hata gelmezse kabul edilmiş sayılır.
      try {
        await this.request(payload, () => false);
      } catch (error) {
        if (!(error instanceof OpenAgentsError) || error.code !== 'REQUEST_TIMEOUT') throw error;
      }
      return {
        moved: true,
        room: this.loginResult?.presence.room || 'beach',
        position: {
          x: input.x,
          z: input.z,
          rotationY,
          moving,
          targetX: moving && hasTarget ? (input.targetX ?? input.x) : null,
          targetZ: moving && hasTarget ? (input.targetZ ?? input.z) : null
        }
      };
    });
  }

  async sendChat(input: SendChatInput): Promise<SendChatResult> {
    return this.runExclusive(async () => {
      await this.ensureConnectedInternal();
      const content = input.content.trim();
      if (!content) {
        throw new OpenAgentsError('EMPTY_MESSAGE', 'Message cannot be empty.', {
          recovery: 'Provide non-empty chat content.'
        });
      }
      const to = input.to && input.to !== 'all' ? input.to : null;
      // Oda mesajında gönderene echo, özel mesajda message_sent ack'i döner.
      await this.request(
        to ? { type: 'message', content, to } : { type: 'message', content },
        (message) => {
          if (to) return message.type === 'message_sent' && asString(message.to) === to;
          return message.type === 'message' && this.account !== null && asString(message.fromId) === this.account.id;
        }
      );
      return { sent: true, to };
    });
  }

  async readChat(input: ReadChatInput = {}): Promise<ReadChatResult> {
    const limit = Math.max(1, Math.min(100, input.limit ?? 20));
    return {
      room: this.loginResult?.presence.room || 'beach',
      connected: this.socket?.readyState === WebSocket.OPEN && this.loginResult !== null,
      totalBuffered: this.chatLog.length,
      messages: this.chatLog.slice(-limit)
    };
  }

  async close(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.rejectPending(new OpenAgentsError('CLIENT_CLOSED', 'OpenAgents MCP client closed.'));
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(1000, 'MCP server shutting down');
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async ensureConnectedInternal(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN && this.loginResult) return;
    if (this.sessionWasReplaced) {
      throw new OpenAgentsError('SESSION_REPLACED', 'This OpenAgents account was opened in another session.', {
        recovery: 'Use a dedicated AI worker account, then call openagents_login again.'
      });
    }
    if (!this.hasLoggedIn) {
      throw new OpenAgentsError('AUTH_REQUIRED', 'OpenAgents login is required before using marketplace tools.', {
        recovery: 'Configure OPENAGENTS_LOGIN_ID and OPENAGENTS_PASSWORD, then call openagents_login.'
      });
    }
    await this.loginInternal(false);
  }

  private loginInternal(explicit: boolean): Promise<LoginResult> {
    if (this.socket?.readyState === WebSocket.OPEN && this.loginResult) return Promise.resolve(this.loginResult);
    if (this.connectPromise) return this.connectPromise;
    if (this.sessionWasReplaced && !explicit) {
      return Promise.reject(new OpenAgentsError('SESSION_REPLACED', 'This account session was replaced.', {
        recovery: 'Use a dedicated AI worker account and explicitly call openagents_login.'
      }));
    }
    if (explicit) this.sessionWasReplaced = false;
    this.connectPromise = this.performLogin().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async performLogin(): Promise<LoginResult> {
    if (!this.config.loginId || !this.config.password) {
      throw new OpenAgentsError('AUTH_CONFIG_MISSING', 'OpenAgents Login ID and password are not configured.', {
        recovery: 'Set OPENAGENTS_LOGIN_ID and OPENAGENTS_PASSWORD in the MCP server environment.'
      });
    }

    const authUrl = new URL('/api/auth/login', this.config.baseUrl);
    let response: Response;
    try {
      response = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ loginId: this.config.loginId, password: this.config.password }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.requestTimeoutMs)
      });
    } catch (error) {
      throw new OpenAgentsError('AUTH_CONNECTION_FAILED', 'Could not reach the OpenAgents login endpoint.', {
        retryable: true,
        recovery: 'Check the network and OPENAGENTS_BASE_URL, then retry login.',
        cause: error
      });
    }

    const body = asRecord(await response.json().catch(() => ({})));
    if (!response.ok || body.ok === false) {
      const codeByStatus: Record<number, string> = {
        401: 'INVALID_CREDENTIALS',
        403: 'ACCOUNT_NOT_VERIFIED',
        404: 'ACCOUNT_NOT_FOUND',
        429: 'AUTH_RATE_LIMITED'
      };
      const code = codeByStatus[response.status] || 'AUTH_FAILED';
      throw new OpenAgentsError(code, asString(body.error, 'OpenAgents login failed.'), {
        retryable: response.status === 429 || response.status >= 500,
        recovery: response.status === 429
          ? 'Wait for the server rate limit window before retrying.'
          : 'Verify the Login ID, password, and account verification status.'
      });
    }

    const authToken = asString(body.authToken);
    const authAccount = safeAccount(body.account);
    if (!authToken || !authAccount.id) {
      throw new OpenAgentsError('INVALID_AUTH_RESPONSE', 'OpenAgents returned an incomplete authentication response.', {
        recovery: 'Retry once. If this persists, verify the deployed OpenAgents auth contract.'
      });
    }

    const result = await this.connectSocket(authToken, authAccount);
    this.hasLoggedIn = true;
    this.reconnectAttempt = 0;
    this.loginResult = result;
    this.account = result.account;
    return result;
  }

  private async connectSocket(authToken: string, authAccount: OpenAgentsAccount): Promise<LoginResult> {
    const oldSocket = this.socket;
    this.socket = null;
    if (oldSocket && oldSocket.readyState !== WebSocket.CLOSED) oldSocket.terminate();

    const socket = new WebSocket(this.config.websocketUrl, { maxPayload: 2 * 1024 * 1024 });
    this.socket = socket;
    this.bindSocket(socket);
    const connectedPromise = this.waitForMessage((message) => message.type === 'connected');
    try {
      await Promise.all([this.waitForOpen(socket), connectedPromise]);
      const joinedPromise = this.waitForMessage((message) => message.type === 'joined');
      socket.send(JSON.stringify({
        type: 'join',
        authToken,
        room: 'beach',
        name: authAccount.nickname || authAccount.loginId,
        avatar: this.lastSelection.avatarColor || authAccount.avatarColor,
        avatarType: this.lastSelection.avatarType || authAccount.avatarType
      }));
      const joined = await joinedPromise;
      const joinedAccount = safeAccount(joined.account);
      const position = asRecord(joined.position);
      return {
        account: joinedAccount.id ? joinedAccount : authAccount,
        presence: {
          connected: true,
          room: asString(joined.room, 'beach'),
          position: Number.isFinite(position.x) && Number.isFinite(position.z) && Number.isFinite(position.rotationY)
            ? { x: Number(position.x), z: Number(position.z), rotationY: Number(position.rotationY) }
            : null
        }
      };
    } catch (error) {
      if (this.socket === socket) this.socket = null;
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      this.rejectPending(error instanceof OpenAgentsError ? error : new OpenAgentsError('WS_JOIN_FAILED', 'Could not join OpenAgents World.'));
      throw error;
    }
  }

  private bindSocket(socket: WebSocket): void {
    socket.on('message', (data: RawData) => this.handleSocketMessage(socket, data));
    socket.on('close', (code) => this.handleSocketClose(socket, code));
    socket.on('error', () => {
      if (this.socket === socket && socket.readyState !== WebSocket.OPEN) {
        this.rejectPending(new OpenAgentsError('WS_CONNECTION_FAILED', 'OpenAgents WebSocket connection failed.', {
          retryable: true,
          recovery: 'Check the network and retry login.'
        }));
      }
    });
  }

  private handleSocketMessage(socket: WebSocket, data: RawData): void {
    if (this.socket !== socket) return;
    let message: JsonObject;
    try {
      message = asRecord(JSON.parse(data.toString()) as unknown);
    } catch {
      return;
    }

    if (message.type === 'session_replaced') {
      this.sessionWasReplaced = true;
      this.loginResult = null;
      this.rejectPending(new OpenAgentsError('SESSION_REPLACED', 'This account was signed in from another browser or MCP process.', {
        recovery: 'Use a dedicated OpenAgents AI worker account for this MCP server.'
      }));
      return;
    }

    // Odadaki chat akışını yakala (read_chat aracı için ring buffer).
    // Pending eşleşmezse bile mesaj kaybolmasın.
    if (message.type === 'message') {
      this.chatLog.push({
        from: asString(message.from, 'unknown'),
        fromId: asString(message.fromId),
        content: asString(message.content),
        timestamp: asNumber(message.timestamp, Date.now()),
        private: message.private === true
      });
      if (this.chatLog.length > CHAT_BUFFER_LIMIT) {
        this.chatLog.splice(0, this.chatLog.length - CHAT_BUFFER_LIMIT);
      }
    }

    const pending = this.pending;
    if (!pending) return;
    if (message.type === 'error') {
      this.pending = null;
      clearTimeout(pending.timer);
      pending.reject(serverError(message));
      return;
    }
    if (pending.predicate(message)) {
      this.pending = null;
      clearTimeout(pending.timer);
      pending.resolve(message);
    }
  }

  private handleSocketClose(socket: WebSocket, code: number): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.loginResult = null;
    if (code === 4001) this.sessionWasReplaced = true;
    this.rejectPending(new OpenAgentsError(
      this.sessionWasReplaced ? 'SESSION_REPLACED' : 'CONNECTION_LOST',
      this.sessionWasReplaced ? 'This account session was replaced.' : 'The OpenAgents connection was lost.',
      {
        retryable: !this.sessionWasReplaced,
        recovery: this.sessionWasReplaced
          ? 'Use a dedicated AI worker account and explicitly log in again.'
          : 'The MCP server will attempt a bounded reconnect; retry the tool afterward.'
      }
    ));
    if (!this.shuttingDown && this.hasLoggedIn && !this.sessionWasReplaced) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.reconnectAttempt >= RECONNECT_DELAYS_MS.length) return;
    const delay = RECONNECT_DELAYS_MS[this.reconnectAttempt]!;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.loginInternal(false).catch(() => this.scheduleReconnect());
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private waitForOpen(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new OpenAgentsError('WS_OPEN_TIMEOUT', 'Timed out opening the OpenAgents WebSocket.', {
          retryable: true,
          recovery: 'Check the network and retry login.'
        }));
      }, this.config.requestTimeoutMs);
      const onOpen = (): void => { cleanup(); resolve(); };
      const onError = (): void => {
        cleanup();
        reject(new OpenAgentsError('WS_CONNECTION_FAILED', 'OpenAgents WebSocket connection failed.', {
          retryable: true,
          recovery: 'Check the network and retry login.'
        }));
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        socket.off('open', onOpen);
        socket.off('error', onError);
      };
      socket.once('open', onOpen);
      socket.once('error', onError);
    });
  }

  private waitForMessage(predicate: (message: JsonObject) => boolean): Promise<JsonObject> {
    if (this.pending) {
      return Promise.reject(new OpenAgentsError('INTERNAL_CONCURRENCY_ERROR', 'OpenAgents protocol already has an in-flight request.'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.timer === timer) this.pending = null;
        reject(new OpenAgentsError('REQUEST_TIMEOUT', 'OpenAgents did not confirm the request in time.', {
          retryable: false,
          recovery: 'Refresh authoritative task state before deciding whether to retry.'
        }));
      }, this.config.requestTimeoutMs);
      this.pending = { predicate, resolve, reject, timer };
    });
  }

  private rejectPending(error: OpenAgentsError): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  private async request(payload: JsonObject, predicate: (message: JsonObject) => boolean): Promise<JsonObject> {
    await this.ensureConnectedInternal();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new OpenAgentsError('CONNECTION_LOST', 'OpenAgents connection is not available.', {
        retryable: true,
        recovery: 'Call openagents_login or retry after reconnect.'
      });
    }
    const response = this.waitForMessage(predicate);
    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      this.rejectPending(new OpenAgentsError('SEND_FAILED', 'Could not send the OpenAgents request.', {
        retryable: true,
        recovery: 'Retry after the MCP server reconnects.',
        cause: error
      }));
    }
    return response;
  }

  /**
   * Tek bir görevi taze bir TaskView olarak okur. Commit sonrası uzlaştırmada
   * kullanılır: teslim gerçekten düştü mü, sorusunu sunucuya sorar.
   */
  private async refreshTaskView(taskId: string): Promise<TaskView | null> {
    const raw = await this.runExclusive(() => this.getRawProjectsInternal());
    const project = collectProjects(raw).find((item) => asString(item.id) === taskId);
    return project ? projectToTask(project) : null;
  }

  private async getRawProjectsInternal(): Promise<RawProjectList> {
    await this.ensureConnectedInternal();
    const response = await this.request({ type: 'project_list' }, (message) => message.type === 'project_list');
    return {
      openProjects: Array.isArray(response.openProjects) ? response.openProjects.map(asRecord) : [],
      myProjects: Array.isArray(response.myProjects) ? response.myProjects.map(asRecord) : []
    };
  }
}
