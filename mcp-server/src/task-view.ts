import {
  asNumber,
  asRecord,
  asString,
  asStringArray,
  type JsonObject,
  type ListTasksInput,
  type ListTasksResult,
  type RawProjectList,
  type ReviewEvidenceSummaryView,
  type ReviewFeedbackView,
  type ReviewView,
  type SubmissionAccessView,
  type TaskView
} from './types.js';
import { OpenAgentsError } from './errors.js';

function participant(value: unknown): { id: string; name: string } | null {
  const record = asRecord(value);
  const id = asString(record.id);
  if (!id) return null;
  return { id, name: asString(record.name) };
}

function safeDelivery(value: unknown): JsonObject | null {
  const raw = asRecord(value);
  const allowed = [
    'source', 'sourceUrl', 'repo', 'prUrl', 'branch', 'commitSha', 'artifactUrl',
    'driveUrl', 'figmaUrl', 'notionUrl', 'installCommand', 'testCommand', 'notes'
  ];
  const result: JsonObject = {};
  for (const key of allowed) {
    if (typeof raw[key] === 'string' && raw[key]) result[key] = raw[key];
  }
  if (raw.redactedUntilPaid === true) result.redactedUntilPaid = true;
  return Object.keys(result).length > 0 ? result : null;
}

// Only step name/status and plain string blocker/warning lists may cross the
// MCP boundary; raw output/findings/fatalErrors/interactions stay server-side
// to keep the prompt-injection surface minimal.
function safeEvidenceSummary(value: unknown): ReviewEvidenceSummaryView {
  const raw = asRecord(value);
  const steps = Array.isArray(raw.steps)
    ? raw.steps.filter((step): step is JsonObject => step !== null && typeof step === 'object' && !Array.isArray(step))
    : [];
  return {
    steps: steps.slice(0, 20).map((step) => ({
      name: asString(step.name),
      status: typeof step.status === 'string' ? step.status : null
    })),
    blockers: asStringArray(raw.blockers).slice(0, 20),
    warnings: asStringArray(raw.warnings).slice(0, 20)
  };
}

function safeReview(value: unknown): ReviewView | null {
  const raw = asRecord(value);
  if (Object.keys(raw).length === 0) return null;
  return {
    status: asString(raw.status, 'not_requested'),
    decision: typeof raw.decision === 'string' ? raw.decision : null,
    notes: asString(raw.notes),
    requestedAt: typeof raw.requestedAt === 'number' ? raw.requestedAt : null,
    reviewedAt: typeof raw.reviewedAt === 'number' ? raw.reviewedAt : null,
    evidenceSummary: safeEvidenceSummary(raw.evidence)
  };
}

// Dedicated review-feedback view for openagents_get_review_feedback: the safe
// review fields plus the reviewer display name. Reviewer identity stays a
// plain string; no reviewer secrets or raw evidence cross the boundary.
export function reviewFeedbackFromReview(value: unknown): ReviewFeedbackView | null {
  const safe = safeReview(value);
  if (!safe) return null;
  return { ...safe, reviewerName: asString(asRecord(value).reviewerName) };
}

// The OpenAgents server exposes the task branch, repository, commit endpoint
// and one-shot commit token only to the assigned worker. When present, the
// worker must deliver through this gateway so the artifact lives where the
// platform decides (repo/branch chosen by OpenAgents), not on an arbitrary URL.
// The commit token itself deliberately never leaves the client: the mapped view
// carries only WHERE the platform wants the delivery, and submitFiles() reads
// the token straight from the raw project payload when it commits.
function safeSubmissionAccess(value: unknown): SubmissionAccessView | null {
  const raw = asRecord(value);
  const branch = asString(raw.branch);
  const repo = asString(raw.repo);
  const endpoint = asString(raw.endpoint);
  if (!branch || !repo || !endpoint) return null;
  return {
    branch,
    repo,
    endpoint,
    tokenVersion: asNumber(raw.tokenVersion),
    endpointPath: asString(raw.endpointPath),
    helperPath: asString(raw.helperPath),
    lastSubmittedAt: typeof raw.lastSubmittedAt === 'number' ? raw.lastSubmittedAt : null,
    lastCommitSha: typeof raw.lastCommitSha === 'string' && raw.lastCommitSha ? raw.lastCommitSha : null
  };
}

export function projectToTask(project: JsonObject): TaskView {
  const preferences = asRecord(project.deliveryPreferences);
  return {
    id: asString(project.id),
    title: asString(project.title),
    description: asString(project.description),
    budget: asNumber(project.budget),
    currency: asString(project.currency, 'TRY').toUpperCase(),
    deadline: typeof project.deadline === 'string' && project.deadline ? project.deadline : null,
    skills: asStringArray(project.skills),
    status: asString(project.status),
    paymentStatus: asString(project.paymentStatus, null),
    owner: participant(project.owner),
    worker: participant(project.worker),
    deliveryPreferences: {
      acceptedTargets: asStringArray(preferences.acceptedTargets),
      preferredLocation: asString(preferences.preferredLocation),
      defaultInstallCommand: asString(preferences.defaultInstallCommand),
      defaultTestCommand: asString(preferences.defaultTestCommand),
      reviewInstructions: asString(preferences.reviewInstructions)
    },
    submissionAccess: safeSubmissionAccess(project.submissionAccess),
    deliverables: asStringArray(project.deliverables),
    deliveryAvailable: project.deliveryAvailable === true,
    delivery: safeDelivery(project.deliveryMeta),
    review: safeReview(project.review),
    createdAt: asNumber(project.createdAt),
    deliveredAt: typeof project.deliveredAt === 'number' ? project.deliveredAt : null
  };
}

function cursorFor(task: TaskView): string {
  return Buffer.from(JSON.stringify({ createdAt: task.createdAt, id: task.id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: number; id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    const record = asRecord(decoded);
    const createdAt = asNumber(record.createdAt, Number.NaN);
    const id = asString(record.id);
    if (!Number.isFinite(createdAt) || !id) throw new Error('invalid cursor fields');
    return { createdAt, id };
  } catch (error) {
    throw new OpenAgentsError('INVALID_CURSOR', 'The task cursor is invalid or expired.', {
      recovery: 'Call openagents_list_tasks again without a cursor.',
      cause: error
    });
  }
}

function isAfterCursor(task: TaskView, cursor: { createdAt: number; id: string }): boolean {
  return task.createdAt < cursor.createdAt || (task.createdAt === cursor.createdAt && task.id < cursor.id);
}

export function selectTasks(raw: RawProjectList, input: ListTasksInput): ListTasksResult {
  const source = input.scope === 'open'
    ? raw.openProjects
    : input.scope === 'mine'
      ? raw.myProjects
      : [...raw.openProjects, ...raw.myProjects];

  const byId = new Map<string, TaskView>();
  for (const project of source) {
    const task = projectToTask(project);
    if (task.id) byId.set(task.id, task);
  }

  const skillNeedle = input.skill?.trim().toLowerCase();
  const currency = input.currency?.trim().toUpperCase();
  let tasks = [...byId.values()].filter((task) => {
    if (input.status && task.status !== input.status) return false;
    if (input.minBudget !== undefined && task.budget < input.minBudget) return false;
    if (currency && task.currency !== currency) return false;
    if (skillNeedle && !task.skills.some((skill) => skill.toLowerCase().includes(skillNeedle))) return false;
    return true;
  });

  tasks.sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
  const totalMatched = tasks.length;
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor);
    tasks = tasks.filter((task) => isAfterCursor(task, cursor));
  }

  const page = tasks.slice(0, input.limit);
  return {
    scope: input.scope,
    tasks: page,
    totalMatched,
    nextCursor: tasks.length > input.limit && page.length > 0 ? cursorFor(page[page.length - 1]!) : null
  };
}
